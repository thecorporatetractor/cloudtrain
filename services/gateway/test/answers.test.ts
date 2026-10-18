import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QuestionsView } from '@cloudtrain/api-types';
import { AnswerService } from '../src/answers/service.js';
import { MemoryAnswerStore } from '../src/answers/store.js';
import { buildApp } from '../src/app.js';
import { DevAuthenticator } from '../src/auth.js';
import { HttpError } from '../src/errors.js';
import { SessionService } from '../src/sessions/service.js';
import { alice, bob, FakeCluster, FakeCompiler, realContent } from './fakes.js';

const LAB = 'ctf-ticket-gate-breach';
const PARAMS = { octet: '77', victim: 'cato', uaminor: '25', export: 'refunds-q3.csv', salt: '9' };
const COMPUTED = { 'q-failed-count': '48' };

async function setup(opts: { rate?: number; computed?: Record<string, string> | null } = {}) {
  const content = await realContent();
  const cluster = new FakeCluster();
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
  const store = new MemoryAnswerStore();
  let now = Date.parse('2026-10-18T10:00:00Z');
  const answers = new AnswerService(sessions, store, { ratePerMinute: opts.rate ?? 50, now: () => new Date(now) });
  const s = await sessions.start(alice, LAB);
  cluster.markReady(s.id, PARAMS);
  if (opts.computed !== null) cluster.sessions.get(s.id)!.status!.computedAnswers = opts.computed ?? COMPUTED;
  return { content, cluster, sessions, store, answers, id: s.id, tick: (ms: number) => (now += ms) };
}

const status = (e: unknown) => (e instanceof HttpError ? e.status : undefined);
const q = (v: QuestionsView, id: string) => v.questions.find((x) => x.id === id)!;

describe('AnswerService (memory store)', () => {
  it('starts with question 1 open and the rest locked, without leaking answers', async () => {
    const { answers, id } = await setup();
    const v = await answers.questions(alice, id);
    expect(v).toMatchObject({ labId: LAB, order: 'sequential', total: 5, solved: 0, earned: 0, possible: 600 });
    expect(v.questions.map((x) => x.state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked']);
    expect(q(v, 'q-attacker-ip')).toMatchObject({ points: 100, penalty: 10, maxAttempts: 5, attemptsLeft: 5, available: 100, input: 'text', placeholder: '192.0.2.1', hintCost: 0 });
    expect(q(v, 'q-failed-count').input).toBe('number');
    expect(q(v, 'q-failed-count').prompt).toBe('');
    const json = JSON.stringify(v);
    for (const secret of ['203.0.113.77', '48', 'cato', 'refunds', 'python-requests']) expect(json).not.toContain(secret);
  });

  it('grades, penalises, unlocks the next question and records the award', async () => {
    const { answers, id, store } = await setup();
    const wrong = await answers.submit(alice, id, 'q-attacker-ip', '203.0.113.78');
    expect(wrong.correct).toBe(false);
    expect(wrong.message).toBe('Not correct. 4 attempts left. Each wrong answer costs 10 points.');
    expect(q(wrong.view, 'q-attacker-ip')).toMatchObject({ state: 'open', wrongAttempts: 1, attemptsLeft: 4, available: 90 });

    const right = await answers.submit(alice, id, 'q-attacker-ip', '  203.0.113.77 ');
    expect(right).toMatchObject({ correct: true, message: 'Correct: +90 points.' });
    expect(q(right.view, 'q-attacker-ip')).toMatchObject({ state: 'solved', awarded: 90, answer: '203.0.113.77' });
    expect(q(right.view, 'q-failed-count').state).toBe('open');
    expect(q(right.view, 'q-failed-count').prompt).toMatch(/How many failed login attempts/);
    expect(right.view).toMatchObject({ earned: 90, solved: 1 });

    // computed number answer, then exact, regex and any-of
    expect((await answers.submit(alice, id, 'q-failed-count', '48.0')).correct).toBe(true);
    expect((await answers.submit(alice, id, 'q-victim', 'CATO')).correct).toBe(true);
    expect((await answers.submit(alice, id, 'q-tool', 'python-requests')).correct).toBe(false);
    expect((await answers.submit(alice, id, 'q-tool', 'Python-Requests/2.25.0')).correct).toBe(true);
    const last = await answers.submit(alice, id, 'q-exfil', 'refunds-q3.csv');
    expect(last.view).toMatchObject({ solved: 5, earned: 90 + 100 + 150 + 85 + 150 });

    expect(store.auditLog.filter((a) => a.action === 'answer.submit')).toHaveLength(7);
    expect(store.auditLog[0]).toMatchObject({ targetId: `${LAB}/q-attacker-ip`, details: { correct: false, attempt: 1, points: 0 } });
    expect(JSON.stringify(store.auditLog)).not.toContain('203.0.113.78');
  });

  it('refuses answers to locked, solved and closed questions', async () => {
    const { answers, id } = await setup();
    await expect(answers.submit(alice, id, 'q-victim', 'cato')).rejects.toSatisfy((e) => status(e) === 409);
    await answers.submit(alice, id, 'q-attacker-ip', '203.0.113.77');
    await expect(answers.submit(alice, id, 'q-attacker-ip', '203.0.113.77')).rejects.toSatisfy((e) => status(e) === 409);
    for (let i = 0; i < 2; i++) await answers.submit(alice, id, 'q-failed-count', '1');
    const closed = await answers.submit(alice, id, 'q-failed-count', '2');
    expect(closed.message).toBe('Not correct. No attempts left: the question is closed.');
    expect(q(closed.view, 'q-failed-count')).toMatchObject({ state: 'closed', attemptsLeft: 0, available: 0 });
    // A closed question opens the next one (sequential).
    expect(q(closed.view, 'q-victim').state).toBe('open');
    await expect(answers.submit(alice, id, 'q-failed-count', '48')).rejects.toSatisfy((e) => status(e) === 409);
  });

  it('reveals question hints in order, at a cost, and only while open', async () => {
    const { answers, id } = await setup();
    await expect(answers.revealHint(alice, id, 'q-attacker-ip', 1)).rejects.toSatisfy((e) => status(e) === 409);
    const v1 = await answers.revealHint(alice, id, 'q-attacker-ip', 0);
    expect(q(v1, 'q-attacker-ip')).toMatchObject({ hintCost: 10, available: 90 });
    expect(q(v1, 'q-attacker-ip').hints[0]).toMatchObject({ revealed: true, cost: 10, body: expect.stringContaining('result=fail') });
    expect(q(v1, 'q-attacker-ip').hints[1]).toEqual({ index: 1, cost: 25, revealed: false });
    // Idempotent.
    expect(q(await answers.revealHint(alice, id, 'q-attacker-ip', 0), 'q-attacker-ip').hintCost).toBe(10);
    await expect(answers.revealHint(alice, id, 'q-victim', 0)).rejects.toSatisfy((e) => status(e) === 409);
    await expect(answers.revealHint(alice, id, 'q-attacker-ip', 9)).rejects.toSatisfy((e) => status(e) === 404);
    const r = await answers.submit(alice, id, 'q-attacker-ip', '203.0.113.77');
    expect(q(r.view, 'q-attacker-ip').awarded).toBe(90);
    await expect(answers.revealHint(alice, id, 'q-attacker-ip', 1)).rejects.toSatisfy((e) => status(e) === 409);
  });

  it('rate-limits submissions per learner', async () => {
    const { answers, id, tick } = await setup({ rate: 3 });
    for (let i = 0; i < 3; i++) await answers.submit(alice, id, 'q-attacker-ip', `198.51.100.${i}`);
    await expect(answers.submit(alice, id, 'q-attacker-ip', '203.0.113.77')).rejects.toSatisfy((e) => status(e) === 429 && (e as HttpError).extra.code === 'rate_limited');
    tick(61_000);
    expect((await answers.submit(alice, id, 'q-attacker-ip', '203.0.113.77')).correct).toBe(true);
  });

  it('validates input, ownership and readiness', async () => {
    const { answers, id, cluster } = await setup({ computed: null });
    await expect(answers.submit(alice, id, 'q-attacker-ip', '   ')).rejects.toSatisfy((e) => status(e) === 422);
    await expect(answers.submit(alice, id, 'q-attacker-ip', 'x'.repeat(513))).rejects.toSatisfy((e) => status(e) === 422);
    await expect(answers.submit(alice, id, 'q-attacker-ip', 42)).rejects.toSatisfy((e) => status(e) === 422);
    await expect(answers.submit(bob, id, 'q-attacker-ip', '1')).rejects.toSatisfy((e) => status(e) === 404);
    await expect(answers.questions(bob, id)).rejects.toSatisfy((e) => status(e) === 404);
    await expect(answers.submit(alice, id, 'nope', '1')).rejects.toSatisfy((e) => status(e) === 404);
    await answers.submit(alice, id, 'q-attacker-ip', '203.0.113.77');
    // The computed answer is not there yet: refused without counting an attempt.
    await expect(answers.submit(alice, id, 'q-failed-count', '48')).rejects.toSatisfy((e) => status(e) === 409);
    expect(q(await answers.questions(alice, id), 'q-failed-count').wrongAttempts).toBe(0);
    cluster.sessions.get(id)!.status!.phase = 'Expired';
    await expect(answers.submit(alice, id, 'q-failed-count', '48')).rejects.toSatisfy((e) => status(e) === 409);
  });

  it('a lab without questions has no questions endpoint', async () => {
    const { answers, sessions } = await setup();
    const s = await sessions.start(alice, 'gateway-smoke');
    await expect(answers.questions(alice, s.id)).rejects.toSatisfy((e) => status(e) === 404);
  });
});

describe('questions HTTP routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves the panel, grades answers and sets Retry-After on 429', async () => {
    const content = await realContent();
    const cluster = new FakeCluster();
    const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
    const answers = new AnswerService(sessions, new MemoryAnswerStore(), { ratePerMinute: 2 });
    app = await buildApp({ content, auth: new DevAuthenticator(alice), sessions, cluster, answers });
    const s = (await app.inject({ method: 'POST', url: `/api/labs/${LAB}/sessions` })).json() as { id: string };
    cluster.markReady(s.id, PARAMS);
    cluster.sessions.get(s.id)!.status!.computedAnswers = COMPUTED;
    const lab = (await app.inject(`/api/labs/${LAB}`)).json();
    expect(lab.spec.questions).toHaveLength(5);
    expect(lab.spec.questionOrder).toBe('sequential');
    expect(lab.spec.questions[1].prompt).toBe('');
    expect(JSON.stringify(lab)).not.toMatch(/"answer"|203\.0\.113|octet/);
    const v = await app.inject(`/api/sessions/${s.id}/questions`);
    expect(v.statusCode).toBe(200);
    const sub = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/questions/q-attacker-ip/answer`, payload: { answer: '203.0.113.77' } });
    expect(sub.json()).toMatchObject({ correct: true });
    const hint = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/questions/q-failed-count/hints/0` });
    expect(hint.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/questions/q-failed-count/answer`, payload: { answer: '1' } });
    const limited = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/questions/q-failed-count/answer`, payload: { answer: '2' } });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
  });
});
