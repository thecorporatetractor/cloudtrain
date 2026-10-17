<h1 align="center">CloudTrain</h1>

<p align="center">
  <b>Hands-on infrastructure training on real systems, graded automatically, with timed exam simulations.</b><br>
  Kubernetes · Linux · Docker · Terraform · Ansible · Networking
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: BUSL-1.1" src="https://img.shields.io/badge/license-BUSL--1.1-blue"></a>
  <a href="content/LICENSE"><img alt="Content: CC BY-NC 4.0" src="https://img.shields.io/badge/content-CC%20BY--NC%204.0-lightgrey"></a>
  <img alt="Status: early development" src="https://img.shields.io/badge/status-early%20development-orange">
</p>

<p align="center">
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/codeql.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/sast.yml"><img alt="SAST" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/sast.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/secrets.yml"><img alt="secrets" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/secrets.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/deps.yml"><img alt="dependencies" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/deps.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/images.yml"><img alt="images" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/images.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/dast.yml"><img alt="DAST" src="https://github.com/thecorporatetractor/cloudtrain/actions/workflows/dast.yml/badge.svg?branch=main"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/thecorporatetractor/cloudtrain"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/thecorporatetractor/cloudtrain/badge"></a>
</p>

![A CloudTrain lab: task with live checks, topology of real nodes, terminal into the lab](docs/images/workspace.png)

CloudTrain gives every learner their own real environment: kubeadm clusters on
VMs, virtual clusters, Linux hosts, routers and switches, wired together on a
private network. The learner works in a browser terminal, and the platform grades
the end state with typed checks, so there are no multiple-choice shortcuts. Each
result is evidence for specific skills, and an adaptive model picks the next lab.
When a learner is ready, they take a timed exam simulation built the same way.

## Highlights

- **Real environments, not simulators.** A lab is a topology: jumphost
  containers, KubeVirt VMs, kubeadm clusters booted from golden images, vclusters
  and FRR routers. Each lab gets its own Kube-OVN network, and every link is its
  own segment, with packet capture and latency/loss impairment.
- **Graded on what's actually there.** Checks are typed (Kubernetes queries,
  `auth can-i`, shell, files, service state, reachability, device commands) and
  run with admin credentials the learner never sees. Hints cost points, and
  learner-facing messages never reveal the answer.
- **Labs that are proven to work.** Every lab ships with a reference solution,
  alternative valid solutions, and wrong-approach "misconceptions". `labctl verify`
  runs each one live: checks must fail before the solution and pass after it,
  every misconception must fail the checks aimed at it, alternatives must pass,
  two random seeds must agree, and teardown must leave nothing behind.
- **Exam simulations.** One timer for the whole exam, no hints, tasks drawn from
  pools weighted like the real blueprint (a retake gets fresh tasks), one shared
  environment, and grading after a freeze, a re-run check and an optional
  reboot. The result is a per-objective score report, with pass/fail against the
  exam's pass mark.
- **Adaptive learning.** A skill graph spanning Kubernetes, Linux, containers,
  infrastructure as code, automation and networking, mapped to CKA, CKAD, CKS,
  LFCS, RHCSA-, Linux+-, Terraform-, RHCE- and CCNA-aligned objectives.
  Recommendations explain why each lab is next.
- **Built for organisations.** Enterprise SSO (Microsoft Entra ID, Okta, Google,
  any OIDC/SAML IdP brokered through Keycloak), roles from IdP app roles and
  groups, and per-organisation data isolation enforced by Postgres row-level
  security. There are views for learners, managers, instructors, authors, org
  admins and platform operators, plus an append-only audit log.
- **Fast and economical sessions.** Warm pools hand out a ready lab in under a
  second, and hibernate/resume keeps the learner's work while freeing compute.
  Instructors can observe a learner's terminal read-only (the learner sees a
  banner) and extend, reset or end sessions.

## A tour

| | |
|---|---|
| ![Home](docs/images/home.png) **Home**: the next best lab and why, goal forecast, mastery | ![Catalog](docs/images/catalog.png) **Catalog**: domains, paths and labs |
| ![Exam workspace](docs/images/exam-workspace.png) **Exam simulation**: one timer, task navigator with flags, terminals into the exam environment | ![Exam results](docs/images/exam-results.png) **Exam results**: per-task and per-objective breakdown against the pass mark |
| ![Real terminal](docs/images/real-terminal.png) **Real lab**: a terminal into a live lab on the cluster | ![Skills](docs/images/skills.png) **Skills**: mastery and uncertainty per framework |
| ![Team dashboard](docs/images/team.png) **Manager**: team competency heatmap, deadlines, at-risk learners | ![Assign](docs/images/assign.png) **Assign**: labs, paths or frameworks to people or teams, with due dates |
| ![Instructor board](docs/images/instructor-board.png) **Instructor**: live cohort board (phase, checks, time on task, "stuck" signal) | ![Observe](docs/images/observe.png) **Observe**: read-only shadow terminal, audited |
| ![Admin SSO](docs/images/admin-sso.png) **Org admin**: SSO connections, domain verification, group-to-role mapping | ![Audit log](docs/images/audit-log.png) **Audit log**: every administrative action, filterable and exportable |
| ![Sign in](docs/images/sign-in.png) **Sign-in**: identity-first, routes each email domain to its company's IdP | ![Scenario Studio](docs/images/studio.png) **Scenario Studio**: lab drafts and their verification gates |

Three themes: dark, light and cream ([light](docs/images/workspace-light.png), [cream](docs/images/workspace-cream.png)).

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-dark.svg">
  <img alt="How CloudTrain works: people use the web app; the gateway signs them in through Keycloak and their company IdP, keeps data in Postgres with per-organisation row-level security, and asks the lab orchestrator for lab and exam sessions; the orchestrator runs isolated kubeadm, virtual-cluster and network labs on Kubernetes with KubeVirt and Kube-OVN and grades them; lab content is validated and verified live before publishing." src="docs/images/architecture-light.svg" width="100%">
</picture>

- **Labs are data.** Each lab is a `lab.yaml` (format `cloudtrain.dev/v3`):
  topology, setup, typed checks tagged with skills, hints, misconceptions and
  solutions. `labctl` compiles it into a `LabTemplate`.
- **The orchestrator is a Kubernetes operator** with `LabTemplate`, `LabSession`,
  `WarmPool`, `ExamTemplate` and `ExamSession` resources. Pluggable node drivers
  run containers, KubeVirt VMs, kubeadm clusters, vclusters and network devices.
- **Credentials stay separate.** The learner works as an unprivileged user in the
  entry node; admin credentials live in a sidecar the learner can't read.

## Curriculum

The approved curriculum lives in [`content/curriculum.yaml`](content/curriculum.yaml),
rendered in [`docs/curriculum.md`](docs/curriculum.md). Scenarios are original,
with fictional organisations. Paths and exams are *aligned to* certification
objectives and never copy exam content.

<!-- curriculum-table:start (generated by tools/curriculum/render.mjs) -->
| Domain | Paths | Learning labs + exam tasks | Exam simulations | Built | Verified live |
| --- | --- | --- | --- | --- | --- |
| Kubernetes | 5 | 192 | 3 | 173 | 17 |
| Linux administration | 11 | 278 | 3 | 21 | 1 |
| Containers with Docker | 11 | 135 | 2 | — | — |
| Infrastructure as code with Terraform | 5 | 99 | 2 | — | — |
| Configuration management and automation | 7 | 97 | 1 | — | — |
| Network administration | 4 | 77 | 1 | — | 2 |
| **Total** | **43** | **878** (499 learning, 379 exam tasks) | **13** | **194** | **20** |
<!-- curriculum-table:end -->

"Built" means written and passing schema, skill and compile validation;
"verified" means it also passed the full live `labctl verify` cycle. The table
is generated from `content/curriculum.yaml` (`task curriculum:render`), and CI
fails when it is out of date.

## Status

CloudTrain is in early development. Here is exactly where it stands.

**Working and proven live**
- Local platform: kind with KubeVirt, CDI, Kube-OVN and Multus, one-command setup
  (`task dev:up`, which also recovers the cluster after a host restart), and
  per-lab network isolation proven by connection checks.
- Lab runtime: container, vcluster, kubeadm-on-VMs and FRR network-device nodes;
  the grader; `labctl verify`; warm pools and hibernate/resume (vcluster).
- Runtime hardening: Pod Security `baseline` enforced on every virtual cluster's
  host namespace (a learner's privileged pod is refused), `kubeadm init` retried
  with a configurable provisioning timeout, lab links that carry bridged and
  VLAN-tagged traffic, and an opt-in sudo-capable learner for pod labs.
- Exam engine: drawing tasks, the shared environment, timer freeze, auto-solved
  runs scoring 100%, unsolved runs failing, and retakes drawing different tasks.
- Exam simulations through the gateway with real sign-in (Keycloak and CSRF),
  run by the same in-cluster orchestrator as the web app's labs.
- Platform: SSO with real Microsoft Entra ID and brokered IdPs, roles, Postgres
  row-level security, audit logging, assignments, quotas, instructor controls (a
  54-check end-to-end proof).
- Web: learner, exam, manager, instructor, admin and platform views in mock mode;
  real mode drives live labs with a real terminal and real grading.

**Built but not yet proven end to end**
- Hibernate/resume on kubeadm clusters, VM labs with extra disks, and the
  `kubeadm init` retry under heavy load.
- The full lab-cluster image (metrics-server, ingress, Gateway API, MetalLB,
  storage provisioner, Falco, gVisor, kube-bench).

**In progress**
- Foundations: boot tests of the full kubeadm image, the `deb-lab` and
  `ubuntu-vm` images, and offline package and registry mirrors.
- Content: more Kubernetes developer and security labs, and the first Docker and
  Terraform labs.

**Known gaps**
- Kata Containers isolation for production.
- Lab links have no rate limit yet, so broadcast-storm labs are held back.

**Not started**
- Lab content for Ansible, and for Linux labs that need VMs or Kata.
- Scenario Studio generation (the UI is mocked) and the AI tutor.
- Production deployment on vCenter with Kata Containers.

## Direction

1. **Harden the runtime:** offline mirrors, Kata isolation, rate-limited lab
   links.
2. **Finish the Kubernetes track:** verify all 192 labs and run the three
   Kubernetes exam simulations end to end through the web app.
3. **Fill the other domains:** Linux (pods, Kata and VMs), Docker (Kata pods
   running dockerd), Terraform (offline providers against vclusters and
   emulators), Ansible (managed-node VMs), and networking (FRR, SR Linux).
4. **Scenario Studio:** authors describe a lab, it is generated, then gated by
   the same live verifier before a pilot cohort sees it.
5. **AI tutor:** explains failures from check results and terminal context,
   subject to an explicit data policy.
6. **Production:** self-hosted on vCenter (KubeVirt with nested virtualisation,
   Kata for privileged labs), warm pools sized by demand, and multi-tenant SaaS.

## Quick start

UI only, with mock data (no cluster needed):

```bash
pnpm install
task dev:web:mock        # http://localhost:5173 (persona switcher: learner, manager, instructor, admin)
```

Full local stack (Linux or WSL2 with `/dev/kvm`, Docker, ~16 GB RAM free):

```bash
task tools               # pinned CLIs into ~/.local/bin
task dev:up              # kind + KubeVirt + CDI + Kube-OVN + Multus (heals expired certs)
task dev:deps            # Postgres, Keycloak (realms, orgs, IdPs), Mailpit; migrate + seed
task dev:orchestrator    # lab orchestrator in the cluster
task dev:gateway         # gateway on :8787
task dev:web             # web app in real mode on :5173
```

Prove a lab works:

```bash
task lab:verify -- --only scale-berth-planner ../../content/packs/kubernetes/labs
```

Checks:

```bash
pnpm -r build && pnpm -r test
node tools/lab-verify/bin/lab-verify.mjs --strict
cd services/lab-orchestrator && go vet ./... && go test ./...
```

## Repository

| Path | What |
|---|---|
| `apps/web` | Web app (React, TanStack Router, xterm.js, React Flow); mock and real mode |
| `services/gateway` | Backend for the web app: OIDC sessions, authorisation, Postgres, catalog, labs, exams, terminal WebSocket |
| `services/lab-orchestrator` | Kubernetes operator (Go), node drivers, grader, exam engine, `labctl` |
| `packages/lab-schema`, `packages/api-types` | Lab and curriculum schemas; shared API types |
| `content/` | Skill graph, framework mappings, curriculum, lab packs |
| `tools/` | `lab-verify`, curriculum renderer, image builds, license inventory, slot limiter |
| `deploy/` | Local stack: kind, KubeVirt, Kube-OVN, Multus, vcluster, compose deps |
| `docs/` | [Architecture](docs/architecture.md), [platform identity](docs/platform-identity.md), [dev environment](docs/dev-environment.md), [curriculum](docs/curriculum.md), [handoff](docs/handoff.md), [research](docs/research/reports/) |

## Security

Every change runs through security pipelines on GitHub Actions
([details](docs/security-ci.md)):
- **Static analysis:** CodeQL (JS/TS, Go, Actions), Semgrep, gosec, shellcheck, hadolint, actionlint, zizmor.
- **Secrets:** gitleaks.
- **Dependencies:** Dependabot, dependency review with a license gate, govulncheck, osv-scanner.
- **SBOMs:** syft (CycloneDX, SPDX), submitted to the dependency graph.
- **Images:** Trivy and Grype scans; signed with cosign; SLSA provenance and SBOM attestations.
- **Infrastructure as code:** kube-linter, Trivy config, checkov.
- **Running app:** OWASP ZAP against the web app and gateway.
- **Other:** OpenSSF Scorecard and nightly Go fuzzing.

All actions are pinned to commit SHAs with least-privilege permissions.

Report vulnerabilities privately through GitHub Security Advisories; see
[SECURITY.md](SECURITY.md). Never open a public issue for a vulnerability.

## License

CloudTrain is **source-available**, not open source.

- **Software:** [Business Source License 1.1](LICENSE). You may use, modify and
  run it for any non-production purpose. Production use is free **only for
  training your own organisation's personnel**. Offering CloudTrain-based
  training, labs or assessments to third parties (hosted, managed, embedded, or
  as a commercial training service) needs a commercial license from AzarGuard.
  Each version becomes Apache-2.0 four years after its first public release.
- **Lab content** (`content/`: labs, skill graph, framework mappings):
  [CC BY-NC 4.0](content/LICENSE). Share and adapt it with credit to
  "CloudTrain by AzarGuard", for non-commercial purposes only.
- **Third-party software:** see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and [NOTICE](NOTICE).
- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md); contributors sign the [CLA](CLA.md).

Certification names are trademarks of their owners. CloudTrain is not
affiliated with or endorsed by any certification body. Screenshots come from
`node apps/web/scripts/readme-shots.mjs`.
