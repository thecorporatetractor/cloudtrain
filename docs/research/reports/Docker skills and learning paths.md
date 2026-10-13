# Build CloudTrain's Docker domain on VM boundaries

CloudTrain should build its Docker/containers domain as a **13-domain skill graph that uses EX188's performance-based style and the OCI specs as its vendor-neutral spine**. The DCA should serve only as a topic map with its legacy items flagged. Labs should run in **rootful dockerd inside Kata pods for roughly 80% of the skills**, with **KubeVirt VMs for the host-level remainder** and **no privileged dind on runc for any learner**. No current certification defines what a Docker practitioner should know in 2026. The Docker Certified Associate is still sold by Mirantis, but its only public blueprint dates from August 2020 and centres on Swarm and the defunct UCP/DTR stack. Docker Inc. offers no certification at all. Meanwhile, the platform has changed under the old curricula. Engine 29 made the containerd image store the default, deprecated cgroup v1, added an experimental nftables backend and removed Docker Content Trust from the CLI. The Notary v1 service behind DCT shuts down permanently on **December 8, 2026**, and Docker Hardened Images became free and Apache-2.0 licensed in December 2025. A curriculum built from the DCA or from pre-2025 tutorials would teach signing that no longer works and storage internals that fresh installs no longer use. The opportunity is also concrete: Play with Docker shut down on March 1, 2026, and every credible competitor (iximiuz Labs, Killercoda, Docker's own Sandboxes) isolates learners with a VM or microVM. That is exactly the Kata-plus-KubeVirt split CloudTrain already has.

## No live certification defines Docker skill in 2026, so anchor on three sources

The credential landscape is fragmented and mostly stale. Only one exam actually tests hands-on container work.

**The DCA is alive but frozen.** Mirantis still schedules it at **$199/EUR 200**: 90 minutes, 13 multiple-choice plus 42 DOMC items, remote proctored on Windows or Mac only, with no retirement notice ([Mirantis DCA exam page](https://training.mirantis.com/certification/dca-certification-exam/)). The study guide is labelled v1.5 in its filename but says **Version 1.4, August 2020** in its text. The exam is entirely knowledge-based, even though its objectives say "describe and demonstrate" ([DCA Study Guide PDF](https://a.storyblok.com/f/146871/x/6daa07336d/docker-study-guide_v1-5-october.pdf)). Its six domains are weighted as follows: Orchestration 25%, Image Creation/Management/Registry 20%, and Installation/Configuration, Networking and Security at 15% each, with Storage and Volumes at 10%. Third-party guides from 2025 and 2026 repeat the same weights ([KodeKloud](https://kodekloud.com/blog/docker-certification/); [ExamCert](https://www.examcert.app/blog/docker-certified-associate-guide/)). The claim that "the DCA is retired" comes from Docker Inc. winding down its own program after it sold Docker Enterprise to Mirantis in 2019. KodeKloud confirms that registration remains open, but it notes that hiring visibility has fallen and recommends KCNA, CKA or CKAD instead ([KodeKloud](https://kodekloud.com/blog/docker-certification/)).

Roughly **20-25% of DCA sub-objectives are now legacy**. These are everything that depends on UCP/DTR (rebranded MKE/MSR): RBAC and LDAP integration, client bundles, DTR scanning and HA Enterprise deployment, plus Interlock L7 load balancing, devicemapper configuration and enabling Content Trust. The rest maps cleanly onto modern skills. Its Swarm items (quorum, replicated versus global services, placement constraints, stack deploy, Go templates) are still technically valid because Swarm ships in Engine. Its image, network and storage items are current, apart from the storage-driver framing.

**Docker Inc.'s own curriculum is its documentation.** It has three layers: Get Started with a "Docker concepts" series, Guides that include a growing set of interactive `lab-*` modules, and per-product Manuals covering Build/BuildKit/Bake, Compose, Engine, Scout, Hardened Images and Testcontainers ([docs.docker.com/llms.txt](https://docs.docker.com/llms.txt)). The lab guides run from container basics through image building (caching, multi-stage, non-root, build secrets), Compose (healthchecks, watch, multiple files), containerized SDLC, attestations (SBOM, provenance, signatures, VEX) and migrating a Node app to Hardened Images, with an optional AI track ([Docker docs full index](https://docs.docker.com/llms-full.txt)). This is the closest thing to an official learning path. It is also the main source for modern topics the DCA never covered: BuildKit cache backends and exporters, Bake, build checks and policies, Compose watch/profiles/include/OCI publishing, Scout policies and VEX.

**Red Hat EX188 is the only performance-based container exam.** It is now titled **Red Hat Certified Developer in Cloud-native Applications**: 150 minutes on a live system targeting RHEL 10, Podman v5 and OCP 4.22, with product documentation available. Configurations must survive normal lifecycle events, which in practice means reboots ([Red Hat EX188](https://www.redhat.com/en/services/training/ex188-red-hat-certified-specialist-containers-exam)). Its five areas, paraphrased, are:

1. Building images from a Containerfile: base selection, user, workdir, ports, ENV/ARG, CMD/ENTRYPOINT, volumes with SELinux labels, rootless permissions.
2. Managing images: private registry auth and TLS, registries.conf, tagging, backing up an image versus a container's state.
3. Running and inspecting containers locally.
4. Assembling multi-container applications with dependencies, secrets and volumes.
5. Troubleshooting through logs, inspection and exec.

The older EX180 is retired ([Red Hat Learning Community](https://learn.redhat.com/t5/Containers-DevOps-OpenShift/Differences-between-EX180-and-EX188/m-p/35884)). The reboot-survival rule implies systemd integration (Quadlet), even though it is not a named objective.

**The remaining anchors are shallower but useful.** In the KCNA curriculum (revised November 2025), container topics sit inside the 28% Container Orchestration domain alongside Kubernetes Fundamentals at 44% ([CNCF curriculum repo](https://github.com/cncf/curriculum/tree/master/kcna)). LFS253 Containers Fundamentals is active: about 40 hours, $299, last updated May 2026. Its chapters run from virtualization through runtimes, images, operations, building, networking and storage to security, and it explicitly works across multiple runtimes ([Linux Foundation LFS253](https://training.linuxfoundation.org/training/containers-fundamentals/)). The OCI specifications are the most durable anchor because they outlive any vendor's CLI:

- **Image spec v1.1.1**: manifests, indexes, config, layers and artifacts guidance.
- **Runtime spec v1.3.0**: bundle and lifecycle, with runc as the reference implementation.
- **Distribution spec v1.1.1**: the registry HTTP API, including the **Referrers API**, which is how signatures and SBOMs attach to images today.

([image-spec](https://github.com/opencontainers/image-spec), [runtime-spec](https://github.com/opencontainers/runtime-spec), [distribution-spec](https://github.com/opencontainers/distribution-spec))

| Anchor | Status Oct 2026 | Format | Use in CloudTrain |
|---|---|---|---|
| Mirantis DCA | Sold, blueprint frozen Aug 2020 | 55 MC/DOMC, no live tasks | Topic map and "legacy exam prep" path. Flag UCP/DTR, Interlock, devicemapper and DCT items |
| Docker docs (concepts, `lab-*` guides, manuals) | Current, no certificate | Self-paced hands-on | Primary source for modern content and ordering |
| Red Hat EX188 | Current, renamed | 2.5 h live system | Model for performance-based grading. Podman track |
| CNCF KCNA | Current (Nov 2025 curriculum) | Knowledge exam | "Next step" bridge to the Kubernetes pack |
| LFS253 | Current (updated May 2026) | Self-paced labs | Foundations and multi-runtime coverage |
| OCI image/runtime/distribution specs | v1.1.1 / v1.3.0 / v1.1.1 | Specs | Vendor-neutral spine for internals, registry and supply-chain nodes |

The strategic point is that the only hands-on exam is Podman-based and the only Docker-branded exam has no hands-on tasks at all. A platform that turns the DCA's "describe and demonstrate" items into auto-graded end-state checks fills a gap no certifier fills.

## Engine 29, DCT retirement and free hardened images redraw the skill map

Three 2025-2026 changes force the taxonomy away from pre-2025 material.

**Engine 29 changed the defaults.** Engine 29.0.0 (November 10, 2025) made the **containerd image store the default for fresh installs**, except for daemons using userns-remap, where it is temporarily unavailable. The same release deprecated **cgroup v1**, with support promised until at least May 2029, and added experimental **nftables** firewalling via `firewall-backend`. It stopped auto-injecting legacy link environment variables, dropped the default `nofile` ulimit from 1,048,576 to **1024**, and **removed Docker Content Trust from the CLI**. Later point releases made further changes:

- 29.5.0 made `gvisor-tap-vsock` the default rootless network driver.
- 29.4.2 hardened seccomp against `AF_ALG` and `socketcall(2)`, which can break 32-bit programs.
- 29.6.0 added an image attestations API.
- 29.7.0 graduated the `image` mount type and added experimental embedded containerd.
- 29.9.0 (October 8, 2026) enabled lazy-pull for known remote snapshotters.

([Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)) Before that, Docker 28.0 had already hardened the iptables rules that make published ports reachable from remote hosts ([Docker Engine 28 release notes](https://docs.docker.com/engine/release-notes/28/)). Each of these changes is a ready-made troubleshooting lab, because each one silently breaks something that worked on Engine 27.

**Signing moved from DCT to Sigstore and Notation.** Docker announced the DCT retirement in July 2025. Fewer than **0.05% of Hub pulls** used it, and the Notary v1 upstream is unmaintained. Official Image signing certificates began expiring on August 8, 2025, so pulls with `DOCKER_CONTENT_TRUST=1` fail ([Docker: Retiring DCT](https://www.docker.com/blog/retiring-docker-content-trust/); [migration guidance](https://www.docker.com/blog/docker-content-trust-retirement-and-migration-guidance/)). After brownouts, notary.docker.io shuts down for good on December 8, 2026 ([Docker docs: Retired](https://docs.docker.com/retired/)). Any signing lab must teach cosign or Notation with OCI referrers. DCT belongs only in a short "what changed and why" note.

**Hardened images became a default rather than a premium.** Docker Hardened Images launched commercially in May 2025. On **December 17, 2025** the 1,000+ image catalog became **free under Apache 2.0**, pulled from dhi.io with Hub credentials. The images are rootless by default and distroless where possible, and ship with signed SBOMs, VEX and SLSA Build Level 3 provenance ([Docker blog](https://www.docker.com/blog/docker-hardened-images-for-every-developer/); [DHI docs](https://docs.docker.com/dhi/)). Paid Select and Enterprise tiers add FIPS/STIG variants, a 7-day critical-CVE SLA and extended lifecycle support. The marketing claim needs qualifying in lab content. "Near-zero CVEs" means **at release**: a third-party tester found 8 low-severity unfixed CVEs in the DHI Node.js image on launch day ([ITNEXT](https://itnext.io/docker-hardened-images-are-free-538fbccabaf3)). That gap between scanner output and VEX status makes a good triage exercise.

### The consolidated taxonomy: 13 domains, beginner to advanced

The taxonomy below merges four inputs: the DCA's domains (with legacy items replaced), EX188's five areas, Docker's manual structure, and iximiuz's module order. That order runs run → build → pull/push → network → storage, with security, debugging and observability as cross-cutting topics ([iximiuz Labs Docker roadmap](https://labs.iximiuz.com/roadmaps/docker)). Levels are B (beginner), I (intermediate) and A (advanced). Skills marked † come from practitioner knowledge rather than a source fetched in this research pass. They are sound curriculum choices, but their exact flags and minimum versions should be confirmed before lab authoring.

| Domain | Competency | Skills (level) |
|---|---|---|
| **1. Foundations and CLI** | Concepts | Containers vs VMs; image/container/registry model; OCI's role (B) |
| | Container lifecycle | `run`/`ps`/`logs`/`exec`/`stop`/`rm`; detached vs interactive; env vars; overriding defaults (B) |
| | Inspection and cleanup | `inspect` with `--format`/`--filter`; `system df`/`prune` (B) |
| **2. Image building** | Dockerfile authoring | Instructions; COPY vs ADD (ADD for checksum-verified remote artifacts); build context and `.dockerignore`; exec-form CMD/ENTRYPOINT; absolute WORKDIR (B) ([best practices](https://docs.docker.com/build/building/best-practices/)) |
| | Efficient images | Cache-aware ordering; combined `apt-get` RUN with cleanup; multi-stage and shared stages; slim/alpine/distroless/scratch/DHI bases (I) |
| | Runtime correctness | Non-root USER with explicit UID/GID; PID 1 and signal handling via `exec`, `--init`/tini†, STOPSIGNAL†; HEALTHCHECK† (I) |
| | Reproducibility | Digest pinning with automated bumps (Dependabot, Scout); `--pull` vs `--no-cache`; `SOURCE_DATE_EPOCH`† (I/A) |
| **3. BuildKit and buildx** | Build mounts | `RUN --mount=type=cache` and `type=bind`; `type=secret`† and `type=ssh`†; heredocs (I) ([cache optimisation](https://docs.docker.com/build/cache/optimize/)) |
| | Builders and platforms | Builder drivers (docker, docker-container, kubernetes, remote); multi-platform via QEMU/binfmt, native nodes or cross-compiling with TARGETPLATFORM† (A) |
| | Cache and export | Cache backends (inline, registry `mode=max`, local, gha, s3); exporters (image, local, tar, oci) (A) |
| | Build-as-code | Bake targets, groups and matrices; build checks (`--check`); build policies (A) ([Build manual](https://docs.docker.com/build/)) |
| **4. Compose** | Application model | Services, networks, volumes; `.env` and interpolation†; project naming; `compose config`; `run --rm` (B/I) |
| | Orchestrating startup | `depends_on` with health/completion conditions†; per-service healthchecks; profiles† (I) |
| | Composition | Multiple `-f` files and override merge; `include`/`extends`†; secrets and configs† (I) |
| | Inner loop | `develop.watch` with sync, rebuild and sync+restart; watch prerequisites (writable target, `stat`/`mkdir` in image, build-based services only) (I) ([file watch](https://docs.docker.com/compose/how-tos/file-watch/)) |
| | Distribution | Publishing Compose apps as OCI artifacts; Compose Bridge to Kubernetes (A) |
| **5. Networking** | Bridge fundamentals | Default vs user-defined bridge and embedded DNS†; aliases; reaching containers without publishing (B/I) |
| | Port publishing | `-p` scope (0.0.0.0, 127.0.0.1, private IP); `-P`; Docker 28 published-port hardening (I) ([iximiuz challenges](https://labs.iximiuz.com/challenges?category=containers)) |
| | Drivers | host, none, macvlan, ipvlan, overlay; `--network container:` sidecar pattern† (I/A) |
| | Host integration | iptables chains and DOCKER-USER†, UFW bypass†; nftables backend (experimental, 29.0); address pools and CIDR clashes†; IPv6†; MTU† (A) |
| | Diagnosis | nsenter, netshoot, tcpdump on veth; `network inspect` (A) |
| **6. Storage** | Mount types | Volumes vs bind mounts vs tmpfs; `--mount` vs `-v`; read-only mounts; `image` mounts (B/I) |
| | Data operations | Volume backup and restore via a throwaway container†; UID/GID permission mismatches; SELinux `:z`/`:Z` (I) |
| | Storage backends | overlay2 graphdriver vs containerd image store (default on fresh 29.x); `/var/lib/docker` vs `/var/lib/containerd`; disk hygiene (A) |
| **7. Runtime security** | Least privilege | `--user`; `--cap-drop ALL` + selective add; why `--privileged` is dangerous; `no-new-privileges`; read-only rootfs + tmpfs; pids and memory limits† (I) |
| | Kernel controls | seccomp profiles (including the 29.4.2 changes); AppArmor template (29.8); SELinux labels (A) |
| | Daemon protection | Docker socket as root-equivalent (CIS 5.32); socket proxies; TLS/SSH daemon access; rootless mode vs userns-remap (A) ([Wazuh CIS](https://wazuh.com/blog/scanning-docker-infrastructure-against-cis-benchmark/)) |
| | Benchmarking | CIS Docker Benchmark sections; docker-bench-security pass/warn/fail (I/A) ([CubePath](https://cubepath.com/docs/docker-advanced/docker-bench-security-audit)) |
| **8. Supply chain** | Scanning and triage | Docker Scout, Trivy, Grype†; VEX exceptions; Scout policies (I) ([Scout docs](https://docs.docker.com/scout/)) |
| | SBOM and provenance | BuildKit `--sbom`/`--provenance=mode=max`†; Syft†; SLSA build levels (A) |
| | Signing | cosign keyless and key-based†; Notation; verifying via referrers; DCT retirement context (A) |
| | Hardened bases | Migrating to DHI; dev vs runtime variants; verifying DHI attestations (I/A) ([DHI docs](https://docs.docker.com/dhi/)) |
| | Secrets hygiene | Build secrets vs ENV/ARG leaks; removing a leaked secret from history (I) |
| **9. Registries and distribution** | References | Tags vs digests; multi-arch indexes (`imagetools inspect`†); save/load vs export (I) |
| | Running registries | CNCF Distribution with TLS and htpasswd†; pull-through cache (Hub only); garbage collection; Harbor projects, robot accounts, retention, immutability† (I/A) ([Distribution mirror](https://distribution.github.io/distribution/recipes/mirror/)) |
| | Hub economics | Rate limits and quota headers; authenticated pulls; mirrors for CI (I) ([Hub pull limits](https://docs.docker.com/docker-hub/usage/pulls/)) |
| | OCI artifacts | Registry API with curl; referrers; artifacts with `oras`/`crane`/`skopeo` (A) |
| **10. Operations and troubleshooting** | Logging | Drivers (json-file, local, journald†); rotation via `log-opts`† (I) |
| | Resources | cgroup v2 limits; OOMKilled/137 vs SIGTERM/143†; ulimits (`nofile` 1024 in 29.x) (I) |
| | Lifecycle | Restart policies†; health status; `events`/`stats`; `live-restore`†; `default-stop-timeout` (I/A) |
| | Daemon admin | `daemon.json` keys†; systemd drop-ins and journald; Engine upgrades and API version floor (29.0 → v1.44, back to v1.40 in 29.3) (A) |
| | Debugging | `docker debug`/sidecar debugging of distroless images; startup-failure diagnosis (A) |
| | CI patterns | Build-push-scan-sign pipelines; dind vs socket mount vs rootless BuildKit in CI (A) |
| **11. Internals and OCI** | Linux primitives | Namespaces (including time, private by default since 29.5); cgroup v2 hierarchy; overlayfs layers; capabilities (A) |
| | Runtime stack | dockerd → containerd → shim → runc; `ctr`/`nerdctl` against the `moby` namespace; `runc spec`/`run` from a bundle; NRI and CDI (A) |
| | Image anatomy | Manifest, index, config, layers, whiteouts; reading a layout on disk (A) |
| | Escape awareness | runc CVEs (28.5.2 fixed three high-severity breakouts); mounted host paths; "am I in a container?" (A) |
| **12. Podman (parallel track)** | Docker parity | Containerfile builds; registries.conf; `podman inspect`/`events`/`logs` (B/I) ([EX188](https://www.redhat.com/en/services/training/ex188-red-hat-certified-specialist-containers-exam)) |
| | Podman-native | Rootless with UID mapping; pods; `podman secret`; `kube play`†; Quadlet/systemd so containers survive reboots (I/A) |
| | Image portability | `podman save`/`load`, `skopeo copy`; commit/export/checkpoint for container state (I) |
| **13. Swarm (optional, ~5-10%)** | Cluster | init/join; manager quorum (Raft); node drain and labels; autolock (I) |
| | Services | Replicated vs global; placement constraints; rolling updates; Go templates (I) |
| | Stacks | `stack deploy` from Compose; overlay and routing mesh vs host publish mode; secrets and configs (I/A) |

Two placement decisions in this table carry weight. First, Swarm is optional, but it is not deleted. Mirantis committed in July 2025 to support Swarm on MKE 3 **through 2030**, and the CIS benchmark keeps a Swarm section ([Mirantis](https://www.mirantis.com/blog/mirantis-guarantees-long-term-support-for-swarm/); [OneUptime CIS guide](https://oneuptime.com/blog/post/2026-01-16-docker-cis-benchmarks/markdown)). Even so, no adoption data shows it as a growth skill, and the Mirantis sources are vendor-interested. Second, the Linux primitives in domain 11 should be **shared nodes with the Linux pack**, not duplicated. The DCA, LFS253 and EX188 all touch them, and the graph is cleaner when the Docker domain declares a prerequisite edge rather than re-teaching namespaces.

## Nine learning paths order the graph from first container to signed images

The paths follow iximiuz's run-build-ship-network-store spine and branch after the foundations. Security never comes first, but non-root users and digest pinning appear inside the image-building path, so learners never practise insecure habits. The ordering is a design judgement. No published 2025-2026 framework quantifies which Docker sub-skills employers test most.

| # | Path | Level | Hard prerequisites | Core domains | Credential alignment |
|---|---|---|---|---|---|
| 1 | Docker Foundations | B | Linux pack: shell, users and permissions, processes | 1, intro of 6 and 9 | LFS253 early chapters; Docker concepts; KCNA containerization |
| 2 | Building Great Images | B→A | Path 1 | 2, 3, secrets part of 8 | DCA D2; EX188 areas 1-2; Docker `lab-building-images` |
| 3 | Compose for Developers | I | Paths 1-2 (first half) | 4 | Docker `lab-compose-quickstart`; EX188 area 4 |
| 4 | Container Networking | I→A | Path 1; Linux networking basics | 5 | DCA D4 (modernised) |
| 5 | Storage and Data | I | Path 1 | 6 | DCA D6 (devicemapper removed) |
| 7 | Registries and Distribution | I→A | Paths 1-2 | 9 | DCA D2 registry items; OCI distribution spec |
| 6 | Security and Supply Chain | I→A | Paths 2 and 7 (referrers needed for signing) | 7, 8 | DCA D5 (DCT → cosign/Notation); Docker `lab-attestation-basics`, `lab-dhi-node`; CIS |
| 8 | Troubleshooting and Production/CI | I→A | Paths 2-5 | 10 | DCA D3; EX188 area 5 |
| 9 | Internals | A | Paths 1, 2, 5; Linux namespaces and cgroups nodes | 11, 12 | LFS253 runtimes and security chapters; OCI runtime/image specs |
| opt | Podman Track | I | Path 1 | 12 | EX188 (all areas) |
| opt | Swarm Essentials | I | Paths 3-4 | 13 | DCA D1 |

The table lists path 7 above path 6 on purpose: a learner cannot meaningfully verify a cosign signature until they understand that it lives as an OCI referrer next to the image's digest. Inside path 2, the recommended internal order is:

1. Instructions, build context and `.dockerignore`.
2. Caching and multi-stage builds.
3. Non-root USER and PID 1 signal handling.
4. HEALTHCHECK and minimal bases.
5. Digest pinning.
6. BuildKit mounts and build checks.
7. Multi-platform builds, Bake and CI cache.

The first five steps make a solid intermediate developer. The last two belong to platform engineers.

Persona routes come from the same graph:

- **Developers:** paths 1-3 plus the beginner nodes of 4 and 5, then optional Testcontainers and Compose watch depth.
- **DevOps and platform engineers:** paths 1-5, 7 and 8, with Swarm optional.
- **Security engineers:** paths 1, 2, 6 and 9, plus the host-integration nodes of 4 and the registry nodes of 7.

For learners who want a credential, offer three labelled routes:

- **"Exam prep: DCA (legacy)"**, which overlays the DCA's weights on paths 1-5 and 7 and clearly flags the UCP/DTR objectives as not taught.
- **"Podman / Red Hat"**, which maps one-to-one onto EX188's five areas and is graded on the same end-state, reboot-surviving terms.
- **"Next step: Kubernetes"**, which hands off to KCNA and then CKAD/CKA in the Kubernetes pack.

## Kata pods carry most Docker labs; KubeVirt VMs carry the host-level remainder

The runtime decision follows from one fact. Both `docker:dind` and `docker:dind-rootless` still require `--privileged`, which Docker Hub says gives "full access to the host environment". The rootless image remains labelled experimental ([Docker Official Image: docker](https://hub.docker.com/_/docker)). On a shared-kernel runc node, a privileged learner pod is root on the node. Play with Docker learned this when CyberArk achieved code execution on the PWD host, which would have meant root over every student's containers ([CyberArk](https://www.cyberark.com/resources/home/how-i-hacked-play-with-docker-and-remotely-ran-code-on-the-host)). Docker's own Sandboxes product reaches the same conclusion and runs **a full Docker daemon inside a dedicated microVM per session** ([Docker blog: Why MicroVMs](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/)). Peer platforms agree. iximiuz Labs runs Firecracker microVMs with a custom kernel, plus Cloud Hypervisor for nested virtualization ([iximiuz Playgrounds 2.0](https://iximiuz.com/en/posts/iximiuz-labs-playgrounds-2.0)). Killercoda reportedly runs learner environments as KubeVirt VMs ([ITNEXT](https://itnext.io/kubevirt-on-killercoda-on-kubevirt-3bc02f7eac7f), a third-party account).

**Tier 1 is a Kata pod running rootful dockerd.** A privileged container in a Kata pod is privileged only inside its guest VM, provided the runtime handler sets **`privileged_without_host_devices = true`**. Without that setting, Kata hot-plugs all host block devices into the guest ([Kata privileged how-to](https://github.com/superfly/kata-containers/blob/main/docs/how-to/privileged.md)). A production Kata CI-runner write-up from August 2026 documents the practical costs. overlay2 on virtiofs fails with "invalid argument", so the author uses fuse-overlayfs, which needs `mknod /dev/fuse c 10 229` and is not shipped in the official dind image. virtiofsd needs `--xattr` or layers carrying file capabilities fail to extract. Each pod adds about **160 MiB and 250m CPU of overhead** and a few seconds of boot time ([encircle360](https://encircle360.com/en/blog/ci-runners-kata-containers-microvm)). A simpler recipe falls back to the vfs driver ([Benkard](https://matthias.benkard.de/posts/814)), but vfs makes the storage-driver lessons inauthentic and slow. CloudTrain should spike a **block-backed `/var/lib/docker`** so that overlay2 and the containerd snapshotter behave as they do on a real host. That fix is plausible but untested.

**Tier 2 is a KubeVirt VM, or several connected by Multus.** Use it for anything that needs a real host: package installation, systemd and `daemon.json` administration, `--network host`, editing iptables/nftables chains, macvlan/ipvlan on a real L2 segment, multi-node Swarm with overlay, rootless-mode setup and SSH contexts between hosts. Density is workable but finite. A Red Hat scale test settled on **400 small VMIs per node** after 500 proved unstable ([Red Hat KubeVirt scale test](https://www.redhat.com/en/blog/kubevirt-scale-test-creating-400-vmis-per-node)).

**Rejected options.** Rootless dind is not a main path. It is still privileged, and rootless mode loses overlay networks, SCTP, AppArmor, checkpoint, low ports and source-IP propagation ([Docker rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/)). Sysbox is not a production path either. Since Docker acquired Nestybox, it has received best-effort community support only, and Kubernetes support is officially CRI-O-only, with containerd needing a source-built sysbox-runc as of September 2025 ([nestybox/sysbox](https://github.com/nestybox/sysbox); [K3s blog](https://docs.k3s.io/blog/2025/09/27/k3s-sysbox)). It also cannot run inside Kata, so adopting it would add a second sandbox runtime. Privileged dind on runc stays confined to **local authoring by trusted developers**.

| Skill area (taxonomy domain) | Recommended runtime | Why |
|---|---|---|
| Foundations, CLI, inspection (1) | Kata pod | Fully authentic; fastest start |
| Dockerfile, BuildKit mounts, Bake, build checks (2, 3) | Kata pod | Authentic once the storage driver is fixed |
| Multi-platform builds via QEMU (3) | Kata pod if the guest kernel has binfmt_misc, else VM | On runc, binfmt registration is a host-global side effect |
| Compose, including watch (4) | Kata pod | Fully authentic |
| Bridge networks, port publishing, embedded DNS (5) | Kata pod | Guest kernel provides real netfilter |
| iptables/nftables chains, DOCKER-USER, UFW bypass, `--network host` (5) | KubeVirt VM | In a pod, "host" is only the pod/guest netns |
| macvlan/ipvlan (5) | KubeVirt VM with Multus | Pod eth0 is not a real L2 segment |
| Volumes, bind mounts, backup/restore, permissions (6) | Kata pod | Authentic |
| Storage-driver internals, containerd store migration (6, 11) | KubeVirt VM (Kata after the block-device spike) | virtiofs blocks overlay2 |
| Capabilities, no-new-privileges, read-only rootfs, limits (7) | Kata pod | Enforced by the guest kernel |
| Custom AppArmor/seccomp profiles, CIS host sections, docker-bench (7) | KubeVirt VM | Needs host LSM and host file layout |
| Docker socket escape and mitigation (7) | Kata pod (contained by the VM boundary) | Escape stays inside the guest |
| Rootless mode setup, userns-remap (7) | KubeVirt VM | Must be installed as a non-root user on a real host |
| Scanning, SBOM, provenance, signing, DHI (8) | Kata pod plus offline vulnerability DB | Tools are client-side; the DB must be mirrored |
| Local registry, Harbor, pull-through cache (9) | Kata pod (single learner); per-session Harbor project | Pre-load `registry:2` |
| Logging, limits, OOM, restart policies, debugging (10) | Kata pod | Authentic on cgroup v2 guest |
| daemon.json, systemd, Engine upgrades (10) | KubeVirt VM | Kata pods lack systemd by default |
| Runtime stack, `ctr`/`runc`, hand-built containers (11) | Kata pod for runc/ctr; VM for full host view | Either works; VM shows the real host chain |
| Podman rootless and Quadlet (12) | KubeVirt VM (Kata pod for basic Podman) | Quadlet needs systemd and reboot survival |
| Swarm single-node (13) | Kata pod | Authentic |
| Swarm multi-node with overlay and routing mesh (13) | KubeVirt VMs on Multus | VXLAN across Kata pods is unverified |

This split puts roughly 80% of nodes on the cheaper Kata tier. Most VM-only nodes cluster in advanced paths 4, 6, 8 and 9 and in the optional tracks, so beginners almost never wait for a VM to boot.

### Offline images need three layers and an allowlist

With no internet inside labs, every byte a lab pulls must be staged in advance. The first layer is **pre-loading**: each lab's images are baked into the VM golden image (containerDisk or DataVolume clone) or into the Kata pod's seeded `/var/lib/docker` volume. This removes cold pulls and keeps labs working when the mirror is down. The second layer is a **platform-run, read-only mirror** using zot or Harbor in active-sync mode. zot supports both pre-syncing (`onDemand: false`) and pull-on-first-request with deduplicated concurrent pulls ([Giant Swarm zot tutorial](https://docs.giantswarm.io/tutorials/registry/zot/)). The mirror fills from a connected bastion, the standard air-gap pattern ([IBM offline install](https://www.ibm.com/docs/en/SSNPJM_3.0/installing_containers/preparing_operator_offline.html)), against a curated allowlist. That allowlist covers `docker.io/library/*`, course-specific ghcr and quay images, the BuildKit image, `tonistiigi/binfmt`, `registry:2`, netshoot, and DHI images from dhi.io.

One trap shapes the lab content: **daemon `registry-mirrors` only mirrors Docker Hub**, and a Distribution pull-through cache proxies only one upstream ([CNCF Distribution mirror recipe](https://distribution.github.io/distribution/recipes/mirror/)). Non-Hub references must be rewritten to the mirror host in the lab content or handled with containerd `hosts.toml`-style configuration. The third layer is **per-learner registries**. The most authentic version has the learner run `registry:2` in their own environment, which teaches tagging, insecure-registry flags and TLS. For "push to the company registry" lessons, provision a Harbor project per session with robot credentials and garbage-collect it at teardown.

Offline operation also affects supply-chain labs in a way the notes only partly cover. Scout, Trivy and Grype all need a vulnerability database. Keyless cosign depends on the public Fulcio and Rekor services. And `docker scout` talks to Docker's backend. Expect key-based cosign and Notation with local trust stores to be the offline-friendly signing path. Scanner databases must be mirrored as OCI artifacts on a schedule. Running the platform's own mirror also solves a real cost problem. Docker Hub's current published limits are **100 pulls per 6 hours** for unauthenticated pulls per IP and 200 for free accounts ([Docker Hub pull limits](https://docs.docker.com/docker-hub/usage/pulls/)), and a fleet of labs behind one egress IP would exhaust that within minutes. The same mirror doubles as a "fix the 429 in CI" lab.

## Copy the broken-environment, end-state-graded scenario style

Two lab styles dominate the post-PWD market, and both avoid follow-the-tutorial steps. **iximiuz Labs challenges** state a single precise goal and check the end state automatically, with hints and feedback ([iximiuz Labs challenges](https://labs.iximiuz.com/challenges?category=containers)). Examples from its "Docker 101" set include:

- publishing PostgreSQL on localhost only
- publishing Redis on the private network only
- publishing all exposed ports on random host ports
- reaching a container without publishing a port

Its harder challenges include debugging a Go image that fails to start, reaching a distroless container's debug endpoint from a sidecar, and running tests without network access, which matches CloudTrain's offline environment. **SadServers** hands the learner a pre-broken machine, a measurable target and a time limit ([SadServers scenarios](https://sadservers.com/scenarios)). Its container scenarios include:

- shrinking a Node image from 916 MB to under 122 MB
- fixing a port conflict that stops a container from starting
- repairing an HAProxy-plus-two-Nginx Compose stack
- fixing Nginx routing without restarting containers
- finding the one correct image among many and tagging it `prod`
- controlling one container from another through the Docker socket
- fixing a stale BuildKit-versus-`docker build` mismatch
- repairing broken Postgres replication in Compose
- migrating a Docker Nginx service to rootless Podman under systemd
- working out whether you are in a container or a VM

Docker's own `lab-*` guides add a third, gentler style for first exposure: concept-plus-exercise walkthroughs.

CloudTrain should combine these styles into four scenario patterns, each graded by state rather than by command history.

**"Constraint" tasks** use the iximiuz style, where `docker inspect` or `ss` can verify the result. Examples are "published on 127.0.0.1 only", "runs as UID 10001", or "image under 80 MB with a passing healthcheck".

**"Pre-broken" tasks** use the SadServers style with a measurable fix. Engine 29 supplies a fresh set:

- an app that breaks after upgrade because `nofile` is now 1024
- a stack that relied on link environment variables
- a 32-bit binary killed by the new seccomp rules
- a CI job failing with 429 until the learner configures a mirror

**"Attack then mitigate" tasks** invert SadServers' socket scenario. The learner escapes via a mounted `docker.sock`, then closes the hole with a socket proxy or rootless mode. These are safe only because the Kata or VM boundary contains them.

**"Supply-chain chain" tasks** have the learner build with SBOM and provenance, push to a local registry, sign with cosign or Notation, then prove that an unsigned image is rejected, with the grader checking referrers through the registry API. Each pattern should be authored once and instantiated in both Docker and Podman variants where the skill transfers, because EX188's five areas map almost one-to-one onto the Docker nodes.

## Twelve claims need verification before lab authoring starts

The notes leave several material questions open. Most affect the runtime tier rather than the curriculum.

| # | Open question | Why it matters | How to resolve |
|---|---|---|---|
| 1 | Does overlay2 or the containerd snapshotter work on a block-backed `/var/lib/docker` inside Kata, avoiding virtiofs? | Decides whether storage-internals labs stay on the cheap tier | Internal spike; benchmark against fuse-overlayfs |
| 2 | Does multi-node Swarm overlay (TCP 2377, TCP/UDP 7946, UDP 4789) work across Kata pods on CloudTrain's CNI, and at what MTU? | Could move Swarm off VMs | Spike with NetworkPolicy allowing VXLAN |
| 3 | Does the Kata guest kernel ship macvlan, vxlan, br_netfilter, ip_vs and binfmt_misc? | Determines multi-platform and network-driver labs in pods | Inspect or customise guest kernel config |
| 4 | Does unprivileged rootless dind or Podman work on runc with `hostUsers: false` (user namespaces GA in Kubernetes 1.36)? | Possible lighter local-dev path | Spike; note that `procMount: Unmasked` violates the restricted PSS ([Kubernetes blog](https://kubernetes.io/blog/2026/04/23/kubernetes-v1-36-userns-ga/)) |
| 5 | Is devicemapper removed or only deprecated in current Engine? | Accurate legacy flagging of DCA D6 | Check the Engine deprecation list |
| 6 | Has Mirantis refreshed the live DCA item bank beyond the 2020 blueprint? | Legacy-path accuracy | Ask Mirantis directly |
| 7 | What exactly do EX188's per-version objectives in the Red Hat LMS say, and when did the rename happen? | Podman-track fidelity | Red Hat partner or LMS access |
| 8 | Which Docker Hub limits are authoritative: 100/6 h (current docs) or the 10/h announced for April 2025? | Mirror sizing and lab text | Re-check the docs page at authoring time |
| 9 | Which flags and minimum versions apply to the † items (build secrets, SSH mounts, Bake, `SOURCE_DATE_EPOCH`, `depends_on` conditions, `include`, `sync+exec`)? | Lab correctness | Fetch docs.docker.com Build and Compose Spec pages |
| 10 | What are the chain names and published-port behaviour under the nftables backend and Docker 28's raw-table hardening? | Networking lab correctness | Docker packet-filtering docs and a VM test |
| 11 | How do Scout, Trivy, Grype and cosign run fully offline (DB mirroring, private Rekor or key-based only)? | Supply-chain path viability | Spike in an air-gapped namespace |
| 12 | What are the actual boot times for Kata pods vs containerDisk KubeVirt VMs with pre-loaded images? | Warm-pool sizing and learner experience | Measure with kube-burner and `kubevirt_vmi_phase_transition_time_from_creation_seconds` ([Red Hat](https://www.redhat.com/de/blog/introducing-kubevirts-crd-support-for-kube-burner-to-benchmark-kubernetes-and-openshift-creation-of-vms)) |

Two smaller gaps belong on the same list. The roadmap.sh Docker node list could not be extracted, so the ordering here rests on iximiuz and the Docker docs. The catalogues for Killercoda's Docker category and Docker's Labspaces extension were not enumerated either. Both are worth a manual review for scenario ideas before authoring.

## Conclusion

The research shows that CloudTrain's main asset in this domain is its isolation model, more than its content. Every Docker-branded learning resource is either knowledge-only (the DCA), hosted on someone else's microVMs (iximiuz, Docker Sandboxes) or gone (Play with Docker). The labs that teach the 2025-2026 changes need a real kernel per learner: nftables chains, rootless networking, seccomp breakage, containerd-store internals and socket-escape mitigation. Kata pods plus KubeVirt provide exactly that, at a density where the expensive tier serves only advanced learners. That makes the runtime spikes in questions 1-3 the critical path. If overlay2 and VXLAN work inside Kata, almost the whole domain runs on the cheap tier.

The second implication is timing. Notary v1 goes dark on December 8, 2026, and free hardened images have made distroless, non-root, attested bases the expected default. A curriculum launched in 2027 that still teaches `DOCKER_CONTENT_TRUST=1` or 900 MB `node:latest` images would be visibly out of date. The domain should instead treat **digests, referrers and attestations as first-class objects from path 2 onward**. Supply-chain security then becomes the way images are built throughout the domain, not an advanced add-on. Pinning content to the OCI specs rather than to any vendor's CLI is what will let the graph survive Engine 30 and whatever replaces the DCA.
