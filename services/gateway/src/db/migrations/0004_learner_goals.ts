import { sql, type Kysely } from 'kysely';

/*
 * The learner's own study goals (exam date, weekly practice target), shown
 * and edited on the Home goal card. Until this migration the web app kept them
 * in localStorage; it imports those once (PUT /me/goals with source=browser).
 *
 * Same tenancy as 0001_platform: org_id on every row, RLS on app.org_id
 * (app.platform for platform code paths), DML granted to the app role. One
 * row per (org, user): goals are per org, like assignments.
 *
 * Additive and idempotent (IF NOT EXISTS, policy recreated): it also applies
 * cleanly to a shared dev database that saw an earlier run of this branch.
 */

export const GOAL_TENANT_TABLES = ['learner_goals'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS learner_goals (
      org_id                uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id               text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      target_date           date,
      weekly_target_minutes integer     CHECK (weekly_target_minutes BETWEEN 5 AND 3000),
      updated_at            timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id)
    )
  `.execute(db);
  for (const t of GOAL_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant ON ${tbl}`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO ${app}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS learner_goals`.execute(db);
}
