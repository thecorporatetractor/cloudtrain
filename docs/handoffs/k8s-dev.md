# Handoff: k8s-dev stream (application-developer path + sim-k8s-developer exam)

Branch `build/k8s-dev`, worktree `/home/hackrvl/cloudtrain/.worktrees/b-k8s-dev`.
Paused 2026-10-14 on coordinator request. All 42 owned labs are authored and pass
`lab-verify --strict` and `labctl validate`. 6 are live-verified.

## Status per lab

The source of truth is each lab's `status`/`notes` in `content/curriculum.yaml`.
"built" means authored and statically clean; live verify has not passed yet.

### Learning labs (path application-developer, in path order)

| Lab | Tier | Status | Notes |
|---|---|---|---|
| build-waybill-image | K | built, **blocked** | kubeadm:1.37 node image has no build tool; needs `buildah` |
| ledger-export-cronjob | V | **verified** | 7 runs, 613 s |
| parallel-manifest-job | V | **verified** | 6 runs, 747 s |
| tariff-cache-statefulset | K | built | uses pre-provisioned local PVs + no-provisioner StorageClass, so no dynamic provisioner is needed; vm-slot verify pending |
| quote-engine-canary | V | **verified** | 1351 s (cluster under load) |
| blue-green-cutover | V | **verified** | 813 s |
| migrate-deprecated-apis | V | **verified** | 458 s |
| app-serviceaccount-api | V | **verified** | 7 runs, 794 s (finished during wrap-up) |
| kiosk-restricted-pss | V | built | verify not started |
| registry-allowlist-vap | V | built | verify not started |

### Exam tasks (sim-k8s-developer), all `built`, no live verify yet

| Pool | Task | Tier | Blocker |
|---|---|---|---|
| design-build | xkd-cronjob-cleanup | V | |
| design-build | xkd-job-completions | V | |
| design-build | xkd-init-container-seed | V | |
| design-build | xkd-build-tag-image | K | **buildah** on the kubeadm node image |
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

## In flight / partial at the pause

- The app-serviceaccount-api verify finished during wrap-up and passed. Nothing else is running.
- No lab is half-written.

## Next steps, in order

1. Redeploy the scoped manager (see "Resume").
2. Verify the V learning labs: kiosk-restricted-pss, registry-allowlist-vap.
3. Verify the 25 V exam tasks with the pod slot, one at a time.
4. Check that C: has at least 15 GB free, then verify the K labs with the vm slot: tariff-cache-statefulset, xkd-pvc-mount-pod, xkd-workload-kind-choice, xkd-netpol-allow-frontend, xkd-nodeport-expose.
5. Once foundations ships the kubeadm extras, re-check the blocked labs: build-waybill-image and xkd-build-tag-image (buildah), xkd-top-memory-report (metrics-server), xkd-ingress-path (ingress controller + default IngressClass). Update the setup comments if the tool names differ.
6. Once the exam engine is on main: `git merge main`, then `labctl exam compile` for sim-k8s-developer, then `labctl exam run --auto-solve` (expect 100 %) and `labctl exam run --no-solve` (expect fail).
7. After any status change: `node tools/curriculum/render.mjs`, then commit.

## Platform blockers

- kubeadm:1.37 has no image build tool (`buildah`), which blocks build-waybill-image and xkd-build-tag-image. `oci-registry:3`, listed for build-waybill-image in the curriculum, is not in the catalog; the lab was designed so that it does not need a registry (OCI archive, then `ctr import`, then `imagePullPolicy: Never`).
- No metrics-server on kubeadm clusters, which blocks xkd-top-memory-report.
- No ingress controller or default IngressClass on kubeadm, which blocks xkd-ingress-path.
- workloadImages is limited to busybox, httpd (2.4 and 2.4-alpine), redis and caddy. Tasks that call for "tag 2.7" or "3.4" images were adapted: httpd:2.4-alpine to httpd:2.4, and a non-pullable `registry.quillmoor.example/...` image where only the spec is graded (kustomize).

## Platform bugs and inconsistencies found

1. **Fixed (platform round 3): shell checks now default to 30 s.** Was: **the grader's default check timeout is 5 s.** Shell checks that make several kubectl calls against a vcluster time out under load ("check timed out"; quote-engine-canary seed 1). Every multi-call shell check now sets `timeoutSec: 30`. A longer default for shell checks would be safer.
2. **`file.source` assets are template-expanded by labctl.** The schema says they are copied verbatim, but `labctl validate` reports Helm's `{{ .Values.x }}` in an asset as an undefined param. Workaround in xkd-helm-upgrade-rollback: write `[[ ]]` delimiters and sed them to braces in setup.
3. **orchestrator-deploy.sh dies on a failing `kind load`** (busybox:1.37 whose local Docker ID differs from the one on the node: "content digest not found"), even though the image is already on the nodes by tag. Workaround: `LOAD_LAB_IMAGES=0`.
4. **The schema has no `type: exam`**; exam-ness lives only in curriculum.yaml. lab-verify now reads it (commit e2aff0c and earlier): exam tasks must not have hints and need no course.
5. **The scratchpad directory is shared between agents** (same session path). Another stream overwrote my `v.sh`, `setstatus.py` and `queue.log`, which made a queue of verifies fail instantly. My scripts now live in `scratchpad/k8sdev/`.

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
