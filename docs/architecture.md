# CloudTrain — Architecture

CloudTrain is a hands-on lab training platform for internal staff upskilling (external offering later). Learners work in real, isolated environments; every task is graded automatically and feeds an adaptive learning engine. Domains: Kubernetes (CKA/CKAD/CKS-style), Linux administration, network administration.

## Core idea

The platform runs **topologies**, not "Kubernetes scenarios". A lab is a graph of nodes and links plus access points, defined by the Lab schema (`packages/lab-schema/schema/lab.schema.json`, `cloudtrain.dev/v3`). The learner sits on an entry node (a jumphost, `learner@workstation`) whose kubeconfig and SSH config point at the other nodes, mirroring real exam/on-call topologies: `kubectl config use-context` switches between real clusters, and `ssh` reaches real nodes.

## Runtime

| Driver | Backend | Use |
|---|---|---|
| `container` | Kata pod (runc locally) | jumphost, light hosts, test clients |
| `vm` | KubeVirt (vSphere Instant Clone provider optional later) | Linux admin, CKS nodes, VM appliances |
| `k8s-cluster` | `virtual` = vcluster; `kubeadm` = VM nodes from golden snapshots | Kubernetes labs |
| `netdev` | Clabernetes (containerlab on Kubernetes), vrnetlab VMs | routers, switches, firewalls |

- Each lab gets an isolated Kube-OVN VPC; each topology link is an OVN logical switch, so VMs, containers and network devices share real L2 wires. Links support capture and impairment (`tc netem`).
- Golden snapshots + per-lab identical private IPs make cloned kubeadm clusters boot in seconds.
- Storage is class-agnostic: homes, vcluster databases and VM disks use the class given by `--storage-class` (or the cluster default); VM disks are CDI DataVolumes completed from StorageProfiles. See [storage.md](storage.md).
- Production: self-hosted on a vCenter cluster (K8s worker VMs with nested virtualization, `vhv.enable`). Local: kind with `/dev/kvm` passed through (WSL2 has KVM).

## Services (monorepo)

| Path | Lang | Role |
|---|---|---|
| `apps/web` | TS/React | learner, instructor, author and admin UI |
| `services/gateway` | TS | BFF, OIDC session (Keycloak), REST/OpenAPI |
| `services/identity` | TS | orgs/teams/roles, SCIM |
| `services/catalog` | TS | courses, paths, lab versions |
| `services/assessment` | TS | attempts, exams, scoring, certificates |
| `services/lab-orchestrator` | Go | operator: `LabTemplate`, `LabSession`, `WarmPool` CRDs, node drivers |
| `services/terminal-gateway` | Go | access gateway: shell/ssh/console/web/RDP (Guacamole), recording |
| `services/grader` | Go | out-of-band check execution, signed results |
| `services/tutor` | TS | AI tutor, failure explainer, Scenario Studio |
| `services/analytics` | Go | events → ClickHouse, learner model |

Contracts: protobuf (buf) in `packages/contracts`. Events: NATS JetStream. Data: Postgres (+JSONB, row-level security per org), ClickHouse (events), MinIO (recordings, certificates).

## Learning engine

- Skill graph (`content/skills.yaml`): domain → competency → skill, with prerequisite edges; frameworks (CKA, CKS, LFCS, CCNA, internal) map onto shared skills.
- Every check is tagged with skills → per-check evidence. Learner model: per-skill ability (μ, σ) Glicko/IRT-style with time decay; scenario difficulty calibrated from population data.
- Recommendation: maximise expected mastery gain + review urgency + goal alignment − time, constrained to predicted success 0.6–0.8 and satisfied prerequisites. Every recommendation explains itself.

## Scenario Studio

Admin describes a lab (or imports material) → planner produces a spec → builder writes the lab → verifier runs it in a real lab: setup idempotent, checks fail before the solution, pass after, every misconception mutation fails, alternative solutions pass, teardown is clean, parameter variants work → human review → pilot cohort → calibrated → published.

## Content rules

All labs are original: fictional organisations, node names, namespaces and resource names. Never reuse names or wording from external question banks.
