import { sql } from 'kysely';
import { withTenant, type Db } from '../db/index.js';
import type { WaitlistStore } from '../waitlist/store.js';
import type { ErasureLedger } from './ledger.js';

/*
 * Retention (docs/gdpr.md "Retention"). Batched and idempotent: a run deletes what is past its
 * period and a second run finds nothing. The log line holds counts only. `0` disables one
 * sweep, CT_RETENTION_SWEEP_MS=0 all of them. One part failing does not stop the others.
 */

export interface RetentionConfig {
  /** CT_RETENTION_SWEEP_MS: how often the sweep runs (default 6 hours; 0 = off). */
  sweepMs: number;
  /** CT_RETENTION_WAITLIST_MONTHS: after created_at (default 24; 0 = off). */
  waitlistMonths: number;
  /** CT_RETENTION_AUDIT_MONTHS: after `at` (default 13; 0 = off; the database refuses a cutoff within 28 days). */
  auditMonths: number;
  /** CT_RETENTION_LEDGER_MONTHS: after completedAt, leaving a signed checkpoint (default 36; 0 = off; at least 12). */
  ledgerMonths: number;
  /** CT_RETENTION_CLOSED_DAYS: from closure to deletion (default 90; 0 = closed accounts stay). */
  closedDays: number;
  /** CT_RETENTION_INACTIVE_MONTHS: since the last sign-in (default 24; 0 = off). */
  inactiveMonths: number;
  /** CT_RETENTION_INACTIVE_WARNING_DAYS: from the warning mail to deletion (default 30, at least 1). */
  warningDays: number;
  /** CT_RETENTION_REQUEST_DAYS: finished rows of the rights queue (default 30; 0 = off). Expired links always go. */
  requestDays: number;
}

export const DEFAULT_RETENTION: RetentionConfig = { sweepMs: 6 * 3_600_000, waitlistMonths: 24, auditMonths: 13, ledgerMonths: 36, requestDays: 30, closedDays: 90, inactiveMonths: 24, warningDays: 30 };

function whole(env: Record<string, string | undefined>, name: string, def: number, floor = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number (0 turns it off)`);
  if (n !== 0 && n < floor) throw new Error(`${name} must be 0 or at least ${floor}`);
  return n;
}

export function retentionConfig(env: Record<string, string | undefined>): RetentionConfig {
  return {
    sweepMs: whole(env, 'CT_RETENTION_SWEEP_MS', DEFAULT_RETENTION.sweepMs),
    waitlistMonths: whole(env, 'CT_RETENTION_WAITLIST_MONTHS', DEFAULT_RETENTION.waitlistMonths),
    auditMonths: whole(env, 'CT_RETENTION_AUDIT_MONTHS', DEFAULT_RETENTION.auditMonths, 1),
    ledgerMonths: whole(env, 'CT_RETENTION_LEDGER_MONTHS', DEFAULT_RETENTION.ledgerMonths, 12),
    requestDays: whole(env, 'CT_RETENTION_REQUEST_DAYS', DEFAULT_RETENTION.requestDays),
    closedDays: whole(env, 'CT_RETENTION_CLOSED_DAYS', DEFAULT_RETENTION.closedDays),
    inactiveMonths: whole(env, 'CT_RETENTION_INACTIVE_MONTHS', DEFAULT_RETENTION.inactiveMonths),
    warningDays: Math.max(1, whole(env, 'CT_RETENTION_INACTIVE_WARNING_DAYS', DEFAULT_RETENTION.warningDays)),
  };
}

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

export type RetentionResult = Record<'waitlist' | 'audit' | 'ledger' | 'expiredLinks' | 'finishedRequests' | 'authSessions' | 'loginStates' | 'closedAccounts' | 'inactiveWarned' | 'inactiveAccounts', number | null> & { accountsSkipped: number; failed: string[] };

export interface RetentionDeps {
  db: Db;
  waitlist?: WaitlistStore;
  ledger?: ErasureLedger;
  /** Absent: a deployment with no accounts (the site VM). */
  accounts?: { sweepAccounts(cfg: { closedDays: number; inactiveMonths: number; warningDays: number }): Promise<{ closed: number | null; warned: number | null; inactive: number | null; skipped: number; failed: number }> };
  config: RetentionConfig;
  log?: { info(o: object, m: string): void; warn(o: object, m: string): void };
  now?: () => Date;
  batch?: number;
  maxBatches?: number;
}

const LOGIN_STATE_TTL_MS = 15 * 60_000;

export async function sweepRetention(d: RetentionDeps): Promise<RetentionResult> {
  const now = d.now?.() ?? new Date();
  const batch = d.batch ?? 1000;
  const maxBatches = d.maxBatches ?? 20;
  const result: RetentionResult = { waitlist: null, audit: null, ledger: null, expiredLinks: null, finishedRequests: null, authSessions: null, loginStates: null, closedAccounts: null, inactiveWarned: null, inactiveAccounts: null, accountsSkipped: 0, failed: [] };

  const drain = async (key: Exclude<keyof RetentionResult, 'failed' | 'accountsSkipped'>, one: () => Promise<number>) => {
    try {
      let total = 0;
      for (let i = 0; i < maxBatches; i++) {
        const n = await one();
        total += n;
        if (n < batch) break;
      }
      result[key] = total;
    } catch (e) {
      result.failed.push(key);
      d.log?.warn({ part: key, code: (e as { code?: string }).code }, 'retention sweep: a part failed');
    }
  };

  if (d.config.waitlistMonths && d.waitlist) {
    const w = d.waitlist;
    const cutoff = monthsBefore(now, d.config.waitlistMonths);
    await drain('waitlist', () => w.removeOlderThan(cutoff, batch));
  }
  if (d.config.auditMonths) {
    const cutoff = monthsBefore(now, d.config.auditMonths);
    await drain('audit', async () => {
      const r = await withTenant(d.db, { platform: true }, (tx) => sql<{ n: number }>`SELECT sys_prune_audit_log(${cutoff}, ${batch}) AS n`.execute(tx));
      return r.rows[0]?.n ?? 0;
    });
  }
  if (d.config.ledgerMonths && d.ledger) {
    const l = d.ledger;
    const cutoff = monthsBefore(now, d.config.ledgerMonths);
    let total = 0;
    await drain('ledger', async () => {
      const n = await l.prune(cutoff, batch);
      total += n;
      // Azure removes at most one transaction's worth per call: carry on until nothing is left.
      return n > 0 ? batch : 0;
    });
    if (result.ledger !== null) result.ledger = total;
  }
  await drain('expiredLinks', async () => {
    const r = await withTenant(d.db, { platform: true }, (tx) => tx.deleteFrom('gdpr_requests').where('status', '=', 'awaiting_confirmation').where('expires_at', '<', now).executeTakeFirst());
    return Number(r.numDeletedRows ?? 0);
  });
  if (d.config.requestDays) {
    const cutoff = new Date(now.getTime() - d.config.requestDays * 86_400_000);
    await drain('finishedRequests', async () => {
      const r = await withTenant(d.db, { platform: true }, (tx) => tx.deleteFrom('gdpr_requests').where('status', '=', 'completed').where('completed_at', '<', cutoff).executeTakeFirst());
      return Number(r.numDeletedRows ?? 0);
    });
  }
  // Until now these went only when presented again, or at the next login: the IP and user agent stayed.
  await drain('authSessions', async () => {
    const r = await d.db.deleteFrom('auth_sessions').where('expires_at', '<', now).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  });
  await drain('loginStates', async () => {
    const r = await d.db.deleteFrom('auth_login_states').where('created_at', '<', new Date(now.getTime() - LOGIN_STATE_TTL_MS)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  });

  if (d.accounts && (d.config.closedDays || d.config.inactiveMonths)) {
    try {
      const a = await d.accounts.sweepAccounts({ closedDays: d.config.closedDays, inactiveMonths: d.config.inactiveMonths, warningDays: d.config.warningDays });
      result.closedAccounts = a.closed;
      result.inactiveWarned = a.warned;
      result.inactiveAccounts = a.inactive;
      result.accountsSkipped = a.skipped;
      if (a.failed) result.failed.push('inactivityWarnings');
    } catch (e) {
      result.failed.push('accounts');
      d.log?.warn({ part: 'accounts', code: (e as { code?: string }).code }, 'retention sweep: a part failed');
    }
  }

  d.log?.info({ ...result }, 'retention sweep');
  return result;
}
