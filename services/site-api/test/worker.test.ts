import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryLedger } from '../src/ledger.js';
import type { IntakeRow, StateRow, TableEntity, WaitlistRow } from '../src/model.js';
import { BACKUP_LEGAL_BASIS, handleMessage, parseMessage, sendWaitlistMail, sweepRequests, type RequestDeps } from '../src/worker/requests.js';
import { dayOf, issueLeaveToken, issueToken, subjectKey, tokenHash, tokenHash as th, verifyLeaveToken, waitlistShard } from '../src/subject.js';
import { MemoryLog, MemoryMailer, MemoryTable } from './fakes.js';

const HMAC = 'test-hmac-key';
const EMAIL = 'person@example.com';
const KEY = subjectKey(EMAIL, HMAC);
const NOW = new Date('2026-11-02T12:00:00.000Z');
const ID = '11111111-2222-4333-8444-555555555555';

let t: Date;
let waitlist: MemoryTable<WaitlistRow>;
let intake: MemoryTable<IntakeRow>;
let state: MemoryTable<StateRow>;
let caps: MemoryTable<TableEntity & { count: number }>;
let ledger: MemoryLedger;
let mailer: MemoryMailer;
let log: MemoryLog;
let d: RequestDeps;

beforeEach(() => {
  t = NOW;
  waitlist = new MemoryTable();
  intake = new MemoryTable();
  state = new MemoryTable();
  caps = new MemoryTable();
  ledger = new MemoryLedger(HMAC);
  mailer = new MemoryMailer();
  log = new MemoryLog();
  d = { hmacKey: HMAC, waitlistTable: waitlist, intakeTable: intake, stateTable: state, capTable: caps, ledger, mailer, siteUrl: 'https://cloudtrain.test/', requestTtlMs: 86_400_000, perSubjectPerHour: 3, dailyMailCap: 500, now: () => t, log };
});

async function joined(email = EMAIL, at = NOW) {
  const key = subjectKey(email, HMAC);
  await waitlist.add({ partitionKey: waitlistShard(key), rowKey: key, email, organisation: 'Org', consentAt: at.toISOString(), createdAt: at.toISOString() });
  return key;
}

async function intakeRow(type: IntakeRow['type'], email = EMAIL, id = ID, expires = new Date(t.getTime() + 86_400_000)) {
  const partition = dayOf(expires.getTime());
  await intake.add({ partitionKey: partition, rowKey: id, email, type, requestedAt: t.toISOString(), expiresAt: expires.toISOString() });
  return partition;
}

const confirmToken = (i = 0) => decodeURIComponent(/#token=([^\s"]+)/.exec(mailer.sent[i]!.text)![1]!);

async function requested(type: IntakeRow['type'], email = EMAIL, id = ID) {
  const partition = await intakeRow(type, email, id);
  await handleMessage({ v: 1, kind: 'send-confirmation', requestId: id, partition }, d);
  return partition;
}

describe('confirmation mail', () => {
  it('goes to the row address with a fragment link, and only the hash is stored', async () => {
    const p = await requested('erasure');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(EMAIL);
    expect(mailer.sent[0]!.text).toContain('https://cloudtrain.test/legal/privacy-request#token=');
    const token = confirmToken();
    const row = (await state.get(p, ID))!;
    expect(row).toMatchObject({ state: 'awaiting', subjectKey: KEY, tokenHash: tokenHash(token), type: 'erasure' });
    expect(row.mailSentAt).toBe(NOW.toISOString());
    expect(JSON.stringify(state.all())).not.toContain(token);
    expect(JSON.stringify(state.all())).not.toContain(EMAIL);
  });

  it('a redelivery sends nothing more', async () => {
    const p = await requested('erasure');
    await handleMessage({ v: 1, kind: 'send-confirmation', requestId: ID, partition: p }, d);
    expect(mailer.sent).toHaveLength(1);
  });

  it('a failed send retries through the queue and then works', async () => {
    const p = await intakeRow('erasure');
    mailer.fail = 1;
    await expect(handleMessage({ v: 1, kind: 'send-confirmation', requestId: ID, partition: p }, d)).rejects.toThrow();
    await handleMessage({ v: 1, kind: 'send-confirmation', requestId: ID, partition: p }, d);
    expect(mailer.sent).toHaveLength(1);
    expect((await state.get(p, ID))!.tokenHash).toBe(tokenHash(confirmToken()));
  });

  it('per address: at most 3 an hour, whatever the requests, then again later', async () => {
    for (let i = 0; i < 6; i++) await requested('erasure', EMAIL, `${ID.slice(0, -1)}${i}`);
    expect(mailer.sent).toHaveLength(3);
    t = new Date(NOW.getTime() + 3_600_001);
    await requested('erasure', EMAIL, `${ID.slice(0, -1)}9`);
    expect(mailer.sent).toHaveLength(4);
  });

  it('the daily cap stops all mail, in a table the public identity cannot write', async () => {
    d.dailyMailCap = 2;
    for (let i = 0; i < 5; i++) await requested('export', `p${i}@example.com`, `${ID.slice(0, -1)}${i}`);
    expect(mailer.sent).toHaveLength(2);
    expect(log.text).toContain('daily_cap');
    t = new Date(NOW.getTime() + 86_400_000);
    await requested('export', 'next@example.com', `${ID.slice(0, -1)}8`);
    expect(mailer.sent).toHaveLength(3);
  });

  it('refuses intake rows that could not have come from the form', async () => {
    const far = new Date(t.getTime() + 90 * 86_400_000);
    for (const [id, row] of Object.entries({
      a: { partitionKey: dayOf(far.getTime()), email: EMAIL, type: 'erasure', requestedAt: t.toISOString(), expiresAt: far.toISOString() },
      b: { partitionKey: 'wrong', email: EMAIL, type: 'erasure', requestedAt: t.toISOString(), expiresAt: new Date(t.getTime() + 1000).toISOString() },
      c: { partitionKey: dayOf(t.getTime()), email: 'not an address', type: 'erasure', requestedAt: t.toISOString(), expiresAt: new Date(t.getTime() + 1000).toISOString() },
      e: { partitionKey: dayOf(t.getTime() + 1000), email: EMAIL, type: 'delete-everything', requestedAt: t.toISOString(), expiresAt: new Date(t.getTime() + 1000).toISOString() },
    })) {
      await intake.add({ rowKey: id, ...row });
      await handleMessage({ v: 1, kind: 'send-confirmation', requestId: id, partition: row.partitionKey }, d);
    }
    expect(mailer.sent).toHaveLength(0);
    expect(intake.all()).toHaveLength(0);
  });
});

describe('confirm', () => {
  it('erasure: removes the row, writes the ledger, mails, and leaves no address', async () => {
    await joined();
    const p = await requested('erasure');
    const token = confirmToken();
    t = new Date(NOW.getTime() + 60_000);
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
    const [rec] = ledger.rows;
    expect(rec).toMatchObject({ requestId: ID, type: 'erasure', scope: 'waitlist', subjectKey: KEY, actor: 'self', dataCategories: ['waitlist', 'backups'], requestedAt: NOW.toISOString(), verifiedAt: t.toISOString(), completedAt: t.toISOString() });
    expect(rec!.outcomes).toEqual([
      { system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 },
      { system: 'backups', category: 'backups', action: 'expires', rows: 0, legalBasis: BACKUP_LEGAL_BASIS },
    ]);
    expect(mailer.sent.at(-1)).toMatchObject({ to: EMAIL });
    expect(mailer.sent.at(-1)!.text).toContain('erased');
    expect(await intake.get(p, ID)).toBeNull();
    const row = (await state.get(p, ID))!;
    expect(row.state).toBe('done');
    expect(row.tokenHash).toBe('');
  });

  it('withdrawal behaves the same, under its own type and mail', async () => {
    await joined();
    await requested('withdrawal');
    await handleMessage({ v: 1, kind: 'confirm', token: confirmToken() }, d);
    expect(ledger.rows[0]!.type).toBe('withdrawal');
    expect(mailer.sent.at(-1)!.subject).toContain('left');
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
  });

  it('an unknown address reads the same to the requester and is recorded as nothing removed', async () => {
    await requested('erasure');
    await handleMessage({ v: 1, kind: 'confirm', token: confirmToken() }, d);
    expect(ledger.rows[0]!.outcomes[0]).toMatchObject({ action: 'none', rows: 0 });
    expect(ledger.rows[0]!.dataCategories).toEqual(['backups']);
    expect(mailer.sent.at(-1)!.text).toContain('nothing to remove');
  });

  it('export: the copy goes to the verified address, and the row stays', async () => {
    await joined();
    await requested('export');
    await handleMessage({ v: 1, kind: 'confirm', token: confirmToken() }, d);
    const m = mailer.sent.at(-1)!;
    expect(m.to).toBe(EMAIL);
    expect(m.text).toContain(EMAIL);
    expect(m.text).toContain('Org');
    expect(m.text).not.toContain('leaveNonce');
    expect(await waitlist.get(waitlistShard(KEY), KEY)).not.toBeNull();
    expect(ledger.rows[0]).toMatchObject({ type: 'export', dataCategories: ['waitlist'] });
    expect(ledger.rows[0]!.outcomes).toEqual([{ system: 'waitlist', category: 'waitlist', action: 'exported', rows: 1 }]);
  });

  it('export: no evidence, no data; the retry finishes', async () => {
    await joined();
    await requested('export');
    const token = confirmToken();
    const before = mailer.sent.length;
    ledger.failNext = 1;
    await expect(handleMessage({ v: 1, kind: 'confirm', token }, d)).rejects.toThrow();
    expect(mailer.sent).toHaveLength(before);
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    expect(mailer.sent).toHaveLength(before + 1);
    expect(ledger.rows).toHaveLength(1);
  });

  it('is single use: a second confirm does nothing', async () => {
    await joined();
    await requested('erasure');
    const token = confirmToken();
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    const mails = mailer.sent.length;
    await joined(); // the person joins again
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    expect(mailer.sent).toHaveLength(mails);
    expect(ledger.rows).toHaveLength(1);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).not.toBeNull();
  });

  it('expired: does nothing', async () => {
    await joined();
    await requested('erasure');
    const token = confirmToken();
    t = new Date(NOW.getTime() + 86_400_001);
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    expect(ledger.rows).toHaveLength(0);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).not.toBeNull();
  });

  it('a validly signed token that was not mailed does nothing: holding the HMAC key is not enough', async () => {
    await joined();
    const p = await requested('erasure');
    const forged = issueToken(ID, new Date((await state.get(p, ID))!.expiresAt), 'erasure', HMAC);
    await handleMessage({ v: 1, kind: 'confirm', token: forged }, d);
    expect(ledger.rows).toHaveLength(0);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).not.toBeNull();
  });

  it('a retry after a crash does not report 0 rows removed', async () => {
    await joined();
    await requested('erasure');
    const token = confirmToken();
    ledger.failNext = 1; // the row goes, the record fails
    await expect(handleMessage({ v: 1, kind: 'confirm', token }, d)).rejects.toThrow();
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    expect(ledger.rows[0]!.outcomes[0]).toMatchObject({ action: 'deleted', rows: 1 });
  });

  it('a retry after the mail failed keeps one record and sends it', async () => {
    await joined();
    await requested('erasure');
    const token = confirmToken();
    const mails = mailer.sent.length;
    mailer.fail = 1;
    await expect(handleMessage({ v: 1, kind: 'confirm', token }, d)).rejects.toThrow();
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    expect(ledger.rows).toHaveLength(1);
    expect(mailer.sent).toHaveLength(mails + 1);
  });

  it('the sweep finishes a verified request whose queue message is gone', async () => {
    await joined();
    await requested('erasure');
    const token = confirmToken();
    ledger.failNext = 1;
    await expect(handleMessage({ v: 1, kind: 'confirm', token }, d)).rejects.toThrow();
    t = new Date(NOW.getTime() + 11 * 60_000);
    const r = await sweepRequests(d);
    expect(r.resumed).toBe(1);
    expect(ledger.rows).toHaveLength(1);
  });

  it('a verified request is not dropped at expiry while the ledger is down', async () => {
    await joined();
    const p = await requested('erasure');
    ledger.failNext = 1;
    await expect(handleMessage({ v: 1, kind: 'confirm', token: confirmToken() }, d)).rejects.toThrow();
    t = new Date(NOW.getTime() + 2 * 86_400_000);
    ledger.failNext = 1;
    expect((await sweepRequests(d)).stuck).toBe(1);
    expect(await intake.get(p, ID)).not.toBeNull();
    expect((await state.get(p, ID))!.state).toBe('processing');
  });
});

describe('the ledger record', () => {
  it('holds no address, organisation or token, serialised', async () => {
    await joined();
    await requested('erasure');
    const token = confirmToken();
    await handleMessage({ v: 1, kind: 'confirm', token }, d);
    const text = JSON.stringify(ledger.rows);
    for (const leak of [EMAIL, '@', 'Org', token, 'example']) expect(text).not.toContain(leak);
    expect(text).toContain(KEY);
  });

  it('the chain verifies across all three kinds of request', async () => {
    await joined();
    await requested('export', EMAIL, `${ID.slice(0, -1)}1`);
    await handleMessage({ v: 1, kind: 'confirm', token: confirmToken(0) }, d);
    await requested('erasure', EMAIL, `${ID.slice(0, -1)}2`);
    await handleMessage({ v: 1, kind: 'confirm', token: confirmToken(2) }, d);
    expect(await ledger.verifyChain()).toMatchObject({ ok: true, count: 2 });
  });
});

describe('welcome', () => {
  it('is sent once for a new row, with a leave link, and marks the row', async () => {
    const key = await joined();
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(EMAIL);
    expect(mailer.sent[0]!.text).toContain('https://cloudtrain.test/legal/privacy-request#token=l1.');
    expect(mailer.sent[0]!.text).toMatch(/wasn.t you/);
    const row = (await waitlist.get(waitlistShard(key), key))!;
    expect(row.welcomeSentAt).toBe(NOW.toISOString());
    expect(row.leaveNonce).toBeTruthy();
  });

  it('checks at send time that the row still exists: an erased entry gets no mail', async () => {
    const key = await joined();
    await waitlist.remove(waitlistShard(key), key);
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    expect(mailer.sent).toHaveLength(0);
  });

  it('a failed send throws for the queue to retry, and the signup stays', async () => {
    const key = await joined();
    mailer.fail = 1;
    await expect(handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d)).rejects.toThrow();
    expect(await waitlist.get(waitlistShard(key), key)).not.toBeNull();
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    expect(mailer.sent).toHaveLength(1);
  });

  it('is bound by the daily cap, and the signup stays', async () => {
    d.dailyMailCap = 1;
    const a = await joined('a@example.com');
    const b = await joined('b@example.com');
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: a }, d);
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: b }, d);
    expect(mailer.sent).toHaveLength(1);
    expect(await waitlist.get(waitlistShard(b), b)).not.toBeNull();
  });

  it('a nonce the public app could have planted is replaced before the first mail', async () => {
    const key = subjectKey(EMAIL, HMAC);
    await waitlist.add({ partitionKey: waitlistShard(key), rowKey: key, email: EMAIL, consentAt: NOW.toISOString(), createdAt: NOW.toISOString(), leaveNonce: 'planted' });
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    expect((await waitlist.get(waitlistShard(key), key))!.leaveNonce).not.toBe('planted');
    const planted = issueLeaveToken(key, new Date(NOW.getTime() + 86_400_000), 'planted', HMAC);
    await handleMessage({ v: 1, kind: 'leave', token: planted }, d);
    expect(ledger.rows).toHaveLength(0);
  });
});

describe('every waitlist mail', () => {
  it('a later notification carries the same working leave link and needs the row', async () => {
    const key = await joined();
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    const render = ({ leaveUrl }: { leaveUrl: string }) => ({ subject: 'Your place', text: `The opening date moved. Leave: ${leaveUrl}\n` });
    expect(await sendWaitlistMail(key, render, d)).toBe(true);
    expect(mailer.sent).toHaveLength(2);
    const links = mailer.sent.map((m) => /#token=(\S+)/.exec(m.text)![1]);
    expect(links[0]).toBe(links[1]);
    await waitlist.remove(waitlistShard(key), key);
    expect(await sendWaitlistMail(key, render, d)).toBe(false);
    expect(mailer.sent).toHaveLength(2);
  });
});

describe('the leave link', () => {
  const welcomeToken = async (email = EMAIL) => {
    const key = await joined(email);
    const before = mailer.sent.length;
    await handleMessage({ v: 1, kind: 'welcome', subjectKey: key }, d);
    return decodeURIComponent(/#token=(\S+)/.exec(mailer.sent[before]!.text)![1]!);
  };

  it('verifies, names its subject, and lasts as long as the row can', async () => {
    const token = await welcomeToken();
    const v = verifyLeaveToken(token, NOW.getTime(), HMAC)!;
    expect(v.subjectKey).toBe(KEY);
    expect(verifyLeaveToken(token, new Date('2028-11-01T00:00:00Z').getTime(), HMAC)).not.toBeNull();
    expect(verifyLeaveToken(token, new Date('2029-01-01T00:00:00Z').getTime(), HMAC)).toBeNull();
    expect(token).not.toContain(EMAIL);
  });

  it('withdraws, writes the ledger, sends one notice with no way back in', async () => {
    const token = await welcomeToken();
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
    expect(ledger.rows[0]).toMatchObject({ type: 'withdrawal', scope: 'waitlist', subjectKey: KEY, actor: 'self' });
    expect(JSON.stringify(ledger.rows)).not.toContain('@');
    const notice = mailer.sent.at(-1)!;
    expect(notice.to).toBe(EMAIL);
    expect(notice.text).not.toContain('privacy-request');
    expect(notice.text).not.toContain('#token');
  });

  it('works only on its own subject: another subject, or a tampered key, does nothing', async () => {
    const token = await welcomeToken();
    const other = await joined('other@example.com');
    const parts = token.split('.');
    parts[1] = other;
    await handleMessage({ v: 1, kind: 'leave', token: parts.join('.') }, d);
    expect(ledger.rows).toHaveLength(0);
    expect(await waitlist.get(waitlistShard(other), other)).not.toBeNull();
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    expect(await waitlist.get(waitlistShard(other), other)).not.toBeNull();
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
  });

  it('is bound to its purpose: it does not pass as a confirm, nor a confirm token as a leave', async () => {
    const leaveToken = await welcomeToken();
    await handleMessage({ v: 1, kind: 'confirm', token: leaveToken }, d);
    expect(ledger.rows).toHaveLength(0);
    const p = await requested('erasure', EMAIL, ID);
    const request = confirmToken(1);
    await handleMessage({ v: 1, kind: 'leave', token: request }, d);
    expect(ledger.rows).toHaveLength(0);
    expect((await state.get(p, ID))!.state).toBe('awaiting');
  });

  it('a signature alone does not act on a row: holding the HMAC key is not enough', async () => {
    await welcomeToken();
    const forged = issueLeaveToken(KEY, new Date(NOW.getTime() + 86_400_000), 'guessed-nonce', HMAC);
    await handleMessage({ v: 1, kind: 'leave', token: forged }, d);
    expect(ledger.rows).toHaveLength(0);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).not.toBeNull();
  });

  it('a second use changes nothing, and an old link does not touch a later signup', async () => {
    const token = await welcomeToken();
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    const mails = mailer.sent.length;
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    expect(ledger.rows).toHaveLength(1);
    expect(mailer.sent).toHaveLength(mails);
    await welcomeToken(); // joins again, gets a new nonce
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    expect(ledger.rows).toHaveLength(1);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).not.toBeNull();
  });

  it('a redelivery after the record was written and the delete failed still removes the row, with one record', async () => {
    const token = await welcomeToken();
    const remove = waitlist.remove.bind(waitlist);
    waitlist.remove = async () => {
      throw Object.assign(new Error('down'), { statusCode: 500 });
    };
    await expect(handleMessage({ v: 1, kind: 'leave', token }, d)).rejects.toThrow();
    waitlist.remove = remove;
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
    expect(ledger.rows).toHaveLength(1);
  });

  it('a failed notice does not undo or block leaving', async () => {
    const token = await welcomeToken();
    mailer.fail = 1;
    await handleMessage({ v: 1, kind: 'leave', token }, d);
    expect(await waitlist.get(waitlistShard(KEY), KEY)).toBeNull();
    expect(ledger.rows).toHaveLength(1);
  });
});

describe('expired privacy requests, one day either side', () => {
  it('expired yesterday goes, expires tomorrow stays', async () => {
    const yesterday = new Date(t.getTime() - 86_400_000);
    const tomorrow = new Date(t.getTime() + 86_400_000);
    await intake.add({ partitionKey: dayOf(yesterday.getTime()), rowKey: 'old', email: EMAIL, type: 'erasure', requestedAt: t.toISOString(), expiresAt: yesterday.toISOString() });
    await intake.add({ partitionKey: dayOf(tomorrow.getTime()), rowKey: 'new', email: EMAIL, type: 'erasure', requestedAt: t.toISOString(), expiresAt: tomorrow.toISOString() });
    await intake.add({ partitionKey: dayOf(yesterday.getTime()), rowKey: `claim-${th('a')}`, expiresAt: yesterday.toISOString() });
    await state.add({ partitionKey: dayOf(yesterday.getTime()), rowKey: 'old', state: 'awaiting', expiresAt: yesterday.toISOString() });
    await state.add({ partitionKey: dayOf(tomorrow.getTime()), rowKey: 'new', state: 'awaiting', expiresAt: tomorrow.toISOString() });
    const r = await sweepRequests(d);
    expect(r).toMatchObject({ expiredIntake: 2, expiredState: 1 });
    expect(intake.all().map((x) => x.rowKey)).toEqual(['new']);
    expect(state.all().map((x) => x.rowKey)).toEqual(['new']);
  });

  it('old mail counters go after a week', async () => {
    await caps.add({ partitionKey: 'mail-cap', rowKey: '2026-10-01', count: 3 });
    await caps.add({ partitionKey: 'mail-cap', rowKey: dayOf(t.getTime()), count: 3 });
    await sweepRequests(d);
    expect(caps.all().map((c) => c.rowKey)).toEqual([dayOf(t.getTime())]);
  });
});

describe('parseMessage', () => {
  it('accepts objects and strings and refuses anything else, without throwing', async () => {
    expect(parseMessage('{"v":1,"kind":"confirm","token":"x"}')).toEqual({ v: 1, kind: 'confirm', token: 'x' });
    for (const bad of ['nope', 1, null, { v: 2, kind: 'confirm', token: 'x' }, { v: 1, kind: 'other' }, { v: 1, kind: 'confirm' }]) expect(parseMessage(bad)).toBeNull();
    await expect(handleMessage('nope', d)).resolves.toBeUndefined();
    expect(log.text).not.toContain('nope');
  });
});

describe('the provider failure in the logs', () => {
  it('names the code, status and request, not the recipient', async () => {
    const { providerFailure } = await import('../src/azure/acs.js');
    const line = providerFailure({ code: 'DeniedByResourceProvider', statusCode: 403, message: 'cannot send to someone@example.com', request: { requestId: 'r-1' } });
    expect(line).toBe('mail: provider refused (code DeniedByResourceProvider, status 403, request r-1)');
    expect(line).not.toContain('@');
  });
});
