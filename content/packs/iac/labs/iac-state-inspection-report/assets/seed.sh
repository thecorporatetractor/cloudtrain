#!/bin/sh
# Seeds and applies ~/stacks/inland once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/inland
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/audit" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
sha256sum terraform.tfstate | cut -d' ' -f1 > .ct-seeded
