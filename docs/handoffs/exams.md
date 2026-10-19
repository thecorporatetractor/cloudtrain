# Handoff: exam simulation runs (2026-10-19)

Every exam simulation that compiles was run end to end on ct-testvm with
`labctl exam run`. Runs used a scoped manager (`ORCH_NAMESPACE=ct-exam-system`,
`SESSION_SELECTOR=labs.cloudtrain.dev/verify=exam`, `SKIP_CRDS=1`,
`LOAD_LAB_IMAGES=0`, `PROVISION_TIMEOUT=40m`) built from the engine fixes in #315,
wrapped in `tools/slots/run.sh vm`, and pools were filtered to `status: verified` labs.

- **auto-solve:** `--auto-solve --attempts 2 --seed 1011`. Attempt 2 uses seed 1012 and avoids
  attempt 1's tasks, so "disjoint" below is the runner's own retake check.
- **no-solve:** `--no-solve --seed 2027`. It must score below the pass mark.
- **Durations:** ready time / whole attempt (seconds).

From 20:52Z the runs went strictly one exam at a time: an flock lock, a wait while any
`labctl exam run` was live on the host, and a 1-minute load under 60. Runs during the two
host overloads (19:15-19:25Z and 20:40-20:50Z, mostly the batch runner's parallel exam
stage, now capped by `EXAM_PAR`) were discarded and re-run.

## Verdicts

| Exam | Verdict | Notes |
|---|---|---|
| sim-iac-associate | **PASS** | |
| sim-iac-advanced | **PASS** | |
| sim-k8s-developer | **PASS** | after #315 (namespace finalizer, stray CNI) and xkd-top-memory-report (#321) |
| sim-k8s-admin | **PASS** | sequential run with the #315 manager |
| sim-containers-podman | **PASS** | |
| sim-el-automation | **PASS** | |
| sim-k8s-security | fixed, re-run pending | seed 1012 at 100 % after #315; seed 1011 xks-runtimeclass-move solution timeout (#321) |
| sim-containers-docker | fixed, re-run pending | three checks broke under restart+reboot grading (#322) |
| sim-linux-sysadmin | fixed, re-run pending | nftables flush broke xlf-container-restart-policy (#323) |
| sim-el-sysadmin | fixed, re-run pending | xel-nice-process could not survive the reboot (#323) |
| sim-net-associate | fixed, re-run pending | xnt-ntp-syslog-client: non-idempotent setup (#324) + host AppArmor (#316) |
| sim-linux-pro | **open** | xlp-process-priority failed on seed 1012 (not investigated); no-solve aborted at wind-down |
| sim-platform-engineer | blocked | does not compile: shared node `workstation`/`qm-build-1` defined differently across xpe tasks (cross-stream decision, `docs/handoffs/iac.md`); 3 pool tasks still `built` |
| sim-soc-analyst | blocked | no pool lab written (29 compile issues) |

The batch runner re-runs every exam sequentially (`EXAM_PAR=1`) with the merged fixes; its
`$RES/exams/` reports supersede the "re-run pending" rows.

## Runs

| Exam | Mode | Seed | Score | Passed | Ready / total (s) | Disjoint | Result |
|---|---|---|---|---|---|---|---|
| sim-iac-associate | auto | 1011 | 100 | yes | 63 / 110 | yes | ok |
| sim-iac-associate | auto | 1012 | 100 | yes | 51 / 133 | yes | ok |
| sim-iac-associate | no-solve | 2027 | 22.3 | no | 54 / 96 | - | ok |
| sim-iac-advanced | auto | 1011 | 100 | yes | 144 / 326 | yes | ok |
| sim-iac-advanced | auto | 1012 | 100 | yes | 408 / 664 | yes | ok |
| sim-iac-advanced | no-solve | 2027 | 31.6 | no | 132 / 249 | - | ok |
| sim-k8s-developer | auto | 1011 | 100 | yes | 225 / 418 | yes | ok |
| sim-k8s-developer | auto | 1012 | 100 | yes | 216 / 563 | yes | ok |
| sim-k8s-developer | no-solve | 2027 | 12.5 | no | 222 / 285 | - | ok |
| sim-k8s-admin | auto | 1011 | 100 | yes | 237 / 451 | yes | ok |
| sim-k8s-admin | auto | 1012 | 100 | yes | 565 / 862 | yes | ok |
| sim-k8s-admin | no-solve | 2027 | 6.4 | no | 306 / 409 | - | ok |
| sim-containers-podman | auto | 1011 | 100 | yes | 126 / 258 | yes | ok |
| sim-containers-podman | auto | 1012 | 100 | yes | 129 / 251 | yes | ok |
| sim-containers-podman | no-solve | 2027 | 0 | no | 126 / 435 | - | ok |
| sim-el-automation | auto | 1011 | 100 | yes | 102 / 473 | yes | ok |
| sim-el-automation | auto | 1012 | 100 | yes | 126 / 489 | yes | ok |
| sim-el-automation | no-solve | 2027 | 2.8 | no | 135 / 412 | - | ok |
| sim-k8s-security | auto | 1011 | - | - | 237 / 426 | yes | solve step timeout, xks-runtimeclass-move |
| sim-k8s-security | auto | 1012 | 100 | yes | 177 / 428 | yes | ok |
| sim-k8s-security | no-solve | 2027 | 17.2 | no | 129 / 189 | - | ok |
| sim-containers-docker | auto | 1011 | 91 | yes | 78 / 356 | yes | xcd-build-entrypoint-signals queue-arg |
| sim-containers-docker | auto | 1012 | 83 | yes | 105 / 274 | yes | xcd-build-cache-secret, xcd-storage-mount-mix after reboot |
| sim-containers-docker | no-solve | 2027 | 0 | no | 81 / 438 | - | ok |
| sim-linux-sysadmin | auto | 1011 | 100 | yes | 90 / 181 | yes | ok |
| sim-linux-sysadmin | auto | 1012 | 98.8 | yes | 126 / 270 | yes | xlf-container-restart-policy port |
| sim-linux-sysadmin | no-solve | 2027 | 8 | no | 105 / 162 | - | ok |
| sim-el-sysadmin | auto | 1011 | 100 | yes | 102 / 229 | yes | ok |
| sim-el-sysadmin | auto | 1012 | 94 | yes | 87 / 221 | yes | xel-nice-process after reboot |
| sim-el-sysadmin | no-solve | 2027 | 0 | no | 84 / 171 | - | ok |
| sim-net-associate | auto | 1011 | - | - | - / 114 | yes | environment failed: xnt-ntp-syslog-client setup |
| sim-net-associate | auto | 1012 | 100 | yes | 69 / 186 | yes | ok |
| sim-net-associate | no-solve | 2027 | - | - | - / 114 | - | environment failed: xnt-ntp-syslog-client setup |
| sim-linux-pro | auto | 1011 | 100 | yes | 141 / 255 | yes | ok |
| sim-linux-pro | auto | 1012 | 95 | yes | 99 / 180 | yes | xlp-process-priority tree, same-processes, decoy-untouched |
| sim-linux-pro | no-solve | 2027 | - | - | - | - | aborted (wind-down) |

Excluded from the draws (pool labs not `verified`): xlf-libvirt-autostart (sim-linux-sysadmin),
xcd-supply-sbom-sign (sim-containers-docker: the supply-chain pool is then 1 task, so that
objective repeats in the retake), xnt-api-interface-desc (sim-net-associate).

## Bugs found and fixed

Engine and platform (#315, merged d31dfc3):
1. **Namespaces stuck `Terminating` for good after every completed attempt.** The ExamSession reconciler
   re-added the `labs.cloudtrain.dev/session-access` finalizer to the manager's RoleBinding
   after the last LabSession released it. Every batch exam namespace of the 20:40Z cycle
   (36) hung on it. Attempts now use a non-holding Ensure.
2. Re-run and reboot grading stages had no time limit; they now time out per stage.
3. A check missing from the re-run or reboot pass kept its first-pass credit; it now fails.
4. An environment that cannot be built left the attempt Pending forever; it now fails
   after the provision budget.
5. **kubeadm nodes put early pods on the podman bridge CNI** (10.88.0.0/16, from
   `87-podman-bridge.conflist` in kubeadm:1.37-full/-sec). This affected CoreDNS,
   calico-kube-controllers and metrics-server: cross-node DNS was flaky, the metrics API was dead,
   and everything broke with Calico WireGuard on. Removed before init/join. Probe:
   default-deny + metadata-egress + wireguard went from 78.6 % to 100 %.
6. `ct-batch.sh`: `EXAM_PAR` (default 1) caps live exam runs on the host.

Host (#316): the verify VM's path-attached AppArmor profiles (rsyslogd, chronyd, tcpdump)
confined those binaries inside unconfined kind lab pods; `tune.sh` unloads and disables
them (applied live), `host-prep.sh` unloads them on native Linux dev hosts.

Content (#321-#324): see the verdict notes. Graded checks changed only in #322 (containers),
which an adversarial opus review checked; its findings are fixed in the PR.

## Open

- Re-run sim-k8s-security, sim-containers-docker, sim-linux-sysadmin, sim-el-sysadmin and
  sim-net-associate once #316 and #321-#324 are merged (the batch's sequential cycle does this).
- sim-linux-pro: investigate xlp-process-priority (failed in the auto-solve retake, per-task
  environment, at load ~50) and run no-solve.
- kubeadm images still ship the podman bridge config; drop it in
  `tools/images/scripts/guest-kubeadm-addons.sh` at the next kubeadm-full rebuild (the
  driver already removes it at boot).
- Pod labs using tcpdump, chronyd or rsyslogd were verified before the AppArmor fix only on
  WSL; requeue them on the VM: net-fix-broadcast-storm, net-pat-internet-edge,
  net-fix-nat-inside-outside, xnt-capture-dns-transport, net-qos-voice-priority,
  net-trunk-two-switches, net-wireguard-annex-tunnel, net-ipsec-partner-tunnel,
  net-osi-capture-walkthrough, net-static-nat-timetable, net-ntp-hierarchy,
  net-fix-library-mask, packages-install-from-mirror (net-syslog-central and
  xnt-ntp-syslog-client pass).
- `labctl exam run --expire` (timer expiry and freeze) was not run live this round.
- sim-platform-engineer and sim-soc-analyst stay blocked (see the verdicts).
