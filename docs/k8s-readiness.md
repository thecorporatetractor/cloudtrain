# Kubernetes readiness: contracts between streams

Goal: every lab in `content/packs/kubernetes` runs for real on the local stack
(`task dev:up`) and passes the full verifier cycle, and a learner can do a lab
from the web UI with a real terminal and real grading.

## Verifier cycle (`labctl verify <lab dir>`)

For each lab, against the live cluster:

1. Fresh session: setup runs, session becomes Ready.
2. Grade: at least one check fails (the lab is not already solved).
3. Apply `solution.steps`; grade: every check passes.
4. For each misconception with a `mutation`: fresh session, apply the mutation
   instead of the solution; every check in `expectFail` must fail.
5. For each `solution.alternatives[]`: fresh session, apply its steps; every
   check passes.
6. Delete each session; every resource the session created is gone.
7. Params: run step 1-3 with two different seeds.

Output: a JSON report per lab under `deploy/.results/verify/<lab>.json` plus a
summary table. Exit non-zero on any failure.

## Image catalog

`deploy/images/catalog.yaml` maps lab image refs to artifacts. Labs reference
only refs in the catalog. Kubeadm labs use `kubeadm:1.37`; the control-plane
upgrade lab uses `kubeadm:1.36` (target v1.37.1 staged offline). Lab VMs have
no internet: pod images used by a lab must be in `workloadImages`.

## Grading API (LabSession)

- Bump `spec.validateRequest` to request grading.
- The controller runs every check once (checks run out-of-band with admin
  credentials, on `check.on` or the entry node) and writes
  `status.validation` with `observedRequest` = the request, `phase`
  Running -> Complete (or Failed if grading itself broke), `score` 0-100
  (weighted), and `checks[]` (`id`, `passed`, `weight`, `skills`, `message`,
  `output` truncated to 2 KiB, `durationMs`).
- `message` is learner-safe: it never reveals expected values.

## Access

- `status.entryNode` + `status.endpoints[]`: the entry node publishes a
  `k8s-exec` endpoint with `target` = `namespace/pod/container`. The terminal
  gateway execs a login shell there as the learner user.
- The learner is a non-root user on the jumphost. Admin credentials used by
  setup, checks and the verifier are never readable by the learner.
- From the jumphost, `kubectl config get-contexts` lists every cluster in the
  topology under its `cluster.context` name, and `ssh <node>` reaches every
  kubeadm node by its topology name (with `sudo` on the node).
- **Container nodes reach each other by name** (lab peers). Every container node
  without a topology link (the entry node included) is a *lab peer*: inside one
  session `getent hosts moto`, `curl http://s3store:8333`, `git clone
  git://git/repo.git` or `ssh <node>` work from any peer, on any port. The full name
  is `<node>.ct-<hash>-nodes.<namespace>.svc.cluster.local` (headless Service
  `ct-<hash>-nodes` is the pods' subdomain and every peer searches it). NetworkPolicy
  `ct-<hash>-peers` admits traffic between the session's peers only: another lab, the
  platform (API server, gateway, managers) and the internet cannot reach a peer, and
  a peer can reach only its own lab, cluster DNS and the shared mirrors. The entry
  node keeps its extra egress (its vclusters, VM hosts). Authoring notes:
  - Service nodes (Moto, an S3 store, Gitea, a database) are ordinary container
    nodes; start their daemons from `setup` (`setsid nohup <daemon> >log 2>&1 </dev/null &`)
    and bind `0.0.0.0`. Non-entry container nodes run as the image's user (often
    `learner`): keep data under `$HOME` or `/tmp`.
  - Names exist from pod start (not-ready pods are published), so setup steps on
    other nodes may use them; still wait for the daemon (`until curl ...; do sleep 2; done`).
  - Node names are the DNS names: keep them short DNS labels (`s3store`, `git`, `moto`).
  - Wired nodes (netdev nodes and container nodes with a link) live in the session
    VPC instead and are not lab peers: a peer cannot reach them over the platform
    network. Connect a service a wired node needs with a link, and use link addresses.
  - VM hosts are reached from the entry node over the lab VPC as before (`ssh <host>`).

