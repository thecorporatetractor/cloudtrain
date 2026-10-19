#!/usr/bin/env bash
# orchestrator:deploy — build the lab-orchestrator manager image, load it into
# the kind cluster and apply CRDs, RBAC and the Deployment (namespace
# cloudtrain-system). Idempotent.
#
# The image catalog ConfigMap is built from deploy/images/catalog.yaml plus an
# optional local overlay (CATALOG_OVERLAY=<file>, merged over it; use it to
# alias refs during development without editing the shared catalog).
# LOAD_LAB_IMAGES=1 (default) also loads every catalog image and workload image
# that exists in the local Docker into the kind nodes (containerDisks only where
# KVM is).
source "$(dirname "$0")/lib.sh"
for t in kubectl docker kind jq yq; do need "$t"; done
cluster_exists || die "kind cluster $CLUSTER_NAME not found (run: task dev:up)"
if [[ -n ${PROVISION_TIMEOUT:-} && ! $PROVISION_TIMEOUT =~ ^([0-9]+(\.[0-9]+)?(h|m|s|ms))+$ ]]; then
  die "PROVISION_TIMEOUT must be a Go duration such as 40m or 1h30m (got '$PROVISION_TIMEOUT')"
fi
case ${VCLUSTER_POD_SECURITY:-baseline} in baseline|restricted) ;; *) die "VCLUSTER_POD_SECURITY must be baseline or restricted";; esac
# NETWORK_MODE (primary|secondary) sets --network-mode: secondary for clusters where
# Kube-OVN is not the primary CNI (KIND_PROFILE=managed-cni defaults to it).
if [[ -z ${NETWORK_MODE:-} && $KIND_PROFILE == managed-cni ]]; then NETWORK_MODE=secondary; fi
case ${NETWORK_MODE:-primary} in primary|secondary) ;; *) die "NETWORK_MODE must be primary or secondary";; esac

SVC="$REPO_ROOT/services/lab-orchestrator"
log "building manager image"
docker build -q -f "$SVC/Dockerfile" -t cloudtrain/lab-orchestrator:dev "$REPO_ROOT" >/dev/null
ID=$(docker image inspect -f '{{.Id}}' cloudtrain/lab-orchestrator:dev | cut -d: -f2 | cut -c1-12)
IMG="cloudtrain/lab-orchestrator:dev-$ID"
docker tag cloudtrain/lab-orchestrator:dev "$IMG"

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
  # Pods of virtual clusters run on the kind nodes: preload the workload images there.
  while read -r image; do
    docker image inspect "$image" >/dev/null 2>&1 || { warn "workload image $image not in local Docker; kind will pull it"; continue; }
    load_image "$image" "${ALL_NODES[@]}"
  done < <(jq -r '.workloadImages[]? // empty' <<<"$merged" | sort -u)
fi

# ORCH_NAMESPACE deploys a separate instance (its own namespace, ClusterRoleBinding
# and leader-election lease); VM_DISKS (default ephemeral: a persistent kubeadm
# session costs ~16 GB of disk, so local verification uses containerDisks; set
# VM_DISKS=persistent to exercise hibernate); SESSION_SELECTOR restricts it to matching
# LabSessions, WarmPools and ExamSessions (e.g. labs.cloudtrain.dev/verify=true for
# labctl verify; app.kubernetes.io/managed-by=cloudtrain-gateway for the gateway's lab
# sessions and exam attempts, `task dev:orchestrator`), so several managers can
# share the cluster without reconciling each other's sessions. An ExamSession's
# environment LabSessions inherit its labels, so the same manager runs them. A separate instance also gets its own ClusterRole
# (lab-orchestrator-<ns>), so deploying one branch's manager never rewrites the
# permissions of another branch's instance. Defaults: cloudtrain-system, all
# sessions. SKIP_CRDS=1 leaves the
# cluster's CRDs alone (when other branches' API additions are installed).
# PROVISION_TIMEOUT (a Go duration, e.g. 40m) sets the manager's
# --provision-timeout: sessions whose nodes are not ready by then fail. Empty
# keeps the manager default (15m); kubeadm sessions on a loaded machine need more.
# STORAGE_CLASS (default for homes, vcluster databases and VM disks),
# HOME_STORAGE_CLASS, VM_DISK_STORAGE_CLASS, VM_DISK_VOLUME_MODE (Block|Filesystem)
# and VM_DISK_ACCESS_MODES set the matching manager flags; all empty = the
# cluster's default class and CDI StorageProfile (see docs/storage.md).
# VCLUSTER_POD_SECURITY (baseline|restricted) sets --vcluster-pod-security.
# NETWORK_MODE (see above) sets --network-mode; LAB_MTU sets --lab-mtu.
NS=${ORCH_NAMESPACE:-cloudtrain-system}
manifests() {
  kubectl kustomize "$SVC/config/default" \
    | NS="$NS" IMG="$IMG" SEL="${SESSION_SELECTOR:-}" VMD="${VM_DISKS:-ephemeral}" PT="${PROVISION_TIMEOUT:-}" PSS="${VCLUSTER_POD_SECURITY:-}" NM="${NETWORK_MODE:-}" MTU="${LAB_MTU:-}" SC="${STORAGE_CLASS:-}" HSC="${HOME_STORAGE_CLASS:-}" VSC="${VM_DISK_STORAGE_CLASS:-}" VVM="${VM_DISK_VOLUME_MODE:-}" VAM="${VM_DISK_ACCESS_MODES:-}" yq '
        (select(.kind == "Namespace") | .metadata.name) = strenv(NS) |
        (select(.metadata.namespace == "cloudtrain-system") | .metadata.namespace) = strenv(NS) |
        (select(.kind == "ClusterRole" and strenv(NS) != "cloudtrain-system") | .metadata.name) = "lab-orchestrator-" + strenv(NS) |
        (select(.kind == "ClusterRoleBinding" and strenv(NS) != "cloudtrain-system") | .roleRef.name) = "lab-orchestrator-" + strenv(NS) |
        (select(.kind == "ClusterRoleBinding") | .metadata.name) = "lab-orchestrator-" + strenv(NS) |
        (select(.kind == "ClusterRoleBinding") | .subjects[0].namespace) = strenv(NS) |
        (select(.kind == "Deployment") | .spec.template.spec.containers[0].image) = strenv(IMG) |
        (select(.kind == "Deployment") | .spec.template.spec.containers[0].args) += ["--leader-election-id=lab-orchestrator-" + strenv(NS)] |
        (select(.kind == "Deployment" and strenv(SEL) != "") | .spec.template.spec.containers[0].args) += ["--session-selector=" + strenv(SEL)] |
        (select(.kind == "Deployment") | .spec.template.spec.containers[0].args) += ["--vm-disks=" + strenv(VMD)] |
        (select(.kind == "Deployment" and strenv(SC) != "") | .spec.template.spec.containers[0].args) += ["--storage-class=" + strenv(SC)] |
        (select(.kind == "Deployment" and strenv(HSC) != "") | .spec.template.spec.containers[0].args) += ["--home-storage-class=" + strenv(HSC)] |
        (select(.kind == "Deployment" and strenv(VSC) != "") | .spec.template.spec.containers[0].args) += ["--vm-disk-storage-class=" + strenv(VSC)] |
        (select(.kind == "Deployment" and strenv(VVM) != "") | .spec.template.spec.containers[0].args) += ["--vm-disk-volume-mode=" + strenv(VVM)] |
        (select(.kind == "Deployment" and strenv(VAM) != "") | .spec.template.spec.containers[0].args) += ["--vm-disk-access-modes=" + strenv(VAM)] |
        (select(.kind == "Deployment" and strenv(PT) != "") | .spec.template.spec.containers[0].args) += ["--provision-timeout=" + strenv(PT)] |
        (select(.kind == "Deployment" and strenv(PSS) != "") | .spec.template.spec.containers[0].args) += ["--vcluster-pod-security=" + strenv(PSS)] |
        (select(.kind == "Deployment" and strenv(NM) != "") | .spec.template.spec.containers[0].args) += ["--network-mode=" + strenv(NM)] |
        (select(.kind == "Deployment" and strenv(MTU) != "") | .spec.template.spec.containers[0].args) += ["--lab-mtu=" + strenv(MTU)]' \
    | if [[ ${SKIP_CRDS:-0} == 1 ]]; then yq 'select(.kind != "CustomResourceDefinition")'; else cat; fi
}
log "applying CRDs, RBAC and manager ($IMG) in $NS${SESSION_SELECTOR:+, sessions $SESSION_SELECTOR}${PROVISION_TIMEOUT:+, provision timeout $PROVISION_TIMEOUT}${NETWORK_MODE:+, network mode $NETWORK_MODE}"
k apply -f <(manifests) >/dev/null
k -n "$NS" create configmap lab-image-catalog "${CM_ARGS[@]}" --dry-run=client -o yaml | k apply -f - >/dev/null
# A catalog change alone does not change the pod template: restart to reload it.
k -n "$NS" rollout restart deploy/lab-orchestrator >/dev/null
k -n "$NS" rollout status deploy/lab-orchestrator --timeout=180s
log "lab-orchestrator deployed in $NS ($IMG)"

# Exactly one manager must reconcile a session: warn about other instances that
# would also pick up this one's sessions (no selector, or the same selector).
while IFS=$'\t' read -r ns sel; do
  [[ $ns == "$NS" ]] && continue
  if [[ -z $sel ]]; then
    warn "lab-orchestrator in $ns has no --session-selector: it also reconciles every session of this instance"
  elif [[ -n ${SESSION_SELECTOR:-} && $sel == "$SESSION_SELECTOR" ]]; then
    warn "lab-orchestrator in $ns uses the same --session-selector ($sel): two managers would reconcile these sessions"
  fi
done < <(k get deploy -A -l app.kubernetes.io/name=lab-orchestrator -o json 2>/dev/null \
  | jq -r '.items[] | [.metadata.namespace, ((.spec.template.spec.containers[0].args // []) | map(select(startswith("--session-selector="))) | .[0] // "" | sub("^--session-selector="; ""))] | @tsv')
