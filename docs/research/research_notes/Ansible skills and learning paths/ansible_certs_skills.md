# Ansible Certifications and Automation Skills Expected of Engineers (2025-2026)

Research date: 2026-10-14. All exam objectives below are paraphrased, not copied. Red Hat pages say objectives follow "the most recent product version," and several exams have multiple live versions, so a lab platform should map to objective *themes*, not exact wording.

## Q1. Red Hat RHCE EX294: current version, objective groups, RHEL 10 update

### Takeaway
EX294 is now listed under the generic "Red Hat Enterprise Linux" URL. Red Hat's page calls it the "Red Hat Certified Advanced System Administrator in Ansible" exam, and passing it counts toward "Red Hat Certified Engineer in Ansible" and "Certified Architect in Ansible." The current objectives add tooling to the classic playbook, role and Vault skills: ansible-navigator, Git, VS Code, and an Ansible development container. Third-party sellers say the current exam is based on RHEL 10.

### Cited Findings
- The current official objective groups, paraphrased (the RHEL-9 URL and the generic URL return the same list) — [Red Hat EX294 (generic)](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux); [Red Hat EX294 RHEL 9 URL](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux-9)
  1. **RHCSA baseline:** essential tools, running systems, local storage, file systems, deploying and maintaining systems, users and groups, security, and reading simple shell scripts.
  2. **Core Ansible concepts:** inventories, modules, variables, facts, loops, conditionals, plays, failure handling, playbooks, config files and roles. Candidates must also use the bundled documentation to look up modules and commands.
  3. **Configuring Ansible:** write and edit `ansible.cfg`, edit `ansible-navigator.yml`, and build static inventories with host groups.
  4. **Managed node setup:** prepare managed nodes, generate and distribute SSH keys, configure privilege escalation (sudo), and push files to nodes.
  5. **Running playbooks:** run with both `ansible-navigator` and `ansible-playbook`. Use navigator to discover modules in installed collections, build inventories and configure the environment.
  6. **Git:** clone a repo and add files to it.
  7. **VS Code:** write playbooks and push them to Git, configure ansible-navigator, and run playbooks in an Ansible development container.
  8. **Plays and playbooks:** common modules, `register` to capture command output, conditionals, error handling, and desired-state playbooks.
  9. **Roles and collections:** create roles; install roles and collections and use them; pull roles, modules and other content from collections.
  10. **Automating RHCSA tasks with modules:** packages and repos, services, firewall rules, file systems, storage devices, file content, archives, scheduled tasks (cron and at), security (SELinux and similar), users and groups.
  11. **Content management:** Jinja2 templates for configuration files, and Ansible Vault for secrets.
  - Exam-wide rule: every configuration must survive a reboot without manual intervention.
- Red Hat's page names the credential "Red Hat Certified Advanced System Administrator in Ansible (EX294)", which counts toward "Red Hat Certified Engineer in Ansible" and "Red Hat Certified Architect in Ansible." The page also contains an internal inconsistency ("System Administrator in Ansible") — [Red Hat EX294](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux)
- Third-party sellers list an EX294 exam "for RHEL 10" based on RHEL 10.0. One listing pairs it with "AAP 1.2" and "Ansible Engine," which look like stale boilerplate. The same listing says there is no internet access and no outside documentation in the exam — [UMBC Training](https://www.umbctraining.com/courses/red-hat-certified-engineer-rhce-exam-for-red-hat-enterprise-linux-10-ex294/); [ULX](https://ulx.hu/en/?p=3234)
- A third-party study guide maps EX294 to a Rocky Linux 10 + ansible-navigator lab and says it was "reviewed against the official page July 2026." I could not fetch it (HTTP 403) — [GoLinuxCloud](https://www.golinuxcloud.com/rhce-ex294-exam-objectives/)
- Format: a 4-hour hands-on exam. Playbooks are applied to freshly installed systems and graded on the result. Product documentation is available during the exam. RHCE is only awarded once RHCSA is also held — [summarised from UMBC and other sellers](https://www.umbctraining.com/courses/red-hat-certified-engineer-rhce-exam-for-red-hat-enterprise-linux-10-ex294/)
- The recommended course is AU294 (Red Hat Enterprise Linux Automation with Ansible) — [Red Hat EX467 page prerequisites](https://www.redhat.com/en/services/training/ex467-red-hat-certified-specialist-managing-automation-ansible-automation-platform-exam)

### Inferences
- The objectives that changed with RHEL 10 / AAP 2.5+ appear to be developer-workflow ones: VS Code, Git push, the dev container, and `ansible-navigator.yml`. The automation content (modules for RHCSA tasks, templates, Vault, roles) is the same as the RHEL 9 era. A lab platform should offer a VS Code-in-browser editor (code-server), a Git server such as Gitea, and the navigator/EE toolchain inside the lab VM.
- The "persist after reboot" rule plus grading on fresh systems means idempotent, desired-state playbooks. Lab checks should re-run playbooks and reboot targets before validating.
- The rename ("Advanced System Administrator in Ansible" / "Engineer in Ansible") is visible on the official page, but I found no announcement explaining it. Treat the naming as in flux.

### Gaps
- I could not see the exact RHEL 10 objective delta, because Red Hat's version-specific list sits behind "Get started" / the LMS. The page also doesn't state the exam's ansible-core or AAP version.
- I found no official announcement of the credential renaming or its date.

## Q2. EX374, EX467, EX457 and other Ansible certs

### Takeaway
EX374 (AAP 2.5) covers advanced development: inventory variables, lookups and filters, delegation, building collections and EEs, and dynamic inventory. EX467 covers operating AAP: RBAC, projects and job templates, workflows, surveys and schedules, the API, backup, and automation mesh/instance groups. EX457 (AAP 2.6) covers network automation with VS Code, navigator, Git, controller and ansible.netcommon. I found no dedicated Event-Driven Ansible exam.

### Cited Findings
**EX374 — Red Hat Certified Specialist in Developing Automation with AAP** (based on AAP 2.5; 4-hour hands-on exam; prep courses AU374 + AU294; counts toward RHCA) — [Red Hat EX374](https://www.redhat.com/en/services/training/red-hat-certified-specialist-developing-automation-ansible-automation-platform-exam). Paraphrased objectives:
  1. **Git:** clone; create, edit and push files.
  2. **Inventory variables:** split host_vars/group_vars across multiple files and directories; override connection host, port or user per host with special variables; alias inventory names to other names or IPs.
  3. **Task execution:** control privilege escalation; run only selected tasks (tags, start-at).
  4. **Data transformation:** fill variables from external data with lookup plugins; use `lookup` and `query` in playbooks and templates; loop over complex data structures with lookups and filters; validate and manipulate IP/network data with filters (`ansible.utils.ipaddr`-style).
  5. **Delegation:** run a task on another host on behalf of a managed host; control whether gathered facts land on the target or the delegate (`delegate_facts`).
  6. **Collections:** create, install and publish a collection.
  7. **Execution environments:** build one (ansible-builder), run playbooks in it, push it to automation hub, and use it in controller.
  8. **Inventories and credentials:** advanced inventories; dynamic inventory from an IdM server or a database; machine credentials; source-control credentials.
  9. **Controller:** run playbooks; sync content from Git or hub; pull an EE from hub and run with it.
  - Older reseller pages still cite AAP 2.0 for EX374, so multiple versions are in circulation — [Gopas](https://www.gopas.cz/get-course-pdf-detail/9491242)

**EX467 — Red Hat Certified Specialist in Managing Automation with AAP** (the page names no version; prep courses AU294 + AU374 + AU467) — [Red Hat EX467](https://www.redhat.com/en/services/training/ex467-red-hat-certified-specialist-managing-automation-ansible-automation-platform-exam). Paraphrased objectives:
  1. **Content:** upload collections and EEs to automation hub.
  2. **Access:** controller users and teams, team membership, organization roles, user types (normal, auditor, admin).
  3. **Inventories and credentials:** host groups, group membership, inventory permissions, inventory variables, machine credentials.
  4. **Projects:** create projects and job templates, set template permissions, launch jobs.
  5. **Workflows:** workflow templates, launching them, and approval nodes configured to auto-approve.
  6. **Jobs:** surveys, schedules and notifications.
  7. **Programmatic use:** script the REST API to find launch parameters and launch a job; use the AAP collections (`ansible.controller` / `ansible.platform`, configuration as code); set up a Git webhook.
  8. **Maintenance:** back up controller and private hub; troubleshoot.
  9. **Scaling:** install and extend automation mesh; create instance groups and assign defaults to inventories and templates; run jobs in a given instance group or on an isolated network segment via mesh.
  - Older reseller versions also included installing AAP, private hub and controller — [Flane EX467](https://www.flane.co.uk/course/redhat-ex467)

**EX457 — Red Hat Certified Specialist in Ansible Network Automation** (the official page now says AAP 2.6, while older search snippets say AAP 2.3; 4-hour hands-on exam; multiple versions live, so candidates should check the LMS) — [Red Hat EX457](https://redhat.com/en/services/training/ex457-red-hat-certified-specialist-in-ansible-network-automation-exam). Paraphrased objectives:
  1. **Tooling:** VS Code for editing, shell commands, SSH to remote systems.
  2. **Content navigator:** build inventories and configure navigator.
  3. **Git:** write and run playbooks, basic Git operations, Git inside VS Code.
  4. **Variables and facts:** flexible variable-driven playbooks; gather facts from network devices; transform data with filters.
  5. **Task control:** loops, conditionals, failure handling.
  6. **Controller:** machine and source credentials, projects, workflow templates, running jobs, defining controller config as code.
  7. **Roles and collections:** include vs import; write network-automation roles.
  8. **Network tasks:** render device configs from Jinja2; use platform-agnostic `ansible.netcommon` modules (cli_command, cli_config and similar); back up device configs.
  - Recommended background: networking (routing, switching), CLI management of Cisco, Juniper and Arista virtual devices, RHCSA-level Linux, Git — [Red Hat EX457](https://redhat.com/en/services/training/ex457-red-hat-certified-specialist-in-ansible-network-automation-exam)
  - A candidate who sat it (Aug 2025) said the exam leaned on general Ansible playbook skill more than deep network plumbing — [fale.io](https://fale.io/blog/2025/08/31/red-hat-ex457-exam); [CBT Nuggets](https://www.cbtnuggets.com/blog/technology/devops/is-the-ex457-worth-it)

**Event-Driven Ansible:** a DO274 "Introduction to Event-Driven Ansible" course exists. A reseller lists it as bundled with "one exam," but I found no EDA-specific exam code — [New Horizons DO274LS](https://www.newhorizons.com/course-outline/courseid/300201565/coursename/introduction-to-event-driven-ansible-red-hat-learning-subscription-course-do274ls)

### Inferences
- These exams form a clean three-tier ladder for a skill graph: **EX294** (author playbooks and roles), then **EX374** (advanced authoring and content packaging: collections, EEs, dynamic inventory), then **EX467** (platform operations: controller RBAC, workflows, API, mesh). **EX457** is a sibling branch off EX294 for network engineers.
- Lab infrastructure needed per tier: EX294 needs a control node plus 3-5 RHEL/Rocky/Alma managed nodes. EX374 adds a Git server, a container registry or private hub, an IdM server or database for dynamic inventory, and controller. EX467 needs a full AAP or AWX install with multiple nodes for mesh and instance groups. EX457 needs virtual network devices (Cisco IOS-XE/CSR, Arista cEOS/vEOS, Juniper vSRX/vQFX); containerlab or KubeVirt VMs work.
- AWX (upstream) can stand in for most controller objectives in a lab without AAP subscriptions. Mesh, hub upload and backup tasks differ in AWX, so those would need real AAP or adapted tasks.

### Gaps
- EX467's AAP version and exam duration aren't stated on the page.
- I couldn't confirm whether any EDA certification exam exists. The DO274 "exam included" claim may refer to a generic voucher.
- Older Ansible exams (EX407, EX447) appear retired. I didn't verify this in this session.

## Q3. Industry skill progression: beginner to advanced topics, and the 2025-2026 tooling baseline

### Takeaway
The 2025-2026 baseline is ansible-core 2.19 to 2.21. Version 2.19 (July 2025) brought data tagging and a stricter templating engine that breaks sloppy conditionals. The current community package is Ansible 14 (core 2.21). On the platform side, AAP 2.5 introduced a unified platform gateway, and AAP 2.6 added EDA external secrets, unified RBAC, Lightspeed assistant and a self-service portal; AAP 2.7 documentation also exists. Skills now expected run past playbook basics into EEs and navigator, collections, testing, controller operations and EDA.

### Cited Findings
- **ansible-core release matrix:** 2.18 (Nov 2024, EOL May 2026); 2.19 (21 Jul 2025, EOL Nov 2026, control-node Python 3.11-3.13); 2.20 (3 Nov 2025, EOL May 2027, Python 3.12-3.14); 2.21 (May 2026, EOL Nov 2027, Python 3.12-3.14, target PowerShell 5.1-7). Community package **Ansible 14.x = ansible-core 2.21** is current; 15.0 (core 2.22) is in development — [Ansible release and maintenance](https://docs.ansible.com/ansible/latest/reference_appendices/release_and_maintenance.html)
- **ansible-core 2.19 breaking changes** (important for lab content and checkers) — [Porting guide 2.19](https://docs.ansible.com/ansible/latest/porting_guides/porting_guide_core_2.19.html):
  - Data tagging: variables carry their origin (file, line, column) for better errors and can be tagged as deprecated.
  - Inverted trust model: templates inside untrusted strings, such as module output, are not rendered.
  - Native Jinja types only; the string-mode option and the final literal-eval pass are gone.
  - Conditionals must evaluate to booleans (temporary escape hatch: `ALLOW_BROKEN_CONDITIONALS`); truthy strings and nested `{{ }}` in `when:` now fail.
  - No multi-pass templating (`1 + {{ x }}` is invalid); `omit` in loop items changed; type errors such as `replace` on lists now surface.
  - Become timeouts are now "unreachable," so use `ignore_unreachable` rather than `ignore_errors`; `async_status` started/finished need the `started`/`finished` tests.
  - SSH password auth defaults to SSH_ASKPASS instead of sshpass; the paramiko plugin is being deprecated ([Roadmap 2.19](https://docs.ansible.com/ansible/latest/roadmap/ROADMAP_2_19.html)).
  - Plugin authors must use `trust_as_template`, `EncryptedString` (replacing AnsibleVaultEncryptedUnicode) and narrower exception handling.
- **AAP 2.6:** unified RBAC through the Gateway API; EDA supports external secret managers (HashiCorp Vault, CyberArk, Azure Key Vault, AWS Secrets Manager); editable EDA project SCM URLs; Kafka multi-topic and wildcard sources; Ansible Lightspeed intelligent assistant; self-service automation portal; automation dashboard; collections standardised on the `AAP_` env-var prefix — [AAP 2.6 release notes](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html-single/release_notes/index); [Red Hat blog: What's new in AAP 2.6](https://www.redhat.com/de/blog/whats-new-in-ansible-automation-platform-2.6)
- AAP 2.7 documentation exists on docs.redhat.com — [AAP 2.7 docs](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.7/platform_intro)
- Topics the exams require, which fix the minimum skill set: inventories, ansible.cfg, navigator, privilege escalation, modules, register, conditionals, loops, error handling, templates, Vault, roles, collections (EX294); host/group_vars layout, lookups and filters, delegation, collections, EEs, dynamic inventory, controller (EX374); RBAC, job templates, workflows, surveys, schedules, API, webhooks, mesh, backup (EX467); network facts, netcommon, Jinja2 configs, config backup (EX457) — [EX294](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux); [EX374](https://www.redhat.com/en/services/training/red-hat-certified-specialist-developing-automation-ansible-automation-platform-exam); [EX467](https://www.redhat.com/en/services/training/ex467-red-hat-certified-specialist-managing-automation-ansible-automation-platform-exam); [EX457](https://redhat.com/en/services/training/ex457-red-hat-certified-specialist-in-ansible-network-automation-exam)
- Red Hat's official interactive labs cover Windows automation, ServiceNow, ansible-builder, collection signing in private hub, and EDA rulebooks and controller. This confirms Windows, ITSM integration, EE building, content signing and EDA as mainstream skills — [Red Hat interactive labs: Ansible](https://www.redhat.com/en/interactive-labs/ansible)

### Proposed structured topic list (beginner to advanced) for the skill graph
These are synthesis inferences built on the cited exam objectives and docs above. Items marked (†) are standard Ansible features not explicitly named in any exam objective I retrieved.

**Level 0 — Prerequisites**
- Linux CLI, SSH and key auth, sudo, YAML syntax, vim or VS Code, basic Git (clone, add, commit, push), Python and pip/venv basics†

**Level 1 — Foundations (EX294 core)**
1. Architecture: control node vs managed nodes, agentless SSH, Python on targets; ansible-core vs the `ansible` community package (Ansible 14 = core 2.21)
2. Installation: pip/pipx, RHEL `ansible-core` RPM, `ansible-navigator`, `ansible-dev-tools`†
3. `ansible.cfg` precedence (ANSIBLE_CONFIG, ./ansible.cfg, ~/.ansible.cfg, /etc/ansible) and `ansible-config dump`†
4. Static inventory in INI and YAML; groups, nested groups (`children`), ranges; `ansible-inventory --graph/--list`
5. Managed-node bootstrap: user creation, SSH key distribution, sudoers / `become`
6. Ad-hoc commands (`ansible all -m ping`, `-m dnf`, `-a`)†
7. Module documentation: `ansible-doc`, `ansible-navigator doc`, FQCNs (`ansible.builtin.*`)
8. First playbooks: plays, tasks, `name`, `hosts`, `become`; reading the recap; idempotency and "changed" state
9. Core modules: dnf/package, service/systemd, copy, file, lineinfile/blockinfile, template, user/group, firewalld, cron/at, archive/unarchive, get_url, command/shell (and why to avoid them), parted/lvg/lvol/filesystem/mount, selinux/seboolean/sefcontext
10. Variables: play vars, vars_files, host_vars/group_vars, extra vars; a working knowledge of precedence
11. Facts: `gather_facts`, `ansible_facts`, setup filters, custom facts (`facts.d`), magic vars (`hostvars`, `groups`, `inventory_hostname`)
12. `register` and `debug`; `--syntax-check`, `--check`, `--diff`, `-v` to `-vvvv`†

**Level 2 — Control flow and content (EX294 core)**
13. Conditionals (`when`) under 2.19+ boolean-only rules; tests (`is defined`, `is failed`)
14. Loops (`loop`, `loop_control`, `until`/`retries`), filters such as `dict2items` and `subelements`
15. Handlers and `notify`, `meta: flush_handlers`
16. Error handling: `ignore_errors`, `failed_when`, `changed_when`, `block`/`rescue`/`always`, `any_errors_fatal`, `ignore_unreachable`
17. Jinja2 templates: loops and conditionals in `.j2`, common filters (`default`, `join`, `map`, `selectattr`, `combine`, `to_nice_yaml`), whitespace control
18. Ansible Vault: create, edit, encrypt_string, `--ask-vault-pass` / `--vault-password-file`, vault IDs
19. Tags, `--tags`/`--skip-tags`, `--start-at-task`, `--step`
20. Reuse: `import_tasks` vs `include_tasks`, `import_playbook`, include vs import semantics (static vs dynamic)
21. Roles: `ansible-galaxy role init` skeleton, defaults vs vars, role dependencies (meta), `roles:` vs `include_role`/`import_role`, argument specs†
22. Collections: `requirements.yml`, `ansible-galaxy collection install`, collections path, using roles and modules from collections; RHEL System Roles (`redhat.rhel_system_roles`)†
23. Dev workflow: ansible-navigator (run, doc, collections, inventory, `ansible-navigator.yml`), VS Code Ansible extension, dev container, Git push

**Level 3 — Intermediate and advanced authoring (EX374)**
24. Inventory design: multi-file host_vars/group_vars directories, `ansible_host`/`ansible_port`/`ansible_user` overrides, aliases
25. Dynamic inventory: inventory plugins (`constructed`, cloud plugins such as `amazon.aws.aws_ec2` and `vmware.vmware.vms`†, IdM/LDAP or database-sourced inventory); keyed groups and composed vars
26. Lookups (`file`, `template`, `env`, `pipe`, `csvfile`, `password`) and `query()`; complex loops over nested data
27. Network-data filters (`ansible.utils.ipaddr` family, `json_query`†)
28. Delegation: `delegate_to`, `delegate_facts`, `run_once`, `local_action`
29. Execution control and performance: forks, `serial` (rolling updates), strategies (`linear`, `free`, `host_pinned`), `throttle`, pipelining, fact caching, `async`/`poll` + `async_status`, `max_fail_percentage`†
30. Privilege escalation at depth: `become_user`, `become_method`, per-task become
31. Collections authoring: `ansible-galaxy collection init`, `galaxy.yml`, build, publish to Galaxy or private hub, versioning
32. Execution environments: `execution-environment.yml` (v3), `ansible-builder build`, running with navigator, pushing to a registry or hub
33. Ansible 2.19+ templating migration: fixing broken conditionals, trusted vs untrusted templates, data-tag-aware errors

**Level 4 — Engineering quality and extensibility**
34. Linting and style: `ansible-lint` (profiles, FQCN rules), yamllint†
35. Testing: Molecule scenarios (create, converge, idempotence, verify, destroy) with podman/docker or delegated drivers; `ansible-test` sanity and units for collections†
36. Custom plugins and modules: filter plugins, lookup plugins, inventory plugins, custom Python modules (`AnsibleModule`, `check_mode` support, returning `changed`); 2.19 plugin API changes (`trust_as_template`)
37. Secrets beyond Vault: HashiCorp Vault and CyberArk lookups/credential plugins, controller credential types
38. CI/CD for Ansible: lint and Molecule in pipelines (GitHub Actions, GitLab CI), EE build pipelines, GitOps triggers via controller webhooks
39. `ansible-pull` for pull-based configuration†
40. Troubleshooting: `-vvvv`, `ANSIBLE_DEBUG`, `debugger` keyword, `--check --diff`, `ansible-navigator replay`/artifacts, connection debugging (SSH, become)†

**Level 5 — Platform operations (EX467, AWX/AAP)**
41. AAP 2.5+/2.6 architecture: platform gateway, automation controller, automation hub (private, with content signing), EDA controller, Lightspeed (AWX equivalents for the lab)
42. RBAC: organizations, teams, users, user types, role assignments (unified RBAC in 2.6)
43. Projects (SCM sync), inventories and inventory sources, credentials and custom credential types, job templates, surveys, extra vars, limits
44. Workflows: nodes, success/failure paths, approval nodes, convergence
45. Schedules, notifications (email, Slack, webhook), Git webhooks
46. API and config-as-code: REST API with curl/Python, `ansible.controller` / `ansible.platform` / `infra.aap_configuration` collections, the `AAP_` env vars
47. Scaling: instance groups, container groups (K8s pods)†, automation mesh (hop and execution nodes), job isolation
48. Day-2: backup and restore, upgrades, troubleshooting job failures and logs

**Level 6 — Specialisations (branches)**
49. **Event-Driven Ansible:** rulebooks (sources, rules, conditions, actions), `ansible-rulebook` CLI, sources (webhook, Kafka, Alertmanager), decision environments, EDA controller activations, external secrets in EDA (AAP 2.6)
50. **Network automation (EX457):** `network_cli`, `netconf`, `httpapi` connections, `ansible_network_os`, `ansible.netcommon` (`cli_command`, `cli_config`, `netconf_config`), resource modules (gathered, merged, replaced, overridden, deleted states), network facts, config backup and restore, Jinja2 config generation, parsing (`ansible.utils.cli_parse`)
51. **Windows automation:** WinRM (and SSH on Windows†) connection setup, `ansible.windows` / `community.windows` modules, PowerShell 5.1/7 targets (core 2.21 supports PS 7), DSC†, Kerberos/NTLM auth†
52. **Cloud and virtualization:** `amazon.aws`, `azure.azcollection`, `vmware.vmware`/`community.vmware`, `kubernetes.core`, `kubevirt.core`†
53. **ITSM integration:** ServiceNow collection (appears in Red Hat's labs)
54. **Generative AI assistance:** Ansible Lightspeed (AAP 2.6)

### Candidate learning paths (inferences)
- **Path A — "Ansible Fundamentals" (0 to 1, about 8-12 h of labs):** L0, L1 (topics 1-12), and starter L2 (13-17). Outcome: write idempotent playbooks for a small fleet.
- **Path B — "RHCE EX294 Prep" (about 25-35 h):** all of L1 and L2, plus a module drill for every RHCSA task category (packages, services, firewall, storage/LVM, filesystems, cron, SELinux, users, archives), navigator and VS Code dev container, and timed mock exams that reboot and verify.
- **Path C — "Advanced Automation Developer / EX374" (about 25 h):** L3 (24-33) plus L4 lint/Molecule. Capstone: build a collection with a role and a custom filter, package it in an EE, publish to a private hub, and run it from controller against a dynamic inventory.
- **Path D — "Automation Platform Operator / EX467" (about 20-25 h):** L5 (41-48). Capstone: multi-team org with RBAC, survey-driven job templates, an approval workflow, API-launched jobs, an instance group in an isolated segment via mesh, and a backup and restore.
- **Path E — "Network Automation / EX457" (about 15-20 h):** L1 and L2 essentials plus L6 network (50), controller workflows and config-as-code. Capstone: render configs from Jinja2 and back up Cisco/Arista/Juniper virtual devices.
- **Path F — "Event-Driven & Self-Healing Automation" (about 8-10 h):** L6-49 integrated with monitoring (Prometheus Alertmanager to rulebook to a job template). This fits a K8s/Linux lab platform well.
- **Path G — "Ansible Engineering Practices / CI" (about 10 h):** ansible-lint, Molecule, ansible-test, GitHub/GitLab pipelines, EE build pipeline, migration to ansible-core 2.19+ templating rules.
- **Path H — "Windows Automation" (about 6-8 h):** WinRM setup, ansible.windows modules, PowerShell 7 targets.

### Gaps
- I did not fetch Molecule, ansible-lint, ansible-navigator, ansible-builder or EDA rulebook docs pages this session. Topics marked (†) and the L4/L6 details rely on general knowledge of these tools and should be checked against docs.ansible.com before final curriculum authoring.
- I did not retrieve roadmap.sh's Ansible content; it did not appear in searches.
- I didn't find the AAP 2.6 GA date or AAP 2.7 feature details.
- I found no industry survey data (job postings, salary studies) quantifying which Ansible skills employers weight most.

## Q4. Typical hands-on lab styles

### Takeaway
Red Hat runs short (15-60 min), single-topic, preconfigured-AAP browser labs organized by track (Getting Started, Network/Edge, EDA). KodeKloud combines a browser terminal on a control node with a quiz panel: multiple-choice questions first, then graded hands-on tasks and a capstone project. Red Hat's own exams are 4-hour, performance-graded, reboot-persistent task sets. I could not verify Killercoda or Instruqt Ansible content.

### Cited Findings
- Red Hat interactive labs list 14 Ansible labs: Getting Started (ansible-navigator 30m, collection signing with private hub 30m, ansible-builder 45m, ServiceNow 60m, controller 55m, Windows 55m); Network and Edge (backup/restore 20m, resource modules 40m, facts 30m, infrastructure awareness 15m, surveys 20m, first playbook 20m); EDA (rulebooks 30m, EDA controller 55m). Each runs in a preconfigured AAP environment — [Red Hat interactive labs: Ansible](https://www.redhat.com/en/interactive-labs/ansible)
- Red Hat's self-paced labs run in the browser with no local setup; topics include first playbook, controller, and DevOps/CI-CD with controller — [Red Hat level-up Ansible self-paced labs](https://www.redhat.com/en/engage/levelup-ansible-selfpaced-20230112)
- KodeKloud labs: a browser terminal on an Ansible control node plus a quiz panel. Each lab usually starts with multiple-choice questions, then harder hands-on tasks. The advanced course ends in an e-commerce app deployment project — [KodeKloud Ansible Advanced lab intro](https://notes.kodekloud.com/docs/Ansible-Advanced-Course/Core-Components/Lab-Introduction-Demo/page.md); [KodeKloud Ansible Advanced](https://kodekloud.com/courses/ansible-advanced-course)
- KodeKloud's "Labs: Ansible for the Absolute Beginners" covers inventory, playbooks, modules, variables, loops and roles, with an exercise per lecture — [KodeKloud beginners labs](https://learn.kodekloud.com/courses/labs-ansible-for-the-absolute-beginners)
- LabEx publishes an Ansible "skill tree" of short labs (setup challenge, conditionals/loops, stat module), each with a difficulty rating and time estimate — [DEV/LabEx](https://dev.to/labex/hands-on-ansible-setup-conditionals-loops-stat-module-labs-209c)
- Red Hat exam style: 4-hour hands-on tasks, graded by applying playbooks to fresh systems; configs must survive a reboot — [Red Hat EX374](https://www.redhat.com/en/services/training/red-hat-certified-specialist-developing-automation-ansible-automation-platform-exam); [Red Hat EX457](https://redhat.com/en/services/training/ex457-red-hat-certified-specialist-in-ansible-network-automation-exam)

### Inferences
- A three-tier lab format would cover the market: (1) micro-labs of 15-45 min on one concept with automatic checks, like Red Hat and LabEx; (2) a quiz-then-tasks module lab, like KodeKloud; (3) multi-hour exam-sim scenarios with hidden grading run after a reboot or on fresh nodes, like the Red Hat exams.
- Automated checkers should verify end state on managed nodes (package installed, service enabled, file content, firewall rule) and re-run the learner's playbook to assert `changed=0` for idempotency. They should not grade playbook text, though a lint pass with ansible-lint is a reasonable optional check.
- Each lab environment should come pre-provisioned with a control node (code-server + navigator + EE images cached offline, since the exams have no internet), 2-5 managed nodes, an optional Gitea and private registry, and, for advanced tracks, AWX/AAP and virtual network devices.

### Gaps
- I could not confirm Killercoda or Instruqt Ansible scenario catalogues, nor that Red Hat's labs run on Instruqt; searches returned nothing for them.
- I found no authoritative description of Red Hat lab checking mechanics (whether they run automatic validation or not).
