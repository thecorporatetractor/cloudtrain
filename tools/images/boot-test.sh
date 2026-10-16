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
#                 `kubeadm init` + Calico; one Pod per workload image Running offline;
#                 a deny-all NetworkPolicy actually blocks traffic (Calico enforces it)
#   kubeadm-upgrade  as above on the N-1 release, then the offline upgrade the lab
#                 teaches: switch kubernetes.list to the staged minor, apt-get update/
#                 install kubeadm, `kubeadm upgrade plan` (reported), `kubeadm upgrade
#                 apply <staged> --etcd-upgrade=false`, kubelet/kubectl install (reports
#                 whether the package restarts kubelet), restart, node and kube-apiserver
#                 report the staged version
#   el-vm         two blank data disks by serial, LVM over both + XFS mount, mdadm,
#                 SELinux Enforcing, firewalld active, `dnf install httpd` offline (local repo)
#   ubuntu-vm     the same disks/LVM checks, AppArmor enabled, `apt-get update/install nginx`
#                 offline (local signed repo), nftables/ufw present
#   docker-vm     Docker Engine 29 with the containerd image store, every preloaded image
#                 listed by `docker images`, offline `docker run`, BuildKit build and
#                 compose stack, published port reachable, --memory OOM kill (exit 137),
#                 then the escape-containment probe: a privileged container with the VM's
#                 / and PID namespace sees only the VM (no kubelet, no kube API, no
#                 platform node reachable)
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
  k delete subnet "$ns-lab" --ignore-not-found >/dev/null
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
    el-vm)           echo "$EL_VM_IMAGE" ;;
    ubuntu-vm)       echo "$UBUNTU_VM_IMAGE" ;;
    docker-vm)       echo "$DOCKER_VM_IMAGE" ;;
    *) die "unknown image '$1'" ;;
  esac
}

run_test() {
  local variant=$1 img mem ns work
  img=$(image_of "$variant")
  case $variant in etcd-host|el-vm|ubuntu-vm) mem=1536Mi ;; docker-vm) mem=2048Mi ;; *) mem=2560Mi ;; esac
  # Linux VM images: two blank data disks, as the vm driver attaches topology
  # resources.disks (emptyDisk for ephemeral VMs, serial ct-dataN).
  local xdisks="" xvols=""
  if [[ $variant == el-vm || $variant == ubuntu-vm ]]; then
    xdisks=$'\n            - { name: data1, serial: ct-data1, disk: { bus: virtio } }\n            - { name: data2, serial: ct-data2, disk: { bus: virtio } }'
    xvols=$'\n        - { name: data1, emptyDisk: { capacity: 1Gi } }\n        - { name: data2, emptyDisk: { capacity: 1Gi } }'
  fi
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
metadata: { name: $ns-lab, labels: { $LABEL: $variant } }
spec: { vpc: $ns, protocol: IPv4, cidrBlock: 192.168.100.0/24, gateway: 192.168.100.1 }
EOF
  wait_for "subnet $ns-lab ready" 60 bash -c "[[ \$(kubectl --context $KUBECONTEXT get subnet $ns-lab -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}') == True ]]"
  cat <<EOF | k apply -f - >/dev/null
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata: { name: vm, namespace: $ns }
spec:
  runStrategy: Always
  template:
    metadata:
      annotations: { ovn.kubernetes.io/logical_switch: $ns-lab, ovn.kubernetes.io/ip_address: $VM_IP }
    spec:
      domain:
        cpu: { cores: 2 }
        memory: { guest: $mem }
        resources: { requests: { memory: $mem } }
        devices:
          disks:
            - { name: root, disk: { bus: virtio } }
            - { name: cloudinit, disk: { bus: virtio } }$xdisks
          interfaces: [{ name: default, bridge: {} }]
          rng: {}
      networks: [{ name: default, pod: {} }]
      volumes:
        - { name: root, containerDisk: { image: $img, imagePullPolicy: IfNotPresent } }
        - { name: cloudinit, cloudInitNoCloud: { secretRef: { name: vm-cloudinit } } }$xvols
---
apiVersion: v1
kind: Pod
metadata:
  name: tester
  namespace: $ns
  annotations: { ovn.kubernetes.io/logical_switch: $ns-lab, ovn.kubernetes.io/ip_address: $TESTER_IP }
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
/opt/cloudtrain/bin/cni-install 10.244.0.0/16
for i in \$(seq 120); do kubectl get node vm --no-headers 2>/dev/null | grep -qw Ready && break; sleep 2; done
kubectl -n kube-system rollout status ds/calico-node --timeout=240s
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

# netpol_enforced: httpd reachable from a client Pod, then unreachable once a deny-all
# ingress NetworkPolicy selects it (Flannel would let it through; Calico must not).
netpol_enforced() {
  cat <<'EOS'
set -e; export KUBECONFIG=/etc/kubernetes/admin.conf
kubectl run web --image=httpd:2.4-alpine --labels=app=web --image-pull-policy=Never --port=80
kubectl run client --image=busybox:1.37 --image-pull-policy=Never -- sleep 3600
kubectl wait pod web client --for=condition=Ready --timeout=120s
ip=$(kubectl get pod web -o jsonpath='{.status.podIP}')
kubectl exec client -- wget -qO- -T 3 "http://$ip/" | head -1
echo "ok: web reachable before the policy"
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: deny-web }
spec: { podSelector: { matchLabels: { app: web } }, policyTypes: [Ingress] }
EOF
for i in $(seq 15); do kubectl exec client -- wget -qO- -T 2 "http://$ip/" >/dev/null 2>&1 || { echo "ok: NetworkPolicy enforced (web blocked)"; exit 0; }; sleep 2; done
echo "FAIL: NetworkPolicy not enforced"; exit 1
EOS
}

test_kubeadm-node() {
  crictl_has_workloads | vmrun || return 1
  kubeadm_single_node "$LAB_K8S_VERSION" | vmrun || return 1
  workload_pods | vmrun || return 1
  netpol_enforced | vmrun
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
  local from=$UPGRADE_K8S_MINOR tominor=$LAB_K8S_MINOR
  vmrun <<EOS
set -e
export KUBECONFIG=/etc/kubernetes/admin.conf
echo "== apt sources"; grep -rh '^deb\|^URIs' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null || true
echo "== offline apt-get update ($from)"; time apt-get update
apt-cache madison kubeadm
echo "== learner switches the repo to $tominor"
sed -i 's#/$from/#/$tominor/#' /etc/apt/sources.list.d/kubernetes.list
cat /etc/apt/sources.list.d/kubernetes.list
time apt-get update
apt-cache madison kubeadm
apt-mark unhold kubeadm kubelet kubectl
apt-get install -y kubeadm='${to#v}-*'
kubeadm version -o short
echo "== REPORT kubeadm upgrade plan (no version, offline)"
if timeout 120 kubeadm upgrade plan > /tmp/plan.log 2>&1; then echo "REPORT: 'kubeadm upgrade plan' exit 0"; else echo "REPORT: 'kubeadm upgrade plan' exit \$?"; fi
tail -25 /tmp/plan.log
echo "== REPORT kubeadm upgrade plan $to (offline)"
if timeout 120 kubeadm upgrade plan $to > /tmp/plan2.log 2>&1; then echo "REPORT: 'kubeadm upgrade plan $to' exit 0"; else echo "REPORT: 'kubeadm upgrade plan $to' exit \$?"; fi
tail -25 /tmp/plan2.log
kubeadm upgrade apply -y $to --etcd-upgrade=false > /var/log/kubeadm-upgrade.log 2>&1 || { tail -40 /var/log/kubeadm-upgrade.log; exit 1; }
tail -3 /var/log/kubeadm-upgrade.log
before=\$(systemctl show kubelet -p MainPID -p ActiveEnterTimestampMonotonic --value | paste -sd/)
apt-get install -y kubelet='${to#v}-*' kubectl='${to#v}-*'
sleep 5
after=\$(systemctl show kubelet -p MainPID -p ActiveEnterTimestampMonotonic --value | paste -sd/)
running=\$(kubectl get node vm -o jsonpath='{.status.nodeInfo.kubeletVersion}')
if [ "\$before" = "\$after" ]; then echo "REPORT: installing the kubelet package does NOT restart kubelet (pid/start \$before unchanged; node still reports \$running)"
else echo "REPORT: installing the kubelet package RESTARTED kubelet (\$before -> \$after; node reports \$running)"; fi
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
etcd --version | head -1; etcdctl version | head -1; etcdutl version | head -1; openssl version
id learner; sudo -n -u learner sudo -n true && echo "ok: learner from cloud-init has passwordless sudo"
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

# linux_vm_checks <family>: the Linux VM image contract (tier C).
linux_vm_checks() {
  cat <<'EOS'
set -e
echo "== learner from cloud-init"; id learner; sudo -n -u learner sudo -n true && echo "ok: learner has passwordless sudo"
echo "== extra blank disks by serial"
lsblk -o NAME,SIZE,TYPE,SERIAL,MOUNTPOINTS
for s in ct-data1 ct-data2; do test -b /dev/disk/by-id/virtio-$s && echo "ok: /dev/disk/by-id/virtio-$s -> $(readlink -f /dev/disk/by-id/virtio-$s)"; done
d1=$(readlink -f /dev/disk/by-id/virtio-ct-data1); d2=$(readlink -f /dev/disk/by-id/virtio-ct-data2)
echo "== LVM on the data disks"
pvcreate -q "$d1" "$d2"; vgcreate -q labvg "$d1" "$d2"; lvcreate -q -y -n data -L 1500M labvg
mkfs.xfs -q /dev/labvg/data; mkdir -p /mnt/data; mount /dev/labvg/data /mnt/data; df -h /mnt/data | tail -1
echo hello > /mnt/data/f && grep -q hello /mnt/data/f && echo "ok: LVM striped over two disks, XFS mounted"
umount /mnt/data; lvremove -q -y labvg/data; vgremove -q -y labvg; pvremove -q "$d1" "$d2"
echo "== mdadm available"; mdadm --version
EOS
}

test_el-vm() {
  linux_vm_checks | vmrun || return 1
  vmrun <<'EOS'
set -e
echo "== SELinux"; getenforce; [ "$(getenforce)" = Enforcing ] && echo "ok: SELinux Enforcing"
sestatus | head -5
echo "== firewalld"; systemctl is-active firewalld; firewall-cmd --get-default-zone; firewall-cmd --list-services
echo "== repos (offline)"; dnf -q repolist
dnf -y -q install httpd mod_ssl && rpm -q httpd && echo "ok: dnf install httpd from the local repo, offline"
systemctl start httpd && curl -fsS -o /dev/null http://127.0.0.1/ -w 'httpd %{http_code}\n' || curl -s -o /dev/null -w 'httpd %{http_code}\n' http://127.0.0.1/
ls -Z /var/www/html -d
echo "== man pages"; man -w ls
EOS
}

test_ubuntu-vm() {
  linux_vm_checks | vmrun || return 1
  vmrun <<'EOS'
set -e
echo "== AppArmor"; aa-enabled && echo "ok: AppArmor enabled"
echo "== apt (offline, local signed repo)"; grep -rh '^URIs' /etc/apt/sources.list.d/
apt-get -qq update && echo "ok: apt-get update offline"
DEBIAN_FRONTEND=noninteractive apt-get -qq install -y nginx >/dev/null && dpkg -s nginx | grep -q 'install ok' && echo "ok: apt-get install nginx from the local repo, offline"
curl -s -o /dev/null -w 'nginx %{http_code}\n' http://127.0.0.1/
echo "== nftables / ufw"; nft --version; ufw status
echo "== man pages"; man -w ls
EOS
}

test_docker-vm() {
  vmrun <<'EOS' || return 1
set -e
echo "== engine"; docker version --format 'server {{.Server.Version}} client {{.Client.Version}}'
docker info --format '{{.Driver}} {{json .DriverStatus}}' | tee /tmp/info; grep -q 'io.containerd.snapshotter' /tmp/info && echo "ok: containerd image store"
echo "== preloaded images"; docker images --format '{{.Repository}}:{{.Tag}}' | sort | tee /tmp/imgs
for i in $(sed 's/@.*//; s#^docker.io/library/##' /opt/cloudtrain/images/images.txt); do grep -qx "$i" /tmp/imgs || { echo "FAIL: $i not in docker images"; exit 1; }; done
echo "ok: every preloaded image is visible to the engine"
echo "== offline run"; docker run --rm busybox:1.37 echo ok: busybox runs
echo "== offline BuildKit build"; d=$(mktemp -d); printf 'FROM alpine:3.22\nRUN echo built > /built\nCMD ["cat","/built"]\n' > $d/Dockerfile
docker build -q -t bt/offline:1 $d >/dev/null && docker run --rm bt/offline:1 | grep -qx built && echo "ok: docker build offline"
echo "== compose + published port"; mkdir -p /tmp/cs && printf 'services:\n  web:\n    image: nginx:1.29-alpine\n    ports: ["127.0.0.1:8088:80"]\n' > /tmp/cs/compose.yaml
docker compose -f /tmp/cs/compose.yaml up -d --wait >/dev/null && curl -fsS -o /dev/null -w 'ok: compose nginx %{http_code}\n' http://127.0.0.1:8088/
docker compose -f /tmp/cs/compose.yaml down >/dev/null
echo "== cgroup memory limit"; set +e; docker run --name oomt --memory 16m busybox:1.37 sh -c 'x=a; while :; do x=$x$x; done' >/dev/null 2>&1
r=$(docker inspect -f '{{.State.ExitCode}} oom={{.State.OOMKilled}}' oomt); docker rm -f oomt >/dev/null; set -e
[ "$r" = "137 oom=true" ] && echo "ok: --memory 16m OOM-killed ($r)" || { echo "FAIL: OOM test gave $r"; exit 1; }
echo "== rootless prerequisites"; command -v newuidmap dockerd-rootless-setuptool.sh slirp4netns
echo "== man pages"; man -w docker-run 2>/dev/null || man -w docker || true
EOS
  echo "== escape containment (as learner in the docker group)" | tee -a "$OUT"
  vmrun <<'EOS' || return 1
usermod -aG docker learner
EOS
  k -n "$NS" exec -i tester -- ssh vm 'bash -s' <<'EOS' 2>&1 | tee -a "$OUT"; [[ ${PIPESTATUS[0]} == 0 ]] || return 1
set -e
docker run --rm --privileged --pid=host --net=host -v /:/host busybox:1.37 sh -c '
  echo "container uid: $(id -u)"; echo "host rootfs: $(grep CLOUDTRAIN_IMAGE= /host/etc/cloudtrain-release)"
  echo "host pid 1: $(cat /proc/1/comm)"
  if ls /host/var/lib/kubelet >/dev/null 2>&1; then echo "FAIL: kubelet state visible"; exit 1; fi; echo "ok: no kubelet state on the VM"
  if ps -o comm | grep -qE "virt-launcher|kubelet|containerd-shim-runc-v2 -namespace k8s.io"; then echo "FAIL: platform processes visible"; exit 1; fi
  echo "ok: only the VM processes are visible ($(ps -o comm | wc -l) processes)"
  for t in 10.96.0.1:443 172.31.0.2:10250 172.31.0.3:6443 1.1.1.1:443; do
    if timeout 3 nc -z ${t%:*} ${t#*:} 2>/dev/null; then echo "FAIL: $t reachable"; exit 1; fi; echo "ok: $t unreachable"
  done'
grep -m1 -i -E 'hypervisor|KVM' /sys/class/dmi/id/sys_vendor /proc/cpuinfo 2>/dev/null | head -1 | sed 's/^/vm evidence: /' || true
EOS
}

targets=("$@"); ((${#targets[@]})) || targets=(kubeadm-node kubeadm-upgrade etcd-host el-vm ubuntu-vm)
for t in "${targets[@]}"; do
  case $t in kubeadm-node|kubeadm-upgrade|etcd-host|el-vm|ubuntu-vm|docker-vm) ;; *) die "unknown image '$t' (kubeadm-node | kubeadm-upgrade | etcd-host | el-vm | ubuntu-vm | docker-vm)" ;; esac
done
for t in "${targets[@]}"; do run_test "$t"; done
