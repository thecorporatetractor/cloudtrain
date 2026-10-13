# Eight certifications collapse into one tiered skill graph

CloudTrain can cover every major Linux certification (LFCS, LFCA, Linux Essentials, LPIC-1, LPIC-2, RHCSA on RHEL 9 and 10, the Ansible-based RHCE EX294, and CompTIA Linux+ XK0-005/XK0-006) from **one deduplicated skill graph of 16 domains and roughly 130 competencies**. Each competency is tagged with the cheapest lab tier that still gives an authentic experience. The tiers are an unprivileged user-namespace pod (Tier A), a privileged Kata pod running a custom guest kernel (Tier B), and a KubeVirt VM (Tier C). The exams overlap far more than their branding suggests. Shell, text processing, permissions, users, processes, packages, systemd, LVM, networking and SELinux recur in nearly all of them. What separates them is format (only LFCS and Red Hat are fully performance-based) and a few distinctive areas: Ansible for EX294, server services for LPIC-2, and automation, compliance and AI-use objectives for XK0-006. The decisive design constraint is the substrate. Boot, GRUB, SELinux, auditd, kernel modules and anything graded after a reboot need a VM. Block storage, firewalls, systemd and container internals become safe for multiple tenants only inside Kata's per-pod guest kernel. By topic count, an estimated 70–80% of an RHCSA/LFCS-style curriculum fits Tiers A and B. That figure is an engineering estimate, not a measurement. Base images should be **AlmaLinux or Rocky Linux** for the Enterprise Linux (EL) family and **Ubuntu LTS** for the Debian family. RHEL itself cannot legally back a hosted multi-user service under the free developer terms. UBI is freely redistributable but too thin for system-level labs. Certification names may appear only nominatively, alongside a no-affiliation disclaimer. Because labs have no internet, every path also depends on in-cluster mirrors for packages, container images, Git, Ansible collections, time and certificates.

## Exams converge on one admin core but diverge in format and freshness

The eight certification targets fall into three groups: performance-based sysadmin exams (LFCS, RHCSA, EX294), broad multiple-choice exams with scenario questions (Linux+), and recall-oriented multiple-choice ladders (Linux Essentials, LPIC-1, LPIC-2, LFCA). This matters for CloudTrain. **Only LFCS is fully performance-based at the command line among the LF/LPI exams** ([LFCS page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/)). Every LPI exam is multiple-choice plus fill-in-the-blank, 60 questions in 90 minutes ([LPIC-1 overview](https://www.lpi.org/our-certifications/lpic-1-overview/)). Red Hat's exams require configurations to survive a reboot, with no internet access and only local product docs ([Red Hat EX200](https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam)). This is the strongest argument for VM-tier labs on the RHCSA path. Linux+ mixes up to 90 multiple-choice and performance-based questions in 90 minutes, with a pass mark of 720/900 ([CompTIA Linux+](https://www.comptia.org/en-us/certifications/linux/)). The objectives below are paraphrased and condensed. Codes in parentheses are the IDs used in the crosswalk later in this report.

### Linux Foundation: LFCS and LFCA

LFCS was rebalanced on **11 May 2023** into five domains, and the LF now describes it as distribution-agnostic with no platform choice ([LF blog](https://training.linuxfoundation.org/blog/updated-linux-foundation-certified-system-administrator-lfcs-exam/)). Its scope is modern. It includes libvirt VMs, container engines, SELinux, NAT, bonds and bridges, reverse proxies, LDAP accounts, Git and TLS certificates, which makes it effectively a distro-neutral superset of RHCSA. The exam runs 2 hours and costs $445 ([LFCS page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/)). Community reports say the exam environment is typically Ubuntu, but the LF does not confirm this ([KodeKloud community](https://kodekloud.com/community/t/lfcs-exam-os-2024/468650)).

| LFCS domain (code) | Weight | Paraphrased competencies |
|---|---|---|
| Operations Deployment (LFCS-OD) | 25% | Runtime and persistent kernel parameters; diagnosing processes and services; scheduling jobs; package and repository maintenance; recovering from hardware, OS or filesystem failure; managing libvirt VMs; running containers; SELinux enforcement |
| Networking (LFCS-NET) | 25% | IPv4/IPv6 and name resolution; time sync; network monitoring and troubleshooting; OpenSSH server and client; packet filtering, port redirection and NAT; static routes; bridges and bonds; reverse proxies and load balancers |
| Storage (LFCS-STO) | 20% | LVM; virtual filesystems (/proc, /sys, tmpfs); creating and repairing filesystems; NFS, SMB, iSCSI and NBD; swap; automounters; storage performance monitoring |
| Essential Commands (LFCS-EC) | 20% | Basic Git; creating and troubleshooting services; system performance monitoring; application- and service-specific constraints; disk-space troubleshooting; SSL certificates |
| Users and Groups (LFCS-UG) | 10% | Local accounts; personal and system-wide environment profiles; user resource limits; ACLs; LDAP-backed accounts |

LFCA is still for sale as of August 2026. It is a 90-minute multiple-choice beginner exam, and only **16% is pure Linux**, plus 30% system-administration fundamentals ([LFCA page](https://training.linuxfoundation.org/certification/certified-it-associate/)). Its six domains are System Administration Fundamentals (30%), Cloud Computing (18%), Linux Fundamentals (16%), Security (14%), DevOps (12%) and IT Project Management (10%). The LF publishes no sub-competencies for it. In the graph, LFCA belongs as a vocabulary overlay on the Foundations path, not as a lab track.

### LPI: Linux Essentials, LPIC-1, LPIC-2 (and LPIC-3 303)

Linux Essentials 1.6 (exam 010-160) has five topics weighted to 40 questions. They cover community and careers (7), finding your way around the system (9), the power of the command line (9), the OS itself (8), and security and permissions (7) ([LPI 010 objectives](https://www.lpi.org/our-certifications/exam-010-objectives/)). Topic 1 and much of Topic 4 are knowledge-only.

**LPIC-1 is still version 5.0, released 29 October 2018**, and no v6 has been announced ([LPI announcement](https://www.lpi.org/fr/articles/lpi-releases-updates-lpic-1-and-linux-essentials-certifications/); [LPIC-1 objectives](https://www.lpi.org/our-certifications/exam-101-objectives/)). Its numbered sub-objectives make an excellent skeleton for fine-grained skill IDs:

| Exam | Topic (weight) | Paraphrased sub-objectives (weight) |
|---|---|---|
| 101-500 | 101 System Architecture (8) | Hardware settings, sysfs/udev (2); boot sequence and boot logs (3); targets, shutdown, rescue mode (3) |
| 101-500 | 102 Installation & Packages (12) | Disk layout (2); GRUB 2 and legacy (2); shared libraries (1); Debian packages (3); RPM/YUM/zypper (3); Linux as a VM or container guest, cloud-init (1) |
| 101-500 | 103 GNU & Unix Commands (26) | Command line (4); text filters (2); file management (4); streams and pipes (4); processes (4); priorities (2); regex (3); vi editing (3) |
| 101-500 | 104 Devices, Filesystems, FHS (14) | Partitions and mkfs incl. Btrfs basics (2); integrity tools (2); mounting and fstab (3); permissions and special bits (3); links (2); FHS and finding files (2) |
| 102-500 | 105 Shells & Scripting (8) | Shell environment files, aliases, functions (4); simple scripts (4) |
| 102-500 | 106 Interfaces & Desktops (4) | X11/Wayland (2); desktops and remote display (1); accessibility (1) |
| 102-500 | 107 Administrative Tasks (12) | Users and groups (5); cron, at, systemd timers (4); localisation and time zones (3) |
| 102-500 | 108 Essential Services (12) | Time and chrony (3); rsyslog, journald, logrotate (4); MTA basics (3); CUPS printing (2) |
| 102-500 | 109 Networking (14) | Protocol fundamentals (4); persistent config incl. nmcli (4); troubleshooting with ip/ss (4); client DNS (2) |
| 102-500 | 110 Security (10) | Security admin, SUID audit, sudo (3); host security, socket units (3); SSH keys, tunnels, GnuPG (4) |

The highest-weighted topic, 103 (26 of 60 questions on exam 101), points to where beginner lab volume should go. LPI itself flags ifup/ifdown, net-tools and TCP wrappers for removal ([LPIC-1 objectives](https://www.lpi.org/our-certifications/exam-101-objectives/)). CloudTrain should treat those, along with X11, accessibility, CUPS and GRUB Legacy, as quiz-only legacy nodes.

LPIC-2 is officially still **v4.5, live since 13 February 2017** ([LPIC-2 objectives](https://www.lpi.org/our-certifications/exam-201-202-objectives/)). That is now the oldest syllabus in the set.

| Exam | Topic (weight) | Paraphrased focus |
|---|---|---|
| 201-450 | 200 Capacity Planning (8) | Measuring CPU, memory, disk and network bottlenecks (6); trend prediction (2) |
| 201-450 | 201 Kernel (9) | Kernel images (2); compiling, initramfs, DKMS (3); runtime modules, sysctl, udev (4) |
| 201-450 | 202 System Startup (9) | Customizing systemd startup (3); recovery, UEFI, rescue modes (4); alternate bootloaders, PXE (2) |
| 201-450 | 203 Filesystems & Devices (9) | Operating filesystems and mount units (4); maintenance, SMART (3); autofs, ISO, LUKS basics (2) |
| 201-450 | 204 Advanced Storage (8) | Software RAID (3); device tuning, iSCSI (2); LVM incl. snapshots (3) |
| 201-450 | 205 Networking (11) | Basic config (3); advanced routing, tcpdump, nmap (4); troubleshooting (4) |
| 201-450 | 206 System Maintenance (6) | Build from source (2); backups (3); notifying users (1) |
| 202-450 | 207 DNS (8) | BIND caching/authoritative (3); zones (3); DNS security (2) |
| 202-450 | 208 HTTP (11) | Apache (4); Apache TLS (3); Squid (2); Nginx (2) |
| 202-450 | 209 File Sharing (8) | Samba (5); NFS server (3) |
| 202-450 | 210 Client Management (11) | DHCP (2); PAM and SSSD (3); LDAP client (2); OpenLDAP server (4) |
| 202-450 | 211 E-Mail (8) | Postfix (4); Sieve (2); Dovecot (2) |
| 202-450 | 212 System Security (14) | Router and NAT (3); FTP (2); SSH hardening (4); security tasks, fail2ban (3); OpenVPN (2) |

LPI's own "future considerations" for LPIC-2 add nmcli, firewalld/ufw, FreeIPA, mod_security, quotas, advanced scripting and Let's Encrypt. They drop FTP and djbdns ([LPIC-2 objectives](https://www.lpi.org/our-certifications/exam-201-202-objectives/)). The LPIC-1 page, meanwhile, refers to an "LPIC-2 v5.0" that the LPIC-2 overview does not list ([LPIC-1 objectives](https://www.lpi.org/our-certifications/exam-101-objectives/)). CloudTrain should therefore modernize LPIC-2 content toward that future list rather than freeze on v4.5. For an advanced security tier, LPIC-3 303 (version 3.0) weights cryptography (17), host security (13), access control (8), network security (17) and threat assessment (5) ([LPI 303 objectives](https://www.lpi.org/our-certifications/exam-303-objectives/)).

### Red Hat: RHCSA on RHEL 9 vs RHEL 10, and EX294

**The live EX200 page now bases RHCSA on RHEL 10** ([Red Hat EX200](https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam)). Red Hat staff confirmed that containers were dropped in the latest release ([learn.redhat.com](https://learn.redhat.com/t5/General/Has-There-Been-a-Recent-Update-to-the-EX200-Exam-Objectives/m-p/53276)), and third-party trainers report Flatpak and systemd timers as the additions ([CertCrush](https://www.certcrush.app/blog/how-to-pass-rhcsa-ex200-2026-8-week-study-plan); [Alta3](https://alta3.com/courses/aa-cs-ex200)). The objective lists carry no weights. The RHEL 9 list below comes from a third-party reproduction ([RootUsers](https://www.rootusers.com/?p=5168)).

| Objective group (paraphrased) | RHEL 9 | RHEL 10 |
|---|---|---|
| Essential tools: shell syntax, redirection, grep/regex, SSH, switching users, archives, editing, file ops, links, permissions, man/info/docs | Yes | Yes |
| Manage software: configure RPM repos, install/remove RPMs, configure Flatpak remotes, install/remove Flatpaks | No group | **New** |
| Simple shell scripts: conditionals, for-loops, positional arguments, command output | Yes | Yes |
| Operate running systems: boot/reboot, boot into a target, interrupt boot for access, kill heavy processes, nice, tuned profiles, logs and persistent journal, network services, secure file transfer | Yes | Yes |
| Local storage: partitions, PV/VG/LV lifecycle, mount by UUID/label, non-destructive add of partitions/LVs/swap | MBR and GPT | GPT confirmed; MBR unverified |
| File systems: vfat/ext4/xfs, NFS, autofs, extend LVs, fix permission problems | Plus set-GID collaborative directories | Set-GID item **removed** |
| Deploy and maintain: scheduling, services, default target, chrony client, package install/update, bootloader changes | at and cron | at, cron and **systemd timers** |
| Basic networking: IPv4/IPv6, hostname resolution, services at boot, firewalld restriction | Yes | Yes |
| Users and groups: local users, password aging, groups, sudo | Yes | Yes |
| Security: firewalld, umask, SSH keys, SELinux modes, contexts, restorecon, port labels, booleans | Plus diagnosing routine SELinux violations | Violation diagnosis **removed** |
| Containers: find/pull/inspect images, podman and skopeo, build from Containerfile, run as systemd service, persistent storage | Yes | **Removed** |

Neither list names Stratis, VDO, dnf modules or image mode (bootc). CloudTrain should mark all four as optional "beyond-exam" nodes. EX294 survives the **May 2026 restructure**, retitled "Red Hat Certified Advanced System Administrator in Ansible" and paired with EX200 in the Ansible track ([Red Hat EX294](https://www.redhat.com/en/services/training/ex294-red-hat-certified-engineer-rhce-exam-red-hat-enterprise-linux-9); [TechBeatly](https://techbeatly.com/rhca/)). Its paraphrased objectives span 14 groups. They are: all RHCSA-level tasks, including reading scripts; core Ansible components (inventories, modules, variables, facts, loops, conditionals, handlers, failure handling, roles, ansible-doc); ansible.cfg and ansible-navigator configuration with static inventories; managed-node setup, SSH key distribution and privilege escalation; file deployment; running content with both ansible-navigator and ansible-playbook; basic Git; writing playbooks in VS Code, pushing to Git and running them in a development container; plays with registered results and error handling; roles and collections; automating every RHCSA task area with modules; and Jinja2 templates with Ansible Vault. The VS Code and dev-container items are the most toolchain-heavy, and no source dates their addition.

### CompTIA: Linux+ XK0-005 vs XK0-006

**XK0-006 launched 15 July 2025, and XK0-005 retired in English on 13 January 2026** ([CompTIA Linux+](https://www.comptia.org/en-us/certifications/linux/); [Training Camp](https://trainingcamp.com/articles/comptia-linux-xk0-006-exam-guide-domains-pbqs-and-a-study-approach-that-actually-works-in-2026/)). New content should target XK0-006. XK0-005 matters only for learners who are mid-preparation in non-English versions.

| XK0-005 domain | Weight | XK0-006 domain | Weight |
|---|---|---|---|
| 1 System Management (FHS, boot, files, storage, processes/services, networking, software build/install, configs) | 32% | 1 System Management (boot/FHS/architectures, devices and modules, storage incl. LVM/RAID/mount options, network config incl. Netplan, shell operations, backup/restore, KVM/libvirt virtualization) | 23% |
| 2 Security (PKI, identity, firewalls, remote access, ACL/SELinux/AppArmor) | 21% | 2 Services & User Management (files, accounts, processes and jobs, software incl. pip/npm/cargo and basic DNS/NTP/DHCP/HTTP/mail services, systemd, containers incl. runc/containerd/networks) | 20% |
| 3 Scripting, Containers & Automation (shell scripts, container ops, Git, IaC concepts, orchestration concepts) | 19% | 3 Security (AAA incl. PAM/SSSD/Kerberos/auditd, firewalld/ufw/nftables/NAT, OS hardening incl. sudoers/SELinux/SSH/fail2ban, account hardening, cryptography incl. LUKS2/WireGuard, compliance incl. OpenSCAP/CIS/AIDE) | 18% |
| 4 Troubleshooting (storage, network, CPU/memory, access, systemd unit diagnosis) | 28% | 4 Automation, Orchestration & Scripting (Ansible/Puppet/OpenTofu, Kickstart/cloud-init, CI/CD and GitOps, Kubernetes/Swarm/Compose, shell scripting, Python basics, Git, responsible AI use) | 17% |
| | | 5 Troubleshooting (monitoring with SLA/SLI/SLO and SNMP; hardware/storage/OS, networking, security and performance scenarios) | 22% |

Sources: [XK0-005 objectives PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652); [XK0-006 objectives PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85).

The structural shift is significant: **4 domains and 20 objectives became 5 domains and 29 objectives**. AppArmor, net-tools, Chef/Salt/Terraform, SAN multipathing and detailed unit-file directives were removed. Python, an AI-use objective, KVM/libvirt, monitoring, OpenTofu and compliance tooling were added ([XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)). The XK0-006 symptom lists in 5.2–5.5 read like ready-made fault-injection catalogues. They are the best seed for CloudTrain's break-fix ("Fix") labs. XK0-006 recommends both EL clones (Alma, Rocky) and Ubuntu/Debian, and it tests firewalld alongside ufw and NetworkManager alongside Netplan. That confirms the two-image-family requirement.

## Three tiers decide what each skill costs to run

Kubernetes user namespaces changed the economics of the cheap tier. They are **stable since Kubernetes v1.36**. A pod with `hostUsers: false` runs as root inside the container but is unprivileged on the host, and Pod Security Admission then skips its runAsUser and runAsNonRoot checks even under the Restricted profile ([K8s user namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)). Students can run `useradd`, `chown`, `setfacl` and package installs in a Tier A pod without becoming host root. Four limits remain. User-namespace pods cannot use raw block `volumeDevices` or NFS volumes, the `CAP_SYS_MODULE` capability has no effect, and `CAP_SYS_ADMIN` is scoped to the pod's own namespaces ([K8s user namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)). Anything beyond the Baseline capability list (NET_ADMIN, SYS_ADMIN, SYS_TIME, SYS_MODULE) requires a Privileged-level namespace ([Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)). Two shared-kernel hazards rule out runc for the middle tier entirely. **Loop devices are not namespaced**, so exposing them leaks state across tenants ([LKML loopfs](https://lkml.iu.edu/hypermail/linux/kernel/2004.2/10825.html)). CLOCK_REALTIME is not virtualized by time namespaces either ([time_namespaces(7)](https://man7.org/linux/man-pages/man7/time_namespaces.7.html)).

Kata changes the picture because **each pod gets its own guest kernel**, and privileged containers gain capabilities inside that guest only ([Kata limitations](https://github.com/kata-containers/kata-containers/blob/main/docs/Limitations.md)). Two settings make this safe. The `privileged_without_host_devices=true` setting, which kata-deploy enables by default, stops host devices from being hot-plugged into privileged pods ([Kata privileged how-to](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/privileged.md)). The default guest kernel, however, is minimal and tuned for boot time ([Kata guest assets](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/guest-assets.md)), so Tier B requires a **dedicated RuntimeClass with a custom guest kernel and rootfs**. That kernel needs device-mapper, md, loop, quota, NFS, bridge, 802.1Q, nf_tables, netem and, ideally, BPF/BTF built in. systemd can run as a container's PID 1 only under specific conditions: a delegated writable cgroup v2 tree, tmpfs on /run, `CAP_SYS_ADMIN` and SIGRTMIN+3 as the stop signal. Even then, udev, real devices and audit stay unavailable ([systemd container interface](https://systemd.io/CONTAINER_INTERFACE/)). Kata confines all of that to the guest. Kata still offers no GRUB, no student-controlled initramfs and no real boot, so boot skills remain VM-only.

The resulting rule is simple. Use the cheapest tier that keeps the skill authentic, and escalate only when the kernel, a device, an LSM or a reboot is part of what is being graded.

| Tier | Substrate | Guardrails | Authentic for | Not authentic for |
|---|---|---|---|---|
| **A** | runc locally / Kata in prod, `hostUsers: false`, Baseline or Restricted PSS | Default seccomp; egress only to in-cluster mirrors; ResourceQuota and TTL | Shell, text, files, permissions, ACLs (verify), users, sudoers, processes, cron (supervised crond), packages via mirror, scripting, Git, SSH, client networking, user-space servers (web, DNS, mail, LDAP) | Anything touching devices, netfilter, systemd PID 1, LSMs, global sysctls, time |
| **B** | Kata only, privileged or NET_ADMIN+SYS_ADMIN, custom `kata-lab` RuntimeClass | `privileged_without_host_devices`; admission rule that privileged implies Kata; dedicated node pool | systemd units, timers and journald; ip/route/bridge/VLAN/netns; nftables and firewalld (runtime); tc/netem; losetup, LVM, mdadm, mkfs, mount, swap; cgroup v2 and namespaces by hand; podman inside the lab; perf/eBPF and PSI on guest values | Boot, GRUB, initramfs; SELinux/AppArmor/auditd (unverified in guest); persistence across a real reboot |
| **C** | KubeVirt VM (Alma/Rocky/Ubuntu cloud image + cloud-init), web console via `virtctl` VNC/serial | Pre-warmed VM pools; per-lab network via Multus | Boot and recovery, kernel modules, SELinux, auditd, AppArmor, NetworkManager/Netplan persistence, fstab and reboot-graded storage, Stratis, NFS server, Flatpak, kdump, libvirt (nested), multi-node Ansible estates | (none; it is the most expensive tier) |
| **Q** | Quiz or knowledge check | (none) | Concepts, history, licensing, port numbers, "awareness of X" items | Hands-on grading |

Cost differences are real but poorly benchmarked. Secondary sources put Kata at roughly 150–400 ms extra startup and 100–250 MB extra memory per pod, without stated methodology ([admin-magazine](https://admin-magazine.com/Articles/Isolate-workloads-from-Docker-and-Kubernetes-with-Kata-Containers/(offset)/3); [jacar.es](https://jacar.es/en/kata-containers-strong-isolation-with-a-docker-like-experience/)). Older virtio-9p measurements showed Kata roughly doubling p50 read latency ([StackHPC](https://www.stackhpc.com/kata-io-1.html)). A KubeVirt VM is ready only after a full guest boot, and its control plane becomes a bottleneck at high VM density per node ([Portworx](https://portworx.com/?p=40285); [IBM Research](https://research.ibm.com/publications/kubevirt-scale-test-by-creating-400-vmis-on-a-single-node)). In practice, Tier C labs need pre-warmed VM pools and small cloud images to feel interactive. CloudTrain should benchmark all three tiers on its own vCenter-hosted workers before setting per-lab quotas.

## A sixteen-domain taxonomy absorbs the exams and the SRE canon

The taxonomy below merges every certification objective with the topics that industry roadmaps and job postings add beyond the exams. The roadmap.sh Linux roadmap stops short of SELinux, auditd, CIS, perf/eBPF and PSI ([roadmap.sh repo](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/linux/content)). Compute-node SRE postings explicitly require scheduling, memory, cgroups, namespaces, perf, eBPF and ftrace ([Lever posting](https://jobs.lever.co/jobgether/a7e5f63a-4d08-4ccd-a3b6-1a00408d2996)). The performance branch follows Brendan Gregg's USE method and 60-second checklist ([USE method](https://www.brendangregg.com/usemethod.html); [Thomas-Krenn](https://www.thomas-krenn.com/en/wiki/Linux_performance_analysis_in_60_seconds)), drilling down into bcc tools ([iovisor/bcc](https://github.com/iovisor/bcc)), PSI ([kernel PSI docs](https://docs.kernel.org/accounting/psi.html)) and cgroup v2 memory events ([kernel cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)). The container-internals branch reflects the eight namespace types ([namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)) and the fact that **systemd 258 removed cgroup v1 support** ([linuxiac](https://linuxiac.com/systemd-258-drops-cgroup-v1-raises-kernel-baseline-to-5-4/)). The hardening branch follows the CIS benchmark structure and OpenSCAP/SSG tooling ([Red Hat KB 7146814](https://access.redhat.com/articles/7146814); [Red Hat SSG notes](https://access.redhat.com/articles/7047972)).

Tier assignments are engineering judgement derived from the feasibility research, not vendor documentation. "A/C" means the skill can be practised at Tier A, but authenticity or reboot grading needs Tier C. Crosswalk codes are as follows: LE = Linux Essentials topic; L1/L2 = LPIC-1/2 objective; LFCS-xx = LFCS domain; R9/R10 = RHCSA version where the item differs (an "R" alone means both); X5/X6 = Linux+ objective; EX294 = RHCE Ansible. Skill IDs should take the form `D08.06.lv-extend`, keeping LPIC numbers and other exam codes as tags rather than primary keys, so that exam revisions never force renumbering.

### D01 Command line and shell, D02 files and text

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 01.1 Shell basics | Syntax, quoting, variables, export/env, PATH, history, type/which, aliases, functions | A | LE 2.1; L1 103.1, 105.1; R; X6 1.5 |
| 01.2 Navigation and FHS | Absolute/relative paths, hidden files, FHS layout, find/locate/whereis | A | LE 2.3; L1 104.7; X6 1.1, 2.1 |
| 01.3 Getting help | man sections, info, --help, /usr/share/doc, apropos | A | LE 2.2; R |
| 01.4 Editors | vi/vim modes and motions, nano, EDITOR variable | A | L1 103.8; R; X6 1.5 |
| 01.5 Environment profiles | /etc/profile, bashrc, bash_profile, skel, system-wide vs personal | A | L1 105.1; LFCS-UG; X6 1.5 |
| 01.6 Remote shell | ssh client, ~/.ssh/config, scp/sftp, rsync over SSH, tmux/screen | A | R; L1 110.3; X5 1.5 |
| 02.1 File operations | cp/mv/rm/mkdir/touch, globbing, brace expansion, case sensitivity | A | LE 2.4; L1 103.3; R |
| 02.2 Links and inodes | Hard vs symbolic links, inode numbers, stat, file | A | L1 104.6; R; X6 2.1 |
| 02.3 Streams | stdin/stdout/stderr redirection, pipes, tee, xargs, here-docs and here-strings | A | LE 3.2; L1 103.4; R; X6 1.5 |
| 02.4 Text filters | cut, sort, uniq, wc, head/tail, tr, paste, join, split, nl, diff/sdiff, checksums | A | L1 103.2; X6 1.5, 2.1 |
| 02.5 Regex and stream editing | BRE vs ERE, grep -E, sed substitutions, awk fields and patterns | A | L1 103.7; R; X5 3.1 |
| 02.6 Archives and backup | tar, gzip/bzip2/xz/zip/7z, cpio, rsync; dd/ddrescue to devices | A (B for devices) | LE 3.1; L1 103.3; L2 206.2; R; X6 1.6 |

### D03 Identity and access, D04 processes and scheduling

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 03.1 Local accounts | useradd/adduser, usermod, userdel, groups, passwd/shadow/group files, UID ranges, getent | A (root-in-userns) | LE 5.1–5.2; L1 107.1; LFCS-UG; R; X6 2.2 |
| 03.2 Password aging and locking | chage, passwd -l, login.defs, nologin shells, expiry | A | L1 110.1; R; X6 2.2, 3.4 |
| 03.3 Privilege delegation | sudo, sudoers.d, visudo, aliases, NOPASSWD and NOEXEC risks, su -, wheel | A | L1 110.1; R; X6 3.3 |
| 03.4 Permissions | chmod octal/symbolic, chown/chgrp, umask, SUID/SGID/sticky, set-GID shared dirs | A | LE 5.3–5.4; L1 104.5; R9 (set-GID); X6 3.3 |
| 03.5 ACLs and attributes | setfacl/getfacl, default ACLs, mask; chattr/lsattr | A (verify on idmapped overlay) | LFCS-UG; X5 2.5; X6 3.3 |
| 03.6 Resource limits | ulimit, limits.conf, pam_limits | A | LFCS-UG; L1 110.1 |
| 03.7 Central identity | LDAP client tools, SSSD, PAM stack, Kerberos, realm/Winbind join, OpenLDAP server | A for tools and slapd; C for SSSD/PAM/realm integration | LFCS-UG; L2 210.2–210.4; X6 3.1 |
| 04.1 Process inspection | ps, top/htop/atop, pstree, /proc/PID, lsof, pgrep, pidof | A | L1 103.5; R; X6 2.3 |
| 04.2 Signals and job control | kill/pkill/killall, HUP/TERM/KILL, bg/fg/jobs, nohup, process states and zombies | A | L1 103.5; R; X6 2.3 |
| 04.3 Priorities | nice, renice, finding and killing CPU/memory hogs | A | L1 103.6; R; X6 2.3 |
| 04.4 Classic scheduling | crontab, /etc/cron.d, at, anacron, allow/deny files, cron environment pitfalls | A (supervised crond) | L1 107.2; R; X6 2.3 |
| 04.5 systemd timers | OnCalendar, Persistent, list-timers, systemd-analyze calendar, systemd-run | B | L1 107.2; R10; X5 4.5 |

### D05 software, D06 systemd and boot, D07 kernel and hardware

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 05.1 RPM and dnf | Install/remove/query, rpm -V and signatures, history, exclusions, local repos | A (in-cluster mirror) | L1 102.5; R; X6 2.4 |
| 05.2 dpkg and apt | apt/apt-cache/dpkg, sources.list(.d), pinning, reconfigure | A (mirror) | L1 102.4; X6 2.4 |
| 05.3 Repository management | .repo files, GPG keys, enabling/disabling repos, third-party repos | A | R10 (new group); X6 2.4 |
| 05.4 Libraries and source builds | ldd, ldconfig, LD_LIBRARY_PATH; configure/make/patch | A | L1 102.3; L2 206.1; X5 1.1 |
| 05.5 Sandboxed apps | Flatpak remotes and installs; snap awareness | C (bubblewrap + systemd) | R10; X6 2.4 |
| 05.6 Language ecosystems | pip and venv, npm, cargo, update-alternatives | A (offline indexes) | X6 2.4, 4.3 |
| 06.1 Service lifecycle | start/stop/restart/reload, enable/disable, mask, status, is-active | B | R; LFCS-EC; X6 2.5 |
| 06.2 Unit authoring | Service units (Type, ExecStart, User, After/Wants), drop-ins, systemctl edit, daemon-reload | B | LFCS-EC; X5 4.5; X6 2.5 |
| 06.3 Journal | journalctl -u/-b/-p/--since/-f, persistent storage, size limits | B (persistence: C) | L1 108.2; R |
| 06.4 Targets | Default target, isolate, multi-user vs graphical | B (set) / C (boot into) | L1 101.3; R |
| 06.5 Boot sequence concepts | Firmware, bootloader, kernel, initramfs, init; UEFI vs BIOS; PXE | Q | L1 101.2; X6 1.1 |
| 06.6 Bootloader | GRUB2 config, grubby, kernel command-line parameters, default kernel | C | L1 102.2; L2 202.2; R; X5 1.1 |
| 06.7 Boot recovery | rescue/emergency targets, rd.break / init= root password recovery, broken fstab recovery | C | L2 202.2; LFCS-OD; R; X6 5.2 |
| 06.8 initramfs | dracut/mkinitramfs, rebuilding after driver changes | C | L2 201.2; X6 1.2 |
| 06.9 Boot and unit analysis | systemd-analyze blame/critical-chain, failed units | C (blame) / B | X6 2.5 |
| 06.10 Time and locale | timedatectl, localectl, chrony client config, time zones | B (config) / C (clock stepping) | L1 107.3, 108.1; LFCS-NET; R |
| 06.11 Tuning profiles | tuned-adm profiles and recommendations | C | R |
| 07.1 Hardware discovery | lspci, lsusb, lscpu, lsmem, lshw, dmidecode, /sys, /proc | A partial (host values) / C | L1 101.1; X6 1.2 |
| 07.2 Kernel modules | lsmod/modinfo (A); modprobe, blacklist, modules-load.d (C) | A / C | L1 101.1; L2 201.3; X6 1.2 |
| 07.3 Kernel parameters | sysctl runtime vs /etc/sysctl.d persistence; namespaced net.* vs global vm.* | A (safe list) / B / C (persist) | LFCS-OD; L2 201.3; X5 1.7 |
| 07.4 Devices and udev | udevadm, rules, /dev block vs char devices | C | L1 101.1; L2 201.3 |
| 07.5 Kernel build and crash | Kernel compile, DKMS, kdump | C (low priority) | L2 201.1–201.2 |

### D08 storage

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 08.1 Space analysis | df/du, inode exhaustion, deleted-but-open files, large logs | A | L1 104.2; LFCS-EC; X6 5.2 |
| 08.2 Partitioning | MBR vs GPT, fdisk/gdisk/parted/sfdisk, growpart, partprobe | A (image file) / B (device) | L1 104.1; R; X6 1.3 |
| 08.3 Filesystems | mkfs ext4/xfs/vfat/btrfs, fsck, xfs_repair, tune2fs, resize2fs, xfs_growfs | A (image file) / B (mounted) | L1 104.1–104.2; LFCS-STO; R; X6 1.3 |
| 08.4 Mounting | mount options (noexec, nosuid, nofail…), fstab by UUID/label, mount units | B / C (reboot-graded) | L1 104.3; L2 203.1; R; X6 1.3 |
| 08.5 Swap | Swap partitions and files, priorities, persistence | B / C | LFCS-STO; R |
| 08.6 LVM | PV/VG/LV lifecycle, extend with filesystem resize, snapshots, pvmove | B (dm in guest) / C | L2 204.3; LFCS-STO; R; X6 1.3 |
| 08.7 Software RAID | mdadm create/fail/rebuild, /proc/mdstat | B / C | L2 204.1; X6 1.3 |
| 08.8 Encryption at rest | LUKS2 with cryptsetup, crypttab | B / C (boot unlock) | L2 203.3; X6 3.5 |
| 08.9 Network storage clients | NFS and SMB mounts, autofs maps, systemd automount | B (nfs in guest) / C | LFCS-STO; L2 203.3; R; X6 1.3 |
| 08.10 Block over network | iSCSI initiator, NBD | C | LFCS-STO; L2 204.2 |
| 08.11 Virtual filesystems | /proc, /sys, tmpfs | A | LFCS-STO; X6 1.3 |
| 08.12 Quotas | User/group quotas, reporting | B / C | X5 4.4; X6 5.2 |
| 08.13 Advanced EL storage | Stratis, VDO (beyond exam) | C | (none) |
| 08.14 Storage performance | iostat -x, iotop, fio, I/O wait, trim | B / C | LFCS-STO; L2 200.1; X6 1.3, 5.5 |

### D09 networking, D10 network services

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 09.1 TCP/IP concepts | CIDR and subnetting, private ranges, ports, TCP/UDP/ICMP, IPv6 basics | Q + A | LE 4.4; L1 109.1 |
| 09.2 Inspection | ip addr/route/link show, ss -tulpn, ping, traceroute/tracepath/mtr, curl | A | L1 109.3; X6 1.4 |
| 09.3 DNS client | resolv.conf, nsswitch.conf, /etc/hosts, dig/host/getent, resolvectl | A (resolved: B) | L1 109.4; R; X6 1.4 |
| 09.4 Runtime configuration | ip addr/route add on a secondary interface, static routes | B (NET_ADMIN) | LFCS-NET; L2 205.2 |
| 09.5 Persistent configuration | nmcli and keyfiles (EL), Netplan (Ubuntu), hostnamectl | C (B partial) | L1 109.2; R; X6 1.4 |
| 09.6 Advanced topology | Bridges, VLANs, bonds, veth, network namespaces, policy routing | B / C (persistence) | LFCS-NET; X6 5.3 |
| 09.7 Packet filtering and NAT | nftables, iptables, firewalld zones/rich rules, ufw, port redirect, ip_forward | B / C (persistence) | LFCS-NET; L2 212.1; R; X6 3.2 |
| 09.8 Capture and probing | tcpdump filters, nmap, nc, openssl s_client | B (NET_RAW) | L2 205.2; X5 4.2; X6 1.4 |
| 09.9 Shaping and impairment | tc qdisc, netem for latency/loss labs | B | (beyond exam) |
| 09.10 Interface tuning | ethtool, MTU, iperf3 | B / C | X6 1.4, 5.3 |
| 09.11 Time service | chrony client and server, in-lab NTP | B / C | LFCS-NET; R; L1 108.1 |
| 09.12 VPN | WireGuard, OpenVPN | B (module in guest) / C | L2 212.5; X6 3.5 |
| 10.1 SSH server | sshd_config, key-only auth, AllowUsers/Groups, tunnels, SFTP chroot | A | LFCS-NET; L2 212.3; R; X6 3.3 |
| 10.2 Web and reverse proxy | Apache vhosts, Nginx, HAProxy load balancing, Unix-socket upstreams | A | LFCS-NET; L2 208; X6 2.4 |
| 10.3 TLS and PKI | openssl keys, CSRs, local CA, cert renewal, expiry debugging | A | LFCS-EC; L2 208.2; X6 3.5 |
| 10.4 DNS server | BIND/unbound caching and authoritative zones, DNSSEC awareness | A (multi-pod) | L2 207 |
| 10.5 DHCP | DHCP server and relay | C (needs L2 segment) | L2 210.1; X6 2.4 |
| 10.6 File servers | NFS server/exports, Samba shares | C (NFS) / B (Samba) | L2 209 |
| 10.7 Mail | Postfix, Dovecot, aliases | A | L1 108.3; L2 211; X6 2.4 |
| 10.8 Data services | PostgreSQL/MySQL backup-restore, Redis (SadServers-style) | A | (beyond exam) |

### D11 security and hardening, D12 observability

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 11.1 SELinux operations | Modes, contexts (ls -Z, ps -Z), restorecon, semanage fcontext/port, booleans | C | LFCS-OD; R; X6 3.3 |
| 11.2 SELinux troubleshooting | AVC denials, ausearch, audit2why/audit2allow, sealert | C | R9; X6 3.3, 5.4 |
| 11.3 AppArmor | aa-status, complain/enforce, profile editing | C | X5 2.5 |
| 11.4 Audit | auditd rules, ausearch/aureport, watches on identity files | C | X6 3.1; L3-303 |
| 11.5 Authentication hardening | PAM pwquality and faillock, password history, restricted shells, MFA concepts | A partial / C | X6 3.4 |
| 11.6 SSH and service hardening | Disabling root login and passwords, crypto settings, fail2ban, removing insecure services | A | L2 212.3–212.4; X6 3.3 |
| 11.7 Cryptography | GPG encrypt/sign/verify, hashing and HMAC, TLS versions, system crypto policies | A / C (crypto-policies) | L1 110.3; X6 3.5 |
| 11.8 Integrity | AIDE baseline and check, rpm -V/debsums, rkhunter | A | X6 3.6 |
| 11.9 Compliance scanning | OpenSCAP + SSG CIS/STIG profiles, scan-remediate-rescan, Lynis | C (A partial) | X6 3.6 |
| 11.10 Kernel and boot hardening | Hardening sysctls, disabling unused modules and filesystems, Secure Boot, FIPS, fapolicyd | C | X6 3.3; L3-303 |
| 11.11 Unit sandboxing | NoNewPrivileges, ProtectSystem, PrivateTmp, systemd-analyze security | B | (beyond exam) |
| 11.12 Offensive scenarios | sudo escalation, root cron abuse, SUID abuse, malicious library persistence | A (B for escapes) | L1 110.1; X6 3.6 |
| 11.13 Vulnerability and lifecycle | CVE/CVSS, backported patches, secure wipe, login banners, supply chain | A + Q | X6 3.6 |
| 12.1 Classic logging | /var/log layout, rsyslog rules and forwarding, logger | A / B | L1 108.2; X6 3.1 |
| 12.2 Journald versus rsyslog | Persistence, ForwardToSyslog, CIS either/or choice | B / C | R; CIS |
| 12.3 Log rotation | logrotate policies, copytruncate vs create | A | L1 108.2; X6 3.1 |
| 12.4 Host metrics | node_exporter (textfile, systemd, PSI collectors), Prometheus scrape and alert rules | A (host values partial) / B | (beyond exam) |
| 12.5 Log pipelines | journald to Loki/Vector/Fluent Bit, OpenTelemetry collector | A | (beyond exam) |
| 12.6 Monitoring concepts | SLA/SLI/SLO, SNMP, agent vs agentless, alert thresholds | Q / A | X6 5.1; L2 200.2 |

### D13 performance and troubleshooting, D14 automation

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 13.1 Method | USE method per resource, 60-second checklist (uptime, dmesg, vmstat, mpstat, pidstat, iostat, free, sar) | B (guest-true values) | L2 200.1; X6 5.5 |
| 13.2 CPU | Load vs run queue, per-CPU imbalance, perf record/report, flame graphs, runqlat | B (verify perf_event in guest) | L2 200.1; X5 4.3 |
| 13.3 Memory | free vs cache, swapping, OOM-killer logs, memleak, memory.events | B | X5 4.3; X6 5.5 |
| 13.4 Disk I/O | iowait, biolatency/biosnoop, fio baselines | B / C | X5 4.1; X6 5.5 |
| 13.5 Network performance | sar -n TCP/ETCP, retransmits, ss -i, tcplife, iperf3 | B | X6 5.5 |
| 13.6 Tracing | strace, ltrace, opensnoop/execsnoop, bpftrace one-liners | A (strace; verify seccomp) / B (eBPF) | X6 2.3 |
| 13.7 Pressure stall information | /proc/pressure, per-cgroup pressure, triggers | B | (beyond exam) |
| 13.8 User-space break-fix | Disk full, permissions/ACL, port conflict, CRLF scripts, cron PATH, expired cert, missing binaries, SSH key perms | A | X6 5.2–5.4 |
| 13.9 System break-fix | Failing units, DNS/firewall/routing faults, OOM in cgroup, MTU mismatch | B | X6 5.2–5.3 |
| 13.10 Boot and platform break-fix | GRUB misconfig, kernel panic, unmountable root/fstab, SELinux denials, missing drivers | C | LFCS-OD; X6 5.2 |
| 14.1 Bash scripting | Tests, if/case, for/while/until, arguments, functions, exit codes, command substitution, arithmetic | A | LE 3.3; L1 105.2; R; X6 4.2 |
| 14.2 Robust scripting | Strict mode and its pitfalls, trap, getopts, shellcheck, idempotence, logging | A | (beyond exam) |
| 14.3 Python for admins | venv, stdlib modules, data types, PEP 8 | A | X6 4.3 |
| 14.4 Git | clone/add/commit/branch/merge/rebase/stash/tag, .gitignore, against an in-cluster Git server | A | LFCS-EC; EX294; X6 4.4 |
| 14.5 Ansible core | Inventories, ad hoc, playbooks, variables/facts, loops, conditionals, handlers, blocks/rescue | A control + C managed nodes | EX294; X6 4.1 |
| 14.6 Ansible content | Roles, collections, Jinja2, Vault, ansible-navigator with execution environments, dev containers | B/C (needs podman) | EX294 |
| 14.7 Automating system tasks | Modules for packages, services, firewall, storage, SELinux, users, cron | C | EX294 |
| 14.8 Other IaC | Puppet basics, OpenTofu with a local provider | A | X6 4.1 |
| 14.9 Unattended provisioning | cloud-init user-data and debugging, Kickstart | C | L1 102.6; X6 4.1 |
| 14.10 Delivery and AI practice | CI/CD and GitOps concepts; reviewing AI-generated scripts against a local model | Q / A | X6 4.1, 4.5 |

### D15 virtualization and containers, D16 concepts

| Competency | Skills | Tier | Crosswalk |
|---|---|---|---|
| 15.1 Container operations | podman/docker run, exec, logs, inspect, ports, volumes, networks, Containerfile builds | B (Kata) | LFCS-OD; R9; X6 2.6 |
| 15.2 Containers as services | podman generate/Quadlet units, rootless with lingering | B / C | R9 |
| 15.3 Images and registries | skopeo, buildah, local registry, tags, layers, pruning | B | R9; X6 2.6 |
| 15.4 Namespaces | lsns, /proc/PID/ns, unshare, nsenter | B (A to verify) | (beyond exam) |
| 15.5 cgroup v2 | Hierarchy, subtree_control, memory.max/high, cpu.max, pids.max, delegation, systemd-run scopes | B | (beyond exam) |
| 15.6 Container assembly by hand | overlayfs lower/upper/work, veth + netns plumbing, pivot_root | B | (beyond exam) |
| 15.7 Isolation primitives | Capabilities (capsh), seccomp, subuid/subgid rootless, OCI bundles with runc/crun | B | X6 2.6 |
| 15.8 Escape scenarios | Privileged containers, mounted runtime sockets | B (Kata only) | (beyond exam) |
| 15.9 Orchestration basics | Compose, Swarm and Kubernetes objects at concept level | Q / B | X5 3.5; X6 4.1 |
| 15.10 KVM and libvirt | virsh lifecycle, images, snapshots, VM networks, VirtIO | C (nested virt) | LFCS-OD; X6 1.7 |
| 15.11 Linux as guest | Templates, machine-id and SSH host-key regeneration, guest drivers | C | L1 102.6 |
| 16.x Professional concepts | OSS licensing, distributions and lifecycles, architectures, cloud concepts, GUI stack, printing, accessibility, IT project management | Q | LE 1, 4.1; L1 106, 108.4; LFCA; X6 1.1 |

A rough tally of the rows puts about half the competencies at Tier A, with the rest split between Tier B and Tier C (or A/C). That matches the feasibility research's rough 70–80% A-or-B estimate for an RHCSA/LFCS curriculum. The estimate is inferred, not measured.

## Eleven learning paths order the graph from shell to SRE

The paths form a directed graph rather than a ladder. Foundations gates everything. Two sysadmin paths, distro-neutral and Enterprise Linux, share about 80% of their nodes and then fan out into specialist tracks. The ordering follows the industry pattern of learning an OS and terminal before networking, containers and configuration management ([roadmap.sh DevOps](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/devops/content)). It also borrows the Linux Upskill Challenge's server-first daily sequence, which runs from navigation through services, networking, scheduling, permissions, logs and scripting ([linuxupskillchallenge.org](https://linuxupskillchallenge.org/)). Every lab should carry one of four types. Three come from SadServers: Fix (repair a broken system), Do (complete a task) and Hack (security or CTF style), each with a time box and a `check.sh` grader ([SadServers](https://sadservers.com/scenarios)). CloudTrain adds a fourth, Learn, for guided first exposure.

| Path | Prerequisites | Ordered modules (competency IDs) | Tier mix | Exam alignment |
|---|---|---|---|---|
| **P0 Linux Foundations** | None | 01.1–01.3 → 02.1–02.3 → 01.4 → 02.4–02.5 → 03.1, 03.4 → 04.1–04.3 → 02.6 → 05.1/05.2 (install only) → 09.2 → 16.x quizzes; capstone: Bandit-style progressive levels | A, Q | Linux Essentials; LFCA Linux part; LPIC-1 topic 103 |
| **P1 Shell Scripting and Automation I** | P0 | 14.1 → 02.5 deep → 04.4 → 14.2 → 14.4 → 14.3; Fix labs on silent cron failures and CRLF | A | LPIC-1 105; RHCSA scripts; X6 4.2–4.4 |
| **P2 Linux System Administration (distro-neutral)** | P0; P1 recommended | 01.5 → 03.2–03.6 → 05.3–05.4 → 06.1–06.3 → 04.5 → 06.10 → 07.3 → 08.1–08.5 → 08.9 → 09.3–09.5 → 09.7 → 10.1–10.3 → 03.7 → 11.1 intro → 15.1 → 15.10 → 06.6–06.7 recovery; capstone: timed mixed-task exam on Ubuntu with one EL node | A → B → C | LFCS (all domains); LPIC-1 101/102 remainder; X6 domains 1–2 |
| **P3 Enterprise Linux Administration** | P0; shares nodes with P2 | 03.x → 05.1, 05.3, 05.5 → 14.1 → 04.x → 06.11 → 06.3 persistent → 06.6–06.7 → 08.2–08.6 → 08.9 autofs → 04.5 → 06.10 → 09.5 nmcli → 09.7 firewalld → 11.1 (+11.2 on the 9 variant) → 15.1–15.2 (9 variant only); capstone: reboot-graded mock exam | Mostly C | RHCSA, with RHEL 9 and RHEL 10 variants as toggles |
| **P4 Networking for Linux Admins** | P0 | 09.1 → 09.2 → 09.3 → 09.4 → 09.5 → 09.8 → 09.7 → 09.6 → 09.10 → 09.9 → 09.11 → 09.12 → 10.2 load balancing → 10.4 → 10.5 | B, C | LFCS-NET; LPIC-1 109; LPIC-2 205/212.1; X6 1.4, 3.2, 5.3 |
| **P5 Storage Engineering** | P2 or P3 storage modules | 08.11 → 08.2–08.3 on image files (A) → 08.4–08.5 → 08.6 incl. snapshots → 08.7 failure/rebuild → 08.8 → 08.12 → 08.9–08.10 → 10.6 NFS server → 08.14 → 08.13; Fix labs on boot-time mount failures | A → B → C | LFCS-STO; LPIC-2 203–204; X6 1.3 |
| **P6 Security Hardening** | P2 or P3, plus P4 firewall module | 03.3–03.5 review → 11.6 → 11.5 → 11.7 → 11.8 → 12.1–12.2 → 11.4 → 11.1–11.3 → 09.7 nftables from scratch → 11.10 → 11.11 → 11.9 scan-remediate-rescan per CIS section → 11.12 Hack labs | A → C | X6 domain 3; LPIC-3 303; CIS/STIG practice |
| **P7 Troubleshooting, Performance and Observability** | P2 or P3; P4 recommended | 12.1–12.3 → 13.8 → 13.1 → 13.3 → 13.2 → 13.4 → 13.5 → 13.6 → 13.7 → 15.5 memory.events → 12.4–12.5 → 12.6 → 13.9 → 13.10; capstone: injected-fault incident with USE-method write-up | A → B → C | X6 domain 5; LPIC-2 200; LFCS-EC |
| **P8 Containers Internals** | P2 (systemd, runtime networking), P4 netns module | 15.1 → 15.4 → 15.5 → 15.6 → 15.7 → 15.3 → 15.2 → 15.8 → 15.9 | B | X6 2.6; platform/SRE role skills |
| **P9 Automation at Scale with Ansible** | P3 and P1 | 14.4 → 14.5 → 14.6 → 14.7 → 14.9 → 11.9 Ansible remediation → 14.8 → 14.10 | A control, C managed | RHCE EX294; X6 4.1 |
| **P10 Linux Network Services** | P2 and P4 | 10.1 → 10.3 → 10.2 → 10.4 → 10.7 → 03.7 → 10.6 → 10.5 → 12.1 forwarding | A, C | LPIC-2 exam 202 (modernized) |

Three design choices make this graph work. First, **certification prep is an overlay, not a path**. Each exam gets a module filter over the shared nodes, a quiz bank for its Tier Q items, and a timed mock in its native format. Linux+ uses short scenario simulations seeded from XK0-006 objectives 5.2–5.5. RHCSA and LFCS use multi-hour graded sessions. LPIC uses recall quizzes plus optional labs. Second, **the RHEL 9 and RHEL 10 variants of P3 should be one path with toggles**. The toggles are containers, set-GID directories and SELinux troubleshooting for 9, and Flatpak, timers and the software group for 10. Containers and SELinux diagnosis stay available in P8 and P6 regardless of variant. Third, **both image families run inside P2 and P4**, because LFCS is distro-agnostic and Linux+ tests firewalld next to ufw and NetworkManager next to Netplan ([XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)). Labs therefore assert end state ("port 8443 reachable only from 10.0.5.0/24"), not the tool used to reach it.

The no-internet constraint reshapes several nodes, and these dependencies should be first-class platform services rather than per-lab hacks. Package nodes (05.x) need in-cluster dnf/apt mirrors plus offline PyPI and npm indexes. Flatpak (05.5) needs a local Flatpak remote. Container nodes (15.x) need a local registry. EX294 needs a local Git server and pre-staged collections and execution environments. Time labs (09.11) need an in-lab NTP source. TLS labs (10.3) should use a local CA or ACME test server in place of Let's Encrypt. XK0-006 4.5 needs either an on-platform model or a quiz-only treatment. Red Hat's own exams already run with no internet ([Red Hat EX200](https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam)), so offline labs are a fidelity feature for the RHCSA path, not a compromise.

## Rebuild images and nominative naming keep CloudTrain legal

**RHEL itself is off the table without a negotiated agreement.** The free Developer Subscription is for one individual "in your personal capacity", capped at 16 nodes, and prohibits "selling, distributing and/or rebranding" the subscription services ([Red Hat Developer terms](https://developers.redhat.com/terms-and-conditions/); [no-cost RHEL FAQ](https://developers.redhat.com/articles/faqs-no-cost-red-hat-enterprise-linux)). Developer for Teams terms are unpublished. **UBI is freely redistributable and runs on any Kubernetes**, but it is a package subset. Adding non-UBI RHEL RPMs and redistributing the result on non-Red Hat platforms is not permitted ([UBI FAQ](https://developers.redhat.com/articles/ubi-faq)). UBI therefore fits Tier A EL-flavoured shell and scripting labs, labelled with the permitted "Built on Red Hat Universal Base Image" wording. It cannot carry anything involving a kernel, bootloader, SELinux, firewalld or real storage.

| Image | Use in CloudTrain | Licensing and naming constraint |
|---|---|---|
| **AlmaLinux 9/10** | Primary EL image: GenericCloud qcow2 for Tier C ([Alma 9 cloud](https://ftp.riken.jp/Linux/almalinux/9/cloud/x86_64/images/); [Alma 10 cloud](https://ftp.riken.jp/Linux/almalinux/10/cloud/x86_64_v2/images)), container image for Tiers A/B ([Docker Hub](https://hub.docker.com/r/almalinux/almalinux)) | Marks apply to bit-for-bit official releases. A modified build may only truthfully describe its origin ([Alma trademark policy](https://almalinux.org/p/the-almalinux-os-trademark-usage-policy)) |
| **Rocky Linux 9/10** | Equivalent EL alternative | Product or service use of the marks needs written permission. Accurate compatibility statements are allowed. The official Docker Hub image is stale; use `rockylinux/rockylinux` ([Rocky trademarks](https://rockylinux.org/legal/trademarks); [Docker Hub](https://hub.docker.com/_/rockylinux)) |
| **RHEL** | Not used | Developer terms are personal-use only. A hosted service needs a commercial agreement with Red Hat |
| **UBI (ubi, ubi-minimal, ubi-init)** | Optional Tier A EL shell labs | Redistributable. No non-UBI RPMs. Not a system-admin substrate |
| **Ubuntu LTS** | Primary Debian-family image for P0, P2, P4 and LFCS | Unmodified redistribution is fine. Modified images need Canonical approval or trademark removal. Internal organizational modification is allowed ([Canonical IP policy](https://canonical.com/legal/intellectual-property-policy)) |
| **Debian** | Alternative Debian-family image, lightest trademark burden | No Debian name in product or service names; no implied endorsement ([Debian trademark](https://www.debian.org/trademark)) |
| CentOS Stream / Fedora | "Next RHEL" preview labs only | Ahead of RHEL minor releases, so drift risk for RHCSA fidelity (inference) |

Two practical consequences follow. First, golden images should be presented as "CloudTrain EL lab image, based on AlmaLinux 9", never as "AlmaLinux" or "Rocky Linux". Where possible, boot unmodified upstream cloud images and apply lab state with cloud-init at runtime. That keeps the shipped artefact unmodified, which matters most under Canonical's policy, though counsel should confirm that this reading holds. Second, Rocky and Alma lack subscription-manager and the Red Hat CDN. The RHCSA item on installing from Red Hat's CDN can only be simulated against a local repository, and the lab text should say so plainly.

For certification-aligned content, Red Hat's guidelines are the strictest and set the house style. Non-partners may not offer Red Hat certification courses or exams. Independent training may refer to Red Hat products only nominatively, with the provider's own name more prominent, no Red Hat logos, no Red Hat course IDs, and a no-affiliation disclaimer. Nothing may be claimed as Red Hat-certified ([Red Hat trademark guidelines](https://www.redhat.com/en/about/trademark-guidelines-and-policies)). In practice, path titles name the skill ("Enterprise Linux Administration"). Exam names appear only in descriptive copy ("objectives mapped to RHCSA"). Course and exam codes such as RH124 or EX200 stay out of product names and are best confined to a crosswalk table. Every aligned path carries a footer stating that CloudTrain is not affiliated with or endorsed by the certifying body, that exam names are its trademarks, and that passing CloudTrain labs confers no certification. The same pattern should apply to LFCS, LPIC and Linux+ until their own trademark policies are checked. All objective text in the platform must be paraphrased, as in this report, and never copied from the vendor documents.

## Open questions to verify before building

| Area | Question | Why it matters | How to verify |
|---|---|---|---|
| Exams | Which distro and version does the live LFCS environment use, and what is the pass mark? The official instructions page returned 404 | Decides the default image for P2's capstone | LF candidate handbook; support ticket |
| Exams | Is LPIC-2 v5.0 real, and with what codes and dates? Is an LPIC-1 v6 planned? | LPIC-2 overlay may be built on a dead syllabus | wiki.lpi.org; LPI news |
| Exams | Does RHCSA 10 still include MBR partitioning? What is the duration? How long can the RHEL 9 version be booked? | P3 variant toggles | Raw EX200 page; Red Hat exam support |
| Exams | Which product version does EX294 track, and when were the VS Code and dev-container items added? | Toolchain to pre-stage offline | EX294 page history; AU294 outline |
| Exams | Are the reconstructed XK0-006 objective numbers exact, and is the AutoOps+ claim real? | Hard-coded crosswalk IDs | Visual check of the official PDF |
| Exams | What is the exact CIS section numbering for RHEL 9 v2.0.0 and Ubuntu 24.04 v1.0.0? | P6 module order | CIS PDFs (registration-gated) |
| Substrate | Does the deployed Kata guest kernel support dm, md, loop, quota, NFS, 802.1Q, nf_tables, netem, WireGuard, BPF/BTF, perf events, SELinux and audit? Is the `kernel_modules` annotation allow-listed? | Defines what Tier B can actually host | Inspect Kata kernel configs; smoke-test suite per module |
| Substrate | Do vCenter-hosted workers expose nested VT-x for Kata and KubeVirt, and can a KubeVirt VM nest libvirt for 15.10? | Kata and the libvirt labs may be impossible without it | ESXi "expose hardware virtualization" test |
| Substrate | Can PVC raw block volumes be hot-plugged into Kata guests for "add a second disk" labs? | Tier B storage realism | Test with the CSI driver in use |
| Substrate | Do ACLs behave correctly on idmapped overlay in user-namespace pods on the production kernel? Do unshare and strace work under the default seccomp profile? | Tier A assignments for 03.5, 13.6, 15.4 | Empirical tests |
| Substrate | Does clock stepping inside a Kata guest stick, or does it re-sync? | 06.10 and 09.11 tiering | Empirical test |
| Substrate | What are the real startup times and memory overheads of Tiers A, B and C on CloudTrain hardware? Secondary figures conflict | Capacity planning and pool sizing | kube-burner style benchmarks |
| Substrate | Is there a supported recipe for systemd as PID 1 in local runc/containerd pods, and is Sysbox still maintained? | Local developer parity with Kata | CRI-O and containerd docs; Sysbox repo activity |
| Legal | Is there any Red Hat path (training partnership, Teams agreement) to host real RHEL? May UBI repositories be mirrored internally? | Could replace the Alma/Rocky stand-ins | Red Hat sales and legal |
| Legal | Does booting unmodified Ubuntu cloud images and customizing them via cloud-init avoid the "modified image" clause? Does Rocky's written-permission rule bite for a "based on" statement? | Golden-image strategy | Counsel; Canonical and RESF contacts |
| Legal | What do the trademark policies of the Linux Foundation, LPI and CompTIA say about exam names in third-party training? | Naming of the LFCS, LPIC and Linux+ overlays | Each body's trademark page |
| Content | Are Stratis and VDO in the Alma/Rocky 9/10 repositories? | Optional 08.13 node | Repo query on mirror |
| Content | Can XK0-006 4.5 (AI use) run with an on-platform model in air-gapped labs? | Otherwise it must be quiz-only | Platform architecture decision |

## Conclusion

The research shifts CloudTrain's main problem from content to substrate. The certifications agree on roughly the same 130 competencies, and their recent revisions move in one direction: RHCSA dropping containers while LFCS and Linux+ add them, Linux+ adding compliance, virtualization and AI use, and LPI planning firewalld and nmcli. That direction rewards a vendor-neutral graph with exam codes as tags rather than a set of exam-shaped courses. What the exams do not settle is where each skill can run honestly. The answer is a three-tier ladder in which Kata with a purpose-built guest kernel does most of the heavy lifting, and VMs are reserved for boot, LSMs and reboot grading. The most consequential unknowns are therefore not in any syllabus. They are whether vCenter exposes nested virtualization to the workers and which features the Kata guest kernel actually supports.

The licensing picture points the same way. RHEL cannot back the service on public terms, so fidelity to RHCSA has to come from Alma or Rocky images plus offline Red Hat-like infrastructure: local repositories, a local CA, a local registry and Git. That turns the no-internet constraint from a limitation into exam realism. The cheapest early win is to build P0, P1 and the user-space break-fix catalogue entirely on Tier A. That content covers Linux Essentials, most of LPIC-1 exam 101 and a large share of Linux+ while the Tier B kernel and the Tier C VM pools are validated.
