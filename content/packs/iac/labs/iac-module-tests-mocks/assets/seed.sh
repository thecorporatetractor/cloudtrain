#!/bin/sh
# Seeds ~/modules/farm-base once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/modules/farm-base
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/tests" && cp -R /var/tmp/ct-seed/module/. "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
