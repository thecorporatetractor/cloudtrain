#!/bin/sh
# Seeds and applies the ~/stacks/grid-telemetry monolith once (about 200 objects; a
# recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/grid-telemetry
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/iac-split-large-state/stack/*.tf "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color -parallelism=20 >/dev/null
touch .ct-seeded
