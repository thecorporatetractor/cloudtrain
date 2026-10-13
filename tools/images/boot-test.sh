#!/usr/bin/env bash
# Boot-test CloudTrain VM images on the dev cluster, OFFLINE, one VM at a time.
#
# Usage: boot-test.sh [kubeadm-node|kubeadm-upgrade|etcd-host ...]   (default: all)
#
# Per image, in a fresh namespace: an isolated Kube-OVN VPC (no route to the platform
# network or the internet, the same model as lab:demo), the VM booted from the
# containerDisk with the runtime's cloud-init conventions (user `learner`, ssh key,
# passwordless sudo), and a tester pod (jumphost image) whose only NIC is in the VPC.
# Every check runs over ssh from the tester, as the learner would. The namespace,
# VPC and subnet are deleted afterwards (KEEP=1 keeps them).
#
#   all           VM Running, ssh as learner, /etc/cloudtrain-release, no internet
#   kubeadm-node  `crictl images` lists every locked workload image; single-node
#                 `kubeadm init` + Flannel; one Pod per workload image Running offline
#   kubeadm-upgrade  as above on the N-1 release, then the offline upgrade:
#                 apt-get update/install of the staged kubeadm/kubelet/kubectl,
#                 `kubeadm upgrade apply <staged> --etcd-upgrade=false`, kubelet restart,
#                 node and kube-apiserver report the staged version
#   etcd-host     etcd.service active, `etcdctl endpoint health` over mutual TLS passes,
#                 a client without a certificate is refused, then the
#                 etcd-snapshot-restore lab's own provision script + solution run
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
for t in kubectl jq ssh-keygen docker; do need "$t"; done
HERE="$REPO_ROOT/tools/images"
RESULTS="$REPO_ROOT/deploy/.results/image-test"; mkdir -p "$RESULTS"
LABEL=cloudtrain.dev/image-test
VM_IP=192.168.100.10
TESTER_IP=192.168.100.11

clean_ns() {
  local ns=$1
  log "deleting $ns"
  k delete ns "$ns" --wait=true --timeout=300s >/dev/null 2>&1 || true
  k delete subnet "$ns" --ignore-not-found >/dev/null
  k delete vpc "$ns" --ignore-not-found >/dev/null
}
if [[ ${1:-} == --clean ]]; then
  for ns in $(k get ns -l "$LABEL" -o name | cut -d/ -f2); do clean_ns "$ns"; done
  exit 0
fi

image_of() {
  case $1 in
    kubeadm-node)    echo "${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION}" ;;
    kubeadm-upgrade) echo "${GOLDEN_IMAGE_REPO}:${UPGRADE_IMAGE_TAG}" ;;
    etcd-host)       echo "$ETCD_HOST_IMAGE" ;;
    *) die "unknown image '$1'" ;;
  esac
}

run_test() {
  local variant=$1 img mem ns work
  img=$(image_of "$variant")
  case $variant in etcd-host) mem=1Gi ;; *) mem=2560Mi ;; esac
  ns="ctimg-$variant-$(date +%H%M%S)"
  work=$(mktemp -d)
  NS=$ns; WORK=$work
  [[ ${KEEP:-0} == 1 ]] || trap 'rm -rf "$WORK"; clean_ns "$NS"' EXIT
  OUT="$RESULTS/$variant.txt"; : > "$OUT"

  bash "$HERE/load.sh" "$variant" jumphost

  ssh-keygen -q -t ed25519 -N '' -C learner@tester -f "$work/id_ed25519"
  cat > "$work/userdata" <<EOF
#cloud-config
hostname: $variant
manage_etc_hosts: true
ssh_pwauth: false
users:
  - name: learner
    gecos: CloudTrain learner
    groups: [sudo]
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys: ["$(cat "$work/id_ed25519.pub")"]
write_files:
  - path: /etc/cloudtrain/resolv.conf
    content: |
      nameserver 192.168.100.1
EOF

  log "[$variant] namespace $ns, image $img"
  k create ns "$ns" >/dev/null
  k label ns "$ns" "$LABEL=$variant" >/dev/null
  k -n "$ns" create secret generic vm-cloudinit --from-file=userdata="$work/userdata" >/dev/null
  k -n "$ns" create secret generic tester-ssh --from-file=id_ed25519="$work/id_ed25519" >/dev/null
  cat <<EOF | k apply -f - >/dev/null
apiVersion: kubeovn.io/v1
kind: Vpc
metadata: { name: $ns, labels: { $LABEL: $variant } }
spec: {}
---
apiVersion: kubeovn.io/v1
kind: Subnet
metadata: { name: $ns, labels: { $LABEL: $variant } }
spec: { vpc: $ns, protocol: IPv4, cidrBlock: 192.168.100.0/24, gateway: 192.168.100.1 }
EOF
  wait_for "subnet $ns ready" 60 bash -c "[[ \$(kubectl --context $KUBECONTEXT get subnet $ns -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}') == True ]]"
  cat <<EOF | k apply -f - >/dev/null
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata: { name: vm, namespace: $ns }
spec:
  runStrategy: Always
  template:
    metadata:
      annotations: { ovn.kubernetes.io/logical_switch: $ns, ovn.kubernetes.io/ip_address: $VM_IP }
    spec:
      domain:
        cpu: { cores: 2 }
        memory: { guest: $mem }
        resources: { requests: { memory: $mem } }
        devices:
          disks:
            - { name: root, disk: { bus: virtio } }
            - { name: cloudinit, disk: { bus: virtio } }
          interfaces: [{ name: default, bridge: {} }]
          rng: {}
      networks: [{ name: default, pod: {} }]
      volumes:
        - { name: root, containerDisk: { image: $img, imagePullPolicy: IfNotPresent } }
        - { name: cloudinit, cloudInitNoCloud: { secretRef: { name: vm-cloudinit } } }
---
apiVersion: v1
kind: Pod
metadata:
  name: tester
  namespace: $ns
  annotations: { ovn.kubernetes.io/logical_switch: $ns, ovn.kubernetes.io/ip_address: $TESTER_IP }
spec:
  automountServiceAccountToken: false
  securityContext: { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 }
  hostAliases: [{ ip: $VM_IP, hostnames: [vm] }]
  containers:
    - name: shell
      image: $JUMPHOST_IMAGE
      imagePullPolicy: IfNotPresent
      command: [bash, -c, "install -m600 /etc/t/id_ed25519 ~/.ssh/ && printf 'Host vm\\n User learner\\n StrictHostKeyChecking no\\n UserKnownHostsFile /dev/null\\n LogLevel ERROR\\n ConnectTimeout 5\\n' > ~/.ssh/config && exec sleep infinity"]
      resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { memory: 256Mi } }
      volumeMounts: [{ name: ssh, mountPath: /etc/t, readOnly: true }]
  volumes: [{ name: ssh, secret: { secretName: tester-ssh, defaultMode: 0440 } }]
EOF
  local t0=$SECONDS
  k -n "$ns" wait vmi/vm --for=jsonpath='{.status.phase}'=Running --timeout=300s >/dev/null || die "[$variant] VMI not Running"
  log "[$variant] VMI Running after $((SECONDS - t0))s"
  k -n "$ns" wait pod/tester --for=condition=Ready --timeout=120s >/dev/null || die "[$variant] tester pod not Ready"
  wait_for "[$variant] ssh learner@vm" 600 k -n "$ns" exec tester -- ssh vm true
  log "[$variant] ssh ready after $((SECONDS - t0))s"
  # vmrun: run stdin as a root bash script on the VM (ssh as learner + sudo), log it.
  vmrun() { k -n "$NS" exec -i tester -- ssh vm 'sudo bash -s' 2>&1 | tee -a "$OUT"; return "${PIPESTATUS[0]}"; }

  vmrun <<'EOS' || die "[$variant] base checks failed (see $OUT)"
set -e
echo "== whoami via ssh: $SUDO_USER, host $(hostname)"; cat /etc/cloudtrain-release
cloud-init status --wait >/dev/null || true
if timeout 3 bash -c '</dev/tcp/1.1.1.1/443' 2>/dev/null; then echo "FAIL: VM reaches the internet"; exit 1; fi
echo "ok: no internet from the VM"
EOS
  "test_$variant" || die "[$variant] FAILED (see $OUT)"
  log "[$variant] PASSED in $((SECONDS - t0))s (log: $OUT)"
  if [[ ${KEEP:-0} == 1 ]]; then log "KEEP=1: $ns left running"; else rm -rf "$work"; clean_ns "$ns"; trap - EXIT; fi
}

# kubeadm_single_node <version>: init a schedulable single-node cluster offline.
kubeadm_single_node() {
  cat <<EOS
set -e
cat > /root/kubeadm.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
localAPIEndpoint: { advertiseAddress: $VM_IP, bindPort: 6443 }
nodeRegistration: { name: vm, criSocket: unix:///run/containerd/containerd.sock, taints: [] }
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: $1
networking: { podSubnet: 10.244.0.0/16, serviceSubnet: 10.96.0.0/12 }
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: systemd
resolvConf: /etc/cloudtrain/resolv.conf
EOF
kubeadm init --config /root/kubeadm.yaml > /var/log/kubeadm.log 2>&1 || { tail -30 /var/log/kubeadm.log; exit 1; }
export KUBECONFIG=/etc/kubernetes/admin.conf
kubectl apply -f /opt/cloudtrain/manifests/kube-flannel.yml >/dev/null
for i in \$(seq 90); do kubectl get node vm --no-headers 2>/dev/null | grep -qw Ready && break; sleep 2; done
kubectl get nodes -o wide
EOS
}

# workload_pods: one Pod per locked workload image (never pulled: imagePullPolicy Never).
workload_pods() {
  local i=0 ref
  echo 'set -e; export KUBECONFIG=/etc/kubernetes/admin.conf'
  echo "cat <<'EOF' | kubectl apply -f -"
  while read -r ref; do
    ref=${ref%@*}
    echo '---'
    echo "{\"apiVersion\":\"v1\",\"kind\":\"Pod\",\"metadata\":{\"name\":\"w$i\",\"labels\":{\"t\":\"w\"}},\"spec\":{\"containers\":[{\"name\":\"c\",\"image\":\"${ref#docker.io/library/}\",\"imagePullPolicy\":\"Never\",\"command\":[\"sleep\",\"3600\"]}]}}"
    i=$((i + 1))
  done < <(grep -v '^#' "$HERE/lock/workloads.lock" | grep .)
  echo 'EOF'
  echo 'kubectl wait pod -l t=w --for=condition=Ready --timeout=180s || { kubectl get pods -o wide; kubectl describe pods | grep -A5 Events; exit 1; }'
  echo 'kubectl get pods -o custom-columns=POD:.metadata.name,IMAGE:.spec.containers[0].image,PHASE:.status.phase'
}

crictl_has_workloads() {
  echo 'set -e; crictl images | tee /tmp/crictl.txt'
  local ref
  while read -r ref; do
    ref=${ref%@*}
    echo "grep -qE '^${ref%:*} +${ref##*:} ' /tmp/crictl.txt && echo 'ok: preloaded $ref' || { echo 'FAIL: $ref not preloaded'; exit 1; }"
  done < <(grep -v '^#' "$HERE/lock/workloads.lock" | grep .)
}

test_kubeadm-node() {
  crictl_has_workloads | vmrun || return 1
  kubeadm_single_node "$LAB_K8S_VERSION" | vmrun || return 1
  workload_pods | vmrun
}

test_kubeadm-upgrade() {
  local to=$LAB_K8S_VERSION
  crictl_has_workloads | vmrun || return 1
  vmrun <<EOS || return 1
set -e
for i in kube-apiserver kube-controller-manager kube-scheduler kube-proxy; do
  crictl images | grep -qE "registry.k8s.io/\$i +$to " || { echo "FAIL: staged \$i:$to not preloaded"; exit 1; }
  echo "ok: staged \$i:$to preloaded"
done
dpkg-query -W -f='\${Package} \${Version}\n' kubeadm kubelet kubectl
apt-mark showhold
EOS
  kubeadm_single_node "$UPGRADE_K8S_VERSION" | vmrun || return 1
  workload_pods | vmrun || return 1
  vmrun <<EOS
set -e
export KUBECONFIG=/etc/kubernetes/admin.conf
echo "== offline apt"; time apt-get update
apt-cache madison kubeadm
apt-mark unhold kubeadm kubelet kubectl
apt-get install -y kubeadm='${to#v}-*'
kubeadm version -o short
kubeadm upgrade plan $to 2>&1 | tail -15
kubeadm upgrade apply -y $to --etcd-upgrade=false > /var/log/kubeadm-upgrade.log 2>&1 || { tail -40 /var/log/kubeadm-upgrade.log; exit 1; }
tail -3 /var/log/kubeadm-upgrade.log
apt-get install -y kubelet='${to#v}-*' kubectl='${to#v}-*'
apt-mark hold kubeadm kubelet kubectl
systemctl daemon-reload && systemctl restart kubelet
for i in \$(seq 60); do [ "\$(kubectl get node vm -o jsonpath='{.status.nodeInfo.kubeletVersion}' 2>/dev/null)" = $to ] && break; sleep 3; done
kubectl get nodes -o wide
api=\$(kubectl -n kube-system get pod kube-apiserver-vm -o jsonpath='{.spec.containers[0].image}')
kv=\$(kubectl get node vm -o jsonpath='{.status.nodeInfo.kubeletVersion}')
echo "apiserver=\$api kubelet=\$kv"
[ "\${api##*:}" = $to ] && [ "\$kv" = $to ] && echo "ok: upgraded to $to offline"
EOS
}

test_etcd-host() {
  vmrun <<'EOS' || return 1
set -e
for i in $(seq 30); do systemctl is-active -q etcd && break; sleep 2; done
systemctl is-active etcd
etcd --version | head -1; etcdctl version | head -1; etcdutl version | head -1
ls -l /etc/qm-etcd/pki
P=/etc/qm-etcd/pki
etcdctl --endpoints=https://127.0.0.1:2379 --cacert=$P/ca.crt --cert=$P/admin.crt --key=$P/admin.key endpoint health
if etcdctl --endpoints=https://127.0.0.1:2379 --cacert=$P/ca.crt --dial-timeout=2s --command-timeout=2s get /x >/dev/null 2>&1; then
  echo "FAIL: client without certificate accepted"; exit 1; fi
echo "ok: client without certificate refused"
EOS
  # The etcd-snapshot-restore lab on this image: its setup files, provision, solution.
  local a="$REPO_ROOT/content/packs/kubernetes/labs/etcd-snapshot-restore/assets"
  [[ -d $a ]] || { warn "lab assets not found, skipping lab compatibility run"; return 0; }
  {
    echo 'set -e; install -d /opt/cloudtrain/lab /opt/cloudtrain/bin'
    for f in provision-etcd.sh teardown-etcd.sh etcd.service; do
      echo "base64 -d > /opt/cloudtrain/lab/$f <<'B64'"; base64 -w76 "$a/$f"; echo B64
    done
    echo "base64 -d > /opt/cloudtrain/bin/grader-etcdctl <<'B64'"; base64 -w76 "$a/grader-etcdctl.sh"; echo B64
    echo 'chmod 0755 /opt/cloudtrain/lab/*.sh; chmod 0700 /opt/cloudtrain/bin/grader-etcdctl'
    echo 'timeout 120 bash /opt/cloudtrain/lab/provision-etcd.sh'
    echo 'echo "before: $(/opt/cloudtrain/bin/grader-etcdctl get /quillmoor/dataset --print-value-only)"'
  } | vmrun || return 1
  # solution steps, as learner with sudo (same as the lab's `as: learner`)
  k -n "$NS" exec -i tester -- ssh vm 'bash -s' <<'EOS' 2>&1 | tee -a "$OUT"
set -e
S=ledger-evidence-q3
sudo etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/srv/qm-dr/tls/ca.pem --cert=/srv/qm-dr/tls/dr-operator.pem --key=/srv/qm-dr/tls/dr-operator-key.pem \
  snapshot save /srv/qm-dr/archive/$S.db
sudo etcdutl snapshot status /srv/qm-dr/archive/$S.db -w table
sudo systemctl stop etcd
sudo etcdutl snapshot restore /srv/qm-dr/archive/ledger-baseline.db --data-dir=/var/lib/etcd-baseline
sudo chown -R etcd:etcd /var/lib/etcd-baseline
sudo sed -i 's#--data-dir=/var/lib/etcd #--data-dir=/var/lib/etcd-baseline #' /etc/systemd/system/etcd.service
sudo systemctl daemon-reload
sudo systemctl start etcd
v=$(sudo /opt/cloudtrain/bin/grader-etcdctl get /quillmoor/dataset --print-value-only)
echo "after: $v"; [ "$v" = baseline ] && echo "ok: etcd-snapshot-restore solution passes on this image"
EOS
  [[ ${PIPESTATUS[0]} == 0 ]]
}

targets=("$@"); ((${#targets[@]})) || targets=(kubeadm-node kubeadm-upgrade etcd-host)
for t in "${targets[@]}"; do
  case $t in kubeadm-node|kubeadm-upgrade|etcd-host) ;; *) die "unknown image '$t' (kubeadm-node | kubeadm-upgrade | etcd-host)" ;; esac
done
for t in "${targets[@]}"; do run_test "$t"; done
