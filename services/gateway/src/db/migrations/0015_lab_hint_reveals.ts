import { sql, type Kysely } from 'kysely';

/*
 * Lab hints revealed, per person, lab and session (grading-5). A solve records
 * as hints used the number of distinct hints this person revealed for the lab
 * in the last 7 days, in any session, so revealing hint 0 in one throwaway
 * session, hint 1 in another and solving in a third still counts all of them
 * (a per-attempt count, even carried over as a maximum, would record 1).
 *
 * Numbered 0015: 0014 is taken by the session isolation work (still open).
 *
 * Same tenancy as 0001_platform: org_id on every row, RLS on app.org_id
 * (app.platform for platform code paths), DML granted to the app role. Rows
 * go with the person (ON DELETE CASCADE, docs/gdpr.md). A reveal is recorded
 * once per (session, hint): ON CONFLICT DO NOTHING keeps retries idempotent.
 *
 * Also lab_attempts.graded_request (content-1): the grader request number of
 * the last run recorded for the attempt. A run is recorded once per request
 * (Validate and every later session read hand the same run in); comparing
 * completion times instead would drop a second run that finishes within the
 * same second. NULL for attempts recorded before this migration.
 *
 * Additive and idempotent (IF NOT EXISTS, policy recreated).
 */

export const HINT_TENANT_TABLES = ['lab_hint_reveals'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS lab_hint_reveals (
      org_id        uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id       text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      lab_id        text        NOT NULL,
      session_name  text        NOT NULL,
      hint_index    integer     NOT NULL CHECK (hint_index >= 0),
      revealed_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id, lab_id, session_name, hint_index)
    );
    CREATE INDEX IF NOT EXISTS lab_hint_reveals_recent ON lab_hint_reveals (org_id, user_id, lab_id, revealed_at DESC);
    ALTER TABLE lab_attempts ADD COLUMN IF NOT EXISTS graded_request integer;
  `.execute(db);
  for (const t of HINT_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant ON ${tbl}`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
    // Append-only for the app: a reveal is never rewritten; erasure goes through the users cascade.
    await sql`GRANT SELECT, INSERT ON ${tbl} TO ${app}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS lab_hint_reveals`.execute(db);
  await sql`ALTER TABLE lab_attempts DROP COLUMN IF EXISTS graded_request`.execute(db);
}
