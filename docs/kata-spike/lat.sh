#!/bin/bash
# lat.sh <label> <runtimeClass|-> <image> <runs> [systemd] : pod create -> Ready (and -> systemd up) in ms
source /srv/ct-work/dev/kata/env.sh
label=$1 rc=$2 img=$3 runs=$4 mode=${5:-}
ns=kata-bench; kk create ns $ns --dry-run=client -o yaml | kk apply -f - >/dev/null
ms() { date +%s%3N; }
for i in $(seq 1 "$runs"); do
  n=lat-$label-$i
  rcl=""; [[ $rc != - ]] && rcl="runtimeClassName: $rc"
  priv=""; cmd='command: ["sleep","infinity"]'
  if [[ $mode == systemd ]]; then priv="securityContext: {privileged: true}"; cmd=""; fi
  y=$(cat <<Y
apiVersion: v1
kind: Pod
metadata: {name: $n, namespace: $ns, labels: {bench: lat}}
spec:
  $rcl
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  terminationGracePeriodSeconds: 2
  containers:
  - name: c
    image: $img
    imagePullPolicy: IfNotPresent
    $cmd
    $priv
Y
)
  t0=$(ms); echo "$y" | kk apply -f - >/dev/null
  until [[ $(kk -n $ns get pod $n -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null) == True ]]; do
    ph=$(kk -n $ns get pod $n -o jsonpath='{.status.phase}'); [[ $ph == Failed ]] && { echo "$label,$i,FAILED"; break; }
    (( $(ms) - t0 > 180000 )) && { echo "$label,$i,TIMEOUT $(kk -n $ns describe pod $n | tail -5 | tr '\n' ' ')"; break; }
    sleep 0.1; done
  t1=$(ms); t2=""
  if [[ $mode == systemd ]]; then
    until s=$(kk -n $ns exec $n -- systemctl is-system-running 2>/dev/null); [[ $s == running || $s == degraded ]]; do
      (( $(ms) - t0 > 240000 )) && { s="TIMEOUT:$s"; break; }; sleep 0.2; done
    t2=",$(( $(ms) - t0 )),$s"
  fi
  echo "$label,$i,$(( t1 - t0 ))$t2"
  kk -n $ns delete pod $n --wait=true --timeout=120s >/dev/null 2>&1
done
