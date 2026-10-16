#!/bin/sh
# Seeds and applies ~/stacks/trading-feed once, with the token in terraform.tfvars.
set -eu
d=$HOME/stacks/trading-feed
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/incident"
cp /var/tmp/ct-seed/main.tf "$d/main.tf"
printf 'grid_operator_token = "%s"\n' "$1" > "$d/terraform.tfvars"
printf '%s\n' "$2" > "$HOME/incident/new-token.txt"; chmod 600 "$HOME/incident/new-token.txt"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
