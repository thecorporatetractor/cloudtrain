# Industry Linux Roadmaps and DevOps/SRE/Platform/Security Linux Skills (2025-2026)

Research date: 2026-10-14. Scope: topics and skill progressions beyond certification syllabi, for a Linux skill graph and learning paths on a hands-on lab platform.

Note on sourcing: claims tagged "[unverified, general knowledge]" in Inferences were not confirmed by a primary source fetched in this session. The report writer should treat them as reasonable but uncited, or drop them.

---

## 1. roadmap.sh Linux roadmap and DevOps roadmap: Linux nodes and ordering

### Takeaway
The roadmap.sh Linux roadmap is a beginner-to-intermediate sysadmin path: navigation/files/text processing, server review, process/user/service/package management, disks and filesystems, booting, networking, shell programming, troubleshooting and containerization. It has almost nothing on security hardening (no SELinux/AppArmor, auditd or CIS), performance tooling (no perf/eBPF/PSI) or host observability. A comprehensive platform has to fill those gaps itself.

### Cited Findings
- The roadmap.sh Linux roadmap is titled "Step by step guide to learning Linux in 2026". The rendered page did not expose its node text to the fetcher. — [roadmap.sh/linux](https://roadmap.sh/linux)
- The roadmap source now lives at `nilbuild/developer-roadmap` (formerly `kamranahmedse/developer-roadmap`; the GitHub API returns a "Moved Permanently" redirect). The Linux roadmap has about 100 topic files under `roadmaps/linux/content/`. — [GitHub repo](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/linux/content)
- Full Linux roadmap topic list, taken from the repo filenames and grouped here by their parent nodes. The parent nodes match roadmap.sh's visual order as far as can be told; the exact ordering JSON was not in the repo tree. — [GitHub repo](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/linux/content)
  - **Navigation basics:** basic-commands, command-help, directory-hierarchy-overview, moving-files/directories, creating/deleting files/dirs, copying-and-renaming, soft-links/hard-links
  - **Editing files:** vim, nano
  - **Shell and other basics:** command-path, environment-variables, super-user, redirects, stdout/stdin/stderr, pipe
  - **Working with files:** file-permissions, archiving-and-compressing
  - **Text processing:** grep, awk, cut, sort, uniq, tr, tee, head, tail, wc, nl, paste, join, split, expand, unexpand
  - **Server review:** uptime-and-load, available-memory/disk, authentication-logs, services-running
  - **Process management:** listing/finding processes, process-signals, killing-processes, process-priorities, background/foreground processes, process-forking
  - **User management:** users-and-groups, create/delete/update, managing-permissions
  - **Service management (systemd):** checking-service-status, starting/stopping-services, checking-service-logs, creating-new-services
  - **Package management:** package-repositories, finding/installing packages, listing-installed-packages, install/remove/upgrade, snap
  - **Disks and filesystems:** filesystems, inodes, mounts, adding-disks, swap, lvm
  - **Booting Linux:** boot-loaders, logs
  - **Networking:** tcpip-stack, subnetting, ethernet/arp/rarp, dhcp, ip-routing, dns-resolution, netfilter, ssh, file-transfer, icmp, ping, traceroute, netstat, packet-analysis
  - **Shell programming:** literals, variables, conditionals, loops, debugging
  - **Troubleshooting:** troubleshooting, ulimits
  - **Containerization:** cgroups, container-runtime, docker
- The roadmap's "Troubleshooting" node is shallow. It describes inspecting logs, processes and error messages, with `top` as the example tool, and links to beginner articles. — [roadmap.sh troubleshooting content](https://github.com/nilbuild/developer-roadmap/blob/master/roadmaps/linux/content/troubleshooting@rOGnHbGIr3xPCFdpkqoeK.md)
- Linux-related nodes in the roadmap.sh DevOps roadmap (from the repo filenames):
  - **Operating system:** ubuntu/debian, rhel/derivatives, suse-linux, freebsd/openbsd/netbsd, windows
  - **Terminal knowledge:** bash, power-shell, vim/nano/emacs, text-manipulation, process-monitoring, performance-monitoring, networking-tools
  - **Networking and protocols:** osi-model, dns, http/https, ssl/tls, ssh, ftp/sftp, smtp/imap/pop3s, spf/dmarc/domain-keys, firewall, load-balancer, reverse/forward-proxy, caching-server
  - **Web servers:** nginx, apache, caddy
  - **Containers:** docker, lxc
  - **Configuration management:** ansible, chef, puppet, salt
  - **Monitoring and logs:** prometheus, grafana, zabbix, datadog, elastic-stack, loki, graylog, splunk, papertrail, opentelemetry, jaeger

  — [GitHub repo devops content](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/devops/content)

### Inferences
- In roadmap.sh's DevOps roadmap, Linux sits early, as "learn an OS" plus "terminal knowledge", before networking, web servers, containers, IaC and config management. Lab paths should treat Linux foundations as a prerequisite for everything else on the platform.
- Topics missing from the roadmap.sh Linux roadmap that the platform should add: SELinux/AppArmor; auditd and journald depth; nftables/firewalld/ufw specifics; PAM/sudoers policy; ACLs; perf/eBPF/strace; PSI; cgroup v2 resource control; OOM analysis; namespaces/capabilities/seccomp; systemd timers and unit hardening; cloud-init; Ansible; bridges/VLANs/bonds/netns; WireGuard; time sync; kernel/sysctl tuning; boot recovery (rescue/emergency targets, initramfs).

### Gaps
- The exact node ordering and edge structure of the roadmap.sh Linux roadmap could not be retrieved (the page rendered no node text and no ordering JSON exists in the repo tree). The grouping above comes from content filenames and the known parent nodes.

---

## 2. Performance and troubleshooting canon

### Takeaway
The industry canon is Brendan Gregg's methodology: the USE method (Utilization, Saturation, Errors per resource), the 10-command "60-second" triage checklist, and drill-down tools (perf, bcc/bpftrace eBPF tools, strace). Modern kernels add PSI (`/proc/pressure/*` and per-cgroup `*.pressure`) and cgroup v2 `memory.events`/`memory.oom.group` for OOM analysis. This maps directly to beginner -> advanced lab tiers.

### Cited Findings
- USE method: "For every resource, check utilization, saturation, and errors." Utilization is time busy; saturation is queued work it can't yet service; errors is a count of error events. Resources: CPUs (sockets/cores/hardware threads), memory capacity, network interfaces, storage devices (I/O and capacity), controllers, interconnects. — [Brendan Gregg, USE Method](https://www.brendangregg.com/usemethod.html)
- The 60-second checklist (Netflix tech blog "Linux Performance Analysis in 60,000 Milliseconds", Brendan Gregg, 2015), in order: `uptime`, `dmesg | tail`, `vmstat 1`, `mpstat -P ALL 1`, `pidstat 1`, `iostat -xz 1`, `free -m`, `sar -n DEV 1`, `sar -n TCP,ETCP 1`, `top`. — [Thomas-Krenn wiki](https://www.thomas-krenn.com/en/wiki/Linux_performance_analysis_in_60_seconds); [makandra cards summary](https://makandracards.com/makandra/38007-linux-performance-analysis-in-60-000-milliseconds). The original Netflix Medium page returned 403 to the fetcher.
- What each step checks: load averages (uptime); recent kernel errors including OOM-killer events (dmesg); CPU usage (vmstat, mpstat), with mpstat showing per-CPU imbalance; rolling per-process view (pidstat); disk workload (iostat); memory (free); network throughput and TCP metrics including retransmits (sar); overall process view (top). The checklist helps complete part of the USE method and needs the sysstat package. — [makandra cards summary](https://makandracards.com/makandra/38007-linux-performance-analysis-in-60-000-milliseconds)
- Gregg's worked example of the checklist output (steady load, no dmesg errors, fine memory, low network, zero TCP retransmits, more than 90% user CPU on all CPUs) leads next to CPU profiling with Linux perf and flame graphs. This illustrates the triage -> drill-down progression. — [brendangregg.com 60s video post](https://www.brendangregg.com/blog/2015-12-03/linux-perf-60s-video.html)
- Gregg's Linux performance page sorts tools into observability, static performance analysis, benchmarking and tuning. It names perf, perf-tools (Ftrace), bcc, bpftrace and production use of strace. — [brendangregg.com/linuxperf](https://www.brendangregg.com/linuxperf.html)
- BCC is a toolkit for eBPF-based kernel tracing, with C kernel instrumentation and Python/Lua front-ends. Notable tools by area:
  - Processes and syscalls: execsnoop, opensnoop, syscount, killsnoop
  - Block I/O: biolatency, biosnoop, bitesize
  - Networking: tcpconnect, tcplife, tcpdrop, tcptop
  - CPU and scheduling: profile, offcputime, runqlat
  - Memory: memleak, oomkill
  - General: trace, funccount

  The repo also contains a `libbpf-tools` directory. — [iovisor/bcc](https://github.com/iovisor/bcc)
- PSI reports stall time on CPU, memory and I/O through `/proc/pressure/{cpu,memory,io}`, with 10/60/300-second averages plus a cumulative total in microseconds. `some` means at least one task is stalled; `full` means all non-idle tasks are stalled (thrashing). System-level CPU `full` is reported as zero (since 5.13). With cgroup2, each cgroup has `cpu.pressure`, `memory.pressure` and `io.pressure`. Triggers can be registered (e.g. `some 150000 1000000`) and polled with poll/epoll; windows run from 500ms to 10s. — [kernel.org PSI docs](https://docs.kernel.org/accounting/psi.html)
- cgroup v2 memory: exceeding `memory.high` throttles and never invokes the OOM killer, while reaching `memory.max` can trigger it. `memory.events` has counters (low, high, max, oom, oom_kill). `memory.oom.group` kills all tasks in the cgroup together, except those with oom_score_adj -1000. — [kernel.org cgroup-v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- Job-market signal: a 2025-26 Senior SRE (Compute Node) posting asks for kernel subsystems (scheduling, memory, filesystems, cgroups, namespaces) and lists perf, eBPF, ftrace, strace and kernel crash analysis as beneficial. — [Lever job posting](https://jobs.lever.co/jobgether/a7e5f63a-4d08-4ccd-a3b6-1a00408d2996)

### Inferences
- Suggested progression for a "Troubleshooting and Performance" path:
  - **Beginner:** top/htop, free, df/du, uptime and load averages, journalctl, dmesg, ps, kill.
  - **Intermediate:** the 60-second checklist and USE method; /proc (`/proc/<pid>/status`, `/proc/meminfo`, `/proc/loadavg`) and /sys; sar history; lsof and deleted-but-open files; strace/ltrace; ss; ulimits; OOM-killer log analysis.
  - **Advanced:** perf record/report and flame graphs; bcc/bpftrace one-liners (execsnoop, opensnoop, biolatency, runqlat, tcplife); PSI and per-cgroup pressure; cgroup v2 limits and `memory.events`; off-CPU analysis.
- Labs can be built to inject a specific fault (CPU hog, memory leak to OOM, I/O saturation, TCP retransmits, a file descriptor leak) and be graded on the learner identifying it with the USE method.
- [unverified, general knowledge] On RHEL, sysstat data collection is driven by systemd timers (sysstat-collect.timer). On Debian/Ubuntu, collection must be enabled in /etc/default/sysstat.

### Gaps
- The original Netflix article text could not be fetched (403); command order was confirmed through two secondary reproductions.
- No source fetched on bpftrace specifics or on libbpf-tools/CO-RE versus BCC Python tools. Distro packaging (bpfcc-tools on Debian/Ubuntu vs bcc-tools on RHEL) is unverified.

---

## 3. Observability on Linux hosts

### Takeaway
Host observability skills centre on journald and rsyslog (including how they interact), logrotate, auditd, and metrics exporters. CIS v2.0.0 for RHEL 9 makes journald vs rsyslog an explicit either/or choice, which makes a good intermediate lab topic.

### Cited Findings
- CIS RHEL 9 v2.0.0 restructured logging into mutually exclusive journald and rsyslog paths. A default RHEL 9 install runs both, so the rule `ensure_journald_and_rsyslog_not_active_together` fails. Sections 6.2.2 (journald) and 6.2.3 (rsyslog) conflict on ForwardToSyslog. The SCAP Security Guide CIS profiles default to journald. — [Red Hat KB 7146814](https://access.redhat.com/articles/7146814)
- Newer CIS RHEL 9 audit content includes collecting events that modify user/group information (auditd). — [BigFix forum post](https://forum.bigfix.com/t/bigfix-compliance-updated-cis-red-hat-enterprise-linux-9-with-bugfixes-published-2026-04-22/54378)
- Linux Upskill Challenge Day 18 covers "Logs, monitoring and troubleshooting (logrotate)". — [linuxupskillchallenge.org](https://linuxupskillchallenge.org/)
- SadServers has scenarios on a systemd log cleaner that "runs but deletes nothing" (Valladolid) and a Prometheus server unable to scrape a Go app's /metrics (Warsaw). Host observability is tested in "fix it" form. — [SadServers scenarios](https://sadservers.com/scenarios)
- The roadmap.sh DevOps roadmap lists prometheus, grafana, loki, elastic-stack, opentelemetry and others under monitoring/logs. — [GitHub repo devops content](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/devops/content)

### Inferences
- Suggested progression:
  - **Beginner:** journalctl filters (-u, -b, -p, --since, -f), /var/log layout, auth logs.
  - **Intermediate:** persistent journal (Storage=persistent, SystemMaxUse), rsyslog forwarding, logrotate config and copytruncate vs create, auditd rules (`auditctl`, `ausearch`, `aureport`, watch /etc/passwd).
  - **Advanced:** node_exporter, including the textfile collector, PSI and systemd collectors; Prometheus scraping and alert rules; centralised logging pipelines (journald to Loki/Fluent Bit/Vector); OpenTelemetry collector host metrics.
- Distro differences [unverified, general knowledge]: Debian/Ubuntu write /var/log/auth.log and /var/log/syslog through rsyslog. RHEL writes /var/log/secure and /var/log/messages. Debian 12+ no longer installs rsyslog by default, so it relies on journald.

### Gaps
- No primary source fetched for node_exporter collectors, the auditd rule set (e.g. the STIG audit rules), or journald.conf details. These are well known, but not cited here.

---

## 4. Security hardening

### Takeaway
Hardening paths should follow the CIS Benchmark section structure. The latest benchmarks (Ubuntu 24.04 v1.0.0, RHEL 9 v2.0.0) have seven sections, including a dedicated Host-Based Firewall section, though sources disagree on numbering. DISA STIG (CAT I/II/III), FIPS mode, SSH crypto, AIDE and auditd add on top. OpenSCAP plus scap-security-guide is the practical tooling to scan and remediate (bash/Ansible), which suits lab autograding.

### Cited Findings
- Section structure, with conflicting reports:
  - A blog (Mar 2026) lists 6 CIS sections: 1 Initial Setup, 2 Services, 3 Network, 4 Logging and Auditing, 5 Access Control, 6 System Maintenance. — [oneuptime CIS Ubuntu audit](https://oneuptime.com/blog/post/2026-03-02-how-to-run-cis-benchmark-audits-on-ubuntu/view)
  - Tenable's audit release for CIS Ubuntu 24.04 v1.0.0 names "1.5 Configure Additional Process Hardening", "2 Services", "5.1 Configure SSH Server" and "6 Logging and Auditing". — [Tenable forum](https://connect.tenable.com/discussions/tenable-research-release-highlights/new-cis-ubuntu-linux-24-04-lts-benchmark-v1-0-0-audits-/108876)
  - An Ansible/Goss audit repo for Ubuntu 24 CIS has section_1 through section_7. — [UBUNTU24-CIS-Audit](https://git.nixc.us/colin/UBUNTU24-CIS-Audit/src/commit/8b1590b79fe64397df15a5072497acc9513ff078)
  - The Red Hat KB places journald/rsyslog under 6.2.x for RHEL 9 v2.0.0. — [Red Hat KB](https://access.redhat.com/articles/7146814)

  Taken together, the current benchmarks are most likely 1 Initial Setup, 2 Services, 3 Network, 4 Host-Based Firewall, 5 Access Control (SSH, PAM, sudo, users), 6 Logging and Auditing, 7 System Maintenance (file permissions, users/groups). This is not confirmed against the CIS PDF.
- CIS RHEL 9 v2.0.0 profiles are Level 1/Level 2 for Server and Workstation. Changes touched the kernel module, service, SSH and PAM sections. — [Tenable CIS v2.0.0](https://connect.tenable.com/discussions/tenable-research-release-highlights/new-cis-linux-v2-0-0-benchmark-audits-summary-customers-can-/108862); [CIS RHEL benchmark page](https://www.cisecurity.org/benchmark/red_hat_linux)
- A newer CIS RHEL 9 check is "ensure nftables is installed". — [BigFix forum](https://forum.bigfix.com/t/bigfix-compliance-updated-cis-red-hat-enterprise-linux-9-with-bugfixes-published-2026-04-22/54378)
- DISA STIG severity: CAT I is high and directly exploitable; CAT II is medium; CAT III is low. FIPS mode is treated as a CAT I item. STIG SSH requirements include FIPS-validated ciphers/MACs, no root login, no empty passwords, and no host-based authentication. Common default-install findings include auditd not configured and AIDE missing. Scanning uses `oscap xccdf eval` with the scap-security-guide STIG profile, and remediation can be generated as bash or Ansible. — [oneuptime STIG/OpenSCAP how-to (blog; secondary)](https://oneuptime.com/blog/post/2026-03-04-scan-rhel-9-stig-compliance-openscap/markdown); [Red Hat RHEL 9 security considerations](https://red.ht/rhel-9-security-considerations)
- The RHEL 9 DISA STIG profile in scap-security-guide is at V2R9, and the rule `crypto_policy_not_overridden` was added. — [Red Hat SSG release notes](https://access.redhat.com/articles/7047972)
- On RHEL, firewalld has been the default since RHEL 7 and nftables the default packet-filter framework since RHEL 8 (replacing iptables). Red Hat advises running only one firewall service. — [Red Hat docs: configuring firewalls](https://docs.redhat.com/fr/documentation/red_hat_enterprise_linux/9/epub/configuring_firewalls_and_packet_filters/index); [Red Hat KB 7046655](https://access.redhat.com/solutions/7046655)
- Security-flavoured hands-on scenarios in SadServers:
  - Fix: "Malicious liblzma loaded by running processes" (Tukaani, an xz backdoor-style scenario); "LAMP stack broken by security changes" (Marseille).
  - Hack: "Escalate privileges via limited sudo" (La Rinconada); "Exploit a root cron job" (Amsterdam).

  — [SadServers scenarios](https://sadservers.com/scenarios)

### Inferences
- Suggested progression for a "Security Hardening" path:
  - **Beginner:** users/groups, chmod/chown/umask, sudo basics, SSH keys, ufw/firewalld basics, automatic updates.
  - **Intermediate:** sudoers policy (Cmnd_Alias, NOPASSWD risks, `visudo`, /etc/sudoers.d); SSH hardening (PermitRootLogin, PasswordAuthentication, AllowGroups, crypto); PAM (pwquality, faillock); POSIX ACLs (setfacl/getfacl); SUID/SGID audit; auditd; AIDE; kernel sysctls (kernel.kptr_restrict, kernel.dmesg_restrict, kernel.yama.ptrace_scope, net.ipv4 rp_filter, accept_redirects, unprivileged_bpf_disabled); disabling unused kernel modules (cramfs, usb-storage).
  - **Advanced:** SELinux on the RHEL family (modes, contexts, `restorecon`, booleans, `audit2why`/`audit2allow`, semanage port) and AppArmor on Ubuntu/Debian/SUSE (aa-status, complain/enforce); nftables rulesets from scratch; Lynis and OpenSCAP scan-remediate-rescan; crypto policies (RHEL `update-crypto-policies`); FIPS; Secure Boot/mokutil and signed kernel modules; fapolicyd (RHEL); systemd unit sandboxing (ProtectSystem, NoNewPrivileges, `systemd-analyze security`).
- Lab grading can reuse OpenSCAP/Lynis scores or CIS audit scripts (Goss/Ansible) as objective checks.
- [unverified, general knowledge] SELinux is enforcing by default on RHEL/Fedora/Alma/Rocky. AppArmor is enabled by default on Ubuntu and Debian (since 10). ufw ships on Ubuntu but is inactive by default; ufw uses iptables-nft on recent releases.

### Gaps
- The CIS PDF table of contents was not directly verified (registration-gated). Official section numbering for Ubuntu 24.04 v1.0.0 and RHEL 9 v2.0.0 remains inferred.
- No primary source fetched on Lynis, Secure Boot, AIDE configuration or kernel hardening sysctl lists (e.g. KSPP recommended settings).

---

## 5. Containers internals expected of platform engineers

### Takeaway
Platform and SRE roles expect working knowledge of namespaces (8 types), cgroup v2 (unified hierarchy, controllers, delegation), and the systemd and Kubernetes move to cgroup v2 only. systemd 258 removed cgroup v1, and Kubernetes has a KEP to remove v1 support. A lab track should build a container by hand (unshare/nsenter, cgroup files, overlay mounts) before Docker/Podman.

### Cited Findings
- The eight namespace types and their clone flags: Cgroup (CLONE_NEWCGROUP), IPC (CLONE_NEWIPC), Network (CLONE_NEWNET), Mount (CLONE_NEWNS), PID (CLONE_NEWPID), Time (CLONE_NEWTIME), User (CLONE_NEWUSER), UTS (CLONE_NEWUTS). — [man7 namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- `/proc/pid/ns/*` entries appeared at different kernel versions: uts/ipc/net in 3.0, mnt/pid/user in 3.8, cgroup in 4.6, time in 5.6. Unprivileged user namespace creation has been possible since 3.8. Namespaces are joined with setns(2) and created with unshare(2); nsenter(1) is the related CLI. — [man7 namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- cgroup v2 core concepts:
  - single unified hierarchy (`mount -t cgroup2`)
  - "no internal process" constraint
  - top-down controller enablement via `cgroup.subtree_control`
  - controllers and their interface files:
    - cpu: `cpu.weight`, `cpu.max` (default "max 100000")
    - memory: `memory.min`, `memory.low`, `memory.high`, `memory.max`
    - io: `io.max`, `io.weight`
    - pids: `pids.max`
    - cpuset
  - delegation to unprivileged users via write access to `cgroup.procs`, `cgroup.threads` and `cgroup.subtree_control`, or the `nsdelegate` mount option

  — [kernel.org cgroup-v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- systemd started phasing out cgroup v1 in v256, treated v1 as obsolete in v257, and removed legacy/hybrid hierarchy support in v258, where cgroup v2 is always mounted. v258 also raised the kernel baseline to 5.4 (5.7 recommended) and deprecated SysV init scripts for removal in v259. — [linuxiac](https://linuxiac.com/systemd-258-drops-cgroup-v1-raises-kernel-baseline-to-5-4/); [newreleases v258-rc3](https://newreleases.io/project/github/systemd/systemd/release/v258-rc3)
- Kubernetes KEP-5573 proposes removing cgroup v1 support. — [KEP-5573](https://kubernetes.dev/resources/keps/5573)
- SadServers has container-internals scenarios: "cgroup v2 memory limit not applied" (Genova), "Determine whether you are in a container" (Venice), "Start a container from inside another container" (Quito), "Migrate Docker container to rootless Podman with systemd" (Podgorica) and "Kubernetes memory config with swap disabled" (Kilifi). — [SadServers scenarios](https://sadservers.com/scenarios)
- The roadmap.sh Linux roadmap's containerization section covers only cgroups, container-runtime and docker. — [GitHub repo](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/linux/content)
- Job postings for compute-node SRE roles name cgroups, namespaces and resource isolation as core requirements. — [Lever posting](https://jobs.lever.co/jobgether/a7e5f63a-4d08-4ccd-a3b6-1a00408d2996)

### Inferences
- Suggested progression for a "Containers Internals" path:
  - **Beginner:** run containers with podman/docker, inspect /proc/<pid>/ns, `lsns`.
  - **Intermediate:** `unshare --pid --fork --mount-proc`, `nsenter` into a container; a manual cgroup v2 hierarchy (mkdir, `memory.max`, triggering an OOM and reading `memory.events`); `systemd-run --scope -p MemoryMax=`; overlayfs mounts by hand (lowerdir/upperdir/workdir).
  - **Advanced:** capabilities (`capsh`, `getpcaps`, dropping CAP_NET_RAW); seccomp profiles; user namespaces and rootless containers (subuid/subgid, slirp4netns/pasta); OCI runtime bundles with runc/crun (`runc spec`, config.json); buildah image builds; Podman Quadlet/systemd integration; container escape scenarios (privileged containers, docker.sock mounts).
- [unverified, general knowledge] crun is the default OCI runtime for Podman on RHEL 9/Fedora, while Docker/containerd default to runc. Podman 5 uses pasta as the default rootless network on Fedora/RHEL 10.

### Gaps
- No primary source fetched for capabilities(7), seccomp, overlayfs, OCI runtime-spec, rootless containers, or Podman/Buildah. The man7 capabilities(7) and seccomp(2) pages and the OCI runtime-spec are the recommended citations.

---

## 6. Automation: shell scripting, systemd timers vs cron, Ansible, cloud-init

### Takeaway
Community curricula treat scripting and scheduling (cron, at, systemd timers) as core sysadmin content. DevOps roadmaps add Ansible/config management. Hands-on platforms test these through "silent cron failure" and "timer not running" fix scenarios.

### Cited Findings
- Linux Upskill Challenge Day 10 covers "Scheduling tasks (cron, at, systemd timers)" and Day 20 covers "Scripting". — [linuxupskillchallenge.org](https://linuxupskillchallenge.org/)
- The roadmap.sh Linux roadmap's shell programming nodes are literals, variables, conditionals, loops and debugging. — [GitHub repo](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/linux/content)
- The roadmap.sh DevOps roadmap lists configuration management tools: ansible, chef, puppet, salt. — [GitHub repo devops content](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/devops/content)
- SadServers automation-failure scenarios: "systemd timer not running a health check" (Cairo), "Silent failure of a backup cron job" (Alexandria), "systemd log cleaner runs but deletes nothing" (Valladolid), "Scripts failing due to line endings" (Kampala), "Create users with passwords from a list" (Budapest), and text-processing tasks such as "Split a CSV into 10 files with headers" (Minneapolis). — [SadServers scenarios](https://sadservers.com/scenarios)
- systemd 258 deprecates SysV init script support, which is scheduled for removal in v259. — [linuxiac](https://linuxiac.com/systemd-258-drops-cgroup-v1-raises-kernel-baseline-to-5-4/)
- Red Hat's STIG tooling can generate Ansible remediation from OpenSCAP results, which links automation to compliance. — [oneuptime STIG Ansible](https://oneuptime.com/blog/post/2026-03-04-apply-disa-stig-controls-ansible-rhel-9/markdown)

### Inferences
- Suggested progression:
  - **Beginner:** variables, quoting, loops, exit codes, pipes; cron syntax.
  - **Intermediate** [unverified, general knowledge for the specifics]: bash strict mode (`set -euo pipefail`, IFS) and its pitfalls; `trap` cleanup; shellcheck linting; getopts; idempotent scripts; systemd timers (OnCalendar, Persistent=, RandomizedDelaySec, `systemctl list-timers`, `systemd-analyze calendar`) versus cron (no logging or dependency handling by default, environment differences being the main source of "silent cron failures").
  - **Advanced:** Ansible inventories, playbooks, roles, idempotency and `--check --diff`; cloud-init user-data (users, packages, write_files, runcmd), debugged through `cloud-init status --long` and /var/log/cloud-init*.log; templated unit files.
- cloud-init is especially relevant for a vCenter + KubeVirt lab platform, because KubeVirt VMs commonly use cloudInitNoCloud. It can serve both as the lab provisioning mechanism and as a learning topic.

### Gaps
- No primary source fetched on shellcheck, bash strict mode guidance, systemd.timer(5), Ansible docs or cloud-init docs.

---

## 7. Networking for Linux admins

### Takeaway
Linux networking for admins now means iproute2 (`ip`, `ss`), distro-specific config layers (netplan rendering to systemd-networkd/NetworkManager on Ubuntu; NetworkManager keyfiles on RHEL 9), nftables-backed firewalls, and the DNS resolver stack. Fix-it labs commonly cover DNS, port conflicts, reverse-proxy wiring and TLS.

### Cited Findings
- roadmap.sh Linux networking nodes: tcpip-stack, subnetting, ethernet/arp/rarp, dhcp, ip-routing, dns-resolution, netfilter, ssh, file-transfer, icmp, ping, traceroute, netstat, packet-analysis. — [GitHub repo](https://github.com/nilbuild/developer-roadmap/tree/master/roadmaps/linux/content)
- Ubuntu: Netplan YAML in /etc/netplan/ generates config for either systemd-networkd or NetworkManager. When NetworkManager is installed, it sets itself as the default renderer. — [matrixpost netplan guide](https://blog.matrixpost.net/mastering-netplan-modern-network-configuration-on-ubuntu/)
- RHEL 9: NetworkManager is standard. New profiles are stored as keyfiles in /etc/NetworkManager/system-connections/ rather than ifcfg. firewalld is the default firewall, on the nftables framework. — [matrixpost](https://blog.matrixpost.net/?p=109237); [Red Hat docs](https://docs.redhat.com/fr/documentation/red_hat_enterprise_linux/9/epub/configuring_firewalls_and_packet_filters/index)
- Linux Upskill Challenge Day 9 is "Diving into networking (ss, nmap, ufw)". — [linuxupskillchallenge.org](https://linuxupskillchallenge.org/)
- SadServers networking scenarios include:
  - port knocking (Taipei)
  - "Port audit without common network tools" (Porto)
  - port 80 to 20280 forwarding (Kampot)
  - app port conflict (Bergen)
  - "Knot DNS zone not resolving" (Sumé)
  - "Service blocked by a DNS health check" (Stockholm)
  - "LAMP stack network connectivity broken" (Toulon)
  - Nginx-to-Gunicorn Unix socket (Melbourne)
  - Caddy not responding on 127.0.0.1 (Nerdearla)
  - HAProxy/Envoy/Traefik load-balancing faults

  — [SadServers scenarios](https://sadservers.com/scenarios)
- The network namespace (CLONE_NEWNET) is one of the eight namespace types and underpins container networking. — [man7 namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)

### Inferences
- Suggested progression:
  - **Beginner:** `ip a`/`ip r`, ping, traceroute/tracepath, `ss -tulpn`, `/etc/hosts`, `dig`/`host`, curl, ssh.
  - **Intermediate:** persistent config with netplan (Ubuntu) vs nmcli/keyfiles (RHEL); DNS resolution stack (nsswitch.conf -> systemd-resolved stub 127.0.0.53 / `resolvectl` on Ubuntu, vs NetworkManager-managed /etc/resolv.conf on RHEL); firewalld zones and ufw rules; tcpdump filters; MTU problems; static routes.
  - **Advanced:** policy routing (`ip rule`, multiple tables); Linux bridges, VLAN subinterfaces and bonds/teams (modes, LACP); network namespaces plus veth pairs (building "container networking by hand"); nftables tables/chains/sets and NAT; conntrack; WireGuard (`wg`, wg-quick, keyfile in NM); sysctl net tuning; `ethtool`; a tcpdump + `ss -i` retransmit analysis tied to the 60s checklist's `sar -n TCP,ETCP`.
  - All [unverified, general knowledge] for specifics such as systemd-resolved defaults.
- The bridges/VLANs/bonds content maps naturally onto vCenter port groups and KubeVirt multus/bridge networking on this platform.

### Gaps
- No primary source fetched for systemd-resolved/nsswitch behaviour, WireGuard, policy routing, or bonding docs (kernel.org bonding.rst and the systemd-resolved(8) man page are the recommended citations). Ubuntu ufw defaults and backend are not confirmed.

---

## 8. Practical-lab collections and scenario styles

### Takeaway
Four styles dominate:
1. **"Fix the broken server"** (SadServers): a time-boxed VM with a `check.sh` grader.
2. **Guided daily curriculum on your own server** (Linux Upskill Challenge).
3. **Progressive wargame/CTF levels** (OverTheWire Bandit).
4. **Browser-based interactive scenarios** (Killercoda), community-authored.

SadServers' Fix/Do/Hack taxonomy with automated checks is the closest model for an enterprise lab platform.

### Cited Findings
- SadServers format: each scenario has a name, a level (Easy/Medium, plus harder tiers), a type (Fix = repair a broken system, Do = complete a task, Hack = CTF-style), access tier (Public/Email/Paid/Business), a description, a test (often a `check.sh` run via "Check My Solution"; some have none) and a time to solve of 10-60 minutes. — [SadServers scenarios](https://sadservers.com/scenarios)
- SadServers has about 33 Easy and more than 63 Medium scenarios. Topics span:
  - logs filling disk (Saint John)
  - deleted-but-open files holding space (Cordoba, Oaxaca)
  - disk space (Kihei)
  - expired TLS certs (Geneva)
  - permissions (Yokohama, Kortenberg)
  - SSH key failures (Nuuk)
  - systemd service failing (Rio de Janeiro)
  - named pipes (Tokamachi)
  - /proc/sys exploration (Bata)
  - finding files without ls (Nara)
  - "Missing commands on a minimal distro" (Bermuda)
  - databases (Postgres, MySQL restore, Redis replication, MongoDB replica set)
  - Docker/Podman image size and builds
  - Kubernetes pod crashloops and Helm
  - Vault PKI cert renewal
  - git bisect (Gitega)
  - a "Linux Server Review" guided scenario

  — [SadServers scenarios](https://sadservers.com/scenarios)
- Linux Upskill Challenge: a free, open-source, month-long course of 1-2 hours a day. It is server-focused and command-line based, uses your own Internet-exposed server, and restarts on the first Monday of each month. Lessons run Day 0 to Day 20:
  - Day 0: create a server
  - Day 1: get to know your server
  - Day 2: navigation
  - Day 3: sudo/hostname/timezone
  - Day 4: packages and file structure
  - Day 5: less, dotfiles, history, nano
  - Day 6: vim
  - Day 7: services (Apache2)
  - Day 8: grep and text processors
  - Day 9: networking (ss, nmap, ufw)
  - Day 10: scheduling (cron, at, systemd timers)
  - Day 11: finding things
  - Day 12: SFTP
  - Day 13: users and groups
  - Day 14: permissions
  - Day 15: repositories
  - Day 16: tar/gzip
  - Day 17: build from source
  - Day 18: logs/monitoring/logrotate
  - Day 19: inodes and links
  - Day 20: scripting

  — [linuxupskillchallenge.org](https://linuxupskillchallenge.org/)
- OverTheWire Bandit: a beginner wargame of levels starting at Level 0, where each level page explains how to reach the next and you connect over SSH. It encourages `man`, `help` for builtins, and searching. — [overthewire.org Bandit](https://overthewire.org/wargames/bandit/). A third-party source adds that you connect on port 2220 and practise ls, cat, find, grep, ssh, permissions and decompression. — [WSU poster](https://wpcdn.web.wsu.edu/wp-vcea/uploads/sites/3267/2025/05/poster_WSU_YoungbloodWhite.pdf)
- Killercoda's Linux area offers browser-based "Learn Linux in Your Browser" scenarios from community authors, e.g. "linuxFundamentals" (Pawel Piwosz) and "Linux" (Alexis Carbillet, framed as exam prep plus real-world skills). — [killercoda.com/linux](https://killercoda.com/linux)

### Inferences
- Scenario taxonomy for the platform (adapted from SadServers): **Fix** (break-fix incident), **Do** (task completion), **Hack** (security/CTF), plus a **Learn** (guided, Upskill-style) type. Each scenario should carry a time box, difficulty, distro, auto-check script, and skill-graph node tags.
- Recurring "broken server" fault archetypes worth templating:
  - disk full: big log, deleted-open file, inode exhaustion
  - permissions/ACL mistakes
  - systemd unit failures (bad ExecStart, missing user, dependency)
  - timer/cron silent failures (env/PATH)
  - port conflicts and bind address
  - DNS misconfiguration
  - firewall blocking
  - expired TLS
  - SELinux denials (RHEL)
  - cgroup/OOM limits
  - CRLF line endings
  - missing binaries on minimal images
  - SSH key/permission issues
  - compromised library / persistence (security)
- Distro coverage should be explicit: SadServers is largely Debian-based. Enterprise users will need RHEL-family variants, especially for SELinux, firewalld and NetworkManager keyfiles.

### Gaps
- The SadServers list was truncated at about 100k characters; Hard/Expert tiers, if any, were not read. SadServers' distro base was not confirmed from source.
- Killercoda's scenario counts and content details were not exposed on the landing page.
- No source fetched for other collections often cited (e.g. KodeKloud, Linux Journey, iximiuz Labs for container internals, LabEx). These are worth checking if the report needs breadth.
