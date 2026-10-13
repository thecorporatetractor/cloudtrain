# CloudTrain tracker

What exists, what is proven, what follows. Status: **verified** (proven live on
the cluster or by an end-to-end run), **built** (code merged, tests pass, not
proven live), **in progress** (an agent is on it), **planned**. Curriculum status
lives in `content/curriculum.yaml` / `docs/curriculum.md`.

Last updated: 2026-10-14.

## Platform capabilities

| Area | Capability | Status | Evidence / branch | Next |
|---|---|---|---|---|
| Runtime | Local stack: kind + KubeVirt + CDI + Kube-OVN + Multus (`task dev:up`) | verified | recovered after WSL reboots in ~110 s; KVM probe VM | |
| Runtime | Lab isolation (NetworkPolicy, VPC per lab, no internet) | verified | 13-connection check in `task lab:demo` | |
| Runtime | Node driver: container (jumphost, learner/admin split) | verified | `labctl verify` runs; learner cannot read admin creds | Kata RuntimeClass in production |
| Runtime | Node driver: k8s-cluster `virtual` (vcluster) | verified | 3 labs full verify cycle | |
| Runtime | Node driver: k8s-cluster `kubeadm` (KubeVirt VMs, PKI, notready nodes) | verified | count-schedulable-nodes full cycle (6 VMs) | Calico image adoption |
| Runtime | Node driver: vm (KubeVirt, cloud-init learner) | built | unit tests; etcd-host image built | live verify with etcd lab |
| Runtime | Node driver: netdev (FRR) + topology links (per-link segments, impair, capture) | verified | OSPF proof `deploy/.results/netdev-ospf-proof.txt` | vrnetlab VMs, SR Linux |
| Runtime | Grader (all check types, learner-safe messages, Running state) | verified | used by `labctl verify` | |
| Runtime | `labctl verify` (Studio verifier cycle, reports) | verified | 6 of 11 K8s labs pass | all 11 |
| Runtime | Orchestrator deployed in-cluster (`task orchestrator:deploy`) | verified | runtime stream | |
| Runtime | WarmPool, claim, hibernate/resume with state, reset | verified (vcluster) / built (kubeadm) | `deploy/.results/warmpool-virtual-proof.txt`: claim Ready in 0.5 s, resume keeps learner work | kubeadm proof once Docker is back |
| Images | Golden kubeadm node v1.37.1 (Calico, workload images preloaded, cni-install) | verified | `task lab:demo` PASS on the Calico image | |
| Images | kubeadm v1.36 upgrade image (v1.37.1 staged offline) | in progress | disk built; packaging interrupted by the Docker Desktop crash | `PACKAGE_ONLY=1` + boot test |
| Images | etcd-host 3.6 VM image | verified | boot test: TLS health, lab setup + solution pass | full lab verify |
| Images | jumphost:1, frr:10, nettools:1 | verified | used in live runs | |
| Images | Image builds without nested KVM (TCG), one at a time | verified | no WSL crash since the change | |
| Content | Lab schema v3 (+ expectFail, alternatives, file.source) | verified | compiler + lab-verify + Go tests | curriculum schema |
| Content | Skill graph (153 K8s-focused skills) + CKA/CKAD/CKS/LFCS/CCNA mappings | built | `content/skills-review.md` | merge Linux/Docker/IaC/Ansible skills after curriculum approval |
| Content | Kubernetes pack: 11 labs | built (6 verified) | `labctl verify` | verify remaining 5 |
| Content | Research: Linux, Docker, Terraform, Ansible | done | `docs/research/reports/` | |
| Content | Full curriculum proposal (all domains, paths, labs, exams) | in progress | branch `curriculum` | user approval |
| Web | Learner UI: home, catalog, lab overview, workspace, skills, studio, team (mock) | built | README screenshots | |
| Web | Real mode: catalog, sessions, real terminal, validate | verified | `apps/web/scripts/smoke-real.mjs` | |
| Gateway | BFF: content catalog, sessions, terminal WebSocket, hints, validate | verified | 31 tests + live smoke | |
| Identity | SSO (Keycloak broker, identity-first, Entra ID), JIT provisioning | in progress | branch `k8s/platform-api` | Entra app pending user approval |
| Identity | Roles + permission matrix (learner, manager, instructor, author, org_admin, platform_admin) | in progress | `docs/platform-identity.md` | |
| Data | Postgres with row-level security, persisted attempts, learner model | in progress | branch `k8s/platform-api` | |
| Web | Sign-in, role-aware nav, manager / instructor / admin / platform views | in progress | branch `k8s/platform-web` | |
| Exams | Exam simulation mode (timed multi-task, no hints, pass mark, report) | planned | definitions in curriculum proposal | engine + UI after approval |
| Studio | Scenario Studio generation + real-lab verification | planned (UI mocked) | | after exam mode |
| Tutor | AI tutor / failure explainer | planned | | needs AI data policy decision |
| Ops | Local stack stability: Docker Desktop crashed under heavy load (01:10, SIGBUS) | open | crash log `~/cloudtrain-crashlog` | user restart; cap parallel heavy builds |
| Ops | Production on vCenter (nested virt, Kata, node pools) | planned | | vCenter details needed |
| Legal | BUSL-1.1 + CC BY-NC 4.0, NOTICE, third-party inventory | done | `LICENSE`, `content/LICENSE` | |
| Legal | CLA (draft), legal review, licensor entity name, contact | planned | `CLA.md` | |

## Open decisions (user)

| Decision | Status |
|---|---|
| Entra app registration for SSO (via the meetbot session / ~/terraform HCP module) | waiting on user |
| Curriculum approval (domains, paths, labs, exams) | waiting on proposal |
| Terraform CLI vs OpenTofu default (licensing) | proposed: OpenTofu default |
| Cisco images (CML Enterprise backend) | open |
| Domain order after Kubernetes | open |
| AI data policy for terminal traces | open |
| vCenter details (version, NSX, storage, capacity) | open |
| GUI/Windows labs in year one | open |
| Employer IP release for contributions from a corporate device | user to arrange |
