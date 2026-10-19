import { describe, expect, it, vi } from 'vitest';
import type { SiteWaitlist } from '@/api/types';
import { emptyWaitlistForm, isEmail, submitWaitlist, validateWaitlistForm, waitlistPayload, WaitlistError, type WaitlistForm } from './waitlist';

const cfg: SiteWaitlist = { enabled: true };
const form = (patch: Partial<WaitlistForm> = {}): WaitlistForm => ({ ...emptyWaitlistForm, email: 'ada@example.com', consent: true, ...patch });

describe('waitlist form validation', () => {
  it('needs a valid email and the consent, nothing else by default', () => {
    expect(validateWaitlistForm(form(), cfg)).toEqual({});
    expect(validateWaitlistForm(form({ email: '' }), cfg).email).toMatch(/Enter your email/);
    expect(validateWaitlistForm(form({ email: 'nope' }), cfg).email).toMatch(/valid email/);
    expect(validateWaitlistForm(form({ consent: false }), cfg).consent).toMatch(/privacy notice/);
  });

  it('applies the required flags of the configuration and skips disabled fields', () => {
    const strict: SiteWaitlist = { enabled: true, fields: { organisation: { required: true }, role: { required: true }, interest: { required: true } } };
    expect(Object.keys(validateWaitlistForm(form(), strict)).sort()).toEqual(['interest', 'organisation', 'role']);
    const off: SiteWaitlist = { enabled: true, fields: { organisation: { required: true, enabled: false }, role: { enabled: false }, interest: { required: true, enabled: false } } };
    expect(validateWaitlistForm(form(), off)).toEqual({});
  });

  it('limits the length of the free-text fields', () => {
    expect(validateWaitlistForm(form({ organisation: 'x'.repeat(121) }), cfg).organisation).toBeTruthy();
    expect(validateWaitlistForm(form({ role: 'x'.repeat(81) }), cfg).role).toBeTruthy();
  });

  it('isEmail matches the gateway rules', () => {
    for (const ok of ['a@b.io', 'first.last+tag@sub.example.co.uk']) expect(isEmail(ok)).toBe(true);
    for (const bad of ['', 'a', 'a@b', 'a b@c.io', 'a@b..io', '.a@b.io']) expect(isEmail(bad)).toBe(false);
  });
});

describe('waitlist payload', () => {
  it('trims, drops empty and disabled optional fields and keeps the honeypot', () => {
    expect(waitlistPayload(form({ email: ' ada@example.com ', organisation: ' Org ', role: '', interest: 'individual' }), cfg)).toEqual({ email: 'ada@example.com', organisation: 'Org', interest: 'individual', consent: true, website: '' });
    const noOrg: SiteWaitlist = { enabled: true, fields: { organisation: { enabled: false } } };
    expect(waitlistPayload(form({ organisation: 'Org' }), noOrg)).not.toHaveProperty('organisation');
  });
});

describe('submitWaitlist', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const payload = waitlistPayload(form(), cfg);

  it('posts JSON without credentials to the configured URL and returns created or duplicate', async () => {
    const created = reply(201, { status: 'created' });
    expect(await submitWaitlist(payload, created, 'https://api.example.com/api/public/waitlist')).toEqual({ status: 'created' });
    const [url, init] = (created as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/public/waitlist');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(JSON.parse(init.body as string)).toMatchObject({ email: 'ada@example.com', consent: true });
    expect(await submitWaitlist(payload, reply(200, { status: 'duplicate' }), '/x')).toEqual({ status: 'duplicate' });
  });

  it('maps field errors, rate limits and failures to typed errors', async () => {
    const invalid = await submitWaitlist(payload, reply(422, { error: 'Check', code: 'invalid', details: { fields: { email: 'Enter a valid email address' } } }), '/x').catch((e) => e);
    expect(invalid).toBeInstanceOf(WaitlistError);
    expect(invalid).toMatchObject({ kind: 'invalid', fields: { email: 'Enter a valid email address' } });
    const limited = await submitWaitlist(payload, reply(429, { error: 'Too many', code: 'rate_limited', details: { retryAfterSeconds: 120 } }), '/x').catch((e) => e);
    expect(limited).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 120 });
    expect(await submitWaitlist(payload, reply(503, { error: 'down' }), '/x').catch((e) => e)).toMatchObject({ kind: 'failed' });
    const offline = vi.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await submitWaitlist(payload, offline, '/x').catch((e) => e)).toMatchObject({ kind: 'failed' });
  });
});
