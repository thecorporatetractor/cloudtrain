#!/usr/bin/env bash
# Build the interim tier-A Linux learner images (catalog refs linux-pod-deb:24.04 and
# linux-pod-el:10) and load them into the dev cluster (LOAD_INTO_KIND=1, default).
#   tools/images/linux-pod-interim/build.sh [deb] [el]
source "$(dirname "$0")/../../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images/linux-pod-interim"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
targets=("$@"); ((${#targets[@]})) || targets=(deb el)
for t in "${targets[@]}"; do
  case $t in deb) ref=linux-pod-deb:24.04 ;; el) ref=linux-pod-el:10 ;; *) die "unknown target $t" ;; esac
  tag=$(yq -r ".images[\"$ref\"].image" "$CATALOG")
  [[ -n $tag && $tag != null ]] || die "catalog has no $ref"
  log "building $tag"
  docker build -q -t "$tag" --label "dev.cloudtrain.catalog-ref=$ref" "$HERE/$t" >/dev/null
  docker images "$tag" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
  if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
    id=$(docker image inspect -f '{{.Id}}' "$tag")
    for node in $(kind get nodes --name "$CLUSTER_NAME"); do
      [[ $(docker exec "$node" ctr -n k8s.io images ls "name==docker.io/$tag" 2>/dev/null) == *"$id"* ]] && continue
      log "loading $tag into $node"; kind load docker-image --name "$CLUSTER_NAME" --nodes "$node" "$tag" >/dev/null
    done
  fi
done
