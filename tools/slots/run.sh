#!/bin/bash
# Machine-wide semaphore for heavy work, shared by every agent and terminal.
#   tools/slots/run.sh vm    -- labctl verify ...   # anything that boots lab VMs
#   tools/slots/run.sh build -- bash tools/images/build.sh ...  # VM image builds
#   tools/slots/run.sh pod   -- labctl verify ...   # pod/vcluster-only labs (4 slots)
# Slot counts (defaults are sized for the WSL reference machine; raise them on a bigger host):
#   CT_SLOTS_HEAVY  vm + build jobs at once (default 1)
#   CT_SLOTS_POD    pod jobs at once (default 4)
# Every caller sharing a machine must use the same values: set CT_SLOTS_ENV to an env file
# with CT_SLOTS_HEAVY= / CT_SLOTS_POD= lines (the verify VM: /srv/ct-work/vm-config/runner.env,
# which its autoscaler rewrites). The limit is re-read from that file on every wait round, so a
# waiting job sees a raised limit; without the file (or the key in it) the env var applies.
# vm and build share ONE "heavy" slot: at load 80+ kubeadm VMs lost 64-85% of their CPU
# and never came up (foundations round 3), so one VM job or one image build runs at a time.
# Waits until a slot is free. Two Docker/WSL crashes on this machine came from
# too much parallel load, so heavy commands must go through here.
set -euo pipefail
kind=${1:?usage: run.sh vm|build|pod -- command...}; shift
[[ ${1:-} == -- ]] && shift
case $kind in vm | build) lock=heavy var=CT_SLOTS_HEAVY def=1 ;; pod) lock=pod var=CT_SLOTS_POD def=4 ;; *) echo "unknown slot kind $kind" >&2; exit 2 ;; esac
limit() { # current slot count: CT_SLOTS_ENV file, else the env var, else the default
  local v=""
  [[ -n ${CT_SLOTS_ENV:-} && -r $CT_SLOTS_ENV ]] && v=$(grep -E "^(export )?$var=[0-9]+\s*$" "$CT_SLOTS_ENV" | tail -1 | sed -E 's/.*=([0-9]+).*/\1/' || true)
  echo "${v:-${!var:-$def}}"
}
n=$(limit)
[[ $n =~ ^[1-9][0-9]*$ ]] || { echo "slot count for $lock must be a positive integer (got '$n')" >&2; exit 2; }
dir=/tmp/cloudtrain-slots; mkdir -p "$dir"
while :; do
  m=$(limit); [[ $m =~ ^[1-9][0-9]*$ ]] && n=$m
  for i in $(seq 1 "$n"); do
    exec {fd}>"$dir/$lock.$i.lock"
    if flock -n "$fd"; then
      echo "[slot $lock.$i ($kind)] $(date +%T) $*" >&2
      "$@"; rc=$?
      flock -u "$fd"; exit $rc
    fi
    exec {fd}>&-
  done
  sleep 15
done
