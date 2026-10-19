#!/usr/bin/env bash
# Load the kernel modules the runtime needs, without sudo: a short-lived
# privileged container runs modprobe against the host kernel. The container is
# the kind node image (pinned by digest, ships kmod), so nothing is fetched at runtime.
#   openvswitch, geneve : Kube-OVN datapath (OVS kernel module + geneve tunnels)
#   vhost_net, tun      : KubeVirt virtio-net (creates /dev/vhost-net)
#   vhost_vsock         : KIND_PROFILE=kata only: the Kata agent talks to the shim over vsock
#                         (creates /dev/vhost-vsock); not loaded for the other profiles
# Must run BEFORE `kind create cluster`: privileged containers only see device
# nodes that existed when they were created.
source "$(dirname "$0")/lib.sh"

[[ -c /dev/kvm ]] || die "/dev/kvm not present: enable nested virtualization (WSL2: nestedVirtualization=true in .wslconfig)"

modules=(openvswitch geneve vhost_net tun vxlan br_netfilter ip_tables)
devices=(/dev/kvm /dev/vhost-net /dev/net/tun)
if ((KATA_PROFILE)); then modules+=(vhost_vsock); devices+=(/dev/vhost-vsock); fi
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

# Host AppArmor (native Linux hosts; WSL has none, so this is a no-op there): kind nodes are
# privileged, lab pods unconfined, and path-attached host profiles then confine rsyslogd,
# chronyd and tcpdump inside lab containers (docs/dev-environment.md, "Host AppArmor").
# Unload exactly those three, without sudo, through a privileged container. Not persistent:
# after a host reboot run this again, or disable them for good as tools/verify-vm/tune.sh does.
if [[ -d /sys/kernel/security/apparmor ]]; then
  aa=()
  for f in usr.sbin.rsyslogd usr.sbin.chronyd usr.bin.tcpdump; do
    [[ -r /etc/apparmor.d/$f ]] && aa+=("$(sed -nE 's/^profile ([^ ]+) .*/\1/p; s/^(\/[^ ]+) .*\{.*/\1/p' "/etc/apparmor.d/$f" | head -1)")
  done
  if ((${#aa[@]})); then
    docker run --rm --privileged --entrypoint sh -v /sys/kernel/security:/sys/kernel/security "$KIND_NODE_IMAGE" -c \
      'for n in "$@"; do awk -v n="$n" '"'"'$1 == n { f = 1 } END { exit !f }'"'"' /sys/kernel/security/apparmor/profiles || continue
         printf %s "$n" > /sys/kernel/security/apparmor/.remove && echo "host-prep: unloaded host AppArmor profile $n"; done' sh "${aa[@]}" \
      || warn "could not unload host AppArmor profiles ${aa[*]}; rsyslogd/chronyd/tcpdump labs may fail"
  fi
fi

for d in "${devices[@]}"; do
  [[ -c $d ]] || die "$d missing after module load"
done
log "host ready: kvm, vhost-net, tun, openvswitch, geneve$( ((KATA_PROFILE)) && echo ', vhost-vsock')"

# Modules lab content needs (tunnels, IPsec, VLANs, bonds, tc, NAT; lab-kernel-modules.txt).
# Not fatal: the platform runs without them, only the labs that use them fail (e.g.
# `add tunnel "gre0" failed: No such device`). Load what is missing, warn about the rest
# (on WSL2 a module missing from the kernel build cannot be loaded at all).
builtin=/lib/modules/$(uname -r)/modules.builtin
have_mod() { grep -qE "^$1 " /proc/modules || [[ -d /sys/module/$1 ]] || grep -qE "/$1\.ko" "$builtin" 2>/dev/null; }
lab_missing=()
while read -r m; do
  [[ -z $m || $m == \#* ]] && continue
  have_mod "$m" || lab_missing+=("$m")
done < "$(dirname "$0")/lab-kernel-modules.txt"
if ((${#lab_missing[@]})); then
  log "loading lab kernel modules: ${lab_missing[*]}"
  docker run --rm --privileged --entrypoint sh -v /lib/modules:/lib/modules:ro "$KIND_NODE_IMAGE" \
    -c "for m in ${lab_missing[*]}; do modprobe \$m 2>/dev/null; done; true" >/dev/null 2>&1 || true
  still=()
  for m in "${lab_missing[@]}"; do have_mod "$m" || still+=("$m"); done
  ((${#still[@]})) && warn "kernel modules missing (labs that use them will fail): ${still[*]}$(grep -qi microsoft /proc/sys/kernel/osrelease && echo '; WSL2: the kernel build lacks them (custom kernel or wsl --update)')"
fi
