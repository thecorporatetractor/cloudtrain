#!/bin/bash
# multus.sh <runtimeClass>: Kube-OVN secondary (Multus NAD) and primary-placement attachment to a Kata pod
source /srv/ct-work/dev/kata/env.sh
rc=$1 ns=kata-net
kk create ns $ns --dry-run=client -o yaml | kk apply -f - >/dev/null
cat <<Y | kk apply -f - >/dev/null
apiVersion: kubeovn.io/v1
kind: Subnet
metadata: {name: kata-link}
spec: {protocol: IPv4, cidrBlock: 10.250.0.0/24, provider: link.$ns.ovn, mtu: 1400, excludeIps: [10.250.0.1]}
---
apiVersion: kubeovn.io/v1
kind: Subnet
metadata: {name: kata-mgmt}
spec: {protocol: IPv4, cidrBlock: 10.251.0.0/24, mtu: 1400, excludeIps: [10.251.0.1], namespaces: []}
---
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata: {name: link, namespace: $ns}
spec:
  config: '{"cniVersion":"0.3.1","type":"kube-ovn","server_socket":"/run/openvswitch/kube-ovn-daemon.sock","provider":"link.$ns.ovn"}'
Y
mk() { # name rcl ip
  cat <<Y | kk apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: $1
  namespace: $ns
  annotations:
    k8s.v1.cni.cncf.io/networks: '[{"name":"link","interface":"net1"}]'
    link.$ns.ovn.kubernetes.io/logical_switch: kata-link
    link.$ns.ovn.kubernetes.io/ip_address: $3
    ovn.kubernetes.io/logical_switch: kata-mgmt
spec:
  $2
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  terminationGracePeriodSeconds: 1
  containers: [{name: c, image: cloudtrain/deb-lab:24.04, imagePullPolicy: IfNotPresent, command: [sleep, infinity]}]
Y
}
mk p-runc "" 10.250.0.10
mk p-kata "runtimeClassName: $rc" 10.250.0.20
mk p-runc2 "" 10.250.0.30
kk -n $ns wait --for=condition=Ready pod/p-runc pod/p-kata pod/p-runc2 --timeout=180s >/dev/null || kk -n $ns describe pod p-kata | tail -5
x() { kk -n $ns exec $1 -- sh -c "$2" 2>&1; }
echo "== kata pod ($rc) kernel and interfaces"; x p-kata 'uname -r; ip -o addr | grep -v " lo "; ip -o link show net1 | grep -o "mtu [0-9]*"'
r() { if out=$(eval "$2" 2>&1); then echo "PASS $1"; else echo "FAIL $1: $(echo "$out" | tail -1)"; fi; }
r "net1 (Multus NAD, kube-ovn secondary) runc->kata 10.250.0.20" "x p-runc 'ping -c2 -W2 10.250.0.20'"
r "net1 kata->runc 10.250.0.10" "x p-kata 'ping -c2 -W2 10.250.0.10'"
r "baseline runc->runc net1 1400 DF" "x p-runc 'ping -c2 -W2 -M do -s 1372 10.250.0.30'"
for sz in 1372 1350 1300 1200; do r "kata->runc net1 DF payload $sz" "x p-kata 'ping -c2 -W2 -M do -s $sz 10.250.0.10'"; done
r "runc->kata net1 DF 1372" "x p-runc 'ping -c2 -W2 -M do -s 1372 10.250.0.20'"
echo "  guest net1: $(x p-kata 'ip -o link show net1' | grep -o 'mtu [0-9]*')  eth0: $(x p-kata 'ip -o link show eth0' | grep -o 'mtu [0-9]*')"
r "kata eth0 (mgmt subnet mtu 1400) DF 1372" "x p-kata 'ping -c2 -W2 -M do -s 1372 '$(kk -n $ns get pod p-runc -o jsonpath={.status.podIP})"
r "eth0 primary placed on kata-mgmt by logical_switch" "x p-kata 'ip -o addr show eth0 | grep -q 10.251.0.'"
r "eth0 kata<->runc on mgmt" "x p-kata 'ping -c2 -W2 \$(echo)$(kk -n $ns get pod p-runc -o jsonpath={.status.podIP})'"
r "kata net1 MAC is the OVN port MAC (L2 passthrough)" "x p-kata 'cat /sys/class/net/net1/address' | grep -qi \"\$(kk -n $ns get pod p-kata -o jsonpath='{.metadata.annotations.link\.$ns\.ovn\.kubernetes\.io/mac_address}')\""
kk delete ns $ns --wait=true --timeout=120s >/dev/null; kk delete subnet kata-link kata-mgmt >/dev/null
