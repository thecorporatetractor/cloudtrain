import { sql, type Kysely } from 'kysely';

/*
 * The rest of the data-subject rights in the app (src/gdpr, docs/gdpr.md).
 *
 * - users.restricted_at: Art. 18, new processing of this person stops.
 * - users.closed_at, closed_orgs: closure. Access ends now and erasure follows after a grace
 *   period; closed_orgs remembers which memberships a reopening gives back.
 * - users.inactivity_warned_at: the warning before inactivity deletion; a sign-in clears it.
 * - users.privacy_notice_version, privacy_notice_at: the information notice at first sign-in.
 * - auth_sessions.authenticated_at: when the person last really authenticated (the ID token's
 *   auth_time), which is not when the session started: a live identity-provider session can start
 *   a gateway session without any password. Download and deletion require a recent one.
 * - The ledger accepts `objection`.
 *
 * Additive and idempotent.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS restricted_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_orgs uuid[] NOT NULL DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS inactivity_warned_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_notice_version text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_notice_at timestamptz;
    CREATE INDEX IF NOT EXISTS users_closed ON users (closed_at) WHERE closed_at IS NOT NULL;
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS authenticated_at timestamptz;

    ALTER TABLE gdpr_ledger DROP CONSTRAINT IF EXISTS gdpr_ledger_type_check;
    ALTER TABLE gdpr_ledger ADD CONSTRAINT gdpr_ledger_type_check CHECK (type IN ('erasure', 'withdrawal', 'export', 'restriction', 'objection'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE gdpr_ledger DROP CONSTRAINT IF EXISTS gdpr_ledger_type_check;
    ALTER TABLE gdpr_ledger ADD CONSTRAINT gdpr_ledger_type_check CHECK (type IN ('erasure', 'withdrawal', 'export', 'restriction'));
    ALTER TABLE auth_sessions DROP COLUMN IF EXISTS authenticated_at;
    DROP INDEX IF EXISTS users_closed;
    ALTER TABLE users DROP COLUMN IF EXISTS privacy_notice_at, DROP COLUMN IF EXISTS privacy_notice_version, DROP COLUMN IF EXISTS inactivity_warned_at, DROP COLUMN IF EXISTS closed_orgs, DROP COLUMN IF EXISTS closed_at, DROP COLUMN IF EXISTS restricted_at;
  `.execute(db);
}
