# shellcheck shell=bash
# Sourced INSIDE the guest (virt-customize --run) by guest-common.sh and guest-el-vm.sh.
#
# require_auditctl: the exam freeze (services/lab-orchestrator/internal/controller/revoke.go)
# finds the learner's processes by their audit loginuid. Making loginuids immutable stops a
# root learner from rewriting /proc/self/loginuid by accident or with a simple script to
# leave their login session. It is a guard and a forensic signal, not a security boundary
# against root: root can replace the binary, this script or the unit. The freeze checks the
# kernel state itself on every VM.
#
# The image locks loginuids with the unit cloudtrain-loginuid-lock.service, which runs before
# sysinit.target, and so before sshd, ssh.socket and systemd-user-sessions (no learner can log
# in before it ran). The runtime's cloud-init bootcmd runs the same script again on every boot
# (drivers.LoginuidImmutable, kept identical by a Go test). An image without
# /usr/sbin/auditctl fails the build.
require_auditctl() {
  local a=/usr/sbin/auditctl
  [ -x "$a" ] || { echo "$a missing: install auditd (audit on EL)"; exit 1; }
  # Not run: the build appliance's kernel audit state says nothing about the VM's.
  grep -aq -- 'loginuid-immutable' "$a" || { echo "$a does not support --loginuid-immutable"; exit 1; }
  systemctl enable auditd || true
  compgen -G '/etc/systemd/system/*.wants/auditd.service' >/dev/null || { echo "auditd.service not enabled"; exit 1; }

  install -d -m 0755 /usr/lib/cloudtrain
  cat > /usr/lib/cloudtrain/loginuid-lock <<'LOCK'
#!/bin/sh
A=/usr/sbin/auditctl
m=
if [ ! -x "$A" ]; then m="$A not installed"
elif ! o=$("$A" --loginuid-immutable 2>&1); then m="auditctl --loginuid-immutable failed: $o"
elif [ ! -e /proc/self/loginuid ]; then m="state unreadable: no /proc/self/loginuid"
elif (echo 0 > /proc/self/loginuid; echo 4294967295 > /proc/self/loginuid) 2>/dev/null; then m="loginuid still mutable after auditctl"
fi
mkdir -p /run/cloudtrain
if [ -n "$m" ]; then
  echo "failed: $m" > /run/cloudtrain/loginuid-lock
  echo "cloudtrain: WARNING: loginuid lock failed (exam freeze weakened): $m" | tee -a /var/log/cloudtrain-loginuid.log /dev/console >&2
  logger -p auth.warning -t cloudtrain-loginuid "loginuid lock failed: $m" 2>/dev/null
else
  echo locked > /run/cloudtrain/loginuid-lock
fi
exit 0
LOCK
  chmod 0755 /usr/lib/cloudtrain/loginuid-lock
  sh -n /usr/lib/cloudtrain/loginuid-lock

  cat > /etc/systemd/system/cloudtrain-loginuid-lock.service <<'UNIT'
[Unit]
Description=CloudTrain: make audit loginuids immutable (exam freeze)
DefaultDependencies=no
After=local-fs.target systemd-tmpfiles-setup.service
Before=sysinit.target shutdown.target ssh.service sshd.service ssh.socket sshd.socket systemd-user-sessions.service cloud-init.service
Conflicts=shutdown.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/lib/cloudtrain/loginuid-lock

[Install]
WantedBy=sysinit.target
UNIT
  systemctl enable cloudtrain-loginuid-lock.service || true
  [ -L /etc/systemd/system/sysinit.target.wants/cloudtrain-loginuid-lock.service ] \
    || { echo "cloudtrain-loginuid-lock.service not enabled"; exit 1; }
}
