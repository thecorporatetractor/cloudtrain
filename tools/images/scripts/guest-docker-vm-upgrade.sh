#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces docker-vm:28-upgrade, the host
# of ctr-engine-upgrade: the Ubuntu 24.04 cloud image with Docker Engine 28 installed and held, and
# Engine 29 (the packages docker-vm:29 runs) staged as the flat apt repo /srv/apt/engine-29, which
# the lab enables. The engine uses the containerd image store, as docker-vm:29 does, so the upgrade
# keeps its images. Images in tools/images/docker-vm/preload-images-upgrade.txt are pulled BY DIGEST
# into containerd's `moby` namespace. No apt source needs the internet. No users or keys are baked
# in (cloud-init injects `learner`, keys, host key).
source /opt/cloudtrain/build/guest-common.sh

grow_root
base_setup iptables nftables tcpdump dnsutils iproute2 vim nano less tmux man-db python3 sudo apt-utils

install -m 0755 -d /etc/apt/keyrings
fetch_key https://download.docker.com/linux/ubuntu/gpg "$DOCKER_APT_KEY_FPR" /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get -o APT::Update::Error-Mode=any update
apt-get install -y --no-install-recommends \
  "containerd.io=${CONTAINERD_VERSION}" "docker-ce=${DOCKER_CE_UPGRADE_VERSION}" "docker-ce-cli=${DOCKER_CE_UPGRADE_VERSION}"
apt-mark hold containerd.io docker-ce docker-ce-cli
install -d /etc/docker
echo '{"features": {"containerd-snapshotter": true}}' > /etc/docker/daemon.json
systemctl enable containerd docker.service docker.socket

# Engine 29 as a flat repo. Same containerd.io as installed: the upgrade replaces only dockerd and
# the CLI, so running containers keep their shims.
S=/srv/apt/engine-29
install -d "$S"
(cd "$S" && apt-get download "docker-ce=${DOCKER_CE_VERSION}" "docker-ce-cli=${DOCKER_CE_VERSION}" "containerd.io=${CONTAINERD_VERSION}" \
  && apt-ftparchive packages . > Packages && gzip -9kf Packages)
chmod -R a+rX /srv/apt
test "$(zcat "$S/Packages.gz" | grep -c '^Package: ')" = 3

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
  "STAGED_DOCKER_VERSION=${DOCKER_CE_VERSION}" \
  "CONTAINERD_PACKAGE=${CONTAINERD_VERSION}"

generalize
