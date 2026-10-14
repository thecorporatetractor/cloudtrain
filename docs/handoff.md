# CloudTrain handoff

Paused on 2026-10-14. All wave-1 branches are merged into `main` (9c272fc); every gate passes (gateway 106 tests, lab-verify 31, Go 150, `labctl validate` 214 labs, lab-verify --strict clean). This is the entry point to resume work; each stream has
its own detailed handoff in `docs/handoffs/`.

## Read first

1. **Security hole in virtual-cluster labs (fix before anyone outside the team
   uses them).** Pods a learner creates inside a vcluster run on the host with
   no Pod Security enforcement, so a learner can start a privileged pod that
   mounts the kind node's filesystem. Fix: enforce Pod Security (baseline or
   restricted) on each vcluster's host namespace in the vcluster driver, and use
   Kata isolation in production. Source: `docs/handoffs/k8s-sec.md`.
2. **kubeadm labs don't come up under load.** `kubeadm init` runs once with no
   retry, and the session provisioning timeout (15 min) isn't configurable from
   the deploy script. Every kubeadm verify in the k8s-admin stream failed this
   way. Fix: retry `kubeadm init`, add a provisioning-timeout option to
   `deploy/scripts/orchestrator-deploy.sh`, and run fewer VM jobs in parallel.
3. **Lab links don't switch.** Kube-OVN link segments drop frames for foreign
   MACs and 802.1Q tags, so bridges, VLANs, STP, LACP and VRRP labs fail.
   Proposed fix (tested by hand): `layer2_forward` on link attachments and
   `vlan-passthru=true` on link switches. Source: `docs/handoffs/networking.md`.
4. **Learners can't use sudo/crontab in pod labs** (`allowPrivilegeEscalation:
   false` on entry pods). Blocks ~20 Linux labs. Source: `docs/handoffs/linux-a.md`.
5. **Windows C: drive is nearly full** (~23 GB free). Docker's disk file is
   ~237 GB though Docker now holds ~80 GB; compact it (see "Machine" below).

## Where things are

| Area | State | Detail |
|---|---|---|
| Platform: SSO, roles, Postgres + RLS, audit | merged, proven (54-check live proof) | `services/gateway/README.md`, `docs/platform-identity.md` |
| Entra ID SSO (AzarGuard tenant) | live: app "CloudTrain (local dev)", 6 app roles via 6 groups; secret expires 2027-04-14 | `~/.config/cloudtrain/entra-dev.env` (never commit) |
| Web: learner, manager, instructor, admin, platform views | merged | `apps/web/README.md`, screenshots in `apps/web/docs/screenshots/platform/` |
| Lab runtime: container, vcluster, kubeadm, VM, netdev drivers; grader; `labctl verify` | merged, verified on several labs | `services/lab-orchestrator/README.md` |
| Warm pools, hibernate/resume, reset | merged; proven on vcluster; kubeadm proof pending | `deploy/.results/warmpool-virtual-proof.txt` |
| Exam simulations (engine + gateway + web) | merged; engine proven live; Postgres flow proven in tests; 3 of 13 exams compile (the K8s ones), the rest wait for pool labs; live end-to-end with real auth and `task dev:orchestrator` reconciling ExamSessions pending | `docs/handoffs/exam-integrate.md` |
| Images | kubeadm 1.37 (Calico), 1.36 upgrade, etcd-host, jumphost, frr, nettools, netsvc, el-lab:10, el-vm:10 built; kubeadm:1.37-full/-sec built not boot-tested; deb-lab, ubuntu-vm not built; mirrors partial | `docs/handoffs/foundations.md` |
| Security CI | merged: pre-public scans done, real issues fixed (Go 1.26.9, gRPC, token tag check), no secrets in history (gitleaks 186 commits); workflows NOT written yet | `docs/handoffs/security-ci.md` |
| Curriculum | approved (Docker-first containers, Terraform-first IaC): 878 labs, 43 paths, 13 exams | `content/curriculum.yaml`, `docs/curriculum.md`, review page https://claude.ai/artifact/1qkEpeMhv1M7Qa5DsfcZpY |

## Labs by stream (wave 1)

| Stream | Owned | Verified live | Written, not yet verified | Blocked / not started | Handoff |
|---|---|---|---|---|---|
| k8s-admin | 88 | 5 | 63 | 18 blocked on add-ons, 2 not written | `docs/handoffs/k8s-admin.md` |
| k8s-dev | 42 | 6 | 32 | 4 blocked (buildah, metrics-server, ingress) | `docs/handoffs/k8s-dev.md` |
| k8s-sec | 51 | 2 | 37 | 12 blocked on security tooling | `docs/handoffs/k8s-sec.md` |
| networking | 77 | 2 | 31 drafts (parked in `docs/handoffs/networking-drafts/`) | 44 not started (exam tasks, SR Linux, Ansible) | `docs/handoffs/networking.md` |
| linux-a | 62 | 1 | 21 | ~40 not started (sudo, mirror, mis-tiered) | `docs/handoffs/linux-a.md` |
| original 11 K8s labs | 11 | 4+ | — | — | `content/packs/kubernetes` |

Most "blocked on add-ons" labs should unblock with `kubeadm:1.37-full` (metrics-server,
Traefik ingress + Gateway API, MetalLB, local-path, Falco, gVisor, kube-bench) once it
is boot-tested and the labs switch to it.

Not started at all (wave 2): Linux tier B/C labs, containers (Docker), IaC
(Terraform), automation (Ansible), and the exam task pools of those domains.

## Resume order

1. **Machine:** compact the Docker disk file (below), start Docker Desktop, then
   `task dev:up` (it now heals expired KubeVirt certs itself) and `task dev:deps`.
2. **Platform fixes (one agent):** vcluster Pod Security hole; kubeadm init retry
   and configurable provisioning timeout; Kube-OVN link switching (layer2_forward,
   vlan-passthru); a sudo-capable learner option for pod labs; asset templating in
   `file.source` (copied verbatim per the schema, but labctl substitutes `{{ }}`);
   grader default timeout for multi-call checks.
3. **Exam integration:** deploy script so `task dev:orchestrator` reconciles
   gateway ExamSessions; port `exam-smoke.mjs` to real auth + CSRF and run the live
   proof.
4. **Foundations:** boot-test `kubeadm:1.37-full`, build `deb-lab` and `ubuntu-vm`,
   deploy the mirrors (`task mirror:up`), Kata spike when disk allows.
5. **Resume content streams** from their handoffs, verify queues one VM job at a
   time (`tools/slots/run.sh`), then exam runs (`labctl exam run --auto-solve`
   and `--no-solve`) per exam.
6. **Security CI:** write the workflows from `docs/handoffs/security-ci.md`, apply
   the GitHub settings checklist, then make the repo public.
7. **Wave 2 streams:** Linux B/C, containers, IaC, automation.

## Running state when paused

- kind cluster `cloudtrain-dev` (context `kind-cloudtrain-dev`); KubeVirt, CDI,
  Kube-OVN, Multus. Scoped in-cluster orchestrator `cloudtrain-system` for
  gateway sessions (`task dev:orchestrator`).
- Compose deps `cloudtrain-dev-deps`: Postgres :55432, Keycloak :8180, Mailpit
  :8025. Gateway :8787 and web :5173 (real mode) were running in the user's
  session; restart with `task dev:gateway` / `task dev:web`.
- Crash logger: systemd user service `cloudtrain-crashlog`
  (`~/cloudtrain-crashlog/monitor.log`).
- Post-commit hook auto-pushes every commit (`.git/autopush.log`).

## Machine

- Heavy work only through `tools/slots/run.sh` (vm 2, build 1, pod 4 slots). Even
  so, two kubeadm jobs plus image builds pushed load to 70-110; verify times were
  10-25 min per lab. Consider `vm` = 1 on this machine.
- VM image builds use TCG (no nested KVM in libguestfs) after three WSL crashes
  and one Windows BSOD during KVM builds; keep it that way.
- Agents must keep scratch files in their own folders and only use ports they
  start (collisions happened).
- Disk: the Docker disk file and the WSL Kali disk aren't sparse. To give space
  back to Windows: quit Docker Desktop, `wsl --shutdown`, then in an admin
  PowerShell run `diskpart` → `select vdisk file="...\Docker\wsl\disk\docker_data.vhdx"`
  → `attach vdisk readonly` → `compact vdisk` → `detach vdisk`; and
  `wsl --manage <distro> --set-sparse true` for the WSL disk.

## Open decisions (user)

- Curriculum rework questions: drop the legacy Docker-cert overlay path? "Docker" in
  the Docker exam title? Add a professional-level Terraform simulation? External
  customers get OpenTofu until IBM confirms Terraform hosting in writing — correct?
- Product names in lab titles (Kubernetes, Podman, OpenTofu, Ansible): keep or drop?
- Cisco IOS labs: CML Enterprise as a backend, or open NOS only.
- AI data policy for terminal traces (tutor, Studio).
- vCenter details (version, NSX, storage, capacity) for production.
- Employer IP release for contributions made on the corporate device.
- Licensor legal entity name and licensing contact in `LICENSE`; CLA legal review.

## Integration notes (wave-1 merge)

- Linux labs still use the interim `linux-pod-deb:24.04` / `linux-pod-el:10` images
  (`tools/images/linux-pod-interim/`); switch them to `deb-lab:24.04` / `el-lab:10`
  once `deb-lab` is built, then drop the interim catalog entries.
- The gateway serves curriculum `newSkills` that loaded labs use (a bridge);
  promote the Linux skills into `content/skills.yaml` like networking did.
- `secrets.yml` must scan history or tracked files only (gitignored `apps/web/dist`
  trips gitleaks in a working-tree scan).
