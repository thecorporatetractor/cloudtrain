#!/usr/bin/env bash
# Load CloudTrain images into the kind dev cluster (cloudtrain-dev).
#
# Usage: load.sh [name...]     default: all
#   kubeadm-node | kubeadm-upgrade | etcd-host   containerDisks -> nodes that run VMs
#   jumphost, linux-pod-el, linux-pod-deb, mirror,
#   iac-ws-terraform, iac-ws-tofu                -> every node
#   el-vm | ubuntu-vm | docker-vm                containerDisks -> nodes that run VMs
#   workloads                                    lab workload images (tools/images/lock/
#                                                workloads.lock) -> every node, for
#                                                `mode: virtual` labs whose Pods run on
#                                                the host nodes
#
# Idempotent: an image already on a node with the same digest is skipped.
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need kind; need jq
cluster_exists || die "kind cluster $CLUSTER_NAME does not exist (run: task dev:up)"
HERE="$REPO_ROOT/tools/images"

ALL_NODES=$(kind get nodes --name "$CLUSTER_NAME")
# Only nodes that can run VMs (KVM device advertised) need the 1-3 GB containerDisks.
VM_NODES=$(k get nodes -o json | jq -r '.items[] | select((.status.allocatable["devices.kubevirt.io/kvm"] // "0") != "0") | .metadata.name')

# load_docker_image <image> <node...>: `kind load` compares Docker's image ID with the CRI
# image ID; with Docker's containerd image store those differ, so it would re-import every
# time. Compare against containerd's index digest instead.
load_docker_image() {
  local img=$1 id node todo=(); shift
  docker image inspect "$img" >/dev/null 2>&1 || die "$img not built (run: task image:build:all)"
  id=$(docker image inspect -f '{{.Id}}' "$img")
  for node in "$@"; do
    [[ $(docker exec "$node" ctr -n k8s.io images ls "name==docker.io/$img" 2>/dev/null) == *"$id"* ]] && continue
    todo+=("$node")
  done
  ((${#todo[@]})) || { log "ok: $img already on $*"; return 0; }
  log "loading $img into ${todo[*]}"
  kind load docker-image --name "$CLUSTER_NAME" --nodes "$(IFS=,; echo "${todo[*]}")" "$img" >/dev/null || die "kind load $img failed"
}

# load_workloads <node...>: pull each locked image BY DIGEST inside the node's containerd
# (linux/amd64 only, same as the VM images), name it by tag and mark it CRI-managed.
load_workloads() {
  local node ref tagged bydigest digest have n=0
  for node in "$@"; do
    while read -r ref; do
      tagged=${ref%@*}; digest=${ref#*@}; bydigest=${tagged%:*}@$digest
      have=$(docker exec "$node" ctr -n k8s.io images ls "name==$tagged" 2>/dev/null | awk 'NR>1{print $3}')
      [[ $have == "$digest" ]] && continue
      docker exec "$node" ctr -n k8s.io images pull --platform linux/amd64 "$bydigest" >/dev/null \
        || die "pull $bydigest on $node failed"
      docker exec "$node" ctr -n k8s.io images tag --force "$bydigest" "$tagged" >/dev/null
      docker exec "$node" ctr -n k8s.io images label "$tagged" io.cri-containerd.image=managed >/dev/null
      n=$((n + 1))
    done < <(grep -v '^#' "$HERE/lock/workloads.lock" | grep .)
  done
  log "ok: workload images on $* ($n pulled)"
}

targets=("$@"); ((${#targets[@]})) || targets=(kubeadm-node kubeadm-upgrade etcd-host jumphost workloads)
for t in "${targets[@]}"; do
  case $t in
    kubeadm-node)    [[ -n $VM_NODES ]] || die "no node advertises devices.kubevirt.io/kvm"
                     # shellcheck disable=SC2086
                     load_docker_image "${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION}" $VM_NODES ;;
    kubeadm-upgrade) # shellcheck disable=SC2086
                     load_docker_image "${GOLDEN_IMAGE_REPO}:${UPGRADE_IMAGE_TAG}" $VM_NODES ;;
    etcd-host)       # shellcheck disable=SC2086
                     load_docker_image "$ETCD_HOST_IMAGE" $VM_NODES ;;
    jumphost)        # shellcheck disable=SC2086
                     load_docker_image "$JUMPHOST_IMAGE" $ALL_NODES ;;
    linux-pod-el)    # shellcheck disable=SC2086
                     load_docker_image "$LINUX_POD_EL_IMAGE" $ALL_NODES ;;
    linux-pod-deb)   # shellcheck disable=SC2086
                     load_docker_image "$LINUX_POD_DEB_IMAGE" $ALL_NODES ;;
    kubeadm-full)    # shellcheck disable=SC2086
                     load_docker_image "${GOLDEN_IMAGE_REPO}:${KUBEADM_FULL_IMAGE_TAG}" $VM_NODES ;;
    el-vm)           # shellcheck disable=SC2086
                     load_docker_image "$EL_VM_IMAGE" $VM_NODES ;;
    ubuntu-vm)       # shellcheck disable=SC2086
                     load_docker_image "$UBUNTU_VM_IMAGE" $VM_NODES ;;
    docker-vm)       # shellcheck disable=SC2086
                     load_docker_image "$DOCKER_VM_IMAGE" $VM_NODES ;;
    mirror)          # shellcheck disable=SC2086
                     load_docker_image "$MIRROR_CONTENT_IMAGE" $ALL_NODES ;;
    workloads)       # shellcheck disable=SC2086
                     load_workloads $ALL_NODES ;;
    iac-ws-terraform) # shellcheck disable=SC2086
                     load_docker_image "${IAC_WS_IMAGE_REPO}:1.15-terraform" $ALL_NODES ;;
    iac-ws-tofu)     # shellcheck disable=SC2086
                     load_docker_image "${IAC_WS_IMAGE_REPO}:1.15-tofu" $ALL_NODES ;;
    *) die "unknown image '$t' (kubeadm-node | kubeadm-upgrade | kubeadm-full | etcd-host | jumphost | workloads | linux-pod-el | linux-pod-deb | el-vm | ubuntu-vm | docker-vm | mirror | iac-ws-terraform | iac-ws-tofu)" ;;
  esac
done
