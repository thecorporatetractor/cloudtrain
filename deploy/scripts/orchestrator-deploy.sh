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

# ORCH_NAMESPACE deploys a separate instance (its own namespace, ClusterRoleBinding
# and leader-election lease); SESSION_SELECTOR restricts it to matching
# LabSessions (e.g. labs.cloudtrain.dev/verify=true for labctl verify), so
# several managers can share the cluster without reconciling each other's
# sessions. Defaults: cloudtrain-system, all sessions. SKIP_CRDS=1 leaves the
# cluster's CRDs alone (when other branches' API additions are installed).
NS=${ORCH_NAMESPACE:-cloudtrain-system}
manifests() {
  kubectl kustomize "$SVC/config/default" \
    | NS="$NS" IMG="$IMG" SEL="${SESSION_SELECTOR:-}" yq '
        (select(.kind == "Namespace") | .metadata.name) = strenv(NS) |
        (select(.metadata.namespace == "cloudtrain-system") | .metadata.namespace) = strenv(NS) |
        (select(.kind == "ClusterRoleBinding") | .metadata.name) = "lab-orchestrator-" + strenv(NS) |
        (select(.kind == "ClusterRoleBinding") | .subjects[0].namespace) = strenv(NS) |
        (select(.kind == "Deployment") | .spec.template.spec.containers[0].image) = strenv(IMG) |
        (select(.kind == "Deployment") | .spec.template.spec.containers[0].args) += ["--leader-election-id=lab-orchestrator-" + strenv(NS)] |
        (select(.kind == "Deployment" and strenv(SEL) != "") | .spec.template.spec.containers[0].args) += ["--session-selector=" + strenv(SEL)]' \
    | if [[ ${SKIP_CRDS:-0} == 1 ]]; then yq 'select(.kind != "CustomResourceDefinition")'; else cat; fi
}
log "applying CRDs, RBAC and manager ($IMG) in $NS${SESSION_SELECTOR:+, sessions $SESSION_SELECTOR}"
k apply -f <(manifests) >/dev/null
k -n "$NS" create configmap lab-image-catalog "${CM_ARGS[@]}" --dry-run=client -o yaml | k apply -f - >/dev/null
# A catalog change alone does not change the pod template: restart to reload it.
k -n "$NS" rollout restart deploy/lab-orchestrator >/dev/null
k -n "$NS" rollout status deploy/lab-orchestrator --timeout=180s
log "lab-orchestrator deployed in $NS ($IMG)"
