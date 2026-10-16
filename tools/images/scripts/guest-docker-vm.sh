#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces docker-vm:29, the
# containers domain's Docker host: Ubuntu 24.04 cloud image with Docker Engine 29
# (containerd image store, the default for new installs), buildx, compose and the
# rootless extras (uidmap, slirp4netns, dbus-user-session), all at exact versions and
# held. The images in tools/images/docker-vm/preload-images.txt are pulled BY DIGEST
# into containerd's `moby` namespace (what the engine's image store reads), so labs
# build and run with no registry. No apt source needs the internet. No users or keys
# are baked in (cloud-init injects `learner`, keys, host key); labs add the learner to
# the docker group themselves when they want it.
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
    ctr -n moby images pull --platform linux/amd64 "$bydigest" >/dev/null && break
    [ "$try" = 3 ] && { echo "pull failed: $bydigest"; exit 1; }; sleep 5
  done
  ctr -n moby images tag --force "$bydigest" "$tagged" >/dev/null
  ctr -n moby images rm "$bydigest" >/dev/null
done < /opt/cloudtrain/images/images.txt
ctr -n moby images ls -q | grep -v '^sha256:' | sort | tee /opt/cloudtrain/images/IMAGES
sed 's/@.*//' /opt/cloudtrain/images/images.txt | sort -u | comm -23 - /opt/cloudtrain/images/IMAGES | tee /tmp/missing
[ ! -s /tmp/missing ]
kill $CPID; wait $CPID || true
rm -f /tmp/containerd.log

write_release \
  "DOCKER_VERSION=$(dpkg-query -W -f='${Version}' docker-ce)" \
  "BUILDX_VERSION=$(dpkg-query -W -f='${Version}' docker-buildx-plugin)" \
  "COMPOSE_VERSION=$(dpkg-query -W -f='${Version}' docker-compose-plugin)" \
  "CONTAINERD_PACKAGE=${CONTAINERD_VERSION}"

generalize
