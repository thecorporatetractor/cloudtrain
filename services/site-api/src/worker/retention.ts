import { randomUUID } from 'node:crypto';
import { AZURE_PRUNE_BATCH, canonicalJson, type ErasureLedger } from '../ledger.js';
import type { BlobStore, Log, Table, WaitlistRow } from '../model.js';
import { waitlistShard } from '../subject.js';

/*
 * The privacy notice's periods, as timers. A log line holds counts only. One part failing does
 * not stop the others; the run then fails, so the platform shows it.
 */

export const WAITLIST_MONTHS = 24;
export const LEDGER_MONTHS = 36;

/** The same day of the month, `months` earlier in UTC (the last day when that month is shorter). */
export function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The same day of the month, `months` later in UTC (the last day when that month is shorter). */
export function monthsAfter(from: Date, months: number): Date {
  return monthsBefore(from, -months);
}

/** Entries older than the period, by scan: the row key says nothing about age, on purpose. */
export async function purgeWaitlist(table: Table<WaitlistRow>, now: Date): Promise<number> {
  const at = monthsBefore(now, WAITLIST_MONTHS).toISOString();
  const old: WaitlistRow[] = [];
  for await (const r of table.list({ before: { prop: 'createdAt', at } })) old.push(r);
  let n = 0;
  for (const r of old) if (await table.remove(r.partitionKey, r.rowKey)) n++;
  return n;
}

/** Oldest records first, leaving a signed checkpoint: what stays still verifies. */
export async function pruneLedger(ledger: ErasureLedger, now: Date): Promise<number> {
  const cutoff = monthsBefore(now, LEDGER_MONTHS);
  let total = 0;
  for (;;) {
    const n = await ledger.prune(cutoff, AZURE_PRUNE_BATCH);
    total += n;
    if (n === 0) return total;
  }
}

export interface RetentionDeps {
  waitlistTable: Table<WaitlistRow>;
  ledger: ErasureLedger;
  /** The immutable container: the long-term evidence of where the chain stood. Logs are kept only 90 days. */
  ledgerCopy?: Pick<BlobStore, 'putNew'>;
  now: () => Date;
  log: Log;
}

export async function runRetention(d: RetentionDeps): Promise<{ waitlist: number | null; ledger: number | null; chainOk: boolean | null }> {
  const now = d.now();
  const failed: string[] = [];
  const part = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      failed.push(name);
      return null;
    }
  };
  const waitlist = await part('waitlist', () => purgeWaitlist(d.waitlistTable, now));
  const ledger = await part('ledger', () => pruneLedger(d.ledger, now));
  const report = await part('verify', () => d.ledger.verifyChain());
  if (report && d.ledgerCopy) {
    const copy = d.ledgerCopy;
    const head = canonicalJson({ checkedAt: now.toISOString(), count: report.count, hash: report.head.hash, ok: report.ok, seq: report.head.seq });
    // One a day: a second run the same day leaves the first, which is what immutable means.
    await part('head', () => copy.putNew(`head/${now.toISOString().slice(0, 10)}.json`, head));
  }
  // The head in the log is the anchor for verifying the chain later against a truncated table.
  if (report) d.log.info({ ok: report.ok, count: report.count, seq: report.head.seq, hash: report.head.hash, problems: report.problems.length }, 'gdpr ledger verified');
  d.log.info({ waitlist, ledger, failed }, 'retention');
  if (report && !report.ok) d.log.warn({ problems: report.problems.slice(0, 20) }, 'gdpr ledger: the chain does not verify');
  if (failed.length) throw new Error(`retention: failed parts: ${failed.join(', ')}`);
  return { waitlist, ledger, chainOk: report?.ok ?? null };
}

/* --------------------------------------------------------------- backup */

const LINE_FIELDS = ['partitionKey', 'rowKey', 'email', 'organisation', 'role', 'interest', 'consentAt', 'consentLabelHash', 'privacyNoticeUpdated', 'formSource', 'createdAt', 'leaveNonce', 'welcomeSentAt'] as const;

export const backupName = (now: Date): string => `waitlist/${now.toISOString().slice(0, 10)}.ndjson`;

/**
 * One blob per night, as JSON lines. The container's lifecycle rule (infrastructure) deletes them
 * after 14 days, which is what the privacy notice promises. They hold the addresses in clear in an
 * encrypted container that only the worker can reach.
 */
export async function backupWaitlist(table: Table<WaitlistRow>, blobs: BlobStore, now: Date): Promise<{ name: string; rows: number; written: boolean }> {
  const lines: string[] = [];
  for await (const r of table.list()) {
    const line: Record<string, unknown> = {};
    for (const k of LINE_FIELDS) if (r[k] !== undefined) line[k] = r[k];
    lines.push(JSON.stringify(line));
  }
  const name = backupName(now);
  // New names only: the container is immutable for 13 days, so a second run on one date gets a 409,
  // and tonight's first copy stands. That is a success, and the run says which it was.
  const written = await blobs.putNew(name, lines.length ? `${lines.join('\n')}\n` : '');
  return { name, rows: lines.length, written };
}

/** Adds a backup's rows back. Rows that exist stay as they are. Always follow it with reapplyErasures. */
export async function restoreWaitlist(table: Table<WaitlistRow>, blobs: BlobStore, name: string): Promise<{ added: number; present: number }> {
  let added = 0;
  let present = 0;
  for (const line of (await blobs.get(name)).split('\n')) {
    if (!line.trim()) continue;
    if (await table.add(JSON.parse(line) as WaitlistRow & Record<string, unknown>)) added++;
    else present++;
  }
  return { added, present };
}

/* -------------------------------------------------------------- reapply */

export interface ReapplyResult {
  subjects: number;
  erased: number;
  keptNewer: number;
  records: number;
}

/**
 * After a restore: every subject the ledger says was erased is looked up by its key, which is the
 * row's key. A row from before the erasure is erased again, with a new record. A row created after
 * it is left alone: that person came back of their own accord. The ledger itself is not in the
 * backup, so a restore does not roll it back.
 */
export async function reapplyErasures(d: { waitlistTable: Table<WaitlistRow>; ledger: ErasureLedger; now: () => Date }, opts: { dryRun?: boolean } = {}): Promise<ReapplyResult> {
  const newest = new Map<string, number>();
  for (const e of await d.ledger.entries()) {
    if (e.type !== 'erasure' && e.type !== 'withdrawal') continue;
    const at = Date.parse(e.completedAt);
    if (at > (newest.get(e.subjectKey) ?? 0)) newest.set(e.subjectKey, at);
  }
  const result: ReapplyResult = { subjects: newest.size, erased: 0, keptNewer: 0, records: 0 };
  for (const [key, completedAt] of newest) {
    const row = await d.waitlistTable.get(waitlistShard(key), key);
    if (!row) continue;
    if (Date.parse(row.createdAt) >= completedAt) {
      result.keptNewer++;
      continue;
    }
    result.erased++;
    if (opts.dryRun) continue;
    const removed = await d.waitlistTable.remove(row.partitionKey, row.rowKey);
    const at = d.now().toISOString();
    await d.ledger.append({
      requestId: randomUUID(),
      type: 'erasure',
      scope: 'waitlist',
      subjectKey: key,
      dataCategories: ['waitlist'],
      outcomes: [{ system: 'waitlist', category: 'waitlist', action: removed ? 'deleted' : 'none', rows: removed ? 1 : 0 }],
      requestedAt: at,
      verifiedAt: at,
      completedAt: at,
      actor: 'admin',
      reason: 'post-restore-reapply',
    });
    result.records++;
  }
  return result;
}
