import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CtfEventDetail, CtfScoreboard } from '@cloudtrain/api-types';
import { LABEL_CTF_EVENT, LABEL_CTF_TEAM } from '../src/kube/types.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();
const LAB = 'ctf-ticket-gate-breach';
const PARAMS = { octet: '77', victim: 'cato', uaminor: '25', export: 'refunds-q3.csv', salt: '9' };

describe.skipIf(!available)('CTF events (teams, shared progress, scoreboard, export)', () => {
  let h: Harness;
  let ev: CtfEventDetail;
  const sessions: Record<string, string> = {};
  beforeAll(async () => {
    h = await harness({ answerRatePerMinute: 50 });
  });
  afterAll(async () => h?.close());

  const start = (user: string) => as(h, user).post(`/api/events/${ev.id}/labs/${LAB}/sessions`);
  const answer = (user: string, q: string, a: string) => as(h, user).post(`/api/sessions/${sessions[user]}/questions/${q}/answer`, { answer: a });
  const ready = (id: string) => {
    h.cluster.markReady(id, PARAMS);
    h.cluster.sessions.get(id)!.status!.computedAnswers = { 'q-failed-count': '48' };
  };

  it('only event managers create events; learners only see published ones', async () => {
    const body = {
      title: 'Depot gateway night',
      labIds: [LAB],
      startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      mode: 'team',
      teamSizeMax: 2,
      teamFormation: 'self',
      scoring: 'dynamic',
      dynamicMinPct: 50,
      dynamicDecay: 2,
      firstBlood: true,
      freezeMinutes: 0,
      published: false,
    };
    expect((await as(h, Q.lucas).post('/api/events', body)).statusCode).toBe(403);
    expect((await as(h, Q.tomasz).post('/api/events', { ...body, labIds: ['gateway-smoke'] })).statusCode).toBe(422);
    const res = await as(h, Q.tomasz).post('/api/events', body);
    expect(res.statusCode).toBe(201);
    ev = res.json();
    expect(ev).toMatchObject({ status: 'draft', mode: 'team', labs: [{ labId: LAB, questionCount: 5, points: 600 }] });
    expect((await as(h, Q.lucas).get('/api/events')).json()).toEqual([]);
    expect((await as(h, Q.lucas).get(`/api/events/${ev.id}`)).statusCode).toBe(404);
    ev = (await as(h, Q.tomasz).patch(`/api/events/${ev.id}`, { published: true })).json();
    expect(ev.status).toBe('running');
    expect((await as(h, Q.lucas).get('/api/events')).json()).toHaveLength(1);
  });

  it('learners form teams; teammates get the same seed and share progress', async () => {
    expect((await start(Q.lucas)).statusCode).toBe(403); // not joined
    ev = (await as(h, Q.lucas).post(`/api/events/${ev.id}/join`, { teamName: 'Night Owls' })).json();
    expect(ev.myTeam).toMatchObject({ name: 'Night Owls', members: [{ id: Q.lucas }] });
    const owls = ev.myTeam!.id;
    expect((await as(h, Q.mei).post(`/api/events/${ev.id}/join`, { teamName: 'night owls' })).statusCode).toBe(409);
    await as(h, Q.mei).post(`/api/events/${ev.id}/join`, { teamId: owls });
    await as(h, Q.sofia).post(`/api/events/${ev.id}/join`, { teamName: 'Signal Box' });
    expect((await as(h, Q.jonah).post(`/api/events/${ev.id}/join`, { teamId: owls })).statusCode).toBe(409); // full (2)

    for (const u of [Q.lucas, Q.mei, Q.sofia]) {
      const r = await start(u);
      expect(r.statusCode).toBe(201);
      sessions[u] = r.json().id;
      ready(sessions[u]!);
    }
    const ls = (u: string) => h.cluster.sessions.get(sessions[u]!)!;
    expect(ls(Q.lucas).spec.seed).toBe(ls(Q.mei).spec.seed);
    expect(ls(Q.lucas).spec.seed).not.toBe(ls(Q.sofia).spec.seed);
    expect(ls(Q.lucas).metadata.labels).toMatchObject({ [LABEL_CTF_EVENT]: ev.id, [LABEL_CTF_TEAM]: owls });
    expect(Date.parse(ls(Q.lucas).spec.expiresAt!)).toBeLessThanOrEqual(Date.parse(ev.endsAt));
    // Starting again resumes the same session.
    expect((await start(Q.lucas)).json().id).toBe(sessions[Q.lucas]);

    expect((await answer(Q.lucas, 'q-attacker-ip', '203.0.113.77')).json()).toMatchObject({ correct: true });
    const mei = (await as(h, Q.mei).get(`/api/sessions/${sessions[Q.mei]}/questions`)).json();
    expect(mei.questions[0]).toMatchObject({ state: 'solved', firstBlood: true, solvedBy: { id: Q.lucas } });
    expect(mei.event).toMatchObject({ id: ev.id, teamName: 'Night Owls', scoring: 'dynamic' });
    expect((await answer(Q.mei, 'q-attacker-ip', '203.0.113.77')).statusCode).toBe(409); // already solved by the team
    expect((await answer(Q.mei, 'q-failed-count', '48')).json().correct).toBe(true);
  });

  it('scores dynamically, marks first bloods and ranks ties by the last solve', async () => {
    await answer(Q.sofia, 'q-attacker-ip', '198.51.100.9');
    await answer(Q.sofia, 'q-attacker-ip', '203.0.113.77');
    const b: CtfScoreboard = (await as(h, Q.sofia).get(`/api/events/${ev.id}/scoreboard`)).json();
    // q-attacker-ip: 2 solves -> 100 + (50-100)/4 = 87.5 -> 88; Signal Box loses 10 for a wrong answer.
    expect(b.rows.map((r) => [r.rank, r.name, r.points, r.solves, r.firstBloods])).toEqual([
      [1, 'Night Owls', 188, 2, 2],
      [2, 'Signal Box', 78, 1, 0],
    ]);
    expect(b.mine).toBe(b.rows[1]!.id);
    expect(b.questions[0]).toMatchObject({ value: 88, solves: 2, firstBlood: { entrantName: 'Night Owls' } });
    expect(b.solves[0]).toMatchObject({ entrantName: 'Signal Box', questionNumber: 1, points: 78 });
    expect(b.timeline.map((t) => t.name)).toEqual(['Night Owls', 'Signal Box']);
  });

  it('freezes the scoreboard for learners during the last minutes, not for managers', async () => {
    await as(h, Q.tomasz).patch(`/api/events/${ev.id}`, { freezeMinutes: 120 });
    const learner: CtfScoreboard = (await as(h, Q.lucas).get(`/api/events/${ev.id}/scoreboard`)).json();
    expect(learner.frozen).toBe(true);
    expect(learner.rows.every((r) => r.points === 0)).toBe(true);
    const manager: CtfScoreboard = (await as(h, Q.tomasz).get(`/api/events/${ev.id}/scoreboard`)).json();
    expect(manager.frozen).toBe(false);
    expect(manager.rows[0]!.points).toBe(188);
    await as(h, Q.tomasz).patch(`/api/events/${ev.id}`, { freezeMinutes: 0 });
  });

  it('gives managers a report and a CSV export, both audited; learners get 403', async () => {
    const rep = (await as(h, Q.tomasz).get(`/api/events/${ev.id}/report`)).json();
    expect(rep.participants).toHaveLength(3);
    expect(rep.participants.find((p: { user: { id: string } }) => p.user.id === Q.sofia)).toMatchObject({ teamName: 'Signal Box', submissions: 2, correct: 1 });
    expect((await as(h, Q.lucas).get(`/api/events/${ev.id}/report`)).statusCode).toBe(403);
    const csv = await as(h, Q.tomasz).get(`/api/events/${ev.id}/results.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toBe(`rank,team,members,points,solves,first_bloods,last_solve_at,${LAB}#1,${LAB}#2,${LAB}#3,${LAB}#4,${LAB}#5`);
    expect(lines[1]).toMatch(/^1,Night Owls,.*,188,2,2,/);
    const actions = (await h.t.owner.selectFrom('audit_log').select('action').where('target_id', '=', ev.id).execute()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['event.create', 'event.update', 'event.join', 'event.export']));
  });

  it('closes answers when the event has ended', async () => {
    await as(h, Q.tomasz).patch(`/api/events/${ev.id}`, { startsAt: new Date(Date.now() - 120 * 60_000).toISOString(), endsAt: new Date(Date.now() - 60_000).toISOString() });
    const r = await answer(Q.sofia, 'q-failed-count', '48');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/ended/);
  });
});
