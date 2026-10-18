# Handoff: stream linux-a (Linux labs on tier A)

> **Round 4 (2026-10-17/18): superseded for current state by `docs/handoffs/linux-bc.md`.**
> Every tier-A lab now runs on deb-lab:24.04 / el-lab:10 (interim images removed), 22 are
> verified live, and the 14 sudo-blocked root labs below were written with `learnerSudo: true`
> and verified (ssh-hardening-fail2ban stays proposed). The ssh-config-depot-hosts mutation
> issue is fixed (platform `Host *` block moved to /etc/ssh/ssh_config.d in setup). The tables
> below are the round-1 record.

Paused 2026-10-14 on request. Branch `build/linux-a`, worktree
`/home/hackrvl/cloudtrain/.worktrees/b-linux-a`. Pack `content/packs/linux`.

## Done

| Lab | Path | Status | Notes |
|---|---|---|---|
| shell-first-steps-timetable | foundations | **verified** | live `labctl verify` passed (2 seeds, 5 mutations, 2 alternatives) |
| file-ops-roster-cleanup | foundations | built | docker preflight passes; live verify interrupted |
| links-shared-timetable | foundations | built | same |
| streams-delay-report | foundations | built | same |
| vim-fix-signal-config | foundations | built | same |
| text-filters-ticket-sales | foundations | built | same |
| regex-extract-train-ids | foundations | built | same |
| find-stale-depot-files | foundations | built | same |
| processes-runaway-sim | foundations | built | same |
| jobs-signals-long-export | foundations | built | same |
| archive-timetable-history | foundations | built | same (all its live runs had started; report not written) |
| net-inspect-ticket-gate | foundations | built | same |
| ssh-config-depot-hosts | foundations | built | **live failure**: mutation `key-on-one-host` step failed: `ssh-copy-id` hit strict host-key checking for depot-1. Fix: put `StrictHostKeyChecking accept-new` in the mutation's config before ssh-copy-id, or pre-seed known_hosts in setup |
| signal-box-levels-1 | foundations | built | preflight passes |
| signal-box-levels-2 | foundations | built | preflight passes |
| script-first-delay-summary | scripting | built | graded on 7 hidden feeds |
| script-loops-depot-checks | scripting | built | hidden host lists; a "silent" host is a loopback listener with a full accept queue |
| script-positional-user-tool | scripting | built | harness runs the script as root; the learner cannot test-run it (no sudo, see blockers) |
| awk-fare-report | scripting | built | hidden logs; image awk is mawk (no asort) |
| fix-crlf-script | scripting | built | |
| robust-script-rotation-tool | scripting | built | harness compares the learner's result tree with a root-only reference |
| git-timetable-repo | scripting | built | in-pod sshd git server (git-shell, AuthorizedKeysCommand reads the learner's ~/.ssh/*.pub) instead of gitea:1 |

## Not started / blocked

| Lab(s) | State | Reason |
|---|---|---|
| fix-cron-silent-failure | not started (draft discarded) | also: `crontab` is setgid, which no_new_privs blocks (see blockers); design around /etc/cron.d + a fix in the script |
| signal-box-levels-3 | not started | needs a scheduled job run by a daemon in the pod |
| help-pages-offline | not started | choose questions from man pages present in the final (foundations) image |
| users-new-signallers, permissions-ticketing-share, password-aging-contractors, sudo-depot-operators, env-profile-signal-tools, ulimits-batch-user, cron-nightly-fares-export, hunt-escalation-paths, sshd-keys-only, ssh-hardening-fail2ban, sftp-chroot-vendors, dns-client-resolution, fix-dns-resolution-outage, fix-missing-shared-lib, rpm-verify-tampered | not started, **blocked** | need root for the learner (sudo); impossible on current entry pods |
| packages-install-from-mirror, package-repo-pinning, dnf-local-repo, python-venv-fleet-report | not started, **blocked** | need the in-cluster package/PyPI mirror (foundations has tooling in tools/mirrors, no mirror Service deployed) and sudo |
| acl-timetable-review, setgid-shared-planning, tls-cert-ticket-portal, fix-expired-cert, gpg-sign-timetable, strace-config-not-found, fix-ssh-key-perms, logrotate-ticket-logs, aide-integrity-baseline | not started | feasible without root (learner-owned paths), do these next |
| apache-vhosts-tls, nginx-reverse-proxy-pis, haproxy-ticket-backends, bind-authoritative-zone, unbound-caching-forwarder, postfix-relay-alerts, postgres-backup-restore | not started | server packages must be in the image or mirror; mostly need root for ports < 1024 / config in /etc |
| disk-full-deleted-open, fs-on-image-files | not started, likely mis-tiered | real disk fill / mkfs + mount need tier B; fs-on-image-files can do mkfs on an image file but not mount |

## In flight when paused

A live batch `labctl verify` of the 14 foundations labs was stopped (SIGINT) after
about 60% of its runs; its sessions were torn down and no report was written. Known
from its log: `ssh-config-depot-hosts` mutation `key-on-one-host` failed (above);
no other failure had been printed.

## Next steps, in order

1. Merge `main`; if the foundations tier-A images (`el-lab:10`, `deb-lab:24.04`,
   branch build/foundations commit 867b88d) are on main, switch every lab's
   `image:` from `linux-pod-*` to them, delete `tools/images/linux-pod-interim/` and the two
   `linux-pod-*` catalog entries (resolve toward theirs). Their images run tini as
   PID 1, set LANG=C.UTF-8 and preinstall jq and tmux.
2. Fix ssh-config-depot-hosts (mutation host-key issue).
3. Deploy the scoped manager and run live verify in batches of ~5 labs
   (each lab takes ~10 min under load); set `verified` only for labs whose JSON
   report is ok; commit after each.
4. Build the feasible non-root labs listed above, then help-pages-offline,
   fix-cron-silent-failure, signal-box-levels-3.
5. Root-requiring labs once the platform lets the learner use sudo (blocker 1).
6. Re-render docs/curriculum.md (`node tools/curriculum/render.mjs`).

## Images

- `cloudtrain/linux-pod-deb:24.04` (ubuntu:24.04 by digest) and
  `cloudtrain/linux-pod-el:10` (almalinux:10 by digest), built by
  `tools/images/linux-pod-interim/build.sh [deb] [el]` (also loads into kind). Interim:
  packages from the live archives because snapshot.ubuntu.com returned 5xx on
  2026-10-14. Learner uid 1000 without sudo rules, man pages kept, sshd installed
  but not started, PID 1 `sleep infinity` (does not reap zombies).

## Platform blockers and bugs

1. **Fixed as an opt-in (platform round 3): entry node `learnerSudo: true`** (security
   trade-off, see docs/dev-environment.md; setup must add the sudoers rule). Original finding:
   **No sudo for the learner on tier-A entry pods.** `drivers/entry.go` sets
   `allowPrivilegeEscalation: false` on the node container, so no_new_privs blocks
   every setuid/setgid program: `sudo`, `crontab` (setgid crontab; "mkstemp:
   Permission denied"), `passwd`. Still true with foundations' user-namespace
   change (867b88d keeps the flag). Tier A's design ("root in a user namespace")
   needs escalation allowed inside the userns pod. Blocks ~20 of this stream's labs.
2. Container nodes lose everything outside /home/learner on hibernate/resume, and
   setup does not re-run: tier-A labs that keep data in /srv, /etc or /tmp break
   after a resume. Either re-run setup on resume for tier A or put lab data in home.
3. `/etc/hosts` in pods is a bind mount: `sed -i` (rename) fails with "Device or
   resource busy"; rewrite in place.
4. Root in the pod lacks CAP_SYS_PTRACE, so `ss -p` as root shows no processes of
   other users; graders run it as the owning user.
5. Only the entry node exists per tier-A lab here; container-to-container traffic
   is blocked by the entry NetworkPolicy unless the nodes are linked, so
   multi-host labs use sshd instances on loopback addresses inside one pod.

## Gotchas and lessons

- Actions and checks run under `/bin/sh -c` (dash on Ubuntu): wrap bash-only steps
  in `bash <<'EOS' ... EOS`.
- `pgrep -f`/`pkill -f` match the step's own `sh -c` script text; anchor patterns
  (`^/bin/bash /usr/local/bin/...`) or use process names.
- `set -e` + `cmd && cmd` in loops or command substitutions ends scripts early.
- Background processes started from a step must redirect stdout/stderr, or the exec
  stream stays open until they exit.
- vim in Ex mode (`-Es`) is vi-compatible: `fileformats` is empty, use `edit ++ff=dos`.
- git as root on another user's repo needs `safe.directory`; upload-pack ignores
  `-c`, use a throwaway HOME with a global config.
- Harness scripts with expected results live in `/var/lib/cloudtrain` (0700) so the
  learner cannot read them; references run as root.
- `tools/linux-preflight/localverify.py LABDIR` runs base, mutations and
  alternatives in docker in a few minutes; it caught most bugs before live runs.
- lab-verify (this branch) accepts the curriculum's own framework objectives and
  newSkills in pack labs.

## How to resume

```sh
cd /home/hackrvl/cloudtrain/.worktrees/b-linux-a     # branch build/linux-a
git fetch && git merge origin/main
pnpm install --frozen-lockfile --offline && (cd packages/lab-schema && pnpm run build)
(cd services/lab-orchestrator && make labctl)
bash tools/images/linux-pod-interim/build.sh                 # only if still on the interim images
# scoped manager (CRDs on the cluster are newer: never apply ours; kubectl diff first)
ORCH_NAMESPACE=ct-linuxa-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=linux-a \
  SKIP_CRDS=1 LOAD_LAB_IMAGES=0 bash deploy/scripts/orchestrator-deploy.sh
python3 tools/linux-preflight/localverify.py content/packs/linux/labs/<lab>
tools/slots/run.sh pod -- services/lab-orchestrator/bin/labctl verify --context kind-cloudtrain-dev \
  --session-label labs.cloudtrain.dev/verify=linux-a --only <lab,...> content/packs/linux/labs
node tools/lab-verify/bin/lab-verify.mjs --strict
services/lab-orchestrator/bin/labctl validate content/packs/linux/labs
```

The scoped manager namespace `ct-linuxa-system` and its ClusterRoleBinding were
deleted at the pause; redeploy as above.
