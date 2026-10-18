#!/usr/bin/env bash
# Bring up the CloudTrain local runtime: kind + Kube-OVN + Multus + KubeVirt (KVM) + CDI.
# Idempotent: re-running converges an existing cluster.
# Host overrides (default: the reference machine's files):
#   KIND_CONFIG=<file>            kind cluster config, used only when the cluster is created
#   KUBE_OVN_EXTRA_VALUES=<file>  extra Helm values merged over deploy/kube-ovn/values.yaml
source "$(dirname "$0")/lib.sh"
for t in docker kind kubectl helm virtctl jq yq curl; do need "$t"; done

T0=$SECONDS
for f in ${KIND_CONFIG:+"$KIND_CONFIG"} ${KUBE_OVN_EXTRA_VALUES:+"$KUBE_OVN_EXTRA_VALUES"}; do
  [[ -f $f ]] || die "override file not found: $f"
done
"$REPO_ROOT/deploy/scripts/host-prep.sh"

# --- 1. kind cluster ---------------------------------------------------------
# Node containers are started only AFTER host-prep: a privileged container gets
# a copy of the host device nodes that exist when it STARTS, so a node started
# before vhost_net/tun were loaded has no /dev/vhost-net and cannot run VMs.
NODE_FILTER="label=io.x-k8s.kind.cluster=$CLUSTER_NAME"
if cluster_exists; then
  log "kind cluster '$CLUSTER_NAME' already exists"
  # `kind get clusters` also lists clusters whose node containers have exited
  # (WSL/Docker restart). Docker does not restart kind nodes on its own.
  mapfile -t stopped < <(docker ps -a --filter "$NODE_FILTER" --filter status=exited --filter status=created --format '{{.Names}}')
  if ((${#stopped[@]})); then
    log "starting stopped node containers: ${stopped[*]}"
    docker start "${stopped[@]}" >/dev/null
  fi
else
  log "creating kind cluster '$CLUSTER_NAME' ($KIND_NODE_IMAGE)"
  # kind switches the kubeconfig's current-context to the new cluster; put the
  # user's previous context back (every call here uses --context explicitly).
  prev_ctx=$(kubectl config current-context 2>/dev/null || true)
  kind create cluster --name "$CLUSTER_NAME" --image "$KIND_NODE_IMAGE" \
    --config "${KIND_CONFIG:-$REPO_ROOT/deploy/kind/cluster.yaml}" --wait 0s
  if [[ -n $prev_ctx ]]; then kubectl config use-context "$prev_ctx" >/dev/null; fi
fi
# Every node must have the KVM/virtio-net device nodes as character devices.
for node in $(docker ps --filter "$NODE_FILTER" --format '{{.Names}}'); do
  if ! docker exec "$node" sh -c 'test -c /dev/kvm && test -c /dev/vhost-net && test -c /dev/net/tun'; then
    warn "$node lacks /dev/kvm, /dev/vhost-net or /dev/net/tun as char devices (started before host-prep?); restarting it"
    docker restart "$node" >/dev/null
    docker exec "$node" sh -c 'test -c /dev/kvm && test -c /dev/vhost-net && test -c /dev/net/tun' \
      || die "$node still lacks KVM/vhost-net/tun devices after restart"
  fi
done
wait_for "API server of $CLUSTER_NAME" 180 k get --raw /readyz

# --- 2. Kube-OVN (primary CNI) -----------------------------------------------
CP_NODE="${CLUSTER_NAME}-control-plane"
# Docker's address for the node container (what kubelet will report once it is up).
CP_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CP_NODE")
[[ -n $CP_IP ]] || die "cannot determine the IP of $CP_NODE"
# kind node IPs are assigned by Docker at container start and can swap after a
# host/WSL restart. ovn-central refuses to start when its node IP is not in
# MASTER_NODES, and the OVN raft DBs record their member address with its
# scheme (tcp:/ssl:). So on IP drift or an ENABLE_SSL change: wipe the
# single-member OVN raft DBs (kube-ovn-controller rebuilds the logical topology
# from its CRDs) and re-render with the new settings.
OLD_VALUES=$(helm --kube-context "$KUBECONTEXT" -n kube-system get values kube-ovn -o json 2>/dev/null || echo '{}')
OLD_IP=$(jq -r '.MASTER_NODES // empty' <<<"$OLD_VALUES")
OLD_SSL=$(jq -r '.networking.ENABLE_SSL // false' <<<"$OLD_VALUES")
NEW_SSL=$(yq -r '.networking.ENABLE_SSL // false' "$REPO_ROOT/deploy/kube-ovn/values.yaml")
reset_reason=""
[[ -n $OLD_IP && $OLD_IP != "$CP_IP" ]] && reset_reason="control-plane IP drifted ($OLD_IP -> $CP_IP)"
[[ -n $OLD_IP && $OLD_SSL != "$NEW_SSL" ]] && reset_reason="ENABLE_SSL changed ($OLD_SSL -> $NEW_SSL)"
if [[ -n $reset_reason ]]; then
  warn "$reset_reason; resetting OVN central DBs"
  docker exec "$CP_NODE" sh -c 'rm -f /etc/origin/ovn/*.db' || true
  RESTART_OVN=1
fi
log "installing Kube-OVN $KUBE_OVN_CHART_VERSION (ovn-central on $CP_IP)"
helm repo add kubeovn https://kubeovn.github.io/kube-ovn/ >/dev/null 2>&1 || true
helm repo update kubeovn >/dev/null
helm --kube-context "$KUBECONTEXT" upgrade --install kube-ovn kubeovn/kube-ovn \
  --version "$KUBE_OVN_CHART_VERSION" --namespace kube-system \
  -f "$REPO_ROOT/deploy/kube-ovn/values.yaml" ${KUBE_OVN_EXTRA_VALUES:+-f "$KUBE_OVN_EXTRA_VALUES"} \
  --set MASTER_NODES="$CP_IP" --wait --timeout 10m
if [[ ${RESTART_OVN:-0} == 1 ]]; then
  k -n kube-system rollout restart deploy/ovn-central deploy/kube-ovn-controller ds/ovs-ovn ds/kube-ovn-cni >/dev/null
  wait_for "ovn-central rollout" 300 k -n kube-system rollout status deploy/ovn-central --timeout=5s
  k delete pod -A --field-selector=status.phase!=Running --wait=false >/dev/null 2>&1 || true
fi
wait_for "all nodes Ready" 300 k wait --for=condition=Ready nodes --all --timeout=5s
wait_for "CoreDNS available" 300 k -n kube-system rollout status deploy/coredns --timeout=5s

# --- 3. Multus (secondary NICs = extra lab links) -----------------------------
# Vendored, already-patched manifest (image digest + resources): a re-apply is a no-op.
log "installing Multus $MULTUS_VERSION (thick plugin)"
k apply -f "$REPO_ROOT/deploy/multus/multus-daemonset-thick.yaml" >/dev/null
wait_for "multus daemonset rolled out" 300 k -n kube-system rollout status ds/kube-multus-ds --timeout=5s

# --- 3b. expired KubeVirt/CDI certificates ------------------------------------
# After the cluster was stopped longer than the operators' 24 h cert lifetime, every
# webhook answers "x509: certificate has expired" and the applies below fail. Detect
# that and restart the operators so they re-issue the certs (no-op when healthy).
"$REPO_ROOT/deploy/scripts/heal-virt-certs.sh"

# --- 4. KubeVirt -------------------------------------------------------------
log "installing KubeVirt $KUBEVIRT_VERSION"
fetch_pinned "https://github.com/kubevirt/kubevirt/releases/download/${KUBEVIRT_VERSION}/kubevirt-operator.yaml" \
  "$KUBEVIRT_OPERATOR_SHA256" "$MANIFEST_CACHE/kubevirt-operator-${KUBEVIRT_VERSION}.yaml"
k apply -f "$MANIFEST_CACHE/kubevirt-operator-${KUBEVIRT_VERSION}.yaml" >/dev/null
k apply -f "$REPO_ROOT/deploy/kubevirt/kubevirt-cr.yaml" >/dev/null
wait_for "KubeVirt Available" 900 k -n kubevirt wait kv/kubevirt --for=condition=Available --timeout=5s

# --- 5. CDI ------------------------------------------------------------------
log "installing CDI $CDI_VERSION"
fetch_pinned "https://github.com/kubevirt/containerized-data-importer/releases/download/${CDI_VERSION}/cdi-operator.yaml" \
  "$CDI_OPERATOR_SHA256" "$MANIFEST_CACHE/cdi-operator-${CDI_VERSION}.yaml"
k apply -f "$MANIFEST_CACHE/cdi-operator-${CDI_VERSION}.yaml" >/dev/null
k apply -f "$REPO_ROOT/deploy/kubevirt/cdi-cr.yaml" >/dev/null
wait_for "CDI Available" 600 k wait cdi/cdi --for=condition=Available --timeout=5s

# --- 6. Prove KVM (not emulation) with a throwaway VMI -----------------------
"$REPO_ROOT/deploy/scripts/verify-kvm.sh"

log "dev:up complete in $((SECONDS - T0))s. Context: $KUBECONTEXT"
