#!/bin/bash
# mem.sh <label> <runtimeClass|-|vmi> <image> <N> [systemd] : start N at once, time to all Ready,
# then per-pod cgroup memory (memory.current and anon; Kata: sandbox_cgroup_only puts VMM+virtiofsd in it)
source /srv/ct-work/dev/kata/env.sh
label=$1 rc=$2 img=$3 N=$4 mode=${5:-} ns=kata-bench
kk create ns $ns --dry-run=client -o yaml | kk apply -f - >/dev/null
ms() { date +%s%3N; }
t0=$(ms)
for i in $(seq 1 $N); do
  if [[ $rc == vmi ]]; then cat <<Y
---
apiVersion: kubevirt.io/v1
kind: VirtualMachineInstance
metadata: {name: m-$label-$i, namespace: $ns, labels: {bench: mem}}
spec:
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  domain:
    cpu: {cores: 2}
    resources: {requests: {memory: 1536Mi}}
    devices:
      disks: [{name: root, disk: {bus: virtio}}]
      interfaces: [{name: default, masquerade: {}}]
  networks: [{name: default, pod: {}}]
  volumes: [{name: root, containerDisk: {image: $img, imagePullPolicy: IfNotPresent}}]
Y
  else
    rcl=""; [[ $rc != - ]] && rcl="runtimeClassName: $rc"
    if [[ $mode == systemd ]]; then extra="securityContext: {privileged: true}"; else extra='command: ["sleep","infinity"]'; fi
    cat <<Y
---
apiVersion: v1
kind: Pod
metadata: {name: m-$label-$i, namespace: $ns, labels: {bench: mem}}
spec:
  $rcl
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  terminationGracePeriodSeconds: 2
  containers: [{name: c, image: $img, imagePullPolicy: IfNotPresent, $extra}]
Y
  fi
done | kk apply -f - >/dev/null
until [[ $(kk -n $ns get pod -l bench=mem -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null | grep -c True) -ge $N ]]; do
  (( $(ms) - t0 > 900000 )) && { echo "$label TIMEOUT ready=$(kk -n $ns get pod -l bench=mem --no-headers | grep -c Running)"; break; }; sleep 1; done
t1=$(ms)
sleep 60
uids=$(kk -n $ns get pod -o jsonpath='{range .items[*]}{.metadata.uid}{"\n"}{end}' | tr - _ | tr '\n' ' ')
docker exec -i ct-kata-worker bash -s <<B > /tmp/kata-mem-$label.txt
for u in $uids; do d=\$(find /sys/fs/cgroup/kubelet.slice -maxdepth 3 -type d -name "*pod\${u}.slice" | head -1); [ -n "\$d" ] || continue
  echo "\$(cat \$d/memory.current) \$(awk '/^anon /{print \$2}' \$d/memory.stat) \$(awk '/^file /{print \$2}' \$d/memory.stat)"; done
B
awk -v l="$label" -v n=$N -v t=$((t1-t0)) '{c+=$1; a+=$2; f+=$3; k++} END {printf "%s,N=%d,allReady_ms=%d,pods_measured=%d,avg_current_MiB=%.1f,avg_anon_MiB=%.1f,avg_file_MiB=%.1f\n", l, n, t, k, c/k/1048576, a/k/1048576, f/k/1048576}' /tmp/kata-mem-$label.txt
# host-side VMM processes (all runtimes): PSS of cloud-hypervisor / qemu / virtiofsd / kata shims, and
# the Go runtime's kata_overhead cgroup (sandbox_cgroup_only=false keeps the VMM out of the pod cgroup)
docker exec ct-kata-worker bash -c 'p=0; for d in /proc/[0-9]*; do c=$(cat $d/comm 2>/dev/null); case "$c" in cloud-hyperviso|qemu-system-x86|virtiofsd|containerd-shim|dragonball) grep -q kata $d/cmdline 2>/dev/null || [ "$c" != containerd-shim ] || continue; v=$(awk "/^Pss:/{print \$2}" $d/smaps_rollup 2>/dev/null); p=$((p+${v:-0}));; esac; done; o=$(cat /sys/fs/cgroup/kata_overhead/memory.current 2>/dev/null || echo 0); echo "$p $o"' | awk -v l="$label" -v n=$N '{printf "%s,host_vmm_pss_per_sandbox_MiB=%.1f,kata_overhead_cgroup_per_sandbox_MiB=%.1f\n", l, $1/n/1024, $2/n/1048576}'
echo "# host MemAvailable now: $(awk '/MemAvailable/{printf "%.1f GiB", $2/1048576}' /proc/meminfo)"
if [[ $rc == vmi ]]; then kk -n $ns delete vmi -l bench=mem --wait=true --timeout=300s >/dev/null; fi
kk -n $ns delete pod -l bench=mem --wait=true --timeout=300s >/dev/null
