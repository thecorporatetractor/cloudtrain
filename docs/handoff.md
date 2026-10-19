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
   (calico-node, controller-manager). MetalLB reachability from the workstation works
   (a first-connection race with kube-proxy, see `docs/handoffs/foundations.md`). Exam runs for sim-k8s-security and
   sim-k8s-admin still blocked on pool coverage (`docs/handoffs/k8s-sec.md`, `k8s-admin.md`).

## Where things are

| Area | State | Detail |
|---|---|---|
| Platform: SSO, roles, Postgres + RLS, audit | merged, proven (54-check live proof) | `services/gateway/README.md`, `docs/platform-identity.md` |
| Public website (landing, catalog, path/exam detail, pricing placeholder, about, FAQ, contact, legal) in `apps/web`; `content/site.yaml` + Site schema; gateway `/api/public/*` (cached, rate-limited, content only) | PRs 1 and 2 of the paid-path series merged (website; plans and pricing with placeholder prices); Stripe test mode (PR 3) follows | `docs/website.md`, `docs/handoffs/website.md` |
| Entra ID SSO (AzarGuard tenant) | live: app "CloudTrain (local dev)", 6 app roles via 6 groups; secret expires 2027-04-14. Headless real sign-in for local end-to-end tests as `ct-e2e@azarguard.com` (no MFA, Conditional Access: this machine's IP + CloudTrain only): `deploy/scripts/entra-login.mjs`, proven 2026-10-17 (roles learner + manager, no admin) | `~/.config/cloudtrain/entra-dev.env`, `entra-e2e.env` (never commit); `docs/dev-environment.md` |
| Web: learner, manager, instructor, admin, platform views | merged | `apps/web/README.md`, screenshots in `apps/web/docs/screenshots/platform/` |
| Lab runtime: container, vcluster, kubeadm, VM, netdev drivers; grader; `labctl verify` | merged, verified on several labs | `services/lab-orchestrator/README.md` |
| Warm pools, hibernate/resume, reset | merged; proven on vcluster; kubeadm proof pending | `deploy/.results/warmpool-virtual-proof.txt` |
| CTF: answer checks (schema, compiler, `labctl verify`, computed answers), questions panel, events | PR 1 of 3 merged (#71): `type: answer` checks with exact / number / regex / any-of matchers, secret params, `answer.compute` run after setup into `status.computedAnswers`, `solution.answers` and wrong-answer misconceptions verified by `labctl verify`; curriculum `type: ctf`; demo lab `ctf-ticket-gate-breach` (built, waits for the verify VM). The CRDs changed: apply `services/lab-orchestrator/config/crd` before running answer labs, or the API server prunes the new fields. PR 2: questions panel in the lab view; gateway `/api/sessions/:id/questions*` grades answers server side (TypeScript matcher on the shared vectors), stores them in Postgres (`0005_ctf_answers`, RLS, append-only), audits and rate-limits them (`CT_ANSWER_RATE_PER_MINUTE`); CTF points in History and Skills. PR 3: CTF events (`/events`, migration `0006_ctf_events`, permission `event.manage`): solo or teams, teammates share a seed and progress, static or dynamic (decaying) points, first bloods, live scoreboard with solve timeline and an optional freeze for the last N minutes, manager view and CSV export. Not yet run against a live cluster: an event lab session end to end (start from the event page, answer in the lab, scoreboard) after the CRD update | `docs/ctf-authoring.md`, `docs/ctf-events.md`, `docs/api/platform.md`, `services/lab-orchestrator/README.md` ("Grading", "labctl verify") |
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
| networking | 78 | 25 (net-fix-broadcast-storm in platform round 5; round 3, 2026-10-17: 9 learning labs incl. every VLAN/trunk/STP/LACP/VRRP lab, 15 sim-net-associate tasks = every objective's draw; exam compiles with `--allow-missing`; exam run live in platform round 5: auto-solve 100 %, no-solve 14.3 %, clean teardowns) | 47 built (write-only, round 5); `docs/handoffs/networking-drafts/` holds only the 6 blocked drafts (SR Linux x5, net-ansible-frr-backup) | round 5 closed (PRs #56, #61, #75 merged, none open): verify queue is 19 container-pod + 28 netdev-pod labs, no vm/kubeadm, Kata or image-blocked built labs; wave 3 built net-jinja-render-frr and drafted the 6 blocked labs (SR Linux x5, net-ansible-frr-backup; see the blocker table in `docs/handoffs/networking.md`); wave 2 built (7 security/VPN labs, 16 pool tasks incl. json-neighbour-export, 2 xpe-net tasks; pools 6/6, 6/6, 8/8, 4/4, 4/4, automation 2 + 1 blocked); SR Linux/Ansible labs blocked | `docs/handoffs/networking.md` |
| linux (round 4) | 278 in curriculum | 53 (36 tier A incl. 14 root labs with learnerSudo; 17 sim-el-sysadmin tasks) | 20 sim-el-sysadmin + 30 sim-linux-sysadmin tasks, 14 tier B/C learning labs (built) | tier B/C beyond systemd/storage/SELinux/AppArmor, sim-linux-pro, mirror/server tier-A labs; image gaps (autofs, ubuntu-vm apt) | `docs/handoffs/linux-bc.md` |
| linux (round 5, wave 1) | 24 tier-A learning labs | 6 (packages, venv, setgid, GPG, TLS, expired cert; live on pod slots before the no-local-live-testing rule) | 18 built (9 changed after their live verify and need re-verify: manuals, cron, ACLs, ssh key perms, strace, AIDE, logrotate, Apache, signal box 3; 9 with docker preflight green (nginx, HAProxy, BIND, Unbound, Postfix, PostgreSQL backup, image-file filesystems, apt pinning, dnf repos) | none; el variants of packages-install-from-mirror / package-repo-pinning not written (versionlock plugin not mirrored) | `docs/handoffs/linux-r5-w1.md` |
| linux (round 5, wave 2) | 24 sim-linux-pro tasks (system-management 10, services-users 8, automation-scripting 6) | 0 | 24 built (15 tier-A pod tasks, 9 tier-B VM tasks); none run live; sim-linux-pro pools system-management, services-users, automation-scripting at 2x their draw | tier-B tasks need a VM runner; xlp-container-network builds an offline podman image from the local dnf repo; xlp-cloud-init-userdata installs cloud-init from the mirror | `docs/handoffs/linux-r5-w2.md` |
| linux (round 5, wave 3) | 22 (8 sim-linux-pro security, 8 troubleshooting, 3 xpe-host/incident tasks, 3 disk-pressure and port learning labs) | 0 | 22 built (6 tier-A pod tasks, 16 tier-B/C VM labs); none run live; sim-linux-pro complete and compiling without --allow-missing, added to the CI compile step | tier-B/C need a VM runner; xlp-fix-time-skew uses a Python NTP responder in a namespace; xpe automation tasks must adopt the shared qm-build VM block (2 disks) before sim-platform-engineer compiles | `docs/handoffs/linux-r5-w3.md` |
| linux (round 5, summary) | waves 1-3 merged (PRs #69, #115, #122): 70 labs and tasks | 36 verified by the remote runner (22 wave 1, 14 wave 2) | 34 built on main (3 fixed after verify runs; follow-up PR #161 open, state as of 2026-10-19); wave 4 (PR #143, 23 networking VM labs) is NOT merged: review round 3 found 2 major mutation issues (wireguard-depot-tunnel, chrony-server-isolated) | none on main; on PR #143: iperf-throughput-baseline (iperf3 not mirrored) and netem-impaired-link (sch_netem) image-blocked; sim-linux-pro complete, sim-platform-engineer xpe-ansible tasks need the shared VM block | `docs/handoffs/linux-r5.md` (verify queue by slot kind: 9 pod, 19 ubuntu-vm, 6 el-vm; no kubeadm, netdev, Kata or image-blocked) |
| original 11 K8s labs | 11 | 4+ | — | — | `content/packs/kubernetes` |
| iac (wave 2) | 99 | 99 (round 2, 2026-10-18: 31 learning labs in the other four paths, the 18-task sim-iac-advanced pool incl. 9 on a Moto lab peer, 2 capstone tasks standalone); sim-iac-associate 100 % / 11.7 %, sim-iac-advanced 100 % twice / 27.8 % | 0 | capstone tasks wait for a shared-workstation decision (jumphost has no Terraform); 3 labs Terraform-only | `docs/handoffs/iac.md` |
| containers (wave 2, Docker on `docker-vm:29`) | 135 | 24 (12 learning, 12 exam tasks) | 113 (round 5 wave 1: 11 learning labs in the efficient-images and BuildKit modules + the 12 remaining sim-containers-docker tasks, every sim-containers-docker pool at 2x its draw; wave 2: 21 Podman-track labs/tasks (merged, sim-containers-podman pools all at 2x their draw); wave 3: 23 Compose, networking and storage labs; wave 4: 20 registries/security/supply-chain labs + the 4 sim-platform-engineer containers-delivery tasks (pool now 4/2), PR #114) | 79 learning labs minus those written (ctr-macvlan-encoder in wave 3 is written but blocked on a Multus second NIC); image gaps carried forward: moby/buildkit (ctr-buildx-cache-export), golang:1.25-alpine (xcd-build-multistage-nonroot), trivy/grype/scout + an offline vuln DB (ctr-scan-triage-vex, ctr-scout-policy; they also need fixture advisories in the DB), docker/buildkit-syft-scanner (ctr-sbom-provenance, ctr-signed-only-gate, xpe-image-sign-verify), cosign (xcd-supply-sbom-sign, ctr-content-trust-retired, ctr-cosign-sign-verify, xpe-image-sign-verify), notation (ctr-notation-sign-verify, ctr-signed-only-gate); ctr-reproducible-build unconfirmed flags; wave 5 (19 labs: troubleshooting and production ops, delivery, internals, three-VM swarm; merged, PR #124; its review-fix commit landed in a follow-up PR, so ctr-link-env-removed and ctr-swarm-init-quorum need a re-verify) has 3 image-blocked labs (`ctr-engine-upgrade` needs an Engine 28 variant, `ctr-ci-rootless-buildkit` needs rootless buildkit/cosign/trivy, `ctr-release-pipeline-capstone` needs cosign/buildkit/buildkit-syft-scanner) and unconfirmed VPC ports for the 3 swarm labs; round 5 closed, no containers PR open (waves 1 to 5 = #58, #63, #87, #114, #124; 111 labs/tasks built, all 79 learning labs written); verify queue is all vm slot (13 single-VM wave 5 labs, 3 multi-VM swarm labs run alone, none pod/kubeadm/netdev), 13 image-blocked, 1 infra-blocked (`ctr-macvlan-encoder`) | `docs/handoffs/containers.md` |
| automation (wave 2, Ansible on `ansible-ctl:2.21`) | 97 | 9 (ansible-fundamentals tier-A labs, pod fleets) + sim-el-automation exam run live (15 tasks on 4 el-vm VMs incl. re-run and reboot: auto-solve 100 %, no-solve 2 %) | 15 sim-el-automation tasks (one per draw) + 21 more built in round 5 wave 1 (19 xan tasks, 2 xpe capstone tasks; 2 blocked on fedora.linux_system_roles; none run live); round 5 wave 2: 23 tier-A pod labs built in PR #84, NOT merged (4 majors + README/docs conflicts; ov-devcontainer-workflow blocked on code-server + web proxy); round 5 wave 3: 21 labs built in PR #126 (12 VM labs incl. the 3 tier-B fundamentals labs, 9 blocked on frr:10 ssh/python3, fedora.linux_system_roles, EE/registry images, ansible-rulebook; the 2 review majors (ov-net-parse-neighbors, ov-block-rescue-db-maintenance) and 3 minors fixed before merge; 21 built, 9 blocked, none verified live). Round 5 wave 4 decision: the 8 controller/alert-remediation labs stay proposed and NOT written (blocked: needs awx:24 + gitea:1 + alertmanager image; no catalog entries for unbuilt images). All blockers: linux_system_roles (3), code-server (1), ansible-rulebook/JDK (1), frr sshd/collections (6), srlinux fallback, EE build infra (1), galaxy-ng/gitea adaptations, awx/alertmanager (8), el10 mirror lacks php and comps groups (adapted). Verify queue: vm 12 (+ exam tasks), pod 22 (PR #84), no netdev/kubeadm/Kata; image-blocked 10 | 6 more paths (about 28 labs) | `docs/handoffs/automation.md` |
| security operations (KQL engine, image `kql-ws:1`) | engine only; labs come from the curriculum agent | spike: 47 of 50 SOC queries and every typical detection right on KustoLoco v1.4.9 + 16 CloudTrain patches (stock: 34); image builds in CI | 0 labs written | gaps for labs: top-nested, evaluate pivot/autocluster, percentiles(), row_cumsum, parse-kv; lab schema has no `security` domain yet; upstream publishing of patches 1-15 is the user's call | `docs/handoffs/soc.md` |

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
   Left: Kata spike, switching the other
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
