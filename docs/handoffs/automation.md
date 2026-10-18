# Handoff: automation stream (wave 3, Ansible)

Branch `content/automation-wave2`. Pack `content/packs/automation`, image `tools/images/ansible`.
Started 2026-10-17 (round 4). Scoped manager used for verification: `ct-auto4-system`,
selector `labs.cloudtrain.dev/verify=auto4` (deleted at the end of the round).

## Status

The source of truth is each lab's `status`/`notes` in `content/curriculum.yaml`.

| Set | Authored | Verified live | Not started |
|---|---|---|---|
| Path `ansible-fundamentals`, tier-A labs (9 of 12) | 9 | **9** | 0 |
| Path `ansible-fundamentals`, tier-B labs (`ov-conditionals-os-family`, `ov-handlers-web-reload`, `ov-template-claims-vhost`) | 0 | 0 | 3 (need VMs, see Next steps) |
| Exam `sim-el-automation` pool (32 pooled tasks) | 34 written (15 passed a live exam run; 19 written in round 5 wave 1, never run live; 2 of those blocked and held out of the pools) | 0 per-task | 0 |
| Capstone tasks `xpe-ansible-node-agents`, `xpe-ansible-ssh-hardening` (pool of `sim-platform-engineer`) | 2 (round 5 wave 1, never run live) | 0 | 0 |
| Round 5 wave 3: 12 VM learning labs (incl. the 3 tier-B fundamentals labs) + 9 blocked (network, EE, EDA, timesync) written in PR #126 (unmerged, none live) | 21 | 0 | 0 |
| Paths `el-automation-engineer`, `automation-engineering-practices`, `automation-content-developer`, `automation-controller-operations`, `network-automation`, `event-driven-automation` | 23 written in PR #84 (unmerged, 22 runnable, 1 blocked), none live | 0 | 26 |

Verified learning labs (path order): ov-first-inventory, ov-bootstrap-automation-user,
ov-ansible-cfg-project, ov-adhoc-kernel-census, ov-first-playbook-motd,
ov-idempotency-shell-cleanup, ov-check-diff-preview, ov-branch-group-vars,
ov-loop-adjuster-accounts. Every one passed `labctl verify` (two seeds, every misconception
mutation, every alternative, clean teardown); pod sessions were Ready in 85-315 s.

Exam run (2026-10-18, scoped manager, one shared environment, control + 4 el-vm VMs, Ready
in 464 s): `labctl exam run --allow-missing --auto-solve --seed 1` scored **100 %** over all
15 tasks through every grading pass (initial, idempotency re-run of each saved playbook,
reboot of the four VMs, post-reboot grade; about 14 minutes from freeze to report);
`--no-solve --seed 2` scored **2 %** (fail). Both environments were released and torn down
cleanly. The tasks are still `built`, not `verified`: their misconception mutations have
not run through `labctl verify` (four VMs per session; see Next steps 1).

Exam tasks authored (one per draw, so `sim-el-automation` compiles with `--allow-missing`):
xan-baseline-script-output, xan-core-loop-groups-users, xan-core-facts-hwreport,
xan-inventory-groups-cfg, xan-nodes-become-defaults, xan-run-navigator-artifact,
xan-git-push-project, xan-errors-block-rescue-file, xan-errors-failed-when-check,
xan-roles-requirements, xan-roles-author-web, xan-sys-boot-target-sysctl,
xan-sys-archive-fetch, xan-sys-cron-at, xan-tpl-vault-rekey.

Adaptations recorded in the curriculum notes: fleets scaled to four managed nodes; managed
nodes are el-lab/deb-lab pods instead of a separate `ansible-node:1` image; the kernel census
reports distribution and version instead of uptime (pods share the node kernel); the legacy
hardening playbook has 8 noisy tasks, not 14; the exam works as `learner` in `~/exam/<task>`
instead of `/home/devops/ansible` (no sudo on the control node), with `devops` on the managed
nodes; the exam Git repository is a bare repository on the control node.

## Lab topology

### Pod fleets (tier A labs)

```
            ov-ctl (entry, ansible-ctl:2.21)                 lab LAN 10.70.0.0/24
            br0 10.70.0.10 = eth1 + eth2 + eth3 + eth4      (bridge inside ov-ctl)
             |eth1      |eth2       |eth3      |eth4         topology links (Kube-OVN
       ov-claims-web1 ov-claims-web2 ov-db-1  ov-quote-api1   segments in the session VPC)
        el-lab .11     el-lab .12   el-lab .21  deb-lab .31
```

- **Control node** `ov-ctl` runs `ansible-ctl:2.21` (entry pod; learner `learner`, no sudo).
- **Managed nodes** are the foundations tier-A images `el-lab:10` (AlmaLinux 10) and
  `deb-lab:24.04` (Ubuntu 24.04). They already carry sshd, python3 and sudo, so no
  `ansible-node:1` image was built. Non-entry pods get no `allowPrivilegeEscalation: false`,
  so `become` (sudo) works there without `learnerSudo` (which validation only allows on the
  entry node anyway). They run in a user namespace (`hostUsers: false`), as every wired pod does.
- **Reachability.** The entry NetworkPolicy allows the entry pod only DNS, its vclusters, the
  lab VPC CIDRs and the mirrors on the platform network (IaC finding 1), so the entry cannot
  reach other pods by pod IP or Service. Topology links are not filtered (P3, round 4), so the
  workaround needs no platform change: **one link per managed node** (`ov-ctl:ethN <->
  node:eth1`), and setup on the control node runs `ct-fleet-net`, which puts every `ethN`
  into a Linux bridge `br0` with the control node's address. All nodes then share one L2
  LAN (managed nodes reach each other through the bridge, for delegation/load-balancer labs
  later). Links forward foreign MACs (`layer2_forward`, round 3), which the bridge needs.
  The learner cannot change the bridge (no root on ov-ctl). Cost: N links and N Multus
  attachments per lab, each rate-limited to 10 Mbit/s (plenty for SSH).
  Platform round 5 (#41, merged while this round ran) made container nodes *without* links
  lab peers that reach each other by name; wired nodes keep the link behaviour, so these
  labs are unaffected (re-verified on the round-5 manager) and can move to peers later
  (Next steps 3).
- **Names and host keys.** `ct-fleet-net` writes the fleet into `/etc/hosts` (a marked block)
  and the nodes' host keys into `/etc/ssh/ssh_known_hosts`, so the platform-wired learner ssh
  config (`StrictHostKeyChecking yes`) verifies them and nothing in `~/.ssh` is touched.
- **Accounts.** The managed-node setup (YAML anchor `&ov-node` in each lab) sets the address
  from the hostname, creates `ovauto` with a one-time password and a NOPASSWD sudo drop-in,
  starts sshd. `ct-ansible pushkey --seal` (as the learner) then installs the platform-wired
  learner key (`~/.ssh/id_ed25519.pub`) with sshpass and clears the password: key-only from
  then on. The bootstrap lab instead leaves an installer account with a password.
- **Grading.** End state is read on the managed nodes directly (root exec into the pod).
  Idempotency: one check per lab runs `ct-ansible recap DIR PLAYBOOK` (the learner's playbook
  as the learner, prints `changed=N failed=N unreachable=N`). Only one check per lab runs a
  playbook, so concurrent checks never run two plays on the same hosts.

### VM fleets (tier C: exam, and labs that need systemd, services or reboots)

`sim-el-automation` uses one shared environment, byte-identical in every task: `control`
(ansible-ctl:2.21, entry) plus `node1`..`node4` (`el-vm:10`, 1 vCPU, 1280 MiB, data disks
2 GiB + 1 GiB as vdb/vdc). VMs are on the session lab network (host aliases, wired known
hosts, the platform learner key with NOPASSWD sudo); every task's setup also creates the exam
account `devops` with the same key. Groups: dev=node1, test=node2, prod=node3 (webservers),
balancers=node4. Each task works in `~/exam/<task>` (inventory + ansible.cfg provided) and
declares `spec.exam.rerun` (its saved playbook must report changed=0); the exam rules now set
`idempotencyRerun: true` next to `rebootBeforeGrade: true`.

Tier-B labs (Kata, deferred by foundations) are planned on VMs as well (el-vm/ubuntu-vm);
none was built this round.

## Platform change: literal Jinja in lab content

Ansible content is full of `{{ var }}`, and the lab templater treated every `{{ name }}` as
a param (undefined param = validation error). Commit `feat(labs): keep spaced undeclared
{{ name }} literal`: a placeholder written **with inner whitespace** whose name is **not a
declared param** stays literal (Go compiler `literalPlaceholder`, `referencedParams` in
lab-schema, web `personalize.fillParams`; the gateway already left unknown names alone).
`{{name}}` without whitespace must still name a declared param (typos still fail), and a
declared name is substituted in either spelling, so a lab must never declare a param named
like a Jinja variable it uses. Covered by a compiler test and a lab-schema test.

## The control node image (`ansible-ctl:2.21`)

`tools/images/ansible/Dockerfile`, built by `tools/images/build-ansible-ctl.sh` (through
`tools/slots/run.sh build`, `task image:build:ansible-ctl`), loaded with
`tools/images/load.sh ansible-ctl`. Also built and scanned in CI (`images.yml`, matrix entry
`ansible-ctl`).

| Piece | Version / source | Licence |
|---|---|---|
| Ubuntu 24.04 base, apt snapshot `UBUNTU_APT_SNAPSHOT` | same digest as the jumphost and IaC image | various |
| ansible-core | 2.21.5 (`ANSIBLE_CORE_VERSION`, checked at build) | GPL-3.0-or-later |
| ansible-navigator 26.9.0, ansible-lint 26.10.1, Molecule 26.9.0, ansible-builder 3.2.0, ansible-runner 2.4.3, yamllint, passlib, netaddr, jmespath | `requirements.in` -> `requirements.lock` (53 wheels, sha256 each, `pip --require-hashes --only-binary`; regenerate with `lock-python.sh`). Versions match the PyPI mirror where it has them; all at least 7 days old except ansible-lint, taken at the mirror's pin | GPL-3.0 / Apache-2.0 / MIT / BSD |
| Collections ansible.posix 2.2.2, community.general 13.5.0 (+ library_inventory_filtering_v1 1.1.5), community.crypto 3.5.0, ansible.utils 6.1.1 | `collections.lock`, Galaxy artifacts with the sha256 of `tools/mirrors/lock/ansible.lock` (the build script refuses a mismatch) | GPL-3.0 |
| sshpass, git, vim, nano, jq, tmux, rsync, iproute2 | apt snapshot | GPL / MIT |

Size: `cloudtrain/ansible-ctl:2.21` **680 MB** uncompressed. No code-server (see questions).

Helpers: `ct-ansible recap|run|pushkey` (grading and setup, runs as the learner with the
learner's login environment) and `ct-fleet-net` (root, setup only). `ansible-lint` and
`molecule` are small wrappers that put the venv first on PATH (ansible-lint warns otherwise;
the wrapper is in the Dockerfile but the image loaded during this round predates it).

### Licence gate outcome

`tools/licenses/check.sh` reads only `THIRD_PARTY_LICENSES.md`, which inventories pnpm and Go
production dependencies. Python packages installed inside an image are never inventoried, so
ansible-core (GPL-3.0-or-later) is invisible to the gate, the same way Terraform (BUSL) is.
That is the right outcome here: CloudTrain code neither imports nor links Ansible; the image
ships it as a separate program that learners run (aggregation, GPL-3.0 section 5), with its
licence text in the venv's dist-info and `/usr/share/doc/ansible-core/COPYING`, and the
corresponding source is the unmodified PyPI release named in `requirements.lock`. ansible-lint,
navigator, Molecule, ansible-builder, ansible-runner and the collections are GPL-3.0 or
Apache/MIT/BSD; same treatment. The inventory header now says so.

## Round 5, wave 1 (write-only)

PR `content/automation-r5-w1`: the 19 remaining `xan-*` exam tasks and the 2 `xpe-ansible-*`
capstone tasks, all `built`, none run live (no heavy slot this round). `sim-el-automation` now
compiles without `--allow-missing` (32 pooled tasks (34 written) against 30 needed) and is on the CI compile list.
Pools: baseline 2/2, core 4/4, inventory 2/2, nodes 2/2, run 2/2, git 2/2, errors 4/4,
roles 4/4 (timesync and selinux written but held out, blocked), sys 8/8, tpl 2/2.

Shared gate change: `tools/lab-verify/src/curriculum.mjs` now lets an exam task whose notes start with
`blocked:` sit in no exam pool (all other exam tasks must still be pooled); other domain owners may use this
for blocked exam tasks.

Conventions (see each lab's notes in `content/curriculum.yaml`): all 34 tasks share the four
VMs, so every setup is idempotent (`/var/tmp/.ct-<task>-seeded`), the node's local repo, sshd
port 22, `devops` and the learner key are never touched, and ports / users / directories are
unique per task (repo server 8800-8809 on node4, slow service 8830-8839 on node3, backends
8840-8849 on node2/node3, repo ids `ov-*`). Checks and setups run through `/bin/sh -c`: dash on
the control node and Ubuntu VMs, bash on the Alma VMs.

Adaptations: no Linux user devops on the control node (baseline: dedicated key pair
`~/.ssh/devops_exam`); bootstrap uses a different account through an installer account
`ovinstall`; handler task runs on node2 (test group); hotfix repo is a separate bare repo;
data disks are addressed by serial (`/dev/disk/by-id/virtio-ct-data1/2`); the 1 GiB partition
becomes a 400-600 MiB param; el10 has no php and the local repo has no comps groups (php became
httpd, setup builds a metadata-only `/opt/ov-groups` repo with the group Development Tools); the
Galaxy role is a CloudTrain-written `balancer` role; the time server is a chronyd on node4.

Blockers recorded in the curriculum notes: `xan-roles-system-timesync` and
`xan-roles-system-selinux` need `fedora.linux_system_roles` in `ansible-ctl` / the Ansible
mirror (setup fails fast with a clear message; both are taken out of the `sim-el-automation` roles pool, which keeps 4 tasks for a draw of 2, because the exam draw does not filter by status; add them back to the blueprint once the collection ships). The
shared Quillmoor estate topology for the `xpe-*` tasks is still undecided (the two automation
tasks use a standalone workstation plus `qm-build-1/2`); the assessment owner decides.
Assumptions to confirm live: node names resolve from the managed nodes (repo and backend
URLs use `node4`, `node2`, `node3`), `/dev/disk/by-id/virtio-ct-data*` links exist, and
`ansible-navigator run` accepts `--tags` / `--limit`, and the navigator artifact key names (`.plays[].tasks[].task` / `.host`; the `xan-run-limit-tags` check also accepts `__task` / `__host`). `xpe-ansible-ssh-hardening` keeps root key logins (`PermitRootLogin prohibit-password`, `AllowGroups ops root`) because the platform administers VMs as root over SSH; confirm `sshd -T` prints `without-password` on noble.

Verify queue for the testing round: two disjoint `exam run --auto-solve --attempts 2` runs plus
`--no-solve` for `sim-el-automation`, then a per-task `labctl verify` of all 19 tasks and the 2
`xpe-ansible-*` tasks in the vm slot (one session at a time; four VMs per exam session).

## Round 5, wave 2 (write-only, PR #84 NOT merged)

PR #84 (`content/automation-r5-w2`, head 520128d): 23 tier-A pod-fleet labs, all `built`
(none verified, none run live). It was not merged: round-3 review found four majors and the
branch conflicts with origin/main in `README.md` and `docs/curriculum.md` (so no CI ran). To
land it: rebase, keep both sides, `node tools/curriculum/render.mjs`, fix the majors below,
then keep curriculum images in sync with lab.yaml node images and `deploy/images/catalog.yaml`
(lab-verify now errors otherwise). Static gates passed locally (lab-verify --strict 0 errors,
render --check clean).

Labs (22 runnable + 1 blocked): ov-automate-archive-evidence, ov-build-publish-collection,
ov-ci-pipeline-lint-test, ov-collections-offline, ov-constructed-inventory,
ov-custom-facts-tier, ov-custom-filter-plugin, ov-debug-failing-play, ov-delegate-lb-drain,
ov-dynamic-inventory-cmdb, ov-git-push-playbooks, ov-lint-clean-role, ov-lookups-filters-ipam,
ov-migrate-core-219 (runs on ansible-core 2.21; no staged 2.19 needed), ov-molecule-role-tests,
ov-navigator-run-settings, ov-privilege-scoping, ov-python-module-check-mode,
ov-register-disk-report, ov-rolling-update-serial, ov-tags-partial-runs, ov-vault-db-credentials;
blocked: ov-devcontainer-workflow.

Blockers per lab:

| Lab | Blocker |
|---|---|
| ov-devcontainer-workflow | needs code-server in `ansible-ctl` and a gateway web-access proxy; written otherwise complete (title no longer names VS Code) |
| ov-register-disk-report | major: grades a rerun with changed=0 and a pct-1 threshold on live `df` values that keep changing; correct learners can fail |
| ov-build-publish-collection | major: grades a `requirements.yml` the statement never asks for |
| ov-delegate-lb-drain | major: the no-wait-for-health mutation may not fail `no-failed-requests` (HAProxy re-checks a re-enabled server immediately); haproxy install in a pod is unconfirmed, test it first |
| all of README/docs conflicts | PR conflicts in `README.md` and `docs/curriculum.md` |

Minors: TOCTOU read by the root CI runner, Molecule checks grep log strings, the navigator
artifact substring check, stale "Galaxy" curriculum title, fixed CMDB site set, lon host name
vs the site param. The tags lab does not depend on the mirror (it removes the preinstalled
`tree` package).

Verify queue (all pod slot; no VM, kubeadm, netdev or Kata needs): 22 runnable labs above,
after the majors are fixed, from origin/main by the batch runner. Kata-blocked: none. Image-blocked:
ov-devcontainer-workflow (code-server + web proxy).

## Round 5, wave 3 (write-only, PR #126 NOT merged)

PR #126 (`content/automation-r5-w3`, head 7502eb7): 21 labs, all `built` (none verified, none
run live): 12 runnable VM labs, 9 blocked (setup stops with a clear "blocked:" message; the
blocker is in each lab's curriculum notes). None of the labs exist on PR #84's branch. Static
gates pass (lab-verify --strict 0 errors and warnings, render --check clean); the three
required GitHub checks (including the go labs job) were still running at review time, none
failed. Round-3 review verdict: not approved until two majors are fixed.

Majors to fix before merge:

| Lab | Major |
|---|---|
| ov-net-parse-neighbors | the failures-ignored mutation is not caught: with `ignore_errors` Ansible still prints `failed:`/`fatal: [host]` lines, and the `reported` check reads failed hosts from those lines instead of the PLAY RECAP, so its expectFail fails at live verify |
| ov-net-config-backup-restore | security: the backup-commit check runs git as root with `safe.directory=*` on the learner-owned bare repo; a repo-configured `gpg.program` runs under `log.showSignature` during `git log --format=%s`, so the learner can run code as root on ov-ctl. Run the check as the learner or drop root and `safe.directory=*` |

Minors: rsync install guard in the EE setup, two gaps in what the async lab grades, the EDA lab
has no playbook-run check (not noted in the curriculum), os-family file mode, template lab's
template file pick.

Runnable VM labs (el-vm:10 fleets with `ansible-ctl:2.21`; conditionals-os-family also uses
ubuntu-vm:24.04): ov-conditionals-os-family, ov-handlers-web-reload, ov-template-claims-vhost,
ov-block-rescue-db-maintenance, ov-role-claims-web, ov-automate-repos-packages,
ov-automate-users-aging, ov-automate-lvm-storage, ov-automate-web-firewall-selinux,
ov-automate-cron-timers, ov-reboot-persistence-fix, ov-async-patching. This also builds the 3
tier-B fundamentals labs listed in Next steps 2.

Blockers per lab:

| Lab | Blocker |
|---|---|
| ov-system-role-timesync | `fedora.linux_system_roles` not installed in `ansible-ctl:2.21` (or the Ansible mirror); setup stops with a blocked message |
| ov-execution-environment-build | no Podman VM image with a mirrored EE base image (`localhost/ov-ee-base:1`) and registry image (`localhost/ov-registry:3`); `oci-registry:3` and `galaxy-ng:4` are pod images; the `additional_build_files` flow is untested |
| ov-net-inventory-facts, ov-net-ospf-branch-config, ov-net-branch-template-role, ov-net-parse-neighbors | `frr:10` has no openssh-server, sudo, python3 or automation account (image rebuild), or a frr `network_cli` collection in the Ansible mirror |
| ov-net-srlinux-interfaces | same `frr:10` gap; `srlinux:25` is not in the catalog, so the FRR-only VLAN fallback was written |
| ov-net-config-backup-restore | same `frr:10` gap; the Git repo is a bare repo on ov-ctl (no gitea) |
| ov-eda-webhook-rulebook | `ansible-rulebook` and a JDK are not in `ansible-ctl:2.21`; setup stops with a blocked message |

## Verify queue (testing round, grouped by slot kind)

- **vm slot** (el-vm:10; runnable after PR #126 merges): the 12 VM labs above. Needing reboots: ov-reboot-persistence-fix, ov-async-patching (boot-id). Also: `sim-el-automation` exam runs and per-task verify of the 19 xan + 2 xpe tasks (four VMs per session, one at a time).
- **pod slot**: the 22 runnable labs of PR #84 (not merged; fix its 4 majors and conflicts first).
- **netdev**, **kubeadm**, **Kata**: none.
- **image-blocked**: ov-devcontainer-workflow (code-server + web proxy, PR #84); ov-system-role-timesync and the xan roles timesync/selinux tasks (`fedora.linux_system_roles`); ov-execution-environment-build (EE/registry images); the 6 `ov-net-*` labs (frr:10 SSH/python3/account, SR Linux image); ov-eda-webhook-rulebook (ansible-rulebook + JDK).

Unmerged PRs: #84 (wave 2, 23 pod labs), #126 (wave 3, 21 labs, two majors).

## Next steps

1. **Exam pool:** (authored in round 5 wave 1) run two disjoint `exam run --auto-solve
   --attempts 2` runs plus `--no-solve`. Per-task `labctl verify` of exam tasks boots four
   el-vm VMs per session: run them one at a time in the vm slot, or rely on exam runs.
2. **Tier-B fundamentals labs** (`ov-conditionals-os-family`, `ov-handlers-web-reload`,
   `ov-template-claims-vhost`): build them on VMs (el-vm + ubuntu-vm), like foundations'
   rule for tier B until Kata exists. Pods are not enough: no service manager (Ansible sees
   `tini`), and nginx did not install from the pod mirror path in a quick test.
3. **Move pod fleets to lab peers** (#41, merged during this round): container nodes
   *without* links now reach each other by name (`ct-<hash>-peers`). Labs could drop the
   links, the bridge and `/etc/hosts` and keep everything else (`ct-fleet-net` would only
   scan host keys). The link design keeps working, so this is optional; it saves N
   Multus attachments per lab.
4. Path `el-automation-engineer` (navigator, Git, roles, vault, system tasks; the system-task
   labs are tier C on el-vm), then `automation-engineering-practices`.
5. Image follow-ups: code-server for `ov-devcontainer-workflow` (needs a gateway web-access
   proxy that does not exist yet), ansible-core 2.19 staged for `ov-migrate-core-219`,
   `fedora.linux_system_roles` / `redhat.rhel_system_roles` for the timesync/selinux tasks.
6. Promote the `automation.*` newSkills into `content/skills.yaml` once the wave settles.

Findings:

- `el-lab:10` has no `/etc/sysctl.d`; labs that manage sysctl files create it in setup.
- Rarely, the first `ansible.builtin.user` run on a fresh el-lab pod fails one item with
  `useradd: user ... already exists` (the account was created); the next run converges.
  Automated steps that create users run the playbook twice on failure.
- The control image's system `python3` has no PyYAML; checks use `/opt/ansible/bin/python3`.
- ansible-core 2.21 deprecates `-o` (oneline, removal in 2.23); checks use it for now.
- Under load most verify time was queueing for slots (the heavy slot was held for hours by
  other streams' VM jobs); a pod lab verify itself took 10-20 minutes.

How to resume:

```bash
cd /home/hackrvl/cloudtrain && git worktree add -b content/automation-<next> .worktrees/auto-next origin/main
cd .worktrees/auto-next && pnpm install --frozen-lockfile && pnpm --filter @cloudtrain/lab-schema build
GOTOOLCHAIN=go1.27.2 go build -o services/lab-orchestrator/bin/labctl ./services/lab-orchestrator/cmd/labctl
tools/slots/run.sh build -- bash tools/images/build-ansible-ctl.sh   # if the image changed
LOAD_LAB_IMAGES=0 SKIP_CRDS=1 ORCH_NAMESPACE=ct-auto-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=auto \
  bash deploy/scripts/orchestrator-deploy.sh
tools/slots/run.sh pod -- services/lab-orchestrator/bin/labctl verify --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=auto --repo-root "$PWD" content/packs/automation/labs/<lab>
tools/slots/run.sh vm -- services/lab-orchestrator/bin/labctl exam run --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=auto --allow-missing --auto-solve sim-el-automation
```

## Open questions (user)

- **Editor:** the image ships vim and nano. The curriculum lists code-server (browser VS Code,
  ~400 MB more, plus a gateway proxy for `web` access that does not exist yet). Build it now,
  or wait until the devcontainer lab is next?
- **Exam control account:** the platform runs the learner as `learner` without sudo, so the
  exam uses `~/exam/<task>` and the `devops` account only on managed nodes, instead of the
  EX294-style `devops` user and `/home/devops/ansible` on the control node. Acceptable?
- **Product names in titles** (already open): this pack keeps Ansible out of lab titles and
  uses it in statements.
