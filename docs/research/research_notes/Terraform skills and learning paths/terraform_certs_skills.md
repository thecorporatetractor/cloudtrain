# Terraform / OpenTofu Certifications and IaC Skills (2025-2026)

Research date: 2026-10-14. All objective lists below are paraphrased, not exam text.

## Q1. HashiCorp Terraform certifications: status, dates, objectives, format

### Takeaway
As of October 2026 the Terraform track has three credentials. **Terraform Associate 004** replaced 003 on 8 Jan 2026 and tests Terraform 1.12. The lab-based **Terraform Authoring and Operations Professional** is being renamed **Advanced** (effective Fall 2026), keeping the same content and format. A new multiple-choice **Terraform Infrastructure Engineer Professional (002)** launches October 2026 and tests Terraform 1.15. HCP Terraform appears as its own domain in all three.

### Cited Findings

**Program structure and status**
- The certification hub lists three Terraform exams. The Associate is multiple choice, takes 1 hour and tests TF 1.12. Infrastructure Engineer Professional is multiple choice, intermediate level and tests TF 1.15. Authoring and Operations Advanced is lab-based, advanced level and is listed against TF 1.6. — [HashiCorp certifications hub](https://developer.hashicorp.com/certifications/infrastructure-automation)
- Rename: Terraform Authoring and Operations Professional becomes "Terraform Authoring and Operations Advanced", and Vault Operations Professional becomes Vault Operations Advanced. The change applies to past and future holders, and badges and links update automatically. The content and the lab-based format stay the same. It takes effect Fall 2026. The announcement describes the program as two levels, Associate and Advanced. — [Announcement: TAO Advanced](https://developer.hashicorp.com/terraform/tutorials/pro-cert/adv-update)
  - Conflict: the hub lists a third, multiple-choice "Infrastructure Engineer Professional" exam alongside Associate and Advanced, so the "two levels" wording in the announcement appears to describe only the rename. Treat the program as Associate, then Professional (multiple choice), then Advanced (lab).
- Associate 003 to 004 transition: 5 Jan 2026 was the last day to schedule 003 and 7 Jan 2026 the last day to sit it. 004 became available on 8 Jan 2026. A candidate who failed 003 retakes on 004. — [hashicorp.com Terraform Associate page](https://Hashicorp.com/certification/terraform-associate) (via search summary); a [DEV community post](https://dev.to/thukhakyawe_cloud/the-terraform-associate-003-exam-will-be-replaced-by-the-terraform-associate-004-exam-version-on-423m) confirms it.
- Third-party sources disagree on Associate 004 logistics. One cites 57 questions in 60 minutes via PSI. Others say delivery moved to Certiverse in 2025. I found no official question count. — [certland guide](https://certland.net/blog/hashicorp-terraform-associate-certification-guide-2026/), [open-exam-prep](https://open-exam-prep.com/study-guides/terraform-associate/introduction/exam-004-changes-study-plan)

**Terraform Associate 004 (tests TF 1.12), paraphrased objectives** — [Exam content list 004](https://developer.hashicorp.com/terraform/tutorials/certification-004/associate-review-004)
1. IaC concepts: what IaC is, its benefits, and how Terraform supports multi-cloud, hybrid and service-agnostic workflows.
2. Fundamentals: installing and versioning providers, how providers plug in, configurations that use several providers, and the purpose of state.
3. Core workflow: write, init, validate, plan, apply, destroy, plus `fmt`.
4. Configuration:
   - (a) resource vs data blocks
   - (b) attribute references across resources
   - (c) variables and outputs
   - (d) complex types
   - (e) expressions and functions
   - (f) **NEW** explicit dependencies and lifecycle rules (depends_on, create_before_destroy)
   - (g) **NEW** custom conditions (validation, pre/postconditions, check)
   - (h) **NEW** sensitive data and secrets, including Vault, ephemeral values and write-only arguments
5. Modules: module sources, variable scope inside modules, calling modules, and version pinning.
6. State: the local backend, locking, remote backends via the `backend` block, and drift and state management.
7. Maintenance: importing existing infrastructure, inspecting state through the CLI, and verbose logging (TF_LOG).
8. HCP Terraform:
   - (a) provisioning through it
   - (b) collaboration and governance features
   - (c) **NEW** organizing workspaces and projects
   - (d) CLI/VCS integration
- Release-specific detail for 4f/4h/8c: the [KodeKloud 004 "what's new" note](https://notes.kodekloud.com/docs/HashiCorp-Certified-Terraform-Associate-004/Course-Introduction/Whats-New-in-the-Terraform-Associate-004-Exam/page), as summarized in search, matches the official list.

**Terraform Authoring and Operations Professional, becoming Advanced (lab-based, AWS)** — [Exam content list](https://developer.hashicorp.com/terraform/tutorials/pro-cert/pro-review), [Advanced orientation](https://developer.hashicorp.com/terraform/tutorials/pro-cert/adv-orientation)
1. Resource lifecycle: init/plan/apply/destroy, and state work including import and drift reconciliation. The study pages also cover targeting and refactoring with address changes.
2. Dynamic configuration: validation features, data sources, functions, meta-arguments, variables and outputs with complex types, and sensitive-data best practices.
3. Collaborative workflows: version constraints for the binary, providers and modules; remote state; Terraform in automation; and sharing data across configurations and workspaces.
4. Modules: creating, consuming, refactoring and versioning modules, and splitting an existing configuration into modules.
5. Providers: the plugin architecture; aliasing, versioning, sourcing and upgrades; authentication; and troubleshooting provider errors.
6. HCP Terraform (multiple-choice only): the run workflow, workspaces and access control, provider credentials, and policy-as-code and governance.

Format:
- Lab scenarios run on a pre-provisioned Linux host with access to the AWS console. Each scenario has several tasks and can be done in any order.
- Each lab is graded on its own, by checking configuration syntax, state files and the settings of the real resources.
- Terraform docs, limited Registry access and limited provider docs are available. There is no general web access.
- A US-QWERTY keyboard is required.
- An Azure variant is expected in late 2026, and there is a single credential whichever provider you choose.
- Associate is recommended first, along with production cloud experience.
- I found no official figures for duration, lab count or passing score.

**Terraform Infrastructure Engineer Professional (002), new; multiple choice, 90 min, TF 1.15, launching Oct 2026 at IBM TechXchange; 2-year validity** — [Exam page](https://developer.hashicorp.com/certifications/terraform-infrastructure-engineer-professional)
1. Scalable configuration design:
   - turning requirements into code
   - predictable, secure configuration
   - tracing variables, locals and outputs to debug
   - tracing for_each instances
   - predicting function results
   - advanced configuration
   - provider configuration
   - **using the Terraform MCP server with AI coding agents**
2. State and backends: remote backends and state, drift repair, mapping dependency chains before upgrades, upgrading the Terraform version across environments, and inspecting state.
3. Lifecycle and operations: scaling projects, plan, apply, import, lifecycle management, multiple environments, troubleshooting deployments, passing data between projects, and managing provider and module versions.
4. CI/CD and automation: pipeline behaviour, deployment strategies, dynamic provider credentials across teams, projects and workspaces, and variable precedence with `.tfvars` and `.auto.tfvars`.
5. Security and governance: secrets best practice, rotation and secret-manager integration, securing pipeline identities, org-wide and team-scoped policies, and spotting risky changes.
6. Modules and registry: when to extract a module, module contracts (inputs and outputs), building from the registry, and unit-testing modules with `terraform test`.
7. HCP Terraform and Enterprise: operations, usage and cost tracking, multi-environment setup, upgrading versions across workspaces, and policy as code in CI/CD.

**Recent Terraform features that the exams and the skill graph should reflect**
- TF 1.10 added ephemeral values (ephemeral resources, ephemeral outputs, provider blocks), which are never written to plan or state. TF 1.11 added write-only arguments on managed resources and made S3-native locking (`use_lockfile`) GA, deprecating DynamoDB locking. — [HashiCorp blog: TF 1.11](https://hashicorp.com/blog/terraform-1-11-ephemeral-values-managed-resources-write-only-arguments)
- TF 1.14.0 (19 Nov 2025) added list resources in `*.tfquery.hcl` files and the `terraform query` command, which can generate import-ready configuration. It also added the `action` block for provider-defined non-CRUD operations, with triggers before/after create and update. — [Terraform releases](https://github.com/hashicorp/terraform/releases), [Spacelift on actions](https://spacelift.io/blog/terraform-actions), [versionlog 1.14](https://versionlog.com/terraform/1.14/)
- Terraform Stacks became GA at HashiConf 2025 for HCP Terraform RUM-based plans. GA brought a unified CLI, broader VCS support and self-hosted agents, and the APIs have compatibility guarantees. — [HashiCorp HashiConf 2025 blog](https://www.hashicorp.com/blog/scale-infrastructure-with-new-terraform-and-packer-features-at-hashiconf-2025)

### Inferences
- A lab platform should target **TF 1.12+ semantics as a baseline**, matching Associate 004, and **1.14/1.15 for advanced tracks**, covering query/import generation, actions and the Professional exam.
- The Advanced exam's grading model (syntax + state + live resource checks) maps directly to automated lab validation. Validators can run `terraform validate`, inspect `terraform show -json` state, and query the target API, here vCenter or KubeVirt instead of AWS.
- HCP Terraform content is multiple-choice or conceptual on every exam. A self-hosted lab platform can cover it with conceptual or quiz nodes, or mirror it with Atlantis-style or OSS remote backends, without needing HCP accounts.
- The AI and MCP objective (1h) is novel for 2026. A small "AI-assisted Terraform authoring with MCP server" node would keep the graph current.

### Gaps
- No official question count, passing score or price for Associate 004. Third-party figures (57 questions, 60 minutes, PSI vs Certiverse) conflict.
- I could not find the Advanced exam's duration or number of labs. Its Terraform version is shown as 1.6 on the hub, which may be stale.
- Price for Infrastructure Engineer Professional is listed as "coming soon".

## Q2. OpenTofu: status, feature differences, certification/training

### Takeaway
OpenTofu is the MPL-2.0 fork of Terraform under the Linux Foundation and was reportedly accepted into the CNCF Sandbox in April 2025. It shipped several features ahead of Terraform: state and plan encryption (1.7), early evaluation (1.8), provider for_each (1.9), OCI registries and native S3 locking (1.10), and an `enabled` meta-argument (1.11). Terraform-native features such as ephemeral resources reached OpenTofu in 1.11. There is no formal OpenTofu certification; the only official training found is a free Linux Foundation Express Learning course with a badge.

### Cited Findings
- 1.7 (Apr 2024) added state and plan encryption with key providers including PBKDF2, AWS KMS, GCP KMS and OpenBao. It also added provider-defined functions, `removed` blocks and loopable `import` blocks (for_each). — [OpenTofu blog archive](https://opentofu.org/blog/archive/), [Scalr overview](https://scalr.com/learning-center/what-is-opentofu)
- 1.8 (Jul 2024) added early evaluation: variables and locals are allowed in backend config, module sources and encryption config. It also added `.tofu` file extension overrides. — [Scalr](https://scalr.com/learning-center/what-is-opentofu), [oneuptime on .tofu files](https://oneuptime.com/blog/post/2026-03-20-tofu-file-extension-opentofu-1-8/view) (secondary)
- 1.9 (10 Jan 2025) added provider `for_each` and an `-exclude` flag. The exclude detail comes from a secondary source only. The 1.9 docs also add `encrypted_metadata_alias` for encryption. — [OpenTofu blog page 2](https://opentofu.org/blog/page/2), [OpenTofu 1.9 docs](https://opentofu.org/docs/v1.9/intro/whats-new/)
- 1.10.0 (23 Jun 2025) added:
  - OCI registry distribution of providers and modules (for air-gapped setups)
  - native S3 locking without DynamoDB
  - deprecation markers for module variables and outputs
  - `-target-file` and `-exclude-file`
  - a global provider cache lock for CI
  - local OpenTelemetry tracing
  - external key providers for state encryption
  - enhanced `moved` and `removed` blocks

  The same announcement covers a VS Code extension, the tofu-ls language server and an OpenTofu Registry MCP server. — [OpenTofu 1.10.0 blog](https://opentofu.org/blog/opentofu-1-10-0/)
- 1.11.0 (Dec 2025) added ephemeral resources, ephemeral variables and outputs, and write-only attributes. It also added the `enabled` meta-argument, a zero-or-one replacement for the `count = cond ? 1 : 0` pattern on resources and modules. — [OpenTofu 1.11.0 blog](https://opentofu.org/blog/opentofu-1-11-0), [Linuxiac](https://linuxiac.com/opentofu-1-11-introduces-ephemerality-for-safer-temporary-credentials/)
- CNCF Sandbox acceptance vote completed 23 Apr 2025, with an MPL-2.0 licensing exception. This rests on a single secondary source and is not verified against a CNCF primary page. — [Habr](https://habr.com/ru/post/903754)
- Training: LF Education's "Getting Started with OpenTofu (LFEL1009)" launched Dec 2024. It is a free, roughly 90-minute, self-paced course with hands-on exercises and a digital badge. — [LF Training](https://training.linuxfoundation.org/?p=36279)

### Inferences
- The Terraform and OpenTofu feature set is diverging. Shared core features (HCL, providers, state, modules, import/moved/removed, `test`, ephemeral and write-only) can be taught once with a `tofu` or `terraform` binary toggle. Divergent features need tool-specific nodes:
  - OpenTofu: state encryption, early evaluation, provider for_each, `enabled`, OCI registry, `-exclude`
  - Terraform: Stacks, `terraform query`/list resources, actions, HCP Terraform, Sentinel
- An on-prem lab platform (vCenter + KubeVirt) fits OpenTofu well. OCI-registry module and provider mirrors suit air-gapped labs, and state encryption is a strong hands-on topic.
- Because there is no OpenTofu certification, a platform can position its own OpenTofu badge path as complementary to the LF course.

### Gaps
- No primary CNCF announcement retrieved. "Linux Foundation project" status is well known, but the Sandbox date rests on one secondary source.
- The current `whats-new` docs page returned 404, so I could not confirm whether OpenTofu 1.12 had shipped by Oct 2026.
- No OpenTofu certification found. "OTCA" appeared in an LF exam-resources list, but its meaning was not confirmed.

## Q3. Industry skill progression (beginner to advanced topic list) and candidate learning paths

### Takeaway
Combining the four exam blueprints with current features gives a clear six-tier progression: (1) foundations → (2) language → (3) state → (4) modules and refactoring → (5) quality, security and testing → (6) team, CI/CD, scale and operations. Policy as code, unit testing, multi-environment design, upgrades, dynamic credentials and drift now appear explicitly in the Professional 002 blueprint, which confirms they belong in mainstream skills.

### Cited Findings
- Associate covers fundamentals through state, import, logging and HCP basics. — [004 list](https://developer.hashicorp.com/terraform/tutorials/certification-004/associate-review-004)
- Professional 002 adds tracing for_each and expressions, upgrade dependency chains, cross-project data, deployment strategies, `.tfvars` precedence, secret rotation, risky-change detection, module contracts, `terraform test`, policy as code in CI and cost tracking. — [002 page](https://developer.hashicorp.com/certifications/terraform-infrastructure-engineer-professional)
- Advanced adds refactoring a configuration into modules, provider aliasing and upgrades, provider auth and error troubleshooting, and sharing data across workspaces, all performed hands-on. — [Exam content list](https://developer.hashicorp.com/terraform/tutorials/pro-cert/pro-review)
- Newer language and CLI features to place in the graph:
  - ephemeral and write-only values (TF 1.10/1.11)
  - S3 `use_lockfile` (1.11)
  - `terraform query` and import generation, plus actions (1.14)
  - Stacks GA

  — sources in Q1.

**Proposed topic list (beginner → advanced).** The tiering is my synthesis; the topics are grounded in the blueprints above.

- **T0 Foundations:**
  - IaC concepts, declarative vs imperative
  - install and version-manage the binary (tfenv/tofuenv)
  - init/validate/plan/apply/destroy
  - `fmt`
  - provider install and the dependency lock file
- **T1 Language:**
  - HCL syntax; resource vs data blocks; references and implicit dependencies
  - variables (types, defaults, validation, sensitive) and `.tfvars`/`.auto.tfvars` precedence; outputs; locals
  - complex types; expressions, conditionals, splat, for expressions; built-in functions
  - count vs for_each vs `enabled` (OpenTofu); dynamic blocks
  - depends_on and lifecycle (create_before_destroy, prevent_destroy, ignore_changes, replace_triggered_by)
  - multiple providers and aliases
- **T2 State:**
  - state purpose and local backend; remote backends (S3 + `use_lockfile`, Kubernetes, HTTP, pg, consul); locking and force-unlock
  - `terraform_remote_state` and data sharing
  - CLI inspection (`state list/show`, `show -json`, `output`)
  - `state mv/rm`, `import` CLI vs `import` blocks with `-generate-config-out`, `moved` and `removed` blocks
  - `-replace`, `-target`/`-exclude`, `refresh-only`, drift detection and reconciliation
  - workspaces vs directory-per-environment layouts
- **T3 Modules:**
  - module authoring: inputs and outputs as a contract, root vs child modules
  - sources (local, git, registry, OCI in OpenTofu) and version constraints
  - composition and passing providers; module deprecations
  - refactoring a monolith into modules with `moved`; a private registry or mirror
- **T4 Quality, security and testing:**
  - `fmt` and `validate`; TFLint and rulesets
  - custom conditions (variable validation, pre/postconditions, `check` blocks)
  - `terraform test` (`.tftest.hcl`, mocks, plan vs apply runs); Terratest
  - security scanning with Checkov and Trivy (tfsec's successor)
  - policy as code with Sentinel (HCP), OPA/Conftest on plan JSON
  - secrets: avoiding them in state, Vault provider, ephemeral and write-only, OpenTofu state encryption
- **T5 Collaboration and CI/CD:**
  - plan/apply pipelines with saved plan artifacts and approvals
  - PR automation (Atlantis), HCP Terraform runs, VCS-driven vs CLI-driven workflows
  - dynamic or OIDC provider credentials; scheduled drift detection
  - cost estimation (Infracost); multi-environment promotion
- **T6 Scale and operations:**
  - Terragrunt (DRY backends, dependencies, run-all) and Terraform Stacks; splitting large state
  - provider and Terraform version upgrades across many roots; dependency-chain analysis
  - troubleshooting: TF_LOG/TF_LOG_PATH, cycle errors, provider auth and API errors, lock contention, state corruption and recovery from backup
  - `terraform query` bulk import; actions
  - AI-assisted authoring via MCP servers

**Candidate learning paths:**
1. **Terraform Associate (004) path:** T0 → T1 (full) → T2 (no Terragrunt) → T3 basics → a T4 intro covering validation and sensitive data → HCP concepts (quiz) → mock exam. Target: TF 1.12.
2. **IaC Practitioner / Professional 002 path:** Associate path → T3 full → T4 full (`test`, TFLint, Checkov/Trivy, OPA) → T5 (pipeline + Atlantis + drift + OIDC) → T6 upgrades and troubleshooting. Target: TF 1.15.
3. **Advanced (lab) exam path:** timed, multi-task scenario labs graded on configuration, state and live resources. Topics: import and drift, refactor into modules, provider aliasing and upgrades, provider error fixing, and cross-workspace data.
4. **OpenTofu path:** shared core (T0 to T3) taught with `tofu`, plus OpenTofu-only nodes: state encryption with key rotation, early evaluation in backends and module sources, provider for_each for multi-region or multi-cluster, `enabled`, `-exclude`, an OCI registry mirror, and migrating from Terraform to OpenTofu.
5. **Platform/Scale path:** Terragrunt or Stacks, a multi-environment monorepo, policy gates, version upgrade campaigns and incident-style troubleshooting labs.

### Inferences
- For a vCenter + KubeVirt platform, the local providers (vSphere, Kubernetes/kubevirt, Helm, local, null, random, tls) let every tier run without public cloud. The MinIO S3 backend supports locking labs, and Atlantis or Gitea supports CI labs.
- Break/fix labs fit the objective verbs well ("troubleshoot", "fix drift", "identify risky changes"). Example labs: an injected dependency cycle, a stale lock, manual drift, a broken provider version constraint, and a rename that would destroy a resource unless a `moved` block is used.

### Gaps
- I did not fetch tool docs for Checkov, TFLint, Terragrunt, Atlantis or Trivy in this pass. Tool facts in the topic list, such as Trivy absorbing tfsec, Atlantis PR workflow and Terragrunt run-all, are from background knowledge and need citation from the tool sites before publication.
- roadmap.sh/terraform was not fetched.

## Q4. Hands-on lab/challenge styles on existing platforms

### Takeaway
Market lab styles are: guided step-by-step tutorials (HashiCorp), task-plus-validation labs with solution videos (KodeKloud), timed multi-task scenario labs graded on state and live resources (the HashiCorp Advanced exam), and browser-terminal scenarios (Killercoda/Instruqt). I could only partially verify the last style in this pass.

### Cited Findings
- HashiCorp maps every Associate and Professional objective to tutorials, so its learning paths are tutorial-per-objective. — [004 content list](https://developer.hashicorp.com/terraform/tutorials/certification-004/associate-review-004), [Advanced study path](https://developer.hashicorp.com/terraform/tutorials/pro-cert/adv-study)
- In the HashiCorp Advanced exam, scenarios hold several tasks in a pre-provisioned Linux VM plus a cloud console. Tasks can be done in any order, and grading inspects config syntax, state files and real resource settings. — [Advanced orientation](https://developer.hashicorp.com/terraform/tutorials/pro-cert/adv-orientation)
- KodeKloud runs tiered hands-on lab series (for example "Terraform Level 2" covering state, resource configuration and provisioning). Its courses pair each lab with a solution video and use sandboxed environments. — [KodeKloud community](https://kodekloud.com/community/t/kodekloud-terraform-level-2-labs/501739), [KodeKloud TF Cloud notes](https://notes.kodekloud.com/docs/HashiCorp-Terraform-Cloud/Introduction/Course-Introduction/page.md)
- KodeKloud's beginner course includes lab modules on Terraform state and commands. — [Coursera listing](https://www.coursera.org/programs/american-college-of-technology-learning-program-zt1jy/learn/terraform-for-the-absolute-beginner)
- LF's OpenTofu course mixes concept content with hands-on exercises and awards a badge. — [LF Training](https://training.linuxfoundation.org/?p=36279)

### Inferences
- A lab engine that pairs scenario tasks with checkers (config parse + `show -json` state assertions + live API checks) reproduces the gold-standard style of the Advanced exam. Adding hints and solutions afterwards reproduces the KodeKloud style.

### Gaps
- Search returned nothing on Killercoda Terraform scenarios or Instruqt's HashiCorp tracks. HashiCorp historically used Instruqt for interactive tutorials, but I did not verify that in this pass.
