import { sql, type Kysely } from 'kysely';

/*
 * Early-access waitlist (services/gateway/src/waitlist, docs/website.md).
 *
 * waitlist_entries is not tenant data: the visitors are not users of any org, so
 * there is no org_id. RLS still applies, with the two roles of this table:
 * - anyone connecting as the app role may INSERT (the unauthenticated public
 *   endpoint, run in a transaction without a tenant), and nothing else;
 * - reading and deleting need `app.platform` (the platform-admin code paths:
 *   the list and CSV export), exactly like the platform views of the tenant tables.
 *
 * One row per address: the unique index is on lower(email), so Ada@x.io and
 * ada@x.io are the same person. The address is stored as typed (trimmed). Consent
 * is recorded as a timestamp; the form cannot be submitted without it. The client
 * address is deliberately not stored. Additive and idempotent.
 */

export const WAITLIST_TABLES = ['waitlist_entries'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text        NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
      organisation  text        CHECK (organisation IS NULL OR length(organisation) BETWEEN 1 AND 120),
      role          text        CHECK (role IS NULL OR length(role) BETWEEN 1 AND 80),
      interest      text        CHECK (interest IS NULL OR interest IN ('enterprise', 'individual')),
      consent_at    timestamptz NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_email ON waitlist_entries (lower(email));
    CREATE INDEX IF NOT EXISTS waitlist_entries_created ON waitlist_entries (created_at DESC);
  `.execute(db);
  await sql`ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS waitlist_insert ON waitlist_entries`.execute(db);
  await sql`DROP POLICY IF EXISTS waitlist_platform_read ON waitlist_entries`.execute(db);
  await sql`DROP POLICY IF EXISTS waitlist_platform_delete ON waitlist_entries`.execute(db);
  await sql`CREATE POLICY waitlist_insert ON waitlist_entries FOR INSERT WITH CHECK (true)`.execute(db);
  await sql`CREATE POLICY waitlist_platform_read ON waitlist_entries FOR SELECT USING (app_platform())`.execute(db);
  await sql`CREATE POLICY waitlist_platform_delete ON waitlist_entries FOR DELETE USING (app_platform())`.execute(db);
  await sql`GRANT SELECT, INSERT, DELETE ON waitlist_entries TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS waitlist_entries`.execute(db);
}
