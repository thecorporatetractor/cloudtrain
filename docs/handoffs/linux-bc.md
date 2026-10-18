# Handoff: Linux round 4 (tier-A migration, root labs, tier B/C start)

Round 4 of the Linux stream, 2026-10-17/18, branch `content/linux-round-4` (squash-merged
in batches: #43, #47, and the final batch). Pack `content/packs/linux`. Source of truth for
every lab's state: `status` / `notes` in `content/curriculum.yaml`. Tier-A history and
gotchas: `docs/handoffs/linux-a.md`.

## What changed

| Area | Result |
|---|---|
| Tier-A images | Every tier-A lab runs on `deb-lab:24.04` / `el-lab:10` (user namespace, tini PID 1). The interim `linux-pod-deb:24.04` / `linux-pod-el:10` images, catalog refs, CI image/SBOM/Dependabot entries and `tools/images/linux-pod-interim/` are gone. 22 tier-A labs verified live on the new images (pod slots). |
| Root labs | 14 labs that were blocked on sudo, written with `learnerSudo: true` and verified live (6 deb-lab, 8 el-lab). `ssh-hardening-fail2ban` stays proposed (no fail2ban in image or mirror, no NET_ADMIN to ban). |
| sim-el-sysadmin | 37 exam tasks (`xel-*`) on el-vm:10; every pool covers its draw, the exam compiles. See "Exam pools". |
| sim-linux-sysadmin | 30 exam tasks (`xlf-*`) on ubuntu-vm:24.04 (+ el-vm:10 for SELinux tasks); every pool covers its draw, the exam compiles. |
| Learning labs B/C | 14 labs (systemd, storage/LVM, SELinux, AppArmor), status built. |
| Skills | The 90 `linux.*` newSkills are in `content/skills.yaml` (new competencies identity, boot, kernel, services, observability, performance, internals, virt, git); `content/frameworks/lfcs.yaml` maps the promoted skills its labs use. |

## Security trade-off: learnerSudo (root labs)

Root labs set `learnerSudo: true` on the entry node and grant
`learner ALL=(ALL) NOPASSWD:ALL` (or a narrower rule where sudoers is the topic) in setup.
The pod drops `no_new_privs`, so the learner becomes root **in the container**: still
unprivileged (default capabilities, no host mounts, user namespace on deb-lab/el-lab, the
admin sidecar keeps `no_new_privs`), annotated `labs.cloudtrain.dev/learner-sudo: "true"`.
Consequences accepted in these labs: a sudo learner can read the root-only grading data in
`/var/lib/cloudtrain` (expected answers, checksums). Operators who do not accept this run the
manager with `--allow-learner-sudo=false`; those sessions fail with a clear message. See
`docs/dev-environment.md` ("learnerSudo").

## Tier B runs as VMs

Every tier-B lab (Kata in the curriculum: `deb-sys:24.04`, `el-sys:10`) is written as a
workstation pod (`jumphost:1`, entry) plus a KubeVirt VM from `ubuntu-vm:24.04` / `el-vm:10`
**until the Kata tier exists**. Their curriculum `envTier` stays B and their `images` name
the VM image; notes say "tier B (Kata): runs as a KubeVirt VM until Kata exists". When Kata
lands, switch the node to the Kata image and re-verify; the checks do not depend on the VM.

## Exam pools

Pool coverage (draw / tasks with a lab / verified). An exam compiles when every pool has at
least its draw (`labctl exam compile --allow-missing <exam>`); the curriculum target is twice
the draw.

| Exam | Objective | Draw | Pool | With a lab | Verified |
|---|---|---|---|---|---|
| sim-el-sysadmin | essential-tools | 3 | 6 | 6 | 5 |
| sim-el-sysadmin | software | 2 | 4 | 3 | 0 |
| sim-el-sysadmin | scripts | 1 | 2 | 2 | 2 |
| sim-el-sysadmin | running-systems | 2 | 4 | 3 | 3 |
| sim-el-sysadmin | local-storage | 3 | 6 | 6 | 6 |
| sim-el-sysadmin | filesystems | 2 | 4 | 4 (autofs blocked) | 1 (+ resize, see below) |
| sim-el-sysadmin | deploy-maintain | 2 | 4 | 4 | 0 |
| sim-el-sysadmin | networking | 2 | 4 | 4 | 0 |
| sim-el-sysadmin | users-groups | 2 | 4 | 4 | 0 |
| sim-el-sysadmin | security | 1 | 2 | 2 | 0 |
| sim-linux-sysadmin | operations-deployment | 5 | 10 | 7 | 0 |
| sim-linux-sysadmin | networking | 4 | 8 | 6 | 0 |
| sim-linux-sysadmin | storage | 4 | 8 | 8 | 0 |
| sim-linux-sysadmin | essential-commands | 3 | 6 | 6 | 0 |
| sim-linux-sysadmin | users-groups | 2 | 4 | 3 | 0 |
| sim-linux-pro | (all) | 20 | 40 | 0 | 0 |

Shared environments: all tasks of one exam declare byte-identical nodes (checked by the
exam compiler): sim-el-sysadmin `workstation` + `tr-el-01` (el-vm:10, 2 vCPU, 1536 MiB,
disks 2Gi/1Gi/2Gi = /dev/vdc, vdd, vde) + `tr-el-02` (el-vm:10); sim-linux-sysadmin
`workstation` + `tr-ops-01` (ubuntu-vm:24.04, same disks) + `tr-sec-01` (el-vm:10). A task
declares only the nodes it uses. Storage tasks share disks the way the real exam does
(learners add partitions in free space; shared VGs are created idempotently), users, paths,
ports and unit names are unique per task. All 36 xel tasks were run together on one VM pair
(every setup, then every solution, then every check) before their individual verify.

Not written (reasons in curriculum notes): xel-root-password-reset and xlf-recover-fstab-boot
(console during boot, not gradable over ssh), xel-flatpak-remote (no flatpak in the mirror),
xlf-bond-config and xlf-static-ip-netplan (one NIC per VM), xlf-container-restart-policy (no
image source in an isolated VM), xlf-libvirt-autostart (nested virtualisation),
xlf-ldap-user-login (no LDAP server image). xel-autofs-home is written but blocked (image gap 1).

## Verification state

- Tier A: 36 labs verified live (22 migrated, 14 root labs).
- sim-el-sysadmin: 17 of 37 tasks verified live (full `labctl verify`: 2 seeds, every
  mutation and alternative). xel-resize-lv-fs: base and mutation runs passed; its fs-size check
  now reads the XFS data size from `xfs_info` (df under-reports by the log/metadata, which made
  the `growfs` alternative fail); it needs one more verify run (the heavy slot was busy at the end of the round). The other 19 are built: 18 passed their setup/solution/checks in the
  shared-VM exam run (xel-autofs-home is blocked, image gap 1), not yet a full verify (deploy-maintain, networking, users-groups,
  security, software, scp).
- sim-linux-sysadmin: 30 built, 0 verified (11 base cycles on a sandbox VM, 7 docker
  cycles with mutations). The lab files are canonical (the generator sources stayed in scratch).
- Learning labs B/C: 14 built (10 ran end to end on a sandbox VM), 0 verified.
- Next: verify the remaining xel tasks (about 60 VM sessions, 2 h of heavy slot at load 50),
  then xlf, then the learning labs; then `labctl exam run sim-el-sysadmin --auto-solve` and
  `--no-solve`.

Exam runs (`labctl exam run --auto-solve` / `--no-solve`) were not done: they need every
drawn task verified first and boot the full environment twice.

## Image gaps (foundations follow-ups)

1. **el-vm:10 cannot install autofs**: `sssd-common` (installed) requires `libsss_autofs`
   of the same version once autofs is installed, and the el10 mirror lacks it. Add
   `libsss_autofs` to `tools/mirrors/packages-el10.txt`, rebuild the mirror content and
   el-vm. Blocks xel-autofs-home, nfs-autofs-home and any EL autofs lab.
2. **el-vm:10 has no bzip2** (it is in the local repo): xel-tar-bzip-archive installs it in
   setup. Consider adding bzip2 to the guest install list.
3. **ubuntu-vm:24.04 apt is not offline at first boot**: cloud-init recreates
   `/etc/apt/sources.list.d/ubuntu.sources` (archive.ubuntu.com) and `/var/lib/apt/lists` is
   empty, so `apt-get update` hangs on internet sources in the isolated VPC. Every xlf apt
   task moves the file aside and runs `apt-get update` in setup. Fix in the image (disable
   cloud-init's apt module or `apt: preserve_sources_list: true`, and pre-fill the lists).
4. acl, autofs, nginx, fail2ban: acl/autofs/nginx are only in ubuntu-vm's local repo
   (tasks install them); fail2ban is in neither image nor mirror.
5. **Data disks are /dev/vdc..., not /dev/vdb...**: `/dev/vdb` is the 1 MiB cloud-init disk.
   The lab schema description and the catalog comment say `/dev/vdb`; fix them (or attach
   cloud-init last) and keep the serials (`/dev/disk/by-id/virtio-ct-dataN`) as the stable
   name.
6. mkfs.xfs (EL10) refuses filesystems under 300 MB; size XFS volumes at >= 320 MiB.

## Platform problems found

- The learner's `~/.ssh/config` written by the platform starts with `Host *`
  (`StrictHostKeyChecking yes`, `User learner`). ssh keeps the first value it reads, so any
  `Host` entry a learner appends cannot change user or host-key policy. ssh-config-depot-hosts
  moves the block to `/etc/ssh/ssh_config.d` in setup; the platform could write its defaults
  there (or at the end of the file) for every lab.
- On 2026-10-18 01:00-01:25 the kind worker's kube-ovn CNI hung (43 ADD calls stuck for
  40 min, pod sandboxes failed with DeadlineExceeded, load 200) until kube-ovn-cni was
  restarted; VM sessions then hit the 25 min ready timeout and several teardowns took over
  10 min. labctl verify reports those as failures; rerun the lab.
- `getent hosts` in the isolated VPC tries IPv6 DNS first and hangs for the resolver timeout;
  checks use `getent ahostsv4`.
- journald on EL10 only moves to `/var/log/journal` on `journalctl --flush` (or boot), not on
  a restart with `Storage=persistent`.
- The scratchpad directory is shared between agent sessions: keep scripts in a private
  subfolder (another session overwrote a helper of this round).
- Tier-A data outside `/home` is still lost on hibernate/resume (linux-a blocker 2).

## Not started

Tier B/C learning labs beyond the 14 above (networking, boot, kernel, services, security,
performance, internals paths), sim-linux-pro (tier A/B pool, 40 tasks), the rest of the
tier-A labs listed in linux-a.md (mirror labs, servers, mis-tiered ones).

## How to resume

```sh
cd /home/hackrvl/cloudtrain && git worktree add .worktrees/linux origin/main && cd .worktrees/linux
pnpm install --frozen-lockfile --offline && (cd packages/lab-schema && pnpm run build)
(cd services/lab-orchestrator && GOTOOLCHAIN=go1.27.2 go build -o bin/labctl ./cmd/labctl)
LOAD_LAB_IMAGES=0 SKIP_CRDS=1 ORCH_NAMESPACE=ct-linux5-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=linux5 \
  PROVISION_TIMEOUT=30m bash deploy/scripts/orchestrator-deploy.sh
# VM labs: one heavy job, parallel 3 sessions
tools/slots/run.sh vm -- services/lab-orchestrator/bin/labctl verify --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=linux5 --repo-root "$PWD" --parallel 3 --only <ids> content/packs/linux/labs
services/lab-orchestrator/bin/labctl exam compile --allow-missing sim-el-sysadmin >/dev/null
node tools/lab-verify/bin/lab-verify.mjs --strict && node tools/curriculum/render.mjs
```

A VM lab verify is 3-6 fresh sessions; a session was Ready in 6-11 min at host load 80-200
and 4-6 min at load 30-50. For authoring, hold the heavy slot with one kept session (entry
plus the exam VMs) and run setups/solutions/checks over `kubectl exec ... -c admin -- ssh -T
<host>`: one boot instead of one per run.
