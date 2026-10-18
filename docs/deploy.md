# Deploying CloudTrain

How to install the CloudTrain platform on a conformant Kubernetes cluster (vCenter,
AKS, EKS, GKE, bare metal), and how its images get from CI to the cluster's nodes.
Design background: [any-kubernetes.md](any-kubernetes.md) (sections 1.7, 1.8 and 5,
decisions 6 and 9). Local development stays on kind
([dev-environment.md](dev-environment.md), `task dev:*`).

## What gets installed

| Chart | Contents |
|---|---|
| `deploy/charts/cloudtrain-crds` | The lab CRDs (LabTemplate, LabSession, WarmPool, ExamTemplate, ExamSession). It is a separate chart because Helm never upgrades a chart's `crds/` directory. They are kept on uninstall |
| `deploy/charts/cloudtrain` | gateway (BFF), web (static app behind nginx), lab-orchestrator (with its catalog ConfigMap), the sessions namespace, the Ingress or Gateway API route, an optional cert-manager Certificate and optional NetworkPolicies. A demo Postgres is opt-in |
| `cloudtrain-prereqs` (not built yet) | KubeVirt, CDI, Multus and Kube-OVN, per [any-kubernetes.md](any-kubernetes.md) section 5. Until it exists, the platform team installs them; the versions are in `deploy/versions.env` |

Platform pods run as non-root on a read-only root filesystem, with no privilege
escalation, all capabilities dropped and RuntimeDefault seccomp. They fit the
`restricted` Pod Security level, so the release namespace can enforce it. Lab pods run
in the sessions namespace, which the chart labels `privileged` (wired labs need a
privileged `net-init`; [any-kubernetes.md](any-kubernetes.md) 1.4).

### Why the web app has its own server

The web app is a static build served by `nginx-unprivileged` in its own image
(`apps/web/Dockerfile`, about 27 MB), not by the gateway:

- the gateway stays API-only (`no-store`, JSON 404s, its own scaling and rollouts);
- hashed assets get a year of caching and can sit behind a CDN;
- the security headers live in one small, reviewed nginx config.

Same origin is kept by routing `/api` to the gateway and everything else to web, in
the Ingress or HTTPRoute. The session cookie, CSRF header and terminal WebSocket
therefore need no CORS.

Runtime settings come from the environment at container start, so the same image
serves every environment:

- `CT_API_BASE` and `CT_ENVIRONMENT` set `window.__CLOUDTRAIN_CONFIG__` through
  `/runtime-config.js`;
- `CT_CSP_*` add Content-Security-Policy sources.

The web app has no OIDC settings: the gateway is the OIDC client (BFF).

## Prerequisites

- Kubernetes 1.30 or newer, and `helm` 3.14+ (Helm 4 works).
- An Ingress controller or a Gateway API implementation (see [Exposure](#exposure)).
  cert-manager is optional.
- PostgreSQL 16 or newer with two roles: an owner (migrations) and an app role that is
  not a superuser, has no BYPASSRLS and does not own the tables, so row-level security
  applies. `deploy/dev/postgres/init.sql` shows the grants.
- An OIDC provider (Keycloak, Entra ID, ...) with a confidential client (code flow +
  PKCE). Keycloak's admin API is optional (SSO connections, invitations).
- For labs: KubeVirt + CDI, Multus, Kube-OVN, and `/dev/kvm` on the lab nodes (VM
  labs). See [any-kubernetes.md](any-kubernetes.md) section 3 per provider.

## Install on a fresh cluster

```bash
# 1. CRDs (once per cluster; upgrade this chart first on every release)
helm install cloudtrain-crds deploy/charts/cloudtrain-crds -n cloudtrain --create-namespace

# 2. Database roles (on the Postgres server, as an admin)
psql "$ADMIN_URL" <<'SQL'
CREATE ROLE cloudtrain_owner LOGIN PASSWORD '<owner password>';
CREATE ROLE cloudtrain_app LOGIN PASSWORD '<app password>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE cloudtrain OWNER cloudtrain_owner;
\connect cloudtrain
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO cloudtrain_owner;
GRANT USAGE ON SCHEMA public TO cloudtrain_app;
SQL

# 3. The gateway's credentials
kubectl -n cloudtrain create secret generic cloudtrain-gateway \
  --from-literal=CT_DATABASE_URL='postgres://cloudtrain_app:<app password>@<host>:5432/cloudtrain' \
  --from-literal=CT_DATABASE_OWNER_URL='postgres://cloudtrain_owner:<owner password>@<host>:5432/cloudtrain' \
  --from-literal=CT_OIDC_CLIENT_SECRET='<client secret>' \
  --from-literal=CT_SESSION_SECRET="$(openssl rand -base64 36)"
  # optional: --from-literal=CT_KEYCLOAK_ADMIN_CLIENT_SECRET=...

# 4. The release's catalog overlay (lab images by digest), from the GitHub release
gh release download v<version> -p catalog-release.yaml

# 5. The platform, with the values for your provider (examples below)
helm install cloudtrain deploy/charts/cloudtrain -n cloudtrain \
  -f deploy/charts/cloudtrain/examples/values-<provider>.yaml \
  --set host=labs.example.com \
  --set global.imageTag=<version> \
  --set-file orchestrator.catalog.releaseOverlay=catalog-release.yaml

# 6. Check
helm test cloudtrain -n cloudtrain
curl -s https://labs.example.com/api/health
```

The install notes print the OIDC redirect URI to register with the IdP:
`https://<host>/api/auth/callback`. The post-logout redirect is `https://<host>/`. Both
are derived from `host`: the chart sets the gateway's `CT_PUBLIC_URL` and `CT_WEB_URL`
to `https://<host>` (`http://` only with `tls.enabled=false`).

Schema migrations run in the gateway's `migrate` init container on every rollout. They
are idempotent and serialized by Kysely's migration lock. Without an owner URL, set
`gateway.migrate=false` and run `node dist/db/cli.js migrate` yourself.

Upgrades: `helm upgrade cloudtrain-crds ...` first, then `helm upgrade cloudtrain ...`
with the new release's overlay. Uninstalling `cloudtrain` keeps the CRDs, the sessions
namespace and with them running labs (`helm.sh/resource-policy: keep`).

### Main values

| Value | Default | Meaning |
|---|---|---|
| `host` | `labs.example.com` | public host; routes, public URL, OIDC redirect URI |
| `global.imageRegistry`, `global.imageTag` | `ghcr.io/thecorporatetractor/cloudtrain`, appVersion | where gateway, web and lab-orchestrator come from |
| `exposure.type` | `ingress` | `ingress`, `gatewayAPI` or `none` |
| `exposure.ingress.className`, `.annotations` | | IngressClass and controller annotations |
| `exposure.gatewayAPI.parentRefs` / `.createGateway`, `.gatewayClassName` | | attach to a shared Gateway, or create one for the release |
| `exposure.gatewayAPI.timeouts` | | HTTPRoute rule timeouts (terminal WebSockets) |
| `tls.enabled`, `tls.mode` | `true`, `secret` | `secret` (existing `tls.secretName`), `certManager` (Certificate from `tls.certManager.issuerRef`), `external` (TLS ends at the cloud LB or CDN) |
| `gateway.existingSecret` | | the Secret from step 3 |
| `gateway.oidc.issuer`, `.clientId` | | IdP issuer URL and client |
| `gateway.keycloak.url` | | Keycloak admin API (optional) |
| `gateway.trustProxy` | private ranges | proxies whose `X-Forwarded-*` are trusted (client IPs for audit and rate limits) |
| `gateway.sessionsNamespace` | `cloudtrain-sessions` | lab sessions and lab pods |
| `web.runtimeConfig.apiBase`, `web.csp.*` | same origin | runtime config and extra CSP sources |
| `orchestrator.catalog.releaseOverlay` | | `catalog-release.yaml` content |
| `orchestrator.images.mirrors`, `.registry`, `.pullSecrets` | | where lab images are pulled from ([Images and registries](#images-and-registries)) |
| `orchestrator.storageClass`, `.vmDisks`, `.runtimeClass` | default class, `persistent`, cluster default | lab storage and runtime |
| `orchestrator.watchNamespace`, `.sessionSelector` | all | scope the manager (one manager per session) |
| `networkPolicy.enabled`, `.ingressNamespaceSelector` | off | admit gateway/web traffic only from the ingress data plane |
| `postgres.demo.enabled` | off | demo Postgres on an emptyDir; never for real data |
| `extraObjects` | | provider policies rendered with the release (templated) |

`values.schema.json` rejects unknown keys and malformed values (an apiBase with a
path, quotes in runtime config, semicolons in CSP sources, malformed mirrors).

## Exposure

`/api` (REST, the terminal WebSocket, OIDC callbacks) goes to the gateway and `/`
goes to web, on one host. Terminal WebSockets stay open while a learner works, so each
provider's idle timeout must be raised. The examples do this.

| Provider | Values file | Front end | TLS | WebSocket timeout | Health checks |
|---|---|---|---|---|---|
| AKS | `values-aks-app-routing.yaml` | app routing add-on (managed NGINX), `className: webapprouting.kubernetes.azure.com` | cert-manager, or Key Vault through the add-on | `nginx.ingress.kubernetes.io/proxy-read-timeout: 3600` | from the controller |
| EKS (ALB) | `values-eks-alb.yaml` | AWS Load Balancer Controller, `className: alb`, `target-type: ip` | ACM on the ALB (`tls.mode: external`) | `idle_timeout.timeout_seconds=3600` | `healthcheck-path: /healthz` (both services serve it) |
| EKS (NLB) | `values-eks-nlb.yaml` | NLB (controller Service annotations) in front of an in-cluster NGINX/Envoy | cert-manager at the controller | controller setting | NLB TCP |
| GKE | `values-gke-gateway.yaml` | GKE Gateway, `gke-l7-global-external-managed`, Gateway created by the chart | cert-manager Secret on the listener (or Certificate Manager) | `GCPBackendPolicy timeoutSec: 3600` | `HealthCheckPolicy` on `/healthz` (the LB checks `/` by default, which is a 404 on the gateway) |
| Generic NGINX | `values-nginx.yaml` | any NGINX ingress controller | existing Secret | `proxy-read-timeout` | from the controller |
| Envoy Gateway / any Gateway API | `values-envoy-gateway.yaml` | HTTPRoute on a shared Gateway (`parentRefs`) | on the shared listener (`tls.mode: external`) | route `timeouts.request: 0s` + `BackendTrafficPolicy` | from the implementation |
| kind / verify VM | `values-kind.yaml` | any controller (the smoke test uses Traefik) | none | default | from the controller |

ingress-nginx is retired upstream (March 2026), and AKS's managed NGINX gets patches
only until November 2026. Prefer the Gateway API where the provider offers it (AKS
app routing's Gateway API mode, Application Gateway for Containers, the AWS LB
Controller's Gateway API support, GKE Gateway, Envoy Gateway, Cilium, Istio, NSX/Avi
on vCenter). `exposure.type: none` renders no route; route the two paths yourself.

`gateway.trustProxy` must cover the addresses the proxy connects from: the
controller's pod CIDR, the VPC CIDR for an ALB in IP mode, or Google's front-end ranges
`35.191.0.0/16,130.211.0.0/22` for GKE. Otherwise audit entries and the public
API's rate limits see the proxy's address instead of the client's. Hop counts are
not supported (Fastify ignores forwarded headers with them).

### Security headers

The web server sends:

- a strict Content-Security-Policy: `script-src 'self'` (no inline scripts or eval),
  `style-src 'self' 'unsafe-inline'` (component styles), `connect-src 'self'` plus
  `web.csp.connectSrc`, `worker-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`;
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy`, COOP/CORP `same-origin`, and HSTS (effective over HTTPS).

The gateway keeps `nosniff` and `Cache-Control: no-store` on every API response.
Hashed assets are cached for a year, while `index.html` and `/runtime-config.js` are
`no-cache`.

### A separate API origin

To serve `/api` on another host (for example `api.labs.example.com` while the app
stays on `labs.example.com`), set:

- `web.runtimeConfig.apiBase: https://api.labs.example.com`;
- `web.csp.connectSrc: "https://api.labs.example.com wss://api.labs.example.com"`;
- `gateway.corsOrigins: [https://labs.example.com]`.

Both hosts must be same-site, because the session cookie is `SameSite=Lax`. The chart
routes one host only, so the second route is yours to add. The default (one host,
path routing) needs none of this.


## Local and the verify VM

`task dev:*` is unchanged: kind, the Vite dev server and `task dev:gateway` with the
`kind-cloudtrain-dev` context. To try the chart there, build the three images, `kind
load` them, install any ingress controller and use `examples/values-kind.yaml`. That
file sets a demo Postgres, plain HTTP, `pullPolicy: Never`, and an orchestrator
limited to its own sessions namespace, so it never reconciles the dev manager's
sessions. `task chart:test` lints and renders every example and checks the result;
`task chart:sync` refreshes the files the charts embed (CRDs, the orchestrator
ClusterRole, the image catalog).

## Not yet

- `cloudtrain-prereqs` (KubeVirt, CDI, Multus, Kube-OVN) and `labctl preflight`.
- Publishing the charts as OCI artifacts (`helm push` to GHCR in the release); today
  they install from the repository.
- Orchestrator RBAC scoped down (decision 7 in any-kubernetes.md); the chart uses
  the generated ClusterRole as is.
- containerDisks and the tier-A Linux pod images in CI (see the design below), so a
  release overlay still leaves those refs on their dev names.
- Mirrors, ServiceMonitors and PodDisruptionBudgets in the chart.

## Images and registries

### Where images come from

GHCR is the signed source of every image CloudTrain publishes:

| Image | Built by | Published as |
|---|---|---|
| Platform: `lab-orchestrator`, `gateway`, `web` | `.github/workflows/images.yml` | `ghcr.io/<owner>/<repo>/<name>` |
| Lab containers marked `publishable: true` in `deploy/images/catalog.yaml` (jumphost, frr, nettools, netsvc, oci-registry, iac-ws-tofu, ansible-ctl, kql-ws) | the same workflow | `ghcr.io/<owner>/<repo>/<publishName>` |
| Lab containerDisks (kubeadm-node, etcd-host, el-vm, ubuntu-vm, docker-vm) and the tier-A Linux pods (el-lab, deb-lab) | locally or on the verify VM today (they need KVM or the package mirror) | not yet; see [Publishing containerDisks](#publishing-containerdisks-design) |

Every push to `main` and every `v*` tag pushes with the branch, `sha-<commit>` and
semver tags, a cosign keyless signature, SLSA provenance and an SBOM attestation.
Pull requests build and scan only.

**Restricted images are never published.** A catalog entry is published only when it
says `publishable: true`. `labctl catalog check` runs in CI (the `go` job) and fails when
the workflow publishes a name that no publishable entry carries. The Terraform
workstation (`terraform-ws:1.15`, image `cloudtrain/iac-ws:1.15-terraform`, BUSL-1.1)
is `publishable: false`. Only the OpenTofu flavour is published, as `iac-ws-tofu`
(`deploy/images/overlays/iac-opentofu.yaml`). Upstream images (`moto:5`) are
`publishable: false` too: they are pulled from their own registry.

### The release catalog overlay

Lab content refers to images by catalog ref (`jumphost:1`, `kubeadm:1.37`). In dev,
the catalog maps them to local names (`cloudtrain/jumphost:1`) that
`task orchestrator:deploy` loads into kind. Those names would resolve to docker.io on
a real cluster, so a release ships an overlay instead: the `catalog overlay` job of
`images.yml` writes `catalog-release.yaml`, which maps every publishable ref to the
exact image CI pushed in that run:

```yaml
# labctl catalog overlay --catalog deploy/images/catalog.yaml,deploy/images/overlays/iac-opentofu.yaml \
#   --registry ghcr.io/<owner>/<repo> --digests <dir> --allow-missing
images:
  jumphost:1:
    kind: container
    image: ghcr.io/<owner>/<repo>/jumphost@sha256:...
    publishable: true
  terraform-ws:1.15:             # public releases run the OpenTofu flavour
    kind: container
    image: ghcr.io/<owner>/<repo>/iac-ws-tofu@sha256:...
```

It is a workflow artifact on every push and a release asset on `v*` tags. The
orchestrator merges it over the base catalog: in the Helm chart it is the value
`orchestrator.catalog.releaseOverlay`. Entries CI does not publish yet (containerDisks)
keep their base image, and the overlay header lists them. Pin by digest, not by tag:
a mirror keeps the digest, so the signature check below still holds after mirroring.

### Pulling from the cluster's own registry

Managed clusters usually pull from their provider's registry with the node identity
(no pull secrets) and must not depend on GHCR at run time. The orchestrator rewrites
registries at the moment it resolves an image. The overlay keeps naming GHCR, and the
cluster maps that prefix onto its mirror:

| Manager flag | Helm value | Effect |
|---|---|---|
| `--image-mirror from=to,...` | `orchestrator.images.mirrors` | rewrites the registry part of every lab image (pods and VM disks). The longest `from` wins. `docker.io` also matches unqualified refs (`busybox:1.37` = `docker.io/library/busybox:1.37`), so Docker Hub images (`moto`, the vcluster workload images) can come from a mirror too |
| `--image-registry <prefix>` | `orchestrator.images.registry` | prefixes unqualified catalog images (a registry laid out like the dev catalog, e.g. Harbor with `cloudtrain/jumphost:1` pushed) |
| `--image-pull-secrets a,b` | `orchestrator.images.pullSecrets` | Secrets in the session namespace that lab pods pull with. Ephemeral VM containerDisks use the first one. The chart can create the Secret from `imagePullSecrets.create` |

The catalog file itself can carry the same settings (`registry`, `mirrors`,
`imagePullSecrets` at the top level). The flags add to it or override it. Persistent VM
root disks are imported by CDI with `pullMethod: node`: the node's container runtime
pulls them, so they need node-level registry access (the provider integrations
below), not a pull secret.

The platform images (gateway, web, lab-orchestrator) are ordinary Deployment images.
Set `global.imageRegistry` in the chart to the mirror path that holds them.

#### Azure: ACR import (or ACR artifact cache)

```bash
ACR=myacr; SRC=ghcr.io/<owner>/<repo>
# The platform images (the chart's appVersion tag) and every digest in catalog-release.yaml:
for ref in $(yq '.images[].image' catalog-release.yaml | grep "^$SRC/"); do
  az acr import --name $ACR --source "$ref" --image "cloudtrain/${ref#$SRC/}" \
    ${GHCR_TOKEN:+--username "$GHCR_USER" --password "$GHCR_TOKEN"}
done
az aks update -g <rg> -n <cluster> --attach-acr $ACR   # node identity pulls, no secret
```

Values: `orchestrator.images.mirrors: ["ghcr.io/<owner>/<repo>=myacr.azurecr.io/cloudtrain"]`,
`global.imageRegistry: myacr.azurecr.io/cloudtrain`. `az acr import` keeps digests. An
ACR artifact cache rule (`az acr cache create --source-repo ghcr.io/<owner>/<repo>/*
--target-repo cloudtrain/*`, with a credential set for a private GHCR) pulls on first
use instead of importing ahead of time.

#### AWS: ECR pull-through cache

```bash
aws secretsmanager create-secret --name ecr-pullthroughcache/ghcr \
  --secret-string '{"username":"<github user>","accessToken":"<read:packages token>"}'
aws ecr create-pull-through-cache-rule --ecr-repository-prefix ghcr \
  --upstream-registry-url ghcr.io --credential-arn <secret arn>
aws ecr create-pull-through-cache-rule --ecr-repository-prefix docker-hub \
  --upstream-registry-url registry-1.docker.io --credential-arn <docker hub secret arn>
```

Values: `orchestrator.images.mirrors: ["ghcr.io=<acct>.dkr.ecr.<region>.amazonaws.com/ghcr",
"docker.io=<acct>.dkr.ecr.<region>.amazonaws.com/docker-hub"]` and
`global.imageRegistry: <acct>.dkr.ecr.<region>.amazonaws.com/ghcr/<owner>/<repo>`. The
node role needs `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, and on the first
pull `ecr:BatchImportUpstreamImage` and `ecr:CreateRepository` for the cache prefixes.
ECR's Docker Hub cache wants `library/` for official images; the `docker.io` mirror
adds it.

#### Google Cloud: Artifact Registry remote repository

```bash
gcloud artifacts repositories create ghcr --location=<region> --repository-format=docker \
  --mode=remote-repository --remote-docker-repo=https://ghcr.io \
  ${PRIVATE:+--remote-username=<github user> --remote-password-secret-version=<secret version>}
gcloud artifacts repositories create docker-hub --location=<region> --repository-format=docker \
  --mode=remote-repository --remote-docker-repo=DOCKER-HUB
```

Values: `orchestrator.images.mirrors: ["ghcr.io=<region>-docker.pkg.dev/<project>/ghcr",
"docker.io=<region>-docker.pkg.dev/<project>/docker-hub"]`,
`global.imageRegistry: <region>-docker.pkg.dev/<project>/ghcr/<owner>/<repo>`. The node
service account needs `roles/artifactregistry.reader`.

#### vCenter, bare metal: Harbor

A proxy-cache project (registry endpoint of type "Github GHCR", project `ghcr` with
proxy cache on) behaves like the caches above:
`orchestrator.images.mirrors: ["ghcr.io=harbor.example.com/ghcr", "docker.io=harbor.example.com/hub"]`.
For air-gapped sites, a pull-based replication rule copies the release's
repositories ahead of time; `cosign copy` brings the signatures along. When Harbor is
private, add a robot account as `imagePullSecrets.create` and
`orchestrator.images.pullSecrets`.
Nodes still need containerd to trust Harbor's CA.

### Verifying signatures

The mirror keeps the digest, so the GHCR signature verifies the mirrored image:

```bash
cosign verify ghcr.io/<owner>/<repo>/jumphost@sha256:... \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/<owner>/<repo>/\.github/workflows/images\.yml@refs/(heads/main|tags/v.+)$'
```

An admission policy (Kyverno `verifyImages`, Sigstore policy-controller) can enforce
the same identity on the mirror's repositories once signatures are copied there.

## Publishing containerDisks (design)

Status: plan, not built. Today the golden VM images are built by
`tools/images/build.sh` on a KVM machine (developer box or the verify VM) and loaded
into kind. Nothing publishes them, so a real cluster has no source for `kubeadm:*`,
`etcd-host`, `el-vm`, `ubuntu-vm` or `docker-vm` (catalog entries already
`publishable: true` with their `publishName`).

**Runner.** GitHub-hosted `ubuntu-24.04` runners expose `/dev/kvm` (nested
virtualization on the hosted VM). A udev rule makes it usable by the runner user:

```yaml
- name: Enable KVM
  run: |
    echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm.rules
    sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
    test -w /dev/kvm
```

The standard runner (4 vCPU, 16 GB RAM, ~14 GB guaranteed free disk, more after
removing preinstalled toolchains) fits one variant per job: the base cloud image
(~600 MB), the customised qcow2 (2-6 GB before sparsify) and the compressed
containerDisk. A larger runner (paid, 8-16 vCPU, 150+ GB) is only needed if
`kubeadm-full` outgrows it.

**Workflow `vm-images.yml`.**

| Step | What |
|---|---|
| Trigger | `push` to `main` and `v*` tags on `tools/images/**`, `deploy/versions.env`, `tools/images/lock/**`; `workflow_dispatch`; PRs build `etcd-host` only (smallest) as a smoke test |
| Matrix | `kubeadm-node`, `kubeadm-upgrade`, `etcd-host`, `docker-vm`, then `kubeadm-full` in a second job (`needs`), because it layers on the published `kubeadm-node` (pulled by digest instead of the local cache) |
| Build | `bash tools/images/build.sh <variant>` unchanged: pinned and checksum-verified inputs, lock files checked, `virt-customize` with KVM; `DOCKERIO_MIRROR=mirror.gcr.io` for the preloaded images |
| Boot test | `tools/images/boot-test.sh` (qemu, KVM) before anything is pushed |
| Scan + SBOM | Trivy/Grype on the image is of little use for a qcow2; `syft` over the mounted root filesystem (`virt-tar-out` / `guestmount`) for the SBOM, and a package-list diff against the previous release |
| Push | to `ghcr.io/<owner>/<repo>/<publishName>` with the catalog tag and `sha-<commit>`; cosign keyless signature, provenance and SBOM attestations as in `images.yml`; the digest as a `digest-<publishName>` artifact |
| Overlay | `images.yml`'s `catalog overlay` job then finds the digests (a `workflow_run` trigger, or one release workflow that calls both as reusable workflows), and `--allow-missing` stops listing containerDisks |

**Mirror-content images.** `el-vm` and `ubuntu-vm` carry the package-mirror snapshot
as a local repository (several GB), built by `tools/mirrors/build-content.sh` from the
pinned snapshot dates. Two options: (a) run `build-content.sh` in the job (slow,
tens of minutes, a lot of download), or (b) publish the mirror content once per snapshot
date as an OCI artifact (`oras push ghcr.io/<owner>/<repo>/mirror-content:<date>`) and
pull it into the job. Recommendation: (b), since the content changes only when the
snapshot dates in `deploy/versions.env` change.

**Size and cost.** GHCR storage and egress are free for public packages. For private
packages, storage counts against the plan's quota: ~10 variants x ~1-3 GB x retained
versions. A retention job keeps the last N `sha-*` versions per package and every
semver tag. Hosted runner minutes are free for public repositories; a private
repository pays per minute (about 10-25 minutes per variant).

**Licensing.** The images contain Ubuntu, AlmaLinux, Kubernetes, etcd, Docker Engine,
Calico and the add-on charts, all redistributable. Publishing must keep the SBOM and
licence texts (as the containers do). Anything restricted stays `publishable: false`,
and `labctl catalog check` would also cover `vm-images.yml` (pass `--workflow` twice
once it exists).

**Open points.** Whether GitHub keeps `/dev/kvm` on standard hosted runners (it is
documented for Android emulator use, not as a guarantee); the fallback is a self-hosted
runner on the verify VM with the same workflow. Signing qcow2 content beyond the OCI
signature (for vSphere imports later) is out of scope.
