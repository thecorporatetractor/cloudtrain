#!/bin/bash
# probe.sh <runtimeClass|-> : tier-B capability probe in a privileged deb-sys pod (systemd PID 1)
source /srv/ct-work/dev/kata/env.sh
rc=$1 ns=kata-probe n=probe
kk create ns $ns --dry-run=client -o yaml | kk apply -f - >/dev/null
rcl=""; [[ $rc != - ]] && rcl="runtimeClassName: $rc"
cat <<Y | kk apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: {name: $n, namespace: $ns}
spec:
  $rcl
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  terminationGracePeriodSeconds: 2
  containers:
  - name: c
    image: cloudtrain/deb-sys:spike
    imagePullPolicy: IfNotPresent
    securityContext: {privileged: true}
    resources: {limits: {memory: 1Gi, cpu: "1"}}
    volumeMounts: [{name: scratch, mountPath: /var/lib/scratch}]
  volumes: [{name: scratch, emptyDir: {medium: Memory, sizeLimit: 600Mi}}]
Y
kk -n $ns wait --for=condition=Ready pod/$n --timeout=180s >/dev/null
x() { kk -n $ns exec $n -- bash -c "$1" 2>&1; }
r() { if out=$(x "$2"); then echo "PASS $1 ${3:+($(x "$3" | tr '\n' ' ' | cut -c1-90))}"; else echo "FAIL $1: $(echo "$out" | tail -1 | cut -c1-140)"; fi; }
until s=$(x 'systemctl is-system-running'); [[ $s == running || $s == degraded ]]; do sleep 1; done
# guest-only device nodes for loop and device-mapper (the container /dev does not get them)
x 'for i in 0 1 2 3 4 5 6 7; do [ -e /dev/loop$i ] || mknod /dev/loop$i b 7 $i; done; [ -e /dev/loop-control ] || mknod /dev/loop-control c 10 237; mkdir -p /dev/mapper; [ -e /dev/mapper/control ] || mknod /dev/mapper/control c 10 236' >/dev/null
echo "== $rc: kernel $(x 'uname -r') nproc $(x nproc) mem $(x 'free -m | awk "/Mem:/{print \$2}"')MiB system=$s"
r "systemd PID 1" "[ \"\$(cat /proc/1/comm)\" = systemd ]"
r "failed units" "true" "systemctl --failed --no-legend | awk '{print \$1}'"
r "journald works" "logger -t ctprobe hello && sleep 1 && journalctl -t ctprobe -q --no-pager | grep -q hello"
r "unit start/enable/mask" "printf '[Service]\nExecStart=/bin/sleep 600\n[Install]\nWantedBy=multi-user.target\n' >/usr/lib/systemd/system/ctp.service && systemctl daemon-reload && systemctl enable --now ctp 2>/dev/null && systemctl is-active -q ctp && systemctl disable --now ctp 2>/dev/null && systemctl mask ctp 2>/dev/null && [ \"\$(systemctl is-enabled ctp 2>/dev/null)\" = masked ]"
r "sshd via systemd" "systemctl is-active ssh"
r "cgroup v2 delegated (systemd-run -p MemoryMax)" "systemd-run --wait -q -p MemoryMax=50M /bin/true"
r "own kernel (not host 7.0.0-1014-aws)" "[ \"\$(uname -r)\" != 7.0.0-1014-aws ]"
r "sysctl ip_forward write" "sysctl -w net.ipv4.ip_forward=1 >/dev/null"
r "nftables table" "nft add table inet ctp && nft list tables | grep -q ctp"
r "iptables (legacy/nft)" "iptables -L -n >/dev/null"
for t in dummy vxlan gre bond veth wireguard; do
  case $t in vxlan) a="id 42 dstport 4789";; gre) a="remote 10.9.9.9 local 10.9.9.8";; veth) a="peer name ctp-veth1";; *) a="";; esac
  r "ip link type $t" "ip link add ctp-$t type $t $a && ip link del ctp-$t"
done
r "vlan 8021q" "ip link add ctp-d0 type dummy && ip link add link ctp-d0 name ctp-d0.10 type vlan id 10 && ip link del ctp-d0"
r "tc netem" "tc qdisc add dev lo root netem delay 1ms && tc qdisc del dev lo root"
r "network namespace (ip netns)" "ip netns add ctp && ip netns exec ctp ip link && ip netns del ctp"
r "unshare pid/mount/uts" "unshare -fpmu --mount-proc true"
r "loop device + ext4 mount" "truncate -s 64M /var/lib/scratch/d.img && L=\$(losetup -f --show /var/lib/scratch/d.img) && mkfs.ext4 -q \$L && mkdir -p /mnt/ctp && mount \$L /mnt/ctp && umount /mnt/ctp && losetup -d \$L"
r "device-mapper (dmsetup / LVM)" "dmsetup version >/dev/null 2>&1 || grep -q device-mapper /proc/misc" "grep device-mapper /proc/misc"
r "md raid1 (/proc/mdstat personalities)" "grep -q raid1 /proc/mdstat"
r "modprobe in guest" "modprobe dummy"
r "chronyd adjtime (CAP_SYS_TIME)" "command -v chronyd >/dev/null || exit 3; timeout 5 chronyd -Q 'server 127.0.0.1 iburst' >/dev/null 2>&1; [ \$? -ne 1 ] || adjtimex >/dev/null 2>&1; true"
r "rootfs type" "true" "findmnt -no FSTYPE /"
r "host devices hidden (no /dev/nvme*, /dev/kvm)" "! ls /dev/nvme* /dev/kvm >/dev/null 2>&1"
kk delete ns $ns --wait=true --timeout=120s >/dev/null
