import { sql, type Kysely } from 'kysely';

/*
 * CTF answers (services/gateway/src/answers, docs/ctf-authoring.md).
 *
 * Same tenancy as 0001_platform: org_id on every row, RLS on app.org_id
 * (app.platform for platform code paths), DML granted to the app role.
 *
 * - answer_submissions: every answer a learner submitted to an answer check,
 *   graded on arrival. `scope_key` is whose progress it counts for: the lab
 *   session for a solo attempt, or "event:<event>:<team or user>:<lab>" in a
 *   CTF event (teammates share progress). At most one correct submission per
 *   (scope, question) is a unique index, so a question is solved once even
 *   under concurrent submits. `points` is the award at solve time (static);
 *   event scoreboards with dynamic scoring recompute it. The expected answer
 *   is never stored here.
 * - answer_hint_reveals: question hints revealed per scope, with their cost.
 * - lab_attempts gains the CTF totals shown in history (points, questions).
 *
 * Additive and idempotent (IF NOT EXISTS, policies recreated).
 */

export const ANSWER_TENANT_TABLES = ['answer_submissions', 'answer_hint_reveals'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS answer_submissions (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      scope_key     text        NOT NULL,
      user_id       text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      session_name  text        NOT NULL,
      lab_id        text        NOT NULL,
      check_id      text        NOT NULL,
      event_id      uuid,
      team_id       uuid,
      answer        text        NOT NULL CHECK (length(answer) <= 512),
      correct       boolean     NOT NULL,
      points        integer     NOT NULL DEFAULT 0 CHECK (points >= 0),
      submitted_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS answer_submissions_scope ON answer_submissions (org_id, scope_key, check_id, submitted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS answer_submissions_one_solve ON answer_submissions (org_id, scope_key, check_id) WHERE correct;
    CREATE INDEX IF NOT EXISTS answer_submissions_user ON answer_submissions (org_id, user_id, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS answer_submissions_event ON answer_submissions (org_id, event_id, submitted_at) WHERE event_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS answer_hint_reveals (
      org_id        uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      scope_key     text        NOT NULL,
      check_id      text        NOT NULL,
      hint_index    integer     NOT NULL CHECK (hint_index >= 0),
      user_id       text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      session_name  text        NOT NULL,
      lab_id        text        NOT NULL,
      event_id      uuid,
      team_id       uuid,
      cost          integer     NOT NULL CHECK (cost >= 0),
      revealed_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, scope_key, check_id, hint_index)
    );

    ALTER TABLE lab_attempts ADD COLUMN IF NOT EXISTS points_earned    integer NOT NULL DEFAULT 0;
    ALTER TABLE lab_attempts ADD COLUMN IF NOT EXISTS points_possible  integer NOT NULL DEFAULT 0;
    ALTER TABLE lab_attempts ADD COLUMN IF NOT EXISTS questions_solved integer NOT NULL DEFAULT 0;
    ALTER TABLE lab_attempts ADD COLUMN IF NOT EXISTS questions_total  integer NOT NULL DEFAULT 0;
  `.execute(db);
  for (const t of ANSWER_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant ON ${tbl}`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
  }
  // Submissions are an append-only record: the app inserts and reads, never rewrites a graded answer.
  await sql`GRANT SELECT, INSERT ON answer_submissions TO ${app}`.execute(db);
  await sql`GRANT SELECT, INSERT, DELETE ON answer_hint_reveals TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS answer_hint_reveals, answer_submissions`.execute(db);
  await sql`ALTER TABLE lab_attempts DROP COLUMN IF EXISTS points_earned, DROP COLUMN IF EXISTS points_possible, DROP COLUMN IF EXISTS questions_solved, DROP COLUMN IF EXISTS questions_total`.execute(db);
}
