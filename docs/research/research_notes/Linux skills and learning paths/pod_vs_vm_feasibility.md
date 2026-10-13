# Linux admin skills: unprivileged pod vs capability/sandboxed pod vs full VM (feasibility matrix)

Research date: 2026-10-14. Scope: lab platform running labs as K8s pods (runc locally, Kata Containers in production) plus full VMs via KubeVirt.

Note on sourcing: claims tagged with a link were checked in this session. Items under "Inferences" are reasoning from those sources plus standard Linux behaviour; the report writer should present them as engineering judgement, not as documented fact.

## Q1. What works fully in an unprivileged container (shell, text, files/permissions, users/groups, processes, scheduling, packages, archives, editors, git, scripting, ACLs, client networking)?

### Takeaway
Almost all "user-space" admin skills work authentically in an unprivileged pod, especially when the pod runs as root inside a user namespace (`hostUsers: false`, Stable since Kubernetes 1.36). That setup lets students do root work such as `useradd`, `chown`, package installs and `setfacl` without being root on the host. The real limits come from the kernel and the host: no real devices, no real network config, no cgroup or systemd control unless extra setup is done.

### Cited Findings
- User namespaces for pods are **Stable since Kubernetes v1.36**. The feature first appeared in 1.28, and the `UserNamespacesSupport` gate can no longer be disabled. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- A pod opts in with `spec.hostUsers: false`. `runAsUser: 0` is then root inside the container but unprivileged on the host. Each pod gets a non-overlapping host UID/GID range (0-65535 inside by default), and IDs outside the range appear as the overflow ID 65534. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- Requirements: Linux with idmap mounts (Linux 6.3+ for tmpfs), crun ≥1.9 (1.13+ recommended) or runc ≥1.2, and containerd ≥2.0 or CRI-O ≥1.25. cri-dockerd is not supported. Supported filesystems include btrfs, ext4, xfs, fat, tmpfs and overlayfs. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- With user namespaces, Pod Security Admission does **not** check `runAsNonRoot`/`runAsUser`, even under Baseline or Restricted. Root-in-container is therefore allowed in a Restricted namespace. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- The Baseline PSS allows adding only these capabilities: `AUDIT_WRITE, CHOWN, DAC_OVERRIDE, FOWNER, FSETID, KILL, MKNOD, NET_BIND_SERVICE, SETFCAP, SETGID, SETPCAP, SETUID, SYS_CHROOT`. — [K8s: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- ACLs on overlayfs: POSIX ACL support landed in overlayfs during the 4.8 cycle. It needed several regression fixes in 4.8/4.9. — [LKML overlayfs 4.8-rc4 pull](https://lkml.iu.edu/hypermail/linux/kernel/1609.0/01129.html); [LKML 4.9-rc3 pull](https://lkml.iu.edu/hypermail/linux/kernel/1611.0/02148.html)
- A later bug showed wrong UIDs from `getfacl` with idmapped lower layers under a container user namespace. As an interim step, SB_POSIXACL was disabled for idmapped layers until a VFS-level fix landed. — [lore.kernel.org: acl ownership in ovl](https://lore.kernel.org/all/YsXN4056AenjHap9@redhat.com/T/)

### Inferences
- **Fully authentic in an unprivileged pod (ideally root-in-userns):** bash/shell navigation; text processing (grep/sed/awk/sort/cut/find/xargs); files, permissions, umask, special bits (setuid/setgid/sticky); links; users and groups via `/etc/passwd`, `/etc/shadow`, `/etc/group`, `useradd/usermod/passwd/chage`, sudoers (container-local); processes and signals (`ps`, `top`, `kill`, `nice/renice`, `jobs/bg/fg`, `nohup`; PID namespace means students see only their own processes); archives and compression (tar/gzip/xz/zip); editors (vim/nano); git; bash/Python scripting; package managers (dnf/apt/zypper) if egress or a mirror/proxy is allowed; client networking (`curl`, `wget`, `dig`, `ssh`, `nc`, `ss`, `ip addr show` read-only); SSH between lab pods; log files in `/var/log` written by apps; `cron`/`at` if the daemon is started (cron works without systemd if crond runs as a foreground or supervised process).
- ACLs (`setfacl/getfacl`) should work on the overlayfs root and on emptyDir (ext4/xfs/tmpfs) on modern kernels. With user-namespace pods, test on the exact kernel because of the idmapped-layer ACL issue above. Unconfirmed for the current production kernel: **test it**.
- Without user namespaces, running as UID 0 in a plain runc pod violates the Restricted PSS and gives host root on breakout. So for "root skills" in runc pods, prefer `hostUsers: false` everywhere it is supported. Kata gives VM isolation regardless.
- `chown`, `useradd` and `passwd` need CHOWN/SETUID/SETGID/DAC_OVERRIDE/FOWNER. These are in the Baseline set and are in the default containerd capability set, but they are dropped under Restricted (drop ALL). Inside a user namespace these capabilities apply only to the pod.

### Gaps
- No primary source found specifically on ACL behaviour on current kernels (6.x) for overlayfs combined with idmapped mounts after the fix. Validate empirically.
- The "Stable in 1.36" status comes from the current docs page and was not cross-checked against the 1.36 release notes.

## Q2. systemd inside containers: can it run as PID 1 in an unprivileged pod, and what breaks?

### Takeaway
systemd can run as PID 1 in a container if the runtime provides a specific environment: a writable cgroup v2 hierarchy (delegated), tmpfs on /run and /tmp, `container=` env, `CAP_SYS_ADMIN` (ideally inside a user namespace), and SIGRTMIN+3 as the stop signal. Podman and Sysbox do this automatically. Vanilla Kubernetes with runc does **not**: it is doable but fiddly and was "experimental" in published write-ups. udev, real VTs, audit and devices never work in a container. **Kata is the easiest production path**, because systemd units, timers and journald in the guest VM behave normally (see Q6).

### Cited Findings
- systemd's container interface requires `/proc` and `/sys` pre-mounted, with `/sys` and `/proc/sys` read-only (`/proc/sys/net` may be writable with a netns). `/dev` must be a private tmpfs with null, zero, full, random, urandom, tty and ptmx, plus `/dev/console` bound to a TTY. The mount tree must be `MS_SHARED`. — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)
- The `container=<name>` env var for PID 1 makes `ConditionVirtualization=` work, and systemd copies it to `/run/systemd/container`. — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)
- Cgroups: mount the full hierarchy, not a subtree. The container's cgroup root should be delegated (`Delegate=yes`). — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)
- Capabilities: do not drop `CAP_SYS_ADMIN` (needed for `PrivateTmp=`, `ProtectSystem=`) or `CAP_MKNOD` (`PrivateDevices=`). Do not pass `CAP_AUDIT_CONTROL/READ/WRITE` because audit is not virtualized. Without SYS_ADMIN/MKNOD systemd disables sandboxing options. "User namespaces are the recommended way" to run without these host privileges. — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)
- In containers `systemd-udevd` refuses to start, device dependencies don't work, real VTs (`/dev/tty1`…) are unsupported (a single console shell is used unless `container_ttys` is set), and arbitrary/block devices are not supported. — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)
- Podman `--systemd=true` (the default) activates when the command is systemd or /sbin/init. It mounts tmpfs on `/run`, `/run/lock`, `/tmp` and `/var/lib/journal`, mounts `/sys/fs/cgroup` writable on cgroup v2, sets the stop signal to SIGRTMIN+3 and sets `container_uuid`. — [podman-run(1)](https://docs.podman.io/en/latest/markdown/podman-run.1.html)
- Sysbox runs systemd in system containers without privileged mode or special flags. It is described as "preliminary support", and units `systemd-journald-audit.socket`, `systemd-udev-trigger.service` and `systemd-networkd-wait-online.service` should be masked. — [Sysbox systemd doc](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/systemd.md)
- On cgroup v2, systemd needs the whole `/sys/fs/cgroup` writable, which breaks the old read-only-cgroup workaround. One OpenShift write-up ran systemd unprivileged by pairing cgroup v2 with CRI-O user namespaces (`userns-mode: auto` annotation, anyuid SCC, all capabilities dropped), and called it experimental (2022). — [NetEye blog part 1](https://www.neteye-blog.com/2022/10/my-openshift-journey-4-run-unprivileged-containers-with-systemd-in-openshift-part-1-deployment/); [LewisGaul/systemd-containers](https://github.com/LewisGaul/systemd-containers)
- A Red Hat issue reports rootless Podman with systemd failing because the pids controller was not delegated to unprivileged users. — [RHEL-5870](https://issues.redhat.com/browse/RHEL-5870)

### Inferences
- **Works in a container with correct setup:** `systemctl start/stop/enable`, custom unit files, `systemctl daemon-reload`, timers (`systemd.timer`), `journalctl` (journald runs; no kernel/audit messages), targets such as `multi-user.target`, user/service management, `hostnamectl` partially (UTS namespace), `loginctl` partially.
- **Breaks or is fake in a container:** udev and `.device` units, `.mount` units for real block devices, `.swap` units, `rescue.target`/`emergency.target` (no real boot), `systemctl reboot/poweroff` (stops the container), `timedatectl set-time`, `systemd-modules-load`, the kernel ring buffer in journal, `journald-audit`, `systemd-networkd` (unless NET_ADMIN), and resource control on slices (only within the delegated cgroup).
- For runc on K8s, the realistic recipe is CRI-O (which has a built-in "systemd mode" that mounts tmpfs and cgroups when the entrypoint is init) or containerd with user namespaces plus extra emptyDir tmpfs mounts. Expect per-runtime tinkering. For **Kata**, systemd runs inside the guest VM (see Q6), which removes most host-interface issues. This is an inference: test it, but the risk is lower.
- Recommendation: treat "systemd basics" (unit files, timers, journalctl, enable/disable) as **pod-capable on Kata** (and on Podman/Sysbox for local dev), and as **VM-only for boot targets**.

### Gaps
- No current (2025-2026) official Kubernetes or containerd doc found that gives a supported recipe for systemd-as-PID-1 in a runc pod. The CRI-O systemd-mode behaviour was not verified against current CRI-O docs in this session.
- Sysbox maintenance status (the project was acquired by Docker in 2022) was not verified. The fetched page did not state it.

## Q3. Which tasks need capabilities (NET_ADMIN, SYS_ADMIN, SYS_TIME, SYS_MODULE, sysctl)?

### Takeaway
Network configuration labs (ip addr/route, nftables/iptables, tc, bridges, VLAN, netns) work in a pod with `NET_ADMIN` because they act on the pod's own network namespace. Inside a user namespace or Kata this is reasonably safe. `SYS_MODULE` and `SYS_TIME` cannot be safely given in a shared-kernel pod: modules are host-global (and blocked in userns), and the realtime clock is not namespaced. Sysctls: only namespaced ones can be set per pod, and Kubernetes allows a small "safe" set by default. Under Kata all of these act on the guest kernel only.

### Cited Findings
- Capabilities granted in a userns pod apply only within that namespace. `CAP_SYS_MODULE` has no effect (cannot load modules), and `CAP_SYS_ADMIN` is limited to the pod's namespaces. Without userns, a root breakout gives host root and capabilities apply on the host. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- Time namespaces virtualize only CLOCK_MONOTONIC* and CLOCK_BOOTTIME*: "time namespaces do not virtualize the CLOCK_REALTIME clock." — [man7 time_namespaces(7)](https://man7.org/linux/man-pages/man7/time_namespaces.7.html)
- Kubernetes **safe sysctls** (enabled by default): `kernel.shm_rmid_forced`, `net.ipv4.ip_local_port_range`, `net.ipv4.tcp_syncookies`, `net.ipv4.ping_group_range` (1.18), `net.ipv4.ip_unprivileged_port_start` (1.22), `net.ipv4.ip_local_reserved_ports` (1.27), `tcp_keepalive_time/intvl/probes`, `tcp_fin_timeout` (1.29), `tcp_rmem/tcp_wmem` (1.32), `tcp_slow_start_after_idle`, `tcp_notsent_lowat` (1.37). — [K8s: Using sysctls](https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/)
- Only **namespaced** sysctls can be set via pod `securityContext.sysctls`: `kernel.shm*`, `kernel.msg*`, `kernel.sem`, `fs.mqueue.*`, and netns-scoped `net.*`. Node-level sysctls require node configuration or privileged DaemonSets. Unsafe namespaced sysctls need kubelet `--allowed-unsafe-sysctls`, and pods that use disallowed ones are scheduled but fail to launch. The docs recommend tainting nodes that allow them. — [K8s: Using sysctls](https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/)
- `net.*` sysctls are not allowed with hostNetwork. `net.netfilter.nf_conntrack_max` was not namespaced before Linux 5.12.2. — [K8s: Using sysctls](https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/)
- NET_ADMIN, SYS_ADMIN, SYS_TIME and SYS_MODULE are **not** in the Baseline allowed-add list, so any pod using them requires a Privileged-level PSS namespace (or a custom admission policy). — [K8s: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)

### Inferences
- **NET_ADMIN (+ NET_RAW) in the pod netns:** `ip addr add`, `ip route`, `ip link add type bridge/vlan/veth/dummy`, `ip netns add` (also needs SYS_ADMIN for the bind-mount of `/run/netns`), nftables/iptables rules, `tc qdisc` (needs sch_* modules already loaded on the host when using runc), and `nmcli`/NetworkManager (needs systemd/dbus). Caveats under runc: changing eth0's address or routes breaks the CNI-assigned pod networking, and the kernel modules (e.g. `8021q`, `bridge`, `nf_tables`, `sch_netem`) must already be present on the host. Under Kata, these modules must be built into or loadable in the guest kernel.
- **Teaching firewalls with NET_ADMIN:** rules apply to the pod netns only, so it is safe for the host but can cut the student's own web-terminal connection. Use an out-of-band terminal (kubectl exec / console) or a second interface.
- **SYS_ADMIN:** needed for `mount` (tmpfs, bind, loop), `unshare`, `ip netns`, and `swapon`. In a runc pod without userns this is close to privileged and a well-known escape vector. In userns, mount of most real filesystems is still refused by the kernel (only "userns-mountable" filesystems such as tmpfs, overlay, proc and fuse are allowed). Real `mount /dev/xxx` therefore effectively needs Kata or a VM.
- **SYS_TIME:** `date -s`, `hwclock`, and chrony stepping the clock change the **host** clock under runc, so never grant it. Teach `timedatectl` and chrony config as read-only/config-file exercises in pods. Clock setting under Kata affects only the guest. The guest clock may be re-synced, so confirm empirically.
- **SYS_MODULE:** never in shared-kernel pods. `lsmod`/`modinfo` read-only is fine. `modprobe` is VM-only (or Kata with a modular guest kernel; see Q6).

### Gaps
- No source fetched for the exact capability set of `ip netns add` or for the userns-mountable filesystem list. These are from general Linux knowledge (capabilities(7), FS_USERNS_MOUNT flag) and should be confirmed.
- Behaviour of `date -s` / clock stepping inside a Kata guest (kvm-clock / guest time sync) was not verified.

## Q4. Storage: partitioning, LVM, mkfs, mount/fstab, swap, RAID, quotas, NFS/autofs, Stratis: pods with loop devices, or VMs only?

### Takeaway
Loop devices are **not namespaced**. Exposing `/dev/loop-control` or loop devices to a runc pod needs privileged mode and leaks host-global state, so block-storage labs in runc pods are unsafe for multi-tenant use. In Kata they become feasible because the guest kernel owns its own loop/dm/md devices, and extra virtio block devices can be attached. A KubeVirt VM gives the most authentic experience (real extra disks, fstab across reboot, boot-time mount failures).

### Cited Findings
- Loop devices aren't namespaced. Handing a host loop device into a container lets the container observe what the host and other containers do with it. Bind-mounting devtmpfs is insecure. The proposed "loopfs" (2020, v2/v3 patches) would give per-container loop devices. — [LKML loopfs v2](https://lkml.iu.edu/hypermail/linux/kernel/2004.2/10825.html); [LKML loopfs v2 0/7](https://lkml.iu.edu/hypermail/linux/kernel/2004.2/09381.html)
- An LXC maintainer: "there aren't any ideal solutions for loop devices as they're not namespaced". The working setup needed a privileged profile with AppArmor unconfined. — [linuxcontainers forum](https://discuss.linuxcontainers.org/t/providing-access-to-loop-and-other-devices-in-containers/1352)
- K8s user-namespace pods cannot use `volumeDevices` (raw block volumes), and NFS volumes cannot be mounted in a userns pod because the NFS client doesn't support idmap mounts. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- Kata: a hostPath of type BlockDevice is hot-plugged into the guest and exposed to the container. Privileged containers in Kata get elevated capabilities inside the guest. — [Kata Limitations](https://github.com/kata-containers/kata-containers/blob/main/docs/Limitations.md)
- Kata `privileged_without_host_devices=true` stops host devices from being hot-plugged even for privileged containers, but "does not stop the container from mounting guest devices". kata-deploy applies it by default. — [Kata privileged how-to](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/privileged.md)
- Kata: block-backed emptyDir ignores `sizeLimit` for device size, and `subPath` is unsupported. — [Kata Limitations](https://github.com/kata-containers/kata-containers/blob/main/docs/Limitations.md)
- Sysbox: mounting rpc-pipefs fails (no NFS server inside the container), and `mknod` fails. — [Sysbox limitations](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/limitations.md)
- gVisor cannot mount block-device filesystems (ext4/ext3/fat32) inside the sandbox. — [gVisor compatibility](https://gvisor.dev/docs/user_guide/compatibility/)

### Inferences
- **In an unprivileged pod, teach only:** `df`, `du`, `lsblk`/`findmnt` (read-only and misleading, since they show host devices), fstab syntax by reading and validating, `quota` concepts, and file-backed images manipulated with `fdisk`/`sfdisk`/`parted` **on a regular file** (partitioning a disk image file works without privileges; `mkfs.ext4 file.img` also works on a plain file without loop). `mke2fs -d`, `mtools` and `guestfish`/libguestfs (it uses its own appliance VM) are other unprivileged options.
- **Privileged Kata pod (guest kernel) — plausible:** `losetup`, `fdisk`/`parted` on loop or extra virtio disks, `pvcreate`/`vgcreate`/`lvcreate` (needs device-mapper in the guest kernel and udev/lvm config tweaks such as `udev_sync=0`), `mkfs`, `mount`, `swapon` on a file or partition, `mdadm` (needs md/raid modules in the guest kernel), quotas (needs quota support in the guest kernel), and an NFS client (needs nfs in the guest kernel). Each depends on the **guest kernel config**, and Kata's default kernel is minimal (see Q6). Verify each with a smoke test.
- **VM (KubeVirt) recommended for:** fstab persistence across a real reboot, `_netdev`/`nofail` boot behaviour, LVM on real extra disks with resize (`lvextend -r`), Stratis (needs a stratisd daemon, systemd and dm-thin), autofs plus an NFS server, and RAID failure/rebuild scenarios. In short, anything RHCSA-style where the grader reboots.
- **Risk:** in runc, any privileged pod with loop/dm access can see other tenants' loop devices and can exhaust host loop/dm minors. Avoid it for multi-tenant labs.

### Gaps
- Whether loopfs was ever merged was not confirmed in this session. General knowledge says it was not merged, but this needs a source.
- No source fetched on the Kata default guest kernel's config for dm, md, quota, nfs or loop. Inspect `kata-containers/tools/packaging/kernel/configs` for the deployed version.

## Q5. Boot and kernel (GRUB, initramfs, kernel params, modules, rescue/emergency targets, root password recovery): VM only?

### Takeaway
Yes. Anything involving the bootloader, initramfs or the boot sequence needs a real VM (KubeVirt). Containers have no boot process. Kata boots its own guest kernel directly from hypervisor-supplied assets, with no GRUB and no student-controlled initramfs, so it cannot teach these skills either.

### Cited Findings
- The Kata guest kernel and image/initrd are "guest assets … used by the hypervisor". The rootfs image is a mini OS booted with systemd as PID 1 that launches the agent. With an initrd, the agent itself is PID 1. — [Kata guest-assets](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/guest-assets.md)
- Kata's default kernel is "highly optimized for kernel boot time and minimal memory footprint", based on the latest LTS. — [Kata guest-assets](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/guest-assets.md)
- Kata's `kernel_params` annotation is in the default `enable_annotations` allowlist (as quoted in a 2026 CVE write-up), so admins can allow per-pod kernel command-line additions. — [vuln.today CVE-2026-44210 write-up](https://vuln.today/cve/CVE-2026-44210) (secondary source; verify in configuration-*.toml)
- Containers cannot use real VTs or udev, and systemd in a container is not booted by a kernel. — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)

### Inferences
- **VM-only (KubeVirt):** GRUB2 configuration and `grub2-mkconfig`/`grubby`; default kernel selection; kernel command-line parameters (`rd.break`, `systemd.unit=rescue.target`, `init=/bin/bash`); `dracut`/`mkinitramfs` and initramfs debugging; root password recovery (needs interactive access to the boot menu via KubeVirt VNC/serial console: `virtctl console`/`vnc`); `rescue.target`/`emergency.target`; broken-fstab recovery; kernel install/update and switching; `modprobe`/blacklist/`/etc/modules-load.d` persistence; kdump; persistent sysctl in `/etc/sysctl.d` verified after reboot; SELinux relabel (`/.autorelabel`).
- KubeVirt VMs must allow the student console access (serial or VNC) to reach the GRUB menu. Plan the web console to proxy `virtctl vnc/console`, and use EFI or BIOS consistently in images.

### Gaps
- Kata's `kernel_modules` annotation is not in the default allowlist according to the same secondary source. Confirm against the deployed Kata 3.x `configuration.toml`.

## Q6. Security modules (SELinux, AppArmor, auditd, firewalld)

### Takeaway
SELinux and AppArmor are host-kernel LSMs. In a runc pod, students cannot load policies, toggle enforcing or run `semanage`, and they see the container as disabled or confined. auditd requires CAP_AUDIT_CONTROL, and audit is not virtualized, so never grant it in shared-kernel pods. firewalld needs systemd, D-Bus and NET_ADMIN, so it works only in a systemd-capable netns setup. Realistic SELinux/auditd labs need a VM. Kata might work if its guest kernel has SELinux/audit enabled, but this is unverified and unlikely by default.

### Cited Findings
- Do not pass `CAP_AUDIT_CONTROL`, `CAP_AUDIT_READ` or `CAP_AUDIT_WRITE` to systemd containers because audit is not virtualized. — [systemd.io CONTAINER_INTERFACE](https://systemd.io/CONTAINER_INTERFACE/)
- Sysbox requires masking `systemd-journald-audit.socket`. — [Sysbox systemd doc](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/systemd.md)
- Baseline PSS limits SELinux `type` to `container_t`, `container_init_t`, `container_kvm_t` or `container_engine_t`, and AppArmor to RuntimeDefault/Localhost. — [K8s: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- gVisor's iptables support is partial (aimed at Docker) and its nftables support is limited. — [gVisor compatibility](https://gvisor.dev/docs/user_guide/compatibility/)

### Inferences
- **Pod-feasible (read/config-level):** reading SELinux contexts (`ls -Z` shows the container label if the host uses SELinux), writing AppArmor profile syntax (not loading it), `firewall-cmd` in a Kata pod with systemd, dbus and NET_ADMIN (likely feasible; test).
- **VM-only:** `setenforce`, `semanage fcontext/port`, `restorecon` with real effect, booleans (`setsebool -P`), troubleshooting AVC denials with `ausearch`/`sealert`, auditd rules (`auditctl`, `/etc/audit/rules.d`), AppArmor `aa-enforce/aa-complain`, and firewalld zones that persist across reboot.

### Gaps
- Whether Kata's default guest kernel enables CONFIG_SECURITY_SELINUX or CONFIG_AUDIT is unverified.

## Q7. Kata Containers specifics, and gVisor and Sysbox compared

### Takeaway
Each Kata pod is a lightweight VM with **its own guest kernel instance**. Privileged operations (mount, sysctls, NET_ADMIN, losetup, systemd as PID 1) then act on that guest, not the host. Two limits matter: the guest kernel is the same minimal image for all pods using a RuntimeClass, so modules and features are limited to what it was built with, and privileged Kata pods must keep `privileged_without_host_devices=true`. gVisor is less compatible for admin labs (no block mounts, partial netfilter). Sysbox provides "system containers" with systemd but no kernel modules, no NFS server and no mknod. Its long-term status should be checked.

### Cited Findings
- Kata: each container or pod runs in its own hardware-isolated VM, and "each VM has its own kernel". Privileged containers get elevated capabilities inside the guest. Passing host devices to privileged containers by default is unsupported and must be disabled. — [Kata Limitations](https://github.com/kata-containers/kata-containers/blob/main/docs/Limitations.md)
- Privileged Kata containers "can decrease the security of Kata Containers if not configured correctly". `privileged_without_host_devices=true` (containerd ≥1.3, CRI-O ≥1.16) prevents hot-plugging host devices and is set automatically by kata-deploy. — [Kata privileged how-to](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/privileged.md)
- Kata limitations: no host networking, no joining another container's netns, no `subPath`, no checkpoint/restore, Podman unsupported, some `/proc`/`/sys` bind mounts blocked, and hostPath shared only with `shared_fs`. — [Kata Limitations](https://github.com/kata-containers/kata-containers/blob/main/docs/Limitations.md)
- Kata guest assets: rootfs image (default Ubuntu on x86_64, systemd as PID 1) or initrd (default Alpine, agent as PID 1). The kernel is minimal and LTS-based. — [Kata guest-assets](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/guest-assets.md)
- The OCI bundle is shared into the VM using virtio-fs. — [Kata architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/README.md)
- Kata annotation `io.katacontainers.config.agent.kernel_modules` loads listed modules in the guest via modprobe. It requires containerd `pod_annotations` passthrough and must be in Kata's `enable_annotations`. One user report needed the matching module files inside the guest. — [Kata sandbox config how-to](https://github.com/kata-containers/documentation/blob/master/how-to/how-to-set-sandbox-config-kata.md); [Aliyun user report](https://developer.aliyun.com/ask/511912); [CVE-2026-44210 write-up](https://vuln.today/cve/CVE-2026-44210)
- gVisor: large syscall coverage; no mounting ext4/ext3/fat inside the sandbox; partial iptables; limited nftables; cgroups accounting-only inside the sandbox; no custom devices; no nested KVM. "The only real way to know if it will work is to try." — [gVisor compatibility](https://gvisor.dev/docs/user_guide/compatibility/)
- Sysbox: no kernel module loading (`insmod` fails "operation not permitted"); no nested userns via `unshare -U --mount-proc`; no rpc-pipefs (NFS server); no `mknod` (/dev/tun, /dev/fuse); must run as root on the host; K8s pods cannot be privileged or use host namespaces. — [Sysbox limitations](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/limitations.md)

### Inferences
- **Kata is the sweet spot for this platform:** it makes "root-ish" labs (systemd units and timers, NET_ADMIN networking, firewalls, sysctl, losetup/LVM/mkfs/mount on guest-only loop or virtio devices, swap on a file) safe-ish for multi-tenant use, because the blast radius is the guest VM. Requirements:
  1. a dedicated RuntimeClass (e.g. `kata-lab`) with a **custom guest kernel and rootfs** built with dm, md/raid, loop, quota, nfs, bridge, 8021q, nf_tables, netem and similar options, either built-in or as modules shipped in the guest image;
  2. `privileged_without_host_devices=true`;
  3. a namespace PSS of `privileged` for those labs, compensated by Kata isolation plus admission policies (Kyverno/ValidatingAdmissionPolicy) that only allow privileged pods with `runtimeClassName: kata-lab`.
- In Kata, the student's container is still a container inside the guest: the student does not see the guest's PID 1 unless the image runs systemd as the container entrypoint. "Your own kernel" applies to sysctl and module operations, not to a GRUB/boot experience.
- Using a custom kernel per RuntimeClass (not per pod) is the practical model. A per-pod kernel via annotations (`kernel` path) is possible only if allow-listed, which widens attack surface.
- gVisor: not recommended for admin labs (storage, netfilter and systemd gaps). It is good only for "user-space skills" pods if extra isolation is wanted without VMs.
- Sysbox: convenient for local dev (systemd, Docker-in-Docker), but it has no module/NFS-server support and needs a host-root daemon. It is mostly redundant if Kata is used in production.

### Gaps
- Not verified: whether Kata 3.x supports hot-plugging extra emptyDir-backed or PVC-backed raw block devices (`volumeDevices`) into the guest for "add a second disk" labs. Kata documents BlockDevice hostPath hotplug. PVC raw block via CSI should be tested.
- Nested-virtualization requirement for Kata on a vCenter-hosted cluster (Kata needs /dev/kvm on worker nodes, which means nested VT-x in ESXi VMs) was not researched here. This is critical for the user's environment.

## Q8. Security implications of granting privileges in multi-tenant labs; recommended isolation

### Takeaway
In shared-kernel runc pods, anything beyond the Baseline capabilities (NET_ADMIN, SYS_ADMIN, privileged, loop devices, SYS_TIME, SYS_MODULE) is a host-level risk. Use `hostUsers: false` for all lab pods (Stable in 1.36). It makes root-in-pod and namespaced capabilities much safer and is accepted by Restricted/Baseline PSS for runAsUser/runAsNonRoot. Anything privileged should go to Kata (VM boundary), and anything boot-related to KubeVirt.

### Cited Findings
- Without user namespaces, root breakout means host root and capabilities apply to the host. With userns, `CAP_SYS_MODULE` has no effect and `CAP_SYS_ADMIN` is namespace-scoped. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- Userns pods cannot use hostNetwork, hostIPC, hostPID or `volumeDevices`, and cannot mount NFS volumes. — [K8s: User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- PSS Baseline forbids privileged pods, hostPath, host namespaces, non-default procMount and Unconfined seccomp, and allows only a fixed capability-add list. — [K8s: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- Unsafe sysctls can cause "container misbehavior, resource shortage, or node breakage". The docs recommend dedicated tainted nodes. — [K8s: Using sysctls](https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/)
- Loop devices are not namespaced, so access leaks cross-tenant state. — [LKML loopfs](https://lkml.iu.edu/hypermail/linux/kernel/2004.2/10825.html)
- Kata privileged pods reduce security if host devices are passed in, which kata-deploy disables by default. — [Kata privileged how-to](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/privileged.md)

### Inferences
- Recommended tiering:
  - **Tier A:** runc or Kata, `hostUsers: false`, Restricted or Baseline PSS, default seccomp, NetworkPolicy egress limited to a package mirror.
  - **Tier B:** Kata only, privileged or NET_ADMIN+SYS_ADMIN, `privileged_without_host_devices`, dedicated node pool and RuntimeClass, admission rule that privileged ⇒ Kata.
  - **Tier C:** KubeVirt VM with its own NetworkPolicy/Multus network and console proxy.
- Always add per-namespace ResourceQuota/LimitRange, pod `activeDeadlineSeconds`/TTL cleanup, and egress NetworkPolicies. Lab students with root can run crypto-miners or scanners.
- With NET_ADMIN, students can spoof traffic within the pod netns and send arbitrary packets onto the CNI network. Apply NetworkPolicy and consider anti-spoofing CNI features.
- Note for local dev: runc plus userns requires containerd ≥2.0 or CRI-O and kernel ≥6.3. kind/k3d on WSL2 kernels (6.x) should satisfy this, but test.

### Gaps
- No primary source fetched for the Restricted PSS capability rule (drop ALL, add only NET_BIND_SERVICE). The fetched text was truncated, and this comes from general knowledge.

## Q9. Startup time and density trade-offs (container vs Kata vs KubeVirt)

### Takeaway
Order of magnitude: runc pods start in sub-second to a few seconds (mostly image pull). Kata adds roughly hundreds of milliseconds to a few seconds of VM boot and around 100-250 MB of extra memory per pod (secondary sources, inconsistent). KubeVirt VMs need a full guest OS boot (tens of seconds) plus a full OS memory footprint, and the KubeVirt control plane becomes a bottleneck at high VM density. No rigorous, current primary benchmark was found. Measure on the target hardware.

### Cited Findings
- One secondary article: Kata pod ~450 MB vs ~200 MB for runc (same workload), and a 2-5% CPU penalty, with no stated methodology. Another table: Kata startup ~150-400 ms vs 30-100 ms for runc, also without methodology. The sources disagree. — [admin-magazine](https://admin-magazine.com/Articles/Isolate-workloads-from-Docker-and-Kubernetes-with-Kata-Containers/(offset)/3); [jacar.es](https://jacar.es/en/kata-containers-strong-isolation-with-a-docker-like-experience/)
- StackHPC fio: Kata I/O overhead significant vs runc. p50 sequential-read latency ~4,112 µs vs ~2,007 µs, attributed largely to virtio-9p (older shared-fs; virtio-fs is the current default). — [StackHPC Kata IO](https://www.stackhpc.com/kata-io-1.html)
- KubeVirt: a VM is not "ready" until the guest OS and services are up, unlike a pod whose process just starts. Portworx publishes a benchmark toolkit (100-VM burst scenarios). — [Portworx](https://portworx.com/?p=40285)
- Red Hat's kube-burner KubeVirt density tests use containerDisk Fedora VMs (1 vCPU / 4 GiB). The metric `kubevirt_vmi_phase_transition_time_from_creation_seconds` gives creation-to-phase latency. — [Red Hat blog](https://www.redhat.com/en/blog/introducing-kubevirts-crd-support-for-kube-burner-to-benchmark-kubernetes-and-openshift-creation-of-vms)
- IBM Research: a 400-VMI single-node test found the KubeVirt control plane becomes a bottleneck as VMs per node increase. — [IBM Research](https://research.ibm.com/publications/kubevirt-scale-test-by-creating-400-vmis-on-a-single-node)

### Inferences
- Density planning heuristics (to validate):
  - runc lab pod ≈ 50-200 MB RAM;
  - Kata lab pod ≈ +150-300 MB guest overhead (memory is configurable via `default_memory`);
  - KubeVirt RHEL-like VM ≈ 1-2 GiB minimum, plus the virt-launcher pod overhead.
  - Roughly 5-20 Kata pods fit per VM-lab-equivalent.
- To make KubeVirt labs feel fast: pre-warmed VM pools (VirtualMachinePools / pre-started VMs assigned on demand), small cloud images with cloud-init, containerDisk images cached on nodes, and DataVolume clones via CSI snapshot (smart clone) rather than full copies.
- Assignment rule: choose the cheapest tier that keeps authenticity. Roughly 70-80% of an RHCSA/LFCS-style curriculum (by topic count) fits Tier A or B, and the remainder (boot, SELinux, persistent storage/reboot grading) needs Tier C. This is an estimate from the matrix below, not a sourced figure.

### Gaps
- No authoritative 2025-2026 benchmark of Kata 3.x (Cloud Hypervisor/QEMU, virtio-fs) startup and memory overhead, or of KubeVirt VM boot time at density. Benchmark in-house.

---

### Feasibility matrix (synthesis; inference based on findings above)

Legend:
- **A** = unprivileged pod (runc or Kata, `hostUsers: false`, Baseline/Restricted).
- **B** = Kata pod with extra capabilities or privileged (guest kernel; `privileged_without_host_devices`). Feasible in runc only with a host-level risk.
- **C** = KubeVirt VM.
- "partial" = works but is not authentic.

| Skill area | Cheapest authentic tier | Notes |
|---|---|---|
| Shell, navigation, globbing, I/O redirection, pipes | A | |
| Text processing (grep/sed/awk/sort/cut/tr/find/xargs), regex | A | |
| Files, permissions, umask, SUID/SGID/sticky, links | A | |
| ACLs (setfacl/getfacl) | A (verify FS) | overlayfs/emptyDir support ACLs. Check the userns + idmapped interaction. |
| Users/groups, passwd/shadow, sudoers, chage | A (root-in-userns) | Container-local identities only. No PAM/SSSD/LDAP realism unless a directory is provided. |
| Processes, signals, nice, jobs, /proc | A | PID namespace view only |
| cron / at | A | Needs crond running (supervisor or systemd) |
| Package management (dnf/apt/rpm/dpkg), repos | A | Needs egress or a mirror. Kernel packages are meaningless. |
| Archives, compression, rsync, scp | A | |
| Editors, git, bash/Python scripting | A | |
| SSH client/server, keys, sshd_config | A (B if sshd via systemd) | sshd can run directly as a process |
| Networking client tools (ping, ss, curl, dig, traceroute) | A | ping needs `net.ipv4.ping_group_range` (safe sysctl) or NET_RAW |
| systemd units, timers, journalctl, enable/disable | B (Kata with systemd entrypoint); Podman/Sysbox locally | udev, devices, reboot and audit not available |
| Boot targets, rescue/emergency, systemctl reboot | C | |
| ip addr/route/link, bridges, VLANs, veth, netns | B (NET_ADMIN (+SYS_ADMIN for netns)) | Modules needed in the host or guest kernel. Do not touch eth0 or the CNI routes. |
| nftables/iptables, firewalld | B (firewalld also needs systemd + dbus) | Persistent zones across reboot: C |
| tc / netem | B | sch_netem module required |
| NetworkManager/nmcli persistent config | C (B partial) | |
| Namespaced sysctls (net.*, kernel.shm*) | A (safe list) / B (unsafe list via kubelet allowlist or Kata) | |
| Global sysctls (vm.*, kernel.* non-ns) persistence | B (Kata guest) / C | Never on runc nodes |
| date/time setting, chrony stepping | C (B on Kata, unverified) | CLOCK_REALTIME is not namespaced, so never use SYS_TIME on runc |
| Kernel modules (modprobe, blacklist, modules-load.d) | C (B only with a modular custom Kata guest kernel) | |
| fdisk/parted/mkfs on an image *file* | A | No mount |
| losetup, mount, fstab (non-boot), swap file | B (Kata) | Loop devices are not namespaced: never on runc multi-tenant |
| LVM, mdadm RAID, quotas | B (Kata with a custom guest kernel) / C | C for resize and reboot persistence |
| Stratis, VDO | C | Needs stratisd/systemd, dm-thin |
| NFS client / autofs | B (Kata, nfs in guest kernel) / C | NFS volumes impossible in userns pods |
| NFS server | C | Sysbox explicitly can't. Kata unverified. |
| GRUB, kernel params, initramfs/dracut, root password recovery | C | Needs VNC/serial console |
| SELinux (enforcing, contexts, booleans, semanage) | C | Host LSM in pods |
| AppArmor profiles | C | |
| auditd | C | Audit not virtualized |
| Containers-in-lab (podman/docker in lab) | B (Kata) / Sysbox locally | |
| Performance and troubleshooting (top, vmstat, iostat, sar) | A (partial: host-wide numbers) / C | Containers see host /proc/meminfo unless lxcfs. Kata shows guest values. |
