import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryLedger, type LedgerRecordInput } from '../src/ledger.js';
import type { WaitlistRow } from '../src/model.js';
import { backupName, backupWaitlist, monthsAfter, monthsBefore, pruneLedger, purgeWaitlist, reapplyErasures, restoreWaitlist, runRetention } from '../src/worker/retention.js';
import { subjectKey, waitlistShard } from '../src/subject.js';
import { MemoryBlobs, MemoryLog, MemoryTable } from './fakes.js';

const HMAC = 'test-hmac-key';
const NOW = new Date('2026-11-02T12:00:00.000Z');
const DAY = 86_400_000;

let waitlist: MemoryTable<WaitlistRow>;
let ledger: MemoryLedger;

beforeEach(() => {
  waitlist = new MemoryTable();
  ledger = new MemoryLedger(HMAC);
});

async function row(email: string, createdAt: Date, extra: object = {}) {
  const key = subjectKey(email, HMAC);
  await waitlist.add({ partitionKey: waitlistShard(key), rowKey: key, email, consentAt: createdAt.toISOString(), createdAt: createdAt.toISOString(), ...extra });
  return key;
}

const record = (key: string, requestId: string, completedAt: Date, type: LedgerRecordInput['type'] = 'erasure'): LedgerRecordInput => ({
  requestId,
  type,
  scope: 'waitlist',
  subjectKey: key,
  dataCategories: ['waitlist'],
  outcomes: [{ system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 }],
  requestedAt: completedAt.toISOString(),
  verifiedAt: completedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  actor: 'self',
});

describe('months', () => {
  it('keeps the day of the month, or the last day of a shorter month', () => {
    expect(monthsBefore(new Date('2026-11-02T00:00:00Z'), 24).toISOString()).toBe('2024-11-02T00:00:00.000Z');
    expect(monthsBefore(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(monthsAfter(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(monthsAfter(new Date('2026-11-02T00:00:00Z'), 25).toISOString()).toBe('2028-12-02T00:00:00.000Z');
  });
});

describe('waitlist retention: 24 months', () => {
  it('goes one day past, stays one day before, stays on the day', async () => {
    const cutoff = monthsBefore(NOW, 24);
    const past = await row('past@example.com', new Date(cutoff.getTime() - DAY));
    const before = await row('before@example.com', new Date(cutoff.getTime() + DAY));
    const exact = await row('exact@example.com', cutoff);
    expect(await purgeWaitlist(waitlist, NOW)).toBe(1);
    expect(await waitlist.get(waitlistShard(past), past)).toBeNull();
    expect(await waitlist.get(waitlistShard(before), before)).not.toBeNull();
    expect(await waitlist.get(waitlistShard(exact), exact)).not.toBeNull();
  });

  it('a second run finds nothing', async () => {
    await row('past@example.com', new Date('2020-01-01T00:00:00Z'));
    await purgeWaitlist(waitlist, NOW);
    expect(await purgeWaitlist(waitlist, NOW)).toBe(0);
  });
});

describe('ledger retention: 3 years', () => {
  const key = 'a'.repeat(64);
  it('prunes one day past, keeps one day before, and the rest still verifies under a checkpoint', async () => {
    const cutoff = monthsBefore(NOW, 36);
    await ledger.append(record(key, 'r1', new Date(cutoff.getTime() - 2 * DAY)));
    await ledger.append(record(key, 'r2', new Date(cutoff.getTime() - DAY)));
    await ledger.append(record(key, 'r3', new Date(cutoff.getTime() + DAY)));
    const head = (await ledger.verifyChain()).head;
    expect(await pruneLedger(ledger, NOW)).toBe(2);
    expect(ledger.rows.map((r) => r.requestId)).toEqual(['r3']);
    const report = await ledger.verifyChain({ expect: head });
    expect(report).toMatchObject({ ok: true, count: 1, checkpoint: { throughSeq: 2, prunedTotal: 2 } });
    const next = await ledger.append(record(key, 'r4', NOW));
    expect(next.seq).toBe(4);
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('more than one batch: runs until nothing is left', async () => {
    for (let i = 0; i < 100; i++) await ledger.append(record(key, `r${i}`, new Date('2020-01-01T00:00:00Z')));
    expect(await pruneLedger(ledger, NOW)).toBe(100);
    expect((await ledger.verifyChain()).ok).toBe(true);
  });
});

describe('runRetention', () => {
  it('runs every part, logs counts only, and fails the run when a part failed', async () => {
    await row('past@example.com', new Date('2020-01-01T00:00:00Z'));
    const log = new MemoryLog();
    const deps = { waitlistTable: waitlist, ledger, now: () => NOW, log };
    expect(await runRetention(deps)).toMatchObject({ waitlist: 1, ledger: 0, chainOk: true });
    expect(log.text).not.toContain('past@');
    ledger.prune = async () => {
      throw new Error('down');
    };
    await row('past2@example.com', new Date('2020-01-01T00:00:00Z'));
    await expect(runRetention(deps)).rejects.toThrow(/ledger/);
    expect(waitlist.all()).toHaveLength(0);
  });
});

describe('the ledger head in the immutable container', () => {
  const deps = () => ({ waitlistTable: waitlist, ledger, now: () => NOW, log: new MemoryLog() });

  it('is written daily, with no identifier, and a second run the same day changes nothing', async () => {
    const key = subjectKey('person@example.com', HMAC);
    const e = await ledger.append(record(key, 'r1', NOW));
    const blobs = new MemoryBlobs();
    await runRetention({ ...deps(), ledgerCopy: blobs });
    const text = blobs.files.get('head/2026-11-02.json')!;
    expect(JSON.parse(text)).toEqual({ checkedAt: NOW.toISOString(), count: 1, hash: e.hash, ok: true, seq: 1 });
    expect(text).not.toContain('@');
    expect(text).not.toContain(key);
    await ledger.append(record(key, 'r2', NOW));
    await runRetention({ ...deps(), ledgerCopy: blobs });
    expect(blobs.files.get('head/2026-11-02.json')).toBe(text);
  });

  it('a noted head proves a later truncation', async () => {
    const key = subjectKey('person@example.com', HMAC);
    await ledger.append(record(key, 'r1', NOW));
    await ledger.append(record(key, 'r2', NOW));
    const blobs = new MemoryBlobs();
    await runRetention({ ...deps(), ledgerCopy: blobs });
    const { seq, hash } = JSON.parse(blobs.files.get('head/2026-11-02.json')!);
    ledger.rows.pop();
    expect((await ledger.verifyChain({ expect: { seq, hash } })).problems.map((p) => p.kind)).toContain('head_mismatch');
  });

  it('a failed write fails the run, so the platform shows it', async () => {
    const blobs = new MemoryBlobs();
    blobs.putNew = async () => {
      throw new Error('down');
    };
    await expect(runRetention({ ...deps(), ledgerCopy: blobs })).rejects.toThrow(/head/);
  });
});

describe('backup and restore', () => {
  it('writes one dated blob, without table metadata, and restores it', async () => {
    await row('a@example.com', NOW, { organisation: 'Org', leaveNonce: 'n', consentLabelHash: 'h' });
    await row('b@example.com', NOW);
    const blobs = new MemoryBlobs();
    const r = await backupWaitlist(waitlist, blobs, NOW);
    expect(r).toEqual({ name: 'waitlist/2026-11-02.ndjson', rows: 2, written: true });
    expect(backupName(NOW)).toBe(r.name);
    const text = blobs.files.get(r.name)!;
    expect(text).not.toContain('etag');
    expect(text.trim().split('\n')).toHaveLength(2);

    const a = subjectKey('a@example.com', HMAC);
    await waitlist.remove(waitlistShard(a), a);
    expect(await restoreWaitlist(waitlist, blobs, r.name)).toEqual({ added: 1, present: 1 });
    expect(await waitlist.get(waitlistShard(a), a)).toMatchObject({ email: 'a@example.com', organisation: 'Org', leaveNonce: 'n', consentLabelHash: 'h' });
  });

  it('a second run on one date, refused by the immutable container, is a success and leaves the first copy', async () => {
    await row('a@example.com', NOW);
    const blobs = new MemoryBlobs();
    const first = await backupWaitlist(waitlist, blobs, NOW);
    const text = blobs.files.get(first.name);
    await row('b@example.com', NOW);
    const second = await backupWaitlist(waitlist, blobs, NOW);
    expect(first.written).toBe(true);
    expect(second).toMatchObject({ name: first.name, written: false });
    expect(blobs.files.get(first.name)).toBe(text);
    // The next night gets its own.
    expect((await backupWaitlist(waitlist, blobs, new Date(NOW.getTime() + DAY))).written).toBe(true);
  });

  it('a real failure of the container still fails the backup', async () => {
    const blobs = new MemoryBlobs();
    blobs.putNew = async () => {
      throw Object.assign(new Error('down'), { statusCode: 500 });
    };
    await expect(backupWaitlist(waitlist, blobs, NOW)).rejects.toThrow('down');
  });

  it('an empty table writes an empty backup', async () => {
    const blobs = new MemoryBlobs();
    expect((await backupWaitlist(waitlist, blobs, NOW)).rows).toBe(0);
    expect(blobs.files.get('waitlist/2026-11-02.ndjson')).toBe('');
  });
});

describe('reapply after a restore', () => {
  const deps = () => ({ waitlistTable: waitlist, ledger, now: () => NOW });

  it('erases again what the ledger says was erased, from the subject key alone, with a new record', async () => {
    const erasedAt = new Date(NOW.getTime() - 5 * DAY);
    const key = await row('gone@example.com', new Date(erasedAt.getTime() - 100 * DAY));
    await ledger.append(record(key, 'r1', erasedAt));
    const r = await reapplyErasures(deps());
    expect(r).toEqual({ subjects: 1, erased: 1, keptNewer: 0, records: 1 });
    expect(await waitlist.get(waitlistShard(key), key)).toBeNull();
    expect(ledger.rows[1]).toMatchObject({ type: 'erasure', actor: 'admin', reason: 'post-restore-reapply', subjectKey: key });
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('counts withdrawals too, ignores exports', async () => {
    const at = new Date(NOW.getTime() - DAY);
    const w = await row('w@example.com', new Date(at.getTime() - DAY));
    const e = await row('e@example.com', new Date(at.getTime() - DAY));
    await ledger.append(record(w, 'r1', at, 'withdrawal'));
    await ledger.append(record(e, 'r2', at, 'export'));
    await reapplyErasures(deps());
    expect(await waitlist.get(waitlistShard(w), w)).toBeNull();
    expect(await waitlist.get(waitlistShard(e), e)).not.toBeNull();
  });

  it('a person who came back after the erasure stays', async () => {
    const erasedAt = new Date(NOW.getTime() - 5 * DAY);
    const key = await row('back@example.com', new Date(erasedAt.getTime() + DAY));
    await ledger.append(record(key, 'r1', erasedAt));
    expect(await reapplyErasures(deps())).toMatchObject({ erased: 0, keptNewer: 1 });
    expect(await waitlist.get(waitlistShard(key), key)).not.toBeNull();
  });

  it('a dry run changes nothing', async () => {
    const at = new Date(NOW.getTime() - DAY);
    const key = await row('gone@example.com', new Date(at.getTime() - DAY));
    await ledger.append(record(key, 'r1', at));
    expect(await reapplyErasures(deps(), { dryRun: true })).toMatchObject({ erased: 1, records: 0 });
    expect(await waitlist.get(waitlistShard(key), key)).not.toBeNull();
    expect(ledger.rows).toHaveLength(1);
  });
});
