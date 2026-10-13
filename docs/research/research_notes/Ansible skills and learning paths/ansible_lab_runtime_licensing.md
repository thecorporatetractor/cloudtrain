# Ansible Lab Runtime (Offline, Kubernetes-based) and Licensing for a Commercial Hosted Training Product

Research date: 2026-10-14. Scope: CloudTrain lab platform (kind/KubeVirt locally, vCenter + KubeVirt + Kata in production, Kube-OVN links, containerlab/Clabernetes for netdev). Not legal advice: licensing items separate cited facts from interpretation.

Method note: about 15 web searches and fetches. Several runtime-compatibility claims (which modules work in which runtime) come from general engineering knowledge. They are marked as inferences and were not verified against a source in this pass.

## Q1. Managed nodes: unprivileged sshd pods vs Kata pods vs KubeVirt VMs (module coverage, systemd, how others do it)

### Takeaway
Fully unprivileged systemd in a container is still fragile. On cgroup v2, systemd needs a writable cgroup hierarchy, and most published Ansible test images assume privileged containers with a host cgroup namespace. Recommendation: use KubeVirt VMs (or Kata microVMs) as the default for "real" RHCSA/RH294-style managed nodes, and keep lightweight sshd containers for fundamentals labs (files, templates, users, packages, ad-hoc commands).

### Cited Findings
- On cgroup v2 hosts, the old read-only `/sys/fs/cgroup` bind-mount workaround for systemd-in-Docker stopped working. Under v2, systemd needs the unified hierarchy to be fully writable. — [jeffgeerling.com: Docker and systemd](https://jeffgeerling.com/node/3250); [LewisGaul/systemd-containers](https://github.com/LewisGaul/systemd-containers)
- Molecule/Docker setups for systemd test images use tmpfs for /run and /tmp, a writable /sys/fs/cgroup, `cgroupns_mode: host` and `privileged: true`. Jeff Geerling reports that `cgroupns_mode: host` is what makes systemd work. A commenter reports that Rocky Linux containers still fail with "Failed to connect to bus" while Debian 11 and Ubuntu 22.04 work. — [jeffgeerling.com](https://jeffgeerling.com/node/3250); [trfore/docker-debian12-systemd](https://github.com/trfore/docker-debian12-systemd)
- Podman runs containers in systemd mode by default (`--systemd=true`) when the entrypoint is systemd/init, and it mounts the needed tmpfs and cgroup filesystems automatically. — [hub.docker.com trfore/docker-ubuntu2204-systemd](https://hub.docker.com/r/trfore/docker-ubuntu2204-systemd); [iximiuz labs: systemd containers with Podman](https://labs.iximiuz.com/tutorials/systemd-containers-podman-30992811)
- Unprivileged systemd pods have been shown on OpenShift/CRI-O with cgroup v2 and user namespaces. The pod annotation `io.kubernetes.cri-o.userns-mode: "auto"` is used and privilege escalation is disabled. — [neteye-blog: Run Unprivileged Containers with systemd in OpenShift](https://neteye-blog.com/?p=43211)
- Red Hat interactive labs are free, browser-based, preconfigured environments, including Ansible Automation Platform labs with "a preconfigured Red Hat Ansible Automation Platform environment". The underlying runtime is not disclosed in the sources found. — [Red Hat blog: interactive labs](https://www.redhat.com/en/blog/interactive-labs-enterprise-lab-environments-ready-minutes-no-cost); [red.ht/ansible_labs](https://red.ht/ansible_labs)
- A KodeKloud Ansible course lists its lab prerequisites as a RHEL 10 control node and at least one RHEL 10 managed node over SSH. — [KodeKloud notes: AI-Assisted Ansible prerequisites](https://notes.kodekloud.com/docs/AI-Assisted-Ansible/Prerequisites/Prerequisites/page)
- NDG's NETLAB+ pod for the official RH294 (RHEL 9) course is built from full VMs. — [NDG RH294 Pod Install Guide](https://netlab-docs.netdevgroup.com/content/redhat/rh294_rhel9/podinstall/)

### Inferences
Not source-verified in this pass. These are based on how the Linux kernel and containers work.

Module and task support per runtime:

| Task / module | Unprivileged sshd pod (no systemd) | systemd container (privileged or userns) | Kata pod | KubeVirt VM |
|---|---|---|---|---|
| copy / template / file / lineinfile / blockinfile | Works | Works | Works | Works |
| user / group | Works if the container runs as root inside; no PAM or login session realism | Works | Works | Works |
| dnf / apt / package | Works, but needs a local mirror (Q3) and network egress to it | Works | Works | Works |
| service / systemd | Fails (no PID 1 systemd) | Works | Works with systemd as PID 1 in the guest kernel; still needs a cgroup-writable setup inside the guest, which is easier because the guest is a real VM kernel | Works fully |
| cron | Module edits the crontab, but jobs run only if crond runs | Works | Works | Works |
| firewalld / ansible.posix.firewalld | Fails (needs D-Bus, nftables and NET_ADMIN) | Partly works; needs NET_ADMIN and is risky on shared-kernel nodes | Works (own kernel) | Works |
| SELinux (selinux, seboolean, sefcontext) | Fails: shared host kernel, SELinux reports disabled | Fails or unsafe | Partly works: depends on the guest kernel config and the SELinux policy in the Kata guest image, which are usually not enabled | Works (real RHEL-family VM) |
| mount / LVM (community.general.lvg, lvol, filesystem, ansible.posix.mount) | Fails (no block devices; needs CAP_SYS_ADMIN) | Dangerous on the host kernel | Possible with extra virtio block devices; unproven | Works: attach extra disks via DataVolume or emptyDisk |
| reboot | Fails or kills the pod | Restarts the container at best | Restarts the pod; `reboot` sees the connection drop and may reconnect to a new pod | Works natively; the VM keeps its disk and IP |
| hostname, sysctl, kernel modules, timezone | Mostly fails | Partial | Mostly works | Works |

- Recommended tiering:
  - **Tier A "fundamentals"**: unprivileged sshd containers (UBI/Rocky/Debian with openssh-server, a non-root `student` with sudo). Very cheap, so you can run 3-5 nodes per learner. Use them for inventory, ad-hoc commands, files and templates, variables, loops, handlers (with a fake service), roles and Vault.
  - **Tier B "sysadmin / RHCE-style"**: KubeVirt VMs from a golden Rocky or AlmaLinux qcow2 with cloud-init and extra disks. They cover services, firewalld, SELinux, LVM, reboot and cron. This matches the platform's existing `vm` driver and kubeadm golden snapshot approach.
  - Kata is a middle option: a real kernel, faster start than KubeVirt. SELinux and LVM support depends on the guest image, so treat Kata as Tier A+ unless validated.
- systemd-in-container for Tier A service labs: Podman-style systemd mode isn't available to Kubernetes pods. Under containerd you need privileged pods or user-namespaced pods (`hostUsers: false`, Kubernetes 1.30+ beta and later) plus cgroup v2 delegation. Privileged pods are unacceptable for multi-tenant runc. Running them inside Kata limits the blast radius, because the guest kernel is the boundary. So "systemd container" equals a "Kata pod with a systemd image", which fits the planned Kata driver.
- Distro choice: Rocky or AlmaLinux images match RHCE content without RHEL subscription issues for redistribution. RHEL UBI is redistributable, but full RHEL VM images are not (see Q6).

### Gaps
- I couldn't find how Red Hat interactive labs, Killercoda or Instruqt actually provision Ansible managed nodes (VM vs container). No primary source was found. Killercoda's Ubuntu playground is believed to be VM-based, but this is unverified.
- No verified source on SELinux or LVM support in Kata guests.
- No verified source on Kubernetes user-namespace pods running systemd under containerd (as opposed to CRI-O).

## Q2. Control node: ansible-core jumphost, ansible-navigator and EEs, AWX via operator

### Takeaway
Use a plain jumphost container with ansible-core, ansible-lint and pre-installed collections. Run ansible-navigator with `--execution-environment false` (`--ee false`) so no nested Podman is needed. AWX is Apache-2.0, but AWX releases have been paused since July 2024 during a refactor, and it needs roughly 4 CPU and 6-8 GB per instance. Treat "controller labs" as optional, shared or pre-warmed, and not per-learner by default.

### Cited Findings
- `ansible-navigator --execution-environment false` disables launching an execution environment. Ansible and the needed collections must then be installed on the system itself. — [PyPI ansible-navigator](https://pypi.org/project/ansible-navigator); [ansible-navigator settings docs](https://docs.ansible.com/projects/navigator/settings/)
- A user found that with EE disabled, navigator could see the host-installed collections that were hidden under the default containerised run. — [AlmaLinux forums](https://forums.almalinux.org/t/installed-ansible-collections-not-showing-up-in-ansible-navigator/6772)
- AWX README: "Releases of this project are now paused during a large scale refactoring." The last release was on Jul 2, 2024. It links "Refactoring AWX into a Pluggable, Service-Oriented Architecture" and "Upcoming changes to AWX Operator installation methods". The license badge shows Apache 2.0. — [github.com/ansible/awx](https://github.com/ansible/awx)
- Jeff Geerling notes that the announcement said the AWX open-source license is not changing, and he criticised its lack of detail. — [jeffgeerling.com: Saying a lot while saying nothing at all about Ansible AWX](https://www.jeffgeerling.com/blog/2024/saying-lot-while-saying-nothing-all-about-ansible-awx)
- Sizing guidance from an unofficial mirror of the AWX docs:
  - about 1.75 CPU, 6 GB memory and 20 GB storage minimum per instance, split across the web, task, PostgreSQL and Redis containers
  - about 4 CPU and 8 GB RAM for a basic deployment
  - older official docs used minikube with 4 CPUs and 6 GB for testing

  — [mintlify AWX requirements (unofficial)](https://www.mintlify.com/ansible/awx/installation/requirements); [mintlify getting started](https://www.mintlify.com/ansible/awx/getting-started)
- Per-container requests and limits are set through operator CR fields, for example `web_resource_requirements` and `task_resource_requirements`. — [awx-operator README 2.5.3](https://github.com/ansible/awx-operator/blob/2.5.3/README.md)

### Inferences
- Jumphost image: ansible-core (pinned), ansible-lint, ansible-navigator (EE disabled via `ansible-navigator.yml`), and a baked collection set in `/usr/share/ansible/collections`. Add vim, git, sshpass, and an SSH key pre-distributed to the managed nodes. This avoids Podman-in-pod entirely. Podman inside an unprivileged pod needs `/dev/fuse` and user namespaces or privileged mode. Only a Kata or KubeVirt-based control node could safely run real EEs, if a lab must teach `ansible-builder` or EEs.
- Teaching EEs or ansible-builder: make it a VM-based (KubeVirt) control node lab with Podman and a local registry mirror holding the EE base images.
- AWX labs: given the paused releases, running AWX per learner is costly (about 4-8 GB each) and its future is uncertain. Options:
  1. One shared AWX per cohort with per-learner organisations/RBAC (cheapest, but tenant isolation is weaker).
  2. Per-learner AWX with a snapshot-restored PostgreSQL, pre-warmed in a pool.
  3. Defer controller labs.

  Offline AWX install means mirroring the operator image, the AWX and EE images, postgres and redis into a local registry, then using kustomize with image overrides.
- Watch the AWX refactor status before committing. Reread the AWX forum posts before building controller content, because the installation method was announced to change.

### Gaps
- The current (2026) AWX or awx-operator release status after the refactor could not be confirmed. The forum posts were not fetched.
- No official AWX resource-sizing table was found. Figures come from an unofficial mirror.

## Q3. Offline content: collections, Python deps, package mirrors

### Takeaway
Use `ansible-galaxy collection download -r requirements.yml -p <dir>` at image build time, then `ansible-galaxy collection install -r requirements.yml` offline. Optionally run a self-hosted Galaxy NG (a Pulp plugin) as an in-cluster "private Galaxy" for labs that teach `ansible-galaxy install` and `requirements.yml`.

### Cited Findings
- `ansible-galaxy collection download` fetches collections plus their dependencies and writes a `requirements.yml` into the target folder. That folder can be used directly with `ansible-galaxy collection install -r requirements.yml` on a host without Galaxy access. — [docs.ansible.com: Downloading collections](https://docs.ansible.com/ansible/latest/collections_guide/collections_downloading.html)
- Collections are re-downloaded from the configured Galaxy server even if they were specified by tarball path or URL. — [docs.ansible.com: Downloading collections](https://docs.ansible.com/ansible/latest/collections_guide/collections_downloading.html)
- Tarball entries in requirements files use `type: file`. Relative paths are computed from the current working directory. — [Ansible 5 docs: Using collections](https://docs.ansible.com/ansible/5/user_guide/collections_using.html); [oneuptime guide (third-party)](https://oneuptime.com/blog/post/2026-02-21-how-to-install-ansible-collections-from-tarballs/markdown)
- Galaxy NG is "a Pulp plugin to support hosting your very own Ansible Galaxy server". Its docs are flagged as work in progress. — [docs.ansible.com: galaxy-ng](https://docs.ansible.com/projects/galaxy-ng/)
- Galaxy NG lets you configure remote repositories that sync from public Galaxy. Clients point to it through `server_list` in ansible.cfg. Publishing works via `ansible-galaxy collection publish` after creating a namespace. — [oneuptime private Galaxy guide (third-party)](https://oneuptime.com/blog/post/2026-02-21-how-to-set-up-a-private-galaxy-server/markdown); [galaxy_ng wiki](https://github.com/ansible/galaxy_ng/wiki/End-User-Installation/25b49e9188b0fba05922d58650a556225392eccb)
- A `pulp/pulp-galaxy-ng` container image exists. — [Docker Hub pulp/pulp-galaxy-ng](https://hub.docker.com/r/pulp/pulp-galaxy-ng)

### Inferences
- Python dependencies: use `pip download -r requirements.txt -d wheels/` at build time and `pip install --no-index --find-links wheels/` offline, or bake them into the jumphost image. Some collections need Python libraries on the managed node, for example netaddr, jmespath and pywinrm.
- Managed-node packages:
  - Use a per-cluster mirror: dnf via a reposync'd Rocky/Alma BaseOS+AppStream subset served by nginx, and apt via apt-mirror or aptly. Alternatively use a Pulp instance with `pulp_rpm` and `pulp_deb`, which could also host `pulp_ansible`/Galaxy NG and container images. One Pulp server would then serve as the offline content hub.
  - A curated subset (httpd, nginx, mariadb, firewalld, chrony and similar) keeps the mirror small.
- Two curricula options: "offline Galaxy server" (realistic `ansible-galaxy` usage) or "pre-baked collections" (zero moving parts). Do both: bake for speed, and point ansible.cfg at the in-cluster Galaxy NG for the labs about collections.

### Gaps
- The official pulp_ansible sync and remote documentation was not fetched. Exact mirror-sync config is unverified.

## Q4. Network automation and Windows targets

### Takeaway
Nokia SR Linux (pulled freely from ghcr.io) and FRR are the easiest offline network targets via containerlab or Clabernetes. Arista cEOS-lab requires an Arista account download, so it's a redistribution risk. Windows evaluation images are "test or demonstration" only, and hosted commercial training use is unconfirmed.

### Cited Findings
- Arista requires users to register before downloading cEOS images. The archive is then imported with `docker import`. — [containerlab: cEOS kind](https://containerlab.dev/manual/kinds/ceos/)
- Arista Community Labs require an Arista account able to download cEOS-lab and an Arista user token. An Arista-hosted page says the email must be on a corporate domain. — [aclabs.arista.com quickstart](https://aclabs.arista.com/quickstart/); [aclabs.arista.com](https://aclabs.arista.com)
- The eos-downloader PyPI page says token download is only available for customers with active maintenance contracts. This conflicts with the free-account framing elsewhere. — [PyPI eos-downloader](https://pypi.org/project/eos-downloader)
- The SR Linux image is pulled from a public registry (`ghcr.io/nokia/srlinux`). Arista and Juniper images require free account registration. — [commitconfirmed/npa-showcases](https://github.com/commitconfirmed/npa-showcases)
- Containerlab is BSD-3 licensed. — [containerlab.dev](https://containerlab.dev/manual/kinds/ceos/)
- Microsoft Q&A: under evaluation terms "you may not sell the software or use it in a live operating environment, or use it after the evaluation period". Sources conflict on whether repeated rearm or reinstall is permitted. — [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/389493/how-long-can-i-used-windows-server-evaluation-vers); [Microsoft Q&A reinstall](https://learn.microsoft.com/en-us/answers/questions/2187843/reinstalling-windows-server-evaluation-for-learnin)

### Inferences
- Network labs:
  - **FRR**: Debian/Alpine plus FRR plus sshd. Students use `ansible.netcommon.cli_command` or `cli_config` via network_cli with `ansible_network_os: frr.frr.frr`, or plain Linux modules for frr.conf templating. Fully redistributable (FRR is GPL).
  - **SR Linux**: `nokia.srlinux` collection over JSON-RPC (httpapi). Check the SR Linux image EULA before redistributing in our registry; mirror it rather than re-host publicly.
  - **cEOS**: each customer or tenant should supply their own image, or we obtain explicit permission from Arista. Don't bake it into a distributed image.
- Windows: for a commercial hosted product, evaluation media is risky ("may not sell"). Use SPLA or a QLM-style hosting licence via a Microsoft licensing partner, or exclude Windows in year one. This aligns with the open question "GUI/Windows labs in year one".

### Gaps
- Nokia SR Linux licence terms were not retrieved.
- Microsoft's actual licence text on hosted training with evaluation editions was not found.
- Recent frr.frr collection maintenance status was not checked.

## Q5. Grading: state inspection, idempotency, ansible-lint, check mode

### Takeaway
Grade on the resulting state of the managed nodes, not on the playbook text. Then optionally add idempotency (a second run reports `changed=0`) and quality gates (ansible-lint, `--syntax-check`, `--check --diff`). No sources were fetched specifically for this question, so the items below are engineering recommendations.

### Cited Findings
- No new sources fetched in this pass. The relevant behaviours (the PLAY RECAP `changed=` counter, `--check`/`--diff`, `--syntax-check`, ansible-lint profiles) are documented on docs.ansible.com and ansible.readthedocs.io/projects/lint but were not re-verified here.

### Inferences
- Grader design (Go grader service):
  1. **State checks**: the grader runs commands over SSH or KubeVirt guest-agent, or `kubectl exec` for containers. Examples: `systemctl is-active httpd`, `getent passwd alice`, `stat`, `firewall-cmd --list-services`, `getsebool`, `lvs`, `findmnt`, `crontab -l -u`. Alternatively use an internal Ansible "verify" playbook with `ansible.builtin.assert` (molecule-verify style).
  2. **Idempotency**: re-run the learner's playbook with `ANSIBLE_STDOUT_CALLBACK=json` (or `ansible.posix.json`) and assert `stats.*.changed == 0` and `failures == 0`.
  3. **Check mode**: `--check --diff` on a mutated node verifies drift detection.
  4. **ansible-lint**: run with a `--profile` (min/basic/moderate/safety/shared/production) and parse SARIF or JSON output into per-skill tags.
  5. **Mutation testing** (Scenario Studio): break state, confirm the checks fail, then restore.
- Because the reboot, SELinux and LVM checks need Tier B VMs, the grader should resolve the node driver from the topology.

### Gaps
- The json callback field names and ansible-lint profile names should be verified against current ansible-core and ansible-lint docs.

## Q6. Licensing: ansible-core, collections, AWX vs AAP, certified content, trademarks

### Takeaway
- **Facts**: ansible-core and most community collections are GPLv3+ (some files are BSD, MIT or PSF). AWX is Apache-2.0. Certified collections require an AAP subscription via Automation Hub. Red Hat trademark guidelines allow training-course titles that use marks only referentially and not as the lead word, with our brand more prominent, no logos, no Red Hat course codes, and a no-affiliation disclaimer.
- **Interpretation (not legal advice)**: shipping the images to customers (self-hosted) is a GPL distribution that triggers source-offer obligations. Purely hosted use arguably isn't "conveying" under GPLv3 (it's not AGPL). Avoid certified and Automation Hub content, and never name the product or courses "Ansible ...".

### Cited Findings
- community.general is "licensed and distributed as a whole under the GNU General Public License v3.0 or later". Some parts are BSD-2-Clause, MIT and PSF-2.0, with per-file license identifiers. — [community.general mirror README](https://git.lsit.ucsb.edu/ansible-collections/community.general)
- ansible.posix is listed as GPL-3.0-or-later. — [Red Hat catalog: ansible.posix](https://catalog.redhat.com/en/software/collection/ansible/posix)
- AWX shows an Apache 2.0 license. "The AWX logos and branding assets are covered by our trademark guidelines." — [github.com/ansible/awx](https://github.com/ansible/awx)
- Certified collections are "distributed via Ansible Automation Hub (subscription required)". "Customers need an Ansible subscription to access and download certified collections." Galaxy collections have no joint support claims. — [Red Hat KB: Ansible Certified Content FAQ](https://access.redhat.com/articles/4916901)
- Distributing a container image means inheriting the licence obligations of every file in every layer. Deleted files in later layers are still distributed. GPLv3 dependencies compiled into binaries carry source obligations. — [VMware OSPO blog: Tracking container image licenses](https://blogs.vmware.com/opensource/2019/04/18/tracking-container-image-licenses/)
- Linux Foundation workshop: GPL components such as BusyBox are in most containers. Tools like Tern can generate notices and corresponding-source pointers shipped with the image. — [LWN](https://lwn.net/Articles/785680/)
- A 2026 LKML post observes that many container images don't follow the letter of the GPL, and that the SFLC hasn't pursued such publishers so far. — [LKML 2026-03](https://lkml.iu.edu/hypermail/linux/kernel/2603.2/08795.html)
- Red Hat trademark guidelines (training) say verbatim:
  - "Use the Red Hat Word Marks referentially and not as the leading word or most prominent element in your course title"
  - "Make your name or company name more prominent than the Red Hat Word Marks"
  - "Do not use any Red Hat Logos"
  - "Do not use any Red Hat course identification numbers (e.g., RH200, EX220, etc.)"
  - Required disclaimer: "(Name/Company Name) has no affiliation with Red Hat, LLC. The (list of used trademarks) trademarks are used for identification purposes only and are not intended to indicate affiliation with or approval by Red Hat."
  - Red Hat certification training or exams cannot be offered without becoming a Red Hat certified training partner. Software must get "its own name that is not similar to any Red Hat Mark". Marks may not be registered in domain or product names.

  — [Red Hat Trademark Guidelines and Policies](https://www.redhat.com/en/about/trademark-guidelines-and-policies)
- The guidelines state "Nothing in these Guidelines is meant to limit your rights under the terms of a free and open source software license", and that some Red Hat marks are covered by separately published policies. — [Red Hat Trademark Guidelines](https://www.redhat.com/en/about/trademark-guidelines-and-policies)
- Community/project trademark policy (ansible/logos TRADEMARKS.md, which referenced AWX in its examples):
  - The marks may not be used in your own "trademark, service mark, domain name, company name, trade name, product name or service name". Use in a domain or subdomain is likely considered infringement.
  - Descriptive use must put the mark after a preposition: "Bob's plug-in for AWX" is OK, "Bob's AWX plug-in" is not.
  - Nominative use is allowed. Book titles may use the word marks if they don't imply endorsement. Questions go to trademarks@redhat.com.

  — [ansible/logos TRADEMARKS.md](https://github.com/ansible/logos/blob/main/TRADEMARKS.md); [ansible/logos repo](https://github.com/ansible/logos/)

### Inferences (interpretation, not legal advice)
- **GPLv3 (ansible-core, community collections)**:
  - GPLv3 obligations are triggered by "conveying" copies. Running ansible-core in our own hosted cluster, where learners interact over a terminal, is generally not conveying, since GPLv3 has no AGPL network clause. So a pure SaaS offering has minimal GPL obligations for ansible-core.
  - When we **distribute images** (self-hosted enterprise installs, offline bundles, customers pulling our registry), each GPL component in them (ansible-core, collections, FRR, BusyBox, coreutils, systemd and others) requires licence texts, notices, and either the source alongside or a written offer (GPLv3 §6). Mirroring the exact upstream source tarballs or SRPMs for each image tag is the cleanest approach.
  - Generate an SBOM per image (syft) plus a "licenses" layer or URL, and keep a source archive per release. Make sure we don't modify GPL code without publishing those modifications.
  - Our own BUSL-licensed platform code isn't affected merely by invoking ansible-core as a separate program over a CLI or process boundary. Don't link or embed ansible-core Python modules into proprietary Python code; call the CLI or ansible-runner instead.
  - Lab content (playbooks written by us) isn't a derivative of ansible-core, so CC BY-NC is fine for it.
- **AWX vs AAP**:
  - AWX (Apache-2.0) can be redistributed and hosted commercially. Keep NOTICE/LICENSE, and remove or avoid Red Hat/Ansible/AWX logos in our UI (AWX branding assets fall under the trademark guidelines).
  - AAP requires Red Hat subscriptions. A hosted multi-tenant training product would need a commercial agreement, likely via the Red Hat Training Partner or CCSP-type programs. Don't use AAP or Automation Hub images or content.
- **Certified collections and Automation Hub**: access is subscription-gated. Redistribution terms weren't found, so don't bake or redistribute certified collections. Use the Galaxy community equivalents (for example `ansible.posix`, `community.general`, `community.mysql`, `arista.eos` from Galaxy).
- **Naming**:
  - Product or course: "CloudTrain Automation Track: Configuration Management with Ansible" is acceptable in principle. "Ansible Academy", "AnsibleLabs" or a domain such as ansible-labs.example are not.
  - Don't reference RH294, EX294 or RHCE as course IDs. Say "skills aligned to ..." carefully and avoid implying official prep.
  - Add the Red Hat disclaimer and the trademark attribution footer.
  - Don't use the Ansible logo. An RHCE-prep claim needs Red Hat certified training partner status.
- **Base OS**: use Rocky/AlmaLinux/Debian/UBI-based images. Full RHEL images can't be redistributed without subscriptions, and UBI is redistributable under the UBI EULA (not verified in this pass).

### Gaps
- The exact Automation Hub and certified-collection redistribution terms (AAP subscription agreement) were not retrieved.
- The current version of the Ansible community trademark policy is unclear: the fetched TRADEMARKS.md used AWX examples, and whether a separate "Ansible community marks" policy exists in 2026 is unconfirmed.
- The FSF GPLv3 FAQ on "conveying" vs SaaS was not fetched in this pass. The interpretation relies on general GPLv3 knowledge.
- The UBI EULA redistribution terms were not verified.
- The Nokia SR Linux and Arista cEOS EULAs for hosted training were not retrieved.
