#!/bin/bash
# Calibration smoke run: verified labs of each kind at once, through the slot runner.
# shellcheck source=/dev/null
source ~/.profile
R=/srv/ct-work/cloudtrain; OUT=/srv/ct-work/calibration; mkdir -p "$OUT"
export CT_SLOTS_HEAVY=${CT_SLOTS_HEAVY:-6} CT_SLOTS_POD=${CT_SLOTS_POD:-12}
cd "$R/services/lab-orchestrator" || exit 1
echo "start $(date -u +%FT%TZ)" > "$OUT/times.txt"
run() { local slot=$1 id=$2 t0=$SECONDS d; d=$(ls -d "$R"/content/packs/*/labs/"$id")
  "$R/tools/slots/run.sh" "$slot" -- bin/labctl verify --context kind-cloudtrain-dev --repo-root "$R" \
    --session-label labs.cloudtrain.dev/verify=batch --parallel "$([[ $slot == vm ]] && echo 2 || echo 3)" --ready-timeout 45m "$d" > "$OUT/$id.log" 2>&1
  echo "$id $slot rc=$? $((SECONDS - t0))s" >> "$OUT/times.txt"; }
for id in count-schedulable-nodes xel-add-pv-extend-vg xcd-compose-health-order; do run vm $id & sleep 10; done
for id in net-vrrp-gateway-pair archive-timetable-history awk-fare-report iac-first-plan-apply scale-berth-planner two-container-pod kubectl-first-contact; do run pod $id & sleep 3; done
wait
echo "end $(date -u +%FT%TZ)" >> "$OUT/times.txt"
