#!/bin/sh
# Seeds ~/stacks/forecast once (initialised, never applied: the refactor broke it).
set -eu
d=$HOME/stacks/forecast
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/reports" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
touch .ct-seeded
