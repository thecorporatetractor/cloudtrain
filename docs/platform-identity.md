# Platform identity, roles and views

Contract for turning CloudTrain into a multi-tenant training platform: SSO, roles,
persistence, and the learner, manager, instructor, author, org-admin and
platform-admin experiences. Backend (`services/gateway` + Postgres + Keycloak)
and web (`apps/web`) build against this document and the types in
`packages/api-types/platform.d.ts`.

## Tenancy

- **Organization** (tenant): every row carries `org_id`; Postgres row-level
  security enforces it (`SET LOCAL app.org_id` per transaction, policies on every
  tenant table). A request can only ever see one org.
- A user belongs to one or more orgs (`memberships`); the active org is chosen at
  login (identity-first by email domain) and switchable in the user menu.
- **Platform** scope is outside any org (AzarGuard operators): orgs, capacity,
  global content packs. Only `platform_admin` reaches it.

## Roles and permissions

Roles are org-scoped and additive (a user can hold several). Team-scoped grants
(manager of team X) live on `team_members.role`.

| Role | Purpose |
|---|---|
| `learner` | Takes labs and paths, sees own progress and assignments. Everyone has it. |
| `manager` | Sees progress of the teams they manage; assigns labs/paths with deadlines; exports reports. Scope: teams where they are `team_members.role = manager`. |
| `instructor` | Runs cohorts/workshops: live board of learner sessions, read-only shadow terminal (audited), extend/reset sessions, broadcast hints. Scope: cohorts they instruct. |
| `author` | Scenario Studio: drafts, verification runs, publishes to pilot within org packs. |
| `org_admin` | Users, teams, roles, SSO connections, content visibility, quotas, live sessions, audit log, org settings. |
| `platform_admin` | Orgs, capacity, warm pools, global content, support access (audited, time-boxed). Not an org role. |

Permissions are strings checked by the gateway (`can(principal, perm, scope)`);
the web only hides UI, it never enforces.

| Permission | learner | manager | instructor | author | org_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `lab.run`, `progress.read.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `progress.read.team` | | team | cohort | | org |
| `assignment.manage` | | team | cohort | | org |
| `report.export` | | team | cohort | | org |
| `session.observe` (shadow terminal) | | | cohort | | org |
| `session.control` (extend/reset/terminate) | | | cohort | | org |
| `cohort.manage` | | | own | | org |
| `studio.author` | | | | ✓ | ✓ |
| `content.publish` (pilot/published in org) | | | | pilot | ✓ |
| `content.visibility` | | | | | ✓ |
| `user.manage`, `team.manage`, `role.assign` | | | | | ✓ |
| `sso.manage`, `settings.manage`, `quota.manage` | | | | | ✓ |
| `audit.read` | | | | | ✓ |

`platform_admin` holds every permission plus `org.manage`, `capacity.read`,
`support.access` at platform scope.

## SSO and authentication

- **Keycloak 26** is the identity broker: one realm `cloudtrain`, the
  **Organizations** feature (each CloudTrain org = a Keycloak organization with its
  verified email domains and its identity providers).
- **Login flow:** identity-first. The user types an email; the domain routes to the
  org's IdP (Entra ID, Okta, Google Workspace, any OIDC or SAML 2.0), or to local
  login (password + MFA/passkey) for orgs without SSO.
- **Self-service SSO:** `org_admin` adds an IdP connection in the admin UI (OIDC
  discovery URL + client, or SAML metadata), verifies the domain (DNS TXT), maps IdP
  groups to CloudTrain roles and teams, tests the connection, then enforces SSO
  (local passwords disabled for that domain). The gateway drives Keycloak's admin
  API; Keycloak is never exposed to org admins directly.
- **Provisioning:** just-in-time on first login (user + membership + mapped
  roles/teams), re-evaluated on every login. SCIM 2.0 (`/scim/v2`) is phase 2.
  Deprovisioning: deactivated in the IdP -> blocked at next login; org_admin can
  deactivate immediately (sessions revoked, running labs terminated).
- **Gateway = BFF:** OIDC authorization code + PKCE, confidential client; tokens
  never reach the browser. Server-side session (Postgres or Redis) behind an
  `HttpOnly; Secure; SameSite=Lax` cookie; CSRF token on state-changing requests;
  refresh handled server-side; RP-initiated and back-channel logout. The existing
  `Authenticator` interface gets an `OidcAuthenticator`; `DevAuthenticator` stays
  for tests only.
- **AzarGuard's own tenant (Entra ID):** Keycloak identity provider alias
  `azarguard-entra` (OIDC, v2.0 issuer), created from
  `~/.config/cloudtrain/entra-dev.env` (never committed). Entra app roles map to
  CloudTrain roles: `CloudTrain.Learner` -> `learner`, `CloudTrain.Manager` ->
  `manager`, `CloudTrain.Instructor` -> `instructor`, `CloudTrain.Author` ->
  `author`, `CloudTrain.OrgAdmin` -> `org_admin`, `CloudTrain.PlatformAdmin` ->
  `platform_admin`. Until the Entra app exists, the local `acme-idp` realm stands
  in with the same role values, so the mapping code is identical.
- **Service accounts / API tokens:** org-scoped personal access tokens for the
  reporting API (phase 2).

## Data model (Postgres 17, RLS on every tenant table)

| Table | Key columns |
|---|---|
| `orgs` | id, slug, name, status, settings jsonb, created_at |
| `org_domains` | org_id, domain, verified_at |
| `sso_connections` | org_id, kc_alias, type (oidc/saml), display_name, enforced, group_mappings jsonb, status |
| `users` | id (= Keycloak sub), email, name, title, avatar_url, last_login_at |
| `memberships` | org_id, user_id, roles text[], status (invited/active/deactivated), invited_by |
| `invitations` | org_id, email, roles, teams, token_hash, expires_at |
| `teams` | org_id, id, name, parent_id |
| `team_members` | org_id, team_id, user_id, role (member/manager) |
| `cohorts` | org_id, id, name, starts_at, ends_at, instructor_ids, path_id/lab_ids |
| `cohort_members` | org_id, cohort_id, user_id |
| `assignments` | org_id, id, target (team/user/cohort), item (lab/path/framework), due_at, assigned_by, required |
| `assignment_status` (view) | per user x assignment: not_started/in_progress/completed/overdue |
| `lab_attempts` | org_id, id, user_id, lab_id, lab_version, session_name, started_at, ended_at, outcome, score, hints_used, duration_s |
| `check_results` | org_id, attempt_id, check_id, passed, weight, skills text[], graded_at |
| `skill_evidence` | org_id, user_id, skill_id, attempt_id, outcome, difficulty, at |
| `learner_skill_state` | org_id, user_id, skill_id, mu, sigma, updated_at |
| `content_visibility` | org_id, pack_id/lab_id, enabled, pinned_paths |
| `quotas` | org_id, max_concurrent_sessions, monthly_lab_hours, max_session_minutes |
| `audit_log` | org_id, at, actor_id, action, target_type, target_id, ip, details jsonb (append-only) |

Grading results (`status.validation`) are persisted on every validate:
`lab_attempts` + `check_results` + `skill_evidence`, then `learner_skill_state` is
updated (Glicko-style: evidence weight from check weight and lab difficulty,
sigma shrinks with evidence and grows with time decay). Recommendations, mastery,
team heatmaps and readiness forecasts come from these tables instead of the sample
learner model.

## Views

**Learner:** Home (real recommendations + assignments due), Catalog, Lab, Workspace,
Skills, **My assignments**, **History** (attempts, scores, time), profile.

**Manager:** Team dashboard (real heatmap: members x competencies, framework
readiness, minutes), member drill-down (skills, attempts, assignments), **Assign**
(labs/paths/frameworks to team or people, due date, required), overdue and at-risk
list, CSV/XLSX export, team selector when managing several.

**Instructor:** Cohorts list, cohort live board (each learner's session: phase,
checks passed, time on task, hints, "stuck" signal), read-only shadow terminal
(banner shown to the learner, audit entry), extend/reset/terminate session,
broadcast message/hint.

**Author:** Scenario Studio (existing), drafts list, verification runs, publish to
pilot.

**Org admin (Admin area):** Overview (active users, running sessions, lab-hours vs
quota), **Users** (search, invite, roles, teams, deactivate, last login),
**Teams** (tree, managers), **SSO** (connections, domains, group mappings, test,
enforce), **Content** (enable/disable packs and labs, pin paths), **Sessions**
(live sessions across the org, terminate), **Usage & quotas**, **Audit log**
(filterable, export), **Settings** (org name, logo, default session length).

**Platform admin:** Orgs (create, suspend, quotas), capacity (cluster nodes,
warm pools, running VMs), global content packs, support access requests.

Navigation shows only what the principal's permissions allow; direct URLs to
forbidden views render a 403 page.

## API surface (gateway)

All under `/api`, JSON, cookie session, CSRF header on writes. Types in
`packages/api-types/platform.d.ts`.

- Auth: `GET /auth/login?email=&returnTo=`, `GET /auth/callback`, `POST /auth/logout`,
  `GET /me` (principal: user, active org, roles, permissions, teams, managed teams,
  cohorts), `POST /me/org` (switch org).
- Learner: `GET /assignments/mine`, `GET /attempts/mine`, existing lab/session routes.
- Manager: `GET /teams`, `GET /teams/:id/dashboard`, `GET /teams/:id/members/:userId`,
  `POST /assignments`, `GET /assignments?team=`, `DELETE /assignments/:id`,
  `GET /reports/progress.csv?team=&from=&to=`.
- Instructor: `GET /cohorts`, `POST /cohorts`, `GET /cohorts/:id/board`,
  `POST /sessions/:id/extend|reset|terminate`, terminal WebSocket with `?observe=1`.
- Admin: `/admin/overview`, `/admin/users` (GET, POST invite, PATCH roles/teams/status),
  `/admin/teams` (CRUD, members), `/admin/sso` (connections CRUD, `/test`,
  `/domains` + verify), `/admin/content` (visibility), `/admin/sessions`,
  `/admin/usage`, `/admin/quotas`, `/admin/audit` (+ `.csv`), `/admin/settings`.
- Platform: `/platform/orgs` (CRUD, suspend), `/platform/capacity`.

Every mutating admin, instructor or manager action writes an `audit_log` row.

## Local development

`deploy/dev/compose.yaml`: Postgres 17, Keycloak 26 (realm import with the
`cloudtrain` realm, organizations enabled, a second realm `acme-idp` acting as an
external corporate IdP to exercise federation), Mailpit for invitation emails.
Seed data: two orgs with fictional people covering every role, teams, a cohort,
assignments and attempt history. `task dev:deps` starts it; `task dev:gateway`
uses it. All names fictional.
