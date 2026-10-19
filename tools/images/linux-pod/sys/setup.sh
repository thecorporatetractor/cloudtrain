#!/bin/sh
# Shared setup of the tier-B systemd pod images, after the family's packages are installed.
# Args: <deb|el> <catalog image name> <lab kernel release>
set -eux
family=$1 name=$2 release=$3
install -m 0755 /tmp/sys/ct-sysinit /usr/local/sbin/ct-sysinit

# A container: no udev, logind, gettys or first-boot wizard. sshd starts at boot (host keys
# generated on first start), as on the lab VMs.
for u in systemd-udevd.service systemd-udevd-control.socket systemd-udevd-kernel.socket \
         systemd-udev-trigger.service systemd-logind.service getty.target console-getty.service \
         systemd-firstboot.service systemd-remount-fs.service; do
  systemctl mask "$u" 2>/dev/null || true
done
case $family in
  deb) ssh=ssh.service ;;
  el) ssh=sshd.service ;;
esac
systemctl enable "$ssh"
mkdir -p "/etc/systemd/system/$ssh.d"
printf '[Service]\nExecStartPre=/usr/bin/ssh-keygen -A\n' > "/etc/systemd/system/$ssh.d/10-hostkeys.conf"

# The learner administers the node, as on the lab VMs: passwordless sudo, key login allowed
# (no password: '*', not a locked '!' account that sshd refuses).
printf 'learner ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/90-learner
chmod 0440 /etc/sudoers.d/90-learner
usermod -p '*' learner

# The Kata guest loads no modules: the lab kernel has the lab's features built in. Its
# modules.builtin (tools/images/kata-kernel) under /lib/modules/<release> lets
# `modprobe <built-in>` succeed there, as it does on a distro kernel. Other kernels (runc,
# the stock Kata kernel) see no module tree for their release, so nothing is faked.
install -D -m 0644 /tmp/sys/modules.builtin "/lib/modules/$release/modules.builtin"
: > "/lib/modules/$release/modules.order"
depmod -a "$release"
modprobe -n -S "$release" sch_netem

sed -i "s/^CLOUDTRAIN_IMAGE=.*/CLOUDTRAIN_IMAGE=$name/" /etc/cloudtrain-release
printf 'TIER=B\nSYSTEMD=1\nLAB_KERNEL_RELEASE=%s\n' "$release" >> /etc/cloudtrain-release
