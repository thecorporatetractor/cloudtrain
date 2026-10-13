#!/usr/bin/env bash
# Live proof of the lab network + netdev driver on the dev cluster.
#
# Precondition: a manager from this tree runs against kind-cloudtrain-dev with
#   --watch-namespace=$NS --image-registry=cloudtrain
# and LabSession $SESSION (testdata/labs/net-ospf-two-routers) is Ready.
# Applies the solution through the drivers (hack/netdevproof), runs the lab's
# checks, measures impairment, captures OSPF on a link end, asserts isolation,
# deletes the session and asserts nothing is left. Exits non-zero on failure.
#
# Usage: NS=ctnet-ospf SESSION=ospf-b hack/netdev-proof.sh > deploy/.results/netdev-ospf-proof.txt
set -euo pipefail
cd "$(dirname "$0")/.."
NS=${NS:-ctnet-ospf}
SESSION=${SESSION:-ospf-b}
CTX=${CTX:-kind-cloudtrain-dev}
K() { kubectl --context "$CTX" "$@"; }
PROOF() { KUBECONFIG=${KUBECONFIG_PROOF:?} bin/netdevproof -n "$NS" -session "$SESSION" "$@"; }
FAILS=0
ok()   { echo "OK   $*"; }
bad()  { echo "FAIL $*"; FAILS=$((FAILS + 1)); }
hdr()  { echo; echo "=== $* ($(date +%T))"; }
pod()  { K -n "$NS" get pod -l "labs.cloudtrain.dev/session=$SESSION,labs.cloudtrain.dev/node=$1" -o jsonpath='{.items[0].metadata.name}'; }
x()    { local p; p=$(pod "$1"); shift; K -n "$NS" exec "$p" -c node -- "$@"; }
tcp()  { x "$1" bash -c "timeout 3 bash -c '</dev/tcp/$2/$3' 2>/dev/null"; }

hdr "session"
K -n "$NS" get ls "$SESSION" -o wide
O=$(K -n "$NS" get ls "$SESSION" -o jsonpath='{.status.resolvedParams.octet}')
AREA=$(K -n "$NS" get ls "$SESSION" -o jsonpath='{.status.resolvedParams.area}')
echo "resolved params: octet=$O area=$AREA"
K -n "$NS" get pods -o wide
hdr "status.links"
K -n "$NS" get ls "$SESSION" -o json | jq -c '(.status.links // [])[]'
hdr "status.endpoints"
K -n "$NS" get ls "$SESSION" -o json | jq -c '(.status.endpoints // [])[]'
hdr "Kube-OVN / Multus objects"
K get vpc,subnet -l "labs.cloudtrain.dev/session=$SESSION"
K -n "$NS" get network-attachment-definitions

hdr "interfaces after setup"
for n in edge-1 edge-2 core-host wh-host; do echo "--- $n"; x "$n" ip -br addr; x "$n" ip route; done
for n in edge-1 edge-2; do
  p=$(pod "$n"); echo "--- $n qdiscs (link sidecar)"; K -n "$NS" exec "$p" -c net -- tc qdisc show dev eth2
done

hdr "checks BEFORE the solution (adjacency and route must fail)"
res=$(PROOF checks); echo "$res"
grep -q '^--- check adjacency-full *FAIL' <<<"$res" && ok "adjacency-full fails before solution" || bad "adjacency-full did not fail before solution"

hdr "apply solution through the netdev driver"
PROOF solution
echo "--- idempotency: apply the solution again"
PROOF solution

hdr "wait for OSPF Full"
for i in $(seq 1 30); do
  out=$(x edge-2 vtysh -c "show ip ospf neighbor")
  grep -q Full <<<"$out" && break; sleep 2
done
echo "$out"
grep -q Full <<<"$out" && ok "edge-2 adjacency Full after $((i * 2))s" || bad "no Full adjacency"
for i in $(seq 1 15); do x edge-2 vtysh -c "show ip route ospf" | grep -q "10.$O.1.0/24" && break; sleep 2; done

hdr "routers"
x edge-2 vtysh -c "show ip ospf neighbor"
x edge-2 vtysh -c "show ip route ospf"
x edge-1 vtysh -c "show ip route ospf"
x edge-2 vtysh -c "show running-config"

hdr "checks AFTER the solution (all must pass)"
res=$(PROOF checks); echo "$res"
grep -q "checks: 4/4 passed" <<<"$res" && ok "all 4 checks pass" || bad "not all checks pass"

hdr "host-to-host across both routers"
x wh-host ping -c 5 -i 0.3 "10.$O.1.10" && ok "wh-host -> core-host ping" || bad "wh-host -> core-host ping"
x wh-host traceroute -n -w 2 -q 1 "10.$O.1.10" || true

hdr "impairment (transit link: latencyMs 15, lossPct 0.5 per end)"
echo "--- edge-1 -> edge-2 over the impaired transit link"
imp=$(x edge-1 ping -c 20 -i 0.2 "10.$O.0.2" | tail -2); echo "$imp"
echo "--- edge-1 -> core-host over the unimpaired LAN link"
clean=$(x edge-1 ping -c 20 -i 0.2 "10.$O.1.10" | tail -2); echo "$clean"
avg() { sed -n 's|.*= [0-9.]*/\([0-9.]*\)/.*|\1|p' <<<"$1"; }
A=$(avg "$imp"); C=$(avg "$clean")
echo "avg RTT impaired=${A}ms clean=${C}ms"
awk -v a="$A" -v c="$C" 'BEGIN{exit !(a >= 28 && a <= 60 && c < 10)}' \
  && ok "impairment measurable: +$(awk -v a="$A" -v c="$C" 'BEGIN{printf "%.1f", a-c}')ms RTT (2 x 15ms netem)" \
  || bad "impairment not as expected"

hdr "capture on link end edge-2:eth2 (proto ospf, 4 packets) via the link sidecar"
cap=$(PROOF capture edge-2:eth2 "proto ospf" 2>&1); echo "$cap"
grep -q "OSPFv2, Hello" <<<"$cap" && ok "tcpdump shows OSPF hellos" || bad "no OSPF hellos captured"

hdr "isolation"
# iperf3 -D keeps the exec stream open; start it detached and do not wait for it.
timeout 10 kubectl --context "$CTX" -n "$NS" exec "$(pod core-host)" -c node -- \
  sh -c 'setsid iperf3 -s -D -p 5201 --logfile /tmp/iperf3.log </dev/null >/dev/null 2>&1' || true
sleep 1
DNS_POD=$(K -n kube-system get pod -l k8s-app=kube-dns -o jsonpath='{.items[0].status.podIP}')
NODE_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cloudtrain-dev-control-plane)
WS=$(pod workstation)
expect() {  # expect <open|closed> <from> <ip> <port> <what>
  local got=closed
  if [[ $2 == workstation ]]; then
    K -n "$NS" exec "$WS" -- bash -c "timeout 3 bash -c '</dev/tcp/$3/$4' 2>/dev/null" && got=open
  else
    tcp "$2" "$3" "$4" && got=open
  fi
  [[ $got == "$1" ]] && ok "$2 -> $5 ($3:$4) $got [$(date +%T)]" || bad "$2 -> $5 ($3:$4) is $got, expected $1"
}
expect open   wh-host     "10.$O.1.10"  5201 "core-host iperf3 across both routers"
for n in edge-1 wh-host; do
  expect closed "$n" "$DNS_POD"  53   "platform pod network (CoreDNS pod)"
  expect closed "$n" 10.96.0.1   443  "host kube-apiserver service"
  expect closed "$n" "$NODE_IP"  6443 "kind node API"
  expect closed "$n" 1.1.1.1     443  "internet"
done
echo "--- learner adds a default route via the VPC gateway on wh-host: still no way out"
x wh-host ip route replace default via 198.19.255.1 dev eth0
expect closed wh-host "$DNS_POD"  53   "platform pod network (default route via VPC)"
expect closed wh-host 10.96.0.1   443  "host kube-apiserver service (default route via VPC)"
expect closed wh-host 1.1.1.1     443  "internet (default route via VPC)"
x wh-host ip route del default via 198.19.255.1 dev eth0
CORE_MGMT=$(K -n "$NS" get pod "$(pod core-host)" -o jsonpath='{.status.podIP}')
expect closed workstation "10.$O.1.10" 5201 "core-host lab address from the platform network"
expect closed workstation "$CORE_MGMT" 5201 "core-host management address from the platform network"

hdr "teardown"
VPC=$(K get vpc -l "labs.cloudtrain.dev/session=$SESSION" -o name)
T=$(date +%s)
K -n "$NS" delete ls "$SESSION" --wait=true --timeout=300s
echo "LabSession gone (finalizer released) after $(( $(date +%s) - T ))s"
# The jumphost (container driver) has the default 30s grace period.
K -n "$NS" wait --for=delete pod --all --timeout=90s >/dev/null 2>&1 || true
echo "all pods gone after $(( $(date +%s) - T ))s"
left=$(K -n "$NS" get pods,svc,network-attachment-definitions -l "labs.cloudtrain.dev/session=$SESSION" -o name 2>/dev/null; \
       K get vpc,subnet -l "labs.cloudtrain.dev/session=$SESSION" -o name 2>/dev/null; \
       K -n "$NS" get pods -o name 2>/dev/null)
echo "left: ${left:-<nothing>}"
[[ -z $left ]] && ok "teardown left nothing (pods, services, NADs, subnets, VPC)" || bad "teardown left objects"
ls=$(K -n kube-system exec deploy/ovn-central -c ovn-central -- ovn-nbctl --no-leader-only ls-list 2>/dev/null)
echo "OVN logical switches: $(tr '\n' ' ' <<<"$ls")"
grep -q "$NS-$SESSION" <<<"$ls" && bad "OVN logical switch left" || ok "no OVN logical switch left for $VPC"

hdr "result"
echo "failures: $FAILS"
exit $(( FAILS > 0 ))
