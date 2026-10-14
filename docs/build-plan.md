# Curriculum build plan

The curriculum in `content/curriculum.yaml` was approved on 2026-10-14, with two
requested changes: containers should focus on Docker more than Podman, and IaC on
Terraform more than OpenTofu. This plan turns it into verified labs and working
exam simulations. Progress is tracked in `docs/tracker.md` (platform) and in each
lab's `status` in `content/curriculum.yaml` (`proposed` -> `built` -> `verified`).

## Definition of done for a lab

1. `content/packs/<pack>/labs/<lab-id>/lab.yaml` (+ `assets/`), original scenario,
   fictional names, skills and frameworks as in the curriculum.
2. `node tools/lab-verify/bin/lab-verify.mjs --strict` and `labctl validate` clean.
3. `labctl verify` passes live on `kind-cloudtrain-dev`: checks fail before the
   solution, pass after it, every mutation fails its `expectFail` checks,
   alternatives pass, two seeds, teardown clean. Report in
   `deploy/.results/verify/<lab-id>.json`.
4. The lab's `status` in `content/curriculum.yaml` is set to `verified` (only after
   step 3), or `built` with a note when a platform prerequisite blocks step 3.

An exam task is a lab of `type: exam` and meets the same bar.

## Shared machine rules

- Heavy work goes through `tools/slots/run.sh`: `vm` (2 slots) for anything that
  boots lab VMs, `build` (1 slot) for VM image builds, `pod` (4 slots) for
  pod/vcluster-only verification.
- Each agent runs its own orchestrator manager scoped with `ORCH_NAMESPACE` and
  `SESSION_SELECTOR` (see `deploy/scripts/orchestrator-deploy.sh`), never an
  unscoped one. `kubectl diff` before applying any CRD; apply only additions.
- Never change the global kube current-context; never touch the user's other
  containers or clusters.
- Commit after every lab; the post-commit hook pushes.
- Edit only your own labs' `status` lines in `content/curriculum.yaml`.

## Waves

| Wave | Stream | Scope | Needs |
|---|---|---|---|
| 1 | platform-api, platform-web | SSO, roles, Postgres, role views (resume) | Docker |
| 1 | curriculum-revision | Docker-first containers domain, Terraform-first IaC domain | |
| 1 | exam-engine | Exam simulation mode in the orchestrator, `labctl exam`, then gateway + web | platform-api for persistence |
| 1 | foundations | Lab images and runtime tiers: Linux pod images (tier A, user namespaces), Linux VM images (tier C: AlmaLinux 10, Ubuntu 24.04), Kata in kind (tier B) spike, offline registry mirror, kubeadm extras (metrics-server, ingress, Gateway API, LB, provisioner), dev:up auto-heal for expired KubeVirt certs | build slot |
| 1 | k8s-admin, k8s-dev, k8s-sec | Kubernetes paths + their exam pools | kubeadm/vcluster tiers (ready) |
| 1 | networking | Networking paths + exam pool | netdev tier (ready) |
| 1 | linux-a | Linux labs on tier A (unprivileged pods) | own pod image |
| 2 | linux-bc | Linux labs on tiers B and C | foundations |
| 2 | containers | Docker-first paths + exam pool | revision, dockerd images |
| 2 | iac | Terraform-first paths + exam pools | revision, tf workstation images |
| 2 | automation | Ansible paths + exam pool | managed-node images |
| 3 | studio, tutor | Scenario Studio generation, AI tutor | exam engine, AI data policy |
