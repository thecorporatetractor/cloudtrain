#!/bin/sh
# Seeds and applies ~/stacks/trading-data once, then adds merge request !142 (not applied).
set -eu
s=/var/tmp/ct-seed/iac-opa-plan-policy
d=$HOME/stacks/trading-data
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/ci" "$d/policy"
cp "$s/stack/"*.tf "$d/" && cp "$s/stack/ci/plan.sh" "$d/ci/" && chmod 755 "$d/ci/plan.sh"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
cp "$s/mr-142.tf" "$d/"
touch .ct-seeded
