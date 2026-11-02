import { sql } from 'kysely';
import type { WaitlistEntry } from '@cloudtrain/api-types';
import { withTenant, type Db } from '../db/index.js';
import type { WaitlistEntriesTable } from '../db/schema.js';
import type { Selectable } from 'kysely';
import type { WaitlistInput } from './validate.js';

/** Where waitlist entries live. Postgres in the gateway; in memory in unit tests. */
export interface WaitlistStore {
  /** Adds an entry; false when the address (compared lowercased) is already on the list. */
  add(entry: WaitlistInput, consentAt: Date): Promise<boolean>;
  /** Newest first. */
  list(limit: number): Promise<{ entries: WaitlistEntry[]; total: number }>;
  /** The entry of an address (compared lowercased), for a data-subject export. */
  find(email: string): Promise<WaitlistEntry | null>;
  /** Removes the entry of an address; how many went (0 or 1). */
  remove(email: string): Promise<number>;
  /** Retention: removes up to `limit` entries created before `cutoff`; how many went. */
  removeOlderThan(cutoff: Date, limit: number): Promise<number>;
}

type WaitlistRow = Selectable<WaitlistEntriesTable>;
const entryOf = (r: WaitlistRow): WaitlistEntry => ({ id: r.id, email: r.email, organisation: r.organisation, role: r.role, interest: r.interest, consentAt: r.consent_at.toISOString(), createdAt: r.created_at.toISOString() });

export class PgWaitlistStore implements WaitlistStore {
  constructor(private readonly db: Db) {}

  async find(email: string) {
    const r = await withTenant(this.db, { platform: true }, (tx) => tx.selectFrom('waitlist_entries').selectAll().where(sql`lower(email)`, '=', email.trim().toLowerCase()).executeTakeFirst());
    return r ? entryOf(r) : null;
  }

  async remove(email: string) {
    const r = await withTenant(this.db, { platform: true }, (tx) => tx.deleteFrom('waitlist_entries').where(sql`lower(email)`, '=', email.trim().toLowerCase()).executeTakeFirst());
    return Number(r.numDeletedRows ?? 0);
  }

  async removeOlderThan(cutoff: Date, limit: number) {
    const r = await withTenant(this.db, { platform: true }, (tx) =>
      tx
        .deleteFrom('waitlist_entries')
        .where('id', 'in', (eb) => eb.selectFrom('waitlist_entries').select('id').where('created_at', '<', cutoff).orderBy('created_at').limit(limit))
        .executeTakeFirst(),
    );
    return Number(r.numDeletedRows ?? 0);
  }

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
        entries: rows.map(entryOf),
        total: Number(total.n),
      };
    });
  }
}

export class MemoryWaitlistStore implements WaitlistStore {
  rows: WaitlistEntry[] = [];
  private seq = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  async find(email: string) {
    const e = email.trim().toLowerCase();
    return this.rows.find((r) => r.email.toLowerCase() === e) ?? null;
  }

  async remove(email: string) {
    const before = this.rows.length;
    const e = email.trim().toLowerCase();
    this.rows = this.rows.filter((r) => r.email.toLowerCase() !== e);
    return before - this.rows.length;
  }

  async removeOlderThan(cutoff: Date, limit: number) {
    const old = this.rows.filter((r) => Date.parse(r.createdAt) < cutoff.getTime()).slice(0, limit);
    this.rows = this.rows.filter((r) => !old.includes(r));
    return old.length;
  }

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
