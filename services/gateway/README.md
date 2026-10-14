# gateway

Backend-for-frontend for `apps/web`. TypeScript, Node 22, Fastify. It serves the
paths and shapes the web app's mock API defines (`packages/api-types`, mirrored by
`apps/web/src/mocks/handlers.ts`), backed by the real content and the real lab
runtime:

| Area | Source |
|---|---|
| Catalog, labs, skills, frameworks | `content/` (`skills.yaml`, `frameworks/*.yaml`, `packs/*/pack.yaml` + `labs/*/lab.yaml`), read once at startup and validated with `@cloudtrain/lab-schema` |
| Sessions | `LabTemplate` + `LabSession` objects (`labs.cloudtrain.dev/v1alpha1`) in the cluster, reconciled by `services/lab-orchestrator` |
| Grading | the LabSession validation contract (`spec.validateRequest` / `status.validation`, see `docs/k8s-readiness.md`) |
| Terminal | WebSocket -> Kubernetes exec into the node's `k8s-exec` endpoint, with TTY and resize |
| Identity, orgs, roles, teams, cohorts, assignments, audit | Postgres 17 with row-level security per org (`src/db`), Keycloak 26 as the identity broker (`src/oidc`, `src/keycloak`) |
| Learner model (Home, mastery, skill states, dashboards) | persisted on every validate (`lab_attempts`, `check_results`, `skill_evidence`, `learner_skill_state`); `src/learner/model.ts`. Without a database (unit tests of the lab surface) the old sample model in `src/learner/sample.ts` is the fallback |
| Scenario Studio | **not served**; the web app keeps it in MSW |

The platform contract (tenancy, roles, permission matrix, SSO, data model) is
[`docs/platform-identity.md`](../../docs/platform-identity.md); every endpoint
with its types and permission is in [`docs/api/platform.md`](../../docs/api/platform.md).

## Run

```sh
task dev:deps           # Postgres + Keycloak + Mailpit (compose), migrate, seed if empty, sync Keycloak organizations
task dev:orchestrator   # CRDs if absent + local manager, scoped to CT_NAMESPACE (optional: only needed to run labs)
task dev:gateway        # builds labctl and lab-schema, creates CT_NAMESPACE, listens on 127.0.0.1:8787
task dev:web            # apps/web with VITE_API_MODE=real, proxied to the gateway
```

Sign in at `http://localhost:8787/api/auth/login?email=<address>` (or through
the web app). Dev accounts (fictional, password `CloudTrain-dev-only-1`, see
`deploy/dev/people.json`):

| Who | Org, login | Roles |
|---|---|---|
| `priya.raman@quillmoor.example` | Quillmoor Logistics, local Keycloak account | org_admin |
| `tomasz.wierzbicki@` / `ines.achterberg@quillmoor.example` | local | manager (Yard Platform / Dispatch SRE) |
| `elena.duarte@quillmoor.example` | local | instructor (Yard Ops Bootcamp cohort) |
| `kenji.morita@quillmoor.example` | local | author |
| `amara.nwosu@`, `lucas.ferreira@`, `sofia.lindqvist@`, `jonah.brandt@`, `mei.tanaka@quillmoor.example` | local | learner (with attempt history) |
| `rhea.castellanos@cloudtrain-ops.example` | local, no org | platform_admin |
| `olivia.hart@`, `marcus.bell@`, `nadia.okafor@`, `felix.moreau@acme-freight.example` | Acme Freight, brokered through the `acme-idp` realm (SSO enforced) | OrgAdmin, Manager (+ Linehaul lead group), Instructor, Author app roles |
| `hannah.vogel@`, `diego.salas@`, `ruth.adeyemi@`, `sam.kowalczyk@acme-freight.example` | brokered | learner (first three have seeded history, claimed on first login; Sam is provisioned just in time) |
| `ari.lindgren@acme-freight.example` | brokered | `CloudTrain.PlatformAdmin` only: platform_admin when `acme-idp` is in `CT_PLATFORM_IDPS` (dev default) |

`node deploy/scripts/platform-proof.mjs --log deploy/.results/platform-proof.log`
drives all of them through the real login flow and the main endpoints.

To also serve the container-only smoke lab (`test/fixtures/labs/gateway-smoke`,
the one lab the current orchestrator can run without the vm/k8s-cluster drivers):

```sh
CT_EXTRA_LAB_DIRS=services/gateway/test/fixtures/labs task dev:gateway
```

| Variable | Default | |
|---|---|---|
| `CT_HOST` / `CT_PORT` | `127.0.0.1` / `8787` | listen address |
| `CT_KUBE_CONTEXT` | `kind-cloudtrain-dev` | kubeconfig context, selected in memory only; the kubeconfig's current-context is never changed |
| `CT_NAMESPACE` | `cloudtrain-sessions` | namespace for LabTemplates and LabSessions (must exist) |
| `CT_CONTENT_DIR` | `content` | content root |
| `CT_EXTRA_LAB_DIRS` | | extra lab directories (`:`-separated), e.g. test fixtures |
| `CT_LABCTL` | `services/lab-orchestrator/bin/labctl` | Go compiler binary (`task gateway:labctl`) |
| `CT_VALIDATE_TIMEOUT_MS` | `60000` | how long `POST /validate` waits for the grader |
| `CT_SESSION_TTL_MINUTES` | controller default | sets `spec.ttl` on new sessions |
| `CT_LOG_LEVEL` | `info` | |
| `CT_DATABASE_URL` | `postgres://cloudtrain_app:app-dev-only@127.0.0.1:55432/cloudtrain` | app role: no superuser, no BYPASSRLS, not the table owner |
| `CT_DATABASE_OWNER_URL` | `postgres://cloudtrain_owner:owner-dev-only@…/cloudtrain` (dev only) | migrations and seed |
| `CT_PUBLIC_URL` | `http://localhost:8787` | where the browser reaches `/api` (OIDC redirect URI = `<this>/api/auth/callback`) |
| `CT_WEB_URL` | `CT_PUBLIC_URL` | where the web app lives (post-login/logout redirects); `http://localhost:5173` behind Vite, which must then proxy `/api` |
| `CT_KEYCLOAK_URL`, `CT_KEYCLOAK_REALM` | `http://localhost:8180`, `cloudtrain` | issuer = `<url>/realms/<realm>` unless `CT_OIDC_ISSUER` |
| `CT_OIDC_CLIENT_ID`, `CT_OIDC_CLIENT_SECRET` | `cloudtrain-gateway`, dev secret | confidential client, code + PKCE (required in production) |
| `CT_KEYCLOAK_ADMIN_CLIENT_ID`, `CT_KEYCLOAK_ADMIN_CLIENT_SECRET` | `cloudtrain-gateway-admin`, dev secret | service account for the Keycloak admin API (SSO connections, invitations, organizations) |
| `CT_SESSION_SECRET` | dev value | seals refresh tokens at rest (required in production) |
| `CT_SESSION_MAX_AGE_SECONDS`, `CT_SESSION_IDLE_SECONDS` | `43200`, `7200` | gateway session lifetime and idle timeout |
| `CT_COOKIE_SECURE` | `true` unless `CT_PUBLIC_URL` is `http://` | `Secure` attribute of `ct_session` |
| `CT_SMTP_HOST`, `CT_SMTP_PORT`, `CT_SMTP_FROM` | `127.0.0.1`, `1025` (Mailpit) | invitation email |
| `CT_PLATFORM_IDPS` | `azarguard-entra` (`task dev:gateway`: `azarguard-entra,acme-idp`) | IdP aliases whose `CloudTrain.PlatformAdmin` app role grants platform_admin |
| `CT_DEV_DOMAIN_VERIFY_BYPASS` | off (`task dev:gateway`: `1`) | accept domain verification without the DNS TXT record; ignored with `NODE_ENV=production` |
| `CT_SWEEP_INTERVAL_MS` | `60000` | closes attempts whose LabSession expired or vanished |

Relative paths are relative to the repository root.

## API

All under `/api`; errors are `ApiError` `{ "error": "...", "code"?, "permission"?, "scope"?, "details"? }`
with an HTTP status. Platform endpoints: [`docs/api/platform.md`](../../docs/api/platform.md).
Every route declares the permission it needs (`config.permission`) or is
`public`; registering an `/api` route without either is a startup error, and the
request hook answers 401 (no session), 403 `csrf` (state-changing request
without `x-csrf-token`) or 403 `forbidden` (permission not held in any scope).
Handlers then check the exact scope (`authorize(principal, permission, target)`
in `src/authz.ts`).

| Method + path | |
|---|---|
| `GET /health` | no auth; lab count and content issues |
| `GET /me` | `Me`: user, active org, memberships, roles, permissions + scoped grants, teams, cohorts, CSRF token |
| `GET /home` | real recommendations, goal forecast, activity, mastery and assignments due (`source: empty` before any history) |
| `GET /catalog` | domains, paths (pack courses + pack paths), lab summaries; filtered by the org's content visibility, pinned paths first, per-learner completion |
| `GET /labs/:id` | learner view of a lab (see below); 404 when hidden for the org |
| `GET /skills[?member=]` | real skill graph, frameworks and the learner's skill states (`member` needs `progress.read.team` over that person) |
| `POST /labs/:id/sessions` | quota check (429), compile (labctl) + create the LabTemplate if missing, create a LabSession with the org's session length -> `201 LabSession`; opens a `lab_attempts` row |
| `GET /labs/:id/sessions`, `GET /sessions` | the caller's sessions |
| `GET /sessions/:id` | maps `status.phase`, `nodes`, `endpoints`, `expiresAt`, `resolvedParams`, `validation` |
| `DELETE /sessions/:id` | deletes the LabSession (the orchestrator's finalizer tears down) -> `204` |
| `POST /sessions/:id/validate` | bumps `spec.validateRequest`, waits for `status.validation.observedRequest` to match with phase Complete/Failed -> `ValidateResponse` (per-check results with skills, score); `grading.state` is `timeout` when no grader answered, `failed` when grading broke; `409` unless the session is Ready. A complete grading is persisted (see "Learner model") |
| `POST /sessions/:id/hints/:index` | records the reveal in the `cloudtrain.dev/revealed-hints` annotation, returns the session with the hint content |
| `GET /sessions/:id/terminal?node=&cols=&rows=` | WebSocket terminal (below) |
| `GET /sessions/:id/terminal?observe=1` | read-only shadow of a learner's terminal for `session.observe` (cohort instructor, org admin); audited |

What leaves the gateway is the learner's view only: expected values, check
commands and queries, setup/teardown, solutions and misconceptions are never sent;
hint text is withheld until revealed; grader `output` (author-only) is dropped.
`{{params}}` stay in the lab text; the session carries `params` and the web app
fills them in.

Every session call checks `spec.learner.id` against the caller; another learner's
session is a 404.

### Terminal (and observe mode)

One WebSocket per console tab. With no `node` (or the entry node) the gateway
execs a login shell in the entry node's `k8s-exec` target (`namespace/pod/container`):
the jumphost image already runs as `learner`; an image running as root with a
`learner` account switches with `su - learner`. Any other topology node, or a
kubeadm cluster member, without its own exec endpoint is reached by running
`ssh <node>` in the entry pod (as the learner).

```
client -> gateway  text   {"t":"i","d":"<keystrokes>"}   {"t":"r","c":cols,"r":rows}
gateway -> client  binary terminal output
                   text   {"t":"ready","via":"..."}  {"t":"exit","code":n}  {"t":"error","m":"..."}
                   text   {"t":"notice","notice":SessionNotice}       (learner: someone started/stopped observing)
                   text   {"t":"observe","readOnly":true,"m":"..."}  (observer: attached)
```

Observe mode does not open a second shell: the learner's terminal bridges
publish their output to an in-process hub (`src/terminal/hub.ts`) and observers
get a copy plus the last 64 KiB of scrollback; observer input is dropped. Each
observation writes `session.observe` to the audit log and a `session_notices`
row the learner sees on the session (`LabSession.notices`) and as a live
`notice` frame. Shadowing works within one gateway replica (a multi-replica
deployment needs sticky routing by session or a shared pub/sub).

## Exam simulations

`src/exams/` serves `/api/exams/*` (types: `packages/api-types/exam.d.ts`) on
top of the orchestrator's `ExamTemplate`/`ExamSession`
(`services/lab-orchestrator`, "Exam simulations").

| Route | What |
|---|---|
| `GET /api/exams` | catalog: every curriculum exam (+ `CT_EXTRA_EXAM_FILES`), availability (each pool covers its draw with built labs), rules, retake policy and the caller's retake status |
| `GET /api/exams/:examId` | detail: objectives (normalised weights), pre-exam checklist, report contents, the caller's attempts |
| `POST /api/exams/:examId/attempts` | start (201): retake policy enforced (one running attempt; first + `freeRetakes` immediately, then `cooldownHours`; `maxAttemptsPer30Days`; attempts the platform failed to run never count); `labctl exam compile`, task LabTemplates + ExamTemplate created once, ExamSession `exam-<10 hex>` with `avoidTasks` = earlier tasks when `freshDraw` |
| `GET /api/exams/attempts/:id` | state: phase, server time, timer start and deadline, tasks (statements with params resolved, weights, contexts, flags), terminal targets while in progress; never checks, hints or solutions |
| `PUT /api/exams/attempts/:id/tasks/:index/flag` | `{flagged}` (in progress, rules.flagForReview) |
| `POST /api/exams/attempts/:id/submit` | `spec.submit` (the orchestrator freezes and grades) |
| `GET /api/exams/attempts/:id/report` | per objective, per task (pass/partial/fail, weight), per check (learner-safe message, failed after reboot / on re-run), skills, recommended labs |
| `GET /api/exams/attempts/mine?exam=` | the caller's attempts |
| `GET /api/exams/team-readiness?team=` | manager view: per exam and member, best/last score, readiness, weakest objective |
| `GET /api/exams/attempts/:id/terminal?target=` | WebSocket, same protocol as lab terminals; refused once the environment is frozen |
| `POST /api/exams/attempts/:id/void` | `{reason?}`: ends someone's running attempt (ExamSession deleted, not scored, not counted) |
| `POST /api/exams/:examId/retake-grants` | `{userId, reason?}` (201): one more attempt past the cooldown / 30-day cap |

Permissions (declared on every route, checked in scope by the service):
`lab.run` for the learner routes (own attempts only; someone else's attempt is
404), `progress.read.team` for team readiness (the team must be one the caller
may read: managed team, or any team for an org admin), `session.control` on
the candidate for void, `assignment.manage` on the candidate for retake grants.
Writes need the CSRF header like every other route. `exam.start`,
`exam.submit`, `exam.void` and `exam.retake_grant` are written to `audit_log`
in the same transaction as the change.

Persistence (`src/exams/pg.ts`, migration `0003_exams`): `PgExamStore`
(`exam_attempts`, `exam_task_results`, `exam_retake_grants`, RLS like every
tenant table; a unique index keeps one running attempt per person and exam, so
the curriculum retake policy holds under concurrent starts; the attempt row is
written before the ExamSession and marked failed, uncounted, if the cluster
refuses it), `PgEvidenceSink` (once per graded attempt: `recordRun` per task
with session `<attempt>/t<index>`, hints 0, then the lab attempt is closed) and
`PgTeamDirectory` (`teams`/`team_members`, people as authz targets with their
teams and cohorts). `MemoryExamStore` and `MemoryEvidenceSink` remain for unit
tests.

Settings: `CT_CURRICULUM_FILE` (default `content/curriculum.yaml`),
`CT_EXTRA_EXAM_FILES` (e.g.
`services/lab-orchestrator/testdata/exams/exams.yaml`, with
`CT_EXTRA_LAB_DIRS=services/lab-orchestrator/testdata/exams/tasks`),
`CT_EXAM_SESSION_LABELS` (`k=v,...`, e.g. a scoped manager's selector),
`CT_EXAM_DURATION_MINUTES` (demo override).

## Auth (BFF)

- **Login, identity-first:** `GET /api/auth/login?email=` looks the domain up
  (`auth_org_for_domain`): a verified domain with an active SSO connection goes
  straight to that IdP (`kc_idp_hint`), otherwise to Keycloak's own login
  (password, OTP, passkeys) with `login_hint`. Authorization code + PKCE (S256)
  with the confidential client `cloudtrain-gateway`; `state`, `nonce` and the
  verifier live in `auth_login_states` (15 minutes, single use).
- **Callback:** code exchange, ID-token verification (signature via JWKS,
  issuer, audience, nonce), then **JIT provisioning** (`src/platform/identity.ts`,
  every login): claim a pre-provisioned identity by email (`pending-…` rows
  from the seed or an SSO-domain invitation; only inside the org that owns the
  IdP/domain), upsert the user, map IdP app roles (`CloudTrain.Learner` ...
  `CloudTrain.OrgAdmin`, Entra style, via the `idp_roles` claim) and groups
  (`idp_groups`, through the connection's group mappings) to roles and teams,
  accept pending invitations, choose the active org. Refused: deactivated
  members, suspended orgs, local logins for an SSO-enforced domain, people with
  no membership. `CloudTrain.PlatformAdmin` counts only from IdPs listed in
  `CT_PLATFORM_IDPS`.
- **Session:** opaque random cookie `ct_session` (`HttpOnly; SameSite=Lax`;
  `Secure` unless the public URL is plain http), stored as a SHA-256 hash in
  `auth_sessions` with the Keycloak `sid`, the ID token (logout hint) and the
  refresh token sealed with AES-256-GCM. Tokens never reach the browser. Each
  session has a CSRF token (`Me.csrfToken`) required as `x-csrf-token` on
  POST/PUT/PATCH/DELETE. When the access token is past its expiry the gateway
  refreshes server-side; a refused refresh (user disabled or logged out at the
  IdP) ends the gateway session. The principal is rebuilt from the database on
  every request, so role changes and deactivation apply immediately.
- **Logout:** `POST /api/auth/logout` deletes the session and answers the
  Keycloak end-session URL; `POST /api/auth/backchannel-logout` accepts
  Keycloak's signed logout token and deletes the sessions with that `sid` (or
  `sub`). Keycloak calls it at `http://host.docker.internal:8787`, which reaches
  the gateway only when it listens on more than loopback (`CT_HOST=0.0.0.0`).
- **Org switch:** `POST /api/me/org` (memberships only; platform admins may
  enter any org, audited as support access).
- `DevAuthenticator` (one fixed principal) remains for unit tests and throws
  when `NODE_ENV=production`; `main.ts` always uses `OidcAuthenticator`.

## Authorization

`src/authz.ts` is the permission matrix of the contract as data (`MATRIX`) plus
`can(principal, permission, target)`: `self` scope matches the caller,
`team` the teams where the caller is a manager (`team_members.role = manager`
and the `manager` role), `cohort` the cohorts they instruct, `own` cohorts they
instruct or created, `pilot` publishing to pilot only, `org` everything in the
active org, `platform_admin` everything everywhere. Targets are a team, a
cohort, a person (with their teams and cohorts), the org or the platform.
`GET /api/me` returns the same grants for the UI.

## Data and tenancy

Postgres schema in `src/db/migrations` (Kysely migrator; `pnpm --filter
@cloudtrain/gateway db:migrate`), tables per the contract plus
`session_notices`, `auth_login_states` and `auth_sessions`. Every tenant table
has row-level security: the gateway connects as `cloudtrain_app` (not owner,
no BYPASSRLS) and runs each request in a transaction with `SET LOCAL
app.org_id / app.user_id` (`withTenant`); without `app.org_id` no tenant row is
visible. `app.platform = on` is set only on platform-admin code paths. Lookups
that precede org selection (domain/IdP routing, memberships, invitation links,
background sweeps) are narrow `SECURITY DEFINER` functions. `audit_log` is
append-only for the app role (SELECT + INSERT). `assignment_status` is a
`security_invoker` view.

## Learner model

`src/learner/model.ts` (formula in the file header), persisted by
`src/learner/learning.ts`:

```
prior            mu0 = 0.30, sigma0 = 0.35 (mu, sigma on a 0..1 mastery scale)
time decay       sigma_t^2 = min(0.45^2, sigma^2 + 0.0004 * days since last evidence)
difficulty       d = 0.30 easy | 0.50 medium | 0.70 hard
expected         E = 1 / (1 + exp(-5 (mu - d)))
weight           w = clamp(check weight, 0.25, 3) * (passed ? 0.75^hints : 1)
gain             K = sigma_t^2 / (sigma_t^2 + 0.05 / w)
update           mu' = clamp01(mu + K (o - E)),  sigma'^2 = max(0.04^2, (1 - K) sigma_t^2)
```

Each validate stores every check result (`check_results`, one row per check per
run) and, for checks that are new or changed since the previous run of the
attempt, one `skill_evidence` row per tagged skill and the updated
`learner_skill_state`. Home recommendations rank labs by expected gain, review
urgency (skills untouched for three weeks), goal alignment (assignments, the
target framework, pinned paths) and time, restricted to predicted success
0.6-0.8 when enough labs qualify and to satisfied prerequisites; each one
carries its reasons. Team heatmaps are competency means of practised skills;
framework readiness is the objective-weighted mean mastery. An attempt ends when
its session is deleted, terminated or found expired (sweeper): `passed` (all
checks passed at some point), `partial`, `failed` or `abandoned`.

## Layout

```
src/app.ts                 routes (HTTP + WebSocket), auth/CSRF/permission hook
src/auth.ts                Principal, Authenticator, dev stub (tests only)
src/authz.ts               permission matrix, can()/authorize()
src/db/                    Kysely schema, migrations, withTenant(), seed, CLI
src/oidc/                  OIDC client (code+PKCE, refresh, logout tokens), session store, OidcAuthenticator
src/keycloak/              Keycloak admin REST client, kc:sync (organizations, IdP links, optional Entra IdP)
src/platform/              identity/JIT, learner views, manager, cohorts/instructor, admin, SSO, platform, audit
src/routes/                auth and platform route tables
src/mail.ts                SMTP (Mailpit in dev)
src/content/               content loader, learner view of a lab
src/kube/                  LabCluster interface, client-node implementation, labctl compiler, CRD types
src/sessions/              SessionService, LabSession -> web mapping
src/terminal/              exec target planning, WebSocket <-> exec bridge
src/learner/               model.ts (math), learning.ts (persistence), home.ts (views), sample.ts (no-DB fallback)
src/terminal/hub.ts        read-only observer fan-out
test/                      vitest; FakeCluster plays the orchestrator, grader and pod
test/fixtures/labs/        container-only smoke lab (not catalog content)
```

LabTemplates are named `<lab>-v<version>-<digest>` so an edited lab never
collides with an immutable older template.

## Test

```sh
task dev:deps                                 # the DB suites need Postgres (CT_TEST_DATABASE_URL, default the compose one); they skip without it
pnpm --filter @cloudtrain/gateway test        # unit + HTTP + WebSocket against fakes; labctl tests run when the binary exists
pnpm --filter @cloudtrain/gateway typecheck
node deploy/scripts/platform-proof.mjs        # end-to-end against compose Keycloak + gateway (real logins)
node apps/web/scripts/smoke-real.mjs          # headless browser run of the real-mode flow (stack must be running)
```

| Suite | Covers |
|---|---|
| `rls.test.ts` | app role has no bypass, RLS on every tenant table, no rows without org, exact own-org visibility, cross-org INSERT/UPDATE/DELETE rejected, append-only audit, no setting leak across pooled transactions, definer lookups, platform mode |
| `authz.test.ts` | the permission matrix row by row, team/cohort/own/pilot scopes, platform-only permissions, 403 shape |
| `auth.test.ts` | the BFF flow against a fake OIDC provider (PKCE, cookie flags, CSRF, SSO routing and role/group mapping per login, identity claim, trusted platform IdPs, enforced SSO, state replay, refresh, logout and back-channel logout, org switch, open redirect) |
| `platform.test.ts` | validate persistence, assignment status, quotas, content visibility, dashboards and scopes, observe mode, deactivation, invitations, cross-org HTTP, platform orgs, audit coverage/paging/CSV |
| `model.test.ts` | learner model properties |
