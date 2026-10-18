# Handoff: Linux round 5, wave 1 (tier-A learning labs: mirror, servers, certificates, files)

Branch `content/linux-r5-w1`, pack `content/packs/linux`. Source of truth for each lab's state
is `status` / `notes` in `content/curriculum.yaml`.

## What is in the wave

24 tier-A learning labs, all on `deb-lab:24.04` or `el-lab:10`, none needing a second node.

| Group | Labs | Status |
|---|---|---|
| Mirror, packages, docs | packages-install-from-mirror, help-pages-offline, python-venv-fleet-report | verified live |
| Mirror, packages | package-repo-pinning, dnf-local-repo | built (docker preflight passes) |
| Files, keys, scheduling | acl-timetable-review, setgid-shared-planning, fix-ssh-key-perms, strace-config-not-found, gpg-sign-timetable, fix-cron-silent-failure, signal-box-levels-3 | verified live |
| Integrity, logs, certificates | aide-integrity-baseline, logrotate-ticket-logs, tls-cert-ticket-portal, fix-expired-cert | verified live |
| Web and network services | apache-vhosts-tls | verified live |
| Web and network services | nginx-reverse-proxy-pis, haproxy-ticket-backends, bind-authoritative-zone, unbound-caching-forwarder, postfix-relay-alerts, postgres-backup-restore, fs-on-image-files | built (docker preflight passes) |

"Verified live" means a full `labctl verify` (2 seeds, every mutation and alternative) passed on
a pod slot with a scoped manager before the "no live testing on this machine" rule of
2026-10-18. The nine built labs passed `tools/linux-preflight/localverify.py` semantics (base,
every mutation, every alternative) in plain docker containers with the in-cluster mirror
reachable; the remote verify runner should confirm them.

## Mirror

Session pods reach `http://mirror.cloudtrain-mirrors.svc/` (proved by packages-install-from-mirror,
python-venv-fleet-report, gpg-sign-timetable, aide-integrity-baseline, apache-vhosts-tls and
logrotate-ticket-logs live). Setup installs gnupg, aide, httpd/mod_ssl, bind, unbound, dnsmasq,
nginx, haproxy, postfix, postgresql, fdisk and xfsprogs from it, so these labs need the
`cloudtrain-mirrors` deployment up at setup time.

## Design notes and gotchas found

- Debian packages do not start daemons (policy-rc.d) and there is no systemd: setup starts what
  the lab needs and the learner uses each daemon's own control command.
- nginx runs with `worker_processes 1`: upstream round robin and failure marks are per worker.
- BIND only binds interface addresses and the pod has no NET_ADMIN, so `ns.tallowmere.test` is
  127.0.0.1 (no 127.0.0.3). Unbound's depot subnets are loopback ranges probed with `dig -b`.
- Unbound ships a static local zone for `test.`; a loopback upstream needs
  `do-not-query-localhost: no`; Debian's trust anchor comes from a systemd helper, so setup
  copies `/usr/share/dns/root.key`.
- Postfix "local only" sets `default_transport`/`relay_transport` to `error:`; names from
  /etc/hosts need `smtp_host_lookup = dns, native`; `maillog_file` gives the learner a log.
  `myorigin` would break the root alias, so the sender is rewritten on the way out.
- `pg_restore -t` restores neither the primary key nor the sequence default; the labs use a
  filtered `-l` list with `-L`.
- `apachectl graceful` needs systemd on EL; use `httpd -k graceful`.
- ACLs (`setfacl`), `strace` of the learner's own child, `crontab` replay and in-pod sshd/cron all
  work on the pod rootfs under the default seccomp profile.
- Data outside /home is lost on hibernate (known blocker 2): the database, web and DNS labs keep
  their state under /var, /srv and /etc.
- Heredoc-driven steps: `ssh`, `sftp -b -` and `nc` inside a `bash <<'EOS'` step read the script
  from stdin; use `ssh -n` and redirect stdin.

## Not written / adaptations

- packages-install-from-mirror and package-repo-pinning are deb only. The el variants named in
  the curriculum (dnf, versionlock) are not written: `python3-dnf-plugin-versionlock` is not in
  the mirror, and dnf coverage lives in dnf-local-repo and the xel-* tasks.
- python-venv-fleet-report installs `requests` and `rich` (tabulate is not in the PyPI mirror).

## Verify queue for the testing round

nginx-reverse-proxy-pis, haproxy-ticket-backends, bind-authoritative-zone,
unbound-caching-forwarder, postfix-relay-alerts, postgres-backup-restore, fs-on-image-files,
package-repo-pinning, dnf-local-repo. Slow ones: haproxy-ticket-backends (health-check waits, set
the per-check timeouts generously), postfix-relay-alerts (grader polls the relay for up to
40 s).
