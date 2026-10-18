# Handoff: Linux round 5 (summary, state as of 2026-10-19)

Per-wave detail stays in `linux-r5-w1.md`, `linux-r5-w2.md` and `linux-r5-w3.md`. The source of truth
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

## Unmerged PRs (round 5 is still open: wave 4 and a wave 3 follow-up)

- PR #143 (`content/linux-r5-w4`, 23 networking labs on VMs, handoff `docs/handoffs/linux-r5-w4.md`
  on that branch): open, no approval recorded, last pushed 2026-10-18 21:29 UTC (after review
  round 3 at 643025f; its later commits are review fixes and a curriculum re-render, not yet
  re-reviewed). The round 3 findings to confirm closed: two major mutation issues in two-VM labs
  (wireguard-depot-tunnel mutates only tr-wg-a, chrony-server-isolated mutates only the server;
  in both, more checks fail than the expectFail lists name) and four minor ones
  (fix-firewall-blocks-app and nftables-from-scratch persistence checks, fix-routing-asymmetric
  networkd drop-in fallback, iperf-throughput-baseline mtu-one-side mutation). The 23 labs are not
  on main; do not queue them for verify until it merges.
- PR #161 (`content/linux-r5-w3-minor`): follow-up to wave 3 (#122). Exact-address hosts pin check
  in xlp-fix-dns-client (its redundant nsswitch-only misconception is removed; pins-hosts and
  no-search remain), StartLimitIntervalSec=0 on the broken units
  (xlp-fix-unit-start, xlp-fix-oom-service), tracer-running check in xpe-incident-disk-pressure,
  port verified in xlp-fix-permission-denied app-reads. Open; touches lab hashes, so those labs
  need a re-verify after it merges.
- Open verify-VM follow-ups touching Linux labs (state 2026-10-19): fix PRs #177 (xlp-netplan-address,
  in this round's queue), #176 (xel-kernel-arg), #178 (xel-scp-remote-copy, blocked), #168
  (xlf-kill-memory-hog), #167 (xlf-lvm-grow-fs); PR #179 marks 27 Linux labs verified at their
  current hash. After #179 and #177 land, the queue below shrinks accordingly; trust `status` in
  `content/curriculum.yaml`.
- PR #143 status update: wave 4 built 23 networking VM labs; its merge state is DIRTY (needs a
  rebase onto main, then re-render). 2 of the 23 are blocked: iperf-throughput-baseline (iperf3 not
  in the mirrors: add it to `tools/mirrors/packages-*.txt` and rebuild the VM image) and
  netem-impaired-link (sch_netem blocker is in its curriculum notes). Still unmerged, so not queued.
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

Blockers recorded on the unmerged wave 4 branch (apply once it lands): iperf-throughput-baseline is
image-blocked (iperf3 in neither package list); netem-impaired-link is image-blocked (sch_netem is in
linux-modules-extra / kernel-modules-extra, not mirrored); kernel modules ip_gre, bridge, 8021q,
bonding, wireguard assumed present on the VM images.

## Verify queue (34 built labs on main), by slot kind

| Slot kind | Labs |
|---|---|
| pod (tier A, 9) | signal-box-levels-3, postfix-relay-alerts, xlp-sed-bulk-edit, xlp-sudoers-limited, xlp-ssh-disable-root, xlp-setuid-audit, xlp-checksum-verify, xlp-fix-dns-client, xlp-fix-permission-denied |
| vm, ubuntu-vm:24.04 (19) | xlp-netplan-address, xlp-module-info, xlp-hardware-report, xlp-raid-status, xlp-sysctl-runtime, xlp-systemd-enable-mask, disk-full-deleted-open, inode-exhaustion-spool, fix-port-conflict, xlp-ufw-rules, xlp-luks-open-mount, xlp-fix-disk-full, xlp-fix-unit-start, xlp-fix-default-route, xlp-fix-high-load, xlp-fix-time-skew, xpe-host-baseline-service, xpe-host-disk-and-mount, xpe-incident-disk-pressure |
| vm, el-vm:10 (6) | xlp-lvm-raid-mount-opts, xlp-lvm-extend-vg, xlp-container-network, xlp-firewalld-rich-rule, xlp-faillock-policy, xlp-fix-oom-service |
| kubeadm | none |
| netdev | none |
| Kata-blocked | none |
| image-blocked | none on main (iperf-throughput-baseline and netem-impaired-link are on PR #143) |

All VM tasks are `workstation` (jumphost:1) plus one VM. By name the queue is 9 pod + 19 ubuntu-vm
(16 tier B/C learning and pool tasks plus the 3 tier-C xpe tasks) + 6 el-vm = 34.

Watch list for the runner: `ip netns` plus `systemd-run -p NetworkNamespacePath` on the ubuntu-vm,
ufw state after `ufw --force reset`, firewalld zone XML parsing, authselect and pam_faillock via pty
on el-vm 10, cgroup OOM on el-vm, chrony `makestep` against the Python NTP responder, `lvm2` and
`xfsprogs` installed from the local mirror, `logrotate -d` return codes, netplan apply on a veth,
`findmnt --verify` summary wording.
