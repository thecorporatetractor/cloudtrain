#!/usr/bin/env bash
# Build the Kata lab guest kernel (docs/kata-spike.md, section 4.3): upstream Linux
# KATA_LAB_KERNEL_VERSION (tarball sha256-pinned), Kata's own config for that kernel
# (kata-config-<version>-<KATA_KERNEL_CONFIG_VERSION>, sha256-pinned) plus lab.config, all
# built in. Release (uname -r): <version>-ct<KATA_LAB_KERNEL_REV>.
#
# Reproducible: the toolchain is UBUNTU_BASE_IMAGE (by digest) with packages from
# UBUNTU_APT_SNAPSHOT, the tree is built at a fixed path with fixed KBUILD_BUILD_* values,
# so the same inputs give the same vmlinux on any x86_64 host (KATA_LAB_KERNEL_SHA256).
# Runs in a throwaway container: nothing is installed on the host. Heavy (5-15 min):
#   tools/slots/run.sh build -- tools/images/kata-kernel/build.sh
#
# Output in OUT (default tools/images/.cache/kata-kernel/<release>):
#   vmlinux          the guest kernel Cloud Hypervisor boots
#   config           the final .config
#   modules.builtin  what is built in (kmod format); must equal the committed copy
#   SHA256SUMS
# --check: also fail when vmlinux differs from KATA_LAB_KERNEL_SHA256 (when that is set).
# JOBS: make -j (default: nproc).
source "$(dirname "$0")/../../../deploy/scripts/lib.sh"
need docker
check=0
case ${1:-} in --check) check=1 ;; "") ;; *) die "usage: $0 [--check]" ;; esac

HERE="$REPO_ROOT/tools/images/kata-kernel"
V=$KATA_LAB_KERNEL_VERSION
RELEASE="$V-ct$KATA_LAB_KERNEL_REV"
BASE="kata-config-$V-$KATA_KERNEL_CONFIG_VERSION"
OUT=${OUT:-$REPO_ROOT/tools/images/.cache/kata-kernel/$RELEASE}
CACHE="$REPO_ROOT/tools/images/.cache/kata-kernel"

echo "$KATA_KERNEL_CONFIG_SHA256  $HERE/$BASE" | sha256sum -c --status \
  || die "$BASE does not match KATA_KERNEL_CONFIG_SHA256 (deploy/versions.env)"
fetch_pinned "https://cdn.kernel.org/pub/linux/kernel/v${V%%.*}.x/linux-$V.tar.xz" \
  "$KATA_LAB_KERNEL_TARBALL_SHA256" "$CACHE/linux-$V.tar.xz"

mkdir -p "$OUT"
log "building lab guest kernel $RELEASE -> $OUT"
docker run --rm \
  -e V="$V" -e RELEASE="$RELEASE" -e BASE="$BASE" -e REV="$KATA_LAB_KERNEL_REV" \
  -e UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" -e JOBS="${JOBS:-}" -e OWNER="$(id -u):$(id -g)" \
  -v "$CACHE/linux-$V.tar.xz:/in/linux.tar.xz:ro" -v "$HERE:/cfg:ro" -v "$OUT:/out" \
  "$UBUNTU_BASE_IMAGE" bash /cfg/build-in-container.sh

sum=$(sha256sum "$OUT/vmlinux" | cut -d' ' -f1)
log "vmlinux $RELEASE sha256 $sum"
cmp -s "$OUT/modules.builtin" "$HERE/modules.builtin" \
  || die "modules.builtin differs from tools/images/kata-kernel/modules.builtin: copy $OUT/modules.builtin there (and bump KATA_LAB_KERNEL_REV when lab.config changed)"
if [[ -n $KATA_LAB_KERNEL_SHA256 && $sum != "$KATA_LAB_KERNEL_SHA256" ]]; then
  ((check)) && die "vmlinux sha256 $sum != KATA_LAB_KERNEL_SHA256 $KATA_LAB_KERNEL_SHA256 (not reproducible, or the inputs changed without updating the pin)"
  warn "vmlinux sha256 differs from KATA_LAB_KERNEL_SHA256 ($KATA_LAB_KERNEL_SHA256)"
fi
