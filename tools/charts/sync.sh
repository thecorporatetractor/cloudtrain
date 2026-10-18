#!/usr/bin/env bash
# The Helm charts embed files from their sources of truth through relative
# symlinks (Helm cannot read outside a chart directory; it follows symlinks when
# rendering and packaging), so the copies can never drift:
#   deploy/charts/cloudtrain-crds/files/*.yaml        -> services/lab-orchestrator/config/crd/
#   deploy/charts/cloudtrain/files/orchestrator-role.txt -> services/lab-orchestrator/config/rbac/role.yaml
#   deploy/charts/cloudtrain/files/orchestrator-session-role.txt -> .../config/rbac/session_role.yaml
#   deploy/charts/cloudtrain/files/orchestrator-admission-policy.txt -> .../config/rbac/admission_policy.yaml
#     (.txt so scanners do not report the accepted roles a second time)
#   deploy/charts/cloudtrain/files/catalog.yaml       -> deploy/images/catalog.yaml
#   deploy/charts/cloudtrain/files/catalog-iac-opentofu.yaml -> deploy/images/overlays/iac-opentofu.yaml
# This script (re)creates the links, e.g. after a CRD is added or removed.
# Usage: tools/charts/sync.sh [--check]   (--check: fail if a link is missing or wrong; CI)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHECK=0
[[ ${1:-} == --check ]] && CHECK=1
links=(
  "deploy/charts/cloudtrain/files/orchestrator-role.txt|../../../../services/lab-orchestrator/config/rbac/role.yaml"
  "deploy/charts/cloudtrain/files/orchestrator-session-role.txt|../../../../services/lab-orchestrator/config/rbac/session_role.yaml"
  "deploy/charts/cloudtrain/files/orchestrator-admission-policy.txt|../../../../services/lab-orchestrator/config/rbac/admission_policy.yaml"
  "deploy/charts/cloudtrain/files/catalog.yaml|../../../images/catalog.yaml"
  "deploy/charts/cloudtrain/files/catalog-iac-opentofu.yaml|../../../images/overlays/iac-opentofu.yaml"
)
for f in "$ROOT"/services/lab-orchestrator/config/crd/labs.cloudtrain.dev_*.yaml; do
  links+=("deploy/charts/cloudtrain-crds/files/$(basename "$f")|../../../../services/lab-orchestrator/config/crd/$(basename "$f")")
done
bad=0
for l in "${links[@]}"; do
  path=$ROOT/${l%%|*} target=${l#*|}
  if [[ -L $path && $(readlink "$path") == "$target" && -e $path ]]; then continue; fi
  if ((CHECK)); then echo "not linked: ${l%%|*} -> $target (run tools/charts/sync.sh)" >&2; bad=1; continue; fi
  mkdir -p "$(dirname "$path")"; rm -f "$path"; ln -s "$target" "$path"
done
# Links whose CRD was removed at the source.
for p in "$ROOT"/deploy/charts/cloudtrain-crds/files/*.yaml; do
  [[ -e $p ]] && continue
  [[ -L $p ]] || continue
  if ((CHECK)); then echo "dangling: ${p#"$ROOT"/}" >&2; bad=1; else rm -f "$p"; fi
done
exit $bad
