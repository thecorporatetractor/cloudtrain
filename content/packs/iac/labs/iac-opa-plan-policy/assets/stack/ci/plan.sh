#!/bin/sh
# Trading-data pipeline: plan, policy gate, apply the saved plan. Run from anywhere.
set -eu
cd "$(dirname "$0")/.."
iac plan -input=false -no-color -out=ci/tfplan
iac show -json ci/tfplan > ci/plan.json
# TODO(platform): policy gate on ci/plan.json before anything is applied.
iac apply -input=false -no-color ci/tfplan
