# Deploying CloudTrain

How to install the CloudTrain platform on a conformant Kubernetes cluster (vCenter,
AKS, EKS, GKE, bare metal), and how its images get from CI to the cluster's nodes.
Design background: [any-kubernetes.md](any-kubernetes.md) (sections 1.7, 1.8, 1.9 and 5,
decisions 6, 7 and 9). Local development stays on kind
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
in the sessions namespace, which the chart labels `privileged`: wired labs need
NET_ADMIN and NET_RAW, user namespaces with an unmasked `/proc`, FRR devices SYS_ADMIN
([any-kubernetes.md](any-kubernetes.md) 1.4). No lab container runs privileged on the
host kernel; the [lab pod admission policy](#lab-pod-admission-policy) enforces that.

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
# 0. Optional: the charts are published to GHCR (public, cosign-signed), so no checkout is
#    needed. Replace deploy/charts/cloudtrain-crds below with
#    oci://ghcr.io/thecorporatetractor/cloudtrain/charts/cloudtrain-crds --version <chart version>
#    and deploy/charts/cloudtrain with oci://ghcr.io/thecorporatetractor/cloudtrain/charts/cloudtrain
#    (the example values files are in the repository).
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
| `orchestrator.sandboxes` | `{}` (off) | tier sandboxes: per catalog tier a `runtimeClass`, `fallback` (`kubevirt` or `fail`) and `requiredFeatures` ([Tier sandboxes](#tier-sandboxes-kata)) |
| `orchestrator.sandboxPreflightConfigMap` | `lab-sandbox-preflight` | the ConfigMap with `labctl preflight`'s sandbox verdict, mounted optionally when sandboxes are set |
| `orchestrator.watchNamespace`, `.sessionSelector` | all | scope the manager (one manager per session) |
| `orchestrator.rbac.admissionPolicy` | `true` | the ValidatingAdmissionPolicy that limits the manager's cluster-wide writes ([Orchestrator RBAC](#orchestrator-rbac)) |
| `orchestrator.rbac.ovnCentral.enabled`, `.namespace`, `.selector` | `true`, `kube-system`, `app=ovn-central` | exec into Kube-OVN's ovn-central for 802.1Q on lab links; `false` drops that Role |
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
sessions. `task chart:test` lints and renders every example and checks the result.
The charts embed the CRDs, the orchestrator ClusterRole and the image catalog through
symlinks to their sources (Helm follows them when rendering and packaging), so they
never drift; `task chart:sync` re-creates the links after a CRD is added or removed.

## Orchestrator RBAC

The lab-orchestrator holds least privilege (decision 7 in
[any-kubernetes.md](any-kubernetes.md)): no `escalate`, no Secrets or `pods/exec`
outside lab namespaces, no writes to namespaced objects anywhere else. Sources, all in
`services/lab-orchestrator/config/rbac/`:

| File | Kind | Scope | Source |
|---|---|---|---|
| `role.yaml` | ClusterRole `lab-orchestrator` | cluster-wide | `+kubebuilder:rbac` markers in `internal/controller` (`make manifests`) |
| `session_role.yaml` | ClusterRole `lab-orchestrator-session` | bound per lab namespace by the manager | markers in `internal/rbac` (`make manifests`) |
| `leader_election_role.yaml` | Role | the manager's namespace | static |
| `ovn_central_role.yaml` | Role | `kube-system` (Kube-OVN's ovn-central) | static |
| `admission_policy.yaml` | ValidatingAdmissionPolicy + binding | requests of the manager's ServiceAccount | static |
| `pod_admission_policy.yaml` | ValidatingAdmissionPolicy + binding | pods in lab namespaces ([Lab pod admission policy](#lab-pod-admission-policy)) | static; sandbox RuntimeClasses and scope rewritten per instance |

### Lab namespaces

A lab namespace carries `labs.cloudtrain.dev/lab-namespace=true`: the namespaces that
hold LabSessions (`labctl verify` and `labctl exam run` namespaces, the gateway's
`cloudtrain-sessions`) and the vcluster host namespaces (`ct-vc-*`) the manager
creates. Before any driver runs, the manager creates a RoleBinding named after the
session ClusterRole in the session's namespace (and in each vcluster host namespace),
binding that ClusterRole to its own ServiceAccount. It may do that because it holds
`bind` on that one ClusterRole (`resourceNames`) and `create` on RoleBindings; it
cannot bind anything else it does not already hold. A LabSession in a namespace
without the label stays Pending with condition `Ready=False`, reason
`NamespaceNotLab`, and is checked again every 30 s.

Deleting a namespace deletes its RoleBindings before the LabSessions' finalizers have
run, which would leave the manager without permission to tear the sessions down. The
binding in a session namespace therefore carries the finalizer
`labs.cloudtrain.dev/session-access` while the namespace holds LabSessions (a
RoleBinding that is being deleted still authorizes): the manager drops it after
tearing down the namespace's last session and adds it back for the next one.
If the manager is uninstalled first, the namespace waits on that finalizer (and on the
LabSessions' own), as before: remove both by hand. vcluster host namespaces have no
such finalizer, since the manager deletes them itself after its cleanup.

Label a namespace you create for sessions yourself:

```bash
kubectl label namespace cloudtrain-sessions labs.cloudtrain.dev/lab-namespace=true \
  pod-security.kubernetes.io/enforce=privileged
```

### What the manager calls, and where it is granted

| Who | API calls | Verbs, resources | Granted by |
|---|---|---|---|
| Controllers | LabSessions, WarmPools, ExamSessions and their templates, status, finalizers | get list watch create update patch delete on `labs.cloudtrain.dev` | ClusterRole |
| Controllers | informers of `Owns(Pod)`, `Owns(Service)` (cache filtered to its own label) | get list watch `pods`, `services` | ClusterRole |
| Controllers | events on sessions | create patch `events` (core, `events.k8s.io`) | session ClusterRole |
| Leader election | its lease | `leases` CRUD, events | Role in its namespace |
| Metrics (`--metrics-secure`) | authn/authz of scrapes | create `tokenreviews`, `subjectaccessreviews` | ClusterRole |
| Startup | storage preflight, user-namespace detection, `--runtime-class` | list `storageclasses`; get list `nodes`; get `runtimeclasses` | ClusterRole |
| Session access | label check, RoleBinding | get `namespaces`; get create update delete `rolebindings`; bind `clusterroles/lab-orchestrator-session` | ClusterRole (+ policy) |
| container driver | entry and lab pods, Services, SSH key Secrets, home PVCs, NetworkPolicies, exec for setup and grading | CRUD + deletecollection on `pods services secrets configmaps persistentvolumeclaims`; `pods/exec`; `networkpolicies` | session ClusterRole |
| vm driver | VMs, VMIs, DataVolumes, root-disk PVCs, cloud-init and SSH Secrets | `virtualmachines virtualmachineinstances` (kubevirt.io), `datavolumes` (cdi.kubevirt.io), PVCs, Secrets | session ClusterRole |
| k8s-cluster kubeadm | VMs as above, PKI and kubeconfig Secrets, exec on the entry node | as vm driver, `pods/exec` | session ClusterRole |
| k8s-cluster vcluster | host namespace `ct-vc-*`: create, relabel (Pod Security), delete | get create patch delete `namespaces` | ClusterRole (+ policy) |
| k8s-cluster vcluster | Helm release: StatefulSet, Services, ServiceAccount, Secret, Role, RoleBinding; cleanup of synced objects | `statefulsets deployments replicasets`, `roles rolebindings`, core objects, deletecollection | session ClusterRole in the host namespace |
| k8s-cluster vcluster | the chart's Role (created without `escalate`, so the manager holds all of it) | `pods/attach pods/portforward pods/exec`, `pods/status pods/ephemeralcontainers pods/resize`, `pods/log`, `endpoints`, `endpointslices`, events | session ClusterRole |
| netdev driver | FRR pods, exec | pods, `pods/exec` | session ClusterRole |
| Session network | per-session VPC and subnets | get list create update patch delete `vpcs subnets` (kubeovn.io) | ClusterRole (+ policy) |
| Session network | Multus attachments | `network-attachment-definitions` CRUD | session ClusterRole |
| vlan-passthru | `ovn-nbctl` in ovn-central | list `pods`, create get `pods/exec` | Role in `kube-system` |

`internal/rbac/rbac_test.go` holds the same inventory as a test (every required call
allowed, a list of forbidden ones denied, the session ClusterRole covers the vcluster
chart's Role); `internal/rbac/envtest_test.go` checks it against a real API server
with the admission policy (`make test-rbac`).

### Before and after

| Permission | Before | After |
|---|---|---|
| `escalate` on (cluster)roles | cluster-wide | none |
| `bind` | any (cluster)role | `clusterroles/lab-orchestrator-session` only |
| ClusterRoles, ClusterRoleBindings | full CRUD | none |
| Roles | cluster-wide CRUD | lab namespaces (session ClusterRole) |
| RoleBindings | cluster-wide CRUD | create get update delete cluster-wide, admission-limited to lab namespaces |
| Secrets, ConfigMaps, PVCs, ServiceAccounts, Endpoints | cluster-wide CRUD | lab namespaces |
| `pods/exec` | cluster-wide | lab namespaces, plus `kube-system` (ovn-central, optional) |
| Pods, Services | cluster-wide CRUD | read cluster-wide (informers), writes in lab namespaces |
| Deployments, StatefulSets, ReplicaSets, NetworkPolicies, EndpointSlices | cluster-wide CRUD | lab namespaces |
| PodDisruptionBudgets | cluster-wide CRUD | none (unused) |
| VMs, VMIs, DataVolumes, NADs | cluster-wide CRUD | lab namespaces |
| Leases | cluster-wide CRUD | its own namespace |
| Events | create cluster-wide | lab namespaces and its own namespace |
| Namespaces | get list watch create patch delete | get create patch delete, admission-limited to its own `ct-vc-*` |
| Kube-OVN VPCs, subnets | CRUD | CRUD, admission-limited to its own (managed-by label) |
| Nodes, StorageClasses, RuntimeClasses, TokenReviews, SARs | read / create | unchanged |

### What stays broad, and why

- **RoleBindings cluster-wide (create, update, delete).** Lab namespaces are created by
  labctl, the gateway or an operator at any time, so the manager must be able to bind
  its session role in a namespace it has never seen. RBAC cannot restrict by
  namespace label; the admission policy does: RoleBinding writes only in lab
  namespaces, and a ClusterRole may be bound only if it is the session ClusterRole,
  with the manager itself as the only subject. RBAC's escalation check still applies
  to every other binding (it can grant nothing it does not hold). Without the policy
  (Kubernetes before 1.30, or the policy not installed) the guard is the manager's
  own label check only.
- **Namespaces create, patch, delete.** vcluster needs one namespace per virtual
  cluster (it refuses to share one). RBAC cannot restrict by name or label; the
  policy limits the manager to `ct-vc-*` namespaces carrying its managed-by label,
  enforcing Pod Security baseline or restricted, and it cannot relabel or delete any
  other namespace.
- **Pods and Services read cluster-wide.** controller-runtime's informers for
  `Owns(Pod)` and `Owns(Service)` list and watch all namespaces (filtered to the
  manager's label in the cache, not in RBAC). This is read-only and excludes Secrets.
  `--watch-namespace` narrows the informers, but a vcluster's host namespace is
  outside it, so the read stays cluster-wide.
- **`pods/exec` in kube-system.** vlan-passthru on lab link switches needs
  `ovn-nbctl` in Kube-OVN's ovn-central pods, whose names are generated, so the Role
  grants exec into every pod in that namespace. Drop `ovn_central_role.yaml` and set
  `--ovn-central=` where 802.1Q on lab links is not needed (tagged frames are then
  dropped on links), or point `--ovn-central` and the Role at another namespace.
- **Kube-OVN VPCs and subnets.** They are cluster-scoped. The policy limits writes to
  the ones carrying the manager's managed-by label, so `ovn-cluster`, `ovn-default`
  and `join` cannot be changed.
- **The session ClusterRole itself** contains what the vcluster chart's Role grants
  (`pods/attach`, `pods/portforward`, `pods/ephemeralcontainers`, ...), because the
  manager creates that Role through Helm without `escalate` and must hold every rule
  of it. These verbs apply only in lab namespaces.

### Configuration

| Setting | Default | Effect |
|---|---|---|
| `--session-cluster-role` | `lab-orchestrator-session` | the ClusterRole the manager binds in lab namespaces; empty = the manager never binds (the operator grants the session permissions, e.g. a RoleBinding in a single sessions namespace) |
| `--service-account` | `$POD_NAMESPACE/$SERVICE_ACCOUNT_NAME` (downward API in `config/manager/manager.yaml`) | the subject of those RoleBindings |
| `--ovn-central` | `kube-system/app=ovn-central` | empty = no vlan-passthru; then drop the Role in kube-system |
| `deploy/vcluster/values.yaml` `rbac.clusterRole.enabled: false` | | the vcluster chart creates no ClusterRole (with "auto" it adds one for volume snapshots) |

The Helm chart renders the same objects per release: `<release>-cloudtrain-orchestrator-<namespace>`
(cluster-wide, its `bind` pointed at the release's session role),
`...-orchestrator-session-<namespace>` (session ClusterRole), the leader-election
Role, the ovn-central Role (`orchestrator.rbac.ovnCentral`) and the admission policy
(`orchestrator.rbac.admissionPolicy`), labels the sessions namespace as a lab namespace
and passes `--session-cluster-role`, `--service-account` and `--ovn-central`.

`deploy/scripts/orchestrator-deploy.sh` gives a separate instance (`ORCH_NAMESPACE`)
its own `lab-orchestrator-<ns>`, `lab-orchestrator-session-<ns>`, kube-system Role and
admission policy (matching only its ServiceAccount), so instances on one cluster
never widen or narrow each other.

### Upgrading from the cluster-wide role

- Label the existing session namespaces (`labs.cloudtrain.dev/lab-namespace=true`)
  before rolling out the new manager; `labctl` sets the label on the namespaces it
  creates.
- vcluster releases installed by an older manager may own a cluster-scoped
  ClusterRole and ClusterRoleBinding (`vc-<release>-v-<namespace>`). The scoped
  manager cannot delete them: `helm uninstall` of such a release fails until an
  operator deletes the two objects. Let those sessions expire under the old manager,
  or delete the leftovers (`kubectl delete clusterrole,clusterrolebinding -l app=vcluster`
  after their sessions are gone). Host namespaces created by an older manager get the
  lab label and their binding the next time the manager touches them.

### What labctl needs

`labctl` runs with the operator's kubeconfig, not the manager's ServiceAccount.
`labctl verify` and `labctl exam run` create and delete lab namespaces (with the lab
and Pod Security labels), LabTemplates, LabSessions and ExamSessions, read session
Secrets (kubeconfigs, SSH keys) and exec into lab pods (the same driver code as the
manager), and for the leftover check list namespaced objects in the lab namespace plus
ClusterRoles, ClusterRoleBindings, namespaces, VPCs and subnets cluster-wide.
`labctl preflight` lists nodes, DaemonSets, Deployments, StorageClasses, ServiceCIDRs
and subnets, and creates a probe namespace with pods and a session network. In
practice it runs as a cluster administrator (the verify VM, CI); a dedicated role
would need all of the above.

## Lab pod privileges

No lab container runs privileged on the host kernel. Privileged containers exist only
for systemd and privileged catalog images inside a VM sandbox RuntimeClass
([Tier sandboxes](#tier-sandboxes-kata)); everything else gets the capabilities below,
and the [lab pod admission policy](#lab-pod-admission-policy) rejects anything more.

### Wired lab pods

A node with topology links (a "wired" pod) gets an init container `net-init`, which
applies addresses, MTU and tc netem to its link interfaces before the node starts, and
a sidecar `net` for packet capture and impairment. Both use the nettools image, drop
every capability except their own, cannot escalate privileges
(`allowPrivilegeEscalation: false`), run on a read-only root filesystem and use the
RuntimeDefault seccomp profile. The manager labels the pod
`labs.cloudtrain.dev/pod-profile=wired` (`netdev` for network devices).

| Container | Adds | Why | Not needed |
|---|---|---|---|
| `net-init` | `NET_ADMIN` | `ip addr flush/replace`, `ip link set mtu/up`, `ip route del`, `tc qdisc replace ... netem`: netlink operations in the pod's own network namespace. With a user namespace, NET_ADMIN over the namespace it owns also opens the pod's network sysctls (`ip_forward`, `rp_filter`, `ignore_routes_with_linkdown`, `arp_ignore`, `ping_group_range`; `procMount: Unmasked`) | `NET_RAW` (no raw or packet sockets), `SYS_ADMIN` (no mounts, no `ip netns`: the pod is the namespace), `SYS_MODULE` (lab kernel modules are loaded on the node, not from a pod) |
| `net` (sidecar) | `NET_ADMIN`, `NET_RAW` | tcpdump opens packet sockets (NET_RAW) and sets promiscuous mode, tc changes impairments (NET_ADMIN) | everything else |
| `node` (the lab's container) | `NET_ADMIN`, `NET_RAW` | labs manage addresses, routes, VLANs, bonds, bridges and qdiscs; ping and traceroute | unchanged by this policy; its other capabilities are the runtime's defaults |
| `node` of an FRR device | `NET_ADMIN`, `NET_RAW`, `NET_BIND_SERVICE`, `SYS_ADMIN`; seccomp RuntimeDefault | zebra programs routes and addresses, ospfd and isisd use raw sockets, bgpd binds 179; every FRR daemon raises the capabilities its privilege model declares (zebra: SYS_ADMIN, for network-namespace VRFs) and exits if one is outside the bounding set | |

Network sysctls are the one thing an unprivileged container cannot change without a
user namespace: the runtime mounts `/proc/sys` read-only, and `ip_forward` and
per-interface `rp_filter` are unsafe sysctls Kubernetes only sets with a kubelet
allow-list, at sandbox creation, when the CNI interfaces may not exist yet.

- **With user namespaces** (`--user-namespaces` and `--link-sysctls`, both on where the
  cluster supports them; the manager logs `wired lab pods ... userNamespace: true`)
  the pod runs with `hostUsers: false` and `net-init` and the node container get an
  unmasked `/proc`: the pod's network namespace is owned by its user namespace, so
  NET_ADMIN in it is enough to write its sysctls, and host-wide sysctls stay
  read-only. Every capability above is then relative to the pod's user namespace.
- **Without** (Kubernetes < 1.33 or a runtime or kernel without idmapped mounts,
  `--link-sysctls=false`): hosts set the safe sysctl `ping_group_range` on the pod and
  need nothing else. Routers (netdev nodes) get theirs from the CNI
  [`tuning`](https://www.cni.dev/plugins/current/meta/tuning/) plugin: the NAD of every
  link that touches a netdev node chains `tuning` behind `kube-ovn`, and the router's
  network-selection elements pass the sysctls as Multus `cni-args` (forwarding on,
  `rp_filter` off and `ignore_routes_with_linkdown` on for all, default, eth0 and the
  link interface, `arp_ignore` 1). Hosts on those links pass none, so `tuning` changes
  nothing for them. `tuning` writes only `net.*` keys, inside the pod's network
  namespace, from Multus' node daemon, which is the CNI's privilege, not the lab
  pod's. Every node then needs the `tuning` binary in its CNI bin directory (the
  reference plugins of containernetworking/plugins; kind does not ship it). If it is
  missing the router pod fails at sandbox creation; if a Multus version drops the
  `cni-args` of a chained NAD, `net-init` fails with "IP forwarding is off" (verified
  with Multus v4.3.1 thick). The manager logs
  `lab network ... routerSysctls`.

### Lab pod admission policy

`services/lab-orchestrator/config/rbac/pod_admission_policy.yaml` is a
ValidatingAdmissionPolicy and binding on every namespace labelled
`labs.cloudtrain.dev/lab-namespace=true`. It judges pod creation, added ephemeral
containers, and the pod templates of Deployments, ReplicaSets, StatefulSets,
DaemonSets, Jobs and CronJobs, and rejects:

- a privileged container or init container, unless the pod's `runtimeClassName` is a
  configured sandbox RuntimeClass (the `runtimeClass` values of `orchestrator.sandboxes`,
  `--sandboxes` or `--tier-runtime-classes`; the same configuration the manager
  sandboxes with);
- outside such a sandbox, any added capability beyond the Pod Security baseline set,
  except the exact sets in the table above, on the containers named there, in pods
  carrying `labs.cloudtrain.dev/pod-profile` that the manager's own ServiceAccount
  creates (any other creator, an ephemeral container or a workload template gets the
  baseline set only). A learner cannot use the label: learners hold no pod permissions in
  lab namespaces (their pods carry no ServiceAccount token, the gateway only creates
  LabSessions), labels on an existing pod cannot change its capabilities, and pods a
  vcluster syncs into its host namespace are created by the syncer, not the manager
  (that namespace also enforces Pod Security baseline);
- SYS_ADMIN without the RuntimeDefault or Localhost seccomp profile;
- host network, PID or IPC namespaces, hostPath volumes, Windows host processes and an
  unmasked `/proc` without a user namespace, sandbox or not.

| Setting | Default | Effect |
|---|---|---|
| `orchestrator.rbac.podPolicy.enabled` (Helm), `POD_POLICY` (orchestrator-deploy.sh) | on | install the policy and pass `--pod-admission-policy=<name>` |
| `orchestrator.rbac.podPolicy.scope`, `POD_POLICY_SCOPE` | `namespaces` (Helm; the deploy script without `SESSION_SELECTOR`), `own` (the deploy script with `SESSION_SELECTOR`) | `namespaces` judges every pod in lab namespaces, whoever creates it (KubeVirt's virt-launcher, CDI importers and vcluster-synced pods pass with their baseline capabilities). `own` judges only this manager's requests: for several managers on one cluster, whose policies would otherwise judge each other's pods and whose sandbox lists must then agree |
| `--pod-admission-policy` | empty | at startup the manager reads the policy and its binding: missing, or a binding that does not deny, stops the manager; a configured sandbox RuntimeClass the policy does not list is a warning. Empty is a warning |

The policy fails closed (`failurePolicy: Fail`). It needs Kubernetes 1.30+, where
ValidatingAdmissionPolicy is GA (the chart's minimum). On an older cluster
orchestrator-deploy.sh skips both admission policies with a warning, and the manager
logs `WARNING: the API server does not serve ValidatingAdmissionPolicy` and runs with
only its own sandbox rules: the only case where it fails open. Tests: the envtest
`TestEnvtestPodPolicy` (`make test-rbac`) creates the pods the manager builds, privileged
pods with and without a sandbox RuntimeClass, and the denied cases against a real API
server.

## Tier sandboxes (Kata)

Off by default. With `orchestrator.sandboxes` set, container nodes whose catalog image
has that tier (`deb-sys:24.04`, `el-sys:10`: tier B) run in the tier's sandbox
RuntimeClass, a Kata VM per pod ([kata-spike.md](kata-spike.md)):

```yaml
orchestrator:
  sandboxes:
    B:
      runtimeClass: kata-clh-runtime-rs   # kata-deploy; AKS: kata-vm-isolation; GKE: microvm
      fallback: kubevirt                  # kubevirt (default) | fail
      requiredFeatures: [dummy, gre, bond, vlan, wireguard, netem, md]   # checked by labctl preflight; empty = all
```

The chart renders it into the `<release>-orchestrator-sandboxes` ConfigMap
(`--sandboxes-config`); the flag form is `--sandboxes B=kata-clh-runtime-rs[:kubevirt|:fail]`.

- **Safety rule.** Images marked `systemd: true` or `privileged: true` in the catalog get a
  privileged container only inside an available sandbox. Without one they are never run
  privileged on the host: they fall back to their KubeVirt VM twin, or the node fails
  with a clear message. A RuntimeClass counts as a sandbox only if its handler is a Kata
  handler (`kata*`) or `labctl preflight --probe` proved it boots its own kernel; the
  name alone is never trusted, and host runtimes (`runc`, `crun`, `youki`, gVisor) are
  refused whatever a preflight file says. The decision is made where the pod is created,
  with an uncached re-check of the RuntimeClass right before a privileged pod is created.
  Who can write the preflight ConfigMap in the manager's namespace can make a non-Kata VM
  handler trusted: keep that namespace to platform administrators.
- **Availability.** At startup and every 30 s (`--sandbox-recheck`) the manager checks each
  tier: the RuntimeClass exists, its handler is a VM sandbox, its node selector matches a
  schedulable node, and the preflight verdict (if mounted) did not fail it. It logs each
  change (`tier sandbox available` / `tier sandbox unavailable`).
- **Fallback.** While a tier is unavailable, `fallback: kubevirt` rewrites that tier's
  container nodes to the image's catalog `vmFallback` (`deb-sys:24.04` -> `ubuntu-vm:24.04`,
  `el-sys:10` -> `el-vm:10`): driver `vm`, the same cpu and memory (at least 1024 MiB),
  `ssh` and `console` access, which is what those labs get on KubeVirt today (including the
  exam's reboot before grading). Not rewritten: the entry node, nodes on topology links and
  nodes with `web` access; and the rewrite is all or nothing per session, since pods reach
  each other as lab peers and a VM is not one. A node that is not rewritten keeps failing
  with the reason in the condition. `fallback: fail` rewrites nothing, and without KubeVirt
  installed the manager treats `kubevirt` as `fail`. A systemd or privileged image also
  falls back when the RuntimeClass exists but its handler is not a trusted VM (unprivileged
  tier pods still use such a RuntimeClass). A session keeps the substrate it started on: a
  sandbox that comes back or disappears later, a manager restarted without sandboxes or a
  changed catalog never moves a running node (a VM twin stays a VM; a sandboxed pod whose
  pod must be recreated while the sandbox is gone is refused, not moved).
- **Visible per session.** The LabSession condition `Sandboxed` is `True` (reason
  `Sandboxed`) when every tier-B node runs in its sandbox, `False` with reason
  `VMFallback` (nodes listed with their VM image) or `SandboxUnavailable` otherwise, plus
  an event when it changes. `status.topology` records the rewritten nodes. Lab pods carry
  the annotation `labs.cloudtrain.dev/sandbox`.
- **Preflight.** Prove the sandbox and give the manager the verdict:

  ```bash
  labctl preflight --sandboxes-config configmap:cloudtrain/ct-cloudtrain-orchestrator-sandboxes \
    --probe --systemd-image cloudtrain/deb-sys:24.04 \
    --sandbox-configmap preflight.yaml --sandbox-configmap-name cloudtrain/lab-sandbox-preflight
  kubectl apply -f preflight.yaml && kubectl -n cloudtrain rollout restart deploy/ct-cloudtrain-orchestrator
  ```

  The probe boots a pod per RuntimeClass and checks its own kernel, the lab kernel
  features, guest sizing, a lab link (Multus/Kube-OVN, MTU and 1400-byte frames with DF
  both ways between a runc pod and a sandboxed pod) and systemd boot with `kubectl exec`.
  A tier it fails is unavailable to the manager (its labs fall back); a non-Kata handler it
  proves (e.g. GKE `microvm`) becomes trusted.
- **Capacity.** The gateway's capacity view (`GET /api/platform/capacity`) marks Kata nodes
  (`sandbox`), counts sandboxed lab pods per node (`sandboxes`) apart from KubeVirt VMs, and
  includes the RuntimeClass overhead in requested CPU and memory.
- The deprecated `orchestrator.tierRuntimeClasses` (`--tier-runtime-classes`, the
  prototype) still works as sandboxes with `fallback: fail`; it cannot be combined with
  `orchestrator.sandboxes`.

## Not yet

- `cloudtrain-prereqs` (KubeVirt, CDI, Multus, Kube-OVN) and `labctl preflight`.
- `el-vm`, `ubuntu-vm` and the tier-A Linux pod images (`el-lab`, `deb-lab`) in CI: they
  need the package-mirror content (see the design below), so a release overlay still
  leaves those refs on their dev names.
- Mirrors, ServiceMonitors and PodDisruptionBudgets in the chart.

## Images and registries

### Where images come from

GHCR is the signed source of every image CloudTrain publishes:

| Image | Built by | Published as |
|---|---|---|
| Platform: `lab-orchestrator`, `gateway`, `web` | `.github/workflows/images.yml` | `ghcr.io/<owner>/<repo>/<name>` |
| Lab containers marked `publishable: true` in `deploy/images/catalog.yaml` (jumphost, frr, nettools, netsvc, oci-registry, iac-ws-tofu, ansible-ctl, kql-ws) | the same workflow | `ghcr.io/<owner>/<repo>/<publishName>` |
| Lab containerDisks (kubeadm-node v1.37, v1.36-upgrade and v1.37-full, etcd-host, docker-vm) | `.github/workflows/vm-images.yml` on GitHub-hosted KVM runners | `ghcr.io/<owner>/<repo>/<publishName>`, see [Publishing containerDisks](#publishing-containerdisks) |
| `el-vm`, `ubuntu-vm` and the tier-A Linux pods (el-lab, deb-lab) | locally or on the verify VM (they need the package mirror) | not yet |
| Helm charts `cloudtrain` and `cloudtrain-crds` | the `publish` job of `.github/workflows/charts.yml` | `oci://ghcr.io/<owner>/<repo>/charts/<chart>:<version>`, see [Charts](#charts) |

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
`orchestrator.catalog.releaseOverlay`. The containerDisks have their own overlay, `catalog-release-vm.yaml`
from `vm-images.yml` (see [Publishing containerDisks](#publishing-containerdisks)); entries
CI does not publish (`el-vm`, `ubuntu-vm`, the tier-A pods) keep their base image, and the
overlay header lists them. Pin by digest, not by tag:
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

## Charts

The `publish` job of `charts.yml` packages `deploy/charts/cloudtrain` and
`deploy/charts/cloudtrain-crds` and pushes them with `helm push` to
`oci://ghcr.io/<owner>/<repo>/charts/<chart>:<chart version>`, on every push to `main`
whose chart version is not in the registry yet. Bumping `version` in `Chart.yaml` is the
release; an existing version is never overwritten. A tag `<chart>-<version>`
(`cloudtrain-0.2.0`) releases that chart too and must match `Chart.yaml`. Each chart is
signed with cosign keyless (by digest) and has SLSA build provenance.

```bash
helm install cloudtrain-crds oci://ghcr.io/<owner>/<repo>/charts/cloudtrain-crds --version 0.1.0 -n cloudtrain --create-namespace
cosign verify ghcr.io/<owner>/<repo>/charts/cloudtrain:0.1.0 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/<owner>/<repo>/\.github/workflows/charts\.yml@refs/(heads/main|tags/.+)$'
```

## Publishing containerDisks

`.github/workflows/vm-images.yml` builds the golden VM disks on free GitHub-hosted
`ubuntu-24.04` runners, which expose `/dev/kvm` once a udev rule makes it writable
(`.github/actions/build-vm-image`). The list is `tools/images/vm-images.yaml`:
`kubeadm-node` (catalog `kubeadm:1.37`), `kubeadm-upgrade` (`kubeadm:1.36`), `etcd-host`,
`docker-vm`, then `kubeadm-full` (`kubeadm:1.37-full` and `-sec`) in a second stage,
because it layers on the published `kubeadm-node` (pulled by digest, signature verified).

| Event | What runs |
|---|---|
| Pull request touching the image inputs | builds and boot-smokes only the images whose inputs changed; nothing is pushed or signed, the job has no write token |
| Push to `main` touching `tools/images/**`, the catalog or `deploy/versions.env` | the images whose inputs that push changed (the shared inputs, build.sh, the builder, versions.env, rebuild all) are built, boot-smoked and published |
| `v*` tag, weekly schedule (Monday 03:41 UTC) | every image |
| `workflow_dispatch` | `variants` input: `all` or a comma separated list (`etcd-host` is the smallest) |

Each build is `bash tools/images/build.sh <variant>` unchanged (pinned and checksum-verified
inputs, lock files, `virt-customize` with KVM, `DOCKERIO_MIRROR=mirror.gcr.io`), after
removing the runner's unused toolchains for disk space. The built disk must boot to a login
prompt under qemu/KVM before anything is pushed; the full lab test
(`tools/images/boot-test.sh`) needs a cluster and stays a verify-VM check.

Publishing pushes `ghcr.io/<owner>/<repo>/<publishName>` with the tags `<branch>`,
`sha-<commit>`, the semver tags and the catalog tag (`v1.37.1`, `3.6`, `29`), signs the
digest with cosign keyless, attaches SLSA provenance and an SBOM attestation (the dpkg
database read out of the disk with libguestfs; the pushed image's own SBOM if that fails)
and uploads the digest as an artifact. The `catalog overlay` job turns those digests into
`catalog-release-vm.yaml` (workflow artifact, attached to the release on `v*` tags),
which maps the containerDisk refs to `ghcr.io/<owner>/<repo>/<publishName>@<digest>`.
`images.yml` writes `catalog-release.yaml` for the container refs. Give the orchestrator
both: merge them with
`yq ea '. as $i ireduce ({}; . * $i)' catalog-release.yaml catalog-release-vm.yaml > overlay.yaml`
and pass the result as `orchestrator.catalog.releaseOverlay`.

**Not built here: `el-vm`, `ubuntu-vm`.** They carry the package-mirror snapshot (several
GB) built by `tools/mirrors/build-content.sh` from the pinned snapshot dates. The
planned route is to publish that content once per snapshot date as an OCI artifact
(`oras push ghcr.io/<owner>/<repo>/mirror-content:<date>`) and pull it into the job.

**Cost.** Public repository: hosted-runner minutes and GHCR storage and egress are free. A
private repository pays per minute (roughly 10 to 25 minutes per variant) and counts
the images against its package storage quota.

## Dev clusters: pull from GHCR

`task orchestrator:deploy` and `tools/images/load.sh` load lab images from the local Docker
store into the kind nodes (`kind load`), built by `tools/images/build*.sh`. That default is
unchanged. With `IMAGE_SOURCE=ghcr` the images CI publishes are pulled from GHCR inside
each node's containerd instead and tagged with the catalog name, so the catalog and the
orchestrator need no change and a machine without KVM can run VM labs:

```bash
IMAGE_SOURCE=ghcr task orchestrator:deploy                 # every publishable catalog image
IMAGE_SOURCE=ghcr GHCR_TAG=sha-<commit> bash tools/images/load.sh kubeadm-node etcd-host
```

| Variable | Default | Meaning |
|---|---|---|
| `IMAGE_SOURCE` | `local` | `local` or `ghcr` |
| `GHCR_REGISTRY` | `ghcr.io/thecorporatetractor/cloudtrain` | where the packages live (a fork's own) |
| `GHCR_TAG` | `main` | `main`, `sha-<commit>`, a catalog tag, or `sha256:<digest>` to pin |
| `GHCR_USER`, `GHCR_TOKEN` | | only for a private package (a token with `read:packages`) |

Images CI does not publish (the Terraform workstation, `moto`, `el-vm`, `ubuntu-vm`, the
tier-A Linux pods) still come from the local Docker store. A cluster that should pull
straight from GHCR at run time (no preloading) instead sets
`CATALOG_OVERLAY=<merged overlay file>` for `task orchestrator:deploy`, or the chart's
`orchestrator.catalog.releaseOverlay`: the digests then name GHCR and the nodes pull them.
