# lab-orchestrator

Kubernetes operator that turns CloudTrain labs (`cloudtrain.dev/v3` lab.yaml,
see `packages/lab-schema`) into running, isolated topologies.

## API (`labs.cloudtrain.dev/v1alpha1`)

| Kind | Purpose |
|---|---|
| `LabTemplate` (`lt`) | Compiled, immutable lab definition: source metadata + digest, params, topology (nodes, links, entry), setup/teardown actions, checks, hints, misconceptions, solution. `{{params}}` stay unresolved; the spec is immutable (CEL rule). |
| `LabSession` (`ls`) | One learner attempt: `templateRef`, `learner`, `seed`, `ttl`/`expiresAt`, `hibernate`, optional `warmPoolRef`. `resetGeneration`. Status: phase (`Pending`, `Provisioning`, `Ready`, `Grading`, `Hibernated`, `Expired`, `Failed`), recorded topology, setup progress, conditions, resolved params, per-node status, access endpoints, entry node, expiry. |
| `WarmPool` (`wp`) | `templateRef` + `size`; status reports the `ready` count. (Controller not built yet.) |

CRDs are generated into `config/crd`, RBAC into `config/rbac`.

## Layout

```
api/v1alpha1/          CRD Go types (kubebuilder markers) + generated deepcopy
internal/labschema/    embedded copy of the v3 JSON schema (synced by `make schema`)
internal/compile/      lab.yaml -> LabTemplate: YAML parse, JSON-schema + semantic validation,
                       deterministic seeded {{param}} resolution
internal/drivers/      NodeDriver interface, registry, drivers
internal/controller/   LabSession reconciler
cmd/labctl/            CLI: compile / validate
cmd/manager/           operator entrypoint
testdata/labs/         sample labs (networking OSPF, kubeadm cluster)
```

## Drivers

`NodeDriver`: `Provision`, `Status`, `Exec`, `Connect(access)`, `Reset`,
`Destroy` (all idempotent); optional `Hibernator`, `TopologyProvisioner`, and
`AccessProvider` (what the entry node needs to reach the node: hosts with
pinned host keys, kubeconfigs). Errors wrapping `ErrInProgress` (e.g. VMs
still terminating) make the reconciler requeue after 3s instead of backing off.
Every object carries the session labels (`labs.cloudtrain.dev/session`,
`session-uid`, `app.kubernetes.io/managed-by`), and no driver adopts or deletes
an object it did not create (`ErrConflict`).

| Driver | Backend | What it builds |
|---|---|---|
| `container` | Pod + ClusterIP Service (RuntimeClass, e.g. `kata`) | Image from the catalog. The **entry node** gets an admin sidecar, host aliases for every VM host and, with VMs, a second NIC on the lab network. |
| `vm` | KubeVirt `VirtualMachine` | Catalog containerDisk on the lab network; cloud-init: `learner` (key, passwordless sudo), root with the admin key only, pinned host key, static `/etc/hosts`. Ready once cloud-init finished. |
| `k8s-cluster` `virtual` | vcluster (Helm, vendored chart + `deploy/vcluster/values.yaml`) | One vcluster per node, embedded DB in an emptyDir (no PVC), kubeconfig rewritten to `https://<release>.<ns>.svc` and published as `<node>-kubeconfig`; synced workloads isolated by a NetworkPolicy. |
| `k8s-cluster` `kubeadm` | one KubeVirt VM per `cluster.nodes[]` | The orchestrator owns the PKI (CA, bootstrap token, admin/learner client certs, host keys), so kubeconfigs exist before boot. Control plane: `kubeadm init` with the pre-seeded CA, version = the image's kubeadm, CNI via the image's `/opt/cloudtrain/bin/cni-install <podCIDR>` (fallback: bundled Flannel manifest), pod CIDR 10.244.0.0/16. Workers join with a pinned CA hash. Declared taints are exact (`[]` = untainted), labels applied after join, `state: notready` = joined, Ready once, then kubelet stopped and disabled. Ready once every member matches its declared state and CoreDNS is available. |
| `netdev` | Clabernetes / vrnetlab | stub (separate stream) |

Image refs resolve through the image catalog (`--image-catalog`, files or
directories, later files override earlier ones). An unknown ref, or a ref of
the wrong kind, fails the node permanently with the list of known refs.

### Per-session lab network (`labnet.go`)

Topologies with VM hosts get their own Kube-OVN VPC `ct-<hash>` with subnet
`-lab` 192.168.100.0/24 (hosts .10, .11, ... in topology order) and `-access`
192.168.99.0/24 (entry node .5 via a Multus NAD, routed to the lab subnet). The
VPC has no route to the platform network or the internet, so every session
uses the same IPs. NetworkPolicy `ct-<hash>-entry` gives the entry pod no
ingress and egress only to cluster DNS, its own vclusters (:8443) and the lab
CIDRs. Ported from `deploy/scripts/lab-demo.sh`; self-contained so it can move
onto a shared network package.

### Entry node and credentials

```
pod <session>-<entry>-<hash>
 ├─ container "node"   root (no_new_privs); the learner works here as user
 │                     "learner" (terminal: k8s-exec + runuser). Holds only learner
 │                     credentials: ~/.kube/config (one context per cluster, named
 │                     cluster.context, no current-context) and ~/.ssh (key,
 │                     config with every VM host by topology name, known_hosts).
 └─ container "admin"  root, all capabilities dropped. Cluster-admin kubeconfigs
                       (/root/.kube/<node>.conf, system:masters for kubeadm) and the
                       root ssh key of every VM. No shared volume or process
                       namespace with "node", so the learner can never read them.
```

Credentials are written by exec (tar over stdin) once available ("wiring", run
by the reconciler every pass; a digest + container-restart marker on the pod
makes it idempotent), so the learner's kubeconfig stays writable and a vcluster
that comes up later is added without restarting the pod. Platform credentials
(the manager's service account) never reach the pod:
`automountServiceAccountToken: false`.

Action / check routing (`controller.NodeExecutor`):

| `on` | `as: admin` | `as: learner` |
|---|---|---|
| entry / container node | exec in the node container as root | `runuser -u learner` with a login-like environment in `$HOME` |
| `<cluster>` (both modes) | admin sidecar, `KUBECONFIG=/root/.kube/<cluster>.conf` | learner shell with a private kubeconfig copy switched to `cluster.context` (the learner's current context is untouched) |
| `<cluster>/<member>`, `<vm>` | admin sidecar: `ssh root@<host>` | learner shell: `ssh <host>` (learner account, sudo) |

`apply` always targets the cluster (`kubectl apply -f -`).

## LabSession reconciler

1. Adds a finalizer. On deletion it destroys every node recorded in
   `status.topology` (never only the live template) and keeps the finalizer until
   that succeeded.
2. Fetches the template and resolves params from `spec.seed` (`TemplateResolved`).
3. Computes expiry: `spec.expiresAt`, else creation + `spec.ttl`, else creation +
   max(2 x `estimatedMinutes`, 30m); without a template, creation + 30m. Past
   expiry it destroys all recorded nodes and only then sets `Expired` (terminal).
4. Records the resolved topology in status before provisioning anything.
5. `spec.hibernate`: hibernates nodes whose driver supports it, withdraws
   endpoints, phase `Hibernated`.
6. `spec.resetGeneration` above `status.observedResetGeneration`: `Reset`s every
   node and re-runs setup.
7. Provisions every node (`NodesReady`); fails the session after
   `--provision-timeout` (15m). Runs setup actions (`SetupComplete`), persisting
   `status.setupProgress` after each one so retries resume; setup runs again when
   a node's `instanceID` changes (pod recreated, container restarted). Publishes
   endpoints and sets `Ready`. A `Grading` phase set by the grader is preserved.

Status is written with a merge patch. Setup runs inside the reconcile (actions
are capped at 10m; `--max-concurrent-reconciles`, default 8), and **setup
actions must be idempotent**: an action whose progress could not be saved, or
all of them after a node is recreated or reset, run again.

Manager flags: `--metrics-bind-address` (default `0`, off; HTTPS with
Kubernetes authn/authz when set), `--watch-namespace`, `--leader-elect`,
`--max-concurrent-reconciles`, `--provision-timeout`, `--image-registry`,
`--runtime-class`, `--image-catalog`, `--admin-image-ref`, `--helm`,
`--vcluster-chart`, `--vcluster-values`, `--session-selector`,
`--leader-election-id`. The cache only holds Pods/Services labelled
`app.kubernetes.io/managed-by=cloudtrain-lab-orchestrator`.

## Grading

Bumping `spec.validateRequest` grades a Ready session: the reconciler
publishes `status.validation` with `phase: Running` and the request's
`observedRequest` first (session phase `Grading`), runs every check once, then
writes `Complete` with the weighted `score` and per-check results (phase back
to `Ready`). A request on a Failed or Expired session is answered with phase
`Failed`. `internal/grader`:

- Targets: `check.on`, else the entry node; `k8s-query` / `k8s-can-i` run on
  `query.cluster` with the cluster-admin kubeconfig; `k8s-context` reads the
  learner's current context as the learner.
- Types: `shell` (stdout vs. expect, else exit 0), `k8s-query` (`kubectl get
  <resource> <name> -o jsonpath=...`; NotFound reads as empty output),
  `k8s-can-i` (`yes`/`no`), `k8s-context`, `file` (content of `target`; a
  missing file fails), `service-state` (`systemctl is-active`, default
  `active`), `reachability` (TCP connect to `target:port`, or ping), `http`
  (body vs. expect, else 2xx/3xx). `device-cmd` is reported as unsupported.
- **Output comparison**: the raw stdout with at most one trailing newline
  (`\n` or `\r\n`) stripped; nothing else is trimmed. The expected value is
  used verbatim. `regex` is Go RE2 and matches anywhere unless anchored.
- Timeouts: `timeoutSec` (default 5s, max 5m) via coreutils `timeout` in the
  target, plus transport slack; exit 124/137 = "the check timed out".
- `message` is learner-safe (`passed`, `not satisfied yet`, `the check timed
  out`, `the check could not run`); it never contains expected values.
  `output` (truncated to 2 KiB) is for authors only.

## labctl

```sh
make labctl
bin/labctl compile testdata/labs/net-ospf-two-routers/lab.yaml            # LabTemplate YAML
bin/labctl compile --seed 1234 testdata/labs/net-ospf-two-routers/lab.yaml  # params resolved
bin/labctl validate testdata/labs content/labs
```

`--schema FILE` validates against a schema file instead of the embedded copy.

### labctl verify

The verifier cycle of `docs/k8s-readiness.md` against a live cluster with the
in-cluster manager: per run a fresh namespace `ctv-<lab>-<kind><rand>` with the
compiled LabTemplate and one LabSession (labelled `--session-label`, default
`labs.cloudtrain.dev/verify=true`). Runs: the base cycle with two seeds whose
params differ (Ready, at least one check fails, solution steps, every check
passes), one per misconception mutation (every `expectFail` check fails), one
per alternative (every check passes). Provisioning, setup and grading go
through the controller (`spec.validateRequest`); solution / mutation steps run
through the same driver exec path as setup actions. After each run the session
is deleted and the namespace must hold nothing but `kube-root-ca.crt` and the
`default` ServiceAccount, with no VPC/subnet of the session and no vcluster
ClusterRole left. JSON reports go to `deploy/.results/verify/<lab>.json`, a
summary table to stdout; exit 1 on any failure.

```sh
task lab:verify -- ../../content/packs/kubernetes/labs/scale-berth-planner
bin/labctl verify --context kind-cloudtrain-dev --parallel 2 --only drain-yard-worker \
  --catalog ../../deploy/images/catalog.yaml,/path/overlay.yaml ../../content/packs/kubernetes/labs
```

Flags: `--parallel N` (default 2; VM labs cost ~1 GiB per worker + 2 GiB per
control plane), `--only id,...`, `--keep` (leave sessions for debugging; skips
the teardown check), `--quick` (only the first-seed base run), `--catalog`
(unknown image refs fail the lab before anything is created),
`--ready-timeout`, `--grade-timeout`, `--teardown-timeout`.

## Deployment

`task orchestrator:deploy` builds `services/lab-orchestrator/Dockerfile`
(manager + pinned helm + vendored vcluster chart; build context = repo root),
loads it into kind, applies `config/default` (CRDs, ClusterRole, Deployment in
`cloudtrain-system`) and the `lab-image-catalog` ConfigMap from
`deploy/images/catalog.yaml`. Variables: `CATALOG_OVERLAY=<file>` (merged over
the catalog, e.g. to alias refs locally), `ORCH_NAMESPACE` (separate instance
with its own binding and leader-election lease), `SESSION_SELECTOR` (manager
`--session-selector`: only matching LabSessions), `SKIP_CRDS=1`,
`LOAD_LAB_IMAGES=0`. The ClusterRole is broad by necessity (VMs, VPCs,
vcluster's Roles via `escalate`/`bind`).

## Make targets

| Target | What |
|---|---|
| `make generate` | sync schema, deepcopy, CRDs, RBAC (controller-gen v0.18) |
| `make test` | `go vet` + `go test ./...` (fake client and fake executors; no cluster or network) |
| `make build` | `bin/labctl`, `bin/manager` |
| `make samples` | validate and compile `testdata/labs` |

After editing `packages/lab-schema/schema/lab.schema.json`, run `make generate`;
`TestEmbeddedSchemaInSync` fails while the embedded copy drifts.
