import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type {
  BillingBlockDetails,
  BillingBlockReason,
  BillingComputeRates,
  BillingDunning,
  BillingEventRow,
  BillingLimit,
  BillingLimitRequest,
  BillingPlanState,
  BillingScope,
  BillingSeats,
  BillingSubscription,
  BillingSummary,
  BillingTrial,
  BillingUsage,
  BillingUsageRow,
  CheckoutRequest,
  CheckoutResponse,
  ComputeTier,
  LabAccess,
  LabSummary,
  PlanEntitlements,
  PlanInterval,
  PortalResponse,
  SiteConfig,
  SitePlan,
  SubscriptionStatus,
  UsageReportState,
} from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, can } from '../authz.js';
import type { ContentLab } from '../content/load.js';
import { withTenant, type Db, type Tx } from '../db/index.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import type { Mail, Mailer } from '../mail.js';
import { actorOf, audit, type AuditActor } from '../platform/audit.js';
import { computeTierOf, monthOf, PricingModel, type LabFacts } from './compute.js';
import { StripeApi, StripeError, verifyWebhook, WebhookError, type StripeCustomer, type StripeEvent, type StripeInvoice, type StripeSetupIntent, type StripeSubscription } from './stripe.js';

/*
 * Billing: plans come from the site configuration, money moves through Stripe
 * (TEST MODE ONLY in this version). The model (docs/billing.md):
 *
 * - Pay for compute: every lab session started through the gateway is metered
 *   (billing_usage: start, stop, compute tier and its rate). At the end its
 *   billed units go into a transactional outbox (billing_meter_outbox) and are
 *   reported to a Stripe Billing Meter as one meter event, identified by the
 *   usage row, so a retry never bills twice. A metered Price on a separate
 *   "compute" subscription per billing customer turns the units into money.
 * - Plans (subscriptions) unlock premium labs (`plans.premium` rules and plan
 *   levels); compute is billed on top of any plan.
 * - Free accounts get the trial labs (`plans.free`), uncharged and capped;
 *   anything else needs a payment method (Checkout in setup mode) or a plan.
 * - Organisations buy seats (subscription quantity, prorated); seated members
 *   get the org plan's level and their compute is billed to the organisation.
 * - Dunning: a failed invoice or a past_due/unpaid subscription starts a grace
 *   period; after it, new paid lab starts are refused (running labs continue).
 * - Spend caps per account and organisation; a hard stop refuses new paid labs.
 *
 * `assertLabStart` enforces all of it when CT_BILLING_ENFORCE is on (default:
 * on with billing). Idempotency: webhook deliveries are keyed by Stripe event
 * id; checkout, customer and subscription creation send idempotency keys; meter
 * events carry the usage row's identifier.
 */

export interface BillingDeps {
  db: Db;
  site: SiteConfig;
  /** Absent when billing is off: summaries still answer with the default plan, usage is recorded unbilled. */
  stripe?: StripeApi;
  webhookSecret?: string;
  /** Refuse lab starts that billing does not allow (CT_BILLING_ENFORCE). */
  enforce?: boolean;
  /** Labs by id (compute tier, premium rules, titles). */
  labs?: ReadonlyMap<string, ContentLab>;
  /** Payment-failure and restore emails (Mailpit in dev). */
  mailer?: Mailer;
  /** Where the browser returns after Checkout or the portal (CT_WEB_URL). */
  webUrl: string;
  now?: () => Date;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
  /** Time budget of one webhook or reconciliation transaction (default 30 s): lock wait, statements, idle time and Stripe writes. */
  txBudgetMs?: number;
  /**
   * When a metered session ended (null while it runs). The gate uses it to close usage of
   * sessions that ended outside the gateway before counting what runs (concurrent labs);
   * without it, open usage rows count until the sweep closes them.
   */
  sessionEnd?: SessionEndResolver;
}

/** What a metered session is: a lab, an exam simulation attempt or a CTF event lab. */
export type StartKind = 'lab' | 'exam' | 'event';
/**
 * Whether a metered session still runs: null while it runs (or is starting), a Date when it
 * ended, 'missing' when neither a LabSession nor an ExamSession of that name exists. Missing is
 * not "ended": a reserved start has no session until createSession, and a session the
 * orchestrator deleted after its end is missing too; the usage row's `session_confirmed` tells
 * the two apart (see closeOpen).
 */
export type SessionEndResolver = (sessionName: string, kind: StartKind) => Promise<Date | UsageEnd | RunningSession | null | 'missing'>;

/**
 * A lab session that still runs, with its first Ready (null: not ready yet). The resolver may
 * answer this instead of null, so running estimates (the spend cap, the plan's minutes, the
 * billing page) count from the first Ready like the final charge, not from the start.
 */
export interface RunningSession {
  readyAt: Date | null;
}
const isRunning = (v: unknown): v is RunningSession => typeof v === 'object' && v !== null && !(v instanceof Date) && 'readyAt' in v && !('end' in v);
/** Open usage rows, for running estimates (BillingService.openUsage). */
const openQuery = (tx: Tx) => tx.selectFrom('billing_usage').select(['session_name', 'kind', 'started_at', 'units_per_minute', 'unit_price', 'billable']).where('ended_at', 'is', null);
type OpenQuery = ReturnType<typeof openQuery>;
/** How long a "not ready yet" answer is trusted for running estimates; after that the start counts again until asked anew. */
const NOT_READY_TTL_MS = 2 * 60_000;
/** Bound of the readiness cache (sessions with open usage rows; entries go when the row closes). */
const LIVE_MAX = 20_000;

/**
 * When a lab session ended and when it first became ready. Compute is billed
 * from the first Ready (provisioning is not the learner's time), and a lab
 * that never became ready is not billed at all. A bare Date (an exam, or a
 * session whose readiness is unknown) bills from the start.
 */
export interface UsageEnd {
  end: Date;
  readyAt: Date | null;
}
const isUsageEnd = (v: unknown): v is UsageEnd => typeof v === 'object' && v !== null && (v as UsageEnd).end instanceof Date;

/** What the sweep or the gate does with an open usage row. */
type Verdict = Date | UsageEnd | 'orphan' | 'confirm';

/** A reservation whose session still does not exist after this long is an orphan: closed unbilled. */
export const START_TIMEOUT_MS = 10 * 60_000;

/** What runs and was used, for the plan limits. */
interface StartUsage {
  running: number;
  minutes: number;
  exams: number;
}

const ACTIVE: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due']);
const DELINQUENT: ReadonlySet<string> = new Set<SubscriptionStatus>(['past_due', 'unpaid']);
const STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);
const DAY = 86_400_000;
/** `userId` of a usage row whose person has been erased (src/gdpr, docs/gdpr.md). */
const ERASED_MEMBER = 'erased';
const OUTBOX_BATCH = 50;
const OUTBOX_MAX_ATTEMPTS = 12;
const OUTBOX_LEASE_MS = 120_000;

export interface WebhookOutcome {
  eventId: string;
  type: string;
  status: 'processed' | 'ignored' | 'duplicate' | 'failed';
}

/** What `assertLabStart` decided; `meterStart` records it. */
export interface StartDecision {
  kind: StartKind;
  /** The lab id (an exam attempt: the exam id). */
  labId: string;
  /** The session (or exam attempt) name the start is reserved under. */
  sessionName: string;
  tier: ComputeTier;
  unitsPerMinute: number;
  unitPrice: number;
  payer: BillingScope;
  payerKey: string;
  customerId: string | null;
  trial: boolean;
  billable: boolean;
}

interface CustomerRow {
  id: string;
  org_id: string;
  user_id: string | null;
  stripe_customer_id: string;
  email: string | null;
  has_payment_method: boolean;
  invoice_failed_at: Date | null;
  delinquent_since: Date | null;
  compute_subscription_id: string | null;
}

/** Everything enforcement and the summaries need about one person (or the org) in one org. */
interface PayerState {
  payer: BillingScope;
  payerKey: string;
  customer?: CustomerRow;
  level: number;
  paymentMethod: boolean;
  dunning: BillingDunning;
  seat?: { plan: SitePlan };
  limit: { monthlyCap: number; hardStop: boolean; source: 'default' | 'custom' };
  spent: number;
  /** The plan whose entitlements (limits) apply: the seat's plan when it is higher, else the account's own (free without one). */
  plan?: SitePlan;
}

/** Stripe objects read before the event's transaction (see prefetch). */
interface Prefetched {
  setupIntent?: StripeSetupIntent;
  invoice?: StripeInvoice;
  /** The Stripe customer the event is about, and its row's version (updated_at) when Stripe was read. */
  customerId?: string;
  version?: string | null;
  /** All of the customer's subscriptions, read before the transaction (absent: not needed, or the customer is gone). */
  subs?: StripeSubscription[];
  /** The customer as Stripe has it now (customer.updated); null when deleted. */
  customer?: StripeCustomer | null;
  /** A prefetch failure, raised inside the savepoint so it is recorded like any other. */
  error?: unknown;
}

interface ApplyResult {
  status: 'processed' | 'ignored';
  orgId?: string;
  userId?: string | null;
  summary: Record<string, unknown>;
  mails?: Mail[];
}

export class BillingService {
  readonly enabled: boolean;
  readonly enforced: boolean;
  readonly pricing: PricingModel;
  /** The billing clock (injectable in tests). */
  readonly now: () => Date;
  private readonly priceIds = new Map<string, string>();
  private readonly facts = new Map<string, LabFacts & { title: string }>();
  private flushing: Promise<unknown> | undefined;
  private readonly deadlines = new WeakMap<Tx, number>();
  /**
   * First Ready of running lab sessions as the resolver last reported it (readyAt is set once
   * and never changes; "not ready yet" is trusted for NOT_READY_TTL_MS). Filled before any
   * transaction (no cluster call under a lock), read when estimating open usage rows.
   */
  private readonly live = new Map<string, { readyAt: Date | null; seen: number }>();

  constructor(private readonly d: BillingDeps) {
    this.enabled = !!d.stripe;
    this.enforced = this.enabled && !!d.enforce;
    this.now = d.now ?? (() => new Date());
    this.pricing = new PricingModel(d.site);
    for (const [id, l] of d.labs ?? []) {
      const m = l.lab.metadata;
      this.facts.set(id, { id, domain: m.domain, difficulty: m.difficulty, ...(m.tags ? { tags: m.tags } : {}), tier: computeTierOf(l.lab.spec.topology), title: m.title });
    }
    if (d.labs) for (const issue of this.pricing.issues(new Set(d.labs.keys()))) d.log?.warn({ issue }, 'billing configuration');
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

  private get currency(): string {
    return this.pricing.currency;
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
    const base = {
      enabled: this.enabled,
      mode: this.enabled ? ('test' as const) : ('off' as const),
      scope,
      plans: this.plansFor(scope),
      currency: this.currency,
      placeholder: !!(this.d.site.plans?.placeholder || this.plans.some((pl) => pl.placeholderPrices) || this.pricing.compute.placeholder),
      checkoutEnabled: this.enabled && !!this.d.site.flags.checkoutEnabled,
      enforced: this.enforced,
      compute: this.rates(),
    };
    if (!p.orgId) {
      const plan = this.defaultState();
      const at = this.now();
      const { start, end } = monthOf(at);
      return {
        ...base,
        ...(plan ? { plan } : {}),
        portalAvailable: false,
        paymentMethod: false,
        level: 0,
        payer: 'user',
        usage: { periodStart: start.toISOString(), periodEnd: end.toISOString(), minutes: 0, units: 0, estimate: 0, running: 0, byTier: [], sessions: [] },
        limit: { ...this.pricing.defaultLimit(scope), source: 'default', spent: 0, reached: false, warn: false },
        dunning: { state: 'ok', graceDays: this.pricing.graceDays },
      };
    }
    // Running labs are estimated from their first Ready (openMinutes): ask the cluster first, outside the transaction.
    const open = await this.tx(p, (tx) => {
      const q = openQuery(tx).where('org_id', '=', p.orgId);
      return (userId === null ? q.where('payer_key', '=', '') : q.where((eb) => eb.or([eb('user_id', '=', userId), eb('payer_key', '=', userId)]))).execute();
    });
    await this.refreshLive(open);
    return this.tx(p, async (tx) => {
      const ent = await tx.selectFrom('billing_entitlements').selectAll().where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
      const sub = await this.latestPlanSub(tx, p.orgId, userId);
      const cus = await this.customerRow(tx, p.orgId, userId);
      const plan = ent ? this.planState(ent.plan_id, ent.entitlements as PlanEntitlements, ent.source, ent.updated_at) : this.defaultState();
      const state = await this.payerState(tx, p.orgId, userId, userId === null ? 'org' : undefined);
      const own = scope === 'org' ? state : await this.accountState(tx, p.orgId, userId!);
      const usage = await this.usage(tx, p.orgId, scope === 'org' ? { payerKey: '' } : { userId: userId! });
      const limit = this.limitView(own, usage.estimate);
      const summary: BillingSummary = {
        ...base,
        ...(plan ? { plan } : {}),
        ...(sub ? { subscription: toSubscription(sub) } : {}),
        portalAvailable: this.enabled && !!cus,
        paymentMethod: own.paymentMethod,
        level: state.level,
        payer: state.payer,
        ...(state.seat && scope === 'user' ? { seat: { planId: state.seat.plan.id, planName: state.seat.plan.name, level: this.pricing.level(state.seat.plan) } } : {}),
        usage,
        limit,
        // A seated member's labs depend on the organisation's payments: show its state.
        dunning: scope === 'user' && state.payer === 'org' ? state.dunning : own.dunning,
      };
      if (scope === 'user') summary.trial = await this.trialView(tx, p.orgId, userId!);
      if (scope === 'org') summary.seats = await this.seatsView(tx, p.orgId, sub);
      return summary;
    });
  }

  private rates(): BillingComputeRates {
    const c = this.pricing.compute;
    return {
      unitPrice: this.pricing.unitPrice,
      placeholder: !!c.placeholder,
      minimumMinutes: c.minimumMinutes ?? 1,
      tiers: (['pod', 'vm', 'heavy'] as const).map((tier) => ({ tier, label: c.tiers[tier].label, unitsPerMinute: c.tiers[tier].unitsPerMinute, pricePerHour: this.pricing.pricePerHour(tier) })),
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

  /* ------------------------------------------------------- payer state */

  /** The scope's plan subscription that counts: an active one if any (the highest plan level, then the newest), else the newest. */
  private async latestPlanSub(tx: Tx, orgId: string, userId: string | null) {
    const subs = await this.planSubs(tx, orgId, userId);
    return this.bestActive(subs) ?? subs[0];
  }

  /** The scope's plan subscriptions, newest first. */
  private planSubs(tx: Tx, orgId: string, userId: string | null) {
    return tx
      .selectFrom('billing_subscriptions')
      .selectAll()
      .where('org_id', '=', orgId)
      .where(sql`coalesce(user_id, '')`, '=', userId ?? '')
      .where('kind', '=', 'plan')
      .orderBy('updated_at', 'desc')
      .execute();
  }

  /** Of the active subscriptions, the one with the highest plan level (newest first among equals). */
  private bestActive<S extends { plan_id: string; status: string }>(subs: S[]): S | undefined {
    let best: S | undefined;
    for (const s of subs) if (ACTIVE.has(s.status) && (!best || this.pricing.level(this.plan(s.plan_id)) > this.pricing.level(this.plan(best.plan_id)))) best = s;
    return best;
  }

  private customerRow(tx: Tx, orgId: string, userId: string | null): Promise<CustomerRow | undefined> {
    return tx
      .selectFrom('billing_customers')
      .select(['id', 'org_id', 'user_id', 'stripe_customer_id', 'email', 'has_payment_method', 'invoice_failed_at', 'delinquent_since', 'compute_subscription_id'])
      .where('org_id', '=', orgId)
      .where('scope_key', '=', userId ?? '')
      .executeTakeFirst();
  }

  /** The account of one scope on its own: payment method, dunning, cap and month-to-date spend. */
  private async accountState(tx: Tx, orgId: string, userId: string | null): Promise<PayerState> {
    const scope: BillingScope = userId ? 'user' : 'org';
    const customer = await this.customerRow(tx, orgId, userId);
    const sub = await this.latestPlanSub(tx, orgId, userId);
    const subActive = !!sub && ACTIVE.has(sub.status);
    const ent = userId ? await tx.selectFrom('billing_entitlements').select(['plan_id', 'source']).where('org_id', '=', orgId).where('scope_key', '=', userId).executeTakeFirst() : undefined;
    const level = userId ? (ent?.source === 'subscription' ? this.pricing.level(this.plan(ent.plan_id)) : 0) : subActive ? this.pricing.level(this.plan(sub!.plan_id)) : 0;
    const lim = await tx.selectFrom('billing_limits').select(['monthly_cap', 'hard_stop']).where('org_id', '=', orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
    const limit = lim ? { monthlyCap: lim.monthly_cap, hardStop: lim.hard_stop, source: 'custom' as const } : { ...this.pricing.defaultLimit(scope), source: 'default' as const };
    const spent = (await this.spend(tx, orgId, { payerKey: userId ?? '' })).amount;
    let since = customer?.delinquent_since ?? null;
    if (!since && sub && DELINQUENT.has(sub.status)) since = sub.updated_at;
    const ownPlan = (userId ? (ent?.source === 'subscription' ? this.plan(ent.plan_id) : undefined) : subActive ? this.plan(sub!.plan_id) : undefined) ?? this.defaultPlan();
    return { payer: scope, payerKey: userId ?? '', ...(customer ? { customer } : {}), level, paymentMethod: !!customer?.has_payment_method || subActive, dunning: this.dunningView(since), limit, spent, ...(ownPlan ? { plan: ownPlan } : {}) };
  }

  /** Who pays for `userId`'s labs (the org for a seated member of an active org plan) and what applies. */
  private async payerState(tx: Tx, orgId: string, userId: string | null, force?: BillingScope): Promise<PayerState> {
    if (!userId || force === 'org') return this.accountState(tx, orgId, null);
    const own = await this.accountState(tx, orgId, userId);
    const orgSub = await this.latestPlanSub(tx, orgId, null);
    const orgPlan = orgSub && ACTIVE.has(orgSub.status) ? this.plan(orgSub.plan_id) : undefined;
    const seated = !!orgPlan && !!(await tx.selectFrom('billing_seats').select('user_id').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst());
    if (!seated) return own;
    const org = await this.accountState(tx, orgId, null);
    const plan = this.pricing.level(orgPlan) >= own.level ? orgPlan : own.plan;
    return { ...org, level: Math.max(own.level, this.pricing.level(orgPlan)), seat: { plan: orgPlan! }, ...(plan ? { plan } : {}) };
  }

  private dunningView(since: Date | null): BillingDunning {
    const graceDays = this.pricing.graceDays;
    if (!since) return { state: 'ok', graceDays };
    const ends = new Date(since.getTime() + graceDays * DAY);
    return { state: this.now() < ends ? 'grace' : 'blocked', since: since.toISOString(), graceEndsAt: ends.toISOString(), graceDays };
  }

  private limitView(s: PayerState, spent: number): BillingLimit {
    const cap = s.limit.monthlyCap;
    return { monthlyCap: cap, hardStop: s.limit.hardStop, source: s.limit.source, spent, reached: cap > 0 && spent >= cap, warn: cap > 0 && spent >= cap * 0.8 };
  }

  /* ------------------------------------------------------------- usage */

  /**
   * The open usage rows matching `scope`, with their live minutes (openMinutes): running
   * estimates are computed here, not in SQL, so they count from the first Ready like the final
   * charge (closeUsage).
   */
  private async openUsage(tx: Tx, scope: (q: OpenQuery) => OpenQuery, at: Date) {
    const rows = await scope(openQuery(tx)).execute();
    return rows.map((r) => ({ ...r, minutes: this.openMinutes(r, at) }));
  }

  /** Compute spend this month (sessions ended this month or still running; Stripe dates a meter event at the session's end). */
  private async spend(tx: Tx, orgId: string, who: { payerKey?: string; userId?: string }): Promise<{ amount: number }> {
    const at = this.now();
    const { start, end } = monthOf(at);
    let q = tx
      .selectFrom('billing_usage')
      .select(sql<string>`coalesce(sum(coalesce(minutes, 0) * units_per_minute * unit_price), 0)`.as('amount'))
      .where('org_id', '=', orgId)
      .where('billable', '=', true)
      .where('ended_at', '>=', start)
      .where('started_at', '<', end);
    if (who.payerKey !== undefined) q = q.where('payer_key', '=', who.payerKey);
    if (who.userId !== undefined) q = q.where('user_id', '=', who.userId);
    const r = await q.executeTakeFirstOrThrow();
    const open = await this.openUsage(tx, (o) => {
      let oq = o.where('org_id', '=', orgId).where('billable', '=', true).where('started_at', '<', end);
      if (who.payerKey !== undefined) oq = oq.where('payer_key', '=', who.payerKey);
      if (who.userId !== undefined) oq = oq.where('user_id', '=', who.userId);
      return oq;
    }, at);
    const running = open.reduce((sum, o) => sum + o.minutes * o.units_per_minute * Number(o.unit_price), 0);
    return { amount: round2(Number(r.amount) + running) };
  }

  private async usage(tx: Tx, orgId: string, who: { payerKey?: string; userId?: string }): Promise<BillingUsage> {
    const at = this.now();
    const { start, end } = monthOf(at);
    let q = tx
      .selectFrom('billing_usage as u')
      .leftJoin('billing_meter_outbox as o', 'o.usage_id', 'u.id')
      .leftJoin('users as us', 'us.id', 'u.user_id')
      .select(['u.id', 'u.session_name', 'u.kind', 'u.lab_id', 'u.user_id', 'us.name as user_name', 'u.compute_tier', 'u.started_at', 'u.ended_at', 'u.minutes', 'u.units_per_minute', 'u.unit_price', 'u.payer_key', 'u.trial', 'u.billable', 'o.status as report'])
      .where('u.org_id', '=', orgId)
      .where('u.started_at', '<', end)
      .where((eb) => eb.or([eb('u.ended_at', 'is', null), eb('u.ended_at', '>=', start)]));
    if (who.payerKey !== undefined) q = q.where('u.payer_key', '=', who.payerKey);
    if (who.userId !== undefined) q = q.where('u.user_id', '=', who.userId);
    const rows = await q.orderBy('u.started_at', 'desc').limit(5000).execute();
    const out: BillingUsage = { periodStart: start.toISOString(), periodEnd: end.toISOString(), minutes: 0, units: 0, estimate: 0, running: 0, byTier: [], sessions: [] };
    const tiers = new Map<ComputeTier, { tier: ComputeTier; minutes: number; units: number; amount: number }>();
    const members = new Map<string, { userId: string; name: string; minutes: number; units: number; amount: number }>();
    for (const r of rows) {
      const mins = r.ended_at ? Number(r.minutes ?? 0) : this.openMinutes(r, at);
      const units = mins * r.units_per_minute;
      const amount = r.billable ? this.pricing.amount(units, Number(r.unit_price)) : 0;
      const running = !r.ended_at;
      if (running) out.running++;
      // Totals are what this scope pays: the org's bill, or a person's own (not their org-paid labs).
      const counts = r.billable && (who.payerKey !== undefined || r.payer_key === who.userId);
      if (counts) {
        out.minutes += mins;
        out.units += units;
        out.estimate += amount;
        const t = tiers.get(r.compute_tier) ?? { tier: r.compute_tier, minutes: 0, units: 0, amount: 0 };
        t.minutes += mins;
        t.units += units;
        t.amount = round2(t.amount + amount);
        tiers.set(r.compute_tier, t);
        if (who.payerKey === '') {
          // An erased member's usage stays on the org's bill, under no name.
          const memberId = r.user_id ?? ERASED_MEMBER;
          const m = members.get(memberId) ?? { userId: memberId, name: r.user_name ?? (r.user_id ? r.user_id : 'Erased user'), minutes: 0, units: 0, amount: 0 };
          m.minutes += mins;
          m.units += units;
          m.amount = round2(m.amount + amount);
          members.set(memberId, m);
        }
      }
      if (out.sessions.length < 50) {
        const report: UsageReportState = running ? 'running' : !r.billable ? 'unbilled' : ((r.report as UsageReportState | null) ?? 'unbilled');
        const row: BillingUsageRow = {
          id: r.id,
          sessionName: r.session_name,
          labId: r.lab_id,
          labTitle: this.facts.get(r.lab_id)?.title ?? r.lab_id,
          userId: r.user_id ?? ERASED_MEMBER,
          ...(r.user_name ? { userName: r.user_name } : r.user_id ? {} : { userName: 'Erased user' }),
          tier: r.compute_tier,
          startedAt: r.started_at.toISOString(),
          ...(r.ended_at ? { endedAt: r.ended_at.toISOString() } : {}),
          minutes: mins,
          units,
          amount,
          payer: r.payer_key === '' ? 'org' : 'user',
          trial: r.trial,
          report,
        };
        out.sessions.push(row);
      }
    }
    out.estimate = round2(out.estimate);
    out.byTier = [...tiers.values()];
    if (who.payerKey === '') out.byMember = [...members.values()].sort((a, b) => b.amount - a.amount);
    return out;
  }

  private async trialUse(tx: Tx, orgId: string, userId: string): Promise<{ sessions: number; minutes: number }> {
    const at = this.now();
    const r = await tx
      .selectFrom('billing_usage')
      .select([sql<number>`count(*)::int`.as('n'), sql<number>`coalesce(sum(coalesce(minutes, 0)) FILTER (WHERE ended_at IS NOT NULL), 0)::int`.as('m')])
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .where('trial', '=', true)
      .executeTakeFirstOrThrow();
    const open = await this.openUsage(tx, (o) => o.where('org_id', '=', orgId).where('user_id', '=', userId).where('trial', '=', true), at);
    return { sessions: Number(r.n), minutes: Number(r.m) + open.reduce((sum, o) => sum + o.minutes, 0) };
  }

  private async trialView(tx: Tx, orgId: string, userId: string): Promise<BillingTrial> {
    const t = this.pricing.trial;
    const used = await this.trialUse(tx, orgId, userId);
    return {
      labs: t.labs.map((id) => ({ id, title: this.facts.get(id)?.title ?? id })),
      maxSessions: t.maxSessions,
      maxMinutes: t.maxMinutes,
      usedSessions: used.sessions,
      usedMinutes: used.minutes,
      exhausted: used.sessions >= t.maxSessions || used.minutes >= t.maxMinutes,
    };
  }

  /* --------------------------------------------------------- enforcement */

  /**
   * The billing gate for a lab start: premium plan level, the free-trial
   * allowance, a payment method, dunning, the spend cap and the plan limits,
   * in that order. Refuses with 402 `payment_required` (`details`:
   * BillingBlockDetails) when enforcement is on. On success the usage row is
   * already written as a reservation under `sessionName` (see assertStart);
   * the caller creates the session under that name, then calls `meterStart`,
   * or `release` when the start fails. `kind: 'event'` is a CTF event lab
   * (needs the plan's CTF events).
   */
  async assertLabStart(p: Principal, labId: string, kind: 'lab' | 'event', sessionName: string): Promise<StartDecision | undefined> {
    const lab = this.facts.get(labId);
    if (!lab) return this.unpriced(`lab ${labId}`);
    return this.assertStart(p, kind, lab, this.pricing.isTrialLab(labId) && kind === 'lab', sessionName);
  }

  /**
   * The same gate for an exam simulation attempt: no premium rule, the plan's
   * exam simulations per month. Compute is metered at the heaviest tier of
   * the exam's task pool (an attempt draws its tasks after the start).
   */
  async assertExamStart(p: Principal, exam: { id: string; title: string; labIds: string[] }, attemptName: string): Promise<StartDecision | undefined> {
    const tiers = exam.labIds.map((id) => this.facts.get(id)?.tier).filter((t): t is ComputeTier => !!t);
    if (tiers.length === 0) return this.unpriced(`exam ${exam.id}`);
    const rank: Record<ComputeTier, number> = { pod: 0, vm: 1, heavy: 2 };
    const tier = tiers.reduce((a, b) => (rank[b] > rank[a] ? b : a));
    return this.assertStart(p, 'exam', { id: exam.id, domain: '', difficulty: '', tier, title: exam.title }, false, attemptName);
  }

  /** Nothing to price a start by (no lab facts): refused while enforcing (fail closed), else started unmetered and logged. */
  private unpriced(what: string): undefined {
    if (this.enforced) throw new HttpError(409, `Billing cannot price this ${what.split(' ')[0]}, so it cannot start. Ask an administrator to check the billing configuration.`, { code: 'conflict' });
    if (this.enabled) this.d.log?.warn({ what }, 'billing: no compute facts; starting unmetered');
    return undefined;
  }

  /**
   * Decides a start and reserves it. Under a transaction-scoped advisory lock
   * per payer (the person, or the organisation for a seated member: the plan
   * limits belong to whoever holds the plan), it counts what runs and was used,
   * decides, and writes the usage row before the session exists. Concurrent
   * starts therefore see each other: limits cannot be raced past, and a second
   * start of the same lab while the first is in flight is refused (409).
   * Whether open sessions have ended is resolved before the transaction, so no
   * cluster call runs while the lock is held.
   */
  private async assertStart(p: Principal, kind: StartKind, lab: LabFacts & { title: string }, trialLab: boolean, sessionName: string): Promise<StartDecision | undefined> {
    if (!p.orgId) return undefined;
    // Whether the person's open sessions still run, asked before the transaction (no cluster call under the lock).
    const { open, orgPays, orgOpen } = await this.tx(p, async (tx) => {
      const orgPays = (await this.payerState(tx, p.orgId, p.sub)).payer === 'org';
      return {
        open: await tx.selectFrom('billing_usage').select(['session_name', 'kind', 'started_at', 'session_confirmed']).where('org_id', '=', p.orgId).where('user_id', '=', p.sub).where('ended_at', 'is', null).execute(),
        orgPays,
        // The organisation's spend cap counts every member's running labs.
        orgOpen: orgPays ? await openQuery(tx).where('org_id', '=', p.orgId).where('payer_key', '=', '').execute() : [],
      };
    });
    const ends = await this.resolveOpen(open);
    // Running labs count towards the cap from their first Ready (openMinutes): learn it before the locks.
    await this.refreshLive(orgOpen);
    // A seated member's start also takes the organisation's lock, for the organisation's spend
    // cap: always in the order organisation, then person (no deadlocks). Whether the person is
    // seated is read before the locks as a hint; if a seat appeared in between, start over.
    for (let lockOrg = orgPays; ; lockOrg = true) {
      const result = await this.decideUnderLock(p, kind, lab, trialLab, sessionName, ends, lockOrg);
      if (result === 'relock') continue;
      if (result.queued) this.kick();
      return result.decision;
    }
  }

  private async decideUnderLock(p: Principal, kind: StartKind, lab: LabFacts & { title: string }, trialLab: boolean, sessionName: string, ends: Map<string, Verdict>, lockOrg: boolean): Promise<'relock' | { decision: StartDecision; queued: boolean }> {
    let queued = false;
    return this.tx(p, async (tx) => {
      // The locks first, then everything the decision reads.
      if (lockOrg) await sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-start:${p.orgId}:`}))`.execute(tx);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-start:${p.orgId}:${p.sub}`}))`.execute(tx);
      const state = await this.payerState(tx, p.orgId, p.sub);
      if (state.payer === 'org' && !lockOrg) return 'relock' as const;
      if (await this.closeOpen(tx, ends)) queued = true;
      const usage = await this.startUsage(tx, p.orgId, p.sub);
      if (kind !== 'exam') {
        const inFlight = await tx.selectFrom('billing_usage').select('session_name').where('org_id', '=', p.orgId).where('user_id', '=', p.sub).where('lab_id', '=', lab.id).where('kind', '=', kind).where('ended_at', 'is', null).executeTakeFirst();
        if (inFlight) throw new HttpError(409, 'This lab is already starting or running for you. Reload the page to attach to it.', { code: 'conflict', details: { sessionId: inFlight.session_name } });
      }
      const trialUse = trialLab ? await this.trialUse(tx, p.orgId, p.sub) : undefined;
      const verdict = this.decide(p, lab, state, trialUse, { kind, usage });
      if (verdict.block && this.enforced) throw new HttpError(402, verdict.block.message, { code: 'payment_required', details: verdict.block.details as unknown as Record<string, unknown> });
      const trial = !!verdict.trial;
      const billable = this.enabled && !trial && !!state.customer;
      const d: StartDecision = {
        kind,
        labId: lab.id,
        sessionName,
        tier: lab.tier,
        unitsPerMinute: this.pricing.unitsPerMinute(lab.tier),
        unitPrice: this.pricing.unitPrice,
        payer: state.payer,
        payerKey: state.payerKey,
        customerId: billable ? state.customer!.id : null,
        trial,
        billable,
      };
      // The reservation: from here on the start counts, and is billed once the session exists.
      await tx.insertInto('billing_usage').values(this.usageRow(p, d, this.now())).execute();
      return { decision: d, queued };
    });
  }

  /** What to do with open usage rows: close at a time (ended), close unbilled (an orphan reservation), or leave open. */
  private async resolveOpen(rows: { session_name: string; kind: StartKind; started_at: Date; session_confirmed: boolean }[], resolver = this.d.sessionEnd): Promise<Map<string, Verdict>> {
    const out = new Map<string, Verdict>();
    if (!resolver) return out;
    for (const r of rows) {
      const end = await resolver(r.session_name, r.kind).catch(() => undefined);
      if (end === undefined) continue; // the cluster did not answer: leave it
      if (isRunning(end)) this.noteLive(r.session_name, end.readyAt);
      else if (isUsageEnd(end)) this.noteLive(r.session_name, end.readyAt);
      if (end === null || isRunning(end)) {
        // Running: a reservation whose confirmation was lost is confirmed now (the repair path).
        if (!r.session_confirmed) out.set(r.session_name, 'confirm');
      } else if (end instanceof Date || isUsageEnd(end)) out.set(r.session_name, end);
      else if (end === 'missing') {
        // A session that ran and was deleted after its end: billed up to now. A reservation that
        // never got its session: an orphan once the start timeout has passed, open until then.
        if (r.session_confirmed) out.set(r.session_name, this.now());
        else if (this.now().getTime() - r.started_at.getTime() > START_TIMEOUT_MS) out.set(r.session_name, 'orphan');
      }
    }
    return out;
  }

  private noteLive(sessionName: string, readyAt: Date | null): void {
    if (this.live.size >= LIVE_MAX) this.live.clear();
    this.live.set(sessionName, { readyAt, seen: this.now().getTime() });
  }

  /**
   * Asks the resolver for the first Ready of open lab rows whose readiness is not known yet
   * (before a transaction: no cluster call under a lock). Exams are billed from their start.
   */
  private async refreshLive(rows: { session_name: string; kind: StartKind }[]): Promise<void> {
    const resolver = this.d.sessionEnd;
    if (!resolver) return;
    const now = this.now().getTime();
    const ask = rows.filter((r) => {
      if (r.kind === 'exam') return false;
      const e = this.live.get(r.session_name);
      return !e || (!e.readyAt && now - e.seen > NOT_READY_TTL_MS / 4);
    });
    await Promise.all(
      ask.slice(0, 200).map(async (r) => {
        const end = await resolver(r.session_name, r.kind).catch(() => undefined);
        if (isRunning(end) || isUsageEnd(end)) this.noteLive(r.session_name, end.readyAt);
      }),
    );
  }

  /**
   * The billed minutes of an open usage row up to `at`, as it would be charged if it ended
   * now: a lab from its first Ready (none while it is not ready yet), an exam from its start;
   * from its start too when the lab's readiness is not known (the cluster did not answer).
   */
  private openMinutes(r: { session_name: string; kind: StartKind; started_at: Date }, at: Date): number {
    const e = r.kind === 'exam' ? undefined : this.live.get(r.session_name);
    let from = r.started_at;
    if (e?.readyAt) from = e.readyAt > r.started_at ? e.readyAt : r.started_at;
    else if (e && at.getTime() - e.seen <= NOT_READY_TTL_MS) return 0;
    return this.pricing.billedMinutes(at.getTime() - from.getTime());
  }

  /**
   * Applies resolveOpen's verdicts; true when a meter event was queued. Each row is read
   * again FOR UPDATE first: the verdict is a snapshot, and meanwhile the session may have been
   * confirmed (a slow start that got there after all) or closed. An orphan verdict on a row that
   * is confirmed by now is dropped.
   */
  private async closeOpen(tx: Tx, ends: Map<string, Verdict>): Promise<boolean> {
    let queued = false;
    for (const [name, verdict] of ends) {
      const row = await tx.selectFrom('billing_usage').select(['ended_at', 'session_confirmed']).where('session_name', '=', name).forUpdate().executeTakeFirst();
      if (!row || row.ended_at) continue;
      if (verdict === 'confirm') await tx.updateTable('billing_usage').set({ session_confirmed: true }).where('session_name', '=', name).execute();
      else if (verdict === 'orphan') {
        if (!row.session_confirmed) await this.closeUnbilled(tx, name);
      } else if (await this.closeUsage(tx, name, verdict)) queued = true;
    }
    return queued;
  }

  /** Closes a usage row at zero minutes, never billed: a released or orphaned reservation. */
  private async closeUnbilled(tx: Tx, sessionName: string): Promise<void> {
    await tx.updateTable('billing_usage').set({ ended_at: sql`started_at`, minutes: 0, units: 0, billable: false }).where('session_name', '=', sessionName).where('ended_at', 'is', null).where('session_confirmed', '=', false).execute();
  }

  /**
   * Marks a usage row's session as existing (and its real start time). A reservation that was
   * closed as an orphan or released meanwhile (its session came up later than the start
   * timeout, or the release raced it) is reopened as it was reserved: the session runs, so it
   * is metered. Returns false only when there is no row to confirm (the caller logs it).
   */
  private async confirmRow(tx: Tx, sessionName: string, startedAt?: Date): Promise<boolean> {
    const open = await tx
      .updateTable('billing_usage')
      .set({ session_confirmed: true, ...(startedAt ? { started_at: startedAt } : {}) })
      .where('session_name', '=', sessionName)
      .where('ended_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (open) return true;
    const reopened = await tx
      .updateTable('billing_usage')
      .set({ ended_at: null, minutes: null, units: null, billable: sql`customer_id IS NOT NULL AND NOT trial`, session_confirmed: true, ...(startedAt ? { started_at: startedAt } : {}) })
      .where('session_name', '=', sessionName)
      .where('session_confirmed', '=', false)
      .where('minutes', '=', 0)
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom('billing_meter_outbox as o').select('o.id').whereRef('o.usage_id', '=', 'billing_usage.id'))))
      .returning('id')
      .executeTakeFirst();
    if (reopened) this.d.log?.warn({ session: sessionName }, 'billing: reopened a reservation closed before its session came up');
    return !!reopened;
  }

  /** Reattaching to a running session: its usage row is confirmed (or reopened) if it is not yet. */
  async confirmSession(p: Principal, sessionName: string): Promise<boolean> {
    if (!p.orgId) return false;
    return this.tx(p, async (tx) => {
      const row = await tx.selectFrom('billing_usage').select(['session_confirmed', 'ended_at']).where('session_name', '=', sessionName).executeTakeFirst();
      if (!row || (row.session_confirmed && !row.ended_at)) return !!row;
      return this.confirmRow(tx, sessionName);
    });
  }

  private usageRow(p: Principal, d: StartDecision, startedAt: Date) {
    return {
      org_id: p.orgId,
      user_id: p.sub,
      lab_id: d.labId,
      session_name: d.sessionName,
      kind: d.kind,
      compute_tier: d.tier,
      units_per_minute: d.unitsPerMinute,
      unit_price: d.unitPrice,
      payer_key: d.payerKey,
      customer_id: d.customerId,
      trial: d.trial,
      billable: d.billable,
      started_at: startedAt,
      session_confirmed: false,
    };
  }

  /**
   * What the person runs now and used this month (UTC), for the plan limits: their own usage,
   * also for a seated member of an organisation plan (the allowances are per member; the spend
   * cap is the organisation's).
   */
  private async startUsage(tx: Tx, orgId: string, userId: string): Promise<StartUsage> {
    const at = this.now();
    const { start, end } = monthOf(at);
    const open = await tx.selectFrom('billing_usage').select(sql<number>`count(*)::int`.as('n')).where('org_id', '=', orgId).where('user_id', '=', userId).where('ended_at', 'is', null).executeTakeFirstOrThrow();
    const r = await tx
      .selectFrom('billing_usage')
      .select([sql<number>`coalesce(sum(coalesce(minutes, 0)) FILTER (WHERE ended_at IS NOT NULL), 0)::int`.as('m'), sql<number>`count(*) FILTER (WHERE kind = 'exam' AND NOT (ended_at IS NOT NULL AND minutes = 0))::int`.as('exams')])
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .where('started_at', '>=', start)
      .where('started_at', '<', end)
      .executeTakeFirstOrThrow();
    const live = await this.openUsage(tx, (o) => o.where('org_id', '=', orgId).where('user_id', '=', userId).where('started_at', '>=', start).where('started_at', '<', end), at);
    return { running: Number(open.n), minutes: Number(r.m) + live.reduce((sum, o) => sum + o.minutes, 0), exams: Number(r.exams) };
  }

  /** The lowest-level plan of the payer's kind above `level` that `ok` accepts (what to upgrade to). */
  private upgradeFor(s: PayerState, ok: (e: PlanEntitlements) => boolean): SitePlan | undefined {
    const current = this.pricing.level(s.plan);
    return this.plansFor(s.payer === 'org' ? 'org' : 'user')
      .filter((pl) => ok(pl.entitlements) && this.pricing.level(pl) >= current && pl.id !== s.plan?.id)
      .sort((a, b) => this.pricing.level(a) - this.pricing.level(b))[0];
  }

  private decide(
    p: Principal,
    lab: LabFacts & { title: string },
    s: PayerState,
    trialUse?: { sessions: number; minutes: number },
    start?: { kind: StartKind; usage?: StartUsage },
  ): { trial?: boolean; block?: { reason: BillingBlockReason; message: string; details: BillingBlockDetails } } {
    const orgPays = s.payer === 'org';
    const manage = can(p, 'billing.manage', { kind: 'org' });
    const href = orgPays ? '/admin/billing' : '/account/billing';
    const fix = (action: BillingBlockDetails['action']): BillingBlockDetails['action'] => (orgPays && !manage ? 'contact_admin' : action);
    const block = (reason: BillingBlockReason, message: string, extra: Partial<BillingBlockDetails> = {}, action: BillingBlockDetails['action']) => ({
      block: { reason, message, details: { reason, action: fix(action), href, scope: s.payer, ...extra } as BillingBlockDetails },
    });
    const required = this.pricing.requiredPlan(lab);
    if (required && s.level < this.pricing.level(required)) {
      const requiredPlan = { id: required.id, name: required.name, level: this.pricing.level(required) };
      return { block: { reason: 'plan_required', message: `"${lab.title}" is a premium lab: it needs the ${required.name} plan or higher.`, details: { reason: 'plan_required', action: 'upgrade', href: '/account/billing', scope: 'user', requiredPlan } } };
    }
    const ent = s.plan?.entitlements;
    const planName = s.plan?.name ?? 'current';
    // Features of the plan: exam simulations and CTF events.
    const feature = start?.kind === 'exam' ? (ent && ent.examSimulationsPerMonth === 0 ? 'Exam simulations' : undefined) : start?.kind === 'event' ? (ent && !ent.ctfEvents ? 'CTF event labs' : undefined) : undefined;
    if (feature) {
      const up = this.upgradeFor(s, (e) => (start!.kind === 'exam' ? e.examSimulationsPerMonth !== 0 : e.ctfEvents));
      const requiredPlan = up ? { id: up.id, name: up.name, level: this.pricing.level(up) } : undefined;
      return block('plan_required', `${feature} are not included in the ${planName} plan${up ? `: they need the ${up.name} plan or higher` : ''}.`, requiredPlan ? { requiredPlan } : {}, 'upgrade');
    }
    // A trial start is free: no payment method, dunning or spend cap; the plan limits below still apply.
    let trial = false;
    if (trialUse) {
      const t = this.pricing.trial;
      if (trialUse.sessions < t.maxSessions && trialUse.minutes < t.maxMinutes) trial = true;
      else if (!s.paymentMethod) return block('trial_exhausted', `You have used your free trial (${t.maxSessions} sessions or ${t.maxMinutes} minutes). Add a payment method to keep going; you pay only for the compute you use.`, {}, 'add_payment_method');
    }
    if (!trial && !s.paymentMethod) {
      return block('payment_method_required', orgPays ? 'Your organisation has no payment method on file. Ask an organisation admin to set up billing.' : 'Add a payment method to start this lab. A free account includes the trial lab only; other labs are billed per compute minute.', {}, 'add_payment_method');
    }
    if (!trial && s.dunning.state === 'blocked') {
      const who = orgPays ? "Your organisation's" : 'Your';
      return block('payment_overdue', `${who} last payment failed and the ${s.dunning.graceDays}-day grace period has ended. Update the payment method in the billing portal to start new labs; running labs are not affected.`, { ...(s.dunning.graceEndsAt ? { graceEndedAt: s.dunning.graceEndsAt } : {}) }, 'portal');
    }
    if (!trial && s.limit.hardStop && s.limit.monthlyCap > 0 && s.spent >= s.limit.monthlyCap) {
      const cap = formatMoney(s.limit.monthlyCap, this.currency);
      return block('spend_cap_reached', `${orgPays ? 'Your organisation has' : 'You have'} reached the monthly compute spend cap of ${cap}. ${orgPays && !manage ? 'Ask an organisation admin to raise it' : 'Raise the cap on the billing page'} to start new labs; running labs continue.`, { currency: this.currency, cap: s.limit.monthlyCap, spent: s.spent }, 'raise_cap');
    }
    // Plan limits (PlanEntitlements), counted per person.
    const u = start?.usage;
    if (u && ent) {
      if (u.running >= ent.concurrentLabs) {
        const up = this.upgradeFor(s, (e) => e.concurrentLabs > ent.concurrentLabs);
        const n = ent.concurrentLabs;
        return {
          block: {
            reason: 'concurrent_limit',
            message: `You already have ${u.running} ${u.running === 1 ? 'lab' : 'labs'} running, and the ${planName} plan allows ${n} at a time. End a running lab (or let it expire) before starting another${up ? `, or upgrade to ${up.name} for ${up.entitlements.concurrentLabs}` : ''}.`,
            details: { reason: 'concurrent_limit', action: 'end_session', href, scope: s.payer, limit: n, used: u.running, ...(up ? { requiredPlan: { id: up.id, name: up.name, level: this.pricing.level(up) } } : {}) },
          },
        };
      }
      const hours = ent.labHoursPerMonth;
      if (hours !== 'unlimited' && u.minutes >= hours * 60) {
        const up = this.upgradeFor(s, (e) => e.labHoursPerMonth === 'unlimited' || e.labHoursPerMonth > hours);
        return block(
          'lab_hours_exhausted',
          `You have used the ${hours} lab ${hours === 1 ? 'hour' : 'hours'} of the ${planName} plan this month (they renew on the 1st, UTC)${up ? `. ${up.name} includes more` : ''}.`,
          { limit: hours, used: Math.round((u.minutes / 60) * 10) / 10, ...(up ? { requiredPlan: { id: up.id, name: up.name, level: this.pricing.level(up) } } : {}) },
          'upgrade',
        );
      }
      const exams = ent.examSimulationsPerMonth;
      if (start!.kind === 'exam' && exams !== 'unlimited' && u.exams >= exams) {
        const up = this.upgradeFor(s, (e) => e.examSimulationsPerMonth === 'unlimited' || e.examSimulationsPerMonth > exams);
        return block(
          'exam_limit_reached',
          `You have started the ${exams} exam ${exams === 1 ? 'simulation' : 'simulations'} the ${planName} plan includes this month (they renew on the 1st, UTC)${up ? `. ${up.name} includes more` : ''}.`,
          { limit: exams, used: u.exams, ...(up ? { requiredPlan: { id: up.id, name: up.name, level: this.pricing.level(up) } } : {}) },
          'upgrade',
        );
      }
    }
    return trial ? { trial: true } : {};
  }

  /** Billing view of labs for the catalog and the lab page: tier, rate, premium plan, trial, lock. */
  async annotate<T extends { id: string; access?: LabAccess }>(p: Principal, labs: T[]): Promise<T[]> {
    if (!p.orgId || this.facts.size === 0) return labs;
    const ctx = await this.tx(p, async (tx) => {
      const state = await this.payerState(tx, p.orgId, p.sub);
      const trialUse = await this.trialUse(tx, p.orgId, p.sub);
      return { state, trialUse };
    });
    return labs.map((l) => {
      const f = this.facts.get(l.id);
      if (!f) return l;
      const trialLab = this.pricing.isTrialLab(l.id);
      const v = this.decide(p, f, ctx.state, trialLab ? ctx.trialUse : undefined);
      const required = this.pricing.requiredPlan(f);
      const access: LabAccess = {
        computeTier: f.tier,
        unitsPerMinute: this.pricing.unitsPerMinute(f.tier),
        pricePerHour: this.pricing.pricePerHour(f.tier),
        ...(required ? { requiredPlan: { id: required.id, name: required.name, level: this.pricing.level(required) } } : {}),
        ...(trialLab ? { trial: true } : {}),
        ...(v.trial || !this.enabled ? { free: true } : {}),
        ...(v.block && this.enforced ? { locked: { reason: v.block.reason, message: v.block.message, action: v.block.details.action, href: v.block.details.href } } : {}),
      };
      return { ...l, access };
    });
  }

  async annotateCatalog<C extends { labs: LabSummary[] }>(p: Principal, catalog: C): Promise<C> {
    return { ...catalog, labs: await this.annotate(p, catalog.labs) };
  }

  async annotateLab<L extends { metadata: { id: string } }>(p: Principal, lab: L): Promise<L & { access?: LabAccess }> {
    const [a] = await this.annotate<{ id: string; access?: LabAccess }>(p, [{ id: lab.metadata.id }]);
    return a?.access ? { ...lab, access: a.access } : lab;
  }

  /* ------------------------------------------------------------ metering */

  /**
   * Confirms a start once the session exists: the reserved usage row takes the
   * session's real start time. The row was written by the gate, so a failure
   * here leaves the session metered from the reservation, never unmetered.
   */
  async meterStart(p: Principal, decision: StartDecision | undefined, session: { id: string; startedAt?: string }): Promise<boolean> {
    if (!decision || !p.orgId) return true;
    const parsed = session.startedAt ? new Date(session.startedAt) : this.now();
    const startedAt = Number.isNaN(parsed.getTime()) ? this.now() : parsed;
    return this.tx(p, async (tx) => {
      // The gate's reservation is normally there; insert it when it is not (a caller without one).
      await tx.insertInto('billing_usage').values({ ...this.usageRow(p, decision, startedAt), session_name: session.id }).onConflict((oc) => oc.column('session_name').doNothing()).execute();
      return this.confirmRow(tx, session.id, startedAt);
    });
  }

  /** Releases a reservation whose start failed: closed at zero minutes, never billed. */
  async release(p: Principal, decision: StartDecision | undefined): Promise<void> {
    if (!decision || !p.orgId) return;
    await this.tx(p, (tx) => this.closeUnbilled(tx, decision.sessionName));
  }

  /** Ends a metered session: billed minutes and units, and its meter event into the outbox (same transaction). */
  async meterEnd(orgId: string, sessionName: string, endedAt: Date | UsageEnd = this.now()): Promise<void> {
    const queued = await withTenant(this.d.db, { orgId }, (tx) => this.closeUsage(tx, sessionName, endedAt));
    if (queued) this.kick();
  }

  private async closeUsage(tx: Tx, sessionName: string, ended: Date | UsageEnd): Promise<boolean> {
    const row = await tx.selectFrom('billing_usage').selectAll().where('session_name', '=', sessionName).where('ended_at', 'is', null).forUpdate().executeTakeFirst();
    this.live.delete(sessionName);
    if (!row) return false;
    const endedAt = isUsageEnd(ended) ? ended.end : ended;
    const end = endedAt < row.started_at ? row.started_at : endedAt;
    // Billed from the first Ready; a lab that never became ready (or only after it ended) is free.
    const readyAt = isUsageEnd(ended) ? ended.readyAt : row.started_at;
    const neverReady = readyAt === null || readyAt >= end;
    const from = readyAt && readyAt > row.started_at ? readyAt : row.started_at;
    const minutes = isUsageEnd(ended) && neverReady ? 0 : this.pricing.billedMinutes(end.getTime() - from.getTime());
    const units = minutes * row.units_per_minute;
    await tx.updateTable('billing_usage').set({ ended_at: end, minutes, units }).where('id', '=', row.id).execute();
    if (!row.billable || !row.customer_id || units === 0) return false;
    const cus = await tx.selectFrom('billing_customers').select('stripe_customer_id').where('id', '=', row.customer_id).executeTakeFirst();
    if (!cus) return false;
    await tx
      .insertInto('billing_meter_outbox')
      .values({ org_id: row.org_id, usage_id: row.id, identifier: `ctu_${row.id}`, event_name: this.pricing.compute.meterEventName, stripe_customer_id: cus.stripe_customer_id, value: units, event_at: end, next_attempt_at: this.now() })
      .onConflict((oc) => oc.column('usage_id').doNothing())
      .execute();
    return true;
  }

  /**
   * Closes usage whose session is over (expired, deleted outside the gateway)
   * and flushes the outbox. `sessionEnd` answers null while the session runs,
   * else when it ended. Runs in the platform context across orgs.
   */
  async sweep(sessionEnd: SessionEndResolver): Promise<{ closed: number; sent: number }> {
    const open = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('billing_usage').select(['org_id', 'session_name', 'kind', 'started_at', 'session_confirmed']).where('ended_at', 'is', null).orderBy('started_at').limit(500).execute());
    const ends = await this.resolveOpen(open, sessionEnd);
    let closed = 0;
    for (const u of open) {
      const end = ends.get(u.session_name);
      if (!end) continue;
      // An orphan verdict is checked once more right before acting on it (outside any transaction).
      if (end === 'orphan' && (await sessionEnd(u.session_name, u.kind).catch(() => undefined)) !== 'missing') continue;
      // Orphaned reservations (the start died before its session existed, or its release failed) close unbilled.
      await withTenant(this.d.db, { orgId: u.org_id }, (tx) => this.closeOpen(tx, new Map([[u.session_name, end]])));
      closed++;
    }
    const r = await this.flushOutbox();
    return { closed, sent: r.sent };
  }

  /** Sends due meter events now, in the background (one flush at a time). */
  private kick(): void {
    if (!this.d.stripe || this.flushing) return;
    this.flushing = this.flushOutbox()
      .catch((e: unknown) => this.d.log?.warn({ err: e instanceof Error ? e.message : String(e) }, 'billing outbox flush failed'))
      .finally(() => (this.flushing = undefined));
  }

  /** Waits for a background flush (tests, shutdown). */
  async settle(): Promise<void> {
    await this.flushing;
  }

  /**
   * Sends due outbox rows to Stripe as meter events. Each row is leased first
   * (next_attempt_at moves ahead, FOR UPDATE SKIP LOCKED), so concurrent
   * workers never send one twice; the identifier makes a resend after a crash
   * harmless. Failures back off exponentially; after OUTBOX_MAX_ATTEMPTS the
   * row is `failed` (dead letter, see docs/billing.md).
   */
  async flushOutbox(): Promise<{ sent: number; failed: number; retry: number }> {
    const stripe = this.d.stripe;
    const out = { sent: 0, failed: 0, retry: 0 };
    if (!stripe) return out;
    const now = this.now();
    const leased = await withTenant(this.d.db, { platform: true }, async (tx) => {
      const due = await tx.selectFrom('billing_meter_outbox').select('id').where('status', '=', 'pending').where('next_attempt_at', '<=', now).orderBy('next_attempt_at').limit(OUTBOX_BATCH).forUpdate().skipLocked().execute();
      if (due.length === 0) return [];
      return tx
        .updateTable('billing_meter_outbox')
        .set({ next_attempt_at: new Date(now.getTime() + OUTBOX_LEASE_MS), attempts: sql`attempts + 1` })
        .where(
          'id',
          'in',
          due.map((r) => r.id),
        )
        .returningAll()
        .execute();
    });
    for (const row of leased) {
      let result: { status: 'sent' | 'failed' | 'pending'; error?: string } = { status: 'sent' };
      try {
        await stripe.meterEvents.create(
          { event_name: row.event_name, identifier: row.identifier, timestamp: Math.floor(row.event_at.getTime() / 1000), payload: { stripe_customer_id: row.stripe_customer_id, value: String(row.value) } },
          `meter:${row.identifier}`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof StripeError && isDuplicateMeterEvent(e)) result = { status: 'sent' };
        else result = { status: row.attempts >= OUTBOX_MAX_ATTEMPTS || (e instanceof StripeError && isPermanent(e)) ? 'failed' : 'pending', error: message.slice(0, 500) };
      }
      const backoff = Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, row.attempts - 1));
      await withTenant(this.d.db, { platform: true }, (tx) =>
        tx
          .updateTable('billing_meter_outbox')
          .set(
            result.status === 'sent'
              ? { status: 'sent', sent_at: this.now(), last_error: null }
              : { status: result.status, last_error: result.error ?? null, next_attempt_at: new Date(this.now().getTime() + backoff) },
          )
          .where('id', '=', row.id)
          .execute(),
      );
      if (result.status === 'sent') out.sent++;
      else if (result.status === 'failed') {
        out.failed++;
        this.d.log?.warn({ identifier: row.identifier, attempts: row.attempts, err: result.error }, 'billing meter event failed permanently');
      } else out.retry++;
    }
    return out;
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

  /**
   * The scope's billing customer, created in Stripe and recorded when missing. With `lock`,
   * the customer's advisory lock (the one the webhooks take) is taken before the row is
   * written, in the same order as the webhooks: lock, then rows.
   */
  private async customerFor(tx: Tx, p: Principal, userId: string | null, lock = false): Promise<{ id: string; stripeCustomerId: string }> {
    const lockOn = (id: string) => sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-customer:${id}`}))`.execute(tx);
    const existing = await tx.selectFrom('billing_customers').select(['id', 'stripe_customer_id']).where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
    if (existing) {
      if (lock) await lockOn(existing.stripe_customer_id);
      return { id: existing.id, stripeCustomerId: existing.stripe_customer_id };
    }
    const created = await this.stripe().customers.create(
      {
        ...(userId ? { email: p.email, name: p.name } : { name: p.orgName }),
        metadata: { ct_org_id: p.orgId, ct_user_id: userId ?? '', ct_scope: userId ? 'user' : 'org' },
      },
      `cus:${p.orgId}:${userId ?? 'org'}`,
    );
    if (lock) await lockOn(created.id);
    const row = await tx
      .insertInto('billing_customers')
      .values({ org_id: p.orgId, user_id: userId, stripe_customer_id: created.id, email: userId ? p.email : null })
      .onConflict((oc) => oc.column('stripe_customer_id').doUpdateSet({ email: userId ? p.email : null }))
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, stripeCustomerId: created.id };
  }

  private assertCheckoutOpen(): void {
    this.stripe();
    if (!this.d.site.flags.checkoutEnabled) throw new HttpError(409, 'Self-service checkout is not open yet.', { code: 'conflict' });
  }

  /**
   * Refuses (409 plan_pending) while a plan Checkout of the customer completed in the last
   * PLAN_PENDING_S but its subscription is not recorded yet (the webhook is on its way). The
   * block lapses after that window, and at once when that Checkout's event failed for good
   * (`deadCheckouts`, see deadCheckouts()); the reconciliation repairs such a plan.
   */
  private async assertNoPendingPlan(tx: Tx, stripeCustomerId: string, deadCheckouts: ReadonlySet<string>): Promise<void> {
    const since = Math.floor(this.now().getTime() / 1000) - PLAN_PENDING_S;
    const done = await this.stripe().checkout.sessions.list({ customer: stripeCustomerId, status: 'complete', limit: 100 });
    for (const cs of done.data) {
      if (cs.mode !== 'subscription' || !cs.subscription || (cs.created ?? 0) < since) continue;
      const known = await tx.selectFrom('billing_subscriptions').select('id').where('stripe_subscription_id', '=', cs.subscription).executeTakeFirst();
      if (known) continue;
      const failedForGood = deadCheckouts.has(cs.id);
      if (failedForGood) continue;
      throw new HttpError(409, 'Your plan purchase is still being confirmed. Reload the billing page in a minute; change plans in the billing portal after that.', { code: 'conflict', details: { reason: 'plan_pending', action: 'portal' } });
    }
  }

  /**
   * Checkouts of the scope's customer whose checkout.session.completed event failed for good
   * (billing_events summary.object and summary.customer). A failed event carries no org, so
   * this reads platform-wide; it runs before the checkout transaction, so it never needs a
   * second pooled connection while that transaction holds the customer lock.
   */
  private async deadCheckouts(p: Principal, userId: string | null): Promise<Set<string>> {
    const cus = await this.tx(p, (tx) => tx.selectFrom('billing_customers').select('stripe_customer_id').where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst());
    if (!cus) return new Set();
    const rows = await withTenant(this.d.db, { platform: true }, (tx) =>
      tx
        .selectFrom('billing_events')
        .select(sql<string>`summary->>'object'`.as('object'))
        .where('type', '=', 'checkout.session.completed')
        .where('status', '=', 'failed')
        .where(sql<boolean>`summary->>'customer' = ${cus.stripe_customer_id} AND summary->>'retryable' = 'false'`)
        .execute(),
    );
    return new Set(rows.map((r) => r.object).filter(Boolean));
  }

  async checkout(p: Principal, scope: BillingScope, req: CheckoutRequest, ip?: string): Promise<CheckoutResponse> {
    this.assertCheckoutOpen();
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
    const dead = await this.deadCheckouts(p, userId);
    return this.tx(p, async (tx) => {
      // One checkout per account at a time: serialised on the customer (the lock the webhooks take, taken before any row is written).
      const customer = await this.customerFor(tx, p, userId, true);
      // One plan subscription per account: a second would bill twice, and an upgrade is a change of the existing one (the portal prorates it).
      const active = this.bestActive(await this.planSubs(tx, p.orgId, userId));
      if (active) {
        const name = this.plan(active.plan_id)?.name ?? active.plan_id;
        throw new HttpError(409, `${scope === 'org' ? 'The organisation already has' : 'You already have'} the ${name} plan. Change or cancel it in the billing portal instead of subscribing again.`, {
          code: 'conflict',
          details: { reason: 'plan_active', planId: active.plan_id, action: 'portal' },
        });
      }
      await this.assertNoPendingPlan(tx, customer.stripeCustomerId, dead);
      // A plan Checkout still open (another tab) could complete as a second subscription. A
      // young one may be mid-payment: refuse rather than kill it. An older one is expired, so
      // only the new one can be paid.
      const nowS = Math.floor(this.now().getTime() / 1000);
      const open = (await this.stripe().checkout.sessions.list({ customer: customer.stripeCustomerId, status: 'open', limit: 100 })).data.filter((cs) => cs.mode === 'subscription');
      if (open.some((cs) => nowS - (cs.created ?? 0) < CHECKOUT_IN_PROGRESS_S)) {
        throw new HttpError(409, 'A checkout for a plan is already in progress (another tab or window). Finish or cancel it, or try again in a few minutes.', { code: 'conflict', details: { reason: 'checkout_in_progress', action: 'portal' } });
      }
      for (const cs of open) await this.stripe().checkout.sessions.expire(cs.id).catch((e: unknown) => {
        if (!(e instanceof StripeError && e.status === 400)) throw e; // completed or expired meanwhile
      });
      // One may have completed between the first check and its expiry: check again.
      await this.assertNoPendingPlan(tx, customer.stripeCustomerId, dead);
      const metadata = { ct_org_id: p.orgId, ct_user_id: userId ?? '', ct_scope: scope, ct_plan_id: plan.id, ct_interval: req.interval, ct_kind: 'plan' };
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

  /** Checkout in setup mode: saves a payment method for pay-as-you-go compute (no charge now). */
  async paymentMethod(p: Principal, scope: BillingScope, ip?: string): Promise<CheckoutResponse> {
    this.assertCheckoutOpen();
    const userId = this.scopeUser(p, scope);
    return this.tx(p, async (tx) => {
      const customer = await this.customerFor(tx, p, userId);
      const metadata = { ct_org_id: p.orgId, ct_user_id: userId ?? '', ct_scope: scope, ct_kind: 'payment_method' };
      const back = `${this.d.webUrl}${this.returnPath(scope)}`;
      const session = await this.stripe().checkout.sessions.create(
        {
          mode: 'setup',
          customer: customer.stripeCustomerId,
          currency: this.currency.toLowerCase(),
          client_reference_id: `${p.orgId}:${userId ?? 'org'}`,
          success_url: `${back}?setup=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${back}?setup=cancelled`,
          metadata,
          setup_intent_data: { metadata },
        },
        `setup:${randomUUID()}`,
      );
      if (!session.url) throw new HttpError(502, 'Stripe returned no checkout URL');
      await audit(tx, actorOf(p, ip), 'billing.payment_method', 'customer', customer.stripeCustomerId, { scope, checkoutSession: session.id, mode: 'test' });
      return { url: session.url, sessionId: session.id };
    });
  }

  async portal(p: Principal, scope: BillingScope, ip?: string): Promise<PortalResponse> {
    this.stripe();
    const userId = this.scopeUser(p, scope);
    return this.tx(p, async (tx) => {
      const cus = await tx.selectFrom('billing_customers').select('stripe_customer_id').where('org_id', '=', p.orgId).where('scope_key', '=', userId ?? '').executeTakeFirst();
      if (!cus) throw conflict('No billing account yet: add a payment method or subscribe to a plan first.');
      const session = await this.stripe().billingPortal.sessions.create({ customer: cus.stripe_customer_id, return_url: `${this.d.webUrl}${this.returnPath(scope)}` });
      await audit(tx, actorOf(p, ip), 'billing.portal', 'customer', cus.stripe_customer_id, { scope });
      return { url: session.url };
    });
  }

  /* ------------------------------------------------------------- limits */

  async setLimit(p: Principal, scope: BillingScope, req: BillingLimitRequest, ip?: string): Promise<BillingLimit> {
    const userId = this.scopeUser(p, scope);
    if (!Number.isInteger(req.monthlyCap) || req.monthlyCap < 0 || req.monthlyCap > 100_000_000) throw badRequest('monthlyCap must be a whole number of minor units between 0 and 100000000', { monthlyCap: 'out of range' });
    if (typeof req.hardStop !== 'boolean') throw badRequest('hardStop must be true or false', { hardStop: 'boolean' });
    return this.tx(p, async (tx) => {
      await tx
        .insertInto('billing_limits')
        .values({ org_id: p.orgId, user_id: userId, monthly_cap: req.monthlyCap, hard_stop: req.hardStop, updated_by: p.sub })
        .onConflict((oc) => oc.columns(['org_id', 'scope_key']).doUpdateSet({ monthly_cap: req.monthlyCap, hard_stop: req.hardStop, updated_by: p.sub, updated_at: this.now() }))
        .execute();
      await audit(tx, actorOf(p, ip), 'billing.limit', scope, userId ?? p.orgId, { monthlyCap: req.monthlyCap, hardStop: req.hardStop, currency: this.currency });
      const s = await this.accountState(tx, p.orgId, userId);
      return this.limitView(s, s.spent);
    });
  }

  /* -------------------------------------------------------------- seats */

  private async seatsView(tx: Tx, orgId: string, sub?: { plan_id: string; seats: number; status: string }): Promise<BillingSeats> {
    const active = !!sub && ACTIVE.has(sub.status);
    const plan = sub ? this.plan(sub.plan_id) : this.plansFor('org')[0];
    const assigned = await tx
      .selectFrom('billing_seats as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.user_id', 'u.name', 'u.email', 's.assigned_at'])
      .where('s.org_id', '=', orgId)
      .orderBy('u.name')
      .execute();
    const seated = new Set(assigned.map((a) => a.user_id));
    const members = await tx
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.name', 'u.email'])
      .where('m.org_id', '=', orgId)
      .where('m.status', '=', 'active')
      .orderBy('u.name')
      .execute();
    return {
      purchased: active ? sub!.seats : 0,
      assigned: assigned.map((a) => ({ userId: a.user_id, name: a.name, email: a.email, assignedAt: a.assigned_at.toISOString() })),
      unassigned: members.filter((m) => !seated.has(m.id)).map((m) => ({ userId: m.id, name: m.name, email: m.email })),
      canChange: this.enabled && active && !!plan?.perSeat,
      minSeats: plan?.minSeats ?? 1,
      maxSeats: plan?.maxSeats ?? 100000,
    };
  }

  async seats(p: Principal): Promise<BillingSeats> {
    authorize(p, 'billing.manage', { kind: 'org' });
    return this.tx(p, async (tx) => this.seatsView(tx, p.orgId, await this.latestPlanSub(tx, p.orgId, null)));
  }

  async assignSeat(p: Principal, userId: string, ip?: string): Promise<BillingSeats> {
    authorize(p, 'billing.manage', { kind: 'org' });
    if (typeof userId !== 'string' || !userId) throw badRequest('userId is required', { userId: 'required' });
    return this.tx(p, async (tx) => {
      const sub = await this.latestPlanSub(tx, p.orgId, null);
      if (!sub || !ACTIVE.has(sub.status)) throw conflict('The organisation has no active plan with seats; buy seats first.');
      const member = await tx.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['u.id', 'u.name']).where('m.org_id', '=', p.orgId).where('m.user_id', '=', userId).where('m.status', '=', 'active').executeTakeFirst();
      if (!member) throw notFound('Member');
      // Serialise seat changes per org so two admins cannot both take the last seat.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`seats:${p.orgId}`}))`.execute(tx);
      const taken = await tx.selectFrom('billing_seats').select(sql<number>`count(*)::int`.as('n')).where('org_id', '=', p.orgId).executeTakeFirstOrThrow();
      const already = await tx.selectFrom('billing_seats').select('user_id').where('org_id', '=', p.orgId).where('user_id', '=', userId).executeTakeFirst();
      if (!already) {
        if (Number(taken.n) >= sub.seats) throw conflict(`All ${sub.seats} seats are assigned. Buy more seats or unassign someone first.`);
        await tx.insertInto('billing_seats').values({ org_id: p.orgId, user_id: userId, assigned_by: p.sub }).execute();
        await audit(tx, actorOf(p, ip), 'billing.seat_assign', 'user', userId, { plan: sub.plan_id, seats: sub.seats }, member.name);
      }
      return this.seatsView(tx, p.orgId, sub);
    });
  }

  async unassignSeat(p: Principal, userId: string, ip?: string): Promise<BillingSeats> {
    authorize(p, 'billing.manage', { kind: 'org' });
    return this.tx(p, async (tx) => {
      const gone = await tx.deleteFrom('billing_seats').where('org_id', '=', p.orgId).where('user_id', '=', userId).returning('user_id').executeTakeFirst();
      if (!gone) throw notFound('Seat');
      await audit(tx, actorOf(p, ip), 'billing.seat_unassign', 'user', userId, {});
      return this.seatsView(tx, p.orgId, await this.latestPlanSub(tx, p.orgId, null));
    });
  }

  /** Changes the seat count: the subscription item's quantity, prorated by Stripe. */
  async setSeatCount(p: Principal, seats: number, ip?: string): Promise<BillingSeats> {
    authorize(p, 'billing.manage', { kind: 'org' });
    const stripe = this.stripe();
    return this.tx(p, async (tx) => {
      const sub = await this.latestPlanSub(tx, p.orgId, null);
      if (!sub || !ACTIVE.has(sub.status)) throw conflict('The organisation has no active per-seat plan; subscribe first.');
      const plan = this.plan(sub.plan_id);
      if (!plan?.perSeat) throw conflict(`${plan?.name ?? sub.plan_id} is not billed per seat.`);
      const min = plan.minSeats ?? 1;
      const max = plan.maxSeats ?? 100000;
      if (!Number.isInteger(seats) || seats < min || seats > max) throw badRequest(`seats must be between ${min} and ${max}`, { seats: 'out of range' });
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`seats:${p.orgId}`}))`.execute(tx);
      const taken = Number((await tx.selectFrom('billing_seats').select(sql<number>`count(*)::int`.as('n')).where('org_id', '=', p.orgId).executeTakeFirstOrThrow()).n);
      if (seats < taken) throw conflict(`${taken} seats are assigned; unassign ${taken - seats} before going down to ${seats}.`);
      if (seats !== sub.seats) {
        const remote = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const item = remote.items.data.find((i) => i.price?.lookup_key === sub.price_lookup_key) ?? remote.items.data[0];
        if (!item) throw new HttpError(502, 'The Stripe subscription has no items');
        await stripe.subscriptions.update(sub.stripe_subscription_id, { items: [{ id: item.id, quantity: seats }], proration_behavior: 'create_prorations' }, `seats:${sub.stripe_subscription_id}:${seats}:${randomUUID()}`);
        await tx.updateTable('billing_subscriptions').set({ seats, updated_at: this.now() }).where('id', '=', sub.id).execute();
        await audit(tx, actorOf(p, ip), 'billing.seats', 'subscription', sub.stripe_subscription_id, { from: sub.seats, to: seats, proration: 'create_prorations' }, plan.name);
      }
      return this.seatsView(tx, p.orgId, { ...sub, seats });
    });
  }

  /* ------------------------------------------------------------ webhook */

  /**
   * Verifies, records and applies a Stripe event. An event counts as handled
   * (`duplicate` on a redelivery) only once it was applied or ignored. apply()
   * runs under a savepoint, so a failure leaves none of its writes behind: the
   * event is recorded `failed` and, when a retry can succeed (Stripe or the
   * database had a moment), the route answers 503 so Stripe redelivers it and
   * the redelivery applies it again. A failure no retry can fix answers 200
   * (`failed`); `reconcile()` repairs the state either way.
   */
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
    let r: { outcome: WebhookOutcome; retry: boolean };
    try {
      r = await this.process(event);
    } catch (e) {
      // Outside the savepoint (the database itself): Stripe retries a transient failure.
      if (isRetryableBillingError(e)) throw new HttpError(503, 'The event could not be applied yet; Stripe retries it.', { code: 'upstream' });
      throw e;
    }
    if (r.retry) throw new HttpError(503, 'The event could not be applied yet; Stripe retries it.', { code: 'upstream' });
    return r.outcome;
  }

  /**
   * Records and applies one (verified) event; shared by the webhook and the replay of failed
   * events. Stripe is read before the transaction (see prefetch). Under the customer lock the
   * customer row's version is compared with the one seen before reading Stripe: if another
   * event or the reconciliation changed the customer meanwhile, the reads may be stale, so they
   * are done again (at most STALE_RETRIES times).
   */
  private async process(event: StripeEvent): Promise<{ outcome: WebhookOutcome; retry: boolean }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.processOnce(event, attempt >= STALE_RETRIES);
      } catch (e) {
        if (!(e instanceof StaleReadError) || attempt >= STALE_RETRIES) throw e;
      }
    }
  }

  private async processOnce(event: StripeEvent, lastTry: boolean): Promise<{ outcome: WebhookOutcome; retry: boolean }> {
    const mails: Mail[] = [];
    let retry = false;
    let pre: Prefetched;
    try {
      pre = await this.prefetch(event);
    } catch (e) {
      pre = { error: e };
    }
    const outcome = await withTenant(this.d.db, { platform: true }, async (tx): Promise<WebhookOutcome> => {
      await this.budget(tx);
      await tx.insertInto('billing_events').values({ stripe_event_id: event.id, type: event.type, org_id: null, user_id: null, livemode: event.livemode }).onConflict((oc) => oc.column('stripe_event_id').doNothing()).execute();
      // One delivery of an event at a time: a concurrent one waits here until the first commits.
      const row = await tx.selectFrom('billing_events').select(['id', 'status']).where('stripe_event_id', '=', event.id).forUpdate().executeTakeFirstOrThrow();
      if (row.status === 'processed' || row.status === 'ignored') return { eventId: event.id, type: event.type, status: 'duplicate' };
      // The customer lock is taken before the apply savepoint, so rolling that savepoint back
      // keeps it until commit. Its own savepoint, released at once (the lock stays with the
      // transaction), lets a lock timeout be recorded below instead of aborting the transaction.
      let lockFailure: unknown;
      if (pre.customerId && !pre.error) {
        await sql`SAVEPOINT billing_lock`.execute(tx);
        try {
          await this.lockCustomer(tx, pre.customerId);
          await sql`RELEASE SAVEPOINT billing_lock`.execute(tx);
        } catch (e) {
          await sql`ROLLBACK TO SAVEPOINT billing_lock`.execute(tx);
          lockFailure = e;
        }
        if (!lockFailure && (await this.customerVersion(tx, pre.customerId)) !== pre.version) {
          if (!lastTry) throw new StaleReadError();
          lockFailure = new TransientEventError('the customer kept changing while Stripe was read');
        }
      }
      // The savepoint covers apply() and its bookkeeping (outcome, audit): any failure in
      // between undoes all of it, and only the record of the failure is written below.
      await sql`SAVEPOINT billing_apply`.execute(tx);
      try {
        if (pre.error) throw pre.error;
        if (lockFailure) throw lockFailure;
        const r = await this.apply(tx, event, pre);
        await this.bumpCustomer(tx, pre.customerId);
        await tx
          .updateTable('billing_events')
          .set({ status: r.status, processed_at: this.now(), error: null, org_id: r.orgId ?? null, user_id: r.userId ?? null, summary: JSON.stringify(r.summary) })
          .where('id', '=', row.id)
          .execute();
        if (r.orgId) await audit(tx, { orgId: r.orgId, actorId: null, actorName: 'Stripe' }, 'billing.webhook', 'event', event.id, { type: event.type, status: r.status, ...r.summary });
        await sql`RELEASE SAVEPOINT billing_apply`.execute(tx);
        if (r.mails) mails.push(...r.mails);
        return { eventId: event.id, type: event.type, status: r.status };
      } catch (e) {
        if (e instanceof StaleReadError) throw e; // the whole transaction rolls back; process() reads again
        await sql`ROLLBACK TO SAVEPOINT billing_apply`.execute(tx);
        const message = e instanceof Error ? e.message : String(e);
        // A "not yet" that has lasted TRANSIENT_MAX_AGE_MS since Stripe created the event will not resolve: permanent.
        const expired = e instanceof TransientEventError && this.now().getTime() - event.created * 1000 > TRANSIENT_MAX_AGE_MS;
        retry = isRetryableBillingError(e) && !expired;
        // summary.retryable: the reconciliation replays only failures a retry can fix; object and
        // customer: which Stripe object failed (checkout looks up a Checkout whose event failed for good).
        await tx.updateTable('billing_events').set({ status: 'failed', processed_at: this.now(), error: message.slice(0, 500), summary: JSON.stringify({ retryable: retry, ...(typeof event.data.object.id === 'string' ? { object: event.data.object.id } : {}), ...(this.customerOf(event) ? { customer: this.customerOf(event) } : {}) }) }).where('id', '=', row.id).execute();
        this.d.log?.warn({ eventId: event.id, type: event.type, err: message, retry }, 'billing webhook failed');
        return { eventId: event.id, type: event.type, status: 'failed' };
      }
    });
    // Mail after commit: a mail server hiccup never rolls back billing state.
    await this.sendMails(mails);
    return { outcome, retry };
  }

  /** The customer the event is about (all handled event types concern one), else undefined. */
  private customerOf(event: StripeEvent): string | undefined {
    const obj = event.data.object;
    if (event.type === 'customer.updated') return typeof obj.id === 'string' ? obj.id : undefined;
    return typeof obj.customer === 'string' ? obj.customer : undefined;
  }

  /**
   * Stripe reads the event needs, before its transaction, so no read runs while the
   * transaction, its pooled connection and the customer lock are held. The customer row's
   * version is read first; processOnce() compares it under the lock (optimistic concurrency).
   */
  private async prefetch(event: StripeEvent): Promise<Prefetched> {
    const stripe = this.d.stripe;
    if (!stripe) return {};
    const obj = event.data.object;
    const pre: Prefetched = {};
    const handled = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'customer.updated'];
    if (!handled.includes(event.type)) return pre;
    const cus = this.customerOf(event);
    if (cus) {
      pre.customerId = cus;
      pre.version = await withTenant(this.d.db, { platform: true }, (tx) => this.customerVersion(tx, cus));
    }
    if (event.type === 'checkout.session.completed' && obj.mode === 'setup' && typeof obj.setup_intent === 'string') pre.setupIntent = await stripe.setupIntents.retrieve(obj.setup_intent);
    if (event.type === 'invoice.payment_failed' && typeof obj.id === 'string') pre.invoice = await stripe.invoices.retrieve(obj.id);
    if (cus && !event.type.startsWith('invoice.')) {
      pre.subs = await this.remoteSubscriptions(cus);
      await this.priceId(this.pricing.compute.lookupKey).catch(() => undefined);
    }
    if (cus && event.type === 'customer.updated') pre.customer = await this.remoteCustomer(cus);
    return pre;
  }

  /** All of a customer's subscriptions in Stripe (undefined when the customer is gone). */
  private async remoteSubscriptions(customer: string): Promise<StripeSubscription[] | undefined> {
    const subs: StripeSubscription[] = [];
    try {
      for (let after: string | undefined; ; ) {
        const page = await this.stripe().subscriptions.list({ customer, status: 'all', limit: 100, ...(after ? { starting_after: after } : {}) });
        subs.push(...page.data);
        if (!page.has_more || page.data.length === 0) break;
        after = page.data.at(-1)!.id;
      }
    } catch (e) {
      if (e instanceof StripeError && e.status === 404) return undefined;
      throw e;
    }
    return subs;
  }

  private async remoteCustomer(customer: string): Promise<StripeCustomer | null> {
    try {
      const c = await this.stripe().customers.retrieve(customer);
      return c.deleted ? null : c;
    } catch (e) {
      if (e instanceof StripeError && e.status === 404) return null;
      throw e;
    }
  }

  /** The billing customer row's version: its updated_at, exactly (text keeps microseconds). */
  private async customerVersion(tx: Tx, stripeCustomerId: string): Promise<string | null> {
    const r = await tx.selectFrom('billing_customers').select(sql<string>`updated_at::text`.as('v')).where('stripe_customer_id', '=', stripeCustomerId).executeTakeFirst();
    return r?.v ?? null;
  }

  /** Marks the customer changed (a new version) at the end of every locked write. */
  private async bumpCustomer(tx: Tx, stripeCustomerId: string | undefined): Promise<void> {
    if (stripeCustomerId) await tx.updateTable('billing_customers').set({ updated_at: sql`clock_timestamp()` }).where('stripe_customer_id', '=', stripeCustomerId).execute();
  }

  /**
   * The time budget of a billing transaction: waiting for a lock, any one statement and any
   * idle stretch (a Stripe write) are each bounded, so one event cannot hold the customer lock
   * and a pooled connection for minutes; Stripe writes check the overall deadline first.
   */
  private async budget(tx: Tx): Promise<void> {
    const ms = this.d.txBudgetMs ?? 30_000;
    this.deadlines.set(tx, Date.now() + ms);
    await sql`SELECT set_config('lock_timeout', ${`${Math.max(1, Math.floor(ms / 2))}ms`}, true), set_config('statement_timeout', ${`${ms}ms`}, true), set_config('idle_in_transaction_session_timeout', ${`${ms}ms`}, true)`.execute(tx);
  }

  /** Before a Stripe write inside a transaction: out of budget is a transient failure (retried later), not a hung lock. */
  private checkBudget(tx: Tx): void {
    const deadline = this.deadlines.get(tx);
    if (deadline !== undefined && Date.now() > deadline) throw new TransientEventError('the billing transaction ran out of time');
  }

  private async sendMails(mails: Mail[]): Promise<void> {
    for (const m of mails) await this.d.mailer?.send(m).catch((e: unknown) => this.d.log?.warn({ err: e instanceof Error ? e.message : String(e), subject: m.subject }, 'billing mail failed'));
  }

  /**
   * Serialises everything that changes one billing customer (webhooks, the
   * reconciliation) until the transaction ends, so two events about the same
   * customer cannot both see "no compute subscription" or interleave writes.
   */
  private async lockCustomer(tx: Tx, stripeCustomerId: string | undefined): Promise<void> {
    if (stripeCustomerId) await sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-customer:${stripeCustomerId}`}))`.execute(tx);
  }

  /**
   * Stripe's current state of a subscription, read before the transaction (and checked for
   * staleness under the lock). Events arrive late and out of order, so the event's own
   * snapshot may be older than what was applied; the live object never is. A subscription
   * Stripe no longer returns (its customer was deleted) falls back to the snapshot.
   */
  private currentSubscription(sent: StripeSubscription, pre: Prefetched): StripeSubscription {
    return pre.subs?.find((x) => x.id === sent.id) ?? sent;
  }

  /* ------------------------------------------------------- reconciliation */

  /**
   * Repairs billing state from Stripe, for whatever a webhook missed: replays
   * events that failed to apply (Stripe keeps events 30 days), then, per
   * billing customer, re-reads the customer and all its subscriptions and
   * writes what changed (plans, entitlements, the compute subscription,
   * payment method, dunning). Idempotent; runs every CT_BILLING_RECONCILE_MS.
   */
  async reconcile(): Promise<{ replayed: number; customers: number; changed: number; errors: number; skipped?: boolean }> {
    this.stripe();
    // One run at a time across all gateway replicas: a session-level advisory lock held on one
    // connection for the whole run; another replica that finds it taken skips this round.
    return this.d.db.connection().execute(async (conn) => {
      const got = await sql<{ ok: boolean }>`SELECT pg_try_advisory_lock(hashtext('billing-reconcile')) AS ok`.execute(conn);
      if (!got.rows[0]?.ok) return { replayed: 0, customers: 0, changed: 0, errors: 0, skipped: true };
      try {
        return await this.reconcileRun();
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtext('billing-reconcile'))`.execute(conn);
      }
    });
  }

  private async reconcileRun(): Promise<{ replayed: number; customers: number; changed: number; errors: number }> {
    const stripe = this.stripe();
    const out = { replayed: 0, customers: 0, changed: 0, errors: 0 };
    const since = new Date(this.now().getTime() - 29 * DAY);
    // Only failures a retry can fix (a permanent one would fail again and fill every page).
    const failed = await withTenant(this.d.db, { platform: true }, (tx) =>
      tx.selectFrom('billing_events').select('stripe_event_id').where('status', '=', 'failed').where('received_at', '>=', since).where(sql<boolean>`coalesce((summary->>'retryable')::boolean, true)`).orderBy('received_at').limit(200).execute(),
    );
    for (const f of failed) {
      try {
        const event = await stripe.events.retrieve(f.stripe_event_id);
        if (event.livemode) continue;
        const r = await this.process(event);
        if (r.outcome.status === 'processed' || r.outcome.status === 'ignored') out.replayed++;
        else out.errors++;
      } catch (e) {
        out.errors++;
        this.d.log?.warn({ eventId: f.stripe_event_id, err: e instanceof Error ? e.message : String(e) }, 'billing reconcile: event replay failed');
      }
    }
    const customers = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('billing_customers').select('stripe_customer_id').orderBy('created_at').execute());
    for (const c of customers) {
      try {
        out.changed += await this.reconcileCustomer(c.stripe_customer_id);
        out.customers++;
      } catch (e) {
        out.errors++;
        this.d.log?.warn({ customer: c.stripe_customer_id, err: e instanceof Error ? e.message : String(e) }, 'billing reconcile: customer failed');
      }
    }
    return out;
  }

  /**
   * Brings one customer in line with Stripe; returns how many records changed. Stripe is read
   * before the transaction; under the customer lock the row's version must be the one seen
   * before reading, else a webhook applied newer state meanwhile and the reads are repeated.
   */
  private async reconcileCustomer(stripeCustomerId: string): Promise<number> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.reconcileCustomerOnce(stripeCustomerId);
      } catch (e) {
        if (!(e instanceof StaleReadError) || attempt >= STALE_RETRIES) throw e;
      }
    }
  }

  private async reconcileCustomerOnce(stripeCustomerId: string): Promise<number> {
    const version = await withTenant(this.d.db, { platform: true }, (tx) => this.customerVersion(tx, stripeCustomerId));
    const remote = await this.remoteCustomer(stripeCustomerId);
    if (!remote) return 0;
    const subs = (await this.remoteSubscriptions(stripeCustomerId)) ?? [];
    await this.priceId(this.pricing.compute.lookupKey).catch(() => undefined);
    const mails: Mail[] = [];
    const changed = await withTenant(this.d.db, { platform: true }, async (tx) => {
      await this.budget(tx);
      await this.lockCustomer(tx, stripeCustomerId);
      if ((await this.customerVersion(tx, stripeCustomerId)) !== version) throw new StaleReadError();
      let n = 0;
      for (const sub of subs) {
        const known = await tx.selectFrom('billing_subscriptions').select(['status', 'seats', 'cancel_at_period_end', 'current_period_end', 'price_lookup_key']).where('stripe_subscription_id', '=', sub.id).executeTakeFirst();
        if (known && !subscriptionDiffers(known, sub)) continue;
        if (!known && !ACTIVE.has(sub.status) && sub.status !== 'incomplete') continue; // ended before we ever saw it
        if (this.isComputeSub(sub)) await this.upsertComputeSubscription(tx, sub);
        else {
          try {
            await this.upsertSubscription(tx, sub, sub.metadata ?? {});
          } catch (e) {
            if (e instanceof PermanentEventError) continue; // not one of our plans
            throw e;
          }
        }
        n++;
      }
      let cus = await this.customerByStripeId(tx, stripeCustomerId);
      if (!cus) return n;
      const pm = remote.invoice_settings?.default_payment_method;
      if (pm && !cus.has_payment_method) {
        await tx.updateTable('billing_customers').set({ has_payment_method: true, updated_at: this.now() }).where('id', '=', cus.id).execute();
        n++;
      }
      cus = (await this.customerByStripeId(tx, stripeCustomerId))!;
      const plan = await this.latestPlanSub(tx, cus.org_id, cus.user_id);
      if ((cus.has_payment_method || (plan && ACTIVE.has(plan.status))) && !cus.compute_subscription_id) {
        if (await this.ensureComputeSubscription(tx, cus, subs)) n++;
      }
      const d = await this.recomputeDunning(tx, cus);
      if (d.transition) n++;
      mails.push(...d.mails);
      if (n > 0) {
        await this.bumpCustomer(tx, stripeCustomerId);
        await audit(tx, { orgId: cus.org_id, actorId: null, actorName: 'Stripe' }, 'billing.reconcile', 'customer', stripeCustomerId, { changes: n });
      }
      return n;
    });
    await this.sendMails(mails);
    return changed;
  }

  private isComputeSub(sub: StripeSubscription): boolean {
    if (sub.metadata?.ct_kind === 'compute') return true;
    return !!sub.items?.data?.some((i) => i.price?.lookup_key === this.pricing.compute.lookupKey);
  }

  private async apply(tx: Tx, event: StripeEvent, pre: Prefetched = {}): Promise<ApplyResult> {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const meta = (obj.metadata ?? {}) as Record<string, string>;
        const cusId = typeof obj.customer === 'string' ? obj.customer : undefined;
        await this.lockCustomer(tx, cusId);
        if (obj.mode === 'setup') {
          const si = typeof obj.setup_intent === 'string' ? obj.setup_intent : undefined;
          const cus = cusId ? await this.customerByStripeId(tx, cusId) : undefined;
          if (!si || !cus) return { status: 'ignored', ...(meta.ct_org_id ? { orgId: meta.ct_org_id } : {}), summary: { reason: !si ? 'no setup intent on session' : 'unknown customer', session: obj.id } };
          const intent = pre.setupIntent ?? (await this.stripe().setupIntents.retrieve(si));
          if (!intent.payment_method) return { status: 'ignored', orgId: cus.org_id, userId: cus.user_id, summary: { reason: 'setup intent has no payment method', session: obj.id } };
          this.checkBudget(tx);
          await this.stripe().customers.update(cus.stripe_customer_id, { invoice_settings: { default_payment_method: intent.payment_method } });
          const mails = await this.paymentMethodSaved(tx, cus, pre.subs);
          return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { session: obj.id, setupIntent: si, paymentMethod: 'saved', computeSubscription: mails.computeSub ?? null }, mails: mails.mails };
        }
        const subId = typeof obj.subscription === 'string' ? obj.subscription : undefined;
        if (!subId) return { status: 'ignored', ...(meta.ct_org_id ? { orgId: meta.ct_org_id } : {}), summary: { reason: 'no subscription on session', session: obj.id } };
        const sub = pre.subs?.find((x) => x.id === subId) ?? (await this.stripe().subscriptions.retrieve(subId));
        const r = await this.upsertSubscription(tx, sub, meta);
        // The plan's payment method also pays for compute: make it the customer default and open the metered subscription.
        const cus = await this.customerByStripeId(tx, sub.customer);
        let computeSub: string | undefined;
        let mails: Mail[] = [];
        if (cus) {
          this.checkBudget(tx);
          if (sub.default_payment_method) await this.stripe().customers.update(cus.stripe_customer_id, { invoice_settings: { default_payment_method: sub.default_payment_method } });
          const saved = await this.paymentMethodSaved(tx, cus, pre.subs);
          computeSub = saved.computeSub;
          mails = saved.mails;
        }
        return { status: 'processed', orgId: r.orgId, userId: r.userId, summary: { session: obj.id, subscription: sub.id, plan: r.planId, status: sub.status, seats: r.seats, computeSubscription: computeSub ?? null }, mails };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sent = obj as unknown as StripeSubscription;
        const sub = this.currentSubscription(sent, pre);
        // The person was erased (docs/gdpr.md): the closing events of the deleted Stripe customer have nothing left to update.
        const erasedUser = sub.metadata?.ct_user_id;
        if (erasedUser && !(await this.customerByStripeId(tx, sub.customer)) && !(await tx.selectFrom('users').select('id').where('id', '=', erasedUser).executeTakeFirst())) {
          return { status: 'ignored', summary: { reason: 'subject erased', subscription: sub.id } };
        }
        if (this.isComputeSub(sub)) {
          const r = await this.upsertComputeSubscription(tx, sub);
          const d = await this.recomputeDunning(tx, r.customer);
          return { status: 'processed', orgId: r.customer.org_id, userId: r.customer.user_id, summary: { subscription: sub.id, kind: 'compute', status: sub.status, dunning: d.transition ?? 'unchanged' }, mails: d.mails };
        }
        const r = await this.upsertSubscription(tx, sub, sub.metadata ?? {});
        const cus = await this.customerByStripeId(tx, sub.customer);
        // A plan bought outside Checkout (portal, API) still needs the metered compute subscription.
        let computeSub: string | undefined;
        if (cus && ACTIVE.has(sub.status) && !cus.compute_subscription_id && event.type !== 'customer.subscription.deleted') {
          this.checkBudget(tx);
          if (sub.default_payment_method) await this.stripe().customers.update(cus.stripe_customer_id, { invoice_settings: { default_payment_method: sub.default_payment_method } });
          computeSub = await this.ensureComputeSubscription(tx, cus, pre.subs);
        }
        const d = cus ? await this.recomputeDunning(tx, cus) : { mails: [] as Mail[], transition: undefined };
        return { status: 'processed', orgId: r.orgId, userId: r.userId, summary: { subscription: sub.id, plan: r.planId, status: sub.status, seats: r.seats, cancelAtPeriodEnd: sub.cancel_at_period_end, dunning: d.transition ?? 'unchanged', ...(computeSub ? { computeSubscription: computeSub } : {}) }, mails: d.mails };
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const cusId = typeof obj.customer === 'string' ? obj.customer : undefined;
        await this.lockCustomer(tx, cusId);
        const cus = cusId ? await this.customerByStripeId(tx, cusId) : undefined;
        const summary = { invoice: obj.id, amountPaid: obj.amount_paid, amountDue: obj.amount_due, currency: obj.currency, customer: cusId, attempt: obj.attempt_count };
        if (!cus) return { status: 'processed', summary };
        const failed = event.type === 'invoice.payment_failed';
        if (failed && typeof obj.id === 'string') {
          // A late failure for an invoice that has been paid (or voided) since must not restart dunning.
          const now = pre.invoice ?? (await this.stripe().invoices.retrieve(obj.id));
          if (now.status === 'paid' || now.status === 'void') return { status: 'ignored', orgId: cus.org_id, userId: cus.user_id, summary: { ...summary, reason: `invoice is ${now.status} now` } };
        }
        await tx
          .updateTable('billing_customers')
          .set({ invoice_failed_at: failed ? (cus.invoice_failed_at ?? this.now()) : null, ...(failed ? {} : { has_payment_method: true }), updated_at: this.now() })
          .where('id', '=', cus.id)
          .execute();
        const d = await this.recomputeDunning(tx, { ...cus, invoice_failed_at: failed ? (cus.invoice_failed_at ?? this.now()) : null });
        return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { ...summary, dunning: d.transition ?? 'unchanged' }, mails: d.mails };
      }
      case 'customer.updated': {
        await this.lockCustomer(tx, typeof obj.id === 'string' ? obj.id : undefined);
        const cus = typeof obj.id === 'string' ? await this.customerByStripeId(tx, obj.id) : undefined;
        if (!cus) return { status: 'ignored', summary: { reason: 'unknown customer', customer: obj.id } };
        // Stripe's current customer, read under the lock: the event's snapshot may be older than what was applied.
        const current: { invoice_settings?: { default_payment_method?: string | null } } = pre.customer ?? (obj as { invoice_settings?: { default_payment_method?: string | null } });
        const pm = current.invoice_settings?.default_payment_method ?? null;
        if (pm && !cus.has_payment_method) {
          const saved = await this.paymentMethodSaved(tx, cus, pre.subs);
          return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { customer: cus.stripe_customer_id, paymentMethod: 'saved' }, mails: saved.mails };
        }
        if (!pm && cus.has_payment_method) {
          const plan = await this.latestPlanSub(tx, cus.org_id, cus.user_id);
          if (!plan || !ACTIVE.has(plan.status)) await tx.updateTable('billing_customers').set({ has_payment_method: false, updated_at: this.now() }).where('id', '=', cus.id).execute();
          return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { customer: cus.stripe_customer_id, paymentMethod: 'removed' } };
        }
        return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { customer: cus.stripe_customer_id, paymentMethod: pm ? 'unchanged' : 'none' } };
      }
      default:
        return { status: 'ignored', summary: { reason: 'event type not handled' } };
    }
  }

  private async customerByStripeId(tx: Tx, stripeCustomerId: string): Promise<CustomerRow | undefined> {
    return tx
      .selectFrom('billing_customers')
      .select(['id', 'org_id', 'user_id', 'stripe_customer_id', 'email', 'has_payment_method', 'invoice_failed_at', 'delinquent_since', 'compute_subscription_id'])
      .where('stripe_customer_id', '=', stripeCustomerId)
      .executeTakeFirst();
  }

  /** A payment method is on file: record it and open the compute (metered) subscription if there is none. */
  private async paymentMethodSaved(tx: Tx, cus: CustomerRow, subs?: StripeSubscription[]): Promise<{ computeSub?: string; mails: Mail[] }> {
    await tx.updateTable('billing_customers').set({ has_payment_method: true, updated_at: this.now() }).where('id', '=', cus.id).execute();
    const computeSub = await this.ensureComputeSubscription(tx, cus, subs);
    return { ...(computeSub ? { computeSub } : {}), mails: [] };
  }

  /**
   * One metered compute subscription per billing customer (the metered price
   * only, no fixed fee): meter events for the customer are billed through it.
   * Exactly one, or usage would be billed twice. Under the customer lock the
   * row is read again (a concurrent webhook may have just opened one), Stripe
   * is asked for a live compute subscription we do not know yet (a delivery
   * whose commit failed after Stripe created it), and the create carries an
   * idempotency key per customer and generation, not per event, so a retry or
   * a second event in the same generation gets the same subscription back.
   */
  private async ensureComputeSubscription(tx: Tx, known: CustomerRow, remoteSubs?: StripeSubscription[]): Promise<string | undefined> {
    await this.lockCustomer(tx, known.stripe_customer_id);
    const cus = (await this.customerByStripeId(tx, known.stripe_customer_id)) ?? known;
    if (cus.compute_subscription_id) {
      const row = await tx.selectFrom('billing_subscriptions').select('status').where('stripe_subscription_id', '=', cus.compute_subscription_id).executeTakeFirst();
      if (!row || ACTIVE.has(row.status) || row.status === 'incomplete') return cus.compute_subscription_id;
    }
    let price: string;
    try {
      price = await this.priceId(this.pricing.compute.lookupKey);
    } catch (e) {
      this.d.log?.warn({ lookupKey: this.pricing.compute.lookupKey, err: e instanceof Error ? e.message : String(e) }, 'billing: no metered compute price (run stripe:sync); compute subscription not created');
      return undefined;
    }
    // Read before the transaction by the caller (and checked for staleness under the lock).
    const remote = remoteSubs ?? (await this.remoteSubscriptions(cus.stripe_customer_id)) ?? [];
    const live = remote.find((x) => this.isComputeSub(x) && (ACTIVE.has(x.status) || x.status === 'incomplete'));
    if (live) {
      await this.upsertComputeSubscription(tx, live, cus);
      return live.id;
    }
    this.checkBudget(tx);
    const generation = Number((await tx.selectFrom('billing_subscriptions').select(sql<number>`count(*)::int`.as('n')).where('customer_id', '=', cus.id).where('kind', '=', 'compute').executeTakeFirstOrThrow()).n);
    const sub = await this.stripe().subscriptions.create(
      { customer: cus.stripe_customer_id, items: [{ price }], metadata: { ct_kind: 'compute', ct_org_id: cus.org_id, ct_user_id: cus.user_id ?? '', ct_scope: cus.user_id ? 'user' : 'org' } },
      `computesub:${cus.stripe_customer_id}:${generation}`,
    );
    await this.upsertComputeSubscription(tx, sub, cus);
    return sub.id;
  }

  private async upsertComputeSubscription(tx: Tx, sub: StripeSubscription, known?: CustomerRow): Promise<{ customer: CustomerRow }> {
    const customer = known ?? (await this.customerByStripeId(tx, sub.customer));
    // We create the customer row before any compute subscription: it may not be committed yet. Retry.
    if (!customer) throw new TransientEventError(`compute subscription ${sub.id}: customer ${sub.customer} not recorded yet`);
    const status: SubscriptionStatus = STATUSES.has(sub.status) ? (sub.status as SubscriptionStatus) : 'incomplete';
    const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    await tx
      .insertInto('billing_subscriptions')
      .values({
        org_id: customer.org_id,
        user_id: customer.user_id,
        customer_id: customer.id,
        stripe_subscription_id: sub.id,
        kind: 'compute',
        plan_id: 'compute',
        price_lookup_key: this.pricing.compute.lookupKey,
        billing_interval: 'monthly',
        seats: 1,
        status,
        current_period_end: periodEnd ? new Date(periodEnd * 1000) : null,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        livemode: false,
      })
      .onConflict((oc) => oc.column('stripe_subscription_id').doUpdateSet({ status, current_period_end: periodEnd ? new Date(periodEnd * 1000) : null, cancel_at_period_end: !!sub.cancel_at_period_end, updated_at: this.now() }))
      .execute();
    const live = ACTIVE.has(status) || status === 'incomplete';
    if (live && customer.compute_subscription_id !== sub.id) await tx.updateTable('billing_customers').set({ compute_subscription_id: sub.id, updated_at: this.now() }).where('id', '=', customer.id).execute();
    if (!live && customer.compute_subscription_id === sub.id) await tx.updateTable('billing_customers').set({ compute_subscription_id: null, updated_at: this.now() }).where('id', '=', customer.id).execute();
    return { customer };
  }

  /**
   * Dunning: delinquent while the last invoice failed or a subscription of the
   * customer is past_due or unpaid. Entering starts the grace period (and
   * mails); leaving restores access (and mails).
   */
  private async recomputeDunning(tx: Tx, cus: CustomerRow): Promise<{ transition?: 'started' | 'cleared'; mails: Mail[] }> {
    const fresh = await this.customerByStripeId(tx, cus.stripe_customer_id);
    if (!fresh) return { mails: [] };
    const bad = await tx.selectFrom('billing_subscriptions').select('id').where('customer_id', '=', fresh.id).where('status', 'in', [...DELINQUENT]).executeTakeFirst();
    const delinquent = !!fresh.invoice_failed_at || !!bad;
    if (delinquent === !!fresh.delinquent_since) return { mails: [] };
    const since = delinquent ? this.now() : null;
    await tx.updateTable('billing_customers').set({ delinquent_since: since, updated_at: this.now() }).where('id', '=', fresh.id).execute();
    const transition = delinquent ? 'started' : 'cleared';
    await audit(tx, { orgId: fresh.org_id, actorId: null, actorName: 'Stripe' }, 'billing.dunning', 'customer', fresh.stripe_customer_id, { state: transition, graceDays: this.pricing.graceDays, scope: fresh.user_id ? 'user' : 'org' });
    return { transition, mails: await this.dunningMails(tx, fresh, transition, since) };
  }

  private async dunningMails(tx: Tx, cus: CustomerRow, transition: 'started' | 'cleared', since: Date | null): Promise<Mail[]> {
    if (!this.d.mailer) return [];
    let to: string[];
    if (cus.user_id) {
      const u = await tx.selectFrom('users').select('email').where('id', '=', cus.user_id).executeTakeFirst();
      to = [cus.email ?? u?.email].filter((e): e is string => !!e);
    } else {
      const admins = await tx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select('u.email')
        .where('m.org_id', '=', cus.org_id)
        .where('m.status', '=', 'active')
        .where(sql<boolean>`'org_admin' = ANY(m.roles)`)
        .execute();
      to = admins.map((a) => a.email);
    }
    const link = `${this.d.webUrl}${cus.user_id ? '/account/billing' : '/admin/billing'}`;
    const brand = this.d.site.brand.name;
    const ends = since ? new Date(since.getTime() + this.pricing.graceDays * DAY) : undefined;
    const subject = transition === 'started' ? `${brand}: a payment failed, please update your payment method` : `${brand}: payment received, lab access restored`;
    const text =
      transition === 'started'
        ? `A payment for your ${brand} ${cus.user_id ? 'account' : 'organisation'} failed.\n\nLabs keep working until ${ends!.toUTCString()} (a ${this.pricing.graceDays}-day grace period). After that, new paid labs cannot be started until the payment goes through; running labs are never stopped.\n\nUpdate the payment method in the billing portal: ${link}\n\n(Stripe test mode: no real money moves.)`
        : `The outstanding payment for your ${brand} ${cus.user_id ? 'account' : 'organisation'} went through. New labs can be started again.\n\nBilling: ${link}\n\n(Stripe test mode: no real money moves.)`;
    return to.map((addr) => ({ to: addr, subject, text }));
  }

  /**
   * Entitlements follow every active plan subscription of the scope, not the
   * one an event was about: the highest plan level wins, and only when none is
   * active does the scope fall back to the free plan. So cancelling one of two
   * subscriptions (two Checkouts raced, or a plan bought in the portal) never
   * drops a still-paying account to Free.
   */
  private async recomputeEntitlements(tx: Tx, orgId: string, userId: string | null): Promise<void> {
    const subs = await this.planSubs(tx, orgId, userId);
    const best = this.bestActive(subs);
    const activeCount = subs.filter((s) => ACTIVE.has(s.status)).length;
    if (activeCount > 1) this.d.log?.warn({ orgId, scope: userId ? 'user' : 'org', subscriptions: activeCount }, 'billing: more than one active plan subscription; entitlements follow the highest plan');
    const effective = best ? this.plan(best.plan_id) : this.defaultPlan();
    if (!effective) return;
    const source = best ? 'subscription' : 'default';
    const subscriptionId = best?.id ?? null;
    await tx
      .insertInto('billing_entitlements')
      .values({ org_id: orgId, user_id: userId, plan_id: effective.id, entitlements: JSON.stringify(effective.entitlements), source, subscription_id: subscriptionId })
      .onConflict((oc) => oc.columns(['org_id', 'scope_key']).doUpdateSet({ plan_id: effective.id, entitlements: JSON.stringify(effective.entitlements), source, subscription_id: subscriptionId, updated_at: this.now() }))
      .execute();
  }

  /** Writes the subscription's latest state and the entitlements that follow from all the scope's subscriptions. */
  private async upsertSubscription(tx: Tx, sub: StripeSubscription, meta: Record<string, string>): Promise<{ orgId: string; userId: string | null; planId: string; seats: number }> {
    const item = sub.items?.data?.find((i) => !!this.planByLookupKey(i.price?.lookup_key)) ?? sub.items?.data?.[0];
    const found = this.planByLookupKey(item?.price?.lookup_key) ?? (meta.ct_plan_id ? { plan: this.plan(meta.ct_plan_id), interval: (meta.ct_interval as PlanInterval) || 'monthly' } : undefined);
    if (!found?.plan) throw new PermanentEventError(`subscription ${sub.id}: no plan for lookup key ${item?.price?.lookup_key ?? '(none)'}`);
    const plan = found.plan;
    // The org comes from the metadata we set at checkout, else from the customer we created.
    let orgId = meta.ct_org_id;
    let userId: string | null = meta.ct_user_id || null;
    let customerRow = await tx.selectFrom('billing_customers').select(['id', 'org_id', 'user_id']).where('stripe_customer_id', '=', sub.customer).executeTakeFirst();
    if (!customerRow) {
      if (!orgId) throw new PermanentEventError(`subscription ${sub.id}: unknown customer ${sub.customer} and no ct_org_id metadata`);
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
    await tx
      .insertInto('billing_subscriptions')
      .values({
        org_id: orgId,
        user_id: userId,
        customer_id: customerRow.id,
        stripe_subscription_id: sub.id,
        kind: 'plan',
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
      .execute();
    const active = ACTIVE.has(status);
    await this.recomputeEntitlements(tx, orgId, userId);
    // A plan subscription implies a payment method.
    if (active) await tx.updateTable('billing_customers').set({ has_payment_method: true, updated_at: this.now() }).where('id', '=', customerRow.id).where('has_payment_method', '=', false).execute();
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

const round2 = (n: number) => Math.round(n * 100) / 100;
/** An open plan Checkout younger than this may be mid-payment: a new checkout waits instead of expiring it. */
const CHECKOUT_IN_PROGRESS_S = 5 * 60;
/** How long a completed plan Checkout whose subscription is not recorded blocks a new checkout. */
const PLAN_PENDING_S = 60 * 60;

/** Minor units as money, e.g. 5000 EUR -> "€50.00". */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** An event no retry can apply (not one of our customers or plans): recorded `failed`, answered 200. */
export class PermanentEventError extends Error {}

/** An event that cannot be applied yet but will be (a row another transaction is about to commit). */
export class TransientEventError extends Error {}

/** The customer changed between reading Stripe and taking its lock: read again. */
class StaleReadError extends Error {}
const STALE_RETRIES = 3;
/** How long a "not yet" (TransientEventError) is retried, counted from the event's creation in Stripe; then it is permanent. */
export const TRANSIENT_MAX_AGE_MS = 3_600_000;

/** Postgres SQLSTATEs a retry can get past: connection loss, serialization failures, deadlocks, lock/statement/idle timeouts (the transaction's own budget), shutdown, overload. */
const TRANSIENT_PG = /^(08...|25P03|40001|40P01|53300|55P03|57014|57P01|57P02|57P03)$/;
const TRANSIENT_NET = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);

/**
 * Whether Stripe should redeliver an event that failed. An allowlist: Stripe
 * 5xx, 429, timeouts and network errors; Postgres connection, serialization,
 * deadlock and overload errors; TransientEventError. Everything else (a bug,
 * a constraint, a refusal) is permanent: retrying would fail the same way.
 */
export function isRetryableBillingError(e: unknown): boolean {
  if (e instanceof TransientEventError) return true;
  if (e instanceof StripeError) return e.status === 0 || e.status === 429 || e.status >= 500;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (TRANSIENT_PG.test(code) || TRANSIENT_NET.has(code))) return true;
  return e instanceof Error && /Connection terminated|timeout exceeded when trying to connect/i.test(e.message);
}

/** Whether Stripe's subscription differs from the stored row in anything we record. */
function subscriptionDiffers(row: { status: string; seats: number; cancel_at_period_end: boolean; current_period_end: Date | null; price_lookup_key: string | null }, sub: StripeSubscription): boolean {
  const item = sub.items?.data?.[0];
  const end = sub.current_period_end ?? item?.current_period_end;
  if (row.status !== sub.status || row.cancel_at_period_end !== !!sub.cancel_at_period_end) return true;
  if ((row.current_period_end?.getTime() ?? null) !== (end ? end * 1000 : null)) return true;
  if (row.price_lookup_key !== null && !sub.items?.data?.some((i) => i.price?.lookup_key === row.price_lookup_key)) return true;
  return sub.items?.data?.some((i) => i.price?.lookup_key === row.price_lookup_key && i.quantity !== undefined && Math.max(1, i.quantity) !== row.seats) ?? false;
}

/** Stripe refuses a meter event whose identifier it has already accepted: it was reported. */
function isDuplicateMeterEvent(e: StripeError): boolean {
  return e.code === 'resource_already_exists' || (/identifier/i.test(e.message) && /(already|duplicate|exists|unique)/i.test(e.message));
}

/** 4xx other than auth, conflicts and rate limits will not succeed on retry. */
function isPermanent(e: StripeError): boolean {
  return e.status >= 400 && e.status < 500 && ![401, 403, 409, 429].includes(e.status);
}
