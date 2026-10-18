#!/bin/sh
# Seeds ~/stacks/trading-fleet once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/trading-fleet
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/iac-query-bulk-import/stack/*.tf "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
