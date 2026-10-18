#!/bin/sh
# Builds the grader's plan JSON fixtures once (good, public, untagged) in /home/learner/.cache/ct-opa
# (run as the learner; planning creates nothing).
set -eu
f=/var/tmp/ct-seed/iac-opa-plan-policy/fixtures
o=$HOME/.cache/ct-opa
[ -e "$o/.done" ] && exit 0
for c in good public untagged; do
  d=$o/$c; mkdir -p "$d" && cp "$f/providers.tf" "$f/$c.tf" "$d/"
  (cd "$d" && iac init -input=false -no-color >/dev/null && iac plan -input=false -no-color -out=p >/dev/null && iac show -json p > "$o/$c.json")
done
touch "$o/.done"
