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

`net-fix-broadcast-storm` is **verified** (platform round 5, 2026-10-18: both seeds
and the mutation). Root cause of the seed-1 `loop-captured` failures: the loop is
already full of the ports' link-up IPv6 multicast (one neighbour advertisement was
copied about 15,700 times in 20 s and every switch tbf queue held ~260 packets with
>130k drops), so the solution's fresh ARP broadcasts were mostly dropped at the full
queues and the `ether broadcast` capture saw fewer than 20 copies of any one frame.
The check now counts copies of the most repeated broadcast **or multicast** frame
(`ether multicast`), and the solution captures `ether multicast` (300 frames, 15 s).

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
entry) is shared. **Exam run live** (platform round 5, 2026-10-18, 55 nodes, one pod
slot, scoped manager with the lab-peer policy): `labctl exam run --allow-missing
--auto-solve` scored **100 %** (every task pass, ready in 277 s, teardown clean, 523 s
in all) and `--no-solve` **14.3 %** (fail; partial credit only where a check holds on
the untouched seed, e.g. ACL/SSH/PAT tasks 38-43 %; teardown clean), reports in
`deploy/.results/exams/sim-net-associate-{auto-solve,no-solve}.json`. A first
auto-solve run also scored 100 % but its teardown hit the Kube-OVN CNI hang under host
load ~190 (`-cni-hang.json`; `docs/dev-environment.md`, known gap 9). No exam content
had to change. Retakes still draw the same 15 tasks (no headroom in the pool).

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

Next: verify the 22 drafts in path order, then write the missing 15 pool tasks so
retakes get a fresh draw (the exam itself now runs end to end: 100 % / 14.3 %).

## Round 5 wave 2 (write-only, status built)

- The seven security/VPN learning labs (`net-acl-grades-server` ... `net-fix-mtu-blackhole`)
  already existed from wave 1; this wave corrected their curriculum `images` to `netsvc:1`
  (Linux routers and firewalls are netsvc) and recorded the kernel risks.
- 16 new `sim-net-associate` pool tasks (`xnt-ipv6-office-slaac` ... `xnt-snmpv3-only`) plus the
  new `xnt-json-neighbour-export` (automation pool: 2 runnable tasks against a draw of 1;
  `xnt-api-interface-desc` stays blocked on SR Linux). Pools now: fundamentals 6/6, access 6/6,
  ip-connectivity 8/8, ip-services 4/4, security 4/4, automation 2 (+1 blocked).
  `labctl exam compile --allow-missing sim-net-associate` passes; without the flag it fails only on
  `xnt-api-interface-desc`.
- The two `sim-platform-engineer` network tasks (`xpe-net-depot-route`, `xpe-net-edge-nat`, Quillmoor
  `qm-*` estate). The harbour cluster nodes are VMs a netdev router cannot be wired to, so both use
  netsvc stand-ins; persistence is checked (FRR `write memory`, parsed per interface stanza in
  `/etc/frr/*.conf`; nftables: the weight-0 trigger runs `restore-firewall`, which flushes the live
  ruleset and loads `/etc/nftables.nft`, so the functional checks grade the saved file).
- Design notes: `xnt-inter-vlan-annex` uses a netsvc Linux router (the learner creates the 802.1Q
  subinterfaces); `xnt-route-preference-report` keeps `mv-core-21` console-only (a netdev node gives the
  learner vtysh only): the answer file lives on the netsvc host `noc-21`, the core serves
  `show ip route <dest> json` read-only over HTTP, and params `rot`/`fad` permute which destination gets
  the static /24, the static /23 and the floating static (AD 90 or 250); `xnt-json-neighbour-export` serves read-only vtysh JSON over
  HTTP from a small python3 server on the core; `xnt-capture-dns-transport` compares the answer file
  with a grader-owned pcap started in setup.
- Verify queue (none run live this wave): every task above per-lab `labctl verify`; first-verify risks
  are the WireGuard/IPsec kernel modules in the user-namespaced netns (net-wireguard-annex-tunnel,
  net-ipsec-partner-tunnel, xnt-wireguard-annex), `ip_gre` and 1400-byte frames on the pod network
  (net-fix-mtu-blackhole, GRE tunnel, not WireGuard), FRR JSON field names
  (`state` DR/Backup/DROther, `ifaceName`), and `show ip route <dest> json` entry layout.

## Round 5 wave 3 (write-only)

- `net-jinja-render-frr` is built (status `built`, not yet verified). Host switched from
  `ansible-ctl:2.21` to `netsvc:1` (curriculum images updated), the same pattern as
  `xnt-render-config-from-yaml`: a Python Jinja2 `render TEMPLATE DATA ROUTER` helper, trim_blocks and
  lstrip_blocks on, configs pasted into the FRR consoles. Three campus routers (north, south, west;
  west has two LANs) plus a preconfigured core. Graded on: the template against the inventory, against
  a hidden second inventory (area 3, different interface counts), the saved files, OSPF Full on every
  adjacency (retry loop), learned LANs and loopbacks, passive LAN interfaces, reachability. The grader
  logic is inline in the three template checks (the hidden inventory exists only while template-generic runs) and all three mutations were smoke-tested locally with
  Python against a sandbox directory. Mutations: hard-coded per-router literals (caught only by the
  hidden inventory), loopback without `ip ospf area`, no passive conditional.
- Drafts (status stays `proposed`) in `docs/handoffs/networking-drafts/`: `net-srlinux-vlan-trunk`,
  `net-jsonrpc-read-state`, `net-jsonrpc-config-change`, `net-gnmi-interface-counters`,
  `xnt-api-interface-desc`, `net-ansible-frr-backup`. All pass `labctl validate`; none has run. They
  use `driver: netdev, image: srlinux:25`, drive the switch with `sr_cli < file` in setup and JSON-RPC
  over plain HTTP (`http://<switch>/jsonrpc`, so no TLS profile or key material is needed; gNMI
  generates a self-signed pair at run time). Nothing was replaced by a Linux-bridge fallback.

### Counts after wave 3

Networking labs in the curriculum: 78 (see `docs/curriculum.md`). verified 25 (3 learn, 5 do,
2 fix, 15 exam), built 47, proposed 6 (the SR Linux set of five and net-ansible-frr-backup). sim-net-associate
pools: fundamentals 6/6, access 6/6, ip-connectivity 8/8, ip-services 4/4, security 4/4, automation 2 runnable
(`xnt-render-config-from-yaml`, `xnt-json-neighbour-export`) + `xnt-api-interface-desc` blocked, against a draw of 1.
`labctl exam compile --allow-missing sim-net-associate` passes; without the flag it fails only on
`xnt-api-interface-desc`. `sim-platform-engineer` does not compile on main (shared `workstation` node differs
between the xpe-iac-* tasks and others; not ours).

### Blockers

| Lab(s) | Blocker | Needed |
|---|---|---|
| net-srlinux-vlan-trunk, net-jsonrpc-read-state, net-jsonrpc-config-change, net-gnmi-interface-counters, xnt-api-interface-desc | `srlinux:25` is a spike (not in `deploy/images/catalog.yaml`, so lab-verify would error), no `netdev: srlinux` driver family (the drafts use `run:` with `sr_cli`), hosted-training EULA decision pending | image + catalog entry + driver family + EULA sign-off |
| net-gnmi-interface-counters (additionally) | `gnmic` is in no image | add gnmic to an image the collector runs |
| net-ansible-frr-backup | `frr:10` has no sshd; `ansible-ctl:2.21` has no `ansible.netcommon` / `frr.frr` collections; `gitea:1` is not in the catalog (the design uses a local bare repo) | sshd on frr (image rebuild) or the collections mirrored into ansible-ctl |
| net-wireguard-annex-tunnel, net-ipsec-partner-tunnel, xnt-wireguard-annex | host kernel wireguard/xfrm modules inside the user-namespaced netns | first-verify risk, not a blocker |
| xpe-net-depot-route, xpe-net-edge-nat | harbour cluster nodes are VMs; netsvc stand-ins are used for the nodes and the Ingress | none, by design |
| shipment-operator-crd (k8s-admin) | operator simulated by an admin-container loop (no operator image in `workloadImages`) | optional controller image |

### Verify queue (path order)

1. The wave-1 drafts first (the 22 labs from `net-subnet-east-campus` to `net-qos-voice-priority`) and the
   wave-2 security/VPN labs, then `net-jinja-render-frr`.
2. Pool tasks, so retakes draw fresh tasks: the 16 wave-2 `xnt-*` tasks plus `xnt-json-neighbour-export`, then
   `xpe-net-depot-route` and `xpe-net-edge-nat`.
3. A full `labctl exam run --allow-missing --auto-solve` and `--no-solve` of `sim-net-associate`.
First-verify risks for `net-jinja-render-frr`: OSPF DR election on the broadcast links takes ~40 s (checks
retry up to 100 s), and `ip ospf passive` is read from `show running-config`.
