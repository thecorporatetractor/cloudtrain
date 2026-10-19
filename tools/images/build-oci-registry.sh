#!/usr/bin/env bash
# Build the in-lab OCI registry image (tools/images/oci-registry, catalog ref oci-registry:3) and
# load it into the dev cluster (LOAD_INTO_KIND=1, the default). CI publishes the same image
# (.github/workflows/images.yml); this is the local path for a dev cluster without GHCR.
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
TAG=$(yq -r '.images["oci-registry:3"].image' "$CATALOG")
[[ -n $TAG && $TAG != null ]] || die "catalog has no oci-registry:3 image"
docker build -q -t "$TAG" --label "dev.cloudtrain.catalog-ref=oci-registry:3" \
  ${OCI_IMAGE_REVISION:+--label "org.opencontainers.image.revision=$OCI_IMAGE_REVISION"} \
  "$HERE/oci-registry" >/dev/null
docker images "$TAG" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
log "built $TAG"
if [[ ${LOAD_INTO_KIND:-1} == 1 ]] && cluster_exists; then bash "$HERE/load.sh" oci-registry; fi
