import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { BillingService } from '../src/billing/service.js';
import { signWebhook, StripeApi } from '../src/billing/stripe.js';
import { syncPlans } from '../src/billing/sync.js';
import { withTenant } from '../src/db/index.js';
import * as m0007 from '../src/db/migrations/0007_billing.js';
import { HeaderAuthenticator, Q, harness, type Harness } from './harness.js';
import { loadSiteConfig } from '../src/site/config.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';
import { pgAvailable } from './pg.js';
import { SessionService } from '../src/sessions/service.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { FakeStripe } from './fake-stripe.js';

/*
 * Billing against a throwaway Postgres and a fake Stripe (an in-memory fetch
 * that answers the handful of endpoints the service uses). Never talks to Stripe.
 */

const available = await pgAvailable();
const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';

const event = (id: string, type: string, object: Record<string, unknown>) => JSON.stringify({ id, type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });

describe.skipIf(!available)('billing (migration 0007, /api/billing/*, Stripe test mode)', () => {
  let h: Harness;
  let stripe: FakeStripe;
  let billing: BillingService;
  let app: FastifyInstance;
  const as = (user: string, org?: string) => {
    const headers = { 'x-test-user': user, ...(org ? { 'x-test-org': org } : {}) };
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload?: unknown, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url, headers: { ...headers, ...extra }, ...(payload !== undefined ? { payload: payload as object } : {}) }),
    };
  };

  beforeAll(async () => {
    h = await harness();
    stripe = new FakeStripe();
    const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    site.flags.checkoutEnabled = true;
    billing = new BillingService({ db: h.t.db, site, stripe: new StripeApi(KEY, stripe.fetch), webhookSecret: SECRET, webUrl: 'http://web.test' });
    const content = await realContent();
    const cluster = new FakeCluster();
    app = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing, site: { config: site } });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('migration 0007 is additive and idempotent with RLS on every billing table', async () => {
    await m0007.up(h.t.owner as unknown as Kysely<unknown>, 'cloudtrain_app');
    for (const t of m0007.BILLING_TENANT_TABLES) {
      const rls = await sql<{ relrowsecurity: boolean }>`SELECT relrowsecurity FROM pg_class WHERE relname = ${t}`.execute(h.t.owner);
      expect(rls.rows[0]?.relrowsecurity, t).toBe(true);
      const policies = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = ${t}`.execute(h.t.owner);
      expect(policies.rows[0]!.n, t).toBe(1);
    }
    // Nothing payment-like is a column anywhere: only Stripe ids.
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'billing_%'`.execute(h.t.owner);
    expect(cols.rows.map((c) => c.column_name).join(' ')).not.toMatch(/card|pan|cvc|iban/);
  });

  it('answers the default (free) plan before any subscription, for a user and for the org', async () => {
    const me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me).toMatchObject({ enabled: true, mode: 'test', scope: 'user', portalAvailable: false, checkoutEnabled: true, placeholder: true, currency: 'EUR' });
    expect(me.plan).toMatchObject({ planId: 'free', source: 'default', entitlements: { concurrentLabs: 1 } });
    expect(me.plans.map((p: { id: string }) => p.id)).toEqual(['pro', 'premium']);
    expect((await as(Q.mei).get('/api/billing/org')).statusCode).toBe(403);
    const org = (await as(Q.priya).get('/api/billing/org')).json();
    expect(org.scope).toBe('org');
    expect(org.plans.map((p: { id: string }) => p.id)).toEqual(['team']);
  });

  it('creates a Checkout Session in subscription mode with the org and user in the metadata, and audits it', async () => {
    const r = await as(Q.mei).post('/api/billing/me/checkout', { planId: 'pro', interval: 'monthly' });
    expect(r.statusCode).toBe(201);
    expect(r.json().url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const s = stripe.checkouts.at(-1)!;
    expect(s.mode).toBe('subscription');
    expect(s['line_items[0][price]']).toBe('price_pro_m');
    expect(s['line_items[0][quantity]']).toBe('1');
    expect(s['metadata[ct_org_id]']).toBe(h.orgs.quillmoor);
    expect(s['metadata[ct_user_id]']).toBe(Q.mei);
    expect(s['subscription_data[metadata][ct_plan_id]']).toBe('pro');
    expect(s.success_url).toMatch(/^http:\/\/web\.test\/account\/billing\?checkout=success/);
    // One Stripe customer per (org, user); a second checkout reuses it.
    const customers = await h.t.owner.selectFrom('billing_customers').selectAll().where('user_id', '=', Q.mei).execute();
    expect(customers).toHaveLength(1);
    await as(Q.mei).post('/api/billing/me/checkout', { planId: 'pro', interval: 'monthly' });
    expect(await h.t.owner.selectFrom('billing_customers').selectAll().where('user_id', '=', Q.mei).execute()).toHaveLength(1);
    const audit = await h.t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'billing.checkout').where('actor_id', '=', Q.mei).execute();
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]!.details).toMatchObject({ scope: 'user', interval: 'monthly', mode: 'test' });
  });

  it('validates checkout requests: plan kind per scope, interval, seats', async () => {
    expect((await as(Q.mei).post('/api/billing/me/checkout', { planId: 'team', interval: 'monthly' })).statusCode).toBe(422);
    expect((await as(Q.mei).post('/api/billing/me/checkout', { planId: 'free', interval: 'monthly' })).statusCode).toBe(422);
    expect((await as(Q.mei).post('/api/billing/me/checkout', { planId: 'pro', interval: 'weekly' })).statusCode).toBe(422);
    expect((await as(Q.mei).post('/api/billing/me/checkout', { planId: 'nope', interval: 'monthly' })).statusCode).toBe(404);
    expect((await as(Q.priya).post('/api/billing/org/checkout', { planId: 'team', interval: 'yearly', seats: 2 })).statusCode).toBe(422);
    expect((await as(Q.mei).post('/api/billing/org/checkout', { planId: 'team', interval: 'yearly', seats: 10 })).statusCode).toBe(403);
    const ok = await as(Q.priya).post('/api/billing/org/checkout', { planId: 'team', interval: 'yearly', seats: 12 });
    expect(ok.statusCode).toBe(201);
    expect(stripe.checkouts.at(-1)!['line_items[0][quantity]']).toBe('12');
    expect(stripe.checkouts.at(-1)!['metadata[ct_user_id]']).toBe('');
  });

  it('applies a checkout.session.completed webhook once: subscription and entitlements, replay ignored', async () => {
    const cus = (await h.t.owner.selectFrom('billing_customers').select('stripe_customer_id').where('user_id', '=', Q.mei).executeTakeFirstOrThrow()).stripe_customer_id;
    stripe.subscription('sub_mei_1', cus, 'ct_pro_monthly', { metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: Q.mei, ct_scope: 'user', ct_plan_id: 'pro', ct_interval: 'monthly' } });
    const body = event('evt_1', 'checkout.session.completed', { id: 'cs_1', object: 'checkout.session', subscription: 'sub_mei_1', customer: cus, metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: Q.mei, ct_scope: 'user', ct_plan_id: 'pro', ct_interval: 'monthly' } });
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, SECRET) } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ received: true, eventId: 'evt_1', status: 'processed' });
    const me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me.plan).toMatchObject({ planId: 'pro', planName: 'Pro', source: 'subscription', entitlements: { concurrentLabs: 2, ctfEvents: true } });
    expect(me.subscription).toMatchObject({ planId: 'pro', interval: 'monthly', seats: 1, status: 'active', cancelAtPeriodEnd: false });
    expect(me.portalAvailable).toBe(true);
    // Replay: acknowledged, not applied twice.
    const again = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, SECRET) } });
    expect(again.json()).toMatchObject({ status: 'duplicate' });
    expect(await h.t.owner.selectFrom('billing_events').selectAll().where('stripe_event_id', '=', 'evt_1').execute()).toHaveLength(1);
    // Other people and the org itself are untouched.
    expect((await as(Q.lucas).get('/api/billing/me')).json().plan.planId).toBe('free');
    expect((await as(Q.priya).get('/api/billing/org')).json().plan.planId).toBe('free');
  });

  it('rejects a bad signature, a stale timestamp and live-mode events', async () => {
    const body = event('evt_bad', 'customer.subscription.updated', { id: 'sub_x', object: 'subscription' });
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, 'whsec_other') } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, SECRET, Math.floor(Date.now() / 1000) - 3600) } })).statusCode).toBe(400);
    const live = body.replace('"livemode":false', '"livemode":true');
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: live, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(live, SECRET) } })).statusCode).toBe(400);
    expect(await h.t.owner.selectFrom('billing_events').selectAll().where('stripe_event_id', '=', 'evt_bad').execute()).toHaveLength(0);
  });

  it('cancellation falls back to the default plan; an unknown event type is recorded as ignored', async () => {
    const cus = (await h.t.owner.selectFrom('billing_customers').select('stripe_customer_id').where('user_id', '=', Q.mei).executeTakeFirstOrThrow()).stripe_customer_id;
    const sub = stripe.subscription('sub_mei_1', cus, 'ct_pro_monthly', { status: 'canceled', cancel_at_period_end: false });
    const body = event('evt_2', 'customer.subscription.deleted', sub);
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(body, SECRET) } });
    expect(r.json().status).toBe('processed');
    const me = (await as(Q.mei).get('/api/billing/me')).json();
    expect(me.plan).toMatchObject({ planId: 'free', source: 'default' });
    expect(me.subscription).toMatchObject({ status: 'canceled' });
    const other = event('evt_3', 'payment_method.attached', { id: 'pm_1', object: 'payment_method' });
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: other, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(other, SECRET) } })).json().status).toBe('ignored');
    const rows = await h.t.owner.selectFrom('billing_events').select(['stripe_event_id', 'status']).orderBy('received_at').execute();
    expect(rows.map((x) => [x.stripe_event_id, x.status])).toEqual([
      ['evt_1', 'processed'],
      ['evt_2', 'processed'],
      ['evt_3', 'ignored'],
    ]);
  });

  it('opens the customer portal for an existing customer only, and lists the org events for billing.manage', async () => {
    const portal = await as(Q.mei).post('/api/billing/me/portal');
    expect(portal.statusCode).toBe(200);
    expect(portal.json().url).toMatch(/^https:\/\/portal\.stripe\.test\//);
    expect(stripe.portals.at(-1)!.return_url).toBe('http://web.test/account/billing');
    expect((await as(Q.lucas).post('/api/billing/me/portal')).statusCode).toBe(409);
    const events = (await as(Q.priya).get('/api/billing/org/events')).json().events;
    expect(events.map((e: { type: string }) => e.type)).toContain('customer.subscription.deleted');
    expect((await as(Q.mei).get('/api/billing/org/events')).statusCode).toBe(403);
  });

  it('keeps billing rows inside the org (RLS)', async () => {
    const other = await withTenant(h.t.db, { orgId: h.orgs.acme }, (tx) => tx.selectFrom('billing_subscriptions').selectAll().execute());
    expect(other).toEqual([]);
    await expect(withTenant(h.t.db, { orgId: h.orgs.acme }, (tx) => tx.insertInto('billing_entitlements').values({ org_id: h.orgs.quillmoor, user_id: null, plan_id: 'team', entitlements: '{}', source: 'manual', subscription_id: null }).execute())).rejects.toThrow(/row-level security/);
  });

  it('answers with billing off: default plan, 409 on checkout and portal, no webhook route', async () => {
    const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    const off = new BillingService({ db: h.t.db, site, webUrl: 'http://web.test' });
    const content = await realContent();
    const cluster = new FakeCluster();
    const app2 = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing: off });
    try {
      const me = (await app2.inject({ url: '/api/billing/me', headers: { 'x-test-user': Q.lucas } })).json();
      expect(me).toMatchObject({ enabled: false, mode: 'off', checkoutEnabled: false, portalAvailable: false });
      expect(me.plan.planId).toBe('free');
      expect((await app2.inject({ method: 'POST', url: '/api/billing/me/checkout', headers: { 'x-test-user': Q.lucas }, payload: { planId: 'pro', interval: 'monthly' } })).statusCode).toBe(409);
      expect((await app2.inject({ method: 'POST', url: '/api/billing/me/portal', headers: { 'x-test-user': Q.lucas } })).statusCode).toBe(409);
      expect((await app2.inject({ method: 'POST', url: '/api/billing/webhook', payload: '{}' })).statusCode).toBe(404);
    } finally {
      await app2.close();
    }
  });

  it('stripe:sync creates products and prices by lookup key and is idempotent', async () => {
    const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    const fresh = new FakeStripe();
    fresh.prices.clear();
    fresh.meters.clear();
    const api = new StripeApi(KEY, fresh.fetch);
    const first = await syncPlans(api, site);
    // Pro, Premium, Team and the Compute product; two prices each plus the metered compute price; one meter.
    expect(first.filter((a) => a.action === 'product.create')).toHaveLength(4);
    expect(first.filter((a) => a.action === 'price.create')).toHaveLength(7);
    expect(first.filter((a) => a.action === 'meter.create')).toHaveLength(1);
    expect(first.some((a) => a.action === 'skip.free' && a.plan === 'free')).toBe(true);
    const meter = [...fresh.meters.values()][0]!;
    expect(meter).toMatchObject({ event_name: 'ct_compute_units', default_aggregation: { formula: 'sum' }, customer_mapping: { event_payload_key: 'stripe_customer_id' }, value_settings: { event_payload_key: 'value' } });
    const metered = [...fresh.prices.values()].find((p) => p.lookup_key === 'ct_compute_unit')!;
    expect(metered).toMatchObject({ unit_amount_decimal: '0.5', currency: 'eur', recurring: { interval: 'month', usage_type: 'metered', meter: meter.id } });
    const second = await syncPlans(api, site);
    expect(second.filter((a) => a.action.endsWith('.ok'))).toHaveLength(12);
    expect(second.some((a) => a.action.endsWith('.create'))).toBe(false);
    // A changed amount replaces the price and moves the lookup key.
    site.plans!.items.find((p) => p.id === 'pro')!.prices!.monthly!.amount = 3900;
    site.plans!.compute!.unitPrice = '0.75';
    const third = await syncPlans(api, site);
    const replaced = third.find((a) => a.action === 'price.replace' && a.plan === 'pro');
    expect(replaced).toMatchObject({ plan: 'pro', interval: 'monthly' });
    const active = [...fresh.prices.values()].filter((p) => p.lookup_key === 'ct_pro_monthly' && p.active);
    expect(active).toHaveLength(1);
    expect(active[0]!.unit_amount).toBe(3900);
    expect(third.find((a) => a.plan === 'compute' && a.action === 'price.replace')).toBeTruthy();
    expect([...fresh.prices.values()].filter((p) => p.lookup_key === 'ct_compute_unit' && p.active).map((p) => p.unit_amount_decimal)).toEqual(['0.75']);
    const dry = await syncPlans(api, { ...site, plans: { ...site.plans!, items: site.plans!.items.map((p) => (p.id === 'pro' ? { ...p, prices: { ...p.prices!, monthly: { ...p.prices!.monthly!, amount: 4900 } } } : p)) } }, { dryRun: true });
    expect(dry.find((a) => a.action === 'price.replace')?.detail).toMatch(/dry run/);
    expect([...fresh.prices.values()].filter((p) => p.unit_amount === 4900)).toHaveLength(0);
  });
});
