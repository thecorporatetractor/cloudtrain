# Handoff: k8s-dev stream (application-developer path + sim-k8s-developer exam)

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

**k8s-dev in round 4: 33 -> 33 verified.** No vm-slot time went to the k8s-dev K labs.
`xkd-ingress-path` and `xkd-top-memory-report` are unblocked on paper (`kubeadm:1.37-full` plus
`addons-install` in setup); every xkd K task uses `kubeadm:1.37-full` (shared qm-yard).
buildah is still missing (build-waybill-image, xkd-build-tag-image).


Round 3 (2026-10-16/17, branch `content/k8s-dev-sec-round-3`, merged into main):
every V-tier lab of the stream is live-verified under the vcluster Pod Security
baseline; 33 of 42 owned labs are verified. The 9 left are kubeadm (K) labs: 5 wait
for a vm-slot verify, 4 are blocked on node add-ons. The sim-k8s-developer exam ran
live on a V-only draw (seed 215, all 16 tasks): auto-solve 100 % (passed), no-solve
14.5 % (failed), clean teardown (`deploy/.results/exams/sim-k8s-developer-*.json`).
Compiling the exam from verified labs only works: every objective's verified pool
covers its draw (design-build 3/6, deployment 6/6, observability 5/6, config 8/8,
networking 3/6).

## Status per lab

The source of truth is each lab's `status`/`notes` in `content/curriculum.yaml`.
"built" means authored and statically clean; live verify has not passed yet.

### Learning labs (path application-developer, in path order)

| Lab | Tier | Status | Notes |
|---|---|---|---|
| build-waybill-image | K | **verified** | buildah on the kubeadm node image (2026-10-19) |
| ledger-export-cronjob | V | **verified** | 7 runs, 613 s |
| parallel-manifest-job | V | **verified** | 6 runs, 747 s |
| tariff-cache-statefulset | K | built | uses pre-provisioned local PVs + no-provisioner StorageClass, so no dynamic provisioner is needed; vm-slot verify pending |
| quote-engine-canary | V | **verified** | 1351 s (cluster under load) |
| blue-green-cutover | V | **verified** | 813 s |
| migrate-deprecated-apis | V | **verified** | 458 s |
| app-serviceaccount-api | V | **verified** | 7 runs, 794 s (finished during wrap-up) |
| kiosk-restricted-pss | V | **verified** | round 3 (pods-compliant check fixed) |
| registry-allowlist-vap | V | **verified** | round 3 |

### Exam tasks (sim-k8s-developer)

Round 3: every V task below is **verified**; the K tasks are `built`.

| Pool | Task | Tier | Blocker |
|---|---|---|---|
| design-build | xkd-cronjob-cleanup | V | |
| design-build | xkd-job-completions | V | |
| design-build | xkd-init-container-seed | V | |
| design-build | xkd-build-tag-image | K | none (buildah on the node image since 2026-10-19) |
| design-build | xkd-pvc-mount-pod | K | none (static PV in class `yard-notes`) |
| design-build | xkd-workload-kind-choice | K | |
| deployment | xkd-canary-share | V | |
| deployment | xkd-bluegreen-switch | V | |
| deployment | xkd-rolling-strategy | V | |
| deployment | xkd-helm-upgrade-rollback | V | |
| deployment | xkd-kustomize-image-tag | V | |
| deployment | xkd-scale-and-pause | V | |
| observability | xkd-readiness-http | V | |
| observability | xkd-liveness-exec-fix | V | |
| observability | xkd-deprecated-manifest | V | |
| observability | xkd-logs-container-select | V | |
| observability | xkd-top-memory-report | K | **metrics-server** on kubeadm |
| observability | xkd-debug-distroless | V | (watch: ephemeral containers through vcluster) |
| config-security | xkd-configmap-volume | V | |
| config-security | xkd-secret-env-from | V | |
| config-security | xkd-security-context-user | V | |
| config-security | xkd-requests-limits | V | |
| config-security | xkd-quota-namespace | V | |
| config-security | xkd-serviceaccount-pod | V | |
| config-security | xkd-role-configmaps | V | |
| config-security | xkd-custom-resource-create | V | |
| services-networking | xkd-clusterip-expose | V | |
| services-networking | xkd-service-port-fix | V | |
| services-networking | xkd-named-port-service | V | |
| services-networking | xkd-netpol-allow-frontend | K | none (Calico in image; setup self-tests enforcement) |
| services-networking | xkd-nodeport-expose | K | |
| services-networking | xkd-ingress-path | K | **ingress controller** with a default IngressClass on kubeadm |

How the exam tasks are designed, following the exam-engine contract:
- Each task names its context (or host) in the statement, has no `k8s-context` check, no hints, and grades end state with admin credentials.
- They use one canonical topology. `workstation` (jumphost:1); `qm-dispatch` and `qm-depot` (virtual, v1.37; design-build, deployment and observability tasks on `qm-dispatch`, config-security and networking on `qm-depot`); `qm-yard` (kubeadm:1.37, v1.37.1: yard-cp-1 tainted, yard-wk-1, yard-wk-2). Each node is byte-identical in every task.
- Each task owns its namespaces (33, none shared) and its answer files (`/home/learner/answers/<task-specific>.txt`, `~/exam/`, `~/manifests/`, `~/charts/`, `~/parcel-api/`).
- Cluster-scoped objects are unique per task: the `deliverywindows.logistics.quillmoor.example` CRD, and the `yard-notes` StorageClass and its PV.
- `rebootBeforeGrade` is false for this exam, so no state needs to survive a reboot.

## In flight

Nothing. The round-3 scoped manager (namespace `ct-k8sdevsec-system`, selector
`labs.cloudtrain.dev/verify=k8s-devsec`, shared with k8s-sec) has been deleted,
with its ClusterRole/Binding. Deploy a new one before the next verify ("How to
resume").

## Round 3 lab fixes (all re-verified)

- xkd-job-completions: the parallel-six mutation only fails `shape` (a Job without
  completions is a work queue; all 6 Pods succeed).
- xkd-canary-share: EndpointSlices keep Pods whose named port does not resolve in a
  slice without ports; the share check counts only slices that carry ports.
- xkd-init-container-seed (and xkd-pvc-mount-pod): `printf '%s'` instead of `echo`
  before jq (dash expands `\n`).
- xkd-debug-distroless: `kubectl debug` defaults to the `general` profile, which adds
  SYS_PTRACE. The vcluster API accepts that ephemeral container, the host namespace's
  baseline PSA refuses it, so it never starts, and as ephemeral containers cannot be
  removed every later one is blocked too (the whole ephemeral-container sync fails).
  Setup now installs a namespace-scoped ValidatingAdmissionPolicy
  (`xkd-debug-distroless-baseline`) that refuses capability-adding debug containers
  with a clear message; statement names the baseline level; solution uses
  `--profile=baseline`; new misconception `default-profile`.
- kiosk-restricted-pss: `pods-compliant` dry-ran the enforce label with its current
  value; PSA only re-checks running Pods when the enforce level or version changes,
  so it always passed. The dry run now flips the version (latest <-> v1.37).
- Every k8s-query check of the V labs has `timeoutSec: 20` (the grader default of 5 s
  timed out under loadavg 70-120).

## Next steps, in order

1. Deploy a scoped manager (see "How to resume"; the round-3 one is gone).
2. Done in round 3: all V learning labs and the 25 V exam tasks.
3. Run the exam through the gateway smoke (`exam-smoke.mjs --exam sim-k8s-developer --no-solve`).
4. Check that C: has at least 15 GB free, then verify the K labs with the vm slot: tariff-cache-statefulset, xkd-pvc-mount-pod, xkd-workload-kind-choice, xkd-netpol-allow-frontend, xkd-nodeport-expose.
5. Once foundations ships the kubeadm extras, re-check the blocked labs: build-waybill-image and xkd-build-tag-image (buildah), xkd-top-memory-report (metrics-server), xkd-ingress-path (ingress controller + default IngressClass). Update the setup comments if the tool names differ.
6. Done for the V-only draw (seed 215; `labctl exam draw --seed 215` shows it). Draws with K tasks need the K labs verified first and a vm slot.
7. After any status change: `node tools/curriculum/render.mjs`, then commit.

## Platform blockers

- Resolved 2026-10-19: kubeadm images ship `buildah`, so build-waybill-image and xkd-build-tag-image run. `oci-registry:3`, listed for build-waybill-image in the curriculum, is not in the catalog; the lab was designed so that it does not need a registry (OCI archive, then `ctr import`, then `imagePullPolicy: Never`).
- No metrics-server on kubeadm clusters, which blocks xkd-top-memory-report.
- No ingress controller or default IngressClass on kubeadm, which blocks xkd-ingress-path.
- workloadImages is limited to busybox, httpd (2.4 and 2.4-alpine), redis and caddy. Tasks that call for "tag 2.7" or "3.4" images were adapted: httpd:2.4-alpine to httpd:2.4, and a non-pullable `registry.quillmoor.example/...` image where only the spec is graded (kustomize).

## Platform bugs and inconsistencies found

1. **Fixed (platform round 3): shell checks now default to 30 s.** Was: **the grader's default check timeout is 5 s.** Shell checks that make several kubectl calls against a vcluster time out under load ("check timed out"; quote-engine-canary seed 1). Every multi-call shell check now sets `timeoutSec: 30`. A longer default for shell checks would be safer.
2. **`file.source` assets are template-expanded by labctl.** The schema says they are copied verbatim, but `labctl validate` reports Helm's `{{ .Values.x }}` in an asset as an undefined param. Workaround in xkd-helm-upgrade-rollback: write `[[ ]]` delimiters and sed them to braces in setup.
3. **orchestrator-deploy.sh dies on a failing `kind load`** (busybox:1.37 whose local Docker ID differs from the one on the node: "content digest not found"), even though the image is already on the nodes by tag. Workaround: `LOAD_LAB_IMAGES=0`.
4. **The schema has no `type: exam`**; exam-ness lives only in curriculum.yaml. lab-verify now reads it (commit e2aff0c and earlier): exam tasks must not have hints and need no course.
5. **The scratchpad directory is shared between agents** (same session path). Another stream overwrote my `v.sh`, `setstatus.py` and `queue.log`, which made a queue of verifies fail instantly. My scripts now live in `scratchpad/k8sdev/`.
6. **Fixed (platform round 4): k8s-query, k8s-can-i and k8s-context checks default to 20 s.** Was: **Round 3: k8s-query checks still default to 5 s.** Under load single queries time out (xkd-bluegreen-switch, xkd-init-container-seed). Lab-side: `timeoutSec: 20`. Platform: raise `grader.DefaultTimeout` too.
7. **Fixed (platform round 4): every vcluster gets the ValidatingAdmissionPolicy `cloudtrain-ephemeral-pod-security`**, so `kubectl debug` with the default profile is refused at once with `... must not add capabilities ... use --profile=baseline` and the Pod stays debuggable; xkd-debug-distroless's own namespace-scoped policy is now redundant (harmless). Was: **Round 3: baseline PSA vs `kubectl debug`.** The vcluster accepts ephemeral containers that the host namespace's baseline refuses (the default `general` profile adds SYS_PTRACE); the Pod is then stuck because no later ephemeral container syncs either. Learners get no error. Platform options: install a VAP like xkd-debug-distroless's in every vcluster, or let the syncer surface the SyncError as a Pod event. Labs or exams that use `kubectl debug` in other streams hit the same trap; k8s-admin's distroless-invoice-debug (written and verified live in round 5 wave 1) uses `--profile=baseline`.
8. **Round 3: editing a running bash script breaks it.** (Agent-side.) Two verifies died with `command not found` after the queue's v.sh was edited mid-run; write a new file instead.
9. **Round 3: a WSL restart (2026-10-17 02:30) killed in-flight verifies** with websocket 1006 / connection refused; nothing lab-related, re-run.

## Gotchas and lessons

- Quote every YAML value that contains `{{param}}` or `: ` inside flow maps or feedback strings.
- RE2 has no backreferences; lab-verify catches them.
- Busybox httpd ignores SIGTERM, so set `terminationGracePeriodSeconds: 2` in setup, or rollout checks see terminating Pods. Filter `deletionTimestamp == null` with jq.
- `kubectl create cronjob/job` names the container after the object, so rename it with yq when the task fixes the container name.
- Go's `flag` stops at the first positional argument: pass `--repo-root` and every other labctl flag before the lab path.
- A vcluster verify takes 7-12 min (two seeds plus mutations plus alternatives), and up to 22 min when the machine is busy.

## How to resume

```bash
cd /home/hackrvl/cloudtrain/.worktrees/b-k8s-dev
git pull --ff-only && git merge main
pnpm install --frozen-lockfile && pnpm --filter @cloudtrain/lab-schema build
go build -o services/lab-orchestrator/bin/labctl ./services/lab-orchestrator/cmd/labctl
kubectl --context kind-cloudtrain-dev diff -f <(kubectl kustomize services/lab-orchestrator/config/crd)   # CRD additions only
LOAD_LAB_IMAGES=0 SKIP_CRDS=1 ORCH_NAMESPACE=ct-k8sdev-system \
  SESSION_SELECTOR=labs.cloudtrain.dev/verify=k8s-dev bash deploy/scripts/orchestrator-deploy.sh
# one lab (pod slot for vcluster labs, vm slot for kubeadm labs; check C: >= 15 GB first)
tools/slots/run.sh pod -- services/lab-orchestrator/bin/labctl verify --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=k8s-dev --repo-root "$PWD" "$PWD/content/packs/kubernetes/labs/<lab>"
node tools/lab-verify/bin/lab-verify.mjs --strict
```

Always pass `--context kind-cloudtrain-dev`; never change the current context.
