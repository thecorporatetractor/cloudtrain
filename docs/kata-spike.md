# Kata Containers for tier B: spike

Status: spike, 2026-10-19. Evidence from ct-testvm, plus a design sketch.
There is a small prototype behind a default-off flag (section 6). It is not
a production feature. **Phase 1** (section 10) made it a reproducible, opt-in
dev profile: the lab guest kernel build and its published artifact, the
`deb-sys`/`el-sys` images, `KIND_PROFILE=kata` and the preflight sandbox
section. The orchestrator's default is unchanged.

Tier B in `content/curriculum.yaml` is "Kata pod with capabilities". The
substrate is a Kata RuntimeClass with a custom guest kernel, and privileged
or NET_ADMIN/SYS_ADMIN applies inside the guest only. It is the authentic
substrate for systemd and journald, runtime networking and nftables,
loop/LVM/mdadm storage, cgroups and namespaces, rootful dockerd and Podman.
Today 150 tier-B labs exist (56 verified, 68 built, 26 proposed). All of them
run as KubeVirt VMs (`docker-vm` 71, `ubuntu-vm` 31, `el-vm` 16, ...) or are
proposed against the `deb-sys`/`el-sys` pod images that do not exist yet. The
notes say "tier B (Kata): runs as a KubeVirt VM until Kata exists".

Raw data, configs and scripts are in [`kata-spike/`](kata-spike/). The
reproduce steps are in section 9.

## Answers

| Question | Answer |
|---|---|
| 1. Can Kata run in a separate kind cluster (`ct-kata`) on ct-testvm? | **Yes.** kata-deploy 4.2.0 (chart, DaemonSet mode) installed in 192 s. Cloud Hypervisor (Go and runtime-rs), QEMU (Go and runtime-rs) and Dragonball start pods. Firecracker does not, because it needs the devmapper snapshotter, a host change that was not made. Two kind-only fixes inside the node container were needed (section 1.3). |
| Nested or emulated `/dev/kvm`? | **Nested, hardware-assisted.** r7i.8xlarge is a virtual Nitro instance (`systemd-detect-virt` = `amazon`). `kvm_intel nested=Y`, and VMX has `ept`, `unrestricted_guest` and `shadow_vmcs`. KubeVirt runs with `useEmulation: false` (libvirt `domain type='kvm'`), and the Kata VMMs need `/dev/kvm` (no TCG). |
| Start latency vs runc vs KubeVirt | Pod Ready: runc **6.9 s**, Kata **7.7-9.9 s** (+0.8 to +3.0 s, depending on the hypervisor). With systemd as PID 1, "systemd running" is reached in runc **6.9 s**, Kata clh **10.1 s**, and an `ubuntu-vm` VMI **39.8 s** (to the cloud-init marker; VMI Ready 13.4 s). |
| Memory overhead per sandbox | Idle busybox: **175 MiB** (clh runtime-rs) to **215 MiB** (QEMU Go). Idle systemd image: **237-260 MiB**. `ubuntu-vm` VMI: **500 MiB**. runc: **1-17 MiB**. |
| Density in 16 GiB | At the idle footprint: **~64** systemd Kata sandboxes vs **~32** VMIs. At the scheduler reservation of the lab as written: **14** Kata pods (1 GiB limit + 130 Mi overhead) vs **9** VMIs (1815 Mi request each). |
| 2. Does systemd work in Kata? | **Yes, with one fix in the image.** systemd as PID 1 boots to `running` with no failed units. Without the fix, every `kubectl exec` fails with `EBUSY` (cgroup v2 "no internal processes"). The fix: the entrypoint creates an empty leaf cgroup `init`, which kata-agent uses for exec processes (kata PR 10845). |
| Does Multus/Kube-OVN secondary networking attach? | **Yes.** A Multus NAD of type kube-ovn attaches `net1` with the OVN port's MAC, and the guest gets MTU 1400. 1400-byte frames with DF pass both ways. Primary placement with `ovn.kubernetes.io/logical_switch` (the orchestrator's primary mode) also works. Tested with clh and QEMU runtime-rs. |
| Does `labctl verify` pass with `runtimeClassName` set? | **Yes.** The full verifier cycle passed for `systemd-service-lifecycle` with `tr-pis-01` as a deb-sys pod on `kata-clh-runtime-rs` (lab kernel): 2 seeds, 3 mutations and 1 alternative, all clean. Sessions were Ready in **25-45 s**, against 55-60 s for the same lab on KubeVirt in the same cluster. The first run failed because setup raced systemd's boot. A readiness probe on systemd nodes fixed it (section 4.5). |
| Lab kernel features | **The stock Kata guest kernel is not enough** for tier B: it has no dummy, GRE, bonding, WireGuard, 802.1Q, netem or md. A lab guest kernel (the same 6.18.35 with Kata's config plus about 40 options, built in 5 minutes) passes every probe. On managed Kata (AKS, GKE) the guest kernel is the provider's, and neither documents a way to replace it. |
| 3. Orchestrator change | Sketch in section 6. A prototype is included: `--tier-runtime-classes` (default off), RuntimeClass detection at startup, a catalog `systemd: true` flag (privileged only inside a sandbox) and Helm `orchestrator.tierRuntimeClasses`. |

**Recommendation:** adopt Kata for tier B on self-managed clusters (vCenter,
bare metal, kind/ct-testvm). Use **Cloud Hypervisor on runtime-rs**
(`kata-clh-runtime-rs`) with a CloudTrain lab guest kernel. Keep KubeVirt as
the fallback, selected per cluster by preflight. Do not migrate content
until the next steps in section 8 are done.

## 1. Environment

| | |
|---|---|
| Host | ct-testvm, AWS r7i.8xlarge (32 vCPU, 247 GiB), kernel 7.0.0-1014-aws, Docker 29.9.1, kind 0.33.0 |
| Cluster | separate kind cluster `ct-kata` (1 control plane + 1 worker), `kindest/node:v1.36.4`, containerd 2.3.4, built by `deploy/scripts/dev-up.sh` (`CT_CLUSTER_NAME=ct-kata`, own kubeconfig): Kube-OVN v1.16.13 primary, Multus v4.3.1, KubeVirt v1.9.1, CDI v1.66.1. `cloudtrain-dev` was not touched |
| Kata | kata-deploy Helm chart **4.2.0** (2026-09-15), DaemonSet mode, shims `clh`, `clh-runtime-rs`, `qemu`, `qemu-runtime-rs`, `dragonball`, `fc`; no nydus snapshotter. Cloud Hypervisor v51.1, QEMU 11.0.1, guest kernel 6.18.35, Ubuntu rootfs image |
| Load | the host was shared with the verify batch runner. Load average was 30-130 during the measurements (it is noted per run in the raw files). Absolute times are pessimistic, so compare runtimes within one table. |
| Interruptions | ct-testvm was Spot-interrupted twice (09:58Z and 11:24Z). After each, `ct-kata` was recovered with `kata-spike/recover.sh`. Samples taken across a reboot were discarded and those runs were repeated. |

### 1.1 Nested virtualization

```
$ systemd-detect-virt                      -> amazon (virtual Nitro instance, not .metal)
$ cat /sys/module/kvm_intel/parameters/nested -> Y
$ grep 'vmx flags' /proc/cpuinfo           -> ... ept ... vpid unrestricted_guest ... shadow_vmcs ...
$ ls -l /dev/kvm                           -> crw-rw---- 10,232
dev-up verify-kvm.sh                       -> "KVM verified: libvirt <domain type='kvm'", probe VMI Ready in 17 s
```

Kata VMs are L2 guests: the Nitro hypervisor is L0, the EC2 instance is L1, and
the Kata/KubeVirt VMs are L2. Since 2026-02, EC2 offers this on virtual
C7i/C8i, M7i/M8i and R7i/R8i ([any-kubernetes.md 3.1](any-kubernetes.md)).

### 1.2 Host requirements found (recorded, not changed)

| Requirement | Why | Done here? |
|---|---|---|
| `vhost_vsock` module loaded **before** the kind node containers start | the Kata agent talks over vsock; a privileged container sees only the device nodes present at its start | loaded with `modprobe` (allowed). It is not in `host-prep.sh` today, so add it there and to `install.sh` |
| devmapper thin pool for containerd (block device or loop-backed pool) | Firecracker supports only block-device rootfs: `inspection service could not find snapshotter devmapper plugin` | **no** (host change). Firecracker not measured |
| none for nested virt | `/dev/kvm` with nested=Y was already there | - |

### 1.3 kind-only fixes inside the `ct-kata-worker` container

These are not host changes and are not needed on real nodes. They are needed
for Kata in kind, and so for CI on ct-testvm.

| Symptom | Cause | Fix (in `kata-spike/node-fix.sh`) |
|---|---|---|
| `kata-qemu` (Go): `kvm run failed Bad address`, then `timed out connecting to vsock` | QEMU backs guest RAM with a file on `/dev/shm` (virtio-fs needs shared memory). A kind node's `/dev/shm` is 64 MiB, so the guest faults past 64 MiB. Cloud Hypervisor uses memfd and is not affected | `mount -o remount,size=32G /dev/shm` in the node |
| every runtime-rs shim: `add runtime to sandbox cgroup: systemd dbus error: No such file or directory` | kubelet uses the systemd cgroup driver; runtime-rs moves the VMM into the pod's systemd scope over D-Bus; kindest/node runs systemd **without** dbus | install and start `dbus` in the node |

Both fixes are lost when the node container restarts (Spot interruption), so
`recover.sh` reapplies them.

## 2. Hypervisors

| RuntimeClass (handler) | Starts in kind on ct-testvm | Notes |
|---|---|---|
| `kata-clh` (Go, Cloud Hypervisor) | yes | VMM outside the pod cgroup (`sandbox_cgroup_only=false`, in `kata_overhead`); default VM 2048 MiB **plus** the pod limit, hot-added (a 1 GiB-limit pod got a 3002 MiB guest) |
| `kata-clh-runtime-rs` | yes (needs D-Bus on the node) | **fastest and smallest**; VMM in the pod cgroup (`sandbox_cgroup_only=true`); the VM is sized to the pod limit (`static_sandbox_resource_mgmt`: 1 GiB limit gave a 1008 MiB guest) |
| `kata-qemu-runtime-rs` (the chart's default `kata`) | yes (needs D-Bus) | RuntimeClass overhead 320 Mi; VM sized to the limit |
| `kata-qemu` (Go) | yes (needs `/dev/shm` larger than guest RAM) | deprecated runtime in Kata 4.x |
| `kata-dragonball` | yes | built-in VMM of runtime-rs; uses the "dragonball-experimental" guest kernel |
| `kata-fc` | **no** | devmapper snapshotter required (host change) |

Cloud Hypervisor is also what AKS Pod Sandboxing and GKE Sandbox `microvm`
use (section 7). That makes `clh-runtime-rs` the closest self-managed match
to the managed offers.

## 3. Measurements

### 3.1 Start latency (sequential, one pod at a time, worker node, image pre-loaded)

Measured from `kubectl apply` to the pod's Ready condition, polled every
100 ms. Kube-OVN pod networking dominates the runc baseline.

| Image | runc | kata-clh-runtime-rs | kata-clh | kata-qemu | kata-dragonball | kata-qemu-runtime-rs |
|---|---|---|---|---|---|---|
| busybox `sleep`, n=8, median (min-max) | **6.9 s** (6.3-9.2) | **7.7 s** (7.5-8.5) | 8.6 s (8.1-9.7) | 9.0 s (8.5-10.0) | 9.0 s (8.3-10.9) | 9.9 s (8.7-11.1) |

A tier-B node is ready for a learner when systemd is up, and for a VM when
the guest has booted. Here deb-sys is the spike image (`deb-lab:24.04` +
systemd as PID 1, privileged), and the VMI is the `ubuntu-vm:24.04`
containerDisk, 2 vCPU, 1536 Mi, as tier-B labs use it today. n=5, median
(min-max):

| | Pod / VMI Ready | systemd `running` / guest booted |
|---|---|---|
| deb-sys on runc (privileged on the **host** kernel, not acceptable) | 6.4 s (6.3-6.5) | 6.9 s (6.7-6.9) |
| deb-sys on kata-clh | 7.7 s (6.8-8.3) | **10.1 s** (9.6-11.0) |
| deb-sys on kata-clh-runtime-rs (lab kernel) | 8.0 s (7.0-8.7) | 10.6 s (9.9-11.4) |
| deb-sys on kata-qemu | 8.8 s (8.6-8.9) | 10.9 s (10.7-10.9) |
| deb-sys on kata-qemu-runtime-rs | 9.3 s (9.1-9.6) | 11.5 s (11.3-11.8) |
| `ubuntu-vm` VMI (KubeVirt) | 13.4 s (12.3-14.4) | **39.8 s** (36.9-42.5), cloud-init `runcmd` on the serial console |

Burst: N sandboxes created at once, time until all are Ready (load ~130):

| | runc | kata-clh | kata-clh-runtime-rs | kata-qemu-runtime-rs | kata-qemu | VMI |
|---|---|---|---|---|---|---|
| 20 busybox | 9.8 s | 19.3 s | 13.1 s | 15.5 s | 12.9 s | - |
| 10 deb-sys (systemd) | 8.3 s | 11.5 s | - | 12.4 s | - | 14.1 s to Ready (not booted) |

### 3.2 Memory per sandbox

Measured 60 s after the burst above was Ready, as the average per sandbox.
"Host PSS" is the sum of `Pss` (smaps_rollup) of the VMM, virtiofsd and
`containerd-shim-kata-v2` processes. It includes guest RAM the guest has
touched, which is shared memfd or `/dev/shm` memory. The pod cgroup counts that
memory only for runtime-rs (`sandbox_cgroup_only=true`). The Go runtime keeps
the VMM in a separate `kata_overhead` cgroup.

| | pod cgroup `memory.current` | host PSS (VMM + virtiofsd + shim) | RuntimeClass `overhead.podFixed.memory` |
|---|---|---|---|
| busybox, runc | 0.7 MiB | - | - |
| busybox, kata-clh-runtime-rs | 174.5 MiB | **175 MiB** | 130 Mi |
| busybox, kata-clh (Go) | 0 (VMM not in it) | 189 MiB (`kata_overhead`: 179 MiB) | 130 Mi, **under-reserved** |
| busybox, kata-qemu-runtime-rs | 196 MiB | 200 MiB | 320 Mi |
| busybox, kata-qemu (Go) | 0 | 215 MiB (`kata_overhead`: 201 MiB) | 320 Mi |
| deb-sys systemd, runc | 17.4 MiB | - | - |
| deb-sys systemd, kata-clh (Go) | 0 | **248 MiB** | 130 Mi |
| deb-sys systemd, kata-qemu-runtime-rs | 256 MiB | **259 MiB** | 320 Mi |
| deb-sys systemd, kata-clh-runtime-rs, lab kernel | 241 MiB | **237 MiB** | 130 Mi |
| `ubuntu-vm` VMI, virt-launcher pod | **500 MiB** (anon 490) | - | KubeVirt sets the request: 1815 Mi for 1536 Mi guest |

Points to note:

- A Kata guest **does not give memory back**. Page cache and freed memory
  stay with the VMM (no balloon or free-page reporting by default), so over
  a session a sandbox grows towards its VM size. Size the pod limit for the
  lab, e.g. 512-768 Mi for a systemd node, not 2 GiB.
- With runtime-rs the VM is sized to the pod limit and everything is
  charged to the pod cgroup (as on AKS). With the Go runtime the guest is
  2 GiB plus the limit, and the VMM is outside the pod cgroup. The 130 Mi
  overhead then under-reserves by about 60 MiB per pod.

### 3.3 Density in 16 GiB

| | per sandbox | sandboxes in 16 GiB |
|---|---|---|
| systemd node, Kata, idle footprint | ~250 MiB | **~64** |
| systemd node, VMI, idle footprint | ~500 MiB | **~32** |
| Kata, scheduler view, lab as written (limit 1 Gi + 130 Mi overhead) | 1154 Mi | **14** |
| Kata, scheduler view, limit 768 Mi | 898 Mi | **18** |
| VMI, scheduler view (1536 Mi guest -> 1815 Mi request) | 1815 Mi | **9** |
| runc systemd pod (not an isolation option) | ~17 MiB | hundreds |

So Kata roughly doubles tier-B density at equal isolation (one kernel per
node), at both the idle and the reservation level. It also removes the 30 s
guest boot and the containerDisk pull (904 MB image vs 242 MB). The
reservation, not the idle footprint, is what bounds a node. The win therefore
comes mostly from smaller limits, which Kata makes safe: a sandbox OOM kills
one learner's VM, not the node.

## 4. A real tier-B lab as a Kata pod

### 4.1 Lab and image

Lab: `systemd-service-lifecycle` (tier B, verified as a VM: `ubuntu-vm:24.04`
node `tr-pis-01`). The Kata variant
([`kata-spike/systemd-service-lifecycle-kata/lab.yaml`](kata-spike/systemd-service-lifecycle-kata/lab.yaml))
changes only the node:

```yaml
      - name: tr-pis-01
        driver: container          # was: vm
        image: deb-sys:24.04       # was: ubuntu-vm:24.04
        resources: {cpu: 1, memoryMiB: 1024}
        access: [ssh]
```

`deb-sys:24.04` (spike image,
[`kata-spike/deb-sys/Dockerfile`](kata-spike/deb-sys/Dockerfile)) is
`deb-lab:24.04` plus `systemd systemd-sysv dbus openssh-server chrony nftables
iptables lvm2 mdadm`. udev, logind and getty are masked, `ssh.service` is
enabled and the learner has passwordless sudo, as in the lab VMs. The catalog
overlay ([`kata-spike/catalog-kata.yaml`](kata-spike/catalog-kata.yaml)) marks
it `tier: B, systemd: true`.

### 4.2 systemd in Kata: the exec problem and the fix

systemd boots fine in a privileged Kata container. Once it has started units,
however, **every exec into the container fails**:

```
failed to add process into unit cri-containerd-<id>.scope
Caused by: System.Error.EBUSY: Failed to attach processes to control group: Device or resource busy
```

On cgroup v2 a cgroup that delegates controllers to children cannot hold
processes. systemd delegates `memory pids` below the container's cgroup, so
kata-agent cannot put the exec'd process there. runc has a fallback for this
case; kata-agent only has the dind one ([kata #10733](https://github.com/kata-containers/kata-containers/issues/10733),
[PR #10845](https://github.com/kata-containers/kata-containers/pull/10845),
4.x): if the container cgroup has a child called `init`, exec goes there. systemd
names its own `init.scope`, so the fallback never triggers.

Fix, in the image: a 5-line entrypoint ([`kata-spike/deb-sys/ct-sysinit`](kata-spike/deb-sys/ct-sysinit))
creates the empty leaf `/sys/fs/cgroup/init` and then `exec /sbin/init`. With it,
exec, `systemctl`, `journalctl`, `systemd-run -p MemoryMax=` and sshd all
work. The same entrypoint adds the guest's loop and device-mapper nodes
(`/dev/loop*`, `/dev/mapper/control`). Kata's `privileged_without_host_devices`
gives the container its own `/dev`. The long-term fix is upstream: a
runc-style fallback in kata-agent, which should be filed.

### 4.3 Tier-B capability probe

The probe ([`kata-spike/probe.sh`](kata-spike/probe.sh)) runs in a privileged
deb-sys pod with a 1 GiB / 1 CPU limit. Raw output:
[`results/probe2.txt`](kata-spike/results/probe2.txt) (kata-clh with the lab kernel, kata-qemu-runtime-rs stock, runc) and
[`results/probe3.txt`](kata-spike/results/probe3.txt) (kata-clh-runtime-rs, lab kernel). [`results/probe.txt`](kata-spike/results/probe.txt) is the first run, before the image had nftables/iptables and the device nodes.

| Probe | runc privileged | Kata, stock guest kernel | Kata, lab guest kernel |
|---|---|---|---|
| systemd PID 1, no failed units, journald, unit start/enable/mask, sshd | pass | pass | pass |
| `systemd-run -p MemoryMax` (cgroup v2 delegation) | pass | pass | pass |
| own kernel | **no** (host 7.0.0-1014-aws) | yes (6.18.35) | yes |
| host devices hidden (`/dev/nvme*`, `/dev/kvm`) | **no, visible** | yes | yes |
| sysctl write, nftables, iptables, netns, unshare | pass | pass | pass |
| `ip link` vxlan, veth | pass | pass | pass |
| `ip link` dummy, gre, bond, wireguard, vlan (8021q) | pass | **fail** (not in kernel) | pass |
| `tc qdisc netem` | pass | **fail** | pass |
| loop device + mkfs.ext4 + mount | pass | pass (with the device nodes) | pass |
| device-mapper (LVM) | pass | pass | pass |
| md raid1 | (host module not loaded) | **fail** | pass |
| `modprobe` | n/a | n/a (no modules) | n/a: everything built in |
| rootfs | overlay | virtiofs | virtiofs |

With the lab kernel the busybox start time on clh-runtime-rs was 8.2 s (7.4-8.8, n=5, `results/lat3.csv`), within noise of the stock kernel's 7.7 s.

The lab kernel is upstream 6.18.35 with Kata's own config
(`config-6.18.35-202`) plus, built in (`=y`), dummy, GRE/IPv6 GRE, IPIP/SIT,
ip6 tunnel, bonding, team, WireGuard, 802.1Q, netem/HTB/TBF/PRIO/fq_codel,
u32/mirred, IPcomp/AH/ESP6/XFRM tunnels, MD (raid0/1/10/456), DM
snapshot/thin/mirror/raid, XFS, Btrfs, NFS client and server, autofs and
quota. That is the content of `deploy/scripts/lab-kernel-modules.txt` plus
the storage labs' needs. It built in 5 minutes in a throwaway container
([`kata-spike/build-kernel.sh`](kata-spike/build-kernel.sh)). It is selected per
shim with a Kata drop-in:

```toml
# /opt/kata/share/defaults/kata-containers/runtime-rs/runtimes/clh-runtime-rs/config.d/90-lab-kernel.toml
[hypervisor.clh]
kernel = "/opt/kata/share/kata-containers/vmlinux-lab"
```

Rootful dockerd in a privileged Kata pod (`docker:28-dind`, kata-clh) also
works: inner containers run and a published port (iptables DNAT) answers.
This covers the 71 `docker-vm` labs ([`results/dind-kata-clh.txt`](kata-spike/results/dind-kata-clh.txt)). `/var/lib/docker` must not be on
virtio-fs, which only gives `vfs`. On a tmpfs emptyDir (or a block PVC) it is
`overlay2`.

### 4.4 Secondary networking

The script is [`kata-spike/multus.sh`](kata-spike/multus.sh); raw output is in [`results/`](kata-spike/results/). A runc pod and a
Kata pod share a Kube-OVN subnet through a Multus NAD (the orchestrator's link
mechanism), and the Kata pod's eth0 is placed on a second subnet with
`ovn.kubernetes.io/logical_switch` (the orchestrator's primary mode). Results,
identical for `kata-clh` and `kata-qemu-runtime-rs`:

| Check | Result |
|---|---|
| `net1` in the guest, MTU 1400 from the Subnet | pass |
| runc <-> Kata over `net1` | pass |
| 1400-byte frames with DF over `net1`, both directions (also 1372/1350/1300/1200) | pass |
| `net1` MAC = the OVN port MAC (tc-redirect keeps L2 identity) | pass |
| eth0 placed on the session subnet by `logical_switch` | pass |
| 1400 DF on eth0 | pass |

Kata's default `internetworking_model=tcfilter` mirrors each pod interface
into a virtio-net device, so Multus and Kube-OVN see an ordinary veth. Not
tested: VLAN passthru (`vlan-passthru` on the switch), whose frames cross the
same tc-redirect and are expected to work but should be confirmed.

### 4.5 `labctl verify`

The run used the prototype orchestrator deployed to `ct-kata` (`TIER_RUNTIME_CLASSES=B=kata-clh`,
`CATALOG_OVERLAY=kata-spike/catalog-kata.yaml`). At startup the manager logged
`tier sandboxes {"enabled": "B=kata-clh"}`, so detection found the RuntimeClass
and the Kata nodes.

**Run 1** (11:44Z, `B=kata-clh`, both variants, [`results/verify-run1.log`](kata-spike/results/verify-run1.log)).
The VM variant passed all 6 runs (Ready 55-60 s). Every Kata run failed before
grading:

```
session not ready: phase Failed: action 0 on tr-pis-01 exited 1: System has not been booted
with systemd as init system (PID 1). Can't operate. | Failed to connect to bus: Host is down
```

The pod is Ready as soon as its container starts, and the orchestrator runs
setup on Ready, which is before systemd has created `/run/systemd/system`.
The VM variant does not hit this. Fix in the prototype: systemd nodes get a readiness probe
(`systemctl is-system-running` = running or degraded, period 1 s). The probe
is an exec, so it also depends on the `init` leaf (4.2).

**Run 2** (12:01Z, `B=kata-clh-runtime-rs`, readiness probe, [`results/verify-run2.log`](kata-spike/results/verify-run2.log),
[JSON report](kata-spike/results/verify-systemd-service-lifecycle-kata.json)):

| Lab | Run | Seed | Ready | Before | After | Teardown | Result |
|---|---|---|---|---|---|---|---|
| systemd-service-lifecycle-kata | base:seed-1 | 1 | 25 s | 0 (0/4) | 100 (4/4) | clean | ok |
| systemd-service-lifecycle-kata | base:seed-2 | 2 | 25 s | 0 (0/4) | 100 (4/4) | clean | ok |
| systemd-service-lifecycle-kata | mutation:started-not-enabled | 1 | 40 s | 0 (0/4) | 78 (3/4) | clean | ok |
| systemd-service-lifecycle-kata | mutation:disabled-not-masked | 1 | 25 s | 0 (0/4) | 67 (3/4) | clean | ok |
| systemd-service-lifecycle-kata | mutation:masked-still-running | 1 | 25 s | 0 (0/4) | 78 (3/4) | clean | ok |
| systemd-service-lifecycle-kata | alternative:separate-commands | 1 | 45 s | 0 (0/4) | 100 (4/4) | clean | ok |
| systemd-service-lifecycle (VM, run 1) | all 6 runs | 1/2 | 55-60 s | 0 (0/4) | as expected | clean | ok |

The grades are identical to the VM variant, run for run. "Ready" is the whole
session (jumphost entry node + tr-pis-01 + setup) under host load ~50.
Learner ssh from the jumphost to a container node (`ssh tr-pis-01`) is not
graded by this lab and was not tested. Today the orchestrator injects keys
only into VMs (cloud-init), so a tier-B pod image needs the same key wiring
(next steps).

## 5. Feature matrix for tier B

| | Kata (lab kernel) | KubeVirt VM | runc |
|---|---|---|---|
| Isolation | own kernel per pod (VM), privileged inside the guest only | own kernel per VM | **host kernel**; tier B needs privileged or SYS_ADMIN, which is root on the node |
| systemd as PID 1, journald, units, timers | yes (image entrypoint fix) | yes | works but only privileged on the host: **not acceptable** |
| Start to usable | ~10 s | ~40 s | ~7 s |
| Memory per idle node | ~250 MiB | ~500 MiB | ~17 MiB |
| Reservation per node (lab sizing) | limit + 130 Mi, can be 768 Mi | 1815 Mi for a 1536 Mi guest | limit |
| Kernel features (tunnels, bonds, VLAN, netem, md, dm) | yes, if built into the guest kernel | yes (guest distro kernel, modules) | host kernel modules; userns pods cannot load them |
| `modprobe` / kernel module labs | **no** (no modules in the guest) | yes | no |
| Reboot / kernel parameters / GRUB / boot targets | **no** (pod restart = new VM, rootfs reset) | yes | no |
| Extra disks | block PVC hotplugged as virtio-blk [U], loop files in the guest | yes (`resources.disks`, `/dev/vdb`..) | loop needs host devices |
| SELinux enforcing (el labs) | guest kernel and policy would need SELinux; **not tested** [U] | yes (el-vm) | no |
| Rootful dockerd / Podman | yes (`/var/lib/docker` on tmpfs or block) | yes (docker-vm) | needs privileged |
| Multus / Kube-OVN links, MTU 1400 | yes | yes | yes |
| Persistent home, hibernate | PVC over virtio-fs, as today's container nodes [U] | DataVolume | PVC |
| Learner terminal and checks | `kubectl exec` (works with the init leaf) and ssh | ssh | exec |
| Managed clusters | AKS Pod Sandboxing, GKE microvm, EKS self-installed (section 7) | self-supported everywhere | everywhere |
| Image build | ordinary OCI image (CI can build it, no KVM) | containerDisk (KVM builder) | OCI |

## 6. Orchestrator design sketch

### 6.1 Configuration: a RuntimeClass per tier

Tier is a property of the catalog image (`deploy/images/catalog.yaml` already
has `tier:`), not of the lab. The manager gets a map from tier to sandbox:

```yaml
# deploy/charts/cloudtrain values (prototype: orchestrator.tierRuntimeClasses: {B: kata-clh-runtime-rs})
orchestrator:
  sandboxes:
    B:
      runtimeClass: kata-clh-runtime-rs   # AKS: kata-vm-isolation, GKE: microvm
      fallback: kubevirt                  # kubevirt | fail
      requiredFeatures: [dummy, gre, bond, vlan, netem, md, wireguard]   # checked by preflight
```

- A container node whose image has `tier: B` gets
  `pod.spec.runtimeClassName`. The existing global `--runtime-class` stays as
  the default for every other image.
- Images marked `systemd: true` get a readiness probe on
  `systemctl is-system-running`, so setup never runs before boot finishes.
- Images marked `systemd: true` run **privileged only when a sandbox
  RuntimeClass applies**. Without one, the node fails with `ErrUnsupported`
  instead of becoming privileged on the host kernel. That is the safety
  property of the design.
- The pod's memory limit becomes the VM size (runtime-rs). Tier-B catalog
  images should carry a default limit (e.g. 768 Mi) for nodes whose lab sets
  none.

### 6.2 Fallback to KubeVirt when Kata is absent

Every tier-B pod image gets a VM twin in the catalog:

```yaml
  deb-sys:24.04: {kind: container, image: cloudtrain/deb-sys:24.04, tier: B, systemd: true, vmFallback: ubuntu-vm:24.04}
  el-sys:10:     {kind: container, image: cloudtrain/el-sys:10,     tier: B, systemd: true, vmFallback: el-vm:10}
```

When the sandbox for tier B is unavailable (detection below) and the setting
is `fallback: kubevirt`, the controller rewrites such nodes when it resolves the
template. `driver: container` becomes `driver: vm`, `image` becomes
`vmFallback`, and resources are raised to the VM minimum. It records this in
`status.nodes[].substrate`. Labs keep one `lab.yaml`. Content has to be
written for both: same commands, no `/dev/vdX` vs loop-file assumptions (use
`/dev/disk/by-id/virtio-ct-dataN`, which both can provide), and no reboot
checks in tier B. Labs that need a reboot, a module or SELinux stay tier C.
The 150 tier-B labs need a pass to re-tier those.

### 6.3 Preflight detection

At manager startup the prototype (`DetectTierRuntimeClasses`) keeps a tier
only if its RuntimeClass exists and its `scheduling.nodeSelector` matches a
schedulable node. Otherwise it logs why and drops the tier. `labctl preflight`
gets a **sandbox** section that does the real check with a throwaway pod per
configured RuntimeClass:

| Check | Fails when |
|---|---|
| RuntimeClass exists, handler on lab nodes | kata-deploy or the managed add-on is missing |
| probe pod reaches Running, `uname -r` differs from the node | it is not actually a VM (misconfigured handler) |
| systemd image reaches `running`, then `kubectl exec` works | the exec `EBUSY` regression (image without the `init` leaf, or an agent change) |
| `requiredFeatures`: `ip link add type gre/bond/dummy/wireguard`, `vlan`, `tc netem`, `/proc/mdstat` raid1 | the guest kernel is the stock or managed kernel |
| memory: guest `MemTotal` vs pod limit | Go-runtime sizing (2 GiB + limit) instead of runtime-rs |
| Multus `net1` + 1400 DF to a runc peer | CNI or tcfilter problem |

The result goes into a ConfigMap that the manager reads, so the fallback
decision is per cluster and visible. The gateway's capacity view
(`services/gateway/src/kube/capacity.ts`) should count tier-B pods by
request + overhead instead of KVM devices.

### 6.4 Helm

- `cloudtrain` chart: `orchestrator.tierRuntimeClasses` (prototype, map
  tier -> RuntimeClass, schema-validated tiers A/B/C/K/V/N) renders
  `--tier-runtime-classes`. The final form is `orchestrator.sandboxes` above.
- Prerequisites chart (any-kubernetes.md section 5): `kata.enabled` installs
  kata-deploy pinned to 4.2.0 with `shims: {clh-runtime-rs}` only,
  `snapshotter.setup: []` and `runtimeClasses.createDefault: false`. It also
  ships the lab guest kernel (an OCI artifact or init container that copies
  `vmlinux-lab` to `/opt/kata/share/kata-containers/`) and the `config.d`
  drop-in. It stays off on AKS and GKE, which use their own RuntimeClass.
- Values profiles: `values-aks.yaml` `sandboxes.B.runtimeClass:
  kata-vm-isolation`, `values-gke.yaml` `microvm`, `values-eks.yaml` /
  `values-vcenter.yaml` / `values-baremetal.yaml` `kata-clh-runtime-rs`,
  `values-kind.yaml` off (or on for the ct-testvm Kata CI profile).

### 6.5 What the prototype in this PR does

Everything is off unless `--tier-runtime-classes` is set.

| File | Change |
|---|---|
| `internal/drivers/sandbox.go` (+ test) | `ParseTierRuntimeClasses`, `DetectTierRuntimeClasses` (RuntimeClass exists and matches a schedulable node), `applySandbox` (sets `runtimeClassName` per image tier; `systemd: true` images become privileged only inside a sandbox, otherwise `ErrUnsupported`, and get a systemd readiness probe; annotation `labs.cloudtrain.dev/sandbox`) |
| `internal/drivers/catalog.go` | `systemd` field on catalog images; `tier` documented as functional with the flag |
| `internal/drivers/container.go`, `runtime.go` | `TierRuntimeClasses` option, `applySandbox` in `Provision` |
| `cmd/manager/main.go` | `--tier-runtime-classes`, startup detection and log |
| `deploy/charts/cloudtrain` | `orchestrator.tierRuntimeClasses` value, schema, arg |
| `deploy/scripts/orchestrator-deploy.sh` | `TIER_RUNTIME_CLASSES` env |

The fallback rewrite (6.2), the preflight section (6.3) and the kata-deploy
packaging (6.4) are not implemented.

## 7. Managed clouds

| | Kata offer | Hypervisor / guest | systemd tier-B pod | Lab kernel features | Caveats |
|---|---|---|---|---|---|
| **AKS** | **Pod Sandboxing**: node pool `--workload-runtime KataVmIsolation --os-sku AzureLinux`, RuntimeClass `kata-vm-isolation`, K8s >= 1.27 [D] ([use-pod-sandboxing](https://learn.microsoft.com/en-us/azure/aks/use-pod-sandboxing)) | Cloud Hypervisor on Microsoft Hyper-V (MSHV), guest kernel `6.6.x.mshv1` [D] | privileged pods allowed, root in the guest only, no host devices [D] ([considerations](https://learn.microsoft.com/en-us/azure/aks/considerations-pod-sandboxing)). The exec `EBUSY` fix depends on the AKS agent version [U] | **guest kernel is Microsoft's; cannot be replaced** [D/U]. GRE/bond/netem/md unknown until preflight runs there [U] | Azure Linux nodes only, Gen2 nested-virt sizes, no FIPS / Trusted Launch / Arm64, no host network. VM size = pod limit (default 512 Mi), overhead ~88 Mi by default [D]. Mixes with KubeVirt on the same nested-virt pool [U] |
| **GKE** | **GKE Sandbox `microvm`**: `gcloud container node-pools create --sandbox=type=microvm --enable-nested-virtualization`, RuntimeClass `microvm`, GKE >= 1.37.0-gke.4713000 [D] ([sandbox pods](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods), [how-to](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/sandbox-pods)) | Kata + Cloud Hypervisor, COS or Ubuntu nodes [D] | privileged allowed (guest root only) [D] | Google's guest kernel, not replaceable [U] | Requires **GKE 1.37**, while KubeVirt 1.9 supports 1.34-1.36 (`deploy/versions.env`), so a cluster running both tier B on microvm and tier C on KubeVirt needs a KubeVirt release that supports 1.37. GA status not stated [U]. No hostNetwork, 250 mCPU / 130 MiB fixed overhead [D]. **gVisor (`gvisor`, Autopilot default) is not an option for tier B**: no privileged, no sysctl, raw sockets need NET_RAW (blocked on Autopilot), COS only, a syscall subset [D]. It fits only tier A-like workloads |
| **EKS** | none managed. kata-deploy on **virtual C8i/M8i/R8i (and C7i/M7i/R7i) with nested virtualization** (ct-testvm is this case: r7i), or on `.metal` [D] ([EC2 nested virt](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html)) | our choice: clh-runtime-rs + lab kernel | yes (measured here) | yes (our kernel) | nested virt via launch template; managed node groups and Karpenter support is not settled ([any-kubernetes.md](any-kubernetes.md) 3.1). AL2023 nodes need `vhost_vsock` (and dbus is present). Firecracker would need a devmapper pool on instance storage |
| vCenter / bare metal | kata-deploy | clh-runtime-rs + lab kernel | yes | yes | vhv on worker VMs (same as KubeVirt) |

So on AKS and GKE, tier B gets Kata isolation but **not our kernel**. Preflight
(6.3) must test the provider's guest kernel against each lab's needs. Labs
that need missing features fall back to KubeVirt per lab (`requiredFeatures`
on the lab or image) rather than per cluster.

## 8. Recommendation and next steps

Recommendation: **go** for Kata as the tier-B substrate on self-managed
clusters and EKS, using `kata-clh-runtime-rs` + a CloudTrain lab guest kernel.
On AKS and GKE, use the provider's sandbox after preflight. Keep KubeVirt as
the fallback, and as the substrate for everything that needs reboots, modules
or SELinux.

Next steps, in order:

1. **Images:** build `deb-sys:24.04` and `el-sys:10` properly (from the
   mirror snapshot, `ct-sysinit` entrypoint, catalog `tier: B, systemd:
   true`), in CI (no KVM needed). Wire learner and admin ssh keys into
   container nodes the way cloud-init does for VMs, so `ssh <node>` from the
   jumphost works. Check that el-sys with systemd 257 (cgroup v1
   removed) behaves the same.
2. **Lab guest kernel:** a `tools/images/kata-kernel` build (Kata's config +
   the fragment from section 4.3), published as an OCI artifact. Add a
   `vhost_vsock` line to `host-prep.sh` and `tools/verify-vm/install.sh`.
3. **kind Kata profile on ct-testvm:** `KIND_PROFILE=kata` in `dev-up.sh`:
   kata-deploy 4.2.0 clh-runtime-rs, the `/dev/shm` and dbus node fixes,
   the kernel and drop-in. Then run `labctl verify` for tier-B labs on it nightly.
4. **Upstream:** file the kata-agent exec `EBUSY` issue for systemd containers
   (runc-style fallback to the init process's cgroup), so the image workaround
   can go.
5. **Orchestrator:** turn the prototype into `orchestrator.sandboxes`. Add
   the `vmFallback` rewrite (6.2), the preflight sandbox section (6.3) and
   tier-B capacity accounting in the gateway.
6. **Content:** re-tier the 150 tier-B labs. Reboot, module, GRUB and SELinux
   labs move to tier C. The rest get a Kata variant verified on the kata
   profile and keep passing on the VM fallback.
7. **Managed:** run the preflight sandbox probe on an AKS Pod Sandboxing pool
   and a GKE microvm pool to learn which lab features their guest kernels
   have, and fill in the [U] cells above.

## 9. Reproduce

Everything ran in `/srv/ct-work/dev/kata` on ct-testvm with its own kubeconfig
(`kata-spike/env.sh`). The heavy steps went through `tools/slots/run.sh`.

```bash
source env.sh                                                     # KUBECONFIG, CT_CLUSTER_NAME=ct-kata, KIND_CONFIG
modprobe vhost_vsock (via a privileged kind-node container)       # before the nodes start
tools/slots/run.sh vm -- deploy/scripts/dev-up.sh                 # kind-ct-kata.yaml
tools/slots/run.sh vm -- helm install kata-deploy oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy \
  --version 4.2.0 -n kube-system -f kata-values.yaml --wait
./node-fix.sh                                                     # /dev/shm, dbus (kind only)
./lat.sh / ./vmlat.sh / ./mem.sh / ./probe.sh / ./multus.sh / ./dind.sh
tools/slots/run.sh build -- ./build-kernel.sh                     # lab guest kernel
SESSION_SELECTOR=labs.cloudtrain.dev/verify=true LOAD_LAB_IMAGES=0 CATALOG_OVERLAY=catalog-kata.yaml \
  TIER_RUNTIME_CLASSES=B=kata-clh-runtime-rs tools/slots/run.sh build -- deploy/scripts/orchestrator-deploy.sh
tools/slots/run.sh vm -- bin/labctl verify --context kind-ct-kata --catalog catalog.yaml,catalog-kata.yaml <labs>
kind delete cluster --name ct-kata                                # done at the end of the spike
```
