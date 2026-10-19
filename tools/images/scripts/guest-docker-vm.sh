#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces docker-vm:29, the
# containers domain's Docker host: Ubuntu 24.04 cloud image with Docker Engine 29
# (containerd image store, the default for new installs), buildx, compose and the
# rootless extras (uidmap, slirp4netns, dbus-user-session), all at exact versions and
# held. The images in tools/images/docker-vm/preload-images.txt are pulled BY DIGEST
# into containerd's `moby` namespace (what the engine's image store reads), so labs
# build and run with no registry. No apt source needs the internet. No users or keys
# are baked in (cloud-init injects `learner`, keys, host key); labs add the learner to
# the docker group themselves when they want it. Supply-chain tools: cosign, notation, trivy
# with an offline vulnerability DB in /var/lib/trivy, and the BuildKit/syft-scanner images.
source /opt/cloudtrain/build/guest-common.sh

grow_root
base_setup uidmap dbus-user-session slirp4netns iptables nftables tcpdump dnsutils \
  netcat-openbsd iproute2 vim nano less tmux man-db manpages git python3 skopeo tree \
  strace lsof psmisc apache2-utils sudo cron

install -m 0755 -d /etc/apt/keyrings
fetch_key https://download.docker.com/linux/ubuntu/gpg "$DOCKER_APT_KEY_FPR" /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get -o APT::Update::Error-Mode=any update
apt-get install -y --no-install-recommends \
  "containerd.io=${CONTAINERD_VERSION}" "docker-ce=${DOCKER_CE_VERSION}" "docker-ce-cli=${DOCKER_CE_VERSION}" \
  "docker-ce-rootless-extras=${DOCKER_CE_VERSION}" "docker-buildx-plugin=${DOCKER_BUILDX_VERSION}" \
  "docker-compose-plugin=${DOCKER_COMPOSE_VERSION}"
apt-mark hold containerd.io docker-ce docker-ce-cli docker-ce-rootless-extras docker-buildx-plugin docker-compose-plugin
systemctl enable containerd docker.service docker.socket

# Lab VMs have no internet: disable every online apt source (kept for reference), so
# `apt-get update` does not hang on a lab host.
for f in /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/ubuntu.sources; do
  if [ -f "$f" ]; then mv "$f" "$f.disabled"; fi
done
if grep -q '^deb ' /etc/apt/sources.list 2>/dev/null; then mv /etc/apt/sources.list /etc/apt/sources.list.disabled; fi

# --- supply-chain CLIs and the offline Trivy DB (fetched and sha256-checked by build.sh) ---
# cosign v2, notation 1.x and trivy in /usr/local/bin; the Trivy DB in /var/lib/trivy (a
# trivy --cache-dir: db/trivy.db + db/metadata.json), world-readable; labs copy it or run
# trivy with --cache-dir /var/lib/trivy --skip-db-update (the VM is offline).
install -m 0755 "$B/tools/cosign" /usr/local/bin/cosign
tar -xzf "$B/tools/trivy.tar.gz" -C /usr/local/bin trivy
tar -xzf "$B/tools/notation.tar.gz" -C /usr/local/bin notation
chown root:root /usr/local/bin/trivy /usr/local/bin/notation; chmod 0755 /usr/local/bin/trivy /usr/local/bin/notation
D=/usr/share/doc/cloudtrain-supply-chain; install -d "$D/trivy" "$D/notation"
tar -xzf "$B/tools/trivy.tar.gz" -C "$D/trivy" LICENSE
tar -xzf "$B/tools/notation.tar.gz" -C "$D/notation" LICENSE
cat > "$D/README" <<R
Separate programs, unmodified upstream release binaries (source: the release tags below).
cosign   ${COSIGN_VERSION}   Apache-2.0  https://github.com/sigstore/cosign    (/usr/share/common-licenses/Apache-2.0)
notation ${NOTATION_VERSION}   Apache-2.0  https://github.com/notaryproject/notation
trivy    ${TRIVY_VERSION}  Apache-2.0  https://github.com/aquasecurity/trivy
Trivy DB (/var/lib/trivy) ghcr.io/${TRIVY_DB_REPO}:2 layer sha256:${TRIVY_DB_LAYER_SHA256}, built ${TRIVY_DB_CREATED}:
  vulnerability data aggregated from public advisory sources, each under its source's terms.
BuildKit images (moby/buildkit, docker/buildkit-syft-scanner) are Apache-2.0, preloaded as images.
R
install -d -m 0755 /var/lib/trivy/db
tar -xzf "$B/tools/trivy-db.tar.gz" -C /var/lib/trivy/db
test -s /var/lib/trivy/db/trivy.db && test -s /var/lib/trivy/db/metadata.json
cosign version
notation version
trivy --cache-dir /var/lib/trivy version
chmod -R a+rX /var/lib/trivy

# --- preload images into the engine's image store (containerd namespace moby) ---
install -d /opt/cloudtrain/images
cp "$B/docker-images.txt" /opt/cloudtrain/images/images.txt
containerd >/tmp/containerd.log 2>&1 &
CPID=$!
for _ in $(seq 1 30); do ctr version >/dev/null 2>&1 && break; sleep 1; done
# Lines are <name>:<tag>@<digest>: pull by digest, then name it by tag (what labs use).
while read -r ref; do
  [ -n "$ref" ] || continue
  tagged=${ref%@*}; bydigest=${tagged%:*}@${ref#*@}
  for try in 1 2 3; do
    ctr -n moby images pull "${CTR_HOSTS[@]}" --platform linux/amd64 "$bydigest" >/dev/null && break
    [ "$try" = 3 ] && { echo "pull failed: $bydigest"; exit 1; }; sleep 5
  done
  ctr -n moby images tag --force "$bydigest" "$tagged" >/dev/null
  ctr -n moby images rm "$bydigest" >/dev/null
done < /opt/cloudtrain/images/images.txt
ctr -n moby images ls -q | grep -v '^sha256:' | sort | tee /opt/cloudtrain/images/IMAGES
sed 's/@.*//' /opt/cloudtrain/images/images.txt | sort -u | comm -23 - /opt/cloudtrain/images/IMAGES | tee /tmp/missing
[ ! -s /tmp/missing ]
kill $CPID; wait $CPID || true
rm -rf /tmp/ct-hosts
rm -f /tmp/containerd.log

write_release \
  "DOCKER_VERSION=$(dpkg-query -W -f='${Version}' docker-ce)" \
  "BUILDX_VERSION=$(dpkg-query -W -f='${Version}' docker-buildx-plugin)" \
  "COMPOSE_VERSION=$(dpkg-query -W -f='${Version}' docker-compose-plugin)" \
  "CONTAINERD_PACKAGE=${CONTAINERD_VERSION}" \
  "COSIGN_VERSION=${COSIGN_VERSION}" "NOTATION_VERSION=${NOTATION_VERSION}" "TRIVY_VERSION=${TRIVY_VERSION}" \
  "TRIVY_DB_CREATED=${TRIVY_DB_CREATED}"

generalize
