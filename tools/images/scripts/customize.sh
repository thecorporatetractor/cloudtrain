#!/usr/bin/env bash
# Runs INSIDE cloudtrain/image-builder (libguestfs). Inputs via env + /src, /work.
set -euo pipefail
mkdir -p "$TMPDIR" /work/out
WORK=/work/tmp/node.qcow2

cp --sparse=always "$BASE" "$WORK"
# Grow the virtual disk so packages + pre-loaded images fit; the root partition
# is grown inside the guest (growpart) during customization. cloud-init's
# growpart grows it again to whatever size the VM disk has at boot.
qemu-img resize -q "$WORK" 10G

virt-customize -a "$WORK" --memsize 2048 --smp 4 --network \
  --mkdir /opt/cloudtrain/images --mkdir /opt/cloudtrain/manifests \
  --upload /work/build.env:/opt/cloudtrain/build.env \
  --upload /work/images.txt:/opt/cloudtrain/images/images.txt \
  --upload "$FLANNEL_YAML":/opt/cloudtrain/manifests/kube-flannel.yml \
  --upload /src/scripts/guest-setup.sh:/opt/cloudtrain/guest-setup.sh \
  --run-command "bash /opt/cloudtrain/guest-setup.sh"

echo "sparsifying + compressing"
virt-sparsify --quiet --compress "$WORK" /work/out/disk.qcow2
rm -f "$WORK"
qemu-img info /work/out/disk.qcow2 | grep -E 'virtual size|disk size'
