import type { Framework, LabSummary, Learner } from '@cloudtrain/api-types';
import { describe, expect, it } from 'vitest';
import type { Content } from '../src/content/load.js';
import { activityOf, buildHome, dailyMinutesNeeded, environmentMinutesSince, MINUTES_FROM_ZERO, minutesSince, READY_AT, readinessGainOf, resumeOf, streakDays, type AttemptLite, type HomeInput, type StateRow } from '../src/learner/home.js';
import { MU0 } from '../src/learner/model.js';

const now = new Date('2026-10-17T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number, minutes = 0) => new Date(now.getTime() - days * DAY + minutes * 60_000);

const fw: Framework = {
  id: 'cka',
  name: 'CKA',
  fullName: 'Certified Kubernetes Administrator',
  vendor: 'CNCF',
  domains: [
    { id: 'cka:storage', name: 'Storage', weight: 0.1, skillIds: ['s.pv', 's.pvc'] },
    { id: 'cka:troubleshooting', name: 'Troubleshooting', weight: 0.5, skillIds: ['t.logs', 't.nodes'] },
    { id: 'cka:services-networking', name: 'Services and networking', weight: 0.4, skillIds: ['n.svc', 'n.dns'] },
  ],
};

const lab = (id: string, skillIds: string[], frameworks: string[], over: Partial<LabSummary> = {}): LabSummary => ({ id, title: `Lab ${id}`, domain: 'kubernetes', difficulty: 'easy', estimatedMinutes: 8, frameworks, skillIds, ...over });
const labs: LabSummary[] = [
  lab('pv', ['s.pv'], ['cka:storage']),
  lab('pvc', ['s.pvc', 's.pv'], ['cka:storage']),
  lab('logs', ['t.logs'], ['cka:troubleshooting'], { estimatedMinutes: 5 }),
  lab('nodes', ['t.nodes', 't.logs'], ['cka:troubleshooting'], { difficulty: 'medium', estimatedMinutes: 15 }),
  lab('svc', ['n.svc'], ['cka:services-networking'], { estimatedMinutes: 6 }),
  lab('dns', ['n.dns', 'n.svc'], ['cka:services-networking']),
  lab('exam-task', ['t.nodes'], ['cka:troubleshooting'], { estimatedMinutes: 3, tags: ['exam'] }),
];

const content = {
  labs: new Map(),
  skills: ['s.pv', 's.pvc', 't.logs', 't.nodes', 'n.svc', 'n.dns'].map((id) => ({ id, name: id, domain: 'kubernetes' as const, competency: 'c' })),
  requires: new Map<string, string[]>(),
  competencies: [],
  frameworks: [fw],
  packs: [],
  paths: [],
  domains: [],
  summaries: labs,
  issues: [],
} as unknown as Content;

const learner: Learner = { id: 'u1', name: 'Marco A', email: 'm@example.test', role: 'learner', team: '', org: 'Org', streakDays: 0, minutesThisWeek: 0 };

let n = 0;
/** An attempt; `run` = minutes after start of the last Validate (omit for none). */
function attempt(labId: string, startedDaysAgo: number, o: { run?: number; ended?: boolean; outcome?: string; passed?: number; total?: number; envMinutes?: number } = {}): AttemptLite {
  const started = ago(startedDaysAgo);
  const env = o.envMinutes ?? 60;
  return {
    id: `a${++n}`,
    lab_id: labId,
    started_at: started,
    ended_at: o.ended === false ? null : new Date(started.getTime() + env * 60_000),
    outcome: o.outcome ?? (o.run === undefined ? 'abandoned' : 'partial'),
    score: 0,
    hints_used: 0,
    duration_s: env * 60,
    session_name: `${labId}-${n}`,
    validations: o.run === undefined ? 0 : 1,
    checks_passed: o.passed ?? 0,
    checks_total: o.total ?? 6,
    last_run_at: o.run === undefined ? null : new Date(started.getTime() + o.run * 60_000),
  };
}

const input = (over: Partial<HomeInput> = {}): HomeInput => ({ learner, content, labs, states: [], attempts: [], assignments: [], pinnedPathIds: [], now, ...over });

describe('practice time', () => {
  it('does not count sessions that were opened and left to expire', () => {
    // The reported case: the same lab opened twice, no Validate, both environments expired after an hour.
    const idle = [attempt('pv', 3), attempt('pv', 3)];
    expect(environmentMinutesSince(idle, ago(7))).toBe(120);
    expect(minutesSince(idle, ago(7))).toBe(0);
    expect(streakDays(idle, now)).toBe(0);
  });

  it('counts graded attempts from start to the last Validate, not to expiry', () => {
    const a = [attempt('pv', 1, { run: 20 }), attempt('svc', 0, { run: 12, ended: false })];
    expect(minutesSince(a, ago(7))).toBe(32);
    expect(environmentMinutesSince(a, ago(7))).toBe(120);
    expect(streakDays(a, now)).toBe(2);
  });
});

describe('resume and activity', () => {
  it('offers the latest unfinished lab, and a session id only while it is live', () => {
    const expired = [attempt('pv', 3), attempt('pv', 3)];
    expect(resumeOf(expired, now)).toMatchObject({ labId: 'pv', attempts: 2, checksPassed: 0, checksTotal: 6, validations: 0 });
    expect(resumeOf(expired, now)?.sessionId).toBeUndefined();
    const live = attempt('svc', 0, { ended: false, run: 5, passed: 2 });
    expect(resumeOf([live, ...expired], now)).toMatchObject({ labId: 'svc', sessionId: live.session_name, checksPassed: 2 });
  });

  it('skips labs passed since and anything older than two weeks', () => {
    expect(resumeOf([attempt('pv', 1, { outcome: 'passed', run: 9 }), attempt('pv', 2)], now)).toBeUndefined();
    expect(resumeOf([attempt('pv', 20)], now)).toBeUndefined();
  });

  it('folds repeated opens of a lab without progress into one line', () => {
    const items = activityOf(content, [attempt('pv', 3), attempt('pv', 3)], [], now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'lab_started', labId: 'pv' });
    expect(items[0]!.text).toBe('Opened Lab pv 2 times; no checks run yet, environment closed.');
  });
});

describe('goal plan', () => {
  it('turns the gap into minutes per day for the target date', () => {
    expect(dailyMinutesNeeded(2400, '2026-12-31', now)).toBe(Math.ceil(2400 / 76));
    expect(dailyMinutesNeeded(100, '2026-10-01', now)).toBe(100); // past date: all of it today
  });

  it('is a prior, not a verdict, without graded sessions; a dated plan with them', () => {
    const cold = buildHome(input({ attempts: [attempt('pv', 3), attempt('pv', 3)] })).goal;
    expect(cold).toMatchObject({ readiness: 0, confidence: 'prior', sessions: 0, weeklyMinutes: 0, minutesToReady: MINUTES_FROM_ZERO, readyAt: READY_AT, targetDateSource: 'default' });
    expect(cold.dailyMinutesNeeded).toBe(dailyMinutesNeeded(MINUTES_FROM_ZERO, cold.targetDate, now));

    const states: StateRow[] = ['t.logs', 't.nodes'].map((skill_id) => ({ skill_id, mu: 0.6, sigma: 0.15, evidence: 3, last_delta: 0.05, updated_at: ago(1) }));
    const warm = buildHome(input({ states, attempts: [1, 3, 5, 8].map((d) => attempt('logs', d, { run: 30, passed: 3 })) })).goal;
    expect(warm.confidence).toBe('estimate');
    expect(warm.sessions).toBe(4);
    expect(warm.weeklyMinutes).toBe(30);
  });

  it('orders exam domains by weight x gap and links each to a lab in it', () => {
    const states: StateRow[] = ['t.logs', 't.nodes'].map((skill_id) => ({ skill_id, mu: 0.9, sigma: 0.1, evidence: 5, last_delta: 0, updated_at: ago(2) }));
    const goal = buildHome(input({ states })).goal;
    // Troubleshooting is 50% but 90% done (gap 0.05); networking 40% x 1.0; storage 10% x 1.0.
    expect(goal.perDomain.map((d) => d.domainId)).toEqual(['cka:services-networking', 'cka:storage', 'cka:troubleshooting']);
    const linked = goal.perDomain.find((d) => d.domainId === 'cka:services-networking')!;
    expect(['svc', 'dns']).toContain(linked.labId);
    expect(linked).toMatchObject({ weight: 0.4, practisedSkills: 0, skills: 2 });
  });
});

describe('recommendations', () => {
  it('labels cold-start success as a prior and reports readiness, not skill points', () => {
    const recs = buildHome(input()).recommendations;
    expect(recs.length).toBe(3);
    for (const r of recs) {
      expect(r.confidence).toBe('prior');
      expect(r.evidenceSkills).toBe(0);
      expect(r.readinessGain).toBeGreaterThan(0);
      expect(r.goalDomainIds!.length).toBeGreaterThan(0);
      for (const reason of r.reasons) expect(reason.text).not.toMatch(/predicted success|skill points|\d+ minutes/i);
    }
    // Alternatives differ from the top pick: three distinct exam domains.
    expect(new Set(recs.map((r) => r.goalDomainIds![0])).size).toBe(3);
  });

  it('readiness gain is the readiness change if the lab is passed', () => {
    // One unpractised storage skill of two: it moves from 0 (not counted) to the post-pass estimate.
    const g = readinessGainOf(fw, ['s.pv'], new Map(), 0.3, now);
    expect(g).toBeGreaterThan((0.1 * MU0) / 2);
    expect(g).toBeLessThan(0.1 / 2);
  });

  it('keeps the lab offered for resuming out of the recommendations', () => {
    const home = buildHome(input({ attempts: [attempt('svc', 1)] }));
    expect(home.resume?.labId).toBe('svc');
    expect(home.recommendations.map((r) => r.labId)).not.toContain('svc');
  });
});

describe('cold start', () => {
  it('offers a short baseline across the heaviest domains and a first-week plan', () => {
    const home = buildHome(input({ attempts: [attempt('pv', 3), attempt('pv', 3)] }));
    expect(home.coldStart).toBeDefined();
    const cs = home.coldStart!;
    // One easy lab per domain by weight, never an exam task, never the lab being resumed.
    expect(cs.baselineLabIds).toEqual(['logs', 'svc', 'pvc']);
    expect(cs.baselineMinutes).toBe(5 + 6 + 8);
    expect(cs.plan[0]).toMatchObject({ day: 1, minutes: cs.baselineMinutes });
    expect(cs.plan[1]).toMatchObject({ day: 2, labId: 'pv', title: 'Finish Lab pv' });
    expect(cs.plan.map((p) => p.day)).toEqual(cs.plan.map((_, i) => i + 1));
  });

  it('disappears once there is graded practice', () => {
    expect(buildHome(input({ attempts: [attempt('pv', 1, { run: 10 })] })).coldStart).toBeUndefined();
  });
});
