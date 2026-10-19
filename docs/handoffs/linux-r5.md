# Handoff: Linux round 5 (summary, state as of 2026-10-19)

Per-wave detail stays in `linux-r5-w1.md`, `linux-r5-w2.md`, `linux-r5-w3.md` and `linux-r5-w4.md`. The source of truth
for each lab's state is `status` / `notes` in `content/curriculum.yaml`. Nothing in round 5 was run
live on the authoring machine (rule of 2026-10-18); every `verified` below was set by the remote
verify VM batch runner, which re-verifies built labs from origin/main after each merge.

## Merged

| Wave | PR | Scope | Labs | Verified | Built |
|---|---|---|---|---|---|
| 1 | #69 | tier-A learning labs (mirror, servers, certificates, files) | 24 | 22 | 2 |
| 2 | #115 | sim-linux-pro pools (system-management, services-users, automation-scripting) | 24 | 14 | 10 |
| 3 | #122 | sim-linux-pro security and troubleshooting, xpe host tasks, disk-pressure labs | 22 | 0 | 22 |
| Total | | | 70 | 36 | 34 |

sim-linux-pro is complete: all five pools hold at least 2x their draw and the exam compiles
without `--allow-missing` (it is in the CI compile step). Wave 3 also fixed the gateway exam test
that still assumed sim-linux-pro was coming-soon.

## Wave 4 and follow-ups (state 2026-10-19)

- Wave 4 is merged as PR #143: 23 networking labs on VMs, all `built`, none run live; handoff
  `docs/handoffs/linux-r5-w4.md`. Before merge it got a strict self-review that fixed three major
  defects (nftables-from-scratch negative checks, netem-impaired-link eth0 guard, wireguard-depot-tunnel
  netdev parser) and added the ip-config skill tag to two checks; the remaining minors are listed in
  its Review follow-ups. 2 of the 23 are blocked: iperf-throughput-baseline (iperf3 not in the
  mirrors: add it to `tools/mirrors/packages-*.txt` and rebuild the VM image) and
  netem-impaired-link (sch_netem lives in linux-modules-extra / kernel-modules-extra, which are not
  mirrored); both are recorded as BLOCKED in their curriculum notes. The wave 4 labs join the verify queue.
- PR #161 (wave 3 follow-up) is merged: exact-address hosts pin check in xlp-fix-dns-client (its
  redundant nsswitch-only misconception is removed; pins-hosts and no-search remain),
  StartLimitIntervalSec=0 on the broken units (xlp-fix-unit-start, xlp-fix-oom-service),
  tracer-running check in xpe-incident-disk-pressure, port verified in xlp-fix-permission-denied
  app-reads. It changed those labs' hashes, so they need a re-verify.
- Verify-VM follow-ups: fix PRs #176, #178 and #168 and the verified-sync PR #179 are merged; #167
  (xlf-lvm-grow-fs) and #177 (xlp-netplan-address, in this round's queue) were still open. Trust
  `status` in `content/curriculum.yaml` for the current queue.
- PR #114 (containers) and PR #84 (automation) belong to other domains and were not touched.

## VM verify results since the wave 3 merge

The verify VM found three real lab bugs, each fixed on main (fix PRs #130, #132, #133, and the
`passes live verify` commits for the same labs): postfix-relay-alerts, signal-box-levels-3 and
xlp-sed-bulk-edit (setup used `$sp600` / `$sp3` under `set -u`; now `${sp}600` / `${sp}3`). The
batch commit d84ac94 marked 30 Linux labs verified in total. All 34 round-5 labs on main are
still `built` in `content/curriculum.yaml`: wave 3 has had no full pass recorded at the current lab
hash, and the three fixed labs changed hash, so they need a new pass. Those 34 are the verify
queue below.

## Blockers per lab

Merged labs: no lab is blocked on a missing image, Kata or kubeadm. Environment risks only:

- postfix-relay-alerts (built, pod): grader polls the relay up to 40 s; slow.
- xlp-container-network: builds an offline podman image from the local dnf repo with
  `dnf --installroot`.
- xlp-cloud-init-userdata (verified) installs cloud-init from the mirror; xlp-fix-time-skew uses a
  stdlib Python NTP responder in a namespace.
- xlp-luks-open-mount needs `cryptsetup` on ubuntu-vm; xlp-module-info needs the `brd` and `dummy`
  modules in the ubuntu-vm kernel.
- xpe-host-baseline-service, xpe-host-disk-and-mount, xpe-incident-disk-pressure use the shared
  sim-platform-engineer VM block (jumphost + qm-build-1/2, 2 disks). The two automation tasks
  xpe-ansible-node-agents and xpe-ansible-ssh-hardening still declare `{cpu 1, memoryMiB 1280}` with
  no disks and must adopt that block before sim-platform-engineer compiles (that exam is `proposed`
  and not in CI).
- Not written: el variants of packages-install-from-mirror and package-repo-pinning
  (`python3-dnf-plugin-versionlock` is not mirrored).

Blockers recorded with wave 4, both cleared on 2026-10-19 (curriculum notes updated): iperf-throughput-baseline needed iperf3, now in both package lists
(`packages-noble.txt`, `packages-el10.txt`) and so in the mirror and the el-vm/ubuntu-vm local repos;
netem-impaired-link was thought to need linux-modules-extra, but the ubuntu-vm kernel
(6.8.0-142-generic, cloud image 20260926) ships `sch_netem` and `sch_tbf` in linux-modules, so no
image change was needed. Both labs passed a full `labctl verify` on the remote verify VM from the
image-gaps clone (2026-10-19). Kernel modules ip_gre, bridge, 8021q, bonding,
wireguard are still assumed present on the VM images.

## Verify queue (34 built labs on main), by slot kind

| Slot kind | Labs |
|---|---|
| pod (tier A, 9) | signal-box-levels-3, postfix-relay-alerts, xlp-sed-bulk-edit, xlp-sudoers-limited, xlp-ssh-disable-root, xlp-setuid-audit, xlp-checksum-verify, xlp-fix-dns-client, xlp-fix-permission-denied |
| vm, ubuntu-vm:24.04 (19) | xlp-netplan-address, xlp-module-info, xlp-hardware-report, xlp-raid-status, xlp-sysctl-runtime, xlp-systemd-enable-mask, disk-full-deleted-open, inode-exhaustion-spool, fix-port-conflict, xlp-ufw-rules, xlp-luks-open-mount, xlp-fix-disk-full, xlp-fix-unit-start, xlp-fix-default-route, xlp-fix-high-load, xlp-fix-time-skew, xpe-host-baseline-service, xpe-host-disk-and-mount, xpe-incident-disk-pressure |
| vm, el-vm:10 (6) | xlp-lvm-raid-mount-opts, xlp-lvm-extend-vg, xlp-container-network, xlp-firewalld-rich-rule, xlp-faillock-policy, xlp-fix-oom-service |
| kubeadm | none |
| netdev | none |
| Kata-blocked | none |
| image-blocked | none (iperf-throughput-baseline and netem-impaired-link, wave 4, were unblocked on 2026-10-19) |

All VM tasks are `workstation` (jumphost:1) plus one VM. By name the queue is 9 pod + 19 ubuntu-vm
(16 tier B/C learning and pool tasks plus the 3 tier-C xpe tasks) + 6 el-vm = 34. The 23 wave 4 labs (21 unblocked) are queued separately; the list is in `linux-r5-w4.md`.

Watch list for the runner: `ip netns` plus `systemd-run -p NetworkNamespacePath` on the ubuntu-vm,
ufw state after `ufw --force reset`, firewalld zone XML parsing, authselect and pam_faillock via pty
on el-vm 10, cgroup OOM on el-vm, chrony `makestep` against the Python NTP responder, `lvm2` and
`xfsprogs` installed from the local mirror, `logrotate -d` return codes, netplan apply on a veth,
`findmnt --verify` summary wording.

## Update 2026-10-19 (waves 4 to 7 merged)

| Wave | PR | Merge commit | Scope | Labs (all `built`) |
|---|---|---|---|---|
| 4 | #143 | merged earlier | networking on VMs | 23 |
| 4 follow-ups | #219 | 155f206 | closes the review minors in `linux-r5-w4.md`; changed labs need a re-verify | 0 |
| 5 | #217 | decd42f | storage, filesystems, NFS, EL running system (`linux-r5-w5.md`) | 23 |
| 6 | #212 | 598bfde | container internals, performance, hardening, observability (`linux-r5-w6.md`) | 23 |
| 7 | #218 | 2d40afd | boot, recovery, kernel, virt, blocked exam tasks, capstones (`linux-r5-w7.md`) | 21 |

Waves 5 to 7 add 67 built labs, none run live. Exam pools: every pool of sim-el-sysadmin and sim-linux-sysadmin
holds at least 2x its draw and both exams compile with and without `--allow-missing` (W7 report: sim-linux-sysadmin
10/5, 8/4, 8/4, 6/3, 4/2; sim-el-sysadmin 6/3, 4/2, 2/1, 4/2, 6/3, 4/2, 4/2, 4/2, 4/2, 2/1).

Package gaps closed on 2026-10-19 (the per-wave handoffs still list them as they were written):
noble adds linux-tools-common + linux-tools-6.8.0-142-generic (perf for the ubuntu-vm kernel; bump
with UBUNTU_SERIAL), bpftrace, prometheus-node-exporter(-collectors), samba, smbclient, fail2ban,
slapd, ldap-utils, sssd(-ldap, -tools), libpam-sss, libnss-sss, libvirt-daemon-system,
libvirt-clients, qemu-system-x86, qemu-utils, virtinst; el10 adds targetcli, iscsi-initiator-utils,
openscap-scanner, scap-security-guide, flatpak, ostree, flatpak-selinux, sssd(-ldap, -tools), oddjob,
oddjob-mkhomedir, authselect and the companions that only rich dependencies pull in ("X if Y", checked
for every package in the repo): adcli-selinux, libsss_sudo, sssd-nfs-idmap, glibc-gconv-extra,
python(3)-rpm-macros, python3-rpm-generators. el-vm 1.78 -> 1.94 GB, ubuntu-vm 1.82 -> 2.04 GB.
Live verify on the remote verify VM (one lab per package group): iscsi-attach-volume, samba-share-office,
bpftrace-who-opens, libvirt-test-vm (qemu software emulation, no nested virt) and ldap-login-crew
(solution and mutations) pass. Lab fixes on the way: samba-share-office's directories check expects 2770
(setgid is inherited from the share root); ldap-login-crew (sssctl config-check non-fatal, 0640 accepted,
the alternative turns off StartTLS). Remaining content blockers (packages install fine):
flatpak-remote-install (setup's flatpak build-init needs the SDK runtime installed first),
ssh-hardening-fail2ban and openscap-scan-remediate (after the solution the grader's root SSH is refused;
openscap's profile-edit mutation is not caught), perf-cpu-flamegraph (profile check reports no-profile
after the solution), node-exporter-alert (no-textfile mutation not caught), libvirt-golden-template
(clone proof not run live). Console/reboot-blocked (end state graded over ssh): boot-target-default,
grub-kernel-args, boot-slow-analysis, recover-root-password, recover-broken-fstab, kernel-panic-initramfs,
xel-root-password-reset, xlf-recover-fstab-boot; journal-persistent-el previous-boot output. Partially blocked:
cloud-init-new-depot-host (applies user-data in place; no nested virt).

Verify queue for the testing round: all 67 wave 5 to 7 labs plus the 23 wave 4 labs and the labs changed by #219,
by slot kind: el-vm:10 VMs (w5 13, w6 12, w7 mixed), ubuntu-vm:24.04 VMs (w5 7, w6 10), two-VM labs (nfs-*, rsyslog,
fix-boot-mount-network), see the per-wave tables. Watch list: libvirt-golden-template removes ssh host keys on the
lab VM and relies on the running sshd; confirm the el10 default `ipv6.method` for nmcli-bond-el; autofs on el10
(nfs-autofs-home) now that libsss_autofs is in the image.
