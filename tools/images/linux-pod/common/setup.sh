#!/bin/sh
# Shared setup of the tier-A Linux learner pods. Args: <el|deb> <mirror url> <tini version> <tini sha256>
set -eux
family=$1 mirror=$2 tini_v=$3 tini_sha=$4
here=/tmp/common

# PID 1: tini reaps orphans (process labs create zombies on purpose), then cloudtrain-init.
curl -fsSL -o /usr/local/sbin/tini "https://github.com/krallin/tini/releases/download/${tini_v}/tini-static-amd64"
echo "${tini_sha}  /usr/local/sbin/tini" | sha256sum -c -
chmod 0755 /usr/local/sbin/tini
install -m 0755 "$here/cloudtrain-init" /usr/local/sbin/cloudtrain-init

# Learner: uid/gid 1000, bash, NO sudo rights (not in wheel/sudo, no sudoers entry). sudo
# itself is installed so sudo labs can add rules as root.
if [ "$family" = deb ]; then userdel -r ubuntu 2>/dev/null || true; fi
useradd -m -u 1000 -U -s /bin/bash -c "CloudTrain learner" learner
usermod -L learner
# EL ships /etc/shadow as mode 000 and unix_chkpwd as plain setuid-root; in the unprivileged
# user-namespace pod the helper cannot override the file mode, so pam_unix account checks fail
# for non-root callers (sudo: "PAM account management error"). Use the Debian scheme instead:
# group shadow reads /etc/shadow and unix_chkpwd runs setgid shadow.
if [ "$family" = el ]; then
  getent group shadow >/dev/null || groupadd -r shadow
  chgrp shadow /etc/shadow
  chmod 0640 /etc/shadow
  chgrp shadow /usr/sbin/unix_chkpwd
  chmod 2755 /usr/sbin/unix_chkpwd
fi
install -m 0644 "$here/bashrc" /etc/cloudtrain/bashrc 2>/dev/null || { mkdir -p /etc/cloudtrain; install -m 0644 "$here/bashrc" /etc/cloudtrain/bashrc; }
for f in /etc/skel/.bashrc /home/learner/.bashrc /root/.bashrc; do
  echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' >> "$f"
done
install -d -m 0700 -o learner -g learner /home/learner/.ssh

# Sample data (fictional, deterministic): /srv/samples, readable by everyone.
python3 -I "$here/gen-samples.py" /srv/samples
chmod -R a+rX /srv/samples

# Package sources: only the in-cluster mirror (labs have no internet).
case $family in
  el)
    rm -f /etc/yum.repos.d/*.repo
    cat > /etc/yum.repos.d/cloudtrain.repo <<R
[cloudtrain-el10]
name=CloudTrain mirror: AlmaLinux 10 BaseOS/AppStream/CRB subset
baseurl=${mirror}/el10/
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10
skip_if_unavailable=False
R
    ;;
  deb)
    rm -f /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list
    install -m 0644 "$here/cloudtrain-mirror.asc" /etc/apt/keyrings/cloudtrain-mirror.asc 2>/dev/null \
      || { mkdir -p /etc/apt/keyrings; install -m 0644 "$here/cloudtrain-mirror.asc" /etc/apt/keyrings/cloudtrain-mirror.asc; }
    cat > /etc/apt/sources.list.d/cloudtrain.sources <<R
Types: deb
URIs: ${mirror}/noble/
Suites: ./
Signed-By: /etc/apt/keyrings/cloudtrain-mirror.asc
R
    ;;
esac
printf '[global]\nindex-url = %s/pypi/simple/\ntrusted-host = %s\n' "$mirror" "$(echo "$mirror" | sed -E 's#https?://([^/:]+).*#\1#')" > /etc/pip.conf

. /etc/os-release
printf 'CLOUDTRAIN_IMAGE=%s\nOS=%s %s\nMIRROR_URL=%s\nTINI_VERSION=%s\n' \
  "$([ "$family" = el ] && echo el-lab || echo deb-lab)" "$ID" "$VERSION_ID" "$mirror" "$tini_v" > /etc/cloudtrain-release
