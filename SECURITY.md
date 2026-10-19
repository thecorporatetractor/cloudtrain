# Security policy

## Supported versions

CloudTrain is in early development and has no long-term-support releases yet.
Security fixes land on `main` and in the next release; only the latest release
and `main` are supported.

| Version | Supported |
|---|---|
| `main` | yes |
| latest release (`v*` tag) | yes |
| older releases | no, upgrade to the latest |

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub: on the repository's **Security** tab choose
**Report a vulnerability**
(<https://github.com/thecorporatetractor/cloudtrain/security/advisories/new>).
Include what is affected (component, version or commit), how to reproduce it,
and the impact you see. A proof of concept helps; please keep it minimal and do
not access other people's data.

### What to expect

| Step | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Triage (confirmed or not, severity by CVSS 3.1/4.0) | within 7 days |
| Fix for Critical / High | within 30 / 60 days |
| Fix for Medium / Low | within 90 days / next release |

We keep you updated in the advisory, agree a disclosure date with you, publish
a GitHub Security Advisory (with a CVE when warranted) once a fix is available,
and credit you unless you prefer otherwise.

## Scope

In scope: everything in this repository that runs as CloudTrain: the web app,
the gateway, the lab orchestrator and its manifests, the published container
images (`ghcr.io/thecorporatetractor/cloudtrain/*`) and the CI/CD workflows.

Lab environments are deliberately insecure *inside* a lab: weak configurations
that learners are asked to find and fix are not vulnerabilities. Breaking out of
a lab is: reaching another learner's lab, the platform's control plane, the
host or another tenant's data is in scope.

Out of scope: the local development stack's published dev credentials
(`deploy/dev`, documented as DEV ONLY), findings that need an already
compromised host or cluster admin, and denial of service by volume.

## Supply chain

Every release image is signed with Sigstore cosign (keyless, GitHub OIDC) and
carries SLSA build provenance and an SBOM attestation. Verify an image with:

```bash
gh attestation verify oci://ghcr.io/thecorporatetractor/cloudtrain/<image>:<tag> \
  --repo thecorporatetractor/cloudtrain
cosign verify ghcr.io/thecorporatetractor/cloudtrain/<image>:<tag> \
  --certificate-identity-regexp '^https://github.com/thecorporatetractor/cloudtrain/\.github/workflows/images\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Container images are scanned in CI with Trivy and Grype. The Security tab shows fixable findings only (HIGH and CRITICAL for platform images, CRITICAL for lab images); the full reports are workflow artifacts. See [Image scan policy](docs/security-ci.md#image-scan-policy).

How the pipelines work is described in [docs/security-ci.md](docs/security-ci.md).
