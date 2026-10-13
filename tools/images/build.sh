#!/usr/bin/env bash
# VM image pipeline: Ubuntu 24.04 cloud image -> customized lab VM -> KubeVirt containerDisk.
#
# Usage: build.sh <variant>          (default: kubeadm-node)
#
#   kubeadm-node     cloudtrain/kubeadm-node:${LAB_K8S_VERSION}     catalog kubeadm:1.37
#   kubeadm-upgrade  cloudtrain/kubeadm-node:${UPGRADE_IMAGE_TAG}   catalog kubeadm:1.36
#                    (UPGRADE_K8S_VERSION installed + held; LAB_K8S_VERSION debs in a local
#                    signed apt repo and its control-plane images in containerd)
#   etcd-host        ${ETCD_HOST_IMAGE}                             catalog etcd-host:3.6
#
# Steps:
#   1. fetch + verify the pinned Ubuntu cloud image
#   2. resolve the image lists (kubeadm control plane per K8s version, Flannel, the
#      catalog's workloadImages) and check them against tools/images/lock/*.lock
#   3. virt-customize (in a container, KVM-accelerated) with scripts/guest-<kind>.sh
#   4. sparsify + compress, wrap as a KubeVirt containerDisk image
#   5. optionally `kind load` it into the dev cluster (LOAD_INTO_KIND=1)
#
# Env: UPDATE_LOCK=1 re-resolves digests into the lock files; LOCK_ONLY=1 stops after
# step 2 (with UPDATE_LOCK=1 that is `task image:lock`).
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need curl; need jq; need yq

VARIANT=${1:-kubeadm-node}
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
LOCKDIR="$HERE/lock"
CACHE="$HERE/.cache"            # shared downloads (base image, kubeadm binaries, tarballs)
WORK="$CACHE/$VARIANT"          # per-variant inputs/outputs, so variants build in parallel
mkdir -p "$CACHE" "$WORK/in" "$WORK/out"
T0=$SECONDS

case $VARIANT in
  kubeadm-node)
    TAG="${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION}"; REF=kubeadm:1.37; GUEST=kubeadm; DISK_SIZE=10G
    K8S_MINOR=$LAB_K8S_MINOR; K8S_VERSION=$LAB_K8S_VERSION; K8S_CRI_TOOLS=$CRI_TOOLS_VERSION
    STAGED_MINOR=""; STAGED_VERSION="" ;;
  kubeadm-upgrade)
    TAG="${GOLDEN_IMAGE_REPO}:${UPGRADE_IMAGE_TAG}"; REF=kubeadm:1.36; GUEST=kubeadm; DISK_SIZE=10G
    K8S_MINOR=$UPGRADE_K8S_MINOR; K8S_VERSION=$UPGRADE_K8S_VERSION; K8S_CRI_TOOLS=$UPGRADE_CRI_TOOLS_VERSION
    STAGED_MINOR=$LAB_K8S_MINOR; STAGED_VERSION=$LAB_K8S_VERSION ;;
  etcd-host)
    TAG="$ETCD_HOST_IMAGE"; REF=etcd-host:3.6; GUEST=etcd-host; DISK_SIZE=4G ;;
  *) die "unknown variant '$VARIANT' (kubeadm-node | kubeadm-upgrade | etcd-host)" ;;
esac

# --- 0. catalog contract: the catalog must name exactly what this build produces ---
cat_get() { yq -r ".images[\"$REF\"].$1 // \"\"" "$CATALOG"; }
[[ $(cat_get image) == "$TAG" ]] || die "catalog $REF.image is '$(cat_get image)', this build produces '$TAG'"
if [[ $GUEST == kubeadm ]]; then
  [[ $(cat_get kubernetesVersion) == "$K8S_VERSION" ]] \
    || die "catalog $REF.kubernetesVersion is '$(cat_get kubernetesVersion)', expected $K8S_VERSION"
  [[ -z $STAGED_VERSION ]] || yq -e ".images[\"$REF\"].stagedUpgrades[] | select(. == \"$STAGED_VERSION\")" "$CATALOG" >/dev/null \
    || die "catalog $REF.stagedUpgrades does not list $STAGED_VERSION"
else
  [[ $(cat_get etcdVersion) == "$ETCD_VERSION" ]] || die "catalog $REF.etcdVersion is '$(cat_get etcdVersion)', expected $ETCD_VERSION"
fi

# --- 1. base image -------------------------------------------------------------
BASE="$CACHE/ubuntu-${UBUNTU_RELEASE}-${UBUNTU_SERIAL}-amd64.img"
if ! echo "${UBUNTU_IMAGE_SHA256}  $BASE" | sha256sum -c --status 2>/dev/null; then
  log "downloading Ubuntu ${UBUNTU_RELEASE} cloud image ${UBUNTU_SERIAL}"
  curl -fSL --retry 3 -o "$BASE" \
    "https://cloud-images.ubuntu.com/releases/${UBUNTU_RELEASE}/release-${UBUNTU_SERIAL}/ubuntu-24.04-server-cloudimg-amd64.img"
  echo "${UBUNTU_IMAGE_SHA256}  $BASE" | sha256sum -c - || die "checksum mismatch for $BASE"
fi

# --- 2. image lists, pinned by digest -------------------------------------------
# lock_check <lockfile> <name:tag...>: the lock must list exactly these names; with
# UPDATE_LOCK=1 their index digests are resolved again. Appends the locked lines to
# LOCKED. (Not run in a subshell, so `die` stops the build.)
LOCKED=()
lock_check() {
  local lock=$1; shift
  if [[ ${UPDATE_LOCK:-0} == 1 ]]; then
    log "resolving digests into ${lock#"$REPO_ROOT"/}"
    { sed -n '/^#/p' "$lock" 2>/dev/null
      for img in "$@"; do
        d=$(docker buildx imagetools inspect "$img" --format '{{json .Manifest}}' | jq -r .digest)
        [[ $d == sha256:* ]] || die "cannot resolve digest of $img"
        echo "$img@$d"
      done; } > "$lock.tmp" && mv "$lock.tmp" "$lock"
  fi
  [[ -f $lock ]] || die "missing $lock (run: task image:lock)"
  diff <(printf '%s\n' "$@" | sort) <(grep -v '^#' "$lock" | grep . | sed 's/@sha256:.*//' | sort) >&2 \
    || die "${lock#"$REPO_ROOT"/} does not match the pinned versions/catalog (run: task image:lock)"
  mapfile -t -O "${#LOCKED[@]}" LOCKED < <(grep -v '^#' "$lock" | grep .)
}

# kubeadm_images <version>: control-plane image list of that release (pinned kubeadm
# binary, sha256 from dl.k8s.io) into KIMAGES.
kubeadm_images() {
  local v=$1 bin="$CACHE/kubeadm-$1"
  if [[ ! -x $bin ]]; then
    curl -fsSL -o "$bin.tmp" "https://dl.k8s.io/release/$v/bin/linux/amd64/kubeadm"
    echo "$(curl -fsSL "https://dl.k8s.io/release/$v/bin/linux/amd64/kubeadm.sha256")  $bin.tmp" | sha256sum -c - >/dev/null \
      || die "kubeadm $v checksum mismatch"
    chmod +x "$bin.tmp" && mv "$bin.tmp" "$bin"
  fi
  local list; list=$("$bin" config images list --kubernetes-version "$v") || die "kubeadm $v config images list failed"
  for want in /kube-apiserver: /pause: /etcd: /coredns:; do
    grep -q -- "$want" <<<"$list" || die "kubeadm $v image list has no '$want' image"
  done
  mapfile -t KIMAGES <<<"$list"
}

# Workload images: catalog workloadImages, normalized to the name containerd stores
# (busybox:1.37 -> docker.io/library/busybox:1.37).
normalize() {
  local r=$1 first=${1%%/*}
  [[ $r == */* ]] || { echo "docker.io/library/$r"; return; }
  [[ $first == *.* || $first == *:* || $first == localhost ]] && echo "$r" || echo "docker.io/$r"
}
mapfile -t WORKLOADS < <(yq -r '.workloadImages[]' "$CATALOG" | while read -r i; do normalize "$i"; done)
((${#WORKLOADS[@]})) || die "catalog has no workloadImages"
lock_check "$LOCKDIR/workloads.lock" "${WORKLOADS[@]}"

if [[ $GUEST == kubeadm ]]; then
  FLANNEL_YAML="$CACHE/kube-flannel-${FLANNEL_VERSION}.yml"
  fetch_pinned "https://github.com/flannel-io/flannel/releases/download/${FLANNEL_VERSION}/kube-flannel.yml" \
    "$FLANNEL_MANIFEST_SHA256" "$FLANNEL_YAML"
  mapfile -t FLANNEL_IMAGES < <(grep -oE 'image: *[^ ]+' "$FLANNEL_YAML" | awk '{print $2}' | sort -u)
  printf '%s\n' "${FLANNEL_IMAGES[@]}" | grep -q 'flannel:' || die "no flannel image in $FLANNEL_YAML"
  lock_check "$LOCKDIR/flannel.lock" "${FLANNEL_IMAGES[@]}"
  kubeadm_images "$K8S_VERSION"
  lock_check "$LOCKDIR/kubernetes-$K8S_VERSION.lock" "${KIMAGES[@]}"
  PAUSE_IMAGE=$(printf '%s\n' "${KIMAGES[@]}" | grep '/pause:')
  if [[ -n $STAGED_VERSION ]]; then
    kubeadm_images "$STAGED_VERSION"
    lock_check "$LOCKDIR/kubernetes-$STAGED_VERSION.lock" "${KIMAGES[@]}"
  fi
  cp "$FLANNEL_YAML" "$WORK/in/kube-flannel.yml"
else
  ETCD_TGZ="$CACHE/etcd-${ETCD_VERSION}-linux-amd64.tar.gz"
  fetch_pinned "https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-amd64.tar.gz" \
    "$ETCD_TARBALL_SHA256" "$ETCD_TGZ"
  cp "$ETCD_TGZ" "$WORK/in/etcd.tar.gz"
  cp -r "$HERE/etcd-host/." "$WORK/in/"
fi
[[ ${LOCK_ONLY:-0} == 1 ]] && { log "lock files ok"; exit 0; }

# The images are pulled INSIDE the guest by containerd (ctr pull by digest, linux/amd64
# only) rather than `docker save`d here: Docker 27 with the containerd image store
# saves multi-arch indexes without the other platforms' blobs, and
# `ctr images import` then fails with "content digest ... not found".
if [[ $GUEST == kubeadm ]]; then
  printf '%s\n' "${LOCKED[@]}" | awk '!seen[$0]++' > "$WORK/in/images.txt"
  log "images to pre-load (by digest): $(sed 's/@.*//' "$WORK/in/images.txt" | tr '\n' ' ')"
fi

# --- 3. customize -----------------------------------------------------------------
# Builder tag = hash of its Dockerfile, so edits rebuild it automatically.
BUILDER="cloudtrain/image-builder:$( { cat "$HERE/builder/Dockerfile"; echo "$UBUNTU_APT_SNAPSHOT"; } | sha256sum | cut -c1-12)"
docker image inspect "$BUILDER" >/dev/null 2>&1 || {
  log "building image-builder container $BUILDER"
  docker build -q -t "$BUILDER" --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" "$HERE/builder" >/dev/null
}
cat > "$WORK/in/build.env" <<EOF
CLOUDTRAIN_IMAGE=${TAG%%:*}
CLOUDTRAIN_IMAGE_TAG=${TAG##*:}
CLOUDTRAIN_CATALOG_REF=${REF}
K8S_MINOR=${K8S_MINOR:-}
K8S_VERSION=${K8S_VERSION:-}
K8S_CRI_TOOLS_VERSION=${K8S_CRI_TOOLS:-}
STAGED_K8S_MINOR=${STAGED_MINOR:-}
STAGED_K8S_VERSION=${STAGED_VERSION:-}
PAUSE_IMAGE=${PAUSE_IMAGE:-}
FLANNEL_VERSION=${FLANNEL_VERSION}
ETCD_VERSION=${ETCD_VERSION}
CONTAINERD_VERSION=${CONTAINERD_VERSION}
KUBERNETES_CNI_VERSION=${KUBERNETES_CNI_VERSION}
UBUNTU_APT_SNAPSHOT=${UBUNTU_APT_SNAPSHOT}
DOCKER_APT_KEY_FPR=${DOCKER_APT_KEY_FPR}
K8S_APT_KEY_FPR=${K8S_APT_KEY_FPR}
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_REV=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
EOF
log "customizing $VARIANT (virt-customize, KVM)"
docker run --rm --device /dev/kvm \
  -v "$HERE:/src:ro" -v "$CACHE:/work" -e TMPDIR="/work/$VARIANT/tmp" \
  -e BASE="/work/$(basename "$BASE")" -e VARIANT_DIR="/work/$VARIANT" \
  -e GUEST_SCRIPT="guest-$GUEST.sh" -e DISK_SIZE="$DISK_SIZE" \
  "$BUILDER" bash /src/scripts/customize.sh

# --- 4. containerDisk -----------------------------------------------------------
log "packaging containerDisk $TAG"
docker build -q -t "$TAG" -f "$HERE/containerdisk/Dockerfile" \
  --label "org.opencontainers.image.version=${TAG##*:}" \
  --label "dev.cloudtrain.catalog-ref=${REF}" \
  --label "dev.cloudtrain.base=ubuntu-${UBUNTU_RELEASE}-${UBUNTU_SERIAL}" "$WORK/out" >/dev/null
docker images "$TAG" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
log "image:build:$VARIANT done in $((SECONDS - T0))s"

# --- 5. load into kind -----------------------------------------------------------
if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
  bash "$HERE/load.sh" "$VARIANT"
fi
