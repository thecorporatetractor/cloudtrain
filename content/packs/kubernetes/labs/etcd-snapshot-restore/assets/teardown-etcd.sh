#!/usr/bin/env bash
# Removes everything provision-etcd.sh (and the learner) may have created.
set -uo pipefail
systemctl disable --now etcd.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/etcd.service
systemctl daemon-reload
rm -rf /etc/qm-etcd /srv/qm-dr /var/lib/etcd /var/lib/etcd-* /var/lib/etcd.*
rm -rf /root/default.etcd /home/learner/default.etcd
exit 0
