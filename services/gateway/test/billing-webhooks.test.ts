import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { sql } from 'kysely';
import { BillingService, isRetryableBillingError, PermanentEventError, TransientEventError } from '../src/billing/service.js';
import { signWebhook, StripeApi, StripeError } from '../src/billing/stripe.js';
import { SessionService } from '../src/sessions/service.js';
import { loadSiteConfig } from '../src/site/config.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { FakeStripe } from './fake-stripe.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';
import { HeaderAuthenticator, Q, harness, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

/*
 * Webhook reliability (docs/billing.md): a failed event leaves no partial
 * writes and is answered 503 so Stripe redelivers it; the redelivery applies
 * it; concurrent events for one customer open one compute subscription; late
 * and out-of-order events never overwrite newer state; the reconciliation
 * repairs what webhooks missed. Against a throwaway Postgres and FakeStripe.
 */

const available = await pgAvailable();
const SECRET = 'whsec_test_0123456789abcdef';
const KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';

describe.skipIf(!available)('billing webhooks: failure, redelivery, concurrency, ordering, reconciliation', () => {
  let h: Harness;
  let stripe: FakeStripe;
  let billing: BillingService;
  let app: FastifyInstance;
  let n = 1;

  const as = (user: string) => ({ post: (url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: { 'x-test-user': user }, ...(payload !== undefined ? { payload: payload as object } : {}) }) });
  const body = (id: string, type: string, object: Record<string, unknown>) => JSON.stringify({ id, type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  /** Delivers an event (as Stripe does: the same id on every redelivery). */
  const deliver = (raw: string) => app.inject({ method: 'POST', url: '/api/billing/webhook', payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(raw, SECRET) } });
  const hook = async (type: string, object: Record<string, unknown>) => {
    const r = await deliver(body(`evt_w${n++}`, type, object));
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { status: string };
  };
  const customerOf = async (user: string) => {
    const r = await h.t.owner.selectFrom('billing_customers').selectAll().where('org_id', '=', h.orgs.quillmoor).where('scope_key', '=', user).executeTakeFirst();
    if (r) return r;
    expect((await as(user).post('/api/billing/me/payment-method')).statusCode).toBe(201);
    return h.t.owner.selectFrom('billing_customers').selectAll().where('org_id', '=', h.orgs.quillmoor).where('scope_key', '=', user).executeTakeFirstOrThrow();
  };
  const plan = async (user: string) => (await h.t.owner.selectFrom('billing_entitlements').select(['plan_id', 'source']).where('org_id', '=', h.orgs.quillmoor).where('scope_key', '=', user).executeTakeFirst()) ?? null;
  const proSub = (id: string, customer: string, user: string, over: Record<string, unknown> = {}) =>
    stripe.subscription(id, customer, 'ct_pro_monthly', { metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: user, ct_plan_id: 'pro', ct_interval: 'monthly' }, ...over });
  const computeSubs = (customer: string) => [...stripe.subscriptions.values()].filter((s) => s.customer === customer && (s.metadata as Record<string, string>).ct_kind === 'compute');
  const eventRow = (id: string) => h.t.owner.selectFrom('billing_events').selectAll().where('stripe_event_id', '=', id).executeTakeFirstOrThrow();

  beforeAll(async () => {
    h = await harness();
    stripe = new FakeStripe();
    const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    site.flags.checkoutEnabled = true;
    const content = await realContent();
    billing = new BillingService({ db: h.t.db, site, stripe: new StripeApi(KEY, stripe.fetch), webhookSecret: SECRET, webUrl: 'http://web.test', labs: content.labs, txBudgetMs: 2000 });
    const cluster = new FakeCluster();
    app = await buildApp({ content, auth: new HeaderAuthenticator(h.t), sessions: new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 }), cluster, platform: h.ps, hub: new TerminalHub(), billing, site: { config: site } });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await h?.close();
  });

  it('a failure mid-apply writes nothing, answers 503, and the redelivery applies the event once', async () => {
    const cus = (await customerOf(Q.mei)).stripe_customer_id;
    proSub('sub_fail', cus, Q.mei, { default_payment_method: 'pm_card_fail' });
    const raw = body('evt_fail_1', 'checkout.session.completed', { id: 'cs_fail', object: 'checkout.session', mode: 'subscription', subscription: 'sub_fail', customer: cus, metadata: { ct_org_id: h.orgs.quillmoor, ct_user_id: Q.mei } });
    // Stripe errors after the subscription and entitlements were written in this transaction.
    stripe.failRequests = { match: /^POST \/v1\/customers\/cus_/, count: 1, status: 500, message: 'Stripe is having a moment' };
    const first = await deliver(raw);
    expect(first.statusCode).toBe(503);
    expect(first.json().code).toBe('upstream');
    expect(await eventRow('evt_fail_1')).toMatchObject({ status: 'failed', error: 'Stripe is having a moment' });
    // The savepoint rolled the partial writes back.
    expect(await h.t.owner.selectFrom('billing_subscriptions').select('id').where('stripe_subscription_id', '=', 'sub_fail').executeTakeFirst()).toBeUndefined();
    expect(await plan(Q.mei)).toBeNull();
    expect(await h.t.owner.selectFrom('audit_log').select('id').where('action', '=', 'billing.subscription').where('target_id', '=', 'sub_fail').executeTakeFirst()).toBeUndefined();

    // Stripe redelivers the same event: it is applied, not counted as a duplicate.
    const again = await deliver(raw);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ eventId: 'evt_fail_1', status: 'processed' });
    expect(await eventRow('evt_fail_1')).toMatchObject({ status: 'processed', error: null });
    expect(await plan(Q.mei)).toEqual({ plan_id: 'pro', source: 'subscription' });
    expect(computeSubs(cus)).toHaveLength(1);
    // Only now is it a duplicate.
    expect((await deliver(raw)).json().status).toBe('duplicate');
    expect(computeSubs(cus)).toHaveLength(1);
  });

  it('an event no retry can apply is recorded failed and answered 200 (Stripe stops retrying)', async () => {
    stripe.subscription('sub_foreign', 'cus_foreign', 'ct_pro_monthly');
    const r = await deliver(body('evt_foreign', 'customer.subscription.updated', stripe.subscriptions.get('sub_foreign')!));
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('failed');
    expect((await eventRow('evt_foreign')).error).toMatch(/unknown customer/);
  });

  it('two concurrent webhooks for one customer open exactly one metered compute subscription', async () => {
    const cus = (await customerOf(Q.lucas)).stripe_customer_id;
    const si = stripe.setupIntent(cus);
    stripe.customers.get(cus)!.invoice_settings = { default_payment_method: si.payment_method };
    stripe.subscriptionCreateLatencyMs = 150;
    try {
      const [a, b] = await Promise.all([
        hook('checkout.session.completed', { id: 'cs_race', object: 'checkout.session', mode: 'setup', setup_intent: si.id, customer: cus, metadata: { ct_org_id: h.orgs.quillmoor, ct_kind: 'payment_method' } }),
        hook('customer.updated', { ...stripe.customers.get(cus)!, object: 'customer' }),
      ]);
      expect([a.status, b.status]).toEqual(['processed', 'processed']);
    } finally {
      stripe.subscriptionCreateLatencyMs = 0;
    }
    expect(computeSubs(cus)).toHaveLength(1);
    const row = await h.t.owner.selectFrom('billing_customers').select(['compute_subscription_id', 'has_payment_method']).where('stripe_customer_id', '=', cus).executeTakeFirstOrThrow();
    expect(row).toEqual({ compute_subscription_id: computeSubs(cus)[0]!.id, has_payment_method: true });
    // A compute subscription Stripe has but we lost (a commit that failed after Stripe created it) is adopted, not duplicated.
    await h.t.owner.updateTable('billing_customers').set({ compute_subscription_id: null }).where('stripe_customer_id', '=', cus).execute();
    await hook('customer.subscription.created', proSub('sub_lucas_pro', cus, Q.lucas));
    expect(computeSubs(cus)).toHaveLength(1);
    expect((await h.t.owner.selectFrom('billing_customers').select('compute_subscription_id').where('stripe_customer_id', '=', cus).executeTakeFirstOrThrow()).compute_subscription_id).toBe(computeSubs(cus)[0]!.id);
  });

  it('late, out-of-order subscription and invoice events never overwrite newer state', async () => {
    const cus = (await customerOf(Q.sofia)).stripe_customer_id;
    const sub = proSub('sub_order', cus, Q.sofia);
    const stale = structuredClone(sub);
    await hook('customer.subscription.created', sub);
    expect(await plan(Q.sofia)).toEqual({ plan_id: 'pro', source: 'subscription' });
    // Cancelled in Stripe; the deletion arrives, then a delayed "updated" from before it.
    sub.status = 'canceled';
    await hook('customer.subscription.deleted', structuredClone(sub));
    expect(await plan(Q.sofia)).toEqual({ plan_id: 'free', source: 'default' });
    expect((await hook('customer.subscription.updated', stale)).status).toBe('processed');
    expect(await plan(Q.sofia)).toEqual({ plan_id: 'free', source: 'default' });
    expect((await h.t.owner.selectFrom('billing_subscriptions').select('status').where('stripe_subscription_id', '=', 'sub_order').executeTakeFirstOrThrow()).status).toBe('canceled');

    // A stale past_due snapshot does not start dunning while Stripe says active.
    const again = proSub('sub_order_2', cus, Q.sofia);
    await hook('customer.subscription.created', again);
    await hook('customer.subscription.updated', { ...structuredClone(again), status: 'past_due' });
    const c = await h.t.owner.selectFrom('billing_customers').select(['delinquent_since']).where('stripe_customer_id', '=', cus).executeTakeFirstOrThrow();
    expect(c.delinquent_since).toBeNull();
    // A payment failure delivered after the invoice was paid is ignored.
    const inv = stripe.invoice(cus);
    const failedSnapshot = structuredClone(inv);
    inv.status = 'paid';
    await hook('invoice.paid', inv);
    expect((await hook('invoice.payment_failed', failedSnapshot)).status).toBe('ignored');
    expect(await h.t.owner.selectFrom('billing_customers').select(['invoice_failed_at', 'delinquent_since']).where('stripe_customer_id', '=', cus).executeTakeFirstOrThrow()).toEqual({ invoice_failed_at: null, delinquent_since: null });
  });

  it('reconciliation replays failed events and repairs subscriptions no webhook delivered, idempotently', async () => {
    // An event that failed and was never redelivered (Stripe gave up, or the endpoint was down).
    const kenji = (await customerOf(Q.kenji)).stripe_customer_id;
    proSub('sub_kenji', kenji, Q.kenji);
    const raw = body('evt_lost_1', 'checkout.session.completed', { id: 'cs_kenji', object: 'checkout.session', mode: 'subscription', subscription: 'sub_kenji', customer: kenji, metadata: { ct_org_id: h.orgs.quillmoor } });
    stripe.events.set('evt_lost_1', JSON.parse(raw) as Record<string, unknown>);
    stripe.failRequests = { match: /^GET \/v1\/subscriptions$/, count: 1, status: 503, message: 'Stripe is having a moment' };
    expect((await deliver(raw)).statusCode).toBe(503);
    expect(await plan(Q.kenji)).toBeNull();

    // A subscription whose events never arrived at all.
    const jonah = (await customerOf(Q.jonah)).stripe_customer_id;
    proSub('sub_jonah', jonah, Q.jonah);

    const r = await billing.reconcile();
    expect(r.replayed).toBeGreaterThanOrEqual(1);
    expect((await eventRow('evt_lost_1')).status).toBe('processed');
    expect(await plan(Q.kenji)).toEqual({ plan_id: 'pro', source: 'subscription' });
    expect(await plan(Q.jonah)).toEqual({ plan_id: 'pro', source: 'subscription' });
    expect(computeSubs(jonah)).toHaveLength(1);
    const audits = await h.t.owner.selectFrom('audit_log').select('target_id').where('action', '=', 'billing.reconcile').execute();
    expect(audits.map((a) => a.target_id)).toContain(jonah);

    // Nothing left to repair: a second run changes nothing and opens nothing.
    const subsBefore = stripe.subscriptions.size;
    const second = await billing.reconcile();
    expect(second.changed).toBe(0);
    expect(stripe.subscriptions.size).toBe(subsBefore);
  });
  it('a failure after apply (recording the outcome, the audit) rolls everything back and is retried, not a 500', async () => {
    const cus = (await customerOf(Q.amara)).stripe_customer_id;
    const sub = proSub('sub_tail', cus, Q.amara);
    // The audit of this one event fails with a serialization failure (transient).
    await sql`CREATE OR REPLACE FUNCTION ct_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id = 'evt_tail_1' THEN RAISE EXCEPTION 'audit is down' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`.execute(h.t.owner);
    await sql`CREATE TRIGGER ct_test_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ct_test_fail_audit()`.execute(h.t.owner);
    const raw = body('evt_tail_1', 'customer.subscription.created', sub);
    try {
      const r = await deliver(raw);
      expect(r.statusCode).toBe(503);
      expect(await eventRow('evt_tail_1')).toMatchObject({ status: 'failed', error: 'audit is down', summary: { retryable: true, object: 'sub_tail', customer: cus } });
      // apply() wrote the subscription and entitlements; the failure after it undid them.
      expect(await h.t.owner.selectFrom('billing_subscriptions').select('id').where('stripe_subscription_id', '=', 'sub_tail').executeTakeFirst()).toBeUndefined();
      expect(await plan(Q.amara)).toBeNull();
    } finally {
      await sql`DROP TRIGGER ct_test_fail_audit ON audit_log`.execute(h.t.owner);
      await sql`DROP FUNCTION ct_test_fail_audit()`.execute(h.t.owner);
    }
    expect((await deliver(raw)).json()).toMatchObject({ status: 'processed' });
    expect(await plan(Q.amara)).toEqual({ plan_id: 'pro', source: 'subscription' });
  });

  it('only transient errors are retried: Stripe 5xx/429/timeouts, Postgres connection, serialization and deadlock errors', async () => {
    const pg = (code: string) => Object.assign(new Error('pg'), { code });
    for (const e of [new StripeError(500, 'x'), new StripeError(503, 'x'), new StripeError(429, 'x'), new StripeError(0, 'x', 'timeout'), pg('40001'), pg('40P01'), pg('08006'), pg('57P01'), pg('57014'), pg('25P03'), pg('55P03'), pg('ECONNRESET'), new Error('Connection terminated unexpectedly'), new TransientEventError('x')]) expect(isRetryableBillingError(e), String((e as { code?: string }).code ?? e.message)).toBe(true);
    for (const e of [new StripeError(400, 'x'), new StripeError(402, 'x'), new StripeError(404, 'x'), new StripeError(409, 'x'), pg('23505'), pg('23514'), pg('42703'), new TypeError("Cannot read properties of undefined (reading 'id')"), new PermanentEventError('x'), 'boom']) expect(isRetryableBillingError(e), String((e as { code?: string })?.code ?? e)).toBe(false);

    // A permanent failure answers 200 and is never replayed; a Stripe 400 is permanent too.
    const cus = (await customerOf(Q.ines)).stripe_customer_id;
    stripe.failRequests = { match: /^GET \/v1\/subscriptions$/, count: 1, status: 400, message: 'Invalid request' };
    proSub('sub_bad', cus, Q.ines);
    const raw = body('evt_perm_1', 'customer.subscription.updated', stripe.subscriptions.get('sub_bad')!);
    stripe.events.set('evt_perm_1', JSON.parse(raw) as Record<string, unknown>);
    const r = await deliver(raw);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('failed');
    expect((await eventRow('evt_perm_1')).summary).toEqual({ retryable: false, object: 'sub_bad', customer: cus });
    const before = stripe.requests.filter((q) => q.url === '/v1/events/evt_perm_1').length;
    await billing.reconcile();
    expect(stripe.requests.filter((q) => q.url === '/v1/events/evt_perm_1').length).toBe(before);
    expect((await eventRow('evt_perm_1')).status).toBe('failed');
  });

  it('reconciliation never overwrites a webhook applied while it read Stripe (version check under the customer lock)', async () => {
    const cus = (await customerOf(Q.elena)).stripe_customer_id;
    const sub = proSub('sub_race', cus, Q.elena);
    await hook('customer.subscription.created', sub);
    expect(await plan(Q.elena)).toEqual({ plan_id: 'pro', source: 'subscription' });
    let run: Promise<unknown> | undefined;
    // Hold the customer's lock (a webhook in flight) while the reconciliation starts.
    await h.t.owner.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-customer:${cus}`}))`.execute(trx);
      run = billing.reconcile();
      for (let i = 0; i < 200; i++) {
        const waiting = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`.execute(h.t.owner);
        if (waiting.rows[0]!.n > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      // Meanwhile the subscription is cancelled in Stripe and the webhook applies it.
      sub.status = 'canceled';
      await trx.updateTable('billing_subscriptions').set({ status: 'canceled' }).where('stripe_subscription_id', '=', 'sub_race').execute();
      await trx.updateTable('billing_entitlements').set({ plan_id: 'free', source: 'default', subscription_id: null }).where('scope_key', '=', Q.elena).execute();
      await trx.updateTable('billing_customers').set({ updated_at: sql`clock_timestamp()` }).where('stripe_customer_id', '=', cus).execute(); // as every applied event does
    });
    await run;
    expect((await h.t.owner.selectFrom('billing_subscriptions').select('status').where('stripe_subscription_id', '=', 'sub_race').executeTakeFirstOrThrow()).status).toBe('canceled');
    expect(await plan(Q.elena)).toEqual({ plan_id: 'free', source: 'default' });
  });

  it('only one reconciliation runs at a time across replicas', async () => {
    const [a, b] = await Promise.all([billing.reconcile(), billing.reconcile()]);
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
  });

  it('a compute subscription event for a customer not recorded yet is retried, not dropped', async () => {
    stripe.subscription('sub_early', 'cus_notyet', 'ct_compute_unit', { metadata: { ct_kind: 'compute' } });
    const r = await deliver(body('evt_early', 'customer.subscription.created', stripe.subscriptions.get('sub_early')!));
    expect(r.statusCode).toBe(503);
    expect((await eventRow('evt_early')).summary).toMatchObject({ retryable: true, object: 'sub_early' });
  });

  it('customer.updated applies Stripe\'s current customer, not a stale snapshot', async () => {
    const cus = await customerOf(Q.jonah);
    const id = cus.stripe_customer_id;
    stripe.customers.get(id)!.invoice_settings = { default_payment_method: 'pm_current' };
    await h.t.owner.updateTable('billing_customers').set({ has_payment_method: true }).where('stripe_customer_id', '=', id).execute();
    // A late event from before the card was added says "no payment method".
    expect((await hook('customer.updated', { id, object: 'customer', invoice_settings: { default_payment_method: null } })).status).toBe('processed');
    expect((await h.t.owner.selectFrom('billing_customers').select('has_payment_method').where('stripe_customer_id', '=', id).executeTakeFirstOrThrow()).has_payment_method).toBe(true);
  });

  it('a "not recorded yet" failure is retried for an hour after the event, then permanent (and not replayed)', async () => {
    stripe.subscription('sub_orphan', 'cus_never', 'ct_compute_unit', { metadata: { ct_kind: 'compute' } });
    const old = JSON.stringify({ id: 'evt_orphan_old', type: 'customer.subscription.created', livemode: false, created: Math.floor(Date.now() / 1000) - 2 * 3600, data: { object: stripe.subscriptions.get('sub_orphan')! } });
    stripe.events.set('evt_orphan_old', JSON.parse(old) as Record<string, unknown>);
    const r = await deliver(old);
    expect(r.statusCode).toBe(200);
    expect(await eventRow('evt_orphan_old')).toMatchObject({ status: 'failed', summary: { retryable: false } });
    const before = stripe.requests.filter((q) => q.url === '/v1/events/evt_orphan_old').length;
    await billing.reconcile();
    expect(stripe.requests.filter((q) => q.url === '/v1/events/evt_orphan_old').length).toBe(before); // out of the replay window
  });

  it('a transaction has a time budget: an event that cannot get the customer lock in time is retried (503), not left hanging', async () => {
    const cus = (await customerOf(Q.kenji)).stripe_customer_id;
    await h.t.owner.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-customer:${cus}`}))`.execute(trx);
      const t0 = Date.now();
      const r = await deliver(body('evt_budget_1', 'customer.updated', { ...stripe.customers.get(cus)!, object: 'customer' }));
      expect(r.statusCode).toBe(503);
      expect(Date.now() - t0).toBeLessThan(10_000); // lock_timeout is half the 2 s budget
    });
    expect(await eventRow('evt_budget_1')).toMatchObject({ status: 'failed', summary: { retryable: true } });
    expect((await deliver(body('evt_budget_1', 'customer.updated', { ...stripe.customers.get(cus)!, object: 'customer' }))).json().status).toBe('processed');
  });

  it('the customer lock survives a failed apply: still held when the failure is recorded', async () => {
    const cus = (await customerOf(Q.ines)).stripe_customer_id;
    proSub('sub_lockheld', cus, Q.ines, { default_payment_method: 'pm_card_lockheld' });
    // When the failure record is written (after ROLLBACK TO the apply savepoint), count the
    // advisory locks this backend still holds.
    await sql`CREATE TABLE IF NOT EXISTS ct_test_lock_probe (n int)`.execute(h.t.owner);
    await sql`CREATE OR REPLACE FUNCTION ct_test_probe_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF NEW.stripe_event_id = 'evt_lockheld' AND NEW.status = 'failed' THEN INSERT INTO ct_test_lock_probe SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted; END IF; RETURN NEW; END $$`.execute(h.t.owner);
    await sql`CREATE TRIGGER ct_test_probe_lock BEFORE UPDATE ON billing_events FOR EACH ROW EXECUTE FUNCTION ct_test_probe_lock()`.execute(h.t.owner);
    stripe.failRequests = { match: /^POST \/v1\/customers\/cus_/, count: 1, status: 500, message: 'Stripe is having a moment' };
    try {
      const r = await deliver(body('evt_lockheld', 'checkout.session.completed', { id: 'cs_lockheld', object: 'checkout.session', mode: 'subscription', subscription: 'sub_lockheld', customer: cus, metadata: { ct_org_id: h.orgs.quillmoor } }));
      expect(r.statusCode).toBe(503);
      const probe = await sql<{ n: number }>`SELECT n FROM ct_test_lock_probe`.execute(h.t.owner);
      expect(probe.rows.map((x) => x.n)).toEqual([1]);
    } finally {
      await sql`DROP TRIGGER IF EXISTS ct_test_probe_lock ON billing_events`.execute(h.t.owner);
      await sql`DROP FUNCTION IF EXISTS ct_test_probe_lock()`.execute(h.t.owner);
      await sql`DROP TABLE IF EXISTS ct_test_lock_probe`.execute(h.t.owner);
    }
  });
});
