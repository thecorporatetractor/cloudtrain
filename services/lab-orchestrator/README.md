# lab-orchestrator

Kubernetes operator that turns CloudTrain labs (`cloudtrain.dev/v3` lab.yaml,
see `packages/lab-schema`) into running, isolated topologies.

## API (`labs.cloudtrain.dev/v1alpha1`)

| Kind | Purpose |
|---|---|
| `LabTemplate` (`lt`) | Compiled, immutable lab definition: source metadata + digest, params, topology (nodes, links, entry), setup/teardown actions, checks, hints, misconceptions, solution. `{{params}}` stay unresolved; the spec is immutable (CEL rule). |
| `LabSession` (`ls`) | One learner attempt: `templateRef`, `learner`, `seed`, `ttl`/`expiresAt`, `hibernate`, optional `warmPoolRef`. Status: phase (`Pending`, `Provisioning`, `Ready`, `Grading`, `Expired`, `Failed`), conditions, resolved params, per-node status, access endpoints, entry node, expiry. |
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
`Destroy` (all idempotent); optional `Hibernator`.

| Driver | Backend | State |
|---|---|---|
| `container` | Pod + ClusterIP Service (RuntimeClass, e.g. `kata`) | implemented; exec via the API server |
| `vm` | KubeVirt | stub (`ErrNotImplemented`) |
| `k8s-cluster` | `virtual` = vcluster, `kubeadm` = VM nodes | stub, dispatches on `cluster.mode` |
| `netdev` | Clabernetes / vrnetlab | stub |

`ErrNotImplemented` / `ErrUnsupported` are permanent: the reconciler marks the
node and session `Failed` instead of retrying.

## LabSession reconciler

1. Adds a finalizer; on deletion destroys every node through its driver.
2. Fetches the template and resolves params from `spec.seed` (`TemplateResolved`).
3. Computes expiry: `spec.expiresAt`, else creation + `spec.ttl`, else creation +
   max(2 x `estimatedMinutes`, 30m). Past expiry it destroys all nodes, withdraws
   endpoints and sets `Expired` (terminal).
4. `spec.hibernate`: hibernates nodes whose driver supports it, withdraws endpoints.
5. Provisions every node (`NodesReady`), runs setup actions once
   (`SetupComplete`), publishes endpoints, sets `Ready`. A `Grading` phase set by
   the grader is preserved. Requeues while provisioning and at expiry.

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
