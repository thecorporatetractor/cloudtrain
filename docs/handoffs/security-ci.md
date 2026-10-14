# Handoff: security CI/CD (branch build/security-ci)

Status 2026-10-15: **done.** All 11 workflows are written:
- `ci`, `codeql`, `sast`, `secrets`, `deps`, `sbom`;
- `images`, `iac`, `dast`, `scorecard`, `fuzz`.

Also in place: Dependabot, harden-runner in every job, SECURITY.md, CODEOWNERS, the
CONTRIBUTING security section and **[docs/security-ci.md](../security-ci.md)**. That doc is
the reference: pipelines, the blocking/report split, required check names, accepted risks,
the manual GitHub settings before and after going public, and README badges.

**gitleaks:**
- Full history of every branch: no real secret, as of 2026-10-15 after the wave-1 merges.
- Earlier false positives are allowlisted narrowly in `.gitleaks.toml`.
- No history rewrite is needed.

## Findings fixed (step 0 and while wiring the pipelines)

| Tool | Finding | Fix | Commit |
|---|---|---|---|
| govulncheck | 59 reachable vulnerabilities (Go 1.24 stdlib out of support; x/net, x/text, grpc, otel, spdystream) | Go 1.26.9 toolchain, patched modules; 0 reachable | 1cc7b22 |
| trivy | grpc CVE-2026-84445 | grpc 1.83.2 | 0c759bd |
| semgrep | gateway `Sealer.open` accepted GCM tags truncated to 4 bytes (refresh-token forgery) | `authTagLength: 16` + tests | 2c54ef0 |
| osv-scanner | vitest/tinypool (GHSA-82fw…, tinypool RCE gadgets) | vitest 4.1.11 | fe85c71 |
| osv-scanner | cel-go GO-2026-6094 | cel-go 0.30.0 | 75f9b06 |
| fuzzing (new FuzzCompile seed) | `file.source` followed a symlink in the lab directory to any readable file | assets read through `os.OpenRoot` | 87feca2 |
| trivy image | `netsvc` image baked SSH host private keys (`ssh-keygen -A` at build), so a public image would share them | removed; labs run `ssh-keygen -A` before starting sshd | 5108da6 |
| trivy/grype image | lab-orchestrator's helm v3.19.0 (grpc CVE-2026-33186, Go CVE-2025-68121, CRITICAL) | helm v3.22.0 | 5108da6 |
| grype image | frr base OpenSSL/Python CRITICALs (CVE-2026-63073, -75803, -19445) | pinned fixed apk releases | 5108da6 |
| ZAP | gateway responses without `X-Content-Type-Options` | `nosniff` + `Cache-Control: no-store` on every response | 06c1fbd |
| hadolint/shellcheck | Dockerfile/script warnings (incl. 2 from foundations) | fixed; shellcheck `-S warning` is clean | 62e6f5c, 601f70e |
| license inventory | `THIRD_PARTY_LICENSES.md` stale after merges | regenerated (go-licenses built with Go 1.26.9) | b385bd8 |

Accepted risks and their ignore files are listed in docs/security-ci.md ("Accepted risks").

## Local validation (2026-10-15, branch merged with main at 4228d39)

- **Every blocking gate, replayed with the same commands:** pass.
  - ci/node: frozen install, build, typecheck, tests. The gateway ran 109 tests,
    including the DB suites against Postgres.
  - lab-verify `--strict`, curriculum check.
  - ci/go: vet, `test -race`, build, `make generate` drift, `labctl validate` of all
    214 labs plus samples, exam compile for k8s-admin/developer/security and testdata.
  - Licenses: drift and copyleft gate.
  - hadolint (error), shellcheck, actionlint, zizmor (medium+).
  - gitleaks over all history.
  - govulncheck.
  - iac: kube-linter and Trivy HIGH+ on the rendered orchestrator manifests.
- **Images** (trivy and grype, no fixable CRITICAL):
  - Rebuilt from current Dockerfiles: lab-orchestrator, frr, netsvc.
  - Scanned from existing local builds: jumphost, nettools, linux-pod-deb, linux-pod-el.
- **ZAP** (`ghcr.io/zaproxy/zaproxy` 2.17.0 by digest):
  - Gateway baseline: 0 High.
  - Gateway 4-minute active scan: 0 High/Medium (1 Low: stored text echoed in JSON).
  - Web baseline: 0 High (Medium: CSP and anti-clickjacking headers from `vite preview`).
- **Fuzzing:** 45 s per target, no crash after the `os.Root` fix.
- **Report-only tools run locally:** semgrep, gosec, osv-scanner (clean), checkov,
  kube-linter on deploy/, syft (693 packages).
- **Only statically validated** (actionlint + zizmor offline; no `gh` auth, so no GitHub
  run has been seen):
  - CodeQL;
  - dependency-review;
  - dependency submission;
  - GHCR push, cosign signing and attestations;
  - release SBOM upload;
  - Scorecard publishing;
  - SARIF uploads.

  zizmor's online audits (impostor commits, known-vulnerable actions) need a token and
  will run in `sast.yml`.

## Known gaps and next steps

1. **First GitHub runs:** watch every workflow's first run and fix anything
   runner-specific. Likely spots:
   - ZAP `--network host`;
   - the Postgres service init;
   - setup-go reading the `toolchain` line;
   - the YAML anchors in `images.yml` (GitHub supports them since 2025).

   Then make the checks listed in docs/security-ci.md required.
2. **Exams:** only 3 of 13 curriculum exams compile, because the rest wait for pool labs.
   Add each to the `ci.yml` exam step once `labctl exam compile <id>` passes.
3. **`tools/images/linux-pod`** (tier-A, needs the package mirror) and the VM golden
   images are not built in CI. Add them to `images.yml` when a mirror is reachable from
   the runners.
4. **Hadolint warnings** in the `linux-pod` and `linux-pod-interim` Dockerfiles (DL4006
   pipefail, SC2046) are report-only. Fix them and raise the hadolint threshold to
   `warning`.
5. **Operator RBAC** (secrets, escalate/bind, exec) is accepted for dev. Before production,
   add a ValidatingAdmissionPolicy scoped to lab namespaces.
6. **pnpm 10.16+** would enable `minimumReleaseAge`/trust policy (semgrep's pnpm rules).
7. **Re-check dates:** `.grype.yaml` GO-2026-6612 (2026-11-15), `osv-scanner.toml`
   GO-2026-5932 (2027-04-30).
8. **Production web server:** set CSP, `frame-ancestors`, `nosniff` and HSTS (the web ZAP
   Medium alerts).

## How to resume

- Worktree `/home/hackrvl/cloudtrain/.worktrees/b-security-ci`, branch
  `build/security-ci`. The post-commit hook pushes.
- Install the CLIs: `TOOLS_BIN=~/.local/bin bash .github/scripts/install-tools.sh <tools>`.
  semgrep and checkov come from pipx; install govulncheck with
  `go install golang.org/x/vuln/cmd/govulncheck@v1.9.0`.
- Local commands for every check are in docs/security-ci.md ("Running the checks locally").
- Keep C: free space ≥ 15 GB. The trivy and grype DBs (~1.5 GB) and the ZAP image (3.8 GB)
  can be deleted after use.
