#!/bin/sh
# Seeds and applies ~/exam/network, then ~/exam/pricing with the network values pasted in
# as literals (how the pricing team wired it). Once only: a recreated pod must not
# overwrite the candidate's work.
set -eu
s=/var/tmp/ct-seed/xiv-remote-state-consumer
n=$HOME/exam/network; p=$HOME/exam/pricing
[ -e "$p/.ct-seeded" ] && exit 0
ct-s3 start && ct-s3 bucket sm-tfstate --versioning
mkdir -p "$n" "$p"
cp "$s/network/"*.tf "$n/"
cd "$n" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
sub=$(iac output -raw pricing_subnet_id); bkt=$(iac output -raw feeds_bucket)
cp "$s/pricing/"*.tf "$p/"
sed -i "s/@SUBNET@/$sub/; s/@BUCKET@/$bkt/" "$p/main.tf"
cd "$p" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch "$n/.ct-seeded" "$p/.ct-seeded"
