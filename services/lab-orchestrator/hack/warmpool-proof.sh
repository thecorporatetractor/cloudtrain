#!/usr/bin/env bash
# Live proof of warm pools, claims, hibernate/resume, reset and teardown.
#
# Precondition: a manager from this tree runs against kind-cloudtrain-dev,
# scoped to sessions labelled $SEL, e.g.
#   ORCH_NAMESPACE=ct-warmpool-system SESSION_SELECTOR=labs.cloudtrain.dev/proof=warmpool \
#     SKIP_CRDS=1 LOAD_LAB_IMAGES=0 deploy/scripts/orchestrator-deploy.sh
#
# PART=virtual  scale-berth-planner (jumphost + vcluster): WarmPool of size 2
#               fills, a claim is Ready in seconds, the pool refills, learner
#               work survives hibernate/resume, reset restores the lab, delete
#               leaves nothing behind.
# PART=kubeadm  count-schedulable-nodes (jumphost + 6 kubeadm VMs, one session,
#               no pool): cold start on persistent disks, learner work (file on
#               the jumphost, file on a VM, Deployment in the cluster) survives
#               hibernate/resume, reset, delete leaves nothing behind.
#
# Usage: PART=virtual hack/warmpool-proof.sh | tee ../../deploy/.results/warmpool-virtual-proof.txt
set -euo pipefail
cd "$(dirname "$0")/.."
PART=${PART:-virtual}
CTX=${CTX:-kind-cloudtrain-dev}
NS=${NS:-ctwp-$PART}
SEL_KEY=labs.cloudtrain.dev/proof
SEL_VAL=warmpool
LABS=../../content/packs/kubernetes/labs
K() { kubectl --context "$CTX" "$@"; }
FAILS=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; FAILS=$((FAILS + 1)); }
hdr() { echo; echo "=== $* ($(date +%T))"; }
now() { date +%s.%N; }
since() { awk -v a="$1" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}'; }
# wait_for <seconds> <description> <command...>: poll every 0.25s.
wait_for() {
  local t=$1 what=$2 start; shift 2; start=$(now)
  while ! "$@" >/dev/null 2>&1; do
    if awk -v a="$start" -v b="$(now)" -v t="$t" 'BEGIN{exit !(b-a>t)}'; then bad "timeout ($t s): $what"; return 1; fi
    sleep 0.25
  done
}
jp() { K -n "$NS" get "$1" "$2" -o jsonpath="$3" 2>/dev/null; }
phase_is() { [[ $(jp ls "$1" '{.status.phase}') == "$2" ]]; }
pool_ready_is() { [[ $(jp wp "$1" '{.status.ready}') == "$2" ]]; }
gone() { ! K -n "$NS" get "$@" >/dev/null 2>&1; }
# Learner shell on the entry node, through the session's k8s-exec endpoint
# (exactly what the terminal gateway opens).
entry() { jp ls "$1" '{.status.endpoints[?(@.protocol=="k8s-exec")].target}'; }
lx() {
  local s=$1 tgt; shift; tgt=$(entry "$s")
  IFS=/ read -r ens epod ectr <<<"$tgt"
  K -n "$ens" exec "$epod" -c "$ectr" -- runuser -u learner -- env -i HOME=/home/learner USER=learner \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin bash -c "cd ~ && $*"
}
# grade <session> <request>: request grading, wait, print and return the score.
grade() {
  K -n "$NS" patch ls "$1" --type merge -p "{\"spec\":{\"validateRequest\":$2}}" >/dev/null
  wait_for 180 "grading $1 #$2" bash -c "[[ \$(kubectl --context $CTX -n $NS get ls $1 -o jsonpath='{.status.validation.observedRequest}/{.status.validation.phase}') == '$2/Complete' ]]" || true
  K -n "$NS" get ls "$1" -o json | jq -r '.status.validation | "score=\(.score) " + ([.checks[] | "\(.id)=\(if .passed then "pass" else "fail" end)"] | join(" "))' >&2
  jp ls "$1" '{.status.validation.score}'
}
# Pods of the claimed session: its nodes, the vcluster control plane, synced workloads.
session_pods() {
  K -n "$NS" get pods -o json | jq -r --arg s "$POOLED" --arg r "$RELEASE" \
    '.items[] | select(.metadata.labels["labs.cloudtrain.dev/session"]==$s or .metadata.labels.release==$r or (.metadata.labels["vcluster.loft.sh/managed-by"] // "")==$r) | .metadata.name'
}
leftovers() {
  local out=() r
  for r in $(K api-resources --verbs=list --namespaced -o name | grep -v '^events'); do
    while read -r o; do [[ -n $o ]] && out+=("$o"); done < <(K -n "$NS" get "$r" -o name --ignore-not-found 2>/dev/null)
  done
  printf '%s\n' "${out[@]}" | grep -v -E '^(configmap/kube-root-ca.crt|serviceaccount/default|labtemplate\.labs\.cloudtrain\.dev/)' || true
  K get clusterrole,clusterrolebinding -o name | grep -- "-v-$NS\$" || true
  K get vpc,subnet -l "labs.cloudtrain.dev/managed-by" -o name 2>/dev/null | grep -- "$NS" || true
}
no_leftovers() { [[ -z $(leftovers) ]]; }
session_yaml() { # <name> [extra spec yaml lines]
  cat <<EOF
apiVersion: labs.cloudtrain.dev/v1alpha1
kind: LabSession
metadata:
  name: $1
  namespace: $NS
  labels: {$SEL_KEY: $SEL_VAL}
spec:
  templateRef: {name: $TPL}
  learner: {id: learner-$1}
  seed: 7
  ttl: 2h
$2
EOF
}

case $PART in
virtual) LAB=$LABS/scale-berth-planner ;;
kubeadm) LAB=$LABS/count-schedulable-nodes ;;
*) echo "PART must be virtual or kubeadm" >&2; exit 2 ;;
esac
hdr "setup: namespace $NS, template from $LAB"
K create namespace "$NS" --dry-run=client -o yaml | K apply -f - >/dev/null
bin/labctl compile "$LAB/lab.yaml" | K -n "$NS" apply -f - >/dev/null
TPL=$(bin/labctl compile "$LAB/lab.yaml" | yq '.metadata.name')
echo "template $TPL"
K -n ct-warmpool-system get deploy lab-orchestrator -o jsonpath='{.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].args}{"\n"}'

if [[ $PART == virtual ]]; then
  hdr "1. WarmPool wp-berth (size 2, maxSurge 2) fills"
  t=$(now)
  K apply -f - <<EOF >/dev/null
apiVersion: labs.cloudtrain.dev/v1alpha1
kind: WarmPool
metadata: {name: wp-berth, namespace: $NS, labels: {$SEL_KEY: $SEL_VAL}}
spec: {templateRef: {name: $TPL}, size: 2, maxSurge: 2}
EOF
  wait_for 600 "pool filled" pool_ready_is wp-berth 2 && ok "pool has 2 ready sessions after $(since "$t")s"
  K -n "$NS" get wp,ls
  K -n "$NS" get ls -o json | jq -r '.items[] | "\(.metadata.name) seed=\(.spec.seed) learner=\(.spec.learner.id) expiresAt=\(.status.expiresAt // "never") params=\(.status.resolvedParams)"'
  K -n "$NS" get wp wp-berth -o json | jq -c '.status.conditions[] | {type, status, reason, message}'

  hdr "2. claim: LabSession x1 with warmPoolRef"
  t=$(now)
  session_yaml x1 "  warmPoolRef: wp-berth" | K apply -f - >/dev/null
  wait_for 60 "x1 Ready" phase_is x1 Ready && CLAIM_S=$(since "$t") && ok "claimed session Ready ${CLAIM_S}s after create (wall clock, 0.25s polling)"
  K -n "$NS" get ls x1 -o json | jq -r '"readyAt-creation: \((.status.readyAt|fromdate) - (.metadata.creationTimestamp|fromdate))s pooledSession=\(.status.pooledSession) entry=\(.status.endpoints[0].target)"'
  K -n "$NS" get ls x1 -o json | jq -c '.status.conditions[] | select(.type=="Claimed")'
  POOLED=$(jp ls x1 '{.status.pooledSession}')
  RELEASE=$(K -n "$NS" get ls "$POOLED" -o json | jq -r '.status.nodes[] | select(.name=="qm-dispatch") | .details.release')
  echo "pooled session $POOLED, vcluster release $RELEASE"
  K -n "$NS" get ls "$POOLED" -o json | jq -c '{name: .metadata.name, labels: .metadata.labels, owner: [.metadata.ownerReferences[] | {kind, name}], learner: .spec.learner.id, expiresAt: .spec.expiresAt}'

  hdr "3. the pool refills"
  t=$(now)
  wait_for 600 "pool refilled" bash -c "[[ \$(kubectl --context $CTX -n $NS get wp wp-berth -o jsonpath='{.status.ready}/{.status.claimed}') == 2/1 ]]" && ok "pool back to 2 ready (+1 claimed) after $(since "$t")s"
  K -n "$NS" get wp,ls

  hdr "4. learner works: file in ~, kubeconfig context, Deployment in the cluster, the lab task"
  R=$(jp ls x1 '{.status.resolvedParams.replicas}')
  lx x1 "echo 'berth notes: tide at 06:40' > ~/notes.txt && mkdir -p ~/work && date > ~/work/started && kubectl config use-context qm-dispatch >/dev/null &&
    kubectl create deployment learner-web --image=caddy:2-alpine -n dock-scheduling &&
    kubectl -n dock-scheduling scale deployment berth-planner --replicas=$R &&
    kubectl -n dock-scheduling rollout status deployment berth-planner --timeout=100s && kubectl -n dock-scheduling rollout status deployment learner-web --timeout=100s"
  S=$(grade x1 1); [[ $S == 100 ]] && ok "graded 100 before hibernate" || bad "score before hibernate: $S"

  hdr "5. hibernate x1"
  t=$(now)
  K -n "$NS" patch ls x1 --type merge -p '{"spec":{"hibernate":true}}' >/dev/null
  wait_for 300 "x1 Hibernated" phase_is x1 Hibernated && ok "Hibernated after $(since "$t")s"
  K -n "$NS" get ls x1 -o json | jq -c '{phase: .status.phase, hibernated: .status.hibernated, endpoints: (.status.endpoints // []), nodes: [.status.nodes[] | {name, phase, message}]}'
  echo "--- pods / statefulsets / PVCs of the pooled session $POOLED"
  K -n "$NS" get pods,sts,pvc -l "labs.cloudtrain.dev/session=$POOLED" -o wide 2>&1
  K -n "$NS" get pvc
  n=$(session_pods | wc -l)
  [[ $n == 0 ]] && ok "no pod of the session runs while hibernated" || bad "$n pod(s) still running while hibernated"

  hdr "6. resume x1"
  t=$(now)
  K -n "$NS" patch ls x1 --type merge -p '{"spec":{"hibernate":false}}' >/dev/null
  wait_for 300 "x1 Ready again" phase_is x1 Ready && ok "Ready again after $(since "$t")s"
  out=$(lx x1 'cat ~/notes.txt; ls ~/work; kubectl config current-context; kubectl -n dock-scheduling get deploy -o custom-columns=NAME:.metadata.name,SPEC:.spec.replicas --no-headers')
  echo "$out"
  grep -q 'tide at 06:40' <<<"$out" && ok "~/notes.txt survived" || bad "~/notes.txt lost"
  grep -qx 'qm-dispatch' <<<"$out" && ok "kubeconfig current-context survived" || bad "current-context lost"
  grep -q 'learner-web' <<<"$out" && ok "learner's Deployment survived" || bad "learner's Deployment lost"
  grep -qE "berth-planner +$R\$" <<<"$out" && ok "berth-planner still at $R replicas" || bad "berth-planner replicas lost"
  wait_for 180 "workloads ready after resume" lx x1 "kubectl -n dock-scheduling rollout status deploy/learner-web --timeout=5s && kubectl -n dock-scheduling rollout status deploy/berth-planner --timeout=5s"
  S=$(grade x1 2); [[ $S == 100 ]] && ok "graded 100 after resume" || bad "score after resume: $S"
  echo "setup re-run on resume? events:"; K -n "$NS" get events --field-selector "involvedObject.name=$POOLED" -o custom-columns=REASON:.reason,MSG:.message --no-headers | grep -E 'NodeReplaced|ResetRequested' || ok "no NodeReplaced/ResetRequested event: setup did not re-run"

  hdr "7. reset x1"
  t=$(now)
  K -n "$NS" patch ls x1 --type merge -p '{"spec":{"resetGeneration":1}}' >/dev/null
  wait_for 300 "reset observed" bash -c "[[ \$(kubectl --context $CTX -n $NS get ls x1 -o jsonpath='{.status.observedResetGeneration}/{.status.phase}') == 1/Ready ]]" && ok "reset done, Ready after $(since "$t")s"
  out=$(lx x1 'ls -a ~; kubectl config current-context 2>&1; kubectl --context qm-dispatch -n dock-scheduling get deploy -o custom-columns=NAME:.metadata.name,SPEC:.spec.replicas --no-headers')
  echo "$out"
  ! grep -q notes.txt <<<"$out" && ok "home reset (notes.txt gone)" || bad "notes.txt survived the reset"
  ! grep -q learner-web <<<"$out" && ok "cluster reset (learner-web gone)" || bad "learner-web survived the reset"
  grep -qE 'berth-planner +1$' <<<"$out" && ok "berth-planner back to 1 replica" || bad "berth-planner not reset"
  S=$(grade x1 3); [[ $S != 100 ]] && ok "lab unsolved again after reset (score $S)" || bad "still 100 after reset"

  hdr "8. delete x1 (and its pooled session)"
  t=$(now)
  K -n "$NS" delete ls x1 --wait=false >/dev/null
  wait_for 300 "x1 gone" gone ls x1 && wait_for 300 "$POOLED gone" gone ls "$POOLED" && ok "x1 and $POOLED gone after $(since "$t")s"
  left=$(K -n "$NS" get pods,pvc,secrets,sts,svc,cm,networkpolicy -o json | jq -r --arg s "$POOLED" --arg r "$RELEASE" \
    '.items[] | select(.metadata.labels["labs.cloudtrain.dev/session"]==$s or .metadata.labels.release==$r or (.metadata.labels["vcluster.loft.sh/managed-by"] // "")==$r or (.metadata.name | contains($r))) | "\(.kind)/\(.metadata.name)"')
  [[ -z $left ]] && ok "nothing of the claimed session left" || { bad "left over"; echo "$left"; }

  hdr "9. delete the pool"
  K -n "$NS" get wp,ls
  t=$(now)
  K -n "$NS" delete wp wp-berth --wait=false >/dev/null
  wait_for 300 "pooled sessions gone" bash -c "[[ -z \$(kubectl --context $CTX -n $NS get ls -o name) ]]" && ok "pool and its sessions gone after $(since "$t")s"
  wait_for 120 "namespace empty" no_leftovers || true
  left=$(leftovers); [[ -z $left ]] && ok "namespace holds nothing but the LabTemplate" || { bad "leftovers"; echo "$left"; }
fi

if [[ $PART == kubeadm ]]; then
  hdr "1. cold start k1 (6 kubeadm VMs on persistent DataVolume disks)"
  t=$(now)
  session_yaml k1 | K apply -f - >/dev/null
  wait_for 1200 "k1 Ready" phase_is k1 Ready && ok "k1 Ready after $(since "$t")s"
  K -n "$NS" get vm,vmi,dv,pvc
  for p in $(K -n "$NS" get pvc -o name | grep -- '-root$'); do
    pv=$(K -n "$NS" get "$p" -o jsonpath='{.spec.volumeName}')
    path=$(K get pv "$pv" -o jsonpath='{.spec.hostPath.path}{.spec.local.path}')
    node=$(K get pv "$pv" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}')
    echo "$p $(docker exec "$node" du -sh --apparent-size "$path" | cut -f1) apparent, $(docker exec "$node" du -sh "$path" | cut -f1) allocated"
  done

  hdr "2. learner works: report file (the solution), a file on a VM, a Deployment"
  REPORT=$(jp ls k1 '{.status.resolvedParams.report}')
  lx k1 "kubectl config use-context qm-capacity >/dev/null &&
    kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{\"|\"}{.status.conditions[?(@.type==\"Ready\")].status}{\"|\"}{.spec.taints[*].effect}{\"\\n\"}{end}' | awk -F'|' '\$2==\"True\" && \$3 !~ /(^| )NoSchedule( |\$)/' | wc -l > '$REPORT' &&
    ssh cap-wk-1 'echo learner-was-here > ~/vm-note.txt && sudo touch /etc/learner-marker' &&
    kubectl create deployment learner-web --image=httpd:2.4-alpine && kubectl rollout status deploy/learner-web --timeout=180s"
  lx k1 "cat '$REPORT'; ssh cap-wk-1 cat vm-note.txt; kubectl get deploy learner-web"
  S=$(grade k1 1); [[ $S == 100 ]] && ok "graded 100 before hibernate" || bad "score before hibernate: $S"

  hdr "3. hibernate k1 (runStrategy Halted, entry pod deleted)"
  t=$(now)
  K -n "$NS" patch ls k1 --type merge -p '{"spec":{"hibernate":true}}' >/dev/null
  wait_for 600 "k1 Hibernated" phase_is k1 Hibernated && ok "Hibernated after $(since "$t")s"
  K -n "$NS" get vm,vmi,pods,pvc
  [[ -z $(K -n "$NS" get vmi -o name) ]] && ok "no VMI runs while hibernated" || bad "VMIs still running"
  [[ -z $(K -n "$NS" get pods -o name | grep -v importer) ]] && ok "no pod runs while hibernated" || bad "pods still running"

  hdr "4. resume k1"
  t=$(now)
  K -n "$NS" patch ls k1 --type merge -p '{"spec":{"hibernate":false}}' >/dev/null
  wait_for 900 "k1 Ready again" phase_is k1 Ready && ok "Ready again after $(since "$t")s"
  out=$(lx k1 "cat '$REPORT'; kubectl config current-context; ssh cap-wk-1 'cat vm-note.txt; ls /etc/learner-marker'; kubectl get deploy learner-web --no-headers")
  echo "$out"
  grep -qx '[0-9]' <<<"$(head -1 <<<"$out")" && ok "report file survived" || bad "report lost"
  grep -qx qm-capacity <<<"$out" && ok "current-context survived" || bad "current-context lost"
  grep -q learner-was-here <<<"$out" && ok "file on VM cap-wk-1 survived (persistent disk)" || bad "VM file lost"
  grep -q /etc/learner-marker <<<"$out" && ok "root change on cap-wk-1 survived" || bad "VM root change lost"
  grep -q learner-web <<<"$out" && ok "Deployment survived" || bad "Deployment lost"
  wait_for 300 "learner-web available after resume" lx k1 "kubectl rollout status deploy/learner-web --timeout=5s" && ok "learner-web available again"
  lx k1 'kubectl get nodes'
  S=$(grade k1 2); [[ $S == 100 ]] && ok "graded 100 after resume" || bad "score after resume: $S"

  hdr "5. reset k1"
  t=$(now)
  K -n "$NS" patch ls k1 --type merge -p '{"spec":{"resetGeneration":1}}' >/dev/null
  wait_for 1200 "reset observed" bash -c "[[ \$(kubectl --context $CTX -n $NS get ls k1 -o jsonpath='{.status.observedResetGeneration}/{.status.phase}') == 1/Ready ]]" && ok "reset done, Ready after $(since "$t")s"
  out=$(lx k1 "ls '$REPORT' 2>&1; ssh cap-wk-1 'cat vm-note.txt' 2>&1; kubectl --context qm-capacity get deploy learner-web 2>&1; kubectl --context qm-capacity get nodes")
  echo "$out"
  grep -q 'No such file' <<<"$(head -1 <<<"$out")" && ok "report gone after reset" || bad "report survived reset"
  ! grep -q learner-was-here <<<"$out" && ok "VM disk fresh after reset" || bad "VM file survived reset"
  grep -q 'NotFound' <<<"$out" && ok "Deployment gone after reset" || bad "Deployment survived reset"
  S=$(grade k1 3); [[ $S != 100 ]] && ok "lab unsolved again after reset (score $S)" || bad "still 100 after reset"

  hdr "6. delete k1"
  t=$(now)
  K -n "$NS" delete ls k1 --wait=false >/dev/null
  wait_for 600 "k1 gone" gone ls k1 && ok "k1 gone after $(since "$t")s"
  wait_for 120 "namespace empty" no_leftovers || true
  left=$(leftovers); [[ -z $left ]] && ok "namespace holds nothing but the LabTemplate (no VM, DataVolume, PVC, Secret, VPC)" || { bad "leftovers"; echo "$left"; }
fi

hdr "result"
if ((FAILS)); then echo "$FAILS failure(s)"; exit 1; fi
echo "all checks passed"
