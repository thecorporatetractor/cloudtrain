#!/bin/sh
# Seeds ~/stacks/substations once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/substations
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
