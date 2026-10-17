# Networking stream handoff

Branch `build/networking`, worktree `/home/hackrvl/cloudtrain/.worktrees/b-networking`.
Paused on 2026-10-14 at the coordinator's request.

## Done

| Lab | Status | Notes |
|---|---|---|
| net-osi-capture-walkthrough | **verified** | 2 seeds + 2 mutations pass; report `deploy/.results/verify/net-osi-capture-walkthrough.json` |
| net-arp-neighbour-tables | **verified** | 2 seeds + 2 mutations pass; report committed |
| everything else (74 labs) | proposed | see "In flight" and "Not started" |

Other commits on the branch:

- `content/skills.yaml`: the 23 `net.*` skills promoted from the curriculum
  `newSkills` list (lab checks may only use graph skills), and removed from
  `newSkills` in `content/curriculum.yaml`; `net.troubleshooting` competency no
  longer marked `new`. `content/frameworks/ccna.yaml` maps the new skills onto
  the ccna objectives.
- Image `netsvc:1` (see Images). Its proposal entry was removed from the
  curriculum `images` list (lab-verify warns when a proposed image is in the catalog).
- `content/packs/networking/pack.yaml` (universe, conventions; courses/paths are
  generated from the curriculum for the labs that exist, see `sync_pack.py`).
- `docs/curriculum.md` re-rendered.

## In flight / partial

Drafted but **not yet live-verified** (kept out of `content/` so the curriculum
stays consistent). All are in `docs/handoffs/networking-drafts/<lab>/lab.yaml`
(+ `assets/`). None has been through `lab-verify`/`labctl validate` except
net-subnet-east-campus, net-fix-library-mask, net-ipv6-dual-stack-office,
net-read-routing-table and net-static-routes-campuses (static checks clean at the
time; some edited afterwards).

| Draft | Needs platform L2 fix (P1/P2)? | Notes |
|---|---|---|
| net-subnet-east-campus | no | was waiting for a pod slot when paused; validated statically |
| net-fix-library-mask | no | proxy-ARP misconception uses `ip neigh add proxy` (untested; sysctls are read-only) |
| net-ipv6-dual-stack-office | **yes (switch)** | hosts use `dhcpcd` on netsvc for SLAAC because accept_ra=0 cannot be changed (P4) |
| net-read-routing-table | no | |
| net-static-routes-campuses | no | "installed" check = every `S` line is `S>*` |
| net-fix-unreachable-campus | no | |
| net-vlan-access-ports | **yes** | |
| net-trunk-two-switches | **yes (P1+P2)** | |
| net-fix-native-vlan-mismatch | **yes (P1+P2)** | |
| net-inter-vlan-subinterfaces | **yes (P1+P2)** | Linux router (netsvc) instead of FRR: FRR console cannot create VLAN devices |
| net-rstp-root-bridge | **yes** (BPDUs pass without the fix; host ping needs P1) | kernel bridge STP is 802.1D, mstpd/RSTP impossible in a pod netns (user STP needs init netns) |
| net-fix-broadcast-storm | **yes** | platform round 4 rate-limits every link attachment (10 Mbit/s each way, host side); the draft ran live under it: seed 2 passed 5/5 and the mutation behaved, seed 1 failed `hosts-reachable` right after the solution (reachable again about a minute later: STP and OVN MAC learning still settling); lengthen the solution's wait or retry the reachability check before marking it verified |
| net-lacp-server-uplink | **yes** | LACP negotiation itself works across OVN (spike) |
| net-default-route-edge | no | |
| net-floating-static-backup | no | core uses a BFD-tracked static so the return path fails over (`ip route ... bfd`, untested) |
| net-ipv6-static-routes | no | fixed link-locals fe80::1/::2 added by setup |
| net-ospf-single-area | no | |
| net-ospf-cost-dr-passive | no | |
| net-fix-ospf-adjacency | no | MTU fix is `ip ospf mtu-ignore` (FRR has no interface `mtu` command; netdev shell = vtysh) |
| net-vrrp-gateway-pair | **yes** | setup starts `vrrpd` by hand and creates protodown macvlans with the VIP (FRR wants the VIP on the macvlan) |
| net-dhcp-pools-reservations | no | `assets/dhcp-probe` runs udhcpc with the broadcast flag from a macvlan carrying the printer MAC |
| net-dhcp-relay-campus | no | dnsmasq relay on a netsvc Linux router (FRR has no DHCP relay) |
| net-dns-district-zone | no | BIND on netsvc |
| net-pat-internet-edge | no | nftables on netsvc |
| net-static-nat-timetable | no | `ncat --ssl` serves HTTPS |
| net-fix-nat-inside-outside | no | |
| net-ntp-hierarchy | no | chronyd -x (no SYS_TIME) |
| net-syslog-central | no | link monitor (`ip monitor link | logger`) stands in for router logging |
| net-snmpv3-polling | no | check where `net-snmp-create-v3-user` writes `rouser` on Alpine |
| net-qos-voice-priority | no | prio under the tbf; flood/probe checks rely on checks running in order |

Several labs use "probe/event" checks with weight 0 that generate traffic for a
later check (the grader runs checks in listed order). Confirm the exam engine
keeps that order, or rework them.

## Not started

- Services/security: net-acl-grades-server, net-zone-firewall-edge,
  net-mgmt-plane-hardening, net-hack-open-management, net-wireguard-annex-tunnel,
  net-ipsec-partner-tunnel, net-fix-mtu-blackhole. All feasible on netsvc
  (nftables, sshd, snmpd, wireguard-tools, strongSwan; kernel modules autoload).
- Automation: net-jinja-render-frr, net-ansible-frr-backup,
  xnt-render-config-from-yaml: blocked on `ansible-ctl:2.21`/`gitea:1` and on a
  way to push config into FRR (frr:10 has no sshd; console/ssh access is vtysh
  over k8s-exec). net-jsonrpc-read-state, net-jsonrpc-config-change,
  net-gnmi-interface-counters, net-srlinux-vlan-trunk, xnt-api-interface-desc:
  blocked on `srlinux:25` (no image, EULA pending). Author and mark `built` with
  that note.
- All 32 `xnt-*` exam tasks. Coordinator rules (exam engine): one exam pool each;
  statement names the device; nodes/links shared between tasks must be identical
  (same name, image, link endpoints; `labctl exam compile` enforces it); task-specific
  addressing/config; checks grade end state only; no hints. sim-net-associate is
  `environment: shared`. Plan: give each task its own device names (only
  `workstation` shared) unless a canonical shared core with a fixed interface plan
  is designed first. Once main has the engine, also run `labctl exam run
  --auto-solve` (expect 100%) and `--no-solve` (expect fail).

## Next steps, in order

1. Merge `main` (other streams and the exam engine may have landed).
2. Redeploy the scoped manager (see "How to resume"); load `cloudtrain/netsvc:1`
   into kind if missing (`bash tools/images/netdev/build.sh netsvc`).
3. Verify the non-L2 drafts one by one: copy `docs/handoffs/networking-drafts/<lab>`
   to `content/packs/networking/labs/`, stage, verify, fix, commit (path order:
   subnet-east-campus, fix-library-mask, read-routing-table,
   static-routes-campuses, fix-unreachable-campus, default-route-edge,
   floating-static-backup, ipv6-static-routes, ospf-single-area,
   ospf-cost-dr-passive, fix-ospf-adjacency, dhcp-pools-reservations,
   dhcp-relay-campus, dns-district-zone, pat-internet-edge, static-nat-timetable,
   fix-nat-inside-outside, ntp-hierarchy, syslog-central, snmpv3-polling,
   qos-voice-priority).
4. For L2 labs: either wait for the platform fix (P1/P2) or verify with the
   test-only shim `docs/handoffs/networking-tools/l2shim.sh` running in the
   background, then set status `built` with a note "verified only with OVN L2
   shim; needs platform P1/P2". Do not mark them verified.
5. Write the not-started learning labs, then the exam tasks.
6. Delete `docs/handoffs/networking-drafts/` once every draft is in the pack.

## Images added

- `cloudtrain/netsvc:1` (`tools/images/netdev/netsvc/Dockerfile`, catalog `# netdev`
  section, `tools/images/netdev/build.sh netsvc`): Alpine 3.22 by digest, packages
  pinned: dnsmasq, Kea DHCPv4, BIND + dig, chrony, rsyslog, net-snmp, OpenSSH,
  nftables/iptables, WireGuard tools, strongSwan, bridge/bond/VLAN tooling, tc,
  dhcpcd, curl, ncat, nmap, python3 + Jinja2/PyYAML. Used for Linux routers,
  firewalls, switches and service hosts in place of `deb-sys:24.04` (tier B, not
  available) and `netsvc:1` as proposed. Curriculum `images` fields still list
  `deb-sys:24.04` for those labs (only status lines were edited).

## Platform blockers and bugs (with evidence)

- **P1 and P2 are fixed in the platform (round 3)**: link attachments carry
  `layer2_forward`, link switches get `vlan-passthru=true`; `net-trunk-two-switches`
  passes without `l2shim.sh`. Original findings:
- **P1 - link segments drop unicast to MACs that are not the port's own.**
  Kube-OVN creates link logical switch ports with `addresses: ["<mac> <ip>"]`, no
  `unknown`, so a Linux bridge, bond member, macvlan or VRRP virtual MAC cannot
  receive unicast (ARP replies to a bridged host never arrive). Spike: h1 - bridge
  pod - h2 ping failed; after `ovn-nbctl lsp-set-addresses <lsp> "<mac> <ip>" unknown`
  on every link port it worked. Fix: annotate wired pods with
  `<nad>.<ns>.ovn.kubernetes.io/layer2_forward: "true"` per link attachment
  (Kube-OVN v1.16 `Layer2ForwardAnnotationTemplate`, calls `EnablePortLayer2forward`).
  Blocks every switch/VLAN/STP/LACP/VRRP lab and any LAN with more than two
  devices.
- **P2 - link segments drop 802.1Q-tagged frames.** Tagged frames left the trunk
  port but never arrived; `ovn-nbctl set Logical_Switch <ls> other_config:vlan-passthru=true`
  fixed it. Needed for trunks and router-on-a-stick.
- **P3 and P4 are fixed in the platform (round 4)**: the entry NetworkPolicy of a
  wired entry carries `ovn.kubernetes.io/network_policy_for: ovn` (plus the access
  NAD when the lab has VMs), so it no longer filters link attachments; wired pods
  run in a user namespace with an unmasked `/proc` in the node container, so
  network sysctls (`ip_forward`, `rp_filter`, `accept_ra`, `proxy_arp`, ...) are
  writable by root in the node (host-wide ones stay read-only), and
  `ping_group_range` lets the learner ping without NET_RAW. The unwired-workstation
  workaround and the dhcpcd SLAAC workaround are no longer required. Original findings:
- **P3 - a wired entry node gets the entry NetworkPolicy**, and Kube-OVN applies
  it to its link attachments too, so unicast IP to that node over lab links is
  dropped (seen when the entry defaulted to a bridge node:
  `ls_out_acl_eval ... outport == @ct.<hash>.entry...` in `ovn-trace`). README says
  wired pods get no NetworkPolicy. Workaround used: always an unwired `workstation`
  jumphost as entry.
- **P4 - `/proc/sys` is read-only in node containers**, so labs cannot change
  sysctls (`ip_forward` is 1 everywhere, `accept_ra=0` and `rp_filter=2` on link
  interfaces). Kernel SLAAC, proxy ARP and forwarding toggles are impossible;
  SLAAC labs use dhcpcd as a userspace client.
- Not a bug, a limit: netdev `console`/`ssh`/`shell` access all open vtysh, and
  vtysh has no `start-shell` or interface `mtu`; Linux-level tasks on a router
  need a netsvc Linux router.
- STP: user-space STP (mstpd/RSTP) needs the init netns; pods get kernel 802.1D STP.

## Gotchas and lessons

- The scratchpad is shared between agents: keep everything under
  `<scratchpad>/networking/` (the helper scripts in `networking-tools/` hard-code
  the old path; set `N`/`S` at the top of each before use).
- The pod slots were saturated by other streams for over an hour; a single verify
  can wait that long before starting.
- Setup `run` blocks: start daemons with `setsid ... </dev/null >/dev/null 2>&1 &`
  or the exec never returns. Do not `pkill -f <pattern>` from a check or step:
  the pattern matches the step's own shell.
- `labctl verify` substitutes `{{param}}` but has no arithmetic or filters; compute
  in shell (`Q=$(( {{q}} + 2 ))`).
- Shell-check `expect` compares stdout only; a non-zero exit with matching stdout
  still passes, so print a verdict word.
- `sort -u` of IPs is lexical: choose param ranges so expected orders are stable.
- FRR: `show vrrp summary` (not `brief`); `vrrpd` is off in the image's daemons
  file; the VIP has to be on the macvlan.
- Every lab needs `courses` membership in pack.yaml or `lab-verify --strict`
  warns: run `sync_pack.py` after adding a lab.
- Check skills must exist in `content/skills.yaml`, not only in curriculum newSkills.

## How to resume

```sh
cd /home/hackrvl/cloudtrain/.worktrees/b-networking
git merge main
pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @cloudtrain/lab-schema build
(cd services/lab-orchestrator && make build)
# scoped manager (diff CRDs first; deploy with SKIP_CRDS=1 when there is no diff)
kubectl kustomize services/lab-orchestrator/config/default | yq 'select(.kind == "CustomResourceDefinition")' | kubectl --context kind-cloudtrain-dev diff -f -
ORCH_NAMESPACE=ct-net-system SESSION_SELECTOR=labs.cloudtrain.dev/verify=networking \
  SKIP_CRDS=1 LOAD_LAB_IMAGES=0 bash deploy/scripts/orchestrator-deploy.sh
# static checks
node tools/lab-verify/bin/lab-verify.mjs --strict
services/lab-orchestrator/bin/labctl validate content/packs/networking/labs
# live verify one lab
cd services/lab-orchestrator && /home/hackrvl/cloudtrain/tools/slots/run.sh pod -- \
  bin/labctl verify --context kind-cloudtrain-dev --repo-root ../.. \
  --session-label labs.cloudtrain.dev/verify=networking ../../content/packs/networking/labs/<lab>
```

Helpers (copy to your private scratchpad dir and fix the paths): `stage.sh <lab>`
(draft -> pack, status built, sync pack, static checks), `v.sh <lab>` (live verify
via the pod slot), `finish.sh <lab> verified|built "<msg>" ["note"]` (status,
sync, commit), `setstatus.py`, `sync_pack.py`, `x.sh <ns> <node> <cmd>` (exec in
a lab node), `l2shim.sh` (test-only P1/P2 emulation for this stream's sessions).
