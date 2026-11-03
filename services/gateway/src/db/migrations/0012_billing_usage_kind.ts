import { sql, type Kysely } from 'kysely';

/*
 * Exam and CTF event usage, and start reservations (docs/billing.md).
 *
 * - billing_usage.kind: `lab` (POST /api/labs/:id/sessions), `exam` (an exam simulation attempt;
 *   lab_id holds the exam id) or `event` (a CTF event lab). The plan limits count exam
 *   simulations by it, and the sweep asks the right resource whether a session still runs.
 * - billing_usage.session_confirmed: false while the row is a reservation written by the start
 *   gate before the session exists, true once it does. A reservation whose session never
 *   appears is closed unbilled; a confirmed session that is gone is billed up to its end.
 *
 * Additive and idempotent. Existing rows are labs whose sessions existed. Constant defaults
 * make ADD COLUMN a catalogue change (no table rewrite); session_confirmed defaults to true so
 * an older gateway's rows read as confirmed, and the gate sets false on its reservations. The
 * CHECK is added NOT VALID, which only checks new rows; validating the existing ones is
 * 0013_billing_usage_kind_validate. migrateToLatest (src/db/index.ts) applies one migration per
 * transaction, so this one holds its ACCESS EXCLUSIVE lock only for the catalogue changes, and
 * lock_timeout bounds the wait for it. No new index: the gate's per-person counts use
 * billing_usage_user.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  // Waits at most 5 s for the table lock (behind long reads), then fails and is retried, instead of queueing every write behind it.
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE billing_usage ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'lab'`.execute(db);
  // DEFAULT true: a gateway older than this migration (no reservations) never writes a row that looks unconfirmed; the gate writes false explicitly.
  await sql`ALTER TABLE billing_usage ADD COLUMN IF NOT EXISTS session_confirmed boolean NOT NULL DEFAULT true`.execute(db);
  const has = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'billing_usage_kind_check' AND conrelid = 'billing_usage'::regclass`.execute(db);
  if (!has.rows[0]?.n) await sql`ALTER TABLE billing_usage ADD CONSTRAINT billing_usage_kind_check CHECK (kind IN ('lab', 'exam', 'event')) NOT VALID`.execute(db);
}

/** Removes both columns (and the constraint). Safe to run more than once; roll the gateway back first. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE billing_usage DROP CONSTRAINT IF EXISTS billing_usage_kind_check`.execute(db);
  await sql`ALTER TABLE billing_usage DROP COLUMN IF EXISTS session_confirmed`.execute(db);
  await sql`ALTER TABLE billing_usage DROP COLUMN IF EXISTS kind`.execute(db);
}
