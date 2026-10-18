#!/usr/bin/env bash
# Copy the files the Helm charts embed from their sources of truth (Helm cannot
# read outside a chart directory):
#   services/lab-orchestrator/config/crd/*.yaml  -> deploy/charts/cloudtrain-crds/files/
#   services/lab-orchestrator/config/rbac/role.yaml -> deploy/charts/cloudtrain/files/orchestrator-role.yaml
#   deploy/images/catalog.yaml                    -> deploy/charts/cloudtrain/files/catalog.yaml
#   deploy/images/overlays/iac-opentofu.yaml      -> deploy/charts/cloudtrain/files/catalog-iac-opentofu.yaml
# Usage: tools/charts/sync.sh [--check]   (--check: fail if a copy is stale; CI)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHECK=0
[[ ${1:-} == --check ]] && CHECK=1
CRDS=$ROOT/deploy/charts/cloudtrain-crds/files
APP=$ROOT/deploy/charts/cloudtrain/files
pairs=(
  "$ROOT/services/lab-orchestrator/config/rbac/role.yaml|$APP/orchestrator-role.yaml"
  "$ROOT/deploy/images/catalog.yaml|$APP/catalog.yaml"
  "$ROOT/deploy/images/overlays/iac-opentofu.yaml|$APP/catalog-iac-opentofu.yaml"
)
for f in "$ROOT"/services/lab-orchestrator/config/crd/labs.cloudtrain.dev_*.yaml; do
  pairs+=("$f|$CRDS/$(basename "$f")")
done
stale=0
for p in "${pairs[@]}"; do
  src=${p%%|*} dst=${p#*|}
  if ((CHECK)); then
    cmp -s "$src" "$dst" || { echo "stale: ${dst#"$ROOT"/} (run tools/charts/sync.sh)" >&2; stale=1; }
  else
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
done
# CRDs removed at the source must disappear from the chart too.
for dst in "$CRDS"/*.yaml; do
  [[ -e $dst ]] || continue
  [[ -e $ROOT/services/lab-orchestrator/config/crd/$(basename "$dst") ]] && continue
  if ((CHECK)); then echo "stale: ${dst#"$ROOT"/} has no source" >&2; stale=1; else rm -f "$dst"; fi
done
exit $stale
