# Foundations stream: handoff (round 3, 2026-10-17)

Round 3 on branch `feat/foundations-round-3` (merged). Nothing is running, no slot is held,
test namespaces are deleted. Round 3 results are in "Round 3" below; the table is current.

## What exists now

| Area | Catalog ref(s) | Image | Status |
|---|---|---|---|
| dev:up auto-heal | n/a | `deploy/scripts/heal-virt-certs.sh`, `task dev:heal-certs`, called by `dev:up` before KubeVirt | **verified**: check 3 s on a healthy cluster, forced repair (`FORCE=1`) 50 s; detection proven against real expiring certs (`MIN_VALID=90000 --list-expired`). Not yet seen against a real >24 h stop. |
| kubeadm upgrade image | `kubeadm:1.36` | `cloudtrain/kubeadm-node:v1.36-upgrade` (4.51 GB) | **verified**: packaged (`PACKAGE_ONLY=1`, 251 s), boot-test PASSED (794 s). REPORT: `kubeadm upgrade plan` exit 0 and `kubeadm upgrade plan v1.37.1` exit 0 offline; installing the kubelet package **restarts kubelet** (node still reports v1.36.5 until the learner upgrades the config and restarts). |
| Tier A, EL | `el-lab:10` | `cloudtrain/el-lab:10` (955 MB) | **built + smoke-tested** in a `hostUsers: false` pod (Ready in 9-11 s; uid_map `0 1256194048 65536`; tini PID 1 reaps zombies; learner has no sudo; man pages; sshd and strace work). Loaded into both kind nodes. Not yet run through the orchestrator end to end. |
| Tier A, Debian | `deb-lab:24.04` | `cloudtrain/deb-lab:24.04` (896 MB) | **verified**: built from the local noble mirror (the apt exit 100 was man-db's postinst: the minimized base diverts `/usr/bin/man`; the Dockerfile now removes the diversion like `unminimize`). `text-filters-ticket-sales` switched to it and passed a live `labctl verify` (9/9 runs: 2 base, 5 mutations, 2 alternatives, Ready in 30-41 s). `task mirror:test` uses it for apt/pip from the mirror. |
| Tier A driver support | (catalog field `userNamespace: true`) | lab-orchestrator | **unit-tested**: `hostUsers: false` when every schedulable node reports `runtimeHandlers[].features.userNamespaces` for the runtime handler (`--user-namespaces=auto`, default), not for pods with privileged containers (topology links); annotation `labs.cloudtrain.dev/user-namespace` records why. kind 1.36.4 / containerd 2.3.4 / runc 1.4.3 / kernel 6.18 supports it (UserNamespacesSupport GA), idmapped local-path PVCs keep uid 1000 on the node. |
| Tier B (Kata) | none | none | **not started** (round 3 used the time on kubeadm-full and the gVisor fix). Preconditions unchanged: the kind worker has `/dev/kvm` (nested) and `/dev/vhost-vsock`; kata-deploy 4.2.0 is ~1.7 GB compressed, Docker has the room now. Fallback until then: tier-B labs run as tier-C VMs. |
| Tier C, EL | `el-vm:10` | `cloudtrain/el-vm:10` (1.78 GB) | **verified**: TCG build 1148 s; boot-test PASSED (432 s): two blank data disks by serial, LVM over both + XFS, mdadm, SELinux Enforcing, firewalld active, offline `dnf install httpd` from the local repo, man pages. |
| Tier C, Ubuntu | `ubuntu-vm:24.04` | `cloudtrain/ubuntu-vm:24.04` (1.82 GB) | **verified**: TCG build 1312 s (first attempt failed: `qemu-guest-agent` was not in the noble mirror; added to `packages-noble.txt`). Boot test PASSED in 520 s (ssh 110 s): two data disks by serial, LVM + XFS, AppArmor enabled, offline `apt-get update` + `apt-get install nginx` from the local signed repo, nftables/ufw. No lab uses it yet. |
| vm driver extra disks | topology `resources.disks: ["2Gi", ...]` | lab-orchestrator | **unit-tested** + the same VM shape boot-tested on el-vm. emptyDisk (ephemeral) / blank DataVolume (persistent), serial `ct-dataN`. |
| Mirror content | n/a | `tools/images/.cache/mirror/2026.10.14/` (828 MB) | **complete**: el10 756 rpms, noble 536 debs (+ qemu-guest-agent), PyPI 57 files (34 MB), Ansible 7 collections (13 MB). Locks committed in `tools/mirrors/lock/` (noble.lock is now `name=version arch`; it was `Package:=name Version:`). |
| Mirror service | n/a | `cloudtrain/mirror-content:2026.10.14` (1.78 GB image), zot, Gitea in `cloudtrain-mirrors` | **deployed + smoke-tested** (`task mirror:up`, 394 s): el-lab `dnf install`, deb-lab `apt-get install` (signed InRelease) with man pages, pip from the PyPI index, Ansible tarballs, allowlisted registry manifest served / non-allowlisted refused / anonymous push refused, Gitea API up with registration off, and an unlabelled pod reaches none of the three. `mirrors-up.sh` no longer needs `envsubst` (perl). After a content change: `docker rmi` the content image, `task mirror:up`, `kubectl -n cloudtrain-mirrors rollout restart deploy/mirror`. |
| kubeadm extras | `kubeadm:1.37-full`, `kubeadm:1.37-sec` (same image) | `cloudtrain/kubeadm-node:v1.37.1-full` (5.0 GB) | **verified** (rebuilt, 1774 s TCG): boot test `kubeadm-full` PASSED in 256 s: init 37 s, `addons-install all,falco --wait` 80 s offline, `kubectl top node`, local-path PVC bound, a `runsc` Pod under gVisor, Ingress and HTTPRoute through traefik (NodePort 30080) -> 200, MetalLB assigns an IP, Falco alerts, kube-bench runs (master: 39 PASS / 10 FAIL / 11 WARN). **Bug fixed**: runsc release-20261005.0 needs `gvisor-bin/` (gvisor_sentry ...) next to it; without it every runsc sandbox failed. **Open**: the MetalLB IP is not reachable from another pod in the Kube-OVN VPC (L2 ARP for an IP that is not a port address); Gateway listeners must use port 80/443 (traefik entrypoints). Live lab: see Round 3. |

New catalog refs (all in `deploy/images/catalog.yaml`): `el-lab:10`, `deb-lab:24.04` (tier A),
`el-vm:10`, `ubuntu-vm:24.04` (tier C), `kubeadm:1.37-full`, `kubeadm:1.37-sec` (tier K).
Content streams should only use the ones marked verified above until the rest pass.

Naming: the coordinator's brief said `linux-pod-el:10`/`el-lab:10` (VM); the approved
`content/curriculum.yaml` uses `el-lab:10`/`deb-lab:24.04` for tier-A pods and
`el-vm:10`/`ubuntu-vm:24.04` for tier-C VMs (88 + 174 uses). The catalog follows the curriculum.
lab-verify's curriculum check will now warn that these refs are both proposed and in the
catalog (drop them from the curriculum's `images` list).

## Next steps, in order

1. Kata spike (tier B): kata-deploy with RuntimeClass `kata` on the kind worker.
2. MetalLB in a Kube-OVN VPC: the assigned IP is not reachable from the tester pod. Options:
   give the speaker's IP to the VM port (`ovn.kubernetes.io` allowed address pairs / port
   security off for lab VMs), or document NodePort/Ingress only for LoadBalancer labs.
3. Switch the remaining add-on labs to `kubeadm:1.37-full`/`-sec` and verify them one at a
   time (k8s streams own them). Labs must run `addons-install <list> --wait` in their setup:
   the kubeadm driver does not call it. `falco-shell-in-container` expects a systemd `falco`
   service, but the image ships Falco as a DaemonSet (`addons-install falco`); the lab
   needs rewriting (rules in `/etc/falco/rules.d` are hostPath-mounted into the DaemonSet).
4. Switch the other linux-pod-deb/el labs to `deb-lab:24.04`/`el-lab:10`, verify, then drop
   the interim catalog entries (linux-a stream).
5. Follow-ups from round 1 still open: VMs in isolated VPCs cannot reach the shared mirror
   (they carry local repos); cloud-init uses group `sudo` also on EL; non-entry container
   nodes have no egress NetworkPolicy.

## Round 3 (2026-10-17): kubeadm under load

- Image catalog switch: `gvisor-runtimeclass` now uses `kubeadm:1.37-sec` (two-node cluster,
  control plane + worker). Its solution step got `timeoutSec: 200`.
- **Low load (3-50)**: the session came up every time: Ready after 316 s, 367 s, 497 s, 601 s,
  996 s, 1854 s as other agents ramped the host up; `kubeadm init` succeeded on attempt 1 in
  ~30 s-1 min after cloud-init, worker joined first try. The live runs exposed the runsc
  sidecar bug (now fixed) and a check that counted terminating Pods. Final live
  `labctl verify` on the rebuilt image: **3/3 runs ok** (base 100 %, mutation caught), Ready in
  221-242 s at load ~10.
- **High load (80-166, three agents with TCG builds and verifies)**: 3 sessions, 0 Ready
  within the 40 min provision timeout. Runs 1 and 2: `kubeadm init` succeeded on attempt 1
  (6.5 and 8.5 min). Run 3: **the retry path fired naturally**: attempt 1 failed in
  `wait-control-plane` (`kube-apiserver check failed at /livez: context deadline exceeded`),
  `kubeadm reset`, the CA restored, attempt 2 started; the session hit the 40 min provision
  timeout before attempt 2 finished, so its outcome was not observed.
- What actually fails under load is **after** init: the VMs show 64-85 % CPU steal;
  kube-apiserver exits (post-start hook `start-service-ip-repair-controllers` times out),
  controller-manager/scheduler lose leader election, and calico-node crashloops because its
  startup reads `kubeadm-config` through the service VIP with a hard-coded 2 s client
  timeout. Probe or retry tuning cannot fix 80 % steal: keep heavy work to one VM job and
  no TCG build at the same time on this machine (the slot runner allows 2 vm + 1 build).
- `boot-test.sh` now uses the driver's kubeadm timeouts and the same bounded init retry
  (its single `kubeadm init` failed with `unable to create ClusterRoleBinding` under load),
  and waits for the VMI to exist before `kubectl wait` (it raced and failed at once).

## Disk usage (round 3 end, 2026-10-17)

- New images: kubeadm-node v1.37.1-full 5.0 GB (rebuilt; also in the kind worker), ubuntu-vm
  1.82 GB (also in the worker), deb-lab 896 MB and mirror-content 1.78 GB (both kind nodes).
- Mirror content 2026.10.14 (with qemu-guest-agent) and its private signing key are in
  `.worktrees/b-foundations/tools/images/.cache/mirror/` (moved there when the round 3
  worktree was removed; gitignored). Copy that `.cache/mirror` into a new worktree before
  `task mirror:up` or an el-vm/ubuntu-vm build.
- Build cache pruned at the end (`docker builder prune -f`).

## Gotchas

- VM image builds only through `tools/slots/run.sh build --`, boots through `vm`. libguestfs
  runs under TCG (no nested KVM, after the WSL crashes): el-vm took 19 min, of which
  `virt-sparsify` ~17 min; kubeadm-full 26 min.
- snapshot.ubuntu.com is slow (~100 KB/s) and sometimes 503: the noble mirror resolves
  against the snapshot but downloads from archive.ubuntu.com (SHA256 checked against the
  snapshot index). `--print-uris` only gives MD5 and URL-encoded names.
- Do not edit `build-content.sh` while it runs (bash reads scripts lazily; it broke a run).
- `pkill -f <pattern>` also matches the invoking shell; kill by PID.
- EL10 package names: no `screen`, `passwd`, `gdisk`, `python3-virtualenv`; `wget` (not
  wget2-wget). The AlmaLinux container ships coreutils-single/curl-minimal (no man pages).
- Scratch logs live in `<scratchpad>/foundations/logs` (private).

## How to resume

`cd .worktrees/b-foundations && git pull`, check C: (`powershell.exe -NoProfile -Command
"[int]((Get-PSDrive C).Free/1GB)"`, stop under 15 GB), `task dev:up` (heals certs), then
the steps above. `docs/dev-environment.md` "Lab runtime tiers" documents the pieces.
