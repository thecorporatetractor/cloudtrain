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

12 learning labs and 12 exam tasks authored; 24 verified live. Source of truth: `status`/`notes` in `content/curriculum.yaml`.

### Learning labs (path order: ctr-foundations, then ctr-building-images module 1)

| Lab | Status | Notes |
|---|---|---|
| `ctr-first-transcoder-run` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 569s); tier-B Kata dockerd:29 not built yet |
| `ctr-override-defaults` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 764s); tier-B Kata dockerd:29 not built yet |
| `ctr-exec-into-subtitle` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 684s); tier-B Kata dockerd:29 not built yet |
| `ctr-inspect-report` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 995s); tier-B Kata dockerd:29 not built yet |
| `ctr-tag-vs-digest` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 1601s); tier-B Kata dockerd:29 not built yet |
| `ctr-user-bridge-dns` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 980s); tier-B Kata dockerd:29 not built yet |
| `ctr-volume-vs-bind` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 794s); tier-B Kata dockerd:29 not built yet |
| `ctr-disk-reclaim` | verified | verified live 2026-10-17 on docker-vm:29 (6 runs, 1367s); tier-B Kata dockerd:29 not built yet |
| `ctr-dockerfile-catalogue-api` | verified | verified live 2026-10-17 on docker-vm:29 (5 runs, 675s); tier-B Kata dockerd:29 not built yet |
| `ctr-build-args-labels` | verified | verified live 2026-10-17 on docker-vm:29 (4 runs, 358s); tier-B Kata dockerd:29 not built yet |
| `ctr-exec-form-signals` | verified | verified live 2026-10-17 on docker-vm:29 (5 runs, 558s); tier-B Kata dockerd:29 not built yet |
| `ctr-healthcheck` | verified | verified live 2026-10-17 on docker-vm:29 (5 runs, 1065s); tier-B Kata dockerd:29 not built yet |

### Exam tasks (`sim-containers-docker` pools)

| Task | Pool | Status | Notes |
|---|---|---|---|
| `xcd-build-entrypoint-signals` | build | verified | verified live 2026-10-17 on docker-vm:29 (3 runs); reboot pass not exercised by labctl verify |
| `xcd-compose-fix-broken-stack` | compose | verified | verified live 2026-10-17 on docker-vm:29 (3 runs, 297s); reboot pass not exercised by labctl verify |
| `xcd-compose-health-order` | compose | verified | verified live 2026-10-17 on docker-vm:29 (3 runs, 325s); reboot pass not exercised by labctl verify |
| `xcd-net-publish-loopback` | networking | verified | verified live 2026-10-17 on docker-vm:29 (3 runs, 237s); reboot pass not exercised by labctl verify |
| `xcd-net-user-bridge` | networking | verified | verified live 2026-10-17 on docker-vm:29 (4 runs, 266s); reboot pass not exercised by labctl verify |
| `xcd-ops-oom-diagnose` | operations | verified | verified live 2026-10-17 on docker-vm:29 (4 runs, 265s); reboot pass not exercised by labctl verify |
| `xcd-ops-restart-survive` | operations | verified | verified live 2026-10-17 on docker-vm:29 (5 runs, 363s); reboot pass not exercised by labctl verify |
| `xcd-registry-tls-push` | registry | verified | verified live 2026-10-17 on docker-vm:29 (3 runs, 246s); reboot pass not exercised by labctl verify |
| `xcd-sec-least-privilege` | security | verified | verified live 2026-10-17 on docker-vm:29 (4 runs, 258s); reboot pass not exercised by labctl verify |
| `xcd-storage-mount-mix` | storage | verified | verified live 2026-10-17 on docker-vm:29 (3 runs, 245s); reboot pass not exercised by labctl verify |
| `xcd-storage-volume-restore` | storage | verified | verified live 2026-10-17 on docker-vm:29 (3 runs, 257s); reboot pass not exercised by labctl verify |
| `xcd-supply-leaked-secret` | supply-chain | verified | verified live 2026-10-17 on docker-vm:29 (4 runs, 290s); reboot pass not exercised by labctl verify |

Superseded by the round 5 wave 1 section below (all of these are now written; the blocked list in this paragraph is outdated: `xcd-ops-debug-shell-less`, `xcd-registry-multiarch-index` and `xcd-sec-socket-proxy` are unblocked by the recipes below). Original text: not written yet (12). Writable with the current image: `xcd-build-bake-targets`, `xcd-build-cache-secret`, `xcd-compose-env-profiles`, `xcd-compose-secret-file`, `xcd-net-address-pool`, `xcd-net-docker-user-rule`, `xcd-ops-log-rotation`. Blocked on image content docker-vm:29 does not have yet: `xcd-build-multistage-nonroot` (Go toolchain image), `xcd-ops-debug-shell-less` (a distroless/static base), `xcd-registry-multiarch-index` (arm64 base content + binfmt), `xcd-sec-socket-proxy` (a socket-proxy image), `xcd-supply-sbom-sign` (cosign binary). Add those to `tools/images/docker-vm/preload-images.txt` or the guest script and rebuild. The other 79 learning labs of the domain (paths ctr-building-images module 2 onward, compose, networking, storage, registries, security, troubleshooting, internals, podman, swarm) are not started.

## Round 5, wave 1 (branch `content/containers-r5-w1`): write-first, 23 labs

Written to the definition of done (status `built`, never run live: the containers labs are
all KubeVirt VMs, so the vm slot and `labctl verify` wait for the testing round).

| Group | Labs |
|---|---|
| Exam tasks (12), so every sim-containers-docker pool is at 2x its draw and the exam is in the CI `labctl exam compile` list | `xcd-build-multistage-nonroot`, `xcd-build-cache-secret`, `xcd-build-bake-targets`, `xcd-registry-multiarch-index`, `xcd-compose-env-profiles`, `xcd-compose-secret-file`, `xcd-net-docker-user-rule`, `xcd-net-address-pool`, `xcd-sec-socket-proxy`, `xcd-supply-sbom-sign`, `xcd-ops-log-rotation`, `xcd-ops-debug-shell-less` |
| Module ctr-images-efficient (5) | `ctr-cache-order`, `ctr-shrink-transcoder`, `ctr-non-root-uid`, `ctr-digest-pin`, `ctr-reproducible-build` |
| Module ctr-images-buildkit (6) | `ctr-buildkit-cache-mount`, `ctr-build-secret-token`, `ctr-build-checks`, `ctr-multi-platform`, `ctr-bake-matrix`, `ctr-buildx-cache-export` |

Both modules are courses in `pack.yaml` (`ctr-images-efficient`, `ctr-images-buildkit`).
The module title "BuildKit, buildx and Bake" became "Builders, secrets, caches and
multi-platform images" (titles carry no product names).

### Recipes used (each lab inlines its own copy)

- **Offline package index** (`ctr-cache-order`, `ctr-buildkit-cache-mount`,
  `ctr-build-secret-token`, `xcd-build-cache-secret`): setup writes pure-Python *sdists*
  (a `pyproject.toml` with an in-tree PEP 517 backend, no setuptools needed) into
  `/srv/pypi/simple/<pkg>/` (PEP 503) and serves them with a small Python server under a
  systemd unit (port 3141; the exam task uses 3142 and a basic-auth token). Builds reach it
  at the docker0 gateway (`docker network inspect bridge | jq`) in the learning labs; pip
  refuses a plain-HTTP index that is not loopback unless the host is trusted, so every
  Dockerfile sets `PIP_TRUSTED_HOST=<host>`. The exam task `xcd-build-cache-secret` uses a
  fixed address instead, 198.18.0.42 on a dummy interface `clpkgs0` made by a oneshot unit,
  because docker0 moves when `xcd-net-address-pool` changes the pools and the exam reboots
  before grading. Why sdists and not wheels: a cache mount over plain-HTTP wheels saves
  nothing useful, while a wheel built from an sdist lands in pip's wheel cache and the
  rebuild
  does not download the tarball again (checked locally with pip). The grader counts
  `.tar.gz` lines in the server's access log.
- **Shell-less runtime** (`xcd-ops-debug-shell-less`): `copperleaf/pyruntime:1` is built in
  setup FROM scratch with the libraries and python3 of python:3.13-alpine. Debug container:
  `docker run --rm --pid container:X --network container:X busybox:1.37`, read the service
  through `/proc/1/root`.
- **Socket proxy** (`xcd-sec-socket-proxy`): `copperleaf/socket-proxy:1` is nginx:1.29-alpine
  with an allowlist (GET /containers/json and /_ping, everything else 403). Unblocks the task.
- **Multi-arch without emulation** (`ctr-multi-platform`, `xcd-registry-multiarch-index`):
  `FROM scratch`, `ARG TARGETARCH`, `COPY file-${TARGETARCH} /x`, `buildx build --platform
  linux/amd64,linux/arm64 --push`. A local run (Engine 27.5, containerd store, docker
  driver) pushed a two-platform index; it also carries `unknown/unknown` attestation
  entries, which the checks ignore.
- **Size labs**: `ctr-shrink-transcoder` uses a synthetic ~300 MiB incompressible toolchain
  layer and a 60 MiB limit (production: 900 MB and 120 MB).
- **Throwaway client namespaces** (`xcd-net-docker-user-rule`): the checks create veth pairs
  and network namespaces with source addresses 10.20.0.2 and 10.30.0.2 and curl the host's
  published port; the rule must match `--ctorigdstport 8443 --ctdir ORIGINAL` because
  DOCKER-USER sees the translated port. The restart check removes the DROP/REJECT rules,
  restarts the engine and every custom unit to emulate a reboot.
- **daemon.json** is only merged with jq (host label `site=copperleaf-exam` seeded by
  `xcd-net-address-pool` and `xcd-ops-log-rotation`; the checks read it back through
  `docker info --format json` or their own key).

### Blockers and unconfirmed points (all labs are marked built)

| Lab | Blocker | Needed in the next docker-vm rebuild |
|---|---|---|
| `ctr-buildx-cache-export` | the docker-container driver needs the moby/buildkit image | preload `moby/buildkit:v0.23.2` exactly (the lab pins it with `--driver-opt image=`); the lab's setup pushes alpine:3.22 to the local registry because the builder cannot see dockerd's images |
| `xcd-build-multistage-nonroot` | no Go toolchain image offline | preload `golang:1.25-alpine` |
| `xcd-supply-sbom-sign` | no cosign, no docker/buildkit-syft-scanner image; setup writes NOTE.txt instead of keys without cosign, keep the task out of a live draw until then | install `cosign` (v2 flags assumed), preload `docker/buildkit-syft-scanner` |
| `ctr-reproducible-build` | `rewrite-timestamps=true` was not honoured by the docker driver in a local test (Engine 27.5, BuildKit 0.18); the lab uses a fixed-mtime tar overlay instead; unconfirmed: offline `FROM tag@digest` resolution on 29.9 | none, confirm at verify |
| `ctr-digest-pin` | unconfirmed: BuildKit pulling FROM from the plain-HTTP mirror configured through insecure-registries | none, confirm at verify |

Other image wishes already known: binfmt/arm64 bases, vulnerability DB and scanners
(trivy/grype/scout), notation, gitea, an Engine 28 apt repo (later waves).

### Verify queue for the testing round (containers)

1. Wave 1 minus the four blocked labs (19 labs), one `labctl verify` at a time (6 to 8
   VMs each): the 10 xcd tasks first (shortest), then the 9 learning labs.
2. After the image rebuild: `ctr-buildx-cache-export`, `xcd-build-multistage-nonroot`,
   `xcd-supply-sbom-sign`; then confirm `ctr-reproducible-build`.
3. Waves 2 to 5 as they land (wave 2 once el-vm podman is confirmed).
4. Reboot pass of `sim-containers-docker` (all 24 tasks are written; the grader reboot is
   not part of `labctl verify`).

How to deploy a label-scoped manager for the testing round is in "How to resume" above:
`SESSION_SELECTOR=labs.cloudtrain.dev/verify=containers`, one containers verify at a time.

## Round 5, wave 2 (branch `content/containers-r5-w2`): Podman track and the whole Podman exam, 21 labs

Written to the definition of done (status `built`, never run live: every lab is a KubeVirt VM pair, so the vm slot and `labctl verify` wait for the testing round).

| Group | Labs |
|---|---|
| Exam tasks (16), so every `sim-containers-podman` pool is at 2x its draw (build 4/2, manage 4/2, run 4/2, multi-container 2/1, troubleshoot 2/1) and the exam is in the CI `labctl exam compile` list | `xct-build-media-containerfile`, `xct-build-entrypoint-cmd`, `xct-build-volume-selinux`, `xct-build-arbitrary-uid`, `xct-manage-registry-push`, `xct-manage-short-names`, `xct-manage-image-archive`, `xct-manage-container-state`, `xct-run-ports-env`, `xct-run-persistent-db`, `xct-run-quadlet-service`, `xct-run-rootless-user`, `xct-multi-pod-api-db`, `xct-multi-kube-play`, `xct-trouble-crashloop`, `xct-trouble-selinux-mount` |
| Path ctr-podman-track, module ctr-podman-differences (3) | `ctr-podman-docker-differences`, `ctr-podman-rootless-basics`, `ctr-selinux-relabel` |
| Module ctr-podman-services (2) | `ctr-podman-pod-kube-play`, `ctr-quadlet-reboot` |

Both modules are courses in `pack.yaml` (`ctr-podman-differences`, `ctr-podman-services`). Titles lost their product names (Podman, Quadlet, Kubernetes); the path became "Daemonless containers for Docker users (optional)".

### Runtime design

`podman-vm:5` does not exist (the proposed image entry was removed from the curriculum). Every lab and task has three nodes:

- `cl-podman-01`: `el-vm:10` (AlmaLinux 10.2, SELinux enforcing, 2 vCPU / 2 GiB). Setup runs `dnf -y install podman buildah skopeo container-selinux systemd-container` (offline, from the dnf-local mirror: Podman 5.8.2), creates the rootless user (`examuser` UID 2300 in the exam, `media` in the learning labs), installs the registry CA into `/etc/containers/certs.d/` and writes `/usr/local/lib/cloudtrain/as-user`, the helper the checks use to run `podman` as that user with `XDG_RUNTIME_DIR` and a session bus (`runuser` alone leaves neither). Learners use `sudo machinectl shell examuser@`.
- `cl-registry-01`: `docker-vm:29` (1 vCPU / 1 GiB). Runs `registry:3` with TLS on 5443 (`registry.exam.example` in the exam, `registry.copperleaf.example` in the labs), republishes the preloaded busybox, alpine, python, nginx and redis images under `library/` (a `FROM`-only build per image, so each is a single-platform manifest), and serves the CA over plain HTTP on 8099 so the podman host can fetch it (public data). The podman host finds it with `getent ahostsv4 cl-registry-01`.
- Setup order: registry step first. All sixteen exam tasks share byte-identical node blocks; the registry step is idempotent (CA, registry container and base images are created only if absent), so any draw of tasks can run its setups one after another on the same two hosts.

Design decisions to know when verifying:

- Working directories are `/home/examuser/exam/<task>` (not `/home/learner/exam`): the rootless user owns its workspace, and the home-directory SELinux label is what the SELinux tasks need.
- The exam leaves lingering **off** for `examuser` (the Quadlet task is graded on the learner enabling it). Checks therefore start the user manager themselves (`as-user`) and run `podman start <name> || true` before probing, so everything except the Quadlet task grades configuration, not whether a container survived the reboot.
- `xct-manage-registry-push` pushes to a second, authenticated registry `secure.exam.example:5444` (same CA, own container `cl-secure-registry`), so the shared registry on 5443 stays anonymous and the CA-trust task has a host:port nothing else touches. The curriculum one-liner says so.
- `xct-run-quadlet-service` uses container `media-edge` on 18090 (the curriculum had `media-api` on 18080, which `xct-run-ports-env` owns). `xct-build-arbitrary-uid` uses a UID inside the rootless default range (parameterised 20000-60000, the curriculum's 1000650000 is unmappable for a rootless user).
- Seeds are created only when absent and never satisfy the producing task: `localhost/media-api:1.0` runs as root from `/app` (seeded by ports-env, quadlet, registry-push), `localhost/static-web:latest` has no VOLUME (seeded by rootless-user).
- PostgreSQL has no offline image: `xct-run-persistent-db` and `xct-multi-pod-api-db` use `redis:7.4-alpine` (noted in the curriculum).

### Unconfirmed until the first live run

- `ctr-podman-pod-kube-play`: `podman kube play` resolving secretKeyRef and secret volumes from a secret created by playing a Secret manifest; the check accepts the plain or base64 password in the stored Secret and requires the pod to answer authenticated.
- `ctr-quadlet-reboot` / `xct-run-quadlet-service`: the Quadlet generator and a unit with `Restart=always` coming up at boot before the registry VM is reachable (the image is local in the exam task, pulled in the lab).
- `xct-manage-image-archive`: `podman load` of an `oci-archive` restoring the tag (alternative path), and rootless `--root`/`vfs` loads in `/tmp`.
- `xct-run-rootless-user` alternative `--userns=keep-id:uid=1001,gid=1001` running the process as 1001.
- `docker build` of a `FROM`-only Dockerfile on docker-vm resolving the preloaded base offline (same assumption as the verified wave-1 labs).
- `buildah config --cmd "--daily"` in the `xct-build-entrypoint-cmd` alternative.

No image blockers for the labs themselves; wishlist for the next image work stays: a real `podman-vm:5` would remove the registry companion.

### Verify queue additions

Wave 2 once `el-vm:10` Podman is confirmed (boot one VM, `dnf install podman`, run a rootless container as a new user): the 5 learning labs first (they are the shortest to debug), then the exam tasks. Each verify is three VMs (workstation pod, el-vm, docker-vm) per seed; one containers verify at a time. The exam's reboot pass is not part of `labctl verify`.

## Round 5, wave 3 (branch `content/containers-r5-w3`): Compose, networking and storage, 23 labs

All 23 are marked built (never run live). Courses added to `pack.yaml` mirror the curriculum modules: `ctr-compose-model`, `ctr-compose-operate`, `ctr-compose-scale`, `ctr-net-basics`, `ctr-net-host`, `ctr-net-diagnose`, `ctr-storage-mounts`, `ctr-storage-backends`. Every lab is a workstation plus one `docker-vm:29` VM (`ctr-macvlan-encoder` adds a `nettools:1` studio node).

### Recipes and substitutions
- Compose labs grade `docker compose -p <proj> config --format json`, containers filtered by the compose project and service labels, and curl. redis:7.4-alpine stands in for PostgreSQL (`ctr-compose-healthy-start`); nginx:1.29-alpine stands in for Caddy (`ctr-compose-proxy-repair`).
- Source-range firewall labs (`ctr-docker-user-chain`, `ctr-nftables-backend`) build network namespaces on the VM so traffic really crosses FORWARD and DOCKER-USER; checks use `ip netns exec`.
- `ctr-image-mount-models`: image mount of a FROM scratch models image; the check reads `HostConfig.Mounts` (type image).
- `ctr-storage-backend-tour`: the report is graded against `docker info --format json` and the layer's marker file on disk.
- `ctr-containerd-store-migration`: setup publishes a two-platform index with provenance to a registry container, `docker save`s registry:3 and busybox:1.37, flips daemon.json to the overlay2 store (jq merge), restarts, `docker load`s them and restarts the registry on the same data directory. The learner flips back, recreates the registry (containers of the old store are not visible) and pulls the digest with all platforms.

### Blockers and unconfirmed points
- `ctr-macvlan-encoder`: needs a second NIC on a Multus L2 segment shared with the studio node; cannot pass until that exists.
- `ctr-nftables-backend`: firewall-backend nftables is experimental in Engine 29; table and chain names must be confirmed on the image at the first live run.
- `ctr-image-mount-models`: confirm `type=image` options (readonly, image-subpath) on the installed 29.x.
- `ctr-compose-oci-publish`: confirm `docker compose publish` works against the plain-HTTP localhost registry (may need `--insecure-registry`).
- `ctr-containerd-store-migration`: assumes `docker save` of the preloaded images, `docker load` into overlay2, `docker image inspect --platform` and `docker buildx imagetools inspect --raw` against localhost:5000 behave as documented; disk heavy.

### Verify queue
Wave 3 after waves 1 and 2: Compose labs first (`ctr-compose-first-stack` onward), then storage and basic networking, then the namespace-based firewall labs, `ctr-net-mtu-hang`, `ctr-containerd-store-migration`; `ctr-macvlan-encoder` last (blocked).

## Round 5 closing handoff (2026-10-18)

State at the end of round 5. Everything below is `built` (static checks only: lab-verify --strict, schema, render --check, exam compile); nothing from waves 1 to 4 has run live. Verified live remains the original 24 (12 learning, 12 exam tasks).

| Wave | PR | Built | State |
|---|---|---|---|
| 1 | #58 | 23 (12 xcd tasks, 11 learning) | merged |
| 2 | #63 | 21 (16 xct Podman tasks, 5 learning) | merged |
| 3 | #87 | 23 (Compose, networking, storage), commit 397395c | merged |
| 4 | #114 | 25 (registries, security, supply chain, 4 xpe tasks) | NOT merged: review round 3 not approved |

Pools: sim-containers-docker and sim-containers-podman are at 2x their draw. The sim-platform-engineer containers-delivery pool is 4/2 once #114 merges.

### Unmerged: PR #114 (wave 4)

Static gates pass (lab-verify --strict 0 errors, 0 warnings); the open review findings are content bugs to fix before merge:

- Blocker: `xpe-image-slim-fix` exec-form check uses `test("sh$")`, which matches the solution's own `ENTRYPOINT ["/printer.sh"]`; solution and alternative both fail.
- Major: `xpe-image-build-push` reads the digest with `buildx imagetools` against a registry whose CA is trusted only in `/etc/docker/certs.d`; imagetools likely ignores that, so `digest.txt` is empty.
- Major: `ctr-notation-sign-verify` alternative `trustedIdentities` names the CA subject instead of the leaf and lacks C/ST/O.
- Major: `ctr-notation-sign-verify` and `ctr-signed-only-gate` create CA certs without keyUsage `keyCertSign`, which notation rejects.
- Major: `ctr-content-trust-retired` kept-content-trust mutation pulls by digest, which skips the content-trust lookup, so the misconception is not caught.
- Minor: unused params (`tag` in `ctr-remote-engine-ssh`, `rel` in `ctr-content-trust-retired`); possible Ubuntu 24.04 AppArmor userns block for `ctr-rootless-engine`; fixed /tmp log path in the gate; weak risk-note check in `ctr-socket-escape`.

### Blockers per lab (all written and marked built)

| Lab | Wave | Blocker |
|---|---|---|
| `ctr-buildx-cache-export` | 1 | needs `moby/buildkit:v0.23.2` preloaded |
| `xcd-build-multistage-nonroot` | 1 | needs `golang:1.25-alpine` preloaded |
| `xcd-supply-sbom-sign` | 1 | no cosign, no buildkit-syft-scanner image; keep out of live draws |
| `ctr-reproducible-build` | 1 | `rewrite-timestamps` unconfirmed; confirm offline `FROM tag@digest` |
| `ctr-digest-pin` | 1 | unconfirmed BuildKit pull from plain-HTTP mirror |
| `ctr-macvlan-encoder` | 3 | needs a second NIC on a Multus L2 segment shared with a `nettools:1` studio host |
| `ctr-nftables-backend` | 3 | nftables backend experimental in Engine 29; confirm table/chain names |
| `ctr-image-mount-models` | 3 | confirm image mount options (readonly, image-subpath) on 29.x |
| `ctr-compose-oci-publish` | 3 | `docker compose publish` against plain-HTTP localhost registry may need insecure-registry |
| `ctr-containerd-store-migration` | 3 | depends on save/load between stores, `image inspect --platform`, imagetools against localhost:5000; disk heavy |
| `ctr-scan-triage-vex`, `ctr-scout-policy` | 4 | no trivy/grype/scout, no offline vulnerability DB |
| `ctr-cosign-sign-verify`, `ctr-content-trust-retired`, `xpe-image-sign-verify` | 4 | no cosign on docker-vm:29 (handoff pins cosign v2) |
| `ctr-notation-sign-verify`, `ctr-signed-only-gate` | 4 | no notation CLI on docker-vm:29 |
| wave 2 labs | 2 | unconfirmed items listed in the wave 2 section (kube play secrets, Quadlet at boot, oci-archive load, keep-id) |

### Verify queue by slot kind

Every containers lab is a `jumphost:1` workstation pod plus one `docker-vm:29` KubeVirt VM (wave 2: `el-vm:10` plus a `docker-vm:29` registry VM), so the whole domain uses the vm slot, one `labctl verify` at a time. No kubeadm or netdev labs.

- pod: none.
- vm, ready to verify: wave 1 minus 5 blocked (18 labs; xcd tasks first, then learning labs), wave 2 (21; learning labs first, after confirming Podman on `el-vm:10`), wave 3 minus the 5 blocked (18; Compose labs first, then storage and basic networking, then namespace firewall labs and `ctr-net-mtu-hang`), wave 4 after #114 is fixed and merged (18 of 25 not image-blocked).
- kubeadm: none.
- netdev: none.
- Kata-blocked: none individually. The tier-B Kata `dockerd:29` variants are not built, so every lab runs as tier C (VM) only.
- image-blocked (verify only after the docker-vm rebuild or tool install): `ctr-buildx-cache-export`, `xcd-build-multistage-nonroot`, `xcd-supply-sbom-sign`, `ctr-scan-triage-vex`, `ctr-scout-policy`, `ctr-cosign-sign-verify`, `ctr-content-trust-retired`, `xpe-image-sign-verify`, `ctr-notation-sign-verify`, `ctr-signed-only-gate`.
- infra-blocked: `ctr-macvlan-encoder` (second NIC).
- unconfirmed-behaviour, verify last: the remaining wave 1 and 3 items in the table above.
- Exam reboot pass of `sim-containers-docker` and `sim-containers-podman` is not part of `labctl verify`.

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
