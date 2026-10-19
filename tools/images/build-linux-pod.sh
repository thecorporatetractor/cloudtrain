#!/usr/bin/env bash
# Build the Linux learner pod images and load them into kind (LOAD_INTO_KIND=1):
#   el      ${LINUX_POD_EL_IMAGE}   catalog el-lab:10      tier A, AlmaLinux 10 userland
#   deb     ${LINUX_POD_DEB_IMAGE}  catalog deb-lab:24.04  tier A, Ubuntu 24.04 userland (unminimized)
#   el-sys  ${EL_SYS_IMAGE}         catalog el-sys:10      tier B: el-lab + systemd as PID 1 (Kata only)
#   deb-sys ${DEB_SYS_IMAGE}        catalog deb-sys:24.04  tier B: deb-lab + systemd as PID 1 (Kata only)
# The tier-B images are layered on the tier-A ones (built first when missing) and carry the
# lab guest kernel's modules.builtin (tools/images/kata-kernel, release <version>-ct<rev>).
# Usage: build-linux-pod.sh [el|deb|el-sys|deb-sys ...]   (default: el deb)
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
MIRROR_URL="http://mirror.${MIRROR_NAMESPACE}.svc"
KEY="$REPO_ROOT/tools/mirrors/keys/cloudtrain-mirror.asc"
[[ -s $KEY ]] || die "missing $KEY (run: task mirror:content)"

build_one() {
  local fam=$1 tag ref
  case $fam in
    el)  tag=$LINUX_POD_EL_IMAGE;  ref=el-lab:10 ;;
    deb) tag=$LINUX_POD_DEB_IMAGE; ref=deb-lab:24.04 ;;
    el-sys | deb-sys) build_sys "$fam"; return ;;
    *) die "unknown family '$fam' (el | deb | el-sys | deb-sys)" ;;
  esac
  [[ $(yq -r ".images[\"$ref\"].image" "$CATALOG") == "$tag" ]] || die "catalog $ref.image does not match $tag"
  local ctx; ctx=$(mktemp -d)
  cp -r "$HERE/linux-pod/common" "$ctx/"; cp "$HERE/linux-pod/$fam/Dockerfile" "$ctx/"; cp "$KEY" "$ctx/common/"
  local ctxargs=()
  if [[ $fam == deb ]]; then
    local noble="$REPO_ROOT/tools/images/.cache/mirror/$MIRROR_SNAPSHOT/noble"
    [[ -f $noble/InRelease ]] || die "no noble mirror in $noble (run: task mirror:content WHAT=noble)"
    ctxargs=(--build-context "noble=$noble")
  fi
  log "building $tag ($ref)"
  local old; old=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
  docker build -q -t "$tag" --label "dev.cloudtrain.catalog-ref=$ref" \
    --build-arg ALMA_BASE_IMAGE="$ALMA_BASE_IMAGE" --build-arg ALMA_REPO="$ALMA_REPO" \
    --build-arg UBUNTU_BASE_IMAGE="$UBUNTU_BASE_IMAGE" --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" \
    --build-arg TINI_VERSION="$TINI_VERSION" --build-arg TINI_STATIC_SHA256="$TINI_STATIC_SHA256" \
    --build-arg MIRROR_URL="$MIRROR_URL" "${ctxargs[@]}" "$ctx" >/dev/null
  rm -rf "$ctx"
  # Remove the superseded image (now dangling) so rebuilds do not pile up on disk.
  local new; new=$(docker image inspect -f '{{.Id}}' "$tag")
  [[ -n $old && $old != "$new" ]] && docker rmi "$old" >/dev/null 2>&1 || true
  docker images "$tag" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
  if [[ ${LOAD_INTO_KIND:-1} == 1 ]] && cluster_exists; then bash "$HERE/load.sh" "linux-pod-$fam"; fi
}
# build_sys <el-sys|deb-sys>: the tier-B systemd image on top of the tier-A image.
build_sys() {
  local fam=$1 base tag ref
  case $fam in
    el-sys)  base=$LINUX_POD_EL_IMAGE;  tag=$EL_SYS_IMAGE;  ref=el-sys:10 ;;
    deb-sys) base=$LINUX_POD_DEB_IMAGE; tag=$DEB_SYS_IMAGE; ref=deb-sys:24.04 ;;
  esac
  [[ $(yq -r ".images[\"$ref\"].image" "$CATALOG") == "$tag" ]] || die "catalog $ref.image does not match $tag"
  docker image inspect "$base" >/dev/null 2>&1 || build_one "${fam%-sys}"
  local ctx; ctx=$(mktemp -d)
  cp -r "$HERE/linux-pod/sys" "$ctx/"; cp "$HERE/linux-pod/sys/${fam%-sys}/Dockerfile" "$ctx/"
  log "building $tag ($ref, on $base)"
  local old; old=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
  docker build -q -t "$tag" --label "dev.cloudtrain.catalog-ref=$ref" \
    --build-arg BASE_IMAGE="$base" --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" \
    --build-arg ALMA_REPO="$ALMA_REPO" --build-arg KATA_LAB_RELEASE="$KATA_LAB_KERNEL_VERSION-ct$KATA_LAB_KERNEL_REV" \
    --build-context "kernel=$HERE/kata-kernel" "$ctx" >/dev/null
  rm -rf "$ctx"
  local new; new=$(docker image inspect -f '{{.Id}}' "$tag")
  [[ -n $old && $old != "$new" ]] && docker rmi "$old" >/dev/null 2>&1 || true
  docker images "$tag" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
  if [[ ${LOAD_INTO_KIND:-1} == 1 ]] && cluster_exists; then bash "$HERE/load.sh" "linux-pod-$fam"; fi
}

targets=("$@"); ((${#targets[@]})) || targets=(el deb)
for t in "${targets[@]}"; do build_one "$t"; done
