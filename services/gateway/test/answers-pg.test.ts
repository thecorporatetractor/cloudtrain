import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();
const LAB = 'ctf-ticket-gate-breach';
const PARAMS = { octet: '77', victim: 'cato', uaminor: '25', export: 'refunds-q3.csv', salt: '9' };

describe.skipIf(!available)('CTF answers in Postgres (RLS, audit, history, skills)', () => {
  let h: Harness;
  let session: string;
  beforeAll(async () => {
    h = await harness({ answerRatePerMinute: 6 });
    const res = await as(h, Q.lucas).post(`/api/labs/${LAB}/sessions`);
    expect(res.statusCode).toBe(201);
    session = res.json().id;
    h.cluster.markReady(session, PARAMS);
    h.cluster.sessions.get(session)!.status!.computedAnswers = { 'q-failed-count': '48' };
  });
  afterAll(async () => h?.close());

  const answer = (q: string, a: string, user = Q.lucas) => as(h, user).post(`/api/sessions/${session}/questions/${q}/answer`, { answer: a });

  it('stores graded submissions and audit rows in the learner org, without the expected answer', async () => {
    expect((await answer('q-attacker-ip', '198.51.100.4')).json()).toMatchObject({ correct: false });
    expect((await as(h, Q.lucas).post(`/api/sessions/${session}/questions/q-attacker-ip/hints/0`)).statusCode).toBe(200);
    const ok = (await answer('q-attacker-ip', '203.0.113.77')).json();
    expect(ok).toMatchObject({ correct: true, message: 'Correct: +80 points.' });

    const rows = await h.t.owner.selectFrom('answer_submissions').selectAll().where('session_name', '=', session).orderBy('submitted_at').execute();
    expect(rows.map((r) => [r.check_id, r.correct, r.points, r.answer])).toEqual([
      ['q-attacker-ip', false, 0, '198.51.100.4'],
      ['q-attacker-ip', true, 80, '203.0.113.77'],
    ]);
    expect(rows[0]!.org_id).toBe(h.orgs.quillmoor);
    expect(rows[0]!.scope_key).toBe(session);
    const reveals = await h.t.owner.selectFrom('answer_hint_reveals').selectAll().where('session_name', '=', session).execute();
    expect(reveals.map((r) => [r.check_id, r.hint_index, r.cost])).toEqual([['q-attacker-ip', 0, 10]]);

    const audit = await h.t.owner.selectFrom('audit_log').selectAll().where('action', 'in', ['answer.submit', 'answer.hint']).orderBy('id').execute();
    expect(audit.map((a) => a.action)).toEqual(['answer.submit', 'answer.hint', 'answer.submit']);
    expect(audit[2]).toMatchObject({ actor_id: Q.lucas, target_type: 'question', target_id: `${LAB}/q-attacker-ip`, org_id: h.orgs.quillmoor });
    expect(audit[2]!.details).toMatchObject({ correct: true, attempt: 2, points: 80, session });
    expect(JSON.stringify(audit)).not.toContain('203.0.113.77');
  });

  it('keeps submissions append-only and invisible to other orgs', async () => {
    await expect(withTenant(h.t.db, { orgId: h.orgs.quillmoor }, (tx) => sql`UPDATE answer_submissions SET correct = true`.execute(tx))).rejects.toThrow(/permission denied/);
    const foreign = await withTenant(h.t.db, { orgId: h.orgs.acme }, (tx) => tx.selectFrom('answer_submissions').selectAll().execute());
    expect(foreign).toEqual([]);
    // Another learner cannot see or answer the session.
    expect((await as(h, Q.mei).get(`/api/sessions/${session}/questions`)).statusCode).toBe(404);
    expect((await answer('q-failed-count', '48', Q.mei)).statusCode).toBe(404);
  });

  it('records points on the attempt and skill evidence; history and skills show them', async () => {
    expect((await answer('q-failed-count', '48')).json().correct).toBe(true);
    const attempt = await h.t.owner.selectFrom('lab_attempts').selectAll().where('session_name', '=', session).executeTakeFirstOrThrow();
    expect(attempt).toMatchObject({ points_earned: 180, points_possible: 600, questions_solved: 2, questions_total: 5 });
    const ev = await h.t.owner.selectFrom('skill_evidence').select(['check_id', 'outcome', 'skill_id']).where('attempt_id', '=', attempt.id).orderBy('id').execute();
    expect(ev.map((e) => e.check_id)).toEqual(['q-attacker-ip', 'q-failed-count']);
    expect(ev.every((e) => e.outcome === 1)).toBe(true);

    const mine = (await as(h, Q.lucas).get(`/api/attempts/mine?lab=${LAB}`)).json();
    expect(mine.items[0].points).toEqual({ earned: 180, possible: 600, solved: 2, total: 5 });
    const skills = (await as(h, Q.lucas).get('/api/skills')).json();
    expect(skills.ctf).toEqual({ points: 180, solved: 2, labs: 1 });
    const lucasState = skills.states.find((s: { skillId: string }) => s.skillId === 'linux.shell.text-processing');
    expect(lucasState.evidence).toBeGreaterThan(0);
  });

  it('rate-limits a learner across questions', async () => {
    // 3 answers so far; the limit is 6 a minute (any question).
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await answer('q-victim', `user${i}`)).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
