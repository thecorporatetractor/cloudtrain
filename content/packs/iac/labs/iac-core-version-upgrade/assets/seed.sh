#!/bin/sh
# Seeds ~/trading/<stack> once and applies each with the staged Terraform 1.9 (the
# release the desk last used), state in ct-s3, locks in the DynamoDB table on moto.
set -eu
s=/var/tmp/ct-seed/iac-core-version-upgrade/stacks
[ -e "$HOME/trading/.ct-seeded" ] && exit 0
ct-s3 start && ct-s3 bucket sm-trading-tfstate --versioning
for st in pricing risk settlement reporting; do
  d=$HOME/trading/$st; mkdir -p "$d" && cp "$s/$st.tf" "$d/main.tf"
  (cd "$d" && terraform-1.9 init -input=false -no-color >/dev/null && terraform-1.9 apply -auto-approve -input=false -no-color >/dev/null)
  mkdir -p "$HOME/.cache/ct-cvu" && (cd "$d" && terraform-1.9 output -raw service) > "$HOME/.cache/ct-cvu/$st"
done
touch "$HOME/trading/.ct-seeded"
