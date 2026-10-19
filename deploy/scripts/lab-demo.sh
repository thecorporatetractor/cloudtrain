#!/usr/bin/env bash
# lab:demo — end-to-end proof of the CloudTrain lab model on the local runtime.
#
# In a fresh namespace it builds the topology a `k8s-cluster: kubeadm` + `virtual`
# lab will use:
#
#   Kube-OVN VPC <ns> (isolated: no route to the pod network or the internet)
#     subnet <ns>-lab     192.168.100.0/24  ctl-1 .10, wrk-1 .11  (KubeVirt VMs, golden image)
#     subnet <ns>-access  192.168.99.0/24   workstation .5         (jumphost 2nd NIC, via Multus)
#   workstation pod (learner@workstation): eth0 on the platform network (reaches the
#     vcluster API), net1 into the lab VPC (reaches the VMs).
#   vcluster "virtual" in the same namespace.
#   NetworkPolicies: the workstation may only reach DNS, its own vcluster and the lab
#     VPC; pods synced from the vcluster may only reach DNS and their own namespace.
#     Step 8 asserts this isolation (and the VPC's) and fails the demo otherwise.
#
# kubeadm init/join run unattended from cloud-init. The CA and bootstrap token
# are generated here, so the worker can join with a pinned CA hash.
#
# Usage: lab-demo.sh            run, measure, then delete the lab (KEEP=1 keeps it)
#        lab-demo.sh --clean    delete every demo lab
source "$(dirname "$0")/lib.sh"
for t in kubectl vcluster openssl ssh-keygen jq docker kind awk; do need "$t"; done

LABEL=cloudtrain.dev/lab
clean_lab() {  # clean_lab <ns>
  local ns=$1
  log "deleting lab $ns"
  k delete ns "$ns" --wait=true --timeout=300s >/dev/null 2>&1 || true
  k delete subnet "$ns-lab" "$ns-access" --ignore-not-found >/dev/null
  k delete vpc "$ns" --ignore-not-found >/dev/null
}
if [[ ${1:-} == --clean ]]; then
  for ns in $(k get ns -l "$LABEL=demo" -o name | cut -d/ -f2); do clean_lab "$ns"; done
  exit 0
fi

NS="ctlab-demo-$(date +%H%M%S)"
NODE_IMAGE="${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION}"
JUMP_IMAGE="$JUMPHOST_IMAGE"   # catalog ref jumphost:1
CP_IP=192.168.100.10
WK_IP=192.168.100.11
JH_IP=192.168.99.5
WORK=$(mktemp -d)
RESULTS="$REPO_ROOT/deploy/.results"; mkdir -p "$RESULTS"
trap 'rm -rf "$WORK"' EXIT
secs() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.1f", b-a}'; }
[[ ${KEEP:-0} == 1 ]] || trap 'rm -rf "$WORK"; [[ -n ${NS:-} ]] && clean_lab "$NS"' EXIT

# --- 0. images present on the kind nodes ----------------------------------------
docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || die "golden image $NODE_IMAGE missing (run: task image:build)"
docker image inspect "$JUMP_IMAGE" >/dev/null 2>&1 || LOAD_INTO_KIND=0 "$REPO_ROOT/tools/images/build-jumphost.sh"
# Only nodes that can run VMs (KVM device advertised) need the 2+ GB golden image.
VM_NODES=$(k get nodes -o json | jq -r '.items[] | select((.status.allocatable["devices.kubevirt.io/kvm"] // "0") != "0") | .metadata.name')
[[ -n $VM_NODES ]] || die "no node advertises devices.kubevirt.io/kvm (run: task dev:verify-kvm)"
# load_image <image> <node...> (lib.sh): skips nodes that have it, falls back when `kind load` fails.
# shellcheck disable=SC2086
load_image "$NODE_IMAGE" $VM_NODES
# shellcheck disable=SC2046
load_image "$JUMP_IMAGE" $(kind get nodes --name "$CLUSTER_NAME")

# --- 1. per-lab secrets: SSH key, cluster CA, bootstrap token ------------------
ssh-keygen -q -t ed25519 -N '' -C "learner@workstation" -f "$WORK/id_ed25519"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=kubernetes" \
  -keyout "$WORK/ca.key" -out "$WORK/ca.crt" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" 2>/dev/null
CA_HASH=$(openssl x509 -pubkey -noout -in "$WORK/ca.crt" | openssl pkey -pubin -outform der 2>/dev/null | sha256sum | cut -d' ' -f1)
rand() { openssl rand -hex 16 | cut -c1-"$1"; }   # [a-f0-9] is valid for kubeadm tokens
TOKEN="$(rand 6).$(rand 16)"
PUBKEY=$(cat "$WORK/id_ed25519.pub")
b64() { base64 -w0 "$1"; }

common_cloudinit() {  # common_cloudinit <hostname>
  cat <<EOF
#cloud-config
hostname: $1
prefer_fqdn_over_hostname: false
manage_etc_hosts: false
ssh_pwauth: false
users:
  - name: learner
    gecos: CloudTrain learner
    groups: [sudo]
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys: ["$PUBKEY"]
write_files:
  # The lab VPC has no DNS service. KubeVirt's DHCP hands the VM the HOST cluster's
  # DNS IP (10.96.0.10), which is the lab cluster's own CoreDNS service IP too, so
  # CoreDNS would forward to itself and die in loop detection. Give kubelet (and so
  # CoreDNS) the VPC gateway instead: cluster names resolve, external names fail fast.
  - path: /etc/cloudtrain/resolv.conf
    content: |
      nameserver 192.168.100.1
  - path: /etc/hosts
    content: |
      127.0.0.1 localhost
      $CP_IP ctl-1
      $WK_IP wrk-1
EOF
}

{ common_cloudinit ctl-1; cat <<EOF
  - path: /etc/kubernetes/pki/ca.crt
    encoding: b64
    content: $(b64 "$WORK/ca.crt")
  - path: /etc/kubernetes/pki/ca.key
    encoding: b64
    permissions: "0600"
    content: $(b64 "$WORK/ca.key")
  - path: /root/kubeadm.yaml
    content: |
      apiVersion: kubeadm.k8s.io/v1beta4
      kind: InitConfiguration
      bootstrapTokens:
        - token: "$TOKEN"
          ttl: 2h
      localAPIEndpoint: { advertiseAddress: $CP_IP, bindPort: 6443 }
      nodeRegistration: { name: ctl-1, criSocket: unix:///run/containerd/containerd.sock }
      ---
      apiVersion: kubeadm.k8s.io/v1beta4
      kind: ClusterConfiguration
      kubernetesVersion: $LAB_K8S_VERSION
      clusterName: kestrel
      controlPlaneEndpoint: $CP_IP:6443
      networking: { podSubnet: 10.244.0.0/16, serviceSubnet: 10.96.0.0/12 }
      ---
      apiVersion: kubelet.config.k8s.io/v1beta1
      kind: KubeletConfiguration
      cgroupDriver: systemd
      resolvConf: /etc/cloudtrain/resolv.conf
runcmd:
  - [bash, -c, "date +%s.%N > /var/log/cloudtrain-boot.ts"]
  - [bash, -c, "kubeadm init --config /root/kubeadm.yaml --skip-token-print > /var/log/kubeadm.log 2>&1 && /opt/cloudtrain/bin/cni-install 10.244.0.0/16 >> /var/log/kubeadm.log 2>&1 && install -d -o learner -g learner /home/learner/.kube && install -o learner -g learner -m 600 /etc/kubernetes/admin.conf /home/learner/.kube/config"]
EOF
} > "$WORK/ctl-1.yaml"

{ common_cloudinit wrk-1; cat <<EOF
  - path: /root/join.yaml
    content: |
      apiVersion: kubeadm.k8s.io/v1beta4
      kind: JoinConfiguration
      discovery:
        bootstrapToken:
          apiServerEndpoint: $CP_IP:6443
          token: "$TOKEN"
          caCertHashes: ["sha256:$CA_HASH"]
      nodeRegistration: { name: wrk-1, criSocket: unix:///run/containerd/containerd.sock }
runcmd:
  - [bash, -c, "date +%s.%N > /var/log/cloudtrain-boot.ts"]
  - [bash, -c, "for i in \$(seq 1 180); do timeout 2 bash -c '</dev/tcp/$CP_IP/6443' 2>/dev/null && break; sleep 5; done; for i in 1 2 3 4 5; do kubeadm join --config /root/join.yaml >> /var/log/kubeadm.log 2>&1 && break; kubeadm reset -f >> /var/log/kubeadm.log 2>&1; sleep 10; done"]
EOF
} > "$WORK/wrk-1.yaml"

cat > "$WORK/ssh_config" <<EOF
Host ctl-1
  HostName $CP_IP
Host wrk-1
  HostName $WK_IP
Host *
  User learner
  IdentityFile ~/.ssh/id_ed25519
  StrictHostKeyChecking accept-new
  ConnectTimeout 5
  LogLevel ERROR
EOF

# --- 2. namespace + isolated VPC -----------------------------------------------
log "creating lab $NS"
k create ns "$NS" >/dev/null
k label ns "$NS" "$LABEL=demo" >/dev/null
k -n "$NS" create secret generic ctl-1-cloudinit --from-file=userdata="$WORK/ctl-1.yaml" >/dev/null
k -n "$NS" create secret generic wrk-1-cloudinit --from-file=userdata="$WORK/wrk-1.yaml" >/dev/null
k -n "$NS" create secret generic learner-ssh --from-file=id_ed25519="$WORK/id_ed25519" \
  --from-file=id_ed25519.pub="$WORK/id_ed25519.pub" --from-file=config="$WORK/ssh_config" >/dev/null

cat <<EOF | k apply -f - >/dev/null
apiVersion: kubeovn.io/v1
kind: Vpc
metadata: { name: $NS, labels: { $LABEL: demo } }
spec: {}
---
apiVersion: kubeovn.io/v1
kind: Subnet
metadata: { name: $NS-lab, labels: { $LABEL: demo } }
spec:
  vpc: $NS
  protocol: IPv4
  cidrBlock: 192.168.100.0/24
  gateway: 192.168.100.1
  excludeIps: ["192.168.100.1..192.168.100.9"]
---
apiVersion: kubeovn.io/v1
kind: Subnet
metadata: { name: $NS-access, labels: { $LABEL: demo } }
spec:
  vpc: $NS
  protocol: IPv4
  cidrBlock: 192.168.99.0/24
  gateway: 192.168.99.1
  provider: access.$NS.ovn
---
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata: { name: access, namespace: $NS }
spec:
  config: '{"cniVersion":"0.3.1","type":"kube-ovn","server_socket":"/run/openvswitch/kube-ovn-daemon.sock","provider":"access.$NS.ovn"}'
---
# The learner shell sits on the platform pod network (eth0). Without this it could
# reach the host API server, the OVN DBs, KubeVirt, other labs and the internet.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: workstation-isolation, namespace: $NS }
spec:
  podSelector: { matchLabels: { cloudtrain.dev/node: workstation } }
  policyTypes: [Ingress, Egress]
  ingress: []
  egress:
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }, podSelector: { matchLabels: { k8s-app: kube-dns } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to: [{ podSelector: { matchLabels: { app: vcluster, release: virtual } } }]
      ports: [{ protocol: TCP, port: 8443 }]
    - to: [{ ipBlock: { cidr: 192.168.99.0/24 } }, { ipBlock: { cidr: 192.168.100.0/24 } }]
---
# Pods the learner creates inside the vcluster are synced into this namespace on the
# platform network: same rule, they may only talk to DNS and to their own lab.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: virtual-workloads-isolation, namespace: $NS }
spec:
  podSelector: { matchLabels: { vcluster.loft.sh/managed-by: virtual } }
  policyTypes: [Egress]
  egress:
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }, podSelector: { matchLabels: { k8s-app: kube-dns } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to: [{ podSelector: {} }]
EOF
wait_for "subnets ready" 60 bash -c "[[ \$(kubectl --context $KUBECONTEXT get subnet $NS-lab $NS-access -o jsonpath='{.items[*].status.conditions[?(@.type==\"Ready\")].status}') == 'True True' ]]"

# --- 3. VMs ---------------------------------------------------------------------
vm() {  # vm <name> <ip> <memory>
  cat <<EOF
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: $1
  namespace: $NS
  labels: { $LABEL: demo, cloudtrain.dev/node: $1 }
spec:
  runStrategy: Always
  template:
    metadata:
      labels: { cloudtrain.dev/node: $1 }
      annotations:
        ovn.kubernetes.io/logical_switch: $NS-lab
        ovn.kubernetes.io/ip_address: $2
    spec:
      hostname: $1
      domain:
        cpu: { cores: 2 }
        memory: { guest: $3 }
        resources: { requests: { memory: $3 } }
        devices:
          disks:
            - { name: root, disk: { bus: virtio } }
            - { name: cloudinit, disk: { bus: virtio } }
          interfaces:
            - { name: default, bridge: {} }
          rng: {}
      networks:
        - { name: default, pod: {} }
      volumes:
        - name: root
          containerDisk: { image: $NODE_IMAGE, imagePullPolicy: IfNotPresent }
        - name: cloudinit
          cloudInitNoCloud: { secretRef: { name: $1-cloudinit } }
EOF
}
T0=$(date +%s.%N)
{ vm ctl-1 "$CP_IP" 2Gi; echo ---; vm wrk-1 "$WK_IP" 1536Mi; } | k apply -f - >/dev/null
log "VMs created; waiting for Running"

# --- 4. jumphost + vcluster (in parallel with VM boot) ---------------------------
cat <<EOF | k apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: workstation
  namespace: $NS
  labels: { $LABEL: demo, cloudtrain.dev/node: workstation }
  annotations:
    k8s.v1.cni.cncf.io/networks: access
    access.$NS.ovn.kubernetes.io/ip_address: $JH_IP
    access.$NS.ovn.kubernetes.io/routes: '[{"dst":"192.168.100.0/24","gw":"192.168.99.1"}]'
spec:
  hostname: workstation
  # The learner must not inherit a token for the HOST cluster (and kubectl would
  # otherwise default to the pod's namespace for lab contexts without one).
  automountServiceAccountToken: false
  hostAliases: [{ ip: $CP_IP, hostnames: [ctl-1] }, { ip: $WK_IP, hostnames: [wrk-1] }]
  securityContext: { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 }
  containers:
    - name: shell
      image: $JUMP_IMAGE
      imagePullPolicy: IfNotPresent
      command: [bash, -c, "install -d -m700 ~/.ssh ~/.kube && install -m600 /etc/cloudtrain/ssh/id_ed25519 ~/.ssh/ && install -m644 /etc/cloudtrain/ssh/config ~/.ssh/config && exec sleep infinity"]
      resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { memory: 256Mi } }
      volumeMounts: [{ name: ssh, mountPath: /etc/cloudtrain/ssh, readOnly: true }]
  volumes: [{ name: ssh, secret: { secretName: learner-ssh, defaultMode: 0440 } }]
EOF

log "creating vcluster 'virtual' (vcluster $VCLUSTER_VERSION)"
vcluster create virtual -n "$NS" --context "$KUBECONTEXT" --connect=false --chart-version "${VCLUSTER_VERSION#v}" \
  -f "$REPO_ROOT/deploy/vcluster/values.yaml" --set "controlPlane.proxy.extraSANs[0]=virtual.$NS.svc" \
  > "$WORK/vcluster.log" 2>&1 &
VC_PID=$!

# --- 5. measure: VMs Running ----------------------------------------------------
for v in ctl-1 wrk-1; do
  k -n "$NS" wait vmi/$v --for=jsonpath='{.status.phase}'=Running --timeout=600s >/dev/null \
    || { k -n "$NS" describe vmi $v | tail -20; die "VMI $v not Running"; }
done
T_RUN=$(date +%s.%N)
log "both VMIs Running after $(secs "$T0" "$T_RUN")s"
k -n "$NS" get vmi -o wide

k -n "$NS" wait pod/workstation --for=condition=Ready --timeout=120s >/dev/null || die "workstation pod not Ready"
jh() { k -n "$NS" exec workstation -- bash -lc "$*"; }

wait_for "ssh ctl-1 from workstation" 600 jh "ssh ctl-1 true"
T_SSH=$(date +%s.%N)
wait_for "ssh wrk-1 from workstation" 300 jh "ssh wrk-1 true"

# --- 6. measure: both kubeadm nodes Ready --------------------------------------
ready_count() { jh "ssh ctl-1 'kubectl get nodes --no-headers 2>/dev/null'" 2>/dev/null | awk '$2=="Ready"' | wc -l; }
start=$SECONDS
until [[ $(ready_count) -ge 2 ]]; do
  if (( SECONDS - start > 900 )); then
    jh "ssh ctl-1 'sudo tail -30 /var/log/kubeadm.log; sudo cloud-init status --long'" || true
    jh "ssh wrk-1 'sudo tail -30 /var/log/kubeadm.log'" || true
    die "kubeadm nodes not Ready after 900s"
  fi
  sleep 3
done
T_READY=$(date +%s.%N)
log "both kubeadm nodes Ready after $(secs "$T0" "$T_READY")s"

# --- 7. learner kubeconfig: kubeadm + virtual contexts --------------------------
jh "ssh ctl-1 cat .kube/config > ~/.kube/kubeadm.conf"
wait $VC_PID || { cat "$WORK/vcluster.log"; die "vcluster create failed"; }
wait_for "vcluster ready" 300 k -n "$NS" rollout status statefulset/virtual --timeout=5s
vcluster connect virtual -n "$NS" --context "$KUBECONTEXT" --print \
  --server "https://virtual.$NS.svc:443" > "$WORK/virtual.conf" 2>"$WORK/vc-connect.log" \
  || { cat "$WORK/vc-connect.log"; die "vcluster connect --print failed"; }
k -n "$NS" exec -i workstation -- bash -c 'cat > ~/.kube/virtual.conf' < "$WORK/virtual.conf"
jh 'set -e
  KUBECONFIG=~/.kube/kubeadm.conf kubectl config rename-context "$(KUBECONFIG=~/.kube/kubeadm.conf kubectl config current-context)" kubeadm >/dev/null
  KUBECONFIG=~/.kube/virtual.conf  kubectl config rename-context "$(KUBECONFIG=~/.kube/virtual.conf kubectl config current-context)" virtual >/dev/null
  KUBECONFIG=~/.kube/kubeadm.conf:~/.kube/virtual.conf kubectl config view --flatten > ~/.kube/config
  chmod 600 ~/.kube/config; rm ~/.kube/kubeadm.conf ~/.kube/virtual.conf
  kubectl config use-context kubeadm >/dev/null'

jh "kubectl --context kubeadm -n kube-system wait deploy/coredns --for=condition=Available --timeout=180s" >/dev/null \
  || { jh "kubectl --context kubeadm -n kube-system get pods -o wide" || true; die "lab CoreDNS not Available"; }
T_SYS=$(date +%s.%N)

# --- 8. the learner view (this is the proof) ------------------------------------
PROOF="$RESULTS/$NS.txt"
jh 'set -ex
  whoami; hostname
  ssh ctl-1 "hostname; cat /etc/cloudtrain-release | head -2"
  kubectl config get-contexts
  kubectl config use-context kubeadm
  kubectl get nodes -o wide
  kubectl version | grep Server
  kubectl config use-context virtual
  kubectl get ns
  kubectl version | grep Server
  kubectl config use-context kubeadm
  kubectl -n kube-system get pods -o wide' 2>&1 | tee "$PROOF" || die "learner view failed (see $PROOF)"

# Assertions: two different, real clusters behind the two contexts.
server_version() { jh "kubectl --context $1 version -o json" 2>/dev/null | jq -r '.serverVersion.gitVersion // empty'; }
V_KUBEADM=$(server_version kubeadm); V_VIRTUAL=$(server_version virtual)
[[ -n $V_KUBEADM && -n $V_VIRTUAL ]] || die "server version missing (kubeadm='$V_KUBEADM' virtual='$V_VIRTUAL')"
[[ $V_KUBEADM != "$V_VIRTUAL" ]] || die "kubeadm and virtual contexts report the same server version ($V_KUBEADM)"
[[ $V_KUBEADM == "$LAB_K8S_VERSION" ]] || die "kubeadm context serves $V_KUBEADM, expected $LAB_K8S_VERSION"
N_READY=$(jh "kubectl --context kubeadm get nodes --no-headers" | awk '$2=="Ready"' | wc -l)
(( N_READY == 2 )) || die "expected 2 Ready kubeadm nodes, got $N_READY"
log "ok: contexts kubeadm=$V_KUBEADM ($N_READY Ready nodes) virtual=$V_VIRTUAL"

# Isolation. reach <where> <ip> <port>: exit 0 iff a TCP connect succeeds within 3s.
reach() {
  local cmd="timeout 3 bash -c '</dev/tcp/$2/$3' 2>/dev/null"
  case $1 in
    workstation) k -n "$NS" exec workstation -- bash -c "$cmd" 2>/dev/null ;;
    *)           jh "ssh $1 \"$cmd\"" 2>/dev/null ;;
  esac
}
expect() {  # expect <open|closed> <where> <ip> <port> <what>
  local got=closed
  reach "$2" "$3" "$4" && got=open
  if [[ $got == "$1" ]]; then echo "isolation ok: $2 -> $5 ($3:$4) $got"
  else echo "ISOLATION FAIL: $2 -> $5 ($3:$4) is $got, expected $1"; fi
}
svc_ip() { k -n "$1" get svc "$2" -o jsonpath='{.spec.clusterIP}'; }
OVN_NB_IP=$(svc_ip kube-system ovn-nb)
OVN_NB_EP=$(k -n kube-system get endpointslice -l kubernetes.io/service-name=ovn-nb -o jsonpath='{.items[0].endpoints[0].addresses[0]}')
VIRT_API_IP=$(svc_ip kubevirt virt-api)
VC_IP=$(svc_ip "$NS" virtual)
DNS_POD_IP=$(k -n kube-system get pod -l k8s-app=kube-dns -o jsonpath='{.items[0].status.podIP}')
NODE_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${CLUSTER_NAME}-control-plane")
{
  expect open   workstation "$VC_IP"       443  "own vcluster API"
  expect open   workstation "$CP_IP"       22   "ctl-1 ssh (net1, lab VPC)"
  expect closed workstation "$OVN_NB_IP"   6641 "OVN NB DB service"
  expect closed workstation "$OVN_NB_EP"   6641 "OVN NB DB endpoint"
  expect closed workstation 10.96.0.1      443  "host kube-apiserver service"
  expect closed workstation "$NODE_IP"     6443 "host kube-apiserver on kind node"
  expect closed workstation "$VIRT_API_IP" 443  "KubeVirt virt-api"
  expect closed workstation 1.1.1.1        443  "internet"
  expect closed ctl-1       "$DNS_POD_IP"  53   "platform pod network (10.16.0.0/16)"
  expect closed ctl-1       "$VC_IP"       443  "vcluster service"
  expect closed ctl-1       "$NODE_IP"     6443 "kind node"
  expect closed ctl-1       1.1.1.1        443  "internet"
  expect open   ctl-1       "$WK_IP"       10250 "wrk-1 kubelet (inside the VPC)"
} 2>&1 | tee -a "$PROOF"
mapfile -t FAILS < <(grep '^ISOLATION FAIL' "$PROOF")
((${#FAILS[@]} == 0)) || die "lab isolation broken: ${#FAILS[@]} check(s) failed (see $PROOF)"

# --- 9. RAM per VM ---------------------------------------------------------------
mem_report() {
  for v in ctl-1 wrk-1; do
    pod=$(k -n "$NS" get pod -l "kubevirt.io/created-by=$(k -n "$NS" get vmi "$v" -o jsonpath='{.metadata.uid}')" -o name | head -1)
    launcher=$(k -n "$NS" exec "$pod" -c compute -- cat /sys/fs/cgroup/memory.current 2>/dev/null || echo 0)
    guest=$(jh "ssh $v free -m" | awk '/^Mem:/{print $3"/"$2}')
    printf '%s guest_used/total_MiB=%s launcher_pod_cgroup_MiB=%d\n' "$v" "$guest" $((launcher / 1048576))
  done
}
MEM=$(mem_report)

{
  echo "lab=$NS date=$(date -Iseconds) golden=$NODE_IMAGE kubevirt=$KUBEVIRT_VERSION"
  echo "vm_running_s=$(secs "$T0" "$T_RUN")"
  echo "ssh_ready_s=$(secs "$T0" "$T_SSH")"
  echo "nodes_ready_s=$(secs "$T0" "$T_READY")"
  echo "coredns_ready_s=$(secs "$T0" "$T_SYS")  (includes vcluster wait/kubeconfig assembly)"
  echo "$MEM"
} | tee -a "$RESULTS/timings.log"

log "lab:demo PASSED ($NS). Proof: $PROOF"
if [[ ${KEEP:-0} == 1 ]]; then log "KEEP=1: lab left running. Shell in: kubectl --context $KUBECONTEXT -n $NS exec -it workstation -- bash -l"; fi
