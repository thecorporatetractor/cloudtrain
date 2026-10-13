#!/usr/bin/env bash
# Runs INSIDE cloudtrain/image-builder (libguestfs). Inputs via env:
#   BASE          pinned Ubuntu cloud image (read only)
#   VARIANT_DIR   per-variant work dir: in/ (build inputs) and out/disk.qcow2 (result)
#   GUEST_SCRIPT  scripts/<name> run inside the guest
#   DISK_SIZE     virtual disk size of the result
set -euo pipefail
mkdir -p "$TMPDIR" "$VARIANT_DIR/out"
DISK="$TMPDIR/node.qcow2"

cp --sparse=always "$BASE" "$DISK"
# Grow the virtual disk so packages + pre-loaded images fit; the root partition
# is grown inside the guest (growpart) during customization. cloud-init's
# growpart grows it again to whatever size the VM disk has at boot.
qemu-img resize -q "$DISK" "$DISK_SIZE"

# Build inputs land in /opt/cloudtrain/build; the guest script moves what it keeps.
virt-customize -a "$DISK" --memsize "${LIBGUESTFS_MEMSIZE:-2048}" --smp 4 --network \
  --mkdir /opt/cloudtrain \
  --copy-in "$VARIANT_DIR/in:/opt/cloudtrain" \
  --run-command "mv /opt/cloudtrain/in /opt/cloudtrain/build" \
  --upload /src/scripts/guest-common.sh:/opt/cloudtrain/build/guest-common.sh \
  --upload "/src/scripts/$GUEST_SCRIPT:/opt/cloudtrain/build/$GUEST_SCRIPT" \
  --run-command "bash /opt/cloudtrain/build/$GUEST_SCRIPT"

echo "sparsifying + compressing"
virt-sparsify --quiet --compress "$DISK" "$VARIANT_DIR/out/disk.qcow2"
rm -f "$DISK"
qemu-img info "$VARIANT_DIR/out/disk.qcow2" | grep -E 'virtual size|disk size'
