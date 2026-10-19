# Handoff: Linux round 5, wave 4 (networking on VMs: namespaces, firewalls, persistent interfaces, time)

Branch `content/linux-r5-w4`, pack `content/packs/linux`. Source of truth for each lab's state
is `status` / `notes` in `content/curriculum.yaml`. All 23 labs are `built`: written, with the curriculum render checked locally. lab-verify --strict,
labctl validate, the content tests and `labctl exam compile --allow-missing sim-linux-sysadmin` are
pending CI (no labctl binary or built lab-schema locally) and not yet confirmed. None run live.

## Labs

| Group | Labs |
|---|---|
| namespaces, routes, captures (VM, ubuntu-vm) | veth-netns-plumbing, subnet-plan-depots, runtime-routes-two-sites, tcpdump-lost-heartbeats, fix-routing-asymmetric, bridge-vlan-namespaces, mtu-mismatch-tunnel, netem-impaired-link, iperf-throughput-baseline |
| firewalls and NAT | nftables-from-scratch (ubuntu-vm), nat-port-redirect-gateway, firewall-ticket-api, fix-firewall-blocks-app, firewalld-zones-el (el-vm) |
| persistent interfaces and bonds | static-ip-persistent (ubuntu, Netplan), nmcli-bond-el, bond-active-backup (el-vm, NetworkManager) |
| sim-linux-sysadmin networking pool | xlf-static-ip-netplan, xlf-bond-config (ubuntu-vm, shared `workstation` + `tr-ops-01`) |
| time and services | chrony-timezone-depot (ubuntu-vm), chrony-server-isolated (two el-vm), wireguard-depot-tunnel (two ubuntu-vm), dhcp-server-depot (ubuntu-vm, dnsmasq) |

sim-linux-sysadmin networking pool is now 8/8 (draw 4, so 2x); `labctl exam compile
--allow-missing sim-linux-sysadmin` is pending CI. Three courses were added to the pack:
`lsn-netns-routing`, `lsn-firewalls`, `lsn-persistent-net`.

## Design notes

- Every lab is `workstation` (jumphost:1) plus one VM (ubuntu-vm:24.04, or el-vm:10 for the
  Enterprise Linux ones). The VMs have one NIC and no topology links, so every extra host is a
  network namespace on the VM: `depot-a`, `gw`, `depot-b`, `rtr`, `tr-signal-03`, `ops`, `pax`,
  `station`, `office`, ... Descriptions say plainly to work with `sudo ip netns exec <host> ...`.
  eth0, the default route and DNS are never touched. Daemons in namespaces are started with
  `systemd-run --unit ... -p NetworkNamespacePath=/run/netns/<ns>`.
- veth-netns-plumbing: the "package mirror" is a namespace behind the uplink `tt-up` with no route
  back, so a masquerade rule is observable (a service on the VM's own addresses would not show NAT).
- tcpdump-lost-heartbeats: the dropping hop is seeded (`rtr` forward chain or the collector's input
  chain); the learner writes the hop to `~/answers/drop.txt` and saves a capture.
- fix-routing-asymmetric: `eth1`/`eth2` are veth ends into dead-end router namespaces; the field
  client at 10.66.9.20 sits behind `rtr-b`. Fix is a routing table and rule (Netplan `routes: table:` +
  `routing-policy:`, or a networkd drop-in).
- mtu-mismatch-tunnel: GRE to a depot namespace through `isp1`/`isp2` namespaces whose middle segment has
  MTU 1400 and which drops its own ICMP errors (a real PMTU black hole). The tunnel is created by
  `tr-gre.service` from `/etc/default/tr-gre`; persistence is that file (MTU <= 1376) or a saved nft
  MSS clamp. Needs `ip_gre`.
- bridge-vlan-namespaces: all four hosts share one /24, only the PVIDs separate them. Needs `bridge`
  (setup fails with a message otherwise).
- nftables-from-scratch: management stays on `eth0` (`iifname "eth0" accept`), so the workstation
  and the platform are never cut off; persistence is graded by loading `/etc/nftables.conf` in a
  scratch namespace plus `systemctl is-enabled nftables`. The same scratch-namespace trick grades
  `/etc/sysconfig/nftables.conf` on the el-vm labs (nat-port-redirect-gateway, fix-firewall-blocks-app).
- firewall-ticket-api collapsed the el/deb variants to el (firewalld); the deb side is covered by
  xlp-ufw-rules and xlf-firewall-subnet-only. Its permanent config is parsed from
  `firewall-cmd --permanent --list-all-zones`.
- static-ip-persistent: a default route via `eth1` would touch the default route, so the "gateway" is
  used for a backbone route (oneLine rewritten). The switch is the namespace `tr-sw`.
- bond-active-backup (el-vm, nmcli) and xlf-bond-config (ubuntu-vm, Netplan): two veth pairs per task
  whose peers are bridged in a switch namespace; the failover check downs the active port's peer
  (`ip netns exec <sw> ip link set ethNp down`) and pings the switch through the bond. NetworkManager
  is told to manage the veths (`conf.d` snippet, `no-auto-default=*`).
- nmcli-bond-el keeps DHCP and appends with `+ipv4.addresses`; checks use `nmcli -g` only.
- chrony-timezone-depot: `tr-ntp-1` is a second `chronyd -x` (local stratum 8) in a namespace.
  chrony-server-isolated uses two real VMs; an `outsider` namespace on the server runs
  `chronyd -Q` against it to prove the allow list.
- wireguard-depot-tunnel: wireguard-tools is not mirrored, so the tunnel is a systemd-networkd
  `.netdev` (`Kind=wireguard`) with keys from `openssl` (x25519). The reference solution derives
  deterministic test keys from the seeded `salt` (never real secrets); a hidden helper
  `/var/lib/cloudtrain/wgsol.sh` drives the mutations and the key-file alternative. Needs the
  `wireguard` kernel module.
- dhcp-server-depot: dnsmasq is the DHCP server (ISC/Kea not mirrored). The image has no DHCP client,
  so `tr-dhcp-probe` (stdlib Python) sends a DISCOVER from the namespace and prints the offer.

## Blockers and risks (recorded in the curriculum notes)

- iperf-throughput-baseline: unblocked 2026-10-19. `iperf3` is in `tools/mirrors/packages-noble.txt`
  and `packages-el10.txt`, so in the mirror and the VM images' local repos; a full `labctl verify`
  passed on the remote verify VM.
- netem-impaired-link: not blocked. `sch_netem` and `sch_tbf` ship in linux-modules of the ubuntu-vm
  kernel (6.8.0-142-generic), not only in linux-modules-extra; a full `labctl verify` passed on the
  remote verify VM (2026-10-19).
- Kernel modules assumed present, with a clear setup failure otherwise: `ip_gre`, `bridge`,
  `bonding`, `wireguard`, `sch_tbf`.
- Reboot-graded labs check persistence from configuration only, until verify can reboot.

## Not verified (risks for the testing round)

- Namespace plumbing inside KubeVirt VMs (`ip netns`, `systemd-run -p NetworkNamespacePath`).
- NetworkManager vs veth devices on el-vm (managed override, `no-auto-default`), `nmcli device reapply`
  on eth0 in nmcli-bond-el.
- `chronyd -Q` output text (`System clock wrong`) in chrony-server-isolated; `local stratum` becoming
  active quickly enough for the 75 s wait.
- `tr-dhcp-probe` broadcast from an address-less veth; dnsmasq ping-check delay (~3 s) vs the probe timeout.
- networkd creating a WireGuard netdev from files and the exact `PrivateKey=` permission handling.
- Netplan `routes: to: default` with `table:` and `routing-policy:` on Ubuntu 24.04; `netplan set` forms.
- dmesg visibility of nft `log` lines inside the VM (nftables-from-scratch).

## Verify queue

All 23: veth-netns-plumbing, subnet-plan-depots, runtime-routes-two-sites, tcpdump-lost-heartbeats,
fix-routing-asymmetric, bridge-vlan-namespaces, mtu-mismatch-tunnel, netem-impaired-link,
iperf-throughput-baseline, nftables-from-scratch, nat-port-redirect-gateway,
firewall-ticket-api, fix-firewall-blocks-app, firewalld-zones-el, static-ip-persistent, nmcli-bond-el,
bond-active-backup, xlf-static-ip-netplan, xlf-bond-config, chrony-timezone-depot,
chrony-server-isolated, wireguard-depot-tunnel, dhcp-server-depot.

## Review follow-ups

Closed on branch `fix/linux-r5-w4-followups` (still `built`; each changed lab needs a fresh remote verify):

- [x] nmcli-bond-el: the eth0 `ipv6.method` switch is kept; confirm the el-vm:10 default `ipv6.method` on the first remote verify and record it here (open). `dhcp-kept` is gated on the extra address being configured; the solution sets `ipv4.dns-options timeout:1,attempts:1` so an unreachable resolver cannot stall lookups (`ipv4.dns-priority` cannot reorder servers inside one connection, so it was not used).
- [x] chrony-server-isolated: `outsider-refused` needs the probe to run (namespace and config present), no fatal error text, and either "no suitable source" or the timeout line. The `server-persistent`/`allow all` expectFail notes stay as documented.
- [x] wireguard-depot-tunnel: unchanged by design (single-action mutations; listed checks fail, others may too).
- [x] "kept" guards gated on the lab's main change: veth-netns-plumbing host-untouched, subnet-plan-depots / fix-routing-asymmetric / static-ip-persistent / xlf-static-ip-netplan eth0-untouched (and fix-routing-asymmetric eth1-path-kept), runtime-routes-two-sites addresses-kept, tcpdump-lost-heartbeats fault-intact, nmcli-bond-el dhcp-kept, firewalld-zones-el default-zone-kept.
- [x] fix-routing-asymmetric networkd branch: From, Gateway and one single Table must appear in the same networkd file.
- [x] tcpdump-lost-heartbeats: setup fails early when tcpdump is missing; the sender-drop capture must be newer than setup and contain only UDP 5140 traffic.
- [x] nftables-from-scratch: `log-limited` needs `limit rate` before `log prefix "tr-drop: "` on the same rule.
- [x] mtu-mismatch-tunnel: the nft branch ignores comments and requires the maxseg clamp on a `tun-dep` line.
- [x] firewall-ticket-api: `permanent` also requires SSH to stay allowed for both client networks (`ssh-lost` otherwise).
- [x] fix-firewall-blocks-app: `persistent` requires the tablet accept before the 9443 drop (or a negated-source drop), and the 3306 and blocked drops kept.
- [x] bond-active-backup: port profiles must name the bond as master/controller (by name or UUID).
- [x] dhcp-server-depot: policy-rc.d blocks the start on install; `dnsmasq --test` includes `/etc/dnsmasq.d`.
- Earlier self-review (2026-10-19) fixes, kept for the record: nftables-from-scratch pub-ssh-blocked and rest-dropped require the positive state first; netem-impaired-link only-depot-link requires netem on depot0; wireguard-depot-tunnel config-a/config-b parse `Key = value` and comma/space separated AllowedIPs.
