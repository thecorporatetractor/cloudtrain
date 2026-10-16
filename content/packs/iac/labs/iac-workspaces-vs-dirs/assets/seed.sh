#!/bin/sh
# Seeds ~/stacks/forecast once and starts the local S3 store with its bucket.
set -eu
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
d=$HOME/stacks/forecast
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/forecast"
cp /var/tmp/ct-seed/backend.tf /var/tmp/ct-seed/main.tf "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
