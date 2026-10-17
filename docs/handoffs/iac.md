# Handoff: iac stream (wave 2, Terraform-first)

Batch 1 merged as #28 (image + iac-foundations path), batch 2 (sim-iac-associate pool +
this handoff) on branch `content/iac-wave2-exams`. Pack `content/packs/iac`, image
`tools/images/iac`. Worked 2026-10-16/17.

## Status

The source of truth is each lab's `status`/`notes` in `content/curriculum.yaml`.

| Set | Authored | Verified live | Not started |
|---|---|---|---|
| Path `iac-foundations` (23 labs) | 23 | **23** | 0 |
| Exam `sim-iac-associate` pool (25 tasks) | 25 | **25** | 0 |
| Paths `iac-practitioner`, `iac-advanced-scenarios`, `iac-platform-scale`, `opentofu-differences` (31 more learning labs) | 0 | 0 | 31 |
| Exam `sim-iac-advanced` IaC tasks (18) and the two `xpe-iac-*` capstone tasks | 0 | 0 | 18 + 2 |

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

Adaptations recorded in the curriculum notes: no Git server (bare repos on the workstation),
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

Sizes (uncompressed): `cloudtrain/iac-ws:1.15-terraform` 1.57 GB, `cloudtrain/iac-ws:1.15-tofu` 1.41 GB.

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

1. Remaining learning paths, in order: `iac-practitioner` (helm values, provider aliases,
   module provider passing, module tests with mocks, conftest policy, saved-plan pipeline,
   dynamic credentials, drift timer, risky-change review, upgrade campaigns, query/actions,
   Stacks concepts), then `iac-platform-scale` incident drills, `opentofu-differences`.
2. Image additions those need: Terraform 1.9 and 1.5.7 staged (upgrade/migration labs),
   kubernetes provider 2.38 in the mirror (major-upgrade lab), conftest, the aws provider
   (large: ~600 MB unpacked) for AWS-shaped labs. Pin each like the rest.
3. AWS-shaped targets (moto:5, sim-iac-advanced pool, iac-moto-vpc-subnets): a separate
   `moto` container node now works (finding 1); the image still has to be built.
4. `tofu-*` labs (state encryption, early evaluation, OCI distribution, migration) need
   the Terraform flavour with tofu alongside, which the image already has.
5. Promote the `iac.*` newSkills into `content/skills.yaml` once the wave settles.
6. Rebuild/rescan the image monthly; the scanner ignores expire 2027-01-31.

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

- **Terraform for external customers:** labs and images are ready for either binary;
  confirm the plan that external tenants get the OpenTofu flavour (overlay) until IBM
  confirms hosted use of Terraform in writing.
- **Publishing the Terraform image:** `images.yml` publishes the Terraform flavour to GHCR on
  push to main (private while the repo is private). BUSL-1.1 permits redistribution with the
  licence text (included). Publish it publicly, switch CI to the OpenTofu flavour, or exclude
  it from publishing before the repo goes public?
- **`terraform` shim in the OpenTofu flavour:** statements say `terraform`; the tofu image
  makes `terraform` run tofu (with a one-line notice). Keep the shim, or show `tofu` in
  statements for OpenTofu tenants?
- **Versions:** curriculum says Terraform 1.15 and OpenTofu 1.11; current releases are 1.16.6
  and 1.13.1. Stay, or move the image (and the curriculum text) forward?
- **Product names in titles** (already open): this pack keeps Terraform/OpenTofu out of
  lab titles and uses them in statements.
