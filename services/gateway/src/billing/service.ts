import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { BillingEventRow, BillingPlanState, BillingScope, BillingSubscription, BillingSummary, CheckoutRequest, CheckoutResponse, PlanEntitlements, PlanInterval, PortalResponse, SiteConfig, SitePlan, SubscriptionStatus } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize } from '../authz.js';
import { withTenant, type Db, type Tx } from '../db/index.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { actorOf, audit, type AuditActor } from '../platform/audit.js';
import { StripeApi, verifyWebhook, WebhookError, type StripeEvent, type StripeSubscription } from './stripe.js';

/*
 * Billing: plans come from the site configuration, money moves through Stripe
 * (TEST MODE ONLY in this version), and what we keep is the mapping from a
 * Stripe customer and subscription to an org (and, for individual plans, a
 * user) plus the entitlements that follow. Everything is recorded and shown;
 * nothing is enforced yet (see `assertLabStart`).
 *
 * Idempotency: every webhook delivery is keyed by its Stripe event id in
 * billing_events; a replay is acknowledged and ignored. Checkout and customer
 * creation send idempotency keys so a retried request never makes two objects.
 */

export interface BillingDeps {
  db: Db;
  site: SiteConfig;
  /** Absent when billing is off: summaries still answer with the default plan. */
  stripe?: StripeApi;
  webhookSecret?: string;
  /** Where the browser returns after Checkout or the portal (CT_WEB_URL). */
  webUrl: string;
  now?: () => Date;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

const ACTIVE: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due']);
const STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);

export interface WebhookOutcome {
  eventId: string;
  type: string;
  status: 'processed' | 'ignored' | 'duplicate' | 'failed';
}

export class BillingService {
  readonly enabled: boolean;
  private readonly now: () => Date;
  private readonly priceIds = new Map<string, string>();

  constructor(private readonly d: BillingDeps) {
    this.enabled = !!d.stripe;
    this.now = d.now ?? (() => new Date());
  }

  /* ------------------------------------------------------------ plans */

  get plans(): SitePlan[] {
    return this.d.site.plans?.items ?? [];
  }

  plan(id: string): SitePlan | undefined {
    return this.plans.find((p) => p.id === id);
  }

  /** The plan everyone has without a subscription: the free one. */
  defaultPlan(): SitePlan | undefined {
    return this.plans.find((p) => p.kind === 'free');
  }

  planByLookupKey(key: string | null | undefined): { plan: SitePlan; interval: PlanInterval } | undefined {
    if (!key) return undefined;
    for (const plan of this.plans) {
      for (const interval of ['monthly', 'yearly'] as const) if (plan.prices?.[interval]?.lookupKey === key) return { plan, interval };
    }
    return undefined;
  }

  private plansFor(scope: BillingScope): SitePlan[] {
    return this.plans.filter((p) => (scope === 'org' ? p.kind === 'organisation' : p.kind === 'individual'));
  }

  /* --------------------------------------------------------- summaries */

  private scopeUser(p: Principal, scope: BillingScope): string | null {
    if (scope === 'org') {
      authorize(p, 'billing.manage', { kind: 'org' });
      return null;
    }
    return p.sub;
  }

  private tx<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!p.orgId) throw new HttpError(409, 'Select an organization first.', { code: 'conflict' });
    return withTenant(this.d.db, { orgId: p.orgId, userId: p.sub }, fn);
  }

  async summary(p: Principal, scope: BillingScope): Promise<BillingSummary> {
    const userId = this.scopeUser(p, scope);
    const state = p.orgId
      ? await this.tx(p, async (tx) => {
          const ent = await tx.selectFrom('billing_entitlements').selectAll().where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
          const sub = await tx.selectFrom('billing_subscriptions').selectAll().where('org_id', '=', p.orgId).where(sql`coalesce(user_id, '')`, '=', userId ?? '').orderBy('updated_at', 'desc').executeTakeFirst();
          const cus = await tx.selectFrom('billing_customers').select('id').where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
          return { ent, sub, cus };
        })
      : { ent: undefined, sub: undefined, cus: undefined };
    const plan = state.ent ? this.planState(state.ent.plan_id, state.ent.entitlements as PlanEntitlements, state.ent.source, state.ent.updated_at) : this.defaultState();
    return {
      enabled: this.enabled,
      mode: this.enabled ? 'test' : 'off',
      scope,
      ...(plan ? { plan } : {}),
      ...(state.sub ? { subscription: toSubscription(state.sub) } : {}),
      portalAvailable: this.enabled && !!state.cus,
      plans: this.plansFor(scope),
      currency: this.d.site.plans?.currency ?? 'EUR',
      placeholder: !!(this.d.site.plans?.placeholder || this.plans.some((pl) => pl.placeholderPrices)),
      checkoutEnabled: this.enabled && !!this.d.site.flags.checkoutEnabled,
    };
  }

  private defaultState(): BillingPlanState | undefined {
    const free = this.defaultPlan();
    return free ? { planId: free.id, planName: free.name, kind: free.kind, entitlements: free.entitlements, source: 'default' } : undefined;
  }

  private planState(planId: string, entitlements: PlanEntitlements, source: BillingPlanState['source'], since: Date): BillingPlanState {
    const plan = this.plan(planId);
    return { planId, planName: plan?.name ?? planId, kind: plan?.kind ?? 'individual', entitlements, source, since: since.toISOString() };
  }

  async orgEvents(p: Principal): Promise<BillingEventRow[]> {
    authorize(p, 'billing.manage', { kind: 'org' });
    const rows = await this.tx(p, (tx) => tx.selectFrom('billing_events').selectAll().where('org_id', '=', p.orgId).orderBy('received_at', 'desc').limit(100).execute());
    return rows.map((r) => ({ id: r.id, type: r.type, receivedAt: r.received_at.toISOString(), ...(r.processed_at ? { processedAt: r.processed_at.toISOString() } : {}), status: r.status, summary: (r.summary as Record<string, unknown>) ?? {} }));
  }

  /* ---------------------------------------------------------- checkout */

  private stripe(): StripeApi {
    if (!this.d.stripe) throw new HttpError(409, 'Billing is not enabled on this deployment.', { code: 'conflict' });
    return this.d.stripe;
  }

  private returnPath(scope: BillingScope): string {
    return scope === 'org' ? '/admin/billing' : '/account/billing';
  }

  private async priceId(lookupKey: string): Promise<string> {
    const cached = this.priceIds.get(lookupKey);
    if (cached) return cached;
    const list = await this.stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = list.data[0];
    if (!price) throw new HttpError(409, `No Stripe price for lookup key ${lookupKey}; run stripe:sync.`, { code: 'conflict' });
    this.priceIds.set(lookupKey, price.id);
    return price.id;
  }

  private async customerFor(tx: Tx, p: Principal, userId: string | null): Promise<{ id: string; stripeCustomerId: string }> {
    const existing = await tx.selectFrom('billing_customers').select(['id', 'stripe_customer_id']).where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
    if (existing) return { id: existing.id, stripeCustomerId: existing.stripe_customer_id };
    const created = await this.stripe().customers.create(
      {
        ...(userId ? { email: p.email, name: p.name } : { name: p.orgName }),
        metadata: { ct_org_id: p.orgId, ct_user_id: userId ?? '', ct_scope: userId ? 'user' : 'org' },
      },
      `cus:${p.orgId}:${userId ?? 'org'}`,
    );
    const row = await tx
      .insertInto('billing_customers')
      .values({ org_id: p.orgId, user_id: userId, stripe_customer_id: created.id, email: userId ? p.email : null })
      .onConflict((oc) => oc.column('stripe_customer_id').doUpdateSet({ email: userId ? p.email : null }))
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, stripeCustomerId: created.id };
  }

  async checkout(p: Principal, scope: BillingScope, req: CheckoutRequest, ip?: string): Promise<CheckoutResponse> {
    this.stripe();
    if (!this.d.site.flags.checkoutEnabled) throw new HttpError(409, 'Self-service checkout is not open yet.', { code: 'conflict' });
    const userId = this.scopeUser(p, scope);
    const plan = this.plan(req.planId);
    if (!plan) throw notFound('Plan');
    if (plan.kind === 'free') throw badRequest('The free plan needs no checkout.');
    if ((scope === 'org') !== (plan.kind === 'organisation')) throw badRequest(scope === 'org' ? 'Organisation billing takes organisation plans.' : 'Personal billing takes individual plans.');
    if (req.interval !== 'monthly' && req.interval !== 'yearly') throw badRequest('interval must be monthly or yearly', { interval: 'monthly or yearly' });
    const price = plan.prices?.[req.interval];
    if (!price) throw badRequest(`${plan.name} has no ${req.interval} price.`, { interval: 'not offered' });
    let seats = 1;
    if (plan.perSeat) {
      seats = req.seats ?? plan.minSeats ?? 1;
      if (!Number.isInteger(seats) || seats < (plan.minSeats ?? 1) || seats > (plan.maxSeats ?? 100000)) throw badRequest(`seats must be between ${plan.minSeats ?? 1} and ${plan.maxSeats ?? 100000}`, { seats: 'out of range' });
    }
    const priceId = await this.priceId(price.lookupKey);
    return this.tx(p, async (tx) => {
      const customer = await this.customerFor(tx, p, userId);
      const metadata = { ct_org_id: p.orgId, ct_user_id: userId ?? '', ct_scope: scope, ct_plan_id: plan.id, ct_interval: req.interval };
      const back = `${this.d.webUrl}${this.returnPath(scope)}`;
      const session = await this.stripe().checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customer.stripeCustomerId,
          client_reference_id: `${p.orgId}:${userId ?? 'org'}`,
          line_items: [{ price: priceId, quantity: seats }],
          success_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${back}?checkout=cancelled`,
          metadata,
          subscription_data: { metadata },
          allow_promotion_codes: false,
        },
        `chk:${randomUUID()}`,
      );
      if (!session.url) throw new HttpError(502, 'Stripe returned no checkout URL');
      await audit(tx, actorOf(p, ip), 'billing.checkout', 'plan', plan.id, { scope, interval: req.interval, seats, checkoutSession: session.id, mode: 'test' }, plan.name);
      return { url: session.url, sessionId: session.id };
    });
  }

  async portal(p: Principal, scope: BillingScope, ip?: string): Promise<PortalResponse> {
    this.stripe();
    const userId = this.scopeUser(p, scope);
    return this.tx(p, async (tx) => {
      const cus = await tx.selectFrom('billing_customers').select('stripe_customer_id').where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
      if (!cus) throw conflict('No billing account yet: subscribe to a plan first.');
      const session = await this.stripe().billingPortal.sessions.create({ customer: cus.stripe_customer_id, return_url: `${this.d.webUrl}${this.returnPath(scope)}` });
      await audit(tx, actorOf(p, ip), 'billing.portal', 'customer', cus.stripe_customer_id, { scope });
      return { url: session.url };
    });
  }

  /* --------------------------------------------------------- enforcement */

  /**
   * Entitlement gate for starting a lab. TODO(billing-enforcement): compare the
   * caller's entitlements (lab hours this month, concurrent labs, the lab's
   * environment tier) with their usage and refuse with 429 `quota_exceeded`.
   * Until plans are final this records nothing and never refuses.
   */
  async assertLabStart(_p: Principal, _labId: string): Promise<void> {
    return;
  }

  /* ------------------------------------------------------------ webhook */

  /** Verifies, records (once) and applies a Stripe event. Returns what happened; never throws for a known-bad event body. */
  async webhook(rawBody: Buffer | string, signature: string | undefined): Promise<WebhookOutcome> {
    if (!this.d.webhookSecret) throw new HttpError(409, 'Billing is not enabled on this deployment.', { code: 'conflict' });
    let event: StripeEvent;
    try {
      event = verifyWebhook(rawBody, signature, this.d.webhookSecret, this.now().getTime());
    } catch (e) {
      if (e instanceof WebhookError) throw new HttpError(400, `Webhook rejected: ${e.message}`);
      throw e;
    }
    if (event.livemode) throw new HttpError(400, 'Webhook rejected: live-mode events are not accepted in test mode');
    return withTenant(this.d.db, { platform: true }, async (tx) => {
      const inserted = await tx.insertInto('billing_events').values({ stripe_event_id: event.id, type: event.type, org_id: null, user_id: null, livemode: event.livemode }).onConflict((oc) => oc.column('stripe_event_id').doNothing()).returning('id').executeTakeFirst();
      if (!inserted) return { eventId: event.id, type: event.type, status: 'duplicate' };
      try {
        const r = await this.apply(tx, event);
        await tx
          .updateTable('billing_events')
          .set({ status: r.status, processed_at: this.now(), org_id: r.orgId ?? null, user_id: r.userId ?? null, summary: JSON.stringify(r.summary) })
          .where('id', '=', inserted.id)
          .execute();
        if (r.orgId) await audit(tx, { orgId: r.orgId, actorId: null, actorName: 'Stripe' }, 'billing.webhook', 'event', event.id, { type: event.type, status: r.status, ...r.summary });
        return { eventId: event.id, type: event.type, status: r.status };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await tx.updateTable('billing_events').set({ status: 'failed', processed_at: this.now(), error: message.slice(0, 500) }).where('id', '=', inserted.id).execute();
        this.d.log?.warn({ eventId: event.id, type: event.type, err: message }, 'billing webhook failed');
        return { eventId: event.id, type: event.type, status: 'failed' };
      }
    });
  }

  private async apply(tx: Tx, event: StripeEvent): Promise<{ status: 'processed' | 'ignored'; orgId?: string; userId?: string | null; summary: Record<string, unknown> }> {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const subId = typeof obj.subscription === 'string' ? obj.subscription : undefined;
        const meta = (obj.metadata ?? {}) as Record<string, string>;
        if (!subId) return { status: 'ignored', ...(meta.ct_org_id ? { orgId: meta.ct_org_id } : {}), summary: { reason: 'no subscription on session', session: obj.id } };
        const sub = await this.stripe().subscriptions.retrieve(subId);
        const r = await this.upsertSubscription(tx, sub, meta);
        return { status: 'processed', orgId: r.orgId, userId: r.userId, summary: { session: obj.id, subscription: sub.id, plan: r.planId, status: sub.status, seats: r.seats } };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = obj as unknown as StripeSubscription;
        const r = await this.upsertSubscription(tx, sub, sub.metadata ?? {});
        return { status: 'processed', orgId: r.orgId, userId: r.userId, summary: { subscription: sub.id, plan: r.planId, status: sub.status, seats: r.seats, cancelAtPeriodEnd: sub.cancel_at_period_end } };
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const cus = typeof obj.customer === 'string' ? obj.customer : undefined;
        const scope = cus ? await tx.selectFrom('billing_customers').select(['org_id', 'user_id']).where('stripe_customer_id', '=', cus).executeTakeFirst() : undefined;
        return { status: 'processed', ...(scope ? { orgId: scope.org_id, userId: scope.user_id } : {}), summary: { invoice: obj.id, amountPaid: obj.amount_paid, amountDue: obj.amount_due, currency: obj.currency, customer: cus } };
      }
      default:
        return { status: 'ignored', summary: { reason: 'event type not handled' } };
    }
  }

  /** Writes the subscription's latest state and the entitlements that follow from it. */
  private async upsertSubscription(tx: Tx, sub: StripeSubscription, meta: Record<string, string>): Promise<{ orgId: string; userId: string | null; planId: string; seats: number }> {
    const item = sub.items?.data?.[0];
    const found = this.planByLookupKey(item?.price?.lookup_key) ?? (meta.ct_plan_id ? { plan: this.plan(meta.ct_plan_id), interval: (meta.ct_interval as PlanInterval) || 'monthly' } : undefined);
    if (!found?.plan) throw new Error(`subscription ${sub.id}: no plan for lookup key ${item?.price?.lookup_key ?? '(none)'}`);
    const plan = found.plan;
    // The org comes from the metadata we set at checkout, else from the customer we created.
    let orgId = meta.ct_org_id;
    let userId: string | null = meta.ct_user_id || null;
    let customerRow = await tx.selectFrom('billing_customers').select(['id', 'org_id', 'user_id']).where('stripe_customer_id', '=', sub.customer).executeTakeFirst();
    if (!customerRow) {
      if (!orgId) throw new Error(`subscription ${sub.id}: unknown customer ${sub.customer} and no ct_org_id metadata`);
      customerRow = await tx
        .insertInto('billing_customers')
        .values({ org_id: orgId, user_id: userId, stripe_customer_id: sub.customer, email: null })
        .onConflict((oc) => oc.columns(['org_id', 'scope_key']).doUpdateSet({ stripe_customer_id: sub.customer }))
        .returning(['id', 'org_id', 'user_id'])
        .executeTakeFirstOrThrow();
    }
    orgId = customerRow.org_id;
    userId = customerRow.user_id;
    const status: SubscriptionStatus = STATUSES.has(sub.status) ? (sub.status as SubscriptionStatus) : 'incomplete';
    const seats = Math.max(1, item?.quantity ?? 1);
    const periodEnd = sub.current_period_end ?? item?.current_period_end;
    const row = await tx
      .insertInto('billing_subscriptions')
      .values({
        org_id: orgId,
        user_id: userId,
        customer_id: customerRow.id,
        stripe_subscription_id: sub.id,
        plan_id: plan.id,
        price_lookup_key: item?.price?.lookup_key ?? null,
        billing_interval: found.interval,
        seats,
        status,
        current_period_end: periodEnd ? new Date(periodEnd * 1000) : null,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        livemode: false,
      })
      .onConflict((oc) =>
        oc.column('stripe_subscription_id').doUpdateSet({
          plan_id: plan.id,
          price_lookup_key: item?.price?.lookup_key ?? null,
          billing_interval: found.interval,
          seats,
          status,
          current_period_end: periodEnd ? new Date(periodEnd * 1000) : null,
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: this.now(),
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    const active = ACTIVE.has(status);
    const effective = active ? plan : this.defaultPlan();
    if (effective) {
      await tx
        .insertInto('billing_entitlements')
        .values({ org_id: orgId, user_id: userId, plan_id: effective.id, entitlements: JSON.stringify(effective.entitlements), source: active ? 'subscription' : 'default', subscription_id: active ? row.id : null })
        .onConflict((oc) => oc.columns(['org_id', 'scope_key']).doUpdateSet({ plan_id: effective.id, entitlements: JSON.stringify(effective.entitlements), source: active ? 'subscription' : 'default', subscription_id: active ? row.id : null, updated_at: this.now() }))
        .execute();
    }
    // Without a free plan to fall back to, a lapsed subscription keeps its last recorded entitlements (nothing is enforced yet).
    await audit(tx, { orgId, actorId: null, actorName: 'Stripe' } satisfies AuditActor, 'billing.subscription', 'subscription', sub.id, { plan: plan.id, status, seats, interval: found.interval, cancelAtPeriodEnd: !!sub.cancel_at_period_end, scope: userId ? 'user' : 'org' }, plan.name);
    return { orgId, userId, planId: plan.id, seats };
  }
}

function toSubscription(r: { id: string; plan_id: string; billing_interval: 'monthly' | 'yearly'; seats: number; status: string; current_period_end: Date | null; cancel_at_period_end: boolean; updated_at: Date }): BillingSubscription {
  return {
    id: r.id,
    planId: r.plan_id,
    interval: r.billing_interval,
    seats: r.seats,
    status: (STATUSES.has(r.status) ? r.status : 'incomplete') as SubscriptionStatus,
    ...(r.current_period_end ? { currentPeriodEnd: r.current_period_end.toISOString() } : {}),
    cancelAtPeriodEnd: r.cancel_at_period_end,
    updatedAt: r.updated_at.toISOString(),
  };
}
