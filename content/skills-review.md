# Kubernetes skill graph and lab review

Scope: `content/skills.yaml` (Kubernetes domain), `content/frameworks/{cka,ckad,cks}.yaml`
and the 11 labs in `content/packs/kubernetes`. Target releases: lab clusters on
Kubernetes v1.37.1 (`kubeadm:1.37`), the upgrade lab from v1.36 to v1.37.1
(`kubeadm:1.36`), the etcd lab on `etcd-host:3.6`. Curricula checked against the
public CNCF curriculum documents: CKA v1.35, CKAD v1.37, CKS v1.34. Framework topic
titles are our own paraphrases; nothing is copied from the curricula or from
question banks.

## 1. Findings

**Granularity**

- Several skills bundled two capabilities that a check can tell apart:
  Helm + Kustomize, Ingress + Gateway API, node + pod affinity, CRDs/operators +
  the CNI/CSI/CRI interfaces, access modes + reclaim policies. Each was split.
- Some skills were not assessable ("Explain ..."): HA control planes, NetworkPolicy
  basics, components, mTLS. They now name something a learner does.
- `k8s.security.supply-chain` covered a whole CKS domain (20 %). It is now four
  skills plus the original (narrowed to vulnerability scanning).
- `k8s.storage.capacity-units` is about resource quantities in general, not only
  storage. The id is kept to avoid a migration; workload labs may tag it too.

**Terminology (v1.36/v1.37)**

- Service backends are checked through EndpointSlices (the Endpoints API is
  deprecated); native sidecars are init containers with `restartPolicy: Always`;
  in etcd 3.6 restore is `etcdutl`, not `etcdctl`. Titles now say so.

**Prerequisite edges** (graph stays acyclic, enforced by lab-verify)

- Missing: `linux.packages.repositories` for `k8s.cluster.kubeadm-upgrade` (a minor
  upgrade starts by switching the per-minor apt repository);
  `linux.systemd.journal` for `k8s.troubleshooting.nodes`;
  `k8s.cluster.container-runtime` (crictl) for `k8s.troubleshooting.control-plane`;
  `k8s.networking.netpol-basics` for `k8s.troubleshooting.networking`;
  `k8s.cluster.node-prep` for `k8s.cluster.kubeadm-install`.
- Spurious: `linux.systemd.unit-editing` for `k8s.cluster.etcd-restore`. A kubeadm
  etcd is restored by editing a static Pod manifest; systemd is only one variant.
- `k8s.security.sandboxing` now builds on the container runtime instead of the
  generic extensions skill; `k8s.security.mtls` builds on CNI knowledge.

**Structure**

- Added competency `k8s.delivery` (image build, release strategies, API
  deprecations) for the CKAD application-delivery items that fit no existing one.
- `k8s.rbac` is retitled "Identity and access control" (it now also holds CSR-based
  user credentials).
- `k8s.cluster` still mixes install, upgrade, etcd, Helm and CRDs. Splitting it would
  rename ids (a learner-model migration), so it is left as is.

**Coverage gaps**: 54 framework topics had no skill, or skills with no lab (see the
matrix in section 4). Missing skills were added (section 2); missing labs are in the
backlog (section 5).

**Lab tagging**

- Several tags were padding: the grader runs `kubectl auth can-i` and the network
  probes itself, so `k8s.rbac.auth-can-i`, `k8s.networking.connectivity-testing` and
  `linux.net.troubleshooting` were tagged without the learner doing anything that
  shows them. Tags like `k8s.cli.manifests`, `k8s.workloads.deployments` and
  `k8s.cli.output-formatting` were on checks that any approach passes.
- Guard checks ("leave X untouched") had unrelated skills. They now use the new
  `k8s.cli.scoped-changes` at weight 0.5.
- Lab `metadata.frameworks` now lists exactly the objectives whose skills the lab's
  checks are tagged with (CKAD objectives added). lab-verify warns when a listed
  objective shares no skill with the checks.

## 2. Changes made

| Kind | Skills |
|---|---|
| New | `k8s.cli.scoped-changes`, `k8s.workloads.jobs`, `k8s.workloads.quotas-limitranges`, `k8s.delivery.image-build`, `k8s.delivery.deployment-strategies`, `k8s.delivery.api-deprecations`, `k8s.scheduling.pod-affinity`, `k8s.networking.loadbalancer`, `k8s.networking.coredns-config`, `k8s.networking.gateway-api`, `k8s.storage.reclaim-policy`, `k8s.storage.ephemeral-volumes`, `k8s.storage.csi-drivers`, `k8s.rbac.user-certificates`, `k8s.cluster.node-prep`, `k8s.cluster.container-runtime`, `k8s.cluster.kustomize`, `k8s.troubleshooting.resource-usage`, `k8s.troubleshooting.debug-containers`, `k8s.security.immutability`, `k8s.security.admission-control`, `k8s.security.node-metadata`, `k8s.security.ingress-tls`, `k8s.security.binary-verification`, `k8s.security.image-footprint`, `k8s.security.sbom`, `k8s.security.image-signing`, `k8s.security.static-analysis`, `k8s.security.incident-investigation`, `linux.security.attack-surface` |
| Narrowed (same id) | `k8s.cluster.packaging` -> Helm only; `k8s.cluster.extensions` -> CRDs/operators; `k8s.networking.ingress-gateway` -> Ingress only; `k8s.scheduling.node-affinity` -> node affinity only; `k8s.storage.access-modes` -> access modes only; `k8s.security.supply-chain` -> vulnerability scanning; `k8s.rbac.roles` -> rule writing for Role and ClusterRole; `k8s.rbac.clusterroles` -> choosing cluster scope |
| Reworded to be assessable | `k8s.cluster.components`, `k8s.cluster.ha-control-plane`, `k8s.networking.netpol-basics`, `k8s.networking.cni`, `k8s.security.mtls`, `k8s.security.api-server-hardening`, `k8s.security.rbac-least-privilege` |
| Edges | see section 1 |
| Frameworks | Topics are structured `{id, title, skills}`. Objective ids are unchanged, so lab refs and the web fixtures stay valid. New `ckad.yaml`. |

The graph has 153 skills; 35 are exercised by at least one lab
(`lab-verify --verbose` lists the others as info).

## 3. Lab technical review

All labs: context instructions now say to switch from the workstation first;
kubeadm clusters use `image: kubeadm:1.37` with `version: v1.37.1`; virtual clusters
declare v1.37; Pod images all come from `workloadImages`; no grader expectation
depends on trailing whitespace (the grader's trimming is not specified yet).

| Lab | Problems found | Fix |
|---|---|---|
| scale-berth-planner | Guard tagged with unrelated skills; wrong-namespace mutation only aimed at one check | Guard uses scoped-changes at 0.5; the mutation also expects `ready-replicas` to fail |
| two-container-pod | `native-sidecars` tag on "no init containers" (that is evidence about app containers); task did not say "in `spec.containers`" | Retagged; task explicit |
| nodeselector-nvme-pod | Label guard parsed the `-L` table by column position (fragile); `--overrides` without `apiVersion` (kubectl documents it as required) | jsonpath guard; `apiVersion` added in hint, mutation and alternative |
| hostpath-pv-readonly | Padding tag | Retagged |
| count-schedulable-nodes | `output-formatting` tag although counting by eye is valid | Removed; guard is scoped-changes |
| rbac-pipeline-grant | `auth-can-i` and `rbac-least-privilege` (audit skill) tagged on grader-run can-i checks | Rule checks use `k8s.rbac.roles`, scope checks `binding-scope`; task names the `apps` group |
| named-port-nodeport | Mutation used `httpd:2.4` (not in the catalog: ImagePullBackOff offline); target port 80 accepted although the task asks for the name; rollout check passed before any change; `sed a\` alternative was fragile | New "port in a second container" misconception; named targetPort required; rollout check requires 3 ready Pods carrying the named port; JSON-patch alternative |
| netpol-namespace-port | Task did not say same-namespace Pods are denied (a check enforces it); a CNI that rejects instead of dropping gave "error" | Task explicit; refused/unreachable count as blocked |
| drain-yard-worker | Health checks passed before the solution; cordon-then-evict alternative only evicted `yard-ops` (CoreDNS etc. could stay on the node); DaemonSet deletion raced drain | Health means ready Pods off the target; alternative evicts every non-DaemonSet Pod; foreground cascade; DaemonSet rule stated in the task |
| kubeadm-control-plane-upgrade | Was a 1.35 patch upgrade on an image that does not exist | Rewritten as a v1.36 to v1.37.1 minor upgrade against the offline per-minor apt mirror; adds hold check and "same-minor repository" misconception; worker checks accept any 1.36 patch |
| etcd-snapshot-restore | `tls-disabled` mutation was never caught: etcd requires client certificates whenever `--trusted-ca-file` is set, even with `--client-cert-auth=false` | Mutation drops both flags |

Hints: full answers appear only in hints that cost at least 2 points (or 3 for
complete manifests). Hints that cost 0 only give the context switch.

## 4. Coverage matrix

Framework topic -> mapped skills -> labs whose checks are tagged with any of them. "(no lab)" marks a skill with no lab yet; **gap** marks a topic that no lab covers.

### Certified Kubernetes Administrator (CKA) (curriculum v1.35)

| Objective / topic | Skills | Labs exercising them |
|---|---|---|
| storage (10%) / StorageClasses and dynamic provisioning | `k8s.storage.storage-classes` (no lab), `k8s.storage.csi-drivers` (no lab) | **gap** |
| storage (10%) / Volume types, access modes and reclaim policies | `k8s.storage.access-modes`, `k8s.storage.reclaim-policy` (no lab), `k8s.storage.ephemeral-volumes` (no lab) | hostpath-pv-readonly |
| storage (10%) / Managing PersistentVolumes and claims | `k8s.storage.persistent-volumes`, `k8s.storage.capacity-units`, `k8s.storage.claims` (no lab) | hostpath-pv-readonly |
| troubleshooting (30%) / Clusters and nodes | `k8s.scheduling.node-status`, `k8s.scheduling.taints-tolerations`, `k8s.troubleshooting.nodes` (no lab) | count-schedulable-nodes |
| troubleshooting (30%) / Cluster components | `k8s.troubleshooting.control-plane` (no lab), `k8s.cluster.container-runtime` (no lab) | **gap** |
| troubleshooting (30%) / Cluster and application resource usage | `k8s.troubleshooting.resource-usage` (no lab), `k8s.cli.output-formatting` (no lab) | **gap** |
| troubleshooting (30%) / Container output streams | `k8s.troubleshooting.logs` (no lab), `k8s.troubleshooting.events` (no lab), `k8s.troubleshooting.debug-containers` (no lab) | **gap** |
| troubleshooting (30%) / Services and networking | `k8s.troubleshooting.networking` (no lab) | **gap** |
| workloads-scheduling (15%) / Deployments, rolling updates and rollbacks | `k8s.workloads.deployments` (no lab), `k8s.workloads.scaling`, `k8s.workloads.rollouts` | named-port-nodeport, scale-berth-planner |
| workloads-scheduling (15%) / Configuring applications with ConfigMaps and Secrets | `k8s.workloads.config` (no lab) | **gap** |
| workloads-scheduling (15%) / Workload autoscaling | `k8s.workloads.autoscaling` (no lab) | **gap** |
| workloads-scheduling (15%) / Primitives for robust, self-healing applications | `k8s.workloads.pods`, `k8s.workloads.multi-container-pods`, `k8s.workloads.native-sidecars` (no lab), `k8s.workloads.probes` (no lab), `k8s.workloads.daemonsets` (no lab), `k8s.workloads.statefulsets` (no lab) | nodeselector-nvme-pod, two-container-pod |
| workloads-scheduling (15%) / Pod admission and scheduling (resource limits, placement) | `k8s.workloads.resources` (no lab), `k8s.workloads.quotas-limitranges` (no lab), `k8s.scheduling.node-labels`, `k8s.scheduling.node-selector`, `k8s.scheduling.node-affinity` (no lab), `k8s.scheduling.pod-affinity` (no lab), `k8s.scheduling.taints-tolerations`, `k8s.scheduling.priority-preemption` (no lab) | count-schedulable-nodes, nodeselector-nvme-pod |
| cluster-architecture (25%) / Role-based access control | `k8s.rbac.service-accounts`, `k8s.rbac.roles`, `k8s.rbac.clusterroles`, `k8s.rbac.binding-scope`, `k8s.rbac.auth-can-i` (no lab), `k8s.rbac.user-certificates` (no lab) | rbac-pipeline-grant |
| cluster-architecture (25%) / Preparing hosts for a cluster install | `k8s.cluster.node-prep` (no lab) | **gap** |
| cluster-architecture (25%) / Creating and managing clusters with kubeadm | `k8s.cluster.components` (no lab), `k8s.cluster.kubeadm-install` (no lab), `k8s.cluster.kubelet` | kubeadm-control-plane-upgrade |
| cluster-architecture (25%) / Cluster lifecycle (upgrades, node maintenance, etcd backup and restore) | `k8s.cluster.version-skew`, `k8s.cluster.kubeadm-upgrade`, `k8s.scheduling.cordon-drain`, `k8s.cluster.etcd-tls`, `k8s.cluster.etcd-snapshot`, `k8s.cluster.etcd-restore` | drain-yard-worker, etcd-snapshot-restore, kubeadm-control-plane-upgrade |
| cluster-architecture (25%) / Highly available control planes | `k8s.cluster.ha-control-plane` (no lab) | **gap** |
| cluster-architecture (25%) / Installing cluster components with Helm and Kustomize | `k8s.cluster.packaging` (no lab), `k8s.cluster.kustomize` (no lab) | **gap** |
| cluster-architecture (25%) / Extension interfaces (CNI, CSI, CRI) | `k8s.networking.cni` (no lab), `k8s.storage.csi-drivers` (no lab), `k8s.cluster.container-runtime` (no lab) | **gap** |
| cluster-architecture (25%) / CRDs and operators | `k8s.cluster.extensions` (no lab) | **gap** |
| services-networking (20%) / Connectivity between Pods | `k8s.networking.cni` (no lab), `k8s.networking.connectivity-testing` (no lab) | **gap** |
| services-networking (20%) / Defining and enforcing NetworkPolicies | `k8s.networking.netpol-basics`, `k8s.networking.netpol-selectors`, `k8s.networking.netpol-ports` | netpol-namespace-port |
| services-networking (20%) / Service types (ClusterIP, NodePort, LoadBalancer) and endpoints | `k8s.networking.services`, `k8s.networking.named-ports`, `k8s.networking.nodeport`, `k8s.networking.loadbalancer` (no lab), `k8s.networking.endpoints` (no lab) | named-port-nodeport |
| services-networking (20%) / Managing ingress traffic with the Gateway API | `k8s.networking.gateway-api` (no lab) | **gap** |
| services-networking (20%) / Ingress controllers and Ingress resources | `k8s.networking.ingress-gateway` (no lab) | **gap** |
| services-networking (20%) / Using and configuring CoreDNS | `k8s.networking.dns` (no lab), `k8s.networking.coredns-config` (no lab) | **gap** |

### Certified Kubernetes Application Developer (CKAD) (curriculum v1.37)

| Objective / topic | Skills | Labs exercising them |
|---|---|---|
| design-build (20%) / Building and changing container images | `k8s.delivery.image-build` (no lab) | **gap** |
| design-build (20%) / Picking the right workload resource | `k8s.workloads.deployments` (no lab), `k8s.workloads.daemonsets` (no lab), `k8s.workloads.statefulsets` (no lab), `k8s.workloads.jobs` (no lab) | **gap** |
| design-build (20%) / Multi-container Pod patterns (sidecar, init and others) | `k8s.workloads.multi-container-pods`, `k8s.workloads.native-sidecars` (no lab) | two-container-pod |
| design-build (20%) / Persistent and ephemeral volumes | `k8s.storage.claims` (no lab), `k8s.storage.ephemeral-volumes` (no lab) | **gap** |
| deployment (20%) / Blue/green and canary releases with core primitives | `k8s.delivery.deployment-strategies` (no lab) | **gap** |
| deployment (20%) / Deployments and rolling updates | `k8s.workloads.rollouts`, `k8s.workloads.scaling` | named-port-nodeport, scale-berth-planner |
| deployment (20%) / Deploying existing Helm charts | `k8s.cluster.packaging` (no lab) | **gap** |
| deployment (20%) / Kustomize | `k8s.cluster.kustomize` (no lab) | **gap** |
| observability-maintenance (15%) / API deprecations | `k8s.delivery.api-deprecations` (no lab) | **gap** |
| observability-maintenance (15%) / Probes and health checks | `k8s.workloads.probes` (no lab) | **gap** |
| observability-maintenance (15%) / Monitoring applications with built-in CLI tools | `k8s.troubleshooting.resource-usage` (no lab), `k8s.cli.output-formatting` (no lab) | **gap** |
| observability-maintenance (15%) / Container logs | `k8s.troubleshooting.logs` (no lab) | **gap** |
| observability-maintenance (15%) / Debugging in Kubernetes | `k8s.troubleshooting.events` (no lab), `k8s.troubleshooting.debug-containers` (no lab) | **gap** |
| environment-config-security (25%) / Resources that extend Kubernetes (CRDs, operators) | `k8s.cluster.extensions` (no lab) | **gap** |
| environment-config-security (25%) / Authentication, authorization and admission control | `k8s.rbac.roles`, `k8s.rbac.binding-scope`, `k8s.rbac.auth-can-i` (no lab), `k8s.security.admission-control` (no lab) | rbac-pipeline-grant |
| environment-config-security (25%) / Requests, limits and quotas | `k8s.workloads.resources` (no lab), `k8s.workloads.quotas-limitranges` (no lab), `k8s.storage.capacity-units` | hostpath-pv-readonly |
| environment-config-security (25%) / ConfigMaps and Secrets | `k8s.workloads.config` (no lab) | **gap** |
| environment-config-security (25%) / ServiceAccounts | `k8s.rbac.service-accounts` | rbac-pipeline-grant |
| environment-config-security (25%) / Application security (securityContext, capabilities) | `k8s.security.security-context` (no lab) | **gap** |
| services-networking (20%) / NetworkPolicy basics | `k8s.networking.netpol-basics`, `k8s.networking.netpol-selectors`, `k8s.networking.netpol-ports` | netpol-namespace-port |
| services-networking (20%) / Providing and troubleshooting access through Services | `k8s.networking.services`, `k8s.networking.named-ports`, `k8s.networking.nodeport`, `k8s.networking.endpoints` (no lab), `k8s.troubleshooting.networking` (no lab) | named-port-nodeport |
| services-networking (20%) / Exposing applications with Ingress rules | `k8s.networking.ingress-gateway` (no lab) | **gap** |

### Certified Kubernetes Security Specialist (CKS) (curriculum v1.34)

| Objective / topic | Skills | Labs exercising them |
|---|---|---|
| cluster-setup (15%) / Restricting cluster-level access with network policies | `k8s.networking.netpol-selectors`, `k8s.networking.netpol-ports`, `k8s.security.netpol-default-deny` (no lab) | netpol-namespace-port |
| cluster-setup (15%) / Reviewing component configuration against the CIS benchmark | `k8s.security.cis-benchmark` (no lab) | **gap** |
| cluster-setup (15%) / Ingress with TLS | `k8s.security.ingress-tls` (no lab) | **gap** |
| cluster-setup (15%) / Protecting node metadata and endpoints | `k8s.security.node-metadata` (no lab) | **gap** |
| cluster-setup (15%) / Verifying platform binaries | `k8s.security.binary-verification` (no lab) | **gap** |
| cluster-hardening (15%) / Minimising exposure with RBAC | `k8s.rbac.roles`, `k8s.rbac.binding-scope`, `k8s.security.rbac-least-privilege` (no lab) | rbac-pipeline-grant |
| cluster-hardening (15%) / Careful ServiceAccount use (defaults, minimal permissions) | `k8s.security.sa-token-hygiene` (no lab) | **gap** |
| cluster-hardening (15%) / Restricting access to the Kubernetes API | `k8s.security.api-server-hardening` (no lab) | **gap** |
| cluster-hardening (15%) / Keeping Kubernetes upgraded | `k8s.cluster.kubeadm-upgrade` | kubeadm-control-plane-upgrade |
| system-hardening (10%) / Minimising the host OS footprint | `linux.security.attack-surface` (no lab) | **gap** |
| system-hardening (10%) / Least-privilege identity and access | `linux.users.sudo` (no lab), `k8s.security.kubelet-hardening` (no lab) | **gap** |
| system-hardening (10%) / Minimising external network access | `linux.net.firewall` (no lab) | **gap** |
| system-hardening (10%) / Kernel hardening tools (AppArmor, seccomp) | `linux.security.mac` (no lab), `k8s.security.seccomp-apparmor` (no lab) | **gap** |
| microservice-vulnerabilities (20%) / Pod Security Standards | `k8s.security.pod-security-admission` (no lab), `k8s.security.security-context` (no lab) | **gap** |
| microservice-vulnerabilities (20%) / Managing Kubernetes Secrets | `k8s.security.secrets` (no lab) | **gap** |
| microservice-vulnerabilities (20%) / Isolation techniques (multi-tenancy, sandboxed runtimes) | `k8s.security.sandboxing` (no lab) | **gap** |
| microservice-vulnerabilities (20%) / Pod-to-pod encryption | `k8s.security.mtls` (no lab) | **gap** |
| supply-chain-security (20%) / Minimising base image footprint | `k8s.security.image-footprint` (no lab) | **gap** |
| supply-chain-security (20%) / Understanding the supply chain (SBOMs, pipelines, registries) | `k8s.security.sbom` (no lab) | **gap** |
| supply-chain-security (20%) / Securing the supply chain (permitted registries, signatures) | `k8s.security.image-signing` (no lab), `k8s.security.admission-control` (no lab) | **gap** |
| supply-chain-security (20%) / Static analysis of workloads and images | `k8s.security.static-analysis` (no lab), `k8s.security.supply-chain` (no lab) | **gap** |
| monitoring-runtime-security (20%) / Behavioural analytics to detect malicious activity | `k8s.security.runtime-detection` (no lab) | **gap** |
| monitoring-runtime-security (20%) / Detecting threats across infrastructure and workloads | `k8s.security.runtime-detection` (no lab) | **gap** |
| monitoring-runtime-security (20%) / Investigating attack phases and actors | `k8s.security.incident-investigation` (no lab) | **gap** |
| monitoring-runtime-security (20%) / Container immutability at runtime | `k8s.security.immutability` (no lab) | **gap** |
| monitoring-runtime-security (20%) / Monitoring access with audit logs | `k8s.security.audit-logging` (no lab) | **gap** |

## 5. Lab backlog (prioritised)

Ordered by curriculum weight times the number of uncovered topics. All scenarios are
set in the pack's fictional universe (Quillmoor Logistics); names are original.

| # | Title | Scenario | Skills | Frameworks |
|---|---|---|---|---|
| 1 | Bring a depot worker back to Ready | `depot-wk-2` is NotReady after a botched kubelet config edit; find the cause in the journal and fix it. | troubleshooting.nodes, cluster.kubelet | CKA troubleshooting |
| 2 | Revive the scheduler on the yard cluster | New Pods stay Pending; the scheduler static Pod has a broken flag. Use crictl and the manifest to repair it. | troubleshooting.control-plane, cluster.container-runtime | CKA troubleshooting |
| 3 | Find the memory hog in parcel-sorting | Report the Pod with the highest memory use in a namespace to a file using the metrics API. | troubleshooting.resource-usage | CKA troubleshooting, CKAD observability |
| 4 | Why does the tariff API return nothing? | A Service has no endpoints (label typo) and a DNS name fails; fix both. | troubleshooting.networking, networking.endpoints, networking.dns | CKA troubleshooting |
| 5 | Crash-looping label printer | Read the previous container's logs and events, fix the command. | troubleshooting.logs, troubleshooting.events | CKA troubleshooting, CKAD observability |
| 6 | Debug a distroless invoice renderer | Attach an ephemeral debug container to a shell-less Pod and fix its config. | troubleshooting.debug-containers | CKAD observability |
| 7 | Join a second control plane to qm-ledger | Add `ledger-cp-2` behind the shared endpoint with stacked etcd. | cluster.ha-control-plane, cluster.kubeadm-install | CKA cluster architecture |
| 8 | Prepare a fresh fleet node | Load kernel modules, set sysctls, disable swap, configure containerd, then join with kubeadm. | cluster.node-prep, cluster.kubeadm-install | CKA cluster architecture |
| 9 | Install the shipment-events operator | Install a CRD and operator with Helm, create a custom resource. | cluster.packaging, cluster.extensions | CKA, CKAD |
| 10 | Kustomize overlays for two depots | Build prod/staging overlays with a patch and apply with `-k`. | cluster.kustomize | CKA, CKAD |
| 11 | Gateway for the brokers' portal | Route two paths to two Services with a Gateway and HTTPRoutes. | networking.gateway-api | CKA networking |
| 12 | Ingress for the tracking UI | Expose two Services under one host with an Ingress. | networking.ingress-gateway | CKA, CKAD networking |
| 13 | Forward the customs zone | Configure CoreDNS to forward a private zone to an internal resolver. | networking.coredns-config | CKA networking |
| 14 | Dynamic volumes for the manifest store | Create a default StorageClass and a claim; change the reclaim policy of a released PV. | storage.storage-classes, storage.reclaim-policy, storage.claims | CKA storage |
| 15 | Quota for the sandbox namespace | Add a ResourceQuota and a LimitRange so Pods without requests get defaults. | workloads.quotas-limitranges, workloads.resources | CKA, CKAD |
| 16 | Autoscale the berth planner | Add requests and an HPA (needs metrics-server). | workloads.autoscaling | CKA workloads |
| 17 | Roll back the waybill API | A bad image rollout; inspect history and roll back to a named revision. | workloads.rollouts | CKA, CKAD |
| 18 | Probes for the dock scheduler | Add readiness and liveness probes so a slow start does not cause restarts. | workloads.probes | CKA, CKAD |
| 19 | Nightly ledger export CronJob | Run a CronJob with history limits and a deadline. | workloads.jobs | CKAD design |
| 20 | Canary for the quote engine | Send a share of traffic to a new version with two Deployments behind one Service. | delivery.deployment-strategies | CKAD deployment |
| 21 | Config and secrets for the routing engine | Mount a ConfigMap and inject a Secret as env. | workloads.config | CKA, CKAD |
| 22 | A user certificate for the night-shift lead | Issue credentials through the CSR API, bind a Role, add a kubeconfig context; record `auth can-i` output to a file. | rbac.user-certificates, rbac.auth-can-i | CKA cluster architecture |
| 23 | Restricted namespace for the kiosk team | Enforce the restricted Pod Security Standard and fix a Pod to comply. | security.pod-security-admission, security.security-context | CKS, CKAD |
| 24 | Default-deny for customs | Default-deny ingress/egress plus DNS egress; block the node metadata address. | security.netpol-default-deny, security.node-metadata | CKS cluster setup |
| 25 | Audit who read the tariff secrets | Write an audit policy, enable it on the API server, find the reader. | security.audit-logging, security.api-server-hardening | CKS |
| 26 | Only signed images from the Quillmoor registry | Enforce a registry allow-list with ValidatingAdmissionPolicy. | security.admission-control, security.image-signing | CKS supply chain, CKAD |
| 27 | Immutable label printers | Read-only root filesystem with emptyDir for writable paths. | security.immutability, storage.ephemeral-volumes | CKS runtime |
| 28 | Rebuild the waybill image smaller | Multi-stage build, non-root user, scan before and after. | delivery.image-build, security.image-footprint, security.supply-chain | CKAD, CKS |

Lower priority (small weight or needs extra platform support): LoadBalancer
Services (needs a load balancer in the lab VPC), CSI drivers, AppArmor/seccomp
profiles, RuntimeClass sandboxing (needs gVisor/Kata inside the lab VMs), mTLS
mesh, Falco-style runtime detection, SBOMs, binary checksum verification, CIS
benchmark runs, kubelet hardening, API deprecation migration, encryption at rest.

## 6. Not settled statically

To be confirmed by the verifier on a live stack:

- **Upgrade lab**: depends on the image contract in section 7 (mirror paths, holds,
  preloaded v1.37.1 images). Also: offline `kubeadm upgrade plan v1.37.1` (it may warn
  that it cannot fetch the latest version); whether the kubelet deb restarts the
  service (`forgot-kubelet-restart` assumes it does not); whether `apt-get update`
  exits 0 when no internet-bound source is configured.
- **netpol lab**: the current golden image ships Flannel, which does not enforce
  NetworkPolicy. Setup aborts on purpose until the image ships Calico or Cilium.
- **etcd lab**: the solution restores without `--name`/`--initial-cluster`, then
  starts the unit with `--name=ledger-etcd`. etcd should accept this on an existing
  data dir. Mutation timings are also unconfirmed.
- **count-schedulable-nodes**: how the driver implements `state: notready` (stopped
  kubelet or something else) and when node-controller taints appear. The guard
  compares against a baseline taken at setup, so either way works.
- **hostpath-pv-readonly on vcluster**: the PV must reach phase `Available` inside
  the virtual cluster.
- **Grader semantics**: no executor exists yet. Assumed: output compared untrimmed
  (expectations avoid trailing whitespace anyway); `k8s-query` needs a `name`;
  regex uses RE2.
- **Name resolution**: `curl http://tracking-wk-1:<port>` in a hint needs the
  jumphost to resolve kubeadm node names (docs/k8s-readiness.md implies it does).
- **curl** must be present on kubeadm nodes (named-port reachability check).

## 7. Requests for the images stream

- `kubeadm:1.37`: a NetworkPolicy-enforcing CNI (Calico or Cilium) with its images
  preloaded, at least for clusters that run netpol labs (Flannel cannot enforce
  policy); `curl` on the nodes; `workloadImages` preloaded.
- `kubeadm:1.36` (upgrade lab):
  - The v1.36 and v1.37 package mirrors are local flat apt repositories at
    `/opt/k8s-apt/v1.36/` and `/opt/k8s-apt/v1.37/`.
  - `/etc/apt/sources.list.d/kubernetes.list` references `/opt/k8s-apt/v1.36/`.
    Changing `/v1.36/` to `/v1.37/` in that line is the only edit the lab expects.
  - Both mirrors are signed with the keyring that the source line names, or
    marked `trusted=yes`.
  - No apt source may point at the internet (docker.list etc.), so that
    `apt-get update` succeeds.
  - kubeadm, kubelet and kubectl are on hold.
  - The images from `kubeadm config images list --kubernetes-version v1.37.1`
    (including that release's etcd, CoreDNS and pause) are preloaded on every
    node.
- `etcd-host:3.6`: `etcd`, `etcdctl`, `etcdutl`, `openssl`, systemd, a `learner`
  user with passwordless sudo and ssh from the jumphost.
- `jumphost:1`: `kubectl`, `ssh` client, and resolution of topology node names.
- Future backlog labs would need `metrics-server`, an Ingress controller, a
  Gateway API implementation and a CSI/hostpath provisioner. No extra workload
  images are needed for the current 11 labs.
