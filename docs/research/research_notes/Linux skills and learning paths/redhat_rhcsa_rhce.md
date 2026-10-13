# Red Hat RHCSA (EX200) and RHCE (EX294) exam objectives, plus licensing and image options for a hosted lab platform

Researched 2026-10-14. All objective text below is paraphrased. "Current" means the live redhat.com page as fetched on this date.

## 1. RHCSA EX200: objective groups and sub-objectives (RHEL 9 vs RHEL 10)

### Takeaway
The live EX200 page now says the exam is based on RHEL 10. The RHEL 10 version has 10 groups. "Manage containers" is gone. A new "Manage software" group adds RPM repos and Flatpak, and systemd timers are added under scheduling. The set-GID collaborative directories and "diagnose routine SELinux policy violations" items are dropped. The RHEL 9 version (9.0/9.3-era) had 10 groups, ending with "Manage containers" (podman/skopeo). Neither version lists Stratis, VDO, or dnf modules as objectives.

### Cited Findings

**Exam basis and status**
- The current EX200 page says the exam is based on RHEL 10. It gives no changelog and no duration. Configurations must survive a reboot without intervention. There is no internet access, and the product documentation shipped with the product is generally available during the exam. Recommended prep is RH124 + RH134, or RH199. — [Red Hat EX200 page](https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam)
- On the community forum, Red Hat staff said the curriculum was moving from RHEL 9.x to 10. Containers "used to be" an objective but were dropped in the latest release in favor of other objectives. The 9.3 objectives can still be requested from exam support, and the Wayback Machine keeps the 9.3 page. — [learn.redhat.com thread (search summary; the page now redirects)](https://learn.redhat.com/t5/General/Has-There-Been-a-Recent-Update-to-the-EX200-Exam-Objectives/m-p/53276)
- Third-party summaries agree that Flatpak and systemd timers are the additions and that Podman is no longer tested. — [CertCrush blog](https://www.certcrush.app/blog/how-to-pass-rhcsa-ex200-2026-8-week-study-plan)
- Alta3 says set-GID collaboration directories and routine SELinux troubleshooting were removed in v10. This was the only source found for that claim, but it matches the diff of the two lists below. — [Alta3](https://alta3.com/courses/aa-cs-ex200)
- On May 11, 2026, Red Hat restructured certifications into tracks (Enterprise Linux, Ansible, OpenShift, Cloud-native apps, AI) with levels (Technologist, Administrator/Developer, Engineer, Specialist, Architect). EX200 is the entry exam for both the Enterprise Linux and Ansible tracks and is now on RHEL 10. A secondary source reports that exam content, objectives, pricing, proctoring, and 3-year validity were unchanged by the restructure, and that existing certifications stay valid. — [TechBeatly summary](https://techbeatly.com/rhca/), which cites Red Hat's blog "Validate targeted expertise: Major updates to Red Hat Certification" (that URL returned 404 when fetched)

**RHEL 10 EX200 (current)**: [Red Hat EX200 page](https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam)
1. **Understand and use essential tools**
   - Shell and command syntax
   - I/O redirection (>, >>, |, 2>)
   - grep and regex
   - SSH to remote systems
   - Log in and switch users in multi-user targets
   - tar/gzip/bzip2 archives
   - Create and edit text files
   - Create, delete, copy, and move files and directories
   - Hard and soft links
   - ugo/rwx permissions
   - man, info, and /usr/share/doc
2. **Manage software (NEW group)**
   - Configure RPM repository access
   - Install and remove RPMs
   - Configure Flatpak repository access
   - Install and remove Flatpaks
3. **Create simple shell scripts**
   - Conditionals (if, test, [ ])
   - Loops (for) over files and input
   - Script arguments ($1, $2)
   - Use command output inside scripts
4. **Operate running systems**
   - Normal boot, reboot, and shutdown
   - Boot into a specific target manually
   - Interrupt boot to gain access (root password recovery)
   - Find and kill CPU- or memory-heavy processes
   - Adjust nice/priority
   - Manage tuning profiles (tuned)
   - Find and interpret logs and the journal
   - Persist the journal across reboots
   - Start, stop, and check network services
   - Secure file transfer
5. **Configure local storage**
   - Partitions on GPT disks. The fetched summary did not mention MBR; the RHEL 9 list said "MBR and GPT". This needs verifying against the raw page.
   - Create and remove PVs
   - Add PVs to VGs
   - Create and delete LVs
   - Mount by UUID or label at boot
   - Add partitions, LVs, and swap non-destructively
6. **Create and configure file systems**
   - VFAT, ext4, and XFS: create, mount, and use
   - NFS mount and unmount
   - autofs
   - Extend LVs
   - Diagnose and fix file permission problems
7. **Deploy, configure, and maintain systems**
   - Scheduling with at, cron, and **systemd timers (NEW)**
   - Start, stop, and enable services
   - Set the default boot target
   - Time service client (chrony)
   - Install and update packages from Red Hat CDN, a remote repo, or local files
   - Modify the bootloader (GRUB)
8. **Manage basic networking**
   - IPv4 and IPv6 addresses
   - Hostname resolution
   - Enable network services at boot
   - Restrict access with firewalld/firewall-cmd
9. **Manage users and groups**
   - Create, delete, and modify local users
   - Passwords and password aging
   - Create, delete, and modify groups and memberships
   - Configure privileged access (sudo)
10. **Manage security**
    - firewalld/firewall-cmd settings
    - Default file permissions (umask)
    - Key-based SSH authentication
    - SELinux enforcing or permissive
    - List SELinux file and process contexts
    - Restore default contexts
    - SELinux port labels
    - SELinux booleans

**RHEL 9 EX200 (older version, still reportedly bookable or requestable)**: [RootUsers RHCSA 9 objectives](https://www.rootusers.com/?p=5168), a third-party reproduction of the official list
1. **Essential tools**: same 11 items as RHEL 10.
2. **Simple shell scripts**: same 4 items.
3. **Operate running systems**: same 10 items. Note "tuned profiles".
4. **Configure local storage**
   - Partitions on **MBR and GPT**
   - PVs, VGs, and LVs as in RHEL 10
   - Mount by UUID or label
   - Add partitions, LVs, and swap non-destructively
5. **Create and configure file systems**
   - vfat, ext4, and xfs
   - NFS
   - autofs
   - Extend LVs
   - **Create set-GID directories for collaboration (removed in 10)**
   - Fix permission problems
6. **Deploy, configure, and maintain systems**
   - Scheduling with **at and cron only**
   - Services
   - Default target
   - Time client
   - Package install and update
   - Bootloader
7. **Manage basic networking**: same as RHEL 10.
8. **Manage users and groups**: same as RHEL 10 (sudo).
9. **Manage security**
   - Same items as RHEL 10, plus **diagnose and resolve routine SELinux policy violations (removed in 10)**
10. **Manage containers (removed in 10)**
    - Find and pull images from a remote registry
    - Inspect images
    - Use podman and skopeo
    - Build from a Containerfile
    - Basic run, start, stop, and list
    - Run a service in a container
    - Run a container as a systemd service at boot
    - Attach persistent storage

### Inferences
- RHEL 9 to RHEL 10 diff:
  - **Added:** "Manage software" group (RPM repo config and Flatpak) and systemd timer units.
  - **Removed:** the whole container group (podman, skopeo, Containerfile, systemd-run containers), set-GID collaborative directories, and SELinux troubleshooting (audit/sealert-style diagnosis).
  - **Possibly removed:** MBR partitioning (unverified).
  - Everything else is stable.
- **bootc / image mode:** no source shows it as an EX200 objective. It is not in the RHEL 10 list.
- **Stratis and VDO:** not in the RHEL 9 or RHEL 10 objectives as cited. My unverified recollection is that they were RHEL 8-era EX200 items. **dnf modules** are not named either. Treat all three as optional or extra skills, not exam-core.
- **Lab-substrate implications.** These items need a real kernel, bootloader, and init, so a full VM (KubeVirt) rather than a container:
  - GRUB edits and boot-interrupt root password recovery
  - systemd targets
  - Partitioning, LVM, and swap on block devices
  - mkfs and mounts, fstab by UUID
  - NFS client, autofs
  - SELinux enforcing, contexts, ports, and booleans (containers share the host kernel's SELinux state)
  - firewalld (needs netfilter in its own netns plus privileges)
  - Persistent journal, tuned, chrony
  - Reboot persistence, which the exam grades
- Shell, text, file, permissions, scripting, and user/group items can run in containers.
- Flatpak inside a container is awkward (it needs bubblewrap and user namespaces), so a VM is preferable there too.

### Gaps
- I could not fetch the raw RHEL 9.3 page (Wayback Machine is blocked for the fetcher), so the RHEL 9 list comes from a third-party reproduction.
- MBR removal in RHEL 10 is unconfirmed.
- Exam duration was not stated on the page.
- The Red Hat May 2026 announcement URL returned 404. The restructure details come from a secondary source.

## 2. RHCE EX294: objective groups and sub-objectives; RHEL 10 update

### Takeaway
EX294 still exists. Since the May 2026 restructure it is titled "Red Hat Certified Advanced System Administrator in Ansible Exam" and is the Engineer-level exam in the Ansible track. Passing it with RHCSA earns "Red Hat Certified Engineer in Ansible". The current objectives are AAP 2.x tooling: ansible-navigator, execution environments, collections, plus newer Git and VS Code dev-container items. The page names no RHEL or AAP version.

### Cited Findings
- The page title is "Red Hat Certified Advanced System Administrator in Ansible Exam | EX294". It says passing counts toward "Red Hat Certified Engineer in Ansible". Objectives are "based on the most recent Red Hat product version available". There is no RHEL 10 mention and no duration. Recommended prep is RH124, RH134, RH199, and AU294. Note that the course code is AU294; earlier sources called it RH294. — [Red Hat EX294 page](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux-9)
- Global Knowledge listings use the new title too. — [Global Knowledge EX294](https://www.globalknowledge.com/en-gb/products/red_hat/ex294)
- The secondary source says EX294 was retitled and paired with EX200 in the Ansible track. — [TechBeatly](https://techbeatly.com/rhca/)
- History: since the RHEL 8 era, RHCE has been Ansible automation (EX294) rather than EX300. — [Red Hat blog, RHCE evolution](https://www.redhat.com/es/blog/announcing-evolution-red-hat-certified-engineer-program)
- Current objective groups (paraphrased) — [Red Hat EX294 page](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux-9):
  1. All RHCSA-level tasks: essential tools, running systems, local storage, file systems, deploy/maintain, users and groups, security, and *analyze* simple shell scripts.
  2. Core Ansible components: inventories, modules, variables, facts, loops, conditionals, plays, failure handling, playbooks, config files, roles, using the provided docs (ansible-doc).
  3. Configure Ansible: ansible.cfg, ansible-navigator.yml, static inventory files, and host groups.
  4. Configure managed nodes.
  5. Create and distribute SSH keys to managed nodes.
  6. Configure privilege escalation on managed nodes.
  7. Deploy files to managed nodes.
  8. Run playbooks with ansible-navigator and ansible-playbook. Use navigator to discover modules in collections and to build inventories and configure the environment.
  9. Basic Git: clone, add files.
  10. VS Code: write playbooks and push them to Git, configure ansible-navigator, run playbooks in an Ansible development container.
  11. Plays and playbooks: common modules, register command results, conditionals, error handling, desired-state playbooks.
  12. Roles and collections: create roles, install roles and use them, install collections and use them, pull roles and modules from collections.
  13. Automate RHCSA tasks with modules: packages and repos, services, firewall rules, file systems, storage devices, file content, archiving, scheduling, security, users and groups.
  14. Manage content: Jinja2 templates, Ansible Vault.
- I found no third-party confirmation that the VS Code objective is new. A search returned nothing on VS Code. — [search; GoLinuxCloud guide](https://www.golinuxcloud.com/rhce-ex294-exam-objectives/)

### Inferences
- Lab needs for EX294:
  - A control node with ansible-navigator, a container runtime (podman) for execution environments, a Git server, and ideally a browser VS Code (code-server) with a dev container.
  - Several managed nodes as VMs, because the playbooks target storage, firewall, SELinux, services, and reboot persistence.
- Running execution-environment containers inside a KubeVirt VM is the cleanest approach.
- The VS Code and Git items suggest Red Hat moved toward a dev-tools workflow. Treat them as a likely recent addition.

### Gaps
- No EX294 version tied to RHEL 10 was found. The page names no AAP or RHEL version.
- No primary source dated the VS Code and Git additions.
- I did not research the RH124, RH134, and RH294/AU294 chapter outlines, EX188 (containers), or EX342 (troubleshooting), because the tool budget went to the expanded licensing scope. Red Hat course pages should be checked before using them. Given that containers were dropped from EX200, EX188 is the natural home for podman skills.

## 3. Licensing: running RHEL / UBI for hosted multi-user training

### Takeaway
The free Developer Subscription for Individuals is personal-use only. It covers 16 nodes for one natural person, and "selling, distributing and/or rebranding" the subscription services is prohibited. It is not a basis for a hosted training service, internal or commercial. Developer for Teams is a sales-negotiated product with unpublished terms. UBI is freely redistributable and runs on any Kubernetes. But it is a package subset designed as a container base, so it cannot cover the VM-bound RHCSA objectives. Adding non-UBI RHEL RPMs and redistributing on non-Red Hat platforms is not allowed.

### Cited Findings
- Developer Subscription for Individuals:
  - One per account, up to 16 physical or virtual nodes.
  - Allowed: demos, prototyping, QA, "small production uses".
  - Available "only to individuals, not organizations or teams", aimed at personal servers and home labs.
  - Self-support only, x86_64 and aarch64.
  - Cloud Access allows up to 16 cloud instances. — [Red Hat Developer no-cost RHEL FAQ](https://developers.redhat.com/articles/faqs-no-cost-red-hat-enterprise-linux)
- Program terms:
  - The subscription is "intended for your individual use in your personal capacity", for one person "working independently (with their own installation)", and unsupported.
  - Prohibited: more than 16 nodes, and "selling, distributing and/or rebranding the Red Hat Subscription Services". Other use requires paid subscriptions.
  - Teams: "other terms apply"; contact sales. — [Red Hat Developer Terms and Conditions](https://developers.redhat.com/terms-and-conditions/)
- UBI:
  - "Freely redistributable" under the UBI EULA, and any registry can be used.
  - Builds and runs anywhere. Red Hat does not support or test UBI on non-Red Hat platforms, but updates still flow.
  - UBI is a subset of RHEL content. Non-UBI packages need a subscription, and images built with them cannot be redistributed.
  - Adding non-UBI RHEL RPMs and redistributing on non-Red Hat platforms is not permitted.
  - Variants: ubi-micro has no package manager, ubi-minimal uses microdnf, and standard ubi has full dnf/yum. ubi-init runs systemd for multi-service containers.
  - Trademark: the EULA permits Red Hat marks when distributing UBI-based images, and the phrase "Built on Red Hat Universal Base Image" may be used. — [Red Hat UBI FAQ](https://developers.redhat.com/articles/ubi-faq)
- The UBI EULA PDF itself was fetched but could not be parsed. — [UBI EULA PDF](https://www.redhat.com/licenses/EULA_Red_Hat_Universal_Base_Image_English_20190422.pdf)

### Inferences
- UBI lacks the following for RHCSA practice:
  - Kernel and bootloader: no GRUB, no boot targets, no root recovery.
  - Real block devices: no partitioning, LVM, swap, or fstab mounts.
  - Its own SELinux enforcement: containers inherit the host's.
  - firewalld and NetworkManager (nmcli) as a real network stack.
  - tuned and chrony behavior.
  - Reboot persistence.
  - The full RHEL repo set: AppStream/BaseOS in UBI is a subset, so many admin tools may be missing.
- ubi-init gives systemd, but only in a container context. UBI fits the shell, text, and scripting labs at best.
- No published RHEL licensing path covers a multi-user hosted training service. A commercial service would need a negotiated agreement with Red Hat (paid subscriptions, a Red Hat training-partner arrangement, or a Teams deal). This is my inference; legal confirmation is needed.

### Gaps
- No explicit Red Hat text was found that addresses "hosting RHEL for training third parties". The conclusion rests on the personal-use and no-redistribution terms.
- Developer for Teams terms and pricing are unpublished.

## 4. RHEL-compatible and other free alternatives: licensing, images, RHCSA fidelity, trademark/naming

### Takeaway
Rocky Linux and AlmaLinux are the practical golden-image bases for RHCSA-style labs.
- **Images:** both publish GenericCloud qcow2 images and container images (Alma 9 and 10 confirmed on mirrors). Unmodified redistribution is allowed.
- **Trademarks for modified images:** Rocky requires written permission to use its marks for anything beyond accurate compatibility statements. Alma lets you use its name only to describe origin for modified builds. In practice, don't call your modified golden image "Rocky Linux" or "AlmaLinux".
- **Red Hat guidelines:**
  - Non-partners may not offer Red Hat *certification* courses or exams.
  - Training may refer to products only nominatively. Your own name must be more prominent, with no Red Hat logos and no course IDs such as RH200 or EX220.
  - A no-affiliation disclaimer is required.
  - So "RHCSA-style" naming needs care.
- **Ubuntu:** modified images must have trademarks removed, or have Canonical approval.

### Cited Findings
- **Red Hat trademark guidelines**
  - Non-partners may not offer Red Hat certification courses or exams without "first becoming a Red Hat certified training partner".
  - Independent training may use the marks only to refer to products covered, with the provider's name more prominent, no Red Hat logos, no Red Hat course IDs, and a no-affiliation disclaimer.
  - You may not claim that a product or service is certified by Red Hat without authorization.
  - Rebuilt or derived software must remove all Red Hat marks and use a non-similar name. "Built from modified source code derived from Red Hat Enterprise Linux" is acceptable wording.
  - Source: [Red Hat Trademark Guidelines](https://www.redhat.com/en/about/trademark-guidelines-and-policies)
- **Rocky Linux (RESF)**
  - No product, service, or advertising use of the marks without written authorization.
  - Accurate compatibility statements such as "<product> for Rocky Linux" are allowed if they don't imply endorsement.
  - The marks may not be altered.
  - Principal Sponsors get broader rights.
  - Source: [Rocky Linux trademark guidelines](https://rockylinux.org/legal/trademarks)
- **Rocky container images**
  - The Docker Hub official image is stale (tags 8 and 9 only, 9.3 from 2023) and redirects users to `rockylinux/rockylinux` for current images.
  - The page shows no Rocky 10 and no init variant.
  - Source: [Docker Hub rockylinux](https://hub.docker.com/_/rockylinux)
- **AlmaLinux**
  - Marks are allowed for bit-for-bit identical official releases.
  - For modified builds, the word mark may be used only to truthfully describe origin, never to claim "this is AlmaLinux OS". Logos may only be scaled.
  - Sources: [AlmaLinux trademark usage policy](https://almalinux.org/p/the-almalinux-os-trademark-usage-policy) (via search summary) and [brand book](https://almalinux.org/branding/brand-book)
- **AlmaLinux images**
  - GenericCloud qcow2 images exist for AlmaLinux 9 (9.8) and 10, including x86_64_v2 and other architectures.
  - osbuild image descriptions for Alma 9.4 and 10.1 qcow2 include cockpit-system and cockpit-ws.
  - Sources: [RIKEN mirror Alma 9 cloud](https://ftp.riken.jp/Linux/almalinux/9/cloud/x86_64/images/), [Alma 10 cloud](https://ftp.riken.jp/Linux/almalinux/10/cloud/x86_64_v2/images), [osbuild Alma 10.1 qcow2](https://osbuild.org/docs/user-guide/image-descriptions/almalinux-10.1/qcow2/)
- **AlmaLinux container image** on Docker Hub — [Docker Hub almalinux](https://hub.docker.com/r/almalinux/almalinux)
- **Ubuntu (Canonical IP policy, 2015)**
  - Unmodified Ubuntu, including VM images, may be redistributed.
  - Modified versions must either be approved, certified, or provided by Canonical (possibly under a paid licence), or have trademarks removed and replaced and binaries recompiled.
  - Modification for personal or internal organizational use is allowed.
  - Source: [Canonical IP rights policy](https://canonical.com/legal/intellectual-property-policy)
- **Debian**
  - The trademark policy does not aim to limit commercial activity.
  - The Debian name may not be used in product or service names, and endorsement may not be implied. A non-affiliation disclaimer is suggested.
  - Modified-image redistribution is not addressed specifically.
  - Source: [Debian trademark policy](https://www.debian.org/trademark)

### Inferences
- **RHCSA fidelity of Rocky and Alma:** both are RHEL rebuilds, so SELinux (targeted policy, enforcing), firewalld, dnf, LVM, autofs, NFS, tuned, chrony, GRUB2/BLS, systemd, podman, and cockpit should all match RHEL closely. Stratis and VDO are RHEL packages and should be present in the rebuilds' repos.
- **Gaps versus RHEL:** no subscription-manager or Red Hat CDN (the "install from Red Hat CDN" objective can only be simulated with local or remote repos), and branding differs.
- **CentOS Stream** is upstream of RHEL, so it is close but moves ahead of RHEL minor releases. **Fedora** is further ahead: firewalld, SELinux, and dnf5 differ. **Oracle Linux** is RHEL-compatible and freely downloadable, with its own trademark terms.
- **Naming advice:**
  - Do: name things after skills, e.g. "Linux System Administration – RHEL-compatible", "aligned to RHCSA (EX200) objectives".
  - Use "RHCSA" only nominatively, with a non-affiliation disclaimer.
  - Don't: use Red Hat course or exam codes as product names, or imply Red Hat certification or partnership.
  - Avoid calling a modified golden image "Rocky Linux" or "AlmaLinux"; say "based on Rocky Linux 9".
  - This is not legal advice; counsel should confirm before the commercial launch.

### Gaps
- I did not fetch the following:
  - Rocky or Alma licensing policy pages and the Rocky GenericCloud image directory
  - CentOS Stream, Fedora, and Oracle Linux licensing or image pages
  - Ubuntu cloud-image-specific terms
- Stratis and VDO availability in the Rocky and Alma 9/10 repos was not verified.
- The rule against using course IDs is specific. I found no explicit Red Hat ruling on using "RHCSA" in third-party lab titles.
