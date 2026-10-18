#!/bin/bash
# Kata spike in a throwaway single-node kind cluster "kata-spike" with its own kubeconfig
# (never touches cloudtrain-dev or ~/.kube/config). Run it in the heavy slot:
#   tools/slots/run.sh vm -- bash tools/kata-spike/spike.sh
S=$(cd "$(dirname "$0")" && pwd); OUT=${OUT:-$(mktemp -d)}
C=kind-kata-spike; export KUBECONFIG="$OUT/kubeconfig"
date -u +%FT%TZ; uptime
ls -la /dev/kvm /dev/vhost-vsock /dev/vhost-net; cat /sys/module/kvm_intel/parameters/nested; uname -r
t0=$(date +%s)
kind create cluster --kubeconfig "$OUT/kubeconfig" --name kata-spike --image kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed --config "$S/kind.yaml" --wait 120s || exit 1
echo "cluster up in $(( $(date +%s)-t0 ))s"
t1=$(date +%s)
helm --kube-context $C install kata oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy --version 4.2.0 -n kube-system -f "$S/values.yaml" --wait --timeout 20m
echo "helm rc=$? in $(( $(date +%s)-t1 ))s"
kubectl --context $C -n kube-system get pods -o wide
kubectl --context $C get runtimeclass
kubectl --context $C get node -o jsonpath='{.items[0].metadata.labels}' | tr ',' '\n' | grep -i kata
docker exec kata-spike-control-plane sh -c 'ls /opt/kata/bin 2>&1 | head; grep -n kata /etc/containerd/config.toml /etc/containerd/conf.d/* 2>/dev/null | head'
cat <<Y | kubectl --context $C apply -f -
apiVersion: v1
kind: Pod
metadata: {name: kata-probe}
spec:
  runtimeClassName: kata-qemu
  restartPolicy: Never
  containers:
    - name: c
      image: busybox:1.36
      command: [sh, -c, 'uname -a; cat /proc/cpuinfo | grep -m1 "model name"; nproc; free -m; dmesg 2>/dev/null | head -3; sleep 5']
Y
t2=$(date +%s)
kubectl --context $C wait --for=jsonpath='{.status.phase}'=Succeeded pod/kata-probe --timeout=300s; echo "pod rc=$? in $(( $(date +%s)-t2 ))s"
kubectl --context $C describe pod kata-probe | tail -25
kubectl --context $C logs kata-probe
echo "host kernel: $(uname -r)"
docker exec kata-spike-control-plane sh -c 'ps aux | grep -c [q]emu; ps aux | grep [q]emu | head -2 | cut -c1-300'
uptime
kind delete cluster --kubeconfig "$OUT/kubeconfig" --name kata-spike
