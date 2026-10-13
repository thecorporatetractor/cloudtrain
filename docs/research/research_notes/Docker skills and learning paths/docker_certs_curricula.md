# Docker and Container Certifications and Official Curricula (state as of Oct 2026)

Legend used below: **[HO]** = practised hands-on in the exam or course (performance-based or "describe and demonstrate"); **[K]** = knowledge only ("describe", "compare", "identify"). All objective text is paraphrased.

## 1. Docker Certified Associate (DCA, run by Mirantis): status, domains, weights, sub-objectives

### Takeaway
The DCA is still sold by Mirantis in 2026 ($199/EUR 200, 90 min, 55 multiple-choice/DOMC items, remote proctored) and has not been retired or replaced. However, the only public blueprint is Study Guide v1.4 (August 2020). It still covers Swarm, UCP/DTR (Docker Enterprise), and devicemapper, which makes much of it legacy content. Docker Inc. itself offers no certification. Third-party "DCA retired" claims refer to Docker Inc.'s own program ending after the 2019 sale of Docker Enterprise to Mirantis.

### Cited Findings
**Status and format**
- The Mirantis DCA page still offers scheduling with no retirement notice. It lists $199 / EUR 200 for one attempt, 13 MC + 42 DOMC questions, 90 minutes, remote proctoring on Windows/Mac only (no Linux), English only. Topics are deferred to the Study Guide PDF. — [Mirantis DCA exam page](https://training.mirantis.com/certification/dca-certification-exam/)
- The Study Guide linked from Mirantis (the file is named "v1-5-october", but its text says Version 1.4, August 2020) states the exam is all knowledge-based: 55 items (13 MC, 42 DOMC, where each option is shown one at a time and answered yes/no). There are **no performance-based tasks**, even though objectives are worded "describe and demonstrate". — [DCA Study Guide PDF](https://a.storyblok.com/f/146871/x/6daa07336d/docker-study-guide_v1-5-october.pdf)
- The target candidate has 6–12 months of Docker experience, including Docker Enterprise, plus container security, at least one cloud provider, config-management tools, and Linux and/or Windows Server. The job tasks listed are running apps from registry images, deploying images across a cluster, triaging issues, standing up an Enterprise cluster (1 UCP manager, 1 DTR replica, 1 worker), migrating traditional apps, configuring and troubleshooting the engine, and general maintenance. — [DCA Study Guide PDF](https://a.storyblok.com/f/146871/x/6daa07336d/docker-study-guide_v1-5-october.pdf)
- KodeKloud (published June 29, 2026) says the DCA was not retired and is open for registration through Mirantis. It says the "DCA is dead" story comes from Docker Inc. winding down its own program after the 2019 sale to Mirantis, that the orchestration content is Swarm-based, and that the credential's hiring visibility has dropped. It recommends KCNA/CKA/CKAD instead for most DevOps roles. — [KodeKloud](https://kodekloud.com/blog/docker-certification/)
- Conflicting view: a third-party guide says Docker "retired" the DCA in 2023, and a Docker forum reply says Docker no longer offers it. Both refer to Docker Inc., not Mirantis. — [course.careers](https://course.careers/certifications/docker-certification-best-options-how-to-choose); [Docker forums](https://forums.docker.com/t/how-can-register-for-dca-exam/134350)
- Searches for a Docker Inc.-run certification in 2025–2026 found only third-party articles pointing back to the DCA. Docker Inc. has no certification of its own. — [DataCamp (Feb 2024)](https://www.datacamp.com/blog/introduction-to-docker-certification)

**Domains and weights (Study Guide v1.4).** The same weights are repeated by 2025–2026 third-party sources ([KodeKloud](https://kodekloud.com/blog/docker-certification/), [ExamCert Dec 2025](https://www.examcert.app/blog/docker-certified-associate-guide/)).

| # | Domain | Weight |
|---|---|---|
| 1 | Orchestration | 25% |
| 2 | Image Creation, Management, and Registry | 20% |
| 3 | Installation and Configuration | 15% |
| 4 | Networking | 15% |
| 5 | Security | 15% |
| 6 | Storage and Volumes | 10% |

**Sub-objectives, paraphrased** — source for all: [DCA Study Guide PDF](https://a.storyblok.com/f/146871/x/6daa07336d/docker-study-guide_v1-5-october.pdf). Items tagged LEGACY rely on Docker Enterprise (UCP/DTR, which Mirantis rebranded as MKE/MSR) or on removed technology.

*D1 Orchestration (25%)*
- Finish building a swarm with manager and worker nodes [HO]
- Turn single-container run instructions into swarm services [HO]
- Explain why manager quorum (Raft) matters [K]
- Explain how a container differs from a service [K]
- Read and interpret `docker inspect` output [HO]
- Convert an app into a Compose-format stack file and deploy it with `docker stack deploy` [HO]
- Modify a running stack: scale replicas, add networks, publish ports, mount volumes [HO]
- Run replicated vs global services [HO]
- Use node labels and placement constraints to control where tasks run [HO]
- Use Go templates with `docker service create` (for example, hostname per task) [HO]
- Troubleshoot a service that won't deploy (for example, pending tasks) [HO]
- Explain how containerized apps talk to legacy systems [K]
- Explain how to deploy workloads as Kubernetes Pods and Deployments [K]
- Explain how to feed config to Pods with ConfigMaps and Secrets [K]

*D2 Image Creation, Management, and Registry (20%)*
- Explain what a Dockerfile is for and its key instructions (ADD vs COPY, VOLUME, EXPOSE, ENTRYPOINT, and others) [K]
- Identify the main parts of a Dockerfile [K]
- Build efficient images: layer ordering, fewer layers, multi-stage [HO]
- Manage images from the CLI: list, remove, prune, rmi [HO]
- Inspect images and pull out attributes with `--filter` / `--format` [HO]
- Tag images [HO]
- Build an image from a given file (`-f`) [HO]
- Show an image's layers (`docker history`) [HO]
- Flatten an image to a single layer (export/import or squash) [HO]
- Registry tasks: deploy a registry, log in, search, push, sign, pull, delete [HO]

*D3 Installation and Configuration (15%)*
- Explain sizing requirements [K]
- Set up the package repo, pick a storage driver, and install the engine on several platforms [HO]
- Configure logging drivers (journald, splunk, and others) [HO]
- Set up a swarm, configure managers, add nodes, and schedule backups [HO]
- Create and manage users and teams [HO, LEGACY: UCP]
- Make the daemon start at boot (systemd) [HO]
- Set up certificate-based client/server auth so the daemon can access a registry (registry CA certs, `certs.d`) [HO]
- Explain namespaces, cgroups, and certificate configuration [K]
- Diagnose installation errors without help [HO]
- Deploy Engine + UCP + DTR in HA on AWS and on-prem [LEGACY]
- Configure UCP/DTR backups [LEGACY]

*D4 Networking (15%)*
- Explain the Container Network Model (CNM) and how it connects the engine, network drivers, and IPAM drivers [K]
- Explain the built-in network drivers and when to use each (bridge, host, overlay, macvlan, none) [K]
- Explain the traffic between engine, registry, and UCP controllers [K, LEGACY]
- Create a user-defined bridge network [HO]
- Publish a port and work out which IP and port a container is reachable on [HO]
- Compare host vs ingress (routing-mesh) publishing modes [K]
- Point Docker at external DNS (daemon.json `dns`, `--dns`) [HO]
- Load-balance HTTP/HTTPS at L7 (Interlock in Docker EE) [LEGACY]
- Deploy a service onto an overlay network [HO]
- Use container and engine logs to fix container-to-container connectivity problems [HO]
- Explain routing to Pods with ClusterIP and NodePort Services, and the Kubernetes network model [K]

*D5 Security (15%)*
- Explain security administration tasks [K]
- Explain image signing [K]
- Explain the engine's default security (namespaces, cgroups, capabilities, seccomp) [K]
- Explain swarm's default security (mTLS, CA rotation, autolock) and what mTLS is [K]
- Explain identity roles; compare UCP workers vs managers [K, LEGACY]
- Use external certificates with UCP/DTR [LEGACY]
- Show that an image passes a security scan [HO; DTR scanning, LEGACY → today Docker Scout or Trivy]
- Enable Docker Content Trust [HO]
- Configure RBAC in UCP, integrate with LDAP/AD, create client bundles [LEGACY]

*D6 Storage and Volumes (10%)*
- Pick the right graph (storage) driver for each OS [K]
- Configure devicemapper [LEGACY]
- Compare object storage and block storage and when to use each [K]
- Explain image layers and where they live on disk (`/var/lib/docker/overlay2`) [K]
- Explain how volumes provide persistent storage [K]
- Clean up unused images on hosts and in DTR [HO]
- Share storage across cluster nodes (volume plugins/NFS) [HO]
- Give Pods persistent storage with PV/PVC; explain how CSI drivers, StorageClass, PVC, and volumes fit together [K]

**Related deprecation affecting D2/D5 (signing)**
- Docker Content Trust and the Notary v1 service at notary.docker.io are being retired. The service shuts down for good on December 8, 2026, after brownouts in July and August. Docker points users to Sigstore/Cosign and Notation instead. — [Docker docs: Retired](https://docs.docker.com/retired/) / [DCT page](https://docs.docker.com/engine/security/trust/)
- The Docker Registry open-source project was donated to CNCF and is now "Distribution". — [Docker docs: Retired](https://docs.docker.com/retired/)

### Inferences
- For a lab skill graph, treat the DCA as a **topic map, not a current standard**. About 20–25% of objectives (UCP/DTR/MKE, Interlock, devicemapper, DCT/Notary v1) should be replaced with modern equivalents: Swarm is still in Engine; for signing use cosign/Notation + OCI referrers; for scanning use Scout/Trivy; use overlay2/containerd image store; for the registry use CNCF Distribution/Harbor.
- The DCA tests nothing hands-on. A hands-on platform adds value by turning the "describe and demonstrate" items into graded tasks.
- Its Kubernetes items are knowledge-only and shallow, so they overlap KCNA more than CKA/CKAD.

### Gaps
- Mirantis has published no blueprint newer than Aug 2020 (v1.4). It is unclear whether the live item bank was refreshed (for example, MKE naming, Engine 25+ changes). No official Mirantis end-of-life or roadmap statement was found.
- I did not confirm from a primary source in this pass that devicemapper was removed from current Docker Engine. Verify in the Engine release notes before labelling it removed rather than deprecated.

## 2. Docker Inc.'s own learning offerings (docs, guides, labs, products)

### Takeaway
Docker Inc. offers no certification. Its official curriculum is the docs site at docs.docker.com. It has three layers: (a) **Get started**, with short tutorials plus a "Docker concepts" series; (b) **Guides**, which include language guides, Testcontainers guides, and a growing set of **interactive "lab-*" guides**; and (c) **Manuals** for each product (Build/BuildKit/Bake, Compose, Engine, Desktop, Scout, Hardened Images, Testcontainers, Build Cloud/Offload, and AI products). These map well onto skill-graph nodes.

### Cited Findings
**Site structure.** docs.docker.com has four main sections: Get started, Guides, Manuals, Reference. "Starter paths" are: (1) Build and share a containerized application, (2) Run your coding agent in a sandbox, (3) Roll out Docker to a pilot group (admin). Product manuals are grouped as AI & agents (Sandboxes, MCP Catalog/Toolkit, Gordon, Model Runner, Docker Agent, Skills), Application development (Desktop, Offload, Build Cloud, Testcontainers, Build, Engine, Compose), and Supply-chain security (Hub, Hardened Images, Scout). Reference covers the Dockerfile and Compose file formats, the docker/compose/dockerd CLIs, and the Engine, Hub, Registry, and Sandboxes APIs. — [docs.docker.com/llms.txt](https://docs.docker.com/llms.txt)

**Get started → "Build and share a containerized application"**
- A 15-minute tutorial: run a container (`docker run -d --name -p`), run a 5-service Compose stack (`docker compose up --build -d`, `compose ps`), build and tag an image, then push to Docker Hub. — [Docker docs](https://docs.docker.com/get-started/tutorials/run-an-app/)

**Get started → Docker concepts** (each page pairs a concept with a short hands-on) — [Docker docs full index](https://docs.docker.com/llms-full.txt)
- The basics: what a container is, what an image is, what a registry is, what Docker Compose is
- Building images: writing a Dockerfile; image layers; build/tag/publish; the build cache and what invalidates it; multi-stage builds
- Running containers: publishing/exposing ports; overriding container defaults; persisting data (volumes); sharing local files (bind mounts); multi-container apps

**Guides → interactive labs** (hands-on, live environment) — [Docker docs full index](https://docs.docker.com/llms-full.txt)
- lab-container-getting-started: container lifecycle; package a Node.js app
- lab-building-images: layer caching, multi-stage builds, non-root users, base-image choice, build-time secrets
- lab-compose-quickstart: Flask+Redis app; healthchecks, watch mode, named volumes, multiple Compose files
- lab-container-supported-development: Postgres + pgAdmin via Compose for local dev
- lab-containerized-sdlc: local dev → integration tests → CI/CD → Kubernetes deployment
- lab-attestation-basics: attach SBOMs, provenance, signatures, VEX
- lab-dhi-node: migrate a Node app to Hardened Images; compare CVEs and attestations with Scout
- AI labs: lab-ai-fundamentals, lab-agentic-apps, lab-mcp-gateway, lab-docker-agent, lab-creating-ai-product-reviewer
- Other guides: language guides (Node, Python, Go, Java, .NET, Rust, PHP, Ruby, C++, R, Deno, Bun, Angular/React/Vue/Next.js, Django, Laravel, and more); Testcontainers (getting started in Java/Go/.NET/Node/Python, Java lifecycle, Spring Boot REST, replacing H2, service configuration); Bake and Compose+Bake; GitHub Actions; Azure Pipelines; databases; OpenTelemetry; Prometheus monitoring for Go; Kafka; LocalStack; WireMock; Traefik; DHI with Backstage/OpenShift; DHI VEX walkthrough

**Docker Build manual (BuildKit/Buildx) topic tree** — [Docker docs full index](https://docs.docker.com/llms-full.txt); [Build overview](https://docs.docker.com/build/)
- Concepts: build context, Dockerfile, overview
- Building: base images, best practices, multi-stage, multi-platform, build secrets, build variables (ARG/ENV), exporting, CDI devices
- Builders: drivers (docker, docker-container, kubernetes, remote), managing builders
- BuildKit: configuration, buildkitd.toml, Dockerfile frontend and release notes
- Cache: invalidation, optimisation, cache backends (inline, registry, local, gha, s3, azblob), garbage collection
- Exporters: image/registry, local/tar, oci/docker
- Metadata: annotations; attestations (SBOM, provenance)
- Build checks (lint rules)
- Bake: targets, inheritance, variables, functions, matrices, overrides, contexts, Compose-file support, remote definitions
- Build policies: intro, inputs, built-ins, validating images and git sources, testing, debugging
- Debugging with OpenTelemetry; CI with GitHub Actions

**Docker Compose manual** — [Docker docs full index](https://docs.docker.com/llms-full.txt); [Compose overview](https://docs.docker.com/compose/)
- Intro: application model, features and uses, history (v1 → v2)
- Lifecycle tasks: start/stop/rebuild, status, logs, one-off commands
- How-tos: environment variables, file watch (develop/watch), GPU support, init containers, startup order (depends_on + healthchecks), multiple Compose files (merge/extend/include), networking, profiles, project name, secrets, using Compose in production, dependent images, provider services, publishing Compose apps as OCI artifacts
- Compose Bridge (convert to Kubernetes, customise); Compose SDK; trust model

**Docker Engine manual (areas relevant to a skill graph)** — [Docker docs full index](https://docs.docker.com/llms-full.txt)
- Network: drivers, port publishing, packet filtering/firewalls (iptables and nftables), CA certs, legacy links
- Security: rootless, userns-remap, seccomp, AppArmor, protecting daemon access (TLS/SSH), certificates, content trust (retiring), antivirus
- Storage: volumes, bind mounts, tmpfs, image mounts, storage drivers, containerd image store
- Swarm: key concepts, how it works, Raft, tutorial, join/manage nodes, services, ingress, networking, configs, secrets, stack deploy, manager autolock, admin guide

**Docker Scout** — scans images to build an SBOM and checks it against a continuously updated vulnerability database; usable from Hub, the CLI, and a dashboard — [Scout docs](https://docs.docker.com/scout/). Topics: install/quickstart; analysis; dashboard; image details; exceptions (GUI or VEX); SBOM viewing/creation; artifact types; CLI config; policies (including local evaluation with built-in and custom Rego); integrations (CI, registries, environments); metrics exporter; advisory DB sources — [Docker docs full index](https://docs.docker.com/llms-full.txt)

**Docker Hardened Images (DHI)** — minimal, near-zero-CVE images, Helm charts, and system packages. Tiers are Community (free, Apache 2.0), Select, and Enterprise. Every tier includes distroless and non-root defaults, SLSA Build L3 provenance, signed SBOMs, VEX, signatures, Alpine/Debian variants (glibc/musl), and dev vs runtime variants. Select/Enterprise add FIPS/STIG variants, a 7-day critical-CVE SLA, customisations (5 on Select, unlimited on Enterprise), and Extended Lifecycle Support (Enterprise add-on, +5 years). — [DHI docs](https://docs.docker.com/dhi/). DHI how-tos cover search/evaluate, use, mirror, customize, scan, verify, policies, Helm, hardened packages, VEX API, and troubleshooting. Migration guides cover moving from Docker Official Images, Ubuntu, or Wolfi, AI-assisted migration, and a checklist. Tooling includes a CLI, API, Hub, MCP, and Terraform. — [Docker docs full index](https://docs.docker.com/llms-full.txt)

**Docker Desktop** — topics include install, settings, VMM, WSL, containerd image store, GPU, Wasm, synchronized file sharing, networking, USB/IP, built-in Kubernetes, resource saver, logs, backup/restore, troubleshooting. Enterprise topics are hardened desktop (ECI), enforced sign-in, allow-lists, and mass deployment. — [Docker docs full index](https://docs.docker.com/llms-full.txt)

**Testcontainers** — runs containers from code in your language for integration tests; it has its own manual plus per-language guides — [llms.txt](https://docs.docker.com/llms.txt)

### Inferences
- Docker's "lab-*" guides and the "Docker concepts" series are the closest thing to an official Docker learning path. A sensible order is: concepts → getting-started lab → building-images lab → Compose lab → supported-development → SDLC → attestation/DHI/Scout (supply chain) → AI/agents (optional track).
- Topics that are modern and absent from the DCA, and should get their own skill nodes: BuildKit/Buildx (cache backends, multi-platform, secrets, exporters, attestations), Bake, build checks/policies, Compose watch/profiles/include/OCI artifacts, Scout policies/VEX, hardened/distroless images, rootless mode, the containerd image store, nftables firewalling, Testcontainers.

### Gaps
- The Get started and Guides landing pages render client-side, so the exact grouping and difficulty/time metadata of guide categories could not be extracted. The structure above comes from the docs index.
- Docker does not appear to publish formal "learning path" badges or certificates for the labs. I found no evidence either way.

## 3. Red Hat EX188 (containers / Podman)

### Takeaway
EX188 is active. It is now listed as the **Red Hat Certified Developer in Cloud-native Applications** exam, formerly "Red Hat Certified Specialist in Containers". It is fully **performance-based**: 2.5 hours on a live system, currently targeting RHEL 10 / Podman v5 / OCP 4.22. It has five objective areas: Containerfile images, image management, running containers, multi-container apps, and troubleshooting. Its predecessor EX180 is retired.

### Cited Findings
- Format: hands-on on live systems, 150 minutes, product docs available, results within 3 US business days. Configurations must survive normal lifecycle events without manual restart. Several exam versions are in use, and per-version objectives sit in the LMS. Prep course: DO188. — [Red Hat EX188 page](https://www.redhat.com/en/services/training/ex188-red-hat-certified-specialist-containers-exam)
- Page title/credential: "Red Hat Certified Developer in Cloud-native Applications". The DE/ES pages say it counts toward Red Hat Certified Architect in Cloud-native Applications. A third-party blog calls the rename a naming update of the old "Certified Specialist in Containers". — [Red Hat EX188 page](https://www.redhat.com/en/services/training/ex188-red-hat-certified-specialist-containers-exam); [Refonte Learning](https://www.refontelearning.com/blog/red-hat-certification-overhaul-system-administrator-path)
- EX180 retired; EX188 is the current container exam. — [Red Hat Learning Community](https://learn.redhat.com/t5/Containers-DevOps-OpenShift/Differences-between-EX180-and-EX188/m-p/35884)

**Objectives (all [HO]), paraphrased** — [Red Hat EX188 page](https://www.redhat.com/en/services/training/ex188-red-hat-certified-specialist-containers-exam)
1. *Build images with Podman and a Containerfile:* choose a base image; add content; set the runtime environment (user ID, working directory, RUN commands); decide when and how to EXPOSE ports; pass ENV and build ARGs; set the default command (CMD/ENTRYPOINT); use volumes, including sharing host data (and SELinux labels); meet security and permission needs for host/network access (rootless, UID mapping); manage container and image lifecycles.
2. *Manage images:* private registry security (auth, TLS); work with several registry types (registries.conf, Quay, Docker Hub, internal); use tags; push and pull; back up an image with its layers and metadata (`podman save`/`load`, `skopeo copy`) and contrast this with backing up a container's state (`commit`/`export`/`checkpoint`).
3. *Run containers locally with Podman:* run containers; read container logs; watch host events (`podman events`); use `podman inspect`; set environment parameters; expose public apps (port publishing); get app logs; inspect running apps.
4. *Multi-container apps with Podman:* build app stacks (pods, `podman compose`/kube play, Quadlet are likely tools, though the page does not name them); handle dependencies between containers; environment variables; secrets (`podman secret`); volumes; configuration.
5. *Troubleshoot containerized apps:* read resource descriptions; get logs; inspect running apps; connect to running containers (`exec`).

### Inferences
- The "must persist across reboots" rule suggests systemd integration (Quadlet / `podman generate systemd`) is tested implicitly, even though it is not a named objective. A Podman lab track should include it.
- EX188 is the best current model for **performance-based container grading**. Its five domains map almost one-to-one onto Docker skill nodes, so a lab platform can run each node in both Docker and Podman variants.

### Gaps
- No official weights are published (Red Hat does not weight objectives). The per-version LMS objectives and the exact rename date were not available publicly.

## 4. Related anchors: CNCF KCNA, Linux Foundation container courses, OCI specifications

### Takeaway
KCNA (updated curriculum, Nov 2025) puts containers inside "Container Orchestration" (28%). LFS253 Containers Fundamentals is an active, ~40-hour self-paced hands-on course (updated May 2026). The three OCI specs (image v1.1.1, runtime v1.3.0, distribution v1.1.1) are the vendor-neutral technical anchor for image, runtime, and registry skill nodes.

### Cited Findings
**KCNA** — [CNCF curriculum repo, KCNA README](https://github.com/cncf/curriculum/tree/master/kcna); [KCNA_Curriculum.pdf](https://github.com/cncf/curriculum/blob/master/KCNA_Curriculum.pdf) (last commit 2025-11-24, per the GitHub API)
- Domains: Kubernetes Fundamentals 44%, Container Orchestration 28%, Cloud Native Application Delivery 16%, Cloud Native Architecture 12%.
- Topic bullets in the PDF: Kubernetes core concepts, administration, scheduling, **containerization**, networking, security, troubleshooting, storage; application delivery, debugging, observability; cloud native ecosystem and principles; community and collaboration. The PDF's two-column layout makes it ambiguous which bullet belongs to which domain. Containerization, networking, security, troubleshooting, and storage most likely sit under Container Orchestration (inference).
- The exam is multiple-choice and knowledge-only [K] (my understanding of KCNA, not checked against the PDF in this pass). Recommended prep includes LFS250 and edX intro courses.

**Linux Foundation — Containers Fundamentals (LFS253)** — [LF training page](https://training.linuxfoundation.org/training/containers-fundamentals/)
- Active. $299, self-paced, about 40 hours, intermediate, hands-on labs (your own Linux machine plus cloud or VirtualBox), 12 months of access, digital badge. Page metadata shows an update on 2026-05-10 (first published 2020).
- Chapters: Course Intro; Virtualization Fundamentals; Virtualization Mechanisms; Container Standards and Runtimes; Container Images; Container Operations; Building Container Images; Container Networking; Container Storage; Runtime and Container Security.
- Outcomes: install, run, manage, and troubleshoot containers; run image and container operations across **multiple runtimes**; manage networking and volumes; build multi-container apps with Docker and its APIs.

**OCI specifications** — [opencontainers/image-spec](https://github.com/opencontainers/image-spec), [runtime-spec](https://github.com/opencontainers/runtime-spec), [distribution-spec](https://github.com/opencontainers/distribution-spec) (versions from GitHub releases API)
- *Image spec* v1.1.1 (Mar 2025): media types, content descriptors (digest-addressed), image layout, image manifest, image index (multi-arch), filesystem layers (changesets, whiteouts), image config, annotations, conversion to a runtime bundle, and artifacts guidance (non-image content).
- *Runtime spec* v1.3.0 (Nov 2025): container principles, filesystem bundle, runtime and lifecycle (create/start/kill/delete, hooks), config (Linux/Windows/FreeBSD/Solaris/VM/z/OS sections), features structure. runc is the reference implementation.
- *Distribution spec* v1.1.1 (Jan 2025): registry HTTP API for push/pull of blobs and manifests, tag listing, content discovery, the **Referrers API** (attaching SBOMs and signatures to images), conformance, proxying, error codes. Definitions cover registry, repository, blob, manifest, image index, config, and "object" (formerly "artifact").

### Inferences
- Suggested OCI-anchored nodes: image anatomy (manifest/index/config/layers, inspected with `crane`/`skopeo`/`oras`); multi-arch indexes; runtime bundle + runc hands-on (`runc spec`/`run`); registry API with curl (token auth, manifest GET/PUT, referrers); artifacts (Helm charts, Compose apps, SBOMs as OCI artifacts). These connect Docker, Podman, BuildKit, Scout/DHI attestations, and Kubernetes (containerd/CRI-O).
- Linux primitives (namespaces, cgroups v2, capabilities, seccomp, union FS) appear in DCA D3/D5, LFS253 ch. 2–3/10, and EX188 (rootless). They belong as foundational nodes shared with the Linux pack.

### Gaps
- I did not fetch LF's free edX courses (e.g., LFS151 "Introduction to Cloud Infrastructure Technologies") or LFD/LFS Podman courses in detail. Their container chapters are not itemised here.
- The OCI distribution-spec release date and the exact runtime-spec v1.3 changes were not studied beyond the TOC.

## 5. Performance-based vs knowledge: summary

### Takeaway
Of the credentials covered, only **EX188** is performance-based. **DCA** and **KCNA** are multiple-choice/DOMC knowledge exams. **LFS253** and the **Docker docs labs** are hands-on learning without proctored assessment.

### Cited Findings
- DCA: 55 MC/DOMC items, no live tasks — [DCA Study Guide](https://a.storyblok.com/f/146871/x/6daa07336d/docker-study-guide_v1-5-october.pdf); [Mirantis](https://training.mirantis.com/certification/dca-certification-exam/)
- EX188: hands-on on a live system, 2.5 hours — [Red Hat](https://www.redhat.com/en/services/training/ex188-red-hat-certified-specialist-containers-exam)
- LFS253: self-paced with hands-on labs — [LF](https://training.linuxfoundation.org/training/containers-fundamentals/)
- Docker "lab-*" guides: hands-on interactive labs in a live environment — [Docker docs index](https://docs.docker.com/llms-full.txt)

### Inferences
- In the DCA tables above, [HO] marks items that can be built as auto-graded lab tasks: state checks via `docker inspect`, `service ls`, `network inspect`, registry API, image digests/labels. [K] items fit quizzes or explain-steps.
- Recommended credential mapping for learner-facing paths: "Docker Fundamentals" → LFS253/Docker concepts; "Docker exam prep (legacy)" → DCA with LEGACY items flagged; "Podman / Red Hat" → EX188; "Next step" → KCNA → CKAD/CKA.

### Gaps
- No vendor publishes pass-rate or item-type splits per domain. I found no evidence of any new Docker-specific performance-based certification announced for 2025–2026.
