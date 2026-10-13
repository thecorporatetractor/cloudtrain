# Terraform/OpenTofu Offline Lab Runtime and Licensing (2025-2026)

Research date: 2026-10-14. Licensing items separate **facts** (cited) from **interpretation** (Inferences). This is not legal advice.

## Q1. Offline targets: what should the learner's Terraform point at?

### Takeaway
No single offline target gives a full cloud. In 2026 the most realistic and legally clean set is: the **kubernetes/helm providers against a per-lab vcluster** (real API, real RBAC, real networking objects), plus the utility providers (local/null/random/tls/http). Add **Moto server** (Apache-2.0) as the default AWS emulator, and **vcsim** for vSphere-flavoured labs. LocalStack changed significantly in March 2026: one auth-token-gated image, with a free tier for non-commercial use only. It is no longer a free drop-in for a commercial hosted product.

### Cited Findings
- **LocalStack changes:** LocalStack's post (Dec 18, 2025, updated Mar 17, 2026) says the Community and Pro images merge into one `localstack/localstack` image from March 2026, and that image requires an auth token. LocalStack "cannot commit to releasing regular updates" to Community. Security patches and features go only to the new image. — [LocalStack blog](https://blog.localstack.cloud/the-road-ahead-for-localstack/)
- **LocalStack free tier:** The free tier is **non-commercial use only**. Business-use questions go to a contact form. The page says Enterprise has "dedicated support and deployment models" but does not explicitly mention offline/air-gapped images. Older image tags still run without auth but get no patches. The Community source stays on GitHub, marked inactive. — [LocalStack blog](https://blog.localstack.cloud/the-road-ahead-for-localstack/)
- **LocalStack cutover dates (secondary sources):** Third-party sources give March 23, 2026 as the cutover. They also mention a temporary `LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1` deferral that ran until April 6, 2026. Paid plans reportedly start at $39 per licence per month. One vendor-tracking page conflicts with this, claiming Community was "still available as open source". — [agentdeals](https://agentdeals.dev/vendor/localstack); [byteiota](https://byteiota.com/floci-free-aws-emulator-after-localstack-goes-paid/)
- **LocalStack alternatives (unvetted):** Community forks and alternatives have appeared: LocalEmu (a fork of archived Community), Floci, and Kumo. — [aws.plainenglish LocalEmu](https://aws.plainenglish.io/meet-localemu-the-free-successor-to-localstack-b9755ba6c91e); [aws.plainenglish Kumo](https://aws.plainenglish.io/meet-kumo-a-free-no-account-local-aws-emulator-4a171b917401)
- **KodeKloud's approach:** KodeKloud offers a "Terraform + LocalStack Playground" alongside real-cloud playgrounds for AWS, GCP and Azure. The AWS playground is 1 hour, extendable by 15 minutes, needs Pro, and does not support managed node groups. — [KodeKloud playgrounds](https://kodekloud.com/pages/playground-terraform); [KodeKloud community](https://kodekloud.com/community/t/testing-projects-on-kode-kloud/497890)
- **Moto server mode:** Moto runs as a standalone server (`moto[server]`, default port 5000, Docker image available) that any AWS SDK can target. Its docs include a Terraform AWS provider example with a custom endpoint, skip-credential/metadata validation flags, and S3 path-style addressing. `s3-control` needs hosts-file entries for account-ID-prefixed hostnames. — [Moto server mode docs](https://moto.readthedocs.io/en/latest/_sources/docs/server_mode.rst.txt)
- **vcsim:** vcsim is a vCenter/ESXi API (SOAP) simulator in the govmomi repo. By default it models a datacenter, hosts, a cluster, resource pools, networks and a datastore. — [govmomi pkg.go.dev](https://pkg.go.dev/github.com/vmware/govmomi@v0.55.0)
- **vcsim with Terraform:** HashiCorp's own vSphere provider tutorial uses vcsim as a prerequisite environment. It notes "some key differences when compared to vSphere and some features are not supported". — [HashiCorp tutorial](https://developer.hashicorp.com/terraform/tutorials/virtual-machine/vsphere-provider/vmware-environment%3Avcsim)
- **vcsim cloning limit (dated source):** An older community note says Terraform against vcsim can't really clone VMs. — [Docker Hub satak/vcsim](https://hub.docker.com/r/satak/vcsim)

### Inferences
- **Most realistic "cloud" experience:**
  - Kubernetes/helm against a per-learner vcluster: real reconciliation, RBAC (an IAM analogue), NetworkPolicy/Service/Ingress (a networking analogue) and the `kubernetes` state backend. It is all in-cluster, so it fits the platform with no third-party licence exposure.
  - Moto: the best free AWS-shaped target for IAM/VPC/S3 resource *shapes*, though behaviour is emulated, not enforced.
  - vcsim: on-brand with the platform's vCenter focus, but limited in clone/guest operations.
- **Docker provider:** Needs a Docker daemon per lab, which on K8s means DinD/rootless or a sidecar. It is good for beginner "real effect" labs but less cloud-like.
- **libvirt provider:** Fits KubeVirt/nested-virt hosts and gives real VMs and networks. It is heavier, so reserve it for advanced labs.
- **Proxmox:** Only if a Proxmox host already exists. It adds an infrastructure dependency for limited added realism.
- **Azure and GCP:** Azurite (Azure Storage only) and the GCP emulators (Pub/Sub, Firestore, Bigtable, Spanner) cover data-plane services, not IAM or networking. They are low value for Terraform labs. This is not verified this session.
- **Kind:** Overlaps with vcluster. vcluster is lighter on an existing K8s platform. Kind inside a pod needs privileged DinD.
- **LocalStack:** For a commercial hosted product, assume a paid or Enterprise LocalStack agreement is required for any version that gets patches. Pinning a pre-2026 Community tag is possible but unpatched. That is a security and supportability concern, and whether those old Apache-2.0 tags may be used commercially should be checked against the tag's own license file.

### Gaps
- LocalStack Enterprise offline/air-gapped licensing terms and pricing are not public on the pages read.
- Moto's license (believed Apache-2.0) was not confirmed from the repo this session.
- I did not verify Azurite or GCP emulator feature lists, the current status of the libvirt and Proxmox providers, or Killercoda's Terraform setup (no results found).
- I did not verify whether the vSphere provider's acceptance tests run against vcsim.

## Q2. Offline provider and module installation

### Takeaway
Both CLIs support `provider_installation` with `filesystem_mirror` and `network_mirror`. Recommended process:
- Build-time: run `terraform providers mirror` (or `tofu providers mirror`) against a "lab catalogue" config for `linux_amd64` (+`arm64`).
- Bake the result into the lab image as a filesystem mirror, or serve it once as a cluster-wide network mirror.
- Disable `direct`.

OpenTofu 1.10+ also adds `oci_mirror`, so providers and modules can be served from the platform's existing OCI registry (Harbor and similar). That is a strong fit for an air-gapped K8s platform.

### Cited Findings
- **Installation methods:** `provider_installation` supports these methods, each with `include`/`exclude` patterns (`exclude` wins). Terraform picks the newest version across matching methods. To use only a mirror, remove `direct` or exclude the mirrored providers from it. — [Terraform CLI config](https://developer.hashicorp.com/terraform/cli/config/config-file)
  - `filesystem_mirror`: a local `path`, in packed (zip) or unpacked layout, and unpacked can be symlinked.
  - `network_mirror`: an HTTPS `url` with a trailing slash, with a warning against untrusted mirrors.
  - `direct`
- **Implied mirror directories (Linux):** `~/.terraform.d/plugins`, `~/.local/share/terraform/plugins`, `/usr/local/share/terraform/plugins`, `/usr/share/terraform/plugins`, plus `terraform.d/plugins` in the working directory. Implied `direct` auto-excludes providers found there. — [Terraform CLI config](https://developer.hashicorp.com/terraform/cli/config/config-file)
- **Plugin cache:** `plugin_cache_dir` / `TF_PLUGIN_CACHE_DIR` must already exist, must not be a mirror directory, and is not guaranteed concurrency-safe. A cached provider is used only if its checksum matches `.terraform.lock.hcl`, unless `plugin_cache_may_break_dependency_lock_file` is set. — [Terraform CLI config](https://developer.hashicorp.com/terraform/cli/config/config-file)
- **`terraform providers mirror`** (v0.13+):
  - Writes the filesystem-mirror layout of `.zip` packages plus `.json` index files. Uploading that directory to a static web host makes it a valid network mirror.
  - `-platform=OS_ARCH` can be repeated.
  - Honours the lock file by default (`-lock-file=true`).
  - Can be re-run on the same directory to add packages without removing existing ones.
  - Source: [Terraform providers mirror](https://developer.hashicorp.com/terraform/cli/commands/providers/mirror)
- **OpenTofu equivalents:**
  - Same `filesystem_mirror` / `network_mirror` methods; `network_mirror` adds `download_retry_count` and `trust_all_hashes`.
  - New `oci_mirror` (mapping provider addresses to OCI repositories), with `oci_credentials` blocks.
  - Default registry is `registry.opentofu.org`.
  - Env vars are the same `TF_*` family: `TF_CLI_CONFIG_FILE`, `TF_PLUGIN_CACHE_DIR`, `TF_TOKEN_<host>`.
  - Source: [OpenTofu CLI config](https://opentofu.org/docs/cli/config/config-file/)
- **OpenTofu 1.10.0 OCI support:** Adds OCI registry support for distributing providers and modules, "perfect for air-gapped environments". — [OpenTofu 1.10.0 blog](https://opentofu.org/blog/opentofu-1-10-0/); [What's new](https://opentofu.org/docs/v1.10/intro/whats-new/)
  - Providers: OCI works only as a *mirror*, not as a primary source.
  - Modules: use `oci://` sources, packaged as a zip artifact (for example with `oras`). — [oneuptime guide](https://oneuptime.com/blog/post/2026-03-20-oci-registry-support-opentofu-1-10/markdown); [OpenTofu OCI docs](https://opentofu.org/docs/main/cli/oci_registries)
- **OpenTofu registry coverage:** The OpenTofu registry hosts the major HashiCorp-maintained providers (AWS, AzureRM, Google). Niche providers may be missing and can be addressed explicitly via `registry.terraform.io/...`. — [oneuptime registry differences](https://oneuptime.com/blog/post/2026-03-20-provider-registry-changes-opentofu/markdown)

### Inferences
- **Provider catalogue:** Ship one pinned catalogue per course version (kubernetes, helm, docker, local, null, random, tls, http, aws for Moto, vsphere, libvirt, plus a lock file). Pre-populate `.terraform.lock.hcl` hashes in starter repos so `init` is deterministic offline. Mirroring for both `registry.terraform.io/*` and `registry.opentofu.org/*` addresses lets both CLIs work.
- **Modules offline:**
  - Git sources (`git::https://gitea.lab.local/...?ref=v1.2.0`) against an in-cluster Gitea/Forgejo are the simplest option and work in both CLIs.
  - OpenTofu can also use `oci://` modules from Harbor.
  - A private registry protocol implementation is optional: a static module-registry server, Terrakube, or Gitea/GitLab's Terraform module registry. None of these were verified this session.

### Gaps
- I did not confirm whether a later OpenTofu (1.11+) allows OCI as a primary provider source.
- Private module registry options (Terrakube, GitLab, Gitea package registry) were not researched in depth.

## Q3. Offline remote state backends

### Takeaway
Use the S3 backend with `use_lockfile = true` against an in-cluster S3-compatible store. DynamoDB locking is deprecated, so no DynamoDB emulator is needed. Note that **MinIO Community Edition is effectively discontinued**: no binaries or images since October 2025, maintenance mode in December 2025, and the repository archived in 2026. Plan for SeaweedFS (Apache-2.0) or Garage, or a pinned or commercial MinIO. The `kubernetes` backend (state in Secrets with Lease locking) is a zero-extra-component alternative.

### Cited Findings
- **S3 backend locking:**
  - `use_lockfile` (default `false`) locks state with a lockfile in S3.
  - `dynamodb_table` / `dynamodb_endpoint` locking "is deprecated" and will be removed in a future minor version.
  - S3-compatible support is "best effort": HashiCorp tests only against Amazon S3.
  - Source: [Terraform S3 backend docs](https://developer.hashicorp.com/terraform/language/backend/s3)
- **S3-compatible settings:** `endpoints.s3`, `use_path_style`, `skip_credentials_validation`, `skip_requesting_account_id`, `skip_metadata_api_check`, `skip_region_validation`, `skip_s3_checksum`. — [Terraform S3 backend docs](https://developer.hashicorp.com/terraform/language/backend/s3)
- **Lockfile mechanism:** The lockfile is a `.tflock` object created with an S3 conditional write (`If-None-Match`), introduced in Terraform 1.10. — [freeCodeCamp](https://www.freecodecamp.org/news/how-to-migrate-to-s3-native-state-locking-in-terraform/); [OVHcloud](https://blog.ovhcloud.com/terraform-s3-state-locking-ovhcloud-object-storage/)
  - Conflict: freeCodeCamp claims Object Lock is required on the bucket. This is unverified and is likely wrong, given the conditional-write mechanism.
  - Sources disagree on the OpenTofu version: 1.8 vs 1.10. — [oneuptime](https://oneuptime.com/blog/post/2026-03-20-native-s3-state-locking-opentofu-1-10/markdown)
- **MinIO conditional writes:** MinIO supports both `If-None-Match` and `If-Match`, merged in February 2023. — [MinIO blog](https://www.min.io/blog/leading-the-way-minios-conditional-write-feature-for-modern-data-workloads)
- **MinIO quorum issue (unconfirmed fix):** A reported issue lets conditional PUTs proceed when read quorum is unavailable, which matters only for distributed MinIO. — [harborframework task](https://hub.harborframework.com/tasks/abundant/minio__minio-21653)
- **MinIO CE status:** Admin features were stripped from the console in May 2025. Binaries and Docker images stopped in October 2025, and maintenance mode began December 3, 2025. Repo archive dates are reported inconsistently (February and/or April 25, 2026). — [glukhov.org](https://glukhov.org/data-infrastructure/object-storage/minio-dead/); [pinggy](https://pinggy.io/blog/minio_archived_self_hosted_s3_alternatives/); [itsfoss](https://itsfoss.com/news/minio-moves-away-from-open-source/)
- **Replacements:** SeaweedFS (Apache-2.0) and Garage (AGPLv3 per one source, unconfirmed) are the most-cited replacements. Open edX chose Garage. — [pinggy](https://pinggy.io/blog/minio_archived_self_hosted_s3_alternatives/); [Open edX discuss](https://discuss.openedx.org/t/replacing-minio-in-tutor-minio-why-we-chose-garage-and-what-comes-next/18868)

### Inferences
- **Backend tiers:**
  - Beginner labs: `local` backend.
  - "Remote state" module: S3 backend plus `use_lockfile` against the platform's object store. Teaches the production pattern, and learners can be shown a held `.tflock`.
  - Advanced: the `kubernetes` backend (Secret plus Lease lock, inside the learner's vcluster), the `pg` backend (Postgres advisory locks), and the `http` backend (for example a GitLab-style state API) as variety. These backend behaviours are from general knowledge and were not re-verified this session.
- **Object store choice:** Whatever store replaces MinIO must support `If-None-Match` conditional PUT, or `use_lockfile` will not lock safely. Test this explicitly (two concurrent `apply`s) before standardising. Moto's S3 can also act as a state backend for AWS-themed labs.

### Gaps
- I found no first-party confirmation that SeaweedFS or Garage implement `If-None-Match` conditional writes compatibly with Terraform `use_lockfile`.
- The exact OpenTofu version that introduced `use_lockfile` is unresolved (1.8 vs 1.10).

## Q4. Grading approaches

### Takeaway
Grade in three layers:
1. **Target system truth**, checked with kubectl/govc/AWS CLI against Moto. This is the most robust signal.
2. **State inspection** via `terraform show -json` / `tofu show -json`, parsed with jq or OPA.
3. **Plan/drift checks** via `plan -detailed-exitcode` (0 = no changes, 2 = changes pending).

Policy-as-code checks with conftest on `show -json` plan output fit "write compliant code" tasks.

### Cited Findings
- I gathered no new primary sources this session specifically on grading commands.
- Related verified facts:
  - vcsim works with `govc`, the vSphere CLI shipped alongside it in govmomi. — [govmomi pkg.go.dev](https://pkg.go.dev/github.com/vmware/govmomi@v0.55.0)
  - Moto exposes standard AWS APIs, so the AWS CLI/SDK can query created resources. — [Moto server mode docs](https://moto.readthedocs.io/en/latest/_sources/docs/server_mode.rst.txt)

### Inferences
- **Grader setup:** Graders run as a sidecar or job with read-only credentials to the learner's vcluster, Moto, and state backend. Read state from the backend, not from the learner's workspace, so it can't be faked locally.
- **Checks to combine:**
  - Resource exists, with the expected attributes in the target system.
  - Resource is under Terraform management: present in `show -json` `values.root_module.resources`.
  - No drift: `plan -detailed-exitcode` returns 0 after apply.
  - Style and structure: `terraform fmt -check`, `validate`, conftest/OPA rules on plan JSON (for example "all resources tagged", "no public S3 ACL"), and module-structure checks on HCL.
- **CLI-agnostic grading:** OpenTofu and Terraform `show -json` formats are compatible in practice, so one grader can serve both CLIs. Verify per version.
- **Native test framework:** `terraform test` / `tofu test` can serve as learner-facing self-checks.

### Gaps
- I did not verify the exact JSON output schema compatibility between Terraform and OpenTofu.
- Conftest/OPA versions and Instruqt-style "check scripts" for Terraform were not researched.

## Q5. Licensing: Terraform (BUSL 1.1) vs OpenTofu (MPL 2.0) for a commercial hosted training product

### Takeaway
**Facts:** Terraform 1.6.0+ is BUSL 1.1, now licensed by IBM. The Additional Use Grant permits production use *except* offering it to third parties hosted or embedded in a **paid product that significantly overlaps IBM's paid Terraform versions** (HCP Terraform / Terraform Enterprise). Providers remain MPL 2.0. HashiCorp's FAQ does not address training platforms.

**Interpretation:** A training/lab SaaS where learners run the CLI to learn it is plausibly *not* a "competitive offering", because it does not substitute for HCP Terraform's remote runs, state management, or policy features. However, the platform *does* host and run the binary for paying third parties, and a lab feature set that drifts toward a hosted state/run/policy service increases risk.

**Recommendation:** Make **OpenTofu the default CLI** (zero licence ambiguity, plus OCI mirrors for air-gap). Offer Terraform as a learner-selectable option only after written confirmation from licensing@hashicorp.com, or ship Terraform labs with clear documentation of the reasoning.

### Cited Findings
- **Terraform LICENSE parameters:**
  - Licensor: "International Business Machines Corporation (IBM)".
  - Licensed Work: "Terraform Version 1.6.0 or later".
  - Change Date: four years from publication of each version.
  - Change License: MPL 2.0.
  - Source: [Terraform LICENSE](https://raw.githubusercontent.com/hashicorp/terraform/main/LICENSE)
- **Additional Use Grant:**
  - Production use is allowed, but not offering the Licensed Work to third parties on a hosted or embedded basis in a competitive offering.
  - Competitive offering: a *paid* Product that significantly overlaps IBM's paid versions. Unpaid products are not competitive. A product does not become competitive later because IBM adds features.
  - Product: software offered to end users to manage in their own environments, or offered as a hosted service.
  - Embedded: including the code or executables in a competitive offering, or packaging it so that the Licensed Work must be downloaded for it to run.
  - Internal hosting within an organization (including affiliates) is not competitive.
  - Source: [Terraform LICENSE](https://raw.githubusercontent.com/hashicorp/terraform/main/LICENSE)
- **HashiCorp FAQ (reproduced in the 2023 blog post):**
  - Competitive offering: a product "sold to third parties, including through paid support arrangements, that significantly overlaps the capabilities of a HashiCorp commercial product". Example: "hosting or embedding Terraform as part of a solution that is sold competitively against our commercial versions of Terraform."
  - Consultants may help customers with "their own use", but may not host or embed in a competitive offering for multiple customers.
  - Providers, SDKs and APIs "will remain licensed under" MPL 2.0.
  - Specific questions go to licensing@hashicorp.com.
  - Source: [HashiCorp blog, Aug 21, 2023](https://www.hashicorp.com/en/blog/hashicorp-updates-licensing-faq-based-on-community-questions)
- **FAQ page itself:**
  - Lists Q12 (competitive offering), Q14 (embedded, with examples added Apr 15, 2024), Q26 (internal hosting), Q27 (professional services), and Q28 (consultants).
  - Has no entry on training or education.
  - Latest change-log entry is April 2024, with no IBM-era substantive changes listed.
  - Source: [HashiCorp License FAQ](https://www.hashicorp.com/en/license-faq)
- **IBM acquisition:** IBM completed the HashiCorp acquisition on February 27, 2025 (about $6.4B). HashiCorp operates as a division of IBM Software. — [IBM press release](https://newsroom.ibm.com/2025-02-27-ibm-completes-acquisition-of-hashicorp,-creates-comprehensive,-end-to-end-hybrid-cloud-platform); [TechRepublic](https://www.techrepublic.com/article/ibm-hashicorp-acquisition-completed/)
- **Provider licence example:** `terraform-provider-kubernetes` is MPL 2.0. — [GitHub LICENSE](https://github.com/hashicorp/terraform-provider-kubernetes/blob/main/LICENSE)
- **OpenTofu origin:** OpenTofu is the fork created in response to the BUSL switch. Its registry is `registry.opentofu.org`. — [OpenTofu CLI config](https://opentofu.org/docs/cli/config/config-file/); [Cisco blog](https://blogs.cisco.com/developer/open-tofu-providers)
- **LocalStack (relevant to licensing):** The free tier is non-commercial only. Commercial use requires a paid plan or a sales contact. — [LocalStack blog](https://blog.localstack.cloud/the-road-ahead-for-localstack/)
- **MinIO (relevant to licensing):** CE was AGPL and is now unmaintained, per the secondary sources above. SeaweedFS is Apache-2.0. — [pinggy](https://pinggy.io/blog/minio_archived_self_hosted_s3_alternatives/)
- **Trademark policy:** HashiCorp marks may be used only to identify HashiCorp products accurately and without misleading or implying endorsement. Nominative fair use generally covers word marks only, and the policy suggests a notice such as "[Mark] is a trademark of HashiCorp". — [HashiCorp trademark policy](https://www.hashicorp.com/trademark-policy)
- **Third-party practice:** Third parties add "not affiliated with or endorsed by HashiCorp" disclaimers when using the Terraform name. — [gitlab.com/tfmod](https://gitlab.com/tfmod)

### Inferences (interpretation, not legal advice)
- **Why a training platform is arguably not "competitive":** The platform sells *education*. IBM's paid Terraform products sell remote execution, state management, a private registry, policy, and team workflow. A per-learner ephemeral sandbox where the learner types `terraform apply` is closest to "providing a hosted environment in which a third party uses Terraform". The FAQ's own competitive example is a solution "sold competitively against our commercial versions of Terraform". HashiCorp's own tutorials run in Instruqt sandboxes, and KodeKloud sells Terraform playgrounds, which suggests this pattern is tolerated in the market. That is an observation, not a licence term.
- **Why there is still risk:**
  - The text says "offer the Licensed Work to third parties on a hosted ... basis" in a paid product, and the platform does exactly that with the binary.
  - "Significantly overlaps" is undefined and decided by the licensor.
  - Features like a shared remote-state service, run history, policy gates, or a module registry exposed to customers move the platform toward HCP Terraform's capabilities.
  - IBM, as the new licensor, has not published updated guidance, and BUSL terms can change for future versions.
- **OpenTofu removes the question:**
  - MPL 2.0 permits commercial hosting and embedding. Obligations apply only to modified MPL files.
  - CLI syntax is near-identical for the curriculum scope (HCL, state, backends, modules).
  - OpenTofu adds OCI mirrors useful for air-gap.
- **Providers:** Providers are MPL 2.0 regardless of the CLI, so mirroring and redistributing them inside the platform is fine. Keep their licence notices in the mirror image.
- **Terraform track options:** If a "Terraform" track is commercially important:
  - (a) Get written confirmation from licensing@hashicorp.com that a per-learner training sandbox is non-competitive, or
  - (b) Use MPL-licensed Terraform ≤1.5.7 for older content. It is outdated, missing `import` blocks, `removed`, `use_lockfile`, and `terraform test`, so it is not recommended.
- **Trademark:** Course titles like "Infrastructure as Code with Terraform and OpenTofu" or "Terraform Associate exam prep" are typical nominative use. Do not use HashiCorp/Terraform logos. Do not imply official or authorized status unless enrolled in a HashiCorp partner or authorized-training programme. Add a footer notice: "Terraform is a trademark of HashiCorp, an IBM Company; this course is not affiliated with or endorsed by HashiCorp/IBM." The OpenTofu name is a Linux Foundation project mark, so apply similar care.
- **Recommended shipping model:**
  - Default CLI: OpenTofu.
  - Content written CLI-neutrally (`tf` alias, with callouts for differences such as state encryption and OCI in OpenTofu, and HCP features in Terraform).
  - Terraform binary offered optionally after licensing confirmation.
  - Moto instead of LocalStack unless a commercial LocalStack agreement is signed.
  - SeaweedFS or Garage, or licensed MinIO, for the S3 state backend.

### Gaps
- The full answer text of FAQ Q12 to Q28 on hashicorp.com did not render. The answers above come from the 2023 blog reproduction, so current wording may differ slightly.
- I found no HashiCorp/IBM statement specifically on training or education platforms.
- I found no public evidence of a licensing arrangement between HashiCorp and KodeKloud or Instruqt.
- I did not obtain the HashiCorp trademark policy's full nominative fair use conditions or a specific course-title rule.
- The OpenTofu trademark policy (Linux Foundation) was not reviewed.
- LocalStack's commercial licence terms for hosted training (as opposed to developer seats) are not published.

## Q6. How existing platforms run Terraform labs

### Takeaway
- HashiCorp's own interactive labs run on Instruqt sandboxes, which are provisioned with Terraform and often pre-seeded with a scenario.
- KodeKloud runs browser VS Code with Terraform pre-installed. It targets either real cloud accounts it provisions (time-boxed) or LocalStack.
- No reliable information was found on Killercoda's Terraform setup.

### Cited Findings
- **HashiCorp and Instruqt:** HashiCorp uses Instruqt with Terraform-provisioned sandboxes pre-populated with a scenario and a task. Learners play Terraform and Vault challenges there. — [HashiCorp resource: Instruqt](https://hashicorp.com/en/resources/instruqt-arcade-learning-terraform)
- **Instruqt Terraform sandbox resource:** Instruqt's docs describe a Terraform sandbox resource that runs a Terraform configuration inside a lab sandbox, for its upcoming "Instruqt 2.0 Labs" (Sep 2026). — [Instruqt docs](https://docs.labs.instruqt.com/ui-overview/sandboxes/terraform/)
- **KodeKloud playgrounds:**
  - Browser VS Code with Terraform pre-installed.
  - AWS, GCP and Azure variants, where "You don't even need an AWS account".
  - A Terraform + LocalStack variant.
  - The AWS playground runs 1 hour, extendable by 15 minutes, and needs Pro.
  - Source: [KodeKloud](https://kodekloud.com/pages/playground-terraform)
- **HashiCorp vSphere tutorial:** Targets vcsim. — [HashiCorp tutorial](https://developer.hashicorp.com/terraform/tutorials/virtual-machine/vsphere-provider/vmware-environment%3Avcsim)

### Inferences
- **Market split:** Competitors split into real-cloud sandboxes (costly, needs internet and account vending) and emulator labs (LocalStack). An offline, K8s-first platform differentiates by making Kubernetes/vcluster plus vcsim plus Moto the "cloud". That is honest realism for state, modules, backends and workflows, while being upfront that AWS behaviour is emulated.

### Gaps
- Killercoda's Terraform scenario backend and KodeKloud's internal sandbox architecture were not found.
