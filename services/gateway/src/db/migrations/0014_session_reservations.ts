import { sql, type Kysely } from 'kysely';

/*
 * Session start reservations (src/platform/capacity.ts, security review escape-6).
 *
 * A start counts what runs (a label-selected LIST of LabSessions, read before the
 * lock) plus these rows, under a transaction-scoped advisory lock, and writes its
 * own row before the lock is released. The Kubernetes create then runs outside the
 * lock; a failed start deletes its row unless the session exists anyway. A lab row
 * is confirmed (confirmed_at, database clock) once its session was created; an exam
 * row reserves its environment count (units) and is confirmed once that many of its
 * environment LabSessions are listed. A confirmed row still counts for a start whose
 * LIST began before the confirmation (that LIST may have missed the sessions), and
 * no longer after that (they are listed, or already gone); confirmed rows are pruned
 * a minute later, unconfirmed ones at expires_at. Every time is the database clock.
 * So concurrent starts on every gateway replica see each other without holding a
 * lock across a cluster call. Keyed by (org, session name): names are random but
 * short, and two orgs may draw the same one.
 *
 * Tenant RLS as everywhere; the capacity path runs with app.platform (it counts
 * every org). Rows hold ids only and live for minutes; erasure of a user drops theirs
 * (ON DELETE CASCADE, CASCADE_TABLES). Additive and idempotent.
 *
 * Numbered after #364's 0012/0013 (billing_usage kind), which merge first.
 */

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS session_reservations (
      org_id      uuid        NOT NULL,
      session_name text       NOT NULL,
      kind        text        NOT NULL CHECK (kind IN ('lab', 'exam')),
      units       int         NOT NULL DEFAULT 1 CHECK (units >= 1),
      user_id     text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz,
      expires_at  timestamptz NOT NULL,
      PRIMARY KEY (org_id, session_name)
    );
    CREATE INDEX IF NOT EXISTS session_reservations_expires ON session_reservations (expires_at);
  `.execute(db);
  await sql`ALTER TABLE session_reservations ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant ON session_reservations`.execute(db);
  await sql`CREATE POLICY tenant ON session_reservations USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON session_reservations TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS session_reservations`.execute(db);
}
