import { describe, expect, it } from 'vitest';
import type { LabSession } from '../src/kube/types.js';
import { assertCapacity, clockSkewMs, LABEL_EXAM_SESSION, liveSessions, occupancy, type Reservation } from '../src/platform/capacity.js';

let n = 0;
const session = (learner: string, phase = 'Ready', nodes?: string[], labels: Record<string, string> = {}, name = `${learner}-${n++}`): LabSession => ({
  apiVersion: 'labs.cloudtrain.dev/v1alpha1',
  kind: 'LabSession',
  metadata: { name, labels: { 'app.kubernetes.io/managed-by': 'cloudtrain-gateway', ...labels } },
  spec: { templateRef: { name: 't' }, learner: { id: learner, org: 'o1' }, seed: 1 },
  status: { phase: phase as never, ...(nodes ? { nodes: nodes.map((ph, i) => ({ name: `n${i}`, driver: 'container', phase: ph as never })) } : {}) },
});
const res = (name: string, kind: 'lab' | 'exam', user: string, org = 'o1'): Reservation => ({ session_name: name, kind, user_id: user, org_id: org });

describe('session capacity', () => {
  it('caps every session of a learner, exams included; one exam larger than the cap only alone', () => {
    const occ = occupancy([session('alice'), session('alice'), session('bob')], []);
    expect(() => assertCapacity({ perLearner: 2, maxActive: 0, examReserve: 0 }, 'alice', occ)).toThrow(/at most 2/);
    expect(() => assertCapacity({ perLearner: 2, maxActive: 0, examReserve: 0 }, 'alice', occ, 'exam')).toThrow(/at most 2/);
    expect(() => assertCapacity({ perLearner: 2, maxActive: 0, examReserve: 0 }, 'carol', occ, 'exam', 5)).not.toThrow(); // runs nothing else
    // A second exam while the first is still reserved: refused.
    const busyExam = occupancy([], [{ ...res('attempt-a', 'exam', 'carol'), units: 2 }]);
    expect(() => assertCapacity({ perLearner: 2, maxActive: 0, examReserve: 0 }, 'carol', busyExam, 'exam', 2)).toThrow(/at most 2/);
    expect(() => assertCapacity({ perLearner: 2, maxActive: 0, examReserve: 0 }, 'bob', occ)).not.toThrow();
  });
  it('an exam is admitted only when all its environments fit', () => {
    const occ = occupancy(Array.from({ length: 7 }, (_, i) => session(`u${i}`)), []);
    expect(() => assertCapacity({ perLearner: 0, maxActive: 10, examReserve: 2 }, 'cand', occ, 'exam', 3)).not.toThrow(); // 7 + 3 = 10
    expect(() => assertCapacity({ perLearner: 0, maxActive: 10, examReserve: 2 }, 'cand', occ, 'exam', 4)).toThrow(/capacity/); // 7 + 4 > 10
    expect(() => assertCapacity({ perLearner: 2, maxActive: 0, examReserve: 0 }, 'u0', occupancy([session('u0')], []), 'lab', 2)).toThrow(/at most 2/);
  });
  it('reports condition times ahead of the database clock', () => {
    const s = session('a');
    s.status!.conditions = [{ type: 'Ready', status: 'True', lastTransitionTime: '2026-11-04T00:05:00Z' }];
    expect(clockSkewMs([s], new Date('2026-11-04T00:00:00Z'))).toBe(300_000);
    expect(clockSkewMs([s], new Date('2026-11-04T00:10:00Z'))).toBe(0);
  });
  it('a failed-session release of 0 never treats a teardown as stuck', () => {
    const s = session('a', 'Failed', ['Ready']);
    s.status!.conditions = [{ type: 'Ready', status: 'False', lastTransitionTime: '2026-01-01T00:00:00Z' }];
    expect(liveSessions([s], new Date('2026-11-04T00:00:00Z'), 0)).toHaveLength(1);
  });
  it('keeps a reserve of the platform cap for exams', () => {
    const occ = occupancy(Array.from({ length: 8 }, (_, i) => session(`u${i}`)), []);
    expect(() => assertCapacity({ perLearner: 0, maxActive: 10, examReserve: 2 }, 'new', occ)).toThrow(/capacity/);
    expect(() => assertCapacity({ perLearner: 0, maxActive: 10, examReserve: 2 }, 'new', occ, 'exam')).not.toThrow();
  });
  it('counts reservations until their sessions are listed, never twice', () => {
    const live = [session('alice', 'Ready', undefined, {}, 'lab-a'), session('cand', 'Ready', undefined, { [LABEL_EXAM_SESSION]: 'attempt-1' }, 'env-1')];
    const occ = occupancy(live, [
      res('lab-a', 'lab', 'alice'), // listed already: not again
      res('lab-b', 'lab', 'alice'), // created, not listed yet
      res('attempt-1', 'exam', 'cand'), // its environment is listed
      res('attempt-2', 'exam', 'cand2'), // environment not created yet
    ]);
    expect(occ.total).toBe(4);
    expect(occ.learnerSessions('alice')).toBe(2);
    expect(occ.learnerSessions('cand')).toBe(1); // its listed exam environment
    // Exam environments count toward the org's concurrency quota.
    expect(occ.orgSessions('o1')).toBe(4);
  });
  it('a confirmed lab reservation counts only for a LIST that began before the confirmation', () => {
    const listedAt = new Date('2026-11-04T00:00:10Z');
    const before = { ...res('gone', 'lab', 'alice'), confirmed_at: new Date('2026-11-04T00:00:05Z') };
    const after = { ...res('racing', 'lab', 'bob'), confirmed_at: new Date('2026-11-04T00:00:11Z') };
    const occ = occupancy([], [before, after, res('creating', 'lab', 'carol')], listedAt);
    expect(occ.total).toBe(2); // racing (maybe missed by the LIST) + creating
    expect(occ.learnerSessions('alice')).toBe(0); // created before the LIST and not in it: deleted
  });
  it('an exam reserves its environment count until all of them are listed, then is confirmed', () => {
    const env = (i: number) => session('cand', 'Ready', undefined, { [LABEL_EXAM_SESSION]: 'attempt-9' }, `env-9-${i}`);
    const r = { ...res('attempt-9', 'exam', 'cand'), units: 3 };
    expect(occupancy([], [r]).total).toBe(3);
    const two = occupancy([env(1), env(2)], [r]);
    expect(two.total).toBe(3); // 2 listed + 1 still to come
    expect(two.examsSeen).toEqual([]);
    const all = occupancy([env(1), env(2), env(3)], [r]);
    expect(all.total).toBe(3);
    expect(all.examsSeen.map((x) => x.session_name)).toEqual(['attempt-9']);
  });
  it('a confirmed exam counts again only for a LIST that may have missed its environments', () => {
    const listedAt = new Date('2026-11-04T00:00:10Z');
    const gone = { ...res('attempt-1', 'exam', 'cand'), units: 2, confirmed_at: new Date('2026-11-04T00:00:05Z') };
    const racing = { ...res('attempt-2', 'exam', 'cand2'), units: 2, confirmed_at: new Date('2026-11-04T00:00:11Z') };
    // Environments ended (not listed) after confirmation: attempt-1 no longer counts.
    expect(occupancy([], [gone, racing], listedAt).total).toBe(2);
  });
  it('stops counting a session whose teardown is stuck past the failed-session release, and reports it', () => {
    const now = new Date('2026-11-04T02:00:00Z');
    const stuck = session('a', 'Failed', ['Ready']);
    stuck.status!.conditions = [{ type: 'Ready', status: 'False', lastTransitionTime: '2026-11-04T01:00:00Z' }];
    const recent = session('b', 'Failed', ['Ready']);
    recent.status!.conditions = [{ type: 'Ready', status: 'False', lastTransitionTime: '2026-11-04T01:50:00Z' }];
    const reported: string[] = [];
    const live = liveSessions([stuck, recent], now, 30 * 60_000, (s) => reported.push(s.metadata.name));
    expect(live.map((s) => s.metadata.name)).toEqual([recent.metadata.name]);
    expect(reported).toEqual([stuck.metadata.name]);
  });
  it('a failed session kept for debugging counts until it expires, never as stuck', () => {
    const s = session('a', 'Failed', ['Ready']);
    s.status!.conditions = [
      { type: 'Ready', status: 'False', lastTransitionTime: '2026-11-04T00:00:00Z' },
      { type: 'ResourcesReleased', status: 'False', reason: 'KeptForDebugging', lastTransitionTime: '2026-11-04T00:00:00Z' },
    ];
    const reported: string[] = [];
    expect(liveSessions([s], new Date('2026-11-04T05:00:00Z'), 5 * 60_000, (x) => reported.push(x.metadata.name))).toHaveLength(1);
    expect(reported).toEqual([]);
  });
  it('counts sessions until their teardown has finished', () => {
    const all = [
      session('a'),
      session('a', 'Expired', ['Destroyed', 'Destroyed']),
      session('a', 'Expired', ['Destroyed', 'Ready']),
      session('a', 'Failed', []),
      session('a', 'Failed', ['Pending']),
    ];
    expect(liveSessions(all).map((s) => s.status?.phase)).toEqual(['Ready', 'Expired', 'Failed']);
  });
});
