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
  // Containers
  { id: 'ctr.build.dockerfile', name: 'Dockerfiles & BuildKit', domain: 'containers', competency: 'Images' },
  { id: 'ctr.build.registry', name: 'Tags, registries & pushes', domain: 'containers', competency: 'Images' },
  { id: 'ctr.run.compose', name: 'Compose applications', domain: 'containers', competency: 'Running containers' },
  { id: 'ctr.run.troubleshoot', name: 'Container troubleshooting', domain: 'containers', competency: 'Running containers' },
  { id: 'ctr.sec.supply-chain', name: 'Scanning, SBOM & signing', domain: 'containers', competency: 'Supply chain' },
  // Infrastructure as code
  { id: 'iac.core.workflow', name: 'init, plan & apply', domain: 'iac', competency: 'Terraform core' },
  { id: 'iac.core.expressions', name: 'Variables & expressions', domain: 'iac', competency: 'Terraform core' },
  { id: 'iac.state.backends', name: 'State & backends', domain: 'iac', competency: 'State' },
  { id: 'iac.state.import-drift', name: 'Import & drift', domain: 'iac', competency: 'State' },
  { id: 'iac.modules.authoring', name: 'Module authoring', domain: 'iac', competency: 'Modules' },
  // Automation
  { id: 'auto.ansible.playbooks', name: 'Playbooks & handlers', domain: 'automation', competency: 'Ansible' },
  { id: 'auto.ansible.inventory', name: 'Inventories & variables', domain: 'automation', competency: 'Ansible' },
  { id: 'auto.ansible.roles', name: 'Roles & collections', domain: 'automation', competency: 'Ansible' },
];

export const skillById = new Map(skills.map((s) => [s.id, s]));

/** Deterministic pseudo-random helper so fixtures are stable between reloads. */
export function seeded(key: string): number {
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
const untouched = new Set(['net.sec.aaa', 'net.svc.nat-dhcp', 'linux.net.firewall', 'auto.ansible.playbooks', 'auto.ansible.inventory', 'auto.ansible.roles', 'ctr.sec.supply-chain', 'iac.state.import-drift']);

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

const DISCLAIMER = {
  CNCF: 'CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. Certification names are trademarks of their owners. This framework maps CloudTrain skills to objectives aligned to that exam; readiness shown here confers no certification.',
  LF: 'CloudTrain is not affiliated with or endorsed by The Linux Foundation. LFCS is a trademark of The Linux Foundation. This framework maps CloudTrain skills to objectives aligned to that exam; readiness shown here confers no certification.',
  CISCO: 'CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. CCNA is a trademark of Cisco Systems, Inc. This framework maps CloudTrain skills to objectives aligned to that exam; readiness shown here confers no certification.',
  of: (body: string) => `CloudTrain is not affiliated with or endorsed by ${body.replace(/\.$/, '')}. Certification and exam names are trademarks of their respective owners. This framework maps CloudTrain skills to objectives aligned to that exam; readiness shown here confers no certification.`,
};

const handWritten: Framework[] = [
  {
    id: 'cka',
    name: 'CKA',
    fullName: 'Certified Kubernetes Administrator',
    vendor: 'CNCF',
    domain: 'kubernetes',
    group: 'Kubernetes',
    coverage: 1,
    disclaimer: DISCLAIMER.CNCF,
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
    domain: 'kubernetes',
    group: 'Kubernetes',
    coverage: 1,
    disclaimer: DISCLAIMER.CNCF,
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
    domain: 'linux',
    group: 'Linux',
    coverage: 1,
    disclaimer: DISCLAIMER.LF,
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
    domain: 'networking',
    group: 'Networking',
    coverage: 1,
    disclaimer: DISCLAIMER.CISCO,
    domains: [
      { id: 'ccna:fundamentals', name: 'Network fundamentals', weight: 0.2, skillIds: ['net.l3.subnetting'] },
      { id: 'ccna:access', name: 'Network access', weight: 0.2, skillIds: ['net.l2.vlans', 'net.l2.stp'] },
      { id: 'ccna:connectivity', name: 'IP connectivity', weight: 0.25, skillIds: ['net.l3.static', 'net.l3.ospf'] },
      { id: 'ccna:services', name: 'IP services', weight: 0.1, skillIds: ['net.svc.nat-dhcp'] },
      { id: 'ccna:security', name: 'Security fundamentals', weight: 0.15, skillIds: ['net.sec.acl', 'net.sec.aaa'] },
      { id: 'ccna:automation', name: 'Automation and programmability', weight: 0.1, skillIds: [] },
    ],
  },
];

type Objective = [id: string, title: string, weight: number | undefined, skillIds: string[]];

/**
 * A framework generated from the curriculum (content/frameworks/<id>.yaml): weights are
 * percentages or absent (objectives then count equally), as the gateway maps them.
 */
function generated(id: string, name: string, fullName: string, vendor: string, domain: Framework['domain'], group: string, coverage: number, objectives: Objective[]): Framework {
  const total = objectives.reduce((a, o) => a + (o[2] ?? 0), 0);
  return {
    id,
    name,
    fullName,
    vendor,
    ...(domain ? { domain } : {}),
    group,
    coverage,
    ...(vendor !== 'CloudTrain' ? { disclaimer: DISCLAIMER.of(vendor) } : {}),
    domains: objectives.map(([oid, title, w, skillIds]) => ({ id: `${id}:${oid}`, name: title, weight: total ? (w ?? 0) / total : 1 / objectives.length, skillIds })),
  };
}

const RH = 'Red Hat, Inc.';
const HC = 'HashiCorp, an IBM Company';

/** The mock serves the same set the real content does: hand-written frameworks plus the curriculum's. */
const curriculumFrameworks: Framework[] = [
  generated('ckad', 'CKAD', 'Certified Kubernetes Application Developer', 'CNCF / Linux Foundation', 'kubernetes', 'Kubernetes', 1, [
    ['design-build', 'Application design and build', 20, ['k8s.wl.deployments', 'k8s.wl.probes']],
    ['deployment', 'Application deployment', 20, ['k8s.wl.deployments', 'k8s.wl.scheduling']],
    ['observability-maintenance', 'Application observability and maintenance', 15, ['k8s.wl.probes', 'k8s.ts.logs-events']],
    ['environment-config-security', 'Application environment, configuration and security', 25, ['k8s.rbac.service-accounts', 'k8s.sec.secrets', 'k8s.sec.security-context']],
    ['services-networking', 'Services and networking', 20, ['k8s.net.services', 'k8s.net.ingress', 'k8s.net.network-policy']],
  ]),
  generated('rhcsa-aligned', 'RHCSA', 'Red Hat Certified System Administrator objective themes, RHEL 10 with RHEL 9 toggle', RH, 'linux', 'Linux', 0.91, [
    ['essential-tools', 'Essential tools (shell, files, links, archives, permissions, docs)', 15, ['linux.cmd.shell', 'linux.cmd.permissions']],
    ['running-systems', 'Operating running systems (boot, targets, processes, tuning, logs)', 12, ['linux.ops.systemd', 'linux.ops.logs']],
    ['local-storage', 'Partitions, LVM and swap', 12, ['linux.storage.lvm']],
    ['filesystems', 'File systems, NFS and autofs', 10, ['linux.storage.fs']],
    ['deploy-maintain', 'Scheduling, services, time, bootloader', 12, ['linux.ops.cron', 'linux.ops.systemd']],
    ['networking', 'Basic networking and firewall', 8, ['linux.net.interfaces', 'linux.net.firewall']],
    ['users-groups', 'Users, groups, password aging and sudo', 8, ['linux.users.accounts']],
    ['security', 'firewalld, SSH keys and SELinux', 8, ['linux.users.ssh', 'linux.net.firewall']],
    ['containers', 'Containers with Podman (RHEL 9 variant only)', 0, []],
  ]),
  generated('linuxplus', 'Linux+', 'CompTIA Linux+ domains', 'CompTIA, Inc.', 'linux', 'Linux', 1, [
    ['system-management', 'System management', 23, ['linux.storage.lvm', 'linux.storage.fs', 'linux.ops.systemd']],
    ['services-users', 'Services and user management', 20, ['linux.users.accounts', 'linux.ops.cron']],
    ['security', 'Security', 18, ['linux.users.ssh', 'linux.net.firewall', 'linux.cmd.permissions']],
    ['automation-scripting', 'Automation, orchestration and scripting', 17, ['linux.cmd.shell', 'auto.ansible.playbooks']],
    ['troubleshooting', 'Troubleshooting', 22, ['linux.ops.logs', 'linux.net.interfaces']],
  ]),
  generated('lpic1', 'LPIC-1', 'LPIC-1 topics', 'Linux Professional Institute', 'linux', 'Linux', 1, [
    ['gnu-commands', 'GNU and Unix commands', undefined, ['linux.cmd.shell']],
    ['devices-filesystems', 'Devices, filesystems and the FHS', undefined, ['linux.storage.fs', 'linux.cmd.permissions']],
    ['admin-tasks', 'Administrative tasks', undefined, ['linux.users.accounts', 'linux.ops.cron']],
    ['essential-services', 'Essential system services', undefined, ['linux.ops.logs', 'linux.ops.systemd']],
    ['networking', 'Networking fundamentals', undefined, ['linux.net.interfaces']],
    ['security', 'Security', undefined, ['linux.users.ssh']],
  ]),
  generated('lpic2', 'LPIC-2', 'LPIC-2 topics, modernised', 'Linux Professional Institute', 'linux', 'Linux', 0.46, [
    ['startup', 'System startup', undefined, ['linux.ops.systemd']],
    ['filesystems', 'Filesystems and devices', undefined, ['linux.storage.fs']],
    ['advanced-storage', 'Advanced storage administration', undefined, ['linux.storage.lvm']],
    ['networking', 'Network configuration', undefined, ['linux.net.interfaces']],
    ['dns', 'Domain name server', undefined, []],
    ['http', 'HTTP services', undefined, []],
    ['file-sharing', 'File sharing', undefined, []],
    ['email', 'E-mail services', undefined, []],
    ['system-security', 'System security', undefined, []],
  ]),
  generated('docker-practitioner', 'Docker Practitioner', 'Docker practitioner practical blueprint', 'CloudTrain', 'containers', 'Containers', 1, [
    ['build', 'Image building with Dockerfiles, BuildKit, buildx and Bake', 18, ['ctr.build.dockerfile']],
    ['registry', 'References, registries and distribution', 8, ['ctr.build.registry']],
    ['compose', 'Multi-container applications with Compose', 15, ['ctr.run.compose']],
    ['networking', 'Container networking and host firewall integration', 15, ['linux.net.firewall', 'ctr.run.compose']],
    ['storage', 'Volumes, mounts and the image store', 8, ['linux.storage.fs']],
    ['security', 'Runtime and engine security', 10, ['k8s.sec.security-context']],
    ['supply-chain', 'Supply chain: scanning, SBOM, provenance, signing and hardened bases', 10, ['ctr.sec.supply-chain']],
    ['operations', 'Running, configuring and troubleshooting containers and the engine', 16, ['ctr.run.troubleshoot']],
  ]),
  generated('ex188-aligned', 'Red Hat Containers', 'Red Hat cloud-native containers exam objective themes', RH, 'containers', 'Containers', 1, [
    ['build-images', 'Building images from a Containerfile', 25, ['ctr.build.dockerfile']],
    ['manage-images', 'Managing images and registries', 20, ['ctr.build.registry']],
    ['run-containers', 'Running and inspecting containers', 20, ['ctr.run.troubleshoot']],
    ['multi-container', 'Multi-container applications', 20, ['ctr.run.compose']],
    ['troubleshoot', 'Troubleshooting containers', 15, ['ctr.run.troubleshoot']],
  ]),
  generated('dca-legacy', 'DCA (legacy)', 'Docker Certified Associate domains, legacy', 'Mirantis, Inc.', 'containers', 'Containers', 0.83, [
    ['orchestration', 'Orchestration', 25, []],
    ['images-registry', 'Image creation, management and registry', 20, ['ctr.build.dockerfile', 'ctr.build.registry']],
    ['install-config', 'Installation and configuration', 15, ['ctr.run.troubleshoot']],
    ['networking', 'Networking', 15, ['ctr.run.compose']],
    ['security', 'Security', 15, ['ctr.sec.supply-chain']],
    ['storage', 'Storage and volumes', 10, ['linux.storage.fs']],
  ]),
  generated('tf-associate', 'Terraform Associate', 'HashiCorp Terraform Associate objective themes', HC, 'iac', 'Infrastructure as code', 1, [
    ['core-workflow', 'Core workflow (init, plan, apply, destroy, fmt, validate)', 12, ['iac.core.workflow']],
    ['configuration', 'Resources, variables, outputs, expressions, dependencies and lifecycle', 20, ['iac.core.expressions']],
    ['modules', 'Modules', 12, ['iac.modules.authoring']],
    ['state', 'State and backends', 12, ['iac.state.backends']],
    ['maintain', 'Import, logging and drift', 6, ['iac.state.import-drift']],
  ]),
  generated('tf-professional', 'Terraform Professional', 'HashiCorp Infrastructure Engineer Professional objective themes', HC, 'iac', 'Infrastructure as code', 1, [
    ['tracing-expressions', 'Tracing for_each, locals and function results', undefined, ['iac.core.expressions']],
    ['risky-changes', 'Spotting risky changes in plans', undefined, ['iac.core.workflow']],
    ['module-contracts-testing', 'Module contracts and terraform test', undefined, ['iac.modules.authoring']],
    ['operations', 'Cost tracking and operations at scale', undefined, ['iac.state.backends']],
  ]),
  generated('tf-advanced', 'Terraform Advanced', 'HashiCorp Terraform Authoring and Operations lab exam themes', HC, 'iac', 'Infrastructure as code', 1, [
    ['lifecycle-import-drift', 'Resource lifecycle, import and drift reconciliation', 25, ['iac.state.import-drift']],
    ['dynamic-config', 'Dynamic configuration', 20, ['iac.core.expressions']],
    ['collaboration', 'Collaborative workflows and cross-workspace data', 15, ['iac.state.backends']],
    ['modules', 'Splitting configuration into modules', 20, ['iac.modules.authoring']],
    ['providers', 'Provider aliasing, upgrades, authentication and troubleshooting', 20, ['iac.core.workflow']],
  ]),
  generated('opentofu', 'OpenTofu', 'OpenTofu differences', 'CloudTrain', 'iac', 'Infrastructure as code', 1, [
    ['encryption', 'State and plan encryption and key rotation', undefined, ['iac.state.backends']],
    ['early-evaluation', 'Early evaluation in backends and module sources', undefined, ['iac.core.expressions']],
    ['migration', 'Migrating a Terraform estate to OpenTofu', undefined, ['iac.core.workflow']],
  ]),
  generated('ex294-aligned', 'RHCE', 'Red Hat Ansible automation exam objective themes', RH, 'automation', 'Automation', 0.2, [
    ['core-components', 'Core components (inventories, modules, variables, facts, loops, conditionals, handlers)', 12, ['auto.ansible.playbooks', 'auto.ansible.inventory']],
    ['managed-nodes', 'Managed node setup, keys and privilege escalation', 8, ['linux.users.ssh']],
    ['roles-collections', 'Roles and collections', 12, ['auto.ansible.roles']],
    ['automate-system-tasks', 'Automating system administration tasks with modules', 20, []],
    ['templates-vault', 'Jinja2 templates and Vault', 8, []],
  ]),
  generated('ex374-aligned', 'Ansible Developer', 'Red Hat advanced Ansible development exam objective themes', RH, 'automation', 'Automation', 0, [
    ['data-transform', 'Lookups, filters and data transformation', undefined, []],
    ['delegation', 'Delegation and orchestration', undefined, []],
    ['collections', 'Creating and publishing collections', undefined, []],
    ['execution-environments', 'Building and running execution environments', undefined, []],
  ]),
  generated('ex467-aligned', 'AAP Operations', 'Red Hat automation platform operations exam objective themes', RH, 'automation', 'Automation', 0, [
    ['rbac', 'Organisations, teams, users and roles', undefined, []],
    ['projects-templates', 'Projects and job templates', undefined, []],
    ['workflows', 'Workflows and approvals', undefined, []],
  ]),
  generated('ex457-aligned', 'Ansible Network', 'Red Hat Ansible network automation exam objective themes', RH, 'automation', 'Automation', 0.14, [
    ['netcommon-modules', 'Platform-agnostic network modules', undefined, ['net.l2.vlans']],
    ['network-roles-templates', 'Network roles and Jinja2-rendered configs', undefined, []],
    ['config-backup', 'Configuration backup and restore', undefined, []],
  ]),
  generated('ct-platform', 'Platform Capstone', 'CloudTrain platform engineer capstone', 'CloudTrain', undefined, 'Platform', 1, [
    ['linux-foundation', 'Linux host operations', 10, ['linux.ops.systemd', 'linux.storage.lvm']],
    ['containers-delivery', 'Container build and delivery', 15, ['ctr.build.dockerfile', 'ctr.sec.supply-chain']],
    ['iac-provisioning', 'Infrastructure provisioning as code', 15, ['iac.core.workflow', 'iac.state.backends']],
    ['config-automation', 'Configuration automation', 15, ['auto.ansible.playbooks']],
    ['kubernetes-operations', 'Kubernetes operations', 20, ['k8s.wl.deployments', 'k8s.arch.upgrade']],
    ['networking-connectivity', 'Network connectivity', 10, ['net.l3.static']],
    ['security-hardening', 'Security hardening', 10, ['k8s.sec.pod-security', 'linux.users.ssh']],
    ['incident-response', 'Incident response', 5, ['k8s.ts.logs-events']],
  ]),
];

/** Group order the gateway uses (content domains, then Platform), then name. */
const GROUP_ORDER = ['Kubernetes', 'Linux', 'Containers', 'Infrastructure as code', 'Automation', 'Networking', 'Platform'];
export const frameworks: Framework[] = [...handWritten, ...curriculumFrameworks].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.name.localeCompare(b.name));
