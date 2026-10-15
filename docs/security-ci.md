# Security CI/CD

Every workflow lives in `.github/workflows/`. They share the same rules:

- Third-party actions are pinned to full commit SHAs with a version comment.
- Permissions are `permissions: {}` at the top level and least privilege per job.
- Each workflow has a concurrency group.
- There is no `pull_request_target`.
- Every job starts with `step-security/harden-runner` in audit mode.
- Scanner CLIs come from `.github/scripts/install-tools.sh`, pinned by version and sha256.

Policy files: `.gitleaks.toml`, `.grype.yaml`, `osv-scanner.toml`, `.hadolint.yaml`,
`.github/iac/trivyignore.yaml`, `.zap/*.yaml`, `.github/dependabot.yml`.

**Blocking** means the check fails the run and is (or should be made) a required
status check. **Report** means results go to the Security tab (code scanning, as
SARIF) and/or artifacts; they are triaged there.

## Pipelines

| Workflow | Triggers | Jobs (check names) | Blocking | Report-only |
|---|---|---|---|---|
| `ci.yml` | PR, push main | `node (build, typecheck, test, content)`, `go (vet, test, build, generate drift, labs)`, `licenses (inventory drift, copyleft gate)` | everything: pnpm frozen install, build, typecheck, test (gateway DB suites against Postgres 17); lab-verify `--strict`; `docs/curriculum.md` up to date; go vet, `test -race`, build; `make generate` drift; `labctl validate` on every pack; exam compile of the exams whose pools are complete (`sim-k8s-admin`, `sim-k8s-developer`, `sim-k8s-security`, testdata); `THIRD_PARTY_LICENSES.md` drift; no GPL/LGPL/AGPL/SSPL/unknown license in production dependencies (`tools/licenses/check.sh`) | none |
| `codeql.yml` | PR, push main, weekly | `analyze (javascript-typescript)`, `analyze (go)`, `analyze (actions)` | via the ruleset's code scanning rule (High+ security alerts) | all CodeQL `security-extended` alerts |
| `sast.yml` | PR, push main, weekly | `semgrep (report)`, `gosec (report)`, `hadolint, shellcheck, actionlint, zizmor` | actionlint; zizmor (medium+); shellcheck `-S warning` over `deploy/`, `tools/`, `services/`, `.github/` (lab assets in `content/` are excluded on purpose); hadolint at `error` | semgrep (p/default, typescript, golang, secrets, dockerfile, kubernetes; `content/` and `docs/` excluded), gosec, hadolint warnings, zizmor (all) |
| `secrets.yml` | PR, push main, nightly | `gitleaks` | gitleaks over the PR's commits / the pushed range; never the working tree (gitignored `apps/web/dist` would trip it) | nightly: every commit on every branch (also SARIF) |
| `deps.yml` | PR, push main, daily | `dependency-review`, `govulncheck`, `osv-scanner` | dependency-review (PRs: new dependency with a high/critical advisory or a GPL/LGPL/AGPL/SSPL license); govulncheck (reachable Go vulnerabilities) | osv-scanner SARIF over `pnpm-lock.yaml` and `go.mod` |
| `dependabot.yml` | weekly (Mon); compose monthly | n/a | n/a | version PRs: npm (pnpm), gomod (k8s group), github-actions, docker, docker-compose; minor/patch grouped; security updates grouped; 7-day cooldown |
| `sbom.yml` | PR, push main, release | `source`, `dependency-submission`, `release` | none | syft SPDX + CycloneDX of the source tree (artifact); on main, submitted to the dependency graph; on release, source and per-image SBOMs attached to the release |
| `images.yml` | PR (image paths), push main, `v*` tags, nightly | `build + scan (<image>)`, `publish (<image>)` | the image build; no CRITICAL vulnerability with a fix (Trivy and Grype) | Trivy (vuln + secret) and Grype SARIF; SBOM artifacts. Push to main and `v*` only: GHCR push, cosign keyless signature, SLSA provenance (`attest-build-provenance`) and SBOM attestation, both pushed to the registry |
| `iac.yml` | PR (deploy/config/images paths), push main, weekly | `iac` | kube-linter and Trivy HIGH+ on the kustomize-rendered lab-orchestrator manifests (accepted operator RBAC in `.github/iac/trivyignore.yaml`) | Trivy config (repo; `content/` excluded), checkov (deploy/, rendered manifests, tools/images, .github), kube-linter over deploy/ |
| `dast.yml` | PR, push main, nightly, manual | `zap (gateway)`, `zap (web)` | PRs/main: ZAP passive baseline fails on High alerts or plan errors | nightly/manual `full`: spider + active scan; HTML/JSON/SARIF reports as artifacts and code scanning |
| `scorecard.yml` | push main, weekly, branch protection change | `analysis` | none | OpenSSF Scorecard (published to the OpenSSF API for the badge, and SARIF) |
| `fuzz.yml` | nightly, manual (`fuzztime`) | `fuzz (FuzzYAMLToJSON / FuzzCompile / FuzzResolveIntParam)` | none (a crash fails the nightly run and uploads the input) | the seed corpora also run in `ci.yml` as unit tests |

Images built by `images.yml`:

| Image | Built from |
|---|---|
| lab-orchestrator | `services/lab-orchestrator/Dockerfile` |
| jumphost | `tools/images/jumphost/` |
| frr, nettools, netsvc | `tools/images/netdev/` |
| linux-pod-deb, linux-pod-el | `tools/images/linux-pod-interim/` |

They are pushed as `ghcr.io/thecorporatetractor/cloudtrain/<name>`. Not built in CI:
- the KubeVirt golden VM images (`tools/images/build.sh`), which need KVM and about 30 minutes;
- the tier-A builds in `tools/images/linux-pod/`, which need the `tools/mirrors` package mirror as a build context;
- `tools/mirrors/content`.

DAST targets:
- **gateway:** `services/gateway/test/dast-server.ts`, a CI test target only, which refuses
  `NODE_ENV=production` like `DevAuthenticator`. It runs:
  - the real routes, permission hook and authz;
  - Postgres with RLS and the seeded fictional data;
  - the test fake cluster.

  Requests are made as the seeded org_admin unless an `x-test-user` header names another
  seeded user.
- **web:** the mock-mode production build behind `vite preview`. Header alerts there
  (CSP, anti-clickjacking) are guidance for the production web server's configuration.

## What blocks a merge

Make these jobs **required status checks** on `main`. Their check names are exact:

- `node (build, typecheck, test, content)`
- `go (vet, test, build, generate drift, labs)`
- `licenses (inventory drift, copyleft gate)`
- `analyze (javascript-typescript)`, `analyze (go)`, `analyze (actions)`
- `hadolint, shellcheck, actionlint, zizmor`
- `gitleaks`
- `dependency-review`, `govulncheck`
- `zap (gateway)`, `zap (web)`

Some checks block when they run but must **not** be required:
- `images` and `iac` are path-filtered on PRs, and a required check that never runs
  blocks the merge forever.
- `semgrep (report)`, `gosec (report)`, `osv-scanner`, `sbom`, `scorecard` and `fuzz` never fail on findings.

The CodeQL gate is the ruleset's "Require code scanning results" rule (CodeQL: security
alerts High or higher, alerts Errors). The other SARIF tools are report-only.

## Accepted risks and ignore files

Each entry carries its reason in the file itself:

- **`.gitleaks.toml`:** a kubeadm documentation token in a test, and public key
  fingerprints and sha256 pins in `deploy/versions.env`.
- **`.github/iac/trivyignore.yaml`:** the operator's by-design RBAC (Secrets,
  `escalate`/`bind`, `pods/exec`, networking). Follow-up before production: a
  ValidatingAdmissionPolicy that restricts the lab-orchestrator ServiceAccount to lab
  namespaces and lab-labelled roles.
- **`.grype.yaml`:** GO-2026-6612, an HTTP/2 server bug, only in the upstream CLI
  binaries in `/usr/local/bin` (helm, kubectl, etcdctl), which are never servers.
  Re-check by 2026-11-15.
- **`osv-scanner.toml`:** GO-2026-5932 (`x/crypto/openpgp`, deprecated, no fix). The
  package is not imported. Expires 2027-04-30.
- **`.hadolint.yaml`:** DL3008/DL3041/DL3003. Packages are pinned by the apt snapshot
  or the AlmaLinux point release.
- **Report-only items** to triage in the Security tab:
  - The vendored Multus daemonset (`deploy/multus`) and the Falco add-on manifests are
    privileged by nature, in the dev stack and lab VMs only.
  - Lab images run as root where a lab needs it (FRR, capture sidecar).
  - semgrep's pnpm settings rules need pnpm ≥ 10.16; the repo uses 9.15.9.
  - gosec: G115 conversions are bounded, and G304 file paths come from the operator or
    CLI by design.

## Tool versions

- **Actions:** Dependabot (`github-actions`) bumps the SHA pins.
- **Scanner CLIs:** pinned in `.github/scripts/install-tools.sh`; bump the version and
  sha256 together. Current versions:
  - actionlint 1.7.12, gitleaks 8.30.1, gosec 2.29.0, grype 0.120.1, hadolint 2.15.1,
    kube-linter 0.8.3;
  - osv-scanner 2.7.0, shellcheck 0.11.0, syft 1.54.1, trivy 0.76.0, zizmor 1.30.1.
- **Pinned in the workflows themselves:**
  - semgrep 1.180.0 and checkov 3.3.29 (pip);
  - govulncheck v1.9.0;
  - the ZAP image by digest in `dast.yml`;
  - the Postgres service image by digest.
- **Go:** setup-go reads the `toolchain` directive in `services/lab-orchestrator/go.mod`
  (go1.27.2).

## Running the checks locally

Install the CLIs into `~/.local/bin`:

```bash
TOOLS_BIN=~/.local/bin bash .github/scripts/install-tools.sh actionlint gitleaks gosec grype hadolint kube-linter osv-scanner shellcheck syft trivy zizmor
```

Then run the checks:

```bash
gitleaks git --config .gitleaks.toml --log-opts=--all .
actionlint && zizmor .github
git ls-files -z 'deploy/*.sh' 'tools/*.sh' 'services/*.sh' '.github/*.sh' | xargs -0 shellcheck -S warning
git ls-files -z '*Dockerfile*' | xargs -0 hadolint --failure-threshold error
semgrep scan --metrics=off --config p/default --config p/typescript --config p/golang --config p/secrets --config p/dockerfile --config p/kubernetes --exclude content --exclude docs .
(cd services/lab-orchestrator && gosec ./... && govulncheck ./...)
osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml --lockfile services/lab-orchestrator/go.mod
kubectl kustomize services/lab-orchestrator/config/default > /tmp/orch.yaml && kube-linter lint /tmp/orch.yaml \
  && trivy config --severity HIGH,CRITICAL --exit-code 1 --ignorefile .github/iac/trivyignore.yaml /tmp/orch.yaml
bash tools/licenses/inventory.sh && git diff --exit-code THIRD_PARTY_LICENSES.md && bash tools/licenses/check.sh
(cd services/lab-orchestrator && go test ./internal/compile -run '^$' -fuzz '^FuzzCompile$' -fuzztime 1m)
```

DAST against a local gateway (Postgres from `task dev:deps`):

```bash
(cd services/gateway && pnpm exec tsx test/dast-server.ts) &
bash .github/scripts/zap-baseline-plan.sh .zap/gateway.yaml > /tmp/zap/plan.yaml
docker run --rm --network host -v /tmp/zap:/zap/wrk:rw <ZAP_IMAGE from dast.yml> zap.sh -cmd -autorun /zap/wrk/plan.yaml
```

On Docker Desktop/WSL, `--network host` does not reach the WSL loopback. Instead:
- start the target with `CT_HOST=0.0.0.0`;
- replace `127.0.0.1:8787` in the plan with `host.docker.internal:8787`;
- add `--add-host host.docker.internal:host-gateway` to the `docker run`;
- for `vite preview`, also set `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=host.docker.internal`.

## Manual GitHub settings

These cannot be set from the repository. "Before" means while the repo is still
private; most code-security features are free only once it is public.

### Before going public

1. **Settings → Actions → General → Actions permissions:**
   - Choose "Allow thecorporatetractor, and select non-thecorporatetractor, actions and reusable workflows".
   - Tick "Allow actions created by GitHub".
   - Add this allow list:
     `step-security/harden-runner@*, pnpm/action-setup@*, docker/setup-buildx-action@*, docker/login-action@*, docker/build-push-action@*, docker/metadata-action@*, sigstore/cosign-installer@*, anchore/sbom-action@*, ossf/scorecard-action@*`
   - Tick **"Require actions to be pinned to a full-length commit SHA"**.
2. **Settings → Actions → General → Workflow permissions:**
   - Choose **"Read repository contents and packages permissions"**.
   - Untick "Allow GitHub Actions to create and approve pull requests".
3. **Same page, "Fork pull request workflows from outside collaborators":**
   "Require approval for all external contributors".
4. **Repository secrets:** none are needed. Signing, attestations and GHCR use the
   workflow's OIDC token and `GITHUB_TOKEN`; keep it that way.
5. **History:** gitleaks over all branches is clean (2026-10-15). Nothing to rewrite.

### Right after going public

1. **Settings → Code security**, turn on:
   - Dependency graph.
   - **Dependabot alerts**.
   - **Dependabot security updates**, plus grouped security updates.
   - **Secret scanning** and **Push protection**, plus validity checks and non-provider
     patterns where offered.
   - **Private vulnerability reporting**.
2. **Settings → Code security → Code scanning:** leave **Default setup OFF**. CodeQL
   runs as advanced setup from `codeql.yml`, and default setup would conflict with it.
   Copilot Autofix is optional.
3. **Settings → Rules → Rulesets → New branch ruleset "main"**, targeting the default
   branch, enforcement Active, no bypass list (or repository admins only, for emergencies):
   - Restrict deletions. Block force pushes.
   - Require a pull request before merging:
     - 1 approval;
     - dismiss stale approvals on new commits;
     - **require review from Code Owners**;
     - require approval of the most recent push;
     - require conversation resolution.
   - Require status checks to pass:
     - "Require branches to be up to date";
     - the checks listed under [What blocks a merge](#what-blocks-a-merge), with source
       GitHub Actions.
   - **Require code scanning results:** tool **CodeQL**, security alerts **High or
     higher**, alerts **Errors**.
4. **Tag ruleset "release tags"**, targeting `v*`: restrict creations, updates and
   deletions to repository admins. A `v*` tag publishes signed images.
5. **Packages**, after the first `images.yml` run on `main`:
   - for each `ghcr.io/thecorporatetractor/cloudtrain/*` package, set visibility to
     **Public**;
   - link it to the repository and keep "Inherit access from source repository".
6. **Scorecard:** the badge works after the first `scorecard.yml` run on `main`. Re-run
   it after the rulesets exist, since the `branch_protection_rule` event triggers it.
7. **Optional hardening:**
   - a `release` environment with required reviewers, referenced by the `publish` job
     of `images.yml`;
   - turn on "Always suggest updating pull request branches";
   - disable the wiki if unused.

## Badges

For the README:

```markdown
[![ci](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/ci.yml)
[![CodeQL](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/codeql.yml)
[![sast](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/sast.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/sast.yml)
[![secrets](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/secrets.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/secrets.yml)
[![deps](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/deps.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/deps.yml)
[![images](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/images.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/images.yml)
[![dast](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/dast.yml/badge.svg?branch=main)](https://github.com/thecorporatetractor/cloudtrain/actions/workflows/dast.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/thecorporatetractor/cloudtrain/badge)](https://scorecard.dev/viewer/?uri=github.com/thecorporatetractor/cloudtrain)
```

The Scorecard badge needs the repository to be public and one `scorecard.yml` run on `main`.
