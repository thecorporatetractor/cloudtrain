#!/bin/bash
# Saltmarsh trading-desk pipeline. The CI runner calls it from the main branch:
#   pipeline.sh plan  STACK_DIR
#   pipeline.sh apply STACK_DIR
set -euo pipefail
cmd=${1:?usage: pipeline.sh plan|apply STACK_DIR}
dir=${2:?usage: pipeline.sh plan|apply STACK_DIR}
cd "$dir"
case $cmd in
  plan)  terraform plan -input=false -no-color ;;
  apply) terraform apply -input=false -no-color -auto-approve ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac
