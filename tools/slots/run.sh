#!/bin/bash
# Machine-wide semaphore for heavy work, shared by every agent and terminal.
#   tools/slots/run.sh vm    -- labctl verify ...   # anything that boots lab VMs (2 slots)
#   tools/slots/run.sh build -- bash tools/images/build.sh ...  # VM image builds (1 slot)
#   tools/slots/run.sh pod   -- labctl verify ...   # pod/vcluster-only labs (4 slots)
# Waits until a slot is free. Two Docker/WSL crashes on this machine came from
# too much parallel load, so heavy commands must go through here.
set -euo pipefail
kind=${1:?usage: run.sh vm|build|pod -- command...}; shift
[[ ${1:-} == -- ]] && shift
case $kind in vm) n=2 ;; build) n=1 ;; pod) n=4 ;; *) echo "unknown slot kind $kind" >&2; exit 2 ;; esac
dir=/tmp/cloudtrain-slots; mkdir -p "$dir"
while :; do
  for i in $(seq 1 "$n"); do
    exec {fd}>"$dir/$kind.$i.lock"
    if flock -n "$fd"; then
      echo "[slot $kind.$i] $(date +%T) $*" >&2
      "$@"; rc=$?
      flock -u "$fd"; exit $rc
    fi
    exec {fd}>&-
  done
  sleep 15
done
