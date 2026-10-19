# Handoff: k8s-admin stream (paused 2026-10-14)

## Round 4 (2026-10-17/18, kubeadm stream, branch `content/kubeadm-round-4`)

One agent for the kubeadm labs of k8s-admin, k8s-dev and k8s-sec. The machine was the
bottleneck: the shared heavy slot (vm + build, no FIFO: waiters poll every 15 s) was won
twice in ~7 h, and host load stayed at 40-220 from other agents' pod/VM/build work.

**Image switch (all streams at once, so exam topologies stay identical):** every
`xks-*` K task and every k8s-sec K learning lab now uses `kubeadm:1.37-sec`; every
`xka-*`/`xpe-*`/`xkd-*` K task and every add-on learning lab uses `kubeadm:1.37-full`
(curriculum `images` updated). Labs without add-ons keep `kubeadm:1.37`. `labctl exam
compile` passes for sim-k8s-admin, -developer, -security.

**Rewrites for what the full image actually ships:**
- `falco-shell-in-container`, `xks-detection-rule-output`: Falco is the `falco`
  DaemonSet (`addons-install falco --wait` in setup), alerts are JSON lines in the Falco
  Pod's log, rules come from the node's `/etc/falco/rules.d` (hostPath), reload = delete
  that node's Falco Pod. New misconception in both: rule written on the wrong node.
  Checks read `kubectl -n falco logs` / match `output_fields`. **Not live-verified yet**
  (the `falco -L` and "rules file named in the log" parts of `rule-loaded` are the
  riskiest assumptions; check them on the first run).
- `ingress-tls-tracking`, `xks-ingress-tls-secret`: Traefik instead of ingress-nginx
  (`addons-install ingress`), redirect through a `traefik.io/v1alpha1` Middleware
  (`redirectScheme`) attached with `traefik.ingress.kubernetes.io/router.middlewares`;
  checks hit the `traefik/traefik` ClusterIP. New misconception: TLS without redirect.
  Not live-verified yet (confirm that the redirect Middleware leaves HTTPS requests alone).
- `xkd-ingress-path`: `addons-install ingress,lb` (the Ingress gets its address from
  Traefik's LoadBalancer Service, so MetalLB is needed); `xkd-top-memory-report`:
  `addons-install metrics-server`.

**Unblocked 2026-10-19 (feat/kubeadm-image-tools):** buildah is in every kubeadm image;
kubeadm:1.37-full/-sec add Trivy with a dated offline DB, cosign with the signed
`/opt/qm-signing` fixture, podman.socket (Trivy reads buildah images through it), the
golang:1.25 and static-nonroot:2026.10 base images in buildah's storage, and
`addons-install csi-hostpath` (see docs/dev-environment.md "kubeadm extras"). Verified
live on the VM: build-waybill-image, xkd-build-tag-image, xka-expand-claim,
xks-signature-verify, xks-sbom-spdx, xks-scan-pick-image, waybill-image-slim-scan;
sbom-dispatch-image is re-queued in the batch runner.

**Lab bugs fixed:** `xka-crd-custom-resource` (the "operator" loop never started:
`pgrep -f /tmp/berth-operator.sh` matched the setup shell's own command line; now
`pgrep -f "^sh /tmp/berth-[o]perator.sh"`; solution waits up to 180 s);
`xka-helm-install-values`, `helm-shipment-events` (the jumphost ships Helm 4: `helm list
-a` is an error, all statuses are listed by default).

Verify helpers used: scratchpad `kr4/` (`v2.sh` batch per slot acquisition, `qrun.sh`
queue, `podq.sh` pod slot, `setstatus.py`, `mark.sh`, `mkpool.py <exam>` copies the
verified pool tasks into a dir for `labctl exam run --labs <dir> --allow-missing`).

**k8s-admin in round 4: 5 -> 16 verified.** All 11 V-tier exam tasks passed in the pod
slot (xka-previous-logs-error, -service-selector-fix, -events-failing-pod,
-dns-lookup-record, -rollout-undo, -secret-env-volume, -sidecar-shared-log,
-clusterrole-binding, -helm-install-values, -kustomize-apply, -crd-custom-resource).
No K lab verified: `xka-loadbalancer-address` (the MetalLB proof) hit the post-init
crashloop at host load 25-50 (calico-node 8-10 restarts, controller-manager/scheduler in
Error, `addons-install lb` past its exec deadline, so the IPAddressPool was never
created); its remaining runs were cut off at the end of the round. sim-k8s-admin pool coverage:
storage 0/2, troubleshooting 3/5, workloads 3/3, architecture 4/4, networking 1/3.
To cover the draw with two kubeadm clusters only (qm-yard + qm-tracking, 6 VMs): verify
xka-pv-claim-mount, xka-retain-reclaim, xka-crictl-container-id (qm-yard) and
xka-coredns-down, xka-nodeport-fixed, xka-loadbalancer-address (qm-tracking).
`helm-shipment-events` (V learning lab) fails on Helm 4: `helm upgrade` reports
server-side-apply field conflicts, and the mutations' `helm install` hits
"resource ... exists"; it needs a Helm 4 pass.


Branch `build/k8s-admin`, worktree `/home/hackrvl/cloudtrain/.worktrees/b-k8s-admin`.
Owned labs: `docs/build-ownership.yaml` → `k8s-admin` (88). All work is committed and pushed.

## Status at pause

| Status | Count |
|---|---|
| verified (passed full `labctl verify` live) | 5 |
| built, authored and validated, live verify still pending | 63 |
| built, blocked on a platform prerequisite (note in `content/curriculum.yaml`) | 18 |
| proposed (not authored, blocked) | 2 |

`node tools/lab-verify/bin/lab-verify.mjs --strict` and `labctl validate` are clean;
`labctl exam compile sim-k8s-admin` (exam-engine branch's labctl) compiles all 41 tasks
(shared-node consistency OK).

### Verified

| Lab | Runs | Time |
|---|---|---|
| kubectl-first-contact | 2 seeds, 4 mutations, 1 alternative | 698 s |
| patch-without-clobbering | 2 seeds, 4 mutations, 2 alternatives | ~2000 s (batch of 4, parallel 3) |
| generate-manifest-dry-run | 2 seeds, 4 mutations, 1 alternative | 715 s |
| jsonpath-depot-inventory | 2 seeds, 4 mutations, 1 alternative | 642 s |
| routing-engine-config | 2 seeds, 4 mutations, 1 alternative | 585 s |

### Built, live verify pending (no known blocker)

Virtual cluster (pod slot): label-printer-crashloop (**failed once, see next steps**),
dns-debug-pod, tariff-api-no-endpoints, waybill-rollback, rolling-update-surge,
dock-scheduler-probes, qos-class-forecast, sandbox-quota-limitrange,
native-sidecar-log-shipper, shared-scratch-emptydir, who-can-delete-secrets,
helm-shipment-events, kustomize-depot-overlays; exam tasks xka-clusterrole-binding,
xka-dns-lookup-record, xka-events-failing-pod, xka-helm-install-values,
xka-kustomize-apply, xka-previous-logs-error, xka-rollout-undo, xka-secret-env-volume,
xka-service-selector-fix, xka-sidecar-shared-log, xka-crd-custom-resource.

kubeadm (vm slot): telemetry-daemonset, affinity-cold-chain, taint-gpu-workers,
spread-tracking-replicas, priority-preemption-peak, pvc-pending-mismatch,
coredns-customs-forward, cni-trace-pod-path, control-plane-tour, night-shift-user-cert,
depot-worker-notready, yard-scheduler-revive, apiserver-down-cert-path,
pending-pod-detective, oncall-depot-incident, kubeadm-etcd-static-restore,
fleet-node-prep-join, kubeadm-bootstrap-cluster, ledger-second-control-plane,
worker-kubelet-upgrade, csi-driver-inventory; exam tasks xka-tainted-node-count,
xka-toleration-control-plane, xka-required-affinity, xka-netpol-egress-db,
xka-csr-user-access, xka-hpa-memory, xka-etcd-snapshot-save, xka-crictl-container-id,
xka-pv-claim-mount, xka-retain-reclaim, xka-coredns-down, xka-nodeport-fixed,
xka-kubelet-stopped, xka-worker-join, xka-controller-manager-flag,
xka-apiserver-etcd-endpoint, xka-node-upgrade-minor, xpe-k8s-deploy-tracking,
xpe-worker-notready-recovery, xpe-sec-least-privilege-ci, xpe-sec-restricted-namespace.

### Built, blocked (reason in the lab's `notes`)

Setup calls the foundations stream's `/opt/cloudtrain/bin/addons-install <addon> --wait`
(contract in `build/foundations:tools/images/kubeadm-addons/addons-install`), which the
current `kubeadm:1.37` image does not ship:

| Lab | Add-on |
|---|---|
| parcel-sorting-memory-hog, berth-planner-hpa, xka-top-cpu-pod, xpe-k8s-autoscale-tracking | metrics-server |
| tracking-ingress-two-paths, xka-ingress-host-rule, xpe-k8s-ingress-route, xpe-incident-tracking-outage | traefik (IngressClass) |
| brokers-gateway-routes, xka-httproute-split | gateway (Gateway API + GatewayClass traefik) |
| loadbalancer-kiosk-ip, xka-loadbalancer-address | metallb |
| manifest-store-dynamic, xka-default-storageclass | local-path |
| xka-expand-claim | resolved 2026-10-19: `addons-install csi-hostpath` (verified) |

Foundations publishes the add-ons on a separate catalog ref `kubeadm:1.37-full`. Once
merged, either the add-ons land in `kubeadm:1.37` or these labs (and their curriculum
`images`, owned by the curriculum) must switch to `kubeadm:1.37-full`; for exam tasks
every task sharing that cluster must switch together (identical node definitions).

### Proposed note, resolved (round 5 wave 1, networking stream)

- distroless-invoice-debug: authored and verified live. No distroless image is needed: the
  renderer Pod runs a shell-less workload and the learner debugs it with an ephemeral container
  (`--profile=baseline`); use is recorded by an admin-container audit loop.
- shipment-operator-crd: authored and verified live. The operator is simulated by an
  admin-container reconcile loop (gated on the CRD being Established, the operator Deployment
  Available and its ServiceAccount allowed to create Deployments). A real controller image in
  `workloadImages` is still a catalog gap; swap the loop for it when one exists.

## In flight at pause

Nothing running. Interrupted cleanly: affinity-cold-chain (kubeadm runs never became
Ready, see blocker 1), dns-debug-pod (just started). telemetry-daemonset was attempted
twice; both times the kubeadm sessions never got Ready.

## Next steps, in order

1. Fix label-printer-crashloop: in the vcluster, `kubectl logs ... --previous` (solution
   and alternative) returned no ERROR line, so line 1 of the report held `BackOff`. Check
   whether the previous instance's log is reachable through vcluster (try
   `kubectl logs <pod> -c printer --previous` vs. `deploy/...`), and if not, make the
   script crash after a sleep so `--previous` has content, or read the line from the
   current crash; then re-verify.
2. Verify the remaining virtual-cluster labs and exam tasks (pod slot, `--parallel 3`).
3. When the machine is less loaded (blocker 1), verify the kubeadm labs one at a time
   (`--parallel 1`), starting with telemetry-daemonset and affinity-cold-chain.
4. After foundations' add-ons merge: switch image refs if needed, verify the 17
   add-on labs, clear their notes.
5. Once main has the exam engine: `labctl exam run --auto-solve` (expect 100 %) and
   `--no-solve` (expect fail) on sim-k8s-admin; sim-platform-engineer needs other
   streams' tasks first.
6. Merge main regularly; re-render `docs/curriculum.md` (`node tools/curriculum/render.mjs`).

## Platform blockers and bugs

1. **kubeadm init has no retry and fails under load** (bug). With host load 80-95 on 12
   cores, `kubeadm init` on the control-plane VM failed with `error execution phase
   wait-control-plane: ... unable to create ClusterRoleBinding: ... context deadline
   exceeded` (`/var/log/kubeadm.log` on fleet-cp-1, session
   ctv-telemetry-daemonset-aa51b88). cloud-init then stops (`set -e`), the CNI is never
   installed, controller-manager/scheduler loop on lost leader election, and the session
   waits until the provision timeout. Workers retry `kubeadm join` five times; the
   control plane does not retry `init` (`internal/drivers/kubeadm.go`, userdata). Every
   K-tier verify in this session failed this way.
2. The manager's default `--provision-timeout=15m` is too short for kubeadm sessions on
   a loaded machine. Fixed: `PROVISION_TIMEOUT=40m bash deploy/scripts/orchestrator-deploy.sh`
   (also works with `task dev:orchestrator`); bug 1 is fixed too (bounded `kubeadm init`
   retry with reset, longer kubeadm timeouts).
3. lab-verify could not accept `ct-platform:*` objectives (declared only in
   content/curriculum.yaml, which forbids redeclaring them under content/frameworks).
   Fixed in this branch (`tools/lab-verify/src/verify.mjs`, commit f7ef682).
4. lab-verify's image scan treats any `image:` text in shell scripts as a Pod image
   (e.g. a `grep 'image: ...'` or a sed), and does not recognise digest references
   (`httpd@sha256:...`) of catalog workload images. Worked around in content.
5. The exam-task lab-verify rules (no hints / no course for `type: exam`) came from
   build/k8s-dev; the same change is applied here so both merge cleanly.
6. A full sim-k8s-admin draw needs up to 7 kubeadm clusters (about 16 VMs) in one
   shared environment; check that against machine capacity before exam runs.

## Gotchas and lessons

- Never point `labctl verify` at the whole labs directory while authoring: it parses
  every lab and one half-written file fails the run. `v.sh` passes the single lab dir.
- Never edit a shell script that a running bash is executing (my old `v.sh` broke this
  way); copy to a new file.
- `{{...}}` anywhere in a lab (including inlined assets) is a param placeholder: Helm
  templates and Go templates must be generated (e.g. `<% %>` converted in setup).
- `kubectl get -o json` hides managedFields; use `--show-managed-fields`.
- Go RE2: no backreferences in `expect.regex`.
- yq (mikefarah) has no `\(...)` interpolation; convert with `yq -o=json` and use jq.
- jq/yq exist in the admin sidecar (jumphost image) but not on kubeadm nodes; checks
  with `on: <cluster>/<node>` use only coreutils, crictl, kubectl.
- Exam tasks: one canonical node definition per cluster name per exam (generated by
  `topo.py` in my scratch; see the shared blocks in any xka-* lab), task-specific
  namespaces, no context checks; tasks that break a control plane get their own cluster.
- Checks that compare a learner's file with live cluster state run on the workstation
  with the learner's kubeconfig (`--context <name>`), since the admin sidecar cannot
  read the node container's files.

## How to resume

```sh
cd /home/hackrvl/cloudtrain/.worktrees/b-k8s-admin
git pull && git merge main
pnpm install --filter @cloudtrain/lab-verify... --offline && (cd packages/lab-schema && pnpm run build)
(cd services/lab-orchestrator && make build)
# scoped manager (CRDs unchanged: diff first, then SKIP_CRDS=1)
ORCH_NAMESPACE=ct-k8sadmin-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=k8s-admin \
  SKIP_CRDS=1 LOAD_LAB_IMAGES=0 PROVISION_TIMEOUT=40m bash deploy/scripts/orchestrator-deploy.sh
# one lab (vm slot for kubeadm, pod slot for vcluster)
cd services/lab-orchestrator
../../tools/slots/run.sh pod -- bin/labctl verify --context kind-cloudtrain-dev --repo-root ../.. \
  --session-label labs.cloudtrain.dev/verify=k8s-admin --only <lab> --parallel 3 ../../content/packs/kubernetes/labs/<lab>
../../tools/slots/run.sh vm -- bin/labctl verify ... --parallel 1 --ready-timeout 45m ../../content/packs/kubernetes/labs/<lab>
```

Before each VM verify check C: free space
(`powershell.exe -NoProfile -Command "[int]((Get-PSDrive C).Free/1GB)"`, stop under 15 GB).
After a pass: set the lab's status line to `verified` in content/curriculum.yaml (only
this stream's labs), re-render docs/curriculum.md, commit (the post-commit hook pushes).
Teardown at the end: delete `ct-k8sadmin-system` and ClusterRoleBinding
`lab-orchestrator-ct-k8sadmin-system`.
