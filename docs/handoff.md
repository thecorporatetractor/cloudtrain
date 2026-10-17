# CloudTrain handoff

Paused on 2026-10-14. All wave-1 branches are merged into `main` (9c272fc); every gate passes (gateway 106 tests, lab-verify 31, Go 150, `labctl validate` 214 labs, lab-verify --strict clean). This is the entry point to resume work; each stream has
its own detailed handoff in `docs/handoffs/`.

## Read first

Platform fixes round 3 (branch `fix/platform-round-3`) closed the first four
items of the old list; round 4 (branch `fix/platform-round-4`, proof in
`deploy/.results/platform-round-4-proof.txt`) closed what was left of them except
Kata and the kubeadm proof under load:

0. **Round 4.** Kubernetes checks (k8s-query, k8s-can-i, k8s-context) default to a
   20 s timeout (was 5 s). Every vcluster gets the ValidatingAdmissionPolicy
   `cloudtrain-ephemeral-pod-security`: `kubectl debug` with the default profile is
   refused at once with a message naming `--profile=baseline`, instead of a debug
   container that never starts and blocks the Pod's later ones. Lab link attachments
   are rate-limited on the host side (`--link-rate-mbps`, default 10 Mbit/s each way).
   A wired entry node's NetworkPolicy no longer filters its link attachments (P3),
   and wired pods run in a user namespace with writable network sysctls (P4,
   `--link-sysctls`). The round-3 manager `ct-k8sdevsec-system` has been deleted.

1. **vcluster Pod Security: fixed.** Every vcluster host namespace now enforces
   Pod Security `baseline` (audit `restricted`; manager flag
   `--vcluster-pod-security`, deploy variable `VCLUSTER_POD_SECURITY`). Proven live: a
   learner's privileged + hostPID + hostPath `/` pod stays Pending with
   `SyncError ... violates PodSecurity "baseline:latest"`, a plain pod runs.
   `restricted` is not usable as the enforced level (it rejects the vcluster
   syncer itself and most lab workloads). Still open: Kata isolation in production.
   `xks-drop-privileged` now starts from refused Pods (statement says so).
2. **kubeadm under load: fixed in code, not yet proven under load.** `kubeadm init`
   is retried up to 3 times with `kubeadm reset` in between (pre-seeded CA
   restored), workers retry join up to 8 times, kubeadm timeouts are longer, and
   `PROVISION_TIMEOUT=40m bash deploy/scripts/orchestrator-deploy.sh` (or with
   `task dev:orchestrator`) sets `--provision-timeout`. Still advised: one VM
   verify at a time on this machine.
3. **Lab links switch: fixed.** Link attachments carry `layer2_forward`, link
   logical switches get `vlan-passthru=true` (manager execs `ovn-nbctl` in
   ovn-central, flag `--ovn-central`). Proven with the `net-trunk-two-switches`
   draft (VLAN 20/30 tagged + native 99 across two Linux bridges). The L2 drafts in
   `docs/handoffs/networking-drafts/` no longer need `l2shim.sh`. P3, P4 and the
   link rate limit: fixed in round 4 (item 0); `net-fix-broadcast-storm` may run.
4. **Learner sudo: available as an opt-in.** Entry node `learnerSudo: true`
   (security trade-off, see `docs/dev-environment.md`); the lab's setup grants the
   sudoers rule. Default stays `allowPrivilegeEscalation: false`; operators can
   refuse such labs with `--allow-learner-sudo=false`. The linux-a root labs can
   now be written.
5. **Windows C: drive is nearly full** (~16 GB free on 2026-10-15). Docker's disk file is
   ~237 GB though Docker now holds ~80 GB; compact it (see "Machine" below).

## Where things are

| Area | State | Detail |
|---|---|---|
| Platform: SSO, roles, Postgres + RLS, audit | merged, proven (54-check live proof) | `services/gateway/README.md`, `docs/platform-identity.md` |
| Entra ID SSO (AzarGuard tenant) | live: app "CloudTrain (local dev)", 6 app roles via 6 groups; secret expires 2027-04-14 | `~/.config/cloudtrain/entra-dev.env` (never commit) |
| Web: learner, manager, instructor, admin, platform views | merged | `apps/web/README.md`, screenshots in `apps/web/docs/screenshots/platform/` |
| Lab runtime: container, vcluster, kubeadm, VM, netdev drivers; grader; `labctl verify` | merged, verified on several labs | `services/lab-orchestrator/README.md` |
| Warm pools, hibernate/resume, reset | merged; proven on vcluster; kubeadm proof pending | `deploy/.results/warmpool-virtual-proof.txt` |
| Exam simulations (engine + gateway + web) | merged; proven live end to end on 2026-10-15 (Keycloak login + CSRF, gateway :8787, `task dev:orchestrator` manager reconciling the ExamSession, partial solve scored 51, environments released; `deploy/.results/exam-integration-proof.txt`); 3 of 13 exams compile (the K8s ones), the rest wait for pool labs | `docs/handoffs/exam-integrate.md` |
| Images | kubeadm 1.37 (Calico), 1.36 upgrade, etcd-host, jumphost, frr, nettools, netsvc, el-lab:10, el-vm:10 built; kubeadm:1.37-full/-sec built not boot-tested; deb-lab, ubuntu-vm not built; mirrors partial | `docs/handoffs/foundations.md` |
| Security CI | merged: pre-public scans done, real issues fixed (Go 1.26.9, gRPC, token tag check), no secrets in history (gitleaks 186 commits); workflows NOT written yet | `docs/handoffs/security-ci.md` |
| Curriculum | approved (Docker-first containers, Terraform-first IaC): 878 labs, 43 paths, 13 exams | `content/curriculum.yaml`, `docs/curriculum.md`, review page https://claude.ai/artifact/1qkEpeMhv1M7Qa5DsfcZpY |

## Labs by stream (wave 1)

| Stream | Owned | Verified live | Written, not yet verified | Blocked / not started | Handoff |
|---|---|---|---|---|---|
| k8s-admin | 88 | 5 | 63 | 18 blocked on add-ons, 2 not written | `docs/handoffs/k8s-admin.md` |
| k8s-dev | 42 | 33 (every V-tier lab; round 3, 2026-10-17); sim-k8s-developer exam run live: auto-solve 100 %, no-solve 14.5 % | 5 K-tier (vm slot) | 4 blocked (buildah, metrics-server, ingress) | `docs/handoffs/k8s-dev.md` |
| k8s-sec | 51 | 12 (every V-tier lab; round 3) | 27 K-tier (vm slot) | 12 blocked on security tooling | `docs/handoffs/k8s-sec.md` |
| networking | 77 | 2 | 31 drafts (parked in `docs/handoffs/networking-drafts/`) | 44 not started (exam tasks, SR Linux, Ansible) | `docs/handoffs/networking.md` |
| linux-a | 62 | 1 | 21 | ~40 not started (sudo, mirror, mis-tiered) | `docs/handoffs/linux-a.md` |
| original 11 K8s labs | 11 | 4+ | — | — | `content/packs/kubernetes` |
| iac (wave 2) | 99 | 48 (23 foundations labs + 25 sim-iac-associate tasks; exam runs 100 % / 11.7 %) | 0 | 31 learning labs, 18 sim-iac-advanced tasks, 2 capstone tasks not started | `docs/handoffs/iac.md` |
| containers (wave 2, Docker on `docker-vm:29`) | 135 | 6 | 18 (6 learning, 12 exam tasks) | 12 exam tasks + 79 learning labs not started | `docs/handoffs/containers.md` |

Most "blocked on add-ons" labs should unblock with `kubeadm:1.37-full` (metrics-server,
Traefik ingress + Gateway API, MetalLB, local-path, Falco, gVisor, kube-bench) once it
is boot-tested and the labs switch to it.

Wave 2: IaC has started (see the iac row; image `terraform-ws:1.15`, Terraform/OpenTofu
swappable per tenant), and so has containers (see the containers row; every lab runs on
a `docker-vm:29` KubeVirt VM, design and escape test in `docs/handoffs/containers.md`).
Not started at all: Linux tier B/C labs, automation (Ansible), and the exam task pools of
those domains.

## Resume order

1. **Machine:** compact the Docker disk file (below), start Docker Desktop, then
   `task dev:up` (it now heals expired KubeVirt certs itself) and `task dev:deps`.
2. **Platform fixes:** done in round 3 (read-first 1-4 above, plus: `file.source`
   assets are templated and the schema now says so; shell checks default to a 30 s
   timeout; the gateway smoke lab creates the learner's `~/handover`) and round 4
   (item 0). Left: Kata and the kubeadm proof under real load.
3. **Exam integration: done** (2026-10-15). `task dev:orchestrator` reconciles the
   gateway's ExamSessions (selector `app.kubernetes.io/managed-by=cloudtrain-gateway`;
   the deploy warns when another manager would overlap); `exam-smoke.mjs` logs in
   through Keycloak with CSRF and passed live (attempt `exam-2dc04c2d63`, score 51,
   ready in 49 s, graded 6 s after submit). Left: screenshots of the exam screens
   (optional) and per-exam runs once pool labs exist (item 5).
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
  :8025. **The Postgres volume is still a v17 data directory** while
  `deploy/dev/compose.yaml` now pins Postgres 18, so `task dev:deps` stops at
  `check-volume.sh`. For the exam proof the old v17 containers were started with
  `docker start cloudtrain-dev-deps-{postgres,keycloak,mailpit}-1` (no reset; migration
  `0003_exams` applied). User step: dump/reset per `docs/dev-environment.md`
  ("Postgres major upgrades"), then `task dev:deps`. Gateway :8787 and web :5173 (real mode) were running in the user's
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
