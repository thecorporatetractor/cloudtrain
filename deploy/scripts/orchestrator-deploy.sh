#!/usr/bin/env bash
# orchestrator:deploy — build the lab-orchestrator manager image, load it into
# the kind cluster and apply CRDs, RBAC and the Deployment (namespace
# cloudtrain-system). Idempotent.
#
# The image catalog ConfigMap is built from deploy/images/catalog.yaml plus an
# optional local overlay (CATALOG_OVERLAY=<file>, merged over it; use it to
# alias refs during development without editing the shared catalog).
# LOAD_LAB_IMAGES=1 (default) also loads every catalog image that exists in
# the local Docker into the kind nodes (containerDisks only where KVM is).
source "$(dirname "$0")/lib.sh"
for t in kubectl docker kind jq yq; do need "$t"; done
cluster_exists || die "kind cluster $CLUSTER_NAME not found (run: task dev:up)"

SVC="$REPO_ROOT/services/lab-orchestrator"
log "building manager image"
docker build -q -f "$SVC/Dockerfile" -t cloudtrain/lab-orchestrator:dev "$REPO_ROOT" >/dev/null
ID=$(docker image inspect -f '{{.Id}}' cloudtrain/lab-orchestrator:dev | cut -d: -f2 | cut -c1-12)
IMG="cloudtrain/lab-orchestrator:dev-$ID"
docker tag cloudtrain/lab-orchestrator:dev "$IMG"

# load_image <image> <node...>: kind load only where containerd lacks it
# (see lab-demo.sh for why the Docker image ID is not enough).
load_image() {
  local img=$1 id node todo=(); shift
  id=$(docker image inspect -f '{{.Id}}' "$img")
  for node in "$@"; do
    [[ $(docker exec "$node" ctr -n k8s.io images ls "name==docker.io/$img" 2>/dev/null) == *"$id"* ]] && continue
    todo+=("$node")
  done
  ((${#todo[@]})) || return 0
  log "loading $img into ${todo[*]}"
  kind load docker-image --name "$CLUSTER_NAME" --nodes "$(IFS=,; echo "${todo[*]}")" "$img" >/dev/null || die "kind load $img failed"
}
mapfile -t ALL_NODES < <(kind get nodes --name "$CLUSTER_NAME")
load_image "$IMG" "${ALL_NODES[@]}"

CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
CM_ARGS=(--from-file=catalog.yaml="$CATALOG")
if [[ -n ${CATALOG_OVERLAY:-} ]]; then
  [[ -f $CATALOG_OVERLAY ]] || die "CATALOG_OVERLAY $CATALOG_OVERLAY not found"
  CM_ARGS+=(--from-file=overlay.yaml="$CATALOG_OVERLAY")
fi

if [[ ${LOAD_LAB_IMAGES:-1} == 1 ]]; then
  mapfile -t VM_NODES < <(k get nodes -o json | jq -r '.items[] | select((.status.allocatable["devices.kubevirt.io/kvm"] // "0") != "0") | .metadata.name')
  merged=$(yq ea '. as $i ireduce ({}; . * $i)' "$CATALOG" ${CATALOG_OVERLAY:+"$CATALOG_OVERLAY"} -o json)
  while IFS=$'\t' read -r kind image; do
    docker image inspect "$image" >/dev/null 2>&1 || { warn "catalog image $image not in local Docker; skipping"; continue; }
    if [[ $kind == containerDisk ]]; then load_image "$image" "${VM_NODES[@]}"; else load_image "$image" "${ALL_NODES[@]}"; fi
  done < <(jq -r '.images[] | [.kind, .image] | @tsv' <<<"$merged" | sort -u)
fi

log "applying CRDs, RBAC and manager ($IMG)"
k apply -f <(kubectl kustomize "$SVC/config/default" | sed "s#image: cloudtrain/lab-orchestrator:dev\$#image: $IMG#") >/dev/null
k -n cloudtrain-system create configmap lab-image-catalog "${CM_ARGS[@]}" --dry-run=client -o yaml | k apply -f - >/dev/null
# A catalog change alone does not change the pod template: restart to reload it.
k -n cloudtrain-system rollout restart deploy/lab-orchestrator >/dev/null
k -n cloudtrain-system rollout status deploy/lab-orchestrator --timeout=180s
log "lab-orchestrator deployed ($IMG)"
