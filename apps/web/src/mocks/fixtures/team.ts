import type { FrameworkId, SkillState, TeamData, TeamMember } from '@/api/types';
import { frameworkReadiness } from '@/lib/readiness';
import { frameworks, seeded, skillStates, skills } from './skills';

const competencies: TeamData['competencies'] = [
  { id: 'c.k8s.arch', name: 'Cluster architecture', domain: 'kubernetes' },
  { id: 'c.k8s.rbac', name: 'Access control', domain: 'kubernetes' },
  { id: 'c.k8s.net', name: 'K8s networking', domain: 'kubernetes' },
  { id: 'c.k8s.sec', name: 'Hardening', domain: 'kubernetes' },
  // Soft hyphen: a break opportunity for narrow heatmap columns even without a hyphenation dictionary.
  { id: 'c.k8s.ts', name: 'Trouble­shooting', domain: 'kubernetes' },
  { id: 'c.linux.ops', name: 'Linux operations', domain: 'linux' },
  { id: 'c.linux.storage', name: 'Linux storage', domain: 'linux' },
  { id: 'c.linux.users', name: 'Users & SSH', domain: 'linux' },
  { id: 'c.net.l2', name: 'Switching', domain: 'networking' },
  { id: 'c.net.l3', name: 'Routing', domain: 'networking' },
  { id: 'c.net.sec', name: 'Network security', domain: 'networking' },
];

/** Which team competency each skill rolls up into (by the skill id's first two segments). */
const competencyByPrefix: Record<string, string> = {
  'k8s.arch': 'c.k8s.arch',
  'k8s.wl': 'c.k8s.arch',
  'k8s.storage': 'c.k8s.arch',
  'k8s.rbac': 'c.k8s.rbac',
  'k8s.net': 'c.k8s.net',
  'k8s.sec': 'c.k8s.sec',
  'k8s.ts': 'c.k8s.ts',
  'linux.cmd': 'c.linux.ops',
  'linux.ops': 'c.linux.ops',
  'linux.net': 'c.linux.ops',
  'linux.storage': 'c.linux.storage',
  'linux.users': 'c.linux.users',
  'net.l2': 'c.net.l2',
  'net.l3': 'c.net.l3',
  'net.svc': 'c.net.l3',
  'net.sec': 'c.net.sec',
};
/** Skills outside the team heatmap's competencies (containers, IaC, automation) roll up into none. */
const competencyOf = (skillId: string): string | undefined => competencyByPrefix[skillId.split('.').slice(0, 2).join('.')];

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Per-skill states for a member, spread around their competency score (deterministic per member). */
function statesFromCompetencies(memberId: string, byCompetency: Record<string, number>): SkillState[] {
  return skills.map((s) => {
    const c = competencyOf(s.id);
    const base = (c ? byCompetency[c] : undefined) ?? 0.3;
    const r = seeded(`${memberId}:${s.id}`);
    const mu = clamp(base + (r - 0.5) * 0.24, 0.05, 0.97);
    const sigma = round2(0.1 + seeded(`${memberId}:${s.id}:sig`) * 0.2);
    const evidence = base < 0.15 ? 0 : Math.round(2 + seeded(`${memberId}:${s.id}:ev`) * 12);
    const daysAgo = Math.round(1 + seeded(`${memberId}:${s.id}:d`) * 45);
    return {
      skillId: s.id,
      mu: round2(mu),
      sigma: evidence ? sigma : 0.42,
      evidence,
      lastPracticed: evidence ? new Date(Date.now() - daysAgo * 86400000).toISOString() : undefined,
      trend: r > 0.66 ? 'up' : r > 0.3 ? 'flat' : 'down',
    };
  });
}

/** Competency means rolled up from skill states (used for the signed-in learner, whose states are the source of truth). */
function competenciesFromStates(states: SkillState[]): Record<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const st of states) {
    const c = competencyOf(st.skillId);
    if (!c) continue;
    const cur = sums.get(c) ?? { total: 0, n: 0 };
    sums.set(c, { total: cur.total + st.mu, n: cur.n + 1 });
  }
  return Object.fromEntries(competencies.map((c) => [c.id, round2((sums.get(c.id)?.total ?? 0) / Math.max(1, sums.get(c.id)?.n ?? 1))]));
}

const LEARNER_ID = 'u-ingrid';
const memberStates = new Map<string, SkillState[]>();

interface MemberSeed {
  id: string;
  name: string;
  title: string;
  /** Competency scores in `competencies` order; omitted for the learner (derived from skill states). */
  skills?: number[];
  certs: { frameworkId: FrameworkId; deadline: string; forecast: string }[];
  minutesThisMonth: number;
}

function member(seed: MemberSeed): TeamMember {
  const byCompetency = seed.skills ? Object.fromEntries(competencies.map((c, i) => [c.id, seed.skills![i] ?? 0])) : competenciesFromStates(skillStates);
  const states = seed.id === LEARNER_ID ? skillStates : statesFromCompetencies(seed.id, byCompetency);
  memberStates.set(seed.id, states);
  return {
    id: seed.id,
    name: seed.name,
    title: seed.title,
    skills: byCompetency,
    certs: seed.certs.map((c) => {
      const fw = frameworks.find((f) => f.id === c.frameworkId)!;
      return { ...c, readiness: round2(frameworkReadiness(fw, states).readiness) };
    }),
    minutesThisMonth: seed.minutesThisMonth,
  };
}

export const teamData: TeamData = {
  team: { id: 't-platrel', name: 'Platform Reliability', manager: 'Ingrid Solvang' },
  competencies,
  members: [
    member({ id: LEARNER_ID, name: 'Ingrid Solvang', title: 'Staff SRE', certs: [{ frameworkId: 'cks', deadline: '2026-12-04', forecast: '2026-11-20' }], minutesThisMonth: 540 }),
    member({ id: 'u-tomas', name: 'Tomas Ferreira', title: 'Platform engineer', skills: [0.66, 0.58, 0.74, 0.44, 0.61, 0.52, 0.41, 0.6, 0.12, 0.18, 0.2], certs: [{ frameworkId: 'cka', deadline: '2026-11-08', forecast: '2026-11-29' }], minutesThisMonth: 310 }),
    member({ id: 'u-mira', name: 'Mira Adeyemi', title: 'Network engineer', skills: [0.31, 0.28, 0.46, 0.22, 0.35, 0.58, 0.44, 0.63, 0.88, 0.84, 0.79], certs: [{ frameworkId: 'ccna', deadline: '2026-10-28', forecast: '2026-10-19' }], minutesThisMonth: 420 }),
    member({ id: 'u-samir', name: 'Samir Haddad', title: 'SRE', skills: [0.74, 0.69, 0.62, 0.7, 0.72, 0.81, 0.73, 0.79, 0.25, 0.3, 0.41], certs: [{ frameworkId: 'cks', deadline: '2026-11-15', forecast: '2026-11-11' }, { frameworkId: 'lfcs', deadline: '2027-02-01', forecast: '2026-12-10' }], minutesThisMonth: 610 }),
    member({ id: 'u-lena', name: 'Lena Varga', title: 'Junior SRE', skills: [0.42, 0.36, 0.3, 0.2, 0.44, 0.55, 0.38, 0.5, 0.15, 0.1, 0.12], certs: [{ frameworkId: 'lfcs', deadline: '2026-11-02', forecast: '2026-12-22' }], minutesThisMonth: 760 }),
    member({ id: 'u-kofi', name: 'Kofi Mensah', title: 'Platform engineer', skills: [0.6, 0.72, 0.55, 0.38, 0.58, 0.47, 0.35, 0.56, 0.2, 0.22, 0.28], certs: [{ frameworkId: 'cka', deadline: '2027-01-20', forecast: '2027-01-12' }], minutesThisMonth: 180 }),
    member({ id: 'u-aino', name: 'Aino Lehto', title: 'Security engineer', skills: [0.5, 0.78, 0.6, 0.86, 0.52, 0.64, 0.4, 0.82, 0.3, 0.3, 0.7], certs: [{ frameworkId: 'cks', deadline: '2026-11-30', forecast: '2026-11-05' }], minutesThisMonth: 390 }),
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

/** Skill states for a team member (the learner's own states for the signed-in user). */
export function memberSkillStates(memberId: string): SkillState[] | undefined {
  return memberStates.get(memberId);
}

export function memberById(memberId: string): TeamMember | undefined {
  return teamData.members.find((m) => m.id === memberId);
}
