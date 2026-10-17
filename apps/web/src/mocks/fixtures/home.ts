import type { Activity, GoalDomain, GoalForecast, HomeData, Learner, LearnerGoals, Recommendation } from '@/api/types';
import { frameworkReadiness } from '@/lib/readiness';
import { pct } from '@/lib/utils';
import { frameworks, skillStates, skills } from './skills';

/*
 * Two Home personas, shaped like the gateway's /api/home:
 *   homeData      a learner with months of history (Ingrid, and every persona by default)
 *   coldHomeData  a new learner with no graded practice (COLD_START_USER)
 */

/** Same planning constants as services/gateway/src/learner/home.ts. */
const READY_AT = 0.75;
const MINUTES_FROM_ZERO = 2400;
const DAY = 86_400_000;
const minutesToReady = (readiness: number) => Math.round((Math.max(0, READY_AT - readiness) / READY_AT) * MINUTES_FROM_ZERO);
const dailyNeeded = (minutes: number, date: string) => Math.ceil(minutes / Math.max(1, Math.ceil((Date.parse(`${date}T23:59:59Z`) - Date.now()) / DAY)));
const isoDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000).toISOString();
const round2 = (v: number) => Math.round(v * 100) / 100;

export const learner: Learner = {
  id: 'u-ingrid',
  name: 'Ingrid Solvang',
  email: 'ingrid.solvang@quillmoor.example',
  role: 'admin',
  team: 'Platform Reliability',
  org: 'Quillmoor Logistics',
  streakDays: 6,
  minutesThisWeek: 142,
};

const stateOf = new Map(skillStates.map((s) => [s.skillId, s]));
const state = (id: string) => stateOf.get(id)!;

/* ------------------------------------------------------------------ */
/* Mature learner: goal computed from the same skill states and        */
/* framework weights the Skills screen uses, so both agree.             */
/* ------------------------------------------------------------------ */

const cks = frameworks.find((f) => f.id === 'cks')!;
const cksReadiness = frameworkReadiness(cks, skillStates);

/** Week-over-week movement per domain (fixture only; the learner model would supply this). */
const delta7d: Record<string, number> = {
  'cks:cluster-setup': 0.04,
  'cks:cluster-hardening': 0.06,
  'cks:system-hardening': 0.0,
  'cks:microservice-vulns': 0.09,
  'cks:supply-chain': 0.0,
  'cks:monitoring-runtime': -0.02,
};
/** A lab to practise each domain next (from the mock catalog). */
const nextLab: Record<string, string> = {
  'cks:cluster-setup': 'orchard-ingress-tls-rotation',
  'cks:cluster-hardening': 'ledger-rbac-least-privilege',
  'cks:system-hardening': 'harbor-systemd-hardening',
  'cks:microservice-vulns': 'orchard-psa-baseline',
  'cks:monitoring-runtime': 'orchard-audit-policy',
};

const perDomain: GoalDomain[] = cksReadiness.perDomain
  .map((d) => ({
    domainId: d.domainId,
    readiness: round2(d.mean),
    delta7d: delta7d[d.domainId] ?? 0,
    weight: round2(d.weight),
    practisedSkills: d.states.filter((s) => s.evidence > 0).length,
    skills: cks.domains.find((x) => x.id === d.domainId)!.skillIds.length,
    ...(nextLab[d.domainId] ? { labId: nextLab[d.domainId] } : {}),
  }))
  .sort((a, b) => b.weight * (1 - b.readiness) - a.weight * (1 - a.readiness));

const cksTarget = '2026-12-04';
const cksToReady = minutesToReady(round2(cksReadiness.readiness));

export const goal: GoalForecast = {
  frameworkId: 'cks',
  targetDate: cksTarget,
  targetDateSource: 'assignment',
  readiness: round2(cksReadiness.readiness),
  readyAt: READY_AT,
  forecastReadyDate: isoDays(Math.ceil((cksToReady / 150) * 7)),
  confidence: 'estimate',
  sessions: 11,
  weeklyMinutes: 150,
  minutesToReady: cksToReady,
  dailyMinutesNeeded: dailyNeeded(cksToReady, cksTarget),
  perDomain,
};

const monitoring = cksReadiness.perDomain.find((d) => d.domainId === 'cks:monitoring-runtime')!;
const system = cksReadiness.perDomain.find((d) => d.domainId === 'cks:system-hardening')!;
const lvm = state('linux.storage.lvm');
const daysSince = (iso?: string) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / DAY) : 0);

export const recommendations: Recommendation[] = [
  {
    labId: 'orchard-audit-policy',
    score: 0.86,
    predictedSuccess: 0.63,
    expectedGain: 18,
    confidence: 'estimate',
    evidenceSkills: 2,
    readinessGain: 0.031,
    goalDomainIds: ['cks:monitoring-runtime', 'cks:cluster-setup'],
    reasons: [
      { kind: 'goal', text: `Practises ${monitoring.name} (${pct(monitoring.weight)} of CKS), at ${pct(monitoring.mean)}, plus 1 more exam domain.` },
      { kind: 'review', text: 'Audit policy has the least evidence of any CKS skill you have touched.' },
      { kind: 'gain', text: 'Pitched at your level: hard enough to learn from, likely to pass.' },
    ],
  },
  {
    labId: 'harbor-systemd-hardening',
    score: 0.74,
    predictedSuccess: 0.71,
    expectedGain: 11,
    confidence: 'estimate',
    evidenceSkills: 2,
    readinessGain: 0.012,
    goalDomainIds: ['cks:system-hardening'],
    buildsOn: { labId: 'harbor-ssh-key-only', title: 'Move harbor-vm to key-only SSH with a bastion user' },
    reasons: [
      { kind: 'goal', text: `Practises ${system.name} (${pct(system.weight)} of CKS), at ${pct(system.mean)}.` },
      { kind: 'prereq', text: 'Builds on Move harbor-vm to key-only SSH with a bastion user, which you worked on recently.' },
      { kind: 'variety', text: 'A Linux lab between Kubernetes ones helps retention.' },
    ],
  },
  {
    labId: 'quill-lvm-extend',
    score: 0.61,
    predictedSuccess: 0.8,
    expectedGain: 7,
    confidence: 'estimate',
    evidenceSkills: 1,
    readinessGain: 0,
    goalDomainIds: [],
    reasons: [
      { kind: 'variety', text: 'Outside CKS: keeps your Linux storage skills from fading.' },
      { kind: 'review', text: `LVM was last practised ${daysSince(lvm.lastPracticed)} days ago.` },
      { kind: 'gain', text: 'Should feel comfortable: a quick confidence win.' },
    ],
  },
];

export const activity: Activity[] = [
  { id: 'a1', kind: 'check_passed', at: h(3), labId: 'orchard-netpol-isolation', text: 'Working on Isolate the payments namespace with NetworkPolicy at 2 of 5 checks.' },
  { id: 'a2', kind: 'hint_used', at: h(3.2), labId: 'orchard-netpol-isolation', text: 'Used 1 hint in Isolate the payments namespace with NetworkPolicy.' },
  { id: 'a3', kind: 'lab_completed', at: h(27), labId: 'ledger-rbac-least-privilege', text: 'Completed Scope the deploy bot to least privilege across two clusters (91%).' },
  { id: 'a4', kind: 'skill_up', at: h(27), text: `Roles & bindings rose to ${pct(state('k8s.rbac.roles').mu)}.` },
  { id: 'a5', kind: 'lab_completed', at: h(52), labId: 'orchard-psa-baseline', text: 'Completed Enforce baseline Pod Security on tenant namespaces (100%).' },
  { id: 'a6', kind: 'path_completed', at: h(140), text: 'Reached 75% of CKA foundations.' },
];

export const masteryByDomain: HomeData['masteryByDomain'] = (['kubernetes', 'linux', 'networking'] as const).map((domain) => {
  const ids = skills.filter((s) => s.domain === domain).map((s) => s.id);
  const states = skillStates.filter((st) => ids.includes(st.skillId));
  const practiced = states.filter((s) => s.evidence > 0);
  const mastery = practiced.length ? practiced.reduce((a, s) => a + s.mu, 0) / practiced.length : 0;
  return { domain, mastery: Math.round(mastery * 100) / 100, skills: ids.length, practicedSkills: practiced.length };
});

export const homeData: HomeData = {
  learner,
  recommendations,
  goal,
  activity,
  masteryByDomain,
  // Started three hours ago, 2 of 5 checks, environment since closed.
  resume: { labId: 'orchard-netpol-isolation', startedAt: h(3.4), attempts: 1, checksPassed: 2, checksTotal: 5, validations: 3 },
};

/* ------------------------------------------------------------------ */
/* Cold start: signed up this week, opened one lab twice, never ran     */
/* Validate. Mirrors what the gateway sends for such a learner.         */
/* ------------------------------------------------------------------ */

export const COLD_START_USER = 'u-noor';

const coldTarget = isoDays(75);

export const coldHomeData: HomeData = {
  learner: { ...learner, id: COLD_START_USER, name: 'Noor Aziz', email: 'noor.aziz@quillmoor.example', role: 'learner', team: '', streakDays: 0, minutesThisWeek: 0 },
  recommendations: [
    {
      labId: 'ledger-rbac-least-privilege',
      score: 0.9,
      predictedSuccess: 0.27,
      expectedGain: 71,
      confidence: 'prior',
      evidenceSkills: 0,
      readinessGain: 0.029,
      goalDomainIds: ['cks:cluster-hardening'],
      reasons: [
        { kind: 'goal', text: 'Practises Cluster hardening (15% of CKS), with no results yet.' },
        { kind: 'gain', text: 'No results for its skills yet, so it also shows where you stand.' },
      ],
    },
  ],
  goal: {
    frameworkId: 'cks',
    targetDate: coldTarget,
    targetDateSource: 'default',
    readiness: 0,
    readyAt: READY_AT,
    forecastReadyDate: isoDays(Math.ceil((MINUTES_FROM_ZERO / 150) * 7)),
    confidence: 'prior',
    sessions: 0,
    weeklyMinutes: 0,
    minutesToReady: MINUTES_FROM_ZERO,
    dailyMinutesNeeded: dailyNeeded(MINUTES_FROM_ZERO, coldTarget),
    perDomain: [...cks.domains]
      .sort((a, b) => b.weight - a.weight)
      .map((d) => ({ domainId: d.id, readiness: 0, delta7d: 0, weight: d.weight, practisedSkills: 0, skills: d.skillIds.length, ...(nextLab[d.id] ? { labId: nextLab[d.id] } : {}) })),
  },
  activity: [{ id: 'c1', kind: 'lab_started', at: h(50), labId: 'orchard-netpol-isolation', text: 'Opened Isolate the payments namespace with NetworkPolicy 2 times; no checks run yet, environment closed.' }],
  masteryByDomain: masteryByDomain.map((m) => ({ ...m, mastery: 0, practicedSkills: 0 })),
  resume: { labId: 'orchard-netpol-isolation', startedAt: h(50), attempts: 2, checksPassed: 0, checksTotal: 5, validations: 0 },
  coldStart: {
    baselineLabIds: ['orchard-psa-baseline', 'harbor-ssh-key-only'],
    baselineMinutes: 30,
    plan: [
      { day: 1, title: 'Baseline: 2 short labs', minutes: 30 },
      { day: 2, title: 'Finish Isolate the payments namespace with NetworkPolicy', labId: 'orchard-netpol-isolation', minutes: 25 },
      { day: 3, title: 'Capture Secret access in the API audit log', labId: 'orchard-audit-policy', minutes: 35 },
      { day: 4, title: 'Scope the deploy bot to least privilege across two clusters', labId: 'ledger-rbac-least-privilege', minutes: 30 },
      { day: 5, title: 'Rotate the expiring TLS certificate on the portal ingress', labId: 'orchard-ingress-tls-rotation', minutes: 20 },
    ],
  },
  assignmentsDue: [],
  source: 'live',
};

/** The goal with the learner's own exam date and weekly target applied, as the gateway's buildHome does. */
export function withGoals(g: GoalForecast, goals: LearnerGoals | undefined): GoalForecast {
  if (!goals) return g;
  const own = goals.targetDate;
  const targetDate = own ?? g.targetDate;
  return {
    ...g,
    targetDate,
    targetDateSource: own ? 'learner' : g.targetDateSource,
    dailyMinutesNeeded: dailyNeeded(g.minutesToReady ?? 0, targetDate),
    ...(goals.weeklyTargetMinutes ? { weeklyTargetMinutes: goals.weeklyTargetMinutes } : {}),
  };
}
