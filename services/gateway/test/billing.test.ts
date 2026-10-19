import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { BillingService } from '../src/billing/service.js';
import { signWebhook, StripeApi, type FetchLike } from '../src/billing/stripe.js';
import { syncPlans } from '../src/billing/sync.js';
import { withTenant } from '../src/db/index.js';
import * as m0007 from '../src/db/migrations/0007_billing.js';
import { HeaderAuthenticator, Q, harness, type Harness } from './harness.js';
import { loadSiteConfig } from '../src/site/config.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';
import { pgAvailable } from './pg.js';
import { SessionService } from '../src/sessions/service.js';
import { TerminalHub } from '../src/terminal/hub.js';

/*
 * Billing against a throwaway Postgres and a fake Stripe (an in-memory fetch
 * that answers the handful of endpoints the service uses). Never talks to Stripe.
 */

const available = await pgAvailable();
const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';

/** The slice of Stripe the service touches: customers, prices by lookup key, checkout and portal sessions, subscriptions. */
class FakeStripe {
  customers = new Map<string, Record<string, unknown>>();
  subscriptions = new Map<string, Record<string, unknown>>();
  prices = new Map<string, Record<string, unknown>>();
  products = new Map<string, Record<string, unknown>>();
  checkouts: Record<string, string>[] = [];
  portals: Record<string, string>[] = [];
  idempotency = new Map<string, unknown>();
  requests: { method: string; url: string; body: Record<string, string> }[] = [];
  private n = 1;

  constructor() {
    this.prices.set('price_pro_m', { id: 'price_pro_m', product: 'prod_pro', active: true, currency: 'eur', unit_amount: 2900, lookup_key: 'ct_pro_monthly', recurring: { interval: 'month', interval_count: 1 }, metadata: {} });
    this.prices.set('price_team_y', { id: 'price_team_y', product: 'prod_team', active: true, currency: 'eur', unit_amount: 19000, lookup_key: 'ct_team_seat_yearly', recurring: { interval: 'year', interval_count: 1 }, metadata: {} });
  }

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = Object.fromEntries(new URLSearchParams(init.body ?? ''));
    this.requests.push({ method: init.method, url: u.pathname + u.search, body });
    const idem = init.headers['idempotency-key'];
    if (idem && this.idempotency.has(idem)) return ok(this.idempotency.get(idem));
    const remember = (v: unknown) => (idem && this.idempotency.set(idem, v), ok(v));
    const id = (p: string) => `${p}_${this.n++}`;
    if (init.method === 'POST' && u.pathname === '/v1/customers') {
      const c = { id: id('cus'), email: body.email ?? null, metadata: meta(body) };
      this.customers.set(c.id, c);
      return remember(c);
    }
    if (init.method === 'GET' && u.pathname === '/v1/prices') {
      const keys = [...u.searchParams.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v);
      return ok({ object: 'list', data: [...this.prices.values()].filter((p) => (keys.length ? keys.includes(p.lookup_key as string) : true)), has_more: false });
    }
    if (init.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      this.checkouts.push(body);
      const s = { id: id('cs'), url: `https://checkout.stripe.test/${this.n}`, customer: body.customer, subscription: null, client_reference_id: body.client_reference_id, metadata: meta(body), mode: body.mode };
      return remember(s);
    }
    if (init.method === 'POST' && u.pathname === '/v1/billing_portal/sessions') {
      this.portals.push(body);
      return ok({ id: id('bps'), url: `https://portal.stripe.test/${this.n}` });
    }
    if (init.method === 'GET' && u.pathname.startsWith('/v1/subscriptions/')) {
      const s = this.subscriptions.get(decodeURIComponent(u.pathname.split('/').pop()!));
      return s ? ok(s) : err(404, 'No such subscription');
    }
    if (init.method === 'GET' && u.pathname === '/v1/products/search') {
      const q = /ct_plan_id'\]:'([a-z0-9-]+)'/.exec(u.searchParams.get('query') ?? '')?.[1];
      return ok({ object: 'list', data: [...this.products.values()].filter((p) => (p.metadata as Record<string, string>).ct_plan_id === q), has_more: false });
    }
    if (init.method === 'POST' && u.pathname === '/v1/products') {
      const p = { id: id('prod'), name: body.name, description: body.description ?? null, active: true, metadata: meta(body) };
      this.products.set(p.id, p);
      return remember(p);
    }
    if (init.method === 'GET' && u.pathname.startsWith('/v1/products/')) {
      const p = this.products.get(u.pathname.split('/').pop()!);
      return p ? ok(p) : err(404, 'No such product');
    }
    if (init.method === 'POST' && u.pathname.startsWith('/v1/products/')) {
      const p = this.products.get(u.pathname.split('/').pop()!)!;
      Object.assign(p, { name: body.name ?? p.name, description: body.description ?? p.description, active: body.active === undefined ? p.active : body.active === 'true' });
      return ok(p);
    }
    if (init.method === 'POST' && u.pathname === '/v1/prices') {
      if (body.transfer_lookup_key === 'true') for (const p of this.prices.values()) if (p.lookup_key === body.lookup_key) p.lookup_key = null;
      const p = { id: id('price'), product: body.product, active: true, currency: body.currency, unit_amount: Number(body.unit_amount), lookup_key: body.lookup_key, recurring: { interval: body['recurring[interval]'], interval_count: 1 }, metadata: meta(body) };
      this.prices.set(p.id, p);
      return remember(p);
    }
    if (init.method === 'POST' && u.pathname.startsWith('/v1/prices/')) {
      const p = this.prices.get(u.pathname.split('/').pop()!)!;
      if (body.active !== undefined) p.active = body.active === 'true';
      return ok(p);
    }
    return err(404, `unhandled ${init.method} ${u.pathname}`);
  };

  /** A subscription object as Stripe would send it in an event. */
  subscription(id: string, customer: string, lookupKey: string, over: Record<string, unknown> = {}) {
    const price = [...this.prices.values()].find((p) => p.lookup_key === lookupKey)!;
    const s = { id, object: 'subscription', customer, status: 'active', cancel_at_period_end: false, current_period_end: 1_900_000_000, metadata: {}, items: { object: 'list', data: [{ id: 'si_1', quantity: 1, price }], has_more: false }, ...over };
    this.subscriptions.set(id, s);
    return s;
  }
}
const meta = (body: Record<string, string>) => Object.fromEntries(Object.entries(body).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
const ok = (v: unknown) => ({ status: 200, json: async () => v, text: async () => JSON.stringify(v) });
const err = (status: number, message: string) => ({ status, json: async () => ({ error: { message } }), text: async () => message });

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
    expect(me.plans.map((p: { id: string }) => p.id)).toEqual(['pro']);
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
    const api = new StripeApi(KEY, fresh.fetch);
    const first = await syncPlans(api, site);
    expect(first.filter((a) => a.action === 'product.create')).toHaveLength(2);
    expect(first.filter((a) => a.action === 'price.create')).toHaveLength(4);
    expect(first.some((a) => a.action === 'skip.free' && a.plan === 'free')).toBe(true);
    const second = await syncPlans(api, site);
    expect(second.filter((a) => a.action.endsWith('.ok'))).toHaveLength(6);
    expect(second.some((a) => a.action.endsWith('.create'))).toBe(false);
    // A changed amount replaces the price and moves the lookup key.
    site.plans!.items.find((p) => p.id === 'pro')!.prices!.monthly!.amount = 3900;
    const third = await syncPlans(api, site);
    const replaced = third.find((a) => a.action === 'price.replace');
    expect(replaced).toMatchObject({ plan: 'pro', interval: 'monthly' });
    const active = [...fresh.prices.values()].filter((p) => p.lookup_key === 'ct_pro_monthly' && p.active);
    expect(active).toHaveLength(1);
    expect(active[0]!.unit_amount).toBe(3900);
    const dry = await syncPlans(api, { ...site, plans: { ...site.plans!, items: site.plans!.items.map((p) => (p.id === 'pro' ? { ...p, prices: { ...p.prices!, monthly: { ...p.prices!.monthly!, amount: 4900 } } } : p)) } }, { dryRun: true });
    expect(dry.find((a) => a.action === 'price.replace')?.detail).toMatch(/dry run/);
    expect([...fresh.prices.values()].filter((p) => p.unit_amount === 4900)).toHaveLength(0);
  });
});
