#!/bin/bash
# Lab guest kernel for Kata: kata's own 6.18.35 config + the lab options, built-in (=y; the
# Kata guest has no module loading). Output: $W/kernel/vmlinux-lab, vmlinuz-lab
set -euo pipefail
W=/srv/ct-work/dev/kata; K=$W/kernel; mkdir -p $K; cd $K
[ -f linux-6.18.35.tar.xz ] || curl -sSfLO https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.35.tar.xz
[ -d linux-6.18.35 ] || tar xf linux-6.18.35.tar.xz
cd linux-6.18.35
docker exec ct-kata-worker cat /opt/kata/share/kata-containers/config-6.18.35-202 > .config
cat >> .config <<'C'
CONFIG_DUMMY=y
CONFIG_NET_IPGRE_DEMUX=y
CONFIG_NET_IPGRE=y
CONFIG_IPV6_GRE=y
CONFIG_NET_IPIP=y
CONFIG_IPV6_SIT=y
CONFIG_IPV6_TUNNEL=y
CONFIG_BONDING=y
CONFIG_NET_TEAM=y
CONFIG_WIREGUARD=y
CONFIG_VLAN_8021Q=y
CONFIG_NET_SCH_NETEM=y
CONFIG_NET_SCH_HTB=y
CONFIG_NET_SCH_TBF=y
CONFIG_NET_SCH_PRIO=y
CONFIG_NET_SCH_FQ_CODEL=y
CONFIG_NET_CLS_U32=y
CONFIG_NET_ACT_MIRRED=y
CONFIG_INET_IPCOMP=y
CONFIG_INET_XFRM_TUNNEL=y
CONFIG_INET6_XFRM_TUNNEL=y
CONFIG_INET_AH=y
CONFIG_INET6_ESP=y
CONFIG_MD=y
CONFIG_BLK_DEV_MD=y
CONFIG_MD_RAID0=y
CONFIG_MD_RAID1=y
CONFIG_MD_RAID10=y
CONFIG_MD_RAID456=y
CONFIG_BLK_DEV_DM=y
CONFIG_DM_SNAPSHOT=y
CONFIG_DM_THIN_PROVISIONING=y
CONFIG_DM_MIRROR=y
CONFIG_DM_RAID=y
CONFIG_BLK_DEV_LOOP=y
CONFIG_XFS_FS=y
CONFIG_BTRFS_FS=y
CONFIG_NFS_FS=y
CONFIG_NFSD=y
CONFIG_AUTOFS_FS=y
CONFIG_QUOTA=y
C
# everything that needs a toolchain runs in a throwaway container (nothing installed on the host)
docker run --rm -v $PWD:/src -w /src debian:trixie bash -c 'apt-get update -qq && apt-get install -y -qq build-essential bc bison flex libelf-dev libssl-dev cpio python3 dwarves >/dev/null && make olddefconfig >/dev/null && for o in DUMMY NET_IPGRE BONDING WIREGUARD VLAN_8021Q NET_SCH_NETEM BLK_DEV_MD MD_RAID1 DM_THIN_PROVISIONING XFS_FS; do grep -q "^CONFIG_$o=y" .config || echo "WARN CONFIG_$o not set"; done; make -j28 vmlinux bzImage >/dev/null 2>build.err; rc=$?; tail -5 build.err; chown -R '"$(id -u):$(id -g)"' /src; exit $rc'
cp vmlinux $K/vmlinux-lab; cp arch/x86/boot/bzImage $K/vmlinuz-lab; ls -la $K/vmlinux-lab $K/vmlinuz-lab
