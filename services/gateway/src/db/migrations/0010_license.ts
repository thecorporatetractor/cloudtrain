import { sql, type Kysely } from 'kysely';

/*
 * Self-hosted license keys uploaded on /platform/license (src/license,
 * docs/licensing-keys.md). CT_LICENSE_KEY / CT_LICENSE_FILE take precedence and
 * are never stored here.
 *
 * Not tenant data: one license per deployment, no org_id. Only the platform
 * context (`app.platform`, platform-admin code paths and the gateway's own
 * startup read) may read or write it. Rows are never deleted: installing a new
 * license or removing it stamps `removed_at`, so the history stays auditable.
 * Additive and idempotent.
 */

export const LICENSE_TABLES = ['platform_licenses'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS platform_licenses (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      license_id    text        NOT NULL,
      token         text        NOT NULL CHECK (length(token) BETWEEN 16 AND 16384),
      installed_by  text,
      installed_at  timestamptz NOT NULL DEFAULT now(),
      removed_at    timestamptz,
      removed_by    text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_licenses_current ON platform_licenses ((true)) WHERE removed_at IS NULL;
  `.execute(db);
  await sql`ALTER TABLE platform_licenses ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS platform_licenses_platform ON platform_licenses`.execute(db);
  await sql`CREATE POLICY platform_licenses_platform ON platform_licenses USING (app_platform()) WITH CHECK (app_platform())`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON platform_licenses TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS platform_licenses`.execute(db);
}
