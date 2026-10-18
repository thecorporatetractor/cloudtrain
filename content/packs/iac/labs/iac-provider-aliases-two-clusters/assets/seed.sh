#!/bin/sh
# Seeds ~/stacks/farm-status once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/farm-status
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp -R /var/tmp/ct-seed/stack/. "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
