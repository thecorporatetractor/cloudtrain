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
| `container` | Pod + ClusterIP Service (RuntimeClass, e.g. `kata`) | implemented; exec via the API server; nodes with link ends are wired into the lab network |
| `vm` | KubeVirt | stub (`ErrNotImplemented`) |
| `k8s-cluster` | `virtual` = vcluster, `kubeadm` = VM nodes | stub, dispatches on `cluster.mode` |
| `netdev` | Pod per device (FRR); vrnetlab VMs / Clabernetes later | implemented for FRR (see "Lab network and netdev") |

`ErrNotImplemented` / `ErrUnsupported` / `ErrConflict` are permanent: the reconciler marks the
node and session `Failed` instead of retrying.

## Lab network and netdev

`internal/network` builds one isolated network per session on Kube-OVN +
Multus; `drivers.LinkNetwork` plugs it into the container and netdev drivers
(`ContainerDriver.Network`, set by the manager).

**Objects** (all labelled `labs.cloudtrain.dev/session`, `-session-namespace`,
`-session-uid`, `app.kubernetes.io/managed-by`; names are deterministic and
hashed over namespace, session, UID and suffix):

| Object | Name | Purpose |
|---|---|---|
| Kube-OVN `Vpc` | `<ns>-<session>-vpc-<hash>` | no route to the platform network, the nodes or the internet |
| `Subnet` mgmt | `<ns>-<session>-mgmt-<hash>`, `198.19.255.0/24` | primary interface (eth0) of every *wired* node |
| `Subnet` per link | `<ns>-<session>-link-<i>-<hash>`, carrier `198.18.<16*i>/28` | the link's L2 segment (logical switch) |
| Multus NAD per link | `<session>-link-<i>-<hash>`, provider `<nad>.<ns>.ovn` | attaches the segment as `node:iface` |

A node is *wired* if it is a netdev node or has a link end. Wired pods get:
the mgmt subnet as primary network, one Multus attachment per link end with
the interface name from `node:iface`, NET_ADMIN/NET_RAW on the node
container, a `net-init` init container (nettools image; privileged only for
netns sysctls) and a `net` sidecar (nettools; `sleep infinity`). Unwired nodes
(e.g. a jumphost without links) are untouched.

**Links are pure L2.** Kube-OVN needs a CIDR, gateway and IP per port, so each
link segment uses a carrier `/28` from `198.18.0.0/16`; `net-init` flushes the
carrier address before the node starts, so the VPC router never routes lab
traffic and every L3 decision is made by the lab's own nodes. Link subnets
must not overlap `198.18.0.0/15` (rejected at plan time, permanent).

**Addressing rule** (`link.subnet`):

- link touching a **netdev** node: every end is `addressMode: lab`; the
  device config and setup actions own all addresses (routers and their hosts
  need gateways the platform cannot know);
- **host-only** link (container/vm ends) with a subnet: `addressMode:
  platform`, end `a` gets the first usable address, end `b` the second
  (`/31`: both addresses);
- no subnet: `addressMode: none`.

`net-init` also removes eth0's default route (the VPC has no way out; this
keeps routing tables clean) and enables forwarding on routers.

**Impairment**: `tc qdisc replace dev <iface> root netem delay <latencyMs>ms
loss <lossPct>%` on *both* ends (each end shapes its egress, so each direction
is impaired once: RTT grows by 2 x latencyMs), `mtu` via `ip link set mtu` on
both ends (576-9000). `network.ImpairCommand` re-applies or clears it at
runtime in the sidecar.

**Isolation** is structural: wired pods live only in the session VPC, which
has no route to the platform pod network, kube-apiserver, nodes or the
internet, even when a learner adds a default route via the VPC gateway; the
platform network has no route into the VPC. No NetworkPolicy is put on wired
pods (it would also filter link traffic: OSPF multicast, router loopbacks).
Platform-network pods such as the jumphost keep the `lab-demo.sh` policies.

**Status**: `status.links[]` = `id`, `segment` (logical switch), `network`
(`ns/nad`), `subnet`, `impair`, `ends[]` (`node`, `interface`, `addressMode`,
`address`).

**Capture**: `LinkNetwork.CaptureTarget(sessionRef, node, iface, opts)` returns
namespace/pod/container (`net` sidecar) and the `tcpdump` argv (text or
`Pcap: true` for a pcap stream on stdout); `LinkNetwork.Capture` runs it
through a `PodExecutor`. The access gateway execs the same target.

**Teardown**: nodes first, then `DestroyTopology` deletes NADs, subnets and the
VPC by label (no topology needed), only after the session's wired pods are
gone; it waits in place (up to 45s) instead of erroring, so the session
finalizer is released as soon as everything is gone.

**Reuse by other drivers (e.g. kubeadm VMs)**: `network.Build(session,
topology)` gives the `Plan` (VPC, mgmt `Segment`, link `Segment`s with
`Subnet`/`NAD`/`Provider`/`CIDR`/`Gateway`); `Manager.Ensure`/`Delete` own the
objects. A VM driver attaches a VM to a link with a KubeVirt `multus` network
(`networkName: <ns>/<Segment.NAD>`) and to mgmt with the
`ovn.kubernetes.io/logical_switch: <Mgmt.Subnet>` annotation on the
`virt-launcher` template. Interface names inside a VM follow the guest's NIC
order, not `node:iface`, so a VM driver must rename them (cloud-init/udev).
A kubeadm cluster subnet should become one more `Segment` in the same session
VPC (non-overlapping with `198.18.0.0/15`); `Plan` currently only creates mgmt
and link segments, so adding a named extra segment is the extension to make.

### netdev driver

`NetdevDriver` embeds the `ContainerDriver` (naming, ownership, exec,
reset/destroy) and selects a `DeviceFamily` by catalog image ref. A family
declares its backend (`pod` now; `vm` = vrnetlab on KubeVirt and
`clabernetes` return `ErrNotImplemented`), capabilities, readiness command,
config command, CLI command and console command; adding a NOS is adding a
family (and, for VM/Clabernetes, the backend in `NetdevDriver.Provision`).

FRR (`frr:*`, image `cloudtrain/frr:10`, built from `tools/images/netdev`):

| Operation | Implementation |
|---|---|
| node | Pod (no Service), wired, startup probe `vtysh -c "show version"`, caps NET_ADMIN, NET_RAW, NET_BIND_SERVICE, SYS_ADMIN |
| `config` action (`ExecDeviceConfig`) | stdin -> temp file -> `vtysh -f` (exit code != 0 on any rejected line; FRR config is declarative, re-applying is a no-op) |
| `device-cmd` check (`ExecDeviceCommand`) | `vtysh -c <line>` per line of `Command` |
| `run`/shell check | `/bin/sh` in the device container (admin only) |
| `console` / `ssh` access | `k8s-exec` endpoint with `command: vtysh` (the VPC is not reachable from the access gateway) |

`hack/netdevproof` drives a live session through these drivers (solution,
mutation, checks, capture) and `hack/netdev-proof.sh` is the end-to-end proof
(`deploy/.results/netdev-ospf-proof.txt`).

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
`--runtime-class`, `--net-tools-image` (default `nettools:1`). The cache only holds Pods/Services labelled
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
