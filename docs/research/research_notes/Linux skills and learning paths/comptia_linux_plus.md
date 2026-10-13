# CompTIA Linux+ Exam Objectives: XK0-005 (V7) and XK0-006 (V8)

Source notes. Both official objectives PDFs were downloaded from CompTIA's asset CDN (the same host CompTIA's site links for objective downloads) and text-extracted:
- XK0-006 V8 objectives PDF, "Exam Objectives Document Version 3.0", (c) 2024: https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85 (cited below as [XK0-006 PDF])
- XK0-005 objectives PDF, (c) 2021: https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652 (cited below as [XK0-005 PDF])
- CompTIA Linux+ product page: https://www.comptia.org/en-us/certifications/linux/ (cited as [CompTIA page])

The objectives below are paraphrased and condensed. Topic lists keep command and tool names because those are the skill-graph nodes. Some objective numbers were reconstructed from page-footer markers in the extracted PDF text. They were cross-checked against the domain summaries on the CompTIA page and against the count of 29 objectives given by Training Camp (details under XK0-006 Gaps).

## XK0-005: domains, weights and objectives

### Takeaway
XK0-005 had 4 domains and 20 objectives: System Management 32%, Security 21%, Scripting/Containers/Automation 19%, Troubleshooting 28%. It was broad, tool-heavy and distro-neutral. It covered both RPM and Debian toolchains, SELinux and AppArmor, and named several IaC tools (Ansible, Puppet, Chef, SaltStack, Terraform) only at a conceptual level.

### Cited Findings
- Exam format: at most 90 questions, multiple-choice plus performance-based, 90 minutes, pass mark 720 on a 100-900 scale. Recommended experience is 12 months hands-on with Linux servers plus A+/Network+/Server+-level knowledge. Target roles are junior Linux support engineer and junior cloud/DevOps support engineer, in on-prem and cloud server environments. — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- Domain weights: 1.0 System Management 32%; 2.0 Security 21%; 3.0 Scripting, Containers, and Automation 19%; 4.0 Troubleshooting 28%. — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- Release date: one study-notes source gives July 12, 2022 (secondary source, not confirmed on comptia.org). — via search summary of [simeononsecurity](https://simeononsecurity.com/cyber-security-career-playbook/cyber-security-certifications-degrees-and-certificates/certifications/passing-comptias-linux-plus-xk0-005/)

**Domain 1.0 System Management (32%)** — all from [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- 1.1 Linux fundamentals (summarize): FHS directories (/boot, /proc, /sys, /var, /usr, /lib, /dev, /etc, /opt, /bin, /sbin, /home, /media, /mnt, /root, /tmp). Boot process: BIOS/UEFI, GRUB2, grub2-install/grub2-mkconfig/grub2-update, mkinitrd/dracut, initrd.img, vmlinuz; boot sources (PXE, USB, ISO); kernel panic. /dev device types (block, character, special: /dev/null, /dev/zero, /dev/urandom). Compiling from source (./configure, make, make install). Storage concepts: file, block and object storage; MBR vs GPT; FUSE; RAID striping/mirroring/parity. Hardware listing with lspci, lsusb, dmidecode.
- 1.2 Manage files and directories (scenario): editing with sed, awk, printf, nano, vi(m); compression, archiving and backup with gzip, bzip2, zip, tar, xz, cpio, dd; metadata via stat and file; soft vs hard links; copying between hosts with rsync, scp, nc; core file operations (mv, cp, mkdir, rmdir, ls, pwd, rm, cd, ., .., ~, tree, cat, touch).
- 1.3 Configure and manage storage (scenario): partitioning (fdisk, parted, partprobe); mounting local and remote devices (systemd.mount, /etc/fstab, mount, LUKS, external devices); XFS/ext4/Btrfs tools; df and du; LVM (pvs, vgs, lvs, pvcreate, vgcreate, vgextend, lvcreate, lvchange, lvresize); RAID inspection (mdadm, /proc/mdstat); SAN/NAS (multipathd, NFS, SMB/CIFS); storage hardware tools (lsscsi, lsblk, blkid, fcstat).
- 1.4 Processes and services (scenario): systemctl start/stop/restart/status/enable/disable/mask; scheduling with cron, crontab, at; signals (SIGTERM, SIGKILL, SIGHUP); listing processes and open files (top, ps, lsof, htop); nice and renice; process states (zombie, sleeping, running, stopped); job control (bg, fg, jobs, Ctrl+Z/C/D); pgrep, pkill, pidof.
- 1.5 Networking tools and config files (scenario): iproute2 (ip, ss); NetworkManager (nmcli); legacy net-tools (ifconfig, ifcfg, hostname, arp, route, /etc/sysconfig/network-scripts); name resolution (nsswitch, /etc/resolv.conf, hostnamectl, resolvectl, dig, nslookup, host, WHOIS); monitoring (tcpdump, wireshark/tshark, netstat, traceroute, ping, mtr); remote tools (SSH, cURL, wget, nc, rsync, SCP, SFTP).
- 1.6 Build and install software (scenario): package managers DNF, YUM, APT, RPM, dpkg, ZYpp; sandboxed apps (snapd, Flatpak, AppImage); kernel and package updates.
- 1.7 Manage software configurations (scenario): restart vs reload after config changes; .rpmnew/.rpmsave; repository config (/etc/apt.conf, /etc/yum.conf, /etc/dnf/dnf.conf, /etc/yum.repos.d, /etc/apt/sources.list.d); kernel parameters (sysctl, /etc/sysctl.conf); modules (lsmod, rmmod, insmod, modprobe, modinfo); common services (SSH, NTP, syslog, chrony); localization (timedatectl, localectl).

**Domain 2.0 Security (21%)** — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- 2.1 Security best practices (summarize): PKI (public/private keys, self-signed and wildcard certificates, digital signatures, hashing, CAs); certificate uses (SSL/TLS, cert-based auth, encryption); authentication (tokens, MFA, PAM, SSSD, LDAP, SSO); hardening (security scanning, UEFI secure boot, logging config, default umask, removing insecure services and unused packages, password strength, kernel parameter tuning, securing service accounts, host firewall).
- 2.2 Identity management (scenario): useradd, groupadd, userdel, groupdel, usermod, groupmod, id, who, w; default shell; /etc/passwd, /etc/group, /etc/shadow, /etc/profile, /etc/skel, .bash_profile, .bashrc; passwd, chage, pam_tally2, faillock, /etc/login.defs.
- 2.3 Firewalls (scenario): opening and closing ports, checking config, enabling/disabling IP forwarding; firewalld, iptables, nftables, UFW; zones, services, stateful vs stateless.
- 2.4 Remote connectivity for management (scenario): SSH config files (sshd_config, ssh_config, known_hosts, authorized_keys, ~/.ssh/config); ssh-keygen, ssh-copy-id, ssh-add; X11, port and dynamic forwarding; running commands as another user (/etc/sudoers, PolicyKit rules, sudo, visudo, su -, pkexec).
- 2.5 Access controls (scenario): ACLs, SUID, SGID, sticky bit; SELinux (contexts, labels, autorelabel, booleans, enforcing/permissive/disabled states, targeted/minimum policies); AppArmor; utilities chown, umask, chmod, getfacl/setfacl, ls, setenforce/getenforce, chattr/lsattr, chgrp, setsebool/getsebool, chcon, restorecon, semanage, audit2allow.

**Domain 3.0 Scripting, Containers, and Automation (19%)** — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- 3.1 Simple shell scripts (scenario): loops (while, for, until); if and case; parameter expansion, globbing, brace expansion; arithmetic, string and boolean comparisons; variables; search and replace; regex; redirection (|, >, >>, <, <<, &, &&, stderr/stdout); here documents; exit codes; built-ins (read, echo, source); utilities awk, sed, find, xargs, grep, egrep, tee, wc, cut, tr, head, tail; $PATH, $SHELL, $?; relative vs absolute paths.
- 3.2 Basic container operations (scenario): start/stop, inspect, list, deploy existing images, connect, logs, expose ports; image build, push, pull, list, rmi.
- 3.3 Basic Git (scenario): clone, push, pull, commit, add, checkout, branch, tag, .gitignore.
- 3.4 IaC technologies (summarize): YAML and JSON; Ansible, Puppet, Chef, SaltStack, Terraform; CI/CD use cases; advanced Git (merge, rebase, pull requests).
- 3.5 Container, cloud and orchestration concepts (summarize): Kubernetes benefits (pods, sidecars, ambassador containers); single-node multi-container with Compose; persistent storage; container networks (overlay, bridge, NAT, host); service mesh; bootstrapping with cloud-init; container registries.

**Domain 4.0 Troubleshooting (28%)** — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- 4.1 Storage issues: latency and I/O wait, low throughput, IOPS; low disk space and inode exhaustion; corruption and mismatch; I/O scheduler; NVMe, SSD and trim, RAID, LVM, I/O errors; mount option problems.
- 4.2 Network resource issues: subnet and routing misconfiguration; firewall; interface errors (dropped packets, collisions, link status); bandwidth and latency; DNS; testing remote systems with nmap and openssl s_client.
- 4.3 CPU and memory issues: runaway and zombie processes; high CPU, load average and run queues; CPU time types (steal, user, system, idle, iowait); nice/renice; memory exhaustion (free memory vs file cache), OOM killer, memory leaks, swapping; lscpu, lsmem, /proc/cpuinfo, /proc/meminfo.
- 4.4 User access and file permissions: login and file access issues (group, context, permission, ACL, attribute, policy); password issues; privilege elevation; quotas.
- 4.5 systemd diagnosis: unit files. Service units: ExecStart/ExecStop, Before/After, Type, User, Requires/Wants. Timer units: OnCalendar, OnBootSec, time expressions. Mount units: naming, What/Where/Type/Options. Targets: default, multi-user, network-online, graphical. Common problems: name resolution, application crashes, timezone, boot, journal, services not starting on time.

**XK0-005 hardware/software list:** a VM- or cloud-capable machine, router/switch/AP, repo access, SSH client, Ansible/Puppet, Git, virtualization software, Docker or Podman. Recommended distros: Ubuntu, Fedora, Debian, openSUSE, RHEL. — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)

### Inferences
- XK0-005 tested Kubernetes, service mesh and IaC tools as concepts. Hands-on scope was mostly shell, Git basics and single-host container operations.
- Systemd unit authoring (service, timer and mount units) sat under Troubleshooting (4.5), not under service management.

### Gaps
- I did not confirm the XK0-005 launch date (July 2022) on comptia.org. It comes from a secondary source.

## XK0-006: dates, domains, weights, objectives and changes

### Takeaway
XK0-006 (Linux+ V8) launched July 15, 2025. XK0-005 retired in English on January 13, 2026. The new exam has 5 domains and 29 objectives: System Management 23%, Services and User Management 20%, Security 18%, Automation/Orchestration/Scripting 17%, Troubleshooting 22%. The main additions are a full automation domain (Ansible, Puppet, OpenTofu, Kubernetes, Swarm, Compose, CI/CD and GitOps), Python, an objective on responsible AI use, KVM/QEMU/libvirt virtualization, monitoring and SLOs, and compliance tooling (OpenSCAP, CIS, AIDE).

### Cited Findings
**Dates and format**
- Launch date July 15, 2025. Format: at most 90 questions, multiple-choice and performance-based, 90 minutes, pass mark 720/900, English only. The page estimates retirement at about three years after launch (around 2028). — [CompTIA page](https://www.comptia.org/en-us/certifications/linux/)
- XK0-005 retired January 13, 2026. — [Training Camp](https://trainingcamp.com/articles/comptia-linux-xk0-006-exam-guide-domains-pbqs-and-a-study-approach-that-actually-works-in-2026/); [CertEmpire](https://certempire.com/?p=95679). A search-engine summary attributed this to a comptia.org language page: V7 in English until Jan 13, 2026, and in Japanese, Portuguese and Spanish until April 14, 2026. When I fetched that page directly it no longer showed the text, so the non-English date is unverified — [comptia.org/pt](https://www.comptia.org/pt/certificacoes/linux)
- Price: $390 at launch and $399 from June 2026, per one vendor (unverified). Renewal is every 3 years via CEUs. — [CertEmpire](https://certempire.com/?p=95679)
- Domain weights: 1.0 System Management 23%; 2.0 Services and User Management 20%; 3.0 Security 18%; 4.0 Automation, Orchestration, and Scripting 17%; 5.0 Troubleshooting 22%. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85); [CompTIA page](https://www.comptia.org/en-us/certifications/linux/)
- Scope statement: configure, manage, operate and troubleshoot Linux server environments using security best practices, scripting, containerization, virtualization and automation. The explicit "cloud-based" wording of XK0-005 is gone, and virtualization is added. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)

**Domain 1.0 System Management (23%)** — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- 1.1 Basic Linux concepts (explain): boot process (bootloader and its config files, kernel and kernel parameters, initrd, PXE); FHS (/, /bin, /boot, /dev, /etc, /home, /lib, /proc, /sbin, /tmp, /usr, /var); server architectures (AArch64, RISC-V, x86, x86_64/AMD64); RPM- vs dpkg-based distros; GUI stack (display managers, window managers, X server, Wayland); licensing (open source, free, proprietary, copyleft).
- 1.2 Device management concepts and tools (summarize): kernel modules (depmod, insmod, lsmod, modinfo, modprobe, rmmod); devices (dmesg, dmidecode, ipmitool, lm_sensors, lscpu, lshw, lsmem, lspci, lsusb); initrd tools (dracut, mkinitrd); custom hardware (embedded systems, GPU use cases, nvtop).
- 1.3 Manage storage (scenario): LVM, including logical volumes (lvchange, lvcreate, lvdisplay, lvremove, lvresize/lvextend, lvs), volume groups (vgchange, vgcreate, vgdisplay, vgexport, vgextend, vgimport, vgremove, vgs, vgscan) and physical volumes (pvcreate, pvdisplay, pvmove, pvremove, pvresize, pvs, pvscan). Partitions: blkid, fdisk/gdisk, growpart, lsblk, parted. Filesystems: xfs, ext4, btrfs, tmpfs. Utilities: df, du, fio, fsck, mkfs, resize2fs, xfs_growfs, xfs_repair. RAID: mdadm, /proc/mdstat. Mounting: /etc/fstab, /etc/mtab, /proc/mounts, autofs, mount, umount. Mount options: noatime, nodev, nodiratime, noexec, nofail, nosuid, remount, ro, rw. Network mounts: NFS, SMB/Samba. Inodes.
- 1.4 Network services and configuration (scenario): /etc/hosts, /etc/resolv.conf, /etc/nsswitch.conf; NetworkManager (nmcli, plus a tool listed as "nmconnect"); Netplan (apply, status, try, /etc/netplan); tools arp, curl, dig, ethtool, hostname, ip (address/link/route), iperf3, mtr, nc, nmap, nslookup, ping/ping6, ss, tcpdump, tracepath, traceroute.
- 1.5 Common shell operations (scenario): environment variables DISPLAY, HOME, PATH, PS1, SHELL, USER; absolute and relative paths (~, /, ., .., -); .bashrc, .bash_profile, .profile; redirection (<, >, <<, >>, |, stdin/stdout/stderr, here docs, here strings <<<); utilities !, !!, alias, awk, bc, cat, cut, echo, grep, head, history, less, more, printf, sed, sort, source, tail, tee, tr, uname, uniq, wc, xargs; editors vi/vim and nano.
- 1.6 Backup and restore (scenario): archiving with cpio and tar; compression with 7-Zip, bzip2, gzip, unzip, xz; other tools dd, ddrescue, rsync, zcat, zgrep, zless.
- 1.7 Virtualization on Linux (summarize): QEMU and KVM hypervisors; VM concepts (paravirtualized drivers, VirtIO, disk image convert/resize/properties, VM states, nested virtualization); VM operations (CPU, RAM, storage and network resources, baseline templates, cloning, migrations, snapshots); bare metal vs VM; network types (bridged, NAT, host-only/isolated, routed, open); libvirt, virsh, virt-manager.

**Domain 2.0 Services and User Management (20%)** — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- 2.1 Manage files and directories (scenario): cd, cp, diff, file, find, ln, locate, ls, lsof, mkdir, mv, pwd, rm, rmdir, sdiff, stat, touch; symbolic vs hard links; /dev block, character and special devices.
- 2.2 Local account management (scenario): add (adduser, groupadd, useradd); delete (deluser, groupdel, userdel); modify (chsh, groupmod, passwd, usermod); lock (chage, passwd, usermod); expiration; listing (getent passwd, groups, id, last, lastlog, w, who, whoami); templates (/etc/profile, /etc/skel); /etc/group, /etc/passwd, /etc/shadow; UID, GID, EUID, EGID; user vs system vs service accounts and their UID ranges.
- 2.3 Processes and jobs (scenario): inspection (/proc/<PID>, atop, htop, lsof, mpstat, pidstat, ps, pstree, strace, top); PID and PPID; states (running, blocked, sleeping, stopped, zombie); nice and renice; process limits; job control (&, bg, fg, jobs, Ctrl+C/D/Z, exec, nohup); kill, killall, pkill; signals HUP(1), KILL(9), TERM(15); scheduling with anacron, at, crontab.
- 2.4 Software management (scenario): install, update and remove from repositories or source; dependencies and conflicts; distro package managers; language package managers (pip, cargo, npm); enabling and disabling repos, third-party repos, GPG signatures; package and repo exclusions; update-alternatives; software configuration; sandboxed apps; basic config of common services: DNS, NTP/PTP, DHCP, HTTP (Apache httpd, Nginx), SMTP, IMAP4.
- 2.5 systemd (scenario): unit types (services, timers, mounts, targets); tools hostnamectl, resolvectl, sysctl, systemctl, systemd-analyze (incl. blame), systemd-resolved, timedatectl; unit state operations daemon-reload, enable/disable, edit, mask/unmask, start/stop/restart/reload, status.
- 2.6 Containers on a Linux server (scenario): runtimes runC, Podman, containerd, Docker. Images: pull, build from a Dockerfile (FROM, USER, ENTRYPOINT, CMD), prune, tags, layers. Containers: logs, volume mapping, start/stop, inspect, delete, run, exec, env vars. Volumes: create, map, prune, SELinux context, overlay. Networks: create, port mapping, prune; types macvlan, ipvlan, host, bridge, overlay, none. Privileged vs unprivileged containers.

**Domain 3.0 Security (18%)** — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- 3.1 Authentication, authorization and accounting (summarize): Polkit, PAM, SSSD/Winbind realm join, LDAP, Kerberos, Samba; logging (journalctl, rsyslog, logrotate, /var/log); system audit (auditd, audit.rules).
- 3.2 Firewalls (scenario): firewalld (firewall-cmd, runtime vs permanent, rich rules, zones, ports vs services); ufw; nftables, iptables, ipset; the netfilter module; NAT, PAT, DNAT, SNAT; stateful vs stateless; IP forwarding (net.ipv4.ip_forward).
- 3.3 OS hardening (scenario): privilege escalation (sudo, /etc/sudoers with NOEXEC and the risks of NOPASSWD, /etc/sudoers.d, visudo, sudo -i, wheel/sudo groups, su -); chattr and lsattr (immutable, append-only); permissions (chgrp, chmod in octal and symbolic form, chown; sticky bit, setuid, setgid; umask); ACLs (setfacl, getfacl). SELinux: restorecon, semanage, chcon, ls -Z, getenforce/setenforce, getsebool/setsebool, audit2allow, sealert, and the enforcing/permissive/disabled states. Secure remote access: SSH key vs password auth, tunneling, PermitRootLogin, disabling X forwarding, AllowUsers/AllowGroups, ssh-agent, SFTP with chroot, fail2ban. Also: avoid Telnet, FTP and TFTP; disable unused filesystems; strip unneeded SUID bits; UEFI secure boot. (The PDF expands "SSHD" as solid-state hybrid drive here, which looks like an editing error; the context is the SSH daemon.)
- 3.4 Account hardening (explain): password complexity, length, expiration, reuse and history; MFA; checking breach lists; restricted shells (/sbin/nologin, /bin/rbash); pam_tally2; avoid running as root.
- 3.5 Cryptography (explain): data at rest (GPG file encryption, LUKS2 filesystem encryption with Argon2); data in transit (OpenSSL, LibreSSL, WireGuard, TLS versions); hashing (SHA-256, HMAC); removing weak algorithms; certificates (trusted roots, free vs commercial CAs, avoiding self-signed).
- 3.6 Compliance and audit (explain): detection and response (anti-malware, IOCs); vulnerability scanning (CVE, CVSS, backported patches, service misconfigurations, port scanners, protocol analyzers); standards (OpenSCAP, CIS Benchmarks); file integrity (AIDE, rkhunter, signed package and installed file verification); secure data destruction (shred, badblocks -w, dd from /dev/urandom, cryptographic erase); software supply chain; login banners (/etc/issue, /etc/issue.net, /etc/motd).

**Domain 4.0 Automation, Orchestration, and Scripting (17%)** — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- 4.1 Automation and orchestration use cases (summarize). IaC with Ansible (playbooks, inventory, modules, ad hoc, collections, facts, agentless), Puppet (classes, certificates, modules, facts, agent/agentless) and OpenTofu (providers, resources, state, API). Unattended deployment: Kickstart, cloud-init. CI/CD: version control, shift-left testing, GitOps, pipelines, DevSecOps. Orchestration: Kubernetes (ConfigMaps, Secrets, Pods, Deployments, Volumes, Services, variables); Docker Swarm (services, nodes, tasks, networks, scaling); Docker/Podman Compose (compose file, up/down, logs).
- 4.2 Shell scripting (scenario): parameter expansion ${var}; command substitution $( ) and backticks; subshells ( ); functions; IFS/OFS; if and case; for, while, until; shebang; numeric tests (-eq, -ne, -gt, -ge, -lt, -le) and string comparisons (=, ==, !=, <, >, <=, >=, =~); regex with [[ =~ ]]; test operators (!, -d, -f, -n, -z); environment variables, arguments, alias/unalias, export, local, set/unset; return codes ($?).
- 4.3 Python basics for sysadmin (summarize): virtual environments, built-in modules, installing dependencies, indentation, current versions, data types (bool, dict, float, int, list, str), modules and packages, PEP 8.
- 4.4 Git version control (scenario): .gitignore, add, branch, checkout, clone, commit, config, diff, fetch, init, log, merge (incl. squash), pull, push, rebase, reset, stash, tag.
- 4.5 Responsible AI use (summarize). Use cases: generating code, regexes and IaC; documentation; compliance recommendations; security review; optimization; linting. Practices: review output before pasting it in, and verify it; data governance (data security, whether data feeds LLM training, human review, local vs public models); follow corporate policy; prompt engineering.

**Domain 5.0 Troubleshooting (22%)** — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- 5.1 Monitoring concepts (summarize): SLA, SLI and SLO; data collection via SNMP (traps, MIBs), agent vs agentless, webhooks, health checks and log aggregation; thresholds, alerts, events, notifications and logging.
- 5.2 Hardware, storage and OS issues (scenario): kernel panic; data or kernel corruption; package dependency problems; filesystem won't mount; server won't power on; full OS filesystem; server inaccessible; device failure; inode exhaustion; partition not writable; segfaults; GRUB misconfiguration; killed processes; PATH misconfiguration; failing systemd units; missing or disabled drivers; unresponsive processes; quotas; memory leaks.
- 5.3 Networking issues (scenario): misconfigured firewalls; DHCP and DNS failures; interface misconfiguration (MTU mismatch, bonding, MAC spoofing, subnet, unpingable server); routing and gateway; server unreachable; IP conflicts; dual-stack IPv4/IPv6; link down; link negotiation.
- 5.4 Security issues (scenario): SELinux policy, context and boolean problems; file and directory permissions (ACLs, attributes); account access; unpatched systems; exposed or misconfigured services; remote access; certificates; misconfigured repos; obsolete protocols and ciphers; cipher negotiation failures.
- 5.5 Performance issues (scenario): swapping, OOM, slow apps, unresponsive system, high CPU, load average and context switching, many failed logins, slow boot, high I/O wait, packet drops, jitter, random disconnects and timeouts, high latency, high disk latency, low throughput, blocked processes, hardware errors, sluggish terminal, exceeding baselines, slow remote storage, CPU bottleneck.

**XK0-006 hardware/software list:** a virtualization-capable PC or cloud access, router/switch/AP, SSD and USB media. Software: Ansible, Puppet, Docker, Kubernetes (Minikube), Podman, Git plus a Git repo, LLM access, a package repo, an SSH client, Python 3, virtualization software. Recommended distros: AlmaLinux, Debian, Fedora, openSUSE/SLES, RHEL, Rocky Linux, Ubuntu. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)

**Notable changes from XK0-005 (my side-by-side comparison of the two PDFs, except where another source is cited)**
- Structure: 4 domains/20 objectives became 5 domains/29 objectives. System Management fell from 32% to 23%, Security from 21% to 18%, Troubleshooting from 28% to 22%. The old 19% Scripting/Containers/Automation domain became Automation/Orchestration/Scripting (17%), and containers moved into the new Services and User Management domain (20%). — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652); [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85); [CertEmpire](https://certempire.com/?p=95679)
- New areas:
  - AI best practices (4.5), Python (4.3) and monitoring/observability with SLA/SLI/SLO and SNMP (5.1).
  - Full virtualization objective: KVM/QEMU/libvirt/virsh (1.7). Backup/restore as its own objective, with ddrescue and 7-Zip (1.6).
  - Netplan, ethtool, iperf3 and tracepath. RISC-V, AArch64, GPUs/nvtop, Wayland, ipmitool, lm_sensors.
  - Language package managers (pip, cargo, npm), PTP, and basic web/mail/DHCP/DNS service configuration.
  - Kerberos, Winbind and Samba for AAA. Auditd and logrotate.
  - Container runtimes (runC, containerd), Dockerfile instructions, and macvlan/ipvlan networks.
  - OpenTofu, Kickstart, GitOps/DevSecOps/shift-left, Docker Swarm, and concrete Kubernetes objects (ConfigMaps, Secrets, Deployments, Services).
  - Crypto (LUKS2/Argon2, WireGuard, LibreSSL, HMAC). Compliance (OpenSCAP, CIS, AIDE, rkhunter, CVE/CVSS, secure wipe, supply chain, banners).
  - fail2ban, SSH hardening directives, and Git extras (fetch, reset, stash, squash).
- Dropped or reduced (not in the XK0-006 PDF text):
  - Security tooling: AppArmor (only SELinux remains), faillock (pam_tally2 remains).
  - IaC tools and cloud-native concepts: Chef, SaltStack and Terraform (OpenTofu replaces Terraform); service mesh, sidecar/ambassador patterns and container registries.
  - Networking: net-tools (ifconfig, netstat, route, /etc/sysconfig/network-scripts) and wireshark/tshark; openssl s_client as a listed tool.
  - Storage: SAN/multipathd/fcstat; object vs block storage concepts; MBR/GPT and FUSE (now acronym list only).
  - Software and boot: building from source with ./configure && make; .rpmnew/.rpmsave; explicit GRUB2 commands (grub2-mkconfig etc.).
  - Troubleshooting detail: CPU time categories (steal etc.) and the I/O scheduler.
  - Systemd unit-file directive detail (ExecStart, OnCalendar, What/Where), which XK0-005 tested in 4.5. XK0-006 2.5 lists unit types and systemctl operations instead.
- Training Camp also describes Ansible/Puppet push vs pull models, idempotency, and cloud/hybrid troubleshooting context. These terms do not appear literally in the XK0-006 PDF, so treat them as vendor interpretation. — [Training Camp](https://trainingcamp.com/articles/comptia-linux-xk0-006-exam-guide-domains-pbqs-and-a-study-approach-that-actually-works-in-2026/)
- CertEmpire implies Kubernetes was dropped from XK0-006. This conflicts with the official PDF, which lists Kubernetes objects under 4.1 and Minikube in the software list. — [CertEmpire](https://certempire.com/?p=95679) contradicted by [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- The CompTIA page says the Automation domain includes AI best practices, specifically responsible use of code generation and prompt engineering. — [CompTIA page](https://www.comptia.org/en-us/certifications/linux/)
- Training Camp mentions a related new CompTIA cert, AutoOps+ (AT0-001), launching June 2026 (vendor claim, unverified). — [Training Camp](https://trainingcamp.com/articles/comptia-linux-xk0-006-exam-guide-domains-pbqs-and-a-study-approach-that-actually-works-in-2026/)

### Inferences
- For a skill graph, XK0-006 maps naturally onto lab tracks. Domains 1 and 2 are host administration; domain 3 is hardening plus AAA; domain 4 is IaC, containers, Kubernetes and Git/Python; domain 5 covers diagnosis scenarios, which suit break-fix labs well (the 5.2-5.5 symptom lists read like ready-made fault-injection catalogs).
- XK0-006 explicitly names KVM/libvirt and Kubernetes objects, which fits a KubeVirt/vCenter lab platform. Minikube appears in CompTIA's own lab software list.
- Objective 4.5 (AI) and the "LLM access" software item suggest a lab that has learners review and validate AI-generated scripts or IaC.

### Gaps
- Objective numbers were reconstructed from PDF footer markers, because text extraction separated the numbers from the titles. The ordering (2.1 files to 2.6 containers; 3.1 AAA to 3.6 compliance; 4.1 IaC to 4.5 AI; 5.1 monitoring to 5.5 performance) is consistent with the domain summaries on the CompTIA page and with Training Camp's total of 29 objectives. Still, check the exact numbers against the PDF visually before hard-coding IDs.
- I did not confirm on a live comptia.org page that XK0-005's non-English versions were available until April 14, 2026.

## Performance-based question (PBQ) areas

### Takeaway
CompTIA confirms only that both exams mix multiple-choice and performance-based questions. It does not publish PBQ counts or topics. Vendor reports describe 3-6 PBQs at the start of the exam: simulated terminal tasks, config-file fix-ups, drag-and-drop ordering and tool matching.

### Cited Findings
- Question types: multiple-choice and performance-based, at most 90 questions, for both versions. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85); [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- (Vendor) 3-6 PBQs, shown first, about 3-7 minutes each. Examples: a simulated terminal (e.g., create a user with a given UID and groups), editing a config file to fix an error, drag-and-drop ordering (e.g., boot sequence steps), matching tools to use cases. — [Training Camp](https://trainingcamp.com/articles/comptia-linux-xk0-006-exam-guide-domains-pbqs-and-a-study-approach-that-actually-works-in-2026/)
- The "Given a scenario..." objectives are the ones CompTIA writes as applied tasks. In XK0-006 these are 1.3, 1.4, 1.5, 1.6, 2.1-2.6, 3.2, 3.3, 4.2, 4.4 and 5.2-5.5. The "explain/summarize" objectives are 1.1, 1.2, 1.7, 3.1, 3.4, 3.5, 3.6, 4.1, 4.3, 4.5 and 5.1. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)

### Inferences
- The scenario objectives are the likeliest PBQ sources, and the best candidates for hands-on graded labs. Explain/summarize objectives suit knowledge checks.

### Gaps
- There is no official CompTIA list of PBQ topics or counts. All PBQ specifics come from vendors or candidates.

## Distro-neutral vs distro-specific emphasis

### Takeaway
Both exams are distro-neutral and cover the RPM/Red Hat and Debian/Ubuntu toolchains in parallel. XK0-006 adds more enterprise RHEL clones (Alma, Rocky) and SLES to its recommended list. It still tests both families' tools: firewalld and ufw, NetworkManager and Netplan, SELinux, plus useradd/adduser.

### Cited Findings
- XK0-005 recommended distros: Ubuntu, Fedora, Debian, openSUSE, RHEL. — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652)
- XK0-006 recommended distros: AlmaLinux, Debian, Fedora, openSUSE/SLES, RHEL, Rocky Linux, Ubuntu. 1.1 calls for RPM-based vs dpkg-based distributions. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- XK0-005 named the package managers per family (DNF, YUM, APT, RPM, dpkg, ZYpp) and the repo config files for each. XK0-006 says only "package managers" generically and adds pip, cargo and npm. — [XK0-005 PDF](https://lecbyo.files.cmp.optimizely.com/download/041d3582bbbb11efb9a5a6f347fbf652); [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- XK0-006 keeps both families' defaults: firewalld (RHEL) and ufw (Ubuntu); NetworkManager (RHEL) and Netplan (Ubuntu); adduser/deluser (Debian) alongside useradd/userdel; SELinux only, with AppArmor dropped. — [XK0-006 PDF](https://lecbyo.files.cmp.optimizely.com/download/4ae79a48529711f08baa4a1390fb0d85)
- (Vendor) Recommends labbing on Ubuntu plus a RHEL derivative (Rocky/Alma). — [Training Camp](https://trainingcamp.com/articles/comptia-linux-xk0-006-exam-guide-domains-pbqs-and-a-study-approach-that-actually-works-in-2026/)

### Inferences
- A lab platform aligned to XK0-006 needs at least two base images: an EL9/EL10 clone (Rocky or Alma) for SELinux, firewalld, dnf and Kickstart, and Ubuntu LTS for Netplan, ufw, apt and cloud-init. SLES/openSUSE is optional.
- With AppArmor gone, MAC (mandatory access control) labs can focus on SELinux on the RHEL-family image.

### Gaps
- Neither PDF says how often distro-specific commands appear in questions.
