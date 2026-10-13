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
`Destroy` (all idempotent); optional `Hibernator` (`Status` then reports
`Hibernated`) and `TopologyProvisioner` (session-scoped links / networks,
provisioned before and destroyed after the nodes). `NodeState` carries an
`InstanceID` (a change means the node was recreated) and `Details` (addresses,
member states). Endpoints can reference a credential Secret (`secretRef`).

Container nodes are named `<session>-<node>-<hash>` (hash of session name, UID
and node), labelled with the session UID, and the driver never adopts or
deletes an object of that name it did not create (`ErrConflict`, permanent).

| Driver | Backend | State |
|---|---|---|
| `container` | Pod + ClusterIP Service (RuntimeClass, e.g. `kata`) | implemented; exec via the API server |
| `vm` | KubeVirt | stub (`ErrNotImplemented`) |
| `k8s-cluster` | `virtual` = vcluster, `kubeadm` = VM nodes | stub, dispatches on `cluster.mode` |
| `netdev` | Clabernetes / vrnetlab | stub |

`ErrNotImplemented` / `ErrUnsupported` / `ErrConflict` are permanent: the reconciler marks the
node and session `Failed` instead of retrying.

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
`--runtime-class`. The cache only holds Pods/Services labelled
`app.kubernetes.io/managed-by=cloudtrain-lab-orchestrator`.

## labctl

```sh
make labctl
bin/labctl compile testdata/labs/net-ospf-two-routers/lab.yaml            # LabTemplate YAML
bin/labctl compile --seed 1234 testdata/labs/net-ospf-two-routers/lab.yaml  # params resolved
bin/labctl validate testdata/labs content/labs
```

`--schema FILE` validates against a schema file instead of the embedded copy.

## Make targets

| Target | What |
|---|---|
| `make generate` | sync schema, deepcopy, CRDs, RBAC (controller-gen v0.18) |
| `make test` | `go vet` + `go test ./...` (fake client; no cluster or network) |
| `make build` | `bin/labctl`, `bin/manager` |
| `make samples` | validate and compile `testdata/labs` |

After editing `packages/lab-schema/schema/lab.schema.json`, run `make generate`;
`TestEmbeddedSchemaInSync` fails while the embedded copy drifts.
