#!/bin/sh
# Seeds and applies ~/stacks/trading-desk once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/trading-desk
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/iac-incident-out-of-band-drift/stack/*.tf /var/tmp/ct-seed/iac-incident-out-of-band-drift/INCIDENT.md "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
