import { sql, type Kysely } from 'kysely';

/*
 * Exam simulations (services/gateway/src/exams, docs/platform-identity.md).
 *
 * Same tenancy as 0001_platform: org_id on every row, RLS on app.org_id
 * (app.platform for platform code paths), DML granted to the app role.
 *
 * - exam_attempts: one row per attempt (= ExamSession name). The ExamSession
 *   in the cluster is the live state; this row is the history that the retake
 *   policy, reports and the manager view read, and it survives the
 *   ExamSession's deletion. At most one running attempt per (org, user, exam)
 *   is a unique index, so the retake policy holds under concurrent starts.
 * - exam_task_results: one row per graded task (reporting, team heatmaps
 *   without parsing the report jsonb).
 * - exam_retake_grants: an admin/manager intervention that lets one person
 *   start one more attempt despite the cooldown or the 30-day cap; consumed
 *   by the attempt it allowed.
 *
 * Skill evidence goes through the existing tables (lab_attempts with
 * session_name "<attempt>/t<index>", check_results, skill_evidence,
 * learner_skill_state), exactly as learner/learning.ts recordRun() does for labs.
 */

export const EXAM_TENANT_TABLES = ['exam_attempts', 'exam_task_results', 'exam_retake_grants'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE exam_attempts (
      org_id            uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      id                text        NOT NULL CHECK (id ~ '^exam-[0-9a-f]{10}$'),
      user_id           text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      exam_id           text        NOT NULL,
      exam_title        text        NOT NULL,
      number            integer     NOT NULL CHECK (number > 0),
      seed              bigint      NOT NULL,
      phase             text        NOT NULL CHECK (phase IN ('preparing', 'in-progress', 'grading', 'completed', 'failed')),
      started_at        timestamptz NOT NULL,
      timer_started_at  timestamptz,
      deadline          timestamptz,
      submitted_at      timestamptz,
      completed_at      timestamptz,
      duration_minutes  integer     NOT NULL,
      tasks             jsonb       NOT NULL DEFAULT '[]',
      flagged           integer[]   NOT NULL DEFAULT '{}',
      score             numeric(5,1),
      passed            boolean,
      report            jsonb,
      evidence_recorded boolean     NOT NULL DEFAULT false,
      voided_at         timestamptz,
      voided_by         text        REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      void_reason       text,
      PRIMARY KEY (org_id, id),
      UNIQUE (id)
    );
    CREATE INDEX exam_attempts_user ON exam_attempts (org_id, user_id, exam_id, started_at DESC);
    CREATE UNIQUE INDEX exam_attempts_one_running ON exam_attempts (org_id, user_id, exam_id) WHERE phase IN ('preparing', 'in-progress', 'grading');

    CREATE TABLE exam_task_results (
      org_id      uuid         NOT NULL REFERENCES orgs ON DELETE CASCADE,
      attempt_id  text         NOT NULL,
      task_index  integer      NOT NULL,
      task_id     text         NOT NULL,
      objective   text         NOT NULL,
      weight      numeric(5,2) NOT NULL,
      outcome     text         NOT NULL CHECK (outcome IN ('pass', 'partial', 'fail')),
      score       numeric(5,1) NOT NULL,
      checks      jsonb        NOT NULL,
      PRIMARY KEY (org_id, attempt_id, task_index),
      FOREIGN KEY (org_id, attempt_id) REFERENCES exam_attempts (org_id, id) ON DELETE CASCADE
    );

    CREATE TABLE exam_retake_grants (
      id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id      text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      exam_id      text        NOT NULL,
      granted_by   text        REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      reason       text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      used_at      timestamptz,
      used_by_attempt text
    );
    CREATE INDEX exam_retake_grants_open ON exam_retake_grants (org_id, user_id, exam_id) WHERE used_at IS NULL;
  `.execute(db);

  for (const t of EXAM_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO ${app}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS exam_retake_grants, exam_task_results, exam_attempts CASCADE`.execute(db);
}
