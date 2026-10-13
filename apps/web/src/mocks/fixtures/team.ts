import type { TeamData, TeamMember } from '@/api/types';

const competencies: TeamData['competencies'] = [
  { id: 'c.k8s.arch', name: 'Cluster architecture', domain: 'kubernetes' },
  { id: 'c.k8s.rbac', name: 'Access control', domain: 'kubernetes' },
  { id: 'c.k8s.net', name: 'K8s networking', domain: 'kubernetes' },
  { id: 'c.k8s.sec', name: 'Hardening', domain: 'kubernetes' },
  { id: 'c.k8s.ts', name: 'Troubleshooting', domain: 'kubernetes' },
  { id: 'c.linux.ops', name: 'Linux operations', domain: 'linux' },
  { id: 'c.linux.storage', name: 'Linux storage', domain: 'linux' },
  { id: 'c.linux.users', name: 'Users & SSH', domain: 'linux' },
  { id: 'c.net.l2', name: 'Switching', domain: 'networking' },
  { id: 'c.net.l3', name: 'Routing', domain: 'networking' },
  { id: 'c.net.sec', name: 'Network security', domain: 'networking' },
];

const m = (
  id: string,
  name: string,
  title: string,
  skills: number[],
  certs: TeamMember['certs'],
  minutesThisMonth: number,
): TeamMember => ({
  id,
  name,
  title,
  skills: Object.fromEntries(competencies.map((c, i) => [c.id, skills[i] ?? 0])),
  certs,
  minutesThisMonth,
});

export const teamData: TeamData = {
  team: { id: 't-platrel', name: 'Platform Reliability', manager: 'Ingrid Solvang' },
  competencies,
  members: [
    m('u-ingrid', 'Ingrid Solvang', 'Staff SRE', [0.82, 0.84, 0.71, 0.52, 0.8, 0.77, 0.6, 0.74, 0.3, 0.26, 0.35], [{ frameworkId: 'cks', deadline: '2026-12-04', readiness: 0.58, forecast: '2026-11-20' }], 540),
    m('u-tomas', 'Tomas Ferreira', 'Platform engineer', [0.66, 0.58, 0.74, 0.44, 0.61, 0.52, 0.41, 0.6, 0.12, 0.18, 0.2], [{ frameworkId: 'cka', deadline: '2026-11-08', readiness: 0.63, forecast: '2026-11-29' }], 310),
    m('u-mira', 'Mira Adeyemi', 'Network engineer', [0.31, 0.28, 0.46, 0.22, 0.35, 0.58, 0.44, 0.63, 0.88, 0.84, 0.79], [{ frameworkId: 'ccna', deadline: '2026-10-28', readiness: 0.9, forecast: '2026-10-19' }], 420),
    m('u-samir', 'Samir Haddad', 'SRE', [0.74, 0.69, 0.62, 0.7, 0.72, 0.81, 0.73, 0.79, 0.25, 0.3, 0.41], [{ frameworkId: 'cks', deadline: '2026-11-15', readiness: 0.69, forecast: '2026-11-11' }, { frameworkId: 'lfcs', deadline: '2027-02-01', readiness: 0.82, forecast: '2026-12-10' }], 610),
    m('u-lena', 'Lena Varga', 'Junior SRE', [0.42, 0.36, 0.3, 0.2, 0.44, 0.55, 0.38, 0.5, 0.15, 0.1, 0.12], [{ frameworkId: 'lfcs', deadline: '2026-11-02', readiness: 0.48, forecast: '2026-12-22' }], 760),
    m('u-kofi', 'Kofi Mensah', 'Platform engineer', [0.6, 0.72, 0.55, 0.38, 0.58, 0.47, 0.35, 0.56, 0.2, 0.22, 0.28], [{ frameworkId: 'cka', deadline: '2027-01-20', readiness: 0.55, forecast: '2027-01-12' }], 180),
    m('u-aino', 'Aino Lehto', 'Security engineer', [0.5, 0.78, 0.6, 0.86, 0.52, 0.64, 0.4, 0.82, 0.3, 0.3, 0.7], [{ frameworkId: 'cks', deadline: '2026-11-30', readiness: 0.81, forecast: '2026-11-05' }], 390),
  ],
  workshops: [
    {
      id: 'w1',
      title: 'Hardening clinic: Pod Security, secrets and supply chain',
      competencyId: 'c.k8s.sec',
      reason: 'Four members sit below 0.5 on Hardening and two of them have a CKS deadline inside 8 weeks.',
      memberIds: ['u-ingrid', 'u-tomas', 'u-lena', 'u-kofi'],
      durationMinutes: 90,
    },
    {
      id: 'w2',
      title: 'Routing fundamentals for platform engineers',
      competencyId: 'c.net.l3',
      reason: 'Team Routing average is 0.33; the Q1 on-call rotation adds the edge network to the pager.',
      memberIds: ['u-ingrid', 'u-tomas', 'u-samir', 'u-lena', 'u-kofi'],
      durationMinutes: 120,
    },
    {
      id: 'w3',
      title: 'Pairing: LVM and filesystems with Samir',
      competencyId: 'c.linux.storage',
      reason: 'Lena is forecast to miss the LFCS deadline by 7 weeks; Storage is her lowest weighted domain.',
      memberIds: ['u-lena', 'u-samir'],
      durationMinutes: 60,
    },
  ],
};
