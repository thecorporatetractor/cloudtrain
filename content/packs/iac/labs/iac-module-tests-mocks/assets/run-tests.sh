#!/bin/bash
# Grader: runs the learner's module tests on a private copy of ~/modules/farm-base,
# optionally with a seeded bug, and prints pass | fail | error.
#   run-tests.sh as-is|maths|validation
set -uo pipefail
mode=${1:?mode}
src=/home/learner/modules/farm-base
[ -d "$src/tests" ] || { echo error; exit 0; }
tmp=$(runuser -u learner -- mktemp -d /tmp/ct-tftest.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
runuser -u learner -- cp -a "$src/." "$tmp/"
rm -rf "$tmp/.terraform" "$tmp/test-out" "$tmp"/*.tfstate*
case $mode in
  maths) sed -i 's/var\.turbines \* {{mem}}$/var.turbines * {{mem}} + 64/' "$tmp/main.tf" ;;
  validation) sed -i 's/condition *= var\.turbines >= 1 .*/condition     = var.turbines == var.turbines/' "$tmp/variables.tf" ;;
esac
ct-iac run "$tmp" iac init -input=false -no-color >/dev/null 2>&1 || { echo error; exit 0; }
out=$(ct-iac run "$tmp" iac test -no-color 2>&1); rc=$?
n=$(printf '%s\n' "$out" | grep -oE '[0-9]+ passed' | tail -1 | cut -d' ' -f1)
[ $rc = 0 ] && echo "pass runs=${n:-0}" || echo fail
