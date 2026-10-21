import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SiteConfig } from '@cloudtrain/api-types';
import { buildApp } from '../src/app.js';
import { computeTierOf, PricingModel } from '../src/billing/compute.js';
import { BillingService } from '../src/billing/service.js';
import { signWebhook, StripeApi } from '../src/billing/stripe.js';
import type { Content } from '../src/content/load.js';
import * as m0009 from '../src/db/migrations/0009_billing_compute.js';
import { MemoryMailer } from '../src/mail.js';
import { SessionService } from '../src/sessions/service.js';
import { loadSiteConfig } from '../src/site/config.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { FakeStripe } from './fake-stripe.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';
import { HeaderAuthenticator, Q, harness, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

/*
 * Pay for compute, premium labs, the free trial, seats, dunning and spend caps
 * (migration 0009, docs/billing.md) against a throwaway Postgres, FakeStripe
 * and a controllable clock. Never talks to Stripe.
 */

const available = await pgAvailable();
const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';

const TRIAL = 'shell-first-steps-timetable'; // pod, easy: the free trial lab
const STANDARD = 'fix-crlf-script'; // pod, easy
const STANDARD_VM = 'ctr-build-args-labels'; // one VM, easy
const HARD = 'ov-build-publish-collection'; // pod, hard: Pro
const HARD_HEAVY = 'ov-async-patching'; // multi-VM, hard: Premium

describe('compute tiers and the pricing model (content/site.yaml)', () => {
  let content: Content;
  let site: SiteConfig;
  beforeAll(async () => {
    content = await realContent();
    site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
  }, 60_000);

  it('derives the compute tier from the topology', () => {
    const tier = (id: string) => computeTierOf(content.labs.get(id)!.lab.spec.topology);
    expect(tier(TRIAL)).toBe('pod');
    expect(tier(STANDARD)).toBe('pod');
    expect(tier(STANDARD_VM)).toBe('vm');
    expect(tier(HARD_HEAVY)).toBe('heavy');
    expect(tier('count-schedulable-nodes')).toBe('heavy'); // kubeadm cluster
    expect(tier('scale-berth-planner')).toBe('pod'); // virtual cluster
  });

  it('prices minutes per tier, rounds up, and resolves premium rules to the highest plan', () => {
    const m = new PricingModel(site);
    expect(m.unitsPerMinute('pod')).toBe(1);
    expect(m.unitsPerMinute('vm')).toBe(4);
    expect(m.unitsPerMinute('heavy')).toBe(10);
    expect(m.pricePerHour('pod')).toBe(30); // 60 units x 0.5 cent
    expect(m.billedMinutes(0)).toBe(1);
    expect(m.billedMinutes(61_000)).toBe(2);
    const facts = (id: string) => {
      const l = content.labs.get(id)!.lab;
      return { id, domain: l.metadata.domain, difficulty: l.metadata.difficulty, tier: computeTierOf(l.spec.topology) };
    };
    expect(m.requiredPlan(facts(STANDARD))).toBeUndefined();
    expect(m.requiredPlan(facts(HARD))?.id).toBe('pro');
    expect(m.requiredPlan(facts(HARD_HEAVY))?.id).toBe('premium');
    expect(m.level(m.plans.find((p) => p.id === 'team'))).toBe(2);
    expect(m.isTrialLab(TRIAL)).toBe(true);
    // The configured trial lab exists, is pod tier and every premium rule names a plan.
    expect(m.issues(new Set(content.labs.keys()))).toEqual([]);
    expect(m.trial.labs.every((id) => facts(id).tier === 'pod')).toBe(true);
  });
});

describe.skipIf(!available)('billing: pay for compute (migration 0009, Stripe test mode)', () => {
  let h: Harness;
  let stripe: FakeStripe;
  let billing: BillingService;
  let app: FastifyInstance;
  let cluster: FakeCluster;
  let content: Content;
  let site: SiteConfig;
  const mailer = new MemoryMailer();
  let clock = new Date('2026-10-13T10:00:00Z');

  const as = (user: string) => {
    const headers = { 'x-test-user': user };
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) }),
      put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers, payload: payload as object }),
      del: (url: string) => app.inject({ method: 'DELETE', url, headers }),
    };
  };
  let evt = 100;
  const hook = async (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${evt++}`, type, livemode: false, created: Math.floor(clock.getTime() / 1000), data: { object } });
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, SECRET, Math.floor(clock.getTime() / 1000)) } });
    expect(r.statusCode).toBe(200);
    return r.json() as { status: string };
  };
  /** Starts a lab and moves the clock to the session's start. */
  const start = async (user: string, lab: string) => {
    const r = await as(user).post(`/api/labs/${lab}/sessions`);
    if (r.statusCode === 201) clock = new Date(Date.parse(r.json().startedAt));
    return r;
  };
  const runFor = async (user: string, lab: string, minutes: number) => {
    const r = await start(user, lab);
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as string;
    clock = new Date(clock.getTime() + minutes * 60_000);
    expect((await as(user).del(`/api/sessions/${id}`)).statusCode).toBe(204);
    await billing.settle();
    return id;
  };
  const usage = (session: string) => h.t.owner.selectFrom('billing_usage').selectAll().where('session_name', '=', session).executeTakeFirstOrThrow();
  const customerOf = async (user: string | null) =>
    (
      await h.t.owner
        .selectFrom('billing_customers')
        .select('stripe_customer_id')
        .where('org_id', '=', h.orgs.quillmoor)
        .where('scope_key', '=', user ?? '')
        .executeTakeFirstOrThrow()
    ).stripe_customer_id;
  const blocked = (r: { statusCode: number; json: () => unknown }) => {
    expect(r.statusCode).toBe(402);
    const b = r.json() as { code: string; details: Record<string, unknown>; error: string };
    expect(b.code).toBe('payment_required');
    return b;
  };

  beforeAll(async () => {
    h = await harness();
    stripe = new FakeStripe();
    site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    site.flags.checkoutEnabled = true;
    content = await realContent();
    billing = new BillingService({ db: h.t.db, site, stripe: new StripeApi(KEY, stripe.fetch), webhookSecret: SECRET, webUrl: 'http://web.test', enforce: true, labs: content.labs, mailer, now: () => clock });
    cluster = new FakeCluster();
    app = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing, site: { config: site } });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('migration 0009 is additive and idempotent with RLS on every new table', async () => {
    await m0009.up(h.t.owner as unknown as Kysely<unknown>, 'cloudtrain_app');
    for (const t of m0009.COMPUTE_TENANT_TABLES) {
      const rls = await sql<{ relrowsecurity: boolean }>`SELECT relrowsecurity FROM pg_class WHERE relname = ${t}`.execute(h.t.owner);
      expect(rls.rows[0]?.relrowsecurity, t).toBe(true);
    }
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'billing_%'`.execute(h.t.owner);
    expect(cols.rows.map((c) => c.column_name).join(' ')).not.toMatch(/card|pan|cvc|iban/);
  });

  it('free account: the trial lab starts uncharged and capped, everything else asks for a payment method or a plan', async () => {
    const catalog = (await as(Q.lucas).get('/api/catalog')).json();
    const lab = (id: string) => catalog.labs.find((l: { id: string }) => l.id === id);
    expect(lab(TRIAL).access).toMatchObject({ computeTier: 'pod', trial: true, free: true, unitsPerMinute: 1, pricePerHour: 30 });
    expect(lab(TRIAL).access.locked).toBeUndefined();
    expect(lab(STANDARD).access.locked).toMatchObject({ reason: 'payment_method_required', action: 'add_payment_method', href: '/account/billing' });
    expect(lab(STANDARD_VM).access).toMatchObject({ computeTier: 'vm', pricePerHour: 120 });
    expect(lab(HARD).access).toMatchObject({ requiredPlan: { id: 'pro', name: 'Pro', level: 1 }, locked: { reason: 'plan_required', action: 'upgrade' } });
    expect(lab(HARD_HEAVY).access).toMatchObject({ computeTier: 'heavy', requiredPlan: { id: 'premium' } });
    expect((await as(Q.lucas).get(`/api/labs/${STANDARD}`)).json().access.locked.reason).toBe('payment_method_required');

    const refused = blocked(await start(Q.lucas, STANDARD));
    expect(refused.details).toMatchObject({ reason: 'payment_method_required', action: 'add_payment_method', href: '/account/billing', scope: 'user' });
    expect(refused.error).toMatch(/payment method/);
    expect(blocked(await start(Q.lucas, HARD)).details).toMatchObject({ reason: 'plan_required', requiredPlan: { id: 'pro' } });

    const first = await runFor(Q.lucas, TRIAL, 5);
    expect(await usage(first)).toMatchObject({ trial: true, billable: false, compute_tier: 'pod', minutes: 5, units: 5, payer_key: Q.lucas, customer_id: null });
    await runFor(Q.lucas, TRIAL, 2);
    await runFor(Q.lucas, TRIAL, 1);
    expect(await h.t.owner.selectFrom('billing_meter_outbox').selectAll().execute()).toHaveLength(0);
    expect(blocked(await start(Q.lucas, TRIAL)).details).toMatchObject({ reason: 'trial_exhausted', action: 'add_payment_method' });

    const me = (await as(Q.lucas).get('/api/billing/me')).json();
    expect(me).toMatchObject({ enforced: true, paymentMethod: false, level: 0, payer: 'user', trial: { maxSessions: 3, maxMinutes: 60, usedSessions: 3, usedMinutes: 8, exhausted: true, labs: [{ id: TRIAL }] } });
    expect(me.usage).toMatchObject({ estimate: 0, running: 0 });
    expect(me.usage.sessions).toHaveLength(3);
    expect(me.usage.sessions[0]).toMatchObject({ labId: TRIAL, trial: true, report: 'unbilled', amount: 0 });
    expect(me.compute.tiers.map((t: { tier: string; pricePerHour: number }) => [t.tier, t.pricePerHour])).toEqual([
      ['pod', 30],
      ['vm', 120],
      ['heavy', 300],
    ]);
  });

  it('adding a payment method (Checkout in setup mode) saves it as the default and opens the metered compute subscription', async () => {
    const r = await as(Q.mei).post('/api/billing/me/payment-method');
    expect(r.statusCode).toBe(201);
    const s = stripe.checkouts.at(-1)!;
    expect(s).toMatchObject({ mode: 'setup', currency: 'eur', 'metadata[ct_kind]': 'payment_method', 'setup_intent_data[metadata][ct_user_id]': Q.mei });
    expect(s.success_url).toMatch(/\/account\/billing\?setup=success/);
    const cus = await customerOf(Q.mei);
    const si = stripe.setupIntent(cus);
    expect((await hook('checkout.session.completed', { id: 'cs_setup', object: 'checkout.session', mode: 'setup', setup_intent: si.id, customer: cus, metadata: { ct_org_id: h.orgs.quillmoor, ct_kind: 'payment_method' } })).status).toBe('processed');
    expect((stripe.customers.get(cus)!.invoice_settings as { default_payment_method: string }).default_payment_method).toBe(si.payment_method);
    const computeSubs = [...stripe.subscriptions.values()].filter((x) => x.customer === cus && (x.metadata as Record<string, string>).ct_kind === 'compute');
    expect(computeSubs).toHaveLength(1);
    const row = await h.t.owner.selectFrom('billing_customers').selectAll().where('stripe_customer_id', '=', cus).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ has_payment_method: true, compute_subscription_id: computeSubs[0]!.id });
    expect(await h.t.owner.selectFrom('billing_subscriptions').select(['kind', 'plan_id', 'status']).where('stripe_subscription_id', '=', computeSubs[0]!.id as string).executeTakeFirst()).toEqual({ kind: 'compute', plan_id: 'compute', status: 'active' });
    // The compute subscription's own events are recognised, not mistaken for a plan.
    expect((await hook('customer.subscription.updated', computeSubs[0]!)).status).toBe('processed');
    const me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me).toMatchObject({ paymentMethod: true, portalAvailable: true, plan: { planId: 'free' } });
    expect(me.subscription).toBeUndefined();
  });

  it('meters a paid session and reports it once to the Billing Meter, idempotently', async () => {
    const r = await start(Q.mei, STANDARD);
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    clock = new Date(clock.getTime() + 12.5 * 60_000);
    const running = (await as(Q.mei).get('/api/billing/me')).json().usage;
    expect(running).toMatchObject({ running: 1, minutes: 13, units: 13, estimate: 6.5 });
    expect((await as(Q.mei).del(`/api/sessions/${id}`)).statusCode).toBe(204);
    await billing.settle();
    const u = await usage(id);
    expect(u).toMatchObject({ billable: true, trial: false, minutes: 13, units: 13, payer_key: Q.mei });
    const cus = await customerOf(Q.mei);
    expect(stripe.meterEvents).toEqual([{ identifier: `ctu_${u.id}`, event_name: 'ct_compute_units', timestamp: Math.floor(clock.getTime() / 1000), customer: cus, value: 13 }]);
    expect(await billing.flushOutbox()).toEqual({ sent: 0, failed: 0, retry: 0 });
    // A resend (a crash between Stripe's answer and our commit) is recognised as already reported.
    await h.t.owner.updateTable('billing_meter_outbox').set({ status: 'pending', next_attempt_at: new Date(0) }).where('usage_id', '=', u.id).execute();
    expect(await billing.flushOutbox()).toMatchObject({ sent: 1 });
    expect(stripe.meterEvents).toHaveLength(1);
    expect(stripe.upcomingComputeAmount(cus)).toBe(6.5);
    const me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me.usage).toMatchObject({ minutes: 13, units: 13, estimate: 6.5, running: 0, byTier: [{ tier: 'pod', minutes: 13, units: 13, amount: 6.5 }] });
    expect(me.usage.sessions[0]).toMatchObject({ labId: STANDARD, payer: 'user', report: 'sent', amount: 6.5 });
    expect(me.limit).toMatchObject({ monthlyCap: 5000, hardStop: true, source: 'default', spent: 6.5, reached: false });
  });

  it('retries failed meter reports from the outbox with backoff and dead-letters permanent failures', async () => {
    stripe.failMeterEvents = { count: 2, status: 500, message: 'Stripe is having a moment' };
    const id = await runFor(Q.mei, STANDARD_VM, 3);
    const u = await usage(id);
    expect(u).toMatchObject({ compute_tier: 'vm', units: 12 });
    const row = () => h.t.owner.selectFrom('billing_meter_outbox').selectAll().where('usage_id', '=', u.id).executeTakeFirstOrThrow();
    expect(await row()).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Stripe is having a moment' });
    expect(await billing.flushOutbox()).toEqual({ sent: 0, failed: 0, retry: 0 }); // not due yet
    clock = new Date(clock.getTime() + 2 * 60_000);
    expect(await billing.flushOutbox()).toMatchObject({ retry: 1 });
    clock = new Date(clock.getTime() + 5 * 60_000);
    expect(await billing.flushOutbox()).toMatchObject({ sent: 1 });
    expect(await row()).toMatchObject({ status: 'sent', attempts: 3, last_error: null });
    expect(stripe.meterEvents.at(-1)).toMatchObject({ identifier: `ctu_${u.id}`, value: 12 });

    stripe.failMeterEvents = { count: 1, status: 400, message: 'Timestamp too far in the past' };
    const bad = await usage(await runFor(Q.mei, STANDARD, 1));
    expect(await h.t.owner.selectFrom('billing_meter_outbox').select(['status', 'last_error']).where('usage_id', '=', bad.id).executeTakeFirstOrThrow()).toEqual({ status: 'failed', last_error: 'Timestamp too far in the past' });
    const me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me.usage.sessions.find((s: { id: string }) => s.id === bad.id).report).toBe('failed');
  });

  it('premium labs need the plan level: Pro unlocks hard labs, Premium the hard multi-VM ones', async () => {
    expect(blocked(await start(Q.mei, HARD)).details).toMatchObject({ reason: 'plan_required', action: 'upgrade', requiredPlan: { id: 'pro', level: 1 } });
    const cus = await customerOf(Q.mei);
    const sub = stripe.subscription('sub_mei_pro', cus, 'ct_pro_monthly', { metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: Q.mei, ct_plan_id: 'pro', ct_interval: 'monthly' } });
    expect((await hook('customer.subscription.created', sub)).status).toBe('processed');
    expect((await as(Q.mei).get('/api/billing/me')).json()).toMatchObject({ level: 1, plan: { planId: 'pro', source: 'subscription' } });
    await runFor(Q.mei, HARD, 4);
    expect(blocked(await start(Q.mei, HARD_HEAVY)).details).toMatchObject({ reason: 'plan_required', requiredPlan: { id: 'premium', level: 2 } });
    const catalog = (await as(Q.mei).get('/api/catalog')).json();
    const lab = (id: string) => catalog.labs.find((l: { id: string }) => l.id === id).access;
    expect(lab(HARD).locked).toBeUndefined();
    expect(lab(HARD_HEAVY).locked.reason).toBe('plan_required');
    // Compute is billed on top of the plan.
    expect((await h.t.owner.selectFrom('billing_usage').select('billable').where('lab_id', '=', HARD).executeTakeFirstOrThrow()).billable).toBe(true);
  });

  it('a spend cap with a hard stop refuses new paid labs; free trial labs and running labs go on', async () => {
    expect((await as(Q.mei).put('/api/billing/me/limits', { monthlyCap: 'lots', hardStop: true })).statusCode).toBe(422);
    expect((await as(Q.mei).put('/api/billing/me/limits', { monthlyCap: -1, hardStop: true })).statusCode).toBe(422);
    const running = await start(Q.mei, STANDARD);
    expect(running.statusCode).toBe(201);
    const set = await as(Q.mei).put('/api/billing/me/limits', { monthlyCap: 1, hardStop: true });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ monthlyCap: 1, hardStop: true, source: 'custom', reached: true });
    const b = blocked(await start(Q.mei, STANDARD_VM));
    expect(b.details).toMatchObject({ reason: 'spend_cap_reached', action: 'raise_cap', cap: 1, currency: 'EUR' });
    expect(b.error).toMatch(/€0\.01/);
    // The session that was already running is untouched.
    expect(cluster.sessions.has(running.json().id)).toBe(true);
    expect((await start(Q.mei, TRIAL)).statusCode).toBe(201); // the trial is free, the cap is about money
    expect((await as(Q.mei).put('/api/billing/me/limits', { monthlyCap: 1, hardStop: false })).statusCode).toBe(200);
    expect((await start(Q.mei, STANDARD_VM)).statusCode).toBe(201); // warn only
    expect((await as(Q.mei).get('/api/billing/me')).json().limit).toMatchObject({ reached: true, warn: true, hardStop: false });
    await as(Q.mei).put('/api/billing/me/limits', { monthlyCap: 5000, hardStop: true });
    for (const s of [...cluster.sessions.values()].filter((x) => x.spec.learner.id === Q.mei)) await as(Q.mei).del(`/api/sessions/${s.metadata.name}`);
    await billing.settle();
  });

  it('dunning: a failed payment starts a grace period (and mails), then blocks new paid labs until paid', async () => {
    const cus = await customerOf(Q.mei);
    mailer.sent = [];
    expect((await hook('invoice.payment_failed', stripe.invoice(cus))).status).toBe('processed');
    let me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me.dunning).toMatchObject({ state: 'grace', graceDays: 7, since: clock.toISOString() });
    expect(Date.parse(me.dunning.graceEndsAt) - clock.getTime()).toBe(7 * 86_400_000);
    const email = (await h.t.owner.selectFrom('users').select('email').where('id', '=', Q.mei).executeTakeFirstOrThrow()).email;
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: email, subject: expect.stringMatching(/payment failed/) });
    expect(mailer.sent[0]!.text).toMatch(/http:\/\/web\.test\/account\/billing/);
    // A second failure does not restart the grace period or mail again.
    await hook('invoice.payment_failed', stripe.invoice(cus, { attempt_count: 2 }));
    expect(mailer.sent).toHaveLength(1);
    await runFor(Q.mei, STANDARD, 1); // within the grace period

    clock = new Date(clock.getTime() + 8 * 86_400_000);
    me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me.dunning.state).toBe('blocked');
    const b = blocked(await start(Q.mei, STANDARD));
    expect(b.details).toMatchObject({ reason: 'payment_overdue', action: 'portal', href: '/account/billing' });
    expect(b.error).toMatch(/grace period has ended/);
    expect((await as(Q.mei).get('/api/catalog')).json().labs.find((l: { id: string }) => l.id === STANDARD).access.locked.reason).toBe('payment_overdue');
    await runFor(Q.mei, TRIAL, 1); // unpaid labs still start

    expect((await hook('invoice.paid', stripe.invoice(cus, { amount_paid: 1234, status: 'paid' }))).status).toBe('processed');
    expect((await as(Q.mei).get('/api/billing/me')).json().dunning).toEqual({ state: 'ok', graceDays: 7 });
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, subject: expect.stringMatching(/restored/) });
    await runFor(Q.mei, STANDARD, 1);

    // A past_due subscription is delinquent too, and recovers with it.
    const pro = stripe.subscriptions.get('sub_mei_pro')!;
    await hook('customer.subscription.updated', { ...pro, status: 'past_due' });
    expect((await as(Q.mei).get('/api/billing/me')).json()).toMatchObject({ dunning: { state: 'grace' }, plan: { planId: 'pro' } });
    await hook('customer.subscription.updated', { ...pro, status: 'active' });
    expect((await as(Q.mei).get('/api/billing/me')).json().dunning.state).toBe('ok');
    const actions = await h.t.owner.selectFrom('audit_log').select('details').where('action', '=', 'billing.dunning').execute();
    expect(actions.map((a) => (a.details as { state: string }).state)).toEqual(['started', 'cleared', 'started', 'cleared']);
  });

  it('organisation seats: checkout quantity, assignment, prorated seat changes, compute billed to the org', async () => {
    expect((await as(Q.priya).post('/api/billing/org/checkout', { planId: 'team', interval: 'monthly', seats: 3 })).statusCode).toBe(201);
    expect(stripe.checkouts.at(-1)!['line_items[0][quantity]']).toBe('3');
    const orgCus = await customerOf(null);
    const sub = stripe.subscription('sub_team', orgCus, 'ct_team_seat_monthly', { default_payment_method: 'pm_org_card', metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: '', ct_scope: 'org', ct_plan_id: 'team', ct_interval: 'monthly' } });
    (sub.items as { data: { quantity: number }[] }).data[0]!.quantity = 3;
    expect((await hook('checkout.session.completed', { id: 'cs_team', object: 'checkout.session', mode: 'subscription', subscription: 'sub_team', customer: orgCus, metadata: sub.metadata })).status).toBe('processed');
    expect((stripe.customers.get(orgCus)!.invoice_settings as { default_payment_method: string }).default_payment_method).toBe('pm_org_card');
    expect([...stripe.subscriptions.values()].filter((x) => x.customer === orgCus && (x.metadata as Record<string, string>).ct_kind === 'compute')).toHaveLength(1);

    const seats = (await as(Q.priya).get('/api/billing/org/seats')).json();
    expect(seats).toMatchObject({ purchased: 3, assigned: [], canChange: true, minSeats: 3 });
    expect(seats.unassigned.map((m: { userId: string }) => m.userId)).toContain(Q.lucas);
    expect((await as(Q.mei).get('/api/billing/org/seats')).statusCode).toBe(403);
    expect((await as(Q.mei).post('/api/billing/org/seats/assign', { userId: Q.lucas })).statusCode).toBe(403);

    for (const u of [Q.lucas, Q.sofia, Q.jonah]) expect((await as(Q.priya).post('/api/billing/org/seats/assign', { userId: u })).statusCode).toBe(200);
    expect((await as(Q.priya).post('/api/billing/org/seats/assign', { userId: Q.lucas })).statusCode).toBe(200); // already seated: no-op
    const full = await as(Q.priya).post('/api/billing/org/seats/assign', { userId: Q.kenji });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/All 3 seats are assigned/);
    expect((await as(Q.priya).post('/api/billing/org/seats/assign', { userId: 'nobody' })).statusCode).toBe(404);

    const lucas = (await as(Q.lucas).get('/api/billing/me')).json();
    expect(lucas).toMatchObject({ payer: 'org', level: 2, seat: { planId: 'team', planName: 'Team', level: 2 } });
    const id = await runFor(Q.lucas, HARD_HEAVY, 10); // Premium-level lab through the seat
    expect(await usage(id)).toMatchObject({ payer_key: '', billable: true, units: 100 });
    expect(stripe.meterEvents.at(-1)).toMatchObject({ customer: orgCus, value: 100 });
    const org = (await as(Q.priya).get('/api/billing/org')).json();
    expect(org.usage).toMatchObject({ units: 100, estimate: 50 });
    expect(org.usage.byMember).toEqual([expect.objectContaining({ userId: Q.lucas, units: 100, amount: 50 })]);
    expect(org.usage.sessions[0]).toMatchObject({ payer: 'org', userId: Q.lucas });
    expect(org.seats.assigned).toHaveLength(3);
    expect(org.limit).toMatchObject({ monthlyCap: 50000, hardStop: false });

    const more = await as(Q.priya).put('/api/billing/org/seats', { seats: 5 });
    expect(more.statusCode).toBe(200);
    expect(more.json().purchased).toBe(5);
    expect(stripe.subscriptionUpdates.at(-1)).toMatchObject({ id: 'sub_team', body: { 'items[0][id]': 'si_sub_team', 'items[0][quantity]': '5', proration_behavior: 'create_prorations' } });
    expect((await as(Q.priya).put('/api/billing/org/seats', { seats: 2 })).statusCode).toBe(422);
    expect((await as(Q.priya).post('/api/billing/org/seats/assign', { userId: Q.kenji })).statusCode).toBe(200);
    const fewer = await as(Q.priya).put('/api/billing/org/seats', { seats: 3 });
    expect(fewer.statusCode).toBe(409);
    expect(fewer.json().error).toMatch(/4 seats are assigned/);
    // Stripe confirms the quantity in its own event.
    (stripe.subscriptions.get('sub_team')!.items as { data: { quantity: number }[] }).data[0]!.quantity = 5;
    await hook('customer.subscription.updated', stripe.subscriptions.get('sub_team')!);
    expect((await as(Q.priya).get('/api/billing/org')).json().subscription.seats).toBe(5);

    // The org cap applies to org-billed labs; a member who cannot manage billing is told to ask an admin.
    expect((await as(Q.priya).put('/api/billing/org/limits', { monthlyCap: 1, hardStop: true })).statusCode).toBe(200);
    expect(blocked(await start(Q.sofia, STANDARD)).details).toMatchObject({ reason: 'spend_cap_reached', action: 'contact_admin', href: '/admin/billing', scope: 'org' });
    expect((await as(Q.sofia).put('/api/billing/org/limits', { monthlyCap: 0, hardStop: false })).statusCode).toBe(403);
    expect((await as(Q.priya).put('/api/billing/org/limits', { monthlyCap: 0, hardStop: false })).statusCode).toBe(200);

    // Unseated again: Lucas is back on his own (free, trial used up) account.
    expect((await as(Q.priya).del(`/api/billing/org/seats/${Q.lucas}`)).statusCode).toBe(200);
    expect((await as(Q.priya).del(`/api/billing/org/seats/${Q.lucas}`)).statusCode).toBe(404);
    expect(blocked(await start(Q.lucas, STANDARD)).details).toMatchObject({ reason: 'payment_method_required', scope: 'user' });
    const audits = await h.t.owner.selectFrom('audit_log').select('action').where('action', 'like', 'billing.seat%').execute();
    expect(new Set(audits.map((a) => a.action))).toEqual(new Set(['billing.seat_assign', 'billing.seat_unassign', 'billing.seats']));
  });

  it('the sweep closes usage of sessions that ended outside the gateway and reports them', async () => {
    const r = await start(Q.mei, STANDARD);
    const id = r.json().id as string;
    cluster.sessions.delete(id); // expired and torn down by the orchestrator
    clock = new Date(clock.getTime() + 20 * 60_000);
    const res = await billing.sweep(async (name) => ((await cluster.getSession(name)) ? null : clock));
    expect(res.closed).toBe(1);
    expect(await usage(id)).toMatchObject({ minutes: 20, units: 20 });
    expect((await h.t.owner.selectFrom('billing_meter_outbox').select('status').where('identifier', '=', `ctu_${(await usage(id)).id}`).executeTakeFirstOrThrow()).status).toBe('sent');
  });

  it('with enforcement off nothing is refused and usage is still recorded; with billing off nothing is billed', async () => {
    const loose = new BillingService({ db: h.t.db, site, stripe: new StripeApi(KEY, stripe.fetch), webhookSecret: SECRET, webUrl: 'http://web.test', enforce: false, labs: content.labs, now: () => clock });
    const off = new BillingService({ db: h.t.db, site, webUrl: 'http://web.test', enforce: true, labs: content.labs, now: () => clock });
    expect(off.enforced).toBe(false);
    const appLoose = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing: loose });
    const appOff = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing: off });
    try {
      const headers = { 'x-test-user': Q.lucas };
      const a = await appLoose.inject({ method: 'POST', url: `/api/labs/${HARD_HEAVY}/sessions`, headers });
      expect(a.statusCode).toBe(201);
      expect(await usage(a.json().id)).toMatchObject({ billable: false, trial: false, compute_tier: 'heavy' });
      const cat = (await appLoose.inject({ url: '/api/catalog', headers })).json();
      expect(cat.labs.find((l: { id: string }) => l.id === HARD_HEAVY).access.locked).toBeUndefined();
      expect((await appLoose.inject({ url: '/api/billing/me', headers })).json().enforced).toBe(false);
      const b = await appOff.inject({ method: 'POST', url: `/api/labs/${STANDARD}/sessions`, headers });
      expect(b.statusCode).toBe(201);
      expect(await usage(b.json().id)).toMatchObject({ billable: false });
      expect((await appOff.inject({ url: '/api/catalog', headers })).json().labs.find((l: { id: string }) => l.id === STANDARD).access).toMatchObject({ free: true });
    } finally {
      await appLoose.close();
      await appOff.close();
    }
  });
});
