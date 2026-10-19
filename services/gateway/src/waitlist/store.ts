import type { WaitlistEntry } from '@cloudtrain/api-types';
import { withTenant, type Db } from '../db/index.js';
import type { WaitlistInput } from './validate.js';

/** Where waitlist entries live. Postgres in the gateway; in memory in unit tests. */
export interface WaitlistStore {
  /** Adds an entry; false when the address (compared lowercased) is already on the list. */
  add(entry: WaitlistInput, consentAt: Date): Promise<boolean>;
  /** Newest first. */
  list(limit: number): Promise<{ entries: WaitlistEntry[]; total: number }>;
}

export class PgWaitlistStore implements WaitlistStore {
  constructor(private readonly db: Db) {}

  async add(e: WaitlistInput, consentAt: Date): Promise<boolean> {
    // No tenant: the table's INSERT policy admits anyone, nothing else. No RETURNING (it needs SELECT).
    const r = await withTenant(this.db, {}, (tx) =>
      tx
        .insertInto('waitlist_entries')
        .values({ email: e.email, organisation: e.organisation ?? null, role: e.role ?? null, interest: e.interest ?? null, consent_at: consentAt })
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst(),
    );
    return Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  async list(limit: number) {
    return withTenant(this.db, { platform: true }, async (tx) => {
      const rows = await tx.selectFrom('waitlist_entries').selectAll().orderBy('created_at', 'desc').orderBy('email').limit(limit).execute();
      const total = await tx.selectFrom('waitlist_entries').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      return {
        entries: rows.map((r) => ({ id: r.id, email: r.email, organisation: r.organisation, role: r.role, interest: r.interest, consentAt: r.consent_at.toISOString(), createdAt: r.created_at.toISOString() })),
        total: Number(total.n),
      };
    });
  }
}

export class MemoryWaitlistStore implements WaitlistStore {
  readonly rows: WaitlistEntry[] = [];
  private seq = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  async add(e: WaitlistInput, consentAt: Date): Promise<boolean> {
    if (this.rows.some((r) => r.email.toLowerCase() === e.email.toLowerCase())) return false;
    this.seq += 1;
    this.rows.push({ id: `w-${this.seq}`, email: e.email, organisation: e.organisation ?? null, role: e.role ?? null, interest: e.interest ?? null, consentAt: consentAt.toISOString(), createdAt: this.now().toISOString() });
    return true;
  }

  async list(limit: number) {
    return { entries: [...this.rows].reverse().slice(0, limit), total: this.rows.length };
  }
}
