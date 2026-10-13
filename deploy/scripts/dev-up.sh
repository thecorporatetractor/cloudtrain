#!/usr/bin/env bash
# Bring up the CloudTrain local runtime: kind + Kube-OVN + Multus + KubeVirt (KVM) + CDI.
# Idempotent: re-running converges an existing cluster.
source "$(dirname "$0")/lib.sh"
for t in docker kind kubectl helm virtctl jq; do need "$t"; done

T0=$SECONDS
"$REPO_ROOT/deploy/scripts/host-prep.sh"

# --- 1. kind cluster ---------------------------------------------------------
if cluster_exists; then
  log "kind cluster '$CLUSTER_NAME' already exists"
else
  log "creating kind cluster '$CLUSTER_NAME' ($KIND_NODE_IMAGE)"
  kind create cluster --name "$CLUSTER_NAME" --image "$KIND_NODE_IMAGE" \
    --config "$REPO_ROOT/deploy/kind/cluster.yaml" --wait 0s
fi
kubectl config use-context "$KUBECONTEXT" >/dev/null

# --- 2. Kube-OVN (primary CNI) -----------------------------------------------
CP_NODE="${CLUSTER_NAME}-control-plane"
CP_IP=$(k get node "$CP_NODE" -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')
# kind node IPs are assigned by Docker at container start and can swap after a
# host/WSL restart. ovn-central refuses to start when its node IP is not in
# MASTER_NODES, so on drift: wipe the single-member OVN raft DBs (kube-ovn-controller
# rebuilds the logical topology from its CRDs) and re-render with the new IP.
OLD_IP=$(helm --kube-context "$KUBECONTEXT" -n kube-system get values kube-ovn -o json 2>/dev/null | jq -r '.MASTER_NODES // empty' || true)
if [[ -n $OLD_IP && $OLD_IP != "$CP_IP" ]]; then
  warn "control-plane IP drifted ($OLD_IP -> $CP_IP); resetting OVN central DBs"
  docker exec "$CP_NODE" sh -c 'rm -f /etc/origin/ovn/*.db' || true
  RESTART_OVN=1
fi
log "installing Kube-OVN $KUBE_OVN_CHART_VERSION (ovn-central on $CP_IP)"
helm repo add kubeovn https://kubeovn.github.io/kube-ovn/ >/dev/null 2>&1 || true
helm repo update kubeovn >/dev/null
helm --kube-context "$KUBECONTEXT" upgrade --install kube-ovn kubeovn/kube-ovn \
  --version "$KUBE_OVN_CHART_VERSION" --namespace kube-system \
  -f "$REPO_ROOT/deploy/kube-ovn/values.yaml" \
  --set MASTER_NODES="$CP_IP" --wait --timeout 10m
if [[ ${RESTART_OVN:-0} == 1 ]]; then
  k -n kube-system rollout restart deploy/ovn-central deploy/kube-ovn-controller ds/ovs-ovn ds/kube-ovn-cni >/dev/null
  wait_for "ovn-central rollout" 300 k -n kube-system rollout status deploy/ovn-central --timeout=5s
  k delete pod -A --field-selector=status.phase!=Running --wait=false >/dev/null 2>&1 || true
fi
wait_for "all nodes Ready" 300 k wait --for=condition=Ready nodes --all --timeout=5s
wait_for "CoreDNS available" 300 k -n kube-system rollout status deploy/coredns --timeout=5s

# --- 3. Multus (secondary NICs = extra lab links) -----------------------------
log "installing Multus $MULTUS_VERSION (thick plugin)"
k apply -f "https://raw.githubusercontent.com/k8snetworkplumbingwg/multus-cni/${MULTUS_VERSION}/deployments/multus-daemonset-thick.yml" >/dev/null
# Upstream limits the thick daemon to 50Mi/100m, but delegate CNI plugins
# (kube-ovn, portmap) run inside its cgroup: at 50Mi they thrash on memory.max
# and pod sandboxes time out ("failed to reserve sandbox name", seen 2026-10-13).
k -n kube-system patch ds kube-multus-ds --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources","value":{"requests":{"cpu":"50m","memory":"100Mi"},"limits":{"memory":"512Mi"}}}]' >/dev/null
wait_for "multus daemonset" 300 k -n kube-system rollout status ds/kube-multus-ds --timeout=5s

# --- 4. KubeVirt -------------------------------------------------------------
log "installing KubeVirt $KUBEVIRT_VERSION"
k apply -f "https://github.com/kubevirt/kubevirt/releases/download/${KUBEVIRT_VERSION}/kubevirt-operator.yaml" >/dev/null
k apply -f "$REPO_ROOT/deploy/kubevirt/kubevirt-cr.yaml" >/dev/null
wait_for "KubeVirt Available" 900 k -n kubevirt wait kv/kubevirt --for=condition=Available --timeout=5s

# --- 5. CDI ------------------------------------------------------------------
log "installing CDI $CDI_VERSION"
k apply -f "https://github.com/kubevirt/containerized-data-importer/releases/download/${CDI_VERSION}/cdi-operator.yaml" >/dev/null
k apply -f "$REPO_ROOT/deploy/kubevirt/cdi-cr.yaml" >/dev/null
wait_for "CDI Available" 600 k wait cdi/cdi --for=condition=Available --timeout=5s

# --- 6. Prove KVM (not emulation) with a throwaway VMI -----------------------
"$REPO_ROOT/deploy/scripts/verify-kvm.sh"

log "dev:up complete in $((SECONDS - T0))s. Context: $KUBECONTEXT"
