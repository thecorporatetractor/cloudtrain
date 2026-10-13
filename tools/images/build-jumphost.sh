#!/usr/bin/env bash
# Build the jumphost (learner workstation) image and load it into the dev cluster.
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker
TAG="cloudtrain/jumphost:${LAB_K8S_VERSION}"
docker build -q -t "$TAG" --build-arg KUBECTL_VERSION="$LAB_K8S_VERSION" "$REPO_ROOT/tools/images/jumphost" >/dev/null
log "built $TAG"
if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
  kind load docker-image --name "$CLUSTER_NAME" "$TAG" >/dev/null && log "loaded $TAG into $CLUSTER_NAME"
fi
