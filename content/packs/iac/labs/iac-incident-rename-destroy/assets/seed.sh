#!/bin/sh
# Seeds and applies ~/stacks/trading-db once, then puts MR !93 (the rename) into the
# working copy without applying it.
set -eu
d=$HOME/stacks/trading-db
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
# MR !93 "naming standard: local names describe the data, not the tech".
sed -i 's/kubernetes_persistent_volume_claim_v1" "db"/kubernetes_persistent_volume_claim_v1" "ledger_data"/; s/kubernetes_persistent_volume_claim_v1\.db\./kubernetes_persistent_volume_claim_v1.ledger_data./' main.tf
touch .ct-seeded
