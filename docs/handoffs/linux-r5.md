# Handoff: Linux round 5 (summary, state after the wave 3 merge)

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

## Unmerged PRs

- PR #143 (`content/linux-r5-w4`, 23 networking labs on VMs, handoff `docs/handoffs/linux-r5-w4.md`
  on that branch): not merged. Review round 3 (HEAD 643025f) is not approved: two major mutation
  issues remain, both in two-VM labs. In wireguard-depot-tunnel the mutations configure only
  tr-wg-a and never tr-wg-b; in chrony-server-isolated the mutations change only the server and
  never point tr-cl-01 at it. In both, more checks fail than the expectFail lists name. Four minor
  findings: fix-firewall-blocks-app (persistence check does not test accept-before-drop order in the
  saved file), nftables-from-scratch (persistence check does not require the SSH restriction or the
  eth0 accept), fix-routing-asymmetric (networkd drop-in alternative has a runtime fallback that can
  hide a broken drop-in), iperf-throughput-baseline (mtu-one-side mutation fails one check and does
  not match its description). Static gates pass (lab-verify --strict 0 errors, render --check clean).
  The 23 labs are not on main; do not queue them until it merges.
- PR #114 (containers) and PR #84 (automation) belong to other domains and were not touched.

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
