import { createHash } from 'node:crypto';
import type { Domain, GoalForecast, HomeData, Learner, Recommendation, SkillState } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import type { Content } from '../content/load.js';

/*
 * SAMPLE LEARNER MODEL. There is no learner-model backend yet (assessment /
 * analytics services). These numbers are deterministic placeholders computed
 * over the REAL skill graph and catalog so Home and Skills render coherently
 * against real lab ids; none of it reflects what the learner actually did.
 * Replace with the learner-model service when it exists.
 */

/** Deterministic 0..1 from a key. */
function seeded(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) / 0xffffffff;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function learnerOf(p: Principal): Learner {
  const role = p.roles.includes('admin') ? 'admin' : p.roles.includes('manager') ? 'manager' : 'learner';
  return { id: p.sub, name: p.name, email: p.email, role, team: p.team, org: p.orgName, streakDays: 3, minutesThisWeek: 75 };
}

export function sampleSkillStates(content: Content, who: string): SkillState[] {
  const now = Date.now();
  return content.skills.map((s) => {
    const r = seeded(`${who}:${s.id}`);
    const practised = r > 0.25;
    const mu = practised ? round2(0.25 + r * 0.6) : 0;
    const days = Math.round(seeded(`${who}:${s.id}:t`) * 40);
    return {
      skillId: s.id,
      mu,
      sigma: round2(practised ? 0.08 + (1 - r) * 0.2 : 0.45),
      evidence: practised ? 1 + Math.round(r * 9) : 0,
      ...(practised ? { lastPracticed: new Date(now - days * 86_400_000).toISOString() } : {}),
      trend: r > 0.7 ? 'up' : r < 0.4 ? 'down' : 'flat',
    };
  });
}

export function sampleHome(content: Content, p: Principal): HomeData {
  const states = sampleSkillStates(content, p.sub);
  const mu = new Map(states.map((s) => [s.skillId, s.mu]));
  const mean = (ids: string[]) => (ids.length ? ids.reduce((a, id) => a + (mu.get(id) ?? 0), 0) / ids.length : 0);

  const ranked = [...content.summaries].sort((a, b) => mean(a.skillIds) - mean(b.skillIds) || a.estimatedMinutes - b.estimatedMinutes);
  const recommendations: Recommendation[] = ranked.slice(0, 3).map((l, i) => {
    const m = mean(l.skillIds);
    return {
      labId: l.id,
      score: round2(0.9 - i * 0.12),
      predictedSuccess: round2(Math.min(0.8, Math.max(0.6, 0.8 - m * 0.3))),
      expectedGain: Math.round(8 + (1 - m) * 10),
      reasons: [
        { kind: 'gain', text: `Its skills sit at ${Math.round(m * 100)}% mastery in the sample learner model, the lowest in the catalog.` },
        { kind: 'time', text: `${l.estimatedMinutes} minutes. (Sample recommendation: the learner model is not connected yet.)` },
      ],
    };
  });

  const fw = content.frameworks.find((f) => f.id === 'cka') ?? content.frameworks[0];
  const perDomain = (fw?.domains ?? []).map((d) => ({ domainId: d.id, readiness: round2(mean(d.skillIds)), delta7d: 0 }));
  const readiness = round2((fw?.domains ?? []).reduce((a, d) => a + d.weight * mean(d.skillIds), 0));
  const day = 86_400_000;
  const goal: GoalForecast = {
    frameworkId: fw?.id ?? 'cka',
    targetDate: new Date(Date.now() + 75 * day).toISOString().slice(0, 10),
    readiness,
    forecastReadyDate: new Date(Date.now() + Math.round((1 - readiness) * 120) * day).toISOString().slice(0, 10),
    weeklyMinutes: 150,
    perDomain,
  };

  const domains: Domain[] = ['kubernetes', 'linux', 'networking'];
  const masteryByDomain = domains.map((d) => {
    const ids = content.skills.filter((s) => s.domain === d).map((s) => s.id);
    const practised = ids.filter((id) => (mu.get(id) ?? 0) > 0);
    return { domain: d, mastery: round2(mean(practised)), skills: ids.length, practicedSkills: practised.length };
  });

  return { learner: learnerOf(p), recommendations, goal, activity: [], masteryByDomain };
}
