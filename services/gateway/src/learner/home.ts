import type { Activity, Domain, FrameworkId, GoalForecast, HomeData, Learner, LabSummary, MyAssignment, Recommendation, SkillState } from '@cloudtrain/api-types';
import type { Content } from '../content/load.js';
import { DIFFICULTY, MU0, SIGMA_MAX, decayedSigma, expectedGain, expectedSuccess, trendOf, type SkillBelief } from './model.js';

/*
 * Learner-facing numbers from the persisted learner model
 * (learner_skill_state + lab_attempts). Pure functions over rows the caller
 * already loaded inside its org-scoped transaction.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const DAY = 86_400_000;

export interface StateRow {
  skill_id: string;
  mu: number;
  sigma: number;
  evidence: number;
  last_delta: number;
  updated_at: Date;
}

export interface AttemptLite {
  id: string;
  lab_id: string;
  started_at: Date;
  ended_at: Date | null;
  outcome: string;
  score: number;
  hints_used: number;
  duration_s: number;
}

export const beliefOf = (r: StateRow): SkillBelief => ({ mu: r.mu, sigma: r.sigma, evidence: r.evidence, lastDelta: r.last_delta, updatedAt: r.updated_at });

/** Every skill of the graph: practised ones from the model, the rest as "no evidence". */
export function skillStates(content: Content, rows: StateRow[], now: Date): SkillState[] {
  const by = new Map(rows.map((r) => [r.skill_id, r]));
  return content.skills.map((s) => {
    const r = by.get(s.id);
    if (!r) return { skillId: s.id, mu: 0, sigma: SIGMA_MAX, evidence: 0, trend: 'flat' };
    const b = beliefOf(r);
    return { skillId: s.id, mu: round2(b.mu), sigma: round2(decayedSigma(b, now)), evidence: b.evidence, lastPracticed: r.updated_at.toISOString(), trend: trendOf(b, now) };
  });
}

/** Mean mastery over skill ids; unpractised skills count as 0. */
export function meanMastery(mu: Map<string, number>, ids: string[]): number {
  return ids.length ? ids.reduce((a, id) => a + (mu.get(id) ?? 0), 0) / ids.length : 0;
}

/** Framework readiness: objective-weighted mean mastery. */
export function readinessOf(content: Content, frameworkId: string, mu: Map<string, number>): number {
  const fw = content.frameworks.find((f) => f.id === frameworkId);
  if (!fw) return 0;
  return round2(fw.domains.reduce((a, d) => a + d.weight * meanMastery(mu, d.skillIds), 0));
}

/** Competency id -> mean mu of practised skills (null when none practised). */
export function competencyMastery(content: Content, mu: Map<string, number>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const c of content.competencies) {
    const practised = c.skillIds.filter((id) => mu.has(id));
    out[c.id] = practised.length ? round2(practised.reduce((a, id) => a + mu.get(id)!, 0) / practised.length) : null;
  }
  return out;
}

export function streakDays(attempts: AttemptLite[], now: Date): number {
  const days = new Set(attempts.map((a) => Math.floor(a.started_at.getTime() / DAY)));
  let d = Math.floor(now.getTime() / DAY);
  if (!days.has(d)) d -= 1; // today not started yet: the streak can still be alive from yesterday
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

export function minutesSince(attempts: AttemptLite[], since: Date): number {
  return Math.round(attempts.filter((a) => a.started_at >= since).reduce((a, x) => a + x.duration_s, 0) / 60);
}

export interface HomeInput {
  learner: Learner;
  content: Content;
  /** Labs the org may see (content visibility). */
  labs: LabSummary[];
  states: StateRow[];
  attempts: AttemptLite[];
  assignments: MyAssignment[];
  pinnedPathIds: string[];
  now: Date;
}

/**
 * Recommendation: expected mastery gain + review urgency + goal alignment -
 * time, restricted to predicted success 0.6-0.8 when enough labs qualify, and
 * to labs whose prerequisites are satisfied. Every recommendation explains itself.
 */
export function recommend(input: HomeInput, frameworkId: string): Recommendation[] {
  const { content, now } = input;
  const beliefs = new Map(input.states.map((r) => [r.skill_id, beliefOf(r)]));
  const passed = new Set(input.attempts.filter((a) => a.outcome === 'passed').map((a) => a.lab_id));
  const assignedLabs = new Map<string, MyAssignment>();
  for (const a of input.assignments) if (a.status !== 'completed') for (const l of a.item.labIds ?? []) if (!assignedLabs.has(l)) assignedLabs.set(l, a);
  const fwSkills = new Set(content.frameworks.find((f) => f.id === frameworkId)?.domains.flatMap((d) => d.skillIds) ?? []);
  const pinnedLabs = new Set(content.paths.filter((p) => input.pinnedPathIds.includes(p.id)).flatMap((p) => p.labIds));

  const candidates = input.labs
    .filter((l) => !passed.has(l.id) || assignedLabs.has(l.id))
    .map((l) => {
      const d = DIFFICULTY[l.difficulty] ?? 0.5;
      const skills = l.skillIds;
      const success = skills.length ? skills.reduce((a, s) => a + expectedSuccess(beliefs.get(s)?.mu ?? MU0, d), 0) / skills.length : 0.7;
      const gain = skills.reduce((a, s) => a + expectedGain(beliefs.get(s), d, now), 0);
      const stale = skills.filter((s) => {
        const b = beliefs.get(s);
        return b && now.getTime() - b.updatedAt.getTime() > 21 * DAY;
      });
      const prereqMissing = skills.flatMap((s) => (content.requires.get(s) ?? []).filter((r) => !skills.includes(r) && (beliefs.get(r)?.mu ?? 0) < 0.4 && beliefs.has(r)));
      const goal = skills.filter((s) => fwSkills.has(s)).length / Math.max(1, skills.length);
      const assigned = assignedLabs.get(l.id);
      const score = gain / 30 + stale.length * 0.15 + goal * 0.3 + (assigned ? 0.6 : 0) + (pinnedLabs.has(l.id) ? 0.2 : 0) - l.estimatedMinutes / 120;
      return { l, d, success, gain, stale, prereqMissing, goal, assigned, score };
    })
    .filter((c) => c.prereqMissing.length === 0 || c.assigned);

  const inBand = candidates.filter((c) => c.success >= 0.6 && c.success <= 0.8);
  const byScore = (a: (typeof candidates)[number], b: (typeof candidates)[number]) => b.score - a.score;
  const rest = candidates.filter((c) => !inBand.includes(c)).sort((a, b) => Math.abs(a.success - 0.7) - Math.abs(b.success - 0.7) || byScore(a, b));
  const ranked = [...inBand.sort(byScore), ...rest].slice(0, 3);

  return ranked.map((c) => {
    const reasons: Recommendation['reasons'] = [];
    if (c.assigned) reasons.push({ kind: 'goal', text: `Assigned by ${c.assigned.assignedBy.name}${c.assigned.dueAt ? `, due ${c.assigned.dueAt.slice(0, 10)}` : ''}.` });
    reasons.push({ kind: 'gain', text: `Expected gain of about ${Math.round(c.gain)} skill points across ${c.l.skillIds.length} skill${c.l.skillIds.length === 1 ? '' : 's'}; predicted success ${Math.round(c.success * 100)}%.` });
    if (c.stale.length) reasons.push({ kind: 'review', text: `${c.stale.length} of its skills were last practised more than three weeks ago.` });
    if (c.goal > 0) reasons.push({ kind: 'goal', text: `${Math.round(c.goal * 100)}% of it counts toward ${frameworkId.toUpperCase()}.` });
    reasons.push({ kind: 'time', text: `${c.l.estimatedMinutes} minutes.` });
    return { labId: c.l.id, score: round2(Math.max(0, Math.min(1, 0.5 + c.score / 4))), predictedSuccess: round2(c.success), expectedGain: Math.round(c.gain), reasons };
  });
}

export function buildHome(input: HomeInput): HomeData {
  const { content, now } = input;
  const mu = new Map(input.states.map((r) => [r.skill_id, r.mu]));
  const fwAssignment = input.assignments.find((a) => a.item.kind === 'framework' && a.status !== 'completed');
  const frameworkId = (fwAssignment?.item.id as FrameworkId | undefined) ?? (content.frameworks.some((f) => f.id === 'cka') ? 'cka' : (content.frameworks[0]?.id ?? 'cka'));
  const fw = content.frameworks.find((f) => f.id === frameworkId);

  // delta7d: mastery change from evidence in the last 7 days (last_delta of recently updated skills).
  const recent = new Map(input.states.filter((r) => now.getTime() - r.updated_at.getTime() < 7 * DAY).map((r) => [r.skill_id, r.last_delta]));
  const perDomain = (fw?.domains ?? []).map((d) => ({
    domainId: d.id,
    readiness: round2(meanMastery(mu, d.skillIds)),
    delta7d: round2(d.skillIds.length ? d.skillIds.reduce((a, s) => a + (recent.get(s) ?? 0), 0) / d.skillIds.length : 0),
  }));
  const readiness = readinessOf(content, frameworkId, mu);
  const weeklyMinutes = Math.round(minutesSince(input.attempts, new Date(now.getTime() - 28 * DAY)) / 4);
  // Heuristic forecast: ~120 days from zero at 150 min/week, scaled by actual weekly time.
  const daysToReady = Math.round(((1 - readiness) * 120 * 150) / Math.max(30, weeklyMinutes || 30));
  const goal: GoalForecast = {
    frameworkId,
    targetDate: (fwAssignment?.dueAt ?? new Date(now.getTime() + 75 * DAY).toISOString()).slice(0, 10),
    readiness,
    forecastReadyDate: new Date(now.getTime() + daysToReady * DAY).toISOString().slice(0, 10),
    weeklyMinutes,
    perDomain,
  };

  const titles = new Map(content.summaries.map((l) => [l.id, l.title]));
  const activity: Activity[] = [];
  for (const a of input.attempts.slice(0, 15)) {
    const title = titles.get(a.lab_id) ?? a.lab_id;
    if (a.outcome === 'passed') activity.push({ id: `${a.id}:done`, kind: 'lab_completed', at: (a.ended_at ?? a.started_at).toISOString(), labId: a.lab_id, text: `Completed ${title} (${a.score}%).` });
    if (a.hints_used > 0) activity.push({ id: `${a.id}:hint`, kind: 'hint_used', at: a.started_at.toISOString(), labId: a.lab_id, text: `Used ${a.hints_used} hint${a.hints_used > 1 ? 's' : ''} in ${title}.` });
    activity.push({ id: `${a.id}:start`, kind: 'lab_started', at: a.started_at.toISOString(), labId: a.lab_id, text: `Started ${title}.` });
  }
  const skillNames = new Map(content.skills.map((s) => [s.id, s.name]));
  for (const r of input.states.filter((s) => s.last_delta > 0.05 && now.getTime() - s.updated_at.getTime() < 14 * DAY)) {
    activity.push({ id: `skill:${r.skill_id}:${r.updated_at.getTime()}`, kind: 'skill_up', at: r.updated_at.toISOString(), text: `${skillNames.get(r.skill_id) ?? r.skill_id} rose to ${Math.round(r.mu * 100)}%.` });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  const domains: Domain[] = (['kubernetes', 'linux', 'containers', 'iac', 'automation', 'networking'] as const).filter(
    (d) => d === 'kubernetes' || d === 'linux' || d === 'networking' || content.skills.some((s) => s.domain === d),
  );
  const masteryByDomain = domains.map((d) => {
    const ids = content.skills.filter((s) => s.domain === d).map((s) => s.id);
    const practised = ids.filter((id) => mu.has(id));
    return { domain: d, mastery: round2(practised.length ? practised.reduce((a, id) => a + mu.get(id)!, 0) / practised.length : 0), skills: ids.length, practicedSkills: practised.length };
  });

  const open = input.assignments.filter((a) => a.status !== 'completed').sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  return {
    learner: input.learner,
    recommendations: recommend(input, frameworkId),
    goal,
    activity: activity.slice(0, 12),
    masteryByDomain,
    assignmentsDue: open,
    source: input.attempts.length || input.states.length ? 'live' : 'empty',
  };
}
