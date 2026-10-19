#!/bin/bash
# vmlat.sh <label> <containerDisk image> <runs> : VMI create -> Ready, and -> marker on the serial console (cloud-init runcmd)
source /srv/ct-work/dev/kata/env.sh
label=$1 img=$2 runs=$3 ns=kata-bench
kk create ns $ns --dry-run=client -o yaml | kk apply -f - >/dev/null
ms() { date +%s%3N; }
for i in $(seq 1 "$runs"); do
  n=vm-$label-$i
  t0=$(ms)
  cat <<Y | kk apply -f - >/dev/null
apiVersion: kubevirt.io/v1
kind: VirtualMachineInstance
metadata: {name: $n, namespace: $ns}
spec:
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  domain:
    cpu: {cores: 2}
    resources: {requests: {memory: 1536Mi}}
    devices:
      disks: [{name: root, disk: {bus: virtio}}, {name: ci, disk: {bus: virtio}}]
      interfaces: [{name: default, masquerade: {}}]
  networks: [{name: default, pod: {}}]
  volumes:
  - {name: root, containerDisk: {image: $img, imagePullPolicy: IfNotPresent}}
  - name: ci
    cloudInitNoCloud:
      userData: |
        #cloud-config
        runcmd:
          - [sh, -c, 'echo CTBOOTED > /dev/ttyS0; echo CTBOOTED > /dev/console']
Y
  until [[ $(kk -n $ns get vmi $n -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null) == True ]]; do
    (( $(ms) - t0 > 300000 )) && break; sleep 0.2; done
  t1=$(ms)
  pod=""
  until kk -n $ns logs $(kk -n $ns get pod -l kubevirt.io/created-by=$(kk -n $ns get vmi $n -o jsonpath='{.metadata.uid}') -o name) -c guest-console-log 2>/dev/null | grep -q CTBOOTED; do
    (( $(ms) - t0 > 400000 )) && { echo "$label,$i,$((t1-t0)),TIMEOUT"; break; }; sleep 0.5; done
  echo "$label,$i,$(( t1 - t0 )),$(( $(ms) - t0 ))"
  kk -n $ns delete vmi $n --wait=true --timeout=120s >/dev/null 2>&1
done
