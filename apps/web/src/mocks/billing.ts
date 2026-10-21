import { delay, http, HttpResponse } from 'msw';
import type {
  BillingBlockDetails,
  BillingBlockReason,
  BillingEventRow,
  BillingLimit,
  BillingScope,
  BillingSeats,
  BillingSubscription,
  BillingSummary,
  BillingUsage,
  BillingUsageRow,
  CheckoutRequest,
  ComputeTier,
  Lab,
  LabAccess,
  PlanInterval,
  SitePlan,
  Topology,
} from '@/api/types';
import { site } from './fixtures/site';
import { COLD_START_USER } from './fixtures/home';
import { labById } from './fixtures/labs';
import { people, personById } from './fixtures/platform';
import { currentSession } from './platformHandlers';

/*
 * Mock billing (services/gateway/src/billing, docs/billing.md): the signed-in
 * persona's plan and the org's, with a pretend Stripe, metered compute, the
 * free trial, early-access labs, seats and spend caps. "Checkout" (plans or setup
 * mode) completes at once (as if the webhook had landed) and sends the browser
 * back. Lab starts are gated like the gateway does (402 payment_required).
 * State lives in localStorage per org and user; personas start with a card on
 * file and a few sessions this month, except the cold-start learner (free).
 */

const STORAGE = 'ct.mock.billing.v2';
interface UsageRec {
  id: string;
  session: string;
  orgId: string;
  userId: string;
  labId: string;
  tier: ComputeTier;
  upm: number;
  payer: string; // user id or '' (org)
  trial: boolean;
  billable: boolean;
  startedAt: string;
  endedAt?: string;
}
interface MockState {
  subscriptions: Record<string, BillingSubscription & { priceRef: string }>;
  customers: Record<string, true>;
  paymentMethods: Record<string, true>;
  events: BillingEventRow[];
  usage: UsageRec[];
  limits: Record<string, { monthlyCap: number; hardStop: boolean }>;
  seats: Record<string, { userId: string; assignedAt: string }[]>;
  seeded: Record<string, true>;
}
const scopeOf = (orgId: string, userId: string | null) => `${orgId}:${userId ?? 'org'}`;

function read(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* ignore */
  }
  return { subscriptions: {}, customers: {}, paymentMethods: {}, events: [], usage: [], limits: {}, seats: {}, seeded: {} };
}
function write(s: MockState) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const plans = () => site.plans?.items ?? [];
const freePlan = () => plans().find((p) => p.kind === 'free');
const levelOf = (p: SitePlan | undefined) => (p ? (p.level ?? (p.kind === 'free' ? 0 : 1)) : 0);
const planState = (plan: SitePlan | undefined, source: 'default' | 'subscription', since?: string) => (plan ? { planId: plan.id, planName: plan.name, kind: plan.kind, entitlements: plan.entitlements, source, ...(since ? { since } : {}) } : undefined);
const unauthenticated = () => HttpResponse.json({ error: 'Not signed in', code: 'unauthenticated' }, { status: 401 });
const isActive = (s?: BillingSubscription) => !!s && (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due');

/* ------------------------------------------------------------ pricing */

const compute = () => site.plans?.compute;
const unitPrice = () => Number(compute()?.unitPrice ?? 0);
const upm = (t: ComputeTier) => compute()?.tiers[t].unitsPerMinute ?? 0;
const pricePerHour = (t: ComputeTier) => Math.round(upm(t) * 60 * unitPrice() * 100) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

function tierOf(t: Topology): ComputeTier {
  let vms = 0;
  for (const n of t.nodes) {
    if (n.driver === 'netdev' || (n.driver === 'k8s-cluster' && n.cluster?.mode === 'kubeadm')) return 'heavy';
    if (n.driver === 'vm') vms++;
  }
  return vms >= 2 ? 'heavy' : vms === 1 ? 'vm' : 'pod';
}

function requiredPlan(lab: Lab): SitePlan | undefined {
  let best: SitePlan | undefined;
  const tier = tierOf(lab.spec.topology);
  for (const r of site.plans?.earlyAccess ?? []) {
    const m = lab.metadata;
    const sel = [r.domains, r.difficulties, r.computeTiers, r.tags].some((x) => x?.length);
    const hit = r.labs?.includes(m.id) || (sel && (!r.domains?.length || r.domains.includes(m.domain)) && (!r.difficulties?.length || r.difficulties.includes(m.difficulty)) && (!r.computeTiers?.length || r.computeTiers.includes(tier)) && (!r.tags?.length || r.tags.some((t) => m.tags?.includes(t))));
    const p = plans().find((x) => x.id === r.plan);
    if (hit && p && (!best || levelOf(p) > levelOf(best))) best = p;
  }
  return best;
}

/** The configured trial labs, or (mock catalog) the first easy pod lab. */
function trialLabs(): string[] {
  const configured = (site.plans?.free?.trialLabs ?? []).filter((id) => labById.has(id));
  if (configured.length) return configured;
  const labs = [...labById.values()].filter((l) => !l.spec.questions?.length);
  const pick = labs.find((l) => l.metadata.difficulty === 'easy' && tierOf(l.spec.topology) === 'pod') ?? labs.find((l) => tierOf(l.spec.topology) === 'pod') ?? labs[0];
  return pick ? [pick.metadata.id] : [];
}
const trialCaps = () => ({ maxSessions: site.plans?.free?.maxSessions ?? 3, maxMinutes: site.plans?.free?.maxMinutes ?? 60 });

/* ------------------------------------------------------------- seeding */

const isAdmin = (orgId: string, userId: string) => (personById.get(userId)?.orgs[orgId] ?? []).includes('org_admin');

/** Personas start with a card on file and a few sessions this month; the cold-start learner starts free. */
function seed(s: MockState, orgId: string, userId: string) {
  const sk = scopeOf(orgId, userId);
  if (s.seeded[sk]) return;
  s.seeded[sk] = true;
  if (userId === COLD_START_USER) return;
  s.customers[sk] = true;
  s.paymentMethods[sk] = true;
  const labs = [...labById.values()].filter((l) => !requiredPlan(l)).slice(0, 4);
  const now = Date.now();
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const span = Math.max(3_600_000, now - monthStart);
  labs.forEach((l, i) => {
    const start = monthStart + Math.floor((span * (i + 1)) / (labs.length + 2));
    const minutes = [34, 52, 18, 41][i] ?? 25;
    const tier = tierOf(l.spec.topology);
    s.usage.push({ id: `use_${sk}_${i}`, session: `${l.metadata.id}-seed${i}`, orgId, userId, labId: l.metadata.id, tier, upm: upm(tier), payer: userId, trial: false, billable: true, startedAt: new Date(start).toISOString(), endedAt: new Date(Math.min(now - 60_000, start + minutes * 60_000)).toISOString() });
  });
}

/* --------------------------------------------------------------- state */

function minutesOf(u: UsageRec, now = Date.now()): number {
  const end = u.endedAt ? Date.parse(u.endedAt) : now;
  return Math.max(compute()?.minimumMinutes ?? 1, Math.ceil(Math.max(0, end - Date.parse(u.startedAt)) / 60_000));
}

function payerOf(s: MockState, orgId: string, userId: string): { payer: BillingScope; key: string; level: number; seat?: SitePlan } {
  const own = s.subscriptions[scopeOf(orgId, userId)];
  const ownLevel = isActive(own) ? levelOf(plans().find((p) => p.id === own!.planId)) : 0;
  const orgSub = s.subscriptions[scopeOf(orgId, null)];
  const orgPlan = isActive(orgSub) ? plans().find((p) => p.id === orgSub!.planId) : undefined;
  const seated = !!orgPlan && (s.seats[orgId] ?? []).some((x) => x.userId === userId);
  return seated ? { payer: 'org', key: '', level: Math.max(ownLevel, levelOf(orgPlan)), seat: orgPlan } : { payer: 'user', key: userId, level: ownLevel };
}

function account(s: MockState, orgId: string, userId: string | null) {
  const sk = scopeOf(orgId, userId);
  const sub = s.subscriptions[sk];
  const paymentMethod = !!s.paymentMethods[sk] || isActive(sub);
  const def = site.plans?.limits?.[userId ? 'user' : 'org'];
  const custom = s.limits[sk];
  const limit = custom ? { ...custom, source: 'custom' as const } : { monthlyCap: def?.monthlyCap ?? 0, hardStop: def?.hardStop ?? false, source: 'default' as const };
  const usage = usageOf(s, orgId, userId === null ? { payer: '' } : { userId });
  return { paymentMethod, limit, spent: usage.estimate, usage };
}

function usageOf(s: MockState, orgId: string, who: { payer?: string; userId?: string }): BillingUsage {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = s.usage
    .filter((u) => u.orgId === orgId && (who.payer === undefined || u.payer === who.payer) && (who.userId === undefined || u.userId === who.userId) && (!u.endedAt || Date.parse(u.endedAt) >= start.getTime()))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const out: BillingUsage = { periodStart: start.toISOString(), periodEnd: end.toISOString(), minutes: 0, units: 0, estimate: 0, running: 0, byTier: [], sessions: [] };
  const tiers = new Map<ComputeTier, { tier: ComputeTier; minutes: number; units: number; amount: number }>();
  const members = new Map<string, { userId: string; name: string; minutes: number; units: number; amount: number }>();
  for (const u of rows) {
    const minutes = minutesOf(u);
    const units = minutes * u.upm;
    const amount = u.billable ? round2(units * unitPrice()) : 0;
    if (!u.endedAt) out.running++;
    if (u.billable && (who.payer !== undefined || u.payer === who.userId)) {
      out.minutes += minutes;
      out.units += units;
      out.estimate = round2(out.estimate + amount);
      const t = tiers.get(u.tier) ?? { tier: u.tier, minutes: 0, units: 0, amount: 0 };
      t.minutes += minutes;
      t.units += units;
      t.amount = round2(t.amount + amount);
      tiers.set(u.tier, t);
      if (who.payer === '') {
        const m = members.get(u.userId) ?? { userId: u.userId, name: personById.get(u.userId)?.name ?? u.userId, minutes: 0, units: 0, amount: 0 };
        m.minutes += minutes;
        m.units += units;
        m.amount = round2(m.amount + amount);
        members.set(u.userId, m);
      }
    }
    if (out.sessions.length < 50) {
      const row: BillingUsageRow = {
        id: u.id,
        sessionName: u.session,
        labId: u.labId,
        labTitle: labById.get(u.labId)?.metadata.title ?? u.labId,
        userId: u.userId,
        userName: personById.get(u.userId)?.name ?? u.userId,
        tier: u.tier,
        startedAt: u.startedAt,
        ...(u.endedAt ? { endedAt: u.endedAt } : {}),
        minutes,
        units,
        amount,
        payer: u.payer === '' ? 'org' : 'user',
        trial: u.trial,
        report: !u.endedAt ? 'running' : u.billable ? 'sent' : 'unbilled',
      };
      out.sessions.push(row);
    }
  }
  out.byTier = [...tiers.values()];
  if (who.payer === '') out.byMember = [...members.values()].sort((a, b) => b.amount - a.amount);
  return out;
}

function limitView(l: { monthlyCap: number; hardStop: boolean; source: 'default' | 'custom' }, spent: number): BillingLimit {
  return { ...l, spent, reached: l.monthlyCap > 0 && spent >= l.monthlyCap, warn: l.monthlyCap > 0 && spent >= l.monthlyCap * 0.8 };
}

function trialUse(s: MockState, orgId: string, userId: string) {
  const rows = s.usage.filter((u) => u.orgId === orgId && u.userId === userId && u.trial);
  return { sessions: rows.length, minutes: rows.reduce((a, u) => a + minutesOf(u), 0) };
}

function seatsView(s: MockState, orgId: string): BillingSeats {
  const sub = s.subscriptions[scopeOf(orgId, null)];
  const plan = sub ? plans().find((p) => p.id === sub.planId) : plans().find((p) => p.kind === 'organisation');
  const held = s.seats[orgId] ?? [];
  const members = people.filter((p) => p.orgs[orgId]);
  return {
    purchased: isActive(sub) ? sub!.seats : 0,
    assigned: held.map((h) => ({ userId: h.userId, name: personById.get(h.userId)?.name ?? h.userId, email: personById.get(h.userId)?.email ?? '', assignedAt: h.assignedAt })),
    unassigned: members.filter((m) => !held.some((h) => h.userId === m.id)).map((m) => ({ userId: m.id, name: m.name, email: m.email })),
    canChange: isActive(sub) && !!plan?.perSeat,
    minSeats: plan?.minSeats ?? 1,
    maxSeats: plan?.maxSeats ?? 100000,
  };
}

function summary(scope: BillingScope, orgId: string, userId: string): BillingSummary {
  const s = read();
  seed(s, orgId, userId);
  write(s);
  const sk = scopeOf(orgId, scope === 'org' ? null : userId);
  const sub = s.subscriptions[sk];
  const plan = isActive(sub) ? planState(plans().find((p) => p.id === sub!.planId), 'subscription', sub!.updatedAt) : planState(freePlan(), 'default');
  const p = payerOf(s, orgId, userId);
  const acc = account(s, orgId, scope === 'org' ? null : userId);
  const c = compute();
  const t = trialUse(s, orgId, userId);
  const caps = trialCaps();
  return {
    enabled: true,
    mode: 'test',
    scope,
    ...(plan ? { plan } : {}),
    ...(sub ? { subscription: stripLookup(sub) } : {}),
    portalAvailable: !!s.customers[sk],
    plans: plans().filter((pl) => (scope === 'org' ? pl.kind === 'organisation' : pl.kind === 'individual')),
    currency: site.plans?.currency ?? 'EUR',
    placeholder: !!(site.plans?.placeholder || plans().some((pl) => pl.placeholderPrices)),
    checkoutEnabled: true,
    enforced: true,
    paymentMethod: acc.paymentMethod,
    level: scope === 'org' ? (isActive(sub) ? levelOf(plans().find((x) => x.id === sub!.planId)) : 0) : p.level,
    payer: scope === 'org' ? 'org' : p.payer,
    ...(scope === 'user' && p.seat ? { seat: { planId: p.seat.id, planName: p.seat.name, level: levelOf(p.seat) } } : {}),
    ...(c ? { compute: { unitPrice: unitPrice(), placeholder: !!c.placeholder, minimumMinutes: c.minimumMinutes ?? 1, tiers: (['pod', 'vm', 'heavy'] as const).map((tier) => ({ tier, label: c.tiers[tier].label, unitsPerMinute: c.tiers[tier].unitsPerMinute, pricePerHour: pricePerHour(tier) })) } } : {}),
    usage: acc.usage,
    limit: limitView(acc.limit, acc.spent),
    dunning: { state: 'ok', graceDays: site.plans?.dunning?.graceDays ?? 7 },
    ...(scope === 'user'
      ? { trial: { labs: trialLabs().map((id) => ({ id, title: labById.get(id)?.metadata.title ?? id })), ...caps, usedSessions: t.sessions, usedMinutes: t.minutes, exhausted: t.sessions >= caps.maxSessions || t.minutes >= caps.maxMinutes } }
      : { seats: seatsView(s, orgId) }),
  };
}
const stripLookup = ({ priceRef: _p, ...rest }: BillingSubscription & { priceRef: string }): BillingSubscription => rest;

/* ---------------------------------------------------------- lab access */

interface Decision {
  trial?: boolean;
  block?: { reason: BillingBlockReason; message: string; details: BillingBlockDetails };
}

function decide(s: MockState, orgId: string, userId: string, lab: Lab): Decision {
  const p = payerOf(s, orgId, userId);
  const acc = account(s, orgId, p.payer === 'org' ? null : userId);
  const orgPays = p.payer === 'org';
  const href = orgPays ? '/admin/billing' : '/account/billing';
  const fix = (a: BillingBlockDetails['action']) => (orgPays && !isAdmin(orgId, userId) ? 'contact_admin' : a);
  const block = (reason: BillingBlockReason, message: string, action: BillingBlockDetails['action'], extra: Partial<BillingBlockDetails> = {}): Decision => ({ block: { reason, message, details: { reason, action: fix(action), href, scope: p.payer, ...extra } } });
  const req = requiredPlan(lab);
  if (req && p.level < levelOf(req)) {
    return { block: { reason: 'plan_required', message: `"${lab.metadata.title}" is in early access: it needs the ${req.name} plan or higher.`, details: { reason: 'plan_required', action: 'upgrade', href: '/account/billing', scope: 'user', requiredPlan: { id: req.id, name: req.name, level: levelOf(req) } } } };
  }
  if (trialLabs().includes(lab.metadata.id)) {
    const t = trialUse(s, orgId, userId);
    const caps = trialCaps();
    if (t.sessions < caps.maxSessions && t.minutes < caps.maxMinutes) return { trial: true };
    if (!acc.paymentMethod) return block('trial_exhausted', `You have used your free trial (${caps.maxSessions} sessions or ${caps.maxMinutes} minutes). Add a payment method to keep going; you pay only for the compute you use.`, 'add_payment_method');
  }
  if (!acc.paymentMethod) return block('payment_method_required', orgPays ? 'Your organisation has no payment method on file. Ask an organisation admin to set up billing.' : 'Add a payment method to start this lab. A free account includes the trial lab only; other labs are billed per compute minute.', 'add_payment_method');
  if (acc.limit.hardStop && acc.limit.monthlyCap > 0 && acc.spent >= acc.limit.monthlyCap) return block('spend_cap_reached', `You have reached the monthly compute spend cap. Raise the cap on the billing page to start new labs; running labs continue.`, 'raise_cap', { cap: acc.limit.monthlyCap, spent: acc.spent, currency: site.plans?.currency ?? 'EUR' });
  return {};
}

function accessOf(s: MockState, orgId: string, userId: string, lab: Lab): LabAccess {
  const tier = tierOf(lab.spec.topology);
  const d = decide(s, orgId, userId, lab);
  const req = requiredPlan(lab);
  const trial = trialLabs().includes(lab.metadata.id);
  return {
    computeTier: tier,
    unitsPerMinute: upm(tier),
    pricePerHour: pricePerHour(tier),
    ...(req ? { requiredPlan: { id: req.id, name: req.name, level: levelOf(req) }, earlyAccess: true } : {}),
    ...(trial ? { trial: true } : {}),
    ...(d.trial ? { free: true } : {}),
    ...(d.block ? { locked: { reason: d.block.reason, message: d.block.message, action: d.block.details.action, href: d.block.details.href } } : {}),
  };
}

/** Adds `access` to catalog rows (mock /api/catalog). */
export function annotateLabs<T extends { id: string }>(labs: T[]): (T & { access?: LabAccess })[] {
  const sess = currentSession();
  if (!sess) return labs;
  const s = read();
  seed(s, sess.orgId, sess.userId);
  write(s);
  return labs.map((l) => {
    const lab = labById.get(l.id);
    return lab ? { ...l, access: accessOf(s, sess.orgId, sess.userId, lab) } : l;
  });
}

export function annotateLab(lab: Lab): Lab {
  const sess = currentSession();
  if (!sess) return lab;
  const s = read();
  seed(s, sess.orgId, sess.userId);
  return { ...lab, access: accessOf(s, sess.orgId, sess.userId, lab) };
}

/** The gate before a mock lab session starts: a 402 response, or undefined to go ahead. */
export function gateLabStart(lab: Lab): Response | undefined {
  const sess = currentSession();
  if (!sess) return undefined;
  const s = read();
  seed(s, sess.orgId, sess.userId);
  const d = decide(s, sess.orgId, sess.userId, lab);
  write(s);
  if (d.block) return HttpResponse.json({ error: d.block.message, code: 'payment_required', details: d.block.details }, { status: 402 });
  return undefined;
}

/** Meters a mock session from its start. */
export function meterStart(lab: Lab, session: { id: string; startedAt: string }) {
  const sess = currentSession();
  if (!sess) return;
  const s = read();
  const d = decide(s, sess.orgId, sess.userId, lab);
  const p = payerOf(s, sess.orgId, sess.userId);
  const tier = tierOf(lab.spec.topology);
  s.usage.push({ id: `use_${session.id}`, session: session.id, orgId: sess.orgId, userId: sess.userId, labId: lab.metadata.id, tier, upm: upm(tier), payer: p.key, trial: !!d.trial, billable: !d.trial, startedAt: session.startedAt });
  write(s);
}

export function meterEnd(sessionId: string) {
  const s = read();
  const u = s.usage.find((x) => x.session === sessionId && !x.endedAt);
  if (!u) return;
  u.endedAt = new Date().toISOString();
  write(s);
}

/* -------------------------------------------------------------- checkout */

function checkout(scope: BillingScope, orgId: string, userId: string | null, body: CheckoutRequest) {
  const plan = plans().find((p) => p.id === body.planId);
  if (!plan) return HttpResponse.json({ error: 'Plan not found', code: 'not_found' }, { status: 404 });
  if ((scope === 'org') !== (plan.kind === 'organisation') || plan.kind === 'free') return HttpResponse.json({ error: 'This plan does not fit this scope', code: 'invalid' }, { status: 422 });
  const interval: PlanInterval = body.interval;
  const price = plan.prices?.[interval];
  if (!price) return HttpResponse.json({ error: `${plan.name} has no ${interval} price`, code: 'invalid' }, { status: 422 });
  const seats = plan.perSeat ? Math.max(plan.minSeats ?? 1, body.seats ?? plan.minSeats ?? 1) : 1;
  const s = read();
  const sk = scopeOf(orgId, userId);
  const now = new Date();
  const end = new Date(now.getTime() + (interval === 'yearly' ? 365 : 30) * 86_400_000);
  s.customers[sk] = true;
  s.paymentMethods[sk] = true;
  s.subscriptions[sk] = { id: `sub_mock_${sk.slice(0, 6)}`, planId: plan.id, interval, seats, status: 'active', currentPeriodEnd: end.toISOString(), cancelAtPeriodEnd: false, updatedAt: now.toISOString(), priceRef: price.lookupKey };
  s.events.unshift(
    { id: `evt_${Date.now()}_a`, type: 'checkout.session.completed', receivedAt: now.toISOString(), processedAt: now.toISOString(), status: 'processed', summary: { plan: plan.id, seats, interval } },
    { id: `evt_${Date.now()}_b`, type: 'customer.subscription.created', receivedAt: now.toISOString(), processedAt: now.toISOString(), status: 'processed', summary: { plan: plan.id, status: 'active' } },
  );
  write(s);
  const back = scope === 'org' ? '/admin/billing' : '/account/billing';
  return HttpResponse.json({ url: `${back}?checkout=success&session_id=cs_test_mock`, sessionId: 'cs_test_mock' }, { status: 201 });
}

function paymentMethod(scope: BillingScope, orgId: string, userId: string | null) {
  const s = read();
  const sk = scopeOf(orgId, userId);
  s.customers[sk] = true;
  s.paymentMethods[sk] = true;
  const now = new Date().toISOString();
  s.events.unshift({ id: `evt_${Date.now()}_s`, type: 'checkout.session.completed', receivedAt: now, processedAt: now, status: 'processed', summary: { mode: 'setup', paymentMethod: 'saved' } });
  write(s);
  const back = scope === 'org' ? '/admin/billing' : '/account/billing';
  return HttpResponse.json({ url: `${back}?setup=success&session_id=cs_test_mock_setup`, sessionId: 'cs_test_mock_setup' }, { status: 201 });
}

const forbidden = () => HttpResponse.json({ error: 'Missing permission billing.manage', code: 'forbidden', permission: 'billing.manage' }, { status: 403 });

export const billingHandlers = [
  http.get('/api/billing/me', async () => {
    await delay(150);
    const sess = currentSession();
    return sess ? HttpResponse.json(summary('user', sess.orgId, sess.userId)) : unauthenticated();
  }),
  http.get('/api/billing/org', async () => {
    await delay(150);
    const sess = currentSession();
    return sess ? HttpResponse.json(summary('org', sess.orgId, sess.userId)) : unauthenticated();
  }),
  http.get('/api/billing/org/events', async () => {
    await delay(120);
    const sess = currentSession();
    return sess ? HttpResponse.json({ events: read().events.slice(0, 50) }) : unauthenticated();
  }),
  http.post('/api/billing/me/checkout', async ({ request }) => {
    await delay(500);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    return checkout('user', sess.orgId, sess.userId, (await request.json()) as CheckoutRequest);
  }),
  http.post('/api/billing/org/checkout', async ({ request }) => {
    await delay(500);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    return checkout('org', sess.orgId, null, (await request.json()) as CheckoutRequest);
  }),
  http.post('/api/billing/me/payment-method', async () => {
    await delay(400);
    const sess = currentSession();
    return sess ? paymentMethod('user', sess.orgId, sess.userId) : unauthenticated();
  }),
  http.post('/api/billing/org/payment-method', async () => {
    await delay(400);
    const sess = currentSession();
    return sess ? paymentMethod('org', sess.orgId, null) : unauthenticated();
  }),
  http.post('/api/billing/me/portal', async () => {
    await delay(300);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!read().customers[scopeOf(sess.orgId, sess.userId)]) return HttpResponse.json({ error: 'No billing account yet: add a payment method or subscribe to a plan first.', code: 'conflict' }, { status: 409 });
    return HttpResponse.json({ url: '/account/billing?portal=mock' });
  }),
  http.post('/api/billing/org/portal', async () => {
    await delay(300);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!read().customers[scopeOf(sess.orgId, null)]) return HttpResponse.json({ error: 'No billing account yet: add a payment method or subscribe to a plan first.', code: 'conflict' }, { status: 409 });
    return HttpResponse.json({ url: '/admin/billing?portal=mock' });
  }),
  ...(['me', 'org'] as const).map((scope) =>
    http.put(`/api/billing/${scope}/limits`, async ({ request }) => {
      await delay(200);
      const sess = currentSession();
      if (!sess) return unauthenticated();
      const b = (await request.json()) as { monthlyCap: number; hardStop: boolean };
      if (!Number.isInteger(b.monthlyCap) || b.monthlyCap < 0) return HttpResponse.json({ error: 'monthlyCap must be a whole number of minor units', code: 'invalid' }, { status: 422 });
      const s = read();
      const userId = scope === 'org' ? null : sess.userId;
      s.limits[scopeOf(sess.orgId, userId)] = { monthlyCap: b.monthlyCap, hardStop: !!b.hardStop };
      write(s);
      const acc = account(s, sess.orgId, userId);
      return HttpResponse.json(limitView(acc.limit, acc.spent));
    }),
  ),
  http.get('/api/billing/org/seats', async () => {
    await delay(150);
    const sess = currentSession();
    return sess ? HttpResponse.json(seatsView(read(), sess.orgId)) : unauthenticated();
  }),
  http.put('/api/billing/org/seats', async ({ request }) => {
    await delay(400);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!isAdmin(sess.orgId, sess.userId)) return forbidden();
    const { seats } = (await request.json()) as { seats: number };
    const s = read();
    const sub = s.subscriptions[scopeOf(sess.orgId, null)];
    const view = seatsView(s, sess.orgId);
    if (!sub || !view.canChange) return HttpResponse.json({ error: 'The organisation has no active per-seat plan; subscribe first.', code: 'conflict' }, { status: 409 });
    if (!Number.isInteger(seats) || seats < view.minSeats || seats > view.maxSeats) return HttpResponse.json({ error: `seats must be between ${view.minSeats} and ${view.maxSeats}`, code: 'invalid' }, { status: 422 });
    if (seats < view.assigned.length) return HttpResponse.json({ error: `${view.assigned.length} seats are assigned; unassign ${view.assigned.length - seats} first.`, code: 'conflict' }, { status: 409 });
    sub.seats = seats;
    sub.updatedAt = new Date().toISOString();
    write(s);
    return HttpResponse.json(seatsView(s, sess.orgId));
  }),
  http.post('/api/billing/org/seats/assign', async ({ request }) => {
    await delay(200);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!isAdmin(sess.orgId, sess.userId)) return forbidden();
    const { userId } = (await request.json()) as { userId: string };
    const s = read();
    const view = seatsView(s, sess.orgId);
    if (!view.assigned.some((a) => a.userId === userId)) {
      if (view.assigned.length >= view.purchased) return HttpResponse.json({ error: `All ${view.purchased} seats are assigned. Buy more seats or unassign someone first.`, code: 'conflict' }, { status: 409 });
      (s.seats[sess.orgId] ??= []).push({ userId, assignedAt: new Date().toISOString() });
      write(s);
    }
    return HttpResponse.json(seatsView(s, sess.orgId));
  }),
  http.delete('/api/billing/org/seats/:userId', async ({ params }) => {
    await delay(200);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!isAdmin(sess.orgId, sess.userId)) return forbidden();
    const s = read();
    s.seats[sess.orgId] = (s.seats[sess.orgId] ?? []).filter((x) => x.userId !== String(params.userId));
    write(s);
    return HttpResponse.json(seatsView(s, sess.orgId));
  }),
];
