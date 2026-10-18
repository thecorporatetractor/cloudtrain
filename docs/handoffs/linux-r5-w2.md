# Handoff: Linux round 5, wave 2 (sim-linux-pro pools)

Branch `content/linux-r5-w2`, pack `content/packs/linux`. Source of truth for each task's state
is `status` / `notes` in `content/curriculum.yaml`. Everything here is `built`: written and
statically checked (lab-verify --strict, labctl validate, `labctl exam compile --allow-missing
sim-linux-pro`, curriculum render), none run live.

sim-linux-pro is `environment: per-task`: each task has its own nodes. Tier-A tasks have one
entry node `tr-lp-01` (deb-lab:24.04 or el-lab:10, `learnerSudo` where root is needed). Tier-B
tasks have `workstation` (jumphost:1) plus a VM `tr-lp-01` (ubuntu-vm:24.04 or el-vm:10).

## Tasks

| Pool (draw) | Tasks |
|---|---|
| system-management (5 of 10) | xlp-backup-restore-tar, xlp-fhs-locate-config, xlp-shell-pipeline (tier A); xlp-netplan-address, xlp-lvm-raid-mount-opts, xlp-lvm-extend-vg, xlp-module-info, xlp-hardware-report, xlp-raid-status, xlp-sysctl-runtime (tier B) |
| services-users (4 of 8) | xlp-user-group-membership, xlp-pip-venv-tool, xlp-at-job, xlp-dns-dhcp-service, xlp-process-priority, xlp-web-vhost (tier A); xlp-systemd-enable-mask, xlp-container-network (tier B) |
| automation-scripting (3 of 6) | xlp-script-fix-loop, xlp-git-revert-commit, xlp-python-parse-json, xlp-cloud-init-userdata, xlp-sed-bulk-edit, xlp-script-exit-codes (all tier A) |

## Design notes

- xlp-netplan-address (first use of the secondary-interface snippet, reused in wave 4): setup
  writes `/etc/systemd/network/10-tr-eth1.netdev` (veth eth1/eth1p) and a `.network` for eth1p,
  reloads networkd and falls back to `ip link add`. eth0 is never touched. Graded with
  `netplan get ethernets.eth1.addresses` and `ip addr show eth1`. Reboot-graded: persistence is
  checked from config.
- xlp-container-network: setup builds the offline image `registry.tallowmere.test/tt-api:1`
  with `dnf --installroot` (python3, coreutils-single) from the local repo and `podman import`;
  learners use `--pull=never`. Checks use `podman ... inspect | python3` and `grep dns_enabled`
  (Go templates would clash with the `{{param}}` syntax).
- xlp-raid-status: setup builds md1 on vdc/vdd (assume-clean), fails the `bad` member and
  leaves vde blank; the report is graded against a hidden copy, so writing it after the repair
  fails.
- xlp-sysctl-runtime: an old `60-tr-tuning.conf` shadows an earlier-sorting drop-in; the
  effective value comes from `systemd-analyze cat-config sysctl.d`.
- xlp-lvm-raid-mount-opts: fstab graded with `findmnt --fstab` plus `findmnt --verify`.
- xlp-hardware-report / xlp-module-info compute expected values from /proc, blockdev and
  modinfo in the check. The module report asks for the `vermagic` kernel release and the
  parameter names; modules are `brd` and `dummy` (must exist in the ubuntu-vm kernel).
- xlp-git-revert-commit: gitea dropped; bare repo `/srv/git/tt-config.git` owned by learner;
  graded on the HEAD tree, that the old tip and the bad commit are ancestors, and that a
  "This reverts commit" message names the bad commit.
- xlp-pip-venv-tool pins `yamllint==1.38.0` (present in `tools/mirrors/lock/pypi.lock`).
- xlp-process-priority runs the tree as `learner` (the pod has no CAP_SYS_NICE, so root could
  not renice another user's processes).
- xlp-at-job, xlp-dns-dhcp-service, xlp-web-vhost, xlp-cloud-init-userdata install at, dnsmasq +
  bind-utils, nginx and cloud-init from the mirror in setup and start daemons directly (no
  systemd in pods).

## Not verified (risks for the testing round)

- Tier A (live pod slot): xlp-at-job (setuid `at` and atd in the pod), xlp-cloud-init-userdata
  (cloud-init package install in a container, `cloud-init schema` output), xlp-dns-dhcp-service,
  xlp-web-vhost, xlp-process-priority, xlp-script-exit-codes (pgrep -x on a symlinked sleep).
- Tier B (VM runner): all nine. Particular watch: netplan apply on the veth, `networkctl reload`
  creating the netdev, module availability, dnf installroot network access, `findmnt --verify`
  summary wording.

## Verify queue

All 24: xlp-backup-restore-tar, xlp-fhs-locate-config, xlp-shell-pipeline, xlp-netplan-address,
xlp-lvm-raid-mount-opts, xlp-lvm-extend-vg, xlp-module-info, xlp-hardware-report, xlp-raid-status,
xlp-sysctl-runtime, xlp-user-group-membership, xlp-pip-venv-tool, xlp-at-job, xlp-dns-dhcp-service,
xlp-process-priority, xlp-web-vhost, xlp-systemd-enable-mask, xlp-container-network,
xlp-script-fix-loop, xlp-git-revert-commit, xlp-python-parse-json, xlp-cloud-init-userdata,
xlp-sed-bulk-edit, xlp-script-exit-codes.
