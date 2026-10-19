#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces el-vm:10: the AlmaLinux 10
# GenericCloud image with
#   - a local dnf repo /opt/cloudtrain/repo/el10 (the mirror snapshot: curriculum packages +
#     full dependency closure, upstream-signed RPMs, gpgcheck=1) as the ONLY enabled repo,
#     so `dnf install` works with no network
#   - SELinux enforcing (targeted), firewalld installed and enabled, auditd, chrony
#   - admin/storage tools for Linux labs (LVM, mdadm, parted, xfsprogs, nfs-utils, ...)
#   - PSI enabled (psi=1 kernel argument)
# No users or keys are baked in: the runtime injects `learner` (passwordless sudo), root's
# authorized_keys and the ssh host key through cloud-init.
set -euxo pipefail
if [ -w /dev/console ]; then exec > >(tee -a /dev/console) 2>&1; fi
B=/opt/cloudtrain/build
source "$B/build.env"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# grow the root filesystem (XFS) into the resized virtual disk
part=$(findmnt -no SOURCE /)
disk=/dev/$(lsblk -no PKNAME "$part")
growpart "$disk" "$(cat "/sys/class/block/$(basename "$part")/partition")" || true
xfs_growfs / || resize2fs "$part" || true
df -h /

# local repo only
install -d /opt/cloudtrain/repo
mv "$B/repo/el10" /opt/cloudtrain/repo/el10
for f in /etc/yum.repos.d/*.repo; do mv "$f" "$f.disabled"; done
cat > /etc/yum.repos.d/cloudtrain.repo <<R
[cloudtrain-el10]
name=CloudTrain local repo: AlmaLinux ${ALMA_RELEASE} BaseOS/AppStream/CRB subset (mirror ${MIRROR_SNAPSHOT})
baseurl=file:///opt/cloudtrain/repo/el10/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10
R
printf 'retries=10\ntimeout=30\n' >> /etc/dnf/dnf.conf
dnf -y --setopt=install_weak_deps=False install \
  qemu-guest-agent firewalld audit policycoreutils-python-utils setools-console chrony rsyslog \
  lvm2 mdadm parted xfsprogs e2fsprogs dosfstools nfs-utils cryptsetup \
  bash-completion man-db man-pages vim-enhanced nano less tmux tar bzip2 rsync lsof strace \
  bind-utils tcpdump nmap-ncat curl wget sudo cronie at tuned cloud-utils-growpart
systemctl enable qemu-guest-agent firewalld auditd chronyd || true
# SELinux enforcing, targeted (the cloud image default; asserted here)
sed -i 's/^SELINUX=.*/SELINUX=enforcing/; s/^SELINUXTYPE=.*/SELINUXTYPE=targeted/' /etc/selinux/config
grep -q '^SELINUX=enforcing' /etc/selinux/config
# firewalld: the default zone allows ssh (and dhcpv6-client, cockpit by default)
firewall-offline-cmd --set-default-zone=public || true   # ZONE_ALREADY_SET is fine
firewall-offline-cmd --zone=public --add-service=ssh || true   # ALREADY_ENABLED is fine
firewall-offline-cmd --zone=public --list-services | grep -qw ssh

# PSI (pressure stall information): the EL kernel is built with CONFIG_PSI_DEFAULT_DISABLED, so
# /proc/pressure/* and the cgroup *.pressure files exist only with psi=1 on the command line.
# grubby updates every BLS entry; /etc/kernel/cmdline and GRUB_CMDLINE_LINUX carry it to kernels
# installed later.
grubby --update-kernel=ALL --args=psi=1
if [ -f /etc/kernel/cmdline ]; then
  grep -qw psi=1 /etc/kernel/cmdline || sed -i 's/[[:space:]]*$/ psi=1/' /etc/kernel/cmdline
fi
if grep -q '^GRUB_CMDLINE_LINUX=' /etc/default/grub && ! grep -q '^GRUB_CMDLINE_LINUX=.*psi=1' /etc/default/grub; then
  sed -i 's/^GRUB_CMDLINE_LINUX="\(.*\)"/GRUB_CMDLINE_LINUX="\1 psi=1"/' /etc/default/grub
fi
n=$(grubby --info=ALL | grep -c '^args=')
[ "$n" -gt 0 ] && [ "$(grubby --info=ALL | grep '^args=' | grep -cw 'psi=1')" = "$n" ]

cat > /etc/cloudtrain-release <<R
CLOUDTRAIN_IMAGE=${CLOUDTRAIN_IMAGE##*/}
OS=AlmaLinux ${ALMA_RELEASE}
CLOUDTRAIN_IMAGE_TAG=${CLOUDTRAIN_IMAGE_TAG}
CLOUDTRAIN_CATALOG_REF=${CLOUDTRAIN_CATALOG_REF}
MIRROR_SNAPSHOT=${MIRROR_SNAPSHOT}
LOCAL_REPO=/opt/cloudtrain/repo/el10
BUILD_DATE=${BUILD_DATE}
GIT_REV=${GIT_REV}
R
cat /etc/cloudtrain-release

# generalize
dnf clean all
rm -rf /var/cache/dnf/* /tmp/* /var/tmp/* "$B"
cloud-init clean --logs --seed || true
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
fstrim -av || true
