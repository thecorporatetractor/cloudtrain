#!/usr/bin/env bash
# Summarise the local runtime: nodes, add-ons, KVM devices, lab namespaces.
source "$(dirname "$0")/lib.sh"
cluster_exists || die "kind cluster '$CLUSTER_NAME' does not exist (run: task dev:up)"
echo "== nodes"; k get nodes -o wide
echo; echo "== KVM devices per node"
k get nodes -o custom-columns='NODE:.metadata.name,KVM:.status.allocatable.devices\.kubevirt\.io/kvm,VHOST:.status.allocatable.devices\.kubevirt\.io/vhost-net,TUN:.status.allocatable.devices\.kubevirt\.io/tun,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory'
echo; echo "== add-ons"
printf '%-12s %s\n' kube-ovn "$(helm --kube-context "$KUBECONTEXT" -n kube-system list -f '^kube-ovn$' -o json | jq -r '.[0] | "\(.chart) \(.status)"')"
printf '%-12s %s\n' kubevirt "$(k -n kubevirt get kv kubevirt -o jsonpath='{.status.observedKubeVirtVersion} {.status.phase}' 2>/dev/null)"
printf '%-12s %s\n' cdi "$(k get cdi cdi -o jsonpath='{.status.observedVersion} {.status.phase}' 2>/dev/null)"
printf '%-12s %s\n' multus "$(k -n kube-system get ds kube-multus-ds -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled} ready' 2>/dev/null)"
printf '%-12s %s\n' vcluster-cli "$(vcluster version 2>/dev/null | awk '{print $3}')"
echo; echo "== unhealthy pods"
k get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers 2>/dev/null || true
echo; echo "== lab namespaces"
k get ns -l cloudtrain.dev/lab --no-headers 2>/dev/null || true
k get vmi -A 2>/dev/null || true
echo; echo "== node container memory"
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} cpu={{.CPUPerc}}' $(docker ps -q --filter "label=io.x-k8s.kind.cluster=$CLUSTER_NAME")
