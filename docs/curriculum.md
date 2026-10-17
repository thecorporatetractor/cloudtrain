# CloudTrain curriculum (proposal)

<!-- GENERATED from content/curriculum.yaml by tools/curriculum/render.mjs. Do not edit by hand. -->

Status: **proposal**, version 2, updated 2026-10-14. Source of truth: `content/curriculum.yaml` (schema `packages/lab-schema/schema/curriculum.schema.json`, cross-checked by `tools/lab-verify`).

Proposed CloudTrain curriculum across six domains. Everything not yet built is status proposed and awaits approval. Alignment to external exams lives only in `frameworks` refs, path/exam disclaimers and descriptive text; titles never name an exam, exam code or certifying body.

Legend. **Type**: learn = guided first exposure, do = complete a task, fix = repair a broken system, hack = attack then mitigate, exam = exam task (no hints, drawn only by exam simulations). **Tier**: A = Unprivileged pod, B = Kata pod with capabilities, C = KubeVirt VM, K = kubeadm cluster VMs, V = Virtual cluster, N = Netdev topology. **Status**: verified = passed the full verifier cycle on a live stack, built = exists in `content/packs`, proposed = awaiting approval.

## Summary

| Domain | Paths | Learning labs | Exam tasks | Exams | Verified | Built | Proposed | Tier mix (all labs) | Learning hours |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kubernetes | 5 | 89 | 103 | 3 | 55 | 135 | 2 | C 1, K 112, V 79 | 25 |
| Linux administration | 11 | 159 | 119 | 3 | 2 | 20 | 256 | A 84, B 69, C 125 | 48 |
| Containers with Docker | 11 | 91 | 44 | 2 | 24 | 0 | 111 | B 71, C 64 | 28 |
| Infrastructure as code with Terraform | 5 | 54 | 45 | 2 | 48 | 0 | 51 | A 53, B 1, V 45 | 21 |
| Configuration management and automation | 7 | 61 | 36 | 1 | 0 | 0 | 97 | A 39, B 7, C 45, N 6 | 26 |
| Network administration | 4 | 45 | 32 | 1 | 16 | 9 | 52 | N 77 | 15 |
| **Total** | 43 | 499 | 379 | 13 | 145 | 164 | 569 | A 176, B 148, C 235, K 112, V 124, N 83 | 161 |

Cross-domain exams: Platform engineer practical capstone. Exam tasks are counted under the domain of each task. Learning labs by type: learn 47, do 356, fix 83, hack 13. New skills proposed: 291.

## Kubernetes

Operate, develop for and secure Kubernetes clusters on real kubeadm VMs and virtual clusters: workloads, scheduling, networking, storage, access control, cluster lifecycle, troubleshooting and security hardening, graded against live cluster state.

Fictional organisation: **Quillmoor Logistics** (A fictional freight and parcel logistics operator with depots, a container yard, a harbour terminal and a customs desk. Clusters are named qm-<area>; nodes <area>-cp-N and <area>-wk-N; namespaces name business functions in kebab-case; labels use the quillmoor.example domain.).

Competencies: `k8s.cli`, `k8s.workloads`, `k8s.delivery`, `k8s.scheduling`, `k8s.networking`, `k8s.storage`, `k8s.rbac`, `k8s.cluster`, `k8s.troubleshooting`, `k8s.security`.

### Paths (5)

| Path | Title | Level | Hours | Labs | Prerequisites | Aligns to | Audience |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kubernetes-foundations` | Kubernetes foundations | beginner | 6 | 11 | - | - | Engineers new to Kubernetes who can use a Linux shell |
| `cluster-administration` | Kubernetes cluster administration | intermediate | 22 | 50 | `kubernetes-foundations` | cka | Platform and operations engineers who run clusters |
| `application-developer` | Building and running applications on Kubernetes | intermediate | 16 | 33 | `kubernetes-foundations` | ckad | Application developers deploying services to Kubernetes |
| `cluster-security` | Kubernetes security hardening | advanced | 20 | 25 | `cluster-administration` | cks | Security and platform engineers protecting clusters and workloads |
| `kubernetes-on-call` | Kubernetes on-call troubleshooting | advanced | 6 | 9 | `cluster-administration` | - | Operators joining an on-call rotation |

<details><summary><b>Kubernetes foundations</b>: modules</summary>

- **kubectl and manifests**: `kubectl-first-contact`, `generate-manifest-dry-run`, `patch-without-clobbering`, `jsonpath-depot-inventory`
- **First workloads**: `two-container-pod`, `scale-berth-planner`, `routing-engine-config`, `label-printer-crashloop`
- **Reaching your app**: `dns-debug-pod`, `named-port-nodeport`, `tariff-api-no-endpoints`

</details>

<details><summary><b>Kubernetes cluster administration</b>: modules</summary>

- **Workloads and scheduling**: `waybill-rollback`, `rolling-update-surge`, `routing-engine-config`, `dock-scheduler-probes`, `telemetry-daemonset`, `nodeselector-nvme-pod`, `affinity-cold-chain`, `spread-tracking-replicas`, `taint-gpu-workers`, `priority-preemption-peak`, `qos-class-forecast`, `sandbox-quota-limitrange`, `berth-planner-hpa`, `native-sidecar-log-shipper`
- **Services and networking**: `named-port-nodeport`, `loadbalancer-kiosk-ip`, `dns-debug-pod`, `coredns-customs-forward`, `tracking-ingress-two-paths`, `brokers-gateway-routes`, `netpol-namespace-port`, `cni-trace-pod-path`
- **Storage**: `hostpath-pv-readonly`, `pvc-pending-mismatch`, `manifest-store-dynamic`, `csi-driver-inventory`, `shared-scratch-emptydir`
- **Access control**: `rbac-pipeline-grant`, `who-can-delete-secrets`, `night-shift-user-cert`
- **Cluster lifecycle**: `control-plane-tour`, `fleet-node-prep-join`, `kubeadm-bootstrap-cluster`, `drain-yard-worker`, `kubeadm-control-plane-upgrade`, `worker-kubelet-upgrade`, `etcd-snapshot-restore`, `kubeadm-etcd-static-restore`, `ledger-second-control-plane`, `helm-shipment-events`, `kustomize-depot-overlays`, `shipment-operator-crd`
- **Troubleshooting**: `count-schedulable-nodes`, `pending-pod-detective`, `parcel-sorting-memory-hog`, `distroless-invoice-debug`, `depot-worker-notready`, `yard-scheduler-revive`, `apiserver-down-cert-path`, `oncall-depot-incident`

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKA is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Building and running applications on Kubernetes</b>: modules</summary>

- **Design and build**: `build-waybill-image`, `two-container-pod`, `native-sidecar-log-shipper`, `ledger-export-cronjob`, `parallel-manifest-job`, `tariff-cache-statefulset`, `shared-scratch-emptydir`, `pvc-pending-mismatch`
- **Deployment**: `scale-berth-planner`, `rolling-update-surge`, `waybill-rollback`, `quote-engine-canary`, `blue-green-cutover`, `helm-shipment-events`, `kustomize-depot-overlays`
- **Observability and maintenance**: `dock-scheduler-probes`, `label-printer-crashloop`, `distroless-invoice-debug`, `parcel-sorting-memory-hog`, `migrate-deprecated-apis`, `jsonpath-depot-inventory`
- **Configuration and security**: `routing-engine-config`, `qos-class-forecast`, `sandbox-quota-limitrange`, `app-serviceaccount-api`, `who-can-delete-secrets`, `kiosk-restricted-pss`, `shipment-operator-crd`, `registry-allowlist-vap`
- **Services and networking**: `named-port-nodeport`, `tariff-api-no-endpoints`, `tracking-ingress-two-paths`, `netpol-namespace-port`

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKAD is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Kubernetes security hardening</b>: modules</summary>

- **Cluster setup**: `netpol-namespace-port`, `customs-default-deny`, `ingress-tls-tracking`, `cis-apiserver-findings`, `verify-kubectl-checksum`
- **Cluster hardening**: `rbac-overgrant-cleanup`, `sa-token-automount-off`, `api-access-restrict`, `kubeadm-control-plane-upgrade`
- **System hardening**: `node-footprint-reduce`, `kubelet-auth-hardening`, `seccomp-apparmor-printer`
- **Workload isolation**: `kiosk-restricted-pss`, `hostpath-mount-policy`, `secrets-encryption-at-rest`, `gvisor-runtimeclass`, `mtls-cni-encryption`
- **Supply chain**: `waybill-image-slim-scan`, `sbom-dispatch-image`, `static-analysis-manifests`, `registry-allowlist-vap`
- **Monitoring and runtime security**: `immutable-label-printers`, `tariff-secret-audit`, `falco-shell-in-container`, `intrusion-timeline`

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKS is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Kubernetes on-call troubleshooting</b>: modules</summary>

- **Application faults**: `label-printer-crashloop`, `pending-pod-detective`, `tariff-api-no-endpoints`, `distroless-invoice-debug`
- **Cluster faults**: `depot-worker-notready`, `yard-scheduler-revive`, `apiserver-down-cert-path`, `kubeadm-etcd-static-restore`, `oncall-depot-incident`

</details>

### Labs (89)

| Lab | Title | Type | Difficulty | Min | Tier | Status | Frameworks | Scenario |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `scale-berth-planner` | Scale one Deployment among several | do | easy | 5 | V | verified | cka:workloads-scheduling, ckad:deployment | The harbour dispatch team needs more capacity for the berth planner only; scale that Deployment in qm-dispatch to the requested replica count with every replica ready while its neighbours stay untouched. |
| `two-container-pod` | Run a web server and its cache in one Pod | do | easy | 8 | V | verified | cka:workloads-scheduling, ckad:design-build | Quillmoor's tracking kiosk needs a web server and a Redis cache sharing one Pod; create it in qm-depot with both app containers running in spec.containers. |
| `rbac-pipeline-grant` | Scoped create-only access for a release pipeline | do | medium | 12 | V | verified | cka:cluster-architecture, ckad:environment-config-security, cks:cluster-hardening | The release pipeline's ServiceAccount may only create Deployments, StatefulSets and DaemonSets in one namespace of qm-depot; grant exactly that with a ClusterRole bound by a RoleBinding. |
| `count-schedulable-nodes` | Report how many nodes can take new workloads | do | easy | 8 | K | verified | cka:troubleshooting, cka:workloads-scheduling | Before the peak-season freight wave, write to a file how many qm-capacity nodes are Ready and carry no NoSchedule taint, without changing any node. |
| `drain-yard-worker` | Take a worker out of service for maintenance | do | easy | 10 | K | built | cka:cluster-architecture | A qm-yard worker needs a firmware update; cordon and drain it so every non-DaemonSet Pod runs healthy elsewhere while node agents stay and the node remains registered. |
| `etcd-snapshot-restore` | Snapshot a TLS-secured etcd and roll back to a baseline | do | hard | 30 | C | built | cka:cluster-architecture, lfcs:operations-deployment | A faulty migration corrupted the billing ledger's etcd; snapshot the running TLS-secured member to the archive, then restore the approved baseline so etcd.service serves it on the same endpoint. |
| `hostpath-pv-readonly` | Publish a read-only hostPath PersistentVolume | do | easy | 8 | K | built | cka:storage | Signed customs manifests must be readable by many reporting Pods but writable by none; publish the archive directory in qm-archive as a ReadOnlyMany hostPath PersistentVolume of the given size. |
| `kubeadm-control-plane-upgrade` | Upgrade a kubeadm control plane to the next minor release | do | hard | 40 | K | built | cka:cluster-architecture, cks:cluster-hardening, lfcs:operations-deployment | Move the qm-ledger control-plane node from v1.36 to v1.37.1 with kubeadm from the offline apt mirror, upgrade and re-hold kubeadm, kubelet and kubectl, and leave the worker untouched. |
| `named-port-nodeport` | Publish a tracking UI through a named port and NodePort | do | easy | 12 | K | built | cka:services-networking, cka:workloads-scheduling, ckad:services-networking, ckad:deployment | Warehouse kiosks must reach the shipment-tracking UI on every qm-tracking node; add a named container port to the Deployment and expose it with a NodePort Service targeting that name. |
| `netpol-namespace-port` | Admit one namespace on one port with a NetworkPolicy | do | medium | 15 | K | built | cka:services-networking, ckad:services-networking, cks:cluster-setup | Lock down the customs-clearance namespace in qm-customs so only the brokers' namespace reaches the declaration API, on one TCP port, and nothing else gets in. |
| `nodeselector-nvme-pod` | Pin a Pod to fast-storage nodes with nodeSelector | do | easy | 8 | K | built | cka:workloads-scheduling | The label printer's spool must run on NVMe-backed workers; label the right qm-fleet node and schedule the Pod onto it with a nodeSelector. |
| `kubectl-first-contact` | Find your way around a cluster with kubectl | learn | easy | 10 | V | verified | cka:troubleshooting | On your first shift at the depot platform, switch to qm-depot, set parcel-tracking as the default namespace and write the names of its running Pods to a report file. |
| `generate-manifest-dry-run` | Generate and apply manifests with dry-run | learn | easy | 10 | V | verified | ckad:design-build | Generate a Deployment manifest for the parcel-label service with kubectl --dry-run, add a resource label in the file, save it under ~/manifests and apply it so the Deployment matches the file. |
| `jsonpath-depot-inventory` | Extract an inventory with jsonpath and custom columns | do | medium | 12 | V | verified | cka:troubleshooting, ckad:observability-maintenance | Produce a sorted file listing every qm-depot Pod with its node and container images using -o jsonpath or custom-columns, matching the exact format the depot auditor asked for. |
| `patch-without-clobbering` | Change a live Deployment without losing other fields | do | easy | 8 | V | verified | ckad:deployment | Raise the memory limit of one container in the dock-scheduler Deployment with kubectl patch or set while its sidecar, annotations and replica count stay exactly as they were. |
| `waybill-rollback` | Roll back a bad image rollout to a named revision | fix | easy | 10 | V | built | cka:workloads-scheduling, ckad:deployment | The waybill API rollout to a broken image left Pods crash-looping; inspect rollout history and return the Deployment to the revision annotated as the last approved release. |
| `rolling-update-surge` | Tune a rolling update so capacity never drops | do | medium | 12 | V | built | cka:workloads-scheduling, ckad:deployment | Configure the quote-engine Deployment's strategy so a new image rolls out with zero unavailable replicas and one surge Pod, then roll out the new tag and record the change cause. |
| `routing-engine-config` | Feed configuration and secrets to the routing engine | do | easy | 12 | V | verified | cka:workloads-scheduling, ckad:environment-config-security | Create a ConfigMap from the routing rules file and a Secret holding the map-service token, mount the rules at /etc/routing and expose the token as ROUTE_TOKEN in the routing-engine Deployment. |
| `dock-scheduler-probes` | Add probes so a slow start stops causing restarts | fix | medium | 15 | V | built | cka:workloads-scheduling, ckad:observability-maintenance | The dock-scheduler takes 40 s to warm up and is killed in a restart loop; add startup, readiness and liveness probes so it becomes Ready without restarts and drops out of the Service when unhealthy. |
| `ledger-export-cronjob` | Schedule the nightly ledger export | do | easy | 10 | V | verified | ckad:design-build | Run the ledger export at 02:30 every night as a CronJob that never runs two copies at once, keeps three successful and one failed Job, and gives up after a 10-minute deadline. |
| `parallel-manifest-job` | Process a manifest backlog with a parallel Job | do | medium | 12 | V | verified | ckad:design-build | Reprocess 12 customs manifest batches with an indexed Job that runs four Pods at a time and tolerates two retries, and leave it Complete. |
| `native-sidecar-log-shipper` | Ship logs with a native sidecar and an init step | do | medium | 15 | V | built | cka:workloads-scheduling, ckad:design-build | Add an init container that fetches the carrier map and a native sidecar (restartPolicy Always) that tails the app log so the label-printer Pod starts in order and the sidecar outlives the main container. |
| `telemetry-daemonset` | Run a telemetry agent on every node including the control plane | do | medium | 12 | K | built | cka:workloads-scheduling, ckad:design-build | Deploy the node-telemetry agent as a DaemonSet in qm-platform on qm-fleet so one Pod runs on every node, control plane included, via the right toleration. |
| `tariff-cache-statefulset` | Run the tariff cache as a StatefulSet with stable storage | do | medium | 18 | K | built | cka:workloads-scheduling, ckad:design-build | Turn the tariff cache into a three-replica StatefulSet behind a headless Service, each replica with its own 1Gi claim that survives Pod deletion. |
| `sandbox-quota-limitrange` | Cap the sandbox namespace with quota and defaults | do | medium | 15 | V | built | cka:workloads-scheduling, ckad:environment-config-security | Give the dev-sandbox namespace a ResourceQuota of 4 CPU / 8Gi and 20 Pods plus a LimitRange so Pods without requests get defaults, and prove an oversized Pod is rejected. |
| `qos-class-forecast` | Set requests and limits for a predictable QoS class | do | easy | 10 | V | built | cka:workloads-scheduling, ckad:environment-config-security | Make the payment-reconciler Pod Guaranteed and the report-renderer Pod Burstable by setting requests and limits, without changing their images or commands. |
| `berth-planner-hpa` | Autoscale the berth planner on CPU | do | medium | 15 | K | built | cka:workloads-scheduling | Add CPU requests and a HorizontalPodAutoscaler that keeps the berth planner between 2 and 8 replicas at 60 % average CPU, and show it scaling under the provided load generator. |
| `quote-engine-canary` | Send a share of traffic to a canary release | do | medium | 15 | V | verified | ckad:deployment | Run quote-engine v2 next to v1 behind the same Service so roughly one request in five reaches v2, using only Deployments, labels and replica counts. |
| `blue-green-cutover` | Cut over the customs portal blue/green | do | medium | 12 | V | verified | ckad:deployment | Stand up the green customs portal Deployment, verify it, then switch the Service selector so all traffic moves at once and blue stays scaled for rollback. |
| `build-waybill-image` | Build and tag an image from a Containerfile | learn | medium | 15 | K | built | ckad:design-build | Fix the waybill renderer's Containerfile so it builds, tag the image for the yard registry, export it as an OCI archive and run it in qm-yard from that tag. |
| `migrate-deprecated-apis` | Migrate manifests off removed API versions | fix | medium | 15 | V | verified | ckad:observability-maintenance | The fleet team's manifests still use removed API versions and fail to apply on v1.37; convert them to the served versions and apply them cleanly. |
| `helm-shipment-events` | Install and upgrade a chart with custom values | do | easy | 12 | V | built | cka:cluster-architecture, ckad:deployment | Install the shipment-events chart from the local repository into its own namespace with three replicas set via values, then upgrade it to the next chart version keeping those values. |
| `kustomize-depot-overlays` | Build staging and production overlays with Kustomize | do | medium | 15 | V | built | cka:cluster-architecture, ckad:deployment | Create staging and production overlays for the depot portal that change replicas, image tag and a ConfigMap value, and apply production with kubectl apply -k. |
| `shipment-operator-crd` | Install an operator and drive it with a custom resource | do | medium | 18 | V | proposed | cka:cluster-architecture, ckad:environment-config-security | Install the ShipmentRoute CRD and its operator, then create a ShipmentRoute that makes the operator produce the expected Deployment and report Ready in status. |
| `affinity-cold-chain` | Place cold-chain workloads with node affinity | do | medium | 12 | K | built | cka:workloads-scheduling | Require the cold-chain monitor to run in the refrigerated zone and prefer nodes with the gpu-free label, using node affinity, and confirm placement on qm-fleet. |
| `spread-tracking-replicas` | Spread replicas across zones and away from each other | do | hard | 18 | K | built | cka:workloads-scheduling | Ensure the six tracking API replicas spread evenly over the two qm-tracking zones and never share a node with the eta-predictor, using topology spread and pod anti-affinity. |
| `taint-gpu-workers` | Reserve workers for one workload with taints | do | easy | 10 | K | built | cka:workloads-scheduling | Taint the two label-imaging workers so only Pods tolerating the imaging taint land there, then give the imaging Deployment the matching toleration. |
| `priority-preemption-peak` | Protect critical workloads with PriorityClasses | do | medium | 15 | K | built | cka:workloads-scheduling | Create a high PriorityClass for customs clearance so its Pods preempt batch reporting when qm-capacity is full, and record which Pods were evicted. |
| `pending-pod-detective` | Find out why Pods stay Pending | fix | medium | 15 | K | built | cka:troubleshooting, cka:workloads-scheduling | Three Pods in qm-dispatch stay Pending for three different reasons (taint, unbound claim, oversized request); fix each so all three run. |
| `tariff-api-no-endpoints` | Why does the tariff API return nothing? | fix | medium | 15 | V | built | cka:troubleshooting, cka:services-networking, ckad:services-networking | The tariff API Service has no endpoints and its DNS name fails from the portal; fix the selector typo and the wrong Service name reference so the portal gets answers. |
| `tracking-ingress-two-paths` | Route two paths of one host with an Ingress | do | easy | 12 | K | built | cka:services-networking, ckad:services-networking | Publish track.quillmoor.example so /parcels reaches the parcel API and /eta reaches the eta-predictor through the cluster's Ingress controller. |
| `brokers-gateway-routes` | Route the brokers' portal with Gateway API | do | medium | 18 | K | built | cka:services-networking | Create a Gateway on the shared GatewayClass and HTTPRoutes so brokers.quillmoor.example/declarations and /tariffs go to two Services, with a 90/10 weight on the declarations route. |
| `coredns-customs-forward` | Forward a private zone in CoreDNS | do | medium | 15 | K | built | cka:services-networking | Make customs.quillmoor.example resolve from every qm-customs Pod by forwarding that zone to the customs resolver in the Corefile and rolling CoreDNS. |
| `loadbalancer-kiosk-ip` | Expose the kiosk API with a LoadBalancer Service | do | easy | 10 | K | built | cka:services-networking | Expose the kiosk API as a LoadBalancer Service, read the address the in-lab load balancer assigns and write it to a report file, then reach it from the workstation. |
| `cni-trace-pod-path` | Trace pod-to-pod traffic and name the CNI | learn | medium | 15 | K | built | cka:services-networking, cka:cluster-architecture | Identify the CNI plugin and Pod CIDR of qm-yard from node configuration, prove two Pods on different nodes can talk, and write both facts to the report file. |
| `dns-debug-pod` | Resolve Services and Pods through cluster DNS | learn | easy | 8 | V | built | cka:services-networking, ckad:services-networking | From a debug Pod in qm-depot, look up the parcel API Service and a Pod's DNS record and write the fully qualified names and addresses to a report file. |
| `manifest-store-dynamic` | Provision volumes dynamically for the manifest store | do | medium | 18 | K | built | cka:storage | Make a StorageClass the default, claim 2Gi for the manifest store, mount it in the Deployment, and switch a Released PV to Retain so the archived data can be reattached. |
| `pvc-pending-mismatch` | Bind a claim stuck in Pending | fix | easy | 10 | K | built | cka:storage, ckad:design-build | The audit reporter's PVC stays Pending against the pre-created PV; fix the access-mode and storageClassName mismatch so it binds and the Pod reads the archive. |
| `csi-driver-inventory` | Identify CSI drivers and the volumes that use them | learn | easy | 10 | K | built | cka:storage, cka:cluster-architecture | List which CSI drivers qm-archive runs, which StorageClasses use each and which PVs were provisioned by the hostpath driver, writing the mapping to a report file. |
| `shared-scratch-emptydir` | Share scratch data between containers | do | easy | 10 | V | built | cka:storage, ckad:design-build | Give the label renderer and its uploader a shared in-memory emptyDir capped at 256Mi plus a projected volume with the Pod's labels and the carrier Secret. |
| `night-shift-user-cert` | Issue a user certificate through the CSR API | do | hard | 20 | K | built | cka:cluster-architecture | Create a key and CSR for the night-shift lead, approve it through the CertificateSigningRequest API, bind a read-only Role in dock-scheduling and add a working kubeconfig context. |
| `who-can-delete-secrets` | Find out who can do what with auth can-i | learn | easy | 10 | V | built | cka:cluster-architecture, ckad:environment-config-security | Using kubectl auth can-i --as and --list, write which of five ServiceAccounts in qm-depot can delete Secrets in the billing namespace to a report file. |
| `app-serviceaccount-api` | Give an app its own ServiceAccount to read ConfigMaps | do | easy | 12 | V | verified | ckad:environment-config-security | Run the route-sync Pod under a dedicated ServiceAccount that may only get and list ConfigMaps in its namespace, so its API call succeeds and listing Secrets fails. |
| `fleet-node-prep-join` | Prepare a fresh host and join it as a worker | do | hard | 35 | K | built | cka:cluster-architecture | Load the kernel modules, set the sysctls, disable swap and configure containerd on fleet-wk-3, then join it to qm-fleet with kubeadm so it reports Ready. |
| `kubeadm-bootstrap-cluster` | Bootstrap a new cluster with kubeadm | do | hard | 40 | K | built | cka:cluster-architecture | Initialise qm-harbour on harbour-cp-1 with the given Pod CIDR and kubeadm config, install the provided CNI manifest, and join harbour-wk-1 so both nodes are Ready. |
| `ledger-second-control-plane` | Add a second control-plane node behind the shared endpoint | do | hard | 40 | K | built | cka:cluster-architecture | Join ledger-cp-2 to qm-ledger as a control-plane node with stacked etcd behind the shared API endpoint, so the etcd cluster has two healthy members. |
| `control-plane-tour` | Locate control-plane components and their config | learn | easy | 12 | K | built | cka:cluster-architecture, cka:troubleshooting | On qm-yard, find which components run as static Pods and which as systemd units, and write each component's manifest or unit path and one key flag to the report file. |
| `worker-kubelet-upgrade` | Upgrade a worker's kubelet after the control plane | do | medium | 25 | K | built | cka:cluster-architecture | Following the control-plane upgrade, drain ledger-wk-1, upgrade its kubeadm node config and kubelet to v1.37.1, re-hold the packages and return it to service. |
| `kubeadm-etcd-static-restore` | Restore a kubeadm cluster's stacked etcd | fix | hard | 30 | K | built | cka:cluster-architecture | A bad bulk delete wiped the yard namespaces; restore qm-yard's stacked etcd from last night's snapshot by repointing the static Pod manifest at the restored data directory. |
| `depot-worker-notready` | Bring a NotReady worker back | fix | medium | 20 | K | built | cka:troubleshooting | depot-wk-2 went NotReady after a kubelet config edit; read the journal, fix the configuration and get the node Ready with its Pods running. |
| `yard-scheduler-revive` | Revive a broken scheduler | fix | medium | 20 | K | built | cka:troubleshooting | New Pods in qm-yard stay Pending because the scheduler static Pod has a bad flag; find it with crictl and the manifest and repair it so scheduling resumes. |
| `apiserver-down-cert-path` | Bring the API server back after a bad edit | fix | hard | 25 | K | built | cka:troubleshooting | kubectl to qm-fleet times out after someone edited the API server manifest; use crictl logs and the manifest to fix the wrong certificate path so the API answers again. |
| `parcel-sorting-memory-hog` | Find the memory hog in a namespace | do | easy | 8 | K | built | cka:troubleshooting, ckad:observability-maintenance | Write the name of the parcel-sorting Pod with the highest memory use, taken from the metrics API, to the report file for the capacity team. |
| `label-printer-crashloop` | Fix a crash-looping label printer | fix | easy | 10 | V | built | cka:troubleshooting, ckad:observability-maintenance | The label-printer Pod restarts every few seconds; read the previous container's logs and events, fix the wrong command argument and leave the Pod Running. |
| `distroless-invoice-debug` | Debug a shell-less container with an ephemeral container | fix | medium | 15 | V | proposed | cka:troubleshooting, ckad:observability-maintenance | The distroless invoice renderer serves errors and has no shell; attach an ephemeral debug container, find the misnamed config file it reads and fix the ConfigMap so it renders. |
| `oncall-depot-incident` | Clear a multi-fault depot incident | fix | hard | 35 | K | built | cka:troubleshooting | The depot portal is down because of a NotReady node, a Service selector mismatch and an expired probe threshold at once; restore the portal to three Ready replicas behind its Service. |
| `kiosk-restricted-pss` | Enforce the restricted Pod Security Standard | do | medium | 15 | V | verified | cks:microservice-vulnerabilities, ckad:environment-config-security | Label the kiosk namespace to enforce the restricted Pod Security Standard and fix the kiosk Deployment's securityContext so its Pods are admitted and run. |
| `customs-default-deny` | Build a default-deny baseline with DNS egress | do | medium | 18 | K | built | cks:cluster-setup | Give customs-clearance default-deny ingress and egress, allow DNS to kube-system only, and block egress to the node metadata address 169.254.169.254. |
| `tariff-secret-audit` | Audit who read the tariff secrets | do | hard | 30 | K | built | cks:monitoring-runtime-security, cks:cluster-hardening | Write an audit policy that logs Secret reads at Metadata level, enable it on the qm-ledger API server, and identify which ServiceAccount read the tariff Secret. |
| `registry-allowlist-vap` | Admit only images from the company registry | do | hard | 20 | V | verified | cks:supply-chain-security, ckad:environment-config-security | Write a ValidatingAdmissionPolicy and binding that rejects any Pod in labelled namespaces whose images do not come from registry.quillmoor.example, and prove a hub image is refused. |
| `immutable-label-printers` | Make the label printers immutable at runtime | do | medium | 15 | V | verified | cks:monitoring-runtime-security | Run the label-printer containers with a read-only root filesystem, non-root user and no privilege escalation, giving only /tmp and the spool directory writable emptyDir volumes. |
| `waybill-image-slim-scan` | Rebuild an image smaller and scan it | do | hard | 30 | K | built | cks:supply-chain-security, ckad:design-build | Rebuild the waybill image as a multi-stage, non-root image on a minimal base so it is under 40 MB, scan before and after, and record the remaining high CVEs in a report. |
| `seccomp-apparmor-printer` | Confine a container with seccomp and AppArmor | do | hard | 25 | K | built | cks:system-hardening | Load the provided AppArmor profile on the fleet workers and run the barcode service with it plus the RuntimeDefault seccomp profile, so its write to /etc is denied. |
| `gvisor-runtimeclass` | Run untrusted converters in a sandboxed runtime | do | medium | 15 | K | verified | cks:microservice-vulnerabilities | Create a RuntimeClass for the gVisor handler and move the third-party document converter Deployment onto it, proving its Pods run under the sandbox kernel. |
| `secrets-encryption-at-rest` | Encrypt Secrets at rest in etcd | do | hard | 30 | K | built | cks:microservice-vulnerabilities | Configure an aescbc encryption provider on the qm-ledger API server, re-write all existing Secrets, and prove from etcd that the billing Secret is no longer stored in plain text. |
| `sa-token-automount-off` | Stop handing API tokens to Pods that need none | do | easy | 10 | V | verified | cks:cluster-hardening | Disable token automounting on the default ServiceAccounts of the depot namespaces and on the Pods that never call the API, while route-sync keeps its projected token. |
| `rbac-overgrant-cleanup` | Strip an over-broad grant back to least privilege | fix | medium | 15 | V | verified | cks:cluster-hardening | The dashboard ServiceAccount is bound to cluster-admin; replace the binding with a namespaced read-only grant on exactly the resources it uses, without breaking the dashboard. |
| `kubelet-auth-hardening` | Lock down kubelet authentication and authorization | do | hard | 25 | K | built | cks:system-hardening, cks:cluster-setup | An audit found the fleet-wk-1 kubelet accepts anonymous requests; disable anonymous auth, switch authorization to Webhook and confirm an unauthenticated request to the kubelet API is refused. |
| `cis-apiserver-findings` | Fix CIS benchmark findings on a control plane | do | hard | 30 | K | built | cks:cluster-setup | Run the benchmark tool on yard-cp-1 and fix the three failing API server and kubelet findings it reports, so a rescan passes those checks. |
| `verify-kubectl-checksum` | Verify platform binaries before use | do | easy | 8 | K | built | cks:cluster-setup | Three kubelet binaries were staged on fleet-wk-1; verify them against the published SHA-512 sums, delete the tampered one and record which version is genuine. |
| `ingress-tls-tracking` | Terminate TLS on the tracking Ingress | do | medium | 15 | K | built | cks:cluster-setup | Create a TLS Secret from the provided certificate and key and serve track.quillmoor.example over HTTPS through the Ingress, redirecting plain HTTP. |
| `sbom-dispatch-image` | Generate an SBOM and find a vulnerable library | do | medium | 15 | K | built | cks:supply-chain-security | Generate an SPDX SBOM for the dispatch image, find which package carries the flagged library version and write its name and version to the report. |
| `static-analysis-manifests` | Statically analyse manifests for risky settings | do | medium | 15 | V | verified | cks:supply-chain-security | Scan the fleet team's manifests with the provided analyser and fix every hostPath, privileged and runAsRoot finding so the scan comes back clean. |
| `falco-shell-in-container` | Detect a shell spawned in a container | hack | hard | 25 | K | built | cks:monitoring-runtime-security | Write a runtime rule that alerts when a shell starts in any customs container, trigger it, and identify and delete the Pod an attacker is using from the alert output. |
| `intrusion-timeline` | Reconstruct an intrusion from audit and runtime data | hack | hard | 35 | K | built | cks:monitoring-runtime-security | Correlate audit log entries, runtime alerts and process data to find the leaked token, the ServiceAccount it belongs to and the Pod used, then revoke the token and isolate the Pod. |
| `hostpath-mount-policy` | Block host filesystem mounts with Pod Security | fix | medium | 20 | K | built | cks:microservice-vulnerabilities | A review flagged a Pod in the yard-tools namespace that mounts the host root filesystem; enforce the baseline Pod Security level there and replace the Pod with a compliant one that uses an emptyDir. |
| `node-footprint-reduce` | Shrink a node's attack surface | do | medium | 20 | K | built | cks:system-hardening | Remove the unneeded FTP service and package from fleet-wk-2, close the stray listening port with nftables and leave only kubelet and SSH reachable from outside. |
| `mtls-cni-encryption` | Encrypt pod-to-pod traffic | do | hard | 25 | K | built | cks:microservice-vulnerabilities | Turn on the CNI's WireGuard encryption on qm-customs and show with a capture on the node that traffic between the declaration API and its database is no longer plaintext. |
| `api-access-restrict` | Restrict access to the Kubernetes API | do | hard | 25 | K | built | cks:cluster-hardening | Disable anonymous access and the insecure NodePort exposure of the qm-dispatch API server, and make sure only the bastion range can reach it, without locking out the admin kubeconfig. |

## Linux administration

Hands-on Linux administration from the first shell prompt to boot recovery, storage engineering, hardening, performance analysis and container internals, on both Enterprise Linux and Debian-family images. Labs grade end state, not the tool used, and run on the cheapest tier that stays authentic.

Fictional organisation: **Tallowmere Rail** (A fictional regional rail operator with a signalling centre, ticketing systems, rolling-stock depots and a timetable office; hosts are named tr-signal-01, tkt-web-02, depot-nfs-1 and similar.).

Competencies: `linux.shell`, `linux.files`, `linux.users`, `linux.identity` (new), `linux.systemd`, `linux.boot` (new), `linux.kernel` (new), `linux.packages`, `linux.remote`, `linux.security`, `linux.storage`, `linux.processes`, `linux.net`, `linux.services` (new), `linux.observability` (new), `linux.performance` (new), `linux.internals` (new), `linux.virt` (new), `linux.git` (new).

### Paths (11)

| Path | Title | Level | Hours | Labs | Prerequisites | Aligns to | Audience |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `linux-foundations` | Linux foundations | beginner | 6 | 20 | - | lpic1, linuxplus | Anyone new to Linux; prerequisite for every other Linux, container, automation and IaC path |
| `linux-scripting` | Shell scripting and everyday automation | beginner | 4 | 10 | `linux-foundations` | lpic1, rhcsa-aligned, linuxplus | Administrators and developers who repeat tasks by hand |
| `linux-sysadmin` | Linux system administration (distribution-neutral) | intermediate | 14 | 41 | `linux-foundations` | lfcs, lpic1, linuxplus | Administrators running mixed Debian-family and Enterprise Linux fleets |
| `enterprise-linux` | Enterprise Linux administration | intermediate | 14 | 31 | `linux-foundations` | rhcsa-aligned | Administrators of Enterprise Linux estates; reboot-graded throughout |
| `linux-networking` | Networking for Linux administrators | intermediate | 8 | 21 | `linux-foundations` | lfcs, lpic1, lpic2, linuxplus | Administrators who own host networking, gateways and firewalls |
| `linux-storage` | Storage engineering | advanced | 7 | 16 | `linux-sysadmin` | lfcs, lpic2, linuxplus | Administrators responsible for disks, volumes, encryption and network storage |
| `linux-security` | Linux security hardening | advanced | 9 | 18 | `linux-sysadmin` | linuxplus, lpic2 | Administrators and security engineers hardening Linux hosts |
| `linux-troubleshooting` | Troubleshooting, performance and observability | advanced | 10 | 24 | `linux-sysadmin` | linuxplus, lpic2 | On-call administrators and SREs |
| `linux-container-internals` | Container internals on Linux | advanced | 4 | 9 | `linux-sysadmin`, `linux-networking` | - | Platform and SRE engineers who need to know what a container really is |
| `linux-network-services` | Linux network services | advanced | 8 | 16 | `linux-sysadmin`, `linux-networking` | lpic2 | Administrators running DNS, web, mail, file and directory services |
| `linux-automation-at-scale` | Automation at scale with Ansible | intermediate | 30 | 20 | - | ex294-aligned, linuxplus | Linux administrators who completed the Enterprise Linux administration and Shell scripting paths (requires Enterprise Linux administration and Shell scripting paths) and now automate whole estates: Git, playbooks, roles, system-task modules, provisioning remediation and CI. |

<details><summary><b>Linux foundations</b>: modules</summary>

- **First steps in the shell**: `shell-first-steps-timetable`, `help-pages-offline`, `file-ops-roster-cleanup`, `links-shared-timetable`, `streams-delay-report`
- **Editing and text processing**: `vim-fix-signal-config`, `text-filters-ticket-sales`, `regex-extract-train-ids`, `find-stale-depot-files`
- **Users and permissions**: `users-new-signallers`, `permissions-ticketing-share`
- **Processes and jobs**: `processes-runaway-sim`, `jobs-signals-long-export`
- **Archives, packages, networking and SSH**: `archive-timetable-history`, `packages-install-from-mirror`, `net-inspect-ticket-gate`, `ssh-config-depot-hosts`
- **Capstone: signal box challenge**: `signal-box-levels-1`, `signal-box-levels-2`, `signal-box-levels-3`

_CloudTrain is not affiliated with or endorsed by the Linux Professional Institute or CompTIA. LPIC-1 is a trademark of the Linux Professional Institute and Linux+ is a trademark of CompTIA. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

<details><summary><b>Shell scripting and everyday automation</b>: modules</summary>

- **Writing scripts**: `script-first-delay-summary`, `script-loops-depot-checks`, `script-positional-user-tool`, `awk-fare-report`
- **Scheduling and its pitfalls**: `cron-nightly-fares-export`, `fix-cron-silent-failure`, `fix-crlf-script`
- **Robust scripts, Git and Python**: `robust-script-rotation-tool`, `git-timetable-repo`, `python-venv-fleet-report`

_CloudTrain is not affiliated with or endorsed by the Linux Professional Institute, Red Hat, Inc. or CompTIA. LPIC-1, RHCSA and Linux+ are trademarks of their respective owners. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

<details><summary><b>Linux system administration (distribution-neutral)</b>: modules</summary>

- **Accounts, privilege and access**: `env-profile-signal-tools`, `password-aging-contractors`, `sudo-depot-operators`, `acl-timetable-review`, `setgid-shared-planning`, `ulimits-batch-user`
- **Software and libraries**: `package-repo-pinning`, `fix-missing-shared-lib`
- **Services, logs, timers and time**: `systemd-service-lifecycle`, `unit-author-delay-feed`, `dropin-override-memory`, `journal-trace-crash`, `fix-failing-service-unit`, `timer-replaces-cron`, `chrony-timezone-depot`
- **Kernel parameters, modules and devices**: `sysctl-persistent-forwarding`, `kernel-module-blacklist`, `hardware-inventory-report`, `udev-stable-device-name`
- **Storage**: `disk-full-deleted-open`, `inode-exhaustion-spool`, `partition-new-data-disk`, `fstab-mount-by-uuid`, `swap-file-planning-host`, `lvm-create-ledger-volume`, `lvm-extend-online`, `nfs-autofs-home`
- **Networking and firewalls**: `dns-client-resolution`, `static-ip-persistent`, `firewall-ticket-api`
- **SSH, web and certificates**: `sshd-keys-only`, `nginx-reverse-proxy-pis`, `tls-cert-ticket-portal`, `fix-expired-cert`
- **Directory accounts**: `ldap-login-crew`
- **Containers, VMs and provisioning**: `podman-run-timetable-api`, `libvirt-test-vm`, `libvirt-golden-template`, `cloud-init-new-depot-host`
- **Boot and recovery**: `grub-kernel-args`, `recover-broken-fstab`

_CloudTrain is not affiliated with or endorsed by The Linux Foundation, the Linux Professional Institute or CompTIA. LFCS, LPIC-1 and Linux+ are trademarks of their respective owners. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

<details><summary><b>Enterprise Linux administration</b>: modules</summary>

- **Users, groups and sudo**: `users-new-signallers`, `password-aging-contractors`, `sudo-depot-operators`, `setgid-shared-planning`
- **Repositories, RPMs and Flatpak**: `dnf-local-repo`, `rpm-verify-tampered`, `flatpak-remote-install`
- **Simple scripts**: `script-positional-user-tool`
- **Operating running systems**: `kill-heavy-process-el`, `tuned-profile-batch`, `journal-persistent-el`, `boot-target-default`, `grub-kernel-args`, `recover-root-password`
- **Local storage and file systems**: `lvm-mbr-gpt-mixed`, `vfat-xfs-ext4-mounts`, `lvm-extend-online`, `swap-file-planning-host`, `nfs-mount-el`, `nfs-autofs-home`
- **Scheduling and time**: `at-and-cron-el`, `timer-replaces-cron`, `chrony-timezone-depot`
- **Networking and firewalld**: `nmcli-bond-el`, `firewalld-zones-el`
- **SELinux**: `selinux-modes-contexts`, `selinux-port-boolean`, `selinux-denial-diagnose`
- **Containers (RHEL 9 variant only)**: `podman-run-timetable-api`, `quadlet-container-service`
- **Capstone: depot server end to end**: `el-mock-scenario-depot`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. RHCSA is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification. Labs run on a CloudTrain Enterprise Linux image based on AlmaLinux, not on Red Hat Enterprise Linux._

</details>

<details><summary><b>Networking for Linux administrators</b>: modules</summary>

- **Addressing, inspection and name resolution**: `subnet-plan-depots`, `net-inspect-ticket-gate`, `dns-client-resolution`, `fix-dns-resolution-outage`
- **Routing and persistent configuration**: `runtime-routes-two-sites`, `static-ip-persistent`, `tcpdump-lost-heartbeats`
- **Packet filtering and NAT**: `nftables-from-scratch`, `firewall-ticket-api`, `nat-port-redirect-gateway`
- **Bridges, VLANs, bonds and policy routing**: `bridge-vlan-namespaces`, `bond-active-backup`, `fix-routing-asymmetric`
- **MTU, throughput and impairment**: `mtu-mismatch-tunnel`, `iperf-throughput-baseline`, `netem-impaired-link`
- **Time, VPN and network services**: `chrony-server-isolated`, `wireguard-depot-tunnel`, `haproxy-ticket-backends`, `unbound-caching-forwarder`, `dhcp-server-depot`

_CloudTrain is not affiliated with or endorsed by The Linux Foundation, the Linux Professional Institute or CompTIA. LFCS, LPIC-1, LPIC-2 and Linux+ are trademarks of their respective owners. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

<details><summary><b>Storage engineering</b>: modules</summary>

- **Partitions and filesystems**: `fs-on-image-files`, `partition-new-data-disk`, `fsck-repair-ext4`, `fstab-mount-by-uuid`, `swap-file-planning-host`
- **LVM and RAID**: `lvm-create-ledger-volume`, `lvm-snapshot-backup`, `pvmove-replace-disk`, `raid1-degrade-rebuild`
- **Encryption and quotas**: `luks-encrypt-archive`, `quotas-crew-homes`
- **Network storage**: `nfs-autofs-home`, `iscsi-attach-volume`, `nfs-server-exports`
- **Performance and boot-time failures**: `io-latency-hunt`, `fix-boot-mount-network`

_CloudTrain is not affiliated with or endorsed by The Linux Foundation, the Linux Professional Institute or CompTIA. LFCS, LPIC-2 and Linux+ are trademarks of their respective owners. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

<details><summary><b>Linux security hardening</b>: modules</summary>

- **Access review**: `acl-timetable-review`, `sudo-depot-operators`
- **Authentication and SSH**: `ssh-hardening-fail2ban`, `pam-pwquality-faillock`
- **Cryptography and integrity**: `gpg-sign-timetable`, `aide-integrity-baseline`
- **Logging and audit**: `rsyslog-forward-central`, `auditd-watch-identity`
- **Mandatory access control**: `selinux-modes-contexts`, `selinux-denial-diagnose`, `apparmor-confine-agent`
- **Firewall, kernel and service hardening**: `nftables-from-scratch`, `kernel-hardening-sysctls`, `unit-sandboxing-score`, `attack-surface-cleanup`
- **Compliance scanning**: `openscap-scan-remediate`
- **Find and close**: `hunt-escalation-paths`, `intrusion-persistence-sweep`

_CloudTrain is not affiliated with or endorsed by CompTIA or the Linux Professional Institute. Linux+ and LPIC-2 are trademarks of their respective owners. This path covers objectives aligned to those exams; completing it confers no certification. The CIS-style profile used is CloudTrain's own and is not a CIS Benchmark._

</details>

<details><summary><b>Troubleshooting, performance and observability</b>: modules</summary>

- **Logs**: `logrotate-ticket-logs`, `rsyslog-forward-central`, `journal-trace-crash`
- **User-space break-fix**: `disk-full-deleted-open`, `fix-port-conflict`, `fix-ssh-key-perms`, `fix-missing-shared-lib`, `fix-crlf-script`
- **Performance method**: `use-method-slow-host`, `oom-kill-investigation`, `perf-cpu-flamegraph`, `io-latency-hunt`, `iperf-throughput-baseline`
- **Tracing and pressure**: `strace-config-not-found`, `bpftrace-who-opens`, `psi-pressure-alert`, `linux-cgroup-v2-limits`
- **Monitoring**: `node-exporter-alert`
- **System and boot break-fix**: `fix-firewall-blocks-app`, `fix-routing-asymmetric`, `mtu-mismatch-tunnel`, `boot-slow-analysis`, `kernel-panic-initramfs`
- **Capstone: morning-peak incident**: `incident-capstone-ticketing`

_CloudTrain is not affiliated with or endorsed by CompTIA or the Linux Professional Institute. Linux+ and LPIC-2 are trademarks of their respective owners. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

<details><summary><b>Container internals on Linux</b>: modules</summary>

- **Running containers**: `podman-run-timetable-api`
- **Namespaces, cgroups and overlayfs**: `linux-namespaces-unshare`, `veth-netns-plumbing`, `linux-cgroup-v2-limits`, `systemd-run-slices`, `linux-overlayfs-by-hand`
- **Isolation and services**: `capabilities-drop-service`, `quadlet-container-service`, `am-i-in-a-container`

</details>

<details><summary><b>Linux network services</b>: modules</summary>

- **SSH and TLS**: `sshd-keys-only`, `sftp-chroot-vendors`, `tls-cert-ticket-portal`
- **Web and load balancing**: `apache-vhosts-tls`, `nginx-reverse-proxy-pis`, `haproxy-ticket-backends`
- **DNS and mail**: `bind-authoritative-zone`, `unbound-caching-forwarder`, `postfix-relay-alerts`
- **Directory and file services**: `ldap-login-crew`, `nfs-server-exports`, `samba-share-office`, `dhcp-server-depot`
- **Backups and log forwarding**: `rsync-backup-timer`, `postgres-backup-restore`, `rsyslog-forward-central`

_CloudTrain is not affiliated with or endorsed by the Linux Professional Institute. LPIC-2 is a trademark of the Linux Professional Institute. This path covers objectives aligned to that exam (modernised beyond its published syllabus); completing it confers no certification._

</details>

<details><summary><b>Automation at scale with Ansible</b>: modules</summary>

- **Git for automation**: `ov-git-push-playbooks`, `ov-devcontainer-workflow`
- **Ansible core**: `ov-first-inventory`, `ov-bootstrap-automation-user`, `ov-first-playbook-motd`, `ov-loop-adjuster-accounts`, `ov-handlers-web-reload`, `ov-block-rescue-db-maintenance`
- **Roles, templates and Vault**: `ov-template-claims-vhost`, `ov-vault-db-credentials`, `ov-role-claims-web`, `ov-collections-offline`
- **Automating system tasks**: `ov-automate-repos-packages`, `ov-automate-lvm-storage`, `ov-automate-web-firewall-selinux`, `ov-automate-cron-timers`, `ov-reboot-persistence-fix`
- **Running at scale**: `ov-rolling-update-serial`, `ov-async-patching`, `ov-ci-pipeline-lint-test`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. or CompTIA, Inc. Red Hat Certified Engineer (RHCE) is a trademark of Red Hat, Inc.; CompTIA Linux+ is a trademark of CompTIA, Inc. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

### Labs (159)

| Lab | Title | Type | Difficulty | Min | Tier | Status | Frameworks | Scenario |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shell-first-steps-timetable` | Find your way around the timetable office workstation | learn | easy | 10 | A | verified | lpic1:gnu-commands, linuxplus:services-users | On Tallowmere's timetable workstation, locate the three draft timetables under /srv/timetable, report the newest one's full path and line count to ~/answers/newest.txt. |
| `help-pages-offline` | Answer configuration questions from the offline manuals | learn | easy | 10 | A | proposed | rhcsa-aligned:essential-tools, lpic1:gnu-commands | With no internet on the depot terminal, use man sections, --help and /usr/share/doc to fill in ~/answers/manuals.txt with the five option names the depot lead asked for. |
| `file-ops-roster-cleanup` | Reorganise the crew roster directory with globbing | do | easy | 10 | A | built | lpic1:gnu-commands, rhcsa-aligned:essential-tools | Move every 2026 crew roster under ~/rosters into per-month directories (2026-01 ... 2026-12) using globs and brace expansion, deleting only the *.bak copies. |
| `links-shared-timetable` | Publish the current timetable with links | do | easy | 8 | A | built | lpic1:devices-filesystems, rhcsa-aligned:essential-tools | Make /srv/timetable/current a symbolic link to the approved draft and create a hard link archive copy, so both survive a rename of the draft directory as the grader checks inode and target. |
| `streams-delay-report` | Split delay-feed output and errors into separate files | do | easy | 8 | A | built | lpic1:gnu-commands, rhcsa-aligned:essential-tools, linuxplus:system-management | Run the delay-feed collector so its stdout lands in /var/tmp/delays.log, its errors in delays.err, and a copy of stdout scrolls on screen via tee. |
| `text-filters-ticket-sales` | Rank stations by ticket sales from a CSV export | do | easy | 12 | A | verified | lpic1:gnu-commands, linuxplus:automation-scripting | From the ticketing export sales.csv, write the five stations with the highest weekend revenue, sorted descending, to ~/answers/top5.txt using cut, sort, uniq and head. |
| `vim-fix-signal-config` | Edit a signalling config file in vim without breaking it | learn | easy | 10 | A | built | lpic1:gnu-commands, rhcsa-aligned:essential-tools | Change three parameters in /etc/tr-signal/interlock.conf with vim, keeping its comments and file mode intact; the grader diffs everything except the three lines. |
| `regex-extract-train-ids` | Extract malformed train IDs with regular expressions | do | medium | 15 | A | built | lpic1:gnu-commands, rhcsa-aligned:essential-tools, linuxplus:automation-scripting | Use grep -E and sed to list every train ID in the dispatch log that breaks the two-letters-four-digits rule and write a corrected copy of the log to ~/dispatch-fixed.log. |
| `find-stale-depot-files` | Find and archive stale depot inspection files | do | medium | 12 | A | built | lpic1:devices-filesystems, lfcs:essential-commands, rhcsa-aligned:essential-tools | Find every inspection report under /srv/depot older than 90 days and larger than 1 MiB owned by user inspector, and copy them preserving paths into /srv/archive/stale. |
| `users-new-signallers` | Onboard three new signallers with groups and home directories | do | easy | 10 | A | proposed | rhcsa-aligned:users-groups, lfcs:users-groups, lpic1:admin-tasks, linuxplus:services-users | Create users ada, bram and cleo with home directories, add them to the signalling group with GID 4100 and make bram's account expire on the date in the ticket. |
| `permissions-ticketing-share` | Lock down the ticketing reports directory with modes and umask | do | easy | 10 | A | proposed | rhcsa-aligned:essential-tools, lpic1:devices-filesystems, linuxplus:security | Make /srv/ticketing/reports readable by group fares only, writable by its owner, closed to others, and set a umask so new reports by user fares-bot are created 0640. |
| `processes-runaway-sim` | Find and stop the runaway timetable simulation | do | easy | 10 | A | built | rhcsa-aligned:running-systems, lpic1:gnu-commands, linuxplus:services-users | A timetable simulation is eating all CPU on the planning box; identify the process tree, renice the legitimate run to 10 and terminate only the orphaned duplicate. |
| `jobs-signals-long-export` | Keep a long export running after you log out | learn | easy | 8 | A | built | lpic1:gnu-commands | Start the nightly fares export so it survives logout with nohup or a background job, send it SIGHUP-safe, and prove it is still running in a new session. |
| `archive-timetable-history` | Package timetable history into compressed archives | do | easy | 10 | A | built | rhcsa-aligned:essential-tools, lpic1:gnu-commands, linuxplus:system-management | Create an xz-compressed tar of /srv/timetable/2025 preserving ownership, list its contents to a file, and restore one month into /tmp/restore for the auditor. |
| `packages-install-from-mirror` | Install the platform tools from the local mirror | learn | easy | 10 | A | proposed | lpic1:install-packages, linuxplus:services-users | Install jq, tmux and a pinned version of the tr-fares client from Tallowmere's offline package mirror and record the installed versions in ~/answers/versions.txt. |
| `net-inspect-ticket-gate` | Report which ports a ticket gate host listens on | learn | easy | 10 | A | built | lpic1:networking, linuxplus:system-management | From the ticket-gate host, list its IP addresses, default route and listening TCP ports with owning processes, and write the answers to ~/answers/gate.txt. |
| `ssh-config-depot-hosts` | Reach four depot hosts with keys and an ssh config file | do | easy | 12 | A | built | rhcsa-aligned:essential-tools, lpic1:security, linuxplus:security | Generate a key pair, install it on depot-1 and depot-2, and write ~/.ssh/config aliases with user, port and jump host so 'ssh depot-2' works without a password. |
| `env-profile-signal-tools` | Give every signaller the same shell environment | do | medium | 12 | A | proposed | lfcs:users-groups, lpic1:shells-scripting, linuxplus:system-management | Make /opt/tr-signal/bin part of PATH and add the sigstat alias for every new and existing signalling user via /etc/profile.d and /etc/skel, without editing users' own dotfiles. |
| `signal-box-levels-1` | Signal box challenge: levels 1 to 5 | hack | easy | 25 | A | built | lpic1:gnu-commands | Progress through five chained levels on the signal-box host, each password hidden by a different trick (dotfiles, odd file names, file types, sizes, owners), and submit the final token. |
| `signal-box-levels-2` | Signal box challenge: levels 6 to 10 | hack | medium | 30 | A | built | lpic1:gnu-commands | Continue the signal-box chain where tokens hide in sorted duplicates, base64 and compressed layers, and the only line that appears once, and submit level 10's token. |
| `signal-box-levels-3` | Signal box challenge: levels 11 to 15 | hack | hard | 40 | A | proposed | lpic1:security | Finish the signal-box chain using ssh keys, a listening service you must talk to with nc, and a scheduled job that reveals the last token. |
| `script-first-delay-summary` | Write a script that summarises daily delays | learn | easy | 15 | A | built | rhcsa-aligned:scripts, lpic1:shells-scripting, linuxplus:automation-scripting | Write /usr/local/bin/delay-summary that takes a date argument, prints total and worst delay from the feed for that day, and exits 2 when the day has no data. |
| `script-loops-depot-checks` | Loop over depot hosts and report which are unreachable | do | medium | 20 | A | built | rhcsa-aligned:scripts, lpic1:shells-scripting, linuxplus:automation-scripting | Write a script that reads depots.txt, checks each host's port 22 with a timeout, and writes only the unreachable ones to /var/tmp/unreachable.txt with a non-zero exit when any fail. |
| `awk-fare-report` | Build a fare-zone report with awk | do | medium | 15 | A | built | lpic1:gnu-commands, linuxplus:automation-scripting | Use awk to turn the raw fares log into a per-zone table of journeys and revenue with a total line, matching the exact format in the finance template. |
| `cron-nightly-fares-export` | Schedule the nightly fares export with cron | do | easy | 10 | A | proposed | rhcsa-aligned:deploy-maintain, lpic1:admin-tasks, linuxplus:services-users | Schedule /opt/fares/export.sh for 02:15 every weekday as user fares, with its output appended to /var/log/fares-export.log, and deny cron to user guest. |
| `fix-cron-silent-failure` | Fix a cron job that works by hand but not on schedule | fix | medium | 15 | A | proposed | linuxplus:troubleshooting, lpic1:admin-tasks | The timetable sync runs fine interactively but silently fails from cron; find the PATH and environment difference and make the scheduled run produce today's sync file. |
| `fix-crlf-script` | Repair a script uploaded from a Windows desktop | fix | easy | 8 | A | built | linuxplus:troubleshooting | The platform-board script fails with 'bad interpreter'; find the CRLF line endings and missing execute bit and make it run and produce the board file. |
| `robust-script-rotation-tool` | Make the roster rotation script safe to re-run | do | hard | 30 | A | built | linuxplus:automation-scripting | Harden rotate-roster.sh with strict mode, a cleanup trap, getopts flags and idempotent steps so a second run changes nothing and a failure leaves no half-written files. |
| `git-timetable-repo` | Version the timetable tooling in Git | do | easy | 15 | A | built | lfcs:essential-commands, linuxplus:automation-scripting | Clone the timetable-tools repo from the local Git server, fix the bug on a feature branch, merge it to main with a meaningful commit and push it so the grader sees the merge. |
| `python-venv-fleet-report` | Ship a Python fleet report in its own virtual environment | do | medium | 15 | A | proposed | linuxplus:automation-scripting | Create a venv in /opt/fleet-report, install the requests and tabulate wheels from the offline index, and make the provided script print the rolling-stock table. |
| `script-positional-user-tool` | Write a user-provisioning script driven by arguments | do | medium | 20 | A | built | rhcsa-aligned:scripts, linuxplus:automation-scripting | Write mkcrew that takes a username and a group as positional arguments, creates the account only if missing, and prints a usage line and exits 1 on wrong arguments. |
| `password-aging-contractors` | Apply password aging to contractor accounts | do | easy | 10 | A | proposed | rhcsa-aligned:users-groups, lpic1:security, linuxplus:security | Force contractors in group agency to change passwords every 45 days with a 7-day warning, lock the account of the departed contractor, and default new accounts to 60 days. |
| `sudo-depot-operators` | Delegate service restarts to depot operators with sudo | do | medium | 12 | A | proposed | rhcsa-aligned:users-groups, lfcs:users-groups, linuxplus:security | Allow group depot-ops to restart only the tr-depot-agent service via a sudoers.d drop-in validated with visudo, without granting a shell or any other command. |
| `acl-timetable-review` | Give reviewers access with ACLs instead of new groups | do | medium | 12 | A | proposed | lfcs:users-groups, linuxplus:security | Let user auditor read and planner-lead write /srv/timetable/drafts, including files created later, using ACLs and default ACLs, while the base mode stays 0750. |
| `setgid-shared-planning` | Build a collaborative directory for the planning team | do | easy | 10 | A | proposed | rhcsa-aligned:filesystems, lpic1:devices-filesystems | Create /srv/planning owned by group planners with setgid and sticky bits so new files inherit the group and members cannot delete each other's files. |
| `ulimits-batch-user` | Cap processes and open files for the batch account | do | medium | 10 | A | proposed | lfcs:users-groups, lpic1:security | Limit user batchrun to 200 processes and 4096 open files (hard) through limits.d, and prove the limits apply to a fresh login session. |
| `systemd-service-lifecycle` | Bring the passenger-info service up at boot | learn | easy | 8 | B | proposed | rhcsa-aligned:deploy-maintain, lfcs:essential-commands, linuxplus:services-users | Start and enable tr-pis.service, mask the legacy pis-old.service so nothing can start it, and confirm both states with systemctl. |
| `unit-author-delay-feed` | Turn the delay-feed collector into a systemd service | do | medium | 15 | B | proposed | lfcs:essential-commands, linuxplus:services-users | Write a unit for /opt/delayfeed/collector that runs as user delayfeed after the network is online, restarts on failure within 5 s, and starts at boot. |
| `dropin-override-memory` | Override a vendor unit with a drop-in | do | easy | 10 | B | proposed | lfcs:essential-commands | Raise the ticket-api service's file limit and add an environment variable through a drop-in under /etc/systemd/system, leaving the vendor unit file untouched. |
| `journal-trace-crash` | Find why the fares service crashed last night from the journal | do | easy | 10 | B | proposed | rhcsa-aligned:running-systems, lpic1:essential-services | Use journalctl filters by unit, priority and time window to find the error that stopped fares-api at night and write the failing config key to ~/answers/cause.txt. |
| `timer-replaces-cron` | Replace a cron entry with a persistent systemd timer | do | medium | 15 | B | proposed | rhcsa-aligned:deploy-maintain, lpic1:admin-tasks, linuxplus:services-users | Run the rolling-stock mileage sync every 15 minutes with a timer that catches up after downtime, remove the old crontab entry, and verify the next elapse time. |
| `chrony-timezone-depot` | Set the depot host's clock source and time zone | do | easy | 10 | B | proposed | rhcsa-aligned:deploy-maintain, lfcs:networking, lpic1:essential-services | Point chrony at the in-lab time server tr-ntp-1, set the time zone to Europe/London and confirm the host reports a synchronised clock. |
| `sysctl-persistent-forwarding` | Persist kernel parameters for the gateway host | do | easy | 10 | C | proposed | lfcs:operations-deployment, linuxplus:system-management | Enable IPv4 forwarding and set vm.swappiness to 10 on the gateway both now and across reboots via /etc/sysctl.d, without touching other parameters. |
| `disk-full-deleted-open` | Free space held by a deleted log file | fix | medium | 15 | A | proposed | lfcs:essential-commands, linuxplus:troubleshooting | Tallowmere's signalling log host fills /var every night; find the deleted-but-open file holding the space and free it without rebooting or stopping the signalling service. |
| `inode-exhaustion-spool` | Recover a filesystem that is out of inodes | fix | medium | 15 | B | proposed | linuxplus:troubleshooting, lfcs:essential-commands | The ticket spool reports 'No space left on device' at 40% usage; find the directory with millions of tiny files, clean it and add a tmpfiles.d rule that keeps it small. |
| `partition-new-data-disk` | Partition and format a new data disk | do | easy | 12 | B | proposed | rhcsa-aligned:local-storage, lfcs:storage, lpic1:devices-filesystems | Create a GPT label on the new 4 GiB disk with a 1 GiB XFS and a 2 GiB ext4 partition, labelled TT-LOGS and TT-ARCHIVE. |
| `fstab-mount-by-uuid` | Mount the archive filesystem persistently by UUID | do | medium | 12 | C | proposed | rhcsa-aligned:local-storage, lfcs:storage, lpic1:devices-filesystems | Mount TT-ARCHIVE at /srv/archive by UUID with noexec,nodev and nofail so the host still boots if the disk is missing, verified after reboot. |
| `swap-file-planning-host` | Add swap to the planning host without repartitioning | do | easy | 10 | C | proposed | rhcsa-aligned:local-storage, lfcs:storage | Add a 1 GiB swap file and a swap partition with priorities 5 and 10, both active now and after reboot. |
| `lvm-create-ledger-volume` | Build an LVM volume for the fares ledger | do | medium | 15 | B | proposed | rhcsa-aligned:local-storage, lfcs:storage, linuxplus:system-management | Create volume group vg-fares from two disks with 8 MiB extents and a 500 MiB logical volume lv-ledger formatted XFS and mounted at /srv/ledger persistently. |
| `lvm-extend-online` | Grow a full logical volume and its filesystem online | do | easy | 10 | B | proposed | rhcsa-aligned:filesystems, lfcs:storage | lv-ledger is 98% full; extend it by 300 MiB from free extents and grow the filesystem without unmounting, keeping the service writing throughout. |
| `nfs-autofs-home` | Automount crew home directories from the depot NFS server | do | medium | 20 | C | proposed | rhcsa-aligned:filesystems, lfcs:storage | Configure autofs so /crew/<user> mounts the matching export from depot-nfs-1 on access and unmounts when idle, verified for two users. |
| `dns-client-resolution` | Fix name resolution order on the ticket office host | do | easy | 10 | A | proposed | rhcsa-aligned:networking, lpic1:networking, lfcs:networking | Make tkt-db resolve from /etc/hosts first and everything else from the in-lab resolver, with search domain tallowmere.test, verified with getent. |
| `static-ip-persistent` | Give the signalling host a persistent static address | do | medium | 15 | C | proposed | rhcsa-aligned:networking, lfcs:networking, lpic1:networking, linuxplus:system-management | Configure eth1 with 10.40.2.15/24, an IPv6 address and gateway, and hostname tr-signal-02, all persistent across reboot using the distribution's native tool. |
| `firewall-ticket-api` | Open only the ticket API port to the station network | do | medium | 15 | B | proposed | rhcsa-aligned:security, lfcs:networking, linuxplus:security | Allow TCP 8443 to the ticket API only from 10.40.5.0/24 and SSH from anywhere, deny everything else inbound, persistently. |
| `sshd-keys-only` | Restrict the jump host to key logins for the ops group | do | medium | 12 | A | proposed | lfcs:networking, rhcsa-aligned:security, linuxplus:security | Configure sshd on tr-jump-1 to accept only key authentication, allow only group ops, disable root login and keep the current session working. |
| `nginx-reverse-proxy-pis` | Put the passenger-info app behind a reverse proxy | do | medium | 20 | A | proposed | lfcs:networking, linuxplus:services-users | Serve pis.tallowmere.test on port 80 with nginx proxying to two app backends on 127.0.0.1:8081-8082, with failover when one stops. |
| `tls-cert-ticket-portal` | Issue and install a certificate for the ticket portal | do | medium | 20 | A | proposed | lfcs:essential-commands, linuxplus:security | Create a key and CSR for tickets.tallowmere.test with two SANs, sign it with the in-lab CA, and serve it from the portal so openssl s_client verifies the chain. |
| `fix-expired-cert` | Restore the timetable API after its certificate expired | fix | medium | 15 | A | proposed | linuxplus:troubleshooting, lfcs:essential-commands | Clients reject the timetable API with an expiry error; find the expired certificate among three on the host, renew it from the local CA and reload without downtime. |
| `ldap-login-crew` | Let crew members log in with directory accounts | do | hard | 30 | C | proposed | lfcs:users-groups, linuxplus:security, lpic2:client-mgmt | Join the crew terminal to the in-lab LDAP directory with SSSD so user driver42 can log in, gets a home directory on first login, and shows the directory groups. |
| `podman-run-timetable-api` | Run the timetable API in a container with persistent data | do | medium | 15 | B | proposed | lfcs:operations-deployment, rhcsa-aligned:containers, linuxplus:services-users | Run the timetable-api image from the local registry with Podman, publish 8080, mount /srv/tt-data persistently and set it to restart on failure. |
| `libvirt-test-vm` | Create and snapshot a test VM with libvirt | do | hard | 30 | C | proposed | lfcs:operations-deployment, linuxplus:system-management | On the nested-virtualization host, define a VM from the provided cloud image on the isolated network, take a snapshot named pre-patch and revert to it. |
| `fix-failing-service-unit` | Bring a service back that fails at start | fix | medium | 15 | B | proposed | lfcs:essential-commands, linuxplus:troubleshooting | tr-board.service enters failed state on start; use status, the journal and the unit file to find the wrong User and missing directory, fix them and keep it enabled. |
| `package-repo-pinning` | Add the vendor repository and pin the signalling agent version | do | medium | 15 | A | proposed | lfcs:operations-deployment, linuxplus:services-users | Add the in-lab vendor repository with its signing key, install tr-agent 3.4.2 exactly and hold it so a full upgrade leaves it at that version. |
| `grub-kernel-args` | Add a kernel argument and pick the default kernel | do | medium | 20 | C | proposed | rhcsa-aligned:deploy-maintain, lpic1:install-packages, linuxplus:system-management | Add audit=1 and remove quiet from the kernel command line for every installed kernel, make the older kernel the default for one boot only, and verify after reboot. |
| `recover-root-password` | Regain root access on a host with an unknown password | fix | medium | 20 | C | proposed | rhcsa-aligned:running-systems, lfcs:operations-deployment | Nobody knows the root password of depot-ctl-3; interrupt the boot from the VM console, reset it to the one in the ticket and leave SELinux labels correct after reboot. |
| `recover-broken-fstab` | Rescue a host that drops to emergency mode | fix | medium | 20 | C | proposed | rhcsa-aligned:running-systems, lfcs:operations-deployment, linuxplus:troubleshooting | A typo in /etc/fstab sends tr-sched-1 into emergency mode; boot it, fix the entry so the data volume mounts and the host reaches multi-user.target. |
| `dnf-local-repo` | Configure the Enterprise Linux repositories from a local mirror | do | easy | 12 | A | proposed | rhcsa-aligned:software, linuxplus:services-users | Replace the default repos with BaseOS and AppStream .repo files pointing at Tallowmere's mirror with GPG checking on, then install httpd and confirm its origin repo. |
| `rpm-verify-tampered` | Find which package files were modified | fix | medium | 15 | A | proposed | rhcsa-aligned:software, linuxplus:security | Use rpm verification to find the two binaries and one config changed outside packaging on tkt-web-02, and restore the binaries by reinstalling their packages. |
| `flatpak-remote-install` | Install a desktop tool from the local Flatpak remote | do | easy | 12 | C | proposed | rhcsa-aligned:software | Add Tallowmere's local Flatpak remote system-wide and install the timetable viewer app from it, removing the outdated user-level install. |
| `boot-target-default` | Change the default boot target and boot into rescue | do | easy | 12 | C | proposed | rhcsa-aligned:running-systems, lpic1:system-architecture | Set the timetable server to boot into multi-user.target by default, then boot once into rescue.target and return, graded after a final reboot. |
| `tuned-profile-batch` | Apply the recommended tuning profile to the batch host | do | easy | 8 | C | proposed | rhcsa-aligned:running-systems | Switch the fares batch host to the throughput-performance profile, persistently, and record the profile tuned recommends in ~/answers/tuned.txt. |
| `journal-persistent-el` | Keep the journal across reboots with a size cap | do | easy | 12 | C | proposed | rhcsa-aligned:running-systems, linuxplus:security | Make the journal on tr-signal-01 persistent with a 200 MiB cap and show a boot-before-last error in ~/answers/prev-boot.txt after a reboot. |
| `lvm-mbr-gpt-mixed` | Add storage non-destructively to a disk in use | do | medium | 20 | C | proposed | rhcsa-aligned:local-storage | Add a new partition to the half-used second disk without touching existing data, make it a PV, extend vg-depot and create lv-logs of 120 extents mounted by label. |
| `vfat-xfs-ext4-mounts` | Create and mount three filesystem types for the depot | do | medium | 20 | C | proposed | rhcsa-aligned:filesystems | Create vfat, ext4 and XFS filesystems on three LVs and mount them at /depot/{usb,logs,data} with the owners and modes in the ticket, persistent across reboot. |
| `nfs-mount-el` | Mount the timetable archive export from the NFS server | do | easy | 10 | C | proposed | rhcsa-aligned:filesystems, lfcs:storage | Mount depot-nfs-1:/exports/timetable read-only at /mnt/tt-archive persistently with the _netdev option, verified after reboot. |
| `nmcli-bond-el` | Configure a second IPv4 and IPv6 address with nmcli | do | medium | 15 | C | proposed | rhcsa-aligned:networking | Add 10.40.9.20/24 and fd00:40:9::20/64 to the existing connection on eth0 with nmcli, set the DNS server and make it survive reboot. |
| `firewalld-zones-el` | Separate station and office traffic with firewalld zones | do | medium | 15 | C | proposed | rhcsa-aligned:security, linuxplus:security | Bind the station subnet to a custom zone that allows only HTTPS and the office subnet to a zone that also allows SSH, both permanent and active. |
| `selinux-modes-contexts` | Serve web content from a non-default directory under SELinux | do | medium | 15 | C | proposed | rhcsa-aligned:security, lfcs:operations-deployment, linuxplus:security | Serve /srv/pis-www with httpd in enforcing mode by adding a persistent file-context rule and relabelling, without disabling SELinux. |
| `selinux-port-boolean` | Run the ticket API on a non-standard port under SELinux | do | medium | 15 | C | proposed | rhcsa-aligned:security | Make httpd listen on TCP 82 and connect to the database over the network by labelling the port and setting the needed boolean persistently. |
| `selinux-denial-diagnose` | Diagnose why the depot agent is denied by SELinux | fix | hard | 20 | C | proposed | rhcsa-aligned:security, linuxplus:troubleshooting | The depot agent fails only in enforcing mode; find the AVC denials, explain them in ~/answers/avc.txt and fix the cause with a context or boolean, not a custom module. |
| `at-and-cron-el` | Schedule one-off and recurring maintenance jobs | do | easy | 10 | C | proposed | rhcsa-aligned:deploy-maintain | Schedule a one-off cache purge at 23:30 with at and a recurring Sunday report with cron for user ops, and restrict at to the ops group. |
| `kill-heavy-process-el` | Identify and tame the heaviest process on the scheduler | do | easy | 10 | C | proposed | rhcsa-aligned:running-systems | Find the process using the most memory and the one using the most CPU on tr-sched-1, renice the CPU hog to 15 and kill the memory hog gracefully, then record their PIDs. |
| `quadlet-container-service` | Run a rootless container as a boot-time service | do | hard | 25 | C | proposed | rhcsa-aligned:containers | Run the pis-board container rootless for user pis as a Quadlet unit with lingering enabled, so it starts at boot without a login and survives a reboot. |
| `el-mock-scenario-depot` | Mixed review: stand up a depot server end to end | do | hard | 75 | C | proposed | rhcsa-aligned:local-storage, rhcsa-aligned:security, rhcsa-aligned:users-groups | Configure a fresh depot server with repos, users, storage, a service, firewall and SELinux in one session, graded only after a reboot. |
| `subnet-plan-depots` | Plan depot subnets and verify them on live interfaces | learn | easy | 15 | B | proposed | lpic1:networking, linuxplus:system-management | Split 10.60.0.0/22 into four equal depot subnets, write the plan to ~/answers/subnets.txt and assign the first host address of subnet 3 to eth1. |
| `runtime-routes-two-sites` | Route between two depot networks with static routes | do | medium | 15 | B | proposed | lfcs:networking, lpic2:networking | Add addresses and static routes on three hosts so depot-a can reach depot-b's 10.61.2.0/24 through the gateway host, verified by ping and traceroute. |
| `tcpdump-lost-heartbeats` | Capture the missing signalling heartbeats | do | medium | 20 | B | proposed | lpic2:networking, linuxplus:troubleshooting | Signalling heartbeats from tr-signal-03 never arrive; capture on both ends with tcpdump filters, find where UDP 5140 is dropped and write the hop to ~/answers/drop.txt. |
| `nftables-from-scratch` | Write an nftables ruleset for the ticket gateway from scratch | do | hard | 25 | B | proposed | lfcs:networking, linuxplus:security, cks:system-hardening | Replace the empty ruleset with an nftables table that allows established traffic, SSH from the ops subnet and HTTPS from anywhere, drops the rest and logs drops at a rate limit. |
| `nat-port-redirect-gateway` | NAT the depot network and redirect a legacy port | do | hard | 25 | B | proposed | lfcs:networking, lpic2:system-security, linuxplus:security | Masquerade 10.61.0.0/16 out of the gateway's uplink and redirect TCP 8080 on the gateway to the timetable API at 10.61.2.10:80, persistently. |
| `bridge-vlan-namespaces` | Wire two VLANs through a Linux bridge between namespaces | do | hard | 30 | B | proposed | lfcs:networking, linuxplus:troubleshooting | Create a VLAN-aware bridge with namespaces for ticketing (VLAN 20) and signalling (VLAN 30) so hosts reach only their own VLAN, verified by ping matrix. |
| `bond-active-backup` | Bond two links for the signalling uplink | do | medium | 20 | C | proposed | lfcs:networking | Bond eth1 and eth2 in active-backup mode with a persistent configuration; the grader downs the active link and expects pings to continue. |
| `mtu-mismatch-tunnel` | Fix large transfers that hang across the depot tunnel | fix | hard | 20 | B | proposed | linuxplus:troubleshooting | Small requests work but timetable downloads stall across the GRE link; find the MTU mismatch with path MTU probes and fix it so the 50 MiB download completes. |
| `netem-impaired-link` | Reproduce a lossy depot radio link with netem | do | medium | 15 | B | proposed |  | Add 120 ms delay and 2% loss on the depot link with tc netem so the vendor can test, then cap the backup sync to 5 Mbit/s with a token bucket. |
| `iperf-throughput-baseline` | Baseline throughput between two depots | do | medium | 15 | B | proposed | linuxplus:troubleshooting | Measure TCP and UDP throughput between depot-a and depot-b with iperf3, tune the interface MTU and ring settings where allowed, and record the before/after numbers. |
| `chrony-server-isolated` | Serve time to an isolated depot network | do | medium | 15 | B | proposed | lfcs:networking, lpic1:essential-services | Make tr-ntp-1 a chrony server for 10.61.0.0/16 using its local reference and point two clients at it so they report synchronised. |
| `wireguard-depot-tunnel` | Connect two depots with a WireGuard tunnel | do | hard | 25 | B | proposed | linuxplus:security, lpic2:system-security | Configure a WireGuard tunnel between depot-a and depot-b with keys and allowed IPs so their LANs route through it, persistent across restarts of the interface. |
| `haproxy-ticket-backends` | Load-balance the ticket API with health checks | do | medium | 20 | A | proposed | lfcs:networking, lpic2:http | Put HAProxy in front of three ticket API backends with round robin and HTTP health checks, so stopping one backend causes no failed requests. |
| `fix-dns-resolution-outage` | Restore name resolution on the dispatch host | fix | medium | 15 | A | proposed | linuxplus:troubleshooting, lfcs:networking | Dispatch apps cannot resolve any internal name though the resolver is up; find the broken nsswitch and resolver config and restore resolution for both short and full names. |
| `fs-on-image-files` | Practise filesystems safely on image files | learn | easy | 15 | A | proposed | lpic1:devices-filesystems, lfcs:storage | Create an image file, partition it, make ext4 and XFS filesystems inside, fill them and report used inodes and blocks for each to ~/answers/fs.txt. |
| `fsck-repair-ext4` | Repair a corrupted ext4 logs volume | fix | medium | 15 | B | proposed | lfcs:storage, lpic1:devices-filesystems, linuxplus:troubleshooting | The depot logs volume refuses to mount after a power cut; check and repair it with the right tool, recover lost+found entries and mount it again. |
| `lvm-snapshot-backup` | Take a consistent backup with an LVM snapshot | do | medium | 20 | B | proposed | lpic2:advanced-storage, lfcs:storage | Snapshot lv-ledger, back up the snapshot to /backup/ledger.tar.gz while the service keeps writing, then remove the snapshot. |
| `pvmove-replace-disk` | Move a volume group off a failing disk | do | hard | 20 | B | proposed | lpic2:advanced-storage | SMART warns about /dev/vdc; move all extents of vg-depot onto the new disk with pvmove while mounted and remove the old PV from the group. |
| `raid1-degrade-rebuild` | Rebuild a degraded RAID 1 mirror | fix | hard | 25 | B | proposed | lpic2:advanced-storage, linuxplus:system-management | One member of the depot RAID 1 failed; mark it failed, remove it, add the replacement disk and let the array resync, with mdadm.conf updated. |
| `luks-encrypt-archive` | Encrypt the passenger-data archive volume | do | hard | 25 | C | proposed | linuxplus:security, lpic2:filesystems | Create a LUKS2 volume on the new disk with a keyfile and passphrase slot, open it at boot through crypttab and mount it at /srv/pax-archive. |
| `quotas-crew-homes` | Enforce disk quotas on crew home directories | do | medium | 20 | C | proposed | linuxplus:troubleshooting | Enable user quotas on /home and give every member of group crew a 200 MiB soft and 250 MiB hard block limit, then report who is over. |
| `iscsi-attach-volume` | Attach a block volume from the storage server over iSCSI | do | hard | 25 | C | proposed | lfcs:storage, lpic2:advanced-storage | Discover and log in to the iSCSI target on tr-san-1, make the LUN persistent across reboot and mount its filesystem at /srv/san-logs. |
| `fix-boot-mount-network` | Fix a network mount that hangs boot | fix | medium | 15 | C | proposed | linuxplus:troubleshooting | tr-report-2 takes four minutes to boot because an NFS mount is tried before the network is up; fix the mount options so boot is fast and the share still mounts. |
| `io-latency-hunt` | Find the process causing I/O wait on the ledger host | do | medium | 20 | B | proposed | lfcs:storage, linuxplus:troubleshooting | Ledger writes are slow; use iostat and per-process I/O tools to identify the culprit and its device, write both to ~/answers/io.txt, and throttle it with ionice. |
| `ssh-hardening-fail2ban` | Harden SSH on the public ticket host and block repeated failures | do | medium | 20 | A | proposed | linuxplus:security, lpic2:system-security | Disable password and root logins, restrict ciphers to the approved set and ban an address for 10 minutes after five failed logins on tkt-web-02. |
| `pam-pwquality-faillock` | Enforce password quality and lockout | do | medium | 20 | C | proposed | linuxplus:security | Require 14-character passwords with three classes and no reuse of the last five, and lock accounts for 15 minutes after five failures, through PAM. |
| `gpg-sign-timetable` | Sign and verify the published timetable | do | easy | 15 | A | proposed | lpic1:security, linuxplus:security | Create a signing key for the timetable office, publish a detached signature for timetable-2027.pdf and verify a colleague's signed file with their imported key. |
| `aide-integrity-baseline` | Baseline and check file integrity on the signalling host | do | medium | 20 | A | proposed | linuxplus:security | Initialise an AIDE database covering /etc and /usr/bin, then after the scheduled change window report exactly which files changed. |
| `rsyslog-forward-central` | Forward authentication logs to the central log host | do | medium | 20 | B | proposed | lpic1:essential-services, linuxplus:security | Forward auth and authpriv messages from three hosts to tr-log-1 over TCP and store them per host under /var/log/remote/<host>/auth.log. |
| `auditd-watch-identity` | Audit changes to identity files and sudoers | do | medium | 20 | C | proposed | linuxplus:security | Add persistent audit rules watching passwd, shadow, group and sudoers.d with a key, trigger a change, and report who made it from ausearch. |
| `apparmor-confine-agent` | Confine the depot agent with AppArmor | do | hard | 25 | C | proposed | cks:system-hardening, linuxplus:security | Generate an AppArmor profile for the depot agent in complain mode, tighten it so it may only read its config and write its spool, and switch it to enforce. |
| `kernel-hardening-sysctls` | Apply kernel hardening settings and disable unused modules | do | medium | 20 | C | proposed | linuxplus:security, cks:system-hardening | Apply the hardening sysctls from the security baseline and stop usb-storage and two unused filesystems from loading, both effective after reboot. |
| `unit-sandboxing-score` | Sandbox the passenger-info service with systemd | do | hard | 25 | B | proposed |  | Add sandboxing directives to tr-pis.service until systemd-analyze security rates it below 4.0 while the service still serves requests. |
| `openscap-scan-remediate` | Scan, remediate and rescan against a CIS-style profile | do | hard | 35 | C | proposed | linuxplus:security | Scan the ticket server with OpenSCAP against the provided CIS-style profile, fix the five failing rules in the SSH and audit sections, and rescan to a passing report. |
| `attack-surface-cleanup` | Remove services nobody needs from the signalling host | do | medium | 20 | C | proposed | cks:system-hardening, linuxplus:security | Find listening services and installed packages not on the signalling host's approved list, remove or disable them, and leave only the approved ports open. |
| `hunt-escalation-paths` | Find and close local privilege-escalation paths | hack | hard | 35 | A | proposed | linuxplus:security | Audit tkt-web-02 as an unprivileged user, list the misconfigured sudo rule, unexpected setuid file and world-writable root-owned job you find, then close each one as root. |
| `intrusion-persistence-sweep` | Find and remove persistence left on a compromised kiosk | hack | hard | 40 | B | proposed | linuxplus:security | A ticket kiosk was compromised; find the rogue user, the extra authorized key, the scheduled job and the modified service that keep the intruder in, remove them all and record each in the incident file. |
| `logrotate-ticket-logs` | Rotate the ticket API logs before they fill the disk | do | easy | 12 | A | proposed | lpic1:essential-services, linuxplus:security | Add a logrotate policy that rotates the ticket API logs daily, keeps 14 compressed copies and signals the service to reopen files, verified with a forced run. |
| `use-method-slow-host` | Triage a slow host in sixty seconds | learn | medium | 20 | B | proposed | lpic2:capacity, linuxplus:troubleshooting | The timetable server is slow; run a 60-second USE checklist and record which resource is saturated and which process causes it in ~/answers/use.txt. |
| `oom-kill-investigation` | Explain why the fares batch keeps getting killed | fix | medium | 20 | B | proposed | linuxplus:troubleshooting | The fares batch dies every night; prove from kernel logs and memory statistics that the OOM killer chose it, name the real memory consumer and cap it so the batch survives. |
| `perf-cpu-flamegraph` | Find the hot function in the route planner | do | hard | 25 | B | proposed | lpic2:capacity | Profile the route planner with perf while it runs a test plan, generate a flame graph and write the hottest function name to ~/answers/hot.txt. |
| `strace-config-not-found` | Find which config file a silent tool tries to open | fix | medium | 15 | A | proposed | linuxplus:troubleshooting | The fleet tool exits 1 with no message; use strace to find the missing file path and permission error, fix both and make the tool succeed. |
| `bpftrace-who-opens` | Trace which processes open the signalling database | do | hard | 20 | B | proposed |  | Use a bpftrace one-liner to log every process that opens /srv/sig/db for one minute and report the unexpected one to ~/answers/opens.txt. |
| `psi-pressure-alert` | Detect memory pressure before users notice | do | hard | 20 | B | proposed |  | Read system and per-cgroup pressure stall data while a load runs, identify the stalled slice and write a threshold to the monitoring config that would have fired. |
| `node-exporter-alert` | Expose host metrics and an alert for a filling disk | do | medium | 25 | B | proposed | linuxplus:troubleshooting | Run node_exporter as a service with the textfile collector, publish a custom depot-sync age metric and write a Prometheus alert rule for disks above 90%. |
| `fix-port-conflict` | Fix a service that cannot bind its port | fix | easy | 10 | B | proposed | linuxplus:troubleshooting | pis-api fails with 'address already in use'; find the stray process holding 8080, stop and disable it, and start pis-api cleanly. |
| `fix-ssh-key-perms` | Fix key login that falls back to password | fix | easy | 10 | A | proposed | linuxplus:troubleshooting | Key login for user ops on tr-jump-1 asks for a password; find the permission and ownership errors in the home and .ssh tree and fix them so key login works. |
| `fix-firewall-blocks-app` | Restore access to the depot API blocked by the firewall | fix | medium | 15 | B | proposed | linuxplus:troubleshooting | After a hardening change, depot tablets cannot reach the API on 9443; find the rule responsible and allow only the tablet subnet, keeping the rest of the policy. |
| `fix-routing-asymmetric` | Fix replies that leave by the wrong interface | fix | hard | 25 | B | proposed | linuxplus:troubleshooting, lfcs:networking | Requests to the signalling host's second address time out; find the asymmetric route, add policy routing so replies leave the interface they arrived on, persistently. |
| `fix-missing-shared-lib` | Fix a binary that cannot find its shared library | fix | medium | 15 | A | proposed | linuxplus:troubleshooting, lpic1:install-packages | The vendor fare calculator fails with a missing .so error; locate the library, register it with ldconfig the right way and make the binary run for all users. |
| `boot-slow-analysis` | Cut the boot time of the platform display host | fix | medium | 20 | C | proposed | linuxplus:troubleshooting | The display host takes too long to boot; find the slowest units with systemd-analyze, fix the one waiting on a missing device and record the before/after times. |
| `kernel-panic-initramfs` | Recover from a kernel that cannot find its root filesystem | fix | hard | 30 | C | proposed | linuxplus:troubleshooting, lpic2:kernel | After a storage driver change the depot host panics at boot; boot the previous kernel, rebuild the initramfs with the needed driver and make the new kernel boot. |
| `incident-capstone-ticketing` | Incident: ticket sales stop during the morning peak | fix | hard | 60 | B | proposed | linuxplus:troubleshooting | Multiple injected faults (disk, DNS and a crashed unit) stop ticket sales; restore service within the time box and file a USE-method write-up naming each cause. |
| `linux-namespaces-unshare` | Build an isolated process with namespaces by hand | learn | medium | 20 | B | proposed |  | Use unshare to start a shell with its own PID, mount, UTS and network namespaces named tt-sandbox, then enter it from another terminal with nsenter and prove the isolation. |
| `linux-cgroup-v2-limits` | Cap a runaway job with cgroup v2 limits | do | medium | 20 | B | proposed |  | Create a cgroup for the route-planner batch with memory.max 256 MiB, cpu.max 50% and pids.max 64, move the job into it and show the memory.events counters after it hits the limit. |
| `linux-overlayfs-by-hand` | Assemble a container root filesystem with overlayfs | do | medium | 20 | B | proposed |  | Mount an overlay of two read-only layers and a writable upper directory at /srv/rootfs, modify and delete files, and show the resulting upper-layer files and whiteouts. |
| `veth-netns-plumbing` | Wire a namespace to the host network with veth and NAT | do | hard | 25 | B | proposed |  | Connect namespace tt-sandbox to the host with a veth pair, give it 10.200.0.2/24, a default route and NAT so it reaches the package mirror. |
| `capabilities-drop-service` | Run a service with only the capabilities it needs | do | hard | 20 | B | proposed | linuxplus:services-users | Make the platform-board daemon bind port 80 as a non-root user with only CAP_NET_BIND_SERVICE, verified from /proc status, and block other capabilities with a seccomp-enabled unit. |
| `systemd-run-slices` | Limit a team's workloads with systemd slices | do | medium | 15 | B | proposed |  | Run the analytics jobs under a dedicated slice with a CPU weight and memory high limit using systemd-run, and confirm the cgroup settings in the hierarchy. |
| `am-i-in-a-container` | Work out whether a shell runs in a container or a VM | hack | medium | 20 | B | proposed |  | From three shells provided by the incident team, decide which runs in a container, which in a VM and which on bare host from namespaces, cgroups and hardware evidence, and record the proof. |
| `bind-authoritative-zone` | Serve the tallowmere.test zone authoritatively | do | medium | 25 | A | proposed | lpic2:dns | Run BIND as the authoritative server for tallowmere.test and its reverse zone with the records in the ticket, and pass a zone check and dig queries from a client. |
| `unbound-caching-forwarder` | Run a caching resolver that forwards the internal zone | do | medium | 20 | A | proposed | lpic2:dns | Run Unbound as a caching resolver for the depot network that forwards tallowmere.test to the authoritative server and refuses queries from outside 10.61.0.0/16. |
| `apache-vhosts-tls` | Host two sites on one Apache server with TLS | do | medium | 25 | A | proposed | lpic2:http | Serve timetable.tallowmere.test and fares.tallowmere.test as name-based virtual hosts on Apache with certificates from the local CA and HTTP-to-HTTPS redirects. |
| `postfix-relay-alerts` | Relay depot alert mail through the central mail host | do | medium | 25 | A | proposed | lpic2:email, lpic1:essential-services | Configure Postfix on the depot host to send through tr-mail-1, rewrite root's mail to the ops alias and deliver a test alert that the grader finds in the ops mailbox. |
| `nfs-server-exports` | Export depot directories over NFS with the right options | do | medium | 20 | C | proposed | lpic2:file-sharing, lfcs:storage | Export /srv/depot/manuals read-only to the depot subnet and /srv/depot/uploads read-write with root squashing, persistently, and verify from a client. |
| `samba-share-office` | Share the timetable office folder with Samba | do | medium | 20 | B | proposed | lpic2:file-sharing | Share /srv/office as \\tr-files\office for group planners only with write access and correct Unix permissions, verified with smbclient. |
| `dhcp-server-depot` | Serve DHCP to a new depot segment | do | medium | 20 | C | proposed | lpic2:client-mgmt, linuxplus:services-users | Serve leases for 10.62.1.100-200 with gateway and DNS options and a fixed address for the depot printer by MAC, verified by a client on the segment. |
| `sftp-chroot-vendors` | Give a vendor SFTP-only access in a chroot | do | medium | 20 | A | proposed | lpic2:system-security, lfcs:networking | Let user vendor-upload transfer files only by SFTP into /srv/vendor/inbox, jailed in a chroot with no shell access. |
| `postgres-backup-restore` | Back up and restore the fares database | do | medium | 20 | A | proposed |  | Take a logical backup of the fares PostgreSQL database, drop a table as instructed, and restore it so the row counts match the backup report. |
| `rsync-backup-timer` | Back up the depot manuals nightly with rsync | do | medium | 20 | B | proposed | lpic2:maintenance, linuxplus:system-management | Mirror /srv/depot/manuals to the backup host with rsync over SSH every night via a timer, preserving permissions and deleting removed files, and prove a restore works. |
| `cloud-init-new-depot-host` | Provision a new depot host with cloud-init | do | medium | 25 | C | proposed | linuxplus:automation-scripting, lpic1:install-packages | Write user-data that creates the ops user with a key, installs the depot agent from the mirror and writes its config, then boot a VM with it and debug the one failing module. |
| `kernel-module-blacklist` | Load a module with options and blacklist another | do | easy | 12 | C | proposed | lpic1:system-architecture, linuxplus:system-management, lpic2:kernel | Load the dummy network module with numdummies=3 at every boot and prevent the floppy module from ever loading, verified after reboot. |
| `udev-stable-device-name` | Give the depot USB serial reader a stable name | do | medium | 15 | C | proposed | lpic2:kernel | Write a udev rule that names the depot reader /dev/tr-reader by its serial attribute with group dialout and mode 0660, verified after a replug. |
| `hardware-inventory-report` | Inventory a depot host's hardware without vendor tools | learn | easy | 12 | C | proposed | lpic1:system-architecture, linuxplus:system-management | Report CPU model and cores, memory, block devices with sizes and PCI network controllers of depot-ctl-2 in the CSV format the asset team needs. |
| `libvirt-golden-template` | Turn a configured VM into a reusable template | do | hard | 25 | C | proposed | lpic1:install-packages | Clean the configured depot VM (machine-id, SSH host keys, logs, cloud-init state) so clones from it boot with unique identities, proven by cloning two copies. |

## Containers with Docker

Build, ship, run, secure and debug OCI containers with Docker Engine 29, BuildKit, buildx, Bake and Compose, graded on end state (inspect output, registry contents, attestations, reachability) rather than on command history. Digests, OCI referrers and attestations are first-class from the image-building path onward. Podman 5 is a short optional track for Enterprise Linux hosts.

Fictional organisation: **Copperleaf Media** (A fictional streaming and publishing company running a video transcoder farm, a catalogue API, a subtitle service, an ad-insertion service and a playout encoder, with a private registry at registry.copperleaf.example.).

Docker-first since revision 2 (2026-10-14). Paths, exams and the image budget centre on Docker Engine 29 (containerd image store), BuildKit/buildx/Bake, Compose, networking, storage, registries, runtime security, supply chain (Scout, cosign, Notation, SBOM and provenance, Docker Hardened Images), troubleshooting and production CI. Podman keeps five labs (differences from Docker, rootless, SELinux mounts, pods with Kubernetes YAML, Quadlet) and a smaller optional simulation; Swarm stays optional and unexamined.

Competencies: `containers.foundations` (new), `containers.build` (new), `containers.buildkit` (new), `containers.compose` (new), `containers.network` (new), `containers.storage` (new), `containers.runtime-security` (new), `containers.supply-chain` (new), `containers.registry` (new), `containers.operations` (new), `containers.internals` (new), `containers.podman` (new), `containers.swarm` (new).

### Paths (11)

| Path | Title | Level | Hours | Labs | Prerequisites | Aligns to | Audience |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ctr-foundations` | Container foundations | beginner | 3 | 8 | - | - | Developers and administrators new to containers; requires the Linux foundations shell, permissions and processes modules |
| `ctr-building-images` | Building great container images | intermediate | 7 | 15 | `ctr-foundations` | ckad | Developers and platform engineers who ship images |
| `ctr-compose` | Multi-container applications with Compose | intermediate | 4 | 9 | `ctr-foundations` | - | Developers running local stacks and small services |
| `ctr-networking` | Container networking | advanced | 6 | 10 | `ctr-foundations` | - | Platform and operations engineers; requires Linux host networking basics |
| `ctr-storage` | Container storage and data | intermediate | 3 | 6 | `ctr-foundations` | - | Anyone running stateful containers |
| `ctr-registries` | Registries and image distribution | intermediate | 3 | 6 | `ctr-building-images` | - | Platform engineers running registries and offline mirrors |
| `ctr-security-supply-chain` | Container security and supply chain | advanced | 10 | 16 | `ctr-building-images`, `ctr-registries` | cks | Security and platform engineers |
| `ctr-troubleshooting-production` | Container troubleshooting and production operations | advanced | 7 | 13 | `ctr-building-images`, `ctr-compose`, `ctr-networking`, `ctr-storage` | - | Operations engineers running container hosts and CI |
| `ctr-internals` | Container internals | advanced | 4 | 7 | `ctr-building-images`, `ctr-storage` | - | Platform engineers, SREs and security engineers |
| `ctr-podman-track` | Podman for Docker users (optional) | intermediate | 2 | 5 | `ctr-foundations` | ex188-aligned | Docker users who also run containers on Enterprise Linux hosts; graded on end state that survives a reboot |
| `ctr-swarm` | Swarm essentials (optional) | intermediate | 2 | 3 | `ctr-compose`, `ctr-networking` | - | Teams still operating Swarm clusters |

<details><summary><b>Container foundations</b>: modules</summary>

- **Run, inspect and debug containers**: `ctr-first-transcoder-run`, `ctr-override-defaults`, `ctr-exec-into-subtitle`, `ctr-inspect-report`
- **Images, networks, volumes and housekeeping**: `ctr-tag-vs-digest`, `ctr-user-bridge-dns`, `ctr-volume-vs-bind`, `ctr-disk-reclaim`

</details>

<details><summary><b>Building great container images</b>: modules</summary>

- **Dockerfile fundamentals**: `ctr-dockerfile-catalogue-api`, `ctr-build-args-labels`, `ctr-exec-form-signals`, `ctr-healthcheck`
- **Small, cache-friendly, non-root, reproducible images**: `ctr-cache-order`, `ctr-shrink-transcoder`, `ctr-non-root-uid`, `ctr-digest-pin`, `ctr-reproducible-build`
- **BuildKit, buildx and Bake**: `ctr-buildkit-cache-mount`, `ctr-build-secret-token`, `ctr-build-checks`, `ctr-multi-platform`, `ctr-bake-matrix`, `ctr-buildx-cache-export`

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation or The Linux Foundation. CKAD is a trademark of The Linux Foundation. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Multi-container applications with Compose</b>: modules</summary>

- **The application model**: `ctr-compose-first-stack`, `ctr-compose-env-interp`, `ctr-compose-override-profiles`
- **Startup, secrets and the inner loop**: `ctr-compose-healthy-start`, `ctr-compose-secrets`, `ctr-compose-watch`, `ctr-compose-proxy-repair`
- **Composition and distribution**: `ctr-compose-include-split`, `ctr-compose-oci-publish`

</details>

<details><summary><b>Container networking</b>: modules</summary>

- **Bridges, names and published ports**: `ctr-user-bridge-dns`, `ctr-publish-scoped`, `ctr-reach-without-publish`
- **Host integration, firewall backends and drivers**: `ctr-cidr-clash`, `ctr-docker-user-chain`, `ctr-nftables-backend`, `ctr-macvlan-encoder`, `ctr-ipv6-dual-stack`
- **Packet-level diagnosis**: `ctr-net-tcpdump-veth`, `ctr-net-mtu-hang`

</details>

<details><summary><b>Container storage and data</b>: modules</summary>

- **Mounts and data operations**: `ctr-volume-vs-bind`, `ctr-volume-backup-restore`, `ctr-bind-permission-denied`, `ctr-image-mount-models`
- **The image store**: `ctr-storage-backend-tour`, `ctr-containerd-store-migration`

</details>

<details><summary><b>Registries and image distribution</b>: modules</summary>

- **References and private registries**: `ctr-tag-vs-digest`, `ctr-local-registry-tls`, `ctr-registry-gc`
- **Mirrors, air gaps and OCI artifacts**: `ctr-offline-mirror`, `ctr-skopeo-copy-airgap`, `ctr-oci-artifacts-referrers`

</details>

<details><summary><b>Container security and supply chain</b>: modules</summary>

- **Runtime and engine least privilege**: `ctr-cap-drop-readonly`, `ctr-socket-escape`, `ctr-remote-engine-ssh`, `ctr-rootless-engine`, `ctr-seccomp-profile`, `ctr-cis-bench`
- **Scanning, policy and hardened bases**: `ctr-scan-triage-vex`, `ctr-scout-policy`, `ctr-leaked-secret-history`, `ctr-hardened-base-migration`, `ctr-dhi-vex-reconcile`
- **Attestations and signatures**: `ctr-sbom-provenance`, `ctr-content-trust-retired`, `ctr-cosign-sign-verify`, `ctr-notation-sign-verify`, `ctr-signed-only-gate`

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation or The Linux Foundation. CKS is a trademark of The Linux Foundation. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Container troubleshooting and production operations</b>: modules</summary>

- **Exits, limits and changed defaults**: `ctr-oom-exit-137`, `ctr-nofile-after-upgrade`, `ctr-link-env-removed`, `ctr-seccomp-legacy-binary`, `ctr-api-version-floor`, `ctr-events-flapping`, `ctr-debug-distroless`
- **Logs, restarts, daemon and upgrades**: `ctr-log-rotation`, `ctr-restart-policy`, `ctr-daemon-json-conflict`, `ctr-engine-upgrade`
- **Production delivery and CI**: `ctr-ci-rootless-buildkit`, `ctr-release-pipeline-capstone`

</details>

<details><summary><b>Container internals</b>: modules</summary>

- **Linux primitives (shared with the Linux domain)**: `linux-namespaces-unshare`, `linux-cgroup-v2-limits`, `linux-overlayfs-by-hand`
- **Runtime stack and OCI formats**: `ctr-runtime-stack-trace`, `ctr-runc-bundle`, `ctr-image-layout-on-disk`, `ctr-socket-escape`

</details>

<details><summary><b>Podman for Docker users (optional)</b>: modules</summary>

- **Differences from Docker and rootless operation**: `ctr-podman-docker-differences`, `ctr-podman-rootless-basics`, `ctr-selinux-relabel`
- **Pods and systemd services**: `ctr-podman-pod-kube-play`, `ctr-quadlet-reboot`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Specialist in Containers is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

Optional short track. Image building, registries and troubleshooting transfer from the Docker paths (ctr-building-images, ctr-registries, ctr-troubleshooting-production); learners aiming at the Podman simulation take those first.

</details>

<details><summary><b>Swarm essentials (optional)</b>: modules</summary>

- **Clusters, services and stacks**: `ctr-swarm-init-quorum`, `ctr-swarm-services`, `ctr-swarm-stack`

</details>

### Labs (91)

| Lab | Title | Type | Difficulty | Min | Tier | Status | Frameworks | Scenario |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ctr-first-transcoder-run` | Start, inspect and retire your first transcoder container | learn | easy | 12 | B | verified | ex188-aligned:run-containers, docker-practitioner:operations | Run the transcode-probe image detached as probe-1 with PROFILE=1080p, read its startup banner from the logs into ~/probe-banner.txt, and remove the stale probe-old container so only probe-1 remains. |
| `ctr-override-defaults` | Run a one-off catalogue migration by overriding image defaults | do | easy | 10 | B | verified | ex188-aligned:run-containers, docker-practitioner:operations, docker-practitioner:build | Copperleaf's catalogue-api image normally starts the server; run it once with an overridden entrypoint and arguments to apply migration 0042, then record the migration container's exit code in ~/migrate-exit.txt. |
| `ctr-exec-into-subtitle` | Read live configuration from inside the subtitle service | do | easy | 8 | B | verified | ex188-aligned:troubleshoot, docker-practitioner:operations | The running subtitle-svc container was started with a config nobody committed; exec into it, find the active caption-font value it loaded, and write it to ~/subtitle-font.txt without restarting the container. |
| `ctr-inspect-report` | Report which containers mount the catalogue share | do | easy | 12 | B | verified | dca-legacy:install-config, docker-practitioner:operations | Of the twelve containers on Copperleaf's batch host, list the names and IP addresses of exactly those that mount /srv/catalogue, one per line in ~/catalogue-mounts.txt, using inspect templates and filters. |
| `ctr-disk-reclaim` | Free engine disk space without losing release images | fix | easy | 12 | B | verified | docker-practitioner:operations | The transcoder host's engine storage is filling up; reclaim a randomised 350-450 MiB with targeted prune commands while every image tagged prod and every named volume survives. |
| `ctr-tag-vs-digest` | Deploy the catalogue API by digest after a tag moved | learn | easy | 10 | B | verified | dca-legacy:images-registry, ex188-aligned:manage-images, docker-practitioner:registry | catalogue-api:2.3 was re-pushed with a different build overnight; find the digest the release note names in the local registry, run the service by that digest, and write the digest to ~/pinned-digest.txt. |
| `ctr-dockerfile-catalogue-api` | Write a Dockerfile with a lean build context for the catalogue API | learn | easy | 15 | B | verified | ex188-aligned:build-images, ckad:design-build, dca-legacy:images-registry, docker-practitioner:build | Containerise Copperleaf's Python catalogue API so the image answers on port 8080 and the sample media in the repository (200 MiB here) never reaches the build context or the image. |
| `ctr-exec-form-signals` | Make the ad-insertion service stop cleanly | fix | medium | 15 | B | verified | ex188-aligned:build-images, docker-practitioner:build | The ad-insertion container ignores SIGTERM because a shell-form ENTRYPOINT wraps it, so every stop waits 10 s and loses in-flight bookings; fix the image so docker stop finishes within 2 s and the service logs a clean shutdown. |
| `ctr-cache-order` | Reorder the subtitle build so code edits reuse cached dependencies | do | medium | 15 | B | proposed | ckad:design-build, docker-practitioner:build | A one-line code change to the subtitle service triggers a six-minute dependency reinstall; restructure the Dockerfile so a rebuild after editing src/ reuses the dependency layer and the apt layer leaves no package lists behind. |
| `ctr-shrink-transcoder` | Shrink the transcoder image with a multi-stage build | do | medium | 20 | B | proposed | ckad:design-build, cks:supply-chain-security, ex188-aligned:build-images, docker-practitioner:build | The transcoder image weighs about 900 MB because it ships its compiler toolchain; rebuild it with multiple stages so it is under 120 MB and still passes the bundled probe-media self-test. |
| `ctr-non-root-uid` | Run the thumbnailer as UID 10001 with one writable cache path | do | medium | 15 | B | proposed | ex188-aligned:build-images, cks:supply-chain-security, docker-practitioner:build | Security wants the thumbnailer image to run as UID/GID 10001 with only /var/cache/thumbs writable by that user; rebuild it so it starts without root and still writes thumbnails. |
| `ctr-healthcheck` | Report catalogue API health only after its cache is warm | do | easy | 12 | B | verified | ex188-aligned:build-images, docker-practitioner:build | Add a HEALTHCHECK to the catalogue API image so the container reports healthy only once /ready returns 200 after the cache warm-up, and unhealthy within 30 s if that endpoint starts failing. |
| `ctr-build-args-labels` | Stamp release metadata into the subtitle image with ARG and labels | do | easy | 10 | B | verified | ex188-aligned:build-images, docker-practitioner:build | Make the subtitle image accept a RELEASE build argument that ends up both as an org.opencontainers.image.version label and as the APP_RELEASE environment variable, then build release 4.2.0. |
| `ctr-digest-pin` | Pin every base image of the catalogue build by digest | do | medium | 12 | B | proposed | cks:supply-chain-security, docker-practitioner:build | Replace each floating FROM tag in the catalogue API's Dockerfile with the digest currently served by the Copperleaf mirror so a rebuild next month produces the same base layers. |
| `ctr-reproducible-build` | Rebuild the subtitle image bit for bit from the same commit | do | hard | 25 | B | proposed | docker-practitioner:build | Auditors want to rebuild subtitle:4.3.0 and get the same digest; pin every input, derive SOURCE_DATE_EPOCH from the commit time and rewrite file timestamps so two clean builds on fresh builders produce an identical image digest. |
| `ctr-buildkit-cache-mount` | Stop re-downloading Python wheels on every rebuild | do | medium | 15 | B | proposed | docker-practitioner:build | Use a BuildKit cache mount for the pip cache in the subtitle build so a rebuild after a requirements bump fetches only the changed package from the offline index (the grader reads the index access log). |
| `ctr-build-secret-token` | Move a private package token out of build arguments | do | medium | 15 | B | proposed | cks:supply-chain-security, docker-practitioner:build, docker-practitioner:supply-chain | The ad-insertion build passes a package-feed token via ARG, so it shows up in image history; switch to a BuildKit secret mount so the image still builds and neither history nor any layer contains the token. |
| `ctr-build-checks` | Clear every build-check warning in the subtitle Dockerfile | fix | easy | 10 | B | proposed | docker-practitioner:build | Run the build checks against the subtitle service's Dockerfile and fix every reported issue (shell-form commands, casing, undefined variables) so the check run exits clean and the image still builds. |
| `ctr-multi-platform` | Publish the thumbnailer for amd64 and arm64 in one index | do | hard | 25 | B | proposed | docker-practitioner:build, docker-practitioner:registry | Copperleaf's new ARM edge boxes need the thumbnailer; build it for linux/amd64 and linux/arm64 with buildx and push a single index to the private registry whose manifest list carries both platforms. |
| `ctr-bake-matrix` | Build three media services from one Bake file | do | hard | 20 | B | proposed | docker-practitioner:build | Write a Bake file whose default group builds the transcoder, subtitle and thumbnailer images with a shared RELEASE variable so one bake command produces all three tagged images. |
| `ctr-buildx-cache-export` | Share build cache between throwaway CI builders through the registry | do | hard | 25 | B | proposed | docker-practitioner:build | Every CI run rebuilds the transcoder from scratch; create a docker-container buildx builder, export its cache to the private registry with mode=max, prove a brand-new builder reuses it, and export the compiled binaries to ./dist with the local exporter. |
| `ctr-compose-first-stack` | Describe the catalogue API and its cache as a Compose project | learn | easy | 15 | B | proposed | ex188-aligned:multi-container, docker-practitioner:compose | Write a Compose file that runs the catalogue API with a Redis cache on a named network and a named volume, so compose up -d leaves the API on port 8080 serving cached titles. |
| `ctr-compose-env-interp` | Drive staging and production ports from .env files | do | easy | 12 | B | proposed | docker-practitioner:compose | Parameterise the catalogue Compose project so .env.staging publishes 18080 and .env.prod publishes 8080, and compose config with each file renders exactly those ports. |
| `ctr-compose-healthy-start` | Stop the rights service racing its database at startup | fix | medium | 15 | B | proposed | ex188-aligned:multi-container, docker-practitioner:compose | The rights-ledger API crash-loops on every compose up because it starts before PostgreSQL accepts connections; add a database healthcheck and a depends_on condition so a cold start brings the API up healthy on the first try. |
| `ctr-compose-override-profiles` | Add a debug toolbox that only starts on request | do | medium | 15 | B | proposed | docker-practitioner:compose | Split the catalogue project into a base file and a local override, and add a toolbox service that starts only with the debug profile, so a plain up runs two services and a debug up runs three. |
| `ctr-compose-secrets` | Deliver the ad partner key as a Compose secret | do | medium | 15 | B | proposed | ex188-aligned:multi-container, docker-practitioner:compose | Give the ad-insertion service its partner API key as a Compose secret mounted under /run/secrets instead of an environment variable, so the key is readable in the container but absent from docker inspect output. |
| `ctr-compose-watch` | Live-sync subtitle templates while developing | do | medium | 15 | B | proposed | docker-practitioner:compose | Configure develop.watch so edits under templates/ appear in the running subtitle container without a rebuild and a change to requirements.txt triggers a rebuild, as proven by the grader's file edits. |
| `ctr-compose-include-split` | Split the media platform Compose file per team | do | medium | 20 | B | proposed | docker-practitioner:compose | The 600-line platform compose.yaml is edited by three teams; split it into catalogue, subtitle and ads files assembled with include, share one logging block through extends, and keep the rendered compose config identical to the original. |
| `ctr-compose-oci-publish` | Ship the caption review stack to QA as an OCI artifact | do | hard | 20 | B | proposed | docker-practitioner:compose | Publish the caption-review Compose application to the private registry as an OCI artifact with every image pinned by digest, then start it on the QA engine straight from the registry reference with no project files copied across. |
| `ctr-compose-proxy-repair` | Repair the caption-render proxy that answers 502 | fix | medium | 20 | B | proposed | ex188-aligned:troubleshoot, docker-practitioner:compose, docker-practitioner:networking | Copperleaf's Caddy proxy in front of two caption renderers returns 502 because the renderers sit on another network and the upstream port is wrong; fix the Compose project so requests alternate between both renderers. |
| `ctr-user-bridge-dns` | Let the catalogue API find its database by name | learn | easy | 12 | B | verified | dca-legacy:networking, ex188-aligned:multi-container, docker-practitioner:networking | catalogue-api cannot resolve catalogue-db because both run on the default bridge; move them to a user-defined network so the API reaches the database by name and stays unpublished to the host. |
| `ctr-publish-scoped` | Publish the transcoder API on the private address only | do | easy | 10 | B | proposed | dca-legacy:networking, ex188-aligned:run-containers, docker-practitioner:networking | Publish the transcoder's job API on the host's private address and its metrics port on 127.0.0.1 only, so the grader's second host reaches the API but never the metrics. |
| `ctr-reach-without-publish` | Query a distroless service's debug port without publishing it | do | medium | 12 | B | proposed | docker-practitioner:networking, docker-practitioner:operations | The distroless subtitle service exposes /debug/vars only on localhost inside its container; start a toolbox container in its network namespace and save that endpoint's output to ~/subtitle-vars.json without publishing any port. |
| `ctr-cidr-clash` | Move container networks off the office VPN range | fix | medium | 20 | C | proposed | dca-legacy:networking, docker-practitioner:networking, docker-practitioner:operations | New Compose networks on the editing host grab 172.20.0.0/16, which collides with Copperleaf's VPN; configure default address pools so new networks land in 10.210.0.0/16 and the VPN route to the archive works again. |
| `ctr-docker-user-chain` | Restrict the ad-insertion port to partner networks | hack | hard | 25 | C | proposed | dca-legacy:networking, dca-legacy:security, docker-practitioner:networking | The published ad-insertion port is reachable from every network, and the host firewall rules the admin added are bypassed; add persistent DOCKER-USER rules so only 198.51.100.0/24 reaches it, surviving an engine restart. |
| `ctr-macvlan-encoder` | Give the playout encoder its own studio LAN address | do | hard | 25 | C | proposed | dca-legacy:networking, docker-practitioner:networking | The playout encoder must appear on the studio LAN as 192.0.2.40; attach it with a macvlan network on the VM's second NIC so the studio host reaches it directly. |
| `ctr-net-mtu-hang` | Fix uploads from containers that hang at the CDN ingest | fix | hard | 25 | B | proposed | docker-practitioner:networking | Large uploads from the packager container to the CDN ingest stall while small ones work; capture the traffic, find the MTU mismatch on the custom network and set the network MTU so a 50 MB upload completes. |
| `ctr-ipv6-dual-stack` | Serve the catalogue API to IPv6-only set-top boxes | do | medium | 20 | C | proposed | docker-practitioner:networking, dca-legacy:networking | Copperleaf's new set-top boxes are IPv6-only; create a dual-stack user-defined network from the assigned ULA prefix, attach the catalogue API and publish it so it answers on both the host's IPv4 and IPv6 addresses. |
| `ctr-nftables-backend` | Move the edge host's engine to the nftables firewall backend | do | hard | 25 | C | proposed | docker-practitioner:networking | Switch the edge host's engine to the nftables firewall backend, keep the transcoder API reachable only from the partner range with an equivalent of the old DOCKER-USER rule, and prove the engine no longer writes iptables rules. |
| `ctr-net-tcpdump-veth` | Prove which container is flooding the ad-decision service | fix | medium | 20 | B | proposed | docker-practitioner:networking | Something on the ads network floods the ad-decision service with requests; capture on the right veth and inside the service's namespace with nsenter and tcpdump, name the offending container in ~/flooder.txt and disconnect it from the network. |
| `ctr-volume-vs-bind` | Pick the right mount type for index, config and scratch | learn | easy | 12 | B | verified | dca-legacy:storage, ex188-aligned:run-containers, docker-practitioner:storage | Run the media indexer with its index in a named volume, its config as a read-only bind mount and its scratch space in a 256 MiB tmpfs, as verified by the container's mount table. |
| `ctr-volume-backup-restore` | Back up the rights database volume and restore it elsewhere | do | medium | 15 | B | proposed | dca-legacy:storage, docker-practitioner:storage | Archive the rights-db named volume to ~/backups/rights-db.tar.gz with a throwaway container and restore it into a new volume rights-db-restore so a second database container reports the same title count. |
| `ctr-bind-permission-denied` | Let the non-root thumbnailer write to its bind mount | fix | medium | 15 | B | proposed | ex188-aligned:troubleshoot, docker-practitioner:storage | The thumbnailer runs as UID 10001 and fails with permission denied on the host directory mounted at /var/cache/thumbs; fix ownership on the host side so it writes thumbnails without running as root. |
| `ctr-image-mount-models` | Mount the caption OCR model pack from an image | do | medium | 15 | B | proposed | docker-practitioner:storage | Ship the caption OCR model pack as its own image and mount it read-only into the OCR worker with an image mount, so a model update is a new image tag and the worker image no longer carries the 2 GB pack. |
| `ctr-selinux-relabel` | Clear an SELinux denial on a Podman bind mount | fix | medium | 15 | C | proposed | ex188-aligned:troubleshoot, ex188-aligned:build-images | On the SELinux-enforcing podman host, the subtitle container cannot read /srv/captions; relabel the mount correctly (not by disabling SELinux) so the container reads the files and enforcing mode stays on. |
| `ctr-storage-backend-tour` | Find where the engine really keeps image layers | learn | medium | 15 | C | proposed | dca-legacy:storage, docker-practitioner:storage | On a freshly installed Engine 29 host, determine whether images live in the containerd image store or overlay2, and write the storage driver and the path holding the transcoder's top layer to ~/storage-report.txt. |
| `ctr-containerd-store-migration` | Move an upgraded host onto the containerd image store | do | hard | 25 | C | proposed | docker-practitioner:storage | The batch host was upgraded from Engine 27 and still stores images in overlay2; switch it to the containerd image store, re-pull the release images by digest and show that multi-platform indexes and attestations now survive a pull. |
| `ctr-local-registry-tls` | Run Copperleaf's private registry with TLS and passwords | do | medium | 20 | B | proposed | dca-legacy:images-registry, ex188-aligned:manage-images, docker-practitioner:registry | Run a registry on port 5443 with the provided certificate and an htpasswd user ci-push, push catalogue-api:2.3 to it, and make sure anonymous pulls are refused. |
| `ctr-offline-mirror` | Fix CI pulls by routing them through the platform mirror | fix | medium | 20 | C | proposed | docker-practitioner:registry, docker-practitioner:operations | Builds on the CI host fail because Hub and ghcr pulls cannot leave the network; configure the engine's Hub mirror and rewrite the ghcr references in the build files to the Copperleaf mirror host so the pipeline build succeeds. |
| `ctr-skopeo-copy-airgap` | Ship the playout image set to the air-gapped studio registry | do | medium | 15 | B | proposed | ex188-aligned:manage-images, docker-practitioner:registry | Copy the four playout images from the build registry to the isolated studio registry (reachable only through an archive on the transfer share) so every image arrives with its original digest. |
| `ctr-oci-artifacts-referrers` | Attach a caption bundle to an image as an OCI referrer | do | hard | 20 | B | proposed | docker-practitioner:registry | Push the caption style bundle as an OCI artifact that refers to catalogue-api's digest, then list that digest's referrers through the registry API and save the response to ~/referrers.json. |
| `ctr-registry-gc` | Reclaim registry storage without losing production digests | do | medium | 15 | B | proposed | docker-practitioner:registry | The private registry's disk is nearly full of nightly builds; delete every nightly-* manifest and run garbage collection so usage drops by at least half while all digests listed in prod-digests.txt still pull. |
| `ctr-cap-drop-readonly` | Run ad insertion with minimal privileges | do | medium | 15 | B | proposed | dca-legacy:security, cks:microservice-vulnerabilities, docker-practitioner:security | Restart the ad-insertion container with all capabilities dropped except binding port 80, no privilege escalation, a read-only root filesystem and a tmpfs /tmp, while it still serves bookings. |
| `ctr-socket-escape` | Escape through a mounted engine socket, then close the hole | hack | hard | 25 | B | proposed | dca-legacy:security, docker-practitioner:security | A monitoring dashboard container mounts the engine socket; use it to read /root/flag.txt on the host, then redeploy the dashboard behind a socket proxy that only allows listing containers so the escape no longer works. |
| `ctr-remote-engine-ssh` | Retire the batch host's unauthenticated engine port | do | medium | 20 | C | proposed | docker-practitioner:security, dca-legacy:security | The batch host's engine listens on TCP 2375 without TLS so operators can manage it remotely; close the port and give the operators a docker context that reaches the engine over SSH as the restricted user ops. |
| `ctr-rootless-engine` | Run the encoder team's engine rootless | do | hard | 25 | C | proposed | dca-legacy:security, docker-practitioner:security | Set up a rootless engine for the encoder user so that user runs the preview service on port 8080 while no root-owned daemon serves their containers. |
| `ctr-seccomp-profile` | Confine the caption OCR worker with a custom seccomp profile | do | hard | 20 | C | proposed | cks:system-hardening, docker-practitioner:security | Apply a custom seccomp profile to the OCR worker that blocks mount, ptrace and keyctl, and prove the worker still processes a test page while a ptrace attempt inside it fails. |
| `ctr-cis-bench` | Fix the failing CIS benchmark checks on the transcoder host | do | hard | 30 | C | proposed | dca-legacy:security, docker-practitioner:security | Run the CIS Docker benchmark tool on the transcoder host and fix the five failures listed in the audit ticket (daemon and container settings) so a rerun reports them as passed. |
| `ctr-scan-triage-vex` | Triage scanner findings for the catalogue API | do | medium | 20 | B | proposed | cks:supply-chain-security, docker-practitioner:supply-chain | Scan catalogue-api with the offline vulnerability database, remove every fixable critical finding by bumping the base, and record the one non-exploitable finding as not_affected in a VEX document the rescan honours. |
| `ctr-scout-policy` | Bring the catalogue image back within supply-chain policy | do | medium | 20 | B | proposed | docker-practitioner:supply-chain | The catalogue image fails Copperleaf's policies for fixable high CVEs, missing provenance and a root default user; evaluate it with Docker Scout against the mirrored advisory data, fix all three and show the rebuilt image passes every policy. |
| `ctr-sbom-provenance` | Publish the subtitle image with SBOM and provenance attestations | do | medium | 15 | B | proposed | cks:supply-chain-security, docker-practitioner:supply-chain | Build and push subtitle:4.2.0 with an SBOM and maximum-detail provenance attached, so the registry holds both attestations for that image digest. |
| `ctr-cosign-sign-verify` | Sign the catalogue release by digest | do | hard | 20 | B | proposed | cks:supply-chain-security, docker-practitioner:supply-chain | Sign catalogue-api's release digest with Copperleaf's release key using cosign so verification with the public key succeeds and the signature is discoverable as a referrer of that digest. |
| `ctr-notation-sign-verify` | Sign the subtitle release with Notation and a trust policy | do | hard | 20 | B | proposed | docker-practitioner:supply-chain | Sign the subtitle release digest with Notation using the Copperleaf test CA, write a trust policy that trusts only that CA for the media repositories, and show verification passes for the release and fails for an image signed by another key. |
| `ctr-signed-only-gate` | Build, attest, sign and prove unsigned images are refused | do | hard | 30 | B | proposed | cks:supply-chain-security, docker-practitioner:supply-chain | Take the ad-insertion service through build with SBOM, push, sign with Notation and deploy through the release gate, then show that an unsigned rebuild of the same tag is rejected by the gate. |
| `ctr-leaked-secret-history` | Purge a leaked storage key from published image history | hack | medium | 20 | B | proposed | cks:supply-chain-security, docker-practitioner:supply-chain, docker-practitioner:registry | An object-storage key was baked into an early layer of transcoder:7.1; find it, mark it revoked in the mock key service, publish a rebuilt image without it and delete the leaked manifest from the registry. |
| `ctr-hardened-base-migration` | Move the subtitle service onto a hardened distroless base | do | medium | 20 | B | proposed | cks:supply-chain-security, docker-practitioner:supply-chain, docker-practitioner:build | Rebase the subtitle service onto the mirrored hardened Python runtime image using its dev variant for the build stage, verify the base's signed SBOM, and keep the service passing its smoke test. |
| `ctr-dhi-vex-reconcile` | Explain the findings a hardened base still reports | do | medium | 20 | B | proposed | docker-practitioner:supply-chain | The thumbnailer now runs on a mirrored hardened runtime image yet the scanner still lists CVEs; reconcile each finding with the base image's VEX attestation and make the release gate fail only on findings the VEX does not cover. |
| `ctr-content-trust-retired` | Replace a retired content-trust pull with signature verification | learn | easy | 10 | B | proposed | dca-legacy:security, docker-practitioner:supply-chain | A legacy deploy script sets DOCKER_CONTENT_TRUST=1 and now fails every pull; remove it and add a cosign verification step against Copperleaf's public key so the script deploys only verified digests. |
| `ctr-oom-exit-137` | Explain and stop the transcoder's exit 137 | fix | medium | 15 | B | proposed | ex188-aligned:troubleshoot, docker-practitioner:operations, docker-practitioner:security | The transcoder container keeps dying with exit code 137; prove from inspect state whether it was OOM-killed, then set a 1 GiB memory limit and WORKERS=2 so a test job completes. |
| `ctr-nofile-after-upgrade` | Fix edge-cache 'too many open files' after an engine upgrade | fix | medium | 15 | B | proposed | docker-practitioner:operations | Since the engine upgrade lowered the default open-files limit, the edge-cache container fails under load; give it a nofile limit of 65536 so the grader's 5,000-connection test passes. |
| `ctr-link-env-removed` | Repair a legacy stack that relied on link environment variables | fix | medium | 15 | B | proposed | docker-practitioner:networking, docker-practitioner:operations | The old rights-report job reads DB_PORT_5432_TCP_ADDR, which the engine no longer injects for links; rewire it to resolve the database by name on a user-defined network so the nightly report runs. |
| `ctr-seccomp-legacy-binary` | Restore a legacy 32-bit caption encoder without going unconfined | fix | hard | 20 | B | proposed | docker-practitioner:security, docker-practitioner:operations | A tightened default seccomp profile now kills the 32-bit caption encoder; ship a profile derived from the default that allows only the syscalls it needs, so it runs while seccomp stays enabled. |
| `ctr-api-version-floor` | Fix the CI deploy client the upgraded engine refuses | fix | medium | 15 | B | proposed | docker-practitioner:operations | After the build host moved to Engine 29 the pinned CI deploy tool fails with a client API version too old error; find which API versions the engine accepts and move the client to a supported one so the deploy job passes without lowering the engine's minimum. |
| `ctr-events-flapping` | Find the flapping container from the engine's event stream | fix | medium | 15 | B | proposed | docker-practitioner:operations | One of forty containers on the batch host restarts every few minutes and the dashboards miss it; use the engine event stream and stats to record the flapping container, its exit reason and its peak memory in ~/flapping.json. |
| `ctr-log-rotation` | Cap container logs that filled the batch host | do | easy | 12 | C | proposed | dca-legacy:install-config, docker-practitioner:operations | The chatty ingest container's JSON logs filled the disk; recreate it with logs rotated at 20 MB keeping 5 files, and set the same default for new containers on the host. |
| `ctr-restart-policy` | Keep the subtitle worker running but respect manual stops | do | easy | 10 | B | proposed | ex188-aligned:run-containers, docker-practitioner:operations | Configure the subtitle worker to restart automatically after crashes and engine restarts but stay down after an operator stops it, as verified by the grader crashing, restarting and stopping it. |
| `ctr-daemon-json-conflict` | Bring a dead engine back after a daemon.json change | fix | medium | 20 | C | proposed | dca-legacy:install-config, docker-practitioner:operations | The engine on the packaging host no longer starts after someone added a hosts entry to daemon.json that conflicts with the service's -H flag; resolve it with a systemd drop-in so the engine starts and listens on the socket and on tcp://127.0.0.1:2375. |
| `ctr-debug-distroless` | Debug a shell-less catalogue API returning 500 | fix | medium | 15 | B | proposed | ex188-aligned:troubleshoot, docker-practitioner:operations | The distroless catalogue API returns 500 for every request; attach a debug container sharing its process and network namespaces, find the missing config file it expects, and fix the deployment so /titles returns 200. |
| `ctr-ci-rootless-buildkit` | Replace the privileged CI builder with rootless BuildKit | do | hard | 25 | B | proposed | cks:supply-chain-security, docker-practitioner:operations | Copperleaf's CI job builds with a privileged dind sidecar; switch it to a rootless BuildKit builder that builds, scans, signs and pushes the thumbnailer, with the privileged sidecar removed. |
| `ctr-release-pipeline-capstone` | Ship a catalogue release from commit to running service | do | hard | 45 | B | proposed | docker-practitioner:supply-chain, docker-practitioner:build | Take catalogue-api 5.0.0 from commit to staging: multi-platform build with registry cache, SBOM and provenance, a signature, a push by digest, a Compose deployment pinned to that digest, and a gate that refuses the unsigned previous build. |
| `ctr-engine-upgrade` | Upgrade the transcoder host engine with running jobs | do | hard | 30 | C | proposed | dca-legacy:install-config, docker-practitioner:operations | Upgrade the transcoder host from Engine 28 to 29 from the local package mirror with live-restore enabled, so the long-running transcode container keeps running through the upgrade and the engine reports version 29. |
| `ctr-runtime-stack-trace` | Trace the transcoder container down to its runc process | learn | medium | 15 | C | proposed |  | Map the running transcoder container from its engine ID to its containerd task in the moby namespace, its shim and its host PID, and write the four identifiers to ~/runtime-chain.txt. |
| `ctr-runc-bundle` | Run the subtitle service from a hand-made OCI bundle | do | hard | 25 | B | proposed |  | Export the subtitle image's filesystem into an OCI bundle, generate and edit config.json for a read-only root and hostname caption-box, and run it with runc so the grader sees it in runc list. |
| `ctr-image-layout-on-disk` | Find the layer that deleted Copperleaf's signing keys | do | hard | 20 | B | proposed |  | Unpack transcoder:7.1 as an OCI image layout, walk index, manifest and config, and record the digest of the layer whose whiteout removes /etc/copperleaf/keys in ~/whiteout-layer.txt. |
| `ctr-podman-docker-differences` | Move a Docker routine to Podman and note what changes | learn | easy | 20 | C | proposed | ex188-aligned:manage-images | Move the catalogue API's run, build and push routine from the Docker host to the Podman host: make short names resolve through Copperleaf's registry, serve Docker-compatible clients through the Podman socket, and record in ~/differences.yaml the three behaviours that changed. |
| `ctr-podman-rootless-basics` | Run the catalogue API rootless with Podman | learn | easy | 15 | C | proposed | ex188-aligned:run-containers | As the unprivileged user media, run the catalogue API with rootless Podman on port 8080 and record which host UID container root maps to in ~/uid-map.txt. |
| `ctr-podman-pod-kube-play` | Run the catalogue pod and replay it from Kubernetes YAML | do | medium | 25 | C | proposed | ex188-aligned:multi-container | Create pod catalogue on port 8080 with the API and Redis sharing localhost and the database password supplied as a Podman secret, then generate Kubernetes YAML from it, tear it down and recreate it with podman kube play so it serves again. |
| `ctr-quadlet-reboot` | Keep the subtitle service running across reboots with Quadlet | do | hard | 25 | C | proposed | ex188-aligned:run-containers | Define the subtitle service as a rootless Quadlet unit for user media with lingering enabled, so after the grader reboots the VM it is running and answering on port 8090. |
| `ctr-swarm-init-quorum` | Build a three-manager swarm and drain one manager | do | medium | 25 | C | proposed | dca-legacy:orchestration | Initialise a swarm across the three playout VMs with all three as managers, then drain playout-2 for maintenance so the swarm keeps quorum and runs no tasks on it. |
| `ctr-swarm-services` | Place catalogue replicas and a global log agent on the swarm | do | medium | 20 | C | proposed | dca-legacy:orchestration | Run catalogue-api as four replicas only on nodes labelled tier=edge and the log shipper as a global service, then roll catalogue-api to 2.4 one task at a time without dropping below three running replicas. |
| `ctr-swarm-stack` | Deploy the ad-insertion stack with an overlay network and secrets | do | hard | 25 | C | proposed | dca-legacy:orchestration | Deploy the ad-insertion stack from its Compose file onto the swarm with an encrypted overlay network, its partner key as a swarm secret and its rules file as a config, reachable through the routing mesh on port 8088. |

## Infrastructure as code with Terraform

Terraform 1.15 is the primary CLI throughout. Learners provision real Kubernetes objects in a per-learner vcluster, AWS-shaped resources on Moto and vSphere inventory on vcsim, fully offline, graded on target truth, state and plan convergence. Recent Terraform features (ephemeral values, write-only arguments, S3 native locking, terraform test, terraform query and actions) are hands-on where the offline runtime allows; HCP Terraform and Stacks are concept-only. OpenTofu is a short optional track.

Fictional organisation: **Saltmarsh Energy** (A fictional renewables operator running offshore and inland wind farms, a grid-telemetry platform and an energy trading desk.).

Terraform-first since revision 2 (2026-10-14). Shared-core labs stay CLI-agnostic where it is cheap (same HCL, state format, providers and grading through show -json and target truth), so OpenTofu can be swapped in as the default binary if the licensing position requires it. Terraform-only labs say so in their notes (terraform query, actions, Stacks and hosted-platform concepts).

**Licensing.** Terraform 1.6 and later is source-available under BUSL-1.1 with IBM as licensor. Internal training of AzarGuard staff is production use that the Additional Use Grant allows. Offering Terraform as a hosted lab to external paying customers may count as a competitive offering, so it needs written confirmation from IBM/HashiCorp (licensing@hashicorp.com) before launch; until then external tenants get the OpenTofu binary. Providers are MPL-2.0 and are mirrored with their licence notices. Content stays CLI-agnostic where cheap so OpenTofu can be swapped in. Not legal advice.

Competencies: `iac.foundations` (new), `iac.language` (new), `iac.targets` (new), `iac.state` (new), `iac.modules` (new), `iac.quality` (new), `iac.collaboration` (new), `iac.operations` (new), `iac.opentofu` (new).

### Paths (5)

| Path | Title | Level | Hours | Labs | Prerequisites | Aligns to | Audience |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `iac-foundations` | Infrastructure as code foundations | beginner | 16 | 23 | - | tf-associate | Engineers new to IaC who know the Linux shell |
| `iac-practitioner` | Infrastructure as code practitioner | intermediate | 20 | 19 | `iac-foundations` | tf-professional | Engineers who run IaC in teams and pipelines |
| `iac-advanced-scenarios` | Advanced IaC scenarios in lab-exam format | advanced | 13 | 13 | `iac-practitioner` | tf-advanced | Practitioners preparing for a hands-on authoring and operations exam |
| `opentofu-differences` | OpenTofu differences (optional) | intermediate | 4 | 5 | `iac-foundations` | opentofu | Teams that run OpenTofu next to Terraform or may need to swap the binary |
| `iac-platform-scale` | IaC platform operations at scale | advanced | 10 | 11 | `iac-practitioner` | tf-professional | Platform teams owning many stacks |

<details><summary><b>Infrastructure as code foundations</b>: modules</summary>

- **Core workflow and providers**: `iac-first-plan-apply`, `iac-provider-lock-offline`, `iac-fmt-validate-repair`
- **Language essentials**: `iac-resources-and-data-sources`, `iac-variables-tfvars-precedence`, `iac-for-expressions-functions`, `iac-count-to-for-each`, `iac-dynamic-blocks-netpol`, `iac-lifecycle-rules`, `iac-depends-on-ordering`
- **State and backends**: `iac-state-inspection-report`, `iac-s3-backend-lockfile`, `iac-moved-removed-refactor`, `iac-import-blocks-generate`, `iac-drift-refresh-only`, `iac-workspaces-vs-dirs`
- **Modules**: `iac-first-module`, `iac-module-sources-versions`
- **Conditions, secrets and hosted concepts**: `iac-custom-conditions`, `iac-secrets-out-of-state`, `iac-ephemeral-resources`, `iac-write-only-rotation`, `iac-hosted-platform-concepts`

_CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and Terraform Associate are trademarks of HashiCorp. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Infrastructure as code practitioner</b>: modules</summary>

- **Real targets**: `iac-helm-release-values`, `iac-provider-aliases-two-clusters`, `iac-moto-vpc-subnets`, `iac-vcsim-inventory`, `iac-remote-state-sharing`
- **Module contracts, tests and policy**: `iac-module-provider-passing`, `iac-module-tests-mocks`, `iac-opa-plan-policy`
- **Pipelines and credentials**: `iac-saved-plan-pipeline`, `iac-dynamic-credentials`, `iac-scheduled-drift-check`, `iac-risky-change-review`
- **Upgrades and troubleshooting**: `iac-provider-upgrade-campaign`, `iac-core-version-upgrade`, `iac-provider-auth-logs`, `iac-incident-unsatisfiable-constraint`
- **Query, actions and Stacks (Terraform 1.14+)**: `iac-query-bulk-import`, `iac-provider-actions`, `iac-stacks-concepts`

_CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and the Terraform professional certification names are trademarks of HashiCorp. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Advanced IaC scenarios in lab-exam format</b>: modules</summary>

- **Import and drift**: `iac-import-blocks-generate`, `iac-query-bulk-import`, `iac-incident-out-of-band-drift`, `iac-drift-refresh-only`
- **Refactoring into modules**: `iac-split-monolith-modules`, `iac-module-sources-versions`, `iac-module-provider-passing`
- **Providers**: `iac-provider-aliases-two-clusters`, `iac-provider-upgrade-campaign`, `iac-provider-auth-logs`
- **Cross-stack data**: `iac-remote-state-sharing`, `iac-dynamic-blocks-netpol`, `iac-moto-vpc-subnets`

_CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and the Terraform Authoring and Operations certification names are trademarks of HashiCorp. This path covers objectives aligned to that exam; completing it confers no certification. Labs target Moto and Kubernetes, not AWS; the simulator matches skills and grading style, not AWS behaviour._

</details>

<details><summary><b>OpenTofu differences (optional)</b>: modules</summary>

- **Differences in practice**: `tofu-cli-differences`, `tofu-early-evaluation-backend`
- **State and plan encryption**: `tofu-state-encryption-pbkdf2`
- **OCI distribution and migration**: `tofu-oci-module-distribution`, `tofu-migrate-from-terraform`

_CloudTrain is not affiliated with or endorsed by the Linux Foundation. OpenTofu is a trademark of The Linux Foundation. This is a CloudTrain badge path; no vendor certification exists and completing it confers none._

Optional short track on the OpenTofu binary installed alongside Terraform: what differs (provider for_each, enabled, -exclude), state encryption, early evaluation, OCI distribution and migration.

</details>

<details><summary><b>IaC platform operations at scale</b>: modules</summary>

- **Structure and state at scale**: `iac-workspaces-vs-dirs`, `iac-split-large-state`, `iac-opa-plan-policy`
- **Incident drills**: `iac-incident-dependency-cycle`, `iac-incident-stale-lock`, `iac-incident-out-of-band-drift`, `iac-incident-unsatisfiable-constraint`, `iac-incident-rename-destroy`, `iac-state-recovery-versions`
- **Upgrade campaigns**: `iac-provider-upgrade-campaign`, `iac-core-version-upgrade`

_CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform is a trademark of HashiCorp. This path covers objectives aligned to the professional exam; completing it confers no certification._

</details>

### Labs (54)

| Lab | Title | Type | Difficulty | Min | Tier | Status | Frameworks | Scenario |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `iac-first-plan-apply` | Plan, apply and destroy a first configuration | learn | easy | 15 | A | verified | tf-associate:iac-concepts, tf-associate:core-workflow | Saltmarsh's survey team needs a turbine inventory file for the Gullhaven farm; write a local-provider config that creates /srv/survey/gullhaven.txt, apply it, prove a second apply changes nothing, then destroy it. |
| `iac-provider-lock-offline` | Pin provider versions and commit a lock file offline | do | easy | 15 | A | verified | tf-associate:fundamentals | The grid-telemetry repo floats on any provider version; constrain kubernetes and random to the approved minor releases, init against the offline mirror and commit a lock file carrying hashes for linux_amd64 and linux_arm64. |
| `iac-fmt-validate-repair` | Repair a configuration that fails format and validation gates | fix | easy | 10 | A | verified | tf-associate:core-workflow | The wind-farm repo's CI rejects every merge; fix the syntax errors and formatting so fmt -check and validate pass without changing the planned resources. |
| `iac-variables-tfvars-precedence` | Type, validate and layer input variables | do | easy | 20 | A | verified | tf-associate:configuration, tf-professional:variables-precedence | Saltmarsh deploys one telemetry config to three farms; declare typed variables with validation, layer defaults, farm.auto.tfvars and -var overrides, and write the effective turbine_count for each farm to a report file. |
| `iac-for-expressions-functions` | Turn a turbine CSV into a keyed map with for expressions | do | medium | 20 | A | verified | tf-associate:configuration, tf-professional:tracing-expressions | The asset register arrives as turbines.csv; decode it, build a map keyed by turbine id with a for expression, output the total nameplate megawatts per farm and create one local file per offshore turbine. |
| `iac-resources-and-data-sources` | Read existing objects with data sources | learn | easy | 15 | V | verified | tf-associate:configuration | The platform team pre-created namespace grid-telemetry with cost labels; read it with a data source and create a ConfigMap in it whose data copies those labels, so the plan shows the implicit dependency. |
| `iac-count-to-for-each` | Move substations from count to for_each without recreating them | do | medium | 20 | V | verified | tf-associate:configuration, tf-associate:state | Removing one substation from a count list would recreate the others' namespaces; switch to for_each keyed by substation name and add moved blocks so the plan shows zero destroys. |
| `iac-dynamic-blocks-netpol` | Generate NetworkPolicy rules with dynamic blocks | do | medium | 20 | V | verified | tf-associate:configuration, tf-advanced:dynamic-config | Grid telemetry must accept traffic only on the ports listed in a variable; generate the NetworkPolicy ingress port entries with a dynamic block so adding a port to the list is the only change needed. |
| `iac-lifecycle-rules` | Protect and roll trading-desk resources with lifecycle rules | do | medium | 20 | V | verified | tf-associate:configuration | Protect the trading-desk namespace with prevent_destroy, ignore the annotations an operator writes, roll the pricing ConfigMap with create_before_destroy and replace the pricing Deployment whenever the ConfigMap changes. |
| `iac-depends-on-ordering` | Fix an apply that races a Helm release against its prerequisites | fix | medium | 15 | V | verified | tf-associate:configuration | A fresh apply of the telemetry collector fails because the Helm release starts before its credentials Secret exists; fix the ordering with references or depends_on so a clean apply from empty state succeeds. |
| `iac-provider-aliases-two-clusters` | Deploy to two clusters with aliased providers | do | medium | 20 | V | proposed | tf-associate:configuration, tf-advanced:providers | Saltmarsh runs a north-sea and an inland cluster; configure two aliased kubernetes providers and deploy the same farm-status ConfigMap into namespace operations on both. |
| `iac-helm-release-values` | Release a dashboard chart with templated values | do | medium | 25 | V | proposed | tf-associate:configuration | Install the scada-dashboard chart from the offline chart repository as release farm-dash with values rendered by templatefile from a per-farm variable map, and prove the release reaches deployed status. |
| `iac-moto-vpc-subnets` | Carve a VPC into zone subnets with cidrsubnet | do | medium | 25 | A | proposed | tf-associate:configuration, tf-advanced:dynamic-config | The trading desk needs VPC 10.40.0.0/16 on the AWS-shaped endpoint with one /20 private subnet per availability zone in a list, each tagged with its zone, computed with cidrsubnet rather than hard-coded. |
| `iac-vcsim-inventory` | Build vSphere folders and resource pools per wind farm | do | medium | 20 | A | proposed | tf-associate:configuration | On the simulated vCenter, look up datacenter dc-saltmarsh with data sources and create one VM folder and one resource pool with the given CPU shares for each wind farm in a variable. |
| `iac-s3-backend-lockfile` | Move local state to an S3 backend with lockfile locking | do | medium | 20 | A | verified | tf-associate:state | Migrate the telemetry stack's local state to bucket saltmarsh-state with use_lockfile enabled, delete the local copy, and show that a second concurrent apply waits on the .tflock object. |
| `iac-state-inspection-report` | Answer audit questions from state and plan JSON | do | easy | 15 | V | verified | tf-associate:state | Audit asks which resources the inland stack manages and which Secret keys it holds; answer five questions into audit.json using state list, state show and show -json with jq, without touching the state. |
| `iac-remote-state-sharing` | Consume network outputs from another stack's state | do | medium | 20 | A | proposed | tf-associate:state, tf-advanced:collaboration | The trading app stack hard-codes subnet ids; publish them as outputs from the network stack and read them through a remote state data source so both stacks converge with no changes. |
| `iac-import-blocks-generate` | Adopt hand-made namespaces with import blocks | do | medium | 25 | V | verified | tf-associate:maintain, tf-advanced:lifecycle-import-drift | Three farm namespaces were created by hand during an outage; adopt them with import blocks and generated configuration so the plan afterwards reports no changes and no namespace is recreated. |
| `iac-query-bulk-import` | Find and adopt every unmanaged trading resource with a query | do | hard | 30 | A | proposed | tf-advanced:lifecycle-import-drift, tf-associate:maintain | Dozens of trading-desk resources on the AWS-shaped endpoint were created outside code; declare list resources in a .tfquery.hcl file, run terraform query to find those tagged team=trading, generate their import configuration and adopt them so the plan shows only imports. |
| `iac-moved-removed-refactor` | Rename resources and release one from management | do | medium | 20 | V | verified | tf-associate:state, tf-advanced:modules | Rename the telemetry resources to the new naming standard with moved blocks and hand the legacy-archive namespace to another team with a removed block, ending with zero destroys and the namespace still present. |
| `iac-drift-refresh-only` | Reconcile hand edits found by a refresh-only plan | fix | medium | 20 | V | verified | tf-associate:maintain, tf-advanced:lifecycle-import-drift | An engineer scaled the forecast Deployment and relabelled its Service by hand; detect both with a refresh-only plan, accept the replica change into config, revert the label and force-replace the corrupted forecast Secret with -replace. |
| `iac-workspaces-vs-dirs` | Run staging and production from workspaces, then directories | do | medium | 25 | A | verified | tf-associate:state | Size the forecast service by terraform.workspace for staging and prod workspaces, then move prod to its own directory with its own backend key, keeping both states converged. |
| `iac-first-module` | Extract a reusable farm module | do | easy | 20 | V | verified | tf-associate:modules | Extract the namespace, quota and ConfigMap each wind farm gets into module farm-base with typed inputs and outputs, call it for three farms and move existing resources into it without recreation. |
| `iac-module-sources-versions` | Consume and upgrade a versioned git module | do | medium | 20 | A | verified | tf-associate:modules | Point the inland stack at the farm-base module in the internal Git server pinned to tag v1.2.0, then upgrade to v1.3.0 and adapt to its renamed input so the plan shows only the intended change. |
| `iac-split-monolith-modules` | Split a flat configuration into modules with no destroys | do | hard | 40 | V | proposed | tf-advanced:modules, tf-associate:modules | The 30-resource grid-telemetry root module is unmaintainable; split it into network, storage and workload modules with moved blocks so the final plan is empty and every object keeps its UID. |
| `iac-module-provider-passing` | Pass aliased providers into a module | do | medium | 20 | V | proposed | tf-associate:modules, tf-advanced:providers | Module farm-base must deploy to the north-sea and inland clusters; pass the aliased providers through a providers map so one call per cluster creates the farm objects in the right place. |
| `iac-custom-conditions` | Guard a stack with validations, conditions and checks | do | medium | 20 | V | verified | tf-associate:custom-conditions | Reject turbine capacities outside 0.5-15 MW, refuse to plan when the target namespace lacks a cost-centre label, assert the published Service is ClusterIP and warn through a check block when the telemetry endpoint is down. |
| `iac-module-tests-mocks` | Test a module with plan and apply runs and mocks | do | medium | 30 | A | proposed | tf-professional:module-contracts-testing | Write farm-base.tftest.hcl with a mocked kubernetes provider for plan runs and one real apply run, covering the quota maths and the rejected-input case, so terraform test passes and fails on a seeded bug. |
| `iac-secrets-out-of-state` | Find a leaked token in state and keep it out | hack | medium | 25 | V | verified | tf-associate:secrets, tf-professional:credentials-secrets | A grid-operator API token sits in plain text in the trading stack's state; prove it, rotate it, then pass the new one through an ephemeral variable and a write-only argument so state contains no secret. |
| `iac-ephemeral-resources` | Hand the forecast stack its cluster token without storing it | do | medium | 25 | V | verified | tf-associate:secrets, tf-professional:credentials-secrets | The forecast stack reads its cluster deploy token from the AWS-shaped secrets store through a data source, so the token sits in state and in every saved plan; read it with an ephemeral resource instead, pass it to the kubernetes provider through an ephemeral module output, and prove neither state nor the saved plan holds it while apply still works. |
| `iac-write-only-rotation` | Rotate a password held in a write-only argument | do | medium | 20 | V | verified | tf-associate:secrets, tf-professional:credentials-secrets | The telemetry database password is set through a write-only argument; rotate it by bumping its version attribute, show that changing the value alone plans no change, and confirm the AWS-shaped secret holds the new password while state holds none. |
| `iac-opa-plan-policy` | Block non-compliant plans with policy on plan JSON | do | hard | 30 | A | proposed | tf-professional:policy-ci | Write Conftest policies that fail any plan creating a public bucket or a resource without a cost-centre tag, and wire them into the plan script so the seeded non-compliant change is refused. |
| `iac-saved-plan-pipeline` | Gate applies on an approved saved plan | do | medium | 30 | A | proposed | tf-professional:policy-ci | Change the trading stack's pipeline script so it stores plan -out artifacts, applies only a plan with a matching approval file and refuses a stale plan after state has moved on. |
| `iac-dynamic-credentials` | Swap a static cluster token for short-lived credentials | do | hard | 30 | V | proposed | tf-professional:credentials-secrets | The telemetry stack authenticates with a never-expiring token; switch the kubernetes provider to a short-lived ServiceAccount token requested per run and revoke the old token without breaking apply. |
| `iac-scheduled-drift-check` | Schedule a nightly drift check | do | medium | 20 | B | proposed | tf-professional:operations | Run plan -detailed-exitcode for the inland stack every night from a systemd timer and write clean, drifted or error to /var/lib/drift/inland.status based on the exit code. |
| `iac-risky-change-review` | Flag the dangerous changes in four saved plans | do | medium | 15 | A | proposed | tf-professional:risky-changes | Review four plan JSON files from pending merge requests and list in review.json every change that destroys or replaces a stateful resource, with its address and action. |
| `iac-hosted-platform-concepts` | Design a hosted-platform workspace layout | learn | easy | 15 | A | verified | tf-associate:hcp | Map Saltmarsh's three teams and two environments onto hosted organisations, projects, workspaces and variable sets in layout.yaml, which the grader checks against the stated access and isolation rules. |
| `iac-stacks-concepts` | Sketch a Stacks layout for the multi-region telemetry estate | learn | easy | 15 | A | proposed | tf-professional:operations | Saltmarsh repeats the same telemetry root modules for six regions and two environments; map them onto Stacks components and deployments in stack-design.yaml and list the orchestration rules that replace the hand-run apply order, graded against the stated dependencies. |
| `iac-provider-upgrade-campaign` | Upgrade a provider major version across four stacks | do | hard | 35 | A | proposed | tf-professional:upgrades, tf-advanced:providers | Move four Saltmarsh root modules to the next kubernetes provider major release, fix the deprecated attributes it reports and refresh each lock file so all four plans are empty. |
| `iac-core-version-upgrade` | Upgrade the trading stacks to the current core release | do | hard | 35 | A | proposed | tf-professional:upgrades | Move four trading-desk root modules from Terraform 1.9 to 1.15: raise required_version, replace the deprecated DynamoDB state locking with S3 lockfiles, clear the new deprecation warnings and finish with empty plans and refreshed lock files. |
| `iac-provider-auth-logs` | Trace a provider authentication failure with debug logs | fix | medium | 20 | V | proposed | tf-associate:maintain, tf-advanced:providers | The inland stack fails with an opaque provider error; capture TF_LOG output to a file, find the wrong CA bundle path and fix the provider configuration so plan succeeds. |
| `iac-incident-dependency-cycle` | Break a dependency cycle introduced by a refactor | fix | medium | 20 | V | proposed | tf-professional:operations | After a refactor the forecast stack fails with a cycle between a Service, a ConfigMap and a depends_on; find the loop with the graph output and break it so a clean apply succeeds. |
| `iac-incident-stale-lock` | Release a stale state lock left by a crashed job | fix | medium | 15 | A | proposed | tf-associate:state | A crashed CI job left a .tflock on the trading stack; confirm the holder is gone, release exactly that lock id with force-unlock and complete the pending apply. |
| `iac-incident-out-of-band-drift` | Reconcile security group rules edited outside code | fix | hard | 30 | A | proposed | tf-advanced:lifecycle-import-drift | During an outage three rules were added by hand to the trading desk's security group; import the one approved by change control, remove the other two, and finish with a converged plan. |
| `iac-incident-unsatisfiable-constraint` | Resolve conflicting provider version constraints | fix | medium | 20 | A | proposed | tf-professional:upgrades | init fails because two modules require incompatible random provider ranges; upgrade the outdated module tag so one provider version satisfies both and the lock file records it. |
| `iac-incident-rename-destroy` | Stop a rename from destroying a database volume | fix | medium | 15 | V | proposed | tf-associate:state | A merge request renames the trading database's PersistentVolumeClaim resource and the plan wants to destroy it; add the moved block so the plan shows a move and the claim keeps its data. |
| `iac-state-recovery-versions` | Recover a state file overwritten by a bad push | fix | hard | 30 | A | proposed | tf-professional:operations | A state push replaced the inland stack's state with an older serial; restore the correct version from the bucket's object versions and prove the plan converges without recreating anything. |
| `iac-split-large-state` | Split a large state into network and workload stacks | do | hard | 40 | A | proposed | tf-professional:operations | The grid-telemetry state holds 200 resources and every plan takes minutes; split it into network and workload stacks with removed and import blocks so both converge and no object is recreated. |
| `iac-provider-actions` | Stop the test fleet with a provider action after each change | do | medium | 25 | A | proposed | tf-professional:operations | After every change to the trading test fleet its instances must be stopped to save cost; declare a provider action, trigger it from the fleet's lifecycle after update, invoke it once from the CLI for the stragglers, and show every instance stopped on the AWS-shaped endpoint. |
| `tofu-cli-differences` | Run one estate under both CLIs and catalogue the differences | learn | easy | 25 | V | proposed | opentofu:provider-iteration, opentofu:enabled-exclude | Run the inland stack under OpenTofu on a copy of its state, then use what Terraform lacks: replace three provider aliases with one provider for_each, swap a count toggle for enabled, skip the dashboard release with -exclude, and record in differences.yaml what each binary accepts. |
| `tofu-state-encryption-pbkdf2` | Encrypt state and plans, then rotate the key | do | hard | 35 | A | proposed | opentofu:encryption | Enable state and plan encryption for the trading stack with a PBKDF2 key provider, migrate the plaintext state through a fallback block, then rotate to an external key provider and prove the old passphrase no longer decrypts the current state. |
| `tofu-early-evaluation-backend` | Key backends and module versions off variables | do | medium | 20 | A | proposed | opentofu:early-evaluation | Use early evaluation so one farm stack derives its S3 state key and its module version from variables, then init it for two farms and show two separate state objects. |
| `tofu-oci-module-distribution` | Publish modules and mirror providers through OCI | do | hard | 30 | A | proposed | opentofu:oci-distribution | Push farm-base v2.0.0 to the platform registry as an OCI module, switch the inland stack to the oci:// source and configure an oci_mirror for providers with direct installation disabled. |
| `tofu-migrate-from-terraform` | Migrate a Terraform-managed estate to OpenTofu | do | hard | 40 | A | proposed | opentofu:migration | Take over the trading stack last applied with Terraform 1.5.7, migrate state and lock file to OpenTofu without resource changes and prove the first OpenTofu plan is empty. |

## Configuration management and automation

Agentless configuration management with Ansible, from first inventories to roles, collections, execution environments, an AWX controller, network devices and event-driven remediation. Every lab grades the managed systems' end state, then re-runs the learner's playbook and expects zero changes; Enterprise Linux tasks also reboot and re-check. Windows automation is deferred until hosting licences for Windows images are resolved, so it has no labs yet.

Fictional organisation: **Orrin & Vale Insurance** (A fictional insurer with a claims portal, a policy database, a quoting API and twelve branch offices; hosts follow ov-<role><n> (ov-claims-web1, ov-db-2, ov-quote-api1, ov-branch-lon-gw).).

Competencies: `automation.foundations` (new), `automation.inventory` (new), `automation.data` (new), `automation.modules` (new), `automation.control-flow` (new), `automation.content` (new), `automation.reuse` (new), `automation.devworkflow` (new), `automation.advanced` (new), `automation.quality` (new), `automation.extensibility` (new), `automation.controller` (new), `automation.eda` (new), `automation.network` (new).

### Paths (7)

| Path | Title | Level | Hours | Labs | Prerequisites | Aligns to | Audience |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ansible-fundamentals` | Configuration management fundamentals with Ansible | beginner | 10 | 12 | - | ex294-aligned | Administrators and developers who know the Linux shell, SSH and sudo and want repeatable, idempotent changes across a small fleet. |
| `el-automation-engineer` | Automating Enterprise Linux administration with Ansible | intermediate | 30 | 18 | `ansible-fundamentals` | ex294-aligned | Enterprise Linux administrators who want to automate every routine administration task, run content with navigator and work from Git; ends with a reboot-graded timed simulation. |
| `automation-engineering-practices` | Engineering practices for automation content | intermediate | 10 | 5 | `el-automation-engineer` | - | Automation authors who need lint-clean, tested content delivered through a pipeline, and who must keep playbooks working across ansible-core releases. |
| `automation-content-developer` | Advanced automation content development | advanced | 25 | 11 | `el-automation-engineer` | ex374-aligned | Automation developers who build collections, execution environments and dynamic inventories for other teams. |
| `automation-controller-operations` | Operating an automation controller | advanced | 22 | 7 | `automation-content-developer` | ex467-aligned | Platform operators who run a shared automation controller for several teams. |
| `network-automation` | Network automation with Ansible | intermediate | 16 | 6 | `ansible-fundamentals` | ex457-aligned | Network engineers and automation authors who manage routers and switches from playbooks; needs the networking domain's routing basics. |
| `event-driven-automation` | Event-driven and self-healing automation | advanced | 8 | 2 | `automation-controller-operations` | - | Operators who want monitoring alerts and events to trigger safe, scoped remediation automatically. |

<details><summary><b>Configuration management fundamentals with Ansible</b>: modules</summary>

- **Inventory and a reachable fleet**: `ov-first-inventory`, `ov-bootstrap-automation-user`, `ov-ansible-cfg-project`, `ov-adhoc-kernel-census`
- **First playbooks and idempotency**: `ov-first-playbook-motd`, `ov-idempotency-shell-cleanup`, `ov-check-diff-preview`
- **Variables, loops and conditions**: `ov-branch-group-vars`, `ov-loop-adjuster-accounts`, `ov-conditionals-os-family`
- **Handlers and templates**: `ov-handlers-web-reload`, `ov-template-claims-vhost`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Engineer (RHCE) is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Automating Enterprise Linux administration with Ansible</b>: modules</summary>

- **Developer workflow**: `ov-navigator-run-settings`, `ov-git-push-playbooks`, `ov-devcontainer-workflow`, `ov-tags-partial-runs`
- **Facts, results and secrets**: `ov-custom-facts-tier`, `ov-register-disk-report`, `ov-vault-db-credentials`, `ov-block-rescue-db-maintenance`
- **Roles and collections**: `ov-collections-offline`, `ov-role-claims-web`, `ov-system-role-timesync`
- **Automating system administration**: `ov-automate-repos-packages`, `ov-automate-users-aging`, `ov-automate-lvm-storage`, `ov-automate-web-firewall-selinux`, `ov-automate-cron-timers`, `ov-automate-archive-evidence`, `ov-reboot-persistence-fix`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Engineer (RHCE) is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Engineering practices for automation content</b>: modules</summary>

- **Lint and test**: `ov-lint-clean-role`, `ov-molecule-role-tests`
- **Debug and migrate**: `ov-debug-failing-play`, `ov-migrate-core-219`
- **Continuous integration**: `ov-ci-pipeline-lint-test`

</details>

<details><summary><b>Advanced automation content development</b>: modules</summary>

- **Inventory engineering**: `ov-constructed-inventory`, `ov-dynamic-inventory-cmdb`
- **Data transformation**: `ov-lookups-filters-ipam`
- **Orchestration and privilege**: `ov-privilege-scoping`, `ov-delegate-lb-drain`, `ov-rolling-update-serial`, `ov-async-patching`
- **Collections, plugins and execution environments**: `ov-build-publish-collection`, `ov-custom-filter-plugin`, `ov-python-module-check-mode`, `ov-execution-environment-build`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Specialist in Developing Automation with Ansible Automation Platform is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Operating an automation controller</b>: modules</summary>

- **Organisations and access**: `ov-awx-org-rbac`
- **Projects, templates and surveys**: `ov-awx-project-template`, `ov-awx-survey-schedule`, `ov-awx-git-webhook`
- **Workflows and automation as code**: `ov-awx-approval-workflow`, `ov-awx-config-as-code`
- **Day-2 operations**: `ov-awx-backup-triage`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Specialist in Managing Automation with Ansible Automation Platform is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification. Labs use the open-source AWX controller._

</details>

<details><summary><b>Network automation with Ansible</b>: modules</summary>

- **Connecting and gathering facts**: `ov-net-inventory-facts`
- **Configuring devices**: `ov-net-ospf-branch-config`, `ov-net-srlinux-interfaces`, `ov-net-branch-template-role`
- **Validation and backups**: `ov-net-parse-neighbors`, `ov-net-config-backup-restore`

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Specialist in Ansible Network Automation is a trademark of Red Hat, Inc. This path covers objectives aligned to that exam; completing it confers no certification. Labs use FRR and SR Linux devices, not the vendor platforms the exam assumes._

</details>

<details><summary><b>Event-driven and self-healing automation</b>: modules</summary>

- **Rulebooks**: `ov-eda-webhook-rulebook`
- **Alert-driven remediation**: `ov-eda-alert-remediation`

</details>

### Labs (61)

| Lab | Title | Type | Difficulty | Min | Tier | Status | Frameworks | Scenario |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ov-first-inventory` | Describe the claims fleet in an inventory | learn | easy | 15 | A | proposed | ex294-aligned:config-inventory, ex294-aligned:core-components | Orrin & Vale's claims platform has four web nodes, two database nodes and a quoting API host; write a YAML inventory with groups claims_web, claims_db and a parent group claims so that ansible-inventory --graph shows the agreed tree and every host answers ping. |
| `ov-bootstrap-automation-user` | Bootstrap managed nodes for key-based automation | do | easy | 15 | A | proposed | ex294-aligned:managed-nodes | Fresh branch-office nodes only accept a one-time password login; create the user ovauto with the control node's public key and a passwordless sudo drop-in on every node, so that later plays run key-only with become. |
| `ov-ansible-cfg-project` | Set project defaults for the claims automation repository | do | easy | 10 | A | proposed | ex294-aligned:config-inventory | Make /home/learner/claims-automation self-contained: an ansible.cfg there must set the inventory, remote user ovauto, become, a roles path and a collections path, and ansible-config dump --only-changed must show exactly those settings. |
| `ov-adhoc-kernel-census` | Take a kernel census of the fleet with ad-hoc commands | do | easy | 10 | A | proposed | ex294-aligned:core-components, linuxplus:automation-scripting | Audit wants every host's kernel release and uptime by 9am; collect them with ad-hoc module runs (no playbook) into /home/learner/audit/kernels.txt as host,kernel lines sorted by host. |
| `ov-first-playbook-motd` | Write a first playbook that sets a compliance banner | learn | easy | 15 | A | proposed | ex294-aligned:core-components | Compliance needs a login banner naming the host's group and support line on every claims node; write a playbook that places it in /etc/motd and reports changed only on the first run. |
| `ov-branch-group-vars` | Resolve conflicting branch-office settings with group variables | do | medium | 20 | A | proposed | ex294-aligned:core-components | The London branch must use proxy 10.40.0.8 while all other branches use 10.40.0.1 and one test host overrides both; place the variables in group_vars and host_vars so a rendered /etc/ov/proxy.conf carries the right value on every host without extra vars. |
| `ov-loop-adjuster-accounts` | Create claims adjuster accounts from a data file | do | medium | 20 | A | proposed | ex294-aligned:core-components, ex294-aligned:automate-system-tasks | HR exported adjusters.yml with name, uid, team and an active flag; create every active adjuster with the given UID and a supplementary group per team on the claims web nodes, and remove the inactive ones. |
| `ov-conditionals-os-family` | Install the audit agent on a mixed Enterprise Linux and Debian fleet | do | medium | 20 | B | proposed | ex294-aligned:core-components | Branch gateways run a Debian-family OS while head-office hosts run Enterprise Linux; one playbook must install the matching audit package and service name per family and skip hosts tagged decommissioning in their facts. |
| `ov-handlers-web-reload` | Reload the claims web server only when its configuration changes | do | medium | 20 | B | proposed | ex294-aligned:core-components, ex294-aligned:plays-errors | Claims web nodes restart nginx on every run and drop sessions; restructure the play so a changed site config notifies a reload handler, an unchanged run touches nothing, and a config with a syntax error never reaches a reload. |
| `ov-template-claims-vhost` | Render the claims portal virtual host from a template | do | medium | 25 | B | proposed | ex294-aligned:templates-vault | Each claims web node needs a vhost with its own server name, the list of upstream quote API hosts taken from inventory and a maintenance block only on hosts in group canary; produce it from one Jinja2 template with no trailing blank lines. |
| `ov-idempotency-shell-cleanup` | Make a noisy playbook idempotent | fix | medium | 25 | A | proposed | ex294-aligned:core-components | The legacy hardening playbook reports 14 changed tasks on every run because it shells out to echo, sed and useradd; rewrite it with modules (or guarded commands) so the second run reports changed=0 and the end state is identical. |
| `ov-check-diff-preview` | Preview a risky change with check and diff mode | do | easy | 10 | A | proposed | ex294-aligned:run-content | Before tonight's change window, record in /home/learner/change/preview.txt which files the sudoers-tightening playbook would change on each host, using check and diff mode, without changing any host. |
| `ov-navigator-run-settings` | Run playbooks through ansible-navigator with a settings file | do | easy | 15 | A | proposed | ex294-aligned:run-content | The team standardises on ansible-navigator: add an ansible-navigator.yml that disables execution environments, uses stdout mode and saves playbook artifacts to /home/learner/claims-automation/artifacts, then run the site playbook so an artifact JSON appears. |
| `ov-git-push-playbooks` | Publish the claims playbooks to the team Git server | do | easy | 15 | A | proposed | ex294-aligned:git-devworkflow, linuxplus:automation-scripting | Clone the claims-automation repository from the in-lab Git server, add your inventory and site playbook on a branch named onboarding, ignore the artifacts directory and push so the server shows the branch with both files. |
| `ov-devcontainer-workflow` | Develop a playbook inside a VS Code dev container | learn | easy | 20 | A | proposed | ex294-aligned:git-devworkflow | Open the policy-db repository in the browser VS Code with its dev container, fix the lint warning the editor flags, run the playbook from the integrated terminal and push the fix. |
| `ov-vault-db-credentials` | Keep the policy database password in an encrypted vars file | do | medium | 20 | A | proposed | ex294-aligned:templates-vault | Store the policy DB application password in a vault-encrypted group_vars file using vault ID prod and a password file outside the repo, and use it to create the database login on ov-db hosts without the secret appearing in any log output. |
| `ov-role-claims-web` | Package the claims web setup as a role | do | medium | 30 | B | proposed | ex294-aligned:roles-collections | Turn the claims web playbook into a role claims_web with defaults for port and document root, a handler, a template and a dependency on a firewall role, so that site.yml is three lines and the end state is unchanged. |
| `ov-collections-offline` | Install roles and collections from an offline requirements file | do | easy | 15 | A | proposed | ex294-aligned:roles-collections | The lab has no internet; install the roles and collections listed in requirements.yml from the tarballs on the in-lab file share into the project's collections and roles paths, then run a play that uses an FQCN module from one of them. |
| `ov-system-role-timesync` | Configure time sync on all hosts with a packaged system role | do | medium | 20 | C | proposed | ex294-aligned:roles-collections, ex294-aligned:automate-system-tasks | Auditors flagged clock drift; use the timesync system role so every host uses the two in-lab NTP servers with iburst, and chronyc on each node shows them as sources after a reboot. |
| `ov-automate-repos-packages` | Point the fleet at the internal package mirrors | do | easy | 20 | C | proposed | ex294-aligned:automate-system-tasks, rhcsa-aligned:software | Configure the BaseOS and AppStream repositories from the in-lab mirror with GPG checking on every node, then ensure the claims toolset (php, httpd, mod_ssl) is installed and the legacy telnet package is absent. |
| `ov-automate-users-aging` | Enforce password aging for claims staff accounts | do | medium | 25 | C | proposed | ex294-aligned:automate-system-tasks, ex294-aligned:templates-vault | Create the claims_staff group and its members with vaulted password hashes, set a 90-day maximum and 7-day warning for each, and give the group sudo access to restart httpd only. |
| `ov-automate-lvm-storage` | Provision the claims document volume on database nodes | do | hard | 35 | C | proposed | ex294-aligned:automate-system-tasks, ex294-aligned:plays-errors | On every ov-db host with a second disk, create volume group vg_claims, a 1500 MiB logical volume lv_docs formatted xfs and mounted persistently at /srv/claims-docs; hosts without the disk must print a clear message and not fail. |
| `ov-automate-web-firewall-selinux` | Serve the quoting API on a non-standard port with SELinux enforcing | do | hard | 35 | C | proposed | ex294-aligned:automate-system-tasks | The quoting API's httpd must listen on 8082 with SELinux enforcing: label the port, set the content context on /srv/quote, open 8082/tcp permanently in firewalld and keep the service enabled across a reboot. |
| `ov-automate-cron-timers` | Schedule nightly claims exports with cron and a timer | do | medium | 25 | C | proposed | ex294-aligned:automate-system-tasks | Install a cron entry that runs the claims export at 02:15 as user claimsbatch on db hosts and a systemd timer that rotates the export directory weekly, both surviving a reboot and neither duplicated on re-run. |
| `ov-automate-archive-evidence` | Collect audit evidence archives from every host | do | easy | 15 | A | proposed | ex294-aligned:automate-system-tasks | Compress /etc/ov and /var/log/ov-audit on each host into a dated tar.gz and fetch it to /home/learner/evidence/<host>/ on the control node, removing the remote copy afterwards. |
| `ov-block-rescue-db-maintenance` | Roll back a failed policy database maintenance step | do | medium | 25 | B | proposed | ex294-aligned:plays-errors | The maintenance play stops the policy service, migrates a schema file and starts the service again; wrap it so any failure restores the previous file, restarts the service and still writes a status line to /var/log/ov-maint.log. |
| `ov-register-disk-report` | Build a disk usage report from registered results | do | medium | 20 | A | proposed | ex294-aligned:plays-errors, ex294-aligned:templates-vault | Register df output and mount facts on every host and render /home/learner/reports/disk.csv on the control node listing host, mount and percent used, flagging mounts above 80 percent. |
| `ov-custom-facts-tier` | Publish service tier as a custom fact | do | medium | 20 | A | proposed | ex294-aligned:core-components | Each host must expose its support tier and owner team as local facts under ansible_local.ov, and a follow-up play must install the paging agent only where the tier is gold. |
| `ov-tags-partial-runs` | Run only the certificate part of the site playbook | do | easy | 15 | A | proposed | ex294-aligned:run-content | A certificate expires in an hour; tag the site playbook so the certificate tasks can run alone, run them with tags only, and prove that no package task ran on any host. |
| `ov-reboot-persistence-fix` | Make runtime-only changes survive a reboot | fix | medium | 25 | C | proposed | ex294-aligned:automate-system-tasks | Last week's playbook set a sysctl, a firewall port and the default target only at runtime, so a reboot undid them; fix the playbook so all three persist and pass the post-reboot checks. |
| `ov-lint-clean-role` | Bring the branch gateway role to a clean lint profile | fix | medium | 25 | A | proposed |  | The branch_gateway role fails ansible-lint at the production profile with missing FQCNs, unnamed tasks and risky permissions; fix it until lint passes without disabling rules and the role's end state is unchanged. |
| `ov-molecule-role-tests` | Add Molecule tests to the audit agent role | do | hard | 35 | A | proposed |  | Add a Molecule scenario to the audit_agent role that converges against the provided test nodes, passes the idempotence step and verifies the service is running and its config owned by root. |
| `ov-migrate-core-219` | Fix playbooks that broke on the new templating engine | fix | hard | 30 | A | proposed |  | After the control node moved to ansible-core 2.19, the claims deploy fails on string conditionals, nested braces and templated module output; fix the three playbooks so they pass on 2.21 without disabling the new checks. |
| `ov-ci-pipeline-lint-test` | Gate the automation repository with a CI pipeline | do | hard | 35 | A | proposed | linuxplus:automation-scripting | Add a pipeline to the claims-automation repository on the in-lab Git server that runs syntax-check, ansible-lint and the Molecule scenario on every push, and show a failing run for a pushed lint error followed by a green run after the fix. |
| `ov-debug-failing-play` | Find why the quoting API deploy fails on one host only | fix | medium | 20 | A | proposed | ex294-aligned:plays-errors | The quote API deploy fails on ov-quote-api2 alone with an undefined variable; use verbosity, the task debugger or navigator replay to find the host_vars typo and fix it so the play succeeds on all hosts. |
| `ov-constructed-inventory` | Group hosts by facts with a constructed inventory | do | medium | 25 | A | proposed | ex374-aligned:dynamic-inventory | Add a constructed inventory source that creates groups os_<family> and tier_<tier> from host variables and puts every host with more than 4 GiB memory in group big_mem, so that ansible-inventory --graph shows those groups. |
| `ov-dynamic-inventory-cmdb` | Build the inventory from the configuration database | do | hard | 35 | A | proposed | ex374-aligned:dynamic-inventory, ex374-aligned:git-vars | Orrin & Vale's CMDB serves hosts as JSON over HTTP; write an inventory source that turns it into groups by site and role with per-host ansible_host and port overrides, and run a play against site_leeds only. |
| `ov-lookups-filters-ipam` | Plan branch subnets with lookups and network filters | do | hard | 30 | A | proposed | ex374-aligned:data-transform | From branches.csv (read with a lookup), compute each branch's gateway and DHCP range with the ipaddr filters and write one YAML var file per branch in host_vars, rejecting rows whose prefix overlaps another branch. |
| `ov-delegate-lb-drain` | Drain web nodes from the load balancer during an update | do | hard | 35 | B | proposed | ex374-aligned:delegation | Update the claims web nodes one at a time: delegate a disable call to the HAProxy host before each node's update and re-enable it afterwards, so the balancer never has fewer than three healthy backends. |
| `ov-rolling-update-serial` | Stop a bad rollout before it reaches every branch | do | medium | 25 | B | proposed | ex374-aligned:delegation | Roll the branch agent upgrade in batches of 1, 2 and then 25 percent with max_fail_percentage 0, so that the injected failure on the second batch leaves later branches untouched and the run ends failed. |
| `ov-async-patching` | Patch database nodes in parallel without SSH timeouts | do | hard | 40 | C | proposed |  | The full update on ov-db hosts runs for 20 minutes and kills the SSH session; run it asynchronously, poll for completion, reboot only hosts that need it and record per-host results in /home/learner/patching/result.json. |
| `ov-privilege-scoping` | Scope privilege escalation to the tasks that need it | do | medium | 20 | A | proposed | ex374-aligned:privilege-tags | The reporting play runs everything as root; restructure it so only the package and service tasks escalate, the report is written as user ovreport, and a become-less run of the reporting block succeeds. |
| `ov-build-publish-collection` | Publish the claims platform collection to the private Galaxy | do | hard | 35 | A | proposed | ex374-aligned:collections | Package the claims_web role and a helper module as collection orrinvale.claims version 1.2.0, build it, publish it to the in-lab Galaxy server and install it from there into a fresh project. |
| `ov-custom-filter-plugin` | Write a filter that masks policy numbers | do | medium | 25 | A | proposed | ex374-aligned:collections | Reports must never show full policy numbers; add a filter plugin mask_policy to the collection that keeps the last four characters, use it in the claims report template and ship it in the collection build. |
| `ov-python-module-check-mode` | Write a module that manages branch printer queues | do | hard | 45 | A | proposed |  | Write a Python module ov_print_queue that adds or removes a queue entry in /etc/ov/printers.conf, reports changed correctly, honours check mode and returns the final queue list. |
| `ov-execution-environment-build` | Build and run an execution environment for the claims project | do | hard | 45 | C | proposed | ex374-aligned:execution-environments | Write an execution-environment definition that adds the orrinvale.claims collection and the jmespath Python package to the mirrored base image, build it with ansible-builder, push it to the in-lab registry and run the site playbook in it with navigator. |
| `ov-awx-org-rbac` | Model the claims and branch teams in the controller | do | medium | 25 | A | proposed | ex467-aligned:rbac | In the controller, create organisation OrrinVale with teams claims-ops and branch-ops, give claims-ops execute rights on claims templates only and branch-ops admin on the branch inventory, and prove a branch user cannot launch a claims job. |
| `ov-awx-project-template` | Turn the claims playbook into a controller job template | do | medium | 25 | A | proposed | ex467-aligned:projects-templates, ex467-aligned:inventories-credentials | Create a project synced from the claims-automation Git repository, an inventory with the claims hosts, a machine credential and a job template that runs site.yml, then launch it successfully. |
| `ov-awx-survey-schedule` | Let branch staff restart services through a survey | do | medium | 25 | A | proposed | ex467-aligned:surveys-schedules-notifications | Add a survey to the restart template that offers only the three approved services and a branch code with validation, schedule a nightly run at 03:00 and send failures to the in-lab webhook receiver. |
| `ov-awx-approval-workflow` | Require approval before production claims deploys | do | hard | 35 | A | proposed | ex467-aligned:workflows | Build a workflow that deploys to staging, waits for an approval node, deploys to production and runs a rollback template on failure; approve one run and deny another. |
| `ov-awx-config-as-code` | Recreate the controller setup from code | do | hard | 40 | A | proposed | ex467-aligned:api-config-as-code | Describe the claims organisation, project, inventory and job templates with the controller configuration collection and apply it to an empty controller, then launch a job through the REST API with curl and record its id. |
| `ov-awx-git-webhook` | Deploy on push with a Git webhook | do | medium | 20 | A | proposed | ex467-aligned:projects-templates | Configure the claims job template to accept a webhook from the in-lab Git server so that pushing to main launches a job, and show the job triggered by your push. |
| `ov-awx-backup-triage` | Recover the controller and triage a failing job | fix | hard | 40 | A | proposed | ex467-aligned:day2 | Back up the controller, find why the nightly branch job fails since yesterday (an expired credential), fix it, then restore the backup into a fresh instance and show the fixed template is present. |
| `ov-net-inventory-facts` | Collect facts from the branch routers | learn | easy | 20 | N | proposed | ex457-aligned:variables-facts, ex457-aligned:dev-workflow | Build an inventory for the three branch routers with the right connection plugin and network OS per platform, gather their interface and routing facts, and save one JSON file per router under /home/learner/net/facts. |
| `ov-net-ospf-branch-config` | Bring up OSPF on the branch routers from variables | do | medium | 30 | N | proposed | ex457-aligned:netcommon-modules, ex457-aligned:variables-facts | From per-router host_vars, configure loopbacks and single-area OSPF on the FRR branch routers so that every router learns every loopback, and a second run reports no changes. |
| `ov-net-srlinux-interfaces` | Configure SR Linux interfaces over its JSON-RPC API | do | medium | 30 | N | proposed | ex457-aligned:netcommon-modules | Use the httpapi connection to the SR Linux aggregation switch to create subinterfaces for the claims and branch VLANs with descriptions taken from a YAML data file and commit them. |
| `ov-net-config-backup-restore` | Back up router configs and restore one after a bad change | fix | medium | 30 | N | proposed | ex457-aligned:config-backup | Back up every branch router's running config to the Git repository with a dated commit, then restore ov-branch-lon-gw from the backup after the injected bad change and prove its OSPF adjacencies return. |
| `ov-net-parse-neighbors` | Assert OSPF health from parsed router output | do | hard | 30 | N | proposed | ex457-aligned:control-flow | Parse show ip ospf neighbor output from each router into structured data and fail the play, naming the router, if any expected neighbor is missing or not Full. |
| `ov-net-branch-template-role` | Generate branch router configs from a role | do | hard | 40 | N | proposed | ex457-aligned:network-roles-templates | Write a role that renders each branch router's interfaces, OSPF and syslog config from a Jinja2 template and pushes it, so that adding a new branch is one host_vars file and one run. |
| `ov-eda-webhook-rulebook` | React to webhook events with a rulebook | learn | medium | 25 | A | proposed |  | Write a rulebook that listens on a webhook source and runs the cache-flush playbook when a claims_cache_stale event arrives for a known host, ignoring all other events; send both kinds and show only one run. |
| `ov-eda-alert-remediation` | Self-heal a full log disk from an alert | do | hard | 40 | A | proposed |  | Route the in-lab Alertmanager's DiskAlmostFull alert to a rulebook that launches the log-cleanup job template for the affected host only, and show the alert resolve after the job runs. |

## Network administration

Routing, switching, IP services, network security and automation, taught on open network stacks (FRR 10 routers, Linux bridges and hosts, optional Nokia SR Linux) inside a per-lab netdev topology. Labs grade end state (routes, adjacencies, reachability, captured packets, device state through APIs). No vendor-proprietary CLI is used. Objectives the substrate cannot teach authentically (wireless LAN architecture and security, switch port security, DHCP snooping, vendor-specific CLI muscle memory) are quiz-only and have no labs.

Fictional organisation: **Marlow Valley Schools** (A fictional school district with a district office, four campuses (north, south, east and a vocational annex), a small data centre and an upstream link to a regional education network. Routers are named mv-core-1, mv-edge-1, mv-campus-north and so on; switches mv-sw-<site>-N; hosts are classroom, staff, printer and server machines on per-function VLANs.).

Quiz-only (no labs): wireless fundamentals and WLAN security (net.wireless.fundamentals), port security and DHCP snooping (net.security.port-security), controller-based and SDN architecture concepts. CCNA v1.1 is the alignment target; third-party sources say v1.1 runs until early February 2027 and a v2.0 blueprint follows (unverified; re-check before launch).

Competencies: `net.fundamentals`, `net.addressing`, `net.switching`, `net.routing`, `net.services`, `net.security`, `net.automation`, `net.troubleshooting`.

### Paths (4)

| Path | Title | Level | Hours | Labs | Prerequisites | Aligns to | Audience |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `net-fundamentals` | Networking fundamentals | beginner | 6 | 8 | - | ccna | IT staff and system administrators new to networking |
| `net-routing-switching` | Routing and switching on open network stacks | intermediate | 10 | 15 | `net-fundamentals` | ccna | Network administrators and engineers preparing for associate-level routing and switching work |
| `net-services-security` | Network services and security | intermediate | 10 | 17 | `net-fundamentals` | ccna | Network and system administrators who run campus IP services and edge security |
| `net-automation` | Network automation and programmability | intermediate | 5 | 5 | `net-routing-switching` | ccna, ex457-aligned | Network engineers moving from CLI changes to API- and template-driven operations |

<details><summary><b>Networking fundamentals</b>: modules</summary>

- **Packets, frames and ports**: `net-osi-capture-walkthrough`, `net-arp-neighbour-tables`
- **IPv4 and IPv6 addressing**: `net-subnet-east-campus`, `net-fix-library-mask`, `net-ipv6-dual-stack-office`
- **First routes and fault finding**: `net-read-routing-table`, `net-static-routes-campuses`, `net-fix-unreachable-campus`

_CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. CCNA is a trademark of Cisco Systems, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Routing and switching on open network stacks</b>: modules</summary>

- **VLANs and trunks**: `net-vlan-access-ports`, `net-trunk-two-switches`, `net-fix-native-vlan-mismatch`, `net-srlinux-vlan-trunk`, `net-inter-vlan-subinterfaces`
- **Spanning tree and link aggregation**: `net-rstp-root-bridge`, `net-fix-broadcast-storm`, `net-lacp-server-uplink`
- **Static routing**: `net-default-route-edge`, `net-floating-static-backup`, `net-ipv6-static-routes`
- **Single-area OSPF**: `net-ospf-single-area`, `net-ospf-cost-dr-passive`, `net-fix-ospf-adjacency`
- **First-hop redundancy**: `net-vrrp-gateway-pair`

_CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. CCNA is a trademark of Cisco Systems, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Network services and security</b>: modules</summary>

- **DHCP and DNS**: `net-dhcp-pools-reservations`, `net-dhcp-relay-campus`, `net-dns-district-zone`
- **Address translation**: `net-pat-internet-edge`, `net-static-nat-timetable`, `net-fix-nat-inside-outside`
- **Time, logging, monitoring and QoS**: `net-ntp-hierarchy`, `net-syslog-central`, `net-snmpv3-polling`, `net-qos-voice-priority`
- **Filtering and device hardening**: `net-acl-grades-server`, `net-zone-firewall-edge`, `net-mgmt-plane-hardening`, `net-hack-open-management`
- **Site-to-site VPNs**: `net-wireguard-annex-tunnel`, `net-ipsec-partner-tunnel`, `net-fix-mtu-blackhole`

_CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. CCNA is a trademark of Cisco Systems, Inc. This path covers objectives aligned to that exam; completing it confers no certification._

</details>

<details><summary><b>Network automation and programmability</b>: modules</summary>

- **Device APIs and structured data**: `net-jsonrpc-read-state`, `net-jsonrpc-config-change`, `net-gnmi-interface-counters`
- **Configuration as code**: `net-jinja-render-frr`, `net-ansible-frr-backup`

_CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. or Red Hat, Inc. CCNA is a trademark of Cisco Systems, Inc.; Red Hat and Ansible are trademarks of Red Hat, Inc. This path covers objectives aligned to those exams; completing it confers no certification._

</details>

### Labs (45)

| Lab | Title | Type | Difficulty | Min | Tier | Status | Frameworks | Scenario |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `net-osi-capture-walkthrough` | Follow one web request down the stack in a packet capture | learn | easy | 15 | N | verified | ccna:network-fundamentals | Capture a north-campus kiosk fetching the district timetable page and record the TCP handshake flags, source and destination ports and the HTTP status code in a report file the grader compares with its own capture. |
| `net-arp-neighbour-tables` | Read ARP and IPv6 neighbour tables to map hosts to MACs | learn | easy | 10 | N | verified | ccna:network-fundamentals | Populate and read the IPv4 ARP and IPv6 neighbour tables on mv-campus-south and write the MAC address of the library printer and of the default gateway to a file. |
| `net-subnet-east-campus` | Carve a campus block into right-sized subnets | do | easy | 20 | N | proposed | ccna:network-fundamentals | Split Marlow Valley's new 10.40.0.0/22 east-campus block into subnets for 300 students, 120 staff, 40 printers and a point-to-point uplink, then address the router and one host per subnet so every host reaches its gateway. |
| `net-fix-library-mask` | Repair a host that uses the wrong prefix length | fix | easy | 12 | N | proposed | ccna:network-fundamentals | The south-campus library PC was given a /16 instead of a /24 and cannot reach the printer subnet; correct its addressing so it reaches both its gateway and the printers without touching the router. |
| `net-ipv6-dual-stack-office` | Add IPv6 to the district office LAN | do | medium | 20 | N | proposed | ccna:network-fundamentals | Give the district office router a global /64 and link-local gateway, send router advertisements so the staff hosts autoconfigure with SLAAC, and prove IPv6 reachability between two office hosts and the router. |
| `net-vlan-access-ports` | Separate staff and student ports into VLANs | learn | easy | 15 | N | verified | ccna:network-access | On the Linux bridge switch mv-sw-north-1 place the staff ports in VLAN 20 and the student ports in VLAN 30 so staff hosts reach each other but not student hosts. |
| `net-trunk-two-switches` | Carry three VLANs over an 802.1Q trunk | do | medium | 20 | N | verified | ccna:network-access | Join mv-sw-north-1 and mv-sw-north-2 with a trunk that carries VLANs 20, 30 and 99 only, with 99 untagged as the native VLAN, so hosts in each VLAN reach their peers on the other switch. |
| `net-fix-native-vlan-mismatch` | Find why management traffic leaks between VLANs | fix | medium | 15 | N | verified | ccna:network-access | After a switch swap, management hosts on the south campus reach the student VLAN; find the native VLAN mismatch on the trunk, fix it and confirm the VLANs are isolated again. |
| `net-inter-vlan-subinterfaces` | Route between campus VLANs on one router link | do | medium | 20 | N | verified | ccna:network-access | Configure 802.1Q subinterfaces for VLANs 20, 30 and 40 on mv-campus-north's single trunk to the switch so hosts in each VLAN reach the others through their own gateway address. |
| `net-rstp-root-bridge` | Choose the spanning-tree root for a campus triangle | do | medium | 20 | N | verified | ccna:network-access | Run RSTP on three switches cabled in a triangle and set bridge priorities so mv-sw-core-1 is root and the link between the two access switches is the one that blocks. |
| `net-fix-broadcast-storm` | Stop a broadcast storm caused by a new redundant link | fix | hard | 20 | N | built | ccna:network-access | A contractor added a second cable between two annex switches and the annex network melted down; prove the loop with a capture, enable rapid spanning tree and keep both cables connected. |
| `net-lacp-server-uplink` | Bundle two links to the data-centre server with LACP | do | medium | 20 | N | built | ccna:network-access | Bond two links between mv-sw-dc-1 and the student-records server with 802.3ad so both carry traffic and the server stays reachable when the grader cuts either link. |
| `net-srlinux-vlan-trunk` | Build access and trunk ports on a network OS switch | do | medium | 20 | N | proposed | ccna:network-access | On the SR Linux switch mv-sw-annex-1 create a bridged network instance with an untagged access port in VLAN 30 and a tagged uplink carrying VLANs 20 and 30, then prove hosts on both sides reach each other. |
| `net-read-routing-table` | Predict next hops from a routing table | learn | easy | 15 | N | proposed | ccna:ip-connectivity | Read mv-core-1's routing table with connected, static and OSPF routes and write the next hop and source protocol for five district destinations to a file the grader checks against the forwarding plane. |
| `net-static-routes-campuses` | Connect the district office and two campuses with static routes | do | easy | 15 | N | proposed | ccna:ip-connectivity | Add static routes on mv-core-1, mv-campus-north and mv-campus-south so every campus LAN reaches the other two and the district office, with no route pointing at an unreachable next hop. |
| `net-default-route-edge` | Send unknown traffic to the regional network edge | do | easy | 10 | N | proposed | ccna:ip-connectivity | Configure default routes so every campus router forwards unknown destinations to mv-edge-1 and mv-edge-1 forwards them to the regional education network, verified by a traceroute from a classroom host. |
| `net-floating-static-backup` | Fail over to a backup link with a floating static route | do | medium | 20 | N | proposed | ccna:ip-connectivity | Give the annex a backup route over its slow radio link with a higher administrative distance so it is used only when the grader takes the fibre link down, and returns when the fibre recovers. |
| `net-ipv6-static-routes` | Route IPv6 between the office and a campus | do | medium | 15 | N | proposed | ccna:ip-connectivity | Add IPv6 static routes and an IPv6 default route so district office hosts reach the north campus IPv6 LAN and the edge router, using link-local next hops where the link has no global address. |
| `net-ospf-single-area` | Replace static routes with single-area OSPF | do | medium | 25 | N | proposed | ccna:ip-connectivity | Run OSPFv2 in area 0 on four district routers with loopback router IDs so every LAN and loopback is learned dynamically and the old static routes can be removed without losing reachability. |
| `net-ospf-cost-dr-passive` | Steer OSPF with cost, DR priority and passive interfaces | do | medium | 20 | N | proposed | ccna:ip-connectivity | Make the fibre path preferred over the copper path with interface costs, force mv-core-1 to be DR on the data-centre segment, stop hellos toward classroom LANs and originate a default route from the edge. |
| `net-fix-ospf-adjacency` | Bring two stuck OSPF neighbours to Full | fix | medium | 20 | N | proposed | ccna:ip-connectivity | mv-campus-east never reaches Full with mv-core-1; find the mismatched hello interval and the MTU mismatch, fix both and confirm the east-campus LAN appears in the core routing table. |
| `net-vrrp-gateway-pair` | Give a campus a redundant default gateway with VRRP | do | medium | 25 | N | built | ccna:ip-connectivity | Configure VRRP between mv-campus-north-a and mv-campus-north-b so classroom hosts keep a single gateway address, the a-router is master by priority, and hosts keep reaching the core when the grader shuts it down. |
| `net-dhcp-pools-reservations` | Serve campus addresses with DHCP pools and reservations | do | easy | 20 | N | proposed | ccna:ip-services | Configure the district DHCP server with pools for the staff and student VLANs, the correct gateway and DNS options, and fixed reservations for the three library printers by MAC address. |
| `net-dhcp-relay-campus` | Relay DHCP from a campus to the central server | do | medium | 20 | N | proposed | ccna:ip-services | Student hosts on the south campus get no address because the DHCP server sits in the data centre; configure a relay on the campus router so they lease from the right pool. |
| `net-dns-district-zone` | Publish district host names in DNS | do | easy | 15 | N | proposed | ccna:ip-services | Add A, AAAA and CNAME records for the timetable and grades servers to the district resolver and point campus hosts at it so the names resolve and connect from every campus. |
| `net-pat-internet-edge` | Share one public address across the student VLANs | do | medium | 20 | N | proposed | ccna:ip-services, lfcs:networking | Configure port address translation on mv-edge-1 so hosts in the student and staff VLANs reach the regional network behind its single outside address, and nothing else is translated. |
| `net-static-nat-timetable` | Publish the timetable server with static NAT | do | medium | 20 | N | proposed | ccna:ip-services, lfcs:networking | Map a second outside address one-to-one to the timetable server so the regional network can reach it on HTTPS, while all other inside hosts keep using PAT. |
| `net-fix-nat-inside-outside` | Repair address translation applied on the wrong side | fix | medium | 15 | N | proposed | ccna:ip-services | After a firewall migration nobody on the north campus reaches the outside; find that translation is applied on the inside interface, fix it and prove sessions leave with the edge address. |
| `net-ntp-hierarchy` | Build a district time hierarchy with NTP | do | easy | 15 | N | proposed | ccna:ip-services | Make the data-centre time server the source for both core routers and point every campus router at the core routers, so all devices report synchronised time within one second of the source. |
| `net-syslog-central` | Send router logs to the district syslog server | do | easy | 15 | N | proposed | ccna:ip-services | Forward warning-and-above messages from every campus router to the central syslog server, separated into one file per router, and prove an interface flap on mv-campus-east is logged there. |
| `net-snmpv3-polling` | Poll interface counters with SNMPv3 only | do | medium | 20 | N | proposed | ccna:ip-services, ccna:security-fundamentals | Enable an authenticated and encrypted SNMPv3 user on the edge router for the monitoring host, disable v1/v2c access, and record the uplink's inbound octet counter from a poll to a file. |
| `net-qos-voice-priority` | Protect phone calls on a congested annex link | do | hard | 25 | N | proposed | ccna:ip-services | Mark the annex VoIP traffic as expedited forwarding and give it strict priority on the slow radio link so calls keep under 30 ms queueing delay while the grader floods the link with bulk transfers. |
| `net-acl-grades-server` | Allow only staff to reach the grades server | do | medium | 20 | N | proposed | ccna:security-fundamentals | Filter forwarded traffic on mv-core-1 so only the staff VLAN reaches the grades server on TCP 443, students and printers are dropped, and every other flow through the router keeps working. |
| `net-zone-firewall-edge` | Build an inside, DMZ and outside firewall policy | do | hard | 30 | N | proposed | ccna:security-fundamentals, linuxplus:security | Turn mv-edge-1 into a stateful zone firewall where inside may reach anything, outside may reach only the DMZ web server on 443, and the DMZ may not open connections inward. |
| `net-mgmt-plane-hardening` | Lock router management to SSH from the admin VLAN | do | medium | 20 | N | proposed | ccna:security-fundamentals | Restrict management of the campus routers to key-based SSH from the network-admin VLAN only, with a login banner and per-admin local accounts, so the grader's attempts from a classroom host fail. |
| `net-hack-open-management` | Abuse then close an exposed management plane | hack | medium | 25 | N | proposed | ccna:security-fundamentals | From a student laptop, find the annex router that still answers SNMP with a default community and read its configuration, then remove the exposure so the same probe returns nothing. |
| `net-wireguard-annex-tunnel` | Link the annex to the core with a WireGuard tunnel | do | medium | 25 | N | proposed | ccna:security-fundamentals | Build a WireGuard tunnel between mv-edge-1 and the annex router across the untrusted regional network and route the annex LANs through it, so a capture on the transit link shows only encrypted UDP. |
| `net-ipsec-partner-tunnel` | Build an IPsec tunnel to a partner college | do | hard | 30 | N | proposed | ccna:security-fundamentals | Bring up an IKEv2 site-to-site IPsec tunnel with pre-shared keys between mv-edge-1 and a partner college gateway so only the shared-course subnets cross it, encrypted. |
| `net-fix-mtu-blackhole` | Unstick large uploads through a tunnel | fix | hard | 25 | N | proposed | ccna:ip-connectivity | Since the annex tunnel went live, small pages load but coursework uploads hang; prove the path-MTU black hole with captures and fix it with an MTU or MSS clamp so a 5 MB upload completes. |
| `net-fix-unreachable-campus` | Find where traffic to the east campus stops | fix | medium | 20 | N | proposed | ccna:ip-connectivity | Staff at the district office cannot reach the east campus; use ping, traceroute and the route tables to find the missing return route on the far router, fix it and record the faulty hop in a file. |
| `net-jsonrpc-read-state` | Read switch state through a JSON-RPC API | learn | easy | 15 | N | proposed | ccna:automation-programmability | Query the annex SR Linux switch's JSON-RPC API with curl and jq and write the oper-state and description of every interface to a JSON file in the format the grader specifies. |
| `net-jsonrpc-config-change` | Change interface settings through the API | do | medium | 20 | N | proposed | ccna:automation-programmability, ex457-aligned:netcommon-modules | Use the switch's JSON-RPC API, not its CLI, to set descriptions and admin state on four annex access ports from a YAML change request, and commit the change. |
| `net-gnmi-interface-counters` | Collect interface counters over gNMI | do | medium | 20 | N | proposed | ccna:automation-programmability | Subscribe to the uplink counters of the annex switch with gNMI using YANG paths and save the in-octets value of each uplink to a file that the grader checks against the device. |
| `net-jinja-render-frr` | Generate router configs from YAML with Jinja2 | do | medium | 25 | N | proposed | ccna:automation-programmability, ex457-aligned:network-roles-templates | Write a Jinja2 template that renders FRR interface and OSPF configuration for the three campus routers from a district YAML inventory, apply the output and prove all adjacencies come up. |
| `net-ansible-frr-backup` | Back up every router config to Git with Ansible | do | medium | 20 | N | proposed | ccna:automation-programmability, ex457-aligned:config-backup | Write a playbook that pulls the running configuration of every district FRR router into a Git repository, one file per router, and commits only when a configuration changed. |

## Exam simulations

| Exam | Title | Aligns to | Format | Duration | Pass mark | Tasks | Pool | Environment | Reboot before grade | Tier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sim-k8s-admin` | Kubernetes administrator practical exam simulation | cka | practical | 120 min | 66% | 17 | 34 | shared | no | K |
| `sim-k8s-developer` | Kubernetes application developer practical exam simulation | ckad | practical | 120 min | 66% | 16 | 32 | shared | no | V |
| `sim-k8s-security` | Kubernetes security specialist practical exam simulation | cks | practical | 120 min | 67% | 15 | 30 | shared | no | K |
| `sim-linux-sysadmin` | Linux system administrator practical exam simulation | lfcs | practical | 120 min | 67% | 18 | 36 | shared | no | C |
| `sim-el-sysadmin` | Enterprise Linux administrator practical exam simulation | rhcsa-aligned | practical | 180 min | 70% | 20 | 40 | shared | yes | C |
| `sim-linux-pro` | Linux professional scenario exam simulation | linuxplus | practical-simulation | 90 min | 72% | 20 | 40 | per-task | no | B |
| `sim-containers-docker` | Container practitioner practical exam simulation | docker-practitioner | practical | 150 min | 70% | 12 | 24 | shared | yes | C |
| `sim-containers-podman` | Rootless container practical exam simulation (optional) | ex188-aligned | practical | 90 min | 70% | 8 | 16 | shared | yes | C |
| `sim-iac-associate` | Infrastructure as code associate exam simulation | tf-associate | practical-simulation | 60 min | 70% | 12 | 25 | shared | no | A |
| `sim-iac-advanced` | Infrastructure as code advanced lab exam simulation | tf-advanced | practical | 240 min | 70% | 9 | 18 | shared | no | V |
| `sim-el-automation` | Enterprise Linux automation practical exam simulation | ex294-aligned | practical | 240 min | 70% | 15 | 34 | shared | yes | C |
| `sim-net-associate` | Associate network engineer practical exam simulation | ccna | practical-simulation | 120 min | 80% | 15 | 30 | shared | no | N |
| `sim-platform-engineer` | Platform engineer practical capstone | ct-platform | practical | 240 min | 70% | 10 | 20 | shared | yes | K |

### Kubernetes administrator practical exam simulation

Aligns to: cka.

**Duration** 120 min. **Pass mark** 66% (The real exam publishes a pass mark; ours (66 %) is a CloudTrain setting and may be recalibrated from pilot data.). **Tasks** 17, environment shared, tier K.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| cka:storage | 10% | 2 | 4 |
| cka:troubleshooting | 30% | 5 | 10 |
| cka:workloads-scheduling | 15% | 3 | 6 |
| cka:cluster-architecture | 25% | 4 | 8 |
| cka:services-networking | 20% | 3 | 6 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: offline copy of the Kubernetes documentation and man pages only. Partial credit: per-check. each task names the context to use; tasks share the multi-cluster environment, so a change outside the task scope can cost points elsewhere

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. weighted score and pass/fail against the pass mark; per-objective percent; per-task pass/fail with learner-safe check messages; time used per task; skill evidence fed to the learner model; recommended labs for the weakest objectives.

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKA is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (34 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xka-pv-claim-mount` | cka:storage | Bind a pre-made volume to a reporting Pod | medium | 7 | K | In qm-archive, claim the existing 3Gi archive volume with a PVC in namespace audit-reports and mount it read-only at /data in a new Pod. |
| `xka-default-storageclass` | cka:storage | Change the default StorageClass | easy | 6 | K | Make the fast-local StorageClass the only default on qm-yard and create a 1Gi PVC that binds through it without naming a class. |
| `xka-retain-reclaim` | cka:storage | Keep a released volume's data | medium | 8 | K | Set the ledger-history PV to Retain before its claim is deleted, delete the claim, and make the Released PV Available again for a new claim. |
| `xka-expand-claim` | cka:storage | Grow a claim in place | easy | 6 | K | Expand the manifest-cache PVC in qm-fleet from 1Gi to 3Gi on its expandable StorageClass and record the new capacity reported in the claim's status. |
| `xka-kubelet-stopped` | cka:troubleshooting | Return a NotReady node to service | medium | 10 | K | dispatch-wk-1 is NotReady; repair its kubelet so the node is Ready and stays Ready after a kubelet restart. |
| `xka-controller-manager-flag` | cka:troubleshooting | Repair the controller manager | hard | 12 | K | Deployments on qm-capacity create no Pods; fix the broken controller-manager static Pod so the pending ReplicaSets scale up. |
| `xka-top-cpu-pod` | cka:troubleshooting | Report the busiest Pod by CPU | easy | 5 | K | Write the name of the Pod using the most CPU among those labelled tier=sorting across all namespaces of qm-capacity to the given file. |
| `xka-previous-logs-error` | cka:troubleshooting | Save the crash reason of a restarting container | easy | 5 | V | Write the lines containing ERROR from the previous instance of the crashing manifest-parser container to the given file. |
| `xka-service-selector-fix` | cka:troubleshooting | Restore traffic to a Service with no backends | medium | 7 | V | The berth-status Service has no EndpointSlice entries; fix it without touching the Deployment so the probe Pod gets HTTP 200. |
| `xka-coredns-down` | cka:troubleshooting | Fix cluster DNS | hard | 10 | K | Name lookups fail in every qm-tracking Pod; repair CoreDNS so the probe Pod resolves the tracking Service again. |
| `xka-tainted-node-count` | cka:troubleshooting | Count nodes that accept new Pods | easy | 4 | K | Write the number of qm-fleet nodes that are Ready and untainted for NoSchedule to the given file. |
| `xka-crictl-container-id` | cka:troubleshooting | Find a container on its node with crictl | medium | 6 | K | On yard-wk-1, find the runtime ID and image of the gate-scanner container with crictl and write them to the given file on that node. |
| `xka-events-failing-pod` | cka:troubleshooting | Get a stuck Pod running | easy | 6 | V | The customs-sync Pod is stuck in ContainerCreating; use its events to find and create the missing ConfigMap so it reaches Running. |
| `xka-apiserver-etcd-endpoint` | cka:troubleshooting | Reconnect the API server to etcd | hard | 12 | K | The qm-ledger API server crash-loops after a change; fix its etcd connection settings so kubectl works again. |
| `xka-hpa-memory` | cka:workloads-scheduling | Autoscale a Deployment | medium | 7 | K | Create an HPA for the label-queue Deployment that keeps 2-6 replicas at 70 % CPU with a 120 s scale-down stabilisation window. |
| `xka-rollout-undo` | cka:workloads-scheduling | Undo a broken rollout | easy | 5 | V | Roll the ferry-schedule Deployment back to its previous revision and scale it to 4 ready replicas. |
| `xka-secret-env-volume` | cka:workloads-scheduling | Wire a Secret into a Deployment | easy | 6 | V | Create the customs-api-key Secret and expose it to the clearance Deployment as env API_KEY and as a file under /run/keys. |
| `xka-required-affinity` | cka:workloads-scheduling | Constrain placement with node affinity | medium | 7 | K | Make the reefer-monitor Deployment run only on nodes labelled zone=cold and preferably on rack=a, with all replicas Running. |
| `xka-toleration-control-plane` | cka:workloads-scheduling | Run a Pod on the control plane | easy | 5 | K | Run a Pod named cp-inspector on qm-fleet's control-plane node using a toleration and nodeSelector, without removing the node's taint. |
| `xka-sidecar-shared-log` | cka:workloads-scheduling | Add a log sidecar to a Deployment | medium | 8 | V | Add a native sidecar to the gate-log Deployment that streams /var/log/gate/access.log from a shared emptyDir to its stdout. |
| `xka-etcd-snapshot-save` | cka:cluster-architecture | Snapshot a cluster's etcd | medium | 8 | K | Save a verified snapshot of qm-yard's stacked etcd to /srv/backup on yard-cp-1 using the cluster's etcd certificates. |
| `xka-worker-join` | cka:cluster-architecture | Join a prepared worker | medium | 10 | K | Join capacity-wk-3 to qm-capacity with a fresh kubeadm token so it reports Ready. |
| `xka-node-upgrade-minor` | cka:cluster-architecture | Upgrade a worker to the next minor | hard | 15 | K | Upgrade dispatch-wk-1's kubeadm and kubelet to v1.37.1 from the offline mirror after draining it, and uncordon it. |
| `xka-clusterrole-binding` | cka:cluster-architecture | Grant a ServiceAccount cluster-wide read on nodes | medium | 7 | V | Create a ServiceAccount fleet-auditor that can list and watch nodes and PersistentVolumes cluster-wide and nothing else. |
| `xka-helm-install-values` | cka:cluster-architecture | Install a chart with a values override | easy | 6 | V | Install the gate-metrics chart from the local repo as release gm in namespace monitoring with service.type NodePort set by values. |
| `xka-kustomize-apply` | cka:cluster-architecture | Apply a Kustomize overlay | easy | 6 | V | Add a patch to the provided production overlay that sets 5 replicas and a prod label, and apply it with kubectl apply -k. |
| `xka-crd-custom-resource` | cka:cluster-architecture | Create a custom resource for an installed operator | medium | 7 | V | List the fields of the installed BerthAllocation CRD and create one for berth 7 that the operator marks Ready. |
| `xka-csr-user-access` | cka:cluster-architecture | Onboard a user with a certificate | medium | 8 | K | Approve the pending CSR for user ops-mara and bind her to view Pods in namespace dock-scheduling only. |
| `xka-netpol-egress-db` | cka:services-networking | Restrict egress to one database | medium | 8 | K | Allow Pods labelled app=invoicing to send traffic only to the ledger-db Pods on 5432 and to DNS, and nowhere else. |
| `xka-nodeport-fixed` | cka:services-networking | Expose a Deployment on a fixed node port | easy | 5 | K | Expose the gate-kiosk Deployment on node port 30880 so the workstation reaches it on every qm-tracking node. |
| `xka-ingress-host-rule` | cka:services-networking | Publish an app through an Ingress host rule | easy | 6 | K | Route ferry.quillmoor.example/ to the ferry-board Service on port 8080 with an Ingress using the cluster's IngressClass. |
| `xka-httproute-split` | cka:services-networking | Migrate an Ingress to Gateway API | hard | 12 | K | Replace the berth-portal Ingress with a Gateway listener and HTTPRoute that serve the same host and paths, then delete the Ingress. |
| `xka-dns-lookup-record` | cka:services-networking | Record Service and Pod DNS names | easy | 5 | V | Write the cluster DNS answer for the tariff Service and for a given Pod IP in namespace customs to the given files. |
| `xka-loadbalancer-address` | cka:services-networking | Expose with a LoadBalancer and record the address | easy | 5 | K | Expose the quote-engine Deployment with a LoadBalancer Service on port 80 and write its external address to the given file. |

</details>

### Kubernetes application developer practical exam simulation

Aligns to: ckad.

**Duration** 120 min. **Pass mark** 66% (The real exam publishes a pass mark; ours (66 %) is a CloudTrain setting and may be recalibrated from pilot data.). **Tasks** 16, environment shared, tier V.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| ckad:design-build | 20% | 3 | 6 |
| ckad:deployment | 20% | 3 | 6 |
| ckad:observability-maintenance | 15% | 3 | 6 |
| ckad:environment-config-security | 25% | 4 | 8 |
| ckad:services-networking | 20% | 3 | 6 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: offline copy of the Kubernetes documentation and man pages only. Partial credit: per-check. each task names the context to use; tasks share the multi-cluster environment, so a change outside the task scope can cost points elsewhere

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. weighted score and pass/fail against the pass mark; per-objective percent; per-task pass/fail with learner-safe check messages; time used per task; skill evidence fed to the learner model; recommended labs for the weakest objectives.

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKAD is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (32 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xkd-cronjob-cleanup` | ckad:design-build | Schedule a cleanup job | easy | 6 | V | Create a CronJob that runs the purge-tmp command every 15 minutes, forbids concurrent runs and keeps 2 finished Jobs. |
| `xkd-job-completions` | ckad:design-build | Run a Job to a fixed number of completions | easy | 5 | V | Run a Job named rate-import that completes 6 times with 2 Pods in parallel and a backoff limit of 3. |
| `xkd-init-container-seed` | ckad:design-build | Seed data with an init container | medium | 7 | V | Add an init container to the timetable Pod that writes the seed file into a shared emptyDir before the web container starts serving it. |
| `xkd-build-tag-image` | ckad:design-build | Build and save an image | medium | 8 | K | Build the provided Containerfile as quote-api:2.1, change its exposed port to 9090, and save it as an OCI archive at the given path. |
| `xkd-pvc-mount-pod` | ckad:design-build | Persist a Pod's data on a claim | easy | 6 | K | Create a 500Mi ReadWriteOnce PVC and mount it at /var/lib/notes in the notes-api Pod so the file it writes survives Pod recreation. |
| `xkd-workload-kind-choice` | ckad:design-build | Pick the right workload resource | medium | 7 | K | Convert the node-cache Deployment into a DaemonSet with the same Pod template so exactly one Pod runs per worker. |
| `xkd-canary-share` | ckad:deployment | Add a canary behind an existing Service | medium | 8 | V | Add a quote-engine-canary Deployment so about 20 % of the 10 Pods behind the quote Service run the new image. |
| `xkd-bluegreen-switch` | ckad:deployment | Switch a Service to the green release | easy | 6 | V | Point the booking Service at the green Deployment's Pods and scale blue to zero once green is fully ready. |
| `xkd-rolling-strategy` | ckad:deployment | Set a rolling update strategy and roll out | easy | 5 | V | Set maxSurge 2 and maxUnavailable 0 on the manifest-api Deployment and roll it out to image tag 3.4. |
| `xkd-helm-upgrade-rollback` | ckad:deployment | Upgrade and roll back a Helm release | medium | 7 | V | Upgrade release track-ui to chart version 1.3.0, then roll it back to revision 1 and record the final revision number. |
| `xkd-kustomize-image-tag` | ckad:deployment | Set an image tag through Kustomize | easy | 5 | V | Use the staging overlay's images field to set the parcel-api tag to 2.7 and apply the overlay. |
| `xkd-scale-and-pause` | ckad:deployment | Pause a rollout to batch changes | medium | 7 | V | Pause the dock-board rollout, change its image and memory limit, then resume so only one new ReplicaSet is created. |
| `xkd-readiness-http` | ckad:observability-maintenance | Add an HTTP readiness probe | easy | 5 | V | Add a readiness probe on /healthz port 8080 with a 5 s period to the carrier-api Deployment. |
| `xkd-liveness-exec-fix` | ckad:observability-maintenance | Fix a liveness probe that kills a healthy app | medium | 7 | V | The ledger-sync Pod restarts constantly; correct its liveness probe so it stays Running with zero new restarts. |
| `xkd-deprecated-manifest` | ckad:observability-maintenance | Update a manifest to a served API version | medium | 6 | V | Fix the provided manifest that uses a removed API version so it applies cleanly and creates the resource. |
| `xkd-logs-container-select` | ckad:observability-maintenance | Save one container's logs | easy | 4 | V | Write the logs of the uploader container of the label-batch Pod to the given file. |
| `xkd-top-memory-report` | ckad:observability-maintenance | Report the Pod using most memory | easy | 4 | K | Write the name of the Pod using the most memory in namespace parcel-sorting to the given file. |
| `xkd-debug-distroless` | ckad:observability-maintenance | Inspect a shell-less Pod | medium | 7 | V | Use an ephemeral debug container on the rates-engine Pod to read its loaded config and write the value of its region setting to the given file. |
| `xkd-configmap-volume` | ckad:environment-config-security | Mount configuration from a ConfigMap | easy | 5 | V | Create ConfigMap tariff-rules from the given file and mount it at /etc/tariff in the tariff-api Deployment. |
| `xkd-secret-env-from` | ckad:environment-config-security | Load all keys of a Secret as environment | easy | 5 | V | Create Secret carrier-creds with two keys and load both into the carrier-sync container with envFrom. |
| `xkd-security-context-user` | ckad:environment-config-security | Run a container as a non-root user | medium | 6 | V | Make the invoice-api container run as UID 1500 with privilege escalation disabled and all capabilities dropped except NET_BIND_SERVICE. |
| `xkd-requests-limits` | ckad:environment-config-security | Set requests and limits | easy | 4 | V | Give the eta-predictor container requests of 200m CPU and 256Mi memory and limits twice as large. |
| `xkd-quota-namespace` | ckad:environment-config-security | Limit a namespace with a quota | easy | 5 | V | Create a ResourceQuota in namespace pilot-apps allowing at most 6 Pods, 2 CPU of requests and 4Gi of memory limits. |
| `xkd-serviceaccount-pod` | ckad:environment-config-security | Run a Pod under a dedicated ServiceAccount | easy | 4 | V | Create ServiceAccount route-reader and run the route-sync Deployment under it. |
| `xkd-role-configmaps` | ckad:environment-config-security | Grant read access to ConfigMaps | medium | 6 | V | Allow ServiceAccount route-reader to get, list and watch ConfigMaps in its own namespace only. |
| `xkd-custom-resource-create` | ckad:environment-config-security | Create a custom resource | easy | 5 | V | Create a DeliveryWindow custom resource named harbour-am with the start and end times given, using the installed CRD. |
| `xkd-clusterip-expose` | ckad:services-networking | Expose a Deployment inside the cluster | easy | 4 | V | Expose the rates-api Deployment as ClusterIP Service rates on port 80 targeting container port 8080. |
| `xkd-netpol-allow-frontend` | ckad:services-networking | Allow one client app with a NetworkPolicy | medium | 7 | K | Allow only Pods labelled role=portal to reach the quote-db Pods on 6379 in namespace pricing. |
| `xkd-ingress-path` | ckad:services-networking | Route a path with an Ingress | easy | 5 | K | Route /quotes on shop.quillmoor.example to the quote Service port 80 through an Ingress. |
| `xkd-service-port-fix` | ckad:services-networking | Fix a Service that targets the wrong port | easy | 5 | V | The booking Service connects but gets refused; correct its targetPort so the probe Pod receives HTTP 200. |
| `xkd-nodeport-expose` | ckad:services-networking | Expose an app on a node port | easy | 5 | K | Expose the kiosk-ui Deployment as a NodePort Service and write the assigned node port to the given file. |
| `xkd-named-port-service` | ckad:services-networking | Target a named container port | medium | 6 | V | Name container port 8443 of the customs-ui Deployment https and make Service customs-ui target it by name. |

</details>

### Kubernetes security specialist practical exam simulation

Aligns to: cks.

**Duration** 120 min. **Pass mark** 67% (The real exam publishes a pass mark; ours (67 %) is a CloudTrain setting and may be recalibrated from pilot data.). **Tasks** 15, environment shared, tier K.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| cks:cluster-setup | 15% | 2 | 4 |
| cks:cluster-hardening | 15% | 2 | 4 |
| cks:system-hardening | 10% | 2 | 4 |
| cks:microservice-vulnerabilities | 20% | 3 | 6 |
| cks:supply-chain-security | 20% | 3 | 6 |
| cks:monitoring-runtime-security | 20% | 3 | 6 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: offline copy of the Kubernetes documentation and man pages only. Partial credit: per-check. each task names the context to use; tasks share the multi-cluster environment, so a change outside the task scope can cost points elsewhere

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. weighted score and pass/fail against the pass mark; per-objective percent; per-task pass/fail with learner-safe check messages; time used per task; skill evidence fed to the learner model; recommended labs for the weakest objectives.

_CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKS is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (30 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xks-default-deny-ns` | cks:cluster-setup | Apply a default-deny baseline | medium | 7 | K | Add default-deny ingress and egress policies to namespace billing that still allow DNS lookups. |
| `xks-metadata-egress-block` | cks:cluster-setup | Block egress to the node metadata address | medium | 7 | K | Prevent all Pods in namespace partner-apps from reaching 169.254.169.254 while other egress keeps working. |
| `xks-ingress-tls-secret` | cks:cluster-setup | Serve an Ingress over TLS | medium | 7 | K | Create a TLS Secret from the given files and make the portal Ingress serve portal.quillmoor.example over HTTPS only. |
| `xks-cis-kubelet-fix` | cks:cluster-setup | Resolve benchmark findings on a node | hard | 10 | K | Fix the two failing kubelet benchmark findings listed in the report on yard-wk-1 so a rescan passes them. |
| `xks-rbac-reduce` | cks:cluster-hardening | Reduce a Role to least privilege | medium | 6 | V | Trim the report-builder Role to exactly get and list on Pods and ConfigMaps, removing every other verb and resource. |
| `xks-sa-automount` | cks:cluster-hardening | Stop automounting API tokens | easy | 5 | V | Disable token automounting for the default ServiceAccount in namespace kiosk and for the kiosk-ui Pods. |
| `xks-apiserver-anonymous` | cks:cluster-hardening | Disable anonymous API access | hard | 10 | K | Turn off anonymous authentication on the qm-ledger API server and confirm the admin kubeconfig still works. |
| `xks-node-restriction` | cks:cluster-hardening | Enable the NodeRestriction admission plugin | medium | 8 | K | Enable NodeRestriction on the qm-fleet API server so kubelets can only modify their own Node and Pods. |
| `xks-apparmor-profile-pod` | cks:system-hardening | Apply an AppArmor profile to a Pod | medium | 8 | K | Load the provided AppArmor profile on fleet-wk-1 and run the scanner Pod there with that profile enforced. |
| `xks-seccomp-localhost` | cks:system-hardening | Apply a custom seccomp profile | medium | 7 | K | Run the label-render Pod with the Localhost seccomp profile placed under the kubelet's seccomp directory. |
| `xks-remove-service-port` | cks:system-hardening | Remove an unneeded service from a node | medium | 7 | K | Stop, disable and remove the package behind the unexpected listener on fleet-wk-2 so only expected ports remain open. |
| `xks-kubelet-webhook-authz` | cks:system-hardening | Require authorization on the kubelet API | hard | 10 | K | Configure dispatch-wk-1's kubelet for Webhook authentication and authorization with anonymous access off, keeping the node Ready. |
| `xks-pss-restricted` | cks:microservice-vulnerabilities | Enforce restricted Pod Security on a namespace | medium | 8 | V | Enforce the restricted level on namespace partner-apps and fix the partner-sync Deployment so its Pods are admitted. |
| `xks-runtimeclass-move` | cks:microservice-vulnerabilities | Move a workload to a sandboxed runtime | medium | 7 | K | Create RuntimeClass sandboxed for the gVisor handler and run the pdf-convert Deployment with it. |
| `xks-encryption-config` | cks:microservice-vulnerabilities | Encrypt one resource type at rest | hard | 12 | K | Configure an encryption provider for Secrets on the qm-capacity API server and re-write the existing Secrets in namespace billing. |
| `xks-immutable-secret` | cks:microservice-vulnerabilities | Make a Secret immutable and mount it read-only | easy | 5 | V | Recreate Secret signing-key as immutable and mount it read-only at /run/signing in the signer Pod. |
| `xks-drop-privileged` | cks:microservice-vulnerabilities | Remove privileged settings from a Deployment | medium | 7 | V | Remove privileged mode and hostPath mounts from the log-collector Deployment while it keeps reading its emptyDir log volume. |
| `xks-wireguard-cni` | cks:microservice-vulnerabilities | Turn on pod-to-pod encryption | hard | 10 | K | Enable the CNI's WireGuard encryption on qm-customs and write the encryption status reported by the CNI to the given file. |
| `xks-scan-pick-image` | cks:supply-chain-security | Remove workloads using images with critical CVEs | medium | 8 | K | Scan the images of the four Deployments in namespace intake and scale to zero those whose images have critical vulnerabilities. |
| `xks-sbom-spdx` | cks:supply-chain-security | Generate an SBOM for an image | easy | 5 | K | Generate an SPDX JSON SBOM for the dispatch image and save it at the given path. |
| `xks-registry-vap` | cks:supply-chain-security | Admit only approved registries | hard | 10 | V | Create a ValidatingAdmissionPolicy and binding that rejects Pods in namespace intake using images outside registry.quillmoor.example. |
| `xks-dockerfile-hardening` | cks:supply-chain-security | Harden a Containerfile | medium | 7 | K | Change the given Containerfile so it uses the pinned minimal base, runs as a non-root user and drops the build tools from the final stage. |
| `xks-manifest-static-fix` | cks:supply-chain-security | Fix risky settings found by static analysis | medium | 7 | V | Fix the two settings the analyser flags in the given Deployment manifest so a rescan reports no findings, then apply it. |
| `xks-signature-verify` | cks:supply-chain-security | Verify image signatures before deployment | medium | 8 | K | Verify the signatures of three tagged images with the given public key and deploy only the one that verifies. |
| `xks-audit-policy-secrets` | cks:monitoring-runtime-security | Write and enable an audit policy | hard | 12 | K | Enable audit logging on the qm-ledger API server with a policy that records Secret access at Metadata level and nothing for Events. |
| `xks-runtime-alert-scale` | cks:monitoring-runtime-security | Act on a runtime detection alert | medium | 8 | K | Find which Pod triggered the runtime alert for unexpected package installs and scale its Deployment to zero. |
| `xks-detection-rule-output` | cks:monitoring-runtime-security | Adjust a detection rule's output | medium | 8 | K | Change the provided runtime rule so its alert includes the container name and user, and write one resulting alert line to the given file. |
| `xks-readonly-rootfs` | cks:monitoring-runtime-security | Make a container's filesystem read-only | easy | 6 | V | Set a read-only root filesystem on the ticket-printer Deployment and give /tmp an emptyDir so it stays Running. |
| `xks-audit-log-reader` | cks:monitoring-runtime-security | Find who read a Secret in the audit log | medium | 7 | K | Search the existing audit log on ledger-cp-1 and write the user that read Secret partner-token to the given file. |
| `xks-incident-isolate-pod` | cks:monitoring-runtime-security | Isolate a flagged Pod for investigation | medium | 7 | K | Isolate the Pod named in the incident ticket with a deny-all NetworkPolicy, keep it running for forensics and label it quarantine=true. |

</details>

### Linux system administrator practical exam simulation

Aligns to: lfcs.

**Duration** 120 min. **Pass mark** 67% (The certifying body does not publish a fixed pass mark for every exam version; 67% is a CloudTrain setting to be calibrated from pilot data.). **Tasks** 18, environment shared, tier C.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| lfcs:operations-deployment | 25% | 5 | 10 |
| lfcs:networking | 25% | 4 | 8 |
| lfcs:storage | 20% | 4 | 8 |
| lfcs:essential-commands | 20% | 3 | 6 |
| lfcs:users-groups | 10% | 2 | 4 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: local man pages and /usr/share/doc only; no internet. Partial credit: per-check. One shared environment: an Ubuntu LTS VM as the main host plus one Enterprise Linux VM for the tasks that need SELinux or EL tooling; tasks state which host to use. The exam is distribution-neutral, so checks grade end state, not the tool used.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks from each objective pool and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percentage against the pass mark; per-task pass/fail with learner-safe check messages (no expected values); time used per task; skill evidence fed to the learner model; recommended labs for objectives below 60%.

_CloudTrain is not affiliated with or endorsed by The Linux Foundation. LFCS is a trademark of The Linux Foundation. This exam simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (36 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xlf-persist-sysctl-pair` | lfcs:operations-deployment | Persist two kernel parameters on the depot gateway | easy | 6 | C | Set two kernel parameters named in the task on depot-gw now and at boot, leaving the rest of the sysctl configuration untouched. |
| `xlf-repo-install-hold` | lfcs:operations-deployment | Install a held package version from the vendor mirror | medium | 8 | C | Add the vendor apt source with its key, install the exact signalling-agent version requested and hold it. |
| `xlf-timer-housekeeping` | lfcs:operations-deployment | Schedule a housekeeping script with a timer | medium | 8 | C | Run the cache-purge script every 20 minutes through a systemd timer that catches up after downtime. |
| `xlf-kill-memory-hog` | lfcs:operations-deployment | Stop the process exhausting memory and prevent its restart | easy | 6 | C | Identify the process consuming the most memory, stop it, and disable the unit that keeps respawning it. |
| `xlf-recover-fstab-boot` | lfcs:operations-deployment | Make a host with a bad fstab entry boot cleanly | hard | 12 | C | Fix the fstab entry that drops the EL node into emergency mode so it reaches multi-user and the volume mounts. |
| `xlf-container-restart-policy` | lfcs:operations-deployment | Run a container that restarts and keeps its data | medium | 8 | C | Run the given image with a published port, a named volume for its data directory and an always-restart policy. |
| `xlf-selinux-enforce-fix` | lfcs:operations-deployment | Switch the EL node to enforcing without breaking its web service | hard | 10 | C | Set SELinux to enforcing persistently on the EL node and fix the file context so its web content is still served. |
| `xlf-libvirt-autostart` | lfcs:operations-deployment | Make an existing VM start with its host | medium | 8 | C | Configure the defined libvirt guest to autostart, give it the requested memory size and start it. |
| `xlf-cron-as-user` | lfcs:operations-deployment | Schedule a report job for a service account | easy | 6 | C | Schedule the given report command for the service account at the requested times, with its output appended to the requested log. |
| `xlf-module-load-options` | lfcs:operations-deployment | Load a kernel module with options at boot | medium | 6 | C | Make the named module load at every boot with the requested option value. |
| `xlf-static-ip-netplan` | lfcs:networking | Give the second interface a persistent dual-stack address | medium | 8 | C | Configure the requested IPv4 and IPv6 addresses on the secondary interface persistently. |
| `xlf-static-route-persist` | lfcs:networking | Add a persistent route to the depot network | easy | 6 | C | Route the given depot prefix through the given next hop, persistently. |
| `xlf-nat-redirect` | lfcs:networking | Redirect a public port to a backend | hard | 10 | C | Forward the requested port on the gateway to the backend host and port, with forwarding enabled persistently. |
| `xlf-firewall-subnet-only` | lfcs:networking | Allow a service from one subnet only | medium | 8 | C | Permit the requested TCP port only from the given subnet and keep SSH open, persistently. |
| `xlf-sshd-restrict-group` | lfcs:networking | Restrict SSH logins to one group with keys only | medium | 8 | C | Change sshd so only the given group may log in and only with keys, without locking out the current session. |
| `xlf-nginx-lb-two-backends` | lfcs:networking | Load-balance two local backends behind nginx | medium | 10 | C | Serve the given hostname on port 80 and balance across the two running backends. |
| `xlf-bond-config` | lfcs:networking | Bond two interfaces in active-backup mode | hard | 10 | C | Create a persistent active-backup bond of the two spare interfaces with the requested address. |
| `xlf-time-sync-server` | lfcs:networking | Point the host at the lab time server | easy | 6 | C | Synchronise the host's clock only from the given in-lab time server and set the requested time zone. |
| `xlf-lvm-new-volume` | lfcs:storage | Create a mounted logical volume of a given size | medium | 10 | C | Create the requested VG and LV from the spare disks, format and mount it persistently at the given path. |
| `xlf-lvm-grow-fs` | lfcs:storage | Extend a volume and its filesystem online | easy | 6 | C | Grow the given LV to the requested size and its filesystem without unmounting. |
| `xlf-swap-file` | lfcs:storage | Add a persistent swap file | easy | 6 | C | Add a swap file of the requested size, active now and after reboot. |
| `xlf-nfs-client-mount` | lfcs:storage | Mount an NFS export persistently | easy | 6 | C | Mount the given export at the given path with the requested options so it survives reboot. |
| `xlf-autofs-map` | lfcs:storage | Automount per-user shares on demand | hard | 10 | C | Configure autofs so the given directory mounts each user's share from the file server on access. |
| `xlf-repair-xfs` | lfcs:storage | Repair and remount a damaged filesystem | medium | 8 | C | Repair the filesystem on the given device and mount it at its usual place. |
| `xlf-raid1-create` | lfcs:storage | Build a mirrored array from two disks | hard | 10 | C | Create a RAID 1 array from the two spare disks, persist its definition and mount a filesystem on it. |
| `xlf-tmpfs-mount` | lfcs:storage | Mount a size-limited tmpfs | easy | 5 | C | Mount a tmpfs of the requested size and mode at the given path, persistently. |
| `xlf-find-and-copy` | lfcs:essential-commands | Find files by criteria and copy them preserving paths | medium | 8 | C | Copy every file matching the given owner, size and age criteria into the target directory with paths preserved. |
| `xlf-git-commit-push` | lfcs:essential-commands | Commit a fix to a branch and push it | easy | 6 | C | Clone the given repository, commit the requested change on a new branch and push it to the server. |
| `xlf-cert-self-signed` | lfcs:essential-commands | Create a key and certificate with given subject fields | medium | 8 | C | Generate a key and a certificate with the requested subject, SANs and validity at the given paths. |
| `xlf-free-disk-space` | lfcs:essential-commands | Free space on a full filesystem without data loss | medium | 8 | C | Bring the given filesystem below the requested usage without deleting the protected data set. |
| `xlf-service-unit-create` | lfcs:essential-commands | Create a service for a provided binary | medium | 8 | C | Create and enable a unit that runs the given binary as the given user and restarts it on failure. |
| `xlf-archive-compare` | lfcs:essential-commands | Archive a tree and report the differences from a backup | easy | 6 | C | Create the requested compressed archive and write the list of files that differ from the given backup to a file. |
| `xlf-user-limits` | lfcs:users-groups | Limit a user's processes | easy | 5 | C | Apply the requested hard and soft process limits to the given user. |
| `xlf-acl-shared-dir` | lfcs:users-groups | Grant a second group access with default ACLs | medium | 6 | C | Give the given group read-write access to a directory and every future file in it using ACLs. |
| `xlf-skel-profile` | lfcs:users-groups | Give new users a default environment | easy | 5 | C | Make every newly created user get the given environment variable and file in their home. |
| `xlf-ldap-user-login` | lfcs:users-groups | Allow a directory user to log in | hard | 12 | C | Configure the host so the given directory user can log in with a home directory created automatically. |

</details>

### Enterprise Linux administrator practical exam simulation

Aligns to: Red Hat Certified System Administrator (RHCSA) objective themes, RHEL 10 with RHEL 9 toggle.

**Duration** 180 min. **Pass mark** 70% (Mirrors the commonly published 210/300 threshold of the real exam; the real exam publishes no objective weights, so blueprint weights are CloudTrain weights.). **Tasks** 20, environment shared, tier C.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| rhcsa-aligned:essential-tools | 15% | 3 | 6 |
| rhcsa-aligned:software | 8% | 2 | 4 |
| rhcsa-aligned:scripts | 7% | 1 | 2 |
| rhcsa-aligned:running-systems | 12% | 2 | 4 |
| rhcsa-aligned:local-storage | 12% | 3 | 6 |
| rhcsa-aligned:filesystems | 10% | 2 | 4 |
| rhcsa-aligned:deploy-maintain | 12% | 2 | 4 |
| rhcsa-aligned:networking | 8% | 2 | 4 |
| rhcsa-aligned:users-groups | 8% | 2 | 4 |
| rhcsa-aligned:security | 8% | 1 | 2 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: yes. Docs: local man pages and offline product documentation only; no internet. Partial credit: per-task. Two Enterprise Linux 10 VMs (node 1 and node 2). Both VMs are rebooted before grading and every task is graded after the reboot; configuration that does not persist scores zero. RHEL 9 variant toggle: swaps the Flatpak and timer tasks for container (Podman/Quadlet) and SELinux-denial tasks and adds set-GID directory tasks.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks from each objective pool and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percentage against the pass mark; per-task pass/fail with learner-safe check messages (no expected values); time used per task; skill evidence fed to the learner model; recommended labs for objectives below 60%; which tasks failed only after the reboot (persistence failures).

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. RHCSA is a trademark of Red Hat, Inc. This exam simulation covers objectives aligned to that exam; passing it confers no certification. It runs on a CloudTrain Enterprise Linux image based on AlmaLinux._

<details><summary>Task pool (40 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xel-grep-redirect-file` | rhcsa-aligned:essential-tools | Save matching lines from a file in original order | easy | 5 | C | Write every line of the given file that matches the given pattern, in order, to the target file. |
| `xel-find-owner-copy` | rhcsa-aligned:essential-tools | Copy all files owned by a user to a directory | easy | 5 | C | Copy every file owned by the given user into the target directory keeping attributes. |
| `xel-tar-bzip-archive` | rhcsa-aligned:essential-tools | Create a compressed archive of a directory | easy | 5 | C | Create the requested compressed tar of the given directory at the given path. |
| `xel-links-hard-soft` | rhcsa-aligned:essential-tools | Create hard and symbolic links as specified | easy | 4 | C | Create the requested hard link and symbolic link so both resolve to the given file. |
| `xel-permissions-umask` | rhcsa-aligned:essential-tools | Set ownership, modes and a user's umask | medium | 6 | C | Set the requested owner, group and mode on the given files and make the given user's default umask persistent. |
| `xel-scp-remote-copy` | rhcsa-aligned:essential-tools | Copy files securely between the two nodes | easy | 5 | C | Copy the given directory from node 2 to node 1 over SSH, preserving modes. |
| `xel-repo-config` | rhcsa-aligned:software | Configure the two local repositories | easy | 6 | C | Configure node 2 to use the given BaseOS and AppStream URLs with GPG checking. |
| `xel-install-remove-rpm` | rhcsa-aligned:software | Install and remove packages to a target state | easy | 5 | C | Install the requested packages and remove the unwanted one so the package set matches the task. |
| `xel-flatpak-remote` | rhcsa-aligned:software | Add a Flatpak remote and install an app | medium | 6 | C | Add the given local Flatpak remote system-wide and install the requested application from it. |
| `xel-update-single-pkg` | rhcsa-aligned:software | Update one package from a staged repository | medium | 6 | C | Update only the given package to the version in the staged repository, leaving everything else unchanged. |
| `xel-script-args-loop` | rhcsa-aligned:scripts | Write a script that processes its arguments | medium | 8 | C | Write the script at the given path that loops over its arguments and prints the requested output, exiting non-zero on no arguments. |
| `xel-script-find-report` | rhcsa-aligned:scripts | Write a script that reports files by condition | medium | 8 | C | Write a script that finds files matching the given size and type and writes their names to the requested file, using a conditional on its argument. |
| `xel-root-password-reset` | rhcsa-aligned:running-systems | Reset the root password of node 2 | hard | 10 | C | Set node 2's unknown root password to the given value through the boot process. |
| `xel-tuned-profile` | rhcsa-aligned:running-systems | Apply the recommended tuning profile | easy | 4 | C | Set the tuning profile that the tool recommends for node 1, persistently. |
| `xel-journal-persistent` | rhcsa-aligned:running-systems | Make the journal persistent | easy | 5 | C | Configure the journal on node 1 to persist across reboots. |
| `xel-nice-process` | rhcsa-aligned:running-systems | Start a job at a given priority | easy | 4 | C | Run the given job at the requested niceness as the given user and keep it running. |
| `xel-gpt-partition-lv` | rhcsa-aligned:local-storage | Create a volume group with a given extent size | medium | 8 | C | Create the requested VG with the given extent size and an LV of the requested number of extents. |
| `xel-swap-partition` | rhcsa-aligned:local-storage | Add a swap partition without touching existing ones | medium | 6 | C | Add a swap partition of the requested size on the second disk, active at boot, leaving existing swap intact. |
| `xel-mount-by-label` | rhcsa-aligned:local-storage | Mount a new filesystem by label | easy | 6 | C | Create a filesystem with the given label on a new partition and mount it by label at the given path. |
| `xel-add-pv-extend-vg` | rhcsa-aligned:local-storage | Extend a volume group with a new partition | medium | 6 | C | Add a new partition to the existing volume group without disturbing data on the disk. |
| `xel-mount-by-uuid` | rhcsa-aligned:local-storage | Mount a logical volume by UUID | easy | 5 | C | Mount the given LV by UUID at the given path with the requested options, persistently. |
| `xel-remove-lv-safely` | rhcsa-aligned:local-storage | Retire a logical volume cleanly | easy | 5 | C | Unmount and remove the given LV and its fstab entry so the host still boots cleanly. |
| `xel-resize-lv-fs` | rhcsa-aligned:filesystems | Resize a logical volume to a size range | medium | 6 | C | Resize the given LV and its filesystem to a size within the requested range without data loss. |
| `xel-autofs-home` | rhcsa-aligned:filesystems | Automount a remote user's home directory | hard | 10 | C | Configure autofs so the given user's home mounts from the NFS server on login. |
| `xel-vfat-mount` | rhcsa-aligned:filesystems | Create and mount a vfat filesystem | easy | 5 | C | Create a vfat filesystem on the given LV and mount it with the requested owner, persistently. |
| `xel-fix-dir-permissions` | rhcsa-aligned:filesystems | Fix a permission problem on a shared directory | medium | 5 | C | Members of the given group cannot write to the shared directory; fix ownership and mode so they can, without opening it to others. |
| `xel-chrony-client` | rhcsa-aligned:deploy-maintain | Synchronise time with the classroom server | easy | 5 | C | Configure node 1 as a chrony client of the given server only. |
| `xel-default-target` | rhcsa-aligned:deploy-maintain | Set the default boot target | easy | 4 | C | Make node 2 boot into the requested target by default. |
| `xel-timer-job` | rhcsa-aligned:deploy-maintain | Schedule a job with a systemd timer | medium | 8 | C | Run the given command at the requested calendar time with a systemd timer. |
| `xel-kernel-arg` | rhcsa-aligned:deploy-maintain | Add a kernel argument for every kernel | medium | 6 | C | Add the requested kernel argument to every installed kernel's command line. |
| `xel-nmcli-static` | rhcsa-aligned:networking | Configure a static address, gateway and DNS | medium | 8 | C | Configure node 2's network with the given IPv4 and IPv6 settings and hostname, persistently. |
| `xel-hosts-resolution` | rhcsa-aligned:networking | Make a short name resolve locally | easy | 4 | C | Make the given short and full names resolve to the given address on both nodes. |
| `xel-firewalld-service` | rhcsa-aligned:networking | Allow a service through firewalld | easy | 5 | C | Permit the requested service and port permanently in the default zone. |
| `xel-enable-network-service` | rhcsa-aligned:networking | Run a network service at boot | easy | 5 | C | Make the given network service start at boot and listen on its port. |
| `xel-users-supplementary` | rhcsa-aligned:users-groups | Create users with supplementary groups and a nologin account | easy | 6 | C | Create the given users, groups and one account without interactive shell, with the requested passwords. |
| `xel-password-aging` | rhcsa-aligned:users-groups | Apply password aging to a user and defaults | easy | 5 | C | Set the requested maximum password age for the given user and for all new users. |
| `xel-sudo-group-nopasswd` | rhcsa-aligned:users-groups | Grant a group passwordless sudo | easy | 5 | C | Allow members of the given group to run any command via sudo without a password. |
| `xel-user-uid-expire` | rhcsa-aligned:users-groups | Create a user with fixed UID and expiry | easy | 4 | C | Create the given user with the requested UID and account expiry date. |
| `xel-selinux-port-httpd` | rhcsa-aligned:security | Serve web content on a non-standard port under SELinux | hard | 10 | C | Make the web server serve the given directory on the given port with SELinux enforcing, persistently. |
| `xel-ssh-key-boolean` | rhcsa-aligned:security | Set up key login and a persistent SELinux boolean | medium | 8 | C | Enable key-based login for the given user from node 1 to node 2 and set the requested SELinux boolean persistently. |

</details>

### Linux professional scenario exam simulation

Aligns to: CompTIA Linux+ (XK0-006) domains.

**Simulation note.** The real exam is mostly multiple choice with a few performance-based items. CloudTrain does not reproduce its question format: it simulates the exam's scenario objectives (including the troubleshooting symptom lists) as short hands-on tasks graded on end state. Recall-only objectives are covered by quizzes outside this simulation.

**Duration** 90 min. **Pass mark** 72% (Mirrors the published 720 on a 100-900 scale; CloudTrain scores in percent of weighted checks.). **Tasks** 20, environment per-task, tier B.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| linuxplus:system-management | 23% | 5 | 10 |
| linuxplus:services-users | 20% | 4 | 8 |
| linuxplus:security | 18% | 4 | 8 |
| linuxplus:automation-scripting | 17% | 3 | 6 |
| linuxplus:troubleshooting | 22% | 4 | 8 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: local man pages only. Partial credit: per-check. Each task gets its own small environment (Tier A pod or Tier B Kata pod) that starts when the learner opens it; Debian-family and Enterprise Linux images are mixed because the objectives test both firewalld and ufw, NetworkManager and Netplan.

**Retakes.** 2 free retake(s); 12 h cooldown; at most 4 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percentage against the pass mark; per-task pass/fail with learner-safe check messages (no expected values); time used per task; skill evidence fed to the learner model; recommended labs for objectives below 60%.

_CloudTrain is not affiliated with or endorsed by CompTIA. Linux+ is a trademark of CompTIA. This exam simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (40 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xlp-netplan-address` | linuxplus:system-management | Apply a Netplan address change safely | medium | 5 | B | Change the secondary interface to the requested address through Netplan and apply it. |
| `xlp-lvm-raid-mount-opts` | linuxplus:system-management | Mount a volume with restrictive options | easy | 4 | B | Mount the given LV at the given path with noexec and nosuid, persistently. |
| `xlp-backup-restore-tar` | linuxplus:system-management | Restore one directory from a backup archive | easy | 4 | A | Restore only the requested directory from the given archive to its original place with ownership intact. |
| `xlp-fhs-locate-config` | linuxplus:system-management | Locate the files the auditor asks for | easy | 4 | A | Write the paths of the requested config, log and variable-data files of the given service to the answer file. |
| `xlp-lvm-extend-vg` | linuxplus:system-management | Extend a volume group and logical volume | medium | 6 | B | Add the spare disk to the VG and grow the given LV and its filesystem by the requested size. |
| `xlp-module-info` | linuxplus:system-management | Report and load a kernel module | easy | 4 | B | Load the given module and write its version and parameters to the answer file. |
| `xlp-hardware-report` | linuxplus:system-management | Report CPU, memory and disks | easy | 4 | B | Write the CPU count, total memory and block device sizes of the host to the answer file in the requested format. |
| `xlp-raid-status` | linuxplus:system-management | Report and repair a RAID array's state | medium | 6 | B | Report the degraded array's state to the answer file and re-add the replacement disk. |
| `xlp-sysctl-runtime` | linuxplus:system-management | Change a kernel parameter persistently | easy | 3 | B | Set the given kernel parameter to the requested value now and at boot. |
| `xlp-shell-pipeline` | linuxplus:system-management | Answer a question with a one-line pipeline | easy | 4 | A | Write the count of unique failed source addresses in the given log to the answer file. |
| `xlp-user-group-membership` | linuxplus:services-users | Fix a user's group membership | easy | 3 | A | Make the given user a member of the requested supplementary groups without removing existing ones. |
| `xlp-systemd-enable-mask` | linuxplus:services-users | Set the requested states of three units | easy | 4 | B | Leave the three given units enabled, disabled and masked as requested. |
| `xlp-container-network` | linuxplus:services-users | Run two containers on a shared network | medium | 6 | B | Run the two given containers on a user-defined network so the client reaches the server by name. |
| `xlp-pip-venv-tool` | linuxplus:services-users | Install a tool in a virtual environment from the offline index | easy | 4 | A | Create a venv at the given path and install the requested package version from the offline index. |
| `xlp-at-job` | linuxplus:services-users | Schedule a one-off job | easy | 3 | A | Schedule the given command to run once at the requested time as the given user. |
| `xlp-dns-dhcp-service` | linuxplus:services-users | Add a host record to the local DNS service | medium | 6 | A | Add the requested A and PTR records to the running local DNS service and make them resolve. |
| `xlp-process-priority` | linuxplus:services-users | Renice a running process tree | easy | 3 | A | Lower the priority of the given process and all its children to the requested niceness. |
| `xlp-web-vhost` | linuxplus:services-users | Add a virtual host to the web server | medium | 6 | A | Serve the given hostname from the given directory on the running web server. |
| `xlp-ufw-rules` | linuxplus:security | Allow two services and deny the rest with ufw | easy | 4 | B | Configure the host firewall to allow the two requested services and deny other inbound traffic. |
| `xlp-firewalld-rich-rule` | linuxplus:security | Add a firewalld rich rule for one subnet | medium | 5 | B | Allow the requested port only from the given subnet with a permanent rich rule. |
| `xlp-sudoers-limited` | linuxplus:security | Grant one command via sudo | easy | 4 | A | Allow the given user to run only the requested command as root via a validated drop-in. |
| `xlp-ssh-disable-root` | linuxplus:security | Disable root and password SSH logins | easy | 4 | A | Disable root login and password authentication over SSH and keep key login for the given user working. |
| `xlp-luks-open-mount` | linuxplus:security | Open and mount an encrypted volume | medium | 5 | B | Unlock the given LUKS volume with the provided key file and mount it at the requested path. |
| `xlp-setuid-audit` | linuxplus:security | Remove an unexpected setuid bit | medium | 5 | A | Find the setuid file that is not on the approved list and remove its setuid bit. |
| `xlp-faillock-policy` | linuxplus:security | Lock accounts after repeated failures | medium | 6 | B | Configure the authentication stack to lock an account after the requested number of failures. |
| `xlp-checksum-verify` | linuxplus:security | Identify the tampered download | easy | 4 | A | Verify the downloads against the signed checksum list and write the name of the one that fails to the answer file. |
| `xlp-script-fix-loop` | linuxplus:automation-scripting | Fix a broken loop in a provided script | medium | 6 | A | Correct the provided script so it processes every input line and produces the expected output file. |
| `xlp-git-revert-commit` | linuxplus:automation-scripting | Revert a bad commit and push | medium | 5 | A | Revert the commit that broke the config in the given repository and push the result. |
| `xlp-python-parse-json` | linuxplus:automation-scripting | Extract a value from JSON with a short Python script | medium | 6 | A | Write a Python script that prints the requested field from every record of the given JSON file. |
| `xlp-cloud-init-userdata` | linuxplus:automation-scripting | Correct a cloud-init user-data file | medium | 6 | A | Fix the provided user-data so it creates the requested user and package set, validated by the cloud-init schema check. |
| `xlp-sed-bulk-edit` | linuxplus:automation-scripting | Change a setting in many config files at once | easy | 4 | A | Change the requested key's value in every matching config file under the given directory, leaving other lines intact. |
| `xlp-script-exit-codes` | linuxplus:automation-scripting | Make a script return meaningful exit codes | easy | 5 | A | Change the provided health-check script to exit 0, 1 or 2 for the three documented states. |
| `xlp-fix-disk-full` | linuxplus:troubleshooting | Restore writes on a full filesystem | medium | 5 | A | Free space on the full filesystem so the given service can write again, without deleting protected data. |
| `xlp-fix-unit-start` | linuxplus:troubleshooting | Make a failing unit start | medium | 6 | B | Fix the given unit so it starts and stays active. |
| `xlp-fix-dns-client` | linuxplus:troubleshooting | Restore name resolution | easy | 4 | A | Make the given internal name resolve again from this host. |
| `xlp-fix-default-route` | linuxplus:troubleshooting | Restore connectivity to the outside subnet | medium | 5 | B | Make the host reach the given remote subnet again by fixing its routing. |
| `xlp-fix-high-load` | linuxplus:troubleshooting | Bring load back to normal | medium | 6 | B | Find the cause of the high load average and stop it without killing the protected service. |
| `xlp-fix-permission-denied` | linuxplus:troubleshooting | Fix a permission-denied error for an app user | easy | 4 | A | Let the given application user read its config again with the minimum permission change. |
| `xlp-fix-oom-service` | linuxplus:troubleshooting | Stop a service from being OOM-killed | hard | 8 | B | Identify why the given service is repeatedly OOM-killed and change the limit or culprit so it stays up. |
| `xlp-fix-time-skew` | linuxplus:troubleshooting | Fix certificate errors caused by clock skew | medium | 5 | B | TLS clients fail on this host; find the clock problem and make time synchronise with the lab server. |

</details>

### Container practitioner practical exam simulation

Aligns to: Docker practitioner practical blueprint (CloudTrain-defined).

The main containers exam. No live hands-on Docker exam exists (the legacy associate exam is multiple choice on a 2020 blueprint), so CloudTrain defines one: twelve end-state-graded tasks on one Engine 29 host, weighted by the docker-practitioner blueprint (the legacy domains modernised plus supply chain and operations).

**Duration** 150 min. **Pass mark** 70% (CloudTrain setting; no vendor pass mark applies.). **Tasks** 12, environment shared, tier C.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| docker-practitioner:build | 18% | 2 | 4 |
| docker-practitioner:registry | 8% | 1 | 2 |
| docker-practitioner:compose | 15% | 2 | 4 |
| docker-practitioner:networking | 15% | 2 | 4 |
| docker-practitioner:storage | 8% | 1 | 2 |
| docker-practitioner:security | 10% | 1 | 2 |
| docker-practitioner:supply-chain | 10% | 1 | 2 |
| docker-practitioner:operations | 16% | 2 | 4 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: yes. Docs: offline Docker documentation and man pages only; no internet. Partial credit: per-task. One docker-vm:29 host (Engine 29, containerd image store) with a local TLS registry; the grader restarts the engine and reboots the VM, then checks end state. Tasks that feed later tasks (for example reports:1.0) are seeded when the producing task is not drawn.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percent against the pass mark; per-task pass/fail with learner-safe messages; which checks failed only after the restart or reboot; time used per task; skill deltas fed to the learner model; recommended Docker path labs for weak objectives.

_CloudTrain is not affiliated with or endorsed by Docker, Inc. or Mirantis, Inc. Docker is a trademark of Docker, Inc. This simulation follows a CloudTrain-defined blueprint; it is aligned to no vendor exam and passing it confers no certification._

<details><summary>Task pool (24 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xcd-build-multistage-nonroot` | docker-practitioner:build | Build the report service as a small non-root image | medium | 12 | C | Write a Dockerfile for the supplied Go report service that compiles in one stage and ships on a minimal base running as UID 10001, tagged reports:1.0 and under 30 MB. |
| `xcd-build-cache-secret` | docker-practitioner:build | Build with a cached dependency step and a secret token | medium | 12 | C | Build pricing:2.0 so the dependency download uses a BuildKit cache mount and reads the package token from a build secret, leaving no trace of the token in any layer or in the image history. |
| `xcd-build-bake-targets` | docker-practitioner:build | Build two images from one Bake definition | medium | 10 | C | Write a Bake file whose default group builds the api and worker images with a shared VERSION variable and OCI source labels, so a single bake call produces both tags. |
| `xcd-build-entrypoint-signals` | docker-practitioner:build | Make the worker take arguments and stop cleanly | medium | 10 | C | Fix the worker image so arguments after the image name reach the program, a stop ends it within two seconds instead of the full timeout, and its health status turns healthy. |
| `xcd-registry-tls-push` | docker-practitioner:registry | Push a release by digest to the authenticated registry | medium | 10 | C | Log in to the exam registry over TLS with the supplied CA, push reports:1.0 and record its digest in ~/digest.txt so a pull by that digest succeeds on a clean engine. |
| `xcd-registry-multiarch-index` | docker-practitioner:registry | Publish a two-platform image index | hard | 12 | C | Publish tools:1.4 for linux/amd64 and linux/arm64 as one index in the exam registry so inspecting the index lists both platforms with their own digests. |
| `xcd-compose-health-order` | docker-practitioner:compose | Start an API only after its database is healthy | medium | 12 | C | Complete compose.yaml so the api service starts only after db reports healthy, restarts on failure and answers on 127.0.0.1:8081. |
| `xcd-compose-env-profiles` | docker-practitioner:compose | Drive a stack from an env file with an optional profile | medium | 10 | C | Make the stack take its image tag and port from .env.staging and start the adminer service only when the debug profile is enabled. |
| `xcd-compose-secret-file` | docker-practitioner:compose | Give two services a password as a Compose secret | medium | 10 | C | Deliver the database password to the db and api services as a file-based Compose secret so neither container's environment nor its inspect output shows it. |
| `xcd-compose-fix-broken-stack` | docker-practitioner:compose | Repair a Compose stack that fails to start | medium | 12 | C | The supplied three-service stack fails on up; fix its network, volume and port mistakes so every service is running and the web front answers on port 8088. |
| `xcd-net-user-bridge` | docker-practitioner:networking | Connect two services by name on an isolated network | medium | 10 | C | Create network backend with subnet 172.30.8.0/24 and run cache and api on it so api reaches cache by name and neither is attached to the default bridge. |
| `xcd-net-publish-loopback` | docker-practitioner:networking | Publish a metrics port on loopback only | easy | 6 | C | Run the metrics service so port 9100 is published on 127.0.0.1 only and on no other host address. |
| `xcd-net-docker-user-rule` | docker-practitioner:networking | Allow a published port from one subnet only | hard | 15 | C | Restrict published port 8443 so only clients from 10.20.0.0/24 reach it, through the engine's user chain, in a way that survives an engine restart and a reboot. |
| `xcd-net-address-pool` | docker-practitioner:networking | Keep new networks off a reserved range | medium | 12 | C | Change the engine's default address pools so new networks come from 10.210.0.0/16 in /24 blocks, then recreate the app network so it no longer overlaps the office range. |
| `xcd-storage-volume-restore` | docker-practitioner:storage | Restore a volume from a backup archive | medium | 10 | C | Restore /backup/ledger.tar into a new volume ledger-data and run the ledger service on it so the restored rows are served. |
| `xcd-storage-mount-mix` | docker-practitioner:storage | Mount configuration, data and scratch correctly | easy | 8 | C | Run the indexer with its configuration bind-mounted read-only from /srv/indexer/conf, its index on the named volume index-data and /tmp as a 64 MB tmpfs. |
| `xcd-sec-least-privilege` | docker-practitioner:security | Run a gateway with minimal privileges | medium | 10 | C | Run the gateway with every capability dropped except NET_BIND_SERVICE, no-new-privileges, a read-only root filesystem and a pids limit of 100, still answering on port 80. |
| `xcd-sec-socket-proxy` | docker-practitioner:security | Take the engine socket away from a monitoring container | hard | 15 | C | The monitoring container mounts the engine socket read-write; redeploy it behind a socket proxy that only allows listing containers so its dashboard still works and it can no longer start containers. |
| `xcd-supply-sbom-sign` | docker-practitioner:supply-chain | Attach an SBOM and a signature to a release | hard | 15 | C | Build and push reports:1.1 with an SBOM attestation, sign its digest with the supplied cosign key and show that verification with the public key succeeds. |
| `xcd-supply-leaked-secret` | docker-practitioner:supply-chain | Remove a credential baked into an image | medium | 12 | C | The api:3.2 image carries a storage key in a layer and in an ENV; rebuild it so no layer, history entry or config field holds the key and push the clean image under the same tag. |
| `xcd-ops-log-rotation` | docker-practitioner:operations | Cap container logs engine-wide | easy | 8 | C | Configure the engine so new containers use the local log driver with 10 MB files and at most three per container, and recreate the chatty service so it uses them. |
| `xcd-ops-oom-diagnose` | docker-practitioner:operations | Diagnose and fix an exit 137 | medium | 10 | C | The import job exits with code 137; record the reason in ~/exam/import-reason.txt and rerun it with a memory limit that lets it finish while staying under 512 MB. |
| `xcd-ops-restart-survive` | docker-practitioner:operations | Keep a service running across engine restarts | easy | 6 | C | Make the beacon service come back after an engine restart and a host reboot but stay stopped after a manual stop. |
| `xcd-ops-debug-shell-less` | docker-practitioner:operations | Diagnose a shell-less service returning errors | medium | 12 | C | The distroless pricing service returns 500; attach a debug container that shares its namespaces, find the missing configuration key and fix the run so it answers 200. |

</details>

### Rootless container practical exam simulation (optional)

Aligns to: Red Hat cloud-native containers exam (EX188) objective themes.

Optional and smaller since revision 2: the Podman track is five labs, so the simulation keeps the reboot-graded, SELinux-enforcing format of the only performance-based container exam but draws eight tasks in 90 minutes. Learners who want a Docker credential-style check take the container practitioner simulation instead.

**Duration** 90 min. **Pass mark** 70% (The real exam reports a scaled score with a published passing threshold; 70% is a CloudTrain setting for this simulation.). **Tasks** 8, environment shared, tier C.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| ex188-aligned:build-images | 25% | 2 | 4 |
| ex188-aligned:manage-images | 20% | 2 | 4 |
| ex188-aligned:run-containers | 20% | 2 | 4 |
| ex188-aligned:multi-container | 20% | 1 | 2 |
| ex188-aligned:troubleshoot | 15% | 1 | 2 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: yes. Docs: local man pages and offline Podman documentation only; no internet. Partial credit: per-task. One podman-vm:5 host (SELinux enforcing) with a local TLS registry; the grader reboots the VM, then checks end state. Tasks drawn so build tasks feeding later tasks (e.g. media-api image) are seeded if the build task is not drawn.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percent against the pass mark; per-task pass/fail with learner-safe messages; which checks failed only after the reboot; time used per task; skill deltas fed to the learner model; recommended Podman-track labs for weak objectives.

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Specialist in Containers is a trademark of Red Hat, Inc. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (16 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xct-build-media-containerfile` | ex188-aligned:build-images | Build the media API image from a Containerfile | medium | 15 | C | Write a Containerfile for the supplied media API that runs as UID 1001 from /opt/media, exposes 8080 and builds as localhost/media-api:1.0. |
| `xct-build-entrypoint-cmd` | ex188-aligned:build-images | Make the report tool accept arguments after the image name | medium | 10 | C | Rebuild localhost/report-tool so its program is the fixed entrypoint and --daily is only the default argument, so passing --weekly at run time replaces just the argument. |
| `xct-build-volume-selinux` | ex188-aligned:build-images | Serve host content through an image-declared volume | medium | 12 | C | Build localhost/static-web with /srv/www declared as a volume and run it as static-web with the host directory /exam/www mounted there with the correct SELinux label so pages are served on port 8081. |
| `xct-build-arbitrary-uid` | ex188-aligned:build-images | Build an image that works under any assigned UID | hard | 12 | C | Adjust the queue-worker image so its data directory is group-0 owned and group-writable, letting the container start and write data when run with an arbitrary UID such as 1000650000. |
| `xct-manage-registry-push` | ex188-aligned:manage-images | Push to the authenticated exam registry over TLS | medium | 10 | C | Trust the exam registry's CA, log in as exam-push and push localhost/media-api:1.0 as registry.exam.example:5443/media/api:1.0 so it can be pulled back by digest. |
| `xct-manage-short-names` | ex188-aligned:manage-images | Make a short image name resolve unambiguously | medium | 8 | C | Configure the user's registries settings so podman pull ledger fetches registry.exam.example:5443/finance/ledger without prompting and without querying any other registry. |
| `xct-manage-image-archive` | ex188-aligned:manage-images | Back up an image to an archive file | easy | 6 | C | Save localhost/caption-api:2.1 with its tag to /exam/backup/caption-api.tar so loading the archive on a clean system recreates the tagged image. |
| `xct-manage-container-state` | ex188-aligned:manage-images | Capture a modified container's state as a new image | easy | 6 | C | The running container tuner has hand-made changes; preserve its current filesystem as localhost/tuner:snapshot without stopping it. |
| `xct-run-ports-env` | ex188-aligned:run-containers | Run a service with published port and environment | easy | 6 | C | Run localhost/media-api:1.0 as container media-api with MEDIA_REGION=north, publishing container port 8080 on host port 18080. |
| `xct-run-persistent-db` | ex188-aligned:run-containers | Run a database whose data outlives the container | medium | 10 | C | Run the supplied PostgreSQL image as ledger-db with its data on the named volume ledger-data, so removing and recreating the container keeps the seeded table. |
| `xct-run-quadlet-service` | ex188-aligned:run-containers | Run a container as a service that survives reboot | hard | 15 | C | Make the container media-api start automatically for user examuser at boot as a systemd service so it is running and answering on port 18080 after the grader reboots the system. |
| `xct-run-rootless-user` | ex188-aligned:run-containers | Run a rootless container as a specific unprivileged user | medium | 8 | C | As examuser, run localhost/static-web rootless as container docs-web on host port 8082 with the process inside running as UID 1001. |
| `xct-multi-pod-api-db` | ex188-aligned:multi-container | Assemble an API and database in one pod | medium | 15 | C | Create pod ledger-pod publishing 8085 with the ledger API and its database inside it, the API reaching the database on localhost and returning the ledger summary from outside. |
| `xct-multi-kube-play` | ex188-aligned:multi-container | Start a multi-container application from Kubernetes YAML | medium | 12 | C | Start the application described in /exam/catalog.yaml with podman kube play, fixing the one wrong image reference in it, so its web container answers on host port 8086. |
| `xct-trouble-crashloop` | ex188-aligned:troubleshoot | Get a crash-looping container running | medium | 10 | C | Container metrics-agent exits immediately after start; read its logs, correct the misnamed configuration variable and leave it running. |
| `xct-trouble-selinux-mount` | ex188-aligned:troubleshoot | Fix a container that cannot read its mounted data | medium | 10 | C | Container report-web returns 403 because it cannot read /exam/reports; fix the mount so it serves the reports while SELinux stays enforcing. |

</details>

### Infrastructure as code associate exam simulation

Aligns to: HashiCorp Terraform Associate (004) objective themes.

**Simulation note.** The real associate exam is multiple choice. CloudTrain simulates its objectives as short hands-on tasks graded on files, state and plan output; the hosted-platform objective is graded through layout-design and run-log reading tasks, with no hosted account.

**Duration** 60 min. **Pass mark** 70% (The vendor does not publish a pass mark for this exam; 70 percent is a CloudTrain setting.). **Tasks** 12, environment shared, tier A.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| tf-associate:iac-concepts | 8% | 1 | 2 |
| tf-associate:fundamentals | 10% | 1 | 2 |
| tf-associate:core-workflow | 12% | 1 | 2 |
| tf-associate:configuration | 20% | 2 | 4 |
| tf-associate:custom-conditions | 8% | 1 | 2 |
| tf-associate:secrets | 7% | 1 | 3 |
| tf-associate:modules | 12% | 2 | 4 |
| tf-associate:state | 12% | 1 | 2 |
| tf-associate:maintain | 6% | 1 | 2 |
| tf-associate:hcp | 5% | 1 | 2 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: offline Terraform and provider documentation only; no web access. Partial credit: per-check. Terraform 1.15 CLI with tasks scoped to the Terraform 1.12 objectives. Grading reads files, state and plan output, so tasks also pass under OpenTofu if the binary is swapped. Each task has its own directory in one shared workspace pod plus a vcluster.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percent against the pass mark; per-task pass/fail with learner-safe check messages; skill deltas fed to the learner model; time used per task; recommended labs for objectives below 70 percent.

_CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and Terraform Associate are trademarks of HashiCorp. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (25 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xia-declarative-rewrite` | tf-associate:iac-concepts | Replace a provisioning script with a declarative config | easy | 6 | A | Rewrite a shell script that creates three farm config files into a config producing identical files, idempotent on re-apply. |
| `xia-predict-plan-actions` | tf-associate:iac-concepts | Predict plan actions for a change set | easy | 6 | A | Given a config, its state and a change, record in answer.json which addresses will be created, updated in place or replaced, then confirm with plan. |
| `xia-pin-provider-offline` | tf-associate:fundamentals | Constrain a provider and record its lock hashes | easy | 5 | A | Constrain the random provider to the approved minor range and produce a lock file with hashes for two platforms from the offline mirror. |
| `xia-mirror-cli-config` | tf-associate:fundamentals | Install providers only from a filesystem mirror | medium | 6 | A | Write CLI configuration so providers install only from /opt/provider-mirror with direct downloads disabled, and init the telemetry stack. |
| `xia-saved-plan-apply` | tf-associate:core-workflow | Apply a saved plan and destroy one stack | easy | 6 | A | Save a plan for the survey stack to survey.tfplan, apply exactly that plan, then destroy the scratch stack leaving the survey stack intact. |
| `xia-fmt-validate-gate` | tf-associate:core-workflow | Make a stack pass format and validation gates | easy | 5 | A | Fix the farm-alerts stack so fmt -check and validate both pass with the planned resources unchanged. |
| `xia-variable-validation` | tf-associate:configuration | Add a typed, validated input with a default | easy | 6 | A | Add variable farm_region restricted to three regions with a default, used in every resource label, and make an invalid value fail at plan. |
| `xia-for-each-namespaces` | tf-associate:configuration | Create namespaces from a map with for_each | medium | 7 | V | Create one namespace per entry of the substations map with its voltage as a label, keyed by substation name. |
| `xia-ignore-operator-annotations` | tf-associate:configuration | Stop an operator's annotations from showing as drift | medium | 6 | V | The forecast Deployment shows changes on every plan because an operator writes annotations; make plans converge without removing them. |
| `xia-ordering-helm-secret` | tf-associate:configuration | Order a release after its credentials | medium | 6 | V | Make a clean apply of the collector stack succeed by ordering the Helm release after the Secret it mounts. |
| `xia-precondition-label` | tf-associate:custom-conditions | Refuse to plan into an unlabelled namespace | medium | 6 | V | Add a precondition so the dashboard stack fails at plan with a clear message when its namespace lacks the cost-centre label. |
| `xia-check-block-endpoint` | tf-associate:custom-conditions | Warn when the telemetry endpoint is unhealthy | medium | 6 | V | Add a check block that warns, without failing the apply, when the telemetry health endpoint does not return 200. |
| `xia-sensitive-redaction` | tf-associate:secrets | Redact a password in plans and outputs | easy | 5 | A | Mark the broker password input and the output derived from it sensitive so neither appears in plan or output text. |
| `xia-write-only-password` | tf-associate:secrets | Pass a generated password without storing it | hard | 8 | V | Generate the forecast database password as an ephemeral value and pass it through a write-only argument so the state holds no password. |
| `xia-ephemeral-provider-token` | tf-associate:secrets | Keep a provider token out of plans and state | medium | 6 | V | Change the stack so the cluster token arrives through an ephemeral input variable and reaches the kubernetes provider without appearing in the saved plan or in state. |
| `xia-call-local-module` | tf-associate:modules | Call a local module twice | easy | 6 | V | Call ./modules/farm-base for farms gullhaven and redmoor with their quota inputs and expose both namespace names as outputs. |
| `xia-git-module-pin` | tf-associate:modules | Pin a git module to a tag | easy | 5 | A | Switch the inland stack to the farm-base module on the internal Git server pinned to tag v1.3.0 and init it. |
| `xia-module-output-wiring` | tf-associate:modules | Wire one module's output into another | medium | 7 | V | Feed the storage module's claim name into the workload module so the Deployment mounts it, with no hard-coded names. |
| `xia-module-input-contract` | tf-associate:modules | Tighten a module's input contract | medium | 6 | A | Give module turbine-alerts typed inputs with validation and a description each so a wrong threshold type fails at plan. |
| `xia-s3-backend-migrate` | tf-associate:state | Migrate state to an S3 backend with locking | medium | 7 | A | Move the survey stack's local state to bucket saltmarsh-exam with lockfile locking and leave no local state file. |
| `xia-state-rename` | tf-associate:state | Rename a resource without recreating it | easy | 5 | V | Rename resource kubernetes_config_map.cfg to farm_settings so the plan shows a move and the ConfigMap keeps its UID. |
| `xia-import-namespace` | tf-associate:maintain | Bring an existing namespace under management | medium | 6 | V | Adopt the hand-made namespace storm-response with an import block so the following plan is empty. |
| `xia-debug-log-file` | tf-associate:maintain | Capture provider debug logs to a file | easy | 5 | A | Reproduce the failing plan with trace logging written to /var/log/iac/plan-trace.log and record the failing API path in answer.txt. |
| `xia-workspace-layout-design` | tf-associate:hcp | Lay out teams on a hosted workspace model | easy | 5 | A | Complete layout.yaml assigning the trading and telemetry teams' projects, workspaces and variable sets so the stated isolation rules hold. |
| `xia-run-log-reading` | tf-associate:hcp | Read a hosted run export and answer from it | easy | 5 | A | From an exported remote run log and workspace settings, record which variable set and execution mode the failed run used. |

</details>

### Infrastructure as code advanced lab exam simulation

Aligns to: HashiCorp Terraform Authoring and Operations (Advanced) lab exam themes.

**Duration** 240 min. **Pass mark** 70% (The vendor publishes neither duration nor pass mark for the lab exam; both are CloudTrain settings.). **Tasks** 9, environment shared, tier V.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| tf-advanced:lifecycle-import-drift | 25% | 2 | 4 |
| tf-advanced:dynamic-config | 20% | 2 | 4 |
| tf-advanced:collaboration | 15% | 1 | 2 |
| tf-advanced:modules | 20% | 2 | 4 |
| tf-advanced:providers | 20% | 2 | 4 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: offline Terraform and provider documentation and the offline module registry only; no general web access. Partial credit: per-check. Terraform 1.15 CLI. Multi-task scenarios on one pre-provisioned workstation with a vcluster, Moto and the S3 state store; each task graded on configuration, state read from the backend by a read-only grader, live target truth and plan -detailed-exitcode convergence.

**Retakes.** 1 free retake(s); 72 h cooldown; at most 2 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different scenarios and new parameters

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percent against the pass mark; per-task result split into config, state and live-target layers; skill deltas fed to the learner model; time used per task; recommended labs for weak objectives.

_CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and the Terraform Authoring and Operations certification names are trademarks of HashiCorp. This simulation covers objectives aligned to that exam; passing it confers no certification. Targets are Moto and Kubernetes, not AWS._

<details><summary>Task pool (18 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xiv-import-bucket-fleet` | tf-advanced:lifecycle-import-drift | Adopt an unmanaged bucket fleet | hard | 25 | A | Bring the six hand-made telemetry archive buckets on the AWS-shaped endpoint under management with for_each and import blocks so the plan is empty. |
| `xiv-reconcile-sg-drift` | tf-advanced:lifecycle-import-drift | Reconcile a drifted security group | hard | 20 | A | Restore the trading desk's security group to the approved rule set after out-of-band edits, keeping the one rule change control approved. |
| `xiv-adopt-workloads-generated` | tf-advanced:lifecycle-import-drift | Adopt running workloads with generated config | hard | 20 | V | Adopt the hand-deployed forecast Deployment and Service with generated configuration, clean the generated code and converge. |
| `xiv-replace-and-protect` | tf-advanced:lifecycle-import-drift | Replace a corrupted instance and protect its peer | medium | 15 | A | Force replacement of the corrupted pricing instance only, and protect the matching archive bucket against destroy. |
| `xiv-subnets-from-map` | tf-advanced:dynamic-config | Derive subnets and routes from a zone map | hard | 25 | A | Replace hard-coded subnets with ones computed from a zone map via cidrsubnet, keeping existing subnets in place with moved blocks. |
| `xiv-dynamic-ingress-rules` | tf-advanced:dynamic-config | Generate ingress rules from a service catalogue | medium | 20 | V | Generate NetworkPolicy ingress rules for each telemetry service from a catalogue variable with dynamic blocks. |
| `xiv-conditional-env-resources` | tf-advanced:dynamic-config | Create resources only where the environment needs them | medium | 20 | V | Create the debug dashboard and its Service only in staging and the PodDisruptionBudget only in prod, from one configuration. |
| `xiv-templated-configmaps` | tf-advanced:dynamic-config | Render per-farm configuration from templates | medium | 15 | V | Render one ConfigMap per farm from a template file and a farm map so adding a farm needs only a map entry. |
| `xiv-remote-state-consumer` | tf-advanced:collaboration | Consume another team's outputs from remote state | medium | 20 | A | Make the pricing stack read its subnet and bucket names from the network stack's remote state instead of literals, both converged. |
| `xiv-cross-stack-outputs` | tf-advanced:collaboration | Publish a stable output contract for other stacks | hard | 25 | A | Expose the network stack's ids as a versioned output object and update its two consumers so all three stacks plan empty. |
| `xiv-extract-vpc-module` | tf-advanced:modules | Extract a network module without destroying anything | hard | 25 | A | Move the trading VPC, subnets and route tables into a local network module with moved blocks so the plan is empty. |
| `xiv-module-upgrade-git` | tf-advanced:modules | Upgrade a shared module across a breaking release | hard | 25 | V | Upgrade farm-base from v1 to v2 on the internal Git server, adapting renamed inputs and moved resources with no recreation. |
| `xiv-split-workload-module` | tf-advanced:modules | Split workload resources into a module | medium | 20 | V | Split the forecast Deployment, Service and HPA into a workload module with a typed contract, preserving every object. |
| `xiv-module-for-each` | tf-advanced:modules | Instantiate a module per farm | medium | 20 | V | Replace three copy-pasted module calls with one module for_each over a farm map, keeping all resources in place. |
| `xiv-provider-alias-regions` | tf-advanced:providers | Deploy a replica bucket in a second region | medium | 20 | A | Add an aliased AWS-shaped provider for the second region and create the replica archive bucket there from the same module. |
| `xiv-provider-major-upgrade` | tf-advanced:providers | Complete a forced provider major upgrade | hard | 25 | V | Upgrade the telemetry stack to the next kubernetes provider major, fix its removed attributes and leave the lock file and plan clean. |
| `xiv-fix-provider-auth` | tf-advanced:providers | Repair a broken provider configuration | medium | 15 | V | The inland stack cannot authenticate to its cluster; diagnose from logs and fix the provider configuration without static secrets in code. |
| `xiv-provider-endpoints` | tf-advanced:providers | Point a provider at private service endpoints | medium | 15 | A | Configure the AWS-shaped provider for the private endpoint set, path-style buckets and skipped metadata checks so plan and apply work offline. |

</details>

### Enterprise Linux automation practical exam simulation

Aligns to: Red Hat Ansible automation exam (EX294) objective themes.

**Duration** 240 min. **Pass mark** 70% (Red Hat publishes a 210/300 passing score for its practical exams; 70 percent here is a CloudTrain setting chosen to match, not an official mark.). **Tasks** 15, environment shared, tier C.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| ex294-aligned:rhcsa-baseline | 5% | 1 | 2 |
| ex294-aligned:core-components | 12% | 2 | 4 |
| ex294-aligned:config-inventory | 8% | 1 | 2 |
| ex294-aligned:managed-nodes | 8% | 1 | 2 |
| ex294-aligned:run-content | 8% | 1 | 2 |
| ex294-aligned:git-devworkflow | 7% | 1 | 2 |
| ex294-aligned:plays-errors | 12% | 2 | 4 |
| ex294-aligned:roles-collections | 12% | 2 | 6 |
| ex294-aligned:automate-system-tasks | 20% | 3 | 8 |
| ex294-aligned:templates-vault | 8% | 1 | 2 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: yes. Docs: local man pages, ansible-doc and navigator doc, and the offline product documentation on the control node only. Partial credit: per-check. One control node (ansible-ctl) plus four fresh el-vm:10 managed nodes shared by every task. Grading runs in order: end-state checks over SSH, then each saved playbook under /home/devops/ansible is re-run and must report changed=0 and no failures, then every managed node is rebooted and the end-state checks run again. Only state that survives the reboot scores; playbook text is never graded.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks from each pool and new parameters (user names, sizes, ports, paths)

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percent against the pass mark; per-task pass/fail with learner-safe check messages; which checks failed only after the reboot or only on the idempotency re-run; time used per task (from terminal activity); skill deltas fed to the learner model; recommended labs for each objective below 70 percent.

_CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Engineer (RHCE) is a trademark of Red Hat, Inc. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (34 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xan-baseline-control-user` | ex294-aligned:rhcsa-baseline | Prepare the exam control node account | easy | 8 | C | On the control node, create user devops with an SSH key pair and a project directory /home/devops/ansible owned by it, and confirm the key is accepted by every managed node's devops account. |
| `xan-baseline-script-output` | ex294-aligned:rhcsa-baseline | Run a provided script and capture its result | easy | 6 | C | A supplied shell script prints the host's role; run it on the control node with the given argument and save only its last line to /home/devops/role.txt. |
| `xan-core-adhoc-repos` | ex294-aligned:core-components | Configure repositories on every node with an ad-hoc script | medium | 12 | C | Write /home/devops/ansible/repos.sh that uses only ad-hoc commands to configure the BaseOS and AppStream repositories from the exam mirror with GPG checking on every node; it must run cleanly twice. |
| `xan-core-loop-groups-users` | ex294-aligned:core-components | Create users from a list with per-group rules | medium | 15 | C | From the supplied user_list.yml, create users whose job is developer on dev hosts with supplementary group devops and users whose job is manager on prod hosts with group opsmgr, all with UIDs from the file. |
| `xan-core-facts-hwreport` | ex294-aligned:core-components | Write a hardware report from facts | medium | 15 | C | Produce /root/hwreport.txt on each managed node with inventory hostname, memory in MiB, BIOS version and the size of disk vdb, writing NONE for any value the host lacks. |
| `xan-core-handler-web` | ex294-aligned:core-components | Deploy a web server that restarts only on change | easy | 12 | C | Install and enable httpd on the web group, deploy the supplied index file and a config change through a handler, and make a second run report no changes. |
| `xan-inventory-groups-cfg` | ex294-aligned:config-inventory | Build the exam inventory and project configuration | easy | 10 | C | Create an inventory with groups dev, test, prod and balancers plus a parent group webservers containing prod, and an ansible.cfg that sets that inventory, the roles and collections paths and remote user devops. |
| `xan-inventory-connection-overrides` | ex294-aligned:config-inventory | Reach a node on a non-standard SSH port | easy | 8 | C | One managed node listens for SSH on port 2202 under a different address; add the per-host connection overrides so every node answers a ping without changing the node. |
| `xan-nodes-bootstrap-keys` | ex294-aligned:managed-nodes | Bootstrap managed nodes with a key and sudo rule | medium | 12 | C | Using the one-time root password, create user devops on every managed node with the control node's public key and passwordless sudo in a drop-in file, then disable password login for devops. |
| `xan-nodes-become-defaults` | ex294-aligned:managed-nodes | Set privilege escalation defaults for the project | medium | 10 | C | Configure the project so plays escalate with sudo to root by default without prompting, except the reporting group which must run unprivileged, and show both behaviours with a whoami play. |
| `xan-run-navigator-artifact` | ex294-aligned:run-content | Run a playbook through navigator and keep its artifact | easy | 8 | C | Configure navigator to run without an execution environment in stdout mode with artifacts saved under /home/devops/ansible/artifacts, then run the supplied playbook so its artifact file exists. |
| `xan-run-limit-tags` | ex294-aligned:run-content | Run part of a playbook against part of the fleet | easy | 8 | C | Run only the tasks tagged motd from the supplied site playbook against the test group only, with both ansible-playbook and navigator, leaving all other hosts untouched. |
| `xan-git-push-project` | ex294-aligned:git-devworkflow | Commit and push the exam project | easy | 8 | C | Clone the exam repository, add your playbooks under playbooks/, exclude artifacts and vault password files, and push to branch exam so the server holds every playbook you wrote. |
| `xan-git-branch-fix-run` | ex294-aligned:git-devworkflow | Fix a playbook from another branch and run it | medium | 12 | C | Check out branch hotfix from the exam repository, fix the broken task it contains, commit with the given message, push it and run the playbook so its end state appears on the dev hosts. |
| `xan-errors-block-rescue-file` | ex294-aligned:plays-errors | Fall back when a configuration file is missing | medium | 12 | C | Append a line to /etc/exam/app.conf on all nodes; where the file is missing, create it from a template in a rescue block, and always write a timestamped line to /var/log/exam-run.log. |
| `xan-errors-failed-when-check` | ex294-aligned:plays-errors | Fail a play on an unacceptable command result | medium | 10 | C | Run the supplied health command on every node, register it, and fail the host with the message 'health check failed' when its output contains DEGRADED, without stopping the play on other hosts. |
| `xan-errors-register-branch` | ex294-aligned:plays-errors | Branch on a registered package query | medium | 12 | C | Query whether the legacy agent package is installed on each node, remove it and install the new agent only where it was present, and write the list of migrated hosts to /home/devops/migrated.txt. |
| `xan-errors-wait-service` | ex294-aligned:plays-errors | Wait for a slow service before continuing | medium | 10 | C | Start the supplied slow-starting service on the prod hosts and retry its status URL until it returns 200, at most 10 attempts 5 seconds apart, before deploying the page that depends on it. |
| `xan-roles-requirements` | ex294-aligned:roles-collections | Install roles and a collection from the exam share | easy | 8 | C | Install the two roles and one collection listed in the supplied requirements file from the exam file share into the project's roles and collections paths, under the names given. |
| `xan-roles-author-web` | ex294-aligned:roles-collections | Write a web role driven by defaults | medium | 18 | C | Create role webpage that installs httpd, opens the firewall and renders an index page showing the host's FQDN and IPv4 address from a template, and apply it to the webservers group. |
| `xan-roles-system-timesync` | ex294-aligned:roles-collections | Configure time sources with the timesync system role | easy | 10 | C | Use the timesync system role so every node uses the exam NTP server with iburst and sources survive a reboot. |
| `xan-roles-system-selinux` | ex294-aligned:roles-collections | Set SELinux state with the selinux system role | medium | 12 | C | Use the selinux system role to put all nodes in enforcing mode with the targeted policy and enable the boolean that lets httpd reach the network, persisting across a reboot. |
| `xan-roles-galaxy-role-use` | ex294-aligned:roles-collections | Use an installed role with overridden variables | medium | 12 | C | Apply the installed balancer role to the balancers group with the webservers as backends by overriding its documented variables, so the balancer page alternates between backends. |
| `xan-roles-argument-spec` | ex294-aligned:roles-collections | Reject invalid input to a role | medium | 10 | C | Add an argument spec to role report so it requires report_dir as a path and report_level as one of brief or full, and show a run with an invalid level fails before any task runs. |
| `xan-sys-lvm-volumes` | ex294-aligned:automate-system-tasks | Create logical volumes where capacity allows | hard | 20 | C | Create LV data of 1500 MiB in VG research on all nodes, falling back to 800 MiB with a warning where the VG is too small and printing 'volume group does not exist' where it is missing; format ext4 without mounting. |
| `xan-sys-partition-mount` | ex294-aligned:automate-system-tasks | Partition a disk and mount it persistently | medium | 15 | C | On the test hosts create a 1 GiB partition on vdc, format it xfs and mount it at /mnt/archive by UUID so it is mounted after a reboot. |
| `xan-sys-vault-users` | ex294-aligned:automate-system-tasks | Create users with vaulted password hashes | medium | 15 | C | Create the users in the supplied list with password hashes derived from a vault-encrypted variable file and its password file, using SHA-512 hashes and the group memberships given. |
| `xan-sys-cron-at` | ex294-aligned:automate-system-tasks | Schedule a recurring and a one-off job | easy | 10 | C | Install a cron job for user natasha that logs a heartbeat every two minutes and an at job that writes a marker file in 30 minutes on the dev hosts, with the cron job surviving re-runs without duplicates. |
| `xan-sys-firewalld-selinux-web` | ex294-aligned:automate-system-tasks | Publish web content from a custom directory with SELinux enforcing | hard | 20 | C | Serve /webdev on the dev hosts through httpd with the correct SELinux context, a symlink from the document root, a group-owned setgid directory for webdev users and the http service open in firewalld permanently. |
| `xan-sys-boot-target-sysctl` | ex294-aligned:automate-system-tasks | Set the default target and a persistent kernel parameter | easy | 10 | C | Set multi-user as the default target on all nodes and vm.swappiness to 10 persistently on the prod hosts, both verified after the grader's reboot. |
| `xan-sys-archive-fetch` | ex294-aligned:automate-system-tasks | Archive configuration and fetch it to the control node | easy | 8 | C | Archive /etc/httpd on the webservers into a bzip2 tarball named after the host and fetch each archive into /home/devops/backups on the control node. |
| `xan-sys-packages-groups` | ex294-aligned:automate-system-tasks | Install package groups by host group | easy | 10 | C | Install php and mariadb on dev, test and prod hosts, the Development Tools group on dev hosts only, and update every package on dev hosts to the latest mirror version. |
| `xan-tpl-hosts-file` | ex294-aligned:templates-vault | Generate a hosts file from inventory facts | medium | 15 | C | Render /etc/myhosts on the dev hosts from a template that lists every inventory host's IPv4 address, FQDN and short name in the same format as /etc/hosts. |
| `xan-tpl-vault-rekey` | ex294-aligned:templates-vault | Create and rekey an encrypted variables file | easy | 8 | C | Create locker.yml with two given variables encrypted with the first vault password, then rekey it to the second password stored in secret.txt, leaving the content unchanged. |

</details>

### Associate network engineer practical exam simulation

Aligns to: ccna.

**Simulation note.** The real exam is mainly multiple choice with some simulation items on vendor CLI. CloudTrain simulates its practical objectives on open network stacks (FRR, Linux bridges and hosts, SR Linux) and grades end state, not commands. Wireless, port-security and DHCP-snooping objectives cannot be reproduced authentically and are covered by quizzes, not by this practical.

**Duration** 120 min. **Pass mark** 80% (The vendor does not publish a pass mark; 80 percent is a CloudTrain setting to be calibrated with pilot cohorts.). **Tasks** 15, environment shared, tier N.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| ccna:network-fundamentals | 20% | 3 | 6 |
| ccna:network-access | 20% | 3 | 6 |
| ccna:ip-connectivity | 25% | 4 | 8 |
| ccna:ip-services | 10% | 2 | 4 |
| ccna:security-fundamentals | 15% | 2 | 4 |
| ccna:automation-programmability | 10% | 1 | 2 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: no. Docs: local man pages, FRR and SR Linux offline documentation only. Partial credit: per-check. One shared district topology for all tasks; tasks touch disjoint devices or VLANs so the drawn set never conflicts. Failover checks (floating static, VRRP, LACP) are run by the grader by shutting links after the timer ends.

**Retakes.** 1 free retake(s); 24 h cooldown; at most 3 attempts per 30 days; every attempt draws fresh tasks and parameters. a retake draws different tasks and new parameters (addresses, VLAN ids, router names)

**Score report.** Breakdown by objective, task, skill; expected values are never shown. per-objective percent against the pass mark; per-task pass/fail with learner-safe check messages; skill deltas fed to the learner model; time used per task; recommended labs for each objective below 70 percent; reminder that wireless and port-security objectives are assessed by quiz, not here.

_CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. CCNA is a trademark of Cisco Systems, Inc. This simulation covers objectives aligned to that exam; passing it confers no certification._

<details><summary>Task pool (30 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xnt-subnet-admin-block` | ccna:network-fundamentals | Address a new admin VLAN from a given block | medium | 8 | N | Choose the smallest subnet of 10.60.8.0/21 that fits 200 administration hosts, configure the gateway and two hosts with it, and make both reach the gateway. |
| `xnt-ipv6-office-slaac` | ccna:network-fundamentals | Give an office LAN IPv6 with SLAAC | medium | 8 | N | Assign the given global /64 to the office router interface and advertise it so both office hosts autoconfigure and reach the router over IPv6. |
| `xnt-fix-host-gateway` | ccna:network-fundamentals | Repair a host's addressing and gateway | easy | 5 | N | A staff host on the north campus cannot leave its subnet; correct its prefix length and default gateway so it reaches the district office server. |
| `xnt-capture-dns-transport` | ccna:network-fundamentals | Record the transport details of a name lookup | easy | 6 | N | Capture a name lookup from the annex host and write the transport protocol, the server port and the client port it used to the given file. |
| `xnt-neighbour-link-local` | ccna:network-fundamentals | Report a neighbour's link-local and MAC address | easy | 5 | N | Write the IPv6 link-local address and MAC address of the router that is the east campus default gateway to the given file, taken from the host's neighbour table. |
| `xnt-summary-route` | ccna:network-fundamentals | Summarise four campus subnets into one route | medium | 8 | N | Replace the four static routes for the north campus subnets on the core router with the single smallest summary route that covers all four and nothing more. |
| `xnt-vlan-guest-ports` | ccna:network-access | Move two switch ports into a guest VLAN | easy | 6 | N | Place two library ports on the south switch into a new guest VLAN 50 so the hosts there reach each other but no other VLAN on that switch. |
| `xnt-trunk-allowed-vlans` | ccna:network-access | Restrict a trunk to the required VLANs | medium | 8 | N | Change the north-campus trunk so it carries only VLANs 20, 30 and 50 with VLAN 99 native, keeping hosts in those VLANs reachable across it. |
| `xnt-native-vlan-repair` | ccna:network-access | Repair a trunk that leaks between VLANs | medium | 8 | N | Find and fix the native VLAN mismatch on the annex trunk so management hosts no longer reach student hosts and both VLANs still cross the trunk. |
| `xnt-rstp-root-choice` | ccna:network-access | Make a chosen switch the spanning-tree root | medium | 8 | N | Set rapid spanning tree priorities so the data-centre switch is root for the campus triangle and the named access link is the blocked one. |
| `xnt-lacp-server-bond` | ccna:network-access | Bundle two server links with LACP | medium | 8 | N | Aggregate the two links to the backup server with LACP so the bundle is up with both members active and the server survives losing either link. |
| `xnt-inter-vlan-annex` | ccna:network-access | Route between two annex VLANs on one link | medium | 8 | N | Add 802.1Q subinterfaces on the annex router for VLANs 20 and 30 so hosts in each VLAN reach the other through their gateway. |
| `xnt-static-campus-reachability` | ccna:ip-connectivity | Restore reachability between two campuses with static routes | easy | 6 | N | Add the static routes needed so the south and east campus LANs reach each other in both directions through the core. |
| `xnt-floating-backup-route` | ccna:ip-connectivity | Add a backup route that is used only on failure | medium | 8 | N | Add a floating static route over the radio link so the annex keeps reaching the core when the grader takes the fibre down, and the fibre path stays preferred while it is up. |
| `xnt-ipv6-default-route` | ccna:ip-connectivity | Give a campus router an IPv6 default route | medium | 6 | N | Configure an IPv6 default route on the north campus router via the core router's link-local address so north IPv6 hosts reach the district office. |
| `xnt-ospf-join-router` | ccna:ip-connectivity | Add a router to the OSPF backbone area | medium | 8 | N | Enable OSPFv2 area 0 on the new vocational annex router with the given router ID so its two LANs appear in every district routing table. |
| `xnt-ospf-dr-election` | ccna:ip-connectivity | Control the DR on a shared segment | medium | 8 | N | Make the named router DR and stop the other router from ever becoming DR or BDR on the data-centre segment, with all adjacencies Full afterwards. |
| `xnt-ospf-adjacency-repair` | ccna:ip-connectivity | Repair an OSPF neighbour that never reaches Full | medium | 10 | N | Find the parameter mismatch that keeps the east campus router out of Full state with the core, fix it and confirm the east LAN is learned by OSPF. |
| `xnt-vrrp-lab-gateway` | ccna:ip-connectivity | Provide a redundant gateway with VRRP | medium | 10 | N | Configure VRRP on the two science-wing routers with the given virtual address and priorities so hosts keep reaching the core when the master is shut down. |
| `xnt-route-preference-report` | ccna:ip-connectivity | Report which route forwards to a destination and why | medium | 6 | N | For three given destinations, write the prefix, source protocol and next hop the core router actually forwards with to the given file, where overlapping static and OSPF routes exist. |
| `xnt-dhcp-pool-reservation` | ccna:ip-services | Add a DHCP pool with one reservation | easy | 8 | N | Add a DHCP pool for the new guest VLAN with the correct gateway and DNS options and reserve one fixed address for the guest kiosk's MAC address. |
| `xnt-dhcp-relay-annex` | ccna:ip-services | Relay DHCP for a remote subnet | medium | 8 | N | Configure the annex router to relay DHCP to the data-centre server so annex student hosts lease addresses from their own pool. |
| `xnt-pat-student-vlan` | ccna:ip-services | Translate a VLAN to the edge address | medium | 8 | N | Add port address translation on the edge router so the new guest VLAN reaches the outside network using the edge's outside address, and no other subnet is affected. |
| `xnt-ntp-syslog-client` | ccna:ip-services | Point a router at the district time and log servers | easy | 6 | N | Make the east campus router synchronise time from the core and send messages of severity warning and above to the central syslog server. |
| `xnt-acl-printer-subnet` | ccna:security-fundamentals | Allow only print traffic into the printer subnet | medium | 10 | N | Filter traffic into the printer subnet so only staff hosts reach printers on TCP 631 and 9100 and all other traffic into that subnet is dropped. |
| `xnt-mgmt-ssh-only` | ccna:security-fundamentals | Restrict router management to SSH from admins | medium | 8 | N | Allow management of the south campus router only over SSH from the network-admin subnet and refuse it from everywhere else. |
| `xnt-wireguard-annex` | ccna:security-fundamentals | Bring up a site-to-site tunnel with given keys | medium | 10 | N | Complete the half-built WireGuard tunnel between the edge and the annex with the provided keys and route the annex staff subnet through it. |
| `xnt-snmpv3-only` | ccna:security-fundamentals | Replace community-based SNMP with SNMPv3 | medium | 8 | N | Remove community-based SNMP access from the edge router and add the given authenticated and encrypted SNMPv3 user readable only from the monitoring host. |
| `xnt-api-interface-desc` | ccna:automation-programmability | Set interface descriptions through a device API | medium | 10 | N | Using the switch's JSON-RPC API, set the descriptions given in a YAML file on three ports and write the API's response for one port to the given file. |
| `xnt-render-config-from-yaml` | ccna:automation-programmability | Render a router config from structured data | medium | 10 | N | Complete the provided Jinja2 template so it renders the annex router's interface addresses from the given YAML, apply the result and make the annex LANs reachable. |

</details>

### Platform engineer practical capstone

Aligns to: CloudTrain platform engineer capstone.

CloudTrain's internal capstone. One shared Quillmoor Logistics estate (build VMs, a kubeadm cluster, a vcluster tenant, an FRR edge and a lab registry) where the candidate takes the harbour-tracking service from host baseline to a hardened, routed, autoscaled deployment and then handles an injected incident. Tasks build on each other's environment but are graded independently, so an early miss does not zero later tasks.

**Duration** 240 min. **Pass mark** 70% (CloudTrain setting; calibrate after the pilot cohort.). **Tasks** 10, environment shared, tier K.

| Objective | Weight | Tasks | Pool |
| --- | --- | --- | --- |
| ct-platform:linux-foundation | 10% | 1 | 2 |
| ct-platform:containers-delivery | 15% | 2 | 4 |
| ct-platform:iac-provisioning | 15% | 1 | 2 |
| ct-platform:config-automation | 15% | 1 | 2 |
| ct-platform:kubernetes-operations | 20% | 2 | 4 |
| ct-platform:networking-connectivity | 10% | 1 | 2 |
| ct-platform:security-hardening | 10% | 1 | 2 |
| ct-platform:incident-response | 5% | 1 | 2 |

**Rules.** Hints: none. Timer: one timer across all tasks. Tasks in any order. Flag for review. Reboot before grading: yes. Docs: offline docs for every tool in the estate; no internet. Partial credit: per-check. VM tasks are re-checked after a reboot of the affected VMs; Ansible tasks are also re-run once and must report no changes.

**Retakes.** 1 free retake(s); 72 h cooldown; at most 2 attempts per 30 days; every attempt draws fresh tasks and parameters. Prerequisite: completion of at least three domain paths. A retake draws a different task per objective where the pool allows and new parameters for all.

**Score report.** Breakdown by objective, task, skill, domain; expected values are never shown. percent per objective against the pass mark; per-task pass/fail with learner-safe check messages; skill evidence fed to the learner model; time spent per task; recommended labs for each objective below 70 percent.

_CloudTrain internal assessment. It is not aligned to, affiliated with or endorsed by any certifying body and confers no external certification; a pass grants the CloudTrain platform engineer badge._

<details><summary>Task pool (20 tasks)</summary>

| Task | Objective | Title | Difficulty | Min | Tier | Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `xpe-host-baseline-service` | ct-platform:linux-foundation | Bring a build host to the platform baseline | medium | 20 | C | Configure qm-build-1 so the svc-ci user owns /srv/ci with setgid group sharing, a systemd unit ci-agent.service starts at boot after the network is online, and the journal is persistent. |
| `xpe-host-disk-and-mount` | ct-platform:linux-foundation | Give the artefact cache its own volume | medium | 20 | C | On qm-build-2 create a 2 GiB logical volume from the spare disk, format it XFS and mount it persistently at /var/cache/artefacts by UUID with noexec so it survives a reboot. |
| `xpe-image-build-push` | ct-platform:containers-delivery | Build and publish the tracking API image | medium | 20 | B | Build the harbour-tracking API from its Containerfile as a multi-stage image that runs as UID 10001, tag it by version and digest, and push it to the lab registry where the grader pulls it by digest. |
| `xpe-image-sign-verify` | ct-platform:containers-delivery | Sign the release image and attach its SBOM | hard | 20 | B | Generate an SBOM for the tracking API image, sign the image with the platform key pair, and leave both attached as referrers in the lab registry so verification with the public key succeeds. |
| `xpe-compose-local-stack` | ct-platform:containers-delivery | Run the tracking stack locally with health ordering | medium | 15 | B | Write a Compose file that starts the tracking API only after its Postgres service reports healthy, persists the database in a named volume and publishes the API on 127.0.0.1:8080 only. |
| `xpe-image-slim-fix` | ct-platform:containers-delivery | Shrink and fix a failing release image | medium | 20 | B | The label-printer image is 900 MB and ignores SIGTERM; rebuild it under 120 MB on a minimal base with an exec-form entrypoint so docker stop finishes in under 3 seconds. |
| `xpe-iac-namespace-baseline` | ct-platform:iac-provisioning | Provision tenant namespaces with a reusable module | hard | 25 | V | Write a local Terraform module that creates a namespace with a ResourceQuota and a default-deny NetworkPolicy, call it for three Quillmoor teams with for_each, and leave state in the lab S3 bucket with locking so a re-plan shows no changes. |
| `xpe-iac-import-drift` | ct-platform:iac-provisioning | Adopt hand-made cluster objects into state | hard | 25 | V | Bring the hand-created ConfigMap and Service of the tracking stack under Terraform management with import blocks, reconcile one drifted label, and finish with a plan that reports no changes. |
| `xpe-ansible-node-agents` | ct-platform:config-automation | Roll the node agent out to the build fleet | medium | 20 | C | Write a playbook that installs the node-agent package from the local mirror on every host in the builders group, templates its config from inventory variables and restarts it only when the config changes, idempotent on a second run. |
| `xpe-ansible-ssh-hardening` | ct-platform:config-automation | Enforce the SSH baseline across the fleet | medium | 20 | C | Write a role that disables password and root login in sshd, allows only the ops group and validates the config before reloading, applied to all build hosts with no changes reported on a re-run. |
| `xpe-k8s-deploy-tracking` | ct-platform:kubernetes-operations | Deploy the tracking API with probes and limits | medium | 20 | K | Deploy the signed tracking API image by digest to qm-harbour with 3 replicas, readiness and liveness probes, requests and limits, config from a ConfigMap and a ClusterIP Service selecting only its Pods. |
| `xpe-k8s-ingress-route` | ct-platform:kubernetes-operations | Route the public tracking host to the API | medium | 15 | K | Publish the tracking API under host track.quillmoor.example path /api through the cluster's Ingress controller with TLS from the provided certificate Secret. |
| `xpe-worker-notready-recovery` | ct-platform:kubernetes-operations | Return a NotReady worker to service | hard | 20 | K | Worker harbour-wk-2 went NotReady after the node-agent rollout; find the cause in the kubelet journal, repair it and confirm the node schedules Pods again. |
| `xpe-k8s-autoscale-tracking` | ct-platform:kubernetes-operations | Autoscale the tracking API on CPU | medium | 15 | K | Add a HorizontalPodAutoscaler that keeps the tracking API between 3 and 8 replicas at 70 percent average CPU utilisation and confirm it reads metrics. |
| `xpe-net-depot-route` | ct-platform:networking-connectivity | Reach the depot subnet from the harbour cluster | medium | 20 | N | Add OSPF adjacency between router qm-edge-1 and the depot router so the harbour cluster nodes reach 10.40.8.0/24, and the depot scanners reach the tracking Ingress address. |
| `xpe-net-edge-nat` | ct-platform:networking-connectivity | Give the harbour subnet controlled egress | medium | 20 | N | Configure source NAT on the Linux edge router so only the harbour node subnet reaches the upstream mirror network, with forwarding from every other subnet dropped. |
| `xpe-sec-restricted-namespace` | ct-platform:security-hardening | Enforce the restricted profile on the tracking namespace | medium | 15 | K | Label the tracking namespace to enforce the restricted Pod Security Standard and change the Deployment so its Pods still start: non-root, no privilege escalation, all capabilities dropped, RuntimeDefault seccomp. |
| `xpe-sec-least-privilege-ci` | ct-platform:security-hardening | Cut the CI service account down to what it uses | medium | 15 | K | The ci-deployer ServiceAccount holds cluster-admin; replace that with a namespaced Role that only lets it update Deployments and read Pods in the tracking namespace, and disable token automounting for other Pods. |
| `xpe-incident-tracking-outage` | ct-platform:incident-response | Restore the tracking service and write the timeline | hard | 30 | K | Customers see 503s from track.quillmoor.example; restore service end to end and record the root cause and the fixing change in /home/learner/incident/summary.txt in the given three-line format. |
| `xpe-incident-disk-pressure` | ct-platform:incident-response | Clear disk pressure on a build host and prevent recurrence | medium | 20 | C | qm-build-1 rejects new jobs because /var is full; free the space held by runaway logs, add a logrotate policy that keeps 7 compressed days, and record the cause in /home/learner/incident/disk.txt. |

</details>

## Appendix: proposed new skills

291 skills to merge into `content/skills.yaml` after approval.

<details><summary>New skills</summary>

| Skill | Name | Competency | Requires |
| --- | --- | --- | --- |
| `linux.shell.help-docs` | Find answers offline with man sections, info, --help and /usr/share/doc | linux.shell | linux.shell.navigation |
| `linux.shell.editors` | Edit files non-interactively and in vim without losing content | linux.shell | linux.shell.navigation |
| `linux.shell.regex-sed-awk` | Transform text with extended regular expressions, sed and awk | linux.shell | linux.shell.text-processing |
| `linux.shell.env-profiles` | Set personal and system-wide environment with profile files, aliases and skel | linux.shell | linux.shell.navigation |
| `linux.shell.robust-scripting` | Write defensive scripts with strict mode, traps, getopts and idempotent steps | linux.shell | linux.shell.scripting |
| `linux.shell.python-basics` | Write small admin tools in Python inside a virtual environment | linux.shell | linux.shell.scripting |
| `linux.files.find-locate` | Locate files by name, owner, size, age and type with find | linux.files | linux.shell.navigation |
| `linux.files.special-bits` | Apply setgid shared directories, sticky bits and audit setuid files | linux.files | linux.files.permissions |
| `linux.files.acls` | Grant access with POSIX ACLs, default ACLs and the mask | linux.files | linux.files.permissions |
| `linux.users.password-aging` | Enforce password aging, expiry and account locking | linux.users | linux.users.accounts |
| `linux.users.resource-limits` | Limit user resources with ulimit and pam_limits | linux.users | linux.users.accounts |
| `linux.identity.ldap-client` | Query and authenticate against an LDAP directory | linux.identity | linux.users.accounts |
| `linux.identity.sssd-pam` | Configure SSSD and the PAM stack for directory-backed logins | linux.identity | linux.identity.ldap-client, linux.systemd.units |
| `linux.systemd.unit-authoring` | Write service units with the right Type, User, ordering and restart policy | linux.systemd | linux.systemd.unit-editing |
| `linux.systemd.timers` | Schedule work with systemd timers and transient units | linux.systemd | linux.systemd.units, linux.processes.scheduled-jobs |
| `linux.systemd.targets` | Set the default target and isolate targets | linux.systemd | linux.systemd.units |
| `linux.systemd.time-locale` | Configure time zone, locale and the chrony client | linux.systemd | linux.systemd.units |
| `linux.systemd.unit-sandboxing` | Sandbox services with systemd hardening directives | linux.systemd | linux.systemd.unit-authoring |
| `linux.boot.grub` | Change kernel arguments and the default boot entry persistently | linux.boot | linux.systemd.targets |
| `linux.boot.recovery` | Recover a host that fails to boot (rescue targets, root password reset, broken fstab) | linux.boot | linux.boot.grub, linux.storage.mounts |
| `linux.boot.initramfs` | Rebuild the initramfs after driver or storage changes | linux.boot | linux.boot.grub |
| `linux.boot.analysis` | Analyse boot time and failed units | linux.boot | linux.systemd.journal |
| `linux.boot.tuned` | Select and verify tuning profiles | linux.boot | linux.systemd.units |
| `linux.kernel.sysctl` | Set kernel parameters at runtime and persistently | linux.kernel | linux.users.sudo |
| `linux.kernel.modules` | Load, configure and blacklist kernel modules | linux.kernel | linux.users.sudo |
| `linux.kernel.hardware-discovery` | Inventory CPU, memory, buses and block devices from /proc and /sys | linux.kernel | linux.shell.navigation |
| `linux.kernel.udev` | Write udev rules for stable device names and permissions | linux.kernel | linux.kernel.hardware-discovery |
| `linux.packages.dnf` | Install, remove, query and verify packages with dnf and rpm | linux.packages | linux.users.sudo |
| `linux.packages.flatpak` | Configure Flatpak remotes and install applications | linux.packages | linux.packages.dnf |
| `linux.packages.source-builds` | Build and install software from source and resolve shared libraries | linux.packages | linux.shell.scripting |
| `linux.packages.language-envs` | Install language packages offline with pip and venv and switch alternatives | linux.packages | linux.shell.navigation |
| `linux.storage.space-analysis` | Find what fills a filesystem, including inodes and deleted-but-open files | linux.storage | linux.files.find-locate |
| `linux.storage.partitions` | Create and resize GPT and MBR partitions | linux.storage | linux.users.sudo |
| `linux.storage.swap` | Add swap devices and files with priorities and persistence | linux.storage | linux.storage.partitions |
| `linux.storage.lvm-advanced` | Use LVM snapshots, thin pools and pvmove | linux.storage | linux.storage.lvm |
| `linux.storage.raid` | Build, degrade and rebuild software RAID with mdadm | linux.storage | linux.storage.partitions |
| `linux.storage.luks` | Encrypt volumes with LUKS2 and unlock them at boot | linux.storage | linux.storage.filesystems |
| `linux.storage.network-mounts` | Mount NFS and SMB shares persistently and on demand with autofs | linux.storage | linux.storage.mounts |
| `linux.storage.quotas` | Enforce and report user and group disk quotas | linux.storage | linux.storage.mounts |
| `linux.storage.block-network` | Attach iSCSI and NBD block devices | linux.storage | linux.storage.partitions |
| `linux.storage.repair` | Check and repair ext4 and XFS filesystems | linux.storage | linux.storage.filesystems |
| `linux.net.persistent-config` | Make interface, route and hostname changes persistent with NetworkManager or Netplan | linux.net | linux.net.ip-config |
| `linux.net.bridges-bonds` | Build bridges, VLAN interfaces, bonds and network namespaces | linux.net | linux.net.ip-config |
| `linux.net.firewalld` | Filter traffic with firewalld zones, services and rich rules | linux.net | linux.net.ip-config |
| `linux.net.nat-forwarding` | Route and NAT traffic between networks and redirect ports | linux.net | linux.net.firewall |
| `linux.net.capture` | Capture and probe traffic with tcpdump, nc, nmap and openssl s_client | linux.net | linux.net.troubleshooting |
| `linux.net.time-sync` | Run chrony as client and server for an isolated network | linux.net | linux.systemd.time-locale |
| `linux.net.vpn` | Connect sites with WireGuard tunnels | linux.net | linux.net.ip-config |
| `linux.net.traffic-control` | Shape and impair traffic with tc and netem | linux.net | linux.net.ip-config |
| `linux.services.sshd` | Configure the OpenSSH server (keys only, allowed users, SFTP chroot, tunnels) | linux.services | linux.remote.ssh, linux.systemd.units |
| `linux.services.web-proxy` | Serve sites and load-balance backends with nginx, Apache or HAProxy | linux.services | linux.systemd.units |
| `linux.services.local-ca` | Run a local CA, issue and renew server certificates | linux.services | linux.security.tls-certificates |
| `linux.services.dns-server` | Run caching and authoritative DNS with BIND or Unbound | linux.services | linux.net.name-resolution |
| `linux.services.dhcp-server` | Serve DHCP leases and reservations | linux.services | linux.net.ip-config |
| `linux.services.nfs-server` | Export directories over NFS with correct options | linux.services | linux.storage.mounts |
| `linux.services.samba` | Share directories with Samba for SMB clients | linux.services | linux.files.permissions, linux.systemd.units |
| `linux.services.mail` | Relay and deliver mail with Postfix and aliases | linux.services | linux.systemd.units |
| `linux.services.database-backup` | Back up and restore PostgreSQL or MariaDB databases | linux.services | linux.systemd.units |
| `linux.services.backup` | Back up and restore files with rsync and tar on a schedule | linux.services | linux.files.links-archives |
| `linux.security.selinux-contexts` | Fix SELinux file contexts, port labels and booleans persistently | linux.security | linux.security.mac |
| `linux.security.selinux-troubleshooting` | Diagnose SELinux denials from the audit log | linux.security | linux.security.selinux-contexts, linux.security.audit |
| `linux.security.audit` | Write auditd rules and search audit events | linux.security | linux.systemd.units |
| `linux.security.ssh-hardening` | Harden SSH and add brute-force protection | linux.security | linux.services.sshd |
| `linux.security.auth-hardening` | Enforce password quality and lockout with PAM | linux.security | linux.users.password-aging |
| `linux.security.crypto` | Encrypt, sign and verify with GPG and checksums | linux.security | linux.shell.navigation |
| `linux.security.integrity` | Baseline and check file integrity with AIDE and package verification | linux.security | linux.packages.dnf |
| `linux.security.compliance-scan` | Scan, remediate and rescan against a CIS-style profile with OpenSCAP | linux.security | linux.security.attack-surface |
| `linux.security.privilege-audit` | Find and remove privilege-escalation paths (sudo rules, setuid files, writable root jobs) | linux.security | linux.files.special-bits, linux.users.sudo |
| `linux.security.kernel-hardening` | Apply hardening sysctls and disable unused kernel modules and filesystems | linux.security | linux.kernel.sysctl, linux.kernel.modules |
| `linux.observability.rsyslog` | Route and forward logs with rsyslog | linux.observability | linux.systemd.journal |
| `linux.observability.logrotate` | Rotate logs with logrotate policies | linux.observability | linux.files.permissions |
| `linux.observability.journal-persistence` | Make the journal persistent and size-limited | linux.observability | linux.systemd.journal |
| `linux.observability.host-metrics` | Expose host metrics with node_exporter and write alert rules | linux.observability | linux.systemd.units |
| `linux.performance.use-method` | Triage a slow host with the USE method and a 60-second checklist | linux.performance | linux.processes.management |
| `linux.performance.cpu` | Profile CPU use with perf and per-process statistics | linux.performance | linux.performance.use-method |
| `linux.performance.memory` | Diagnose memory pressure, swapping and OOM kills | linux.performance | linux.performance.use-method |
| `linux.performance.disk-io` | Measure and attribute disk latency and I/O wait | linux.performance | linux.performance.use-method |
| `linux.performance.network` | Find retransmits, MTU problems and throughput limits | linux.performance | linux.performance.use-method, linux.net.troubleshooting |
| `linux.performance.tracing` | Trace system calls and events with strace and bpftrace | linux.performance | linux.processes.management |
| `linux.performance.psi` | Read pressure stall information per system and cgroup | linux.performance | linux.performance.memory |
| `linux.internals.namespaces` | Create and enter namespaces with unshare and nsenter | linux.internals | linux.processes.management |
| `linux.internals.cgroups` | Limit processes with cgroup v2 controllers and systemd slices | linux.internals | linux.systemd.units |
| `linux.internals.overlayfs` | Assemble a root filesystem from overlayfs layers | linux.internals | linux.storage.mounts |
| `linux.internals.capabilities-seccomp` | Drop capabilities and apply seccomp filters to a process | linux.internals | linux.internals.namespaces |
| `linux.internals.podman` | Run, inspect and persist containers with Podman | linux.internals | linux.processes.management |
| `linux.internals.container-services` | Run containers as systemd services with Quadlet and lingering | linux.internals | linux.internals.podman, linux.systemd.unit-authoring |
| `linux.virt.libvirt` | Create, snapshot and network VMs with libvirt and virsh | linux.virt | linux.systemd.units |
| `linux.virt.cloud-init` | Provision hosts with cloud-init user-data and debug its runs | linux.virt | linux.shell.scripting |
| `linux.virt.guest-templates` | Prepare a guest as a template (machine-id, host keys, cleanup) | linux.virt | linux.virt.libvirt |
| `linux.git.basics` | Clone, commit, branch, merge and push with Git | linux.git | linux.shell.navigation |
| `containers.foundations.lifecycle` | Run, stop, restart and remove containers with names, env and overridden defaults | containers.foundations | linux.shell.navigation |
| `containers.foundations.inspect` | Extract container and image facts with inspect --format and filters | containers.foundations | containers.foundations.lifecycle, linux.shell.text-processing |
| `containers.foundations.exec-logs` | Read container logs and run commands inside running containers | containers.foundations | containers.foundations.lifecycle |
| `containers.foundations.cleanup` | Reclaim engine disk space with system df and targeted prune | containers.foundations | containers.foundations.inspect |
| `containers.build.dockerfile` | Write a Dockerfile or Containerfile with a lean build context and .dockerignore | containers.build | containers.foundations.lifecycle, linux.files.permissions |
| `containers.build.entrypoint` | Combine exec-form ENTRYPOINT and CMD so arguments and overrides behave | containers.build | containers.build.dockerfile |
| `containers.build.signals` | Make PID 1 receive and handle stop signals (exec form, init, STOPSIGNAL) | containers.build | containers.build.entrypoint, linux.processes.management |
| `containers.build.cache-order` | Order instructions for cache reuse and clean package-manager layers | containers.build | containers.build.dockerfile |
| `containers.build.multi-stage` | Use multi-stage builds to ship only runtime artifacts | containers.build | containers.build.cache-order |
| `containers.build.non-root` | Run images as a non-root user with explicit UID/GID and correct ownership | containers.build | containers.build.dockerfile |
| `containers.build.healthcheck` | Declare a HEALTHCHECK and read container health status | containers.build | containers.build.dockerfile |
| `containers.build.minimal-base` | Choose slim, distroless, scratch or hardened base images | containers.build | containers.build.multi-stage |
| `containers.build.digest-pinning` | Pin base images by digest and update pins deliberately | containers.build | containers.registry.references |
| `containers.build.args-labels` | Parameterise builds with ARG, ENV and OCI labels | containers.build | containers.build.dockerfile |
| `containers.build.reproducible` | Make builds reproducible with pinned inputs and SOURCE_DATE_EPOCH | containers.build | containers.build.digest-pinning |
| `containers.buildkit.mounts` | Speed up builds with RUN --mount cache and bind mounts | containers.buildkit | containers.build.cache-order |
| `containers.buildkit.secrets` | Pass build secrets and SSH agents without leaking them into layers | containers.buildkit | containers.buildkit.mounts |
| `containers.buildkit.multi-platform` | Build multi-platform images and indexes with buildx | containers.buildkit | containers.buildkit.mounts, containers.registry.references |
| `containers.buildkit.bake` | Define builds as code with Bake targets, groups and shared variables | containers.buildkit | containers.buildkit.mounts |
| `containers.buildkit.checks` | Run build checks and fix their findings | containers.buildkit | containers.build.dockerfile |
| `containers.buildkit.cache-export` | Choose buildx builders, cache backends and exporters and share build cache through a registry | containers.buildkit | containers.buildkit.mounts, containers.registry.references |
| `containers.compose.model` | Describe services, networks and volumes in a Compose file and run the project | containers.compose | containers.foundations.lifecycle, containers.network.bridge-dns |
| `containers.compose.interpolation` | Use .env files and variable interpolation and verify with compose config | containers.compose | containers.compose.model |
| `containers.compose.startup-order` | Order startup with depends_on conditions and healthchecks | containers.compose | containers.compose.model, containers.build.healthcheck |
| `containers.compose.overrides` | Merge Compose files and gate services with profiles | containers.compose | containers.compose.model |
| `containers.compose.secrets-configs` | Provide secrets and configs to Compose services as files | containers.compose | containers.compose.model |
| `containers.compose.watch` | Configure develop.watch to sync files and rebuild services | containers.compose | containers.compose.model |
| `containers.compose.include` | Assemble an application from several Compose files with include and extends | containers.compose | containers.compose.overrides |
| `containers.compose.distribution` | Publish Compose applications as OCI artifacts and run them from a registry reference | containers.compose | containers.compose.model, containers.registry.oci-artifacts |
| `containers.network.bridge-dns` | Connect containers on user-defined bridges and resolve them by name | containers.network | containers.foundations.lifecycle |
| `containers.network.publishing` | Publish ports on chosen host addresses and verify reachability | containers.network | containers.network.bridge-dns |
| `containers.network.drivers` | Choose host, none, macvlan, ipvlan and container network modes | containers.network | containers.network.bridge-dns |
| `containers.network.host-firewall` | Inspect and extend the engine's iptables/nftables rules via DOCKER-USER | containers.network | containers.network.publishing, linux.net.firewall |
| `containers.network.address-pools` | Configure default address pools and network MTU to fit the host network | containers.network | containers.network.bridge-dns, linux.net.ip-config |
| `containers.network.diagnosis` | Diagnose container traffic with nsenter, tcpdump and network inspect | containers.network | containers.network.bridge-dns, linux.net.troubleshooting |
| `containers.network.ipv6` | Enable IPv6 and dual-stack container networks and publish on both address families | containers.network | containers.network.publishing, linux.net.ip-config |
| `containers.storage.mount-types` | Choose volumes, bind mounts and tmpfs, read-only where possible | containers.storage | containers.foundations.lifecycle |
| `containers.storage.backup-restore` | Back up and restore named volumes with throwaway containers | containers.storage | containers.storage.mount-types, linux.files.links-archives |
| `containers.storage.permissions` | Fix UID/GID and SELinux label mismatches on mounted data | containers.storage | containers.storage.mount-types, linux.files.permissions |
| `containers.storage.backends` | Identify the image store (overlay2 or containerd snapshotter) and where container data lives | containers.storage | containers.storage.mount-types |
| `containers.runtime-security.least-privilege` | Drop capabilities, block privilege escalation and run with a read-only root filesystem | containers.runtime-security | containers.foundations.lifecycle |
| `containers.runtime-security.limits` | Set memory, CPU and pids limits on containers | containers.runtime-security | containers.foundations.lifecycle |
| `containers.runtime-security.kernel-profiles` | Confine containers with custom seccomp and AppArmor profiles | containers.runtime-security | containers.runtime-security.least-privilege, linux.security.mac |
| `containers.runtime-security.daemon-socket` | Protect the engine API socket with a socket proxy or authenticated remote access | containers.runtime-security | containers.runtime-security.least-privilege |
| `containers.runtime-security.rootless` | Run the engine rootless or with user-namespace remapping | containers.runtime-security | containers.runtime-security.least-privilege, linux.users.accounts |
| `containers.runtime-security.benchmark` | Assess an engine host against the CIS Docker benchmark and fix findings | containers.runtime-security | containers.runtime-security.least-privilege, containers.operations.daemon-config |
| `containers.supply-chain.scanning` | Scan images offline and triage findings with fixes or VEX statements | containers.supply-chain | containers.build.dockerfile |
| `containers.supply-chain.sbom-provenance` | Attach SBOM and provenance attestations at build time and read them back | containers.supply-chain | containers.buildkit.mounts, containers.registry.references |
| `containers.supply-chain.signing` | Sign and verify images by digest with cosign or Notation via OCI referrers | containers.supply-chain | containers.registry.oci-artifacts |
| `containers.supply-chain.verify-gate` | Gate deployment on signature and attestation verification | containers.supply-chain | containers.supply-chain.signing |
| `containers.supply-chain.hardened-bases` | Migrate to hardened bases and verify their attestations | containers.supply-chain | containers.build.minimal-base, containers.supply-chain.sbom-provenance |
| `containers.supply-chain.secret-hygiene` | Find secrets leaked into image layers and history and remove them | containers.supply-chain | containers.foundations.inspect |
| `containers.supply-chain.policy` | Evaluate images against supply-chain policies with Docker Scout and fix the failures | containers.supply-chain | containers.supply-chain.scanning, containers.supply-chain.sbom-provenance |
| `containers.registry.references` | Distinguish tags, digests and multi-platform indexes | containers.registry | containers.foundations.inspect |
| `containers.registry.run-registry` | Run a private registry with TLS and authentication | containers.registry | containers.registry.references, linux.security.tls-certificates |
| `containers.registry.mirror` | Configure pull-through mirrors and rewrite references for offline pulls | containers.registry | containers.registry.references |
| `containers.registry.oci-artifacts` | Push, discover and pull OCI artifacts and referrers through the registry API | containers.registry | containers.registry.run-registry |
| `containers.registry.portability` | Move images between engines and registries with save/load and skopeo copy | containers.registry | containers.registry.references |
| `containers.registry.garbage-collection` | Delete manifests and garbage-collect registry storage safely | containers.registry | containers.registry.run-registry |
| `containers.operations.logging` | Configure log drivers and log rotation | containers.operations | containers.foundations.exec-logs |
| `containers.operations.exit-codes` | Diagnose exits from OOM kills, signals and ulimits | containers.operations | containers.foundations.inspect, containers.runtime-security.limits |
| `containers.operations.restart-health` | Recover services with restart policies and health status | containers.operations | containers.build.healthcheck |
| `containers.operations.daemon-config` | Configure the engine with daemon.json and systemd drop-ins | containers.operations | containers.foundations.lifecycle, linux.systemd.unit-editing |
| `containers.operations.debug-distroless` | Debug shell-less containers with debug sidecars sharing namespaces | containers.operations | containers.foundations.exec-logs, containers.network.drivers |
| `containers.operations.ci-pipeline` | Build, scan, sign and push in CI without a privileged daemon | containers.operations | containers.supply-chain.signing, containers.buildkit.mounts |
| `containers.operations.engine-upgrade` | Upgrade the engine and absorb changed defaults | containers.operations | containers.operations.daemon-config, linux.packages.apt |
| `containers.internals.runtime-stack` | Trace a container through dockerd, containerd, shim and runc with ctr | containers.internals | containers.foundations.inspect, linux.processes.management |
| `containers.internals.oci-bundle` | Run a container from an OCI runtime bundle with runc | containers.internals | containers.internals.runtime-stack |
| `containers.internals.image-layout` | Read an OCI image layout (index, manifest, config, layers, whiteouts) | containers.internals | containers.registry.references |
| `containers.internals.escape-awareness` | Recognise container escape paths such as mounted sockets and privileged mode and close them | containers.internals | containers.runtime-security.least-privilege |
| `containers.podman.docker-parity` | Carry Docker workflows to Podman: daemonless model, rootless defaults, short names and the Docker-compatible socket | containers.podman | containers.foundations.lifecycle |
| `containers.podman.rootless` | Run rootless Podman with subuid/subgid mappings | containers.podman | containers.foundations.lifecycle, linux.users.accounts |
| `containers.podman.registries-conf` | Configure registries.conf search order, short-name aliases, mirrors and CAs | containers.podman | containers.registry.references |
| `containers.podman.pods` | Group containers into Podman pods sharing network and ports | containers.podman | containers.podman.rootless |
| `containers.podman.quadlet` | Run containers as systemd services with Quadlet so they survive reboot | containers.podman | containers.podman.rootless, linux.systemd.units |
| `containers.podman.secrets` | Create Podman secrets and consume them as files or env | containers.podman | containers.podman.rootless |
| `containers.podman.kube-play` | Generate Kubernetes YAML from pods and run it with podman kube play | containers.podman | containers.podman.pods |
| `containers.podman.state-portability` | Preserve container state with commit, export and checkpoint | containers.podman | containers.podman.rootless, containers.registry.portability |
| `containers.swarm.cluster` | Initialise a swarm, join managers and workers, keep quorum and drain nodes | containers.swarm | containers.network.bridge-dns |
| `containers.swarm.services` | Run replicated and global services with placement constraints and rolling updates | containers.swarm | containers.swarm.cluster |
| `containers.swarm.stacks` | Deploy stacks with overlay networks, secrets and configs | containers.swarm | containers.swarm.services, containers.compose.model |
| `iac.foundations.concepts` | Contrast declarative IaC with imperative scripts and predict idempotent re-runs | iac.foundations | linux.shell.navigation |
| `iac.foundations.workflow` | Run the init, plan, apply and destroy workflow and apply saved plans | iac.foundations | iac.foundations.concepts |
| `iac.foundations.provider-install` | Constrain provider versions and maintain the dependency lock file | iac.foundations | iac.foundations.workflow |
| `iac.foundations.cli-config` | Configure provider installation from filesystem, network and OCI mirrors | iac.foundations | iac.foundations.provider-install |
| `iac.foundations.style` | Keep configurations formatted and valid with fmt and validate | iac.foundations | iac.foundations.workflow |
| `iac.language.resources-data` | Declare resources and data sources and use attribute references | iac.language | iac.foundations.workflow |
| `iac.language.variables` | Declare typed input variables with defaults, validation and tfvars precedence | iac.language | iac.language.resources-data |
| `iac.language.outputs-locals` | Compute locals and expose outputs | iac.language | iac.language.variables |
| `iac.language.expressions` | Write conditional, splat and for expressions over complex types | iac.language | iac.language.variables |
| `iac.language.functions` | Transform data with built-in functions (templatefile, csvdecode, cidrsubnet) | iac.language | iac.language.expressions |
| `iac.language.repetition` | Choose count or for_each and predict resource addresses | iac.language | iac.language.expressions |
| `iac.language.dynamic-blocks` | Generate nested blocks with dynamic blocks | iac.language | iac.language.repetition |
| `iac.language.lifecycle` | Apply lifecycle rules (prevent_destroy, ignore_changes, create_before_destroy, replace_triggered_by) | iac.language | iac.language.resources-data |
| `iac.language.dependencies` | Fix ordering with implicit references and depends_on | iac.language | iac.language.resources-data |
| `iac.language.provider-config` | Configure providers and aliases for several targets | iac.language | iac.foundations.provider-install, iac.language.resources-data |
| `iac.targets.kubernetes-helm` | Manage Kubernetes objects and Helm releases with the kubernetes and helm providers | iac.targets | iac.language.provider-config, k8s.cli.manifests |
| `iac.targets.aws-api` | Provision AWS-shaped networks, buckets and IAM against a custom endpoint | iac.targets | iac.language.provider-config, net.addressing.ipv4-subnetting |
| `iac.targets.vsphere-api` | Manage vSphere inventory objects (folders, resource pools, networks) | iac.targets | iac.language.provider-config |
| `iac.state.backends` | Configure and migrate state backends (local, S3, kubernetes) | iac.state | iac.foundations.workflow |
| `iac.state.locking` | Use S3 lockfile locking and release stale locks safely | iac.state | iac.state.backends |
| `iac.state.inspection` | Inspect state and plans with state list/show and show -json | iac.state | iac.foundations.workflow, linux.shell.text-processing |
| `iac.state.sharing` | Share outputs across configurations with remote state data sources | iac.state | iac.state.backends, iac.language.outputs-locals |
| `iac.state.import` | Adopt existing resources with import blocks and generated configuration | iac.state | iac.state.inspection, iac.language.resources-data |
| `iac.state.query` | Discover unmanaged resources with list resources and terraform query and generate import configuration | iac.state | iac.state.import |
| `iac.state.refactor` | Rename and detach resources with moved and removed blocks or state mv/rm | iac.state | iac.state.inspection, iac.language.repetition |
| `iac.state.drift` | Detect and reconcile drift with refresh-only plans, -replace and -target | iac.state | iac.state.inspection |
| `iac.state.environments` | Separate environments with workspaces or directory layouts | iac.state | iac.state.backends, iac.language.variables |
| `iac.modules.authoring` | Write child modules with an input and output contract | iac.modules | iac.language.outputs-locals |
| `iac.modules.sources` | Consume modules from local, git and registry sources with version constraints | iac.modules | iac.modules.authoring |
| `iac.modules.refactor` | Split a flat configuration into modules without destroying resources | iac.modules | iac.modules.authoring, iac.state.refactor |
| `iac.modules.provider-passing` | Pass aliased providers into modules | iac.modules | iac.modules.authoring, iac.language.provider-config |
| `iac.quality.conditions` | Guard configurations with validation, pre/postconditions and check blocks | iac.quality | iac.language.variables |
| `iac.quality.testing` | Test modules with .tftest.hcl runs and mock providers | iac.quality | iac.modules.authoring |
| `iac.quality.secrets` | Keep secrets out of state with sensitive, ephemeral values and write-only arguments | iac.quality | iac.state.inspection, iac.language.variables |
| `iac.quality.ephemeral` | Read and pass short-lived values with ephemeral resources, variables and outputs so they never reach plans or state | iac.quality | iac.quality.secrets |
| `iac.quality.write-only` | Set and rotate write-only arguments through their version attributes | iac.quality | iac.quality.secrets |
| `iac.quality.policy` | Enforce policy as code on plan JSON with OPA/Conftest | iac.quality | iac.state.inspection |
| `iac.collaboration.saved-plans` | Gate applies on reviewed saved-plan artifacts in a pipeline | iac.collaboration | iac.state.backends |
| `iac.collaboration.dynamic-credentials` | Replace static provider credentials with short-lived workload identity tokens | iac.collaboration | iac.language.provider-config, k8s.rbac.service-accounts |
| `iac.collaboration.drift-detection` | Schedule drift detection with plan -detailed-exitcode | iac.collaboration | iac.state.drift, linux.processes.scheduled-jobs |
| `iac.collaboration.change-review` | Spot risky destroys and replacements in plans before approval | iac.collaboration | iac.state.inspection |
| `iac.collaboration.hcp-concepts` | Map teams onto hosted-platform organisations, projects, workspaces and run workflows | iac.collaboration | iac.state.environments |
| `iac.collaboration.stacks-concepts` | Explain Stacks components and deployments and when they replace many hand-ordered root modules | iac.collaboration | iac.collaboration.hcp-concepts |
| `iac.operations.upgrades` | Upgrade core and provider versions across many root modules | iac.operations | iac.foundations.provider-install, iac.modules.sources |
| `iac.operations.troubleshooting` | Diagnose provider, auth and cycle errors with logs and graph output | iac.operations | iac.foundations.workflow |
| `iac.operations.state-recovery` | Recover lost or corrupted state from backend versions and backups | iac.operations | iac.state.locking, iac.state.inspection |
| `iac.operations.state-splitting` | Split a large state into independent stacks without recreating resources | iac.operations | iac.state.import, iac.state.refactor |
| `iac.operations.actions` | Invoke provider-defined actions from lifecycle triggers and from the CLI | iac.operations | iac.language.lifecycle |
| `iac.opentofu.encryption` | Encrypt state and plans and rotate key providers | iac.opentofu | iac.state.backends |
| `iac.opentofu.early-evaluation` | Use variables in backend blocks and module sources through early evaluation | iac.opentofu | iac.state.backends, iac.modules.sources |
| `iac.opentofu.provider-iteration` | Instantiate providers with for_each | iac.opentofu | iac.language.provider-config, iac.language.repetition |
| `iac.opentofu.enabled-exclude` | Toggle resources with the enabled meta-argument and skip them with -exclude | iac.opentofu | iac.language.repetition |
| `iac.opentofu.oci-distribution` | Distribute modules and mirror providers through an OCI registry | iac.opentofu | iac.modules.sources, iac.foundations.cli-config |
| `iac.opentofu.migration` | Migrate a Terraform-managed estate to OpenTofu with no resource changes | iac.opentofu | iac.operations.upgrades, iac.state.backends |
| `automation.foundations.control-node` | Prepare a control node and verify ansible-core and its Python | automation.foundations | linux.shell.navigation |
| `automation.foundations.config` | Set project defaults in ansible.cfg and explain config precedence with ansible-config | automation.foundations | automation.foundations.control-node |
| `automation.foundations.adhoc` | Run ad-hoc module commands against host patterns | automation.foundations | automation.inventory.static |
| `automation.foundations.docs` | Find module options and examples with ansible-doc and navigator doc | automation.foundations | automation.foundations.control-node |
| `automation.inventory.static` | Write INI and YAML inventories with groups, children and ranges | automation.inventory | linux.remote.ssh |
| `automation.inventory.connection-vars` | Override connection user, host, port and become per host and group | automation.inventory | automation.inventory.static |
| `automation.inventory.bootstrap` | Bootstrap managed nodes with an automation user, SSH key and sudo rule | automation.inventory | linux.users.sudo, linux.remote.ssh |
| `automation.inventory.dynamic` | Build inventories with constructed and dynamic inventory plugins and keyed groups | automation.inventory | automation.inventory.connection-vars, automation.data.facts |
| `automation.data.variables` | Place variables in play, host_vars, group_vars and extra vars and predict precedence | automation.data | automation.inventory.static |
| `automation.data.facts` | Use gathered facts, custom facts.d facts and magic variables | automation.data | automation.data.variables |
| `automation.data.register` | Register task results and use them in later tasks | automation.data | automation.data.variables |
| `automation.data.lookups` | Pull data with lookups and query() from files, environment and generators | automation.data | automation.data.variables |
| `automation.data.filters` | Transform nested data with filters such as dict2items, subelements, ipaddr and json_query | automation.data | automation.data.variables |
| `automation.modules.files` | Manage file content with copy, file, lineinfile, blockinfile and template | automation.modules | linux.files.permissions, automation.foundations.adhoc |
| `automation.modules.packages-services` | Install packages, configure repositories and manage services idempotently | automation.modules | linux.systemd.units, automation.foundations.adhoc |
| `automation.modules.users` | Manage users, groups, password aging, SSH keys and sudo rules with modules | automation.modules | linux.users.accounts, automation.foundations.adhoc |
| `automation.modules.storage` | Partition disks and create LVM volumes, filesystems and persistent mounts with modules | automation.modules | linux.storage.lvm, linux.storage.mounts |
| `automation.modules.firewall-selinux` | Configure firewalld services and SELinux modes, booleans, contexts and port labels with modules | automation.modules | linux.security.mac, linux.net.firewall |
| `automation.modules.scheduling` | Schedule work with the cron and at modules and systemd timers | automation.modules | linux.processes.scheduled-jobs |
| `automation.modules.archives` | Create and extract archives and fetch files back to the control node | automation.modules | linux.files.links-archives |
| `automation.modules.boot-kernel` | Set the default boot target and persistent kernel parameters with modules | automation.modules | linux.systemd.units |
| `automation.modules.avoid-shell` | Replace command and shell tasks with modules or guard them with creates and changed_when | automation.modules | automation.modules.files |
| `automation.control-flow.conditionals` | Write when conditions that return real booleans under ansible-core 2.19 rules | automation.control-flow | automation.data.facts |
| `automation.control-flow.loops` | Loop over lists and dictionaries with loop and loop_control | automation.control-flow | automation.data.variables |
| `automation.control-flow.handlers` | Notify, order and flush handlers so services restart only on change | automation.control-flow | automation.modules.packages-services |
| `automation.control-flow.error-handling` | Control failure with failed_when, changed_when, ignore_errors and block/rescue/always | automation.control-flow | automation.data.register |
| `automation.control-flow.retries` | Wait for conditions with until, retries and delay or wait_for | automation.control-flow | automation.data.register |
| `automation.content.templates` | Render Jinja2 templates with loops, conditionals, filters and whitespace control | automation.content | automation.data.facts |
| `automation.content.vault` | Encrypt variables and files with Vault, vault IDs and password files and rekey them | automation.content | automation.data.variables |
| `automation.content.tags` | Select or skip work with tags and start-at-task | automation.content | automation.foundations.adhoc |
| `automation.reuse.imports-includes` | Choose static imports or dynamic includes for tasks, roles and playbooks | automation.reuse | automation.control-flow.loops |
| `automation.reuse.roles` | Author roles with defaults, vars, handlers, templates and dependencies | automation.reuse | automation.control-flow.handlers, automation.content.templates |
| `automation.reuse.argument-specs` | Validate role inputs with argument specs | automation.reuse | automation.reuse.roles |
| `automation.reuse.collections` | Install roles and collections offline from requirements.yml and call modules by FQCN | automation.reuse | automation.foundations.config |
| `automation.reuse.system-roles` | Configure hosts through packaged system roles by setting their variables | automation.reuse | automation.reuse.collections |
| `automation.devworkflow.navigator` | Run playbooks and inspect docs, inventory and artifacts with ansible-navigator and its settings file | automation.devworkflow | automation.foundations.config |
| `automation.devworkflow.git` | Clone, branch, commit and push automation content to a Git server | automation.devworkflow | linux.shell.navigation |
| `automation.devworkflow.devcontainer` | Write and run playbooks from a VS Code dev container | automation.devworkflow | automation.devworkflow.git |
| `automation.devworkflow.check-diff` | Preview changes with syntax-check, check mode, diff and verbosity | automation.devworkflow | automation.modules.files |
| `automation.advanced.delegation` | Delegate tasks and facts with delegate_to, delegate_facts and run_once | automation.advanced | automation.data.facts |
| `automation.advanced.rolling` | Roll changes through a fleet with serial, max_fail_percentage, throttle and strategies | automation.advanced | automation.control-flow.error-handling |
| `automation.advanced.async` | Run long tasks asynchronously with async and poll and collect their results | automation.advanced | automation.data.register |
| `automation.advanced.privilege` | Scope privilege escalation per play, block and task | automation.advanced | automation.inventory.bootstrap |
| `automation.advanced.migration-219` | Migrate playbooks to ansible-core 2.19 templating, trust and conditional rules | automation.advanced | automation.control-flow.conditionals, automation.content.templates |
| `automation.advanced.collection-build` | Create, build and publish a collection to a private Galaxy server | automation.advanced | automation.reuse.roles, automation.reuse.collections |
| `automation.advanced.execution-environments` | Build execution environments with ansible-builder, push them and run them with navigator | automation.advanced | automation.devworkflow.navigator |
| `automation.quality.lint` | Make content pass ansible-lint at a chosen profile | automation.quality | automation.reuse.roles |
| `automation.quality.molecule` | Test roles with Molecule converge, idempotence and verify steps | automation.quality | automation.reuse.roles |
| `automation.quality.ci` | Run lint, tests and builds in a CI pipeline on every push | automation.quality | automation.quality.lint, automation.devworkflow.git |
| `automation.quality.debugging` | Diagnose failing plays with verbosity, the debugger keyword and navigator replay | automation.quality | automation.devworkflow.navigator |
| `automation.extensibility.filter-plugins` | Write and ship a custom filter plugin | automation.extensibility | automation.data.filters |
| `automation.extensibility.modules` | Write a Python module with AnsibleModule that supports check mode | automation.extensibility | automation.modules.avoid-shell |
| `automation.controller.rbac` | Model organisations, teams, users and roles in the controller | automation.controller | automation.devworkflow.git |
| `automation.controller.projects-templates` | Create projects, inventories, credentials and job templates in the controller | automation.controller | automation.controller.rbac |
| `automation.controller.surveys-schedules` | Add surveys, schedules and notifications to job templates | automation.controller | automation.controller.projects-templates |
| `automation.controller.workflows` | Build workflows with approval, failure and convergence nodes | automation.controller | automation.controller.projects-templates |
| `automation.controller.api-config-as-code` | Drive the controller through its REST API and configuration-as-code collections | automation.controller | automation.controller.projects-templates |
| `automation.controller.webhooks` | Launch jobs from Git webhooks | automation.controller | automation.controller.projects-templates |
| `automation.controller.day2` | Back up and restore the controller and triage failed jobs | automation.controller | automation.controller.projects-templates |
| `automation.eda.rulebooks` | Write rulebooks with sources, conditions and actions and run them with ansible-rulebook | automation.eda | automation.control-flow.conditionals |
| `automation.eda.remediation` | Turn monitoring alerts into remediation job runs | automation.eda | automation.eda.rulebooks, automation.controller.projects-templates |
| `automation.network.connections` | Connect to network devices with network_cli, httpapi or netconf and the right network OS | automation.network | automation.inventory.connection-vars, net.fundamentals.tcp-udp-ports |
| `automation.network.resource-config` | Change interfaces and routing on devices with config modules and resource states | automation.network | automation.network.connections, net.routing.ospf |
| `automation.network.config-templates` | Render device configurations from Jinja2 templates and push them | automation.network | automation.network.connections, automation.content.templates |
| `automation.network.backup-facts` | Gather network facts and back up and restore device configurations | automation.network | automation.network.connections |
| `automation.network.parsing` | Parse device CLI output into structured data and assert on it | automation.network | automation.network.connections, automation.data.filters |

</details>

## Appendix: proposed images

| Ref | Kind | Tier | Status | Description |
| --- | --- | --- | --- | --- |
| `el-sys:10` | container | B | proposed | Kata pod image with systemd as PID 1, LVM/mdadm/nftables tools, AlmaLinux 10 based |
| `deb-sys:24.04` | container | B | proposed | Kata pod image with systemd as PID 1, networking and storage tools, Ubuntu 24.04 based |
| `el-vm:9` | containerDisk | C | proposed | EL 9 cloud image (AlmaLinux 9 GenericCloud) for the RHEL 9 variant |
| `dockerd:29` | container | B | spike | Kata pod running rootful Docker Engine 29 with a block-backed /var/lib/docker (overlay2 spike pending) |
| `podman-vm:5` | containerDisk | C | proposed | EL 10 VM with Podman 5, skopeo, buildah and Quadlet |
| `oci-registry:3` | container | A/B | proposed | CNCF Distribution registry pod per learner (TLS and htpasswd configurable) |
| `gitea:1` | container | A | proposed | In-lab Git server for Git workflow, module sources and Ansible content |
| `moto:5` | container | A/V | proposed | Moto server mode as an offline AWS-shaped API (shape only, behaviour not enforced) |
| `vcsim:1` | container | A/V | proposed | govmomi vcsim vSphere API simulator (inventory, folders, networks, resource pools) |
| `s3-store:1` | container | A/V | spike | SeaweedFS S3 endpoint for remote state with use_lockfile (two-writer contention test pending) |
| `ansible-ctl:2.21` | container | A | proposed | Ansible control node: ansible-core 2.21, ansible-navigator (EE disabled), ansible-lint, Molecule, code-server, git |
| `ansible-node:1` | container | A | proposed | sshd managed-node pod with a sudo-enabled student user (no systemd) |
| `awx:24` | service | C | spike | AWX controller pool (Apache-2.0; releases paused upstream), per-learner org or per-learner instance |
| `galaxy-ng:4` | service | A | proposed | Private Galaxy (Pulp galaxy_ng) for collection publish labs |
| `srlinux:25` | container | N | spike | Nokia SR Linux; hosted-training EULA to be confirmed |

## Appendix: alignment frameworks declared here

Frameworks with a file in `content/frameworks/` (cka, ckad, cks, lfcs, ccna) are not repeated. Weights marked *cloudtrain* are CloudTrain estimates where the body publishes none.

| Framework | Title | Body | Weights | Objectives |
| --- | --- | --- | --- | --- |
| `rhcsa-aligned` | Red Hat Certified System Administrator (RHCSA) objective themes, RHEL 10 with RHEL 9 toggle | Red Hat, Inc. | cloudtrain | essential-tools (15), software (8), scripts (7), running-systems (12), local-storage (12), filesystems (10), deploy-maintain (12), networking (8), users-groups (8), security (8), containers (0) |
| `linuxplus` | CompTIA Linux+ (XK0-006) domains | CompTIA, Inc. | published | system-management (23), services-users (20), security (18), automation-scripting (17), troubleshooting (22) |
| `lpic1` | LPIC-1 (v5.0) topics | Linux Professional Institute | none | system-architecture, install-packages, gnu-commands, devices-filesystems, shells-scripting, admin-tasks, essential-services, networking, security |
| `lpic2` | LPIC-2 (v4.5) topics, modernised | Linux Professional Institute | none | capacity, kernel, startup, filesystems, advanced-storage, networking, maintenance, dns, http, file-sharing, client-mgmt, email, system-security |
| `tf-associate` | HashiCorp Terraform Associate (004) objective themes | HashiCorp, an IBM Company | cloudtrain | iac-concepts (8), fundamentals (10), core-workflow (12), configuration (20), custom-conditions (8), secrets (7), modules (12), state (12), maintain (6), hcp (5) |
| `tf-professional` | HashiCorp Infrastructure Engineer Professional (002) objective themes | HashiCorp, an IBM Company | none | tracing-expressions, upgrades, variables-precedence, credentials-secrets, risky-changes, module-contracts-testing, policy-ci, operations |
| `tf-advanced` | HashiCorp Terraform Authoring and Operations (Advanced) lab exam themes | HashiCorp, an IBM Company | cloudtrain | lifecycle-import-drift (25), dynamic-config (20), collaboration (15), modules (20), providers (20) |
| `opentofu` | OpenTofu differences (CloudTrain-defined) | CloudTrain | none | encryption, early-evaluation, provider-iteration, enabled-exclude, oci-distribution, migration |
| `ex294-aligned` | Red Hat Ansible automation exam (EX294) objective themes | Red Hat, Inc. | cloudtrain | rhcsa-baseline (5), core-components (12), config-inventory (8), managed-nodes (8), run-content (8), git-devworkflow (7), plays-errors (12), roles-collections (12), automate-system-tasks (20), templates-vault (8) |
| `ex374-aligned` | Red Hat advanced Ansible development exam (EX374) objective themes | Red Hat, Inc. | none | git-vars, privilege-tags, data-transform, delegation, collections, execution-environments, dynamic-inventory, controller-content |
| `ex467-aligned` | Red Hat automation platform operations exam (EX467) objective themes | Red Hat, Inc. | none | hub-content, rbac, inventories-credentials, projects-templates, workflows, surveys-schedules-notifications, api-config-as-code, day2 |
| `ex457-aligned` | Red Hat Ansible network automation exam (EX457) objective themes | Red Hat, Inc. | none | dev-workflow, variables-facts, control-flow, controller, network-roles-templates, netcommon-modules, config-backup |
| `ex188-aligned` | Red Hat cloud-native containers exam (EX188) objective themes | Red Hat, Inc. | cloudtrain | build-images (25), manage-images (20), run-containers (20), multi-container (20), troubleshoot (15) |
| `dca-legacy` | Docker Certified Associate (blueprint v1.4, 2020) domains, legacy | Mirantis, Inc. | published | orchestration (25), images-registry (20), install-config (15), networking (15), security (15), storage (10) |
| `docker-practitioner` | Docker practitioner practical blueprint (CloudTrain-defined) | CloudTrain | cloudtrain | build (18), registry (8), compose (15), networking (15), storage (8), security (10), supply-chain (10), operations (16) |
| `ct-platform` | CloudTrain platform engineer capstone | CloudTrain | cloudtrain | linux-foundation (10), containers-delivery (15), iac-provisioning (15), config-automation (15), kubernetes-operations (20), networking-connectivity (10), security-hardening (10), incident-response (5) |

