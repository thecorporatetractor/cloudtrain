import { beforeEach, describe, expect, it } from 'vitest';
import { publicSettings } from '../src/config.js';
import { ACCEPTED, ipPrefix, MAX_BODY_CHARS, postPrivacyConfirm, postPrivacyRequest, postWaitlist, type ApiRequest, type ConsentEvidence, type PublicDeps } from '../src/public/handlers.js';
import { WriteCap } from '../src/ratelimit.js';
import { dayOf, issueLeaveToken, issueToken, subjectKey, tokenHash, verifyToken, waitlistShard } from '../src/subject.js';
import { addOnly, MemoryLog, MemoryQueue, MemoryTable } from './fakes.js';

const HMAC = 'test-hmac-key';
const PRINCIPAL = 'AAAAAAAA-1111-2222-3333-444444444444';
const NOW = new Date('2026-11-02T12:00:00.000Z');
const cfg = { enabled: true, consentLabel: 'I agree', fields: { role: { options: ['Engineer'] } } };
const consent: ConsentEvidence = { labelHash: 'a'.repeat(64), noticeUpdated: '2026-11-02', source: 'site-waitlist-form' };

function req(body: unknown, headers: Record<string, string> = {}): ApiRequest {
  const h = new Map(Object.entries({ 'x-ms-client-principal-id': PRINCIPAL.toLowerCase(), 'x-ct-client-ip': '203.0.113.77', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (n) => h.get(n.toLowerCase()) ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

let waitlist: MemoryTable<never>;
let intake: MemoryTable<never>;
let queue: MemoryQueue;
let log: MemoryLog;
let d: PublicDeps;

beforeEach(() => {
  waitlist = new MemoryTable();
  intake = new MemoryTable();
  queue = new MemoryQueue();
  log = new MemoryLog();
  d = {
    hmacKey: HMAC,
    allowedPrincipalId: PRINCIPAL,
    waitlist: cfg,
    consent,
    revealDuplicates: false,
    requestTtlMs: 86_400_000,
    waitlistTable: addOnly(waitlist),
    intakeTable: addOnly(intake),
    queue,
    writeCap: new WriteCap(1e6, 1e6),
    now: () => NOW,
    log,
    logSample: 1,
    random: () => 0,
  };
});

const entry = { email: 'Person@Example.com', organisation: 'Org', role: 'Engineer', interest: 'individual', consent: true, website: '' };

describe('every route: the caller', () => {
  const routes = [
    ['waitlist', postWaitlist],
    ['requests', postPrivacyRequest],
    ['confirm', postPrivacyConfirm],
  ] as const;
  for (const [name, handler] of routes) {
    it(`${name}: refuses without the header, with another principal, and when none is configured`, async () => {
      for (const r of [req(entry, { 'x-ms-client-principal-id': '' }), req(entry, { 'x-ms-client-principal-id': '00000000-0000-0000-0000-000000000000' })]) {
        expect((await handler(r, d)).status).toBe(403);
      }
      expect((await handler(req(entry), { ...d, allowedPrincipalId: '' })).status).toBe(403);
      expect(waitlist.adds + intake.adds + queue.messages.length).toBe(0);
    });
    it(`${name}: refuses an oversized body`, async () => {
      expect((await handler(req('x'.repeat(MAX_BODY_CHARS + 1)), d)).status).toBe(413);
    });
  }
  it('compares the principal without regard to case', async () => {
    expect((await postWaitlist(req(entry, { 'x-ms-client-principal-id': PRINCIPAL.toUpperCase() }), d)).status).toBe(201);
  });
});

describe('POST /api/public/waitlist', () => {
  it('adds one row keyed by the HMAC, in a shard of it, with no plaintext in any key', async () => {
    const r = await postWaitlist(req(entry), d);
    expect(r).toMatchObject({ status: 201, body: { status: 'created' } });
    expect(r.headers?.['cache-control']).toBe('no-store');
    const [row] = waitlist.all() as unknown as Record<string, string>[];
    const key = subjectKey('person@example.com', HMAC);
    expect(row).toMatchObject({ partitionKey: waitlistShard(key), rowKey: key, email: 'Person@Example.com', organisation: 'Org', role: 'Engineer', interest: 'individual', consentAt: NOW.toISOString(), createdAt: NOW.toISOString() });
    expect(`${row!.partitionKey}${row!.rowKey}`).not.toMatch(/person|example/i);
  });

  it('stores the consent evidence and no address of the visitor', async () => {
    await postWaitlist(req(entry), d);
    const [row] = waitlist.all() as unknown as Record<string, string>[];
    expect(row).toMatchObject({ consentLabelHash: consent.labelHash, privacyNoticeUpdated: '2026-11-02', formSource: 'site-waitlist-form' });
    expect(JSON.stringify(row)).not.toContain('203.0.113');
  });

  it('never reads: the deps it gets can only add', async () => {
    await postWaitlist(req(entry), d);
    await postWaitlist(req(entry), d);
    expect(waitlist.reads).toBe(0);
  });

  it('a second signup, any case and spacing, any month, changes nothing, through the 409 alone', async () => {
    await postWaitlist(req(entry), d);
    const later = { ...d, now: () => new Date('2027-08-01T00:00:00.000Z') };
    await postWaitlist(req({ ...entry, email: '  PERSON@example.COM ' }), later);
    expect(waitlist.adds).toBe(2);
    expect(waitlist.all()).toHaveLength(1);
    expect((waitlist.all()[0] as unknown as { createdAt: string }).createdAt).toBe(NOW.toISOString());
  });

  it('a duplicate gets exactly the answer of a new signup: nobody can test an address', async () => {
    const a = await postWaitlist(req(entry), d);
    const b = await postWaitlist(req(entry), d);
    expect(a).toMatchObject({ status: 201, body: { status: 'created' } });
    expect(b).toEqual(a);
  });

  it('tells a duplicate apart only when explicitly configured to', async () => {
    await postWaitlist(req(entry), d);
    expect(await postWaitlist(req(entry), { ...d, revealDuplicates: true })).toMatchObject({ status: 200, body: { status: 'duplicate' } });
  });

  it('the default setting does not reveal: only an explicit true does', () => {
    const base = { CT_GDPR_HMAC_KEY: 'k', SITE_ALLOWED_PRINCIPAL_ID: 'p' };
    expect(publicSettings(base).revealDuplicates).toBe(false);
    expect(publicSettings({ ...base, SITE_WAITLIST_REVEAL_DUPLICATES: 'false' }).revealDuplicates).toBe(false);
    expect(publicSettings({ ...base, SITE_WAITLIST_REVEAL_DUPLICATES: 'yes' }).revealDuplicates).toBe(false);
    expect(publicSettings({ ...base, SITE_WAITLIST_REVEAL_DUPLICATES: 'true' }).revealDuplicates).toBe(true);
  });

  it('queues one welcome for a new row, holding no address', async () => {
    await postWaitlist(req(entry), d);
    expect(queue.messages).toEqual([{ v: 1, kind: 'welcome', subjectKey: subjectKey('person@example.com', HMAC) }]);
    expect(JSON.stringify(queue.messages)).not.toMatch(/person|example/i);
  });

  it('queues no welcome for a duplicate or the honeypot', async () => {
    await postWaitlist(req(entry), d);
    queue.messages.length = 0;
    await postWaitlist(req(entry), d);
    await postWaitlist(req({ ...entry, email: 'bot@example.com', website: 'http://spam' }), d);
    expect(queue.messages).toEqual([]);
  });

  it('a failure queuing the welcome does not change the answer or lose the signup', async () => {
    queue.fail = 1;
    const r = await postWaitlist(req(entry), d);
    expect(r).toMatchObject({ status: 201, body: { status: 'created' } });
    expect(waitlist.all()).toHaveLength(1);
  });

  it('the honeypot answers success and stores nothing', async () => {
    const r = await postWaitlist(req({ ...entry, website: 'http://spam' }), d);
    expect(r).toMatchObject({ status: 201, body: { status: 'created' } });
    expect(waitlist.adds).toBe(0);
  });

  it('answers 422 with fields, as the form reads them', async () => {
    const r = await postWaitlist(req({ email: 'nope', role: 'Pirate' }), d);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'invalid', details: { fields: { email: expect.any(String), role: expect.any(String), consent: expect.any(String) } } });
    expect((await postWaitlist(req('not json'), d)).status).toBe(422);
  });

  it('fails closed without the bundled configuration, 404 when the waitlist is off, 503 on a storage failure', async () => {
    expect((await postWaitlist(req(entry), { ...d, waitlist: null })).status).toBe(503);
    expect((await postWaitlist(req(entry), { ...d, consent: null })).status).toBe(503);
    expect((await postWaitlist(req(entry), { ...d, waitlist: { enabled: false } })).status).toBe(404);
    waitlist.failAdd = 1;
    expect((await postWaitlist(req(entry), d)).status).toBe(503);
  });
});

describe('POST /api/public/privacy/requests', () => {
  it('the answer is the same for every address and for the honeypot', async () => {
    const a = await postPrivacyRequest(req({ email: 'known@example.com', type: 'erasure' }), d);
    const b = await postPrivacyRequest(req({ email: 'unknown@example.com', type: 'export' }), d);
    const c = await postPrivacyRequest(req({ email: 'bot@example.com', type: 'erasure', website: 'x' }), d);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a).toMatchObject({ status: 202, body: ACCEPTED });
  });

  it('adds an intake row with an expiry and queues a message without the address', async () => {
    await postPrivacyRequest(req({ email: ' Person@Example.com ', type: 'withdrawal' }), d);
    const [row] = intake.all() as unknown as Record<string, string>[];
    const expires = NOW.getTime() + 86_400_000;
    expect(row).toMatchObject({ partitionKey: dayOf(expires), email: 'person@example.com', type: 'withdrawal', expiresAt: new Date(expires).toISOString() });
    expect(queue.messages).toEqual([{ v: 1, kind: 'send-confirmation', requestId: row!.rowKey, partition: row!.partitionKey }]);
    expect(JSON.stringify(queue.messages)).not.toContain('person');
    expect(`${row!.partitionKey}${row!.rowKey}`).not.toMatch(/person|example/);
  });

  it('the honeypot writes nothing', async () => {
    await postPrivacyRequest(req({ email: 'bot@example.com', type: 'erasure', website: 'x' }), d);
    expect(intake.adds + queue.messages.length).toBe(0);
  });

  it('validates as the gateway does', async () => {
    const r = await postPrivacyRequest(req({ email: 'nope', type: 'other' }), d);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'invalid', details: { fields: { email: 'Enter a valid email address', type: 'Choose what you would like us to do' } } });
    expect(((await postPrivacyRequest(req({}), d)).body as { details: { fields: { email: string } } }).details.fields.email).toBe('Enter your email address');
  });

  it('answers 503 on a storage failure', async () => {
    queue.fail = 1;
    expect((await postPrivacyRequest(req({ email: 'a@example.com', type: 'erasure' }), d)).status).toBe(503);
  });
});

describe('POST /api/public/privacy/confirm', () => {
  const later = new Date(NOW.getTime() + 3_600_000);
  const token = (type: 'erasure' | 'withdrawal' | 'export' = 'erasure') => issueToken('11111111-2222-4333-8444-555555555555', later, type, HMAC);

  it('a sound token is queued and answered 202 pending with its type, never 200, never data', async () => {
    for (const type of ['erasure', 'withdrawal', 'export'] as const) {
      const t = token(type);
      const r = await postPrivacyConfirm(req({ token: t }), d);
      expect(r).toMatchObject({ status: 202, body: { status: 'pending', type } });
      expect(Object.keys(r.body)).toEqual(['status', 'type']);
      expect(queue.messages.at(-1)).toEqual({ v: 1, kind: 'confirm', token: t });
    }
  });

  it('one 410 body for invalid, expired and used links', async () => {
    const invalid = await postPrivacyConfirm(req({ token: 'nope' }), d);
    const missing = await postPrivacyConfirm(req({}), d);
    const expired = await postPrivacyConfirm(req({ token: issueToken('r', new Date(NOW.getTime() - 1), 'erasure', HMAC) }), d);
    const tampered = await postPrivacyConfirm(req({ token: `${token()}x` }), d);
    const t = token();
    await postPrivacyConfirm(req({ token: t }), d);
    const used = await postPrivacyConfirm(req({ token: t }), d);
    for (const r of [invalid, missing, expired, tampered, used]) {
      expect(r.status).toBe(410);
      expect(r.body).toEqual(invalid.body);
    }
  });

  it('single use without a read: the second claim answers 409 from storage', async () => {
    const t = token();
    await postPrivacyConfirm(req({ token: t }), d);
    await postPrivacyConfirm(req({ token: t }), d);
    expect(intake.reads).toBe(0);
    const claims = intake.all() as unknown as Record<string, string>[];
    expect(claims).toHaveLength(1);
    expect(claims[0]!.rowKey).toBe(`claim-${tokenHash(t)}`);
    expect(JSON.stringify(claims)).not.toContain(t);
  });

  it('a failed message claims nothing, so the same link can be tried again', async () => {
    const t = token();
    queue.fail = 1;
    expect((await postPrivacyConfirm(req({ token: t }), d)).status).toBe(503);
    expect(intake.all()).toHaveLength(0);
    expect((await postPrivacyConfirm(req({ token: t }), d)).status).toBe(202);
  });

  it('a leave link is a withdrawal, goes to the worker, and answers 410 when used again', async () => {
    const key = subjectKey('person@example.com', HMAC);
    const t = issueLeaveToken(key, new Date(NOW.getTime() + 86_400_000 * 700), 'nonce', HMAC);
    expect(await postPrivacyConfirm(req({ token: t }), d)).toMatchObject({ status: 202, body: { status: 'pending', type: 'withdrawal' } });
    expect(queue.messages.at(-1)).toEqual({ v: 1, kind: 'leave', token: t });
    expect((await postPrivacyConfirm(req({ token: t }), d)).status).toBe(410);
  });

  it('a request token signed under the leave key, or the reverse, passes as neither', async () => {
    const key = subjectKey('person@example.com', HMAC);
    const leaveToken = issueLeaveToken(key, later, 'n', HMAC);
    const swapped = `v1.${leaveToken.split('.').slice(1).join('.')}`;
    expect((await postPrivacyConfirm(req({ token: swapped }), d)).status).toBe(410);
    const t = token().split('.');
    const fakeLeave = ['l1', key, t[2], 'n', t[4]].join('.');
    expect((await postPrivacyConfirm(req({ token: fakeLeave }), d)).status).toBe(410);
  });
});

describe('token format', () => {
  it('keeps the gateway format: five parts, and verifies with the type', () => {
    const t = issueToken('abc', new Date(NOW.getTime() + 1000), 'export', HMAC);
    expect(t.split('.')).toHaveLength(5);
    expect(verifyToken(t, NOW.getTime(), HMAC)).toEqual({ requestId: 'abc', expiresAtMs: NOW.getTime() + 1000, type: 'export' });
    expect(verifyToken(t, NOW.getTime(), 'other-key')).toBeNull();
    expect(verifyToken(t, NOW.getTime() + 1000, HMAC)).toBeNull();
  });
});

describe('write cap', () => {
  it('at most the bucket per second, with a 429 and Retry-After beyond it, and no storage call', async () => {
    let t = 0;
    const cap = new WriteCap(5, 5, () => t);
    const capped = { ...d, writeCap: cap };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await postWaitlist(req({ ...entry, email: `p${i}@example.com` }), capped)).status);
    // Two tokens each: the row and the welcome.
    expect(statuses).toEqual([201, 201, 429, 429, 429, 429]);
    expect(waitlist.adds).toBe(2);
    const refused = await postWaitlist(req({ ...entry, email: 'x@example.com' }), capped);
    expect(refused).toMatchObject({ status: 429, body: { code: 'rate_limited', details: { retryAfterSeconds: 1 } } });
    expect(refused.headers?.['retry-after']).toBe('1');
    t = 1000;
    expect((await postWaitlist(req({ ...entry, email: 'y@example.com' }), capped)).status).toBe(201);
  });

  it('the honeypot, invalid input and invalid tokens cost no writes', async () => {
    const capped = { ...d, writeCap: new WriteCap(0.0001, 1) };
    await postWaitlist(req({ ...entry, website: 'x' }), capped);
    await postWaitlist(req({ email: 'nope' }), capped);
    await postPrivacyConfirm(req({ token: 'nope' }), capped);
    expect(capped.writeCap.take(1)).toBe(true);
  });
});

describe('logs', () => {
  it('hold no address, name or token and only the network of the visitor', async () => {
    const t = issueToken('r', new Date(NOW.getTime() + 1000), 'erasure', HMAC);
    await postWaitlist(req(entry), d);
    await postPrivacyRequest(req({ email: 'person@example.com', type: 'erasure' }), d);
    await postPrivacyConfirm(req({ token: t }), d);
    queue.fail = 1;
    await postPrivacyRequest(req({ email: 'person@example.com', type: 'erasure' }), d);
    expect(log.lines.length).toBeGreaterThan(0);
    for (const leak of ['person', 'example.com', 'Org', t, '203.0.113.77']) expect(log.text).not.toContain(leak);
    expect(log.text).toContain('203.0.113.0/24');
    expect(ipPrefix('2001:db8:1:2::1')).toBe('2001:db8:1::/48');
    expect(ipPrefix(null)).toBe('');
  });

  it('samples success and always logs a failure', async () => {
    const quiet = { ...d, logSample: 0.01, random: () => 0.5 };
    await postWaitlist(req(entry), quiet);
    expect(log.lines).toHaveLength(0);
    waitlist.failAdd = 1;
    await postWaitlist(req({ ...entry, email: 'b@example.com' }), quiet);
    expect(log.lines).toHaveLength(1);
  });
});
