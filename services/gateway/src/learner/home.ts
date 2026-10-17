import type { Activity, ColdStart, Domain, Framework, FrameworkId, GoalDomain, GoalForecast, HomeData, Learner, LabSummary, MyAssignment, Recommendation, ResumeItem, SkillState } from '@cloudtrain/api-types';
import type { Content } from '../content/load.js';
import { DIFFICULTY, MU0, R, SIGMA_MAX, decayedSigma, expectedGain, expectedSuccess, prior, trendOf, type SkillBelief } from './model.js';

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
  /** Environment time (session open to close): what quotas count, not practice. */
  duration_s: number;
  session_name: string;
  validations: number;
  checks_passed: number;
  checks_total: number;
  /** Time of the last graded run (Validate) in the attempt; null when none ran. */
  last_run_at: Date | null;
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

/*
 * Practice time. lab_attempts.duration_s is how long the environment ran
 * (session open until it was ended or expired), which is what quotas bill.
 * A session opened and left to expire is an hour of environment and zero
 * practice, so learner-facing time counts only attempts with a graded run,
 * from the start of the attempt to its last Validate.
 */
export function practiceSeconds(a: AttemptLite): number {
  if (!a.validations || !a.last_run_at) return 0;
  return Math.max(0, Math.round((a.last_run_at.getTime() - a.started_at.getTime()) / 1000));
}

const practised = (a: AttemptLite) => a.validations > 0 && a.last_run_at !== null;

/** Environment minutes (session lifetime) in attempts started since `since`: the manager views' measure. */
export function environmentMinutesSince(attempts: Pick<AttemptLite, 'started_at' | 'duration_s'>[], since: Date): number {
  return Math.round(attempts.filter((a) => a.started_at >= since).reduce((a, x) => a + x.duration_s, 0) / 60);
}

/** Consecutive days (UTC) with graded practice, ending today or yesterday. */
export function streakDays(attempts: AttemptLite[], now: Date): number {
  const days = new Set(attempts.filter(practised).map((a) => Math.floor((a.last_run_at ?? a.started_at).getTime() / DAY)));
  let d = Math.floor(now.getTime() / DAY);
  if (!days.has(d)) d -= 1; // today not practised yet: the streak can still be alive from yesterday
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

/** Practice minutes in attempts started since `since` (see practiceSeconds). */
export function minutesSince(attempts: AttemptLite[], since: Date): number {
  return Math.round(attempts.filter((a) => a.started_at >= since).reduce((a, x) => a + practiceSeconds(x), 0) / 60);
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

/** Readiness at which the plan counts a learner as exam-ready. */
export const READY_AT = 0.75;
/**
 * Planning estimate: practice minutes to go from no evidence to READY_AT
 * (about 40 hours of labs). A heuristic for sizing a daily target, not a
 * fitted number; the UI says so.
 */
export const MINUTES_FROM_ZERO = 2400;
/** Graded sessions in four weeks before the forecast date is shown as an estimate. */
export const FORECAST_MIN_SESSIONS = 3;
/** Baseline: up to three short labs, one per heavy exam domain, within this many minutes. */
export const BASELINE_MAX_MINUTES = 25;
/** Default target when no framework goal with a due date is assigned. */
const DEFAULT_TARGET_DAYS = 75;

export function minutesToReady(readiness: number): number {
  return Math.round((Math.max(0, READY_AT - readiness) / READY_AT) * MINUTES_FROM_ZERO);
}

/** Minutes per day from `now` needed to practise `minutes` by `targetDate` (YYYY-MM-DD, inclusive). */
export function dailyMinutesNeeded(minutes: number, targetDate: string, now: Date): number {
  const days = Math.max(1, Math.ceil((Date.parse(`${targetDate}T23:59:59Z`) - now.getTime()) / DAY));
  return Math.ceil(minutes / days);
}

/** Readiness of `fw` if every skill of the lab got one passing piece of evidence (absolute change, 0..1). */
export function readinessGainOf(fw: Framework | undefined, labSkills: string[], beliefs: Map<string, SkillBelief>, difficulty: number, now: Date): number {
  if (!fw) return 0;
  let gain = 0;
  for (const d of fw.domains) {
    const inDomain = labSkills.filter((s) => d.skillIds.includes(s));
    if (!inDomain.length) continue;
    let delta = 0;
    for (const s of inDomain) {
      const b = beliefs.get(s);
      const cur = b ?? prior(now);
      const s2 = decayedSigma(cur, now) ** 2;
      const k = s2 / (s2 + R);
      const pass = Math.min(1, cur.mu + k * (1 - expectedSuccess(cur.mu, difficulty)));
      // Readiness counts a skill without evidence as 0, so its first pass moves it from 0.
      delta += pass - (b?.mu ?? 0);
    }
    gain += (d.weight * delta) / d.skillIds.length;
  }
  return Math.max(0, gain);
}

interface Candidate {
  l: LabSummary;
  d: number;
  success: number;
  gain: number;
  readinessGain: number;
  evidenceSkills: number;
  stale: string[];
  prereqMissing: string[];
  goal: number;
  goalDomainIds: string[];
  assigned: MyAssignment | undefined;
  score: number;
  inBand: boolean;
}

/**
 * Candidates ranked: expected mastery gain + review urgency + goal alignment -
 * time, restricted to predicted success 0.6-0.8 when enough labs qualify, and
 * to labs whose prerequisites are satisfied.
 */
export function rankLabs(input: HomeInput, frameworkId: string, exclude: ReadonlySet<string> = new Set()): Candidate[] {
  const { content, now } = input;
  const beliefs = new Map(input.states.map((r) => [r.skill_id, beliefOf(r)]));
  const passed = new Set(input.attempts.filter((a) => a.outcome === 'passed').map((a) => a.lab_id));
  const assignedLabs = new Map<string, MyAssignment>();
  for (const a of input.assignments) if (a.status !== 'completed') for (const l of a.item.labIds ?? []) if (!assignedLabs.has(l)) assignedLabs.set(l, a);
  const fw = content.frameworks.find((f) => f.id === frameworkId);
  const fwSkills = new Set(fw?.domains.flatMap((d) => d.skillIds) ?? []);
  const pinnedLabs = new Set(content.paths.filter((p) => input.pinnedPathIds.includes(p.id)).flatMap((p) => p.labIds));

  const candidates = input.labs
    .filter((l) => (!passed.has(l.id) || assignedLabs.has(l.id)) && !exclude.has(l.id))
    .map((l): Candidate => {
      const d = DIFFICULTY[l.difficulty] ?? 0.5;
      const skills = l.skillIds;
      const success = skills.length ? skills.reduce((a, s) => a + expectedSuccess(beliefs.get(s)?.mu ?? MU0, d), 0) / skills.length : 0.7;
      const gain = skills.reduce((a, s) => a + expectedGain(beliefs.get(s), d, now), 0);
      const readinessGain = readinessGainOf(fw, skills, beliefs, d, now);
      const stale = skills.filter((s) => {
        const b = beliefs.get(s);
        return b && now.getTime() - b.updatedAt.getTime() > 21 * DAY;
      });
      const prereqMissing = skills.flatMap((s) => (content.requires.get(s) ?? []).filter((r) => !skills.includes(r) && (beliefs.get(r)?.mu ?? 0) < 0.4 && beliefs.has(r)));
      const goal = skills.filter((s) => fwSkills.has(s)).length / Math.max(1, skills.length);
      const goalDomainIds = (fw?.domains ?? []).filter((fd) => l.frameworks?.includes(fd.id) || skills.some((s) => fd.skillIds.includes(s))).map((fd) => fd.id);
      const assigned = assignedLabs.get(l.id);
      const score = gain / 30 + readinessGain * 10 + stale.length * 0.15 + goal * 0.3 + (assigned ? 0.6 : 0) + (pinnedLabs.has(l.id) ? 0.2 : 0) - l.estimatedMinutes / 120;
      return { l, d, success, gain, readinessGain, evidenceSkills: skills.filter((s) => beliefs.has(s)).length, stale, prereqMissing, goal, goalDomainIds, assigned, score, inBand: success >= 0.6 && success <= 0.8 };
    })
    .filter((c) => c.prereqMissing.length === 0 || c.assigned);

  const byScore = (a: Candidate, b: Candidate) => b.score - a.score;
  const inBand = candidates.filter((c) => c.inBand).sort(byScore);
  const rest = candidates.filter((c) => !c.inBand).sort((a, b) => Math.abs(a.success - 0.7) - Math.abs(b.success - 0.7) || byScore(a, b));
  return [...inBand, ...rest];
}

/** Top pick plus alternatives that differ from it: another exam domain or lab domain where possible. */
function diversePicks(ranked: Candidate[], n: number): Candidate[] {
  const picks: Candidate[] = [];
  const key = (c: Candidate) => `${c.l.domain}|${c.goalDomainIds[0] ?? ''}`;
  for (const c of ranked) {
    if (picks.length >= n) break;
    if (!picks.length || c.assigned || !picks.some((p) => key(p) === key(c))) picks.push(c);
  }
  for (const c of ranked) {
    if (picks.length >= n) break;
    if (!picks.includes(c)) picks.push(c);
  }
  return picks;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every recommendation explains itself, without repeating the numbers shown beside it. */
export function recommend(input: HomeInput, frameworkId: string, exclude: ReadonlySet<string> = new Set()): Recommendation[] {
  const { content, now } = input;
  const fw = content.frameworks.find((f) => f.id === frameworkId);
  const fwName = fw?.name ?? frameworkId.toUpperCase();
  const titles = new Map(content.summaries.map((l) => [l.id, l.title]));
  const beliefs = new Map(input.states.map((r) => [r.skill_id, r.mu]));
  // Labs practised (graded) in the last two weeks, most recent first.
  const recentLabs = Array.from(new Set(input.attempts.filter((a) => practised(a) && now.getTime() - a.started_at.getTime() < 14 * DAY).map((a) => a.lab_id)));
  const skillsOf = new Map(input.labs.map((l) => [l.id, l.skillIds]));

  return diversePicks(rankLabs(input, frameworkId, exclude), 3).map((c) => {
    const reasons: Recommendation['reasons'] = [];
    const confidence = c.evidenceSkills > 0 ? 'estimate' : 'prior';
    if (c.assigned) reasons.push({ kind: 'goal', text: `Assigned by ${c.assigned.assignedBy.name}${c.assigned.dueAt ? `, due ${c.assigned.dueAt.slice(0, 10)}` : ''}.` });
    const domains = (fw?.domains ?? []).filter((d) => c.goalDomainIds.includes(d.id));
    if (domains.length) {
      const top = [...domains].sort((a, b) => b.weight - a.weight)[0]!;
      const level = (d: (typeof domains)[number]) => {
        const seen = d.skillIds.filter((s) => beliefs.has(s));
        return seen.length ? `at ${Math.round((d.skillIds.reduce((a, s) => a + (beliefs.get(s) ?? 0), 0) / d.skillIds.length) * 100)}%` : 'with no results yet';
      };
      reasons.push({ kind: 'goal', text: `Practises ${top.name} (${Math.round(top.weight * 100)}% of ${fwName}), ${level(top)}${domains.length > 1 ? `, plus ${plural(domains.length - 1, 'more exam domain')}` : ''}.` });
    } else if (c.goal === 0) {
      reasons.push({ kind: 'variety', text: `Outside ${fwName}: broadens your ${c.l.domain} skills.` });
    }
    const buildsOnId = recentLabs.find((id) => id !== c.l.id && (skillsOf.get(id) ?? []).some((s) => c.l.skillIds.includes(s)));
    if (buildsOnId) reasons.push({ kind: 'prereq', text: `Builds on ${titles.get(buildsOnId) ?? buildsOnId}, which you worked on recently.` });
    if (c.stale.length) reasons.push({ kind: 'review', text: `${plural(c.stale.length, 'of its skills was', 'of its skills were')} last practised more than three weeks ago.` });
    if (confidence === 'prior') reasons.push({ kind: 'gain', text: 'No results for its skills yet, so it also shows where you stand.' });
    else if (c.inBand) reasons.push({ kind: 'gain', text: 'Pitched at your level: hard enough to learn from, likely to pass.' });
    else if (c.success < 0.6) reasons.push({ kind: 'gain', text: 'A stretch for your current level; hints are there if you need them.' });
    else reasons.push({ kind: 'gain', text: 'Should feel comfortable: a quick confidence win.' });
    return {
      labId: c.l.id,
      score: round2(Math.max(0, Math.min(1, 0.5 + c.score / 4))),
      predictedSuccess: round2(c.success),
      expectedGain: Math.round(c.gain),
      confidence,
      evidenceSkills: c.evidenceSkills,
      readinessGain: Math.round(c.readinessGain * 1000) / 1000,
      goalDomainIds: c.goalDomainIds,
      ...(buildsOnId ? { buildsOn: { labId: buildsOnId, title: titles.get(buildsOnId) ?? buildsOnId } } : {}),
      reasons,
    };
  });
}

/** The most recent lab opened in the last 14 days and not passed since. */
export function resumeOf(attempts: AttemptLite[], now: Date): ResumeItem | undefined {
  const recent = attempts.filter((a) => now.getTime() - a.started_at.getTime() < 14 * DAY).sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
  const passed = new Set(attempts.filter((a) => a.outcome === 'passed').map((a) => a.lab_id));
  const latest = recent.find((a) => !passed.has(a.lab_id));
  if (!latest) return undefined;
  const same = recent.filter((a) => a.lab_id === latest.lab_id);
  return {
    labId: latest.lab_id,
    startedAt: latest.started_at.toISOString(),
    attempts: same.length,
    checksPassed: Math.max(...same.map((a) => a.checks_passed)),
    checksTotal: latest.checks_total,
    validations: latest.validations,
    ...(latest.ended_at === null ? { sessionId: latest.session_name } : {}),
  };
}

/**
 * Cold start: a short baseline (easy labs from the heaviest exam domains,
 * at most BASELINE_MAX_MINUTES) and a first-week plan. Seeds the learner model instead of
 * presenting its priors as verdicts.
 */
export function coldStartOf(fw: Framework | undefined, labs: LabSummary[], ranked: Candidate[], resume: ResumeItem | undefined, perDomain: GoalDomain[]): ColdStart {
  const tagged = (domainId: string) => labs.filter((l) => l.frameworks?.includes(domainId));
  const short = (a: LabSummary, b: LabSummary) => (DIFFICULTY[a.difficulty] ?? 0.5) - (DIFFICULTY[b.difficulty] ?? 0.5) || a.estimatedMinutes - b.estimatedMinutes || a.id.localeCompare(b.id);
  const baseline: LabSummary[] = [];
  let minutes = 0;
  for (const d of [...(fw?.domains ?? [])].sort((a, b) => b.weight - a.weight)) {
    if (baseline.length >= 3) break;
    const pick = tagged(d.id)
      // Exam-tagged tasks stay out: they are the mock exams' pools.
      .filter((l) => l.id !== resume?.labId && !baseline.includes(l) && l.estimatedMinutes <= 10 && !l.tags?.includes('exam'))
      .sort(short)[0];
    if (pick && minutes + pick.estimatedMinutes <= BASELINE_MAX_MINUTES) {
      baseline.push(pick);
      minutes += pick.estimatedMinutes;
    }
  }
  const plan: ColdStart['plan'] = [];
  if (baseline.length) plan.push({ day: 1, title: `Baseline: ${plural(baseline.length, 'short lab')}`, minutes });
  if (resume) {
    const l = labs.find((x) => x.id === resume.labId);
    if (l) plan.push({ day: plan.length + 1, title: `Finish ${l.title}`, labId: l.id, minutes: l.estimatedMinutes });
  }
  const used = new Set([...baseline.map((l) => l.id), resume?.labId]);
  for (const d of perDomain) {
    if (plan.length >= 5) break;
    const c = ranked.find((x) => !used.has(x.l.id) && x.goalDomainIds.includes(d.domainId));
    if (!c) continue;
    used.add(c.l.id);
    plan.push({ day: plan.length + 1, title: c.l.title, labId: c.l.id, minutes: c.l.estimatedMinutes });
  }
  return { baselineLabIds: baseline.map((l) => l.id), baselineMinutes: minutes, plan };
}

/** Repeated opens of the same lab without progress collapse into one line. */
export function activityOf(content: Content, attempts: AttemptLite[], states: StateRow[], now: Date): Activity[] {
  const titles = new Map(content.summaries.map((l) => [l.id, l.title]));
  const activity: Activity[] = [];
  const recent = attempts.slice(0, 20);
  const idle = (a: AttemptLite) => a.outcome !== 'passed' && a.validations === 0;
  for (let i = 0; i < recent.length; i++) {
    const a = recent[i]!;
    const title = titles.get(a.lab_id) ?? a.lab_id;
    if (idle(a)) {
      // Fold the run of idle opens of this lab that follows (older ones).
      let n = 1;
      while (recent[i + n] && recent[i + n]!.lab_id === a.lab_id && idle(recent[i + n]!)) n++;
      const live = a.ended_at === null;
      activity.push({ id: `${a.id}:start`, kind: 'lab_started', at: a.started_at.toISOString(), labId: a.lab_id, text: `Opened ${title}${n > 1 ? ` ${n} times` : ''}; no checks run yet${live ? '' : ', environment closed'}.` });
      i += n - 1;
      continue;
    }
    if (a.outcome === 'passed') activity.push({ id: `${a.id}:done`, kind: 'lab_completed', at: (a.ended_at ?? a.last_run_at ?? a.started_at).toISOString(), labId: a.lab_id, text: `Completed ${title} (${a.score}%).` });
    else activity.push({ id: `${a.id}:progress`, kind: 'check_passed', at: (a.last_run_at ?? a.started_at).toISOString(), labId: a.lab_id, text: `${a.ended_at ? 'Stopped' : 'Working on'} ${title} at ${a.checks_passed} of ${a.checks_total} checks.` });
    if (a.hints_used > 0) activity.push({ id: `${a.id}:hint`, kind: 'hint_used', at: a.started_at.toISOString(), labId: a.lab_id, text: `Used ${plural(a.hints_used, 'hint')} in ${title}.` });
  }
  const skillNames = new Map(content.skills.map((s) => [s.id, s.name]));
  for (const r of states.filter((s) => s.last_delta > 0.05 && now.getTime() - s.updated_at.getTime() < 14 * DAY)) {
    activity.push({ id: `skill:${r.skill_id}:${r.updated_at.getTime()}`, kind: 'skill_up', at: r.updated_at.toISOString(), text: `${skillNames.get(r.skill_id) ?? r.skill_id} rose to ${Math.round(r.mu * 100)}%.` });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));
  return activity.slice(0, 12);
}

export function buildHome(input: HomeInput): HomeData {
  const { content, now } = input;
  const mu = new Map(input.states.map((r) => [r.skill_id, r.mu]));
  const fwAssignment = input.assignments.find((a) => a.item.kind === 'framework' && a.status !== 'completed');
  const frameworkId = (fwAssignment?.item.id as FrameworkId | undefined) ?? (content.frameworks.some((f) => f.id === 'cka') ? 'cka' : (content.frameworks[0]?.id ?? 'cka'));
  const fw = content.frameworks.find((f) => f.id === frameworkId);
  const graded = input.attempts.filter(practised);
  const cold = graded.length === 0 && input.states.length === 0;

  const resume = resumeOf(input.attempts, now);
  const exclude = new Set(resume ? [resume.labId] : []);
  const ranked = rankLabs(input, frameworkId, exclude);

  // delta7d: mastery change from evidence in the last 7 days (last_delta of recently updated skills).
  const recent = new Map(input.states.filter((r) => now.getTime() - r.updated_at.getTime() < 7 * DAY).map((r) => [r.skill_id, r.last_delta]));
  const perDomain: GoalDomain[] = (fw?.domains ?? [])
    .map((d) => {
      const readiness = round2(meanMastery(mu, d.skillIds));
      const labId = ranked.find((c) => c.goalDomainIds.includes(d.id))?.l.id;
      return {
        domainId: d.id,
        readiness,
        delta7d: round2(d.skillIds.length ? d.skillIds.reduce((a, s) => a + (recent.get(s) ?? 0), 0) / d.skillIds.length : 0),
        weight: round2(d.weight),
        practisedSkills: d.skillIds.filter((s) => mu.has(s)).length,
        skills: d.skillIds.length,
        ...(labId ? { labId } : {}),
      };
    })
    .sort((a, b) => b.weight * (1 - b.readiness) - a.weight * (1 - a.readiness));

  const readiness = readinessOf(content, frameworkId, mu);
  const since28 = new Date(now.getTime() - 28 * DAY);
  const weeklyMinutes = Math.round(minutesSince(input.attempts, since28) / 4);
  const sessions = graded.filter((a) => a.started_at >= since28).length;
  const toReady = minutesToReady(readiness);
  const targetDate = (fwAssignment?.dueAt ?? new Date(now.getTime() + DEFAULT_TARGET_DAYS * DAY).toISOString()).slice(0, 10);
  // At the learner's own pace (four-week average); with no practice yet there is no pace to project.
  const daysToReady = weeklyMinutes > 0 ? Math.ceil((toReady / weeklyMinutes) * 7) : Math.ceil((toReady / 150) * 7);
  const goal: GoalForecast = {
    frameworkId,
    targetDate,
    targetDateSource: fwAssignment?.dueAt ? 'assignment' : 'default',
    readiness,
    readyAt: READY_AT,
    forecastReadyDate: new Date(now.getTime() + daysToReady * DAY).toISOString().slice(0, 10),
    confidence: sessions >= FORECAST_MIN_SESSIONS && weeklyMinutes > 0 ? 'estimate' : 'prior',
    sessions,
    weeklyMinutes,
    minutesToReady: toReady,
    dailyMinutesNeeded: dailyMinutesNeeded(toReady, targetDate, now),
    perDomain,
  };

  const domains: Domain[] = (['kubernetes', 'linux', 'containers', 'iac', 'automation', 'networking'] as const).filter(
    (d) => d === 'kubernetes' || d === 'linux' || d === 'networking' || content.skills.some((s) => s.domain === d),
  );
  const masteryByDomain = domains.map((d) => {
    const ids = content.skills.filter((s) => s.domain === d).map((s) => s.id);
    const seen = ids.filter((id) => mu.has(id));
    return { domain: d, mastery: round2(seen.length ? seen.reduce((a, id) => a + mu.get(id)!, 0) / seen.length : 0), skills: ids.length, practicedSkills: seen.length };
  });

  const open = input.assignments.filter((a) => a.status !== 'completed').sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  return {
    learner: input.learner,
    recommendations: recommend(input, frameworkId, exclude),
    goal,
    activity: activityOf(content, input.attempts, input.states, now),
    masteryByDomain,
    assignmentsDue: open,
    ...(resume ? { resume } : {}),
    ...(cold ? { coldStart: coldStartOf(fw, input.labs, ranked, resume, perDomain) } : {}),
    source: input.attempts.length || input.states.length ? 'live' : 'empty',
  };
}
