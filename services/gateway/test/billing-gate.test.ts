import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CtfEventDetail, SiteConfig } from '@cloudtrain/api-types';
import { buildApp } from '../src/app.js';
import type { Principal } from '../src/auth.js';
import { BillingService, type SessionEndResolver } from '../src/billing/service.js';
import { signWebhook, StripeApi } from '../src/billing/stripe.js';
import type { Content } from '../src/content/load.js';
import { EventService } from '../src/events/service.js';
import { PgEvidenceSink, PgExamStore, PgTeamDirectory } from '../src/exams/pg.js';
import { ExamService } from '../src/exams/service.js';
import { phaseOf } from '../src/sessions/map.js';
import { SessionService } from '../src/sessions/service.js';
import { loadSiteConfig } from '../src/site/config.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { catalog, EXAM, examContent, FakeExamCluster, StubExamCompiler } from './exam-fakes.js';
import { FakeStripe } from './fake-stripe.js';
import { FakeCompiler, repo } from './fakes.js';
import { HeaderAuthenticator, Q, harness, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

/*
 * One billing gate and one meter for every start path (gateway-4, appsec-4):
 * labs, exam simulation attempts and CTF event labs. Plan limits
 * (concurrent labs, lab hours, exam simulations per month, CTF events) are
 * enforced with 402 payment_required and BillingBlockDetails. Starting a
 * lab that already runs reattaches to it instead of metering a second one
 * (web-2). Against a throwaway Postgres, FakeStripe and fake clusters.
 */

const available = await pgAvailable();
const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';
const EVENT_LAB = 'ctf-ticket-gate-breach';
const TRIAL = 'shell-first-steps-timetable';
const STANDARD = 'fix-crlf-script';
const STANDARD_VM = 'ctr-build-args-labels';

describe.skipIf(!available)('billing gate and metering on labs, exams and CTF event labs; plan limits', () => {
  let h: Harness;
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let site: SiteConfig;
  let content: Content;
  let examCluster: FakeExamCluster;
  let event: CtfEventDetail;
  let n = 1;
  // Billing and exams run on this clock, just after FakeCluster's session timestamps (2026-10-13T10:00Z on).
  const clock = new Date('2026-10-13T10:30:00Z');

  let billing: BillingService;
  let sessionEnd: SessionEndResolver;
  const hook = async (type: string, object: Record<string, unknown>) => {
    const raw = JSON.stringify({ id: `evt_g${n++}`, type, livemode: false, created: Math.floor(clock.getTime() / 1000), data: { object } });
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(raw, SECRET, Math.floor(clock.getTime() / 1000)) } });
    expect(r.json().status, r.body).toBe('processed');
  };
  const as = (user: string, org?: string) => {
    const headers = { 'x-test-user': user, ...(org ? { 'x-test-org': org } : {}) };
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) }),
      patch: (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, headers, payload: payload as object }),
      put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers, payload: payload as object }),
      del: (url: string) => app.inject({ method: 'DELETE', url, headers }),
    };
  };
  const blocked = (r: { statusCode: number; body: string; json: () => unknown }) => {
    expect(r.statusCode, r.body).toBe(402);
    const b = r.json() as { code: string; error: string; details: Record<string, unknown> };
    expect(b.code).toBe('payment_required');
    return b;
  };
  const usageOf = (user: string) => h.t.owner.selectFrom('billing_usage').selectAll().where('user_id', '=', user).orderBy('started_at').execute();
  const startExam = (user: string) => as(user).post(`/api/exams/${EXAM}/attempts`);
  const startEventLab = (user: string) => as(user).post(`/api/events/${event.id}/labs/${EVENT_LAB}/sessions`);
  const startLab = (user: string, lab: string) => as(user).post(`/api/labs/${lab}/sessions`);
  const runningOf = (user: string) => [...h.cluster.sessions.values()].filter((s) => s.spec.learner.id === user && phaseOf(s) !== 'expired');

  beforeAll(async () => {
    h = await harness();
    stripe = new FakeStripe();
    site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    site.flags.checkoutEnabled = true;
    content = await examContent();
    examCluster = new FakeExamCluster();
    sessionEnd = async (name, kind) => {
      if (kind === 'exam') {
        const es = await examCluster.getExamSession(name);
        if (!es) return 'missing';
        return es.status?.phase !== 'Completed' && es.status?.phase !== 'Failed' ? null : clock;
      }
      const ls = await h.cluster.getSession(name);
      if (!ls) return 'missing';
      return !['expired', 'failed'].includes(phaseOf(ls)) ? null : clock;
    };
    billing = new BillingService({ db: h.t.db, site, stripe: new StripeApi(KEY, stripe.fetch), webhookSecret: SECRET, webUrl: 'http://web.test', enforce: true, labs: content.labs, sessionEnd, now: () => clock });
    // The platform's hooks, as in main.ts: restriction, visibility, quotas, attempts.
    const sessions = new SessionService(content, h.cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20, hooks: h.ps });
    const exams = new ExamService(await catalog(), content, examCluster, new StubExamCompiler(), new PgExamStore(h.t.db), new PgEvidenceSink(h.t.db, content), new PgTeamDirectory(h.t.db), { now: () => clock });
    exams.gate = h.ps; // the capacity gate, as in main.ts
    app = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions, cluster: h.cluster, platform: h.ps, hub: new TerminalHub(), billing, events: new EventService(h.ps, sessions), exams, site: { config: site } });

    // Mei: Pro with a card (the plan subscription implies the payment method).
    expect((await as(Q.mei).post('/api/billing/me/payment-method')).statusCode).toBe(201);
    const cus = (await h.t.owner.selectFrom('billing_customers').select('stripe_customer_id').where('scope_key', '=', Q.mei).executeTakeFirstOrThrow()).stripe_customer_id;
    const sub = stripe.subscription('sub_mei_pro', cus, 'ct_pro_monthly', { metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: Q.mei, ct_plan_id: 'pro', ct_interval: 'monthly' } });
    const raw = JSON.stringify({ id: `evt_g${n++}`, type: 'customer.subscription.created', livemode: false, created: Math.floor(Date.now() / 1000), data: { object: sub } });
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(raw, SECRET, Math.floor(clock.getTime() / 1000)) } })).json().status).toBe('processed');

    // A running solo CTF event with one lab.
    const created = await as(Q.tomasz).post('/api/events', {
      title: 'Gate night',
      labIds: [EVENT_LAB],
      startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      mode: 'solo',
      scoring: 'static',
      freezeMinutes: 0,
      published: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    event = created.json();
    for (const u of [Q.lucas, Q.mei]) expect((await as(u).post(`/api/events/${event.id}/join`, {})).statusCode).toBe(200);
  }, 90_000);
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('a free account cannot start exam simulations or CTF event labs: the plan does not include them', async () => {
    const exam = blocked(await startExam(Q.lucas));
    expect(exam.details).toMatchObject({ reason: 'plan_required', action: 'upgrade', requiredPlan: { id: 'pro' } });
    expect(exam.error).toMatch(/Exam simulations are not included in the Free plan: they need the Pro plan/);
    expect(examCluster.sessions.size).toBe(0);

    const ctf = blocked(await startEventLab(Q.lucas));
    expect(ctf.details).toMatchObject({ reason: 'plan_required', requiredPlan: { id: 'pro' } });
    expect(ctf.error).toMatch(/CTF event labs are not included in the Free plan/);
    expect(runningOf(Q.lucas)).toHaveLength(0);
    expect(await usageOf(Q.lucas)).toHaveLength(0);
  });

  it('exam attempts and CTF event labs are metered like labs, as exam and event usage', async () => {
    const ev = await startEventLab(Q.mei);
    expect(ev.statusCode, ev.body).toBe(201);
    const ex = await startExam(Q.mei);
    expect(ex.statusCode, ex.body).toBe(201);
    const attempt = ex.json().attempt as { id: string };
    const rows = await usageOf(Q.mei);
    expect(rows.map((r) => [r.kind, r.lab_id, r.session_name])).toEqual([
      ['event', EVENT_LAB, ev.json().id],
      ['exam', EXAM, attempt.id],
    ]);
    for (const r of rows) expect(r).toMatchObject({ billable: true, trial: false, payer_key: Q.mei, ended_at: null });
    // The event lab again: the running one, not a second metered environment.
    expect((await startEventLab(Q.mei)).json().id).toBe(ev.json().id);
    expect(await usageOf(Q.mei)).toHaveLength(2);
  });

  it('concurrent labs: a third environment is refused; ended ones stop counting; a running lab reattaches', async () => {
    // Pro allows 2 at a time: the event lab and the exam run.
    const third = blocked(await startLab(Q.mei, STANDARD));
    expect(third.details).toMatchObject({ reason: 'concurrent_limit', action: 'end_session', limit: 2, used: 2, requiredPlan: { id: 'premium' } });
    expect(third.error).toMatch(/2 labs running, and the Pro plan allows 2 at a time/);

    // The exam completes (outside the gateway): the gate closes its usage before counting.
    const attempt = (await usageOf(Q.mei)).find((r) => r.kind === 'exam')!;
    examCluster.sessions.get(attempt.session_name)!.status = { phase: 'Completed', completedAt: clock.toISOString() };
    const lab = await startLab(Q.mei, STANDARD);
    expect(lab.statusCode, lab.body).toBe(201);
    expect((await h.t.owner.selectFrom('billing_usage').select('ended_at').where('id', '=', attempt.id).executeTakeFirstOrThrow()).ended_at).not.toBeNull();

    // Start (or Resume) again: the same session, 200, metered once.
    const again = await startLab(Q.mei, STANDARD);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(lab.json().id);
    expect((await usageOf(Q.mei)).filter((r) => r.lab_id === STANDARD)).toHaveLength(1);
    expect(runningOf(Q.mei).filter((s) => s.metadata.name.startsWith(STANDARD.slice(0, 10)))).toHaveLength(1);
    blocked(await startLab(Q.mei, STANDARD_VM)); // 2 running again

    // Ending one frees a slot.
    expect((await as(Q.mei).del(`/api/sessions/${lab.json().id}`)).statusCode).toBe(204);
    expect((await startLab(Q.mei, STANDARD_VM)).statusCode).toBe(201);
  });

  it("exam simulations per month: the plan's allowance is enforced", async () => {
    for (const s of runningOf(Q.mei)) expect((await as(Q.mei).del(`/api/sessions/${s.metadata.name}`)).statusCode).toBe(204);
    // Pro includes 4 a month; Mei has started 1. Three more earlier this month:
    const base = (await usageOf(Q.mei)).find((r) => r.kind === 'exam')!;
    for (let i = 0; i < 3; i++) {
      const started = new Date(base.started_at.getTime() - (i + 1) * 60_000);
      await h.t.owner
        .insertInto('billing_usage')
        .values({ org_id: h.orgs.quillmoor, user_id: Q.mei, lab_id: EXAM, session_name: `exam-past${i}`, kind: 'exam', compute_tier: base.compute_tier, units_per_minute: base.units_per_minute, unit_price: base.unit_price, payer_key: Q.mei, customer_id: base.customer_id, billable: true, started_at: started, ended_at: started, minutes: 1, units: 1 })
        .execute();
    }
    const r = blocked(await startExam(Q.mei));
    expect(r.details).toMatchObject({ reason: 'exam_limit_reached', action: 'upgrade', limit: 4, used: 4, requiredPlan: { id: 'premium' } });
    expect(r.error).toMatch(/started the 4 exam simulations the Pro plan includes this month/);
  });

  it('lab hours per month: refused once the plan hours are used', async () => {
    const free = site.plans!.items.find((p) => p.id === 'free')!;
    const before = free.entitlements.labHoursPerMonth;
    free.entitlements.labHoursPerMonth = 1;
    try {
      const at = new Date(clock.getTime() - 2 * 3600_000);
      await h.t.owner
        .insertInto('billing_usage')
        .values({ org_id: h.orgs.quillmoor, user_id: Q.sofia, lab_id: STANDARD, session_name: 'sofia-hour', compute_tier: 'pod', units_per_minute: 2, unit_price: '0.166667', payer_key: Q.sofia, customer_id: null, billable: false, started_at: at, ended_at: new Date(at.getTime() + 3600_000), minutes: 60, units: 120 })
        .execute();
      const r = blocked(await startLab(Q.sofia, TRIAL));
      expect(r.details).toMatchObject({ reason: 'lab_hours_exhausted', action: 'upgrade', limit: 1, used: 1, requiredPlan: { id: 'pro' } });
      expect(r.error).toMatch(/used the 1 lab hour of the Free plan this month/);
    } finally {
      free.entitlements.labHoursPerMonth = before;
    }
    expect((await startLab(Q.sofia, TRIAL)).statusCode).toBe(201);
  });

  it('dunning blocks exam and CTF event lab starts too', async () => {
    await h.t.owner.updateTable('billing_customers').set({ delinquent_since: new Date(clock.getTime() - 30 * 86_400_000) }).where('scope_key', '=', Q.mei).execute();
    try {
      expect(blocked(await startEventLab(Q.mei)).details).toMatchObject({ reason: 'payment_overdue', action: 'portal' });
      expect(blocked(await startExam(Q.mei)).details).toMatchObject({ reason: 'payment_overdue' });
    } finally {
      await h.t.owner.updateTable('billing_customers').set({ delinquent_since: null }).where('scope_key', '=', Q.mei).execute();
    }
    expect((await startEventLab(Q.mei)).statusCode).toBe(201);
  });

  const endAll = async (user: string) => {
    for (const x of runningOf(user)) expect((await as(user).del(`/api/sessions/${x.metadata.name}`)).statusCode).toBe(204);
  };
  const openUsage = (user: string, lab?: string) => {
    let q = h.t.owner.selectFrom('billing_usage').selectAll().where('user_id', '=', user).where('ended_at', 'is', null);
    if (lab) q = q.where('lab_id', '=', lab);
    return q.execute();
  };

  /** Makes creating a session slow, as the real cluster is (template compile, API round trips). */
  const slowCreate = async <T,>(ms: number, fn: () => Promise<T>): Promise<T> => {
    const real = h.cluster.createSession.bind(h.cluster);
    h.cluster.createSession = async (x) => {
      await new Promise((r) => setTimeout(r, ms));
      return real(x);
    };
    try {
      return await fn();
    } finally {
      h.cluster.createSession = real;
    }
  };

  it('concurrent starts cannot race past the limit, also while the first session does not exist yet', async () => {
    await endAll(Q.mei);
    expect(await openUsage(Q.mei)).toHaveLength(0);
    // Each start's session appears only 300 ms after its reservation: a reservation without a
    // session is still a start in flight, never "ended".
    const rs = await slowCreate(300, () => Promise.all([startLab(Q.mei, STANDARD), startLab(Q.mei, STANDARD_VM), startLab(Q.mei, TRIAL)]));
    const codes = rs.map((r) => r.statusCode).sort();
    expect(codes, rs.map((r) => r.body).join('\n')).toEqual([201, 201, 402]);
    expect((rs.find((r) => r.statusCode === 402)!.json() as { details: { reason: string } }).details.reason).toBe('concurrent_limit');
    expect(await openUsage(Q.mei)).toHaveLength(2);
    expect(runningOf(Q.mei)).toHaveLength(2);
    // No reservation was closed by a concurrent start; both are confirmed (the trial lab is free).
    for (const u of await openUsage(Q.mei)) expect(u).toMatchObject({ session_confirmed: true, billable: u.lab_id !== TRIAL });
    expect((await usageOf(Q.mei)).filter((u) => u.ended_at && u.minutes === 0)).toHaveLength(0);
  });

  it('two parallel starts of one lab create one environment: the second is refused while the first is in flight', async () => {
    await endAll(Q.mei);
    const rs = await slowCreate(300, () => Promise.all([startLab(Q.mei, STANDARD), startLab(Q.mei, STANDARD)]));
    const codes = rs.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
    expect(await openUsage(Q.mei, STANDARD)).toHaveLength(1);
    expect(runningOf(Q.mei)).toHaveLength(1);
  });

  it('a start that fails after the gate releases its reservation: never billed, never counted', async () => {
    await endAll(Q.mei);
    const real = h.cluster.createSession.bind(h.cluster);
    h.cluster.createSession = async () => {
      throw new Error('the cluster is having a moment');
    };
    let failed;
    try {
      failed = await startLab(Q.mei, STANDARD);
    } finally {
      h.cluster.createSession = real;
    }
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    const released = (await usageOf(Q.mei)).find((r) => r.lab_id === STANDARD && r.minutes === 0)!;
    expect(released).toMatchObject({ lab_id: STANDARD, minutes: 0, units: 0, billable: false });
    expect(released.ended_at).not.toBeNull();
    expect(await openUsage(Q.mei)).toHaveLength(0);
    expect((await startLab(Q.mei, STANDARD)).statusCode).toBe(201);
  });

  it("reattaching and listing stay in the caller's organisation: after switching orgs, the other org's session is not theirs", async () => {
    const live = runningOf(Q.mei).find((x) => x.metadata.name.startsWith(STANDARD.slice(0, 10)))!;
    await h.t.owner.insertInto('memberships').values({ org_id: h.orgs.acme, user_id: Q.mei, roles: ['learner'], status: 'active', source: 'seed' }).onConflict((oc) => oc.doNothing()).execute();
    const home = h.orgs.quillmoor;
    const acme = h.orgs.acme;
    try {
      expect((await as(Q.mei, home).get(`/api/labs/${STANDARD}/sessions`)).json().map((x: { id: string }) => x.id)).toContain(live.metadata.name);
      expect((await as(Q.mei, acme).get(`/api/labs/${STANDARD}/sessions`)).json()).toEqual([]);
      expect((await as(Q.mei, acme).get(`/api/sessions/${live.metadata.name}`)).statusCode).toBe(404);
      expect((await as(Q.mei, home).post(`/api/labs/${STANDARD}/sessions`)).json().id).toBe(live.metadata.name); // home org: reattached
      const other = await as(Q.mei, acme).post(`/api/labs/${STANDARD}/sessions`);
      expect(other.statusCode).not.toBe(200); // never the other org's session
      expect(other.json().id).not.toBe(live.metadata.name);
    } finally {
      await h.t.owner.deleteFrom('memberships').where('org_id', '=', acme).where('user_id', '=', Q.mei).execute();
    }
  });

  it('reattaching runs the access checks of a start: restricted processing refuses it', async () => {
    const live = runningOf(Q.mei).find((x) => x.metadata.name.startsWith(STANDARD.slice(0, 10)))!;
    await h.t.owner.updateTable('users').set({ restricted_at: clock }).where('id', '=', Q.mei).execute();
    try {
      const r = await startLab(Q.mei, STANDARD);
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toMatch(/restricted processing/);
    } finally {
      await h.t.owner.updateTable('users').set({ restricted_at: null }).where('id', '=', Q.mei).execute();
    }
    expect((await startLab(Q.mei, STANDARD)).json().id).toBe(live.metadata.name);
  });

  it('fails closed when a start cannot be priced (no lab facts for an exam pool or a lab)', async () => {
    const p = { sub: Q.mei, orgId: h.orgs.quillmoor } as Principal;
    await expect(billing.assertExamStart(p, { id: 'nowhere', title: 'Nowhere', labIds: ['no-such-lab'] }, 'exam-nowhere')).rejects.toMatchObject({ status: 409 });
    await expect(billing.assertLabStart(p, 'no-such-lab', 'lab', 'no-such-lab-abc123')).rejects.toMatchObject({ status: 409 });
    expect(await h.t.owner.selectFrom('billing_usage').select('id').where('session_name', 'in', ['exam-nowhere', 'no-such-lab-abc123']).execute()).toEqual([]);
  });

  it('orphan reservations (no session after the start timeout) are closed unbilled; young ones and ended sessions are not', async () => {
    const row = (name: string, minutesAgo: number, confirmed: boolean) => ({
      org_id: h.orgs.quillmoor, user_id: Q.kenji, lab_id: STANDARD, session_name: name, kind: 'lab' as const, compute_tier: 'pod' as const, units_per_minute: 2, unit_price: '0.166667',
      payer_key: Q.kenji, customer_id: null, billable: true, started_at: new Date(clock.getTime() - minutesAgo * 60_000), session_confirmed: confirmed,
    });
    await h.t.owner.insertInto('billing_usage').values([row('orphan-old-000001', 20, false), row('orphan-young-0001', 5, false), row('gone-confirmed-01', 30, true)]).execute();
    await billing.sweep(sessionEnd);
    const get = (name: string) => h.t.owner.selectFrom('billing_usage').selectAll().where('session_name', '=', name).executeTakeFirstOrThrow();
    expect(await get('orphan-old-000001')).toMatchObject({ minutes: 0, units: 0, billable: false });
    expect((await get('orphan-old-000001')).ended_at).not.toBeNull();
    expect((await get('orphan-young-0001')).ended_at).toBeNull(); // may still be starting
    expect(await get('gone-confirmed-01')).toMatchObject({ minutes: 30, billable: true }); // ran, then deleted: billed
    const outbox = await h.t.owner.selectFrom('billing_meter_outbox as o').innerJoin('billing_usage as u', 'u.id', 'o.usage_id').select('u.session_name').where('u.session_name', 'like', 'orphan-%').execute();
    expect(outbox).toEqual([]);
  });

  it("Team: the plan's limits apply per seated member (their own usage); the spend cap is the organisation's", async () => {
    // Quillmoor buys Team (3 seats) and seats Sofia and Jonah.
    expect((await as(Q.priya).post('/api/billing/org/payment-method')).statusCode).toBe(201);
    const orgCus = (await h.t.owner.selectFrom('billing_customers').select('stripe_customer_id').where('org_id', '=', h.orgs.quillmoor).where('scope_key', '=', '').executeTakeFirstOrThrow()).stripe_customer_id;
    const team = stripe.subscription('sub_team_gate', orgCus, 'ct_team_seat_monthly', { metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: '', ct_scope: 'org', ct_plan_id: 'team', ct_interval: 'monthly' } });
    (team.items as { data: { quantity: number }[] }).data[0]!.quantity = 3;
    await hook('customer.subscription.created', team);
    for (const u of [Q.sofia, Q.jonah]) expect((await as(Q.priya).post('/api/billing/org/seats/assign', { userId: u })).statusCode).toBe(200);
    await endAll(Q.sofia);

    // Team allows 2 at a time, per member.
    expect((await startLab(Q.sofia, STANDARD)).statusCode).toBe(201);
    expect((await startLab(Q.sofia, STANDARD_VM)).statusCode).toBe(201);
    const third = blocked(await startLab(Q.sofia, TRIAL));
    expect(third.details).toMatchObject({ reason: 'concurrent_limit', limit: 2, used: 2, scope: 'org' });
    expect(third.error).toMatch(/You already have 2 labs running, and the Team plan allows 2/);
    // Jonah's allowance is his own, not shared with Sofia's.
    const jonah = await startLab(Q.jonah, STANDARD);
    expect(jonah.statusCode, jonah.body).toBe(201);
    expect((await usageOf(Q.jonah)).at(-1)).toMatchObject({ payer_key: '', billable: true });

    // The spend cap is the organisation's: at the cap, every seated member is refused.
    expect((await as(Q.priya).put('/api/billing/org/limits', { monthlyCap: 1, hardStop: true })).statusCode).toBe(200);
    try {
      expect(blocked(await startLab(Q.jonah, STANDARD_VM)).details).toMatchObject({ reason: 'spend_cap_reached', scope: 'org' });
    } finally {
      expect((await as(Q.priya).put('/api/billing/org/limits', { monthlyCap: 0, hardStop: false })).statusCode).toBe(200);
    }
  });

  it('a session that comes up later than the start timeout is still metered: the orphan close is undone', async () => {
    await endAll(Q.mei);
    const real = h.cluster.createSession.bind(h.cluster);
    const t0 = clock.getTime();
    // The cluster takes longer than START_TIMEOUT_MS: meanwhile the sweep closes the reservation as an orphan.
    h.cluster.createSession = async (x) => {
      clock.setTime(t0 + 11 * 60_000);
      await billing.sweep(sessionEnd);
      return real(x);
    };
    let r;
    try {
      r = await startLab(Q.mei, STANDARD);
    } finally {
      h.cluster.createSession = real;
      clock.setTime(t0);
    }
    expect(r.statusCode, r.body).toBe(201);
    const row = await h.t.owner.selectFrom('billing_usage').selectAll().where('session_name', '=', r.json().id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ ended_at: null, minutes: null, session_confirmed: true, billable: true });
    // And the sweep, now that the session exists, leaves it running.
    await billing.sweep(sessionEnd);
    expect((await h.t.owner.selectFrom('billing_usage').select('ended_at').where('session_name', '=', r.json().id).executeTakeFirstOrThrow()).ended_at).toBeNull();
  });

  it('a create call that fails after the session was written keeps the session metered (no release)', async () => {
    await endAll(Q.mei);
    const real = h.cluster.createSession.bind(h.cluster);
    h.cluster.createSession = async (x) => {
      await real(x);
      throw new Error('timeout awaiting the API server response');
    };
    let r;
    try {
      r = await startLab(Q.mei, STANDARD);
    } finally {
      h.cluster.createSession = real;
    }
    expect(r.statusCode, r.body).toBe(201);
    expect(await h.t.owner.selectFrom('billing_usage').selectAll().where('session_name', '=', r.json().id).executeTakeFirstOrThrow()).toMatchObject({ ended_at: null, session_confirmed: true, billable: true });
  });

  it("the organisation's spend cap is decided one seated member at a time (organisation lock, then person)", async () => {
    await endAll(Q.sofia);
    await endAll(Q.jonah);
    const HEAVY = 'ov-async-patching'; // multi-VM: 15 units a minute, 2.5 minor units
    const spent = (await as(Q.priya).get('/api/billing/org')).json().limit.spent as number;
    // Room for one more start: the first reservation's minimum minute takes the organisation to the cap.
    expect((await as(Q.priya).put('/api/billing/org/limits', { monthlyCap: Math.floor(spent) + 1, hardStop: true })).statusCode).toBe(200);
    try {
      const rs = await slowCreate(200, () => Promise.all([startLab(Q.sofia, HEAVY), startLab(Q.jonah, HEAVY)]));
      expect(rs.map((x) => x.statusCode).sort(), rs.map((x) => x.body).join('\n')).toEqual([201, 402]);
      expect((rs.find((x) => x.statusCode === 402)!.json() as { details: { reason: string } }).details.reason).toBe('spend_cap_reached');
    } finally {
      expect((await as(Q.priya).put('/api/billing/org/limits', { monthlyCap: 0, hardStop: false })).statusCode).toBe(200);
    }
  });

  it('reattaching confirms a start whose confirmation was lost; the sweep does too', async () => {
    const live = runningOf(Q.mei).find((x) => x.metadata.name.startsWith(STANDARD.slice(0, 10)))!;
    const unconfirm = () => h.t.owner.updateTable('billing_usage').set({ session_confirmed: false }).where('session_name', '=', live.metadata.name).execute();
    const confirmed = async () => (await h.t.owner.selectFrom('billing_usage').select('session_confirmed').where('session_name', '=', live.metadata.name).executeTakeFirstOrThrow()).session_confirmed;
    await unconfirm();
    expect((await startLab(Q.mei, STANDARD)).json().id).toBe(live.metadata.name);
    expect(await confirmed()).toBe(true);
    await unconfirm();
    await billing.sweep(sessionEnd);
    expect(await confirmed()).toBe(true);
  });
});
