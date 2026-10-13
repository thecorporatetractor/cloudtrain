import type { Lab, LabSummary, Path, DomainInfo, Topology, LabCheck, LabHint } from '@/api/types';

/* ------------------------------------------------------------------ */
/* Reusable topologies (fictional org: Tessera Freight)                */
/* ------------------------------------------------------------------ */

const orchardTopology: Topology = {
  entry: 'workstation',
  nodes: [
    { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'], resources: { cpu: 1, memoryMiB: 1024 } },
    {
      name: 'orchard-cluster',
      driver: 'k8s-cluster',
      image: 'kubeadm:1.35',
      access: ['ssh'],
      cluster: {
        mode: 'kubeadm',
        version: '1.35.1',
        context: 'orchard',
        nodes: [
          { name: 'orchard-cp-1', role: 'control-plane' },
          { name: 'orchard-w-1', role: 'worker', labels: { tier: 'apps' } },
          { name: 'orchard-w-2', role: 'worker', labels: { tier: 'apps' } },
        ],
      },
    },
    { name: 'registry', driver: 'container', image: 'registry:3', access: ['web', 'shell'] },
  ],
  links: [
    { a: 'workstation:eth0', b: 'orchard-cluster:eth0', subnet: '10.40.0.0/24' },
    { a: 'orchard-cluster:eth1', b: 'registry:eth0', subnet: '10.40.1.0/24' },
  ],
};

const ledgerTopology: Topology = {
  entry: 'workstation',
  nodes: [
    { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
    {
      name: 'ledger-cluster',
      driver: 'k8s-cluster',
      image: 'vcluster:0.22',
      access: ['ssh'],
      cluster: { mode: 'virtual', version: '1.34.2', context: 'ledger' },
    },
    {
      name: 'billing-cluster',
      driver: 'k8s-cluster',
      image: 'vcluster:0.22',
      access: ['ssh'],
      cluster: { mode: 'virtual', version: '1.34.2', context: 'billing' },
    },
  ],
  links: [
    { a: 'workstation:eth0', b: 'ledger-cluster:eth0', subnet: '10.41.0.0/24' },
    { a: 'workstation:eth1', b: 'billing-cluster:eth0', subnet: '10.41.1.0/24' },
  ],
};

const quillTopology: Topology = {
  entry: 'workstation',
  nodes: [
    { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
    { name: 'quill-db', driver: 'vm', image: 'ubuntu:24.04', access: ['ssh', 'console'], resources: { cpu: 2, memoryMiB: 2048, disks: ['20G', '8G'] } },
    { name: 'quill-app', driver: 'vm', image: 'ubuntu:24.04', access: ['ssh', 'console'], resources: { cpu: 1, memoryMiB: 1024 } },
  ],
  links: [
    { a: 'workstation:eth0', b: 'quill-db:ens3', subnet: '10.50.0.0/24' },
    { a: 'quill-db:ens4', b: 'quill-app:ens3', subnet: '10.50.1.0/24' },
  ],
};

const harborTopology: Topology = {
  entry: 'workstation',
  nodes: [
    { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
    { name: 'harbor-vm', driver: 'vm', image: 'rocky:9', access: ['ssh', 'console'], resources: { cpu: 1, memoryMiB: 1024 } },
  ],
  links: [{ a: 'workstation:eth0', b: 'harbor-vm:ens3', subnet: '10.51.0.0/24' }],
};

const edgeTopology: Topology = {
  entry: 'workstation',
  nodes: [
    { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
    { name: 'edge-rtr-1', driver: 'netdev', image: 'frr:10', access: ['console', 'ssh'] },
    { name: 'edge-rtr-2', driver: 'netdev', image: 'frr:10', access: ['console', 'ssh'] },
    { name: 'core-sw-1', driver: 'netdev', image: 'frr:10', access: ['console'] },
    { name: 'depot-host', driver: 'container', image: 'netshoot:1', access: ['shell'] },
  ],
  links: [
    { a: 'workstation:eth0', b: 'core-sw-1:eth0', subnet: '10.60.0.0/24' },
    { a: 'core-sw-1:eth1', b: 'edge-rtr-1:eth0', subnet: '10.60.1.0/30' },
    { a: 'core-sw-1:eth2', b: 'edge-rtr-2:eth0', subnet: '10.60.2.0/30' },
    { a: 'edge-rtr-1:eth1', b: 'edge-rtr-2:eth1', subnet: '10.60.9.0/30', impair: { latencyMs: 40 } },
    { a: 'edge-rtr-2:eth2', b: 'depot-host:eth0', subnet: '10.60.20.0/24' },
  ],
};

/* ------------------------------------------------------------------ */
/* Labs                                                                 */
/* ------------------------------------------------------------------ */

const lab = (
  meta: Lab['metadata'],
  description: string,
  objectives: string[],
  topology: Topology,
  checks: LabCheck[],
  hints: LabHint[] = [],
): Lab => ({ apiVersion: 'cloudtrain.dev/v3', kind: 'Lab', metadata: meta, spec: { description, objectives, topology, checks, hints } });

export const labs: Lab[] = [
  lab(
    {
      id: 'orchard-netpol-isolation',
      title: 'Isolate the payments namespace with NetworkPolicy',
      domain: 'kubernetes',
      frameworks: ['cks:cluster-setup', 'cka:services-networking'],
      difficulty: 'medium',
      estimatedMinutes: 25,
      tags: ['network-policy', 'segmentation'],
      version: 3,
    },
    `Tessera Freight runs its card-settlement service in the \`payments\` namespace of the **orchard** cluster. An internal review found that any pod in the cluster can reach the settlement API.

Lock the namespace down so that:

- only pods in the \`checkout\` namespace may reach \`settlement-api\` on port **8443**
- pods in \`payments\` may still resolve DNS through \`kube-system\`
- all other ingress to \`payments\` is denied

Work from the \`workstation\` jumphost. The kubeconfig context for the cluster is \`orchard\`.`,
    [
      'Create a default-deny ingress policy for the payments namespace',
      'Allow ingress to settlement-api from the checkout namespace on 8443 only',
      'Allow egress to CoreDNS on UDP/TCP 53',
      'Verify with the provided probe pods, not by reading the manifest',
    ],
    orchardTopology,
    [
      { id: 'default-deny-exists', description: 'A NetworkPolicy selecting all pods in payments denies ingress by default', type: 'k8s-query', skills: ['k8s.net.network-policy'], weight: 2 },
      { id: 'checkout-allowed', description: 'checkout/probe can reach settlement-api:8443', type: 'reachability', skills: ['k8s.net.network-policy', 'k8s.net.services'], weight: 2 },
      { id: 'other-denied', description: 'inventory/probe cannot reach settlement-api:8443', type: 'reachability', skills: ['k8s.net.network-policy'], weight: 2 },
      { id: 'dns-allowed', description: 'payments pods can resolve kubernetes.default', type: 'shell', skills: ['k8s.net.dns', 'k8s.net.network-policy'] },
      { id: 'no-wide-open', description: 'No policy in payments allows ingress from all namespaces', type: 'k8s-query', skills: ['k8s.net.network-policy'] },
    ],
    [
      { title: 'Start with deny', body: 'A policy with `podSelector: {}` and `policyTypes: [Ingress]` and no `ingress` rules denies all ingress to the namespace.', cost: 1 },
      { title: 'Select the namespace, not the pod', body: 'Use `namespaceSelector` with the label CloudTrain pre-applied: `kubernetes.io/metadata.name: checkout`.', command: 'kubectl get ns checkout --show-labels', cost: 2 },
      { title: 'DNS is egress', body: 'Egress rules are evaluated separately. Add a policy with `policyTypes: [Egress]` allowing UDP and TCP 53 to `kube-system`.', cost: 3 },
    ],
  ),
  lab(
    {
      id: 'ledger-rbac-least-privilege',
      title: 'Scope the deploy bot to least privilege across two clusters',
      domain: 'kubernetes',
      frameworks: ['cks:cluster-hardening', 'cka:cluster-architecture'],
      difficulty: 'medium',
      estimatedMinutes: 30,
      tags: ['rbac', 'multi-cluster'],
      version: 2,
    },
    `The \`deploy-bot\` service account in both the **ledger** and **billing** clusters is bound to \`cluster-admin\`. Replace it with the minimum rights needed: manage Deployments and ConfigMaps in the \`ledger-api\` namespace and read Pods cluster-wide. Nothing else.`,
    ['Remove the cluster-admin binding on both clusters', 'Create a namespaced Role and RoleBinding for ledger-api', 'Create a ClusterRole for pod read access', 'Verify with kubectl auth can-i --as'],
    ledgerTopology,
    [
      { id: 'ledger-no-admin', description: 'deploy-bot is not bound to cluster-admin (ledger)', type: 'k8s-can-i', skills: ['k8s.rbac.roles', 'k8s.rbac.service-accounts'], weight: 2 },
      { id: 'billing-no-admin', description: 'deploy-bot is not bound to cluster-admin (billing)', type: 'k8s-can-i', skills: ['k8s.rbac.roles'], weight: 2 },
      { id: 'can-update-deploy', description: 'deploy-bot can update deployments in ledger-api', type: 'k8s-can-i', skills: ['k8s.rbac.roles'] },
      { id: 'cannot-delete-ns', description: 'deploy-bot cannot delete namespaces', type: 'k8s-can-i', skills: ['k8s.rbac.roles'] },
      { id: 'pods-cluster-wide', description: 'deploy-bot can list pods in all namespaces', type: 'k8s-can-i', skills: ['k8s.rbac.roles'] },
      { id: 'context-switch', description: 'Both contexts were used during the attempt', type: 'k8s-context', skills: ['k8s.arch.control-plane'] },
    ],
    [{ title: 'Find the binding', body: 'ClusterRoleBindings reference subjects by kind, name and namespace.', command: 'kubectl get clusterrolebindings -o wide | grep deploy-bot', cost: 1 }],
  ),
  lab(
    {
      id: 'orchard-etcd-snapshot-restore',
      title: 'Snapshot etcd and restore after a bad ConfigMap purge',
      domain: 'kubernetes',
      frameworks: ['cka:cluster-architecture'],
      difficulty: 'hard',
      estimatedMinutes: 40,
      tags: ['etcd', 'backup', 'disaster-recovery'],
    },
    `Take a snapshot of etcd on \`orchard-cp-1\`. A scripted incident will then delete every ConfigMap in \`fleet-ops\`. Restore the cluster from your snapshot so the ConfigMaps come back, and keep the control plane healthy.`,
    ['Snapshot etcd to /var/backups/etcd/pre-incident.db', 'Restore from the snapshot into a new data directory', 'Point the static pod manifest at the restored directory', 'Confirm the fleet-ops ConfigMaps exist again'],
    orchardTopology,
    [
      { id: 'snapshot-exists', description: 'Snapshot file exists and is a valid etcd backup', type: 'file', skills: ['k8s.arch.etcd-backup'], weight: 2 },
      { id: 'configmaps-back', description: 'fleet-ops ConfigMaps are present after restore', type: 'k8s-query', skills: ['k8s.arch.etcd-backup'], weight: 3 },
      { id: 'cp-healthy', description: 'All control plane pods are Running', type: 'k8s-query', skills: ['k8s.arch.control-plane', 'k8s.ts.node-failure'] },
      { id: 'data-dir-moved', description: 'etcd static pod uses the restored data directory', type: 'shell', skills: ['k8s.arch.etcd-backup', 'k8s.arch.control-plane'] },
    ],
    [{ title: 'Certificates', body: 'etcdctl needs --cacert, --cert and --key from /etc/kubernetes/pki/etcd.', cost: 1 }],
  ),
  lab(
    { id: 'orchard-psa-baseline', title: 'Enforce baseline Pod Security on tenant namespaces', domain: 'kubernetes', frameworks: ['cks:microservice-vulns'], difficulty: 'easy', estimatedMinutes: 15, tags: ['pod-security'] },
    `Label the \`tenant-a\` and \`tenant-b\` namespaces so that Pod Security Admission **enforces baseline** and **warns on restricted**. The existing privileged debug pod in \`tenant-a\` must be removed.`,
    ['Apply enforce=baseline and warn=restricted labels', 'Remove the privileged pod', 'Confirm a privileged pod is rejected'],
    orchardTopology,
    [
      { id: 'labels-a', description: 'tenant-a has enforce=baseline and warn=restricted', type: 'k8s-query', skills: ['k8s.sec.pod-security'] },
      { id: 'labels-b', description: 'tenant-b has enforce=baseline and warn=restricted', type: 'k8s-query', skills: ['k8s.sec.pod-security'] },
      { id: 'priv-gone', description: 'No privileged pods remain in tenant-a', type: 'k8s-query', skills: ['k8s.sec.pod-security', 'k8s.sec.security-context'] },
    ],
  ),
  lab(
    { id: 'orchard-worker-upgrade', title: 'Drain and upgrade a worker without dropping traffic', domain: 'kubernetes', frameworks: ['cka:cluster-architecture'], difficulty: 'medium', estimatedMinutes: 30, tags: ['upgrade', 'drain'] },
    `Upgrade \`orchard-w-2\` from kubelet 1.34 to 1.35 while the \`dispatch\` Deployment keeps serving. Respect its PodDisruptionBudget.`,
    ['Cordon and drain orchard-w-2', 'Upgrade kubeadm, kubelet and kubectl', 'Uncordon and verify Ready'],
    orchardTopology,
    [
      { id: 'kubelet-version', description: 'orchard-w-2 reports kubelet 1.35.x', type: 'k8s-query', skills: ['k8s.arch.upgrade'], weight: 2 },
      { id: 'node-ready', description: 'orchard-w-2 is Ready and schedulable', type: 'k8s-query', skills: ['k8s.arch.node-maintenance'] },
      { id: 'pdb-respected', description: 'dispatch never dropped below minAvailable', type: 'shell', skills: ['k8s.arch.node-maintenance', 'k8s.wl.deployments'] },
    ],
  ),
  lab(
    { id: 'orchard-ingress-tls-rotation', title: 'Rotate the expiring TLS certificate on the portal ingress', domain: 'kubernetes', frameworks: ['cka:services-networking', 'cks:cluster-setup'], difficulty: 'easy', estimatedMinutes: 20, tags: ['ingress', 'tls'] },
    `The certificate behind \`portal.tessera.internal\` expires tomorrow. Issue a new one from the internal CA on the jumphost and rotate the Secret without downtime.`,
    ['Generate a new key and CSR', 'Replace the TLS secret', 'Confirm the ingress serves the new certificate'],
    orchardTopology,
    [
      { id: 'cert-new', description: 'Ingress serves a certificate valid > 30 days', type: 'http', skills: ['k8s.net.ingress'], weight: 2 },
      { id: 'secret-type', description: 'Secret is of type kubernetes.io/tls', type: 'k8s-query', skills: ['k8s.net.ingress', 'k8s.sec.secrets'] },
    ],
  ),
  lab(
    { id: 'orchard-audit-policy', title: 'Capture Secret access in the API audit log', domain: 'kubernetes', frameworks: ['cks:monitoring-runtime'], difficulty: 'hard', estimatedMinutes: 35, tags: ['audit', 'logging'] },
    `Configure an audit policy on \`orchard-cp-1\` that logs Secret reads at RequestResponse level and everything else at Metadata, writing to /var/log/kubernetes/audit.log.`,
    ['Write the audit policy', 'Wire the kube-apiserver flags and volume mounts', 'Prove a Secret read appears in the log'],
    orchardTopology,
    [
      { id: 'policy-file', description: 'Audit policy file exists with RequestResponse for secrets', type: 'file', skills: ['k8s.rbac.audit'], weight: 2 },
      { id: 'apiserver-flags', description: 'kube-apiserver has --audit-policy-file and --audit-log-path', type: 'shell', skills: ['k8s.rbac.audit', 'k8s.arch.control-plane'] },
      { id: 'secret-logged', description: 'A Secret read is present in audit.log', type: 'shell', skills: ['k8s.rbac.audit'], weight: 2 },
    ],
  ),
  // Linux
  lab(
    { id: 'quill-lvm-extend', title: 'Grow the database volume without unmounting', domain: 'linux', frameworks: ['lfcs:storage'], difficulty: 'medium', estimatedMinutes: 20, tags: ['lvm', 'xfs'] },
    `\`quill-db\` is at 96% on /var/lib/postgres. A second 8 GiB disk has been attached. Extend the volume group and the XFS filesystem online.`,
    ['Create a PV on the new disk', 'Extend vg_data and lv_postgres', 'Grow the XFS filesystem online'],
    quillTopology,
    [
      { id: 'pv-added', description: 'New disk is a physical volume in vg_data', type: 'shell', skills: ['linux.storage.lvm'] },
      { id: 'lv-size', description: 'lv_postgres is at least 26 GiB', type: 'shell', skills: ['linux.storage.lvm'], weight: 2 },
      { id: 'fs-grown', description: '/var/lib/postgres reports the new size and stayed mounted', type: 'shell', skills: ['linux.storage.fs'] },
    ],
    [{ title: 'Online growth', body: 'XFS grows with xfs_growfs on the mount point, not the device.', cost: 1 }],
  ),
  lab(
    { id: 'harbor-systemd-hardening', title: 'Harden the harbor-sync service unit', domain: 'linux', frameworks: ['lfcs:operations', 'cks:system-hardening'], difficulty: 'medium', estimatedMinutes: 25, tags: ['systemd', 'hardening'] },
    `The \`harbor-sync.service\` on \`harbor-vm\` runs as root with full filesystem access. Make it run as the \`sync\` user, with a private /tmp, read-only system paths and a restart policy.`,
    ['Run as the sync user', 'Add ProtectSystem=strict and PrivateTmp', 'Restart on failure with a 5s delay'],
    harborTopology,
    [
      { id: 'runs-as-sync', description: 'harbor-sync main PID runs as sync', type: 'service-state', skills: ['linux.ops.systemd', 'linux.users.accounts'] },
      { id: 'protect-system', description: 'Unit has ProtectSystem=strict and PrivateTmp=yes', type: 'shell', skills: ['linux.ops.systemd'], weight: 2 },
      { id: 'restart-policy', description: 'Unit restarts on failure after 5s', type: 'shell', skills: ['linux.ops.systemd'] },
    ],
  ),
  lab(
    { id: 'harbor-ssh-key-only', title: 'Move harbor-vm to key-only SSH with a bastion user', domain: 'linux', frameworks: ['lfcs:users', 'cks:system-hardening'], difficulty: 'easy', estimatedMinutes: 15, tags: ['ssh'] },
    `Disable password authentication and root login over SSH on \`harbor-vm\`, and allow only the \`ops\` group to log in.`,
    ['Disable PasswordAuthentication and PermitRootLogin', 'Restrict with AllowGroups ops', 'Reload sshd without dropping your session'],
    harborTopology,
    [
      { id: 'no-password', description: 'sshd -T reports passwordauthentication no', type: 'shell', skills: ['linux.users.ssh'] },
      { id: 'no-root', description: 'sshd -T reports permitrootlogin no', type: 'shell', skills: ['linux.users.ssh'] },
      { id: 'allowgroups', description: 'Only the ops group may log in', type: 'shell', skills: ['linux.users.ssh', 'linux.users.accounts'] },
    ],
  ),
  lab(
    { id: 'quill-log-rotation', title: 'Rotate and ship the quill-app logs nightly', domain: 'linux', frameworks: ['lfcs:operations'], difficulty: 'easy', estimatedMinutes: 15, tags: ['cron', 'logrotate'] },
    `Configure logrotate for /var/log/quill/*.log on \`quill-app\` (daily, 14 copies, compressed) and a systemd timer that ships rotated logs to \`quill-db:/srv/archive\` at 02:30.`,
    ['Write the logrotate stanza', 'Create a service and timer pair', 'Verify the timer is scheduled'],
    quillTopology,
    [
      { id: 'logrotate-conf', description: 'logrotate config rotates daily with 14 compressed copies', type: 'file', skills: ['linux.ops.logs'] },
      { id: 'timer-active', description: 'ship-logs.timer is active and next fires at 02:30', type: 'service-state', skills: ['linux.ops.cron', 'linux.ops.systemd'] },
    ],
  ),
  // Networking
  lab(
    { id: 'edge-ospf-convergence', title: 'Bring the depot back online with OSPF area 0', domain: 'networking', frameworks: ['ccna:connectivity'], difficulty: 'medium', estimatedMinutes: 30, tags: ['ospf', 'frr'] },
    `\`depot-host\` behind \`edge-rtr-2\` cannot reach the core. Configure OSPF area 0 on \`edge-rtr-1\`, \`edge-rtr-2\` and \`core-sw-1\` so the depot subnet is learned everywhere, and prefer the direct inter-router link.`,
    ['Enable OSPF on all three devices', 'Advertise the depot subnet', 'Adjust cost so the direct link is preferred'],
    edgeTopology,
    [
      { id: 'adjacency-full', description: 'All OSPF neighbours are in FULL state', type: 'device-cmd', skills: ['net.l3.ospf'], weight: 2 },
      { id: 'depot-reachable', description: 'workstation can ping depot-host', type: 'reachability', skills: ['net.l3.ospf', 'net.l3.static'], weight: 2 },
      { id: 'path-preferred', description: 'core-sw-1 routes to the depot via edge-rtr-2 directly', type: 'device-cmd', skills: ['net.l3.ospf'] },
    ],
    [{ title: 'Neighbour state', body: 'In FRR, `show ip ospf neighbor` shows the state; 2-Way on a broadcast segment is normal for non-DR routers.', cost: 1 }],
  ),
  lab(
    { id: 'edge-vlan-trunk', title: 'Trunk the branch VLANs to the core', domain: 'networking', frameworks: ['ccna:access'], difficulty: 'easy', estimatedMinutes: 20, tags: ['vlan', 'trunk'] },
    `Create VLANs 110 (office) and 120 (warehouse) on \`core-sw-1\`, trunk them to \`edge-rtr-1\` and give each a gateway.`,
    ['Create VLANs and assign ports', 'Configure the trunk with only the needed VLANs', 'Verify inter-VLAN routing'],
    edgeTopology,
    [
      { id: 'vlans-exist', description: 'VLANs 110 and 120 exist on core-sw-1', type: 'device-cmd', skills: ['net.l2.vlans'] },
      { id: 'trunk-allowed', description: 'Trunk allows exactly 110,120', type: 'device-cmd', skills: ['net.l2.vlans'], weight: 2 },
      { id: 'intervlan', description: 'Hosts in 110 can reach 120 gateway', type: 'reachability', skills: ['net.l2.vlans', 'net.l3.subnetting'] },
    ],
  ),
  lab(
    { id: 'edge-acl-dmz', title: 'Segment the depot DMZ with ACLs', domain: 'networking', frameworks: ['ccna:security'], difficulty: 'hard', estimatedMinutes: 35, tags: ['acl', 'segmentation'] },
    `Only HTTPS from the office subnet may reach \`depot-host\`; the depot may initiate nothing except DNS and NTP to the core. Implement this with ACLs on \`edge-rtr-2\`.`,
    ['Write an inbound ACL on the depot interface', 'Write an outbound ACL for depot-originated traffic', 'Verify with the test clients'],
    edgeTopology,
    [
      { id: 'https-allowed', description: 'Office client reaches depot-host:443', type: 'reachability', skills: ['net.sec.acl'] },
      { id: 'ssh-denied', description: 'Office client cannot reach depot-host:22', type: 'reachability', skills: ['net.sec.acl'], weight: 2 },
      { id: 'egress-limited', description: 'depot-host can only reach core on 53 and 123', type: 'reachability', skills: ['net.sec.acl'], weight: 2 },
    ],
  ),
];

export const labById = new Map(labs.map((l) => [l.metadata.id, l]));

/* ------------------------------------------------------------------ */
/* Paths & domains                                                      */
/* ------------------------------------------------------------------ */

export const paths: Path[] = [
  {
    id: 'cks-readiness',
    title: 'CKS readiness',
    domain: 'kubernetes',
    framework: 'cks',
    description: 'Hardening, admission, audit and runtime security across the full CKS blueprint.',
    labIds: ['orchard-netpol-isolation', 'ledger-rbac-least-privilege', 'orchard-psa-baseline', 'orchard-audit-policy', 'harbor-systemd-hardening'],
    estimatedMinutes: 130,
    progress: 0.4,
  },
  {
    id: 'cka-foundations',
    title: 'CKA foundations',
    domain: 'kubernetes',
    framework: 'cka',
    description: 'Cluster lifecycle, networking and troubleshooting on real kubeadm clusters.',
    labIds: ['orchard-etcd-snapshot-restore', 'orchard-worker-upgrade', 'orchard-ingress-tls-rotation', 'ledger-rbac-least-privilege'],
    estimatedMinutes: 120,
    progress: 0.75,
  },
  {
    id: 'lfcs-sysadmin',
    title: 'LFCS system administration',
    domain: 'linux',
    framework: 'lfcs',
    description: 'Storage, services, scheduling and access control on Ubuntu and Rocky VMs.',
    labIds: ['quill-lvm-extend', 'harbor-systemd-hardening', 'harbor-ssh-key-only', 'quill-log-rotation'],
    estimatedMinutes: 75,
    progress: 0.25,
  },
  {
    id: 'ccna-routing-switching',
    title: 'CCNA routing & switching',
    domain: 'networking',
    framework: 'ccna',
    description: 'VLANs, OSPF and ACLs on a realistic three-device edge topology.',
    labIds: ['edge-vlan-trunk', 'edge-ospf-convergence', 'edge-acl-dmz'],
    estimatedMinutes: 85,
    progress: 0,
  },
];

const completed = new Set(['orchard-psa-baseline', 'orchard-worker-upgrade', 'orchard-ingress-tls-rotation', 'harbor-ssh-key-only', 'ledger-rbac-least-privilege']);
const inProgress = new Set(['orchard-netpol-isolation', 'quill-lvm-extend']);

export const labSummaries: LabSummary[] = labs.map((l) => {
  const skillIds = Array.from(new Set(l.spec.checks.flatMap((c) => c.skills)));
  const pathId = paths.find((p) => p.labIds.includes(l.metadata.id))?.id;
  const completion: LabSummary['completion'] = completed.has(l.metadata.id) ? 'completed' : inProgress.has(l.metadata.id) ? 'in-progress' : 'new';
  return {
    ...l.metadata,
    skillIds,
    pathId,
    completion,
    bestScore: completion === 'completed' ? 82 + (l.metadata.id.length % 17) : completion === 'in-progress' ? 40 : undefined,
  };
});

export const domains: DomainInfo[] = [
  { id: 'kubernetes', name: 'Kubernetes', tagline: 'Real kubeadm and virtual clusters, from etcd to admission.', labCount: labs.filter((l) => l.metadata.domain === 'kubernetes').length, pathCount: 2 },
  { id: 'linux', name: 'Linux', tagline: 'Full VMs for storage, services and access control.', labCount: labs.filter((l) => l.metadata.domain === 'linux').length, pathCount: 1 },
  { id: 'networking', name: 'Networking', tagline: 'Routers, switches and firewalls on real L2 wires.', labCount: labs.filter((l) => l.metadata.domain === 'networking').length, pathCount: 1 },
];
