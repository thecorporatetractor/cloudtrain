# Handoff: iac stream (wave 2, Terraform-first)

Round 1: #28 (image + iac-foundations path) and #31 (sim-iac-associate pool), 2026-10-16/17.
Round 2 (branch `content/iac-round-2`, 2026-10-17/18): the other four learning paths, the
sim-iac-advanced pool, the two IaC capstone tasks and image round 2. Pack
`content/packs/iac`, image `tools/images/iac`.

## Status

The source of truth is each lab's `status`/`notes` in `content/curriculum.yaml`.

| Set | Authored | Verified live | Not started |
|---|---|---|---|
| Path `iac-foundations` (23 labs) | 23 | **23** | 0 |
| Exam `sim-iac-associate` pool (25 tasks) | 25 | **25** | 0 |
| Paths `iac-practitioner`, `iac-advanced-scenarios`, `iac-platform-scale`, `opentofu-differences` (31 learning labs) | 31 | **31** | 0 |
| Exam `sim-iac-advanced` pool (18 tasks) | 18 | **18** | 0 |
| Capstone tasks `xpe-iac-namespace-baseline`, `xpe-iac-import-drift` | 2 | **2** (standalone) | 0 |

All 99 IaC labs in the curriculum are `verified`. sim-iac-advanced compiles (added to the
CI compile step) and ran live on a shared workstation + `sm-grid` + `moto` environment:
`--auto-solve --attempts 2` scored 100 % twice with disjoint draws (all 18 tasks drawn),
`--no-solve` scored 27.8 % (fail), environments released, teardown clean. The capstone tasks verify standalone but do not compile into
sim-platform-engineer yet (open question below).

Every verified lab passed `labctl verify` (two seeds, every misconception mutation, every
alternative, clean teardown). `sim-iac-associate` compiles (now in the CI compile step) and
ran live: `labctl exam run --auto-solve --attempts 2` scored 100 % twice with disjoint draws,
`--no-solve` scored 11.7 % (fail), environments released, teardown clean.

Learning labs (path order): iac-first-plan-apply, iac-provider-lock-offline,
iac-fmt-validate-repair, iac-resources-and-data-sources, iac-variables-tfvars-precedence,
iac-for-expressions-functions, iac-count-to-for-each, iac-dynamic-blocks-netpol,
iac-lifecycle-rules, iac-depends-on-ordering, iac-state-inspection-report,
iac-s3-backend-lockfile, iac-moved-removed-refactor, iac-import-blocks-generate,
iac-drift-refresh-only, iac-workspaces-vs-dirs, iac-first-module,
iac-module-sources-versions, iac-custom-conditions, iac-secrets-out-of-state,
iac-ephemeral-resources, iac-write-only-rotation, iac-hosted-platform-concepts.

Round 2 labs (path order): iac-helm-release-values, iac-provider-aliases-two-clusters,
iac-moto-vpc-subnets, iac-vcsim-inventory, iac-remote-state-sharing,
iac-module-provider-passing, iac-module-tests-mocks, iac-opa-plan-policy,
iac-saved-plan-pipeline, iac-dynamic-credentials, iac-scheduled-drift-check,
iac-risky-change-review, iac-provider-upgrade-campaign, iac-core-version-upgrade,
iac-provider-auth-logs, iac-incident-unsatisfiable-constraint, iac-query-bulk-import,
iac-provider-actions, iac-stacks-concepts, iac-incident-out-of-band-drift,
iac-split-monolith-modules, iac-split-large-state, iac-incident-dependency-cycle,
iac-incident-stale-lock, iac-incident-rename-destroy, iac-state-recovery-versions,
tofu-cli-differences, tofu-early-evaluation-backend, tofu-state-encryption-pbkdf2,
tofu-oci-module-distribution, tofu-migrate-from-terraform.

Terraform-only (do not work on the OpenTofu flavour): iac-core-version-upgrade (staged
Terraform 1.9 is BUSL, Terraform flavour only), iac-query-bulk-import (`terraform query`),
iac-provider-actions (actions). iac-stacks-concepts is a concept lab (no HCP account).
Round 2 adaptations (curriculum notes): AWS-shaped labs and tasks use a separate `moto`
lab peer node (`moto:5`); state stores stay in-pod (`ct-s3`), Git servers stay bare repos,
the vCenter simulator (`ct-vcsim`) and the OCI registry (`ct-oci`) run in the workstation;
iac-scheduled-drift-check (tier B in the curriculum) grades systemd user units with
`systemd-analyze` and runs the unit's ExecStart (no systemd as PID 1), status file in
`~/drift/`.

Round 1 adaptations recorded in the curriculum notes: no Git server (bare repos on the workstation),
no s3-store/moto nodes (in-pod `ct-s3`), iac-ephemeral-resources and iac-write-only-rotation
use the cluster instead of an AWS-shaped secrets store (the latter moved to tier V),
xia-debug-log-file writes to `~/exam/debug/` instead of `/var/log/iac`.

## The IaC workstation image (`terraform-ws:1.15`)

`tools/images/iac/Dockerfile`, built by `tools/images/build-iac-ws.sh [terraform|tofu|all]`
(through `tools/slots/run.sh build`), loaded with `tools/images/load.sh iac-ws-terraform|iac-ws-tofu`.

| Piece | Version / source | Licence |
|---|---|---|
| Ubuntu 24.04 base, apt snapshot `UBUNTU_APT_SNAPSHOT` | same digest as the jumphost | various |
| Terraform | 1.15.9 (sha256 of the zip in `deploy/versions.env`) | **BUSL-1.1** |
| OpenTofu | 1.11.14 (sha256 pinned) | MPL-2.0 |
| Provider mirror `/opt/cloudtrain/providers` | `providers.txt` -> `providers.lock` (sha256 per zip, from HashiCorp's GPG-verified SHA256SUMS via `lock-providers.sh`): kubernetes 3.3.0, helm 3.3.0, random 3.9.1/3.8.1/3.7.2, local 2.9.1, null 3.3.2, tls 4.4.1, time 0.14.2, http 3.6.2; linux_amd64 unpacked (init symlinks it), linux_arm64 zips for kubernetes and random | MPL-2.0 |
| SeaweedFS `weed` 4.47 (`ct-s3`) | sha256 pinned (upstream ships md5 only) | Apache-2.0 |
| Round 2: staged `terraform-1.9` (1.9.8, Terraform flavour only) and `terraform-1.5` (1.5.7, both; LICENSE from the v1.5.7 tag, sha256 pinned) under `/opt/cloudtrain/terraform/<v>/` | `deploy/versions.env` | BUSL-1.1 / MPL-2.0 |
| Round 2 providers: kubernetes 2.38.0 (upgrade labs), aws 6.67.0 (~790 MB unpacked), vsphere 2.12.0 (newest on releases.hashicorp.com) | `providers.lock` | MPL-2.0 |
| Round 2 tools: conftest 0.70.1, vcsim (govmomi 0.56.0, `ct-vcsim`), oras 1.3.4, CNCF registry 3.1.2 (`ct-oci`), openssl, systemd (for `systemd-analyze` only) | sha256 from each release's checksums | Apache-2.0 / LGPL (systemd) |
| kubectl, helm, yq | from `deploy/versions.env` (same as the jumphost) | Apache-2.0 / MIT |

Helpers in the image:

- `iac`: runs the image's primary CLI (`IAC_CLI` in `/etc/cloudtrain/iac.env`).
- `ct-iac plan|planjson|state|run DIR`: grading helper; runs as the learner with the
  learner's login environment (kubeconfig, `~/.terraformrc`, `~/.aws`), prints
  `no-changes|changes|error`, plan JSON or state JSON.
- `ct-s3 start|ensure|bucket|api|status`: an S3-compatible store inside the pod on
  127.0.0.1:8333 (path style, lab credentials in `~/.aws/credentials`, data in
  `~/.local/share/ct-s3` so it survives hibernation; `ensure` runs from login shells
  and from `ct-iac`). Tested: `use_lockfile` contention (second run gets "Error
  acquiring the state lock") and object versioning, under both terraform and tofu.
  `ct-s3 api` percent-encodes `:` (workspace keys `env:/...`) or SigV4 fails.
- `~/.terraformrc` (learner, root, skel): filesystem mirror only, no direct installs,
  `disable_checkpoint`. Both CLIs read it.

- `ct-vcsim start [ARGS]|ensure|status` (round 2): vcsim on https://127.0.0.1:8989/sdk
  (user saltmarsh / saltmarsh-lab, self-signed). Inventory is in memory: after a pod
  restart `ensure` brings back an empty simulator, so labs re-run their init.
- `ct-oci start|ensure|status` (round 2): distribution registry on https://localhost:5000
  with a lab CA generated at build time and trusted system-wide (OpenTofu talks HTTPS
  only); `oras` needs `--plain-http=false` for localhost. Data in `~/.local/share/ct-oci`.

Sizes (uncompressed, round 1): `cloudtrain/iac-ws:1.15-terraform` 1.57 GB, `cloudtrain/iac-ws:1.15-tofu` 1.41 GB.

### Terraform / OpenTofu swap

- Build arg `IAC_CLI=terraform` (default): Terraform primary, OpenTofu alongside as
  `tofu` (optional track). `IAC_CLI=tofu`: **no Terraform binary is downloaded or
  shipped**; `iac` runs tofu and `terraform` is a shim to tofu (`TERRAFORM_SHIM=0`
  drops the shim).
- Labs never name the binary in setup, checks or solutions: they call `iac` and
  `ct-iac`. Statements say `terraform` (Terraform-first).
- The lab ref stays `terraform-ws:1.15`; a tenant that must not get Terraform runs
  the orchestrator with `CATALOG_OVERLAY=deploy/images/overlays/iac-opentofu.yaml`,
  which maps the ref to `cloudtrain/iac-ws:1.15-tofu`.
- The mirror carries the same tree under `registry.terraform.io` and
  `registry.opentofu.org` (hard links), so `hashicorp/x` resolves offline under both.
  Checks match resources by type and attributes, never by registry hostname (lock
  files and state record `registry.opentofu.org/...` under tofu).
- Proven live: a second manager (`ct-iactofu-system`, overlay applied) verified
  iac-provider-lock-offline, iac-resources-and-data-sources and iac-workspaces-vs-dirs
  unchanged on the OpenTofu flavour; the base solutions of 7 cluster exam tasks and all 12
  workstation exam tasks also pass on it. No lab built so far is Terraform-only.

### Licence gate outcome

`tools/licenses/check.sh` (CI job "licenses") only reads `THIRD_PARTY_LICENSES.md`,
which `inventory.sh` builds from pnpm and Go **production dependencies**. Binaries a
Dockerfile downloads are never inventoried, so Terraform is invisible to the gate (and
BUSL would not match its GPL/LGPL/AGPL/SSPL pattern anyway). Nothing fails; instead
the inventory header now states that the IaC image ships Terraform under BUSL-1.1
unless built with `IAC_CLI=tofu`. Licence texts ship in the image under
`/usr/share/doc/{terraform,opentofu}`; provider zips keep their LICENSE files.
`images.yml` builds and scans the Terraform flavour; on push to main its publish job
would push it to GHCR (private while the repo is private). BUSL-1.1 allows
redistribution with the licence text, but decide before the repo or package goes
public (see open questions).

### Image scans

Trivy and Grype gates pass with path-scoped ignores (`.github/images/trivyignore.yaml`,
new `--ignorefile` in `images.yml`; entries appended to `.grype.yaml`), all for
upstream HashiCorp builds that cannot be rebuilt: kubernetes 3.3.0 (kin-openapi
GHSA-r277), random 3.8.1/3.7.2 (gRPC CVE-2026-33186 / GHSA-p77j, Go TLS
CVE-2025-68121 / GO-2026-4337), GO-2026-6612 in every provider (HTTP/2 server; the
plugin server only talks to its parent process), GO-2026-6604 in terraform (Windows
only). Re-check dates 2027-01-31.

## Lab conventions (pack `content/packs/iac`)

- Entry node `workstation` (`terraform-ws:1.15`); tier V labs add a vcluster
  `sm-grid` (context `sm-grid`, pinned in every kubernetes/helm provider block).
- State, plan and target truth: checks use `ct-iac state|planjson|plan` + jq and
  admin `k8s-query`/kubectl on the cluster. Identity (no recreate) is proven with
  UIDs recorded at setup in a kube-system ConfigMap.
- Stateful seeds are written once (`/var/tmp/ct-seed/seed.sh`, marker `.ct-seeded`
  in the stack), so a recreated pod never overwrites learner work. Everything that
  must survive hibernation lives under `/home/learner`.
- Mutations that recreate objects with the same names race their own destroys
  ("already exists"); they run apply twice (`|| iac apply ... || true`).
- Exam tasks: same workstation and `sm-grid` node definitions in every task,
  per-task `~/exam/<dir>`, namespaces and seed dirs, no hints.

## Platform findings

Round 2:

- **Moto as a lab peer works** (platform round 5, #41): `moto:5` (`motoserver/moto:5.2.3`)
  runs its own entrypoint; the workstation reaches `http://moto:5000`. Setup and checks
  run boto3 on the moto node (`on: moto`, python3 in the image), so baselines (ids,
  creation dates) live there. AWS provider 6.67 against Moto: VPC/subnet/SG/instance/S3/
  DynamoDB work; `terraform query` (list resource `aws_instance`) and the
  `aws_ec2_stop_instance` action work; generated config needs cleaning (conflicting
  arguments); Moto drops bucket tags given at create in a second region (avoid them).
  Exam tasks sharing one Moto must use unique Name tags.
- **kubernetes provider 2.38 -> 3.3:** only `kubernetes_namespace` -> `_v1` supports
  `moved`; every other type fails with "Move Resource State Not Supported" and needs
  `removed` (destroy = false) + `import`. 3.3 rejects null label values.
- **Generated Kubernetes config is invalid as is:** `-generate-config-out` for a
  Deployment emits `host_port = 0` and `active_deadline_seconds = 0`, which the provider
  rejects (xiv-adopt-workloads-generated grades the cleanup).
- **Image builds:** `cmd | head -1` under `pipefail` can fail with SIGPIPE (exit 141);
  one build was lost to it. The heavy slot queue (kubeadm, automation, builds) meant the
  round-2 image waited about 4 hours for its slot; queue image builds early.
- **lab-verify** now counts params referenced in templated `file.source` assets
  (they were reported as unused and failed `--strict`).
- The image's awk is mawk; Kubernetes vcluster workloads are slow to schedule under
  load (15 min "pod pending" timeouts happened at load 120+).

Round 1:

1. **Fixed in platform round 5: container nodes reach each other by name.** Every
   container node without links is a lab peer: `s3store`, `git` or `moto` resolve
   inside the session and the peer NetworkPolicy allows any port between the session's
   peers (isolated from other labs and the platform). Proven with a workstation using
   an S3 backend and a Git remote on a second `terraform-ws:1.15` node
   (`deploy/.results/lab-peers/`). The labs written so far keep `ct-s3` and bare repos
   on the workstation; new labs may use separate `s3-store`, `gitea` or `moto` nodes
   (see "Container nodes reach each other by name" in `docs/k8s-readiness.md`).
2. Catalog parsing is strict (`UnmarshalStrict`): no custom catalog fields.
3. `lab.schema.json` only allowed the wave-1 domains; it now accepts the six
   curriculum domains (containers, iac, automation too).
4. labctl verify fails a run when a mutation step exits non-zero, even for mutations
   that model a failing apply; end such steps with `|| true`.
5. Checks may run concurrently: a check that runs `init` in the learner's directory can
   collide with another check's plan there. Run `init` only in private copies.
6. A check block whose scoped data source fails makes `plan -detailed-exitcode` exit 2
   forever ("config will be reloaded to verify a check block"); grade convergence on the
   plan JSON's resource changes in such stacks.
7. kubernetes provider 3.3: `data_wo` conflicts with `data`, and switching an existing
   `kubernetes_secret_v1` from `data` to `data_wo` in place kept the old data in state in
   our test (replace the Secret). Fresh creates with `data_wo` store nothing.
8. The gateway's real-content tests now need about 6 s for the first load; their timeout
   is 30 s.
9. Under load (4 pod slots shared by several agents) most verify time was queueing:
   a 5-minute verify took 20-75 minutes end to end. Unloaded, a tier-A verify takes
   3-5 min and a vcluster verify 5-10 min.

## Next steps

1. Capstone: decide the shared workstation of sim-platform-engineer (open question), then
   compile and run that exam once the other domains' pools exist.
2. OpenTofu flavour: round 2 labs were verified on the Terraform flavour only (tofu-*
   labs call `tofu`, present in both). Re-run a sample on `ct-iactofu-system` with the
   overlay, as round 1 did; the three Terraform-only labs are listed above.
3. The Terraform 1.16 / OpenTofu 1.13 move stays deferred (decision 2026-10-17); it now
   means re-verifying 99 labs.
4. Promote the `iac.*` newSkills into `content/skills.yaml` once the wave settles.
5. Rebuild/rescan the image monthly; the scanner ignores expire 2027-01-31. The image is
   now ~2.9 GB (aws provider); if that hurts, split an `-aws` flavour.

How to resume:

```bash
cd /home/hackrvl/cloudtrain && git worktree add -b content/iac-<next> .worktrees/iac-next origin/main
cd .worktrees/iac-next && pnpm install --frozen-lockfile && pnpm --filter @cloudtrain/lab-schema build
GOTOOLCHAIN=go1.27.2 go build -o services/lab-orchestrator/bin/labctl ./services/lab-orchestrator/cmd/labctl
LOAD_INTO_KIND=1 tools/slots/run.sh build -- bash tools/images/build-iac-ws.sh all   # if the image changed
LOAD_LAB_IMAGES=0 SKIP_CRDS=1 ORCH_NAMESPACE=ct-iac-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=iac \
  bash deploy/scripts/orchestrator-deploy.sh
tools/slots/run.sh pod -- services/lab-orchestrator/bin/labctl verify --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=iac --repo-root "$PWD" "$PWD/content/packs/iac/labs/<lab>"
# OpenTofu flavour: same with ORCH_NAMESPACE=ct-iactofu-system,
# CATALOG_OVERLAY=deploy/images/overlays/iac-opentofu.yaml and verify=iac-tofu.
```

## Open questions (user)

- **Capstone workstation (new):** sim-platform-engineer's tasks share one entry node
  `workstation` (`jumphost:1`, no Terraform). The two IaC capstone tasks need
  `terraform-ws:1.15`, so the exam compile reports "node workstation is defined
  differently". Options: add terraform/tofu and the mirror to the jumphost, make
  `terraform-ws:1.15` the capstone workstation (it has kubectl/helm, but not the
  jumphost's ssh/etcd tooling), or give IaC tasks a second shell node with its own
  kubeconfig. Needs a cross-stream decision; the tasks are verified standalone.

- Decided 2026-10-17 (see `docs/handoff.md`): external tenants get the OpenTofu flavour;
  public CI publishes only `iac-ws-tofu`; the `terraform` shim stays; the 1.16 / 1.13
  version move is deferred.
- **Product names in titles** (already open): this pack keeps Terraform/OpenTofu out of
  lab titles and uses them in statements.
