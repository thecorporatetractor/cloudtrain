#!/usr/bin/env bash
# Builds the etcd disaster-recovery exercise on the ledger-etcd VM.
#
#   /etc/qm-etcd/pki/           server PKI and the grader's client identity (root only)
#   /srv/qm-dr/tls/             client identity handed to the learner
#   /srv/qm-dr/archive/         baseline snapshot; the learner's snapshot goes here too
#   /var/lib/etcd               live data dir served by etcd.service on 127.0.0.1:2379
#
# Datasets (the marker key tells them apart):
#   baseline: /quillmoor/dataset=baseline, namespace archived-waybills
#   live:     /quillmoor/dataset=live,     namespaces freight-quotes, dock-slots
#
# Idempotent: every run tears the previous state down first.
set -euo pipefail

LAB_DIR="$(cd "$(dirname "$0")" && pwd)"
PKI=/etc/qm-etcd/pki
TLS=/srv/qm-dr/tls
ARCHIVE=/srv/qm-dr/archive
UNIT=/etc/systemd/system/etcd.service

for bin in etcd etcdctl etcdutl openssl; do
  command -v "$bin" >/dev/null || { echo "missing $bin: use the etcd-host image" >&2; exit 1; }
done

bash "$LAB_DIR/teardown-etcd.sh"

id etcd >/dev/null 2>&1 || useradd --system --home-dir /var/lib/etcd --shell /usr/sbin/nologin etcd

# ---- PKI -------------------------------------------------------------------
install -d -m 0755 "$PKI" "$TLS"
cd "$PKI"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/O=Quillmoor Logistics/CN=ledger-etcd-ca" \
  -keyout ca.key -out ca.crt 2>/dev/null

issue() { # name cn extfile-lines...
  local name=$1 cn=$2; shift 2
  printf '%s\n' "$@" > "$name.ext"
  openssl req -newkey rsa:2048 -nodes -subj "/O=Quillmoor Logistics/CN=$cn" -keyout "$name.key" -out "$name.csr" 2>/dev/null
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days 30 -extfile "$name.ext" -out "$name.crt" 2>/dev/null
  rm -f "$name.csr" "$name.ext"
}
issue server ledger-etcd "subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:ledger-etcd" "extendedKeyUsage=serverAuth,clientAuth"
issue grader cloudtrain-grader "extendedKeyUsage=clientAuth"
issue operator dr-operator "extendedKeyUsage=clientAuth"
chown -R etcd:etcd "$PKI"; chmod 0600 "$PKI"/*.key

cp ca.crt "$TLS/ca.pem"
cp operator.crt "$TLS/dr-operator.pem"
cp operator.key "$TLS/dr-operator-key.pem"
rm -f operator.crt operator.key
chown -R root:learner "$TLS" 2>/dev/null || true
chmod 0640 "$TLS/dr-operator-key.pem"

# ---- baseline snapshot from a throwaway, plaintext etcd -------------------
install -d -m 0750 "$ARCHIVE"
chgrp learner "$ARCHIVE" 2>/dev/null || true
tmp=$(mktemp -d)
etcd --name=ledger-etcd --data-dir="$tmp/data" \
  --listen-client-urls=http://127.0.0.1:23790 --advertise-client-urls=http://127.0.0.1:23790 \
  --listen-peer-urls=http://127.0.0.1:23800 --initial-advertise-peer-urls=http://127.0.0.1:23800 \
  --initial-cluster=ledger-etcd=http://127.0.0.1:23800 >"$tmp/etcd.log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -rf "$tmp"' EXIT
for _ in $(seq 50); do etcdctl --endpoints=http://127.0.0.1:23790 endpoint health >/dev/null 2>&1 && break; sleep 0.2; done
e() { etcdctl --endpoints=http://127.0.0.1:23790 "$@" >/dev/null; }
e put /quillmoor/dataset baseline
e put /registry/namespaces/default '{"kind":"Namespace","metadata":{"name":"default"}}'
e put /registry/namespaces/archived-waybills '{"kind":"Namespace","metadata":{"name":"archived-waybills"}}'
for i in $(seq 1 40); do e put "/quillmoor/waybills/WB-$((7100 + i))" "archived"; done
etcdctl --endpoints=http://127.0.0.1:23790 snapshot save "$ARCHIVE/ledger-baseline.db" >/dev/null
kill $pid; wait $pid 2>/dev/null || true
chmod 0640 "$ARCHIVE/ledger-baseline.db"; chgrp learner "$ARCHIVE/ledger-baseline.db" 2>/dev/null || true

# ---- live service ----------------------------------------------------------
install -m 0644 "$LAB_DIR/etcd.service" "$UNIT"
install -d -m 0700 -o etcd -g etcd /var/lib/etcd
systemctl daemon-reload
systemctl enable --now etcd.service

g() { etcdctl --endpoints=https://127.0.0.1:2379 --cacert="$PKI/ca.crt" --cert="$PKI/grader.crt" --key="$PKI/grader.key" "$@"; }
for _ in $(seq 50); do g endpoint health >/dev/null 2>&1 && break; sleep 0.2; done
g put /quillmoor/dataset live >/dev/null
g put /registry/namespaces/default '{"kind":"Namespace","metadata":{"name":"default"}}' >/dev/null
g put /registry/namespaces/freight-quotes '{"kind":"Namespace","metadata":{"name":"freight-quotes"}}' >/dev/null
g put /registry/namespaces/dock-slots '{"kind":"Namespace","metadata":{"name":"dock-slots"}}' >/dev/null
for i in $(seq 1 60); do g put "/quillmoor/quotes/FQ-$((52000 + i))" "open" >/dev/null; done
echo "ledger etcd ready"
