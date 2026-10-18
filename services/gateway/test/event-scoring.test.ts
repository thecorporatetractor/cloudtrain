import { describe, expect, it } from 'vitest';
import { questionValue, scoreEvent, type EventSubmission, type QuestionDef, type ScoringRules } from '../src/events/scoring.js';
import { eventSeed, eventStatus } from '../src/events/service.js';

const T0 = new Date('2026-10-20T09:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const STATIC: ScoringRules = { scoring: 'static', dynamicMinPct: 30, dynamicDecay: 10, firstBlood: true };
const DYNAMIC: ScoringRules = { ...STATIC, scoring: 'dynamic', dynamicDecay: 3 };

const Q: QuestionDef[] = [
  { labId: 'lab', checkId: 'q1', number: 1, prompt: 'One?', points: 100, penalty: 10 },
  { labId: 'lab', checkId: 'q2', number: 2, prompt: 'Two?', points: 200, penalty: 0 },
];
const entrants = ['red', 'blue', 'green'].map((id) => ({ id, name: id.toUpperCase(), members: [] }));
const sub = (entrantId: string, checkId: string, correct: boolean, min: number): EventSubmission => ({ entrantId, userId: `${entrantId}-u`, labId: 'lab', checkId, correct, at: at(min) });

describe('event scoring', () => {
  it('decays dynamic values with the solve count down to the minimum', () => {
    expect(questionValue(100, 0, DYNAMIC)).toBe(100);
    expect(questionValue(100, 1, DYNAMIC)).toBe(100);
    expect(questionValue(100, 2, DYNAMIC)).toBe(93); // 100 - 70/9
    expect(questionValue(100, 4, DYNAMIC)).toBe(30);
    expect(questionValue(100, 40, DYNAMIC)).toBe(30);
    expect(questionValue(100, 40, STATIC)).toBe(100);
  });

  it('ranks by points, then the earlier last solve; penalties, hints and first bloods count', () => {
    const r = scoreEvent({
      rules: STATIC,
      questions: Q,
      entrants,
      startsAt: T0,
      submissions: [sub('red', 'q1', false, 1), sub('red', 'q1', true, 2), sub('blue', 'q1', true, 3), sub('blue', 'q2', true, 10), sub('red', 'q2', true, 8), sub('blue', 'q1', true, 11)],
      reveals: [{ entrantId: 'blue', labId: 'lab', checkId: 'q2', cost: 20, at: at(9) }],
    });
    // red: 100-10 + 200 = 290 (last 8); blue: 100 + 200-20 = 280; green: 0
    expect(r.rows.map((x) => [x.rank, x.id, x.points, x.solves, x.firstBloods])).toEqual([
      [1, 'red', 290, 2, 2],
      [2, 'blue', 280, 2, 0],
      [3, 'green', 0, 0, 0],
    ]);
    expect(r.rows[0]!.lastSolveAt).toBe(at(8).toISOString());
    expect(r.solves[0]).toMatchObject({ entrantId: 'blue', checkId: 'q2', points: 180, firstBlood: false });
    expect(r.questions.map((q) => [q.checkId, q.solves, q.firstBlood?.entrantName])).toEqual([
      ['q1', 2, 'RED'],
      ['q2', 2, 'RED'],
    ]);
    expect(r.timeline.find((t) => t.entrantId === 'red')!.points.map((p) => p.total)).toEqual([0, 90, 290]);
  });

  it('breaks equal points by the time of the last solve', () => {
    const r = scoreEvent({ rules: STATIC, questions: Q, entrants, startsAt: T0, submissions: [sub('green', 'q1', true, 5), sub('blue', 'q1', true, 4)], reveals: [] });
    expect(r.rows.map((x) => x.id)).toEqual(['blue', 'green', 'red']);
  });

  it('dynamic scoring is retroactive for every solver', () => {
    const r = scoreEvent({ rules: DYNAMIC, questions: Q, entrants, startsAt: T0, submissions: [sub('red', 'q1', true, 1), sub('blue', 'q1', true, 2), sub('green', 'q1', true, 3)], reveals: [] });
    // 3 solves: 100 - 70/9*4 = 68.9 -> 69 for all three
    expect(r.rows.map((x) => x.points)).toEqual([69, 69, 69]);
    expect(r.questions[0]!.value).toBe(69);
  });

  it('ignores solves after the freeze cutoff', () => {
    const r = scoreEvent({ rules: STATIC, questions: Q, entrants, startsAt: T0, cutoff: at(5), submissions: [sub('red', 'q1', true, 1), sub('blue', 'q2', true, 6)], reveals: [] });
    expect(r.rows.map((x) => [x.id, x.points])).toEqual([
      ['red', 100],
      ['blue', 0],
      ['green', 0],
    ]);
  });

  it('seeds per entrant and lab, and derives the status from the window', () => {
    const a = eventSeed('e1', 'team-a', 'lab');
    expect(a).toBe(eventSeed('e1', 'team-a', 'lab'));
    expect(a).not.toBe(eventSeed('e1', 'team-b', 'lab'));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(2 ** 31);
    const e = { published: true, starts_at: at(0), ends_at: at(60) };
    expect(eventStatus(e, at(-1))).toBe('upcoming');
    expect(eventStatus(e, at(30))).toBe('running');
    expect(eventStatus(e, at(60))).toBe('ended');
    expect(eventStatus({ ...e, published: false }, at(30))).toBe('draft');
  });
});
