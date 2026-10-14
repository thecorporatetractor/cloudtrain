import type { Activity, GoalForecast, HomeData, Learner, Recommendation } from '@/api/types';
import { frameworkReadiness } from '@/lib/readiness';
import { pct } from '@/lib/utils';
import { frameworks, skillStates, skills } from './skills';

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
const round2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ */
/* Goal forecast: computed from the same skill states and framework    */
/* weights the Skills screen uses, so both show the same number.        */
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

export const goal: GoalForecast = {
  frameworkId: 'cks',
  targetDate: '2026-12-04',
  readiness: round2(cksReadiness.readiness),
  forecastReadyDate: '2026-11-20',
  weeklyMinutes: 150,
  perDomain: cksReadiness.perDomain.map((d) => ({ domainId: d.domainId, readiness: round2(d.mean), delta7d: delta7d[d.domainId] ?? 0 })),
};

const clusterSetup = cksReadiness.perDomain.find((d) => d.domainId === 'cks:cluster-setup')!;
const monitoring = cksReadiness.perDomain.find((d) => d.domainId === 'cks:monitoring-runtime')!;
const weakest = [...cksReadiness.perDomain].sort((a, b) => a.mean - b.mean)[0]!;
const netpol = state('k8s.net.network-policy');
const services = state('k8s.net.services');
const lvm = state('linux.storage.lvm');
const daysSince = (iso?: string) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0);

export const recommendations: Recommendation[] = [
  {
    labId: 'orchard-netpol-isolation',
    score: 0.91,
    predictedSuccess: 0.72,
    expectedGain: 14,
    reasons: [
      { kind: 'goal', text: weakest.domainId === clusterSetup.domainId ? `${clusterSetup.name} is ${pct(clusterSetup.weight)} of CKS and your weakest domain (${pct(clusterSetup.mean)}).` : `${clusterSetup.name} is ${pct(clusterSetup.weight)} of CKS and sits at ${pct(clusterSetup.mean)}, below your ${pct(cksReadiness.readiness)} overall.` },
      { kind: 'gain', text: `NetworkPolicy mastery is ${netpol.mu.toFixed(2)} ± ${netpol.sigma.toFixed(2)}: ${netpol.sigma > 0.18 ? 'high uncertainty, so one attempt moves the estimate a lot' : 'a focused attempt would confirm it'}.` },
      { kind: 'prereq', text: `You already hold Services & endpoints at ${services.mu.toFixed(2)}, the only prerequisite.` },
      { kind: 'review', text: 'You started this lab 3 days ago and passed 2 of 5 checks; resuming keeps the context warm.' },
      { kind: 'time', text: '25 minutes fits the 30-minute block in your calendar.' },
    ],
  },
  {
    labId: 'orchard-audit-policy',
    score: 0.78,
    predictedSuccess: 0.61,
    expectedGain: 18,
    reasons: [
      { kind: 'goal', text: `${monitoring.name} is ${pct(monitoring.weight)} of CKS and sits at ${pct(monitoring.mean)}; audit policy has the least evidence in it.` },
      { kind: 'gain', text: 'Largest expected mastery gain in the catalog for you right now.' },
      { kind: 'time', text: 'Hard, 35 minutes. Predicted success 61%: just inside the productive range.' },
    ],
  },
  {
    labId: 'quill-lvm-extend',
    score: 0.64,
    predictedSuccess: 0.8,
    expectedGain: 7,
    reasons: [
      { kind: 'review', text: `LVM mastery is decaying: last practised ${daysSince(lvm.lastPracticed)} days ago.` },
      { kind: 'variety', text: 'Switching domains after two Kubernetes labs improves retention.' },
    ],
  },
];

const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000).toISOString();

export const activity: Activity[] = [
  { id: 'a1', kind: 'check_passed', at: h(3), labId: 'orchard-netpol-isolation', text: 'Passed "default-deny-exists" and "no-wide-open"' },
  { id: 'a2', kind: 'hint_used', at: h(3.2), labId: 'orchard-netpol-isolation', text: 'Revealed hint "Start with deny" (−1)' },
  { id: 'a3', kind: 'lab_completed', at: h(27), labId: 'ledger-rbac-least-privilege', text: 'Completed with 91 / 100 in 26 min' },
  { id: 'a4', kind: 'skill_up', at: h(27), text: `Roles & bindings rose to ${state('k8s.rbac.roles').mu.toFixed(2)} (was ${(state('k8s.rbac.roles').mu - 0.13).toFixed(2)})` },
  { id: 'a5', kind: 'lab_completed', at: h(52), labId: 'orchard-psa-baseline', text: 'Completed with 100 / 100 in 11 min' },
  { id: 'a6', kind: 'lab_started', at: h(75), labId: 'quill-lvm-extend', text: 'Started, 1 of 3 checks passing' },
  { id: 'a7', kind: 'path_completed', at: h(140), text: 'Reached 75% of CKA foundations' },
];

export const masteryByDomain: HomeData['masteryByDomain'] = (['kubernetes', 'linux', 'networking'] as const).map((domain) => {
  const ids = skills.filter((s) => s.domain === domain).map((s) => s.id);
  const states = skillStates.filter((st) => ids.includes(st.skillId));
  const practiced = states.filter((s) => s.evidence > 0);
  const mastery = practiced.length ? practiced.reduce((a, s) => a + s.mu, 0) / practiced.length : 0;
  return { domain, mastery: Math.round(mastery * 100) / 100, skills: ids.length, practicedSkills: practiced.length };
});

export const homeData: HomeData = { learner, recommendations, goal, activity, masteryByDomain };
