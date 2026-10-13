# Linux Foundation and LPI Linux Certification Curricula (state as of Oct 2026)

All objective text below is paraphrased. Weights for LPI are "objective weights" (approximate number of questions out of 60 per exam; 40 for Linux Essentials). Weights for LF are domain percentages.

## LFCS (Linux Foundation Certified System Administrator): domains, weights, competencies, distro

### Takeaway
LFCS has had 5 domains since the revision that took effect on 11 May 2023: Operations Deployment 25%, Networking 25%, Storage 20%, Essential Commands 20%, Users and Groups 10%. It is a 2-hour, performance-based exam taken at the command line. The LF says it is "distribution agnostic" and no longer names a distro. Unofficial reports say Ubuntu is typical.

### Cited Findings
- Revision announced on 11 May 2023 and effective for any attempt after 00:01 UTC on 11 May 2023, retakes included. New weights: Operations & Deployment 25, Storage 20, Networking 25, Users & Groups 10, Essential Commands 20 — [LF blog: Updated LFCS exam](https://training.linuxfoundation.org/blog/updated-linux-foundation-certified-system-administrator-lfcs-exam/)
- Distro policy: exam content is independent of distribution-specific tasks, so candidates no longer pick a platform. The LF publishes no distro or version — [LF blog](https://training.linuxfoundation.org/blog/updated-linux-foundation-certified-system-administrator-lfcs-exam/); [LFCS cert page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/)
- Competencies (paraphrased) from the current cert page, last modified Aug 2026 — [LFCS cert page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/):
  - **Operations Deployment (25%)**
    - Kernel parameters, both runtime and persistent (sysctl)
    - Diagnosing and troubleshooting processes and services
    - Scheduling jobs (cron/at/timers)
    - Finding, installing, verifying and maintaining packages and repositories
    - Recovering from hardware, OS or filesystem failures
    - Managing libvirt VMs
    - Configuring container engines and running/managing containers
    - Creating and enforcing SELinux MAC
  - **Networking (25%)**
    - IPv4/IPv6 configuration and name resolution
    - Time sync against time servers
    - Monitoring and troubleshooting the network
    - OpenSSH server and client config
    - Packet filtering, port redirection and NAT
    - Static routes
    - Bridge and bond devices
    - Reverse proxies and load balancers
  - **Storage (20%)**
    - LVM
    - Virtual filesystem management (/proc, /sys, tmpfs-type)
    - Creating, managing and troubleshooting filesystems
    - Remote filesystems and network block devices (NFS/SMB/iSCSI/NBD)
    - Swap
    - Automounters (autofs/systemd automount)
    - Storage performance monitoring
  - **Essential Commands (20%)**
    - Basic Git
    - Creating, configuring and troubleshooting services
    - Monitoring and troubleshooting system performance and services
    - Working out application- and service-specific constraints
    - Disk-space troubleshooting
    - SSL certificates
  - **Users and Groups (10%)**
    - Local user and group accounts
    - Personal and system-wide environment profiles
    - User resource limits
    - ACLs
    - Using LDAP for user and group accounts
- Format: online and proctored, 2 hours, performance-based (solving tasks at a Linux command line). Includes a Killer.sh simulator (2 sessions of 36 hours each, 20–25 questions). Valid 2 years. 12-month eligibility window. Exam alone costs $445 — [LFCS cert page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/)
- The page contradicts itself on retakes: the header says "two exam attempts" and the includes list says one retake — [LFCS cert page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/)
- Pre-2023 history: an LF forum moderator reported that the old exam let candidates choose CentOS Stream 8 or Ubuntu 20.04 — [LF forum](https://forum.linuxfoundation.org/discussion/comment/36496)
- Community view after 2023: "typically it's Ubuntu", but the LF won't say. A CentOS-type node might appear — [KodeKloud community, Nov 2024](https://kodekloud.com/community/t/lfcs-exam-os-2024/468650)
- Third-party sources that conflict:
  - Tecmint says candidates choose Ubuntu LTS (for example 22.04) or AlmaLinux at registration — [Tecmint LFCS course](https://pro.tecmint.com/lfcs-certification-course/)
  - A 2026 guide says Ubuntu or CentOS Stream — [certland 2026 guide](https://certland.net/blog/linux-foundation-certified-system-administrator-lfcs-study-guide-2026/)
  - Neither matches the official "no platform selection" statement.
- Unofficial LabEx practice exams use Ubuntu 22.04 and simulate a 67/100 pass mark. They state this is not official — [LabEx LFCS practice](https://labex.io/courses/lfcs-practice-exam-02)

### Inferences
- The domains are "cloud-era sysadmin" in scope, with much RHCSA/RHCE-style content: SELinux, libvirt, containers, NAT, bonding/bridging, reverse proxy/LB, LDAP clients, Git and TLS certs.
- Because the exam is distro-agnostic but SELinux is listed, lab tasks should be portable:
  - Use Ubuntu LTS as the primary image (it matches community reports).
  - Use a RHEL-family image (Alma/Rocky) for the SELinux and firewalld tasks.
- For LFCS-aligned labs, every competency should be validated hands-on by checking live system state.

### Gaps
- The LF has published no official current exam OS/version. The official "Important Instructions: LFCS" doc URL returned 404.
- No official passing score or task count was found in this session. 66–67% is widely reported but unverified here.
- The LF publishes no curriculum version number for the post-2023 domains. The forum mentions a pre-2023 "V3.18" domain set, which is unverified.
- No public LF GitHub curriculum repo for LFCS was found. The CNCF curriculum repo covers only K8s certs.

## LFCA (Linux Foundation Certified IT Associate): domains, Linux parts, still offered?

### Takeaway
LFCA is still sold as of Aug–Oct 2026. It is a beginner, multiple-choice exam with 6 domains, and only about 16% of it is pure Linux. System administration fundamentals add another 30%.

### Cited Findings
- Domains, weights and topic areas — [LFCA cert page](https://training.linuxfoundation.org/certification/certified-it-associate/):

  | Domain | Weight | Topic areas |
  |---|---|---|
  | System Administration Fundamentals | 30% | system administration, best practices, networking, troubleshooting, disaster recovery |
  | Cloud Computing Fundamentals | 18% | cloud computing, performance/availability, budgeting, best practices, networking |
  | Linux Fundamentals | 16% | Linux OS, command line |
  | Security Fundamentals | 14% | security, sensitive data, compliance |
  | DevOps Fundamentals | 12% | DevOps basics, Git concepts, containers |
  | IT Project Management Fundamentals | 10% | project management, app architecture, functional analysis, OSS licensing |

- Format: online and proctored, multiple-choice, 90 minutes, beginner level, 1 retake, valid 2 years. Exam alone costs $250 — [LFCA cert page](https://training.linuxfoundation.org/certification/certified-it-associate/)
- Still offered: the page has active purchase buttons and no retirement notice. It was published Oct 2020 and last modified 6 Aug 2026 — [LFCA cert page](https://training.linuxfoundation.org/certification/certified-it-associate/)

### Inferences
- LFCA is useful as a "foundations/awareness" tier in the skill graph: concepts and vocabulary, not tasks.
- The Linux-relevant parts are the Linux Fundamentals domain and the sysadmin/networking/troubleshooting parts of System Administration, which together make up about 46%.

### Gaps
- The public page lists no finer-grained sub-competencies under each LFCA domain.

## LPI Linux Essentials (010-160)

### Takeaway
Linux Essentials is objectives version 1.6, exam 010-160. It has 5 topics with 40 total weight, which equals 40 questions. It has been at version 1.6 since the Oct 2018 LPIC-1 v5 release.

### Cited Findings
- Topics and weights — [LPI 010 objectives](https://www.lpi.org/our-certifications/exam-010-objectives/):
  - **Topic 1: Linux community and open-source careers (7)**
    - 1.1 Linux evolution and popular OSes, including embedded and cloud distros (2)
    - 1.2 Major open-source apps, dev languages, package tools and repos (2)
    - 1.3 OSS philosophy and licensing, FSF/OSI (1)
    - 1.4 ICT skills: desktop, getting to a shell, cloud and virtualization uses (2)
  - **Topic 2: Finding your way on a Linux system (9)**
    - 2.1 Shell basics, syntax, variables, quoting (3)
    - 2.2 Getting help with man and info (2)
    - 2.3 Directories and listing, hidden files, home, absolute vs relative paths (2)
    - 2.4 Creating, moving and deleting files, case sensitivity, simple globbing (2)
  - **Topic 3: Power of the command line (9)**
    - 3.1 Archiving and compression (2)
    - 3.2 Searching and extracting data with pipes, redirection and basic regex (3)
    - 3.3 Turning commands into scripts, with vi/nano awareness (4)
  - **Topic 4: The Linux operating system (8)**
    - 4.1 Choosing an OS: Windows/macOS/Linux, distro lifecycles (1)
    - 4.2 Hardware components and drivers (2)
    - 4.3 Where data lives: programs/config, processes, memory, messaging, logs (3)
    - 4.4 Networking: routers, DNS client and network config (2)
  - **Topic 5: Security and file permissions (7)**
    - 5.1 Root, standard and system users (2)
    - 5.2 User and group commands, UIDs (2)
    - 5.3 Permissions and ownership (2)
    - 5.4 Special files/dirs: tmp, sticky, symlinks (1)
- Linux Essentials was minor-updated to 1.6 alongside the LPIC-1 v5.0 release on 29 Oct 2018 — [LPI announcement](https://www.lpi.org/fr/articles/lpi-releases-updates-lpic-1-and-linux-essentials-certifications/)

### Inferences
- This maps cleanly to an entry tier of the skill graph (shell navigation, files, permissions, basic scripting). Topic 1 and some of Topic 4 are knowledge-only.

### Gaps
- No exact live date for 1.6 is given on the objectives page. Format details (60 min, 40 MC questions, lifetime validity) were not re-verified in this session.

## LPIC-1 v5.0 (101-500, 102-500): every topic with weights and key knowledge

### Takeaway
LPIC-1 is at version 5.0, released 29 Oct 2018, and is still current in Oct 2026. There are 2 exams of 60 questions and 90 minutes each, in multiple-choice and fill-in-the-blank format. Each exam's weights sum to 60. No v6 has been announced, but LPI lists "future considerations" for the next revision.

### Cited Findings
- Overview: v5.0, exams 101-500 and 102-500, 60 MC/fill-in questions, 90 minutes each, both required, valid 5 years, no prerequisites. No newer version is mentioned — [LPIC-1 overview](https://www.lpi.org/our-certifications/lpic-1-overview/)
- Released 29 Oct 2018 — [LPI announcement](https://www.lpi.org/fr/articles/lpi-releases-updates-lpic-1-and-linux-essentials-certifications/). Key changes:
  - Much more systemd
  - Networking split into concepts, configuration and troubleshooting
  - New 102.6 "Linux as a virtualization guest"
  - Quotas and SQL removed
- Objectives with weights and key items — [LPIC-1 objectives page](https://www.lpi.org/our-certifications/exam-101-objectives/). That URL serves both 101 and 102. The topic group names (101 System Architecture etc.) are LPI's standard headings.

**Exam 101-500 (total 60)**

- **Topic 101 System Architecture (8)**
  - 101.1 Hardware settings (2): enable/disable peripherals, storage device types, sysfs/udev/D-Bus. Tools: lspci, lsusb, lsmod, modprobe, /sys, /proc, /dev.
  - 101.2 Boot the system (3): firmware to bootloader to kernel to init, SysVinit/systemd (Upstart awareness), boot logs (dmesg, journalctl), initramfs.
  - 101.3 Runlevels/targets, shutdown and reboot (3): default target, rescue/single-user mode, shutdown/wall, systemctl, telinit, /etc/inittab, acpid awareness.
- **Topic 102 Installation and Package Management (12)**
  - 102.1 Disk layout design (2): separate /, /var, /home, /boot, ESP, swap, basic LVM.
  - 102.2 Boot manager (2): GRUB 2 basics (grub-install, grub-mkconfig, grub.cfg), GRUB Legacy (menu.lst), MBR.
  - 102.3 Shared libraries (1): ldd, ldconfig, /etc/ld.so.conf, LD_LIBRARY_PATH.
  - 102.4 Debian packages (3): dpkg, dpkg-reconfigure, apt-get, apt-cache, sources.list.
  - 102.5 RPM/YUM (3): rpm (including signature/integrity checks), rpm2cpio, yum, zypper, dnf awareness, yum.repos.d.
  - 102.6 Linux as a VM/container guest (1): clones and templates, cloud-init, regenerating SSH host keys and D-Bus machine-id, guest drivers.
- **Topic 103 GNU and Unix Commands (26)**
  - 103.1 Command line (4): bash, env/export/set/unset, type/which, history, quoting.
  - 103.2 Text filters (2): cut, sort, uniq, wc, head, tail, tr, sed, paste, split, nl, od, less, checksums (md5/sha256/sha512), zcat/bzcat/xzcat.
  - 103.3 Basic file management (4): cp, mv, rm, mkdir, touch, find by type/size/time, tar, cpio, dd, file, gzip, bzip2, xz, globbing.
  - 103.4 Streams, pipes, redirects (4): stdin/stdout/stderr redirection, tee, xargs.
  - 103.5 Processes (4): jobs, bg, fg, &, nohup, ps, top, free, uptime, pgrep, pkill, killall, kill signals, watch, screen, tmux.
  - 103.6 Priorities (2): nice, renice.
  - 103.7 Regex (3): BRE vs ERE, grep/egrep/fgrep, sed substitutions.
  - 103.8 Editing (3): vi modes and navigation, EDITOR variable, awareness of nano/emacs/vim.
- **Topic 104 Devices, Filesystems, FHS (14)**
  - 104.1 Partitions and filesystems (2): MBR/GPT, fdisk, gdisk, parted, mkfs for ext2/3/4, XFS, VFAT, exFAT, basic Btrfs (subvolumes, compression, multi-device), mkswap.
  - 104.2 Filesystem integrity (2): df, du (space and inodes), fsck, e2fsck, tune2fs, xfs_repair, xfs_fsr, xfs_db.
  - 104.3 Mounting (3): mount/umount, /etc/fstab, labels and UUIDs (blkid, lsblk), removable media, systemd mount unit awareness.
  - 104.4 Removed in v5 (it was quotas).
  - 104.5 Permissions and ownership (3): chmod, chown, chgrp, umask, SUID/SGID/sticky bits.
  - 104.6 Links (2): hard vs symbolic, ln.
  - 104.7 FHS and finding files (2): find, locate/updatedb, whereis, which, type.

**Exam 102-500 (total 60)**

- **Topic 105 Shells and Shell Scripting (8)**
  - 105.1 Shell environment (4): /etc/profile, bash.bashrc, ~/.bashrc, ~/.bash_profile, ~/.profile, ~/.bash_logout, aliases, functions, PATH, /etc/skel.
  - 105.2 Simple scripts (4): loops and tests (for, while, if, test), read, seq, exec, command substitution, exit status, && and ||, shebang, script permissions, conditionally mailing root.
- **Topic 106 User Interfaces and Desktops (4)**
  - 106.1 X11 (2): Xorg configuration, display and window managers, xhost, xauth, DISPLAY, Wayland awareness.
  - 106.2 Graphical desktops (1): KDE, GNOME, Xfce, plus XDMCP, VNC, SPICE and RDP awareness.
  - 106.3 Accessibility (1): themes, screen reader, braille, magnifier, sticky/slow/bounce keys.
- **Topic 107 Administrative Tasks (12)**
  - 107.1 Users and groups (5): useradd, usermod, userdel, group*, passwd, chage, getent, /etc/passwd, shadow, group, skel.
  - 107.2 Job scheduling (4): crontab, /etc/crontab, cron.d, at/atq/atrm, allow/deny files, systemd timers, systemd-run.
  - 107.3 Localisation (3): locale, LANG, LC_*, LC_ALL, TZ, tzselect, timedatectl, /etc/localtime, zoneinfo, iconv, LANG=C in scripts.
- **Topic 108 Essential System Services (12)**
  - 108.1 System time (3): date, hwclock, timedatectl, ntpd/ntpdate, chrony (chronyc), pool.ntp.org.
  - 108.2 Logging (4): rsyslog facilities and priorities, logrotate, logger, journalctl filtering, persistent journal and size limits, journald.conf, systemd-cat.
  - 108.3 MTA basics (3): ~/.forward, aliases/newaliases, mail, mailq, Postfix/Sendmail/Exim awareness.
  - 108.4 Printing (2): CUPS, lpr, lpq, lprm.
- **Topic 109 Networking Fundamentals (14)**
  - 109.1 Protocol fundamentals (4): CIDR and netmasks, private ranges, common ports (/etc/services), TCP/UDP/ICMP, IPv6 basics.
  - 109.2 Persistent network config (4): hostname/hostnamectl, /etc/hosts, nsswitch.conf, resolv.conf, nmcli (NetworkManager wired and Wi-Fi), ifup/ifdown, systemd-networkd awareness.
  - 109.3 Troubleshooting (4): ip, ss, ping/ping6, traceroute, tracepath, netcat, legacy ifconfig/netstat/route awareness.
  - 109.4 Client DNS (2): host, dig, getent, resolution order, systemd-resolved awareness.
- **Topic 110 Security (10)**
  - 110.1 Security admin (3): finding SUID/SGID files, password aging, open ports (nmap, lsof, fuser, ss/netstat), ulimit, who/w/last, sudo/sudoers, su.
  - 110.2 Host security (3): shadow passwords, disabling unused services, /etc/nologin, TCP wrappers (hosts.allow/deny), xinetd, systemd.socket.
  - 110.3 Encryption (4): ssh client config, host keys, ssh-keygen/agent/add, authorized_keys, SSH tunnels including X11 forwarding, GnuPG (encrypt, sign, verify, revoke).

- LPI's "future considerations" for LPIC-1 — [LPIC-1 objectives page](https://www.lpi.org/our-certifications/exam-101-objectives/):
  - Drop ifup/ifdown, net-tools and TCP wrappers.
  - Reword part of 102.4.
  - Fold in material from LPIC-2 202.1 (startup customization).

### Inferences
- Several v5.0 topics are now legacy and low-value for a modern lab platform:
  - X11/accessibility (106)
  - GRUB Legacy
  - SysVinit and Upstart
  - CUPS
  - TCP wrappers and xinetd
  - net-tools
- The LFCS list is a more modern target. The LPIC-1 numbering is still an excellent fine-grained taxonomy for skill-graph nodes.
- Highest-weight areas: 103 (26/60 on exam 101), then 109/107/108. These suggest where to put most beginner and intermediate labs.

### Gaps
- No official LPIC-1 v6 or other new-version announcement was found as of Oct 2026.
- The LPIC-1 objectives page refers to LPIC-2 topic 202.1 being absent from "LPIC-2 v5.0", yet the LPIC-2 overview still shows v4.5 (see next section). This conflict is unresolved.

## LPIC-2 v4.5 (201-450, 202-450): every topic with weights; newer versions?

### Takeaway
The official LPIC-2 objectives are still v4.5.0, live since 13 Feb 2017, with exams 201-450 and 202-450. Each exam has 60 MC/fill-in questions in 90 minutes. LPI's own pages hint that a v5.0 exists or is being drafted, but this session found no official release, codes or dates for it.

### Cited Findings
- Overview: v4.5, exams 201-450 and 202-450, 60 MC/fill-in questions in 90 minutes per exam. No newer version is listed — [LPIC-2 overview](https://www.lpi.org/our-certifications/lpic-2-overview/)
- v4.5.0 has been live since 13 Feb 2017 — [LPIC-2 objectives](https://www.lpi.org/our-certifications/exam-201-202-objectives/)
- Objectives and weights (paraphrased; topic totals are my sums) — [LPIC-2 objectives](https://www.lpi.org/our-certifications/exam-201-202-objectives/):

**Exam 201-450 (total 60)**

- **200 Capacity Planning (8)**
  - 200.1 Measuring and troubleshooting CPU, memory, disk and network usage, finding bottlenecks (6): iostat, iotop, vmstat, sar, ss, lsof, htop.
  - 200.2 Predicting future resource needs and trends (2): Icinga2, Nagios, collectd, MRTG, Cacti awareness.
- **201 Linux Kernel (9)**
  - 201.1 Kernel components and image types (2): zImage, bzImage, kernel docs.
  - 201.2 Compiling a kernel (3): make targets, modules, initramfs (mkinitrd, mkinitramfs, dracut), DKMS.
  - 201.3 Kernel runtime management and troubleshooting (4): modprobe, insmod, rmmod, modinfo, /proc, sysctl, udev rules (udevadm), dmesg.
- **202 System Startup (9)**
  - 202.1 Customizing startup (3): systemd targets and units, systemd-delta, SysV runlevels, chkconfig, update-rc.d.
  - 202.2 System recovery (4): BIOS/UEFI, GRUB 2/Legacy shells, efibootmgr, rescue and emergency modes, NVMe boot.
  - 202.3 Alternate bootloaders (2): SYSLINUX family, PXE (BIOS/UEFI), shim, systemd-boot and U-Boot awareness.
- **203 Filesystem and Devices (9)**
  - 203.1 Operating filesystems (4): fstab, swap, UUIDs, mount units.
  - 203.2 Maintaining filesystems (3): ext, Btrfs, XFS tools, SMART (smartctl), ZFS awareness.
  - 203.3 Filesystem options (2): autofs, ISO images, dm-crypt/LUKS basics with cryptsetup.
- **204 Advanced Storage (8)**
  - 204.1 Software RAID 0/1/5 (3): mdadm, /proc/mdstat.
  - 204.2 Device access tuning (2): hdparm, sdparm, nvme, fstrim, iSCSI (iscsiadm), SAN awareness.
  - 204.3 LVM (3): PV/VG/LV lifecycle, resizing, snapshots.
- **205 Networking (11)**
  - 205.1 Basic config, wired and wireless (3): ip, iw.
  - 205.2 Advanced config (4): routing tables, multi-homed hosts, tcpdump, nmap, nc.
  - 205.3 Troubleshooting (4): ip, ss, traceroute, mtr, resolution, logs.
- **206 System Maintenance (6)**
  - 206.1 Building from source (2): configure, make, patch.
  - 206.2 Backups (3): tar, dd, rsync, tape, Amanda/Bacula/Bareos/BackupPC awareness.
  - 206.3 Notifying users (1): issue, motd, wall.

**Exam 202-450 (total 60)**

- **207 DNS (8)**
  - 207.1 BIND as authoritative or caching server (3): rndc, named-checkconf.
  - 207.2 Zones and records, forward/reverse, delegation (3)
  - 207.3 Securing DNS (2): non-root, chroot, TSIG, DNSSEC/DANE awareness.
- **208 HTTP Services (11)**
  - 208.1 Apache basics: vhosts, auth, MPM, logs, .htaccess (4)
  - 208.2 Apache HTTPS: openssl keys, CSRs, self-signed certs, ciphers, SNI (3)
  - 208.3 Squid caching proxy with ACLs (2)
  - 208.4 Nginx as web server and reverse proxy (2)
- **209 File Sharing (8)**
  - 209.1 Samba standalone and AD member, shares, user mapping, client mounts (5)
  - 209.2 NFS exports, exportfs, showmount, NFSv4 awareness (3)
- **210 Network Client Management (11)**
  - 210.1 ISC DHCP, relay, DHCPv6/radvd awareness (2)
  - 210.2 PAM and SSSD/LDAP auth (3)
  - 210.3 LDAP client tools: ldapsearch, ldapadd, etc. (2)
  - 210.4 OpenLDAP server: slapd, LDIF, ACLs, schemas (4)
- **211 E-Mail Services (8)**
  - 211.1 Postfix, basic TLS, aliases (4)
  - 211.2 Sieve filtering, vacation (2)
  - 211.3 Dovecot IMAP/POP3 (2)
- **212 System Security (14)**
  - 212.1 Router: ip_forward, NAT/masquerade, port redirect with iptables/ip6tables (3)
  - 212.2 FTP: vsftpd, Pure-FTPd, active vs passive (2)
  - 212.3 SSH hardening, key auth, AllowUsers, multiplexing (4)
  - 212.4 Security tasks: nmap, fail2ban, IDS (Snort/OpenVAS awareness), patching (3)
  - 212.5 OpenVPN point-to-point and site-to-site (2)

- LPI's planned future changes for LPIC-2 — [LPIC-2 objectives](https://www.lpi.org/our-certifications/exam-201-202-objectives/):
  - Add nmcli/nmtui, firewalld/ufw, FreeIPA, mod_security, IPv6 autoconfiguration, quotas, advanced scripting and Let's Encrypt.
  - Drop djbdns (possibly replaced by unbound), FTP, Samba share-level security, nmblookup and arp.
  - Reconsider Squid, chroot, nslookup and mod_perl.
- Third-party claim that LPIC-2 is "version 5.0" with exam 201-450 and "objectives 201-500/202-500". The same site contradicts itself and this is unverified — [linuxlearningcentre](https://linuxlearningcentre.com/lpic-201)
- LPI's LPIC-1 page mentions "LPIC-2 topic 202.1, which no longer appears in LPIC-2 v5.0" — [LPIC-1 objectives](https://www.lpi.org/our-certifications/exam-101-objectives/). This conflicts with the LPIC-2 overview, which shows 4.5.

### Inferences
- An LPIC-2 v5.0 is probably in development or recently drafted. Treat it as unconfirmed.
- For the skill graph, the v4.5 content and the "future considerations" list together give a reasonable target. Modernize it by preferring nftables/firewalld, NetworkManager and Let's Encrypt, and by deprioritizing FTP, djbdns and Squid.
- LPIC-2 server-service topics (DNS, Apache/Nginx, Samba/NFS, LDAP/PAM/SSSD, Postfix/Dovecot, OpenVPN) are ideal for multi-VM labs on KubeVirt/vCenter.

### Gaps
- Official status, exam codes and live date of an LPIC-2 v5.0 could not be confirmed from lpi.org in this session. Check wiki.lpi.org and LPI news before relying on it.

## Other LPI items (brief): LPIC-3 Security 303

### Takeaway
LPIC-3 303 (Security) is version 3.0, exam 303-300. Its topics are 331 to 335.

### Cited Findings
- Topics, with weight sums computed from objective weights — [LPI 303 objectives](https://www.lpi.org/our-certifications/exam-303-objectives/):
  - 331 Cryptography (17): X.509/PKI, certificates for servers and clients, encrypted filesystems, DNS and cryptography
  - 332 Host Security (13): hardening, IDS, resource control
  - 333 Access Control (8): DAC/ACLs and MAC (SELinux)
  - 334 Network Security (17): hardening, monitoring, nftables/iptables packet filtering, VPNs
  - 335 Threats and Vulnerability Assessment (5)
  - The parenthetical descriptions of each topic come from my knowledge of 3.0 and were not returned by the fetch, so verify them.
- Other LPI tracks exist (LPIC-3 300 Mixed Environments, 305 Virtualization & Containerization, 306 High Availability, and DevOps Tools Engineer 2.0, which the LPI site mentions in Oct 2026) but were not researched here — [lpi.org](https://www.lpi.org/our-certifications/exam-102-objectives/)

### Inferences
- 303 is a good "advanced security" tier: PKI/openssl, LUKS, SELinux, nftables, VPN, IDS.

### Gaps
- Sub-objective detail for 303 and other LPIC-3 exams was not collected.

## Hands-on/performance-based vs multiple-choice

### Takeaway
Only LFCS is performance-based (live command-line tasks). LFCA is multiple-choice. All LPI exams (Essentials, LPIC-1, LPIC-2, LPIC-3) are multiple-choice plus fill-in-the-blank, so their "hands-on" content is assessed only by recall.

### Cited Findings
- LFCS: performance-based, online and proctored, solving problems at a Linux command line, 2 hours — [LFCS page](https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/)
- LFCA: online, proctored, multiple-choice, 90 minutes — [LFCA page](https://training.linuxfoundation.org/certification/certified-it-associate/)
- LPIC-1: 60 MC/fill-in questions per exam, 90 minutes — [LPIC-1 overview](https://www.lpi.org/our-certifications/lpic-1-overview/)
- LPIC-2: 60 MC/fill-in questions per exam, 90 minutes — [LPIC-2 overview](https://www.lpi.org/our-certifications/lpic-2-overview/)
- Linux Essentials: weights sum to 40, which matches 40 questions — [LPI 010 objectives](https://www.lpi.org/our-certifications/exam-010-objectives/)

### Inferences
- Lab-platform mapping by objective type:
  - **Task-validatable:** all LFCS competencies, plus LPIC objectives whose key items are commands or config files (most of 103–105, 107–110, 200–212).
  - **Knowledge/awareness only:** suited to quizzes rather than labs. Examples: LE Topic 1 and 4.1, LPIC-1 106.2/106.3, the "awareness of X" items, 109.1 port numbers, 200.2 capacity tools.
- A graph that uses LPIC-1/2 numbering as node IDs, tagged with LFCS domain cross-references, would cover both ecosystems.

### Gaps
- None beyond those noted above (LFCS passing score and OS not officially published).
