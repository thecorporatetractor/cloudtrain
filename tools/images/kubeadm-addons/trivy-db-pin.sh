#!/usr/bin/env bash
# Prints new TRIVY_DB_REF / TRIVY_DB_DATE lines for deploy/versions.env: the current
# ghcr.io/aquasecurity/trivy-db:2 (Trivy's vulnerability DB, rebuilt upstream every 6 h),
# pinned by manifest digest. Refreshing the DB baked into kubeadm:1.37-full/-sec:
#   1. bash tools/images/kubeadm-addons/trivy-db-pin.sh   -> paste both lines into versions.env
#   2. rebuild: bash tools/images/build.sh kubeadm-full (fetches the layer, checks its sha256)
#   3. re-verify the Trivy labs: their checks compare against the same DB, so results only
#      shift when the setup's assumptions change (xks-scan-pick-image needs 1-3 of its 4
#      images with a CRITICAL finding).
# Old pins keep working while the registry still serves that manifest; build.sh caches the
# layer in tools/images/.cache/trivy-db-<digest>.tar.gz.
set -euo pipefail
repo=${1:-ghcr.io/aquasecurity/trivy-db}; tag=${2:-2}
host=${repo%%/*}; path=${repo#*/}
token=$(curl -fsSL "https://$host/token?scope=repository:$path:pull" | jq -r .token)
hdr=$(mktemp); trap 'rm -f "$hdr"' EXIT
manifest=$(curl -fsSL -D "$hdr" -H "Authorization: Bearer $token" \
  -H "Accept: application/vnd.oci.image.manifest.v1+json" "https://$host/v2/$path/manifests/$tag")
digest="sha256:$(printf '%s' "$manifest" | sha256sum | cut -d' ' -f1)"
grep -qi "docker-content-digest: *$digest" "$hdr" || { echo "digest mismatch for $repo:$tag" >&2; exit 1; }
created=$(jq -r '.annotations["org.opencontainers.image.created"] // empty' <<<"$manifest")
echo "TRIVY_DB_REF=$repo@$digest"
echo "TRIVY_DB_DATE=${created:-unknown}"
