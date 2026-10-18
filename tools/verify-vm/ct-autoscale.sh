#!/usr/bin/env bash
# Adaptive slot limits for ct-batch.sh: every INTERVAL seconds, look at the last window of
# host metrics (ct-metrics.sh) and move CT_SLOTS_HEAVY and CT_SLOTS_POD in runner.env:
#   up    (heavy +STEP_HEAVY, pod +STEP_POD, when that limit is in use) when CPU busy < CPU_HIGH, MemAvailable > MEM_MIN_GIB, steal < STEAL_MAX and no warning sign
#   down  when CPU busy > CPU_MAX, steal > STEAL_MAX, MemAvailable < MEM_LOW_GIB, a Kube-OVN CNI
#         DEL/ADD older than 15 min, load average over LOAD_MAX (3 x 32 vCPU) (docs/dev-environment.md known gap 9) or >= 2 recent timeout failures
# Decisions: /srv/ct-work/results/state/autoscale.log
set -uo pipefail
CFG=${CT_BATCH_ENV:-/srv/ct-work/vm-config/runner.env}
RES=/srv/ct-work/results; LOG=$RES/state/autoscale.log
INTERVAL=${INTERVAL:-150} MIN=${MIN:-2} MAX=${MAX:-40} POD_MIN=${POD_MIN:-4} POD_MAX=${POD_MAX:-64}
STEP_HEAVY=${STEP_HEAVY:-3} STEP_POD=${STEP_POD:-8}
CPU_HIGH=${CPU_HIGH:-80} CPU_MAX=${CPU_MAX:-95} STEAL_MAX=${STEAL_MAX:-3} MEM_MIN_GIB=${MEM_MIN_GIB:-40} MEM_LOW_GIB=${MEM_LOW_GIB:-20} LOAD_MAX=${LOAD_MAX:-96}
mkdir -p "$RES/state"
get() { grep -E "^$1=" "$CFG" | tail -1 | cut -d= -f2; }
set_heavy() { sed -i "s/^CT_SLOTS_HEAVY=.*/CT_SLOTS_HEAVY=$1/" "$CFG"; }
set_pod() { sed -i "s/^CT_SLOTS_POD=.*/CT_SLOTS_POD=$1/" "$CFG"; }
while sleep "$INTERVAL"; do
  f=$RES/metrics/$(date -u +%F).tsv; [[ -f $f ]] || continue
  since=$(date -u -d "-$INTERVAL sec" +%FT%TZ)
  read -r cpu steal mem load < <(awk -F'\t' -v s="$since" 'NR>1 && $1>=s {n++; c+=$2; st+=$6; if(m==""||$9<m)m=$9; l+=$7} END{if(n) printf "%.0f %.2f %.0f %.1f", c/n, st/n, m, l/n; else print "0 0 999 0"}' "$f")
  stall=0
  for n in cloudtrain-dev-worker cloudtrain-dev-worker2 cloudtrain-dev-worker3; do
    c=$(docker exec "$n" sh -c 'ps -eo etimes,args | awk "\$1 > 900 && /[\/]opt\/cni\/bin\/kube-ovn/" | wc -l' 2>/dev/null || echo 0)
    stall=$((stall + c))
  done
  tmo=$(find "$RES/labs" -name '*.json' -newermt "-$((2 * INTERVAL)) sec" -exec jq -r 'select(.status != "pass") | .failingStep' {} + 2>/dev/null | grep -ciE 'timed out|timeout|deadline|not ready' || true)
  h=$(get CT_SLOTS_HEAVY); p=$(get CT_SLOTS_POD); new=$h newp=$p why=hold
  if ((stall > 0)) || awk -v a="$steal" -v b="$STEAL_MAX" 'BEGIN{exit !(a > b)}' || awk -v a="$load" -v b="$LOAD_MAX" 'BEGIN{exit !(a > b)}' || ((cpu > CPU_MAX || mem < MEM_LOW_GIB || tmo >= 2)); then
    new=$((h - 2)); ((new < MIN)) && new=$MIN; ((p > POD_MIN)) && newp=$((p - 4)); why=down
  elif ((cpu < CPU_HIGH && mem > MEM_MIN_GIB)); then
    # raise a limit only when it is in use (otherwise the queue, not the limit, is the cap)
    rv=$(pgrep -fc 'tools/slots/run.sh vm' || true); rp=$(pgrep -fc 'tools/slots/run.sh pod' || true)
    why="up?"
    if ((rv >= h && h < MAX)); then new=$((h + STEP_HEAVY)); ((new > MAX)) && new=$MAX; fi
    if ((rp >= p && p < POD_MAX)); then newp=$((p + STEP_POD)); ((newp > POD_MAX)) && newp=$POD_MAX; fi
    [[ $new == "$h" && $newp == "$p" ]] && why="hold (vm jobs $rv/$h, pod jobs $rp/$p)" || why=up
  fi
  [[ $new != "$h" ]] && set_heavy "$new"
  [[ $newp != "$p" ]] && set_pod "$newp"
  echo "$(date -u +%FT%TZ) cpu=${cpu}% steal=${steal}% memAvail=${mem}GiB load=${load} cniStall=${stall} timeoutFails=${tmo} heavy ${h} -> ${new}, pod ${p} -> ${newp} (${why})" >> "$LOG"
done
