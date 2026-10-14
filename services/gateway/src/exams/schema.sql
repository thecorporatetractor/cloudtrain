-- Exam attempts for the platform-api Postgres database (proposed migration
-- 0002_exams; same conventions as 0001_platform: org_id on every row, RLS on
-- app.org_id, DML granted to the app role). The gateway's ExamStore interface
-- (src/exams/store.ts) maps onto these tables; MemoryExamStore is the
-- in-memory stand-in until this lands.

CREATE TABLE exam_attempts (
  org_id            uuid        NOT NULL REFERENCES orgs(id),
  id                text        NOT NULL,              -- ExamSession name, "exam-<10 hex>"
  user_id           text        NOT NULL REFERENCES users(id),
  exam_id           text        NOT NULL,              -- curriculum exam id
  exam_title        text        NOT NULL,
  number            int         NOT NULL,              -- 1-based per (user, exam)
  seed              bigint      NOT NULL,
  phase             text        NOT NULL CHECK (phase IN ('preparing','in-progress','grading','completed','failed')),
  started_at        timestamptz NOT NULL,
  timer_started_at  timestamptz,
  deadline          timestamptz,
  submitted_at      timestamptz,
  completed_at      timestamptz,
  duration_minutes  int         NOT NULL,
  tasks             jsonb       NOT NULL DEFAULT '[]', -- [{index, taskId, objective, title, weight}]
  flagged           int[]       NOT NULL DEFAULT '{}',
  score             numeric(5,1),
  passed            boolean,
  report            jsonb,                             -- api-types ExamReport
  evidence_recorded boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX exam_attempts_user ON exam_attempts (org_id, user_id, exam_id, started_at DESC);

-- One row per graded task (reporting, team heatmaps without parsing report jsonb).
CREATE TABLE exam_task_results (
  org_id     uuid    NOT NULL,
  attempt_id text    NOT NULL,
  task_index int     NOT NULL,
  task_id    text    NOT NULL,
  objective  text    NOT NULL,
  weight     numeric(5,2) NOT NULL,
  outcome    text    NOT NULL CHECK (outcome IN ('pass','partial','fail')),
  score      numeric(5,1) NOT NULL,
  checks     jsonb   NOT NULL,                         -- [{id, passed, weight, skills, message, failedAfterReboot, failedOnRerun}]
  PRIMARY KEY (org_id, attempt_id, task_index),
  FOREIGN KEY (org_id, attempt_id) REFERENCES exam_attempts (org_id, id) ON DELETE CASCADE
);

ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_task_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON exam_attempts USING (org_id::text = current_setting('app.org_id', true) OR current_setting('app.platform', true) = 'on');
CREATE POLICY tenant ON exam_task_results USING (org_id::text = current_setting('app.org_id', true) OR current_setting('app.platform', true) = 'on');

-- Skill evidence goes through the existing tables: one lab_attempts row per
-- task (session_name "<attempt id>/t<index>", hints_used 0) with its
-- check_results and skill_evidence rows, then learner_skill_state, exactly as
-- learner/learning.ts recordRun() does for labs.
