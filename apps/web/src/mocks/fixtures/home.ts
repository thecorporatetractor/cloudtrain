import type { Activity, GoalForecast, HomeData, Learner, Recommendation } from '@/api/types';
import { skillStates, skills } from './skills';

export const learner: Learner = {
  id: 'u-ingrid',
  name: 'Ingrid Solvang',
  email: 'ingrid.solvang@tessera-freight.example',
  role: 'admin',
  team: 'Platform Reliability',
  org: 'Tessera Freight',
  streakDays: 6,
  minutesThisWeek: 142,
};

export const recommendations: Recommendation[] = [
  {
    labId: 'orchard-netpol-isolation',
    score: 0.91,
    predictedSuccess: 0.72,
    expectedGain: 14,
    reasons: [
      { kind: 'goal', text: 'Cluster setup is 15% of CKS and your weakest weighted domain (41%).' },
      { kind: 'gain', text: 'NetworkPolicy mastery is 0.46 ± 0.21: high uncertainty, so one attempt moves the estimate a lot.' },
      { kind: 'prereq', text: 'You already hold Services & endpoints at 0.86, the only prerequisite.' },
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
      { kind: 'goal', text: 'Monitoring & runtime is 20% of CKS and you have no evidence on audit policy yet.' },
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
      { kind: 'review', text: 'LVM mastery is decaying: last practised 31 days ago.' },
      { kind: 'variety', text: 'Switching domains after two Kubernetes labs improves retention.' },
    ],
  },
];

export const goal: GoalForecast = {
  frameworkId: 'cks',
  targetDate: '2026-12-04',
  readiness: 0.58,
  forecastReadyDate: '2026-11-20',
  weeklyMinutes: 150,
  perDomain: [
    { domainId: 'cks:cluster-setup', readiness: 0.41, delta7d: 0.04 },
    { domainId: 'cks:cluster-hardening', readiness: 0.74, delta7d: 0.06 },
    { domainId: 'cks:system-hardening', readiness: 0.66, delta7d: 0.0 },
    { domainId: 'cks:microservice-vulns', readiness: 0.62, delta7d: 0.09 },
    { domainId: 'cks:supply-chain', readiness: 0.33, delta7d: 0.0 },
    { domainId: 'cks:monitoring-runtime', readiness: 0.47, delta7d: -0.02 },
  ],
};

const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000).toISOString();

export const activity: Activity[] = [
  { id: 'a1', kind: 'check_passed', at: h(3), labId: 'orchard-netpol-isolation', text: 'Passed "default-deny-exists" and "no-wide-open"' },
  { id: 'a2', kind: 'hint_used', at: h(3.2), labId: 'orchard-netpol-isolation', text: 'Revealed hint "Start with deny" (−1)' },
  { id: 'a3', kind: 'lab_completed', at: h(27), labId: 'ledger-rbac-least-privilege', text: 'Completed with 91 / 100 in 26 min' },
  { id: 'a4', kind: 'skill_up', at: h(27), text: 'Roles & bindings rose to 0.84 (was 0.71)' },
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
