# Foundations stream: handoff (paused 2026-10-14)

Branch `build/foundations`, worktree `.worktrees/b-foundations`. Paused on request; nothing
is running, no slot is held, test namespaces are deleted.

## What exists now

| Area | Catalog ref(s) | Image | Status |
|---|---|---|---|
| dev:up auto-heal | n/a | `deploy/scripts/heal-virt-certs.sh`, `task dev:heal-certs`, called by `dev:up` before KubeVirt | **verified**: check 3 s on a healthy cluster, forced repair (`FORCE=1`) 50 s; detection proven against real expiring certs (`MIN_VALID=90000 --list-expired`). Not yet seen against a real >24 h stop. |
| kubeadm upgrade image | `kubeadm:1.36` | `cloudtrain/kubeadm-node:v1.36-upgrade` (4.51 GB) | **verified**: packaged (`PACKAGE_ONLY=1`, 251 s), boot-test PASSED (794 s). REPORT: `kubeadm upgrade plan` exit 0 and `kubeadm upgrade plan v1.37.1` exit 0 offline; installing the kubelet package **restarts kubelet** (node still reports v1.36.5 until the learner upgrades the config and restarts). |
| Tier A, EL | `el-lab:10` | `cloudtrain/el-lab:10` (955 MB) | **built + smoke-tested** in a `hostUsers: false` pod (Ready in 9-11 s; uid_map `0 1256194048 65536`; tini PID 1 reaps zombies; learner has no sudo; man pages; sshd and strace work). Loaded into both kind nodes. Not yet run through the orchestrator end to end. |
| Tier A, Debian | `deb-lab:24.04` | `cloudtrain/deb-lab:24.04` | **not built**: the build (packages from the local noble mirror) failed with apt exit 100, most likely the `--reinstall` of base packages whose installed version is older than the mirror's. Fix applied in the Dockerfile (`apt-get -y upgrade` before the reinstall), not yet re-run. |
| Tier A driver support | (catalog field `userNamespace: true`) | lab-orchestrator | **unit-tested**: `hostUsers: false` when every schedulable node reports `runtimeHandlers[].features.userNamespaces` for the runtime handler (`--user-namespaces=auto`, default), not for pods with privileged containers (topology links); annotation `labs.cloudtrain.dev/user-namespace` records why. kind 1.36.4 / containerd 2.3.4 / runc 1.4.3 / kernel 6.18 supports it (UserNamespacesSupport GA), idmapped local-path PVCs keep uid 1000 on the node. |
| Tier B (Kata) | none | none | **deferred** (disk rule): kata-deploy 4.2.0 image is 1.7 GB compressed (kata-static tarball 950 MB). Preconditions look good: the kind worker has `/dev/kvm` (kvm_intel nested=Y) and `/dev/vhost-vsock`, same nesting depth as the KubeVirt VMs that work. Fallback until then: tier-B labs run as tier-C VMs (`el-vm:10`, `ubuntu-vm:24.04`, driver `vm`). |
| Tier C, EL | `el-vm:10` | `cloudtrain/el-vm:10` (1.78 GB) | **verified**: TCG build 1148 s; boot-test PASSED (432 s): two blank data disks by serial, LVM over both + XFS, mdadm, SELinux Enforcing, firewalld active, offline `dnf install httpd` from the local repo, man pages. |
| Tier C, Ubuntu | `ubuntu-vm:24.04` | `cloudtrain/ubuntu-vm:24.04` | **not built** (scripts ready: `guest-ubuntu-vm.sh`, boot-test checks). Needs the noble mirror, which now exists. |
| vm driver extra disks | topology `resources.disks: ["2Gi", ...]` | lab-orchestrator | **unit-tested** + the same VM shape boot-tested on el-vm. emptyDisk (ephemeral) / blank DataVolume (persistent), serial `ct-dataN`. |
| Mirror content | n/a | `tools/images/.cache/mirror/2026.10.14/` | el10: 756 rpms, 445 MB; noble: 535 debs, 338 MB (signed InRelease). **PyPI failed** (snapshot.ubuntu.com 503 while installing pip), Ansible collections not built. Total so far 782 MB (target <= 8 GB). |
| Mirror service | n/a | `deploy/mirrors/mirrors.yaml`, `mirrors-up.sh`, `mirrors-test.sh` | **written, not deployed**: content image not built yet (needs a complete content run), zot allowlist = catalog workloadImages, Gitea, NetworkPolicy admitting only pods labelled `labs.cloudtrain.dev/session`. Entry pods may egress to the mirrors namespace (unit-tested). |
| kubeadm extras | `kubeadm:1.37-full`, `kubeadm:1.37-sec` (same image) | `cloudtrain/kubeadm-node:v1.37.1-full` (4.85 GB) | **built, not loaded, not boot-tested**. Layered on kubeadm:1.37 (1562 s TCG). `addons-install <list>`: metrics-server v0.9.0, gateway-api v1.6.3, traefik v3.7.14 (IngressClass + GatewayClass `traefik`, :80/:443, NodePorts 30080/30443), metallb v0.16.1 (pool 192.168.100.200-220), local-path v0.0.37 (default class), falco 0.45.0. CKS: gVisor runsc as containerd handler `runsc`, kube-bench v0.16.0 + cfg, AppArmor sample profiles, audit policies. No Trivy DB (size). The final `load.sh kubeadm-full` failed (missing case; fixed). |

New catalog refs (all in `deploy/images/catalog.yaml`): `el-lab:10`, `deb-lab:24.04` (tier A),
`el-vm:10`, `ubuntu-vm:24.04` (tier C), `kubeadm:1.37-full`, `kubeadm:1.37-sec` (tier K).
Content streams should only use the ones marked verified above until the rest pass.

Naming: the coordinator's brief said `linux-pod-el:10`/`el-lab:10` (VM); the approved
`content/curriculum.yaml` uses `el-lab:10`/`deb-lab:24.04` for tier-A pods and
`el-vm:10`/`ubuntu-vm:24.04` for tier-C VMs (88 + 174 uses). The catalog follows the curriculum.
lab-verify's curriculum check will now warn that these refs are both proposed and in the
catalog (drop them from the curriculum's `images` list).

## Next steps, in order

1. `bash tools/mirrors/build-content.sh pypi ansible` (retry; snapshot.ubuntu.com was
   returning 503/slow). Writes `SNAPSHOT` and copies the locks to `tools/mirrors/lock/`. Commit the locks.
2. `bash tools/images/build-linux-pod.sh deb` (fast now: local mirror). Smoke-test like el-lab.
3. `task mirror:up` (packages the content image, deploys, runs `mirrors-test.sh`). Expect
   to tune: zot allowlist/auth, Gitea admin creation, NetworkPolicy with Kube-OVN.
4. `tools/slots/run.sh build -- bash tools/images/build.sh ubuntu-vm`, then
   `tools/slots/run.sh vm -- bash tools/images/boot-test.sh ubuntu-vm`.
5. `bash tools/images/load.sh kubeadm-full`, add a `test_kubeadm-full` to boot-test.sh
   (kubeadm init, `addons-install all --wait`, metrics-server `kubectl top`, an Ingress and
   an HTTPRoute through traefik, a MetalLB LoadBalancer IP reachable in the VPC, a PVC
   bound by local-path, a `runsc` RuntimeClass pod, falco alert on `kubectl exec`), run it
   in the vm slot. MetalLB L2 inside a Kube-OVN VPC is the riskiest part.
6. End-to-end orchestrator run of a tier-A lab (manager with `--user-namespaces=auto`) and
   a vm lab with `resources.disks`.
7. Kata spike when disk allows (> 2 GB download): kata-deploy with RuntimeClass `kata`.
8. Follow-ups: VMs in isolated VPCs cannot reach the shared mirror (they carry local
   repos instead); a proxy on the entry pod's net1 would give VMs the registry/Gitea.
   cloud-init uses group `sudo` also on EL (cloud-init creates it; `wheel` would be
   more authentic). Non-entry container nodes have no egress NetworkPolicy yet.

## Disk usage added (C: had 23-24 GB free throughout)

- Docker images: el-lab 955 MB, el-vm 1.78 GB, kubeadm-node v1.36-upgrade 4.51 GB,
  v1.37.1-full 4.85 GB (plus copies inside the kind worker for upgrade/el-vm, both nodes for el-lab).
- `tools/images/.cache` (this worktree): 2.0 GB = base cloud images (Alma 475 MB, Ubuntu
  597 MB), mirror content 782 MB, gvisor tarball 160 MB. Keep the mirror for steps 1-4;
  the base images can be deleted and re-downloaded (sha256-pinned).
- Build intermediates are deleted after each build (`CLEAN_DISK=1` default in build.sh).
- The k8s-images worktree still holds old build disks (`.cache/*/out/disk.qcow2`, ~4.6 GB,
  root-owned) that are now packaged; they belong to that stream but can be removed.

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
