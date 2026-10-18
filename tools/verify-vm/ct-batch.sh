#!/usr/bin/env bash
# CloudTrain batch verifier for the remote verify VM (no LLM in the loop).
#
#   ct-batch.sh loop                 pull origin/main, verify every `status: built` lab and exam task,
#                                    then the exam runs; repeat every CYCLE_SLEEP seconds (systemd unit)
#   ct-batch.sh once [id,...]        one cycle (optionally only these lab ids; they are re-run even if passed);
#                                    while the loop runs, the ids are queued for it instead (state/requeue)
#   ct-batch.sh summary              print the summary table
#   ct-batch.sh list                 built labs: slot, run/skip, image readiness (no side effects)
#
# Results (persistent volume): $RES/summary.tsv, $RES/summary.json, $RES/labs/<id>.json,
# $RES/logs/<id>.log, $RES/reports/<id>.json (labctl's own report), $RES/exams/<exam>-<mode>.json.
# A lab is skipped when it passed with the same lab tree (git) and platform hash; a failed
# lab is re-run when its tree or the platform changed. Killed runs leave no result and run again.
set -uo pipefail
# shellcheck source=/dev/null
source ~/.profile 2>/dev/null || true
CFG=${CT_BATCH_ENV:-/srv/ct-work/vm-config/runner.env}
# shellcheck source=/dev/null
[[ -f $CFG ]] && source "$CFG"
REPO=${REPO:-/srv/ct-work/cloudtrain}
RES=${RES:-/srv/ct-work/results}
VMCFG=${VMCFG:-/srv/ct-work/vm-config}
CTX=kind-cloudtrain-dev
export CT_SLOTS_HEAVY=${CT_SLOTS_HEAVY:-1} CT_SLOTS_POD=${CT_SLOTS_POD:-4}
export CT_SLOTS_ENV=${CT_SLOTS_ENV:-$CFG}   # tools/slots/run.sh re-reads the limits from it while waiting
SESSION_LABEL=${SESSION_LABEL:-labs.cloudtrain.dev/verify=batch}
ORCH_NS=${ORCH_NS:-ct-batch-system}
RECONCILES=${RECONCILES:-64}
PAR_VM=${PAR_VM:-2} PAR_POD=${PAR_POD:-3}
READY_TIMEOUT=${READY_TIMEOUT:-45m}
GRADE_TIMEOUT=${GRADE_TIMEOUT:-15m}   # labctl verify --grade-timeout: max time for one grading round (default 5m)
CYCLE_SLEEP=${CYCLE_SLEEP:-900}
EXAM_SEEDS=${EXAM_SEEDS:-"1 2"}   # auto-solve with the first, no-solve with the second
mkdir -p "$RES"/{labs,logs,reports,exams,state}
LOG=$RES/runner.log
K="kubectl --context $CTX"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG" >&2; }

# ---------------------------------------------------------------------------- repo + platform
platform_hash() { git -C "$REPO" rev-parse HEAD:services/lab-orchestrator HEAD:deploy/images HEAD:deploy/versions.env HEAD:tools/images | sha256sum | cut -c1-16; }

cluster_up() {
  if ! $K get --raw /readyz >/dev/null 2>&1 || [[ $(docker ps -a --filter label=io.x-k8s.kind.cluster=cloudtrain-dev --filter status=exited -q | wc -l) != 0 ]]; then
    log "cluster not ready: dev:up"
    (cd "$REPO" && KIND_CONFIG=$VMCFG/kind-cluster.yaml KUBE_OVN_EXTRA_VALUES=$VMCFG/kube-ovn-values.yaml task dev:up) >>"$RES/state/dev-up.log" 2>&1 \
      || { log "dev:up failed (see state/dev-up.log)"; return 1; }
  fi
  bash "$VMCFG/tune.sh" >>"$RES/state/tune.log" 2>&1 || log "tune.sh failed (state/tune.log)"   # idempotent; also after node restarts
}

deploy_manager() {
  log "deploying manager in $ORCH_NS (selector $SESSION_LABEL)"
  (cd "$REPO" && ORCH_NAMESPACE=$ORCH_NS SESSION_SELECTOR=$SESSION_LABEL LOAD_LAB_IMAGES=1 PROVISION_TIMEOUT=40m \
     bash deploy/scripts/orchestrator-deploy.sh) >>"$RES/state/manager.log" 2>&1 || { log "manager deploy failed"; return 1; }
  local args
  args=$($K -n "$ORCH_NS" get deploy lab-orchestrator -o json | jq -c --arg r "--max-concurrent-reconciles=$RECONCILES" \
    '.spec.template.spec.containers[0].args | map(select(startswith("--max-concurrent-reconciles=") | not)) + [$r]')
  $K -n "$ORCH_NS" patch deploy lab-orchestrator --type json -p "[
    {\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/args\",\"value\":$args},
    {\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/resources\",\"value\":{\"requests\":{\"cpu\":\"500m\",\"memory\":\"512Mi\"},\"limits\":{\"memory\":\"6Gi\"}}}]" >/dev/null
  $K -n "$ORCH_NS" rollout status deploy/lab-orchestrator --timeout=300s >/dev/null
  platform_hash > "$RES/state/manager.hash"
}

sync_repo() {
  local old new
  old=$(git -C "$REPO" rev-parse HEAD)
  git -C "$REPO" fetch -q origin main || { log "git fetch failed; staying on ${old:0:9}"; return 0; }
  git -C "$REPO" reset -q --hard origin/main
  new=$(git -C "$REPO" rev-parse HEAD)
  if [[ $old != "$new" || ! -x $REPO/services/lab-orchestrator/bin/labctl ]]; then
    log "repo ${old:0:9} -> ${new:0:9}"
    (cd "$REPO" && pnpm install --frozen-lockfile && pnpm --filter @cloudtrain/lab-schema build \
      && GOTOOLCHAIN=go1.27.2 go build -o services/lab-orchestrator/bin/labctl ./services/lab-orchestrator/cmd/labctl) \
      >>"$RES/state/build.log" 2>&1 || { log "labctl build failed (state/build.log)"; return 1; }
    local imgs
    imgs=$(git -C "$REPO" diff --name-only "$old" "$new" -- tools/images tools/mirrors deploy/versions.env deploy/images | head -50)
    [[ -n $imgs ]] && { printf '%s %s..%s\n%s\n' "$(date -u +%FT%TZ)" "${old:0:9}" "${new:0:9}" "$imgs" >> "$RES/state/images-stale.txt"; log "image inputs changed (state/images-stale.txt); images are NOT rebuilt automatically"; }
  fi
  [[ $(cat "$RES/state/manager.hash" 2>/dev/null) == "$(platform_hash)" ]] && $K -n "$ORCH_NS" get deploy lab-orchestrator >/dev/null 2>&1 || deploy_manager
}

# Leftovers from runs killed by a stop/reboot: verify and exam namespaces of this runner.
cleanup_stale() {
  local ns
  # only when no verify/exam run is alive (a manual run may share the cluster and label)
  pgrep -u "$(id -u)" -f 'bin/labctl (verify|exam run)' >/dev/null && { log "labctl runs alive; skipping stale namespace cleanup"; return 0; }
  ns=$($K get ns -o name 2>/dev/null | grep -E '^namespace/ctv-' || true)
  [[ -n $ns ]] && { log "deleting stale namespaces: $(echo $ns | tr '\n' ' ')"; $K delete $ns --wait=false >/dev/null 2>&1; }
}

# ---------------------------------------------------------------------------- lab list
# id <TAB> dir <TAB> slot  for every built lab/exam task at HEAD
lab_list() {
  yq -r '.labs[] | select(.status == "built") | [.id, .envTier, ((.images // []) | join(","))] | @tsv' "$REPO/content/curriculum.yaml" |
  while IFS=$'\t' read -r id tier refs; do
    dir=$(ls -d "$REPO"/content/packs/*/labs/"$id" 2>/dev/null | head -1)
    [[ -n $dir ]] || { echo -e "$id\t-\tmissing\t"; continue; }
    case $tier in K | C | B) slot=vm ;; *) slot=pod ;; esac
    echo -e "$id\t$dir\t$slot\t$refs"
  done
}
# Image gate: a lab starts only when every catalog image it uses is in the kind nodes'
# containerd (builds load them when they finish), so verifies start as images appear.
declare -A CAT=() IMG_OK=()
load_catalog() { local r i; CAT=(); while IFS=$'\t' read -r r i; do CAT[$r]=$i; done < <(yq -r '.images | to_entries[] | [.key, .value.image] | @tsv' "$REPO/deploy/images/catalog.yaml"); }
images_ready() { # images_ready <ref,ref,...>; prints the first missing image
  local r img n
  for r in ${1//,/ }; do
    img=${CAT[$r]:-}; [[ -n $img ]] || continue          # unknown refs are recorded as blocked earlier
    [[ -n ${IMG_OK[$img]:-} ]] && continue
    for n in cloudtrain-dev-worker cloudtrain-dev-worker2 cloudtrain-dev-worker3; do
      docker exec "$n" crictl inspecti -q "$img" >/dev/null 2>&1 || { echo "$img"; return 1; }
    done
    IMG_OK[$img]=1
  done
}
lab_hash() { git -C "$REPO" rev-parse "HEAD:${1#"$REPO"/}" 2>/dev/null; }

needs_run() { # needs_run <id> <dir> <force>
  local f=$RES/labs/$1.json
  [[ $3 == 1 || ! -f $f ]] && return 0
  local st lh ph
  read -r st lh ph < <(jq -r '[.status, .labHash, .platformHash] | @tsv' "$f")
  [[ $lh != "$(lab_hash "$2")" ]] && return 0
  [[ $st == pass ]] && return 1
  [[ $ph != "$(platform_hash)" ]]   # failed: re-run only when the platform changed
}

run_lab() { # run_lab <id> <dir> <slot>
  local id=$1 dir=$2 slot=$3 t0 rc par lh ph log=$RES/logs/$1.log rep=$REPO/deploy/.results/verify/$1.json
  par=$([[ $slot == vm ]] && echo "$PAR_VM" || echo "$PAR_POD")
  lh=$(lab_hash "$dir"); ph=$(platform_hash); t0=$(date +%s)
  rm -f "$rep"
  { echo "# $id ($slot) rev $(git -C "$REPO" rev-parse --short HEAD) started $(date -u +%FT%TZ)"
    cd "$REPO/services/lab-orchestrator" && "$REPO/tools/slots/run.sh" "$slot" -- timeout -k 2m 4h bin/labctl verify --context "$CTX" \
      --repo-root "$REPO" --session-label "$SESSION_LABEL" --parallel "$par" --ready-timeout "$READY_TIMEOUT" --grade-timeout "$GRADE_TIMEOUT" "$dir"; } >"$log" 2>&1
  rc=$?
  [[ -f $rep ]] && cp "$rep" "$RES/reports/$id.json"
  local status=fail step=""
  if [[ $rc == 0 ]]; then status=pass
  elif [[ -f $rep ]]; then
    step=$(jq -r 'first(.runs[] | select(.ok | not) | "\(.kind)\(if .id then ":" + .id else "" end) seed \(.seed): \((.errors // [])[0] // ("teardown " + .teardown))") // ((.errors // [])[0]) // "unknown"' "$rep")
  else status=error; step="labctl exited $rc without a report"; [[ $rc == 124 ]] && step="timed out after 4h"; fi
  jq -n --arg id "$id" --arg dir "${dir#"$REPO"/}" --arg slot "$slot" --arg status "$status" --arg step "$step" \
    --arg rev "$(git -C "$REPO" rev-parse HEAD)" --arg lh "$lh" --arg ph "$ph" --argjson rc "$rc" \
    --argjson t0 "$t0" --argjson t1 "$(date +%s)" --arg tail "$(tail -n 40 "$log" | cut -c1-400)" \
    '{id:$id, path:$dir, slot:$slot, status:$status, failingStep:$step, exitCode:$rc, rev:$rev, labHash:$lh, platformHash:$ph,
      startedAt:($t0|todate), finishedAt:($t1|todate), durationSec:($t1-$t0), log:("logs/"+$id+".log"),
      report:(if $status=="error" then null else "reports/"+$id+".json" end), logTail:$tail}' > "$RES/labs/$id.json.tmp" \
    && mv "$RES/labs/$id.json.tmp" "$RES/labs/$id.json"
  log "$id: $status ($(( $(date +%s) - t0 ))s)${step:+ - $step}"
  summary >/dev/null
}

# ---------------------------------------------------------------------------- exams
task_passed() { # verified in the curriculum, or passed here at the current lab hash
  local id=$1 st dir
  st=$(yq -r ".labs[] | select(.id == \"$id\") | .status" "$REPO/content/curriculum.yaml")
  [[ $st == verified ]] && return 0
  dir=$(ls -d "$REPO"/content/packs/*/labs/"$id" 2>/dev/null | head -1)
  [[ -n $dir && -f $RES/labs/$id.json ]] || return 1
  [[ $(jq -r .status "$RES/labs/$id.json") == pass && $(jq -r .labHash "$RES/labs/$id.json") == "$(lab_hash "$dir")" ]]
}

run_exam() { # run_exam <exam> <mode> <seed> <inputs-hash>
  local ex=$1 mode=$2 seed=$3 ih=$4 t0 rc log=$RES/logs/exam-$1-$2.log rep=$REPO/deploy/.results/exams/$1-$2.json
  t0=$(date +%s); rm -f "$rep"
  (cd "$REPO/services/lab-orchestrator" && "$REPO/tools/slots/run.sh" vm -- timeout -k 2m 5h bin/labctl exam run "--$mode" --seed "$seed" \
     --context "$CTX" --repo-root "$REPO" --session-label "$SESSION_LABEL" --ready-timeout 45m "$ex") >"$log" 2>&1
  rc=$?
  local status step=""
  if [[ $rc == 0 ]]; then status=pass; elif [[ -f $rep ]]; then status=fail
    step=$(jq -r '((.errors // [])[0]) // (first(.attempts[] | (.errors // [])[0])) // "unknown"' "$rep")
  else status=error; step="labctl exited $rc without a report"; fi
  [[ -f $rep ]] && cp "$rep" "$RES/reports/exam-$ex-$mode.json"
  jq -n --arg ex "$ex" --arg mode "$mode" --argjson seed "$seed" --arg status "$status" --arg step "$step" --arg ih "$ih" \
    --arg rev "$(git -C "$REPO" rev-parse HEAD)" --argjson t0 "$t0" --argjson t1 "$(date +%s)" --arg tail "$(tail -n 40 "$log" | cut -c1-400)" \
    '{exam:$ex, mode:$mode, seed:$seed, status:$status, failingStep:$step, rev:$rev, inputsHash:$ih, startedAt:($t0|todate),
      finishedAt:($t1|todate), durationSec:($t1-$t0), log:("logs/exam-"+$ex+"-"+$mode+".log"), report:("reports/exam-"+$ex+"-"+$mode+".json"), logTail:$tail}' \
    > "$RES/exams/$ex-$mode.json.tmp" && mv "$RES/exams/$ex-$mode.json.tmp" "$RES/exams/$ex-$mode.json"
  log "exam $ex $mode: $status${step:+ - $step}"
  summary >/dev/null
}

exam_jobs() { # prints "<exam> <mode> <seed> <hash>" for exams whose drawn tasks all pass and that need a run
  local ex mode seed tasks ok ih t
  for ex in $(yq -r '.exams[].id' "$REPO/content/curriculum.yaml"); do
    set -- $EXAM_SEEDS
    for mode in auto-solve no-solve; do
      seed=$1; [[ $mode == no-solve ]] && seed=${2:-$1}
      tasks=$(cd "$REPO/services/lab-orchestrator" && bin/labctl exam draw --repo-root "$REPO" --seed "$seed" -o json "$ex" 2>/dev/null | jq -r '.tasks[].id' | sort -u)
      [[ -n $tasks ]] || { echo "$ex: draw failed" >>"$RES/state/exam-skip.log"; continue; }
      ok=1; for t in $tasks; do task_passed "$t" || { ok=0; break; }; done
      ((ok)) || continue
      ih=$( { for t in $tasks; do d=$(ls -d "$REPO"/content/packs/*/labs/"$t" | head -1); lab_hash "$d"; done; platform_hash; } | sha256sum | cut -c1-16)
      f=$RES/exams/$ex-$mode.json
      [[ -f $f && $(jq -r .inputsHash "$f") == "$ih" ]] && continue   # same inputs: no re-run (pass or fail)
      echo "$ex $mode $seed $ih"
    done
  done
}

# ---------------------------------------------------------------------------- scheduling
declare -A RUNNING=()   # pid -> slot
# Jobs in flight per slot kind, counted from the processes (so jobs of an earlier runner that
# survived a restart, and manual runs through the slot runner, count too).
running_count() { pgrep -fc "tools/slots/run.sh $1 --" || true; }
alive() { pgrep -f -- "bin/labctl verify .*--ready-timeout [^ ]+ $1\$" >/dev/null; }
reap() { local p; for p in "${!RUNNING[@]}"; do kill -0 "$p" 2>/dev/null || { wait "$p" 2>/dev/null; unset "RUNNING[$p]"; }; done; }
# Slot limits are re-read from $CFG before every dispatch, so they can be changed while the runner runs.
reload_limits() { [[ -f $CFG ]] && eval "$(grep -E '^(export )?CT_SLOTS_(HEAVY|POD)=[0-9]+$' "$CFG")"; export CT_SLOTS_HEAVY CT_SLOTS_POD; }
limit_for() { reload_limits; [[ $1 == vm ]] && echo "$CT_SLOTS_HEAVY" || echo "$CT_SLOTS_POD"; }

# Requeue: `once <ids>` while the loop holds the runner lock appends the ids to state/requeue;
# the loop picks them up while it dispatches (and wakes from its sleep for them), forced.
REQUEUE=$RES/state/requeue
requeue_add() { (flock 8; tr ',' '\n' <<<"$1" | grep -v '^$' >> "$REQUEUE") 8>"$REQUEUE.lock"; }
requeue_take() { # prints queued ids (comma-separated) and empties the queue
  (flock 8; [[ -s $REQUEUE ]] && sort -u "$REQUEUE" | paste -sd, -; : > "$REQUEUE") 8>"$REQUEUE.lock" 2>/dev/null
}
# requeue_into <ids>: append those labs to vmq/podq of the calling cycle (forced), unless running
requeue_into() {
  local id dir slot refs n=0
  while IFS=$'\t' read -r id dir slot refs; do
    [[ ,$1, == *",$id,"* && $slot != missing ]] || continue
    alive "$dir" && { log "requeue: $id is running; skipped"; continue; }
    [[ " ${vmq[*]} ${podq[*]} " == *" $id|"* ]] && continue   # already waiting in this cycle
    if [[ $slot == vm ]]; then vmq+=("$id|$dir|$refs"); else podq+=("$id|$dir|$refs"); fi
    n=$((n + 1))
  done < <(lab_list)
  log "requeue: queued $n of $1"
}

cycle() { # cycle [ids]
  local only=${1:-} force=0 id dir slot vmq=() podq=()
  [[ -n $only ]] && force=1
  cluster_up || return 1
  sync_repo || return 1
  cleanup_stale
  load_catalog; IMG_OK=()
  while IFS=$'\t' read -r id dir slot refs; do
    [[ -n $only && ,$only, != *",$id,"* ]] && continue
    if [[ $slot == missing ]]; then
      jq -n --arg id "$id" '{id:$id, status:"error", failingStep:"no lab directory under content/packs", finishedAt:(now|todate)}' > "$RES/labs/$id.json"; continue
    fi
    needs_run "$id" "$dir" "$force" || continue
    alive "$dir" && continue    # still running from before a runner restart
    # a ref the catalog does not know cannot be built here: record it, retry when the platform changes
    local r unknown=""
    for r in ${refs//,/ }; do [[ -n ${CAT[$r]:-} ]] || unknown+="$r "; done
    if [[ -n $unknown ]]; then
      jq -n --arg id "$id" --arg dir "${dir#"$REPO"/}" --arg u "${unknown% }" --arg lh "$(lab_hash "$dir")" --arg ph "$(platform_hash)" \
        '{id:$id, path:$dir, status:"blocked", failingStep:("image ref not in deploy/images/catalog.yaml: " + $u), labHash:$lh, platformHash:$ph, finishedAt:(now|todate)}' > "$RES/labs/$id.json"
      continue
    fi
    if [[ $slot == vm ]]; then vmq+=("$id|$dir|$refs"); else podq+=("$id|$dir|$refs"); fi
  done < <(lab_list)
  log "cycle at $(git -C "$REPO" rev-parse --short HEAD): ${#vmq[@]} vm + ${#podq[@]} pod labs to run (slots heavy=$CT_SLOTS_HEAVY pod=$CT_SLOTS_POD)"
  # queue entries are "id|dir|refs"; started ones are blanked. Labs whose images are not
  # there yet wait (other labs go first); after IMAGE_WAIT seconds they are recorded as errors.
  local q i e refs miss started_at=$SECONDS left
  while :; do
    reap
    local rq; rq=$(requeue_take); [[ -n $rq ]] && requeue_into "$rq"
    left=0
    for q in vm pod; do
      local -n Q=${q}q
      for i in "${!Q[@]}"; do
        e=${Q[$i]}; [[ -n $e ]] || continue
        left=$((left + 1))
        (( $(running_count $q) < $(limit_for $q) )) || break
        IFS='|' read -r id dir refs <<<"$e"
        if ! miss=$(images_ready "$refs"); then
          if (( SECONDS - started_at > ${IMAGE_WAIT:-10800} )); then
            jq -n --arg id "$id" --arg m "$miss" '{id:$id, status:"error", failingStep:("image not available in kind: " + $m), finishedAt:(now|todate)}' > "$RES/labs/$id.json"
            log "$id: image $miss still missing; recorded as error"; Q[$i]=""
          fi
          continue
        fi
        Q[$i]=""
        run_lab "$id" "$dir" $q 9>&- & RUNNING[$!]=$q
        [[ $q == vm ]] && sleep 3 || sleep 1   # small stagger; slots fill within one pass
      done
      unset -n Q
    done
    ((left == 0 && ${#RUNNING[@]} == 0)) && break
    sleep 5
  done
  # exam runs (heavy slot each), after the labs of this cycle
  [[ -n $only ]] && return 0
  local jobs; mapfile -t jobs < <(exam_jobs)
  log "exam runs to start: ${#jobs[@]}"
  local j ex mode seed ih
  for j in "${jobs[@]}"; do
    read -r ex mode seed ih <<<"$j"
    while (( $(running_count vm) >= $(limit_for vm) )); do sleep 15; reap; done
    run_exam "$ex" "$mode" "$seed" "$ih" 9>&- & RUNNING[$!]=vm; sleep 20
  done
  while ((${#RUNNING[@]} > 0)); do sleep 15; reap; done
}

summary() {
  local t1 t2 f
  t1=$(mktemp "$RES/.summary.tsv.XXXXXX"); t2=$(mktemp "$RES/.summary.json.XXXXXX")
  { printf 'id\tstatus\tslot\tdurationSec\tfinishedAt\tfailingStep\n'
    for f in "$RES"/labs/*.json; do
      [[ -f $f ]] || continue
      jq -r '[.id, .status, .slot // "", .durationSec // "", .finishedAt // "", (.failingStep // "" | gsub("[\t\n]"; " "))] | @tsv' "$f"
    done | sort -k2,2 -k1,1
    for f in "$RES"/exams/*.json; do
      [[ -f $f ]] || continue
      jq -r '["exam:" + .exam + ":" + .mode, .status, "vm", .durationSec, .finishedAt, (.failingStep // "" | gsub("[\t\n]"; " "))] | @tsv' "$f"
    done
  } > "$t1"
  mv "$t1" "$RES/summary.tsv"
  if cat "$RES"/labs/*.json 2>/dev/null | jq -s '{generatedAt:(now|todate), counts:(group_by(.status) | map({key:.[0].status, value:length}) | from_entries), labs:.}' > "$t2"; then
    mv "$t2" "$RES/summary.json"
  else rm -f "$t2"; fi
  cat "$RES/summary.tsv"
}

case ${1:-loop} in
  loop) # Run from a private copy, so editing the installed script never changes a running one;
        # every cycle re-execs the installed script, so edits apply from the next cycle on.
        SELF=${CT_BATCH_SELF:-$(readlink -f "$0")}
        if [[ $(readlink -f "$0") != "$RES/state/ct-batch.run.sh" ]]; then
          cp "$SELF" "$RES/state/ct-batch.run.sh" && CT_BATCH_SELF=$SELF exec bash "$RES/state/ct-batch.run.sh" loop
        fi
        exec 9>"$RES/state/runner.flock"; flock -n 9 || { log "another runner holds the lock"; exit 1; }
        log "runner cycle start (pid $$)"
        cycle || log "cycle failed; retrying after sleep"; summary >/dev/null
        log "cycle done; sleeping ${CYCLE_SLEEP}s (a requeue wakes it)"
        for ((t = 0; t < CYCLE_SLEEP; t += 15)); do [[ -s $REQUEUE ]] && break; sleep 15; done
        exec 9>&-
        cp "$SELF" "$RES/state/ct-batch.run.sh.new" && mv "$RES/state/ct-batch.run.sh.new" "$RES/state/ct-batch.run.sh"
        CT_BATCH_SELF=$SELF exec bash "$RES/state/ct-batch.run.sh" loop ;;
  once) exec 9>"$RES/state/runner.flock"
        if ! flock -n 9; then
          [[ -n ${2:-} ]] || { log "another runner holds the lock"; exit 1; }
          requeue_add "$2"; log "the loop holds the runner lock; queued for it: $2"; exit 0
        fi
        cycle "${2:-}"; summary >/dev/null ;;
  summary) summary ;;
  list) load_catalog; while IFS=$'\t' read -r id dir slot refs; do
          w=$(needs_run "$id" "$dir" 0 && echo run || echo skip); m=$(images_ready "$refs") && m=ready
          printf '%s\t%s\t%s\t%s\n' "$id" "$slot" "$w" "$m"; done < <(lab_list) ;;
  *) echo "usage: $0 loop | once [id,...] | summary | list" >&2; exit 2 ;;
esac
