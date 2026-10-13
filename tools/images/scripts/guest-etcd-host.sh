#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces the etcd-host VM:
# Ubuntu 24.04 + etcd/etcdctl/etcdutl (ETCD_VERSION, sha256-pinned release tarball)
# in /usr/local/bin, a system user `etcd`, and etcd.service running a single TLS
# member on 127.0.0.1:2379 with per-VM certificates under /etc/qm-etcd/pki.
# Users and ssh keys come from cloud-init at boot, as on the kubeadm node image.
source /opt/cloudtrain/build/guest-common.sh

grow_root
base_setup

tmp=$(mktemp -d)
tar -xzf /opt/cloudtrain/build/etcd.tar.gz -C "$tmp" --strip-components=1
install -m 0755 "$tmp/etcd" "$tmp/etcdctl" "$tmp/etcdutl" /usr/local/bin/
rm -rf "$tmp"
/usr/local/bin/etcd --version | grep -q "etcd Version: ${ETCD_VERSION#v}"
etcdctl completion bash > /etc/bash_completion.d/etcdctl
etcdutl completion bash > /etc/bash_completion.d/etcdutl

id etcd >/dev/null 2>&1 || useradd --system --home-dir /var/lib/etcd --shell /usr/sbin/nologin etcd
install -d -m 0700 -o etcd -g etcd /var/lib/etcd
install -m 0755 /opt/cloudtrain/build/cloudtrain-etcd-pki /usr/local/sbin/cloudtrain-etcd-pki
install -m 0644 /opt/cloudtrain/build/etcd.service /etc/systemd/system/etcd.service
systemctl enable etcd.service

write_release "ETCD_VERSION=${ETCD_VERSION}"
generalize
