# Handoff: k8s-sec stream (cluster-security path + sim-k8s-security pool)

Round 3 (2026-10-16/17, branch `content/k8s-dev-sec-round-3`, merged into main):
every V-tier lab of the stream is now live-verified (12 of 51). Everything left is
kubeadm (K tier, vm slot): 27 built and 12 blocked on security tooling. The
sim-k8s-security exam (envTier K) cannot run yet: verified pools cover cluster-hardening
(2/4) and microservice-vulnerabilities (3/6) only; cluster-setup and system-hardening
have no verified task.

All 51 owned labs are authored in `content/packs/kubernetes/labs/<id>/`, pass
`lab-verify --strict` and `labctl validate`, and are listed in
`content/curriculum.yaml` (status `built`, or `verified` after a passing live run).
Course `k8s-cluster-security` in `content/packs/kubernetes/pack.yaml` lists the
21 learning labs in path order. Exam tasks are tagged `exam` (no hints, no
`k8s-context` checks, not in a course).

## Status

### Verified live (`labctl verify`, full cycle, clean teardown)

| Lab | Tier | Verify time |
|---|---|---|
| rbac-overgrant-cleanup | V | 679 s |
| static-analysis-manifests | V | 580 s |
| sa-token-automount-off | V | 707 s (round 3) |
| immutable-label-printers | V | 874 s (round 3; writable-mounts expected `{{spool}},/tmp`, jq sorts `/tmp` first) |
| xks-rbac-reduce | V | 367 s (round 3) |
| xks-sa-automount | V | 434 s |
| xks-immutable-secret | V | 572 s |
| xks-drop-privileged | V | 692 s (starts from Pods refused by the host baseline PSA) |
| xks-pss-restricted | V | 556 s |
| xks-readonly-rootfs | V | 500 s |
| xks-registry-vap | V | 580 s |
| xks-manifest-static-fix | V | 555 s |

### Built, live verify ran and failed; lab fixed since, needs a re-run

| Lab | Failure | Fix (committed) |
|---|---|---|
| customs-default-deny | `--quick` base run passed (setup, before 3/8, after 8/8); the full run failed because both sessions hit the 15 min provision timeout under machine load (loadavg 70-110) | nothing to fix in the lab; re-run when the machine is quieter |

### Built, ready for live verify (runs on existing images: kubeadm:1.37 or vcluster)

Learning labs: verify-kubectl-checksum, api-access-restrict, node-footprint-reduce,
kubelet-auth-hardening, seccomp-apparmor-printer, hostpath-mount-policy,
secrets-encryption-at-rest, mtls-cni-encryption, tariff-secret-audit, intrusion-timeline.

Exam tasks (K, qm-ledger): xks-default-deny-ns, xks-metadata-egress-block,
xks-incident-isolate-pod, xks-apiserver-anonymous, xks-node-restriction,
xks-audit-policy-secrets, xks-audit-log-reader, xks-encryption-config,
xks-kubelet-webhook-authz, xks-cis-kubelet-fix, xks-apparmor-profile-pod,
xks-seccomp-localhost, xks-remove-service-port, xks-runtime-alert-scale,
xks-wireguard-cni. Workstation only: xks-dockerfile-hardening (checks tested locally
against the solution and every mutation in the jumphost image).

### Built, blocked on platform prerequisites (status `built` + `notes` in the curriculum)

| Lab | Missing |
|---|---|
| ingress-tls-tracking, xks-ingress-tls-secret | Ingress controller (IngressClass `nginx`, ingress-nginx controller Service) in the kubeadm image |
| cis-apiserver-findings | kube-bench on the nodes |
| falco-shell-in-container, xks-detection-rule-output | Falco as a systemd service (`falco*`) on the nodes |
| gvisor-runtimeclass, xks-runtimeclass-move | gVisor `runsc` + containerd `runsc` handler |
| sbom-dispatch-image, xks-sbom-spdx | Trivy (offline DB) on the nodes |
| xks-scan-pick-image | Trivy offline DB; setup needs 1-3 of the 4 workload images to have CRITICAL findings |
| waybill-image-slim-scan | buildah, Trivy, offline `registry.quillmoor.example/mirror/golang:1.25` and `.../base/static-nonroot:2026.10` |
| xks-signature-verify | cosign plus pre-signed OCI layouts `/opt/qm-signing/parcel-api-{blue,green,amber}` and `release.pub`, images loaded on every node |

These labs reference `kubeadm:1.37` (so lab-verify passes; `kubeadm:1.37-sec` is not
in the catalog) and fail setup with `prerequisite missing: ...`. When
`kubeadm:1.37-sec` lands, switch the image ref (for exam tasks: in all K-tier `xks-*`
labs at once, the topology must stay identical) and check the tool contracts the
setup assumes (paths, service names, CLI flags) against what was actually installed.

### Not started

None. (`kiosk-restricted-pss`, `registry-allowlist-vap`, `netpol-namespace-port` in the
path belong to other streams.)

## In flight

Nothing. Round 3 used the scoped manager `ct-k8sdevsec-system` (selector
`labs.cloudtrain.dev/verify=k8s-devsec`, shared with k8s-dev). All V-tier k8s-query
checks now set `timeoutSec: 20` (grader default 5 s timed out under load).

## Next steps, in order

1. Done in round 3: the whole V-tier queue is verified.
2. K-tier labs, one at a time in the vm slot, starting with customs-default-deny; check
   C: free space first (stop under 15 GB). Watch for the 15 min provision timeout under load.
3. Highest-risk K labs to watch on first run: api-access-restrict (baseline uses a
   secondary address 192.168.100.200 on ledger/dispatch worker as an outside source; if
   Kube-OVN drops it, setup fails at the baseline step: redesign the outsider test),
   the `AuthenticationConfiguration` `apiserver.config.k8s.io/v1` with
   `anonymous.conditions` (api-access-restrict, xks-apiserver-anonymous; fall back to
   v1beta1 if v1 rejects it), Calico WireGuard (`felixconfigurations ... default` must
   exist), and intrusion-timeline (largest setup).
4. When main has the exam engine: `labctl exam compile` for sim-k8s-security, then
   `labctl exam run --auto-solve` (expect 100 %) and `--no-solve` (expect fail).
5. Re-render `docs/curriculum.md` (`node tools/curriculum/render.mjs`) after status changes.

## Platform blockers and bugs found

- Security node image (`kubeadm:1.37-sec`) and an Ingress controller are missing (table above).
- Fixed (platform round 3): `PROVISION_TIMEOUT=40m` for orchestrator-deploy.sh, and
  `kubeadm init` is retried. Was: controller `DefaultProvisionTimeout` is a fixed 15 min with no
  deploy option; under machine load (loadavg 70-110) kubeadm clusters did not bootstrap in
  time and verify sessions failed as `nodes not ready after 15m0s`.
- `orchestrator-deploy.sh` with `LOAD_LAB_IMAGES=1` aborted on `kind load busybox:1.37`
  ("content digest ... not found") although the image was already on the nodes under a
  different image ID (multi-platform image); work-around `LOAD_LAB_IMAGES=0`.
- Fixed (platform round 3): vcluster host namespaces enforce Pod Security `baseline`, so a
  learner Pod in a `mode: virtual` cluster can no longer be privileged or mount hostPath
  (it stays Pending with a SyncError). xks-drop-privileged therefore starts from refused
  Pods; its setup no longer waits for the rollout.
- lab-verify had no notion of exam tasks: it warned "no hints" and "not in any course" for
  them, which fails `--strict`. Changed (tools/lab-verify/src/verify.mjs): labs tagged
  `exam` must have no hints and must not be in a course.

## Gotchas and lessons

- The grader's shell checks run under `sh` (dash): `echo "$json" | jq` mangles `\n`;
  use `printf '%s'`.
- After a rollout, old Pods stay in phase Running with a deletionTimestamp for the grace
  period (busybox loops ignore SIGTERM): filter them out in Pod checks.
- `UID` is a read-only bash variable; do not source files that set it.
- Go RE2: no backreferences in `expect.regex`.
- Plain YAML scalars containing `` `x: y` `` need quoting.
- `--anonymous-auth=false` also breaks the kubelet's unauthenticated `/livez` probes; the
  labs teach `AuthenticationConfiguration` with `anonymous.conditions` for health paths.
- `/etc/nftables.conf` starts with `flush ruleset`, which would wipe Calico/kube-proxy
  rules; labs use a separate `inet` table and never flush.
- Kubeadm nodes (Ubuntu 24.04) already have apparmor_parser, nft, tcpdump, python3 with
  PyYAML, jq, curl, dpkg-deb and the WireGuard module; jumphost has yq, jq, nc, openssl,
  mawk but no python3.
- Canonical sim-k8s-security topology (all `xks-*`): `workstation` (jumphost:1),
  `qm-ledger` kubeadm (ledger-cp-1 tainted, ledger-wk-1, ledger-wk-2, `access: [ssh]`),
  `qm-depot` virtual v1.37. Node-level tasks are spread: kubelet webhook on ledger-wk-1,
  CIS kubelet fix and service removal on ledger-wk-2.
- The scratchpad is shared between agents: keep everything under `scratchpad/k8s-sec/`.

## How to resume

```bash
cd /home/hackrvl/cloudtrain/.worktrees/b-k8s-sec
git pull && git merge main
(cd packages/lab-schema && pnpm run build)          # lab-verify needs the built schema
(cd services/lab-orchestrator && go build -o bin/labctl ./cmd/labctl)
node tools/lab-verify/bin/lab-verify.mjs --strict

# scoped manager (never unscoped; CRDs untouched)
ORCH_NAMESPACE=ct-k8ssec-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=k8s-sec \
  SKIP_CRDS=1 LOAD_LAB_IMAGES=0 bash deploy/scripts/orchestrator-deploy.sh

# one verify (vm slot for kubeadm labs, pod slot for vcluster-only)
powershell.exe -NoProfile -Command "[int]((Get-PSDrive C).Free/1GB)"   # stop under 15
tools/slots/run.sh pod -- services/lab-orchestrator/bin/labctl verify \
  --context kind-cloudtrain-dev --session-label labs.cloudtrain.dev/verify=k8s-sec \
  --parallel 2 content/packs/kubernetes/labs/<lab>
```

Helper scripts used during the session (copy them if the scratchpad is gone):
`scratchpad/k8s-sec/v.sh` (disk check + slot + labctl), `queue.sh` (sequential list),
`setstatus.py <lab> <status> [note]` (edits only that lab's status/notes lines),
`mark-verified.sh <lab> <seconds>` (status + lab-verify + commit).
