#!/usr/bin/env bash
# Delete ONLY the CloudTrain kind cluster. Never touches other clusters/containers.
source "$(dirname "$0")/lib.sh"
if cluster_exists; then
  kind delete cluster --name "$CLUSTER_NAME"
else
  log "kind cluster '$CLUSTER_NAME' does not exist"
fi
