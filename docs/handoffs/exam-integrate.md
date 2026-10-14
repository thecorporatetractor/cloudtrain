# Handoff: exam-integrate (paused 2026-10-14)

Branch `build/exam-integrate`, worktree `.worktrees/b-exam-integrate`, based on
main + `build/exam-engine`. Paused at the user's request after step 3.

## Merge / conflicts: done (commit 70ce24f)

All 10 conflicts resolved:

| File | Resolution |
|---|---|
| apps/web routes/Exams.tsx (add/add) | exam-engine screens; `RequireRole` replaced by `RequireAccess` (ROUTE_ACCESS, permissions). ExamDetail/ExamWorkspace/ExamResults are wrapped in `RequireAccess path="/exams"` too |
| apps/web router.tsx | platform-web routes + exam routes; `/team/exams` keeps `team` search and adds `exam` |
| apps/web app/Shell.tsx | platform-web permission-based nav sections and hotkeys; exam workspace forces the rail; `/exams` link/hotkey pass `search={}` |
| apps/web mocks/handlers.ts | `[...allPlatformHandlers, ...coreHandlers, ...examHandlers, ...sampleOnlyHandlers]` |
| apps/web README, gateway README | both sections kept (gateway exam section later rewritten for Postgres) |
| packages/api-types/package.json | files: index, platform, exam |
| gateway config.ts / app.ts / main.ts | platform-api auth, CSRF, sessions, authz kept; exam config + `registerExamRoutes` added |

## Permissions and migrations

- No new permissions. Exam routes declare: `lab.run` (catalog, start, flag,
  submit, report, mine, terminal; own attempts only), `progress.read.team`
  (team readiness, scoped to the team), `session.control` (new
  `POST /api/exams/attempts/:id/void`), `assignment.manage` (new
  `POST /api/exams/:examId/retake-grants`). Documented in
  docs/platform-identity.md; matrix unchanged so authz.test.ts unchanged.
- Migration `0003_exams` (services/gateway/src/db/migrations): `exam_attempts`,
  `exam_task_results`, `exam_retake_grants`, RLS + grants like every tenant
  table; unique partial index `exam_attempts_one_running` (one running attempt
  per org/user/exam, holds under concurrent starts). `src/exams/schema.sql` removed.
- `src/exams/pg.ts`: PgExamStore, PgEvidenceSink (recordRun per task, session
  `<attempt>/t<n>`, hints 0, endAttempt), PgTeamDirectory (teams/team_members);
  AttemptTeamDirectory removed. Audit: `exam.start`, `exam.submit`,
  `exam.void`, `exam.retake_grant` (same transaction). CSRF: the global
  onRequest check covers exam writes (tested).

## Gates

Passing (run 2026-10-14):
- `pnpm --filter @cloudtrain/gateway typecheck` and `test`: 103 passed, 2 skipped
  (incl. new test/exams-pg.test.ts: CSRF, 409 second + concurrent start,
  persisted report/task results/evidence, team readiness scope, cross-org
  HTTP + RLS; rls.test.ts covers exam tables).
- `apps/web` typecheck + build.

Not yet run: `pnpm -r build/test` (whole repo), go vet/test + `make generate`
drift, `lab-verify --strict`, `curriculum render --check`. The merge did not
change Go code beyond build/exam-engine itself.

## Live proof: not started

`deploy/.results/exam-integration-proof.txt` does not exist. Nothing was
deployed: no gateway, DB, namespace or scoped manager of mine is running
(the mock vite on :5291 was stopped).

## Left, in order

1. Step 4 (deploy): verify `deploy/scripts/orchestrator-deploy.sh` keeps the
   per-instance ClusterRole and `CT_EXAM_SESSION_LABELS`; make
   `task dev:orchestrator` (scoped to `app.kubernetes.io/managed-by=cloudtrain-gateway`)
   reconcile gateway ExamSessions: the gateway puts `managed-by=cloudtrain-gateway`
   on ExamSessions by default; check the manager's selector filters
   ExamSessions too and that env LabSessions inherit the label, so exactly one
   manager reconciles them.
2. Step 5 gates above.
3. Step 6 live proof via `tools/slots/run.sh pod`: own gateway on a free port
   (not 8787) with a separate database in the compose Postgres
   (`CREATE DATABASE`, `pnpm db:migrate`/`db:seed` with CT_DATABASE_URL/OWNER_URL),
   `CT_EXTRA_EXAM_FILES`/`CT_EXTRA_LAB_DIRS` for sim-test-k8s-dev,
   `CT_EXAM_SESSION_LABELS` = own scoped manager selector. Port
   `services/gateway/scripts/exam-smoke.mjs` to the OIDC/CSRF gateway (it was
   written for DevAuthenticator): start, 409, flag, submit, report persisted,
   manager readiness 200 / other 403, cross-org. Save the log.
4. Optional: regenerate `apps/web/docs/screenshots/exams` in all three themes
   (`node apps/web/scripts/exam-shots.mjs --base http://localhost:<port>`; it
   now runs as the learner persona and switches to the manager for shot 12; a
   dark-theme run passed, screenshots not committed).

## Resume

```sh
cd /home/hackrvl/cloudtrain/.worktrees/b-exam-integrate
pnpm install --frozen-lockfile && pnpm --filter @cloudtrain/lab-schema build
pnpm --filter @cloudtrain/gateway test   # needs the compose Postgres on :55432
```
