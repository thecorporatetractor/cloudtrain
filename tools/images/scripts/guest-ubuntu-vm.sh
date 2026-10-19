#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces ubuntu-vm:24.04: the
# Ubuntu 24.04 cloud image with a local, signed flat apt repo /opt/cloudtrain/repo/noble
# (the mirror snapshot: curriculum packages + full dependency closure) as the ONLY apt
# source, so `apt-get update && apt-get install` work with no network; AppArmor (default),
# ufw installed but inactive, nftables, auditd, chrony, LVM/mdadm/storage tools.
# No users or keys are baked in (cloud-init injects `learner`, keys, host key).
source /opt/cloudtrain/build/guest-common.sh

grow_root
apt-get purge -y snapd unattended-upgrades || true
systemctl mask apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service

install -d /opt/cloudtrain/repo /etc/apt/keyrings
mv "$B/repo/noble" /opt/cloudtrain/repo/noble
install -m 0644 "$B/cloudtrain-mirror.asc" /etc/apt/keyrings/cloudtrain-mirror.asc
for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do [ -f "$f" ] && mv "$f" "$f.disabled"; done
cat > /etc/apt/sources.list.d/cloudtrain.sources <<R
Types: deb
URIs: file:/opt/cloudtrain/repo/noble/
Suites: ./
Signed-By: /etc/apt/keyrings/cloudtrain-mirror.asc
R
# cloud-init must not rewrite the sources at first boot (its apt module restores the online
# ubuntu.sources); keep the local repo as the only source
install -d /etc/cloud/cloud.cfg.d
cat > /etc/cloud/cloud.cfg.d/99-cloudtrain-apt.cfg <<C
apt:
  preserve_sources_list: true
C
apt-get update
apt-get install -y --no-install-recommends \
  qemu-guest-agent auditd apparmor-utils chrony nftables ufw \
  lvm2 mdadm parted gdisk xfsprogs e2fsprogs dosfstools nfs-common cryptsetup \
  bash-completion man-db manpages vim nano less tmux tar rsync lsof strace \
  dnsutils tcpdump netcat-openbsd curl wget sudo cron at jq
systemctl enable qemu-guest-agent auditd chrony || true

cat > /etc/cloudtrain-release <<R
CLOUDTRAIN_IMAGE=${CLOUDTRAIN_IMAGE##*/}
OS=Ubuntu 24.04
CLOUDTRAIN_IMAGE_TAG=${CLOUDTRAIN_IMAGE_TAG}
CLOUDTRAIN_CATALOG_REF=${CLOUDTRAIN_CATALOG_REF}
MIRROR_SNAPSHOT=${MIRROR_SNAPSHOT}
UBUNTU_APT_SNAPSHOT=${UBUNTU_APT_SNAPSHOT}
LOCAL_REPO=/opt/cloudtrain/repo/noble
BUILD_DATE=${BUILD_DATE}
GIT_REV=${GIT_REV}
R
cat /etc/cloudtrain-release
# generalize (keeps the local repo as the only source; no restore of the online sources)
rm -f "$B/ubuntu.sources.orig"
apt-get clean
rm -rf /tmp/* /var/tmp/* "$B"
cloud-init clean --logs --seed || true
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
fstrim -av || true
