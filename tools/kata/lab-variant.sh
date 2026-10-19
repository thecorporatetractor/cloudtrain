#!/usr/bin/env bash
# Write the Kata variant of a tier-B VM lab, for `labctl verify` on KIND_PROFILE=kata
# (docs/kata-spike.md, sections 4.1 and 6.2; a hand-run stand-in for the orchestrator's
# planned vmFallback rewrite, the other direction).
#   tools/kata/lab-variant.sh <lab dir> <out dir>    -> <out dir>/<id>-kata/lab.yaml
# Every `driver: vm` node on a Linux VM image becomes a tier-B systemd pod:
#   ubuntu-vm:24.04 -> deb-sys:24.04, el-vm:10 -> el-sys:10
# with the same cpu/memory (the pod limit is the Kata VM's size), no `console` access and no
# extra disks. Only the node changes: setup, checks, mutations and solutions are the lab's.
# Refuses labs that use extra disks (/dev/vdX, virtio-ct-data) or reboot the node: those
# stay on KubeVirt (tier C).
set -euo pipefail
src=${1:?usage: $0 <lab dir> <out dir>} out=${2:?usage: $0 <lab dir> <out dir>}
lab=$src/lab.yaml
[[ -f $lab ]] || { echo "lab-variant: $lab not found" >&2; exit 2; }
command -v yq >/dev/null || { echo "lab-variant: yq missing" >&2; exit 2; }
id=$(yq -r .metadata.id "$lab")
if grep -qE '/dev/vd[b-z]|virtio-ct-data' "$lab"; then
  echo "lab-variant: $id uses extra VM disks; it stays on KubeVirt" >&2; exit 3
fi
if grep -qE '^\s*(reboot|systemctl reboot|shutdown -r)\b|type: reboot' "$lab"; then
  echo "lab-variant: $id reboots a node; it stays on KubeVirt" >&2; exit 3
fi
n=$(yq '[.spec.topology.nodes[] | select(.driver == "vm" and (.image == "ubuntu-vm:24.04" or .image == "el-vm:10"))] | length' "$lab")
((n > 0)) || { echo "lab-variant: $id has no ubuntu-vm/el-vm node" >&2; exit 3; }
dst=$out/$id-kata
rm -rf "$dst"; mkdir -p "$out"; cp -r "$src" "$dst"
yq -i '
  .metadata.id += "-kata" |
  (.spec.topology.nodes[] | select(.driver == "vm" and (.image == "ubuntu-vm:24.04" or .image == "el-vm:10"))) |= (
    .driver = "container" |
    .image = ({"ubuntu-vm:24.04": "deb-sys:24.04", "el-vm:10": "el-sys:10"}[.image]) |
    del(.resources.disks) |
    .access = ([.access[] | select(. != "console")])
  )' "$dst/lab.yaml"
echo "$dst ($n node(s) on a tier-B systemd pod)"
