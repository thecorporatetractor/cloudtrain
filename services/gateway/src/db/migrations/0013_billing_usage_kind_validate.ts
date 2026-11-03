import { sql, type Kysely } from 'kysely';

/*
 * Validates billing_usage_kind_check (added NOT VALID by 0012) on the existing rows.
 * migrateToLatest (src/db/index.ts) applies each migration in its own transaction (Kysely's
 * migrateToLatest would run all pending ones in a single transaction), so this runs after 0012
 * has committed and released its ACCESS EXCLUSIVE lock. VALIDATE CONSTRAINT itself takes only
 * SHARE UPDATE EXCLUSIVE: reads and writes go on while it scans.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE billing_usage VALIDATE CONSTRAINT billing_usage_kind_check`.execute(db);
}

/** Nothing to undo: a validated constraint is dropped with 0012's down. */
export async function down(): Promise<void> {}
