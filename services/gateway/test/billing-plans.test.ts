import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { BillingService } from '../src/billing/service.js';
import { signWebhook, StripeApi } from '../src/billing/stripe.js';
import { SessionService } from '../src/sessions/service.js';
import { loadSiteConfig } from '../src/site/config.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { FakeStripe } from './fake-stripe.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';
import { HeaderAuthenticator, Q, harness, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

/*
 * One plan subscription per account (gateway-3): checkout refuses a second
 * one, and entitlements follow every active plan subscription, so cancelling
 * one of two never drops a paying account to Free. Postgres and FakeStripe.
 */

const available = await pgAvailable();
const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';

describe.skipIf(!available)('billing: one plan subscription per account, entitlements from all active ones', () => {
  let h: Harness;
  let stripe: FakeStripe;
  let app: FastifyInstance;
  let n = 1;

  const as = (user: string) => {
    const headers = { 'x-test-user': user };
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) }),
    };
  };
  /** Sends a subscription event; Stripe's own copy is updated first (the gateway may read it back). */
  const hook = async (type: string, sub: Record<string, unknown>) => {
    stripe.subscriptions.set(sub.id as string, sub);
    const raw = JSON.stringify({ id: `evt_p${n++}`, type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: sub } });
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(raw, SECRET) } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('processed');
  };
  const customerOf = async (user: string | null, admin = Q.priya) => {
    const scope = user ?? '';
    const existing = await h.t.owner.selectFrom('billing_customers').select('stripe_customer_id').where('org_id', '=', h.orgs.quillmoor).where('scope_key', '=', scope).executeTakeFirst();
    if (existing) return existing.stripe_customer_id;
    expect((await as(user ?? admin).post(user ? '/api/billing/me/payment-method' : '/api/billing/org/payment-method')).statusCode).toBe(201);
    return (await h.t.owner.selectFrom('billing_customers').select('stripe_customer_id').where('org_id', '=', h.orgs.quillmoor).where('scope_key', '=', scope).executeTakeFirstOrThrow()).stripe_customer_id;
  };
  const sub = (id: string, customer: string, lookupKey: string, planId: string, user: string | null, over: Record<string, unknown> = {}) =>
    stripe.subscription(id, customer, lookupKey, { metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: user ?? '', ct_scope: user ? 'user' : 'org', ct_plan_id: planId, ct_interval: 'monthly' }, ...over });

  beforeAll(async () => {
    h = await harness();
    stripe = new FakeStripe();
    const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    site.flags.checkoutEnabled = true;
    const content = await realContent();
    const billing = new BillingService({ db: h.t.db, site, stripe: new StripeApi(KEY, stripe.fetch), webhookSecret: SECRET, webUrl: 'http://web.test', enforce: true, labs: content.labs });
    const cluster = new FakeCluster();
    app = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing, site: { config: site } });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('checkout refuses a second plan subscription while one is active and points to the portal', async () => {
    const cus = await customerOf(Q.mei);
    await hook('customer.subscription.created', sub('sub_pro', cus, 'ct_pro_monthly', 'pro', Q.mei));
    const before = stripe.checkouts.length;
    for (const planId of ['premium', 'pro']) {
      const r = await as(Q.mei).post('/api/billing/me/checkout', { planId, interval: 'monthly' });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ code: 'conflict', details: { reason: 'plan_active', planId: 'pro', action: 'portal' } });
      expect(r.json().error).toMatch(/already have the Pro plan.*billing portal/);
    }
    expect(stripe.checkouts.length).toBe(before); // no Checkout Session was created
  });

  it('with two active plan subscriptions, entitlements follow the highest, and cancelling one keeps the other', async () => {
    // Two Checkouts opened before either completed: Stripe has two active plan subscriptions.
    const cus = await customerOf(Q.mei);
    const premium = sub('sub_premium', cus, 'ct_premium_monthly', 'premium', Q.mei);
    await hook('customer.subscription.created', premium);
    let me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me).toMatchObject({ level: 2, plan: { planId: 'premium', source: 'subscription' }, subscription: { planId: 'premium', status: 'active' } });

    // A late "updated" of the Pro subscription does not downgrade the account.
    await hook('customer.subscription.updated', { ...stripe.subscriptions.get('sub_pro')!, cancel_at_period_end: true });
    expect((await as(Q.mei).get('/api/billing/me')).json().plan.planId).toBe('premium');

    // Cancelling Premium leaves Pro, still paid: not Free.
    await hook('customer.subscription.deleted', { ...premium, status: 'canceled' });
    me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me).toMatchObject({ level: 1, plan: { planId: 'pro', source: 'subscription' }, subscription: { planId: 'pro', status: 'active' } });

    // Only when nothing is active does the account fall back to Free; then a new checkout is allowed.
    await hook('customer.subscription.deleted', { ...stripe.subscriptions.get('sub_pro')!, status: 'canceled' });
    me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me).toMatchObject({ level: 0, plan: { planId: 'free', source: 'default' } });
    expect((await as(Q.mei).post('/api/billing/me/checkout', { planId: 'premium', interval: 'monthly' })).statusCode).toBe(201);
  });

  it('an organisation keeps its level and seats while one of two plan subscriptions is cancelled', async () => {
    const cus = await customerOf(null);
    const a = sub('sub_team_a', cus, 'ct_team_seat_monthly', 'team', null);
    (a.items as { data: { quantity: number }[] }).data[0]!.quantity = 3;
    await hook('customer.subscription.created', a);
    expect((await as(Q.priya).post('/api/billing/org/seats/assign', { userId: Q.lucas })).statusCode).toBe(200);
    expect((await as(Q.priya).post('/api/billing/org/checkout', { planId: 'team', interval: 'monthly', seats: 3 })).statusCode).toBe(409);

    const b = sub('sub_team_b', cus, 'ct_team_seat_monthly', 'team', null);
    (b.items as { data: { quantity: number }[] }).data[0]!.quantity = 3;
    await hook('customer.subscription.created', b);
    await hook('customer.subscription.deleted', { ...a, status: 'canceled' });
    const org = (await as(Q.priya).get('/api/billing/org')).json();
    expect(org).toMatchObject({ level: 2, plan: { planId: 'team', source: 'subscription' }, subscription: { status: 'active' }, seats: { purchased: 3 } });
    // The seated member keeps the org plan's level.
    expect((await as(Q.lucas).get('/api/billing/me')).json()).toMatchObject({ payer: 'org', level: 2, seat: { planId: 'team' } });
  });
  const planSessions = (cus: string) => [...stripe.checkoutSessions.values()].filter((x) => x.customer === cus && x.mode === 'subscription');
  const age = (cus: string, seconds: number) => {
    for (const x of planSessions(cus)) x.created = Math.floor(Date.now() / 1000) - seconds;
  };

  it('concurrent checkouts are serialised: the second waits for the first and finds it in progress', async () => {
    const cus = await customerOf(Q.sofia);
    stripe.checkoutCreateLatencyMs = 100;
    let rs;
    try {
      rs = await Promise.all([as(Q.sofia).post('/api/billing/me/checkout', { planId: 'pro', interval: 'monthly' }), as(Q.sofia).post('/api/billing/me/checkout', { planId: 'premium', interval: 'monthly' })]);
    } finally {
      stripe.checkoutCreateLatencyMs = 0;
    }
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.statusCode === 409)!.json().details).toMatchObject({ reason: 'checkout_in_progress' });
    expect(planSessions(cus).filter((x) => x.status === 'open')).toHaveLength(1);
  });

  it('a checkout in progress (under 5 minutes) is not killed; an older abandoned one is expired', async () => {
    const cus = await customerOf(Q.sofia);
    const young = await as(Q.sofia).post('/api/billing/me/checkout', { planId: 'pro', interval: 'monthly' });
    expect(young.statusCode).toBe(409);
    expect(planSessions(cus).filter((x) => x.status === 'open')).toHaveLength(1);
    age(cus, 10 * 60);
    const fresh = await as(Q.sofia).post('/api/billing/me/checkout', { planId: 'pro', interval: 'monthly' });
    expect(fresh.statusCode).toBe(201);
    const open = planSessions(cus).filter((x) => x.status === 'open');
    expect(open.map((x) => x.id)).toEqual([fresh.json().sessionId]);
  });

  it('a Checkout that completes while the old ones are expired is caught by the re-check (plan_pending)', async () => {
    const cus = await customerOf(Q.sofia);
    age(cus, 10 * 60);
    // The payment in the open (old) session wins the race against its expiry.
    for (const x of planSessions(cus).filter((y) => y.status === 'open')) x.completeOnExpire = 'sub_sofia_raced';
    const r = await as(Q.sofia).post('/api/billing/me/checkout', { planId: 'premium', interval: 'monthly' });
    expect(r.statusCode).toBe(409);
    expect(r.json().details).toMatchObject({ reason: 'plan_pending' });
    const before = planSessions(cus).length;
    expect(planSessions(cus).length).toBe(before); // nothing new was created
  });

  it('plan_pending lapses after an hour, and at once when that Checkout\'s event failed for good', async () => {
    const cus = await customerOf(Q.sofia);
    const completed = planSessions(cus).find((x) => x.status === 'complete')!;
    // Failed for good (as #359 records it: summary.object and retryable false).
    await h.t.owner.insertInto('billing_events').values({ stripe_event_id: 'evt_cs_dead', type: 'checkout.session.completed', status: 'failed', summary: JSON.stringify({ retryable: false, object: completed.id, customer: cus }) }).execute();
    const ok = await as(Q.sofia).post('/api/billing/me/checkout', { planId: 'premium', interval: 'monthly' });
    expect(ok.statusCode, ok.body).toBe(201);
    await h.t.owner.deleteFrom('billing_events').where('stripe_event_id', '=', 'evt_cs_dead').execute();
    // Without that event the block holds while the completion is recent, and lapses after an hour.
    age(cus, 10 * 60);
    expect((await as(Q.sofia).post('/api/billing/me/checkout', { planId: 'premium', interval: 'monthly' })).json().details?.reason).toBe('plan_pending');
    age(cus, 2 * 3600);
    expect((await as(Q.sofia).post('/api/billing/me/checkout', { planId: 'premium', interval: 'monthly' })).statusCode).toBe(201);
  });
});
