# Docker / Container Skills for Developers, DevOps, Platform and Security Engineers (2025-2026): Topic List and Learning Paths

Research date: 2026-10-14. Budget-limited web pass of about 17 tool calls. Primary sources are official Docker docs and blogs where they were available. Under "Inferences", any item marked **[practitioner knowledge, unverified this pass]** comes from general domain knowledge and was not re-confirmed by a source in this pass. The report writer should treat those items as curriculum-design suggestions, not cited facts.

---

## 1. roadmap.sh Docker roadmap: nodes and ordering

### Takeaway
The roadmap.sh Docker roadmap is live and branded "Step by step guide to learning Docker in 2026". Its node list is rendered client-side, so I could not extract it this pass. iximiuz Labs runs a separate hands-on Docker roadmap built from five modules (Running Containers, Building Images, Pulling and Pushing Images, Container Networking, Container Storage), with security, debugging and observability as cross-cutting topics.

### Cited Findings
- roadmap.sh/docker exists and is titled "Docker Roadmap: Step by step guide to learning Docker in 2026". It has a companion projects page at roadmap.sh/docker/projects. — [roadmap.sh Docker](https://roadmap.sh/docker); [roadmap.sh Docker projects](https://roadmap.sh/docker/projects)
- The iximiuz Labs "Docker The Hands-On Way" roadmap has these modules in order: Running Containers, Building Images, Pulling and Pushing Images, Container Networking, Container Storage. It has two routes ("Must-Have" and "Digging Deeper") and three coverage levels (Must-have, Deep dive, Full). Security, debugging and observability are cross-cutting topics, and the roadmap is a graph of hands-on challenges grouped into topics. — [iximiuz Labs Docker roadmap](https://labs.iximiuz.com/roadmaps/docker)

### Inferences
- **[Practitioner knowledge, unverified this pass]** The roadmap.sh Docker roadmap has historically been ordered roughly as follows:
  1. Introduction: what containers are, why use them, bare metal vs VMs vs containers, Docker and OCI.
  2. Prerequisites: Linux fundamentals, shell, package managers, users/permissions, web app architecture.
  3. Underlying technologies: namespaces, cgroups, union filesystems.
  4. Installation/setup: Docker Desktop, Docker Engine.
  5. Basics of Docker.
  6. Data persistence: ephemeral container filesystem, volume mounts, bind mounts.
  7. Using third-party images: databases, interactive test environments, CLI utilities.
  8. Building container images: Dockerfiles, efficient layer caching, image size and security.
  9. Container registries: Docker Hub, alternatives, image tagging best practices.
  10. Running containers: docker run, docker compose, runtime configuration options.
  11. Container security: runtime security, image security.
  12. Docker CLI: images, containers, volumes, networks.
  13. Developer experience: hot reloading, debuggers, tests, CI.
  14. Deploying containers: PaaS options, Kubernetes, Nomad, Docker Swarm.

  The report writer should verify this against the live page before citing it.
- The roadmap.sh roadmap is breadth-first and introductory. It covers almost nothing on supply chain, BuildKit internals or rootless operation. The iximiuz roadmap is challenge-first. An enterprise skill graph should combine roadmap.sh's ordering with iximiuz's challenge-driven depth.

### Gaps
- I could not retrieve the exact roadmap.sh node list. The page is client-rendered, and GitHub paths to the roadmap data returned 404 because the repo layout has apparently changed.
- I could not get the topic and challenge list inside each iximiuz roadmap module. The page only shows module names without interaction.

---

## 2. Image building (Dockerfile, BuildKit, buildx, minimal images)

### Takeaway
Docker's official build guidance in 2025-2026 recommends:
- multi-stage builds and reusable common stages
- trusted, minimal base images pinned by digest, with automated digest updates
- `.dockerignore`
- exec-form CMD/ENTRYPOINT, with `exec` in wrapper scripts so the app is PID 1
- a non-root USER with explicit UID/GID
- cache-aware layer ordering
- BuildKit `RUN --mount` (bind/cache), plus external cache backends for CI

### Cited Findings
- **Multi-stage builds:** separate build from runtime output, and stages can build in parallel. Reusable common stages are built once. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **Base images:**
  - Choose trusted bases: Docker Official Images, Verified Publisher, or Docker-Sponsored OSS.
  - Keep bases minimal. Alpine is cited as an example.
  - Consider two bases, a fuller one for build/test and a slimmer one for production. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **Keeping images current and reproducible:**
  - Rebuild regularly.
  - `--pull` refreshes the base image. `--no-cache` rebuilds all layers but does not refresh the base.
  - Pin base images to a digest because tags are mutable.
  - Automate digest bumps with Dependabot (`package-ecosystem: "docker"`) or `docker scout recommendations`. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **RUN hygiene:**
  - Combine `apt-get update` and `install` in one RUN.
  - Pin package versions.
  - Remove `/var/lib/apt/lists`.
  - Use `set -o pipefail`.
  - Use heredocs for long commands.
  - Set, use and unset sensitive ENV values in a single RUN so they don't persist in a layer. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **ADD vs COPY:** use COPY for files and copies between stages. Use bind mounts for build-time-only files. ADD is for remote artifacts because it supports checksum validation. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **ENTRYPOINT/CMD:** use exec form. Helper scripts should `exec` the app so it runs as PID 1 and receives signals. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **USER:** run as non-root with an explicit UID/GID. Avoid sudo, using gosu if needed, and minimise user switching. Use absolute WORKDIR paths. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **Container design:** containers should be ephemeral, with one concern per container. "One process per container" is a rule of thumb, not a hard requirement. Build and test images in CI, for example with GitHub Actions. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- **Cache optimisation:**
  - Order expensive, rarely changing steps first. For example, copy `package.json` and the lockfile and install dependencies before copying the source.
  - Keep the context small with `.dockerignore`.
  - `RUN --mount=type=bind,target=.` exposes source for one step without adding a layer. It is read-only by default.
  - `RUN --mount=type=cache,target=...` persists package-manager caches (`/root/.npm`, `/root/.cache/pip`, `/go/pkg/mod`). Apt cache mounts use `sharing=locked`.
  - Export and import cache with `docker buildx build --cache-to/--cache-from`, for example the registry backend `type=registry,ref=user/app:buildcache,mode=max`. — [Docker cache optimisation](https://docs.docker.com/build/cache/optimize/)
- **Engine 29.x build and image changes:**
  - The containerd image store is the default for fresh installs (29.0.0, 2025-11-10).
  - The `image` mount type is no longer experimental (29.7.0).
  - There is a new `GET /images/{name}/attestations` API endpoint (29.6.0).
  - Image inspect has an `Identity` field (29.2.0).
  - A `lazy-pull` feature for the containerd image store is on by default for known remote snapshotters (29.9.0, 2026-10-08). — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- **Real-world image-optimisation lab tasks:**
  - SadServers "Torino": shrink a Node.js image from 916 MB to under 122 MB.
  - SadServers "Atlantis": build a minimal multi-stage image.
  - SadServers "Tallinn": "BuildKit & Docker build mismatch", where the image reports a stale API version.
  - iximiuz: "Debug a Go Container Image That Fails to Start After a Recent Change" (Hard).
  - iximiuz: "Reach a Distroless Container's Debug Endpoint From a Sidecar Container". — [SadServers scenarios](https://sadservers.com/scenarios); [iximiuz Labs challenges](https://labs.iximiuz.com/challenges?category=containers)

### Inferences
- **[Practitioner knowledge, unverified this pass]** Skills to include beyond the cited docs:
  - BuildKit `--mount=type=secret` (build secrets via `--secret id=...,src=...` or `env=`) and `--mount=type=ssh` for private git deps.
  - `# syntax=docker/dockerfile:1` frontend pinning.
  - Dockerfile heredocs.
  - `docker buildx bake` (HCL/JSON/Compose build definitions, targets/groups, matrix).
  - `buildx` multi-platform builds (`--platform linux/amd64,linux/arm64`), via QEMU emulation, native multi-node builders, or cross-compilation with `TARGETPLATFORM`/`BUILDPLATFORM`/`TARGETARCH`.
  - Builder drivers: `docker`, `docker-container`, `kubernetes`, `remote`.
  - Cache backends: `inline`, `local`, `gha`, `s3`, `azblob`.
  - `SOURCE_DATE_EPOCH` for reproducible builds.
  - `docker build --check`, the Dockerfile build checks/linter (alongside hadolint).
  - Distroless (gcr.io/distroless, Chainguard/Wolfi, Docker Hardened Images) and `scratch` for static binaries, plus debugging those with `docker debug` or ephemeral sidecars.
  - The HEALTHCHECK instruction (interval/timeout/start-period/start-interval/retries).
  - `STOPSIGNAL`, and `tini`/`docker run --init` for zombie reaping and signal forwarding.
  - Tooling: `dive` for layer analysis, and `docker history`.
- The cited best-practices page does not cover HEALTHCHECK. That needs to be sourced from the Dockerfile reference.

### Gaps
- I did not fetch the official pages for build secrets, SSH mounts, bake, multi-platform builds or reproducible builds (`SOURCE_DATE_EPOCH`) this pass. Exact flag syntax should be confirmed at docs.docker.com/build/.

---

## 3. Compose (Compose v2 / Compose Specification)

### Takeaway
Modern Compose for developers centres on `develop.watch` (sync / rebuild / sync+restart) for inner-loop development. It also uses healthcheck-gated `depends_on`, profiles, include/extends, override files, secrets/configs and `build` integration with BuildKit.

### Cited Findings
- **Compose Watch actions:**
  - `sync` copies host changes into the container, for hot-reload frameworks.
  - `rebuild` builds a new image with BuildKit and replaces the container, like `up --build`, and prunes superseded dangling images unless `--prune=false` is passed.
  - `sync+restart` syncs, then restarts, for config files such as nginx.conf. — [Compose file watch](https://docs.docker.com/compose/how-tos/file-watch/)
- **Watch syntax:**
  - Each rule needs `path` and `action`. Optional keys are `target`, `ignore` and `initial_sync` (sync+x actions only).
  - Start it with `docker compose up --watch` or `docker compose watch`. — [Compose file watch](https://docs.docker.com/compose/how-tos/file-watch/)
- **Watch requirements:**
  - The image needs `stat`, `mkdir` and `rmdir`, and the container USER must be able to write the target (use `COPY --chown`).
  - Watch works only for services with `build`, not prebuilt `image`.
  - Paths are not globbed, `.dockerignore` is respected, and `.git` is ignored. — [Compose file watch](https://docs.docker.com/compose/how-tos/file-watch/)
- Compose troubleshooting scenarios used in practice:
  - SadServers "Tarifa": HAProxy load-balancing two Nginx containers via Compose.
  - SadServers "Helsingør": a Postgres physical replication replica in Compose that isn't working. — [SadServers scenarios](https://sadservers.com/scenarios)

### Inferences
- **[Practitioner knowledge, unverified this pass]** Compose Spec features for the graph:
  - `profiles` and `--profile`.
  - `depends_on` with `condition: service_started | service_healthy | service_completed_successfully` and `restart: true`.
  - Per-service `healthcheck`.
  - `include` (top-level, Compose 2.20+) and `extends`.
  - Multiple `-f` files and the `compose.override.yaml` merge rules.
  - Top-level `secrets` and `configs` (file/environment sources, mounted at `/run/secrets`).
  - Variable interpolation (`.env`, `${VAR:-default}`, `${VAR:?err}`).
  - `x-` extension fields and YAML anchors.
  - `docker compose config` for rendering and validation.
  - `deploy.resources` limits, which Compose v2 honours locally.
  - Named networks and volumes, project naming (`-p`, `name:`), and `docker compose run --rm` for one-off tasks.
  - The `sync+exec` watch action exists in newer Compose releases but was not covered on the page fetched.
- Compose v1 (`docker-compose` Python) is end-of-life. Labs should use `docker compose` (v2 plugin) only, and the top-level `version:` key is obsolete.

### Gaps
- I did not fetch the Compose Specification pages for depends_on, include, profiles or secrets this pass. Exact minimum Compose versions per feature are unverified.

---

## 4. Networking

### Takeaway
Container networking skills are a core differentiator. The key topics are:
- default bridge vs user-defined bridge (embedded DNS)
- port publishing scope (0.0.0.0 vs 127.0.0.1 vs private IP)
- reaching containers without publishing
- the iptables (and now nftables) rules Docker manages

Docker 28 tightened published-port exposure. Docker 29 added experimental nftables and deprecated legacy links.

### Cited Findings
- Docker Engine 29.0.0 added experimental nftables support via the `firewall-backend` daemon option set to `nftables`. Legacy link environment variables are deprecated and no longer added automatically. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- Engine 29.6.0 emits a deprecation warning when containers on the default bridge are created with links. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- Engine 29.5.0 made `gvisor-tap-vsock` the default rootless network driver, replacing slirp4netns. Engine 28.x had added `pasta` as a fallback when slirp4netns was missing. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/); [Docker Engine 28 release notes](https://docs.docker.com/engine/release-notes/28/)
- Docker 28.0.0 introduced hardening of iptables rules, including raw-table rules, that makes published ports harder to reach from remote hosts. A later docs change documents an environment variable that disables raw-table rules and warns that it weakens the 28.0.0 hardening. — [Docker Engine 28 release notes](https://docs.docker.com/engine/release-notes/28/); [docker/docs PR 22660](https://github.com/docker/docs/pull/22660/files). The exact variable name was not confirmed in this pass.
- The iximiuz "Docker 101" networking challenges are styled as concrete port-publishing tasks:
  - list networks and inspect the default bridge
  - publish all exposed ports on random host ports (`-P`)
  - publish Redis on the private network only
  - reach a container without publishing a port
  - publish PostgreSQL on localhost only
  - publish a port to reach an app from the host — [iximiuz Labs challenges](https://labs.iximiuz.com/challenges?category=containers)
- SadServers networking scenarios include:
  - "Auderghem": fix Nginx routing to two other containers without stopping them
  - "Salta": the container won't start because the port is in use
  - "Bharuch": a container's web server on 3000 is not working — [SadServers scenarios](https://sadservers.com/scenarios)

### Inferences
- **[Practitioner knowledge, unverified this pass]** The topic list should cover:
  - Network drivers: bridge, host, none, macvlan, ipvlan (L2/L3), and overlay (Swarm).
  - Embedded DNS at 127.0.0.11 on user-defined networks only, plus network aliases.
  - `--network container:<id>` namespace sharing, which is the sidecar pattern.
  - Docker's iptables chains (DOCKER, DOCKER-USER, DOCKER-ISOLATION-STAGE-*) and that UFW bypass is a common pitfall. Use DOCKER-USER for host firewall policy.
  - docker-proxy vs hairpin NAT.
  - IPv6 (`--ipv6`, ip6tables), `daemon.json` `default-address-pools` and `bip` to avoid corporate CIDR clashes, and MTU issues.
  - Troubleshooting with `nsenter -t <pid> -n`, `nicolaka/netshoot` attached via `--network container:<name>`, tcpdump on veth/docker0, and `docker network inspect`.
- Given the 28.x port-hardening and 29.x nftables changes, a "my published port is unreachable" troubleshooting lab is both topical and high-value.

### Gaps
- I did not fetch Docker's packet-filtering/firewall docs page. Exact chain names under nftables and the 28.0 "gateway mode"/direct-routing behaviour are unverified.

---

## 5. Storage

### Takeaway
Must-have storage skills are volumes vs bind mounts vs tmpfs, backup/restore, and UID/permission mismatches. The storage-driver landscape is shifting: Engine 29 makes the containerd image store (snapshotters) the default for fresh installs, replacing classic graphdrivers like overlay2 for new hosts.

### Cited Findings
- **containerd image store:**
  - It is the default for fresh installs in Engine 29.0.0. It does not apply to daemons using `userns-remap`, where it is temporarily unavailable.
  - Engine 29.9.0 added `lazy-pull` for the containerd store with known remote snapshotters. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- **Other 29.x storage-related changes:**
  - A `bind-create-src` mount option (29.3.0).
  - The `image` mount type is no longer experimental (29.7.0).
  - A `--umask` container option (29.8.0). — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- Engine 28.x had containerd-image-store fixes, for example for `docker build --push` in 28.2.2. BuildKit garbage collection is enabled by default for the containerd store. — [Docker Engine 28 release notes](https://docs.docker.com/engine/release-notes/28/); [docker/docs PR 22242](https://github.com/docker/docs/pull/22242/files)
- iximiuz's roadmap has a dedicated "Container Storage" module. — [iximiuz Labs Docker roadmap](https://labs.iximiuz.com/roadmaps/docker)

### Inferences
- **[Practitioner knowledge, unverified this pass]** Topics to include:
  - named vs anonymous volumes, `--mount` vs `-v` syntax, read-only mounts, `tmpfs` mounts
  - volume drivers/plugins (local with NFS/CIFS options)
  - backup and restore via a throwaway container (`docker run --rm -v vol:/data -v $PWD:/backup alpine tar ...`)
  - DB data-dir permission errors from UID mismatches, and the `:z`/`:Z` SELinux labels
  - `docker system df`/`prune`, and image/layer storage under `/var/lib/docker` vs `/var/lib/containerd`
  - overlay2 lowerdir/upperdir/merged inspection
  - a migration lab for moving from graphdriver to the containerd store

### Gaps
- I did not fetch Docker's storage-driver or containerd-store docs. Migration commands and behaviour on upgraded (non-fresh) hosts are unconfirmed.

---

## 6. Security and supply chain

### Takeaway
The 2025-2026 security picture has four parts:
1. Host and daemon hardening per the CIS Docker Benchmark, audited with docker-bench-security.
2. Runtime least privilege: non-root, caps, seccomp/AppArmor, read-only rootfs, no-new-privileges, never mounting docker.sock.
3. Supply chain: SBOM, provenance and signing with Sigstore or Notation. Docker Content Trust is retired and removed from the CLI.
4. Hardened minimal base images, where free, Apache-2.0 Docker Hardened Images (Dec 2025) are a major new option.

### Cited Findings
- **CIS Docker Benchmark structure**, as described by secondary guides:
  1. Host Configuration
  2. Docker Daemon Configuration
  3. Daemon Configuration Files
  4. Container Images and Build Files
  5. Container Runtime
  6. Security Operations
  7. Swarm Configuration

  One guide lists six sections and omits Swarm. — [OneUptime CIS guide](https://oneuptime.com/blog/post/2026-01-16-docker-cis-benchmarks/markdown); [OneUptime NeuVector CIS](https://oneuptime.com/blog/post/2026-03-20-neuvector-cis-benchmarks/view)
- **Wazuh's CIS Docker v1.7.0 policy:**
  - Checks 98 requirements.
  - Host checks include a separate partition for containers (1.1.1) and auditing of the daemon, /etc/docker and containerd.sock (1.1.3-1.1.10).
  - Control 5.32: the Docker socket must not be mounted inside containers.
  - Control numbering differs between secondary sources. — [Wazuh](https://wazuh.com/blog/scanning-docker-infrastructure-against-cis-benchmark/); [CubePath Docker Bench](https://cubepath.com/docs/docker-advanced/docker-bench-security-audit)
- Docker Bench for Security is an open-source script that audits against the CIS benchmark and labels each check pass, warn or fail. — [CubePath Docker Bench](https://cubepath.com/docs/docker-advanced/docker-bench-security-audit)
- **Docker Content Trust retirement:**
  - Announced July 2025.
  - The oldest DCT signing certificates for Docker Official Images began expiring on 2025-08-08.
  - With `DOCKER_CONTENT_TRUST=1`, Official Image pulls fail.
  - Fewer than 0.05% of Hub pulls used DCT, and the Notary v1 upstream is unmaintained. — [Docker: Retiring DCT](https://www.docker.com/blog/retiring-docker-content-trust/); [Docker: DCT migration guidance](https://www.docker.com/blog/docker-content-trust-retirement-and-migration-guidance/)
- Publishers are advised to move to Sigstore or Notation. — [InfoQ](https://www.infoq.com/news/2025/08/docker-content-trust-retired)
- Engine/CLI 29.0.0 removed Docker Content Trust from the CLI. It can be built as a separate plugin. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- **Docker Hardened Images (DHI):**
  - Launched commercially in May 2025.
  - Made free and open source (Apache 2.0) on 2025-12-17, covering 1,000+ images.
  - Pulled from dhi.io after logging in with Docker Hub credentials.
  - Docker describes them as rootless by default, minimal and "free of known vulnerabilities at release", with VEX, SBOMs and SLSA Build Level 3 provenance.
  - DHI Enterprise is a paid tier for customisation, compliance and faster patching. — [Docker blog: DHI for every developer](https://www.docker.com/blog/docker-hardened-images-for-every-developer/); [BleepingComputer](https://bleepingcomputer.com/news/security/docker-hardened-images-now-open-source-and-available-for-free); [SiliconANGLE](https://siliconangle.com/2025/12/17/docker-open-sources-entire-catalog-hardened-images-making-free-everyone/)
- **Caveat on "zero CVEs":** a third-party tester reported 8 low-severity CVEs with no fixed versions in the DHI Node.js image as of 2025-12-17. The claim refers to release-time status. — [ITNEXT: DHI are free](https://itnext.io/docker-hardened-images-are-free-538fbccabaf3)
- Docker publishes a CIS Benchmark concept page within its DHI docs. — [Docker DHI CIS concept](https://docs.docker.com/dhi/explore/security-concepts/cis.md)
- **Engine 29 security changes:**
  - Seccomp hardening blocks `AF_ALG` and `socketcall(2)` (CVE-2026-31431), which can break 32-bit programs (29.4.2, 2026-05-01).
  - A configurable default AppArmor profile template (29.8.0).
  - Private time namespaces are on by default on supported kernels (29.5.0).
  - The default container `nofile` ulimit dropped from 1048576 to 1024 (29.0.0).
  - Multiple CVE fixes in `docker cp`, BuildKit and HTTP/2 handling across 29.5.1-29.9.0. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- Engine 28.5.2 addressed three high-severity runc vulnerabilities that could enable container breakouts. — [Docker Engine 28 release notes](https://docs.docker.com/engine/release-notes/28/)
- Docker's build guidance recommends Docker Scout (`docker scout recommendations`) for base-image updates. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)

### Inferences
- **[Practitioner knowledge, unverified this pass]** Security topic ladder:
  - `--user`/USER.
  - `--cap-drop ALL --cap-add <needed>`, and why `--privileged` is dangerous.
  - `--security-opt no-new-privileges`.
  - `--read-only` plus `--tmpfs`.
  - Custom seccomp profiles (default profile JSON) and AppArmor/SELinux labels.
  - `--pids-limit` and memory limits as DoS controls.
  - The Docker socket as root-equivalent. This pairs with the SadServers "Quito" scenario, where one container controls another via the socket — [SadServers scenarios](https://sadservers.com/scenarios). Mitigations are socket proxies and authorization plugins.
  - Rootless Docker (`dockerd-rootless-setuptool.sh`, network driver limits, port <1024) vs `userns-remap` (note: incompatible with the containerd store per the 29.0 notes above).
  - TLS-protected daemon sockets.
  - Secrets: Compose/Swarm secrets and BuildKit build secrets, never ENV/ARG.
  - Scanners: Docker Scout, Trivy, Grype.
  - SBOM generation: Syft, `docker buildx build --sbom=true`, `docker scout sbom`.
  - Provenance attestations (`--provenance=mode=max`) mapped to SLSA build levels.
  - Signing and verification with cosign (keyless OIDC via Fulcio/Rekor) and Notation (Notary Project v2).
  - Admission or policy enforcement downstream (e.g., Kyverno/Sigstore policy-controller in Kubernetes).
  - VEX for triaging scanner noise.
  - Container escape awareness (runc CVEs, mounted host paths).
- OWASP's Docker Security Cheat Sheet covers similar ground: rule-based items such as keeping host/Docker updated, not exposing the socket, setting a user, limiting capabilities, no-new-privileges, disabling inter-container communication, LSMs, resource limits, read-only FS, scanning, logging and rootless mode. It should be used as a checklist source but was not fetched this pass.

### Gaps
- I did not fetch the official CIS Docker Benchmark text (it requires CIS registration). The section list is from secondary sources and is consistent across them, but numbering conflicts exist.
- Not fetched this pass: OWASP Docker Security Cheat Sheet, sigstore.dev, slsa.dev, Docker rootless docs. Their specific claims are not cited here.

---

## 7. Registries

### Takeaway
Docker Hub limits per the current official docs page are 100 pulls per 6h unauthenticated per IP (or /64), 200 per 6h for free Personal accounts, and unlimited (fair use) for paid tiers. Earlier 2025 announcements cited 10/hour and 100/hour, and that conflict should be noted. Authenticated pulls, pull-through mirrors and digest pinning are core CI skills.

### Cited Findings
- **Current Docker Hub limits (per 6-hour window):**
  - Unauthenticated: 100 pulls per IPv4 address or IPv6 /64.
  - Personal (free): 200.
  - Pro/Team/Business: unlimited with fair use.

  Check the remaining quota with a HEAD request to the manifest endpoint and read the `ratelimit-limit`/`ratelimit-remaining` headers. HEAD requests don't count. Shared egress IPs can trigger abuse limits even when authenticated. — [Docker Hub pull usage and limits](https://docs.docker.com/docker-hub/usage/pulls/)
- **Conflicting figures:** a Docker docs PR and forum posts announced 10 pulls/hour unauthenticated and 100 pulls/hour for free accounts effective 2025-04-01. A mailing-list post notes the page later changed to 100 per 6h unauthenticated. GitLab's 2025-03-24 blog cited 100 per 6h. — [docker/docs PR 22081](https://github.com/docker/docs/pull/22081/files); [Eclipse Tractus-X list](https://www.eclipse.org/lists/tractusx-dev/msg00621.html); [GitLab blog](https://about.gitlab.com/blog/prepare-now-docker-hub-rate-limits-will-impact-gitlab-ci-cd/); [Sonatype support](https://support.sonatype.com/hc/en-us/articles/33993902899731-Handling-request-rate-limiting-from-Docker-Hub)
- Sonatype recommends Nexus as a proxy cache to cope with Hub limits. — [Sonatype blog](https://www.sonatype.com/blog/using-sonatype-nexus-repository-with-the-new-docker-hub-rate-limits)
- Docker's guidance is to pin by digest because tags are mutable, and to use Dependabot or Scout to automate digest bumps. — [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- Pull/push and tagging are a dedicated module ("Pulling and Pushing Images") in the iximiuz roadmap. — [iximiuz Labs Docker roadmap](https://labs.iximiuz.com/roadmaps/docker)
- SadServers "Woluwe": find the one correct image among many, tag it `prod` and run it. — [SadServers scenarios](https://sadservers.com/scenarios)

### Inferences
- **[Practitioner knowledge, unverified this pass]** Lab topics to include:
  - Run `registry:2` (CNCF Distribution) with TLS and htpasswd auth.
  - Configure it as a pull-through cache (`proxy.remoteurl`) and point `daemon.json` `registry-mirrors` at it. Note that this applies only to Docker Hub.
  - Harbor: projects, RBAC, replication, Trivy scanning, retention and immutability rules, robot accounts.
  - Image references: tag vs digest, multi-arch manifest lists/OCI indexes (`docker buildx imagetools inspect`).
  - OCI artifacts and referrers (where signatures and SBOMs live).
  - Registry garbage collection.
  - Insecure-registry pitfalls and credential helpers.
- The lab platform will itself hit Hub limits at scale. The platform should run its own pull-through mirror, and teaching that is a natural "production" lab.

### Gaps
- Harbor and registry:2 docs were not fetched this pass.

---

## 8. Operations (logging, limits, daemon, runtime stack, Podman)

### Takeaway
Engine 29 deprecates cgroup v1 (support until at least May 2029), so labs should assume cgroups v2. Operational skills include:
- logging drivers and rotation
- resource limits and OOM diagnosis
- restart policies and healthchecks
- `daemon.json`
- understanding the dockerd → containerd → containerd-shim → runc chain, which is becoming more visible as Docker adopts the containerd image store, embedded containerd and NRI

### Cited Findings
- Engine 29.0.0 deprecated cgroup v1, with support continuing until at least May 2029 and a recommended migration to v2. — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- **29.x operational changes:**
  - The API minimum was raised to v1.44 in 29.0 and lowered back to v1.40 in 29.3.0.
  - The Go SDK moved to `github.com/moby/moby/client`.
  - The default `nofile` ulimit changed to 1024, overridable via `--ulimit` or daemon.json.
  - Experimental NRI support (29.2.0). `--gpus` uses CDI for NVIDIA where possible.
  - Experimental `embedded-containerd` (29.7.0).
  - New `default-stop-timeout` daemon option (29.7.0). — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- SadServers "Podgorica": migrate from Docker to a rootless Podman Nginx container run as a systemd service. "Socorro": optimise a Podman-built image. "Venice": determine whether you're inside a container or a VM. — [SadServers scenarios](https://sadservers.com/scenarios)
- iximiuz lists observability and debugging as cross-cutting topics across its Docker roadmap. — [iximiuz Labs Docker roadmap](https://labs.iximiuz.com/roadmaps/docker)

### Inferences
- **[Practitioner knowledge, unverified this pass]** Topics to include:
  - Logging drivers (json-file default, `local`, journald, syslog, fluentd, gelf, awslogs) and `log-opts` max-size/max-file. Disk-full from unrotated json-file logs is a classic incident.
  - Limits: `--memory`, `--memory-swap`, `--cpus`, `--cpuset-cpus`, `--pids-limit`, and reading `/sys/fs/cgroup` for a container.
  - OOMKilled diagnosis (`docker inspect .State.OOMKilled`, exit code 137) vs SIGTERM handling (143).
  - Restart policies (`no`, `on-failure[:N]`, `always`, `unless-stopped`) and crash-loop backoff.
  - Health status and `docker events`, `docker stats`, `docker system events`.
  - `live-restore`.
  - daemon.json keys: `data-root`, `log-driver`, `default-address-pools`, `registry-mirrors`, `features`, `userns-remap`, `default-ulimits`.
  - systemd drop-ins and `journalctl -u docker`.
  - `ctr`/`nerdctl` against the `moby` namespace, and `runc list`.
- **Docker vs Podman [practitioner knowledge]:** Podman is daemonless with fork/exec, rootless-first, and has pods. It uses Quadlet/systemd integration instead of restart daemons, `podman compose` or `podman-compose`, and a Docker-compatible API socket. It defaults to the crun runtime on many distros and uses netavark/pasta networking.

### Gaps
- Docker's logging and resource-constraints doc pages were not fetched. There is no cited source for Podman feature claims in this pass.

---

## 9. Swarm: relevance in 2025-2026

### Takeaway
Swarm is maintained and commercially supported. Mirantis committed in 2025 to support Swarm on MKE 3 through 2030, and CIS still has a Swarm section. It is not a growth skill for most employers, though, so it warrants a small optional module, not a full path.

### Cited Findings
- Mirantis says it will support Swarm on its Mirantis Kubernetes Engine 3 dual-orchestrator platform through 2030. A podcast dates the announcement to July 2025. — [Mirantis: long-term support for Swarm](https://www.mirantis.com/blog/mirantis-guarantees-long-term-support-for-swarm/); [Bret Fisher podcast transcript](https://podcast.bretfisher.com/episodes/swarm-2030-lets-go/transcript)
- Mirantis reports Swarm often runs side by side with Kubernetes. It has also described CSI support within MKE 3 and a regular security update cadence. — [Mirantis press: Swarm still thriving](https://www.mirantis.com/company/press-center/company-news/docker-swarm-still-thriving-three-years-after-mirantis-acquisition-often-running-side-by-side-with-kubernetes/); [Mirantis blog: Swarm is here to stay](https://www.mirantis.com/blog/swarm-is-here-to-stay-and-keeps-getting-better-in-security-and-ease-of-operations/)
- An analyst piece frames the extension as long-term viability for lightweight and edge workloads. — [Efficiently Connected](https://www.efficientlyconnected.com/mirantis-doubles-down-on-simple-container-orchestration/)
- The CIS Docker Benchmark retains a Swarm Configuration section in common descriptions. — [OneUptime CIS guide](https://oneuptime.com/blog/post/2026-01-16-docker-cis-benchmarks/markdown)

### Inferences
- Suggested coverage is about 5-10% of the Docker domain, in one optional module:
  - `swarm init/join`
  - services, replicas and rolling updates
  - overlay networks and the routing mesh
  - Swarm secrets/configs
  - `docker stack deploy` from Compose files
  - node drain
  - Swarm CIS items (autolock, encrypted overlay)

  Overlay networking concepts also transfer to Kubernetes CNI understanding.
- Swarm's main enterprise relevance comes from Mirantis customers and small or edge deployments. Kubernetes remains the mainstream orchestrator target.

### Gaps
- I found no hard data on Swarm adoption share in 2025-2026. Mirantis sources are vendor-interested.

---

## 10. Existing hands-on Docker lab and challenge collections

### Takeaway
Play with Docker is shut down as a hosted service (deprecated, with the hosted service discontinued 1 March 2026). The current reference collections are:
- **iximiuz Labs:** realistic, auto-checked challenges plus a Docker roadmap.
- **SadServers:** broken-server troubleshooting with a time limit, where many scenarios are Docker/Compose/Podman.
- **Killercoda:** a Docker category exists, but I could not enumerate it.
- **Docker "Labspaces":** a Docker Desktop extension, which is Docker's own replacement suggestion.

### Cited Findings
- **Play with Docker:**
  - Deprecated, with hosted services discontinued from 2026-03-01.
  - Docker's forum points learners to iximiuz, Google Cloud Shell, and Docker's "Labspaces" Docker Desktop extension.
  - PWD-based tutorials may need updating. — [Docker forum: PWD deprecated](https://forums.docker.com/t/play-with-docker-is-deprecated-and-will-be-unavailable-starting-march-1-2026-learn-about-alternatives/151177); [Docker forum: PWD down](https://forums.docker.com/t/labs-play-with-docker-com-is-down/150915)
- **iximiuz Labs container challenges (10 listed):**
  - Medium: distroless debug via sidecar
  - Medium: tests without network access
  - Medium: Redis feature flag through a tunnel with local containerised redis-cli
  - Easy/Medium: six "Docker 101" port-publishing/networking tasks
  - Hard: debug a Go image that fails to start

  Style: "focused, hands-on DevOps and server-side problems" with hints, feedback and automated solution checks, mostly authored by Ivan Velichko. — [iximiuz Labs challenges](https://labs.iximiuz.com/challenges?category=containers)
- **SadServers container scenarios (all Medium):**
  - Salta (container won't start/port conflict)
  - Venice (in a container or a VM?)
  - Podgorica (Docker to rootless Podman + systemd)
  - Torino (image 916 MB → <122 MB)
  - Socorro (Podman image optimisation)
  - Tarifa (Compose HAProxy + 2 Nginx)
  - Auderghem (container miscommunication)
  - Woluwe (find the correct image and tag prod)
  - Quito (control a container from another container)
  - Bharuch (web server on 3000 broken)
  - Atlantis (minimal multi-stage image)
  - Helsingør (Postgres replication in Compose)
  - Tallinn (BuildKit vs docker build mismatch)

  Style: a pre-broken VM, a goal stated as a checkable end-state, and an automated "test" check (some, like Venice, have no test). — [SadServers scenarios](https://sadservers.com/scenarios)

### Inferences
- Lab-design patterns worth copying:
  - **iximiuz:** a single-skill goal with an automated end-state check (e.g., "port published on 127.0.0.1 only").
  - **SadServers:** a pre-broken environment with a measurable target (e.g., an image under N MB, or a service responding on port X).
  - Both avoid "follow the tutorial" steps.
- PWD's shutdown leaves a market gap for free and enterprise in-browser Docker sandboxes, especially ones running real VMs (KubeVirt/vCenter) where daemon-level, iptables, rootless and cgroup labs are possible. Those are hard in shared-kernel playgrounds.

### Gaps
- I could not enumerate the Killercoda Docker scenarios because the page content did not render via fetch.
- I did not inspect the scenario catalogue of Docker Labspaces.
- The SadServers page was truncated at 100k characters, so there may be more container scenarios, including Easy and Hard ones.

---

## Appendix-style synthesis (kept within the required structure): proposed topic graph and learning paths

### Takeaway
This is a proposed beginner → advanced Docker domain organised into 9 learning paths. It is derived from the cited findings above plus practitioner knowledge. Items not individually cited above are curriculum suggestions, not sourced claims.

### Cited Findings
- The anchor sources for the ordering and content are:
  - iximiuz's module order (run → build → pull/push → network → storage, with security, debugging and observability cross-cutting) — [iximiuz Labs Docker roadmap](https://labs.iximiuz.com/roadmaps/docker)
  - Docker's official build and cache guidance — [Docker build best practices](https://docs.docker.com/build/building/best-practices/); [Docker cache optimisation](https://docs.docker.com/build/cache/optimize/)
  - Engine 29 changes — [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)

### Inferences
**Proposed learning paths (beginner → advanced), each with example hands-on labs:**

1. **Docker Foundations (Beginner)**
   - Topics: containers vs VMs, images/containers/registries, the OCI image and runtime specs, installing Engine 29 (no Desktop), `run/ps/logs/exec/stop/rm`, interactive vs detached, env vars, port publishing basics, `inspect`, cleanup (`system df/prune`).
   - Labs: run nginx and publish it to localhost only, using the iximiuz Docker 101 style. Find the right image and tag it, as in SadServers Woluwe.

2. **Building Great Images (Beginner → Intermediate → Advanced)**
   - Topics, in order:
     - Dockerfile instructions, build context and `.dockerignore`
     - layer caching and ordering
     - multi-stage builds
     - non-root USER
     - exec form, PID 1 and signals (`exec`, tini/`--init`, STOPSIGNAL)
     - HEALTHCHECK
     - minimal bases (slim/alpine/distroless/scratch/DHI)
     - digest pinning
     - BuildKit mounts (cache/bind/secret/ssh) and heredocs
     - `docker build --check`
     - buildx builders and multi-platform builds
     - bake
     - CI cache backends (registry/gha) with `mode=max`
     - reproducibility (`SOURCE_DATE_EPOCH`)
   - Labs: shrink an image from 900 MB to under 120 MB (SadServers Torino style). Fix a container that ignores SIGTERM and takes 10s to stop. Build an amd64+arm64 image. Remove a leaked secret from layers.

3. **Compose for Developers (Intermediate)**
   - Topics: services, networks and volumes, `.env` and interpolation, `depends_on` with healthcheck conditions, profiles, override files, include/extends, secrets/configs, `develop.watch`, `compose config`, one-off `run`.
   - Labs: fix a broken HAProxy+Nginx stack (Tarifa style). Get a database to come up before the app without sleep hacks. Set up hot reload with watch.

4. **Container Networking (Intermediate → Advanced)**
   - Topics:
     - default vs user-defined bridge and DNS
     - `-p` scopes, `-P`
     - container-to-container without publishing
     - host/none/macvlan/ipvlan
     - `--network container:`
     - iptables/DOCKER-USER, and the experimental nftables backend in 29.x
     - address pools and CIDR clashes, IPv6
     - troubleshooting with nsenter/netshoot/tcpdump
   - Labs: a published port reachable from the internet when it shouldn't be. UFW bypass. A DNS name not resolving on the default bridge. Fix Nginx upstream routing without restarting containers (Auderghem style).

5. **Storage and Data (Intermediate)**
   - Topics:
     - volumes vs bind vs tmpfs
     - `--mount` syntax, read-only mounts
     - backup/restore of volumes
     - UID/GID permission issues and SELinux `:z/:Z`
     - storage drivers (overlay2) vs the containerd image store (default on fresh 29.x installs)
     - disk-space hygiene
   - Labs: restore a Postgres volume from a backup. Fix a "permission denied" data directory. Find what filled `/var/lib/docker`.

6. **Container Security and Supply Chain (Intermediate → Advanced)**
   - Topics:
     - CIS Docker Benchmark sections and docker-bench-security
     - daemon socket risks and TLS
     - rootless Docker vs userns-remap
     - capabilities, seccomp (29.x default changes), AppArmor/SELinux, read-only rootfs, no-new-privileges, pids/memory limits
     - secrets handling (build and runtime)
     - scanning (Scout/Trivy/Grype) and VEX
     - SBOMs (Syft, BuildKit `--sbom`)
     - provenance/SLSA (`--provenance=mode=max`)
     - signing and verification (cosign keyless, Notation); DCT is retired and removed from the CLI
     - hardened images (DHI)
   - Labs: harden a container to pass a docker-bench section. Escape via a mounted docker.sock, then mitigate it (Quito style, inverted). Sign and verify an image and block unsigned ones. Generate an SBOM and attest it.

7. **Registries and Distribution (Intermediate)**
   - Topics: Hub limits and auth (100/6h unauth, 200/6h Personal per current docs), registry:2 with TLS/auth, pull-through mirror via `registry-mirrors`, Harbor (projects, robot accounts, replication, retention, immutability, scanning), tags vs digests, multi-arch indexes, OCI referrers.
   - Labs: CI fails with 429 Too Many Requests, fixed with a mirror. Set up Harbor retention.

8. **Troubleshooting, Performance and Running in Production/CI (Intermediate → Advanced)**
   - Topics:
     - logging drivers and rotation
     - limits on cgroups v2 (v1 deprecated in 29.0)
     - OOMKilled/137 vs 143
     - restart policies and crash loops
     - `events`/`stats`
     - daemon.json, live-restore, `default-stop-timeout`
     - `docker debug`/sidecar debugging of distroless images
     - ulimit changes (nofile 1024 in 29.x)
     - CI pipelines (GitHub Actions build-push, cache, scan, sign), Docker-in-Docker vs socket mount vs rootless BuildKit in CI
   - Labs: a container is OOMKilled under load. Logs filled the disk. An app breaks after the Engine 29 upgrade because of nofile=1024. Debug a distroless container from a sidecar (iximiuz style).

9. **Internals (Advanced)**
   - Topics:
     - namespaces (pid/net/mnt/uts/ipc/user/cgroup/time)
     - cgroups v2 hierarchy
     - overlayfs layers
     - OCI image layout and manifests
     - the dockerd → containerd → shim → runc chain
     - `ctr`/`nerdctl`
     - runc CVEs and escapes
     - NRI/CDI
     - building a "container" by hand with unshare/chroot
     - Docker vs Podman architecture (daemonless, rootless, Quadlet)
   - Labs: create a container with unshare and cgroups by hand. Find a container's processes and netns from the host. "Am I in a container?" (SadServers Venice style). Migrate a service to rootless Podman with systemd (Podgorica style).

**Optional module: Swarm Essentials (about 5-10%)**
- Topics: init/join, services, overlay networks, stack deploy, secrets, rolling updates, autolock.

**Persona mapping (suggested):**
- Developers: paths 1, 2, 3, plus the networking and storage basics.
- DevOps/Platform: 1-5, 7, 8, plus Swarm optional.
- Security engineers: 1, 2, 6, 9, plus parts of 4 and 7.

### Gaps
- The persona mappings and path boundaries are design judgements, not drawn from a published industry framework. I found no 2025-2026 survey quantifying which Docker sub-skills employers test most.
