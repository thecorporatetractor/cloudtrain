import type { SiteConfig, SitePlan } from '@cloudtrain/api-types';
import type { StripeApi, StripeMeter, StripePrice, StripeProduct } from './stripe.js';

/*
 * Creates or updates the Stripe Products and Prices behind the configured plans,
 * idempotently: one Product per paid plan (found by `metadata.ct_plan_id`), one
 * Price per interval (found by lookup key). A price whose amount, currency or
 * interval changed gets a new Price that takes over the lookup key
 * (`transfer_lookup_key`), and the old one is archived, so subscriptions keep
 * their price and new checkouts get the new one. Test account only.
 *
 * Compute (`plans.compute`): one Billing Meter (found by event name, sum of
 * `value` per `stripe_customer_id`), one "Compute" Product and one metered
 * monthly Price on that meter (`unit_amount_decimal` per unit, found by
 * lookup key, replaced the same way when the rate changes).
 */

export interface SyncAction {
  plan: string;
  interval?: 'monthly' | 'yearly';
  action: 'product.create' | 'product.update' | 'product.ok' | 'price.create' | 'price.replace' | 'price.ok' | 'skip.free' | 'meter.create' | 'meter.ok';
  id?: string;
  detail?: string;
}

export interface SyncOptions {
  dryRun?: boolean;
  log?: (line: string) => void;
}

const toStripeInterval = (i: 'monthly' | 'yearly'): 'month' | 'year' => (i === 'monthly' ? 'month' : 'year');

export async function syncPlans(stripe: StripeApi, site: SiteConfig, opts: SyncOptions = {}): Promise<SyncAction[]> {
  const plans = site.plans;
  if (!plans) throw new Error('the site configuration has no plans');
  const actions: SyncAction[] = [];
  const log = (a: SyncAction) => {
    actions.push(a);
    opts.log?.(`${a.action.padEnd(14)} ${a.plan}${a.interval ? `/${a.interval}` : ''}${a.id ? ` ${a.id}` : ''}${a.detail ? ` (${a.detail})` : ''}`);
  };
  for (const plan of plans.items) {
    if (plan.kind === 'free' || !plan.prices) {
      log({ plan: plan.id, action: 'skip.free' });
      continue;
    }
    const product = await ensureProduct(stripe, site, plan, opts, log);
    for (const interval of ['monthly', 'yearly'] as const) {
      const price = plan.prices[interval];
      if (!price) continue;
      const existing = (await stripe.prices.list({ lookup_keys: [price.lookupKey], limit: 10 })).data.find((p) => p.active) ?? (await stripe.prices.list({ lookup_keys: [price.lookupKey], limit: 10 })).data[0];
      const want = { unit_amount: price.amount, currency: plans.currency.toLowerCase(), interval: toStripeInterval(interval) };
      const same = (p: StripePrice) => p.unit_amount === want.unit_amount && p.currency === want.currency && p.recurring?.interval === want.interval && p.recurring.interval_count === 1 && (!product || p.product === product.id) && p.active;
      if (existing && same(existing)) {
        log({ plan: plan.id, interval, action: 'price.ok', id: existing.id });
        continue;
      }
      const params = {
        product: product?.id ?? 'prod_dry_run',
        currency: want.currency,
        unit_amount: want.unit_amount,
        recurring: { interval: want.interval },
        lookup_key: price.lookupKey,
        ...(existing ? { transfer_lookup_key: true } : {}),
        nickname: `${plan.name} ${interval}${plan.perSeat ? ' per seat' : ''}`,
        metadata: { ct_plan_id: plan.id, ct_interval: interval, ct_per_seat: String(!!plan.perSeat), ct_placeholder: String(!!(plan.placeholderPrices || plans.placeholder)) },
      };
      if (opts.dryRun) {
        log({ plan: plan.id, interval, action: existing ? 'price.replace' : 'price.create', detail: `dry run: ${want.unit_amount} ${want.currency}/${want.interval}` });
        continue;
      }
      const created = await stripe.prices.create(params, `price:${price.lookupKey}:${want.unit_amount}:${want.currency}:${want.interval}`);
      if (existing) {
        if (existing.active) await stripe.prices.update(existing.id, { active: false });
        log({ plan: plan.id, interval, action: 'price.replace', id: created.id, detail: `was ${existing.id}` });
      } else log({ plan: plan.id, interval, action: 'price.create', id: created.id });
    }
  }
  if (plans.compute) await syncCompute(stripe, site, opts, log);
  return actions;
}

async function syncCompute(stripe: StripeApi, site: SiteConfig, opts: SyncOptions, log: (a: SyncAction) => void): Promise<void> {
  const c = site.plans!.compute!;
  const currency = site.plans!.currency.toLowerCase();
  const meters = (await stripe.meters.list({ status: 'active' })).data;
  let meter: StripeMeter | undefined = meters.find((m) => m.event_name === c.meterEventName);
  if (meter) log({ plan: 'compute', action: 'meter.ok', id: meter.id });
  else if (opts.dryRun) log({ plan: 'compute', action: 'meter.create', detail: `dry run: ${c.meterEventName}` });
  else {
    meter = await stripe.meters.create(
      {
        display_name: `${site.brand.name} compute units`,
        event_name: c.meterEventName,
        default_aggregation: { formula: 'sum' },
        customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
        value_settings: { event_payload_key: 'value' },
      },
      `meter:${c.meterEventName}`,
    );
    log({ plan: 'compute', action: 'meter.create', id: meter.id });
  }
  const pseudo = {
    id: 'compute',
    name: 'Compute',
    kind: 'individual',
    description: `Lab compute, metered per minute by environment tier (${Object.values(c.tiers)
      .map((t) => `${t.label}: ${t.unitsPerMinute}/min`)
      .join(', ')}).`,
    prices: { monthly: { amount: 0, lookupKey: c.lookupKey } },
    entitlements: site.plans!.items[0]!.entitlements,
    includes: [],
    cta: { label: 'Compute', action: 'contact' },
  } as SitePlan;
  const product = await ensureProduct(stripe, site, pseudo, opts, log);
  const listed = (await stripe.prices.list({ lookup_keys: [c.lookupKey], limit: 10 })).data;
  const existing = listed.find((p) => p.active) ?? listed[0];
  const same = (p: StripePrice) =>
    Number(p.unit_amount_decimal ?? p.unit_amount ?? NaN) === Number(c.unitPrice) && p.currency === currency && p.recurring?.interval === 'month' && p.recurring.usage_type === 'metered' && (!meter || p.recurring.meter === meter.id) && (!product || p.product === product.id) && p.active;
  if (existing && same(existing)) {
    log({ plan: 'compute', interval: 'monthly', action: 'price.ok', id: existing.id });
    return;
  }
  if (opts.dryRun || !meter) {
    log({ plan: 'compute', interval: 'monthly', action: existing ? 'price.replace' : 'price.create', detail: `dry run: ${c.unitPrice} ${currency}/unit metered` });
    return;
  }
  const created = await stripe.prices.create(
    {
      product: product?.id ?? 'prod_dry_run',
      currency,
      unit_amount_decimal: c.unitPrice,
      recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
      lookup_key: c.lookupKey,
      ...(existing ? { transfer_lookup_key: true } : {}),
      nickname: 'Compute unit (metered)',
      metadata: { ct_plan_id: 'compute', ct_kind: 'compute', ct_placeholder: String(!!c.placeholder) },
    },
    `price:${c.lookupKey}:${c.unitPrice}:${currency}:${meter.id}`,
  );
  if (existing) {
    if (existing.active) await stripe.prices.update(existing.id, { active: false });
    log({ plan: 'compute', interval: 'monthly', action: 'price.replace', id: created.id, detail: `was ${existing.id}` });
  } else log({ plan: 'compute', interval: 'monthly', action: 'price.create', id: created.id });
}

async function ensureProduct(stripe: StripeApi, site: SiteConfig, plan: SitePlan, opts: SyncOptions, log: (a: SyncAction) => void): Promise<StripeProduct | undefined> {
  const name = `${site.brand.name} ${plan.name}`;
  const description = plan.description;
  const metadata = { ct_plan_id: plan.id, ct_kind: plan.id === 'compute' ? 'compute' : plan.kind, ct_per_seat: String(!!plan.perSeat) };
  // Search is eventually consistent (a product created seconds ago may not be indexed yet), so a
  // price that already carries one of the plan's lookup keys names the product first.
  const keys = Object.values(plan.prices ?? {}).map((p) => p.lookupKey);
  const viaPrice = keys.length ? (await stripe.prices.list({ lookup_keys: keys, limit: 10 })).data[0]?.product : undefined;
  const searched = (await stripe.products.search(`metadata['ct_plan_id']:'${plan.id}'`)).data;
  const found = (viaPrice ? await stripe.products.retrieve(viaPrice).catch(() => undefined) : undefined) ?? searched.find((p) => p.active) ?? searched[0];
  if (found) {
    if (found.name === name && (found.description ?? '') === description && found.active) {
      log({ plan: plan.id, action: 'product.ok', id: found.id });
      return found;
    }
    if (opts.dryRun) {
      log({ plan: plan.id, action: 'product.update', id: found.id, detail: 'dry run' });
      return found;
    }
    const updated = await stripe.products.update(found.id, { name, description, metadata, active: true });
    log({ plan: plan.id, action: 'product.update', id: updated.id });
    return updated;
  }
  if (opts.dryRun) {
    log({ plan: plan.id, action: 'product.create', detail: 'dry run' });
    return undefined;
  }
  const created = await stripe.products.create({ name, description, metadata }, `product:${plan.id}`);
  log({ plan: plan.id, action: 'product.create', id: created.id });
  return created;
}
