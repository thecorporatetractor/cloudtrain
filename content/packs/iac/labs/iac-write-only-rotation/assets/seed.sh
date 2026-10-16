#!/bin/sh
# Seeds ~/stacks/telemetry-db once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/telemetry-db
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
