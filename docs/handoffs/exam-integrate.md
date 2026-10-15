# Handoff: exam-integrate (done 2026-10-15)

Branch `build/exam-integrate` (merged into main with wave 1), then
`feat/exam-integration-live` for the deploy step and the live proof (sections
"Deploy" and "Live proof" below).

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

## Deploy: `task dev:orchestrator` runs the gateway's exams

- The manager's `--session-selector` filters LabSessions, WarmPools and
  ExamSessions (cmd/manager/main.go cache options); the ExamSession controller
  copies the attempt's labels onto its environment LabTemplates/LabSessions
  (`childLabels`), so one manager owns the whole attempt.
- The gateway labels ExamSessions `app.kubernetes.io/managed-by=cloudtrain-gateway`
  by default, which is the `task dev:orchestrator` selector: leave
  `CT_EXAM_SESSION_LABELS` unset for it (set it only to hand exams to another scoped
  manager, e.g. `labs.cloudtrain.dev/exam-proof=true` for `ct-exam-system`).
- `orchestrator-deploy.sh` keeps the per-instance ClusterRole for non-default
  namespaces (cloudtrain-system uses `lab-orchestrator`, which has the exam verbs)
  and now warns after a deploy when another lab-orchestrator has no selector or
  the same selector.
- Proven: the manager in `cloudtrain-system` logged the attempt, `ct-exam-system`
  did not.

## Live proof: passed (2026-10-15)

`deploy/.results/exam-integration-proof.txt` (log) and
`deploy/.results/exams/gateway-live-smoke.json`. Setup: gateway on :8787 from main
(`CT_EXTRA_LAB_DIRS=services/lab-orchestrator/testdata/exams/tasks`,
`CT_EXTRA_EXAM_FILES=services/lab-orchestrator/testdata/exams/exams.yaml`, no
`CT_EXAM_SESSION_LABELS`), Keycloak :8180 local accounts, `task dev:orchestrator`
manager, kind `cloudtrain-dev`; run through `tools/slots/run.sh pod`.

`node services/gateway/scripts/exam-smoke.mjs` (now OIDC + CSRF via
`deploy/scripts/platform-login.mjs`; `--no-solve` keeps the untouched run), 32
checks passed:

| Step | Result |
|---|---|
| Auth | 401 without a session; Amara (learner, Quillmoor, local Keycloak) logged in; start without `x-csrf-token` refused 403 `csrf` |
| Start | attempt `exam-2dc04c2d63` 201 preparing; second start 409; in-progress after **49 s** (vcluster exam-core + exam-edge + workstation) |
| Terminal | WebSocket with the session cookie runs kubectl as the learner (both contexts); without a cookie HTTP 401 |
| Solve | task 2 "Feed a berth limit from a ConfigMap" solved in the exam terminal (8 s), task 2 flagged |
| Grade | submit 200; completed with report **6.4 s** later; score **51** (pass mark 66, not passed): deployment 40, config 100, networking 0; passes initial + rerun |
| After | terminal refused, history and catalog count the attempt; manager Tomasz sees it in Yard Platform readiness (51, not-ready); manager Ines (other team) 403; another learner 404; Acme Freight user 404 |
| Clean-up | ExamSession labelled managed-by=cloudtrain-gateway; environments released (no LabSessions left) 47 s after submit. The completed ExamSession, its ExamTemplate and the task LabTemplate were then deleted by hand; the attempt and report stay readable from Postgres |

Whole run 108 s. Not covered live: the secret task's solver branch (the config
task was drawn), retake grants and void (covered by test/exams-pg.test.ts).

## Left

1. Optional: regenerate `apps/web/docs/screenshots/exams` in all three themes
   (`node apps/web/scripts/exam-shots.mjs --base http://localhost:<port>`; it
   runs as the learner persona and switches to the manager for shot 12).
2. Per-exam runs (`labctl exam run --auto-solve` / `--no-solve`, then the gateway
   smoke with `--exam <id>`) as pool labs land; the smoke's solver only knows the
   sim-test-k8s-dev config/secret tasks, other exams run with `--no-solve`.
3. The dev Postgres volume is still v17 (see docs/handoff.md, Running state).

## Resume

```sh
task dev:deps            # needs the v17 -> 18 volume step first
task dev:orchestrator
CT_EXTRA_LAB_DIRS=services/lab-orchestrator/testdata/exams/tasks \
CT_EXTRA_EXAM_FILES=services/lab-orchestrator/testdata/exams/exams.yaml task dev:gateway
tools/slots/run.sh pod -- node services/gateway/scripts/exam-smoke.mjs --out /tmp/exam-smoke.json
```
