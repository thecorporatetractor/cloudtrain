# Local development environment (Phase 0 runtime proof)

This is the local CloudTrain runtime: a kind cluster with real KVM, Kube-OVN, Multus,
KubeVirt and CDI, plus a golden kubeadm node image. `task lab:demo` checks the whole
lab model end to end. Everything below was run on the reference dev machine, and the
numbers come from those runs.

Reference machine: Windows + WSL2 (kernel `6.18.33.2-microsoft-standard-WSL2`), 12 vCPU,
48 GB WSL memory (about 20 GB taken by other workloads), Docker Engine 27.5.1 with the
containerd image store, nested virtualization on (`/dev/kvm` present).

## Prerequisites

| Need | Why | Check |
|---|---|---|
| `/dev/kvm` | KubeVirt runs guests with hardware KVM, never TCG | `ls -l /dev/kvm` (WSL2: `nestedVirtualization=true`, the default on Win11) |
| Kernel modules `openvswitch geneve vhost_net tun vxlan br_netfilter` | Kube-OVN datapath and virtio-net | `deploy/scripts/host-prep.sh` loads them without sudo through a short-lived privileged container |
| Docker, `kubectl`, `helm` | | already on the machine |
| `kind task vcluster virtctl jq yq` | pinned CLIs | `task tools` installs them into `~/.local/bin` |
| about 8 GB free RAM, 20 GB disk | platform takes about 3 GB idle, one demo lab about 3 GB | |

Every version is pinned in **`deploy/versions.env`**, which is the only place versions are
set:

| Component | Version | Note |
|---|---|---|
| kind / node image | v0.33.0 / `kindest/node:v1.36.4@sha256:099e…` | KubeVirt 1.9 supports K8s 1.34–1.36, so the host cluster stays on 1.36 |
| Kube-OVN (helm chart) | v1.16.13 | primary CNI, geneve overlay, one VPC per lab |
| Multus (thick) | v4.3.1 | adds the jumphost's second NIC into the lab VPC |
| KubeVirt / virtctl | v1.9.1 | `useEmulation: false` |
| CDI | v1.66.1 | installed; the demo uses containerDisks |
| vcluster CLI and chart | v0.37.2 | the virtual cluster serves K8s v1.36.0 |
| Lab Kubernetes (inside VMs) | v1.37.1 from `pkgs.k8s.io/core:/stable:/v1.37` | current minor |
| Ubuntu cloud image | noble `release-20260926`, sha256 pinned | |
| Flannel (lab CNI inside VMs) | v0.28.10 | |
| go-task | v3.54.0 | |

## Commands

```bash
task tools          # install pinned CLIs into ~/.local/bin (idempotent)
task dev:up         # create or converge kind 'cloudtrain-dev' + Kube-OVN + Multus + KubeVirt + CDI, then prove KVM
task dev:status     # nodes, KVM devices, add-on versions, unhealthy pods, lab namespaces, node memory
task dev:verify-kvm # boot a throwaway VMI and check libvirt <domain type='kvm'>
task image:build    # golden kubeadm node image -> containerDisk cloudtrain/kubeadm-node:v1.37.1
task lab:demo       # end-to-end lab proof; the lab is deleted afterwards (KEEP=1 keeps it)
task lab:clean      # delete leftover demo labs (namespace + VPC + subnets)
task dev:down       # delete ONLY the cloudtrain-dev kind cluster
```

`dev:up` is idempotent. It also recovers the cluster after a WSL or Docker restart; see
"Known gaps".

## What `lab:demo` builds

```
Kube-OVN VPC <ns>  (isolated: no route to the platform pod network or the internet; verified)
 ├─ subnet <ns>-lab     192.168.100.0/24   ctl-1 .10  wrk-1 .11   (KubeVirt VMs, golden containerDisk, bridge binding)
 └─ subnet <ns>-access  192.168.99.0/24    workstation .5         (provider access.<ns>.ovn, Multus NAD)
workstation pod (learner@workstation)
   eth0 -> platform network (reaches the vcluster API service)
   net1 -> lab VPC (static route 192.168.100.0/24 via 192.168.99.1)
vcluster "virtual" in the same namespace (its pods stay on the platform network)
```

1. For each lab, the script generates an SSH key, a cluster CA (so the worker can join
   with a pinned `caCertHashes`) and a bootstrap token. All of them go into Secrets.
2. Two `VirtualMachine`s boot from `cloudtrain/kubeadm-node:v1.37.1`. Each gets a fixed IP
   through `ovn.kubernetes.io/ip_address`, so every lab uses the same private IPs.
   cloud-init runs `kubeadm init` and applies Flannel on `ctl-1`. On `wrk-1` it waits for
   `:6443` and then runs `kubeadm join`. The VMs have no internet: every image comes from
   the golden image.
3. The learner kubeconfig on the workstation is built from `admin.conf` (fetched over
   `ssh ctl-1`) and `vcluster connect --print --server https://virtual.<ns>.svc`. Its
   contexts are renamed to `kubeadm` and `virtual`. The workstation pod has
   `automountServiceAccountToken: false`, so the learner never holds a token for the host
   cluster.
4. The script prints the learner's view (saved to `deploy/.results/<ns>.txt`), measures
   timings and RAM (appended to `deploy/.results/timings.log`), and then deletes the
   namespace, VPC and subnets.

Proof excerpt (run `ctlab-demo-185308`):

```
+ whoami / hostname            -> learner / workstation
+ ssh ctl-1 'hostname; ...'    -> ctl-1, KUBERNETES_VERSION=v1.37.1
+ kubectl config get-contexts
*  kubeadm   kestrel                                      kubernetes-admin
   virtual   vcluster_virtual_ctlab-demo-185308_kind-...  vcluster_virtual_...
+ kubectl config use-context kubeadm; kubectl get nodes -o wide
ctl-1  Ready  control-plane  v1.37.1  192.168.100.10  Ubuntu 24.04.5 LTS  containerd://2.4.1
wrk-1  Ready  <none>         v1.37.1  192.168.100.11  Ubuntu 24.04.5 LTS  containerd://2.4.1
Server Version: v1.37.1
+ kubectl config use-context virtual; kubectl get ns; kubectl version
default kube-node-lease kube-public kube-system ...   Server Version: v1.36.0
```

The two contexts report different server versions (v1.37.1 and v1.36.0), which shows
that `use-context` switches between two real clusters. The kept lab was also checked by
hand: CoreDNS Running with 0 restarts, and a pod pinned to `wrk-1` ran with pod IP
`10.244.1.2`, so the Flannel overlay works across the VMs.

## Measured timings and memory

All timings start at `kubectl apply` of the two VMs. The golden image is already on the
node.

| Run | VMs Running | SSH ready (ctl-1) | both nodes Ready | CoreDNS ready* |
|---|---|---|---|---|
| ctlab-demo-185308 | 13.3 s | 60.7 s | 99.8 s | n/a |
| ctlab-demo-185644 | 13.2 s | 55.2 s | 89.0 s | 142.4 s |
| ctlab-demo-190031 | 14.4 s | 56.5 s | 99.4 s | 139.7 s |
| ctlab-demo-190804 (after node restart + IP drift) | 15.6 s | 63.4 s | 106.5 s | 167.2 s |

\* This includes waiting for the vcluster and assembling the kubeconfig. It is not a pure
cluster metric.

| VM | Guest RAM | Guest used (`free -m`) | virt-launcher pod cgroup |
|---|---|---|---|
| ctl-1 (2 vCPU) | 2 GiB | 670–800 MiB | 1.56–1.73 GiB |
| wrk-1 (2 vCPU) | 1.5 GiB | 350–390 MiB | 0.91–0.95 GiB |

KubeVirt also reports `Memory Overhead: 280Mi` per VMI on top of guest RAM for
scheduling. A two-node kubeadm lab therefore costs about 2.6 GiB of real memory, and
about 4.3 GiB when scheduled.

Other measurements:

| Step | Time |
|---|---|
| `dev:up` from nothing | 401 s (cold image pulls; KubeVirt 173 s, CDI 49 s) |
| `dev:up` re-run after node restart with IP drift | 144 s |
| `image:build` (base image cached) | 304 s (virt-customize 116 s, sparsify, containerDisk build) |
| KVM probe VMI (cirros) to Ready | 13–16 s |
| `kind load` of the golden image (2.26 GB containerDisk) | about 65 s per node; the demo skips nodes that already have it |
| Platform idle footprint (both kind nodes) | about 3.1 GB |

The VMs go from apply to Running in about 13 s, but most of the remaining ~100 s is the
Ubuntu boot, cloud-init and `kubeadm init`. The next speed-up is VM snapshots or
warm pools, not faster scheduling.

## Golden image pipeline (`tools/images/`)

Choice: **virt-customize at build time**, not cloud-init at first boot. Packages and all
control-plane and CNI images are baked in. This is what lets the VMs run in an isolated
VPC with no internet and keeps boot-to-Ready around 90–100 s.

- `builder/Dockerfile`: Ubuntu 24.04 + libguestfs, run with `--device /dev/kvm`. The tag is
  derived from the Dockerfile hash, so editing it triggers a rebuild.
- `build.sh`: fetches the pinned cloud image and checks its sha256. It resolves the image
  list with the pinned `kubeadm config images list` plus the Flannel manifest, grows the
  disk to 10G, runs `scripts/guest-setup.sh` inside the guest (containerd.io with
  SystemdCgroup, kubelet/kubeadm/kubectl `1.37.1-1.1` held, sysctls/modules, then
  `ctr pull --platform linux/amd64` of 9 images into `k8s.io`), generalizes the image
  (machine-id, ssh host keys, cloud-init clean), runs `virt-sparsify --compress` (about
  1.06 GiB qcow2), and packages the result as a containerDisk `FROM scratch`, with
  `/disk/disk.qcow2` owned by 107.
- `jumphost/Dockerfile` + `build-jumphost.sh`: the learner workstation image (ssh client,
  pinned kubectl, bash completion, user `learner`).
- CDI alternative: the same `disk.qcow2` can be served as a `DataVolume` source (`http` or
  `registry` import). A DataVolume is the better fit for persistent per-learner disks;
  containerDisk is the better fit for disposable labs.

## Known gaps and problems hit (with the fix in place)

1. **Only the kind worker runs VMs.** The control-plane node is tainted, so virt-handler
   (and `devices.kubevirt.io/kvm`) is only on the worker. That is enough for the demo. To
   use both nodes, tolerate the taint in the KubeVirt CR (`spec.workloads.nodePlacement`).
2. **Node IPs change after a WSL or Docker restart** (this is what broke the previous
   attempt). ovn-central then crash-loops with `ERROR! host ip 172.31.0.2 not in env
   NODE_IPS 172.31.0.3`. `dev:up` now detects the drift, wipes the single-member OVN raft
   DBs and re-renders Kube-OVN with the new IP. kube-ovn-controller rebuilds the topology
   from its CRDs. This was tested by forcing a control-plane IP change (.3 → .4): dev:up
   recovered in 144 s and lab:demo passed afterwards. Running labs do not survive this,
   which is acceptable locally.
3. **Do not bind-mount `/dev/vhost-net` or `/dev/net/tun` in kind.** If the device is
   missing when a node starts (vhost_net is not loaded after a WSL reboot), Docker creates
   an empty *directory* `/dev/vhost-net` on the host and `modprobe vhost_net` can no
   longer create the node. kind nodes are privileged and get host devices anyway, so only
   `/dev/kvm` is mounted. `host-prep.sh` repairs a stray directory.
4. **Multus thick daemon limits (50Mi/100m upstream) are too small.** Delegate plugins
   such as portmap run in its cgroup, hit `memory.max` about 300k times, and sandboxes fail
   with `failed to reserve sandbox name`. `dev:up` patches the limits to 100Mi request /
   512Mi limit with no CPU limit.
5. **CoreDNS loop in lab clusters.** KubeVirt DHCP gives the VM the host cluster DNS
   (10.96.0.10), which is also the lab cluster's own DNS service IP, so CoreDNS forwarded
   to itself and died in loop detection. The lab kubelet now uses `resolvConf:
   /etc/cloudtrain/resolv.conf` (the VPC gateway). Cluster names resolve and external
   names fail fast. **Gap:** labs have no upstream DNS or internet. A per-VPC NAT gateway
   and DNS (Kube-OVN `VpcNatGateway`, `ENABLE_NAT_GW` is already on) is the next step for
   labs that need egress.
6. **Kube-OVN multi-NIC needs a subnet per provider.** A `kube-ovn` NAD attachment cannot
   join a subnet whose provider is `ovn` (`provider ... is not bound to any subnet`). The
   jumphost therefore gets its own access subnet in the same VPC, routed by the VPC
   router. The orchestrator should model "access point" as its own subnet.
7. **`kind load` always re-imports** with Docker's containerd image store, because the
   Docker image ID (index digest) differs from the CRI image ID. `lab-demo.sh` compares
   the containerd index digest itself. For production, push to a registry instead.
8. **Builder gotchas** (all fixed): the libguestfs appliance needs a DHCP client in the
   builder image (otherwise eth0 stays down and there is no DNS); `passt` fails in Docker,
   so it is not installed; apt is forced to IPv4 during the build; `virt-customize --run`
   uses `/bin/sh`, so the script is run with `bash`; `docker save` (Docker 27) of
   multi-arch images is not importable with `ctr`, so images are pulled inside the guest.
9. Not covered yet: Clabernetes and netdev nodes, `tc netem` impairment, link capture,
   the Kata runtime for containers (runc locally), and warm pools / VM snapshots.

## What changes for the vCenter target (nested ESXi / vSphere VMs)

| Local (kind on WSL2) | vCenter production |
|---|---|
| `/dev/kvm` comes from WSL2 nested virt, bind-mounted into kind nodes | K8s worker VMs need **`vhv.enable = TRUE`** ("Expose hardware assisted virtualization to the guest OS"), hardware version ≥ 9, EVC mode that keeps VMX, and no FT. Check `/dev/kvm` and `kvm_intel nested=Y` on each worker. KubeVirt then runs as nested KVM on ESXi. |
| kind node IPs from Docker, drift after restart | Static node IPs (DHCP reservations or IPAM), so the drift handling is not needed. Kube-OVN `MASTER_NODES` uses 3 control-plane nodes (raft). |
| Geneve overlay over the Docker bridge | Geneve over the vSphere port group: MTU ≥ 1600 on the vDS/NSX segment (or lower the Kube-OVN MTU), and allow UDP 6081 between workers. Promiscuous mode/forged transmits are NOT needed for overlay. They are needed only if labs use underlay/VLAN subnets bridged to physical networks. |
| `kind load` of the containerDisk | Internal OCI registry (Harbor) for `cloudtrain/kubeadm-node` and the jumphost. Pre-pull or a warm pool on the workers, or a CDI DataVolume golden PVC on a CSI class with fast clone (vSphere CSI does not CSI-clone across datastores; consider a local-NVMe class such as TopoLVM for fast clones). |
| local-path storage | vSphere CSI or local-NVMe for VM disks. The vcluster etcd and SQLite PVCs also need a real StorageClass. |
| One worker runs all VMs | Size workers for about 4.3 GiB scheduled per 2-node lab plus about 280 MiB overhead per VMI. Use dedicated "virt" workers (label + KubeVirt nodePlacement). Reserve memory for nested-virt EPT overhead. Do not overcommit memory on the ESXi host under nested guests. |
| No egress for labs | `VpcNatGateway` per lab VPC (or a shared one) with an allow-list egress proxy, plus DNS. |
| Optional later | vSphere Instant Clone provider for `vm` nodes (see architecture.md), which avoids nested virt for Linux-admin labs. |
