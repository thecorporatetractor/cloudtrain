#!/usr/bin/env bash
# Load the kernel modules the runtime needs, without sudo: a short-lived
# privileged container runs modprobe against the host kernel. The container is
# the kind node image (pinned by digest, ships kmod), so nothing is fetched at runtime.
#   openvswitch, geneve : Kube-OVN datapath (OVS kernel module + geneve tunnels)
#   vhost_net, tun      : KubeVirt virtio-net (creates /dev/vhost-net)
# Must run BEFORE `kind create cluster`: privileged containers only see device
# nodes that existed when they were created.
source "$(dirname "$0")/lib.sh"

[[ -c /dev/kvm ]] || die "/dev/kvm not present: enable nested virtualization (WSL2: nestedVirtualization=true in .wslconfig)"

modules=(openvswitch geneve vhost_net tun vxlan br_netfilter ip_tables)
missing=()
for m in "${modules[@]}"; do
  grep -qE "^${m} " /proc/modules || [[ -d /sys/module/$m ]] || missing+=("$m")
done

# A bind mount of a missing /dev/vhost-net (old cluster.yaml, or someone else's
# container) leaves an empty directory there, and modprobe then cannot create
# the device node. Remove it (only if it is an empty directory).
fix_vhost=""
if [[ -d /dev/vhost-net ]]; then
  warn "/dev/vhost-net is a directory (stale bind mount); replacing with the device node"
  fix_vhost="rmdir /hostdev/vhost-net && modprobe -r vhost_net 2>/dev/null; "
  missing+=(vhost_net)
fi

if ((${#missing[@]})); then
  log "loading kernel modules: ${missing[*]}"
  docker run --rm --privileged --entrypoint sh -v /lib/modules:/lib/modules:ro -v /dev:/hostdev "$KIND_NODE_IMAGE" \
    -c "${fix_vhost}for m in ${missing[*]}; do modprobe \$m; done" \
    || die "modprobe failed; on WSL2 check that /lib/modules/$(uname -r) exists"
fi

for d in /dev/kvm /dev/vhost-net /dev/net/tun; do
  [[ -c $d ]] || die "$d missing after module load"
done
log "host ready: kvm, vhost-net, tun, openvswitch, geneve"
