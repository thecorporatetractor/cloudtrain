import type { Framework, Skill, SkillState } from '@/api/types';

export const skills: Skill[] = [
  // Kubernetes
  { id: 'k8s.arch.control-plane', name: 'Control plane components', domain: 'kubernetes', competency: 'Cluster architecture' },
  { id: 'k8s.arch.etcd-backup', name: 'etcd snapshot & restore', domain: 'kubernetes', competency: 'Cluster architecture' },
  { id: 'k8s.arch.upgrade', name: 'kubeadm upgrades', domain: 'kubernetes', competency: 'Cluster architecture' },
  { id: 'k8s.arch.node-maintenance', name: 'Drain, cordon, uncordon', domain: 'kubernetes', competency: 'Cluster architecture' },
  { id: 'k8s.rbac.roles', name: 'Roles & bindings', domain: 'kubernetes', competency: 'Access control' },
  { id: 'k8s.rbac.service-accounts', name: 'Service accounts', domain: 'kubernetes', competency: 'Access control' },
  { id: 'k8s.rbac.audit', name: 'Audit policy', domain: 'kubernetes', competency: 'Access control' },
  { id: 'k8s.net.network-policy', name: 'NetworkPolicy', domain: 'kubernetes', competency: 'Networking' },
  { id: 'k8s.net.services', name: 'Services & endpoints', domain: 'kubernetes', competency: 'Networking' },
  { id: 'k8s.net.ingress', name: 'Ingress & TLS', domain: 'kubernetes', competency: 'Networking' },
  { id: 'k8s.net.dns', name: 'Cluster DNS', domain: 'kubernetes', competency: 'Networking' },
  { id: 'k8s.wl.deployments', name: 'Deployments & rollouts', domain: 'kubernetes', competency: 'Workloads' },
  { id: 'k8s.wl.scheduling', name: 'Affinity, taints, tolerations', domain: 'kubernetes', competency: 'Workloads' },
  { id: 'k8s.wl.probes', name: 'Probes & resources', domain: 'kubernetes', competency: 'Workloads' },
  { id: 'k8s.sec.pod-security', name: 'Pod Security Admission', domain: 'kubernetes', competency: 'Hardening' },
  { id: 'k8s.sec.security-context', name: 'Security contexts', domain: 'kubernetes', competency: 'Hardening' },
  { id: 'k8s.sec.secrets', name: 'Secrets & encryption at rest', domain: 'kubernetes', competency: 'Hardening' },
  { id: 'k8s.sec.runtime', name: 'Runtime detection (Falco)', domain: 'kubernetes', competency: 'Hardening' },
  { id: 'k8s.sec.supply-chain', name: 'Image policy & signing', domain: 'kubernetes', competency: 'Hardening' },
  { id: 'k8s.storage.pv', name: 'PV / PVC / StorageClass', domain: 'kubernetes', competency: 'Storage' },
  { id: 'k8s.ts.logs-events', name: 'Logs & events triage', domain: 'kubernetes', competency: 'Troubleshooting' },
  { id: 'k8s.ts.node-failure', name: 'Node & kubelet failures', domain: 'kubernetes', competency: 'Troubleshooting' },
  // Linux
  { id: 'linux.cmd.shell', name: 'Shell & text processing', domain: 'linux', competency: 'Essential commands' },
  { id: 'linux.cmd.permissions', name: 'Permissions & ACLs', domain: 'linux', competency: 'Essential commands' },
  { id: 'linux.ops.systemd', name: 'systemd units', domain: 'linux', competency: 'Operations' },
  { id: 'linux.ops.cron', name: 'Scheduling (cron, timers)', domain: 'linux', competency: 'Operations' },
  { id: 'linux.ops.logs', name: 'journald & log rotation', domain: 'linux', competency: 'Operations' },
  { id: 'linux.users.accounts', name: 'Users, groups, sudo', domain: 'linux', competency: 'Users & groups' },
  { id: 'linux.users.ssh', name: 'SSH hardening', domain: 'linux', competency: 'Users & groups' },
  { id: 'linux.storage.lvm', name: 'LVM', domain: 'linux', competency: 'Storage' },
  { id: 'linux.storage.fs', name: 'Filesystems & mounts', domain: 'linux', competency: 'Storage' },
  { id: 'linux.net.interfaces', name: 'Interfaces & routes', domain: 'linux', competency: 'Networking' },
  { id: 'linux.net.firewall', name: 'nftables / firewalld', domain: 'linux', competency: 'Networking' },
  // Networking
  { id: 'net.l2.vlans', name: 'VLANs & trunking', domain: 'networking', competency: 'Network access' },
  { id: 'net.l2.stp', name: 'Spanning tree', domain: 'networking', competency: 'Network access' },
  { id: 'net.l3.static', name: 'Static routing', domain: 'networking', competency: 'IP connectivity' },
  { id: 'net.l3.ospf', name: 'OSPF', domain: 'networking', competency: 'IP connectivity' },
  { id: 'net.l3.subnetting', name: 'IPv4/IPv6 addressing', domain: 'networking', competency: 'Network fundamentals' },
  { id: 'net.svc.nat-dhcp', name: 'NAT & DHCP', domain: 'networking', competency: 'IP services' },
  { id: 'net.sec.acl', name: 'ACLs & segmentation', domain: 'networking', competency: 'Security fundamentals' },
  { id: 'net.sec.aaa', name: 'Device hardening & AAA', domain: 'networking', competency: 'Security fundamentals' },
];

export const skillById = new Map(skills.map((s) => [s.id, s]));

/** Deterministic pseudo-random helper so fixtures are stable between reloads. */
function seeded(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const strongSkills = new Set([
  'k8s.wl.deployments',
  'k8s.net.services',
  'k8s.rbac.roles',
  'k8s.arch.node-maintenance',
  'linux.cmd.shell',
  'linux.ops.systemd',
  'linux.users.accounts',
  'k8s.ts.logs-events',
]);
const weakSkills = new Set([
  'k8s.sec.runtime',
  'k8s.sec.supply-chain',
  'k8s.rbac.audit',
  'net.l3.ospf',
  'net.l2.stp',
  'k8s.sec.secrets',
]);
const untouched = new Set(['net.sec.aaa', 'net.svc.nat-dhcp', 'linux.net.firewall']);

export const skillStates: SkillState[] = skills.map((s) => {
  const r = seeded(s.id);
  let mu = 0.35 + r * 0.4;
  let sigma = 0.12 + seeded(s.id + 'sig') * 0.12;
  let evidence = Math.round(3 + seeded(s.id + 'ev') * 14);
  if (strongSkills.has(s.id)) {
    mu = 0.78 + r * 0.17;
    sigma = 0.06 + r * 0.05;
    evidence += 10;
  }
  if (weakSkills.has(s.id)) {
    mu = 0.18 + r * 0.25;
    sigma = 0.16 + r * 0.14;
    evidence = Math.round(1 + r * 4);
  }
  if (untouched.has(s.id)) {
    mu = 0.4;
    sigma = 0.42;
    evidence = 0;
  }
  const daysAgo = Math.round(1 + seeded(s.id + 'd') * 40);
  const trend: SkillState['trend'] = r > 0.66 ? 'up' : r > 0.3 ? 'flat' : 'down';
  return {
    skillId: s.id,
    mu: Math.round(mu * 100) / 100,
    sigma: Math.round(sigma * 100) / 100,
    evidence,
    lastPracticed: evidence ? new Date(Date.now() - daysAgo * 86400000).toISOString() : undefined,
    trend,
  };
});

export const frameworks: Framework[] = [
  {
    id: 'cka',
    name: 'CKA',
    fullName: 'Certified Kubernetes Administrator',
    vendor: 'CNCF',
    domains: [
      { id: 'cka:cluster-architecture', name: 'Cluster architecture, installation & configuration', weight: 0.25, skillIds: ['k8s.arch.control-plane', 'k8s.arch.etcd-backup', 'k8s.arch.upgrade', 'k8s.arch.node-maintenance', 'k8s.rbac.roles'] },
      { id: 'cka:workloads', name: 'Workloads & scheduling', weight: 0.15, skillIds: ['k8s.wl.deployments', 'k8s.wl.scheduling', 'k8s.wl.probes'] },
      { id: 'cka:services-networking', name: 'Services & networking', weight: 0.2, skillIds: ['k8s.net.services', 'k8s.net.ingress', 'k8s.net.dns', 'k8s.net.network-policy'] },
      { id: 'cka:storage', name: 'Storage', weight: 0.1, skillIds: ['k8s.storage.pv'] },
      { id: 'cka:troubleshooting', name: 'Troubleshooting', weight: 0.3, skillIds: ['k8s.ts.logs-events', 'k8s.ts.node-failure'] },
    ],
  },
  {
    id: 'cks',
    name: 'CKS',
    fullName: 'Certified Kubernetes Security Specialist',
    vendor: 'CNCF',
    domains: [
      { id: 'cks:cluster-setup', name: 'Cluster setup', weight: 0.15, skillIds: ['k8s.net.network-policy', 'k8s.net.ingress', 'k8s.arch.control-plane'] },
      { id: 'cks:cluster-hardening', name: 'Cluster hardening', weight: 0.15, skillIds: ['k8s.rbac.roles', 'k8s.rbac.service-accounts', 'k8s.arch.upgrade'] },
      { id: 'cks:system-hardening', name: 'System hardening', weight: 0.1, skillIds: ['linux.users.ssh', 'linux.net.firewall', 'k8s.sec.security-context'] },
      { id: 'cks:microservice-vulns', name: 'Minimize microservice vulnerabilities', weight: 0.2, skillIds: ['k8s.sec.pod-security', 'k8s.sec.security-context', 'k8s.sec.secrets'] },
      { id: 'cks:supply-chain', name: 'Supply chain security', weight: 0.2, skillIds: ['k8s.sec.supply-chain'] },
      { id: 'cks:monitoring-runtime', name: 'Monitoring, logging & runtime security', weight: 0.2, skillIds: ['k8s.sec.runtime', 'k8s.rbac.audit', 'k8s.ts.logs-events'] },
    ],
  },
  {
    id: 'lfcs',
    name: 'LFCS',
    fullName: 'Linux Foundation Certified System Administrator',
    vendor: 'Linux Foundation',
    domains: [
      { id: 'lfcs:operations', name: 'Operations & deployment', weight: 0.25, skillIds: ['linux.ops.systemd', 'linux.ops.cron', 'linux.ops.logs'] },
      { id: 'lfcs:networking', name: 'Networking', weight: 0.25, skillIds: ['linux.net.interfaces', 'linux.net.firewall'] },
      { id: 'lfcs:storage', name: 'Storage', weight: 0.2, skillIds: ['linux.storage.lvm', 'linux.storage.fs'] },
      { id: 'lfcs:commands', name: 'Essential commands', weight: 0.2, skillIds: ['linux.cmd.shell', 'linux.cmd.permissions'] },
      { id: 'lfcs:users', name: 'Users & groups', weight: 0.1, skillIds: ['linux.users.accounts', 'linux.users.ssh'] },
    ],
  },
  {
    id: 'ccna',
    name: 'CCNA',
    fullName: 'Cisco Certified Network Associate',
    vendor: 'Cisco',
    domains: [
      { id: 'ccna:fundamentals', name: 'Network fundamentals', weight: 0.2, skillIds: ['net.l3.subnetting'] },
      { id: 'ccna:access', name: 'Network access', weight: 0.2, skillIds: ['net.l2.vlans', 'net.l2.stp'] },
      { id: 'ccna:connectivity', name: 'IP connectivity', weight: 0.25, skillIds: ['net.l3.static', 'net.l3.ospf'] },
      { id: 'ccna:services', name: 'IP services', weight: 0.1, skillIds: ['net.svc.nat-dhcp'] },
      { id: 'ccna:security', name: 'Security fundamentals', weight: 0.15, skillIds: ['net.sec.acl', 'net.sec.aaa'] },
    ],
  },
];
