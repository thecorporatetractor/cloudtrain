# CloudTrain handoff

Paused on 2026-10-14. All wave-1 branches are merged into `main` (9c272fc); every gate passes (gateway 106 tests, lab-verify 31, Go 150, `labctl validate` 214 labs, lab-verify --strict clean). This is the entry point to resume work; each stream has
its own detailed handoff in `docs/handoffs/`.

## Read first

Platform fixes round 3 (branch `fix/platform-round-3`) closed the first four
items of the old list; round 4 (branch `fix/platform-round-4`, proof in
`deploy/.results/platform-round-4-proof.txt`) closed what was left of them except
Kata and the kubeadm proof under load:

0. **Round 5** (branch `fix/platform-round-5`). Container nodes of one lab reach each
   other by name: every container node without links (entry included) is a *lab peer*
   with DNS name `<node>` inside its session (headless Service `ct-<hash>-nodes` as the
   pods' subdomain + search domain) and the NetworkPolicy `ct-<hash>-peers` allows any
   port between the session's peers, nothing from other labs or the platform, and
   egress only to peers, DNS and the mirrors (non-entry container nodes used to be open
   both ways). Proof `deploy/.results/lab-peers/` (20/20: S3 + Git + a Terraform s3
   backend by name; another lab, the API server, the host, the internet and a platform
   pod all refused). Authoring rules in `docs/k8s-readiness.md` ("Access"). Unblocks
   separate Moto/S3/Git nodes (IaC) and Ansible managed nodes.
   Also in round 5: headless Entra sign-in for local end-to-end tests
   (`deploy/scripts/entra-login.mjs`, #42), `net-fix-broadcast-storm` verified (#44),
   the `sim-net-associate` exam run live (100 % / 14.3 %), and a Kube-OVN CNI hang under
   heavy load with its recovery (`docs/dev-environment.md`, known gap 9). Kata spike:
   prepared (`tools/kata-spike/spike.sh`, throwaway kind cluster), not run because the
   heavy slot was queued for hours; see `docs/handoffs/foundations.md`.

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
2. **kubeadm under load: init retry proven, post-init still load-bound.** `kubeadm init`
   is retried up to 3 times with `kubeadm reset` in between (pre-seeded CA restored),
   workers retry join up to 8 times, longer kubeadm timeouts, and `PROVISION_TIMEOUT=40m
   task dev:orchestrator` sets `--provision-timeout`. Round 3 (2026-10-17): at host load
   3-50 every two-node `kubeadm:1.37-sec` session came up (Ready in 5-31 min, init first
   try); at load 80-166 the retry fired naturally once (attempt 1 failed in
   wait-control-plane, reset, attempt 2 started) but no session became Ready in 40 min:
   with 64-85 % CPU steal kube-apiserver, the controllers and calico-node (2 s startup
   timeout) crashloop after init. Run one VM job and no TCG build at a time.
3. **Lab links switch: fixed.** Link attachments carry `layer2_forward`, link
   logical switches get `vlan-passthru=true` (manager execs `ovn-nbctl` in
   ovn-central, flag `--ovn-central`). Proven with the `net-trunk-two-switches`
   draft (VLAN 20/30 tagged + native 99 across two Linux bridges). The L2 drafts in
   `docs/handoffs/networking-drafts/` no longer need `l2shim.sh`. P3, P4 and the
   link rate limit: fixed in round 4 (item 0); `net-fix-broadcast-storm` may run.
   Networking round 3 verified every L2 lab on it; the broadcast storm followed in
   round 5 (its capture check now counts multicast copies too).
   The `labctl verify` / exam auto-solve netdev bug (steps on FRR nodes failed with
   `exec not implemented`) is fixed in `drivers.NewRuntime`, so the 12 round-3 labs
   verified with a locally patched labctl match what main runs now.
4. **Learner sudo: available as an opt-in.** Entry node `learnerSudo: true`
   (security trade-off, see `docs/dev-environment.md`); the lab's setup grants the
   sudoers rule. Default stays `allowPrivilegeEscalation: false`; operators can
   refuse such labs with `--allow-learner-sudo=false`. The linux-a root labs were
   written with it in round 4 (14 verified, `docs/handoffs/linux-bc.md`).
5. **Windows C: drive is nearly full** (~16 GB free on 2026-10-15). Docker's disk file is
   ~237 GB though Docker now holds ~80 GB; compact it (see "Machine" below).

6. **kubeadm round 4 (2026-10-18).** All kubeadm labs of k8s-admin/-dev/-sec now use
   the image their tooling needs (`kubeadm:1.37-full` for add-ons, `-sec` for every CKS lab;
   exam topologies switched together). Falco labs rewritten for the DaemonSet, ingress-TLS
   labs for Traefik. Only 2 K labs got verified: the heavy slot was won twice in ~7 h
   (no FIFO) and at host load 25-50 three-node clusters still crashloop after init
   (calico-node, controller-manager). MetalLB reachability from the workstation is still
   unproven (see `docs/handoffs/foundations.md`). Exam runs for sim-k8s-security and
   sim-k8s-admin still blocked on pool coverage (`docs/handoffs/k8s-sec.md`, `k8s-admin.md`).

## Where things are

| Area | State | Detail |
|---|---|---|
| Platform: SSO, roles, Postgres + RLS, audit | merged, proven (54-check live proof) | `services/gateway/README.md`, `docs/platform-identity.md` |
| Entra ID SSO (AzarGuard tenant) | live: app "CloudTrain (local dev)", 6 app roles via 6 groups; secret expires 2027-04-14. Headless real sign-in for local end-to-end tests as `ct-e2e@azarguard.com` (no MFA, Conditional Access: this machine's IP + CloudTrain only): `deploy/scripts/entra-login.mjs`, proven 2026-10-17 (roles learner + manager, no admin) | `~/.config/cloudtrain/entra-dev.env`, `entra-e2e.env` (never commit); `docs/dev-environment.md` |
| Web: learner, manager, instructor, admin, platform views | merged | `apps/web/README.md`, screenshots in `apps/web/docs/screenshots/platform/` |
| Lab runtime: container, vcluster, kubeadm, VM, netdev drivers; grader; `labctl verify` | merged, verified on several labs | `services/lab-orchestrator/README.md` |
| Warm pools, hibernate/resume, reset | merged; proven on vcluster; kubeadm proof pending | `deploy/.results/warmpool-virtual-proof.txt` |
| CTF: answer checks (schema, compiler, `labctl verify`, computed answers) | PR 1 of 3 merged: `type: answer` checks with exact / number / regex / any-of matchers, secret params, `answer.compute` run after setup into `status.computedAnswers`, `solution.answers` and wrong-answer misconceptions verified by `labctl verify`; curriculum `type: ctf`; demo lab `ctf-ticket-gate-breach` (built, waits for the verify VM). The CRDs changed: apply `services/lab-orchestrator/config/crd` before running answer labs, or the API server prunes the new fields. Learner UI and gateway submissions (PR 2) and events with a scoreboard (PR 3) follow | `docs/ctf-authoring.md`, `services/lab-orchestrator/README.md` ("Grading", "labctl verify") |
| Exam simulations (engine + gateway + web) | merged; proven live end to end on 2026-10-15 (Keycloak login + CSRF, gateway :8787, `task dev:orchestrator` manager reconciling the ExamSession, partial solve scored 51, environments released; `deploy/.results/exam-integration-proof.txt`); 3 of 13 exams compile (the K8s ones), the rest wait for pool labs | `docs/handoffs/exam-integrate.md` |
| Images | kubeadm 1.37 (Calico), 1.36 upgrade, etcd-host, jumphost, frr, nettools, netsvc, el-lab:10, el-vm:10, **deb-lab:24.04, ubuntu-vm:24.04, kubeadm:1.37-full/-sec** all built and verified (round 3: gVisor sidecar fix, add-on boot test); mirrors deployed (`cloudtrain-mirrors`: content, zot, Gitea; smoke test passes); Kata not started | `docs/handoffs/foundations.md` |
| Security CI | merged: pre-public scans done, real issues fixed (Go 1.26.9, gRPC, token tag check), no secrets in history (gitleaks 186 commits); workflows NOT written yet | `docs/handoffs/security-ci.md` |
| Curriculum | approved (Docker-first containers, Terraform-first IaC): 878 labs, 43 paths, 13 exams | `content/curriculum.yaml`, `docs/curriculum.md`, review page https://claude.ai/artifact/1qkEpeMhv1M7Qa5DsfcZpY |

## Labs by stream (wave 1)

| Stream | Owned | Verified live | Written, not yet verified | Blocked / not started | Handoff |
|---|---|---|---|---|---|
| k8s-admin | 88 | 16 (round 4, 2026-10-18: + all 11 V-tier exam tasks; no K lab yet) | 13 V + 57 K (add-on labs switched to `kubeadm:1.37-full`) | xka-expand-claim (no CSI expansion add-on), 2 not written; sim-k8s-admin pool: storage 0/2, troubleshooting 3/5, networking 1/3 | `docs/handoffs/k8s-admin.md` |
| k8s-dev | 42 | 33 (every V-tier lab; round 3, 2026-10-17); sim-k8s-developer exam run live: auto-solve 100 %, no-solve 14.5 % | 7 K-tier (xkd K tasks on `kubeadm:1.37-full`; ingress and metrics-server labs unblocked in round 4, not yet verified) | 2 blocked on buildah | `docs/handoffs/k8s-dev.md` |
| k8s-sec | 51 | 15 (round 4: + xks-dockerfile-hardening, xks-metadata-egress-block; gvisor-runtimeclass by foundations) | 31 K-tier on `kubeadm:1.37-sec` (Falco and Traefik rewrites included) | 5 blocked (buildah, Trivy, cosign); sim-k8s-security pool: cluster-setup 1/2, system-hardening 0/2, monitoring 1/3 | `docs/handoffs/k8s-sec.md` |
| networking | 77 | 25 (net-fix-broadcast-storm in platform round 5; round 3, 2026-10-17: 9 learning labs incl. every VLAN/trunk/STP/LACP/VRRP lab, 15 sim-net-associate tasks = every objective's draw; exam compiles with `--allow-missing`; exam run live in platform round 5: auto-solve 100 %, no-solve 14.3 %, clean teardowns) | 22 drafts in `docs/handoffs/networking-drafts/` | wave 2 built (7 security/VPN labs, 16 pool tasks incl. json-neighbour-export, 2 xpe-net tasks; pools 6/6, 6/6, 8/8, 4/4, 4/4, automation 2 + 1 blocked); SR Linux/Ansible labs blocked; `labctl verify` cannot exec steps on FRR nodes (see handoff) | `docs/handoffs/networking.md` |
| linux (round 4) | 278 in curriculum | 53 (36 tier A incl. 14 root labs with learnerSudo; 17 sim-el-sysadmin tasks) | 20 sim-el-sysadmin + 30 sim-linux-sysadmin tasks, 14 tier B/C learning labs (built) | tier B/C beyond systemd/storage/SELinux/AppArmor, sim-linux-pro, mirror/server tier-A labs; image gaps (autofs, ubuntu-vm apt) | `docs/handoffs/linux-bc.md` |
| original 11 K8s labs | 11 | 4+ | — | — | `content/packs/kubernetes` |
| iac (wave 2) | 99 | 99 (round 2, 2026-10-18: 31 learning labs in the other four paths, the 18-task sim-iac-advanced pool incl. 9 on a Moto lab peer, 2 capstone tasks standalone); sim-iac-associate 100 % / 11.7 %, sim-iac-advanced 100 % twice / 27.8 % | 0 | capstone tasks wait for a shared-workstation decision (jumphost has no Terraform); 3 labs Terraform-only | `docs/handoffs/iac.md` |
| containers (wave 2, Docker on `docker-vm:29`) | 135 | 24 (12 learning, 12 exam tasks) | 23 (round 5 wave 1: 11 learning labs in the efficient-images and BuildKit modules + the 12 remaining sim-containers-docker tasks; every sim-containers-docker pool at 2x its draw) | 79 learning labs minus the 11 written (waves 2 to 5 in progress); 4 of the 23 need image content (ctr-buildx-cache-export: moby/buildkit; xcd-build-multistage-nonroot: golang:1.25-alpine; xcd-supply-sbom-sign: cosign and the syft scanner; ctr-reproducible-build: unconfirmed flags) | `docs/handoffs/containers.md` |
| automation (wave 2, Ansible on `ansible-ctl:2.21`) | 97 | 9 (ansible-fundamentals tier-A labs, pod fleets) + sim-el-automation exam run live (15 tasks on 4 el-vm VMs incl. re-run and reboot: auto-solve 100 %, no-solve 2 %) | 15 sim-el-automation tasks (one per draw) + 21 more built in round 5 wave 1 (19 xan tasks, 2 xpe capstone tasks; 2 blocked on fedora.linux_system_roles; none run live) | 3 tier-B fundamentals labs (VMs), 6 more paths (49 labs) | `docs/handoffs/automation.md` |

Most "blocked on add-ons" labs should unblock with `kubeadm:1.37-full` (metrics-server,
Traefik ingress + Gateway API, MetalLB, local-path, Falco, gVisor, kube-bench), now
boot-tested; labs must call `addons-install <list> --wait` in their setup.

Wave 2: IaC has started (see the iac row; image `terraform-ws:1.15`, Terraform/OpenTofu
swappable per tenant), and so has containers (see the containers row; every lab runs on
a `docker-vm:29` KubeVirt VM, design and escape test in `docs/handoffs/containers.md`).
Linux tier B/C started in round 4 (`docs/handoffs/linux-bc.md`). Automation has started too
(see the automation row; managed nodes are el-lab/deb-lab pods linked to the control node, or
el-vm VMs for the exam).

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
4. **Foundations: done except Kata** (round 3, 2026-10-17). kubeadm:1.37-full/-sec,
   deb-lab, ubuntu-vm built and verified; mirrors deployed and smoke-tested;
   `gvisor-runtimeclass` and `text-filters-ticket-sales` switched to the new images.
   Left: Kata spike, MetalLB IP reachability inside a Kube-OVN VPC, switching the other
   add-on and Linux labs (see `docs/handoffs/foundations.md`).
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

- Heavy work only through `tools/slots/run.sh` (vm and build share 1 heavy slot, pod 4 slots). Even
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

- Decided 2026-10-17 (user: "as you advise"):
  - The legacy Docker-cert (`dca-legacy`) overlay path stays dropped; its domains remain lab tags only.
  - The containers exam keeps its neutral title ("Container practitioner practical exam
    simulation"), with Docker named in the description.
  - The scaled-down sizes in `ctr-disk-reclaim` (350-450 MiB) and
    `ctr-dockerfile-catalogue-api` (200 MiB of media) are accepted.
  - External customers get the OpenTofu workstation (`deploy/images/overlays/iac-opentofu.yaml`)
    until IBM confirms Terraform hosting in writing.
  - Public CI publishes only `iac-ws-tofu` to GHCR. The Terraform flavour is local only.
  - OpenTofu images keep the `terraform` -> `tofu` shim, so lab instructions don't fork.
  - The move to Terraform 1.16 / OpenTofu 1.13 is deferred to a later round (rebuild plus
    re-verify of 48 labs).
- Still open: add a professional-level Terraform simulation?
- Cisco FMC/FTD lab: waiting for Cisco's written answer on evaluation licensing before any work.
- Product names in lab titles (Kubernetes, Podman, OpenTofu, Ansible): keep or drop?
- Cisco IOS labs: CML Enterprise as a backend, or open NOS only.
- AI data policy for terminal traces (tutor, Studio).
- vCenter details (version, NSX, storage, capacity) for production.
- Employer IP release for contributions made on the corporate device.
- Licensor legal entity name and licensing contact in `LICENSE`; CLA legal review.

## Integration notes (wave-1 merge)

- Linux labs run on `deb-lab:24.04` / `el-lab:10` (round 4); the interim images are gone.
- The Linux `newSkills` are promoted into `content/skills.yaml` (round 4).
- `secrets.yml` must scan history or tracked files only (gitignored `apps/web/dist`
  trips gitleaks in a working-tree scan).
