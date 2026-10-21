import { describe, expect, it } from 'vitest';
import { billingConfig } from '../src/config.js';
import { formEncode, isLiveKey, isTestKey, maskKey, signWebhook, StripeApi, verifyWebhook, WebhookError } from '../src/billing/stripe.js';

/* Stripe client plumbing and the test-mode-only guard rails; no network. */

const SECRET = 'whsec_test_0123456789abcdef';
const TEST_KEY = 'sk_test_51FAKEFAKEFAKEFAKEFAKEFAKE';

describe('billing config guard rails', () => {
  const base = { CT_PUBLIC_URL: 'http://localhost:8787' };
  it('is off by default and never accepts a live key', () => {
    expect(billingConfig({ ...base })).toEqual({ enabled: false, mode: 'test', secretKey: '', webhookSecret: '', enforce: false, sweepMs: 60000 });
    expect(() => billingConfig({ ...base, STRIPE_SECRET_KEY: 'sk_live_FAKEFAKEFAKEFAKEFAKE' })).toThrow(/live key/);
    expect(() => billingConfig({ ...base, CT_BILLING_ENABLED: '1', STRIPE_SECRET_KEY: 'rk_live_FAKEFAKEFAKEFAKEFAKE', STRIPE_WEBHOOK_SECRET: SECRET })).toThrow(/live key/);
  });
  it('supports test mode only', () => {
    expect(() => billingConfig({ ...base, STRIPE_MODE: 'live' })).toThrow(/test mode only/);
    expect(() => billingConfig({ ...base, CT_BILLING_ENABLED: 'yes' })).toThrow(/CT_BILLING_ENABLED/);
  });
  it('needs a test key and a webhook secret when on', () => {
    expect(() => billingConfig({ ...base, CT_BILLING_ENABLED: '1' })).toThrow(/test-mode key/);
    expect(() => billingConfig({ ...base, CT_BILLING_ENABLED: '1', STRIPE_SECRET_KEY: TEST_KEY })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(billingConfig({ ...base, CT_BILLING_ENABLED: '1', STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: SECRET })).toEqual({ enabled: true, mode: 'test', secretKey: TEST_KEY, webhookSecret: SECRET, enforce: true, sweepMs: 60000 });
    // Enforcement follows billing unless CT_BILLING_ENFORCE says otherwise; it never runs without billing.
    expect(billingConfig({ ...base, CT_BILLING_ENABLED: '1', CT_BILLING_ENFORCE: '0', STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: SECRET }).enforce).toBe(false);
    expect(billingConfig({ ...base, CT_BILLING_ENFORCE: '1' }).enforce).toBe(false);
    expect(() => billingConfig({ ...base, CT_BILLING_ENFORCE: 'on' })).toThrow(/CT_BILLING_ENFORCE/);
    expect(() => billingConfig({ ...base, CT_BILLING_SWEEP_MS: '-5' })).toThrow(/CT_BILLING_SWEEP_MS/);
  });
  it('key helpers', () => {
    expect(isLiveKey('sk_live_x')).toBe(true);
    expect(isTestKey(TEST_KEY)).toBe(true);
    expect(isTestKey('sk_test_short')).toBe(false);
    expect(maskKey(TEST_KEY)).toBe('sk_test_…FAKE');
    expect(maskKey(TEST_KEY)).not.toContain('51FAKEFAKEFAKEFAKEFAKE');
    expect(() => new StripeApi('sk_live_FAKEFAKEFAKEFAKEFAKE')).toThrow(/live keys/);
  });
});

describe('form encoding', () => {
  it('nests objects and arrays the way Stripe expects', () => {
    const enc = formEncode({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 3 }], metadata: { ct_org_id: 'o1', ct_user_id: '' }, allow_promotion_codes: false, skip: undefined, lookup_keys: ['a', 'b'] });
    const pairs = decodeURIComponent(enc).split('&');
    expect(pairs).toEqual(['mode=subscription', 'line_items[0][price]=price_1', 'line_items[0][quantity]=3', 'metadata[ct_org_id]=o1', 'metadata[ct_user_id]=', 'allow_promotion_codes=false', 'lookup_keys[0]=a', 'lookup_keys[1]=b']);
  });
});

describe('webhook signatures', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', livemode: false, created: 1, data: { object: { id: 'sub_1', object: 'subscription' } } });
  const now = 1_760_000_000_000;
  it('accepts a valid signature within tolerance', () => {
    const header = signWebhook(body, SECRET, Math.floor(now / 1000) - 10);
    expect(verifyWebhook(body, header, SECRET, now).id).toBe('evt_1');
    expect(verifyWebhook(Buffer.from(body), header, SECRET, now).type).toBe('customer.subscription.updated');
  });
  it('rejects a missing, malformed, wrong or stale signature and a non-event body', () => {
    expect(() => verifyWebhook(body, undefined, SECRET, now)).toThrow(WebhookError);
    expect(() => verifyWebhook(body, 't=abc,v1=00', SECRET, now)).toThrow(/malformed/);
    expect(() => verifyWebhook(body, signWebhook(body, 'whsec_other', Math.floor(now / 1000)), SECRET, now)).toThrow(/mismatch/);
    expect(() => verifyWebhook(`${body} `, signWebhook(body, SECRET, Math.floor(now / 1000)), SECRET, now)).toThrow(/mismatch/);
    expect(() => verifyWebhook(body, signWebhook(body, SECRET, Math.floor(now / 1000) - 600), SECRET, now)).toThrow(/tolerance/);
    expect(() => verifyWebhook('{"nope":1}', signWebhook('{"nope":1}', SECRET, Math.floor(now / 1000)), SECRET, now)).toThrow(/not a Stripe event/);
  });
  it('accepts any one of several v1 signatures (secret rotation)', () => {
    const t = Math.floor(now / 1000);
    const good = signWebhook(body, SECRET, t).split('v1=')[1]!;
    expect(verifyWebhook(body, `t=${t},v1=deadbeef,v1=${good}`, SECRET, now).id).toBe('evt_1');
  });
});

describe('StripeApi requests', () => {
  it('sends bearer auth, form bodies and idempotency keys, and surfaces Stripe errors', async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const api = new StripeApi(TEST_KEY, async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/customers')) return { status: 200, json: async () => ({ id: 'cus_1', metadata: {} }), text: async () => '' };
      return { status: 402, json: async () => ({ error: { message: 'Your card was declined.', code: 'card_declined', type: 'card_error' } }), text: async () => '' };
    });
    const c = await api.customers.create({ email: 'a@b.example', metadata: { ct_org_id: 'o1' } }, 'cus:o1:u1');
    expect(c.id).toBe('cus_1');
    expect(calls[0]!.init.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(calls[0]!.init.headers['idempotency-key']).toBe('cus:o1:u1');
    expect(calls[0]!.init.body).toBe('email=a%40b.example&metadata%5Bct_org_id%5D=o1');
    await expect(api.checkout.sessions.create({ mode: 'subscription' })).rejects.toMatchObject({ status: 402, code: 'card_declined' });
    const list = new StripeApi(TEST_KEY, async (url) => {
      calls.push({ url, init: { method: 'GET', headers: {} } });
      return { status: 200, json: async () => ({ object: 'list', data: [], has_more: false }), text: async () => '' };
    });
    await list.prices.list({ lookup_keys: ['ct_pro_monthly'], active: true });
    expect(calls.at(-1)!.url).toBe('https://api.stripe.com/v1/prices?lookup_keys%5B0%5D=ct_pro_monthly&active=true');
  });
});
