#!/usr/bin/env bash
# Prints a ZAP automation plan without its active-scan block (the lines from
# "#>>> active-scan" to "#<<< active-scan"): the passive PR baseline of a plan
# whose full version runs nightly. Usage: zap-baseline-plan.sh .zap/gateway.yaml
set -euo pipefail
plan=$1
grep -q '^  #>>> active-scan' "$plan" || { echo "no active-scan block in $plan" >&2; exit 1; }
sed '/^  #>>> active-scan/,/^  #<<< active-scan/d' "$plan"
