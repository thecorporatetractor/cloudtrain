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
