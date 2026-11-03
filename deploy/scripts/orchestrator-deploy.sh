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
# KVM is). IMAGE_SOURCE=ghcr pulls the catalog images CI publishes from GHCR into the
# nodes instead (GHCR_TAG=main|sha-<commit>|sha256:..., docs/deploy.md); default: local.
source "$(dirname "$0")/lib.sh"
for t in kubectl docker kind jq yq; do need "$t"; done
cluster_exists || die "kind cluster $CLUSTER_NAME not found (run: task dev:up)"
if [[ -n ${PROVISION_TIMEOUT:-} && ! $PROVISION_TIMEOUT =~ ^([0-9]+(\.[0-9]+)?(h|m|s|ms))+$ ]]; then
  die "PROVISION_TIMEOUT must be a Go duration such as 40m or 1h30m (got '$PROVISION_TIMEOUT')"
fi
case ${VCLUSTER_POD_SECURITY:-baseline} in baseline|restricted) ;; *) die "VCLUSTER_POD_SECURITY must be baseline or restricted";; esac
# NETWORK_MODE (primary|secondary) sets --network-mode: secondary for clusters where
# Kube-OVN is not the primary CNI (the managed-cni profiles default to it).
if [[ -z ${NETWORK_MODE:-} && $SECONDARY_PROFILE == 1 ]]; then NETWORK_MODE=secondary; fi
case ${NETWORK_MODE:-primary} in primary|secondary) ;; *) die "NETWORK_MODE must be primary or secondary";; esac
# KIND_PROFILE=kata sandboxes tier B in its Kata RuntimeClass (fallback kubevirt) unless
# SANDBOXES (or the deprecated TIER_RUNTIME_CLASSES) is set (SANDBOXES= , empty, deploys
# without sandboxes: the default behaviour).
if [[ $KATA_PROFILE == 1 && -z ${SANDBOXES+x} && -z ${TIER_RUNTIME_CLASSES+x} ]]; then SANDBOXES=B=$KATA_RUNTIME_CLASS; fi
[[ -n ${SANDBOXES:-} && -n ${TIER_RUNTIME_CLASSES:-} ]] && die "SANDBOXES and the deprecated TIER_RUNTIME_CLASSES are exclusive"
if [[ -n ${SANDBOX_PREFLIGHT:-} ]]; then
  [[ -f $SANDBOX_PREFLIGHT ]] || die "SANDBOX_PREFLIGHT $SANDBOX_PREFLIGHT not found"
  [[ -n ${SANDBOXES:-} ]] || die "SANDBOX_PREFLIGHT needs SANDBOXES"
fi

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
    if use_ghcr "$image"; then # IMAGE_SOURCE=ghcr: the nodes pull what CI published
      if [[ $kind == containerDisk ]]; then ghcr_pull_image "$image" "${VM_NODES[@]}"; else ghcr_pull_image "$image" "${ALL_NODES[@]}"; fi
      continue
    fi
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
# sessions. Its session ClusterRole (lab-orchestrator-session-<ns>, bound by the
# manager in every lab namespace it works in), its Role in kube-system (ovn-central
# exec) and its ValidatingAdmissionPolicy (matching only its ServiceAccount) are
# separate too. SKIP_CRDS=1 leaves the
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
# SANDBOXES (docs/kata-spike.md; <tier>=<RuntimeClass>[:kubevirt|:fail], e.g.
# B=kata-clh-runtime-rs) sets --sandboxes (default with KIND_PROFILE=kata, see above) and
# mounts the optional ConfigMap lab-sandbox-preflight (--sandbox-preflight): SANDBOX_PREFLIGHT=<file>
# applies one written by labctl preflight --sandbox-configmap <file>. TIER_RUNTIME_CLASSES is the
# deprecated prototype flag (--tier-runtime-classes, fallback fail).
NS=${ORCH_NAMESPACE:-cloudtrain-system}
# Cluster-scoped RBAC and admission objects (and the Roles in kube-system) of a
# separate instance carry its namespace as a suffix.
SUF=""; [[ $NS != cloudtrain-system ]] && SUF="-$NS"
# The lab pod admission policy (config/rbac/pod_admission_policy.yaml, docs/deploy.md):
# privileged containers in lab namespaces only in the sandbox RuntimeClasses of
# SANDBOXES / TIER_RUNTIME_CLASSES. POD_POLICY=0 leaves it out. POD_POLICY_SCOPE: own
# (only this manager's requests; the default with SESSION_SELECTOR, where several
# managers share the cluster and each one's policy must not judge the others' pods) or
# namespaces (every pod in a lab namespace, whoever creates it; the default otherwise).
# Without the ValidatingAdmissionPolicy API (Kubernetes < 1.30) both admission
# policies are skipped with a warning, and the manager warns at startup.
POD_POLICY=${POD_POLICY:-1}
# Scope "namespaces" judges every pod in lab namespaces against THIS manager's ServiceAccount, so
# another manager on the cluster (dev: cloudtrain-system, ct-exam-system, ...) would have its wired
# pods rejected: default to "own" when a selector is set or another instance exists.
others=$(k get deploy -A -l app.kubernetes.io/name=lab-orchestrator -o jsonpath='{range .items[*]}{.metadata.namespace}{"\n"}{end}' 2>/dev/null | grep -vx "${ORCH_NAMESPACE:-cloudtrain-system}" || true)
if [[ -z ${POD_POLICY_SCOPE:-} ]]; then
  POD_POLICY_SCOPE=namespaces
  [[ -n ${SESSION_SELECTOR:-} || -n $others ]] && POD_POLICY_SCOPE=own
elif [[ $POD_POLICY_SCOPE == namespaces && -n $others ]]; then
  die "POD_POLICY_SCOPE=namespaces would reject the wired pods of the other lab-orchestrator instances ($(tr "\n" " " <<<"$others")); use own"
fi
case $POD_POLICY_SCOPE in own|namespaces) ;; *) die "POD_POLICY_SCOPE must be own or namespaces";; esac
VAP_API=1
# (not `kubectl api-resources`: it fails when any aggregated API is unavailable, e.g. during KubeVirt startup)
k get --raw /apis/admissionregistration.k8s.io/v1 2>/dev/null | jq -e '.resources[] | select(.name == "validatingadmissionpolicies")' >/dev/null || VAP_API=0
if [[ $VAP_API == 0 ]]; then
  warn "the cluster does not serve ValidatingAdmissionPolicy (Kubernetes < 1.30): no admission policies (lab-orchestrator, lab pods)"
  POD_POLICY=0
fi
PP_NAME=""; [[ $POD_POLICY == 1 ]] && PP_NAME="lab-orchestrator-pods$SUF"
# The sandbox RuntimeClasses as a CEL list: <tier>=<RuntimeClass>[:fallback],...
PP_SANDBOXES=""
IFS=, read -ra _tiers <<<"${SANDBOXES:-${TIER_RUNTIME_CLASSES:-}}"
for t in "${_tiers[@]}"; do
  [[ -n $t ]] || continue
  rc=${t#*=}; rc=${rc%%:*}
  [[ $rc =~ ^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$ ]] || die "sandbox RuntimeClass '$rc' is not a valid name"
  [[ ",$PP_SANDBOXES," == *",'$rc',"* ]] || PP_SANDBOXES+="${PP_SANDBOXES:+,}'$rc'"
done
PP_SANDBOXES="[${PP_SANDBOXES//,/, }]"
manifests() {
  kubectl kustomize "$SVC/config/default" \
    | NS="$NS" SUF="$SUF" IMG="$IMG" PPS="$PP_SANDBOXES" PPSCOPE="$POD_POLICY_SCOPE" PPN="$PP_NAME" VAPAPI="$VAP_API" POL="$POD_POLICY" SEL="${SESSION_SELECTOR:-}" VMD="${VM_DISKS:-ephemeral}" PT="${PROVISION_TIMEOUT:-}" PSS="${VCLUSTER_POD_SECURITY:-}" NM="${NETWORK_MODE:-}" MTU="${LAB_MTU:-}" TRC="${TIER_RUNTIME_CLASSES:-}" SBX="${SANDBOXES:-}" SC="${STORAGE_CLASS:-}" HSC="${HOME_STORAGE_CLASS:-}" VSC="${VM_DISK_STORAGE_CLASS:-}" VVM="${VM_DISK_VOLUME_MODE:-}" VAM="${VM_DISK_ACCESS_MODES:-}" yq '
        (select((.kind == "ValidatingAdmissionPolicy" or .kind == "ValidatingAdmissionPolicyBinding") and .metadata.name == "lab-orchestrator-pods" and strenv(POL) != "1") | .kind) = "Drop" |
        (select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "lab-orchestrator-pods") | .spec.variables[] | select(.name == "manager") | .expression) |= sub("system:serviceaccount:cloudtrain-system:"; "system:serviceaccount:" + strenv(NS) + ":") |
        (select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "lab-orchestrator-pods") | .spec.variables[] | select(.name == "sandboxes") | .expression) = strenv(PPS) |
        (select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "lab-orchestrator-pods" and strenv(PPSCOPE) == "own") | .spec.matchConditions) = [{"name": "own-requests", "expression": "request.userInfo.username == '"'"'system:serviceaccount:" + strenv(NS) + ":lab-orchestrator'"'"'"}] |
        (select((.kind == "ValidatingAdmissionPolicy" or .kind == "ValidatingAdmissionPolicyBinding") and strenv(VAPAPI) != "1") | .kind) = "Drop" |
        (select(.kind == "Deployment" and strenv(PPN) != "") | .spec.template.spec.containers[0].args) += ["--pod-admission-policy=" + strenv(PPN)] |
        (select(.kind == "Namespace") | .metadata.name) = strenv(NS) |
        (select(.metadata.namespace == "cloudtrain-system") | .metadata.namespace) = strenv(NS) |
        (select(.kind == "ClusterRole" or .kind == "Role" or .kind == "ValidatingAdmissionPolicy" or .kind == "ValidatingAdmissionPolicyBinding") | .metadata.name) += strenv(SUF) |
        (select(.kind == "ClusterRole") | .rules[] | select(has("resourceNames")) | .resourceNames) |= map(. + strenv(SUF)) |
        (select(.kind == "ClusterRoleBinding" or .kind == "RoleBinding") | .roleRef.name) += strenv(SUF) |
        (select(.kind == "ClusterRoleBinding") | .metadata.name) = "lab-orchestrator-" + strenv(NS) |
        (select(.kind == "RoleBinding") | .metadata.name) += strenv(SUF) |
        (select(.kind == "ClusterRoleBinding" or .kind == "RoleBinding") | .subjects[0].namespace) = strenv(NS) |
        (select(.kind == "ValidatingAdmissionPolicyBinding") | .spec.policyName) += strenv(SUF) |
        (select(.kind == "ValidatingAdmissionPolicy") | .spec.matchConditions[].expression) |= sub("system:serviceaccount:cloudtrain-system:"; "system:serviceaccount:" + strenv(NS) + ":") |
        (select(.kind == "ValidatingAdmissionPolicy") | .spec.validations[].expression) |= sub("lab-orchestrator-session"; "lab-orchestrator-session" + strenv(SUF)) |
        (select(.kind == "Deployment" and strenv(SUF) != "") | .spec.template.spec.containers[0].args) += ["--session-cluster-role=lab-orchestrator-session" + strenv(SUF)] |
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
        (select(.kind == "Deployment" and strenv(MTU) != "") | .spec.template.spec.containers[0].args) += ["--lab-mtu=" + strenv(MTU)] |
        (select(.kind == "Deployment" and strenv(TRC) != "") | .spec.template.spec.containers[0].args) += ["--tier-runtime-classes=" + strenv(TRC)] |
        (select(.kind == "Deployment" and strenv(SBX) != "") | .spec.template.spec.containers[0].args) += ["--sandboxes=" + strenv(SBX), "--sandbox-preflight=/etc/cloudtrain/sandbox-preflight/preflight.yaml"] |
        (select(.kind == "Deployment" and strenv(SBX) != "") | .spec.template.spec.containers[0].volumeMounts) += [{"name": "sandbox-preflight", "mountPath": "/etc/cloudtrain/sandbox-preflight", "readOnly": true}] |
        (select(.kind == "Deployment" and strenv(SBX) != "") | .spec.template.spec.volumes) += [{"name": "sandbox-preflight", "configMap": {"name": "lab-sandbox-preflight", "optional": true}}]' \
    | yq 'select(.kind != "Drop")' \
    | if [[ ${SKIP_CRDS:-0} == 1 ]]; then yq 'select(.kind != "CustomResourceDefinition")'; else cat; fi
}
log "applying CRDs, RBAC and manager ($IMG) in $NS${SESSION_SELECTOR:+, sessions $SESSION_SELECTOR}${PP_NAME:+, pod policy $PP_NAME (scope $POD_POLICY_SCOPE, sandboxes $PP_SANDBOXES)}${PROVISION_TIMEOUT:+, provision timeout $PROVISION_TIMEOUT}${NETWORK_MODE:+, network mode $NETWORK_MODE}${TIER_RUNTIME_CLASSES:+, tier runtime classes $TIER_RUNTIME_CLASSES}${SANDBOXES:+, sandboxes $SANDBOXES}"
k apply -f <(manifests) >/dev/null
k -n "$NS" create configmap lab-image-catalog "${CM_ARGS[@]}" --dry-run=client -o yaml | k apply -f - >/dev/null
if [[ -n ${SANDBOX_PREFLIGHT:-} ]]; then # labctl preflight's verdict, whatever namespace it was written for
  yq ".metadata.namespace = \"$NS\" | .metadata.name = \"lab-sandbox-preflight\"" "$SANDBOX_PREFLIGHT" | k apply -f - >/dev/null
fi
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
