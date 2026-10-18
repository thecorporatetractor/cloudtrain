#!/bin/sh
# Seeds and applies the four stacks once on kubernetes provider 2.38.0.
set -eu
for s in farm-gullhaven farm-redmoor grid-ingest forecast; do
  d=$HOME/stacks/$s
  [ -e "$d/.ct-seeded" ] && continue
  mkdir -p "$d" && cp "/var/tmp/ct-seed/$s.tf" "$d/main.tf"
  cd "$d"
  iac init -input=false -no-color >/dev/null
  iac apply -auto-approve -input=false -no-color >/dev/null
  touch .ct-seeded
done
