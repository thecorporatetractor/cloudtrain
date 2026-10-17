#!/bin/bash
# Machine-wide semaphore for heavy work, shared by every agent and terminal.
#   tools/slots/run.sh vm    -- labctl verify ...   # anything that boots lab VMs
#   tools/slots/run.sh build -- bash tools/images/build.sh ...  # VM image builds
#   tools/slots/run.sh pod   -- labctl verify ...   # pod/vcluster-only labs (4 slots)
# vm and build share ONE "heavy" slot: at load 80+ kubeadm VMs lost 64-85% of their CPU
# and never came up (foundations round 3), so one VM job or one image build runs at a time.
# Waits until a slot is free. Two Docker/WSL crashes on this machine came from
# too much parallel load, so heavy commands must go through here.
set -euo pipefail
kind=${1:?usage: run.sh vm|build|pod -- command...}; shift
[[ ${1:-} == -- ]] && shift
case $kind in vm | build) lock=heavy n=1 ;; pod) lock=pod n=4 ;; *) echo "unknown slot kind $kind" >&2; exit 2 ;; esac
dir=/tmp/cloudtrain-slots; mkdir -p "$dir"
while :; do
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
