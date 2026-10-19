# CloudTrain on any Kubernetes

Status: design proposal, 2026-10-18. The CNI spike for option (b) passed on
every property (section 8), so the default-network override is the chosen
design and the fallback is not needed. The other decisions in section 7 are
open for the product owner.

Requirement: the platform runs on vCenter (self-managed Kubernetes on vSphere
VMs, or VKS), Azure AKS, AWS EKS, Google GKE and bare metal, not only on the kind
dev cluster.

Today the runtime is kind with Kube-OVN as the primary CNI, Multus, KubeVirt,
CDI, vcluster, local-path storage and the in-cluster mirrors
([dev-environment.md](dev-environment.md), [architecture.md](architecture.md)).
Storage-class independence is being done separately on `feat/storage-agnostic`
(`docs/storage.md` there); section 4 lists what this design needs from it.

Line references are to `main` at `d4de865`.

## Summary

- **The one real blocker is the primary CNI.** The orchestrator puts lab pods'
  and lab VMs' *primary* interface (eth0) on a per-session Kube-OVN subnet with
  the `ovn.kubernetes.io/logical_switch` annotation. That only works when
  Kube-OVN is the cluster's primary CNI, which managed clusters do not allow
  (GKE) or do not support (AKS BYO-CNI, EKS without the VPC CNI).
- **Recommendation:** keep the cloud's CNI as primary and run Kube-OVN in its
  documented *non-primary* mode behind Multus for every lab-facing network.
  Wired lab pods and lab VMs get their eth0 from the session VPC through a
  Multus default-network override (pods) or KubeVirt's `multus.default: true`
  (VMs), so the isolation model of today is kept. The same code path also works
  on clusters where Kube-OVN *is* primary (vCenter, bare metal).
- **Everything else is configuration:** image registry, storage classes,
  Pod Security labels, DNS selectors, RBAC breadth, API-server tuning and the
  install path (a Helm chart plus a prerequisites chart and a `preflight` check).
- **Nested virtualization drives provider choice.** KubeVirt and Kata need
  `/dev/kvm` on workers: easy on vCenter and bare metal, available on AKS
  (Dsv5-class sizes), GKE (nested-virtualization node pools on C3/C4/N4) and,
  since February 2026, EKS on virtual C8i/M8i/R8i-class instances (before that
  only `.metal`). None of the three clouds supports KubeVirt as a product; it
  is self-supported everywhere (section 3).

## 1. Hard-coded dev assumptions

Severity: **B** = blocks a managed cluster, **P** = provider-specific setting
needed, **D** = dev-only (fine for kind, must not leak into the product).

### 1.1 Primary CNI: Kube-OVN

| Where | Assumption | Sev |
|---|---|---|
| `deploy/kind/cluster.yaml:14-16` | `disableDefaultCNI: true`, pod subnet `10.16.0.0/16` (Kube-OVN default) | D |
| `deploy/kind/cluster.yaml:20` | node label `kube-ovn/role: master` on the control plane | D |
| `deploy/scripts/dev-up.sh:50-86` | Kube-OVN installed as the primary CNI; `MASTER_NODES` = the one kind control-plane IP read from Docker (`dev-up.sh:51-53`) | D |
| `services/lab-orchestrator/internal/network/pod.go:21,81` | wired lab pods (topology link ends, netdev) get `ovn.kubernetes.io/logical_switch=<mgmt subnet>`: **eth0 moves into the session VPC**. Needs Kube-OVN as primary | **B** |
| `services/lab-orchestrator/internal/drivers/kubevirt.go:166-169,180,184` | lab VMs: `pod` network with `bridge` binding, eth0 placed on the session lab subnet with `ovn.kubernetes.io/logical_switch` + `ip_address`. Needs Kube-OVN as primary | **B** |
| `deploy/kubevirt/kubevirt-cr.yaml:17-20` | `permitBridgeInterfaceOnPodNetwork: true` (bridge on the pod network only makes sense when the pod network is the lab VPC) | B |
| `services/lab-orchestrator/internal/drivers/labnet.go:3-10,196-218` | per-session `Vpc` + `Subnet` (`kubeovn.io/v1`) for the VM lab network; access attachment as a NAD of `type: kube-ovn` | P |
| `services/lab-orchestrator/internal/network/manager.go:23-24,84-111` | per-session `Vpc`, mgmt `Subnet`, one `Subnet` + NAD per topology link | P |
| `labnet.go:217`, `network/manager.go:92` | NAD config hard-codes `server_socket: /run/openvswitch/kube-ovn-daemon.sock` (Kube-OVN chart default path) | P |
| `services/lab-orchestrator/internal/drivers/labnet.go:37-44` | fixed lab CIDRs `192.168.100.0/24` (lab), `192.168.99.0/24` (access), entry `.5`; reused by every session (VPC isolation) | P (must not overlap node, pod or service CIDRs the entry pod routes to, e.g. an AKS/EKS VNet/VPC in 192.168.0.0/16) |
| `services/lab-orchestrator/internal/network/plan.go:38-46` | reserved `198.18.0.0/15` for link carriers and the mgmt segment | P (same overlap rule) |
| `services/lab-orchestrator/internal/network/pod.go:22-32` | link QoS (`<provider>.kubernetes.io/ingress_rate/egress_rate`) and `layer2_forward` (Kube-OVN >= 1.16) | P |
| `services/lab-orchestrator/internal/drivers/labnet.go:383`, `labpeers.go:116-125` | `ovn.kubernetes.io/network_policy_for` scopes NetworkPolicies to the primary interface: only Kube-OVN reads it | P |
| `services/lab-orchestrator/cmd/manager/main.go:63`, `internal/drivers/links.go:57-90` | vlan-passthru set by `kubectl exec` of `ovn-nbctl` into `kube-system/app=ovn-central` | P |
| `deploy/kube-ovn/values.yaml:10-14` | geneve overlay over the node network; needs UDP 6081 between nodes and underlay MTU headroom | P |
| `content/packs/networking/labs/net-fix-mtu-blackhole/lab.yaml:66-104` (and `ctr-net-mtu-hang`, `net-fix-ospf-adjacency`) | labs assume lab links carry **1400-byte frames**. Kube-OVN's geneve MTU is node MTU minus 100, so GKE's default 1460 VPC MTU gives 1360 and breaks them | P |

### 1.2 Multus

| Where | Assumption | Sev |
|---|---|---|
| `deploy/multus/multus-daemonset-thick.yaml` | vendored thick Multus in `kube-system`; managed clusters may already ship Multus (EKS documents it; GKE has its own multi-network) | P |
| `services/lab-orchestrator/internal/network/pod.go:18,85-97` | `k8s.v1.cni.cncf.io/networks` with an interface name per link end | portable |

### 1.3 KubeVirt, CDI and `/dev/kvm`

| Where | Assumption | Sev |
|---|---|---|
| `deploy/kind/cluster.yaml:22-27`, `deploy/scripts/host-prep.sh:11,36-38` | `/dev/kvm`, `/dev/vhost-net`, `/dev/net/tun` on every node | P (node pool must have nested virt or be metal) |
| `deploy/kubevirt/kubevirt-cr.yaml:14-15` | `useEmulation: false`: no TCG fallback (correct; keep) | portable |
| `deploy/versions.env:15-17` | host cluster pinned to 1.36 because KubeVirt 1.9 supports 1.34-1.36. Managed clusters must be on a KubeVirt-supported minor | P |
| `services/lab-orchestrator/internal/drivers/kubevirt.go:121-123` | DataVolume import with `pullMethod: node` (works with images loaded into kind; on cloud needs node pull credentials for the registry) | P |
| `services/gateway/src/kube/capacity.ts:50`, `deploy/scripts/orchestrator-deploy.sh:51` | KVM nodes found by `devices.kubevirt.io/kvm` allocatable | portable |
| no KubeVirt `nodePlacement` / no virt node pool selector | VMs land on any KVM-capable node; managed clusters need a dedicated virt pool (taint + selector) | P |

### 1.4 User namespaces, privileges and Pod Security

| Where | Assumption | Sev |
|---|---|---|
| `services/lab-orchestrator/internal/drivers/userns.go:67-95`, `cmd/manager/main.go:60,144-160` | `hostUsers: false` when every node's runtime handler reports `features.userNamespaces` (auto-detected, good) | portable |
| `services/lab-orchestrator/internal/network/pod.go:122-131` | wired pods: `hostUsers: false` plus `procMount: Unmasked` (needs the `ProcMountType` feature, beta; off on some managed versions) or else a **privileged** `net-init` | P |
| `services/lab-orchestrator/internal/drivers/netdev.go:66-69` | FRR containers add `SYS_ADMIN` | P |
| session namespace `cloudtrain-sessions` (`Taskfile.yml:198`, `services/gateway/src/config.ts:130`) created without Pod Security labels; kind enforces nothing | privileged init containers are rejected where a cluster enforces `baseline` by default (AKS deployment safeguards, GKE Autopilot, policy add-ons) | P |
| `services/lab-orchestrator/internal/drivers/container.go:68-69,203-205` | `--runtime-class` for Kata is a free string; no check that the RuntimeClass exists or that its handler supports userns | P |

### 1.5 Kernel modules

| Where | Assumption | Sev |
|---|---|---|
| `deploy/scripts/host-prep.sh:13,29-34` | platform modules (`openvswitch geneve vhost_net tun vxlan br_netfilter ip_tables`) loaded by a privileged `docker run` on the host | D (on clusters: node image or a privileged DaemonSet) |
| `deploy/scripts/lab-kernel-modules.txt` (also `tools/verify-vm/install.sh:22` → `/etc/modules-load.d/cloudtrain-labs.conf`) | lab modules: `ip_gre gre ip6_gre wireguard tunnel4 tunnel6 ip_tunnel ipip sit vxlan esp4 esp6 ah4 xfrm_user xfrm4_tunnel xfrm6_tunnel ipcomp 8021q bonding dummy veth sch_netem sch_htb sch_tbf sch_prio sch_fq_codel cls_u32 act_mirred br_netfilter nf_conntrack nf_nat`. Lab pods share the node kernel, and a user-namespaced pod cannot load modules | P |

### 1.6 MetalLB, kubeadm and API-server settings

| Where | Assumption | Sev |
|---|---|---|
| `deploy/images/catalog.yaml:76-80` | MetalLB L2 *inside* kubeadm lab VMs, pool `192.168.100.200-220` on the lab subnet. Works because VMs sit on an OVN L2 segment (ARP for extra IPs); would fail behind masquerade or a cloud VPC that drops unknown IP/MAC pairs | P (keep VMs on an OVN segment) |
| `services/lab-orchestrator/internal/drivers/kubeadm.go:357,391` | kubeadm labs: pod CIDR `10.244.0.0/16`, service CIDR `10.96.0.0/12`. Inside the isolated VPC, so no clash with the host | portable |
| `tools/verify-vm/kind-cluster.yaml:19-38` | host API server, controller-manager and scheduler tuning (`max-requests-inflight 1600`, `kube-api-qps 200`, `concurrent-*-syncs`), kubelet `maxPods: 300`, parallel pulls. Not settable on AKS/EKS/GKE (control plane is managed); `maxPods` is capped per provider (AKS 250, EKS by ENI/prefix delegation, GKE 256) | P |

### 1.7 Images, registries and mirrors

| Where | Assumption | Sev |
|---|---|---|
| `deploy/scripts/orchestrator-deploy.sh:21-41,50-62` | every image (manager, catalog images, containerDisks) is `kind load`ed; `orchestrator-deploy.sh:33` checks `docker.io/<img>` in containerd | D |
| `services/lab-orchestrator/config/manager/manager.yaml:30-31` | `image: cloudtrain/lab-orchestrator:dev`, `IfNotPresent` | D |
| `deploy/images/catalog.yaml` | refs like `cloudtrain/jumphost:1` resolve to `docker.io/cloudtrain/...` unless `--image-registry` is set (`cmd/manager/main.go:50`, `internal/drivers/container.go:151-160`) | **B** |
| `.github/workflows/images.yml:191,197-200` | CI publishes `ghcr.io/<repo>/<name>` with branch/sha/semver tags; the catalog's `cloudtrain/<name>:<tag>` does not map onto that with a plain prefix. Golden containerDisks and linux-pod images are not built in CI at all (`images.yml:1-6`, KVM needed) | **B** |
| `tools/verify-vm/kind-cluster.yaml:2,10-15`, `tools/verify-vm/certs.d/docker.io/hosts.toml` | docker.io pulled through `mirror.gcr.io` via containerd `certs.d` on the nodes. Managed nodes need the same (AKS/EKS/GKE each have their own way) or a pull-through registry | P |
| `deploy/mirrors/mirrors.yaml:198` | registry mirror egress `0.0.0.0/0` except RFC 1918, TCP 443: fails where egress goes through a private proxy or private endpoint | P |
| `deploy/mirrors/mirrors.yaml:187`, `labnet.go:343`, `labpeers.go:136`, `vcluster.go:254` | DNS egress allowed only to `kube-system` pods labelled `k8s-app: kube-dns`. GKE with Cloud DNS (no in-cluster DNS pods) and NodeLocal DNSCache (`169.254.20.10`, AKS/GKE option) are not matched | P |
| `services/lab-orchestrator/internal/drivers/container.go:412`, `labpeers.go:43` | cluster domain `cluster.local` (no flag) | P (rarely changed on managed clusters) |

### 1.8 Ports, exposure and the gateway/web

| Where | Assumption | Sev |
|---|---|---|
| `services/gateway/src/config.ts:125-131` | gateway listens on `127.0.0.1:8787`, uses kube context `kind-cloudtrain-dev`, shells out to `services/lab-orchestrator/bin/labctl` from a repo checkout, reads `content/` from the repo | **B** (no container image, no in-cluster mode) |
| `services/gateway/src/kube/client.ts:12` | `loadFromDefault()` (works in-cluster too, good) | portable |
| `services/gateway/src/app.ts:70` | `trustProxy: '127.0.0.1'` (behind an Ingress the proxy is not loopback) | P |
| `apps/web/vite.config.ts:17-22` | web served by Vite with a dev proxy to the gateway; no static build served anywhere | B |
| `deploy/dev/compose.yaml:18,48,65` | Postgres, Keycloak, Mailpit on loopback ports via Docker Compose | D |
| terminals | exec through the API server (`services/gateway/src/kube/client.ts:101-105`), no lab Service is exposed: portable and keeps learners off the node network | portable |

### 1.9 CRDs, RBAC and install path

| Where | Assumption | Sev |
|---|---|---|
| `Taskfile.yml:180`, `deploy/scripts/orchestrator-deploy.sh:82-100` | CRDs applied with `kubectl apply` from `config/crd` via kustomize + `yq` rewrites; no chart, no upgrade story for CRDs | B |
| `services/lab-orchestrator/config/rbac/role.yaml:7-24` | ClusterRole: create/delete **secrets, pods, services, serviceaccounts** in every namespace | P (scope it) |
| `role.yaml:29-36` | create/delete **namespaces** | P |
| `role.yaml:44-49` | **`pods/exec` cluster-wide** (needed for ovn-central and lab pods) | P |
| `role.yaml:244-260` | `clusterroles`, `clusterrolebindings` with **`bind` and `escalate`** (vcluster installs): effectively cluster-admin | P (the largest security finding for a shared managed cluster) |
| `internal/controller/network_rbac.go:6`, `role.yaml` kubeovn.io | cluster-scoped `vpcs`/`subnets` write | portable |

### 1.10 Other

| Where | Assumption | Sev |
|---|---|---|
| `deploy/scripts/dev-up.sh:39-47`, `deploy/kind/cluster.yaml:5-10` | Docker device-node copying quirks of kind | D |
| `Taskfile.yml:221` | `labctl verify --context kind-<cluster>` | D (needs a `--context` from the caller) |
| `deploy/kube-ovn/values.yaml:24-36`, `tools/verify-vm/kube-ovn-values.yaml` | resource requests tuned for a laptop / one 32-vCPU VM | P |
| `docs/dev-environment.md:778-785` | the existing vCenter notes (vhv.enable, MTU 1600, Harbor, CSI) remain valid and are folded into section 3 | - |

### Top 10

1. eth0 of wired lab pods on a Kube-OVN subnet (`network/pod.go:81`).
2. eth0 of lab VMs on a Kube-OVN subnet, bridge on the pod network (`drivers/kubevirt.go:166-184`, `kubevirt-cr.yaml:20`).
3. Catalog image refs resolve to docker.io; containerDisks are not published anywhere (`catalog.yaml`, `images.yml`).
4. Gateway and web have no deployable form (`gateway/src/config.ts:125-131`, `apps/web/vite.config.ts`).
5. `/dev/kvm` on every node, no virt node pool (`kind/cluster.yaml:22-27`).
6. Lab kernel modules loaded on the host by Docker (`host-prep.sh`, `lab-kernel-modules.txt`).
7. RBAC with `bind`/`escalate` on cluster roles, cluster-wide `pods/exec` and secrets (`role.yaml`).
8. Privileged `net-init` / `procMount: Unmasked` with no Pod Security labels on session namespaces (`network/pod.go:122-131`).
9. Storage class `standard` for CDI scratch and `Filesystem` VM disks (`kubevirt/cdi-cr.yaml:33`, `drivers/kubevirt.go:108,145`; fixed, see [storage.md](storage.md)).
10. Lab content assumes 1400-byte link MTU and fixed `192.168.99/100.0/24` lab CIDRs (`net-fix-mtu-blackhole`, `labnet.go:37-44`).

## 2. CNI design

### What the lab network must keep doing

- Per-session isolation: a lab cannot reach another lab, the platform pod
  network, the host API server, the OVN databases or the internet, except for
  the shared mirrors and DNS where a node is allowed to.
- Identical private IPs in every session (golden snapshots, kubeadm advertise
  addresses, lab content that names IPs).
- True L2 links between any mix of pods, VMs and netdevs, on any nodes: ARP,
  VRRP virtual MACs, bridges and bonds behind a link end (`layer2_forward`),
  802.1Q tags (`vlan-passthru`), MetalLB L2 inside kubeadm labs, per-link rate
  limits out of the learner's reach.
- NetworkPolicies on the entry node and lab peers (primary interface only).

### (a) Kube-OVN stays the primary CNI everywhere (BYO-CNI)

- **AKS:** `--network-plugin none` is a supported cluster mode, but Microsoft
  support does not cover problems caused by the customer's CNI; the customer
  owns the CNI's lifecycle and IPAM
  ([AKS BYO CNI](https://learn.microsoft.com/en-us/azure/aks/use-byo-cni)).
- **EKS:** the VPC CNI can be removed and replaced; AWS supports only the VPC
  CNI and points to the vendor for others. With an overlay CNI the managed
  control plane cannot route to pod IPs, so every admission webhook and
  aggregated API (KubeVirt, CDI, Multus, the orchestrator's own webhooks if any)
  must run with `hostNetwork`. EKS Auto Mode does not allow a custom CNI
  ([EKS alternate CNIs](https://docs.aws.amazon.com/eks/latest/userguide/alternate-cni-plugins.html)).
- **GKE:** no supported way to replace the dataplane on GKE Standard;
  Autopilot is out entirely.
- Verdict: works on vCenter and bare metal (where it is the plan today), is
  "unsupported but possible" on AKS, painful on EKS and impossible on GKE. It
  fails the requirement.

### (b) Cloud CNI primary, Kube-OVN non-primary behind Multus (recommended)

Kube-OVN documents a non-primary mode (`--non-primary-cni-mode=true`, chart
value `cni.nonPrimaryCNI` / `cni_conf.NON_PRIMARY_CNI`): another CNI owns eth0,
Kube-OVN serves NADs of `type: kube-ovn`, and secondary interfaces keep VPCs,
subnets, QoS, security groups and NAT gateways
([Kube-OVN non-primary mode](https://kube-ovn.readthedocs.io/zh-cn/latest/en/start/non-primary-mode/)).
Secondary networks do not take part in Service load balancing or DNS, which is
what the lab network wants anyway.

What changes per piece:

| Piece | Today | Under (b) |
|---|---|---|
| Wired lab pods (link ends, netdev) | eth0 on the session mgmt subnet via `logical_switch` | **eth0 still on the session mgmt segment**, via the Multus default-network override `v1.multus-cni.io/default-network: <ns>/<mgmt NAD>` ([Multus how-to](https://github.com/k8snetworkplumbingwg/multus-cni/blob/master/docs/how-to-use.md)). The pod never touches the cloud network, so isolation is unchanged and no NetworkPolicy is needed. Link ends stay NAD attachments as today. HTTP/TCP probes from the kubelet would not reach these pods; they have none today (exec only) and must keep it that way |
| Lab VMs | `pod` network + bridge + `logical_switch` | `networks: [{name: default, multus: {networkName: <lab NAD>, default: true}}]` with bridge binding ([KubeVirt interfaces and networks](https://kubevirt.io/user-guide/network/interfaces_and_networks)); fixed IP through `<provider>.kubernetes.io/ip_address`. `permitBridgeInterfaceOnPodNetwork` is no longer needed. MetalLB L2 inside kubeadm labs keeps working (still an OVN L2 segment) |
| Entry node | eth0 on the platform network (Kube-OVN default subnet) + access NAD | eth0 on the cloud CNI + the same access NAD. Its NetworkPolicy is enforced by the cloud's policy engine on eth0 only, so `network_policy_for` becomes unnecessary (the P3 problem disappears by construction) |
| Lab peers (unwired container nodes) | eth0 on the platform network, headless Service, `ct-<hash>-peers` policy | unchanged, enforced by the cloud policy engine. Requires network policy to be **enabled** on the cluster (AKS: Cilium or Azure NPM; EKS: VPC CNI `enableNetworkPolicy`; GKE: Dataplane V2 or Calico policy) |
| vclusters | platform network | unchanged |
| Link QoS, `layer2_forward`, `vlan-passthru` | Kube-OVN annotations + `ovn-nbctl` exec | unchanged (Kube-OVN still owns these ports; QoS on secondary interfaces is documented) |
| Kube-OVN footprint | CNI for everything | ovn-central (3 replicas for raft on production), `ovs-ovn` and `kube-ovn-cni` DaemonSets on lab nodes only (node selector), geneve UDP 6081 open between lab nodes in the NSG / security group / firewall rule; the `openvswitch` and `geneve` modules on the node image |
| Clabernetes (not built yet) | n/a | its launcher pods use VXLAN over the primary network; independent of this choice |

Work and risks:
- A spike must prove two things not stated in Kube-OVN's page: a `kube-ovn` NAD
  used as the Multus *default* network in non-primary mode (pods), and KubeVirt
  `multus.default` on a Kube-OVN NAD with a fixed IP and bridge binding (VMs).
  **Both proven** on a kind emulation, 2026-10-18 (section 8).
  KubeVirt + Kube-OVN secondary NICs are documented; the default-network case
  is the one to prove. Fallback if it fails: eth0 on the cloud network with a
  deny-all NetworkPolicy, and the lab segment as `net1` (VMs then need cloud-init
  to make `net1` their default route, and lab content that says `eth0` changes).
- MTU: underlay MTU must be at least 1500 so geneve leaves 1400 for links
  (GKE: create the VPC with MTU 1500 or 8896; AWS 9001 and Azure 1500 are fine).
- The code change is contained: `network/pod.go` (annotation), `drivers/kubevirt.go`
  (networks stanza), `drivers/labnet.go` (lab subnet gets a provider + NAD), a
  `--primary-cni=kube-ovn|other` flag only where behaviour must differ (the
  default-network annotation also works when Kube-OVN is primary, so the flag may
  not be needed at all).

### (c) Other options

| Option | Verdict |
|---|---|
| OVN-Kubernetes secondary networks (layer2 topology, UDNs) | Multi-homing and UDNs require OVN-Kubernetes as the *primary* CNI, so it has the same problem as (a) and a rewrite of the network code on top |
| Plain `bridge` / `macvlan` / `ipvlan` NADs | `bridge` is node-local (no cross-node L2 without our own VXLAN mesh); `macvlan`/`ipvlan` need an L2 underlay, and cloud VPCs drop frames from unknown MACs/IPs. No VPC isolation, no QoS. Only usable for single-node labs |
| GKE multi-network (`Network`/`GKENetworkParamSet`) or AWS/Azure secondary ENIs/NICs | Each secondary network is a real cloud VPC subnet: L3 only, no arbitrary MACs, not per session at our churn rate. Unfit for lab links |
| Point-to-point VXLAN pairs per link (the Clabernetes approach) | Works over any CNI for netdev links, but no isolation VPC, no VM lab subnet, no MetalLB L2. Good for Clabernetes topologies, not a general replacement |
| Calico/Cilium as the only CNI | no multi-network L2 segments; would need (c)-bridge plus our own overlay |

### Recommendation

(b), with one code path for every provider: lab-facing interfaces always come
from Kube-OVN NADs through Multus, whatever the primary CNI is. On vCenter and
bare metal Kube-OVN may still be the primary CNI (one fewer component, its
NetworkPolicy engine), but the orchestrator no longer depends on it.
Trade-offs: one more moving part on managed clusters (two CNIs), Kube-OVN on
managed clusters is a self-supported component (as KubeVirt is), and the spike
above is the critical path.

## 3. Provider support matrix

Legend: **[V]** verified in this repo (kind dev cluster or the verify VM);
**[D]** from the provider's documentation (URL given, read 2026-10);
**[U]** unconfirmed or inferred, to be settled by `labctl preflight` on a real
node pool. Prices are US East, Linux, on-demand, 2026-10. The verify VM was
unreachable while this was written (AZ move), so no new node experiments were run.

### 3.1 Compute: nested virtualization, KubeVirt, Kata

| | vCenter | AKS | EKS | GKE | Bare metal |
|---|---|---|---|---|---|
| `/dev/kvm` on nodes | Worker VMs with "Expose hardware assisted virtualization" (`vhv.enable`), HW version >= 9, EVC keeping VMX [D] ([vSphere docs](https://docs.vmware.com/en/VMware-vSphere/7.0/com.vmware.vsphere.vm_admin.doc/GUID-2A98801C-68E8-47AF-99ED-00C63E4857F6.html)); same model as WSL2 on the dev box [V]. VKS-managed node VMs: setting vhv not confirmed [U], self-managed K8s on vSphere VMs recommended | Sizes whose page lists "Nested Virtualization: Supported", e.g. **Standard_D8s_v5** [D] ([Dsv5](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dsv5-series)); Trusted Launch / confidential sizes not assumed [U] | Since 2026-02: **virtual** C7i/C8i, M7i/M8i, R7i/R8i (and -flex/-d), X8i, I7i with `NestedVirtualization=enabled` CPU option, no extra cost [D] ([EC2 nested virt](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html)). Managed node groups via launch template: fixed per [containers-roadmap#2784](https://github.com/aws/containers-roadmap/issues/2784) [U]; Karpenter not yet. Otherwise `.metal` | Standard node pool with `--enable-nested-virtualization` (set at creation), C3/C4/N4 examples, not E2/AMD/Arm (except N4D), **pods must be privileged**, blocked by the org policy "Disable VM nested virtualization" [D] ([GKE nested virt](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/nested-virtualization), [GCE overview](https://docs.cloud.google.com/compute/docs/instances/nested-virtualization/overview)). Autopilot via ComputeClass on recent versions [D, version unclear] | native |
| KubeVirt stance | Works nested; VMware supports third-party hypervisors in guests only for Hyper-V VBS, so **unsupported by VMware** [D] | "Not an officially supported AKS add-on" but documented by the AKS team on D4s_v5 [D] ([AKS blog](https://blog.aks.azure.com/2026/02/06/kubevirt-on-aks)) | No AWS doc; community guide on metal [D] ([kubevirt.io](https://kubevirt.io/2023/KubeVirt-on-autoscaling-nodes.html)); Red Hat OpenShift Virtualization GA on ROSA metal [D] | Nested virt documented, QEMU/Kata **not covered by Google support** [D] | upstream-supported, best performance |
| Kata | kata-deploy on vhv workers [U] | **Pod Sandboxing**, RuntimeClass `kata-vm-isolation`, Azure Linux nodes only, Gen2 nested-virt sizes, no Trusted Launch/FIPS [D] ([Pod Sandboxing](https://learn.microsoft.com/en-us/azure/aks/use-pod-sandboxing)); GA wording not confirmed [U] | kata-deploy on metal [D] ([AWS blog](https://aws.amazon.com/blogs/containers/enhancing-kubernetes-workload-isolation-and-security-using-kata-containers/)); on nested-virt C8i/M8i [U] | GKE Sandbox is gVisor, not Kata [D]; kata-deploy on nested-virt pools possible, unsupported [U] | kata-deploy [D] |
| Recommended lab node | 8-16 vCPU / 32-64 GiB worker VMs on a dedicated virt pool | D8s_v5 (8/32), $0.384/h, Spot ~$0.08 | m8i.2xlarge (8/32) $0.423/h, c8i.2xlarge (8/16) $0.375/h; smallest x86 metal ~$3.9/h | C3/N4 8 vCPU, ~$0.35-0.40/h [U] | - |

### 3.2 Storage

| | vCenter | AKS | EKS | GKE | Bare metal |
|---|---|---|---|---|---|
| CSI / default class | vSphere CSI, admin-named classes from storage policies [D] | Azure Disk CSI, `managed-csi` default [D] ([AKS storage](https://learn.microsoft.com/en-us/azure/aks/concepts-storage)) | EBS CSI is an **add-on**; since 1.30 **no default class** [D] ([EBS CSI](https://docs.aws.amazon.com/eks/latest/userguide/ebs-csi.html)) | PD CSI, `standard-rwo`/`premium-rwo`; C3/C4/N4 need Hyperdisk (`hyperdisk-balanced`) [D] ([PD CSI](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/gce-pd-csi-driver)) | operator's choice (Ceph RBD, Longhorn, TopoLVM); kind: local-path [V] |
| RWO / RWX | RWO; RWX via vSAN File Service | RWO disk; RWX via Azure Files | RWO; RWX via EFS | RWO; RWX via Filestore | per CSI |
| Block mode for KubeVirt | Filesystem recommended (see `docs/storage.md` on `feat/storage-agnostic`) [U] | yes [U] | yes [D] | yes [U] | per CSI |
| Snapshots (CDI smart clone) | yes, CSI >= 2.5 [D] | snapshot controller via `--enable-snapshot-controller` [D] | snapshot controller add-on required [D] | yes [D] | per CSI |
| CSI volume clone | **no** (snapshot only) [D, driver source](https://github.com/kubernetes-sigs/vsphere-csi-driver) | yes [D] ([CSI drivers](https://learn.microsoft.com/en-us/azure/aks/csi-storage-drivers)) | yes, same AZ, recent driver versions [D] ([EBS volume clones](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-ebs-volume-clones-instant-volume-copies)) | yes, same zone [D] | per CSI |

### 3.3 Networking and exposure

| | vCenter | AKS | EKS | GKE | Bare metal |
|---|---|---|---|---|---|
| Primary CNI | Kube-OVN (primary or non-primary) | Azure CNI (overlay / powered by Cilium); BYO-CNI possible but CNI unsupported by Microsoft [D] ([BYO CNI](https://learn.microsoft.com/en-us/azure/aks/use-byo-cni)) | VPC CNI only supported CNI; alternates allowed with partner support; **Auto Mode forbids alternates** [D] ([alternate CNIs](https://docs.aws.amazon.com/eks/latest/userguide/alternate-cni-plugins.html)) | Dataplane V2 (Cilium); not replaceable [U] | Kube-OVN |
| Multus | install | install (no official doc) [U] | install; VPC CNI multi-NIC exists for ENIs [D] ([multi NIC](https://docs.aws.amazon.com/eks/latest/userguide/pod-multiple-network-interfaces.html)) | Google documents Multus + ipvlan [D] ([GKE Multus](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/multus-ipvlan-whereabouts)); GKE multi-network is L3 [D] | install |
| Kube-OVN non-primary | n/a or yes | yes [U; mechanism V on kind + Cilium, section 8] | yes [U; mechanism V, section 8] | yes, Ubuntu nodes [U; mechanism V, section 8] | n/a or yes |
| Calico primary (kind `managed-cni-calico`) | n/a | BYO-CNI option | alternate CNI option | n/a | n/a; verified on kind only [V, section 10] |
| Underlay MTU for 1400-byte lab links | port group MTU >= 1600 recommended [V, dev-environment.md] | 1500 [U] | 9001 [U] | default 1460: **set VPC MTU 1500 or 8896** [U] | >= 1500 |
| NetworkPolicy engine | Kube-OVN | Cilium / Azure NPM | VPC CNI `enableNetworkPolicy` must be on [U] | Dataplane V2 | Kube-OVN |
| LoadBalancer | NSX / Avi on VKS, else MetalLB or kube-vip [U] | Azure LB | AWS LB Controller (NLB) [U] | native | MetalLB |
| Ingress | Gateway API (Envoy Gateway, Traefik, NSX) | App Routing NGINX gets security patches only to Nov 2026, Gateway API (Istio-based) mode or App Gateway for Containers [D] ([migration](https://learn.microsoft.com/azure/aks/app-routing-nginx-to-gateway-api-migration)) | AWS LB Controller ALB (Ingress / Gateway) [U] | GKE Gateway controller [U] | Gateway API implementation of choice |

ingress-nginx is retired upstream since March 2026 ([kubernetes.io](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)):
the chart targets Gateway API `HTTPRoute` first, Ingress as a fallback.

### 3.4 Node OS: user namespaces and kernel modules

User namespaces are GA in Kubernetes 1.36; they need kernel >= 6.3,
containerd >= 2.0 (or CRI-O >= 1.25) and runc >= 1.2, and do not work on NFS
volumes [D] ([user namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)).
The orchestrator already auto-detects support per runtime handler [V].

| | vCenter / bare metal (Ubuntu 24.04) | AKS | EKS | GKE |
|---|---|---|---|---|
| userns | yes (as the verify VM) [V] | K8s >= 1.33 on Azure Linux 3 or Ubuntu 24.04 [D] ([AKS](https://learn.microsoft.com/en-us/azure/aks/secure-container-access)) | AL2023 AMI for 1.36: kernel 6.18, containerd 2.2, runc 1.3 [U] ([AWS builder post](https://builder.aws.com/content/3F7xMMfym9HPoYxY8aYz7dMkY2w/amazon-eks-and-amazon-eks-distro-now-support-kubernetes-136)); Bottlerocket [U] | >= 1.33 reported [U] |
| Lab modules (`lab-kernel-modules.txt`) | loaded on the Ubuntu verify VM via `/etc/modules-load.d` (`tools/verify-vm/install.sh:22`) [V]; WSL2 kernels lack some [V] | Ubuntu: yes [U]; Azure Linux 3 [U] | AL2023 moved many modules to `kernel-modules-extra`, not installed by default [D] ([AL2023 notes](https://docs.aws.amazon.com/linux/al2023/release-notes/relnotes-2023.2.20231018.html)); Bottlerocket immutable [U]. Use Ubuntu EKS AMIs or a custom AMI | COS kernel is locked down, module loading restricted by LoadPin/signing [D] ([COS modules](https://docs.cloud.google.com/kubernetes-engine/security/secure-modules-cos)); **use Ubuntu node images** |
| openvswitch + geneve (Kube-OVN) | yes [V] | Ubuntu yes [U] | Ubuntu yes [U] | Ubuntu yes [U]; COS [U] |

### 3.5 Control plane

| | vCenter | AKS | EKS | GKE | Bare metal |
|---|---|---|---|---|---|
| Control plane price | own VMs | Free tier $0, Standard $0.10/h [D] ([pricing tiers](https://learn.microsoft.com/en-us/azure/aks/free-standard-pricing-tiers)) | $0.10/h [D] ([EKS pricing](https://aws.amazon.com/eks/pricing/)) | ~$0.10/h with a monthly credit covering one zonal cluster [U] | own nodes |
| API-server flags (`max-requests-inflight` etc.) | settable | no | no (provider scales) | no | settable |
| K8s minor vs KubeVirt 1.9 (1.34-1.36) | choose | choose a supported minor | choose | choose | choose |

## 4. Storage-class independence (for the storage agent to cross-check)

Storage independence (`docs/storage.md`, `internal/drivers/storage.go`)
covers most of this. Requirements from this design:

1. No class name in code, CRs, content or charts: `deploy/kubevirt/cdi-cr.yaml:33`
   (`scratchSpaceStorageClass: standard`) moves to dev-up only (done).
2. VM disks: volume mode from the CDI StorageProfile by default, `Block` where the
   class supports it (Azure Disk, EBS, PD), `Filesystem` on vSphere CSI (done:
   `--vm-disk-volume-mode`).
3. RWO only. Live migration (RWX) is not required; a node drain stops the lab
   VM (hibernate semantics). Charts must not request RWX.
4. `WaitForFirstConsumer` classes must work (EBS, PD, Azure Disk, vSphere with
   topology): the CDI `HonorWaitForFirstConsumer` gate is already on.
5. Zonal disks: a persistent VM disk pins the VM to one zone. Virt node pools
   must have capacity in every zone used, or be single-zone.
6. Future golden-image clones (architecture: golden snapshots): CDI smart clone
   needs VolumeSnapshot CRDs + a snapshot class (an add-on on AKS and EKS); CSI
   clone needs the driver's clone support. Azure Disk, PD and recent EBS drivers
   clone (same zone); **vSphere CSI does not**, so CDI falls back to snapshot or
   host-assisted copy there. Preflight should report snapshot/clone support per
   class rather than assume it.
7. Preflight (branch: `--storage-preflight`) should be part of `cloudtrain
   preflight` (section 5), plus: a default class exists, the VM class supports
   the chosen volume mode, CDI StorageProfile is complete for it.
8. Mirrors: `deploy/mirrors/mirrors.yaml:76-78,122-124` PVCs take the default
   class; the Helm chart exposes `storageClass` for them too.

## 5. Packaging

### Charts

- **`cloudtrain-prereqs`** (or a documented guide for clusters where the
  platform team owns add-ons): KubeVirt operator + CR, CDI operator + CR,
  Multus thick (skipped when the provider ships one), Kube-OVN in non-primary
  mode with its node selector, optional kata-deploy + RuntimeClass, optional
  lab-module DaemonSet (writes `/etc/modules-load.d` and runs `modprobe` on lab
  nodes where the node image allows it). Each component can be turned off
  (`kubevirt.enabled`, `kubeovn.mode=primary|secondary|off`, ...).
- **`cloudtrain`**: lab-orchestrator (CRDs in `crds/` plus an upgrade hook or
  a separate `cloudtrain-crds` chart, since Helm does not upgrade `crds/`),
  gateway, web (static build behind the gateway or nginx), mirrors (content,
  zot, Gitea), image catalog ConfigMap with a registry/ref mapping, session
  namespace with Pod Security labels, Ingress/Gateway API route for gateway+web,
  NetworkPolicies, PDBs, ServiceMonitors. External Postgres and IdP by default
  (in-chart Postgres only for demos).
- **Values profiles:** `values-vcenter.yaml`, `values-aks.yaml`,
  `values-eks.yaml`, `values-gke.yaml`, `values-baremetal.yaml`,
  `values-kind.yaml`. They set storage classes and volume mode, registry,
  runtime class, primary-CNI mode, node selectors/tolerations for the virt pool,
  DNS selector, ingress class, and the Kube-OVN underlay MTU.
- **Images:** publish every catalog image and containerDisk to one registry
  (GHCR for public images, plus a mirroring step into ACR/ECR/Artifact
  Registry/Harbor), and replace the free-form `--image-registry` prefix with a
  catalog overlay generated at release time (`ref -> registry/name@digest`).
  ContainerDisks need a KVM-capable builder (the verify VM or a self-hosted
  runner).

### `cloudtrain preflight`

A `labctl preflight` subcommand (same binary the verifier uses), runnable
against any kubeconfig and as a Helm test. Each check reports pass, warn or
fail with the fix:

| Check | How |
|---|---|
| KVM | nodes with `devices.kubevirt.io/kvm` > 0 (after KubeVirt); before KubeVirt, a short privileged Job per node pool testing `/dev/kvm` and `kvm_intel/kvm_amd nested` |
| Kernel modules | Job per lab node pool: `modprobe -n` + `/sys/module` for the platform list and `lab-kernel-modules.txt`; reports which labs would fail |
| CNI | Multus present; Kube-OVN mode and version (>= 1.16 for `layer2_forward`); a throwaway VPC + two pods on different nodes exchanging 1400-byte frames over a link NAD; geneve port reachable |
| NetworkPolicy | a deny-all policy actually blocks traffic (catches EKS without `enableNetworkPolicy`) |
| DNS | DNS pods match the selector the policies use, or a configured alternative (Cloud DNS, NodeLocal DNS) |
| CIDR overlap | node, pod and service CIDRs vs `192.168.99.0/24`, `192.168.100.0/24`, `198.18.0.0/15` |
| StorageClass | default class, configured classes exist, volume mode, snapshot class, CDI StorageProfile complete (from the storage branch) |
| User namespaces | `runtimeHandlers[].features.userNamespaces` on lab nodes (the existing `DetectUserNamespaces`), `ProcMountType` usable (dry-run pod) |
| RuntimeClass | configured RuntimeClass exists and its handler is on the lab nodes |
| Pod Security / admission | session namespace accepts a privileged `net-init` (server-side dry-run), no policy engine rejects it |
| Registry | every catalog image resolvable from a node (dry-run pull Job) |
| Versions | Kubernetes minor within the KubeVirt/CDI support range |

## 6. Test strategy

| Tier | What | Where | Cost |
|---|---|---|---|
| 0 | Unit + `make generate` + `labctl validate` (today) | GitHub CI | free |
| 1 | **kind profiles**: `kubeovn-primary` (today); `cilium-primary` (Cilium as eth0, Multus, Kube-OVN non-primary: emulates AKS Azure CNI powered by Cilium and GKE Dataplane V2); `kindnet-primary` + kube-network-policies (emulates a plain non-overlay CNI with a separate policy engine, close to EKS VPC CNI); every profile with the default class renamed (not `standard`), no API-server flags, Pod Security `baseline` on everything except session namespaces, catalog from a registry instead of `kind load` | ct-testvm (KVM), nightly and on network-code PRs | VM already paid for |
| 2 | **Conformance suite**: `labctl preflight` + a fixed smoke set of `labctl verify` labs, one per feature: tier-A userns container, wired GRE/MTU lab, IPsec, bonding/VLAN, VM, kubeadm + MetalLB, vcluster, FRR netdev, persistent VM hibernate/resume. Runs against any kubeconfig | any cluster | - |
| 3 | **Short-lived real clusters**: OpenTofu modules (the repo already ships the IaC toolchain) create AKS/EKS/GKE with one system node and two nested-virt workers, install prereqs + chart with the provider profile, run tier 2, destroy. Weekly per provider and before releases; manual trigger on CNI/storage PRs | cloud accounts | About **$2-2.50 per provider per 2-hour run** on demand (6.1); ~$6-7 for all three |

vCenter and bare metal: tier 2 against a standing staging cluster once one
exists (vCenter details are still open in [tracker.md](tracker.md)).

### 6.1 Cost of a real-cloud run

Assumed run: 2 hours wall clock (create ~15 min, prereqs + chart ~15 min, smoke
set ~60 min, destroy ~15 min), one small system node and **two 8 vCPU
nested-virt workers**, on-demand, US East.

| Provider | Per hour | Per 2 h run |
|---|---|---|
| AKS | control plane $0 (Free tier) + 2 × D8s_v5 $0.384 + system D4s_v5 ~$0.19 [U] + disks/LB/public IP ~$0.10 [U] ≈ **$1.06** | **≈ $2.10** |
| EKS | control plane $0.10 + 2 × m8i.2xlarge $0.423 + system t3.medium ~$0.04 [U] + NLB/EBS/NAT ~$0.15 [U] ≈ **$1.14** | **≈ $2.30** |
| GKE | control plane covered by the free credit (one zonal cluster) [U] + 2 × C3/N4 8 vCPU ~$0.38 [U] + system e2-standard-2 ~$0.07 [U] + disks/LB ~$0.10 [U] ≈ **$0.93** | **≈ $1.90** |

All three ≈ **$6-7 per run** (budget $10 for retries and leftovers); weekly
≈ $30-40/month. Spot workers (Azure D8s_v5 Spot ~$0.08/h) cut compute by
~70-80% at the price of eviction retries. EKS on metal instead of nested virt
(smallest x86 metal ~$3.9-4.8/h) would cost ~$17-20 per run. Image egress is
free from GHCR; containerDisk pulls (several GB) add time, not cost. The
biggest cost risk is a cluster that is not destroyed: the job tags everything
with the run id, and a scheduled janitor deletes anything older than 6 hours.

## 7. Decisions for the user

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Primary CNI model | (a) Kube-OVN primary everywhere; (b) cloud CNI primary + Kube-OVN non-primary via Multus; (c) other | **(b)**, one code path on every provider; Kube-OVN may stay primary on vCenter/bare metal |
| 2 | Wired pods and VMs: eth0 in the session VPC (default-network override) or eth0 on the cloud network + lab `net1` | override / net1 | **Override**, keeps today's isolation and lab content; net1 only as the fallback if the spike fails |
| 3 | Provider order | - | **vCenter and bare metal first** (no CNI or nested-virt limits), then **AKS** (nested virt on common SKUs, Pod Sandboxing for Kata, Ubuntu nodes with all modules), then **GKE** (Ubuntu node image + nested-virt node pools, privileged virt pods; COS cannot load lab modules), **EKS last** (nested virt on C8i/M8i is new and not yet wired into managed node groups/Karpenter; AL2023 lacks lab modules by default) |
| 4 | Node image on managed clusters | provider default (COS, Bottlerocket, Azure Linux, AL2023) / Ubuntu | **Ubuntu** node images for lab pools on every provider (module coverage, userns-capable containerd); provider default for system pools |
| 5 | Kata | required / optional | **Optional** (RuntimeClass value). AKS Pod Sandboxing where available, kata-deploy elsewhere; tier-A user namespaces remain the default isolation |
| 6 | Packaging | one chart / platform chart + prereqs chart / operator | **Two charts** (`cloudtrain-prereqs`, `cloudtrain`) + CRDs chart, values profile per provider, `labctl preflight` as the gate and Helm test |
| 7 | Orchestrator RBAC | keep cluster-wide / scope down | **Scope down** before any shared cluster: namespaced Roles in session and vcluster namespaces created by a small privileged component; drop `escalate`; `pods/exec` only in session namespaces and the ovn-central namespace |
| 8 | Real-cloud CI | none / on demand / scheduled | **Scheduled weekly per provider + manual trigger**, budget cap in the cloud accounts, everything destroyed by the job (and a janitor on tags) |
| 9 | Images | GHCR only / per-provider registry | **GHCR as the source** (signed), mirrored into the provider registry by the install guide; catalog overlay generated per release |
| 10 | Lab content MTU | keep 1400 / derive from cluster | **Keep 1400** as a platform guarantee (preflight enforces it); document the underlay MTU per provider |

## 8. Spike: cloud CNI primary, Kube-OVN non-primary (2026-10-18)

Goal: prove or disprove option (b) before any code depends on it. Result:
**every property passed**; the fallback (eth0 on the cloud network plus a
deny-all policy, lab network on `net1`) is not needed.

### Setup

A throwaway kind cluster `ct-cni-spike` on the verify VM (own kubeconfig, one
control plane and two workers, next to the batch runner's `cloudtrain-dev`),
built with the new `KIND_PROFILE=managed-cni` profile of `task dev:up`
(`deploy/kind/cluster-managed-cni.yaml`, `tools/verify-vm/kind-managed-cni.yaml`
on the VM):

| Component | Version | Settings |
|---|---|---|
| Kubernetes (kind) | 1.36.4 | pod subnet 10.32.0.0/16 (Cilium), service 10.96.0.0/12 |
| Cilium (primary CNI, stands in for AKS Azure CNI powered by Cilium / GKE Dataplane V2) | 1.20.3 | `cni.exclusive: false`, kube-proxy kept, IPAM `kubernetes`, VXLAN tunnel (`deploy/cilium/values.yaml`) |
| Multus thick | 4.3.1 | unchanged vendored manifest, `multusConfigFile: auto` (picks `05-cilium.conflist`) |
| Kube-OVN | 1.16.13 | `cni_conf.NON_PRIMARY_CNI: true`, `CNI_CONFIG_PRIORITY: "90"` so Multus keeps Cilium as the cluster default (`deploy/kube-ovn/values-secondary.yaml`); NetworkPolicy on |
| KubeVirt | 1.9.1 | `permitBridgeInterfaceOnPodNetwork: false` (to prove it is not needed) |

Two emulated sessions (`spike-a`, `spike-b`), each a `Vpc` with the session
segments of today's orchestrator, all with `spec.mtu: 1400` and a provider
(so each is a NAD): management `198.19.255.0/24`, one link carrier
`198.18.0.0/28`, lab `192.168.100.0/24`, access `192.168.99.0/24`. Per session:
two wired pods on different workers with `v1.multus-cni.io/default-network:
<ns>/mgmt` plus link and lab attachments; one VMI (cirros) with
`networks: [{name: default, multus: {networkName: <ns>/lab, default: true}}]`,
bridge binding and `<provider>.kubernetes.io/ip_address: 192.168.100.10`.
In `spike-a` also an entry-style pod (Cilium eth0 plus the access NAD with
`.5` and a route to the lab subnet), two lab peers with the headless Service,
subdomain and DNS search of `labpeers.go`, and the peer and entry policies.

### Results

| # | Property | Result | Evidence |
|---|---|---|---|
| 1 | Pods: `kube-ovn` NAD as the Multus default network in non-primary mode | **pass** | Kube-OVN allocated from the default-network annotation (fixed IP honoured), eth0 = `198.19.255.10/24`, default route via the VPC gateway, `status.podIP` is the session IP; pods run without any Cilium endpoint |
| 2 | VMs: KubeVirt `multus.default: true` on a Kube-OVN NAD, fixed IP, bridge binding | **pass** | VMI `Running` with IP `192.168.100.10` from the annotation; reachable from a pod on the other worker, and from the entry pod through the VPC router; `permitBridgeInterfaceOnPodNetwork: false` |
| 3 | Cross-node L2 on lab links (two workers) | **pass** | link carrier address flushed, lab addresses `10.0.0.1/30`, `10.0.0.2/30` set by hand: ping and `arping` across workers |
| 4 | Isolation between sessions | **pass** | both sessions use the same IPs (`.10`, `.20`, `192.168.100.10`); `spike-a` cannot reach an address that only `spike-b` has; wired pods reach neither the Cilium pod network (CoreDNS), the node IPs, the API service `10.96.0.1:443` nor the internet |
| 5 | 1400-byte MTU | **pass** | every Kube-OVN interface (eth0, links, lab, access) has MTU 1400 from `Subnet.spec.mtu`; `ping -M do -s 1372` (1400-byte packets) passes cross-node on eth0, link and VM paths; `-s 1373` is refused. Cilium's own eth0 is 1450 (VXLAN), which lab traffic never uses |
| 6 | Lab peers resolve each other by name | **pass** | `getent hosts bravo` (search domain) and the full name `bravo.ct-nodes.spike-a.svc.cluster.local`, TCP by name across workers |
| 7 | NetworkPolicy, cloud CNI | **pass** | Cilium enforces the peer and entry policies on eth0: peer to another namespace's pod blocked (egress), other namespace to peer blocked (ingress), entry has DNS but no internet and no other pods; controls: the same connections succeed without the policy |
| 8 | NetworkPolicy, Kube-OVN | **pass** | Kube-OVN still enforces the entry policy on the access attachment in non-primary mode: lab subnet to entry `192.168.99.5` blocked with the policy, reachable without it (control); entry to lab works (egress allowed) |

Findings that shaped the implementation:

- Kube-OVN's `install-cni` still writes `<priority>-kube-ovn.conflist` in
  non-primary mode. With the default priority `01` Multus (`auto`) would pick
  Kube-OVN as the cluster network; the profile sets `90`. A production chart
  must do the same (or point Multus at the cloud CNI's file explicitly).
- `Subnet.spec.mtu` pins the segment MTU, so the 1400-byte guarantee no longer
  depends on the node MTU (it still needs underlay MTU >= 1500 for geneve).
  The orchestrator sets it on every session segment (`--lab-mtu`, default 1400).
- Cilium needs `cni.exclusive: false`, or it renames the Multus and Kube-OVN
  configs away.
- Pods on the default-network override are not Cilium endpoints, so no cloud
  policy applies to them; they need none (no route out of the VPC), and the
  session VPC is the isolation, as with Kube-OVN primary today.
- Not covered by the spike: the default-network override on a cluster where
  Kube-OVN *is* primary (vCenter / bare metal keep `--network-mode=primary`,
  which is unchanged), Calico or the AWS VPC CNI as the primary CNI, and a
  real cloud underlay. The implementation's `labctl preflight` network probe
  repeats the core checks on any cluster.

Method: `ip`, `ping -M do`, `arping`, `getent` and `nc` from the nettools
image, run by `kubectl exec`. The spike cluster is reused for the `labctl
verify` runs of the implementation (`--network-mode=secondary`) and deleted
afterwards.

## 9. Implementation: `--network-mode` (2026-10-18)

The orchestrator has a network mode setting; one code path serves both kinds of
cluster.

| Setting | `primary` (default) | `secondary` |
|---|---|---|
| Clusters | Kube-OVN is the primary CNI: kind dev (`cloudtrain-dev`), verify VM, vCenter, bare metal | the cluster's CNI owns eth0, Kube-OVN non-primary behind Multus: AKS, EKS, GKE, `KIND_PROFILE=managed-cni` |
| Wired lab pods (link ends, netdev) | eth0 via `ovn.kubernetes.io/logical_switch` (today) | mgmt subnet gets a provider and a NAD; `v1.multus-cni.io/default-network` + `<provider>.kubernetes.io/logical_switch` (`network/pod.go`) |
| Lab VMs | `pod` network + bridge, `ovn.kubernetes.io/*` (today) | lab subnet gets a provider and NAD `ct-<hash>-lab`; `multus: {networkName, default: true}` + bridge, `<provider>.kubernetes.io/ip_address` (`drivers/labnet.go`, `kubevirt.go`) |
| Link ends, access NAD, QoS, `layer2_forward`, vlan-passthru | unchanged | unchanged |
| Entry node, lab peers (headless Service) | unchanged | eth0 on the cluster CNI, which enforces the entry and peer policies; `network_policy_for` of a wired entry lists the mgmt and access NADs instead of `ovn` |
| Segment MTU | `--lab-mtu` (default 1400) sets `Subnet.spec.mtu` on every session subnet in both modes |

Flags: `--network-mode`, `--lab-mtu`; `orchestrator-deploy.sh` takes
`NETWORK_MODE` and `LAB_MTU` (`KIND_PROFILE=managed-cni` defaults to
`secondary`). `labctl preflight` (network section, `--probe`) checks a cluster
for either mode, using the orchestrator's own wiring code for the probe.

### Pod Security and privileges

- Session namespaces created by `labctl verify`/`labctl exam` and by
  `task dev:gateway` get `enforce: privileged` (set explicitly, so a cluster
  default of baseline does not reject lab pods) and `audit: baseline`
  (`drivers.SessionNamespacePodSecurity`). The Helm chart must do the same for
  its session namespace.
- Reduced: `net-init` of wired pods that are not routers no longer runs
  privileged without user namespaces. It gets NET_ADMIN/NET_RAW, and the pod
  sets the safe sysctl `ping_group_range`. With user namespaces (the default
  where supported) no wired pod is privileged.
- Cannot be reduced without losing lab features: NET_ADMIN/NET_RAW on wired
  nodes and the link sidecar (addresses, routes, tc, tcpdump); `procMount:
  Unmasked` for writable network sysctls in user-namespaced pods; a privileged
  `net-init` for router nodes without user namespaces (`ip_forward` and
  per-interface `rp_filter` are unsafe sysctls, and the per-interface ones do
  not exist yet when the sandbox is created); SYS_ADMIN for FRR; KubeVirt's
  virt-launcher. So session namespaces stay `privileged`, and baseline is
  audited only.

### Verify results

Secondary mode on the spike cluster (`ct-cni-spike`: Cilium primary,
Kube-OVN non-primary, scoped manager `--network-mode=secondary`,
`labctl verify --parallel 1`, ephemeral VM disks):

| Lab | Kind | Result |
|---|---|---|
| `fix-ssh-key-perms` | container only | pass |
| `xnt-json-neighbour-export` | netdev (FRR) with links | pass (base, mutations, alternatives; teardown clean) |
| `etcd-snapshot-restore` | VM | pass (8/8 runs) |
| `hostpath-mount-policy` | kubeadm cluster (`kubeadm:1.37-sec`) | pass (6/6 runs) |

`labctl preflight --probe` on the same cluster passed every check (secondary
mode detected, Cilium, conflist priority 90, MTU 1400 on eth0 and the link,
1400-byte DF frames across workers on both, no route to the API service, 35
platform and lab modules on both workers).

Primary mode unchanged: on `cloudtrain-dev`, a test manager (namespace
`ct-cni-test`, `labs.cloudtrain.dev/verify=cni-test`, deleted afterwards)
passed `fix-ssh-key-perms` and `xnt-json-neighbour-export`, both passing in
the batch results before.

Found on the way: on hosts with DMI (the EC2 verify VM) kind bind-mounts files
over `/sys/devices/virtual/dmi/id`, and then every `hostUsers: false` pod fails
with `error mounting "sysfs" ... operation not permitted`. This is not related
to the CNI. `tools/verify-vm/tune.sh` handled it for `cloudtrain-dev` only;
`dev:up` now drops the overmounts for every profile.

### Remaining gaps

- Secondary mode is verified only on kind with Cilium. Calico, the AWS VPC CNI
  (with `enableNetworkPolicy`), Azure CNI and GKE Dataplane V2 on a real
  underlay (MTU, geneve UDP 6081 in the security groups) are next, through
  tier 3 of section 6.
- Secondary mode on a cluster where Kube-OVN is primary is not verified.
  Preflight warns about it, so use `primary` there.
- Lab CIDRs stay fixed at `192.168.99.0/24`, `192.168.100.0/24` and
  `198.18.0.0/15`, because lab content names these addresses. Preflight fails
  on any overlap with node, pod, service or Kube-OVN ranges, which means a
  cloud VNet/VPC in `192.168.0.0/16` must avoid these two /24s.
- The kubelet cannot reach wired pods and VMs, which have no address on the
  cluster network, so lab pods must keep exec-only probes.
- Pod Security for the gateway's own session namespace in a cluster install
  belongs in the Helm chart, which does not exist yet.
- Clabernetes is not built yet. Its VXLAN launchers would sit on the primary
  network, independent of this mode.

## 10. Calico profile on kind (2026-10-19)

`KIND_PROFILE=managed-cni-calico` (`task dev:up KIND_PROFILE=managed-cni-calico`,
cluster `cloudtrain-calico`) is the second "bring your own CNI" profile. It uses
the same kind config and secondary mode as `managed-cni`, with Calico v3.33.0
(VXLAN, pool 10.32.0.0/16, the pinned manifest the golden image uses, edited by
`deploy/calico/kind.sed`) as the primary CNI. Lab CIDRs stay fixed and
`--lab-mtu=1400` applies as in the Cilium profile.

Verified on ct-testvm (throwaway cluster `ct-calico`, `--network-mode=secondary`,
`labctl verify --parallel 1 --grade-timeout 15m`):

| Check | Result |
|---|---|
| `labctl preflight --probe` | all checks pass: Calico detected, conflist priority 90, eth0 and link MTU 1400, 1400-byte DF frames across workers on both, API service unreachable from wired pods |
| `fix-ssh-key-perms` (pod) | pass, 6/6 runs |
| `etcd-snapshot-restore` (KubeVirt VM) | pass, 8/8 runs |
| `net-fix-mtu-blackhole` (multi-node network) | 6/7 runs pass; `alternative:tunnel-mtu-only` fails (`upload-arrived`, got 32768). Known lab issue, unrelated to the CNI: the Kube-OVN primary `cloudtrain-dev` batch failed the same way |

MTU: lab pod and VM-path interfaces come up at 1400 (set by Kube-OVN
`Subnet.spec.mtu`; Calico's own eth0 is smaller because of VXLAN and lab traffic
never uses it) and pass 1400-byte packets with DF set across nodes.

Known startup race: right after KubeVirt reports Available, the first VMI create
in `verify-kvm.sh` can fail with `virt-api` webhook "connection refused" while the
virt-api pods restart. Re-running `task dev:verify-kvm` succeeded. Not shown to
be Calico-specific.
