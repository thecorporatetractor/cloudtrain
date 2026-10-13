#!/usr/bin/env bash
# Build the jumphost (learner workstation) image ${JUMPHOST_IMAGE} (catalog ref jumphost:1)
# and optionally load it into the dev cluster (LOAD_INTO_KIND=1, the default).
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
TAG="$JUMPHOST_IMAGE"
[[ $(yq -r '.images["jumphost:1"].image' "$CATALOG") == "$TAG" ]] || die "catalog jumphost:1.image does not match JUMPHOST_IMAGE=$TAG"
[[ $(yq -r '.images["jumphost:1"].kubectlVersion // ""' "$CATALOG") == "$LAB_K8S_VERSION" ]] \
  || die "catalog jumphost:1.kubectlVersion does not match LAB_K8S_VERSION=$LAB_K8S_VERSION"
docker build -q -t "$TAG" \
  --label "dev.cloudtrain.catalog-ref=jumphost:1" \
  --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" \
  --build-arg KUBECTL_VERSION="$LAB_K8S_VERSION" \
  --build-arg HELM_VERSION="$HELM_VERSION" --build-arg HELM_TARBALL_SHA256="$HELM_TARBALL_SHA256" \
  --build-arg ETCD_VERSION="$ETCD_VERSION" --build-arg ETCD_TARBALL_SHA256="$ETCD_TARBALL_SHA256" \
  --build-arg YQ_VERSION="$YQ_VERSION" --build-arg YQ_BINARY_SHA256="$YQ_BINARY_SHA256" \
  "$HERE/jumphost" >/dev/null
docker images "$TAG" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
log "built $TAG"
if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
  bash "$HERE/load.sh" jumphost
fi
