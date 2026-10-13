# Docker Lab Runtime Options on a Kubernetes-Based Lab Platform (2025-2026)

Context: multi-tenant lab platform. Labs run as K8s pods (runc locally, Kata Containers in production) or KubeVirt VMs. No internet inside labs. The goal is to give each learner a real Docker Engine with Compose, BuildKit, networking and volumes. Research date: 2026-10-14.

## Docker-in-Docker (docker:dind and docker:dind-rootless): privilege and security

### Takeaway
Both official `docker:dind` and `docker:dind-rootless` images still need `--privileged`. The rootless variant is labelled "experimental". On a shared-kernel runtime (runc), a privileged learner pod is effectively host access, so plain dind on runc is not acceptable for multi-tenant production. Rootless Docker drops a set of features, notably overlay networks (so Swarm overlay networking does not work), SCTP, AppArmor, checkpoint, low ports and accurate source IPs.

### Cited Findings
- `docker:dind` requires `--privileged`. Docker Hub says this "provides full access to the host environment". Docker also says running Docker-in-Docker is generally not recommended. — [Docker Official Image: docker](https://hub.docker.com/_/docker)
- `docker:dind-rootless` "still requires `--privileged`", is called "experimental", and is a security issue that "needs to be treated appropriately". The default UID/GID is 1000 and the socket is at `/run/user/1000/docker.sock`. — [Docker Hub: docker](https://hub.docker.com/_/docker)
- Since 19.03 the dind images generate TLS certs (`DOCKER_TLS_CERTDIR`) and listen on 2376 with `--tlsverify`. Running without TLS is a "potential security issue" when containers share network namespaces, as in K8s pods, and "can lead to access to the host". — [Docker Hub: docker](https://hub.docker.com/_/docker)
- Docker Hub's production suggestions for nested daemons are to tune ulimits, `--pids-limit` and `--oom-score-adj` so the nested daemon is OOM-killed before the host one (its example is -500). — [Docker Hub: docker](https://hub.docker.com/_/docker)
- Rootless Docker requirements:
  - `newuidmap`/`newgidmap` (the `uidmap` package).
  - At least 65,536 subordinate IDs in `/etc/subuid` and `/etc/subgid`.
  - No setuid binaries other than those two.

  — [Docker docs: Rootless mode](https://docs.docker.com/engine/security/rootless/)
- Rootless storage drivers and their kernel requirements:
  - `overlay2` needs kernel 5.11+.
  - `fuse-overlayfs` needs kernel 4.18+ and the fuse-overlayfs package.
  - `btrfs` and `vfs` are also supported.
  - Ubuntu 24.04+ restricts unprivileged user namespaces, so it needs an AppArmor profile for rootlesskit when installed via script.

  — [Docker docs: Rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/)
- Rootless limits on resources: limits work only with cgroup v2 plus systemd. On cgroup v1, `--cpus`, `--memory` and `--pids-limit` are ignored. — [Docker docs: Rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/)
- Rootless networking limits:
  - Ports below 1024 need `net.ipv4.ip_unprivileged_port_start` or `CAP_NET_BIND_SERVICE`.
  - Ping needs `ping_group_range`.
  - Container IPs are namespaced and can't be reached from the host without `nsenter`.
  - `-p` does not propagate source IPs by default.
  - `--net=host` was namespaced inside RootlessKit until Engine v29.5.
  - User-mode network stacks (slirp4netns, pasta, gvisor-tap-vsock, and others) are slower.

  — [Docker docs: Rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/)
- Unsupported in rootless mode: AppArmor, checkpoint, overlay network, exposing SCTP ports. `--cap-add` applies only inside the user namespace. — [Docker docs: Rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/)
- Play with Docker (built on dind) had a container escape. CyberArk got code running on the PWD host, which would give root over the infrastructure and all students' containers. It was fixed after disclosure. — [CyberArk: How I Hacked Play-with-Docker](https://www.cyberark.com/resources/home/how-i-hacked-play-with-docker-and-remotely-ran-code-on-the-host)
- Docker itself argues that running Docker inside a container needs elevated privileges that undermine isolation. That is why Docker Sandboxes run a full Docker daemon inside a dedicated microVM per session. — [Docker blog: Why MicroVMs](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/)

### Inferences
- On the local runc dev environment, privileged dind is fine for a single trusted developer but must never be the production path. It is equivalent to giving each learner root on the node.
- Rootless dind cannot teach Swarm overlay networking, AppArmor profiles, SCTP or `-p 80:80` without sysctl tweaks. It is good only for teaching "rootless mode" itself, and that is better done inside a VM where the learner installs rootless Docker as a non-root user.

### Gaps
- No official doc lists the exact seccomp/AppArmor/`/dev/fuse` needs of `docker:dind-rootless` beyond "requires --privileged". I could not confirm whether a non-privileged rootless dind pod works with `hostUsers: false` plus `procMount: Unmasked` on K8s 1.36.

## Sysbox runtime

### Takeaway
Sysbox runs Docker, systemd and K3s inside unprivileged containers by mapping container root to an unprivileged host UID and virtualizing parts of /proc and /sys. Since Docker acquired Nestybox in May 2022, it has been community-maintained with best-effort support only, and Sysbox-EE is deprecated. Official K8s support is CRI-O only. containerd needs a source-built sysbox-runc. It still shares the host kernel. Not recommended as the production path for this platform, which already has Kata.

### Cited Findings
- Nestybox was acquired by Docker in May 2022. Sysbox is "not officially supported by Docker", with best-effort support via GitHub and Slack. Sysbox Enterprise is deprecated and some of its features are being folded into Docker Desktop. — [GitHub nestybox/sysbox](https://github.com/nestybox/sysbox)
- Sysbox runs systemd, Docker, K8s and K3s inside containers "without modification" and with no rootless variants. Container root maps to an unprivileged host user through the user namespace. procfs and sysfs are partially virtualized. It can coexist with runc and Kata. — [GitHub nestybox/sysbox](https://github.com/nestybox/sysbox)
- Sysbox installs on K8s via the `sysbox-deploy-k8s` DaemonSet with `runtimeClassName: sysbox-runc`. The recommended host minimum is 4 CPUs and 4 GB RAM, on amd64 and arm64. — [GitHub nestybox/sysbox](https://github.com/nestybox/sysbox)
- Isolation limits: there is no hardware virtualization, and Sysbox "does not yet match the isolation of VM-based alternatives or gVisor". Kernel CVEs have reduced isolation in the past (fixed in recent kernels). — [GitHub nestybox/sysbox](https://github.com/nestybox/sysbox)
- Containerd status as of Sept 2025: Sysbox officially supports only CRI-O. containerd 2.0 userns support was blocked by a sysbox-runc bug. The fix is merged in sysbox-runc but needed a build from `main`. The integration is "still evolving". The pod spec uses `runtimeClassName: sysbox-runc` plus `hostUsers: false` and no privileged mode. — [K3s blog: k3s + sysbox (2025-09-27)](https://docs.k3s.io/blog/2025/09/27/k3s-sysbox)
- A third-party index showed the last repo push around 2025-05-03, and no 2025 release tag was found. — [awesome.ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fnestybox%2Fsysbox) (approximate, unverified)

### Inferences
- Sysbox is the most "container-native" way to give a real, non-rootless dockerd without privileged mode. However, its maintenance cadence, the CRI-O-only support and the shared kernel make it a weaker production bet than Kata in 2026.
- Sysbox cannot run inside Kata, and the platform already runs Kata in production, so adding Sysbox would mean a second sandbox runtime to operate.

### Gaps
- I found no current (2026) Sysbox release version or date. The GitHub releases section was not visible.
- I did not verify Sysbox's compatibility with K8s 1.36 or containerd 2.x as of 2026.

## Kata Containers: dockerd inside a Kata pod

### Takeaway
This is the strongest pod-based option. A `privileged: true` container in a Kata pod is privileged only inside its own guest VM, provided containerd or CRI-O sets `privileged_without_host_devices = true`. Practical gotchas:
- overlay2 fails on virtiofs, so use fuse-overlayfs (needs `mknod /dev/fuse`) or vfs, or put `/var/lib/docker` on a block device or emptyDir. Note that "invalid argument" comes from overlay-on-virtiofs.
- virtiofs needs `--xattr`.
- There is about 160 MiB of memory overhead per pod and a few seconds of extra boot time.

### Cited Findings
- By default, privileged Kata containers get all host `/dev/*` block devices hot-plugged into the guest, which weakens isolation. `privileged_without_host_devices = true` disables this. It is supported since containerd 1.3.0 and CRI-O 1.16.0. — [Kata docs: privileged.md (mirror)](https://github.com/superfly/kata-containers/blob/main/docs/how-to/privileged.md)
- A Kata DinD recipe:
  1. Add `privileged_without_host_devices = true` to the containerd kata runtime section.
  2. Create a privileged pod with `runtimeClassName: kata`.
  3. Verify the host disks are not visible in `/dev`.
  4. Start `dockerd --storage-driver=vfs`.

  — [Benkard: Docker in a Kata pod](https://matthias.benkard.de/posts/814)
- Notes from a Kata CI-runner write-up (Aug 2026):
  - The dind sidecar runs `privileged: true`, and that privilege applies only inside the guest VM.
  - overlay2 fails on virtiofs ("failed to mount overlay: invalid argument"), so the author uses fuse-overlayfs. The official docker:dind image lacks that binary.
  - `/dev/fuse` is not populated, so the author runs `mknod /dev/fuse c 10 229`, which works because of CAP_MKNOD inside the VM.
  - virtiofsd needs `--xattr` (via `virtio_fs_extra_args`), or image layers that carry file capabilities fail to extract.
  - Pod overhead in the RuntimeClass is `podFixed` 160Mi and 250m CPU.
  - VM start adds "a few seconds".
  - Guest kernel updates require rolling pods.

  — [encircle360: CI Runners in a microVM with Kata](https://encircle360.com/en/blog/ci-runners-kata-containers-microvm)
- The Kata guest kernel has FUSE built in (virtiofs depends on it). — [encircle360](https://encircle360.com/en/blog/ci-runners-kata-containers-microvm)

### Inferences
- Within a single Kata pod, the learner gets real (rootful) dockerd, bridge networks, iptables/nftables rules in the guest kernel, volumes, Compose and BuildKit. The guest kernel config determines which netfilter, macvlan, ipvlan, vxlan and binfmt_misc features exist. The Kata guest kernel config should be checked or customized for the `macvlan`, `vxlan`, `br_netfilter`, `ip_vs` and `binfmt_misc` modules.
- An emptyDir backed by a Kata block device, or a local volume as a block device, would likely avoid the overlay-on-virtiofs issue and allow overlay2. This is unverified and needs a spike.
- A multi-node Swarm with overlay networks across several Kata pods is likely to work if the pod network permits TCP 2377, TCP/UDP 7946 and UDP 4789 (VXLAN) between the learner's pods. The CNI and NetworkPolicy must allow it, and VXLAN-over-pod-network MTU must be considered. This is unverified.
- macvlan and host networking inside a pod attach to the pod's eth0 (veth/tap inside the guest), not a real L2 segment. They "work" mechanically but are less authentic than in a VM with Multus secondary networks.

### Gaps
- I found no official Kata 2025-2026 doc specifically covering Docker-in-Kata storage best practice (block-device emptyDir vs fuse-overlayfs).
- I found no benchmark of overlay2-on-block vs fuse-overlayfs inside Kata.

## KubeVirt VMs with Docker installed

### Takeaway
This is the most authentic option: a full kernel, systemd and real dockerd, rootless mode taught exactly as in production, and Multus secondary networks for multi-node Swarm, macvlan and iptables/nftables labs. The costs are higher per-learner memory and slower boot than Kata pods. This is what Killercoda and iximiuz Labs effectively do: VMs, not containers, for learner environments.

### Cited Findings
- Density: a Red Hat/IBM scale test targeted 500 VMIs per node but became unstable, and set a safe limit of 400 VMIs per node with small VMs. Control-plane scalability became the bottleneck as VMs per node increased. — [Red Hat: KubeVirt scale test 400 VMIs per node](https://www.redhat.com/en/blog/kubevirt-scale-test-creating-400-vmis-per-node); [FOSDEM 2022 talk](https://archive.fosdem.org/2022/schedule/event/vai_kubevirt_scale/)
- To measure startup latency, use `kubevirt_vmi_phase_transition_time_from_creation_seconds` (kube-burner with a containerDisk VM). — [Red Hat: kube-burner KubeVirt](https://www.redhat.com/de/blog/introducing-kubevirts-crd-support-for-kube-burner-to-benchmark-kubernetes-and-openshift-creation-of-vms)
- Killercoda (third-party account): uses containers for its infrastructure but VMs (KubeVirt, via a custom Go operator) for interactive learner environments, because containers share a kernel. — [ITNEXT: KubeVirt on Killercoda on KubeVirt](https://itnext.io/kubevirt-on-killercoda-on-kubevirt-3bc02f7eac7f) (summary via search result; page fetch returned 403)

### Inferences
- Use VMs for the "advanced/authentic" Docker modules:
  - multi-node Swarm with overlay networks and routing mesh
  - macvlan/ipvlan on a real L2 secondary network
  - `--network host`
  - inspecting and editing Docker's iptables/nftables chains (DOCKER, DOCKER-USER)
  - installing Docker from packages
  - rootless mode setup
  - systemd unit/daemon.json management
  - docker context over SSH between hosts
- Pre-pull the course images into the VM golden image (containerDisk or DataVolume clone). Optionally use VM pools or pre-warmed VMs to hide boot time.

### Gaps
- I found no published 2025-2026 boot-time figures for containerDisk-based KubeVirt VMs. It needs internal measurement.

## Podman as an alternative inside pods

### Takeaway
Rootless Podman in a pod is documented and tested by Red Hat in privileged mode. Unprivileged setups need `/dev/fuse` (fuse-overlayfs), SETUID/SETGID capabilities, subuid/subgid entries in the image, and often unmasked /proc, which needs `hostUsers: false`. It is a useful complement for "Podman vs Docker" lessons but is not a substitute for Docker Engine skills (daemon, daemon.json, docker networks, Swarm).

### Cited Findings
- A Red Hat walkthrough runs Podman as UID 1000 in a `privileged: true` pod to build and run images. Rootless Podman cannot mount overlay but can mount FUSE, hence fuse-overlayfs. Rootless users cannot create device nodes, so `/dev/fuse` must be passed from the host. — [Red Hat: How to use Podman inside of Kubernetes](https://redhat.com/sysadmin/podman-inside-kubernetes) (via search snippet; full page fetch failed)
- A non-privileged variant (third-party blog, unverified) runs as UID 1000 with the SETUID, SETGID and SYS_CHROOT capabilities and a hostPath `/dev/fuse` CharDevice. — [oneuptime: Run Podman inside Kubernetes (2026)](https://oneuptime.com/blog/post/2026-03-18-run-podman-inside-kubernetes/view)
- `procMount: Unmasked` requires `hostUsers: false` and is prohibited by the restricted Pod Security Standard. — [oneuptime: procMount (2026)](https://oneuptime.com/blog/post/2026-02-09-proc-mount-type-isolation/view) (secondary source)
- Kubernetes user namespaces (`hostUsers: false`) went alpha in 1.25, beta in 1.30, enabled by default in 1.33, and GA in 1.36 (April 2026). — [Kubernetes blog: v1.36 userns GA](https://kubernetes.io/blog/2026/04/23/kubernetes-v1-36-userns-ga/)
- A 2026 test write-up reports that hostPath volumes are still writable as root under userns. — per search summary of [techplained](https://www.techplained.com/kubernetes-user-namespaces) (secondary)

### Inferences
- Inside a Kata pod, Podman can run as the guest's rootful user without host risk. That is simpler than fighting the unprivileged-runc requirements.
- On runc with `hostUsers: false` (K8s 1.36 GA), unprivileged nested containers become more feasible, but this needs a spike. Host-mounted `/dev/fuse` via hostPath is itself a policy exception.

### Gaps
- The official Podman "podman in a container" docs could not be fetched (404). I could not verify the exact current flags (`--security-opt label=disable`, `seccomp=unconfined`) from a primary source.

## Offline operation: images and private registries

### Takeaway
There is no internet in labs, so every image a lab uses must be pre-staged. There are three layers:
1. Pre-loaded images in the lab image (VM golden image, or `/var/lib/docker` seeded in the pod image or volume).
2. A shared, read-only, platform-run mirror registry (Harbor or zot) synced from upstream outside the lab network.
3. A per-learner private registry for push/pull exercises (a `registry:2` container started by the learner, or a per-lab namespace or project in Harbor/zot).

Daemon `registry-mirrors` only covers Docker Hub, so non-Hub images (ghcr, quay) need explicit rewriting or a curated catalog.

### Cited Findings
- The `registry` (distribution) pull-through cache:
  - Set `proxy.remoteurl` (for example `https://registry-1.docker.io`).
  - Only one upstream can be mirrored at a time.
  - Docker daemon `registry-mirrors` "supports only mirrors of Docker Hub".
  - TTL cleanup needs `delete` enabled.

  — [CNCF Distribution: Mirror recipe](https://distribution.github.io/distribution/recipes/mirror/)
- zot sync has two modes: active (`onDemand: false`) pre-syncs upstream images, and on-demand (`onDemand: true`) pulls and caches on first request. Concurrent on-demand requests trigger a single pull. — [Giant Swarm: zot tutorial](https://docs.giantswarm.io/tutorials/registry/zot/)
- Air-gapped pattern: a bastion host with internet fetches images and pushes them to the local registry inside the disconnected environment. — [IBM: Preparing for offline installation](https://www.ibm.com/docs/en/SSNPJM_3.0/installing_containers/preparing_operator_offline.html)

### Inferences
- Recommended layout:
  - A platform-level zot or Harbor runs in "active sync" mode on the connected side to mirror a curated allowlist (docker.io/library/*, the course's ghcr/quay images, BuildKit and binfmt images).
  - Lab networks get read-only pull access only.
  - In labs, set `registry-mirrors` for Docker Hub. For other registries, either rewrite references in lab content to the mirror host, or use containerd/Docker hosts.toml-style mirror config where available.
- Per-learner push/pull: the most authentic exercise is the learner running `docker run -d -p 5000:5000 registry:2` inside their own environment. This teaches insecure-registries, TLS and tagging, and needs the `registry:2` image pre-loaded. For "push to a shared company registry" lessons, provision a Harbor project per lab session with robot credentials, and garbage-collect it on teardown.
- Pre-load images into the VM golden image or the Kata pod volume. That avoids cold pulls and is resilient when the mirror is down.
- BuildKit multi-platform via QEMU needs `tonistiigi/binfmt` mirrored, plus the binfmt_misc kernel feature in the VM or Kata guest kernel.

### Gaps
- I did not verify Harbor 2.x proxy-cache features or per-project quotas from a primary source in this session.
- I found no zot-specific air-gapped documentation.

## How existing platforms isolate Docker labs

### Takeaway
The industry trend is clear: platforms that let untrusted users run real Docker give each learner a VM or microVM, not a shared-kernel container:
- iximiuz Labs: Firecracker microVMs, plus Cloud Hypervisor for nested virtualization.
- Killercoda: KubeVirt VMs.
- Docker's own Sandboxes: microVM with a full daemon.
- Instruqt: VMs or containers chosen per track.

Play with Docker used plain dind and suffered a host escape.

### Cited Findings
- iximiuz Labs:
  - Each playground is one or more VMs on bare-metal hosts, attached to bridge networks isolated per playground via network namespaces, and reached over SSH.
  - It uses Firecracker microVMs, with a custom kernel because Firecracker's default kernels lack Docker/K8s support.
  - It has custom rootfs images and multi-network playgrounds.
  - Cloud Hypervisor is used for nested virtualization, which the author notes has a larger attack surface.

  — [iximiuz: Playgrounds 2.0](https://iximiuz.com/en/posts/iximiuz-labs-playgrounds-2.0); [newsletter: nested virtualization](https://newsletter.iximiuz.com/posts/nested-virtualization-and-more-affordable-prices-come-to-iximiuz-labs)
- Killercoda uses VMs via KubeVirt for learner environments. — [ITNEXT](https://itnext.io/kubevirt-on-killercoda-on-kubevirt-3bc02f7eac7f) (third-party)
- Play with Docker runs on Docker-in-Docker. It allows 5 instances per session and deletes sessions after 4 hours. It had a CyberArk-reported host escape. — [CyberArk](https://www.cyberark.com/resources/home/how-i-hacked-play-with-docker-and-remotely-ran-code-on-the-host); [PWD repo forks](https://github.com/3l3n01/play-with-docker)
- Instruqt sandbox hosts can be VMs (up to 32 vCPU and 208 GB) or containers (up to 8 GB, max 15 containers/services per sandbox). Containers are suggested for fast loading and lightweight apps. — [Instruqt quotas](https://docs.instruqt.com/reference/platform/quotas-and-limits); [Instruqt add hosts](https://docs.instruqt.com/sandboxes/hosts/add-hosts)
- Docker Sandboxes: each session gets a dedicated microVM running a full Docker daemon, isolated from the host and other sandboxes. — [Docker blog: Why MicroVMs](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/); [Docker docs: sandboxes architecture](https://docs.docker.com/ai/sandboxes/architecture)

### Inferences
- The platform's Kata (production) and KubeVirt combination maps directly onto the industry pattern: Kata ~ Firecracker microVM, and KubeVirt ~ Killercoda.

### Gaps
- I found no primary source for KodeKloud's lab isolation technology.
- Instruqt's Docker tracks typically use VM hosts (inferred from docs), but I did not confirm that.
- I found no current (2025-2026) primary documentation of Killercoda's architecture.

## Authenticity matrix: which Docker skills work in each option (and recommendation)

### Takeaway
Use a two-tier design:
- **Tier 1, default:** Kata pod with rootful dockerd, `privileged` inside the guest only, `privileged_without_host_devices=true`. Use it for ~80% of Docker labs: CLI, images, Dockerfile, BuildKit, Compose, bridge networks, volumes, local registry, basic security.
- **Tier 2:** KubeVirt VMs (multi-VM, Multus) for Swarm multi-node, macvlan/ipvlan, host networking, iptables/nftables, rootless-mode installation, daemon/systemd administration and multi-host contexts.
- **Local dev (runc):** privileged dind is acceptable only for authors and developers, never for learners.
- Reject Sysbox: maintenance risk and a second runtime. Reject rootless dind as the main path: still privileged, and too many features lost.

### Cited Findings (basis for the matrix)
- Rootless mode loses overlay networks, SCTP, AppArmor, checkpoint, low ports, source-IP propagation and cgroup v1 limits. — [Docker rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/)
- Kata privileged works inside the guest and needs storage-driver adjustments. — [encircle360](https://encircle360.com/en/blog/ci-runners-kata-containers-microvm)
- Sysbox is a shared kernel with weaker isolation than VMs. — [nestybox/sysbox](https://github.com/nestybox/sysbox)
- dind is privileged, giving full host access on runc. — [Docker Hub: docker](https://hub.docker.com/_/docker)

### Inferences (matrix; Y = authentic, P = partial/caveat, N = not possible)

| Skill | dind on runc (privileged) | rootless dind | Sysbox | Kata pod + dockerd | KubeVirt VM(s) |
|---|---|---|---|---|---|
| CLI, images, Dockerfile, volumes, bridge networks | Y | Y | Y | Y (storage driver tweak) | Y |
| Compose, BuildKit/buildx | Y | Y | Y | Y | Y |
| Multi-platform via QEMU binfmt | Y (host binfmt, global side effect!) | N/P | P | Y if guest kernel has binfmt_misc | Y |
| Local registry push/pull | Y | Y | Y | Y | Y |
| Ports <1024, `-p 80:80` | Y | P (sysctl) | Y | Y | Y |
| iptables/nftables DOCKER chains | P (pod netns) | N/P (namespaced) | Y (container netns) | Y (guest kernel) | Y |
| `--network host` | P (= pod netns) | P | P | P (= pod/guest netns) | Y |
| macvlan/ipvlan on real L2 | P | N | P | P (pod eth0 only) | Y (Multus) |
| Swarm single-node | Y | P (no overlay) | Y | Y | Y |
| Swarm multi-node + overlay | P (multi-pod, CNI must pass VXLAN) | N | P | P (needs spike) | Y |
| AppArmor/seccomp profiles | P | N (AppArmor) | P | P (guest LSM) | Y |
| Rootless mode setup (as a lesson) | P | P (already rootless) | P | P | Y |
| systemd/daemon.json/package install | N/P | N | Y | P (no systemd by default) | Y |
| Multi-tenant safety | Unsafe | Unsafe (still privileged) | Medium (shared kernel) | Strong (VM boundary) | Strong |

- Mirror course images into a platform zot or Harbor (active sync, allowlist). Pre-load per-lab images into the Kata/VM image, set `registry-mirrors`, and pre-load `registry:2` for per-learner registries.

### Gaps
- Multi-node Swarm with overlay networks across Kata pods is not verified. It is recommended as a spike, along with overlay2 on a block-backed emptyDir in Kata.
- I found no measured boot-time comparison of Kata pod vs KubeVirt VM for Docker-ready labs.
