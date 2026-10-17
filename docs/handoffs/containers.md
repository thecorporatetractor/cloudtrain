# Handoff: containers stream (wave 2, Docker-first)

Branch `content/containers-wave2`, worktree `.worktrees/containers-wave2` (removed at
the end of the session; everything is on `main` via the PRs below).
Started 2026-10-16. Docker-first per the user's decision ("I would focus more on Docker
than podman").

## Engine design: one KubeVirt VM per lab (`docker-vm:29`)

Every containers lab is a workstation pod (`jumphost:1`, entry) plus **one KubeVirt VM
from `docker-vm:29`** (Ubuntu 24.04, Docker Engine 29.9.0 with the containerd image
store, buildx 0.38.0, compose 5.6.0, rootless extras, held). The learner works on the
VM over ssh (`ssh cl-<host>`), has passwordless sudo there, and labs that use the
engine add `learner` to the `docker` group in setup.

### Options evaluated

| Option | Result | Why not / why |
|---|---|---|
| Privileged DinD in the learner pod | rejected without a test | Not allowed (shared pods, Pod Security baseline). `--privileged` + the docker socket is node root. |
| Rootless Docker in a user-namespaced pod (`hostUsers: false`) | **spiked live, works partially** | See "Pod spike" below: the engine starts, but no cgroups (memory limits silently ignored), no network for the engine (no `/dev/net/tun`), published ports invisible outside the engine's namespace, no daemon restarts/reboots, no host firewall. About half the curriculum (OOM, limits, DOCKER-USER, address pools, macvlan, daemon.json, engine upgrade, rootless-vs-rootful, reboot-graded exam) cannot run there. |
| Sysbox | not available | No sysbox runtime on the kind nodes or in the production plan; it would be a new privileged node component (its own kernel-facing daemon) to secure and maintain. |
| Kata pod (curriculum tier B, `dockerd:29`) | deferred by foundations (download size) | The production target for the cheaper tier-B labs; until it exists tier-B labs run as tier-C VMs (as foundations decided for every tier-B lab). |
| **KubeVirt VM (`docker-vm:29`)** | **chosen, proven live** | Real kernel per learner: cgroups v2, iptables/nftables, bridges, systemd, daemon.json, reboots. Same image serves the learning labs and the exam (`sim-containers-docker` is tier C with `rebootBeforeGrade`). |

### Security reasoning

- The isolation boundary is **hardware virtualization**: the learner is root inside the
  VM (sudo; the `docker` group is root-equivalent by design), and nothing in the VM is
  shared with the node. A `docker run --privileged --pid=host -v /:/host` reaches the
  **VM's** root filesystem, PID 1 and kernel only.
- Lab VMs sit in the session's own Kube-OVN VPC with no route to the platform network,
  the nodes, the cluster services or the internet (`labnet.go`). The VM has no service
  account token, no kubelet, no cluster credentials. The admin key stays in the entry
  pod's admin sidecar.
- The virt-launcher pod is KubeVirt's normal unprivileged launcher (not affected by
  anything the learner does inside the guest).
- Residual risks: QEMU/KVM escapes (hypervisor bugs) and resource abuse (bounded by the
  VM's 2 vCPU / 2 GiB and the session TTL). Same model as every other tier-C lab.
- No platform runtime option was added or loosened: no privileged pods, no new
  capabilities, `learnerSudo` not used.

### Live escape test (boot-test `docker-vm`)

`tools/slots/run.sh vm -- bash tools/images/boot-test.sh docker-vm`, PASSED in 597 s on
2026-10-17 (VM in an isolated Kube-OVN VPC, checks over ssh as `learner`). As `learner`
in the `docker` group:

```
docker run --rm --privileged --pid=host --net=host -v /:/host busybox:1.37 sh -c '...'
container uid: 0
host rootfs: CLOUDTRAIN_IMAGE=docker-vm        <- /host is the VM, not the node
host pid 1: systemd                            <- the VM's init
ok: no kubelet state on the VM
ok: only the VM processes are visible (136 processes; no virt-launcher, kubelet, k8s shims)
ok: 10.96.0.1:443 unreachable                  <- cluster API service
ok: 172.31.0.2:10250 unreachable               <- kind worker kubelet
ok: 172.31.0.3:6443 unreachable                <- kind control plane
ok: 1.1.1.1:443 unreachable                    <- internet
```

The same run proved Engine 29.9.0 with the containerd image store, every preloaded
image visible to the engine, offline `docker run`, an offline BuildKit build, a
Compose stack with a published port, `--memory 16m` OOM kill (exit 137,
`OOMKilled=true`), the rootless prerequisites and the Docker man pages.

### Pod spike (rootless Docker under Pod Security baseline), for the record

Namespace with `pod-security.kubernetes.io/enforce: baseline`, pod `hostUsers: false`,
`procMount: Unmasked`, image `docker:29-dind-rootless`, `runAsUser: 1000`:

1. Admission accepts `procMount: Unmasked` for a user-namespaced pod under baseline.
2. Default subuid range (100000+) fails: the pod's user namespace only maps 0-65535.
   With `/etc/subuid` = `rootless:1001:64535` (ConfigMap) the uid map works.
3. `slirp4netns` needs `/dev/net/tun`, which an unprivileged pod does not get
   (`ip tuntap add` fails). Only `DOCKERD_ROOTLESS_ROOTLESSKIT_NET=none` +
   `PORT_DRIVER=none` starts: Docker 29.9.0, overlayfs (containerd snapshotter) on an
   emptyDir, "Running in rootless-mode without cgroups".
4. `docker run --memory 64m` returns 0 (limit silently not applied); a
   `--privileged -v /:/host` container sees only the pod's own root filesystem (no
   kubelet). So it is contained, but too far from a real engine for most labs.
5. It also needs `allowPrivilegeEscalation` (setuid `newuidmap`), which the entry pod
   only allows with `learnerSudo`.

Possible later cost optimisation for build-only labs: a `/dev/net/tun` device plugin +
systemd-managed cgroup delegation in a tier-A image. Not needed now.

## Image `docker-vm:29`

| | |
|---|---|
| Ref / image | `docker-vm:29` -> `cloudtrain/docker-vm:29` (containerDisk), 1.8 GB image, 863 MiB compressed qcow2, 12 GiB virtual |
| Build | `task image:build:docker-vm` (= `tools/slots/run.sh build -- bash tools/images/build.sh docker-vm`), TCG, 5597 s on a machine at load 80-110 |
| Contents | Ubuntu 24.04 cloud image (pinned serial), `docker-ce`/`-cli`/`-rootless-extras` 5:29.9.0, `docker-buildx-plugin` 0.38.0, `docker-compose-plugin` 5.6.0, `containerd.io` = `CONTAINERD_VERSION`, all held; uidmap, slirp4netns, dbus-user-session, skopeo, iptables, nftables, tcpdump, apache2-utils, git, python3, jq. All online apt sources disabled. |
| Preloaded images | `tools/images/docker-vm/preload-images.txt` (busybox:1.37, alpine:3.22, python:3.13-alpine, nginx:1.29-alpine, registry:3, redis:7.4-alpine), digests in `tools/images/lock/docker-vm.lock`, pulled by digest into containerd's `moby` namespace |
| Pins | `deploy/versions.env` (`DOCKER_VM_IMAGE`, `DOCKER_CE_VERSION`, `DOCKER_BUILDX_VERSION`, `DOCKER_COMPOSE_VERSION`); Docker packages are at least 7 days old at pin time |
| Boot test | `tools/images/boot-test.sh docker-vm` (see above) |

Lab authoring conventions are at the top of `content/packs/containers/pack.yaml`:
workstation `jumphost:1` + one VM `cl-<function>-NN` (exam: `cl-docker-01`, byte-identical
in every task), `usermod -aG docker learner` in setup, checks read `docker inspect` JSON
with `jq`. Never write Go templates like `{{.Name}}` in a lab: the lab templater treats
`{{x}}` as a param (a template with a space inside, e.g. `{{json .Manifest}}`, is safe).

## Platform changes (separate commits, called out in the PR)

1. `feat(lab-schema)`: the lab schema and the LabTemplate CRD enum accept the domains
   `containers`, `iac` and `automation` (the curriculum schema already had them). The
   widened CRD was applied to `cloudtrain-dev` (additive; diffed first).
2. `fix(lab-verify)`: the Pod-image rule (`image:` must be in `workloadImages`) applies
   only to labs with a `k8s-cluster` node; Compose files and Dockerfiles on a Docker host
   are no Pods. New unit test; 32/32 pass.
3. Image pipeline: `build.sh`, `load.sh`, `boot-test.sh`, `Taskfile.yml`, catalog entry
   `docker-vm:29` (catalog parsing is strict, so the preload list lives in
   `tools/images/docker-vm/preload-images.txt`, not in the catalog).

Not changed, follow-ups for the platform: the gateway's and web's `Domain` types
(`packages/api-types`, `services/gateway/src/content/load.ts`) know only kubernetes,
linux and networking, so containers labs are not shown in the UI yet.

## Status

12 learning labs and 12 exam tasks authored; 6 verified live. Source of truth: `status`/`notes` in `content/curriculum.yaml`.

### Learning labs (path order: ctr-foundations, then ctr-building-images module 1)

| Lab | Status | Notes |
|---|---|---|
| `ctr-first-transcoder-run` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 569s); tier-B Kata dockerd:29 not built yet |
| `ctr-override-defaults` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 764s); tier-B Kata dockerd:29 not built yet |
| `ctr-exec-into-subtitle` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 684s); tier-B Kata dockerd:29 not built yet |
| `ctr-inspect-report` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 995s); tier-B Kata dockerd:29 not built yet |
| `ctr-tag-vs-digest` | built | runs on docker-vm:29 (tier C VM) with registry:3 as a container on the host; live verify pending |
| `ctr-user-bridge-dns` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 980s); tier-B Kata dockerd:29 not built yet |
| `ctr-volume-vs-bind` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 794s); tier-B Kata dockerd:29 not built yet |
| `ctr-disk-reclaim` | built | runs on docker-vm:29 (tier C VM) until the tier-B Kata dockerd:29 image exists; live verify pending |
| `ctr-dockerfile-catalogue-api` | built | runs on docker-vm:29 (tier C VM) until the tier-B Kata dockerd:29 image exists; live verify pending |
| `ctr-build-args-labels` | built | runs on docker-vm:29 (tier C VM) until the tier-B Kata dockerd:29 image exists; live verify pending |
| `ctr-exec-form-signals` | built | runs on docker-vm:29 (tier C VM) until the tier-B Kata dockerd:29 image exists; live verify pending |
| `ctr-healthcheck` | built | runs on docker-vm:29 (tier C VM) until the tier-B Kata dockerd:29 image exists; live verify pending |

### Exam tasks (`sim-containers-docker` pools)

| Task | Pool | Status | Notes |
|---|---|---|---|
| `xcd-build-entrypoint-signals` | build | built | live verify pending |
| `xcd-compose-fix-broken-stack` | compose | built | live verify pending |
| `xcd-compose-health-order` | compose | built | live verify pending |
| `xcd-net-publish-loopback` | networking | built | live verify pending |
| `xcd-net-user-bridge` | networking | built | live verify pending |
| `xcd-ops-oom-diagnose` | operations | built | live verify pending |
| `xcd-ops-restart-survive` | operations | built | live verify pending |
| `xcd-registry-tls-push` | registry | built | live verify pending |
| `xcd-sec-least-privilege` | security | built | live verify pending |
| `xcd-storage-mount-mix` | storage | built | live verify pending |
| `xcd-storage-volume-restore` | storage | built | live verify pending |
| `xcd-supply-leaked-secret` | supply-chain | built | live verify pending |

Not written yet (12). Writable with the current image: `xcd-build-bake-targets`, `xcd-build-cache-secret`, `xcd-compose-env-profiles`, `xcd-compose-secret-file`, `xcd-net-address-pool`, `xcd-net-docker-user-rule`, `xcd-ops-log-rotation`. Blocked on image content docker-vm:29 does not have yet: `xcd-build-multistage-nonroot` (Go toolchain image), `xcd-ops-debug-shell-less` (a distroless/static base), `xcd-registry-multiarch-index` (arm64 base content + binfmt), `xcd-sec-socket-proxy` (a socket-proxy image), `xcd-supply-sbom-sign` (cosign binary). Add those to `tools/images/docker-vm/preload-images.txt` or the guest script and rebuild. The other 79 learning labs of the domain (paths ctr-building-images module 2 onward, compose, networking, storage, registries, security, troubleshooting, internals, podman, swarm) are not started.

## Open questions for the user

- Drop the legacy Docker-cert overlay path (`dca-legacy` refs stay on the labs until
  decided)? Not pre-empted.
- "Docker" in exam titles: the simulation keeps its neutral curriculum title
  ("Container practitioner practical exam simulation"); lab titles name no product.
- Scaled-down lab sizes: `ctr-disk-reclaim` reclaims a randomised 350-450 MiB instead of
  3 GiB, and `ctr-dockerfile-catalogue-api` uses 200 MiB of sample media instead of 2 GiB
  (VM disk budget). OK?

## How to resume

```bash
cd /home/hackrvl/cloudtrain && git worktree add .worktrees/containers origin/main && cd .worktrees/containers
GOTOOLCHAIN=go1.27.2 go build -o services/lab-orchestrator/bin/labctl ./services/lab-orchestrator/cmd/labctl
docker image inspect cloudtrain/docker-vm:29 >/dev/null || task image:build:docker-vm   # ~95 min under TCG
bash tools/images/load.sh docker-vm
LOAD_LAB_IMAGES=0 SKIP_CRDS=1 ORCH_NAMESPACE=ct-containers-system \
  SESSION_SELECTOR=labs.cloudtrain.dev/verify=containers PROVISION_TIMEOUT=30m \
  bash deploy/scripts/orchestrator-deploy.sh
tools/slots/run.sh vm -- services/lab-orchestrator/bin/labctl verify --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=containers --parallel 2 --repo-root "$PWD" \
  "$PWD/content/packs/containers/labs/<lab>"
node tools/lab-verify/bin/lab-verify.mjs --strict && node tools/curriculum/render.mjs
```

One lab verify is 6-8 fresh VMs (two seeds, mutations, alternatives): 9-21 min with
`--parallel 2` (VM ready in about 110 s on a quiet machine, 350-520 s under load).
Under heavy machine load (load average around 100) WSL restarted once during a verify
batch; run one containers verify job at a time.
