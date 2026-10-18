#!/bin/sh
# Seeds ~/stacks/trading once and applies it with Terraform 1.5.7 (terraform-1.5, staged
# on the workstation), so the S3 state and the lock file were last written by 1.5.7.
set -eu
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
d=$HOME/stacks/trading
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/backups" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
terraform-1.5 init -input=false -no-color >/dev/null
terraform-1.5 apply -auto-approve -input=false -no-color >/dev/null
{ terraform-1.5 output -raw desk; echo; ct-s3 api GET /saltmarsh-state/trading/terraform.tfstate | jq -r .lineage; } > .ct-seeded
