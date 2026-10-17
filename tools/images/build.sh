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
#   el-vm            ${EL_VM_IMAGE}                                 catalog el-vm:10
#                    (AlmaLinux ${ALMA_RELEASE} GenericCloud + local dnf repo from the mirror
#                    snapshot, SELinux enforcing, firewalld)
#   ubuntu-vm        ${UBUNTU_VM_IMAGE}                             catalog ubuntu-vm:24.04
#                    (Ubuntu cloud image + local signed apt repo from the mirror snapshot)
#   kubeadm-full     ${GOLDEN_IMAGE_REPO}:${KUBEADM_FULL_IMAGE_TAG}  catalog kubeadm:1.37-full (+ -sec)
#                    LAYERED on the kubeadm-node containerDisk (must exist): add-ons for
#                    /opt/cloudtrain/bin/addons-install + images, gVisor, kube-bench, AppArmor
#                    profiles, audit policies (tools/images/kubeadm-addons)
#   el-vm/ubuntu-vm need the mirror content: tools/mirrors/build-content.sh (task mirror:content)
#
# Steps:
#   1. fetch + verify the pinned Ubuntu cloud image
#   2. resolve the image lists (kubeadm control plane per K8s version, Calico, the
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
  kubeadm-full)
    TAG="${GOLDEN_IMAGE_REPO}:${KUBEADM_FULL_IMAGE_TAG}"; REF=kubeadm:1.37-full; GUEST=kubeadm-addons; DISK_SIZE=12G
    K8S_VERSION=$LAB_K8S_VERSION; STAGED_VERSION="" ;;
  el-vm)
    TAG="$EL_VM_IMAGE"; REF=el-vm:10; GUEST=el-vm; DISK_SIZE=10G ;;
  ubuntu-vm)
    TAG="$UBUNTU_VM_IMAGE"; REF=ubuntu-vm:24.04; GUEST=ubuntu-vm; DISK_SIZE=10G ;;
  *) die "unknown variant '$VARIANT' (kubeadm-node | kubeadm-upgrade | etcd-host | el-vm | ubuntu-vm)" ;;
esac

# --- 0. catalog contract: the catalog must name exactly what this build produces ---
cat_get() { yq -r ".images[\"$REF\"].$1 // \"\"" "$CATALOG"; }
[[ $(cat_get image) == "$TAG" ]] || die "catalog $REF.image is '$(cat_get image)', this build produces '$TAG'"
if [[ $GUEST == kubeadm || $GUEST == kubeadm-addons ]]; then
  [[ $(cat_get kubernetesVersion) == "$K8S_VERSION" ]] \
    || die "catalog $REF.kubernetesVersion is '$(cat_get kubernetesVersion)', expected $K8S_VERSION"
  [[ -z $STAGED_VERSION ]] || yq -e ".images[\"$REF\"].stagedUpgrades[] | select(. == \"$STAGED_VERSION\")" "$CATALOG" >/dev/null \
    || die "catalog $REF.stagedUpgrades does not list $STAGED_VERSION"
elif [[ $GUEST == etcd-host ]]; then
  [[ $(cat_get etcdVersion) == "$ETCD_VERSION" ]] || die "catalog $REF.etcdVersion is '$(cat_get etcdVersion)', expected $ETCD_VERSION"
fi

# --- 1. base image -------------------------------------------------------------
BASE="$CACHE/ubuntu-${UBUNTU_RELEASE}-${UBUNTU_SERIAL}-amd64.img"
BASE_LABEL="ubuntu-${UBUNTU_RELEASE}-${UBUNTU_SERIAL}"
if [[ $GUEST == kubeadm-addons ]]; then
  # Layered build: start from the kubeadm:1.37 disk inside its containerDisk image.
  KBASE="${GOLDEN_IMAGE_REPO}:${LAB_K8S_VERSION}"
  docker image inspect "$KBASE" >/dev/null 2>&1 || die "$KBASE not built (run: task image:build:kubeadm-node)"
  BASE="$WORK/base.qcow2"; BASE_LABEL="${KBASE##*/}"
  if [[ ${PACKAGE_ONLY:-0} != 1 && ${LOCK_ONLY:-0} != 1 ]]; then
    cid=$(docker create "$KBASE" sh); docker cp "$cid:/disk/disk.qcow2" "$BASE"; docker rm "$cid" >/dev/null
  fi
elif [[ $GUEST == el-vm ]]; then
  BASE="$CACHE/$ALMA_CLOUD_IMAGE"; BASE_LABEL="${ALMA_CLOUD_IMAGE%.x86_64.qcow2}"
  if ! echo "${ALMA_CLOUD_IMAGE_SHA256}  $BASE" | sha256sum -c --status 2>/dev/null; then
    log "downloading $ALMA_CLOUD_IMAGE"
    curl -fSL --retry 3 -o "$BASE" "https://repo.almalinux.org/almalinux/10/cloud/x86_64/images/$ALMA_CLOUD_IMAGE" \
      || curl -fSL --retry 3 -o "$BASE" "https://vault.almalinux.org/${ALMA_RELEASE}/cloud/x86_64/images/$ALMA_CLOUD_IMAGE"
    echo "${ALMA_CLOUD_IMAGE_SHA256}  $BASE" | sha256sum -c - || die "checksum mismatch for $BASE"
  fi
elif ! echo "${UBUNTU_IMAGE_SHA256}  $BASE" | sha256sum -c --status 2>/dev/null; then
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
  # Calico (enforces NetworkPolicy). Upstream calico-vxlan.yaml, sha256-checked, then two
  # edits: the IPv4 pool is the kubeadm podSubnet (the default 192.168.0.0/16 overlaps the
  # lab VPC) and VXLAN is Always (pod traffic never leaves a VM unencapsulated, like
  # Flannel before it, so the lab network never sees pod IPs).
  CALICO_UPSTREAM="$CACHE/calico-vxlan-${CALICO_VERSION}.yaml"
  fetch_pinned "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/calico-vxlan.yaml" \
    "$CALICO_MANIFEST_SHA256" "$CALICO_UPSTREAM"
  CALICO_YAML="$WORK/in/calico.yaml"
  sed -e 's|^            # - name: CALICO_IPV4POOL_CIDR|            - name: CALICO_IPV4POOL_CIDR|' \
      -e 's|^            #   value: "192.168.0.0/16"|              value: "'"$LAB_POD_CIDR"'"|' \
      -e '/name: CALICO_IPV4POOL_VXLAN$/{n;s|value: "CrossSubnet"|value: "Always"|}' \
      "$CALICO_UPSTREAM" > "$CALICO_YAML"
  grep -A1 'name: CALICO_IPV4POOL_CIDR$' "$CALICO_YAML" | grep -q "value: \"$LAB_POD_CIDR\"" \
    || die "could not set CALICO_IPV4POOL_CIDR in $CALICO_YAML"
  grep -A1 'name: CALICO_IPV4POOL_VXLAN$' "$CALICO_YAML" | grep -q 'value: "Always"' \
    || die "could not set CALICO_IPV4POOL_VXLAN in $CALICO_YAML"
  mapfile -t CALICO_IMAGES < <(grep -oE 'image: *[^ ]+' "$CALICO_YAML" | awk '{print $2}' | tr -d '"' | sort -u)
  printf '%s\n' "${CALICO_IMAGES[@]}" | grep -q '/calico/node:' || die "no calico/node image in $CALICO_YAML"
  lock_check "$LOCKDIR/calico.lock" "${CALICO_IMAGES[@]}"
  cp "$HERE/kubeadm-node/cni-install" "$WORK/in/cni-install"
  kubeadm_images "$K8S_VERSION"
  lock_check "$LOCKDIR/kubernetes-$K8S_VERSION.lock" "${KIMAGES[@]}"
  PAUSE_IMAGE=$(printf '%s\n' "${KIMAGES[@]}" | grep '/pause:')
  if [[ -n $STAGED_VERSION ]]; then
    kubeadm_images "$STAGED_VERSION"
    lock_check "$LOCKDIR/kubernetes-$STAGED_VERSION.lock" "${KIMAGES[@]}"
  fi
elif [[ $GUEST == etcd-host ]]; then
  ETCD_TGZ="$CACHE/etcd-${ETCD_VERSION}-linux-amd64.tar.gz"
  fetch_pinned "https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-amd64.tar.gz" \
    "$ETCD_TARBALL_SHA256" "$ETCD_TGZ"
  cp "$ETCD_TGZ" "$WORK/in/etcd.tar.gz"
  cp -r "$HERE/etcd-host/." "$WORK/in/"
fi
if [[ $GUEST == kubeadm-addons ]]; then
  A="$HERE/kubeadm-addons"; IN="$WORK/in"; rm -rf "$IN/addons"; mkdir -p "$IN/addons"/{metrics-server,gateway-api,traefik,metallb,local-path,falco}
  fetch_pinned "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml" \
    "$METRICS_SERVER_MANIFEST_SHA256" "$CACHE/metrics-server-${METRICS_SERVER_VERSION}.yaml"
  # lab kubelets serve self-signed certificates
  sed 's|        - --metric-resolution=15s|        - --metric-resolution=15s\n        - --kubelet-insecure-tls|' \
    "$CACHE/metrics-server-${METRICS_SERVER_VERSION}.yaml" > "$IN/addons/metrics-server/components.yaml"
  grep -q -- '--kubelet-insecure-tls' "$IN/addons/metrics-server/components.yaml" || die "could not patch metrics-server args"
  fetch_pinned "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml" \
    "$GATEWAY_API_MANIFEST_SHA256" "$IN/addons/gateway-api/standard-install.yaml"
  fetch_pinned "https://raw.githubusercontent.com/metallb/metallb/${METALLB_VERSION}/config/manifests/metallb-native.yaml" \
    "$METALLB_MANIFEST_SHA256" "$IN/addons/metallb/metallb-native.yaml"
  fetch_pinned "https://raw.githubusercontent.com/rancher/local-path-provisioner/${LOCAL_PATH_VERSION}/deploy/local-path-storage.yaml" \
    "$LOCAL_PATH_MANIFEST_SHA256" "$CACHE/local-path-${LOCAL_PATH_VERSION}.yaml"
  # default StorageClass; helper pod uses the preloaded busybox:1.37
  sed -e 's|image: docker.io/library/busybox$|image: docker.io/library/busybox:1.37|' \
      -e 's|^  name: local-path$|  name: local-path\n  annotations: { storageclass.kubernetes.io/is-default-class: "true" }|' \
    "$CACHE/local-path-${LOCAL_PATH_VERSION}.yaml" > "$IN/addons/local-path/local-path-storage.yaml"
  grep -q 'busybox:1.37' "$IN/addons/local-path/local-path-storage.yaml" || die "could not pin the local-path helper image"
  cp "$A/manifests/traefik.yaml" "$A/manifests/traefik-crds.yaml" "$IN/addons/traefik/"
  cp "$A/falco.yaml" "$IN/addons/falco/falco.yaml"
  cp "$A/addons-install" "$IN/"; rm -rf "$IN/security"; cp -r "$A/security" "$IN/security"
  fetch_pinned "https://github.com/google/gvisor/releases/download/${GVISOR_RELEASE}/gvisor-x86_64.tar.bz2" \
    "$GVISOR_TARBALL_SHA256" "$CACHE/gvisor-${GVISOR_RELEASE}.tar.bz2"
  # the guest has no bzip2: unpack here. runsc (since the 2026 releases) also needs its
  # sidecars in gvisor-bin/ next to it (gvisor_sentry, ...; sidecar policy STRICT), else
  # every sandbox fails with 'sidecar "gvisor_sentry" not usable'.
  rm -rf "$IN/gvisor"; mkdir -p "$IN/gvisor"
  tar -xjf "$CACHE/gvisor-${GVISOR_RELEASE}.tar.bz2" -C "$IN/gvisor" runsc containerd-shim-runsc-v1 gvisor-bin
  fetch_pinned "https://github.com/aquasecurity/kube-bench/releases/download/${KUBE_BENCH_VERSION}/kube-bench_${KUBE_BENCH_VERSION#v}_linux_amd64.tar.gz" \
    "$KUBE_BENCH_TARBALL_SHA256" "$IN/kube-bench.tar.gz"
  # every image the add-on manifests reference must be in lock/addons.lock (exactly)
  mapfile -t AIMG < <(grep -rhoE 'image: *"?[a-z0-9.-]+(/[a-zA-Z0-9._-]+)+:[a-zA-Z0-9._-]+' "$IN/addons" | awk '{print $2}' | tr -d '"' \
    | grep -v 'busybox:1.37' | while read -r i; do normalize "$i"; done | sort -u)
  lock_check "$LOCKDIR/addons.lock" "${AIMG[@]}"
  grep -v '^#' "$LOCKDIR/addons.lock" | grep . > "$IN/addon-images.txt"
fi
if [[ $GUEST == el-vm || $GUEST == ubuntu-vm ]]; then
  MIRROR="$CACHE/mirror/$MIRROR_SNAPSHOT"
  repo=$([[ $GUEST == el-vm ]] && echo el10 || echo noble)
  [[ -f $MIRROR/$repo/${repo}.lock ]] || die "no mirror content $MIRROR/$repo (run: task mirror:content)"
  rm -rf "$WORK/in/repo"; mkdir -p "$WORK/in/repo"
  cp -al "$MIRROR/$repo" "$WORK/in/repo/$repo" 2>/dev/null || cp -a "$MIRROR/$repo" "$WORK/in/repo/$repo"
  rm -f "$WORK/in/repo/$repo/.wanted" "$WORK/in/repo/$repo/.missing"
  cp "$REPO_ROOT/tools/mirrors/keys/cloudtrain-mirror.asc" "$WORK/in/"
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
# PACKAGE_ONLY=1 reuses an existing $WORK/out/disk.qcow2 and only re-runs step 4 (e.g.
# after the containerDisk `docker build` failed; virt-customize under TCG takes 10-40 min).
if [[ ${PACKAGE_ONLY:-0} == 1 ]]; then
  [[ -s $WORK/out/disk.qcow2 ]] || die "PACKAGE_ONLY=1 but $WORK/out/disk.qcow2 does not exist"
  log "PACKAGE_ONLY=1: reusing $WORK/out/disk.qcow2 ($(date -r "$WORK/out/disk.qcow2" '+%F %T'))"
else
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
CALICO_VERSION=${CALICO_VERSION}
LAB_POD_CIDR=${LAB_POD_CIDR}
STAGED_CRI_TOOLS_VERSION=${CRI_TOOLS_VERSION}
ALMA_RELEASE=${ALMA_RELEASE}
MIRROR_SNAPSHOT=${MIRROR_SNAPSHOT}
ETCD_VERSION=${ETCD_VERSION}
GVISOR_RELEASE=${GVISOR_RELEASE}
KUBE_BENCH_VERSION=${KUBE_BENCH_VERSION}
CONTAINERD_VERSION=${CONTAINERD_VERSION}
KUBERNETES_CNI_VERSION=${KUBERNETES_CNI_VERSION}
UBUNTU_APT_SNAPSHOT=${UBUNTU_APT_SNAPSHOT}
DOCKER_APT_KEY_FPR=${DOCKER_APT_KEY_FPR}
K8S_APT_KEY_FPR=${K8S_APT_KEY_FPR}
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_REV=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
EOF
# libguestfs runs its appliance under TCG (software emulation) by default: on the WSL2
# reference machine, nested KVM inside the appliance (docker --device /dev/kvm -> WSL2
# -> Hyper-V) crashed WSL several times and once blue-screened Windows (bugcheck 0x7f,
# double fault). GUESTFS_KVM=1 re-enables KVM where nested virt is known to be stable.
# The appliance gets at most 2 GiB and the builder container at most 6 GiB.
GUESTFS_ARGS=(-e LIBGUESTFS_BACKEND=direct -e LIBGUESTFS_MEMSIZE=2048 -e GUESTFS_VERBOSE="${GUESTFS_VERBOSE:-0}")
if [[ ${GUESTFS_KVM:-0} == 1 ]]; then GUESTFS_ARGS+=(--device /dev/kvm -e GUESTFS_SMP=4)
else GUESTFS_ARGS+=(-e LIBGUESTFS_BACKEND_SETTINGS=force_tcg -e GUESTFS_SMP="${GUESTFS_SMP:-2}"); fi
log "customizing $VARIANT (virt-customize, $([[ ${GUESTFS_KVM:-0} == 1 ]] && echo KVM || echo 'TCG; GUESTFS_KVM=1 for KVM'))"
docker run --rm --memory 6g "${GUESTFS_ARGS[@]}" \
  -v "$HERE:/src:ro" -v "$CACHE:/work" -e TMPDIR="/work/$VARIANT/tmp" \
  -e BASE="/work/${BASE#"$CACHE"/}" -e VARIANT_DIR="/work/$VARIANT" \
  -e GUEST_SCRIPT="guest-$GUEST.sh" -e DISK_SIZE="$DISK_SIZE" \
  "$BUILDER" bash /src/scripts/customize.sh
fi

# --- 4. containerDisk -----------------------------------------------------------
log "packaging containerDisk $TAG"
docker build -q -t "$TAG" -f "$HERE/containerdisk/Dockerfile" \
  --label "org.opencontainers.image.version=${TAG##*:}" \
  --label "dev.cloudtrain.catalog-ref=${REF}" \
  --label "dev.cloudtrain.base=${BASE_LABEL}" "$WORK/out" >/dev/null
docker images "$TAG" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
# Disk hygiene (the host disk is small): drop the build inputs; CLEAN_DISK=1 also drops the
# customized disk (then PACKAGE_ONLY=1 is no longer possible). Both are root-owned.
docker run --rm -u 0 -v "$WORK:/w" --entrypoint sh "$UBUNTU_BASE_IMAGE" -c \
  "rm -rf /w/in /w/tmp /w/base.qcow2 $([[ ${CLEAN_DISK:-1} == 1 ]] && echo /w/out/disk.qcow2)" 2>/dev/null || true
log "image:build:$VARIANT done in $((SECONDS - T0))s"

# --- 5. load into kind -----------------------------------------------------------
if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
  bash "$HERE/load.sh" "$VARIANT"
fi
