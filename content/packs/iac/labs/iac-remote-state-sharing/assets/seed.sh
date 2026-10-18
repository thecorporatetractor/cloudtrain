#!/bin/sh
# Seeds and applies ~/stacks/trading-net, then ~/stacks/trading-app with the subnet ids
# pasted in as literals. Once only: a recreated pod must not overwrite the learner's work.
set -eu
s=/var/tmp/ct-seed/iac-remote-state-sharing
n=$HOME/stacks/trading-net; a=$HOME/stacks/trading-app
[ -e "$a/.ct-seeded" ] && exit 0
ct-s3 start && ct-s3 bucket sm-trading-tfstate --versioning
mkdir -p "$n" "$a"
cp "$s/trading-net/"*.tf "$n/"
cd "$n" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
sa=$(iac show -json | jq -r '.values.root_module.resources[] | select(.address == "aws_subnet.app[\"eu-west-2a\"]") | .values.id')
sb=$(iac show -json | jq -r '.values.root_module.resources[] | select(.address == "aws_subnet.app[\"eu-west-2b\"]") | .values.id')
cp "$s/trading-app/"*.tf "$a/"
sed -i "s/@SUBNET_A@/$sa/; s/@SUBNET_B@/$sb/" "$a/main.tf"
cd "$a" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch "$n/.ct-seeded" "$a/.ct-seeded"
