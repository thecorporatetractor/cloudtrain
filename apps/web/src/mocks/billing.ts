import { delay, http, HttpResponse } from 'msw';
import type { BillingEventRow, BillingScope, BillingSubscription, BillingSummary, CheckoutRequest, PlanInterval, SitePlan } from '@/api/types';
import { site } from './fixtures/site';
import { currentSession } from './platformHandlers';

/*
 * Mock billing (services/gateway/src/billing): the signed-in persona's plan and
 * the org's, with a pretend Stripe. "Checkout" completes at once (as if the
 * webhook had landed) and sends the browser back with ?checkout=success; the
 * portal returns to the page. State lives in localStorage per org and user.
 */

const STORAGE = 'ct.mock.billing';
interface MockState {
  subscriptions: Record<string, BillingSubscription & { priceRef: string }>;
  customers: Record<string, true>;
  events: BillingEventRow[];
}
const scopeOf = (orgId: string, userId: string | null) => `${orgId}:${userId ?? 'org'}`;

function read(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* ignore */
  }
  return { subscriptions: {}, customers: {}, events: [] };
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
const planState = (plan: SitePlan | undefined, source: 'default' | 'subscription', since?: string) => (plan ? { planId: plan.id, planName: plan.name, kind: plan.kind, entitlements: plan.entitlements, source, ...(since ? { since } : {}) } : undefined);
const unauthenticated = () => HttpResponse.json({ error: 'Not signed in', code: 'unauthenticated' }, { status: 401 });

function summary(scope: BillingScope, orgId: string, userId: string | null): BillingSummary {
  const s = read();
  const sk = scopeOf(orgId, userId);
  const sub = s.subscriptions[sk];
  const active = sub && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due');
  const plan = active ? planState(plans().find((p) => p.id === sub.planId), 'subscription', sub.updatedAt) : planState(freePlan(), 'default');
  return {
    enabled: true,
    mode: 'test',
    scope,
    ...(plan ? { plan } : {}),
    ...(sub ? { subscription: stripLookup(sub) } : {}),
    portalAvailable: !!s.customers[sk],
    plans: plans().filter((p) => (scope === 'org' ? p.kind === 'organisation' : p.kind === 'individual')),
    currency: site.plans?.currency ?? 'EUR',
    placeholder: !!(site.plans?.placeholder || plans().some((p) => p.placeholderPrices)),
    checkoutEnabled: true,
  };
}
const stripLookup = ({ priceRef: _p, ...rest }: BillingSubscription & { priceRef: string }): BillingSubscription => rest;

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
  s.subscriptions[sk] = { id: `sub_mock_${sk.slice(0, 6)}`, planId: plan.id, interval, seats, status: 'active', currentPeriodEnd: end.toISOString(), cancelAtPeriodEnd: false, updatedAt: now.toISOString(), priceRef: price.lookupKey };
  s.events.unshift(
    { id: `evt_${Date.now()}_a`, type: 'checkout.session.completed', receivedAt: now.toISOString(), processedAt: now.toISOString(), status: 'processed', summary: { plan: plan.id, seats, interval } },
    { id: `evt_${Date.now()}_b`, type: 'customer.subscription.created', receivedAt: now.toISOString(), processedAt: now.toISOString(), status: 'processed', summary: { plan: plan.id, status: 'active' } },
  );
  write(s);
  const back = scope === 'org' ? '/admin/billing' : '/account/billing';
  return HttpResponse.json({ url: `${back}?checkout=success&session_id=cs_test_mock`, sessionId: 'cs_test_mock' }, { status: 201 });
}

export const billingHandlers = [
  http.get('/api/billing/me', async () => {
    await delay(150);
    const sess = currentSession();
    return sess ? HttpResponse.json(summary('user', sess.orgId, sess.userId)) : unauthenticated();
  }),
  http.get('/api/billing/org', async () => {
    await delay(150);
    const sess = currentSession();
    return sess ? HttpResponse.json(summary('org', sess.orgId, null)) : unauthenticated();
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
  http.post('/api/billing/me/portal', async () => {
    await delay(300);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!read().customers[scopeOf(sess.orgId, sess.userId)]) return HttpResponse.json({ error: 'No billing account yet: subscribe to a plan first.', code: 'conflict' }, { status: 409 });
    return HttpResponse.json({ url: '/account/billing?portal=mock' });
  }),
  http.post('/api/billing/org/portal', async () => {
    await delay(300);
    const sess = currentSession();
    if (!sess) return unauthenticated();
    if (!read().customers[scopeOf(sess.orgId, null)]) return HttpResponse.json({ error: 'No billing account yet: subscribe to a plan first.', code: 'conflict' }, { status: 409 });
    return HttpResponse.json({ url: '/admin/billing?portal=mock' });
  }),
];
