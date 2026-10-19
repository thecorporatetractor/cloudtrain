# Handoff: Linux round 5, wave 7 (boot, recovery, kernel, virt, blocked exam tasks, capstones)

Branch `content/linux-r5-w7`, pack `content/packs/linux`. Source of truth for each lab's state is
`status` / `notes` in `content/curriculum.yaml`. All 21 labs are `built`: written and statically
checked, none run live (rule of 2026-10-18). Several are blocked on images or on a console/reboot
step; they are written honestly so that the checks grade the end state reachable over ssh.

## Labs

| Group | Labs |
|---|---|
| Boot and kernel (el-vm:10 unless noted) | boot-target-default, grub-kernel-args, kernel-module-blacklist, boot-slow-analysis (ubuntu-vm) |
| Recovery | recover-root-password, recover-broken-fstab, kernel-panic-initramfs, xel-root-password-reset (exam, tr-el-02), xlf-recover-fstab-boot (exam, tr-sec-01) |
| Provisioning and containers (ubuntu-vm) | cloud-init-new-depot-host, xlf-container-restart-policy (exam), ssh-hardening-fail2ban (moved A -> C) |
| Directory login | ldap-login-crew (two VMs), xlf-ldap-user-login (exam) |
| Flatpak (el-vm:10) | flatpak-remote-install, xel-flatpak-remote (exam) |
| Virtualisation (ubuntu-vm) | libvirt-test-vm, libvirt-golden-template, xlf-libvirt-autostart (exam) |
| Capstones | el-mock-scenario-depot (el-vm, 3 data disks, hints), incident-capstone-ticketing (ubuntu-vm, tier B) |

## Design notes

- Recovery tasks cannot be driven from a console. Setup builds the broken state without
  rebooting (random root hash, a bad fstab line, an initramfs built with `omit_drivers`
  virtio_blk) and the checks grade the end state of the console procedure: root hash compared
  through libcrypt (`pwmatch.py`), `shadow_t` label or `/.autorelabel`, fstab valid plus live mount,
  `lsinitrd` showing the driver.
- grub-kernel-args: the second kernel is a cloned BLS entry (`<machine-id>-0-tr-previous.conf`,
  version 0-tr-previous, same vmlinuz). Graded: `audit=1` on all entries, `quiet` gone, the same
  in `/etc/kernel/cmdline`, `grub2-editenv` `next_entry` = the older entry, `saved_entry` unchanged.
- kernel-panic-initramfs: the new kernel entry (`9-tr-new`) has its own initramfs
  `/boot/initramfs-9-tr-new.img`, so the running kernel's initramfs is never touched.
- boot-slow-analysis: the stalled unit is not started at boot (the lab cannot reboot); the report
  (culprit, JobTimeoutSec, userspace time of the current boot) is graded against hidden state.
- cloud-init-new-depot-host applies user-data in place from a NoCloud seed. A cloud.cfg.d drop-in
  (`98-tr-keep.cfg`) keeps the network, host name and SSH host keys. Graded from
  `/run/cloud-init/status.json` (no stage reports errors).
- ssh-hardening-fail2ban: the sshd part uses a legacy `10-` drop-in that shadows later edits
  (first value wins); graded from `sshd -T`. The jail is graded from config only.
- incident-capstone-ticketing: the "resolv.conf fault" is service-scoped (`BindReadOnlyPaths=` of
  `/etc/tr/ticket-resolv.conf`), so eth0 and systemd-resolved are not touched; the site resolver is
  the W3 python resolver on 127.0.0.54.
- el-mock-scenario-depot: four mutations are built from the solution script with one part left out.
  Its curriculum skills were extended to the nine skills actually graded.

## Blockers (recorded in the curriculum notes)

| Lab | Blocker |
|---|---|
| boot-target-default, grub-kernel-args, boot-slow-analysis, recover-root-password, recover-broken-fstab, kernel-panic-initramfs, xel-root-password-reset, xlf-recover-fstab-boot | console/reboot verify: the boot-time part is not graded, only the end state over ssh |
| ssh-hardening-fail2ban | fail2ban in neither mirror (jail graded from config). Add `fail2ban` to tools/mirrors/packages-noble.txt |
| ldap-login-crew, xlf-ldap-user-login | no LDAP server: add `slapd`, `ldap-utils` (noble) and `sssd`, `sssd-ldap`, `sssd-tools`, `oddjob-mkhomedir` (el10), `sssd-ldap`, `libpam-sss`, `libnss-sss` (noble) |
| flatpak-remote-install, xel-flatpak-remote | add `flatpak`, `ostree` to tools/mirrors/packages-el10.txt |
| libvirt-test-vm, xlf-libvirt-autostart | add `libvirt-daemon-system`, `libvirt-clients`, `qemu-system-x86`, `qemu-utils`, `virtinst` to packages-noble.txt; labs use software emulation so nested virt is not needed |
| libvirt-golden-template | only the clone proof is blocked (needs libvirt and nested virt); identity cleaning is graded on the VM |
| cloud-init-new-depot-host | partially blocked: no boot of a new VM (nested virt); applied in place instead |

## Verify queue (21 labs, all `built`)

Every lab is a workstation (jumphost:1) plus VMs. ubuntu-vm:24.04: boot-slow-analysis,
cloud-init-new-depot-host, xlf-container-restart-policy, ssh-hardening-fail2ban, libvirt-test-vm,
libvirt-golden-template, xlf-libvirt-autostart, xlf-ldap-user-login, incident-capstone-ticketing.
el-vm:10: boot-target-default, grub-kernel-args, kernel-module-blacklist, recover-root-password,
recover-broken-fstab, kernel-panic-initramfs, xel-root-password-reset, xlf-recover-fstab-boot,
flatpak-remote-install, xel-flatpak-remote, el-mock-scenario-depot. Two VMs: ldap-login-crew
(ubuntu-vm + el-vm). The image-blocked labs (ssh-hardening-fail2ban ban part, both LDAP labs,
both flatpak labs, the libvirt trio) will fail verify until the packages above are mirrored.

Watch list for the runner: `grub2-editenv` and BLS paths on el-vm:10 (BIOS vs UEFI grubenv),
`dracut -f <path> <kver>` time (setup timeout 300 s), ssh.socket behaviour after the SSH host keys
are removed in libvirt-golden-template, `cloud-init clean/init/modules` on ubuntu-vm,
`podman import` of the python rootfs on ubuntu 24.04 (podman 4.9, netavark/aardvark optional),
`findmnt --verify` exit codes with a missing source.
