#!/bin/sh
# Seeds and applies ~/stacks/inland once.
set -eu
d=$HOME/stacks/inland
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
