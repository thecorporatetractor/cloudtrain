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
set. Pinning goes below the tag where that is possible: the kind node image, the Multus
image, the KVM probe disk and every image baked into the golden image are pinned by
digest (VM image contents: `tools/images/lock/*.lock`); the KubeVirt, CDI and Calico
manifests are checked against sha256 sums; Multus is vendored (`deploy/multus/`, see
"Known gaps" 4); the golden image's apt packages are exact versions, Ubuntu packages come
from a fixed `snapshot.ubuntu.com` point in time, and the Docker and pkgs.k8s.io repo keys
must match pinned fingerprints:

| Component | Version | Note |
|---|---|---|
| kind / node image | v0.33.0 / `kindest/node:v1.36.4@sha256:099e…` | KubeVirt 1.9 supports K8s 1.34–1.36, so the host cluster stays on 1.36 |
| Kube-OVN (helm chart) | v1.16.13 | primary CNI, geneve overlay, one VPC per lab, `ENABLE_SSL: true` (NB/SB/raft over mutual TLS) |
| Multus (thick) | v4.3.1 (`v4.3.1-thick@sha256:a357…`) | adds the jumphost's second NIC into the lab VPC; upstream manifest ships the floating `snapshot-thick` tag |
| KubeVirt / virtctl | v1.9.1 | `useEmulation: false` |
| CDI | v1.66.1 | installed; the demo uses containerDisks |
| vcluster CLI and chart | v0.37.2 | the virtual cluster serves K8s v1.36.0 |
| Lab Kubernetes (inside VMs) | v1.37.1 from `pkgs.k8s.io/core:/stable:/v1.37` | current minor |
| Lab node runtime | containerd.io `2.4.1-2~ubuntu.24.04~noble`, cri-tools `1.37.0-1.1`, kubernetes-cni `1.9.1-1.1` | installed as `pkg=version` and held |
| Ubuntu cloud image | noble `release-20260926`, sha256 pinned | apt archive snapshot `20261010T000000Z` |
| Calico (lab CNI inside VMs) | v3.33.0 (`calico-vxlan.yaml`, VXLAN Always, pool 10.244.0.0/16) | replaced Flannel, which does not enforce NetworkPolicy |
| go-task | v3.54.0 | |

## Commands

```bash
task tools          # install pinned CLIs into ~/.local/bin (idempotent)
task dev:up         # create or converge kind 'cloudtrain-dev' + Kube-OVN + Multus + KubeVirt + CDI, then prove KVM
task dev:status     # nodes, KVM devices, add-on versions, unhealthy pods, lab namespaces, node memory
task dev:verify-kvm # boot a throwaway VMI and check libvirt <domain type='kvm'>
task image:build:all   # every lab image, one at a time (see "Lab images" below)
task image:build       # = image:build:kubeadm-node -> containerDisk cloudtrain/kubeadm-node:v1.37.1
task image:load        # load built images + workload images into kind (IMAGES="..." for a subset)
task image:test        # boot-test the VM images offline on the dev cluster (IMAGES="..." for a subset)
task lab:demo       # end-to-end lab proof; the lab is deleted afterwards (KEEP=1 keeps it)
task lab:clean      # delete leftover demo labs (namespace + VPC + subnets)
task dev:down       # delete ONLY the cloudtrain-dev kind cluster
```

`dev:up` is idempotent: a re-run on a converged cluster changes nothing (no DaemonSet or
Deployment generation bump, no pod replaced; checked by comparing pod UIDs before and
after, about 20 s). It also brings the cluster back after its node containers stop:

- it runs `host-prep.sh` first, then `docker start`s any stopped node container of
  `cloudtrain-dev` (`kind get clusters` also lists clusters whose nodes have exited, and
  Docker does not restart kind nodes on its own);
- it checks that `/dev/kvm`, `/dev/vhost-net` and `/dev/net/tun` are character devices in
  every node and restarts a node that lacks one (a privileged container only gets the
  host device nodes that exist when it starts);
- it handles the control-plane IP drift that a restart can cause (see "Known gaps" 2).
- it heals expired KubeVirt/CDI certificates (`deploy/scripts/heal-virt-certs.sh`, also
  `task dev:heal-certs`). virt-operator and cdi-operator issue 24 h serving certificates
  (CA 7 d) and rotate them only while running; after a stop longer than that (seen after
  ~20 h) every webhook answers `x509: certificate has expired`. The script flags any
  expired or soon-expiring `tls.crt` in the kubevirt/cdi Secrets, a CA bundle with no valid
  certificate, or an x509 error from a server-side dry-run of a VMI and a DataVolume (and a
  GET on `subresources.kubevirt.io`); it then restarts both operators, waits until every
  certificate is valid, restarts serving components that still present the old one, and
  waits until the probes pass. A healthy cluster costs ~3 s; a forced repair (`FORCE=1`)
  took 50 s.

`dev:up` never changes your kubeconfig's current-context: every call passes
`--context kind-cloudtrain-dev`, and after `kind create cluster` (which switches it) the
previous context is restored.

Tested: `docker stop` of both node containers, then `dev:up` (135 s, including an IP
drift .4 → .2 and OVN DB reset); and a node with `/dev/vhost-net` removed (restarted,
83 s). **Not tested:** a real `wsl --shutdown` cycle (it would kill the session running the
test). It should be the same as the `docker stop` case plus host-prep reloading modules.

## What `lab:demo` builds

```
Kube-OVN VPC <ns>  (no route to the platform pod network, kind nodes or the internet; asserted by lab:demo)
 ├─ subnet <ns>-lab     192.168.100.0/24   ctl-1 .10  wrk-1 .11   (KubeVirt VMs, golden containerDisk, bridge binding)
 └─ subnet <ns>-access  192.168.99.0/24    workstation .5         (provider access.<ns>.ovn, Multus NAD)
workstation pod (learner@workstation)
   eth0 -> platform network, NetworkPolicy workstation-isolation: egress ONLY to
           kube-dns :53, its own vcluster (virtual-0 :8443 via svc virtual:443) and the
           lab VPC CIDRs; no ingress
   net1 -> lab VPC (static route 192.168.100.0/24 via 192.168.99.1)
vcluster "virtual" in the same namespace (its pods stay on the platform network)
   pods synced from it: NetworkPolicy virtual-workloads-isolation, egress ONLY to
   kube-dns :53 and pods in the lab namespace (no internet, no external DNS)
```

**Isolation is asserted, not assumed.** Step 8 of `lab-demo.sh` probes TCP connects and
fails the demo on any mismatch:

| From | Must reach | Must NOT reach |
|---|---|---|
| workstation | own vcluster API (`virtual.<ns>.svc:443`), `ctl-1:22` over net1 | `ovn-nb` service and endpoint `:6641`, host API (`10.96.0.1:443` and kind node `:6443`), `virt-api`, internet (`1.1.1.1:443`) |
| ctl-1 (VM) | `wrk-1:10250` | platform pod network (a `10.16.0.0/16` CoreDNS pod), the vcluster service, kind node `:6443`, internet |

An earlier version of this page said "isolated; verified", but only the VM side had
been checked: the workstation reached the unauthenticated OVN NB DB, the host API server,
virt-api, other labs' vclusters and the internet. That is fixed by the policies above and
by Kube-OVN `ENABLE_SSL` (the NB/SB DBs now require a client certificate; a plain
JSON-RPC `list_dbs` gets no answer). Removing the workstation policy from a running lab
makes `ovn-nb:6641`, `10.96.0.1:443` and `1.1.1.1:443` reachable again, so the policy is
what blocks them.

1. For each lab, the script generates an SSH key, a cluster CA (so the worker can join
   with a pinned `caCertHashes`) and a bootstrap token. All of them go into Secrets.
2. Two `VirtualMachine`s boot from `cloudtrain/kubeadm-node:v1.37.1`. Each gets a fixed IP
   through `ovn.kubernetes.io/ip_address`, so every lab uses the same private IPs.
   cloud-init runs `kubeadm init` and applies Calico on `ctl-1`. On `wrk-1` it waits for
   `:6443` and then runs `kubeadm join`. The VMs have no internet: every image comes from
   the golden image.
3. The learner kubeconfig on the workstation is built from `admin.conf` (fetched over
   `ssh ctl-1`) and `vcluster connect --print --server https://virtual.<ns>.svc`. Its
   contexts are renamed to `kubeadm` and `virtual`. The workstation pod has
   `automountServiceAccountToken: false`, so the learner never holds a token for the host
   cluster.
4. The script prints the learner's view (saved to `deploy/.results/<ns>.txt`) and asserts
   it: both contexts return a server version, the versions differ, `kubeadm` serves
   `LAB_K8S_VERSION` with 2 Ready nodes, and lab CoreDNS is Available. Then it runs the
   isolation checks above, measures timings and RAM (appended to
   `deploy/.results/timings.log`), and deletes the namespace, VPC and subnets. Any failed
   check exits non-zero.

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
that `use-context` switches between two real clusters; the script now fails if they do
not. The kept lab was also checked by
hand: CoreDNS Running with 0 restarts, and a pod pinned to `wrk-1` ran with pod IP
`10.244.1.2`, so the overlay works across the VMs (that run used Flannel; Calico replaced it).

## Measured timings and memory

All timings start at `kubectl apply` of the two VMs. The golden image is already on the
node.

| Run | VMs Running | SSH ready (ctl-1) | both nodes Ready | CoreDNS ready* |
|---|---|---|---|---|
| ctlab-demo-185308 | 13.3 s | 60.7 s | 99.8 s | n/a |
| ctlab-demo-185644 | 13.2 s | 55.2 s | 89.0 s | 142.4 s |
| ctlab-demo-190031 | 14.4 s | 56.5 s | 99.4 s | 139.7 s |
| ctlab-demo-190804 (after node restart + IP drift) | 15.6 s | 63.4 s | 106.5 s | 167.2 s |
| two review runs (kept lab ctlab-demo-191948 and one other) | n/a | 64.3–65.2 s | 105.6–109.4 s | n/a |
| ctlab-demo-194258 (NetworkPolicies + Kube-OVN SSL) | 16.1 s | 67.6 s | 116.5 s | 160.9 s |
| ctlab-demo-202340 (rebuilt golden image: digests, apt snapshot, pinned packages) | 16.2 s | 60.2 s | 98.8 s | 139.8 s |

\* This includes waiting for the vcluster and assembling the kubeconfig. It is not a pure
cluster metric.

Across all runs: VMs Running in 13–17 s, SSH ready in 55–68 s, both nodes Ready in
89–117 s.
**End to end, `task lab:demo` takes about 3.5–4 minutes of wall time** (3m37s in review,
3m39s for ctlab-demo-194258 with the lab kept; 5m02s for ctlab-demo-202340, of which
about 62 s was the one-off `kind load` of the rebuilt golden image), which includes image checks, vcluster creation, the assertions, and
deleting the lab.

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
| `dev:up` re-run after node restart with IP drift | 144 s (forced IP change), 135 s (`docker stop` of both nodes) |
| `dev:up` re-run on a converged cluster | about 20 s, no changes |
| `image:build:*` under TCG (default since the WSL crashes) | etcd-host 540–555 s, kubeadm-node 1450 s, kubeadm-upgrade about 2150 s through sparsify (most of it apt from `snapshot.ubuntu.com` and image pulls through the appliance's user-mode network). Earlier KVM numbers: 304 s for the kubeadm node image with a cached builder, 3072 s when the builder image was rebuilt |
| KVM probe VMI (cirros) to Ready | 13–16 s |
| `kind load` of the golden image (2.26 GB containerDisk) | about 65 s per node; the demo skips nodes that already have it |
| Platform idle footprint (both kind nodes) | about 3.1 GB |

The VMs go from apply to Running in about 13 s, but most of the remaining ~100 s is the
Ubuntu boot, cloud-init and `kubeadm init`. The next speed-up is VM snapshots or
warm pools, not faster scheduling.

## Lab images (`tools/images/`)

Every image a lab references is listed in `deploy/images/catalog.yaml` (the contract the
runtime reads). Versions come from `deploy/versions.env`, digests from
`tools/images/lock/*.lock`, and every build refuses to run when the catalog entry and the
pins disagree.

| Catalog ref | Image | Contents | Build |
|---|---|---|---|
| `kubeadm:1.37` | `cloudtrain/kubeadm-node:v1.37.1` (containerDisk) | kubeadm/kubelet/kubectl 1.37.1 held, containerd, control-plane + Calico + workload images, curl | `task image:build:kubeadm-node` |
| `kubeadm:1.36` | `cloudtrain/kubeadm-node:v1.36-upgrade` (containerDisk) | v1.36.5 installed and held; v1.37.1 staged offline (see below) | `task image:build:kubeadm-upgrade` |
| `etcd-host:3.6` | `cloudtrain/etcd-host:3.6` (containerDisk) | etcd v3.6.15 + etcdctl/etcdutl in `/usr/local/bin`, `etcd.service` with mutual TLS | `task image:build:etcd-host` |
| `jumphost:1` | `cloudtrain/jumphost:1` (container) | kubectl v1.37.1, helm v4.3.0, etcdctl/etcdutl, yq, jq, ssh, vim/nano, tmux, user `learner` (uid 1000), `k` alias with completion, prompt with the kube context | `task image:build:jumphost` |

**Workload images.** Lab VMs have no internet, so every image a lab's Pods use is in the
catalog's `workloadImages` (`busybox:1.37`, `httpd:2.4-alpine`, `redis:7.4-alpine`,
`caddy:2-alpine`, and `httpd:2.4`, which the named-port-nodeport misconception drifts to).
They are pinned by index digest in `lock/workloads.lock`, pulled by digest into every
kubeadm node image's containerd (`k8s.io` namespace, CRI-managed, named by tag so
`imagePullPolicy: IfNotPresent` finds them), and pulled the same way into the kind nodes
for `mode: virtual` labs (`task image:load:workloads`, idempotent). Adding an image:
add it to `workloadImages`, run `task image:lock`, rebuild the kubeadm images.

**Upgrade image (`kubeadm:1.36`).** v1.36.5 is installed from the v1.36 pkgs.k8s.io repo
and kubeadm/kubelet/kubectl are held. The build then mirrors the two minors the lab needs
as flat apt repos, downloading through the signed pkgs.k8s.io repos (apt checks the
signatures and every .deb's sha256): `/opt/k8s-apt/v1.36/` (kubeadm/kubelet/kubectl
1.36.5, cri-tools 1.36.0, kubernetes-cni) and `/opt/k8s-apt/v1.37/` (1.37.1, cri-tools
1.37.0, kubernetes-cni). Both are signed with a throwaway build key whose public half is
appended to `/etc/apt/keyrings/kubernetes-apt-keyring.gpg` (next to the pkgs.k8s.io key),
and `/etc/apt/sources.list.d/kubernetes.list` has the same shape as the online one:

```
deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] file:/opt/k8s-apt/v1.36/ /
```

so the learner upgrades exactly as online: change `v1.36` to `v1.37` in that file,
`apt-get update`, `apt-get install kubeadm=1.37.1-*`. No apt source needs the internet
(the Ubuntu and Docker sources are renamed `*.disabled`), so `apt-get update` succeeds
offline. Every image of `kubeadm config images list --kubernetes-version v1.37.1`
(etcd, CoreDNS and pause included) is preloaded next to the v1.36.5 set, so
`kubeadm upgrade apply v1.37.1` runs with no network.

**etcd-host.** Ubuntu 24.04 with etcd from the sha256-pinned release tarball, a system
user `etcd`, and an enabled `etcd.service` (single member, client and peer mutual TLS on
127.0.0.1:2379/2380). Its PKI is generated per VM on first start
(`/usr/local/sbin/cloudtrain-etcd-pki`, `ExecStartPre`) under `/etc/qm-etcd/pki`:
`ca`, `server`, `peer`, and client identities `grader` and `admin` (`.crt`/`.key`, keys
0600, owned by `etcd`). No `ETCDCTL_*` variables are set, because the etcd lab teaches
the TLS flags. The etcd-snapshot-restore lab replaces the unit and PKI with its own
(`provision-etcd.sh` tears them down first); `task image:test` runs that lab's provision
script and solution on the image.

All VM images share the same conventions: Ubuntu cloud image with cloud-init and sshd,
**no users or keys baked in** (the runtime injects `learner` with passwordless sudo,
root's authorized_keys and the ssh host key through cloud-init), apt timers and snapd
are gone, and `/etc/cloudtrain-release` records versions and the catalog ref.

**CNI contract (kubeadm images).** The runtime calls `/opt/cloudtrain/bin/cni-install
<podCIDR>` on the control plane after `kubeadm init` (with `10.244.0.0/16`). It checks
`/opt/cloudtrain/manifests/calico.yaml` against the sha256 recorded at build time
(`calico.yaml.sha256`), sets Calico's default IPv4 pool to `<podCIDR>` (Calico's own
default, 192.168.0.0/16, overlaps the lab VPCs 192.168.99.0/24 and 192.168.100.0/24)
and applies it with `/etc/kubernetes/admin.conf`; `--wait` also waits for the rollout.
All Calico images are preloaded. `lab:demo` and `image:test` use the same script.

### Build pipeline

Choice: **virt-customize at build time**, not cloud-init at first boot. Packages and all
images are baked in. This is what lets the VMs run in an isolated VPC with no internet
and keeps boot-to-Ready around 90–117 s.

- `builder/Dockerfile`: Ubuntu 24.04 (by digest) + libguestfs from the pinned apt snapshot
  (only the `ca-certificates` bootstrap comes from the live archive). The tag is derived
  from the Dockerfile and snapshot, so changing either triggers a rebuild.
- **libguestfs runs under TCG (software emulation), not KVM, by default.** On the
  reference machine, nested KVM inside the libguestfs appliance (`docker --device
  /dev/kvm` → WSL2 → Hyper-V) coincided with several WSL crashes and one Windows bugcheck
  0x7f (double fault), while KubeVirt lab VMs on the same host ran cleanly.
  `build.sh` now sets `LIBGUESTFS_BACKEND_SETTINGS=force_tcg`, caps the appliance at
  2 GiB (`LIBGUESTFS_MEMSIZE=2048`) and the builder container at 6 GiB. `GUESTFS_KVM=1`
  re-enables KVM on hosts where nested virtualization is known to be stable. Build one
  image at a time (`image:build:all` is sequential). `GUESTFS_VERBOSE=1` streams every
  traced guest command to the log (otherwise a stalled build looks idle); apt in the
  guest has timeouts and retries, because the appliance's user-mode network can stall
  under TCG. `PACKAGE_ONLY=1` re-runs only the containerDisk packaging from an existing
  `.cache/<variant>/out/disk.qcow2`.
- `build.sh <variant>` (`kubeadm-node`, `kubeadm-upgrade`, `etcd-host`): fetches the
  pinned cloud image and checks its sha256. It resolves the image lists (pinned
  `kubeadm config images list` per Kubernetes version, the Calico manifest checked by
  sha256 (then pool CIDR and VXLAN mode set, see `build.sh`), the catalog's `workloadImages`) and requires each to match its lock file
  (`lock/kubernetes-<version>.lock`, `lock/calico.lock`, `lock/workloads.lock`;
  `task image:lock` refreshes the digests after a version bump). It grows the disk, runs
  `scripts/guest-<kind>.sh` inside the guest (shared steps in `scripts/guest-common.sh`:
  apt from the pinned Ubuntu snapshot, repo keys checked against pinned fingerprints,
  exact package versions held; images pulled by digest with
  `ctr pull --platform linux/amd64`), generalizes the image (machine-id, ssh host keys,
  cloud-init clean), runs `virt-sparsify --compress`, and packages the result as a
  containerDisk `FROM scratch` with `/disk/disk.qcow2` owned by 107. Work files live in
  `tools/images/.cache/<variant>/`.
- `build-jumphost.sh`: `jumphost/Dockerfile` with apt from the same snapshot and helm,
  etcd and yq checked against sha256 sums in `versions.env` (kubectl against dl.k8s.io's
  `.sha256`).
- `load.sh`: loads images into kind and skips any node that already has the same digest
  (containerDisks only to nodes that run VMs).
- `boot-test.sh`: per VM image, a fresh namespace with an isolated Kube-OVN VPC (no
  internet, as in a lab), the VM booted with the runtime's cloud-init conventions, and a
  `jumphost:1` tester pod in the VPC that runs every check over `ssh` as `learner`.
  kubeadm-node: `crictl images` lists every workload image, a single-node `kubeadm init`,
  and one Pod per workload image Running with `imagePullPolicy: Never`. kubeadm-upgrade:
  the same on v1.36.5, then the offline `apt-get update`/`install` of 1.37.1,
  `kubeadm upgrade apply v1.37.1 --etcd-upgrade=false`, kubelet restart, and the node and
  kube-apiserver at v1.37.1. etcd-host: `etcdctl endpoint health` over mutual TLS, a client
  without a certificate is refused, then the etcd lab's provision script and solution.
  Results: `deploy/.results/image-test/<variant>.txt`. At most one test VM runs at a time.
  kubeadm-upgrade (2026-10-14, image packaged with `PACKAGE_ONLY=1` from the TCG-built
  disk, 4.51 GB containerDisk image): PASSED in 794 s. `kubeadm upgrade plan` and
  `kubeadm upgrade plan v1.37.1` both exit 0 offline; installing the kubelet 1.37.1
  package **restarts kubelet** (new PID; the node keeps reporting v1.36.5 until the
  config is upgraded and kubelet restarted again by the learner); afterwards kube-apiserver
  and kubelet report v1.37.1.
- CDI alternative: the same `disk.qcow2` can be served as a `DataVolume` source (`http` or
  `registry` import). A DataVolume is the better fit for persistent per-learner disks;
  containerDisk is the better fit for disposable labs.

## Lab runtime tiers (foundations stream)

Status and measurements: `docs/handoffs/foundations.md`.

- **Tier A, unprivileged pods** (`el-lab:10`, `deb-lab:24.04`, `task image:build:linux-pod`).
  Catalog `userNamespace: true`: the container driver sets `hostUsers: false` when every
  schedulable node reports user namespace support for the runtime handler
  (`--user-namespaces=auto|true|false`), except for pods with a privileged container
  (topology links). Works on this kind cluster (K8s 1.36.4, containerd 2.3.4, runc 1.4.3,
  kernel 6.18); idmapped PVC mounts keep uid 1000 on the node. Fallback: host users, with
  the reason in the pod annotation `labs.cloudtrain.dev/user-namespace`. PID 1 is tini,
  learner (uid 1000) has no sudo rights, package sources point only at the mirror.
- **Tier B, Kata**: deferred (download size); tier-B labs run as tier-C VMs locally.
- **Tier C, VMs** (`el-vm:10`, `ubuntu-vm:24.04`, `task image:build:el-vm|ubuntu-vm`). The
  mirror snapshot is baked in as the only, local repo (`/opt/cloudtrain/repo/<el10|noble>`),
  because lab VPCs have no route to cluster services. Extra blank disks: topology
  `resources.disks: ["2Gi", "2Gi"]` -> `/dev/vdb..`, `/dev/disk/by-id/virtio-ct-dataN`.
- **Mirrors** (`task mirror:content`, `task mirror:up`): namespace `cloudtrain-mirrors`.
  Labs reference `http://mirror.cloudtrain-mirrors.svc/el10/`, `/noble/` (key
  `/keys/cloudtrain-mirror.asc`), `/pypi/simple/`, `/ansible/`; registry
  `registry.cloudtrain-mirrors.svc:5000` (zot, allowlist = catalog `workloadImages`,
  anonymous read only); Gitea `http://git.cloudtrain-mirrors.svc:3000` (anonymous read, no
  sign-up). Ingress only from pods labelled `labs.cloudtrain.dev/session`.
- **kubeadm extras** (`kubeadm:1.37-full` = `kubeadm:1.37-sec`, `build.sh kubeadm-full`,
  layered on kubeadm:1.37): `/opt/cloudtrain/bin/addons-install <list> [--wait] [--pool a-b]`
  after `kubeadm init` + `cni-install`; see the catalog comment for the add-on list.

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
   `/dev/kvm` is mounted. `host-prep.sh` repairs a stray directory, but that repair path
   has **not been tested** since it was written (it needs the broken state from a WSL
   reboot). host-prep runs `modprobe` in the kind node image (pinned by digest, ships
   kmod), so it fetches nothing at runtime.
4. **Multus thick daemon limits (50Mi/100m upstream) are too small.** Delegate plugins
   such as portmap run in its cgroup, hit `memory.max` about 300k times, and sandboxes fail
   with `failed to reserve sandbox name`. The manifest is vendored in
   `deploy/multus/multus-daemonset-thick.yaml` with 100Mi request / 512Mi limit and no CPU
   limit, and with the image pinned to `v4.3.1-thick` by digest. It is applied as is, so a
   re-run of `dev:up` is a no-op (the earlier apply-then-patch bumped the DaemonSet twice
   and bounced a Multus pod on every run). The upstream file's sha256 is recorded in
   `versions.env`; re-vendor it when bumping `MULTUS_VERSION`.
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
