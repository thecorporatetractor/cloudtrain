# Handoff: Linux round 5, wave 5 (storage, filesystems, NFS and EL running-system labs)

Branch `content/linux-r5-w5`, pack `content/packs/linux`. All 23 labs are `built`: written and
statically checked (lab-verify --strict, labctl validate, content tests via CI, curriculum render),
none run live. Source of truth for state and notes is `content/curriculum.yaml`.

## Labs

| Group | Labs |
|---|---|
| Running system (el-vm:10) | kill-heavy-process-el, tuned-profile-batch, journal-persistent-el, at-and-cron-el |
| Kernel and sysctl (ubuntu-vm) | hardware-inventory-report, udev-stable-device-name, sysctl-persistent-forwarding |
| Local storage | lvm-mbr-gpt-mixed, vfat-xfs-ext4-mounts, quotas-crew-homes (el); fsck-repair-ext4, raid1-degrade-rebuild, luks-encrypt-archive (ubuntu) |
| Online storage operations (tier B) | lvm-snapshot-backup, pvmove-replace-disk, io-latency-hunt (el); rsync-backup-timer (ubuntu) |
| NFS (two el-vm:10 VMs) | nfs-server-exports, nfs-mount-el, nfs-autofs-home; fix-boot-mount-network (ubuntu client + el server) |
| Blocked by packages | iscsi-attach-volume, samba-share-office |

## Design notes

- Images follow the brief: `deb-sys`/`el-sys` refs became `[jumphost:1, ubuntu-vm:24.04]` / `[jumphost:1, el-vm:10]`;
  tier-B labs carry the Kata note. fix-boot-mount-network is the only mixed-image lab.
- Reboot-graded (persistence from config until verify can reboot): sysctl-persistent-forwarding
  (`systemd-analyze cat-config sysctl.d`), journal-persistent-el, lvm-mbr-gpt-mixed, vfat-xfs-ext4-mounts,
  nfs-mount-el (generated mount unit), luks-encrypt-archive (crypttab plus generated cryptsetup unit).
- journal-persistent-el: the boot-before-last error cannot exist without a reboot, so
  `~/answers/prev-boot.txt` holds the `journalctl -b -1 -p err` command; the rest is graded live.
- lvm-snapshot-backup proves the snapshot was used from the kernel log (an XFS mount of a dm device that is
  not lv-ledger); the writer unit must keep its MainPID. pvmove-replace-disk does the same for its writer.
- io-latency-hunt: ionice is ineffective on virtio with the `none` scheduler, so the throttle is
  `IOWriteBandwidthMax`, read back from the unit property and the cgroup `io.stat`.
- quotas-crew-homes: /home is on the root fs; the lab mounts a dedicated XFS at `/home/crew` (uquota).
- rsync-backup-timer: one VM, backup account `backup@127.0.0.1` with a root key.
- nfs-autofs-home was blocked on libsss_autofs; #192 added it to el10, so the lab stays on el-vm:10 and
  installs autofs in setup. Confirm on the first remote verify.
- fsck-repair-ext4 zeroes the primary superblock magic after orphaning inodes with `debugfs unlink`;
  e2fsck falls back to a backup superblock and fills lost+found.

## Blockers

- iscsi-attach-volume: `targetcli` (tr-san-1) and `iscsi-initiator-utils` (tr-iscsi-cl) are in neither mirror.
  Add to `tools/mirrors/packages-el10.txt`; rebuild the el-vm image.
- samba-share-office: `samba` and `smbclient` not mirrored. Add to the ubuntu 24.04 package list; rebuild ubuntu-vm.
- journal-persistent-el: reboot blocker for the previous-boot output (see above).

## Verify queue (23 built)

| Slot kind | Labs |
|---|---|
| vm, el-vm:10 (13) | kill-heavy-process-el, tuned-profile-batch, journal-persistent-el, at-and-cron-el, lvm-mbr-gpt-mixed, vfat-xfs-ext4-mounts, quotas-crew-homes, lvm-snapshot-backup, pvmove-replace-disk, io-latency-hunt, nfs-server-exports, nfs-mount-el, nfs-autofs-home |
| vm, ubuntu-vm:24.04 (7) | hardware-inventory-report, udev-stable-device-name, sysctl-persistent-forwarding, fsck-repair-ext4, raid1-degrade-rebuild, luks-encrypt-archive, rsync-backup-timer |
| vm, mixed (1) | fix-boot-mount-network |
| image-blocked (2) | iscsi-attach-volume, samba-share-office |

Watch list: `pidstat` and `iostat` (sysstat from the local repo), cgroup io.stat after `IOWriteBandwidthMax`,
XFS quota enabling by umount/mount, `debugfs unlink` plus superblock-magic corruption, `mdadm --wait`,
`journalctl -k` XFS mount lines, `findmnt --verify` exit codes (0 or 64 accepted), `cryptsetup` default PBKDF
memory on a 1.5 GiB VM, python3 on el-vm:10 (kill-heavy-process-el).
