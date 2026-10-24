import type { FetchLike } from '../src/billing/stripe.js';

/*
 * An in-memory fake of the slice of the Stripe API the gateway uses: customers
 * (create, update), prices by lookup key (licensed and metered), products,
 * Checkout Sessions (subscription and setup mode), portal sessions,
 * subscriptions (retrieve, create, update quantity with proration), setup
 * intents, Billing Meters and meter events (deduplicated by identifier, with
 * injectable failures), plus builders for subscription and invoice objects as
 * Stripe sends them in webhook events. Never talks to Stripe; CI runs on it.
 */

type Obj = Record<string, unknown>;

export class FakeStripe {
  customers = new Map<string, Obj>();
  subscriptions = new Map<string, Obj>();
  prices = new Map<string, Obj>();
  products = new Map<string, Obj>();
  meters = new Map<string, Obj>();
  setupIntents = new Map<string, Obj>();
  /** Accepted meter events, in order. */
  meterEvents: { identifier: string; event_name: string; timestamp: number; customer: string; value: number }[] = [];
  checkouts: Record<string, string>[] = [];
  portals: Record<string, string>[] = [];
  subscriptionUpdates: { id: string; body: Record<string, string> }[] = [];
  idempotency = new Map<string, unknown>();
  requests: { method: string; url: string; body: Record<string, string> }[] = [];
  /** The next N meter event calls answer this status (500: retryable, 400: permanent). */
  failMeterEvents: { count: number; status: number; message: string } = { count: 0, status: 500, message: 'Stripe is having a moment' };
  private n = 1;

  constructor() {
    const price = (id: string, product: string, unit_amount: number, lookup_key: string, interval: 'month' | 'year') =>
      this.prices.set(id, { id, product, active: true, currency: 'eur', unit_amount, lookup_key, recurring: { interval, interval_count: 1, usage_type: 'licensed', meter: null }, metadata: {} });
    price('price_pro_m', 'prod_pro', 900, 'ct_pro_monthly', 'month');
    price('price_premium_m', 'prod_premium', 1900, 'ct_premium_monthly', 'month');
    price('price_team_m', 'prod_team', 1500, 'ct_team_seat_monthly', 'month');
    price('price_team_y', 'prod_team', 15000, 'ct_team_seat_yearly', 'year');
    this.meters.set('mtr_compute', { id: 'mtr_compute', event_name: 'ct_compute_units', display_name: 'compute units', status: 'active' });
    this.prices.set('price_compute', { id: 'price_compute', product: 'prod_compute', active: true, currency: 'eur', unit_amount: null, unit_amount_decimal: '0.166667', lookup_key: 'ct_compute_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'metered', meter: 'mtr_compute' }, metadata: {} });
  }

  /** Units reported for a customer (what Stripe would bill on the metered price). */
  usage(customer: string): number {
    return this.meterEvents.filter((e) => e.customer === customer).reduce((a, e) => a + e.value, 0);
  }

  /** The metered part of the customer's next invoice, minor units (units x unit_amount_decimal). */
  upcomingComputeAmount(customer: string): number {
    const price = [...this.prices.values()].find((p) => p.lookup_key === 'ct_compute_unit' && p.active);
    return this.usage(customer) * Number(price?.unit_amount_decimal ?? 0);
  }

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = Object.fromEntries(new URLSearchParams(init.body ?? ''));
    this.requests.push({ method: init.method, url: u.pathname + u.search, body });
    const idem = init.headers['idempotency-key'];
    if (idem && this.idempotency.has(idem)) return ok(this.idempotency.get(idem));
    const remember = (v: unknown) => (idem && this.idempotency.set(idem, v), ok(v));
    const id = (p: string) => `${p}_${this.n++}`;
    const last = () => decodeURIComponent(u.pathname.split('/').pop()!);
    const { method } = init;
    const path = u.pathname;

    if (method === 'POST' && path === '/v1/customers') {
      const c = { id: id('cus'), email: body.email ?? null, metadata: meta(body), invoice_settings: { default_payment_method: null } };
      this.customers.set(c.id, c);
      return remember(c);
    }
    if (method === 'POST' && path.startsWith('/v1/customers/')) {
      const c = this.customers.get(last());
      if (!c) return err(404, 'No such customer');
      if (body['invoice_settings[default_payment_method]']) c.invoice_settings = { default_payment_method: body['invoice_settings[default_payment_method]'] };
      return ok(c);
    }
    if (method === 'GET' && path === '/v1/prices') {
      const keys = [...u.searchParams.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v);
      return ok({ object: 'list', data: [...this.prices.values()].filter((p) => (keys.length ? keys.includes(p.lookup_key as string) : true)), has_more: false });
    }
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      this.checkouts.push(body);
      const s = { id: id('cs'), url: `https://checkout.stripe.test/${this.n}`, customer: body.customer, subscription: null, setup_intent: null, client_reference_id: body.client_reference_id, metadata: meta(body), mode: body.mode };
      return remember(s);
    }
    if (method === 'POST' && path === '/v1/billing_portal/sessions') {
      this.portals.push(body);
      return ok({ id: id('bps'), url: `https://portal.stripe.test/${this.n}` });
    }
    if (method === 'GET' && path.startsWith('/v1/subscriptions/')) {
      const s = this.subscriptions.get(last());
      return s ? ok(s) : err(404, 'No such subscription');
    }
    if (method === 'POST' && path === '/v1/subscriptions') {
      const price = this.prices.get(body['items[0][price]']!);
      if (!price) return err(400, 'No such price');
      const s = this.subscription(id('sub'), body.customer!, price.lookup_key as string, { metadata: meta(body) });
      if (price.recurring && (price.recurring as Obj).usage_type === 'metered') (s.items as { data: Obj[] }).data[0]!.quantity = undefined;
      return remember(s);
    }
    if (method === 'POST' && path.startsWith('/v1/subscriptions/')) {
      const s = this.subscriptions.get(last());
      if (!s) return err(404, 'No such subscription');
      this.subscriptionUpdates.push({ id: s.id as string, body });
      const items = (s.items as { data: Obj[] }).data;
      for (let i = 0; body[`items[${i}][id]`]; i++) {
        const item = items.find((it) => it.id === body[`items[${i}][id]`]);
        if (!item) return err(400, 'No such subscription item');
        if (body[`items[${i}][quantity]`]) item.quantity = Number(body[`items[${i}][quantity]`]);
      }
      return remember(s);
    }
    if (method === 'GET' && path.startsWith('/v1/setup_intents/')) {
      const si = this.setupIntents.get(last());
      return si ? ok(si) : err(404, 'No such setup intent');
    }
    if (method === 'GET' && path === '/v1/billing/meters') return ok({ object: 'list', data: [...this.meters.values()].filter((m) => !u.searchParams.get('status') || m.status === u.searchParams.get('status')), has_more: false });
    if (method === 'POST' && path === '/v1/billing/meters') {
      if ([...this.meters.values()].some((m) => m.event_name === body.event_name)) return err(400, 'A meter with this event_name already exists');
      const m = { id: id('mtr'), event_name: body.event_name, display_name: body.display_name, status: 'active', default_aggregation: { formula: body['default_aggregation[formula]'] }, customer_mapping: { event_payload_key: body['customer_mapping[event_payload_key]'] }, value_settings: { event_payload_key: body['value_settings[event_payload_key]'] } };
      this.meters.set(m.id, m);
      return remember(m);
    }
    if (method === 'POST' && path === '/v1/billing/meter_events') {
      if (this.failMeterEvents.count > 0) {
        this.failMeterEvents.count--;
        return err(this.failMeterEvents.status, this.failMeterEvents.message);
      }
      if (![...this.meters.values()].some((m) => m.event_name === body.event_name)) return err(400, `No active meter for event_name ${body.event_name}`);
      if (this.meterEvents.some((e) => e.identifier === body.identifier)) return err(400, `An event with identifier ${body.identifier} already exists.`);
      const e = { identifier: body.identifier!, event_name: body.event_name!, timestamp: Number(body.timestamp), customer: body['payload[stripe_customer_id]']!, value: Number(body['payload[value]']) };
      this.meterEvents.push(e);
      return remember({ object: 'billing.meter_event', identifier: e.identifier, event_name: e.event_name, timestamp: e.timestamp, payload: { stripe_customer_id: e.customer, value: String(e.value) } });
    }
    if (method === 'GET' && path === '/v1/products/search') {
      const q = /ct_plan_id'\]:'([a-z0-9-]+)'/.exec(u.searchParams.get('query') ?? '')?.[1];
      return ok({ object: 'list', data: [...this.products.values()].filter((p) => (p.metadata as Record<string, string>).ct_plan_id === q), has_more: false });
    }
    if (method === 'POST' && path === '/v1/products') {
      const p = { id: id('prod'), name: body.name, description: body.description ?? null, active: true, metadata: meta(body) };
      this.products.set(p.id, p);
      return remember(p);
    }
    if (method === 'GET' && path.startsWith('/v1/products/')) {
      const p = this.products.get(last());
      return p ? ok(p) : err(404, 'No such product');
    }
    if (method === 'POST' && path.startsWith('/v1/products/')) {
      const p = this.products.get(last())!;
      Object.assign(p, { name: body.name ?? p.name, description: body.description ?? p.description, active: body.active === undefined ? p.active : body.active === 'true' });
      return ok(p);
    }
    if (method === 'POST' && path === '/v1/prices') {
      if (body.transfer_lookup_key === 'true') for (const p of this.prices.values()) if (p.lookup_key === body.lookup_key) p.lookup_key = null;
      const p = {
        id: id('price'),
        product: body.product,
        active: true,
        currency: body.currency,
        unit_amount: body.unit_amount !== undefined ? Number(body.unit_amount) : null,
        unit_amount_decimal: body.unit_amount_decimal ?? body.unit_amount ?? null,
        lookup_key: body.lookup_key,
        recurring: { interval: body['recurring[interval]'], interval_count: 1, usage_type: body['recurring[usage_type]'] ?? 'licensed', meter: body['recurring[meter]'] ?? null },
        metadata: meta(body),
      };
      this.prices.set(p.id, p);
      return remember(p);
    }
    if (method === 'POST' && path.startsWith('/v1/prices/')) {
      const p = this.prices.get(last())!;
      if (body.active !== undefined) p.active = body.active === 'true';
      return ok(p);
    }
    return err(404, `unhandled ${method} ${path}`);
  };

  /** A subscription object as Stripe would send it in an event (also retrievable). */
  subscription(id: string, customer: string, lookupKey: string, over: Obj = {}): Obj {
    const price = [...this.prices.values()].find((p) => p.lookup_key === lookupKey)!;
    const s = { id, object: 'subscription', customer, status: 'active', cancel_at_period_end: false, current_period_end: 1_900_000_000, default_payment_method: null, metadata: {}, items: { object: 'list', data: [{ id: `si_${id}`, quantity: 1, price }], has_more: false }, ...over };
    this.subscriptions.set(id, s);
    return s;
  }

  /** A completed setup intent with a saved card (Checkout in setup mode). */
  setupIntent(customer: string): Obj {
    const si = { id: `seti_${this.n++}`, object: 'setup_intent', customer, payment_method: `pm_card_${this.n++}`, status: 'succeeded' };
    this.setupIntents.set(si.id, si);
    return si;
  }

  /** An invoice object as Stripe sends it in `invoice.paid` / `invoice.payment_failed`. */
  invoice(customer: string, over: Obj = {}): Obj {
    return { id: `in_${this.n++}`, object: 'invoice', customer, amount_due: 1234, amount_paid: 0, currency: 'eur', attempt_count: 1, status: 'open', ...over };
  }
}

export const meta = (body: Record<string, string>) => Object.fromEntries(Object.entries(body).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
const ok = (v: unknown) => ({ status: 200, json: async () => v, text: async () => JSON.stringify(v) });
const err = (status: number, message: string) => ({ status, json: async () => ({ error: { message } }), text: async () => message });
