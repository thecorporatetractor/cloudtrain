import { describe, expect, it, vi } from 'vitest';
import { confirmPrivacyRequest, emptyPrivacyForm, PrivacyError, privacyPayload, resultMessage, submitPrivacyRequest, tokenFromHash, validatePrivacyForm } from './privacyRequest';

const json = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('privacy request form', () => {
  it('needs a valid address and a type', () => {
    expect(validatePrivacyForm(emptyPrivacyForm)).toEqual({ email: 'Enter your email address', type: 'Choose what you would like us to do' });
    expect(validatePrivacyForm({ ...emptyPrivacyForm, email: 'nope', type: 'erasure' }).email).toMatch(/valid email/);
    expect(validatePrivacyForm({ ...emptyPrivacyForm, email: 'a@b.io', type: 'export' })).toEqual({});
  });

  it('trims the address and passes the honeypot on', () => {
    expect(privacyPayload({ email: ' a@b.io ', type: 'erasure', website: '' })).toEqual({ email: 'a@b.io', type: 'erasure', website: '' });
  });

  it('reads the token from the fragment', () => {
    expect(tokenFromHash('#token=v1.abc')).toBe('v1.abc');
    expect(tokenFromHash('#token=v1%2Eabc')).toBe('v1.abc');
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#other=1')).toBeNull();
  });
});

describe('the two calls', () => {
  it('posts without cookies to the public route', async () => {
    const f = json(202, { status: 'accepted', message: 'If this address...' });
    await expect(submitPrivacyRequest({ email: 'a@b.io', type: 'erasure' }, f, '/api/public/privacy/requests')).resolves.toMatchObject({ status: 'accepted' });
    expect(f).toHaveBeenCalledWith('/api/public/privacy/requests', expect.objectContaining({ method: 'POST', credentials: 'omit' }));
  });

  it('maps field errors and the rate limit', async () => {
    await expect(submitPrivacyRequest({ email: 'x', type: 'erasure' }, json(422, { error: 'Check', details: { fields: { email: 'bad' } } }))).rejects.toMatchObject({ kind: 'invalid', fields: { email: 'bad' } });
    await expect(submitPrivacyRequest({ email: 'x', type: 'erasure' }, json(429, { details: { retryAfterSeconds: 60 } }))).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 60 });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(submitPrivacyRequest({ email: 'x', type: 'erasure' }, down)).rejects.toBeInstanceOf(PrivacyError);
  });

  it('confirm: completed, pending, expired, unavailable', async () => {
    await expect(confirmPrivacyRequest('t', json(200, { status: 'completed', type: 'erasure', removed: 1 }))).resolves.toMatchObject({ removed: 1 });
    await expect(confirmPrivacyRequest('t', json(202, { status: 'pending', type: 'erasure' }))).resolves.toMatchObject({ status: 'pending' });
    await expect(confirmPrivacyRequest('t', json(410, { error: 'gone' }))).rejects.toMatchObject({ kind: 'expired' });
    await expect(confirmPrivacyRequest('t', json(503, { error: 'later' }))).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('what the visitor is told', () => {
  it('never says erased while it is pending', () => {
    const m = resultMessage({ status: 'pending', type: 'erasure' });
    expect(`${m.title} ${m.body}`).not.toMatch(/\berased\b|deleted|removed/i);
  });

  it('says what happened', () => {
    expect(resultMessage({ status: 'completed', type: 'erasure', removed: 1 }).title).toMatch(/erased/);
    expect(resultMessage({ status: 'completed', type: 'withdrawal', removed: 1 }).title).toMatch(/withdrawn/);
    expect(resultMessage({ status: 'completed', type: 'erasure', removed: 0 }).title).toMatch(/no waitlist entry/);
    expect(resultMessage({ status: 'completed', type: 'export', removed: 0, data: { waitlist: [] } }).title).toMatch(/no waitlist entry/);
  });
});
