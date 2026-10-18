# Handoff: Linux round 5, wave 3 (sim-linux-pro security and troubleshooting, capstone, disk pressure)

Branch `content/linux-r5-w3`, pack `content/packs/linux`. Source of truth for each lab's state
is `status` / `notes` in `content/curriculum.yaml`. All 22 labs are `built`: written and
statically checked (lab-verify --strict, labctl validate, `labctl exam compile sim-linux-pro`
without `--allow-missing`, curriculum render), none run live.

## Labs

| Group | Labs |
|---|---|
| sim-linux-pro security (8, draw 4) | tier A: xlp-sudoers-limited, xlp-ssh-disable-root, xlp-setuid-audit, xlp-checksum-verify; tier B: xlp-ufw-rules, xlp-firewalld-rich-rule, xlp-luks-open-mount, xlp-faillock-policy |
| sim-linux-pro troubleshooting (8, draw 4) | tier A: xlp-fix-dns-client, xlp-fix-permission-denied; tier B: xlp-fix-disk-full, xlp-fix-unit-start, xlp-fix-default-route, xlp-fix-high-load, xlp-fix-oom-service, xlp-fix-time-skew |
| sim-platform-engineer, linux (tier C) | xpe-host-baseline-service, xpe-host-disk-and-mount, xpe-incident-disk-pressure |
| learning labs (tier B) | disk-full-deleted-open, inode-exhaustion-spool, fix-port-conflict (added to the course lsv-troubleshooting) |

sim-linux-pro is now complete: all five pools hold at least 2x their draw (10/5, 8/4, 8/4, 6/3, 8/4)
and `labctl exam compile sim-linux-pro` passes; the exam was added to the CI compile step.

## Design notes

- Re-tiering: xlp-fix-disk-full and disk-full-deleted-open moved A -> B (a full filesystem cannot
  exist in a pod). Both mount a 512Mi data disk (`virtio-ct-data1`, asserted to be `/dev/vdc` in
  setup) at the log path and fill it. ubuntu-vm tier-B/C images are `[jumphost:1, ubuntu-vm:24.04]`
  and el-vm ones `[jumphost:1, el-vm:10]`; the old `deb-sys`/`el-sys` refs are gone.
- Network-namespace "remote host" (`docs/lab-snippets/netns-remote-host.sh`, pasted into setup):
  xlp-ufw-rules (client `tr-cl`, 10.64.11.0/24), xlp-firewalld-rich-rule (two clients `tr-fwa` and
  `tr-fwb`, 10.64.13.0/24 and 10.64.14.0/24), xlp-fix-default-route (`tr-rem`, 10.64.20.0/24,
  depot subnet 10.91.o.0/24 on a dummy, servers started with `systemd-run` and
  `NetworkNamespacePath`), xlp-fix-time-skew (`tr-ntp`, 10.65.30.0/24). eth0, the default route
  and DNS are never touched.
- xlp-fix-time-skew deviates from the brief: `chronyd -x` in a namespace cannot serve a time that
  differs from the shared kernel clock, so the reference server is a stdlib Python NTP responder
  that answers with `T0 + (monotonic - M0)` from a record taken before the clock is skewed
  backwards by `{{hours}}` hours. The grader compares the system clock against the same record.
- xlp-faillock-policy drives failed `su` attempts through a pty (`/var/lib/cloudtrain/tryauth.py`)
  as `tr-caller` against `tr-probe`; checks that N-1 failures then the right password works and
  N failures then the right password is refused. learner and root are never locked.
- xlp-ufw-rules and xlp-firewalld-rich-rule accept a second legitimate method (nftables ruleset;
  `--runtime-to-permanent`) and grade behaviour from the client namespaces plus config parsing.
- xlp-fix-high-load: the runaway is a unit with `Restart=always` and two busy bash workers; killing
  the workers is a misconception. The protected `tr-ledger.service` keeps its MainPID.
- xlp-fix-oom-service: `MemoryMax=64M`, `MemorySwapMax=0`; fix by raising the limit (finite, <= 400M)
  or shrinking `CACHE_MB` while the cache stays >= 48 MB.
- inode-exhaustion-spool: `mkfs.ext4 -N 4096`; the tmpfiles.d rule is parsed (types d, D, e, q, Q,
  age equal to the requested value).
- xpe-*: shared sim-platform-engineer VM blocks, identical in the three tasks:
  workstation (jumphost:1) + qm-build-1 + qm-build-2 (`ubuntu-vm:24.04`,
  `{cpu: 2, memoryMiB: 1536, disks: ["2Gi", "2Gi"]}`, ssh + console). The automation tasks
  xpe-ansible-node-agents and xpe-ansible-ssh-hardening currently declare `{cpu: 1, memoryMiB: 1280}`
  with no disks: they must be changed to the same block before sim-platform-engineer can compile.
  xpe-host-disk-and-mount asks for a **1 GiB** LV (a 2 GiB disk cannot hold a 2 GiB LV).
  Grading is reboot-free: `systemctl is-enabled`, `systemd-analyze cat-config` of journald,
  `/var/log/journal`, `findmnt --fstab` + `findmnt --verify`. sim-platform-engineer is not in CI
  (the IaC workstation question is open).

## Not verified (risks for the testing round)

- Tier A (pod): xlp-sudoers-limited, xlp-ssh-disable-root (sshd in a pod), xlp-setuid-audit,
  xlp-checksum-verify (gnupg from the mirror), xlp-fix-dns-client (python DNS server on 127.0.0.53,
  bind-mounted resolv.conf), xlp-fix-permission-denied.
- Tier B/C: all others. Watch list: `ip netns` + `systemd-run -p NetworkNamespacePath` on the
  ubuntu-vm; ufw state after `ufw --force reset`; firewalld zone XML parsing; `cryptsetup`
  availability on ubuntu-vm; authselect + pam_faillock via pty on el-vm 10; cgroup OOM on el-vm;
  chrony `makestep` against the Python NTP responder; XFS and LVM tooling on ubuntu-vm
  (`lvm2`, `xfsprogs` are installed from the local mirror if missing); `logrotate -d` return codes.

## Verify queue

All 22: xlp-sudoers-limited, xlp-ssh-disable-root, xlp-setuid-audit, xlp-checksum-verify,
xlp-ufw-rules, xlp-firewalld-rich-rule, xlp-luks-open-mount, xlp-faillock-policy, xlp-fix-dns-client,
xlp-fix-permission-denied, xlp-fix-disk-full, xlp-fix-unit-start, xlp-fix-default-route,
xlp-fix-high-load, xlp-fix-oom-service, xlp-fix-time-skew, xpe-host-baseline-service,
xpe-host-disk-and-mount, xpe-incident-disk-pressure, disk-full-deleted-open, inode-exhaustion-spool,
fix-port-conflict.
