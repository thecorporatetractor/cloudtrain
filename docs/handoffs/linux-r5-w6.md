# Handoff: Linux round 5, wave 6 (container internals, performance, hardening, observability)

Branch `content/linux-r5-w6`, pack `content/packs/linux`. Source of truth for each lab's state is
`status` / `notes` in `content/curriculum.yaml`. All 23 labs are `built`: written and statically checked
(lab-verify --strict, labctl validate, schema/content tests, curriculum render), none run live (rule of
2026-10-18). Every lab is `workstation` (jumphost:1) plus one VM (rsyslog-forward-central: two).

## Labs

| Group | Labs (image) |
|---|---|
| Container internals (el-vm:10 unless noted) | linux-namespaces-unshare, linux-cgroup-v2-limits, systemd-run-slices, capabilities-drop-service, linux-overlayfs-by-hand (ubuntu), am-i-in-a-container (ubuntu) |
| Containers as services (el-vm:10) | podman-run-timetable-api, quadlet-container-service |
| Performance | use-method-slow-host (ubuntu), oom-kill-investigation (el), psi-pressure-alert (el), perf-cpu-flamegraph (ubuntu, image-blocked), bpftrace-who-opens (ubuntu, image-blocked) |
| Observability | node-exporter-alert (ubuntu, image-blocked), rsyslog-forward-central (2 x ubuntu) |
| Hardening | selinux-denial-diagnose, pam-pwquality-faillock, auditd-watch-identity, openscap-scan-remediate (image-blocked) on el-vm:10; kernel-hardening-sysctls, attack-surface-cleanup, unit-sandboxing-score, intrusion-persistence-sweep on ubuntu-vm:24.04 |

Five new pack courses in `content/packs/linux/pack.yaml` hold them: lsi-internals, lsi-containers,
lsp-performance, lso-observability, lss-hardening.

## Curriculum changes

- el-vm:9 references are gone: selinux-denial-diagnose and quadlet-container-service use el-vm:10 (the
  "RHEL 9 variant objective" note is kept) and the unused `el-vm:9` catalog entry was removed.
- All `el-sys:10` / `deb-sys:24.04` images became `[jumphost:1, el-vm:10]` / `[jumphost:1, ubuntu-vm:24.04]`.
- podman-run-timetable-api: "local registry" became "local image store". am-i-in-a-container answers are
  container / vm / namespace-sandbox.

## Design notes

- Offline container images are built from the local dnf repo (`dnf --installroot`, `podman import --change CMD`),
  tagged `registry.tallowmere.test/...`, used with `--pull=never`. quadlet-container-service imports into user
  `pis` storage after `loginctl enable-linger`, then disables linger so the learner has to enable it.
- Internals labs grade `/proc/<pid>/ns`, NSpid, `/sys/fs/cgroup/<path>/{memory.max,cpu.max,pids.max,memory.events}`,
  overlay options and the 0:0 whiteout, `CapEff/CapBnd/Seccomp` from `/proc/<pid>/status`, `systemctl show`.
- Load generators (use-method-slow-host, oom-kill-investigation, psi-pressure-alert) are setup-planted units.
  oom-kill-investigation uses a cgroup OOM in `tr-nightly.slice` (MemoryMax 400M, batch has OOMScoreAdjust=500) so the
  VM itself never OOMs. psi-pressure-alert: six CPU spinners in one slice, the idle `tr-web.slice` is the decoy.
- rsyslog-forward-central: two ubuntu VMs; the three "hosts" are raw RFC5424 TCP messages with distinct hostnames
  sent to the server port by the grader (documented design choice). `cli-forward` (on tr-app-1) sends the probe and
  `cli-arrives` polls up to 25 s, so list order matters.
- node-exporter-alert evaluates the alert expression by substituting `node_filesystem_*` with numbers and `eval`ing it
  (used 3 points above and below the threshold), so no promtool is needed.
- Reboot-graded: quadlet-container-service (linger + unit file), kernel-hardening-sysctls (merged `sysctl.d` via
  `systemd-analyze cat-config`, `modprobe -n -v`).

## Blockers (image gaps, labs written anyway)

Package names to add for foundations (this round did not touch `tools/mirrors/` or the images):

| Lab | Add to |
|---|---|
| perf-cpu-flamegraph | `tools/mirrors/packages-noble.txt`: `linux-tools-common linux-tools-generic` (+ the `linux-tools-<kernel>` matching the VM kernel). Also needs `perf_event` in the guest; the lab uses the `cpu-clock` event and folds stacks with awk |
| bpftrace-who-opens | `packages-noble.txt`: `bpftrace`; the guest kernel needs BTF (`/sys/kernel/btf/vmlinux`) and tracepoints |
| node-exporter-alert | `packages-noble.txt`: `prometheus-node-exporter` (the textfile collectors package `prometheus-node-exporter-collectors` is optional) |
| openscap-scan-remediate | `packages-el10.txt`: `openscap-scanner scap-security-guide`; the data stream path (`/usr/share/xml/scap/ssg/content/ssg-*10-ds.xml`) and the SSG rule IDs used in the tailoring file are unverified |

These labs fail in setup with a message naming the missing package until the images carry it.

## Verify queue (23 built labs), by slot kind

| Slot kind | Labs |
|---|---|
| vm, el-vm:10 (12) | linux-namespaces-unshare, linux-cgroup-v2-limits, systemd-run-slices, capabilities-drop-service, podman-run-timetable-api, quadlet-container-service, oom-kill-investigation, psi-pressure-alert, selinux-denial-diagnose, pam-pwquality-faillock, auditd-watch-identity, openscap-scan-remediate |
| vm, ubuntu-vm:24.04 (10) | linux-overlayfs-by-hand, am-i-in-a-container, unit-sandboxing-score, use-method-slow-host, perf-cpu-flamegraph, bpftrace-who-opens, node-exporter-alert, kernel-hardening-sysctls, attack-surface-cleanup, intrusion-persistence-sweep |
| vm, two ubuntu VMs (1) | rsyslog-forward-central |
| image-blocked | perf-cpu-flamegraph, bpftrace-who-opens, node-exporter-alert, openscap-scan-remediate |

Watch list for the runner: `podman import` of a `dnf --installroot` rootfs and rootless podman for `pis` on el-vm:10
(passt/netavark, subuid ranges), `loginctl enable-linger` plus `runuser -u pis env XDG_RUNTIME_DIR=...` for user units,
the `Pull=never` Quadlet key, `httpd` with `ProxyPass` under enforcing SELinux, `authselect enable-feature with-pwhistory`
on EL10, `systemd-analyze security` output wording for the score parse, `systemd-analyze cat-config sysctl.d` on Ubuntu,
ubuntu `vsftpd` listening on IPv6 only, `rsyslog` dynaFile creation under `/var/log/remote` as user syslog, and
psi `cpu.pressure` values of the six-spinner slice (threshold window is between the idle slice and its avg60).
