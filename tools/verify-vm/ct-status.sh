#!/usr/bin/env bash
# One-line JSON status of the verify VM every ${1:-60}s -> /srv/ct-work/results/status.json
set -uo pipefail
RES=/srv/ct-work/results; CFG=/srv/ct-work/vm-config/runner.env; iv=${1:-60}
while :; do
  m=$(tail -1 "$RES/metrics/$(date -u +%F).tsv" 2>/dev/null)
  IFS=$'\t' read -r _ cpu _ _ io st load mu _ _ _ <<<"$m"
  h=$(grep -E '^CT_SLOTS_HEAVY=' "$CFG" | cut -d= -f2); p=$(grep -E '^CT_SLOTS_POD=' "$CFG" | cut -d= -f2)
  rv=$(pgrep -fc 'tools/slots/run.sh vm' || true); rp=$(pgrep -fc 'tools/slots/run.sh pod' || true)
  # queued = labs of the current cycle not finished yet and not running
  cyc=$(grep 'labs to run' "$RES/runner.log" | tail -1)
  ct=$(sed -E 's/^\[([^]]+)\].*/\1/' <<<"$cyc"); n=$(sed -E 's/.*: ([0-9]+) vm \+ ([0-9]+) pod labs.*/\1 \2/' <<<"$cyc")
  total_cycle=$(( ${n% *} + ${n#* } ))
  done_cycle=$(find "$RES/labs" -name '*.json' -newermt "$ct" 2>/dev/null | wc -l)
  q=$(( total_cycle - done_cycle - rv - rp )); ((q < 0)) && q=0
  builds=$(pgrep -fc 'tools/images/(build|build-linux-pod|build-iac-ws|build-jumphost|build-ansible-ctl)\.sh' || true)
  jq -cn --arg ts "$(date -u +%FT%TZ)" --argjson cpu "${cpu:-0}" --argjson io "${io:-0}" --argjson st "${st:-0}" --argjson load "${load:-0}" \
    --argjson mu "${mu:-0}" --argjson h "${h:-0}" --argjson p "${p:-0}" --argjson rv "$rv" --argjson rp "$rp" --argjson q "$q" --argjson b "$builds" \
    --slurpfile labs <(cat "$RES"/labs/*.json 2>/dev/null) '
    {ts:$ts, "cpu%":$cpu, "iowait%":$io, "steal%":$st, load:$load, memUsedGiB:$mu, heavy:$h, pod:$p,
     runningVm:$rv, runningPod:$rp, queued:$q,
     passed:([$labs[] | select(.status=="pass")] | length), failed:([$labs[] | select(.status=="fail" or .status=="error")] | length),
     blocked:([$labs[] | select(.status=="blocked")] | length), total:($labs | length), imagesBuilding:$b,
     lastFailures:([$labs[] | select(.status=="fail" or .status=="error")] | sort_by(.finishedAt) | reverse | .[0:3] | map(.id + ":" + ((.failingStep // "") | .[0:160])))}' \
    > "$RES/status.json.tmp" && mv "$RES/status.json.tmp" "$RES/status.json"
  sleep "$iv"
done
