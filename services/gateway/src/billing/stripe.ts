import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * A small Stripe REST client (form-encoded requests, JSON responses) and the
 * webhook signature check. No SDK: the surface we use is a handful of calls,
 * tests inject a fake `fetch`, and nothing here ever logs a key or a body.
 *
 * Keys: only test-mode keys are accepted in this version (`sk_test_`,
 * `rk_test_`); `isLiveKey` lets the config refuse a live key outright.
 */

export const STRIPE_API = 'https://api.stripe.com';
const API_VERSION = '2025-09-30.clover';

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export const isLiveKey = (key: string | undefined): boolean => /^[sr]k_live_/.test(key ?? '');
export const isTestKey = (key: string | undefined): boolean => /^[sr]k_test_[A-Za-z0-9]{8,}/.test(key ?? '');

/** Masks a key for logs: prefix and the last four characters only. */
export const maskKey = (key: string): string => (key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : '***');

export class StripeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly type?: string,
    public readonly param?: string,
  ) {
    super(message);
  }
}

type Params = Record<string, unknown>;

/** Stripe's form encoding: `a[b][0][c]=v`; arrays by index, booleans as strings, undefined dropped. */
export function formEncode(params: Params, prefix = '', out: string[] = []): string {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' && item !== null ? formEncode(item as Params, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === 'object') formEncode(v as Params, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
}
export interface StripeProduct {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  metadata: Record<string, string>;
}
export interface StripePrice {
  id: string;
  product: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  lookup_key: string | null;
  recurring: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } | null;
  metadata: Record<string, string>;
}
export interface StripeCustomer {
  id: string;
  email?: string | null;
  metadata: Record<string, string>;
}
export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata: Record<string, string>;
  items: StripeList<{ id: string; quantity?: number; price: StripePrice; current_period_end?: number }>;
}
export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string>;
  mode: string;
  status?: string | null;
}
export interface StripePortalSession {
  id: string;
  url: string;
}
export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  data: { object: Record<string, unknown> & { id?: string; object?: string } };
}

export class StripeApi {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly base: string = STRIPE_API,
  ) {
    if (isLiveKey(secretKey)) throw new Error('StripeApi: live keys are not accepted in this version');
  }

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}, opts: { idempotencyKey?: string } = {}): Promise<T> {
    const body = method === 'GET' ? undefined : formEncode(params);
    const url = method === 'GET' && Object.keys(params).length ? `${this.base}${path}?${formEncode(params)}` : `${this.base}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.secretKey}`,
      'stripe-version': API_VERSION,
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    const res = await this.fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}) });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string; type?: string; param?: string } };
    if (res.status >= 400) throw new StripeError(res.status, data.error?.message ?? `Stripe ${res.status}`, data.error?.code, data.error?.type, data.error?.param);
    return data as T;
  }

  customers = {
    create: (p: { email?: string; name?: string; metadata?: Record<string, string> }, idempotencyKey?: string) => this.request<StripeCustomer>('POST', '/v1/customers', p, { idempotencyKey }),
    retrieve: (id: string) => this.request<StripeCustomer>('GET', `/v1/customers/${encodeURIComponent(id)}`),
  };
  products = {
    search: (query: string) => this.request<StripeList<StripeProduct>>('GET', '/v1/products/search', { query, limit: 10 }),
    create: (p: { name: string; description?: string; metadata?: Record<string, string> }, idempotencyKey?: string) => this.request<StripeProduct>('POST', '/v1/products', p, { idempotencyKey }),
    update: (id: string, p: { name?: string; description?: string; metadata?: Record<string, string>; active?: boolean }) => this.request<StripeProduct>('POST', `/v1/products/${encodeURIComponent(id)}`, p),
    retrieve: (id: string) => this.request<StripeProduct>('GET', `/v1/products/${encodeURIComponent(id)}`),
  };
  prices = {
    list: (p: { lookup_keys?: string[]; product?: string; active?: boolean; limit?: number }) => this.request<StripeList<StripePrice>>('GET', '/v1/prices', p),
    create: (p: { product: string; currency: string; unit_amount: number; recurring: { interval: 'month' | 'year' }; lookup_key: string; transfer_lookup_key?: boolean; metadata?: Record<string, string>; nickname?: string }, idempotencyKey?: string) =>
      this.request<StripePrice>('POST', '/v1/prices', p, { idempotencyKey }),
    update: (id: string, p: { active?: boolean; metadata?: Record<string, string> }) => this.request<StripePrice>('POST', `/v1/prices/${encodeURIComponent(id)}`, p),
  };
  checkout = {
    sessions: {
      create: (p: Params, idempotencyKey?: string) => this.request<StripeCheckoutSession>('POST', '/v1/checkout/sessions', p, { idempotencyKey }),
      retrieve: (id: string) => this.request<StripeCheckoutSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
    },
  };
  billingPortal = {
    sessions: { create: (p: { customer: string; return_url: string }) => this.request<StripePortalSession>('POST', '/v1/billing_portal/sessions', p) },
  };
  subscriptions = {
    retrieve: (id: string) => this.request<StripeSubscription>('GET', `/v1/subscriptions/${encodeURIComponent(id)}`),
  };
}

/* ------------------------------------------------------------ webhooks */

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Verifies a `Stripe-Signature` header over the raw request body: HMAC-SHA256 of
 * `${t}.${body}` with the endpoint secret must match one of the `v1` signatures,
 * and `t` must be within the tolerance. Returns the parsed event or throws.
 */
export function verifyWebhook(rawBody: string | Buffer, header: string | undefined, secret: string, now: number = Date.now(), tolerance = WEBHOOK_TOLERANCE_SECONDS): StripeEvent {
  if (!header) throw new WebhookError('missing Stripe-Signature header');
  const parts = header.split(',').map((kv) => kv.trim().split('=', 2) as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) throw new WebhookError('malformed Stripe-Signature header');
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')));
  if (!ok) throw new WebhookError('signature mismatch');
  if (Math.abs(Math.floor(now / 1000) - Number(t)) > tolerance) throw new WebhookError('timestamp outside tolerance');
  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    throw new WebhookError('body is not JSON');
  }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string' || !event.data?.object) throw new WebhookError('body is not a Stripe event');
  return event;
}

/** Builds a `Stripe-Signature` header (tests and the local `stripe listen` replacement). */
export function signWebhook(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export class WebhookError extends Error {}
