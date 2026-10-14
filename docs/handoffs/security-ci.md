# Handoff: security CI/CD (branch build/security-ci)

Paused on 2026-10-14 at the user's request. Step 0 (local scans + fixes) is done.
No `.github/` workflows have been written yet.

**gitleaks: no real secret anywhere in the git history.** The full-history scan
(`gitleaks git --log-opts=--all`, all local and remote branches, 153 commits) found
only false positives. They are now allowlisted in `.gitleaks.toml`, and a rescan
with that config reports `no leaks found`. No history rewrite is needed.

## Step-0 findings

| Tool | Finding | Disposition | Commit |
|---|---|---|---|
| gitleaks | `generic-api-key`: kubeadm example token `abcdef.0123456789abcdef` in `internal/drivers/runtime_test.go` | False positive (documentation example token in a unit test). Allowlisted | 62e6f5c |
| gitleaks | `generic-api-key`: `K8S_APT_KEY_FPR` in `deploy/versions.env`; `GATEWAY_API_MANIFEST_SHA256` (build/foundations) | False positive (public GPG fingerprint, sha256 pin). Allowlisted for that file only | 62e6f5c, b0ab1aa |
| gitleaks | `generic-api-key`: `keys: 'mod+shift+h'` in `apps/web/src/routes/Workspace.tsx` | False positive (keyboard shortcuts). Allowlisted | 62e6f5c |
| govulncheck | 59 reachable vulnerabilities: 53 in the Go 1.24 stdlib (1.24 no longer gets fixes), plus x/text, x/net, grpc, otel sdk/otlptracegrpc, moby/spdystream | **Fixed.** `go 1.26.0` + `toolchain go1.26.9` (go.mod, go.work), build image `golang:1.26.9-bookworm@sha256:d9c68c2c…`, modules bumped. Now 0 reachable | 1cc7b22 |
| trivy fs | CVE-2026-84445 grpc 1.83.1 (HIGH, DoS) | **Fixed**: grpc 1.83.2 | 0c759bd |
| semgrep | `gcm-no-tag-length`: `Sealer.open` (gateway `src/oidc/sessions.ts`) accepted GCM tags truncated to 4 bytes, so sealed refresh tokens could be forged | **Fixed (real)**: `authTagLength: 16`, 12-byte IV check, new `test/sealer.test.ts` (fails on the old code) | 2c54ef0 |
| osv-scanner | vitest/@vitest/mocker 3.2.7 GHSA-82fw-gwwq-j7x9; tinypool 1.1.1 GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (dev deps) | **Fixed**: vitest ^4.1.11. Gateway suite: 84 passed, 2 skipped | fe85c71 |
| semgrep | `dangerous-exec-command` on `drivers/vcluster.go:54` (also gosec G204) | False positive: runs the fixed helm binary with an argv, no shell | n/a |
| semgrep | `missing-integrity` on `apps/web/index.html:8` | False positive: a `data:` favicon | n/a |
| semgrep | `detect-non-literal-regexp` in `tools/lab-verify/src/denylist.mjs` | False positive: patterns built from constants in the file | n/a |
| semgrep | `ifs-tampering` in lab-demo/orchestrator-deploy/load.sh | False positive: `IFS=,` inside a `$(...)` subshell | n/a |
| semgrep | `unsafe-formatstring` in `apps/web/scripts/smoke-real.mjs` | False positive: dev script `console.log` | n/a |
| semgrep | `missing-user` nettools; trivy DS-0002 (root user) for frr, nettools, builder, containerdisk | Accepted risk: lab/device images that need root or `NET_ADMIN` (FRR, capture/impairment sidecar), a build toolbox and a `FROM scratch` disk. Runtime securityContext decides | n/a |
| semgrep / trivy | privileged, hostNetwork, hostPID, KSV-0046 in `deploy/multus/multus-daemonset-thick.yaml` | Accepted risk: vendored upstream CNI daemonset in the local dev stack only | n/a |
| trivy config | `config/rbac/role.yaml`: secrets, `escalate`/`bind` on RBAC, `pods/exec`, networking (KSV-0041/0050/0053/0056) | Accepted risk **for now**: the operator creates per-lab RBAC, secrets and exec. Follow-up: scope it with a ValidatingAdmissionPolicy (only bind roles labelled for labs, only in lab namespaces) before production | n/a |
| semgrep | `pnpm-minimum-release-age`, `pnpm-trust-policy`, `pnpm-block-exotic-sub-dependencies` | Accepted for now: these need pnpm ≥ 10.16 (repo uses 9.15.9). Follow-up: pnpm 10 + `minimumReleaseAge` | n/a |
| gosec | G115 integer conversions (compile/params.go, network/plan.go, controllers) | False positive: values are bounded. params.go wraps safely (`intn(0)` returns 0). The planned fuzz test asserts min ≤ v ≤ max | n/a |
| gosec | G404 `math/rand` for the WarmPool seed | False positive: picks lab parameter variety, not a secret | n/a |
| gosec | G304 file reads via variable (labctl, compile, catalog, labschema) | False positive: CLI and operator read operator-supplied paths by design | n/a |
| gosec | G301/G306 0755/0644 in `labctl verify` reports | Accepted: non-sensitive report output | n/a |
| hadolint | DL3020 ADD→COPY (containerdisk), DL4006 pipefail (orchestrator, jumphost), SC2086 (jumphost) | **Fixed** | 62e6f5c |
| hadolint | DL3008/DL3041 unpinned packages, DL3003 `cd` | Ignored in `.hadolint.yaml`: packages are pinned by the apt snapshot or AlmaLinux point release | 62e6f5c |
| hadolint | DL3066 `USER learner` (info) | Accepted (below the CI threshold) | n/a |
| shellcheck `-S warning` | SC2046, SC2034 ×2, SC2178/SC2128 (array shadowing), SC2088 | **Fixed** (renamed the array, used `_`, added two reasoned directives). Clean over `deploy/`, `tools/`, `services/*/hack` | 62e6f5c |
| semgrep | timeouts on large files (`content/curriculum.yaml`, mocks, platform services) | Tooling: in CI, raise `--timeout` or exclude `content/` from the yaml rules | n/a |

Validated locally after the fixes:
- `go build`, `go vet` and `go test ./...` pass.
- `make generate` shows no drift.
- `pnpm -r build` passes, and gateway typecheck and tests pass.
- osv-scanner and govulncheck are clean.
- The `lab-orchestrator` image builds from the changed Dockerfile on Go 1.26.9.
- The jumphost/frr/nettools builds were stopped before they finished, so those Dockerfile edits are only linted.

Not yet run: actionlint and zizmor (there are no workflows yet), checkov, kube-linter, grype, and trivy image scans.

## Workflows

| # | Deliverable | Status |
|---|---|---|
| 1 | `ci.yml`: pnpm frozen install/build/test/typecheck, Go vet/test/build, `make generate` drift, lab-verify --strict, curriculum render --check, license inventory drift + GPL/LGPL/AGPL gate | to do |
| 2 | `codeql.yml` (js-ts, go, actions; security-extended; push/PR/weekly) | to do |
| 3 | `sast.yml` (semgrep SARIF, gosec SARIF, hadolint at `failure-threshold: error`, shellcheck `-S warning`, actionlint, zizmor SARIF) | to do |
| 4 | `secrets.yml` (gitleaks: diff on PR, full history on schedule; uses committed `.gitleaks.toml`) | to do (config done) |
| 5 | `deps.yml` + `dependabot.yml` (npm/pnpm, gomod, github-actions, docker; grouped), dependency-review (high + license deny), govulncheck, osv-scanner SARIF | to do |
| 6 | `sbom.yml` (syft CycloneDX + SPDX for source + images, dependency submission, release assets) | to do |
| 7 | `images.yml` (lab-orchestrator, jumphost, frr, nettools; Trivy + Grype SARIF, fail on critical fixable; GHCR push on main/tags; cosign keyless; attest-build-provenance + SBOM attestations) | to do |
| 8 | `iac.yml` (trivy config/checkov on deploy/ + `kustomize build services/lab-orchestrator/config/default`, kube-linter; SARIF) | to do |
| 9 | `dast.yml` (ZAP baseline on PR + full nightly; rules file) | to do |
| 10 | `scorecard.yml` | to do |
| 11 | `fuzz.yml` + `Fuzz*` tests in `internal/compile` (Compile/Validate on arbitrary YAML; ResolveParams int range property) | to do |
| 12 | harden-runner (audit) in every workflow | to do |
| 13 | SECURITY.md, CONTRIBUTING "Security" section, CODEOWNERS (@thecorporatetractor), docs/security-ci.md | to do |

Every workflow can only be validated statically (actionlint, zizmor, and the scanners
run locally). There is no `gh` auth, so no GitHub run has been observed.

Design decisions already made, for whoever resumes:
- **DAST against the gateway.** `main.ts` always uses OIDC, and `DevAuthenticator` has no
  database principal. Plan: a CI-only entry point `services/gateway/test/dast-server.ts`
  that mirrors `test/harness.ts`:
  - `createTestDb` + seed against a Postgres 17 service container, with the roles from
    `deploy/dev/postgres/init.sql` applied by a step;
  - `FakeCluster`/`FakeCompiler` for the cluster side;
  - `HeaderAuthenticator` (`x-test-user`), which ZAP sends through a replacer rule;
  - a refusal to start when `NODE_ENV=production`.

  Web app: `pnpm --filter web build && vite preview` in mock mode.
- **Linux-pod images (`tools/images/linux-pod/{deb,el}`, on build/foundations).** They need
  the `tools/mirrors` content mirror as a build context, so they are not CI-buildable as-is.
  Add them to `images.yml` once that branch merges and a CI mirror strategy exists.
- **Lint debt on build/foundations.** It brings 2 shellcheck warnings in
  `guest-kubeadm-addons.sh` (SC2034, SC2010) and hadolint DL4006/SC2046 warnings in the
  linux-pod Dockerfiles. Fix them before shellcheck blocks on warning after merge.
- **Image build arguments.** The jumphost needs build args from `deploy/versions.env`
  (see `tools/images/build-jumphost.sh`). The orchestrator builds from the repo root with
  `-f services/lab-orchestrator/Dockerfile`.
- **Action pins.** Pin every action by full SHA. Look up current SHAs with
  `git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>`.
- **Trivy.** Use trivy ≥ 0.76 / a trivy-action pinned by SHA (tags were hijacked in the
  2026 supply-chain incident).

## Manual GitHub settings (user)

1. **Code security:**
   - Secret scanning and push protection: on.
   - Private vulnerability reporting: on.
   - Dependabot alerts and security updates: on.
   - Dependency graph: on (needed for dependency-review and SBOM submission).
2. **Code scanning:** default setup **off**, because CodeQL runs as advanced setup from `codeql.yml`.
3. **Branch protection / ruleset on `main`:**
   - Require PRs with 1 review, CODEOWNERS review and conversation resolution.
   - Require the status checks that `docs/security-ci.md` marks as blocking.
   - No force pushes or deletions.
   - Signed commits optional.
4. **Actions:**
   - Allow only selected actions: GitHub-owned plus the pinned third-party list.
   - Workflow permissions: read-only by default.
   - Do not let Actions create or approve PRs.
   - Require approval for fork PR workflows from first-time contributors.
5. **Packages:** after the first push, set the GHCR package visibility (public) and link it to the repo.
6. **Repo rename / org.** The module path is `github.com/cloudtrain/...` while the repo is
   `thecorporatetractor/cloudtrain`. This is harmless for builds; decide before tagging releases.

## Blocking going public

- No secrets in history, so nothing there blocks.
- The step-0 fixes above (Go 1.26, GCM tag, vitest, grpc) should merge to `main` first.
  They touch `services/lab-orchestrator/go.mod`/`go.sum`, `go.work` and the orchestrator
  Dockerfile. Other streams that edit `go.mod` (exam-engine) should rebase onto them.
- Recommended before public: the CI workflows (at least ci, secrets, codeql, deps),
  SECURITY.md, and the manual settings above. `deploy/dev` holds published dev-only
  credentials (Keycloak realm, compose). They are labelled DEV ONLY, which is acceptable,
  but `docs/security-ci.md` should say so.
- The RBAC breadth of the operator (`escalate`/`bind`, secrets) is an accepted risk for
  dev. Track it for production.

## Next steps

1. Write the workflows in the order of the table, beginning with `.github/workflows/ci.yml`
   and `secrets.yml`. Keep `permissions: {}` at the top level and set per-job permissions,
   plus concurrency groups, pnpm/go caches and harden-runner in audit mode.
2. Add the `Fuzz*` tests and the DAST server entry point (see the design decisions).
3. Run `actionlint` and `zizmor .github/workflows` until clean.
4. Rerun the step-0 scanners and add checkov, kube-linter, and grype/trivy image scans.
5. Write SECURITY.md, the CONTRIBUTING section, CODEOWNERS and docs/security-ci.md.
6. Merge to main.

## How to resume

- Worktree: `/home/hackrvl/cloudtrain/.worktrees/b-security-ci`, branch `build/security-ci`.
  The post-commit hook pushes.
- Scanners are installed in `~/.local/bin`:
  - gitleaks 8.30.1, gosec 2.29.0, osv-scanner 2.7.0, trivy 0.76.0, hadolint 2.15.1;
  - shellcheck 0.11.0, actionlint 1.7.12, zizmor 1.30.1, syft 1.54.1, grype 0.120.1;
  - kube-linter 0.8.3, govulncheck;
  - semgrep 1.180.0 and checkov 3.3.29 via pipx.
- Check C: free space first with
  `powershell.exe -NoProfile -Command "[int]((Get-PSDrive C).Free/1GB)"`. Stop below 15 GB.
- Re-run step 0:
  - `gitleaks git --log-opts=--all --config .gitleaks.toml /home/hackrvl/cloudtrain`
  - `semgrep scan --config p/default --config p/typescript --config p/golang --config p/secrets --config p/dockerfile --config p/kubernetes --metrics=off .`
  - `(cd services/lab-orchestrator && gosec ./... && govulncheck ./...)`
  - `osv-scanner scan source -L pnpm-lock.yaml -L services/lab-orchestrator/go.mod`
  - `trivy fs --scanners vuln,secret,misconfig --skip-dirs node_modules .`
  - `hadolint $(git ls-files '*Dockerfile*')`
  - `shellcheck -S warning $(git ls-files 'deploy/*.sh' 'tools/*.sh' 'services/*.sh')`
