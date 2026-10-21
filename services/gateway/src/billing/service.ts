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
import { StripeApi, StripeError, verifyWebhook, WebhookError, type StripeEvent, type StripeSubscription } from './stripe.js';

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
 * - Plans (subscriptions) unlock premium features (src/entitlements,
 *   `plans.items[].features`) and, on the hosted edition, early-access labs
 *   (`plans.earlyAccess` rules and plan levels). Public labs are never gated by
 *   plan. Compute is billed on top of any plan.
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
  /** Labs by id (compute tier, early-access rules, titles). */
  labs?: ReadonlyMap<string, ContentLab>;
  /**
   * Gate early-access labs by plan level (`plans.earlyAccess`). On for the hosted
   * edition; off on self-hosted, where every lab present is usable. Default on.
   */
  earlyAccess?: boolean;
  /** Payment-failure and restore emails (Mailpit in dev). */
  mailer?: Mailer;
  /** Where the browser returns after Checkout or the portal (CT_WEB_URL). */
  webUrl: string;
  now?: () => Date;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

const ACTIVE: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due']);
const DELINQUENT: ReadonlySet<string> = new Set<SubscriptionStatus>(['past_due', 'unpaid']);
const STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);
const DAY = 86_400_000;
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
  labId: string;
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
  private readonly now: () => Date;
  private readonly priceIds = new Map<string, string>();
  private readonly facts = new Map<string, LabFacts & { title: string }>();
  private flushing: Promise<unknown> | undefined;

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

  private latestPlanSub(tx: Tx, orgId: string, userId: string | null) {
    return tx
      .selectFrom('billing_subscriptions')
      .selectAll()
      .where('org_id', '=', orgId)
      .where(sql`coalesce(user_id, '')`, '=', userId ?? '')
      .where('kind', '=', 'plan')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
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
    return { payer: scope, payerKey: userId ?? '', ...(customer ? { customer } : {}), level, paymentMethod: !!customer?.has_payment_method || subActive, dunning: this.dunningView(since), limit, spent };
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
    return { ...org, level: Math.max(own.level, this.pricing.level(orgPlan)), seat: { plan: orgPlan! } };
  }

  /**
   * The plans behind premium features (src/entitlements): the organisation's plan
   * (an active subscription or a manual grant), the person's own plan, and whether
   * they hold a seat of the organisation plan.
   */
  async plansOf(orgId: string, userId?: string): Promise<{ org?: SitePlan; user?: SitePlan; seated: boolean }> {
    return withTenant(this.d.db, { orgId, userId: userId ?? null }, async (tx) => {
      const keys = userId ? ['', userId] : [''];
      const rows = await tx.selectFrom('billing_entitlements').select(['scope_key', 'plan_id', 'source']).where('org_id', '=', orgId).where('scope_key', 'in', keys).execute();
      const planOf = (key: string) => {
        const r = rows.find((x) => x.scope_key === key);
        return r && r.source !== 'default' ? this.plan(r.plan_id) : undefined;
      };
      const org = planOf('');
      const user = userId ? planOf(userId) : undefined;
      const seated = !!org && !!userId && !!(await tx.selectFrom('billing_seats').select('user_id').where('org_id', '=', orgId).where('user_id', '=', userId).executeTakeFirst());
      return { ...(org ? { org } : {}), ...(user ? { user } : {}), seated };
    });
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

  /** SQL for the billed minutes of a row, counting a running session up to `at`. */
  private minutesExpr(at: Date, alias?: string) {
    const min = this.pricing.compute.minimumMinutes ?? 1;
    const col = (c: string) => sql.ref(alias ? `${alias}.${c}` : c);
    return sql<number>`CASE WHEN ${col('ended_at')} IS NULL THEN greatest(${min}::int, ceil(greatest(0, extract(epoch FROM (${at}::timestamptz - ${col('started_at')}))) / 60)::int) ELSE coalesce(${col('minutes')}, 0) END`;
  }

  /** Compute spend this month (sessions ended this month or still running; Stripe dates a meter event at the session's end). */
  private async spend(tx: Tx, orgId: string, who: { payerKey?: string; userId?: string }): Promise<{ amount: number }> {
    const at = this.now();
    const { start, end } = monthOf(at);
    let q = tx
      .selectFrom('billing_usage')
      .select(sql<string>`coalesce(sum(${this.minutesExpr(at)} * units_per_minute * unit_price), 0)`.as('amount'))
      .where('org_id', '=', orgId)
      .where('billable', '=', true)
      .where('started_at', '<', end)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>=', start)]));
    if (who.payerKey !== undefined) q = q.where('payer_key', '=', who.payerKey);
    if (who.userId !== undefined) q = q.where('user_id', '=', who.userId);
    const r = await q.executeTakeFirstOrThrow();
    return { amount: round2(Number(r.amount)) };
  }

  private async usage(tx: Tx, orgId: string, who: { payerKey?: string; userId?: string }): Promise<BillingUsage> {
    const at = this.now();
    const { start, end } = monthOf(at);
    let q = tx
      .selectFrom('billing_usage as u')
      .leftJoin('billing_meter_outbox as o', 'o.usage_id', 'u.id')
      .leftJoin('users as us', 'us.id', 'u.user_id')
      .select(['u.id', 'u.session_name', 'u.lab_id', 'u.user_id', 'us.name as user_name', 'u.compute_tier', 'u.started_at', 'u.ended_at', 'u.units_per_minute', 'u.unit_price', 'u.payer_key', 'u.trial', 'u.billable', 'o.status as report'])
      .select(this.minutesExpr(at, 'u').as('minutes'))
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
      const mins = Number(r.minutes);
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
          const m = members.get(r.user_id) ?? { userId: r.user_id, name: r.user_name ?? r.user_id, minutes: 0, units: 0, amount: 0 };
          m.minutes += mins;
          m.units += units;
          m.amount = round2(m.amount + amount);
          members.set(r.user_id, m);
        }
      }
      if (out.sessions.length < 50) {
        const report: UsageReportState = running ? 'running' : !r.billable ? 'unbilled' : ((r.report as UsageReportState | null) ?? 'unbilled');
        const row: BillingUsageRow = {
          id: r.id,
          sessionName: r.session_name,
          labId: r.lab_id,
          labTitle: this.facts.get(r.lab_id)?.title ?? r.lab_id,
          userId: r.user_id,
          ...(r.user_name ? { userName: r.user_name } : {}),
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
      .select([sql<number>`count(*)::int`.as('n'), sql<number>`coalesce(sum(${this.minutesExpr(at)}), 0)::int`.as('m')])
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .where('trial', '=', true)
      .executeTakeFirstOrThrow();
    return { sessions: Number(r.n), minutes: Number(r.m) };
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
   * The billing gate for a lab start: early-access plan level, the free-trial
   * allowance, a payment method, dunning and the spend cap, in that order.
   * Refuses with 402 `payment_required` (`details`: BillingBlockDetails) when
   * enforcement is on; returns what it decided so `meterStart` records who pays.
   */
  async assertLabStart(p: Principal, labId: string): Promise<StartDecision | undefined> {
    const lab = this.facts.get(labId);
    if (!p.orgId || !lab) return undefined;
    return this.tx(p, async (tx) => {
      const state = await this.payerState(tx, p.orgId, p.sub);
      const trialUse = this.pricing.isTrialLab(labId) ? await this.trialUse(tx, p.orgId, p.sub) : undefined;
      const verdict = this.decide(p, lab, state, trialUse);
      if (verdict.block && this.enforced) throw new HttpError(402, verdict.block.message, { code: 'payment_required', details: verdict.block.details as unknown as Record<string, unknown> });
      const trial = !!verdict.trial;
      const billable = this.enabled && !trial && !!state.customer;
      return {
        labId,
        tier: lab.tier,
        unitsPerMinute: this.pricing.unitsPerMinute(lab.tier),
        unitPrice: this.pricing.unitPrice,
        payer: state.payer,
        payerKey: state.payerKey,
        customerId: billable ? state.customer!.id : null,
        trial,
        billable,
      };
    });
  }

  private decide(p: Principal, lab: LabFacts & { title: string }, s: PayerState, trialUse?: { sessions: number; minutes: number }): { trial?: boolean; block?: { reason: BillingBlockReason; message: string; details: BillingBlockDetails } } {
    const orgPays = s.payer === 'org';
    const manage = can(p, 'billing.manage', { kind: 'org' });
    const href = orgPays ? '/admin/billing' : '/account/billing';
    const fix = (action: BillingBlockDetails['action']): BillingBlockDetails['action'] => (orgPays && !manage ? 'contact_admin' : action);
    const block = (reason: BillingBlockReason, message: string, extra: Partial<BillingBlockDetails> = {}, action: BillingBlockDetails['action']) => ({
      block: { reason, message, details: { reason, action: fix(action), href, scope: s.payer, ...extra } as BillingBlockDetails },
    });
    const required = this.requiredPlan(lab);
    if (required && s.level < this.pricing.level(required)) {
      const requiredPlan = { id: required.id, name: required.name, level: this.pricing.level(required) };
      return { block: { reason: 'plan_required', message: `"${lab.title}" is in early access: it needs the ${required.name} plan or higher.`, details: { reason: 'plan_required', action: 'upgrade', href: '/account/billing', scope: 'user', requiredPlan } } };
    }
    if (trialUse) {
      const t = this.pricing.trial;
      if (trialUse.sessions < t.maxSessions && trialUse.minutes < t.maxMinutes) return { trial: true };
      if (!s.paymentMethod) return block('trial_exhausted', `You have used your free trial (${t.maxSessions} sessions or ${t.maxMinutes} minutes). Add a payment method to keep going; you pay only for the compute you use.`, {}, 'add_payment_method');
    }
    if (!s.paymentMethod) {
      return block('payment_method_required', orgPays ? 'Your organisation has no payment method on file. Ask an organisation admin to set up billing.' : 'Add a payment method to start this lab. A free account includes the trial lab only; other labs are billed per compute minute.', {}, 'add_payment_method');
    }
    if (s.dunning.state === 'blocked') {
      const who = orgPays ? "Your organisation's" : 'Your';
      return block('payment_overdue', `${who} last payment failed and the ${s.dunning.graceDays}-day grace period has ended. Update the payment method in the billing portal to start new labs; running labs are not affected.`, { ...(s.dunning.graceEndsAt ? { graceEndedAt: s.dunning.graceEndsAt } : {}) }, 'portal');
    }
    if (s.limit.hardStop && s.limit.monthlyCap > 0 && s.spent >= s.limit.monthlyCap) {
      const cap = formatMoney(s.limit.monthlyCap, this.currency);
      return block('spend_cap_reached', `${orgPays ? 'Your organisation has' : 'You have'} reached the monthly compute spend cap of ${cap}. ${orgPays && !manage ? 'Ask an organisation admin to raise it' : 'Raise the cap on the billing page'} to start new labs; running labs continue.`, { currency: this.currency, cap: s.limit.monthlyCap, spent: s.spent }, 'raise_cap');
    }
    return {};
  }

  /** The plan an early-access lab needs, when early access is gated on this deployment. */
  private requiredPlan(lab: LabFacts): SitePlan | undefined {
    return this.d.earlyAccess === false ? undefined : this.pricing.requiredPlan(lab);
  }

  /** Billing view of labs for the catalog and the lab page: tier, rate, early-access plan, trial, lock. */
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
      const required = this.requiredPlan(f);
      const access: LabAccess = {
        computeTier: f.tier,
        unitsPerMinute: this.pricing.unitsPerMinute(f.tier),
        pricePerHour: this.pricing.pricePerHour(f.tier),
        ...(required ? { requiredPlan: { id: required.id, name: required.name, level: this.pricing.level(required) }, earlyAccess: true } : {}),
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

  /** Records the start of a metered session (after the session was created). */
  async meterStart(p: Principal, decision: StartDecision | undefined, session: { id: string; startedAt?: string }): Promise<void> {
    if (!decision || !p.orgId) return;
    const startedAt = session.startedAt ? new Date(session.startedAt) : this.now();
    await this.tx(p, (tx) =>
      tx
        .insertInto('billing_usage')
        .values({
          org_id: p.orgId,
          user_id: p.sub,
          lab_id: decision.labId,
          session_name: session.id,
          compute_tier: decision.tier,
          units_per_minute: decision.unitsPerMinute,
          unit_price: decision.unitPrice,
          payer_key: decision.payerKey,
          customer_id: decision.customerId,
          trial: decision.trial,
          billable: decision.billable,
          started_at: Number.isNaN(startedAt.getTime()) ? this.now() : startedAt,
        })
        .onConflict((oc) => oc.column('session_name').doNothing())
        .execute(),
    );
  }

  /** Ends a metered session: billed minutes and units, and its meter event into the outbox (same transaction). */
  async meterEnd(orgId: string, sessionName: string, endedAt: Date = this.now()): Promise<void> {
    const queued = await withTenant(this.d.db, { orgId }, (tx) => this.closeUsage(tx, sessionName, endedAt));
    if (queued) this.kick();
  }

  private async closeUsage(tx: Tx, sessionName: string, endedAt: Date): Promise<boolean> {
    const row = await tx.selectFrom('billing_usage').selectAll().where('session_name', '=', sessionName).where('ended_at', 'is', null).forUpdate().executeTakeFirst();
    if (!row) return false;
    const end = endedAt < row.started_at ? row.started_at : endedAt;
    const minutes = this.pricing.billedMinutes(end.getTime() - row.started_at.getTime());
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
  async sweep(sessionEnd: (sessionName: string) => Promise<Date | null>): Promise<{ closed: number; sent: number }> {
    const open = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('billing_usage').select(['org_id', 'session_name']).where('ended_at', 'is', null).orderBy('started_at').limit(500).execute());
    let closed = 0;
    for (const u of open) {
      const end = await sessionEnd(u.session_name).catch(() => null);
      if (!end) continue;
      await withTenant(this.d.db, { orgId: u.org_id }, (tx) => this.closeUsage(tx, u.session_name, end));
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

  private assertCheckoutOpen(): void {
    this.stripe();
    if (!this.d.site.flags.checkoutEnabled) throw new HttpError(409, 'Self-service checkout is not open yet.', { code: 'conflict' });
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
    return this.tx(p, async (tx) => {
      const customer = await this.customerFor(tx, p, userId);
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
    const mails: Mail[] = [];
    const outcome = await withTenant(this.d.db, { platform: true }, async (tx): Promise<WebhookOutcome> => {
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
        if (r.mails) mails.push(...r.mails);
        return { eventId: event.id, type: event.type, status: r.status };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await tx.updateTable('billing_events').set({ status: 'failed', processed_at: this.now(), error: message.slice(0, 500) }).where('id', '=', inserted.id).execute();
        this.d.log?.warn({ eventId: event.id, type: event.type, err: message }, 'billing webhook failed');
        return { eventId: event.id, type: event.type, status: 'failed' };
      }
    });
    // Mail after commit: a mail server hiccup never rolls back billing state.
    for (const m of mails) await this.d.mailer?.send(m).catch((e: unknown) => this.d.log?.warn({ err: e instanceof Error ? e.message : String(e), subject: m.subject }, 'billing mail failed'));
    return outcome;
  }

  private isComputeSub(sub: StripeSubscription): boolean {
    if (sub.metadata?.ct_kind === 'compute') return true;
    return !!sub.items?.data?.some((i) => i.price?.lookup_key === this.pricing.compute.lookupKey);
  }

  private async apply(tx: Tx, event: StripeEvent): Promise<ApplyResult> {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const meta = (obj.metadata ?? {}) as Record<string, string>;
        const cusId = typeof obj.customer === 'string' ? obj.customer : undefined;
        if (obj.mode === 'setup') {
          const si = typeof obj.setup_intent === 'string' ? obj.setup_intent : undefined;
          const cus = cusId ? await this.customerByStripeId(tx, cusId) : undefined;
          if (!si || !cus) return { status: 'ignored', ...(meta.ct_org_id ? { orgId: meta.ct_org_id } : {}), summary: { reason: !si ? 'no setup intent on session' : 'unknown customer', session: obj.id } };
          const intent = await this.stripe().setupIntents.retrieve(si);
          if (!intent.payment_method) return { status: 'ignored', orgId: cus.org_id, userId: cus.user_id, summary: { reason: 'setup intent has no payment method', session: obj.id } };
          await this.stripe().customers.update(cus.stripe_customer_id, { invoice_settings: { default_payment_method: intent.payment_method } });
          const mails = await this.paymentMethodSaved(tx, cus, event.id);
          return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { session: obj.id, setupIntent: si, paymentMethod: 'saved', computeSubscription: mails.computeSub ?? null }, mails: mails.mails };
        }
        const subId = typeof obj.subscription === 'string' ? obj.subscription : undefined;
        if (!subId) return { status: 'ignored', ...(meta.ct_org_id ? { orgId: meta.ct_org_id } : {}), summary: { reason: 'no subscription on session', session: obj.id } };
        const sub = await this.stripe().subscriptions.retrieve(subId);
        const r = await this.upsertSubscription(tx, sub, meta);
        // The plan's payment method also pays for compute: make it the customer default and open the metered subscription.
        const cus = await this.customerByStripeId(tx, sub.customer);
        let computeSub: string | undefined;
        let mails: Mail[] = [];
        if (cus) {
          if (sub.default_payment_method) await this.stripe().customers.update(cus.stripe_customer_id, { invoice_settings: { default_payment_method: sub.default_payment_method } });
          const saved = await this.paymentMethodSaved(tx, cus, event.id);
          computeSub = saved.computeSub;
          mails = saved.mails;
        }
        return { status: 'processed', orgId: r.orgId, userId: r.userId, summary: { session: obj.id, subscription: sub.id, plan: r.planId, status: sub.status, seats: r.seats, computeSubscription: computeSub ?? null }, mails };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = obj as unknown as StripeSubscription;
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
          if (sub.default_payment_method) await this.stripe().customers.update(cus.stripe_customer_id, { invoice_settings: { default_payment_method: sub.default_payment_method } });
          computeSub = await this.ensureComputeSubscription(tx, cus, event.id);
        }
        const d = cus ? await this.recomputeDunning(tx, cus) : { mails: [] as Mail[], transition: undefined };
        return { status: 'processed', orgId: r.orgId, userId: r.userId, summary: { subscription: sub.id, plan: r.planId, status: sub.status, seats: r.seats, cancelAtPeriodEnd: sub.cancel_at_period_end, dunning: d.transition ?? 'unchanged', ...(computeSub ? { computeSubscription: computeSub } : {}) }, mails: d.mails };
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const cusId = typeof obj.customer === 'string' ? obj.customer : undefined;
        const cus = cusId ? await this.customerByStripeId(tx, cusId) : undefined;
        const summary = { invoice: obj.id, amountPaid: obj.amount_paid, amountDue: obj.amount_due, currency: obj.currency, customer: cusId, attempt: obj.attempt_count };
        if (!cus) return { status: 'processed', summary };
        const failed = event.type === 'invoice.payment_failed';
        await tx
          .updateTable('billing_customers')
          .set({ invoice_failed_at: failed ? (cus.invoice_failed_at ?? this.now()) : null, ...(failed ? {} : { has_payment_method: true }), updated_at: this.now() })
          .where('id', '=', cus.id)
          .execute();
        const d = await this.recomputeDunning(tx, { ...cus, invoice_failed_at: failed ? (cus.invoice_failed_at ?? this.now()) : null });
        return { status: 'processed', orgId: cus.org_id, userId: cus.user_id, summary: { ...summary, dunning: d.transition ?? 'unchanged' }, mails: d.mails };
      }
      case 'customer.updated': {
        const cus = typeof obj.id === 'string' ? await this.customerByStripeId(tx, obj.id) : undefined;
        if (!cus) return { status: 'ignored', summary: { reason: 'unknown customer', customer: obj.id } };
        const pm = (obj.invoice_settings as { default_payment_method?: string | null } | undefined)?.default_payment_method ?? null;
        if (pm && !cus.has_payment_method) {
          const saved = await this.paymentMethodSaved(tx, cus, event.id);
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
  private async paymentMethodSaved(tx: Tx, cus: CustomerRow, eventId: string): Promise<{ computeSub?: string; mails: Mail[] }> {
    await tx.updateTable('billing_customers').set({ has_payment_method: true, updated_at: this.now() }).where('id', '=', cus.id).execute();
    const computeSub = await this.ensureComputeSubscription(tx, cus, eventId);
    return { ...(computeSub ? { computeSub } : {}), mails: [] };
  }

  /**
   * One metered compute subscription per billing customer (the metered price
   * only, no fixed fee): meter events for the customer are billed through it.
   * Exactly one, or usage would be billed twice.
   */
  private async ensureComputeSubscription(tx: Tx, cus: CustomerRow, eventId: string): Promise<string | undefined> {
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
    const sub = await this.stripe().subscriptions.create(
      { customer: cus.stripe_customer_id, items: [{ price }], metadata: { ct_kind: 'compute', ct_org_id: cus.org_id, ct_user_id: cus.user_id ?? '', ct_scope: cus.user_id ? 'user' : 'org' } },
      `computesub:${cus.stripe_customer_id}:${eventId}`,
    );
    await this.upsertComputeSubscription(tx, sub, cus);
    return sub.id;
  }

  private async upsertComputeSubscription(tx: Tx, sub: StripeSubscription, known?: CustomerRow): Promise<{ customer: CustomerRow }> {
    const customer = known ?? (await this.customerByStripeId(tx, sub.customer));
    if (!customer) throw new Error(`compute subscription ${sub.id}: unknown customer ${sub.customer}`);
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

  /** Writes the subscription's latest state and the entitlements that follow from it. */
  private async upsertSubscription(tx: Tx, sub: StripeSubscription, meta: Record<string, string>): Promise<{ orgId: string; userId: string | null; planId: string; seats: number }> {
    const item = sub.items?.data?.find((i) => !!this.planByLookupKey(i.price?.lookup_key)) ?? sub.items?.data?.[0];
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

/** Minor units as money, e.g. 5000 EUR -> "€50.00". */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** Stripe refuses a meter event whose identifier it has already accepted: it was reported. */
function isDuplicateMeterEvent(e: StripeError): boolean {
  return e.code === 'resource_already_exists' || (/identifier/i.test(e.message) && /(already|duplicate|exists|unique)/i.test(e.message));
}

/** 4xx other than auth, conflicts and rate limits will not succeed on retry. */
function isPermanent(e: StripeError): boolean {
  return e.status >= 400 && e.status < 500 && ![401, 403, 409, 429].includes(e.status);
}
