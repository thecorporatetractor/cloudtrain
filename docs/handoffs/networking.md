# Networking stream handoff

Round 3 (2026-10-17), branch `content/networking-round-3`, squash-merged into
`main`. Worktree removed; resume from a fresh worktree off `origin/main`.

## State

Status lives in `content/curriculum.yaml` (rendered into `docs/curriculum.md`
and the README table). Verify reports: `deploy/.results/verify/<lab>.json`.

**Learning labs verified live** (2 seeds + every mutation + every alternative):

| Lab | Notes |
|---|---|
| net-osi-capture-walkthrough, net-arp-neighbour-tables | round 1 |
| net-vlan-access-ports, net-trunk-two-switches, net-fix-native-vlan-mismatch | Linux bridges on the platform L2 fabric |
| net-inter-vlan-subinterfaces | framework narrowed to ccna:network-access (no check maps to ip-connectivity) |
| net-rstp-root-bridge | looping `stp-off` mutation replaced by `core-only`; host check waits for STP to settle |
| net-vrrp-gateway-pair | return path is fast OSPF (hello 1 / dead 3): static return routes cannot fail over; `show vrrp interface eth1 N` (not `show vrrp eth1 N`); solution waits out the failover probe of the earlier grading round |
| net-lacp-server-uplink | after platform round 4 the node runs in a user namespace and `/proc/net/bonding` hides the LACP partner/aggregator details; the checks read `ip -d -j link` (`ad_info`) instead |

`net-fix-broadcast-storm` stays **built**: on the round-4 manager (10 Mbit/s link
cap) seed 2 and the mutation pass and `hosts-reachable` now retries for 45 s, but
seed 1 failed `loop-captured` twice (the solution's capture saw fewer than 20
copies of one broadcast). Next step: count total broadcast frames in the capture
instead of copies of one frame, or lower the threshold, then re-verify.

**sim-net-associate exam tasks** (`xnt-*`, type exam, no hints):
xnt-subnet-admin-block, xnt-fix-host-gateway, xnt-summary-route (fundamentals);
xnt-vlan-guest-ports, xnt-trunk-allowed-vlans, xnt-native-vlan-repair (access);
xnt-static-campus-reachability, xnt-ospf-join-router, xnt-ospf-adjacency-repair,
xnt-ipv6-default-route (IP connectivity); xnt-pat-student-vlan,
xnt-ntp-syslog-client (IP services); xnt-acl-printer-subnet, xnt-mgmt-ssh-only
(security); xnt-render-config-from-yaml (automation, Jinja2 on a netsvc node, the
config is pasted into the FRR console). All 15 are verified live (2 seeds, every
mutation and alternative).

Exam pool: 15 of 30 tasks exist, exactly the draw of every objective (3/3/4/2/2/1).
`labctl exam compile --allow-missing sim-net-associate` passes (shared-node
consistency included); without `--allow-missing` it fails on the 15 missing
tasks. Every task uses its own device names; only `workstation` (jumphost:1,
entry) is shared. **Not run yet:** `labctl exam run --auto-solve/--no-solve`
(blocked by the labctl netdev bug below, and the pool has no retake headroom).

Still drafts in `docs/handoffs/networking-drafts/` (not touched this round, static
checks were clean in round 1): the fundamentals, static/OSPF, services and NAT
labs listed in path order in the round-1 notes (`net-subnet-east-campus` ...
`net-qos-voice-priority`, 22 labs). Not started: net-acl/zone/mgmt/hack/VPN
learning labs, the automation path (SR Linux, Ansible images missing) and 15
`xnt-*` tasks (DHCP, relay, floating static, VRRP, LACP, RSTP, OSPF DR, route
report, inter-VLAN, link-local, SLAAC, capture, WireGuard, SNMPv3, JSON-RPC).

## Platform problems found (not fixed)

- **Fixed:** `labctl verify` and the exam auto-solve couldn't run solution/mutation
  steps on netdev (FRR) nodes (`driver netdev (clabernetes): exec not implemented`).
  `drivers.NewRuntime` now registers the real netdev driver, which is the same
  one-line change round 3 verified with in a scratchpad labctl, so the manager, labctl
  and the exam runner all share it.
- P1/P2 (L2 on links), P3, P4 and link rate limiting are fixed in main (#24, #35).
  The labs keep their own `tbf` caps on switch ports (harmless). Drafts still
  carry P4 workarounds: `net-ipv6-dual-stack-office` uses dhcpcd for SLAAC and
  `net-fix-library-mask` avoids proxy-ARP sysctls; switch them to kernel SLAAC /
  sysctls when they are verified.

## Gotchas (new this round)

- `fwd` is an nftables keyword: a chain named `fwd` is a syntax error.
- FRR: `passive-interface IFNAME` under `router ospf` is deprecated but accepted
  (converted to `ip ospf passive`); `no ip ospf area` needs no `network` statements.
- Daemon restarts in steps: `pkill -x <name>` (exact name) is safe; pid files of
  chronyd/rsyslogd on Alpine are not where you would guess.
- A check that shuts a link (VRRP failover probe) also runs in the *before*
  grading round of `labctl verify`, so the solution must wait for the network to
  recover. Checks after a topology change need a retry loop (STP, LACP, OSPF SPF).
- `{{` in step text is a lab param; generate Jinja braces with
  `sed -e 's/@{/{''{/g'` (busybox printf mangles octal escapes).
- `bridge vlan add` on an existing VLAN rewrites its flags (pvid/untagged).
- A link `subnet:` between two container nodes is platform-addressed (end a gets
  the first usable address): never also set those addresses in setup, or a node
  ends up owning its peer's address (it broke the NTP task).
- Inside the node user namespace (round 4) `/proc/net/bonding` hides LACP details;
  use `ip -d -j link`. chronyd's old process stays a zombie (no init), so remove
  `/run/chrony/chronyd.pid` before restarting it.
- Rebasing the worktree while `labctl verify` lanes read lab files from it is risky;
  rebase between lanes.

## How to resume

```sh
git worktree add -b content/networking-round-4 .worktrees/net-r4 origin/main
cd .worktrees/net-r4 && pnpm install --frozen-lockfile --prefer-offline \
  && pnpm --filter @cloudtrain/lab-schema build && (cd services/lab-orchestrator && make build)
ORCH_NAMESPACE=ct-net-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=networking \
  SKIP_CRDS=1 LOAD_LAB_IMAGES=0 bash deploy/scripts/orchestrator-deploy.sh
```

Helpers in `docs/handoffs/networking-tools/` (copy to your scratchpad, fix `R`/`S`):
`stage.sh` (draft -> pack, status built), `v.sh` (one live verify through
`tools/slots/run.sh pod`), `finish.sh` (status, sync, render, plain commit without
trailers), `sync_pack.py` (pack courses from the curriculum; exam tasks stay out of
courses), `setstatus.py`, `x.sh`, `l2shim.sh` (obsolete). Until the labctl netdev
bug is fixed, point `v.sh` at a labctl built with the one-line patch.

Next: fix the labctl netdev bug (platform), run the sim-net-associate exam
(`--auto-solve`, `--no-solve`), verify the 22 drafts in path order, then write the
missing 15 pool tasks so retakes get a fresh draw.
