#!/bin/sh
# Seeds ~/stacks/trading-network once (a recreated pod must not overwrite the learner's work).
set -eu
d=$HOME/stacks/trading-network
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/iac-moto-vpc-subnets/stack/*.tf "$d/"
cd "$d" && iac init -input=false -no-color >/dev/null
touch .ct-seeded
