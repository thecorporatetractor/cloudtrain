#!/bin/sh
# Seeds and applies ~/stacks/telemetry (local state) once, and prepares the S3 bucket.
set -eu
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
d=$HOME/stacks/telemetry
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/telemetry" "$HOME/reports" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
sed -n 's/^collector=//p' "$HOME/telemetry/collector.id" > .ct-seeded
