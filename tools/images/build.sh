#!/usr/bin/env bash
# Golden image pipeline: Ubuntu 24.04 cloud image -> kubeadm node image -> containerDisk.
#
#   1. fetch + verify the pinned Ubuntu cloud image
#   2. resolve the kubeadm control-plane + CNI image list for the pinned versions
#   3. virt-customize (in a container, KVM-accelerated): containerd, kubeadm/kubelet/kubectl,
#      kernel/sysctl prerequisites, and the images pulled into containerd's k8s.io store
#   4. sparsify + compress, wrap as a KubeVirt containerDisk image
#   5. optionally `kind load` it into the dev cluster
#
# Output: docker image ${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION} and .cache/out/disk.qcow2
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need curl

HERE="$REPO_ROOT/tools/images"
CACHE="$HERE/.cache"
OUT="$CACHE/out"
mkdir -p "$CACHE" "$OUT"
TAG="${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION}"
T0=$SECONDS

# --- 1. base image -------------------------------------------------------------
BASE="$CACHE/ubuntu-${UBUNTU_RELEASE}-${UBUNTU_SERIAL}-amd64.img"
if ! echo "${UBUNTU_IMAGE_SHA256}  $BASE" | sha256sum -c --status 2>/dev/null; then
  log "downloading Ubuntu ${UBUNTU_RELEASE} cloud image ${UBUNTU_SERIAL}"
  curl -fSL --retry 3 -o "$BASE" \
    "https://cloud-images.ubuntu.com/releases/${UBUNTU_RELEASE}/release-${UBUNTU_SERIAL}/ubuntu-24.04-server-cloudimg-amd64.img"
  echo "${UBUNTU_IMAGE_SHA256}  $BASE" | sha256sum -c - || die "checksum mismatch for $BASE"
fi

# --- 2. image list + pre-pull ---------------------------------------------------
KUBEADM_BIN="$CACHE/kubeadm-${LAB_K8S_VERSION}"
if [[ ! -x $KUBEADM_BIN ]]; then
  curl -fsSL -o "$KUBEADM_BIN" "https://dl.k8s.io/release/${LAB_K8S_VERSION}/bin/linux/amd64/kubeadm"
  echo "$(curl -fsSL "https://dl.k8s.io/release/${LAB_K8S_VERSION}/bin/linux/amd64/kubeadm.sha256")  $KUBEADM_BIN" | sha256sum -c - >/dev/null
  chmod +x "$KUBEADM_BIN"
fi
FLANNEL_YAML="$CACHE/kube-flannel-${FLANNEL_VERSION}.yml"
[[ -s $FLANNEL_YAML ]] || curl -fsSL -o "$FLANNEL_YAML" \
  "https://github.com/flannel-io/flannel/releases/download/${FLANNEL_VERSION}/kube-flannel.yml"

mapfile -t IMAGES < <(
  "$KUBEADM_BIN" config images list --kubernetes-version "$LAB_K8S_VERSION" 2>/dev/null
  grep -oE 'image: *[^ ]+' "$FLANNEL_YAML" | awk '{print $2}' | sort -u
)
PAUSE_IMAGE=$(printf '%s\n' "${IMAGES[@]}" | grep '/pause:')
# The images are pulled INSIDE the guest by containerd (ctr pull, linux/amd64 only)
# rather than `docker save`d here: Docker 27 with the containerd image store
# saves multi-arch indexes without the other platforms' blobs, and
# `ctr images import` then fails with "content digest ... not found".
printf '%s\n' "${IMAGES[@]}" > "$CACHE/images.txt"
log "images to pre-load: ${IMAGES[*]}"

# --- 3. customize -----------------------------------------------------------------
# Builder tag = hash of its Dockerfile, so edits rebuild it automatically.
BUILDER="cloudtrain/image-builder:$(sha256sum "$HERE/builder/Dockerfile" | cut -c1-12)"
docker image inspect "$BUILDER" >/dev/null 2>&1 || {
  log "building image-builder container $BUILDER"
  docker build -q -t "$BUILDER" "$HERE/builder" >/dev/null
}
cat > "$CACHE/build.env" <<EOF
LAB_K8S_MINOR=${LAB_K8S_MINOR}
LAB_K8S_VERSION=${LAB_K8S_VERSION}
PAUSE_IMAGE=${PAUSE_IMAGE}
FLANNEL_VERSION=${FLANNEL_VERSION}
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_REV=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
EOF
log "customizing image (virt-customize, KVM)"
docker run --rm --device /dev/kvm \
  -v "$HERE:/src:ro" -v "$CACHE:/work" -e TMPDIR=/work/tmp \
  -e BASE="/work/$(basename "$BASE")" -e FLANNEL_YAML="/work/$(basename "$FLANNEL_YAML")" \
  "$BUILDER" bash /src/scripts/customize.sh

# --- 4. containerDisk -----------------------------------------------------------
log "packaging containerDisk $TAG"
docker build -q -t "$TAG" -f "$HERE/containerdisk/Dockerfile" \
  --label "org.opencontainers.image.version=${LAB_K8S_VERSION}" \
  --label "dev.cloudtrain.base=ubuntu-${UBUNTU_RELEASE}-${UBUNTU_SERIAL}" "$OUT" >/dev/null
docker images "$TAG" --format '{{.Repository}}:{{.Tag}}  {{.Size}}'
log "image:build done in $((SECONDS - T0))s"

# --- 5. load into kind -----------------------------------------------------------
if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
  log "loading $TAG into kind cluster $CLUSTER_NAME"
  kind load docker-image --name "$CLUSTER_NAME" "$TAG"
fi
