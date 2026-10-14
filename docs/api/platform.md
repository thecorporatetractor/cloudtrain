# Platform API (gateway)

Endpoint list for the platform contract in [`docs/platform-identity.md`](../platform-identity.md).
Types: [`packages/api-types/platform.d.ts`](../../packages/api-types/platform.d.ts)
(re-exported from `@cloudtrain/api-types`).

## Conventions

- Base path `/api`, JSON. Session cookie `ct_session` (`HttpOnly; Secure; SameSite=Lax`;
  `Secure` is dropped only on plain-http localhost in dev).
- **CSRF:** every `POST`/`PUT`/`PATCH`/`DELETE` under `/api` with a session
  (everything except the public `/api/auth/backchannel-logout`) needs header `x-csrf-token: <Me.csrfToken>`; a missing or wrong token is
  `403 { code: "csrf" }`.
- **Errors:** `ApiError` `{ error, code?, permission?, scope?, details? }`.
  `401 unauthenticated` (no/expired session), `403 forbidden` (with `permission` and
  `scope`), `404 not_found` (also for objects in another org: existence is not
  revealed), `409 conflict`, `422 invalid` (`details` = field -> message), `429
  quota_exceeded` (`details` = `QuotaExceededDetails`).
- **Paging:** `?cursor=&limit=` -> `Page<T>` `{ items, nextCursor, total? }`.
- **Scopes** in the permission column: `self` (own data), `team` (a team the caller
  manages, or any team with org scope), `cohort` (a cohort the caller instructs),
  `org` (whole active org), `platform` (platform_admin). `org_admin` satisfies every
  team/cohort scope in its org; `platform_admin` satisfies everything.
- Every mutating manager, instructor, admin and platform call writes an
  `audit_log` row (`AuditAction` in the last column).

## Auth and principal

| Method + path | Request | Response | Permission | Audit |
|---|---|---|---|---|
| `GET /auth/discover?email=` | | `AuthDiscovery` | public | |
| `GET /auth/login?email=&returnTo=&org=&idp=` | | 302 to Keycloak (PKCE; `kc_idp_hint` when the verified domain has an active SSO connection, or `idp=` names one, e.g. the SSO test link; `login_hint` otherwise) | public | |
| `GET /auth/callback?code=&state=` | | 302 to `<web>/<returnTo>` (sets `ct_session`); on refusal 302 to `<web>/login?error=<reason>&message=` (`sso_required`, `deactivated`, `no_membership`, `org_suspended`, `invalid_state`, `token_error`) | public | `auth.login` / `auth.login_denied` |
| `POST /auth/logout` | | `LogoutResponse` (Keycloak end-session URL) | signed in | `auth.logout` |
| `POST /auth/backchannel-logout` | form `logout_token` (Keycloak) | 200 | signed JWT from Keycloak | |
| `GET /auth/invite/:token` | | 302 to login with the invited email | public | |
| `GET /me` | | `Me` | signed in | |
| `POST /me/org` | `SwitchOrgRequest` | `Me` | membership in that org (or platform_admin) | `org.switch` |

## Learner

| Method + path | Request | Response | Permission |
|---|---|---|---|
| `GET /home` | | `HomeData` (+ `assignmentsDue`, `source`) | `progress.read.self` |
| `GET /catalog` | | `{ domains, paths, labs }`, filtered by content visibility | `lab.run` |
| `GET /labs/:id` | | `Lab` (404 when hidden for the org) | `lab.run` |
| `GET /skills[?member=]` | | `{ skills, states, frameworks, member? }` (`member` needs `progress.read.team` for that user) | `progress.read.self` |
| `POST /labs/:id/sessions` | | `201 LabSession`; `429` on quota | `lab.run` |
| `GET /sessions`, `GET /sessions/:id`, `DELETE /sessions/:id`, `POST /sessions/:id/validate`, `POST /sessions/:id/hints/:index` | | as before (`LabSession.notices` added) | `lab.run` (own sessions) |
| `GET /sessions/:id/terminal` (WebSocket) | | terminal frames + `{"t":"notice","notice":SessionNotice}` | `lab.run` (own session) |
| `GET /assignments/mine` | | `MyAssignment[]` | `progress.read.self` |
| `GET /attempts/mine?lab=&outcome=&from=&to=&cursor=&limit=` | `AttemptQuery` | `Page<Attempt>` | `progress.read.self` |
| `GET /attempts/:id` | | `AttemptDetail` | `progress.read.self` (own) or `progress.read.team` (team/cohort/org of the attempt's user) |

## Manager

| Method + path | Request | Response | Permission | Audit |
|---|---|---|---|---|
| `GET /teams` | | `Team[]` (teams the caller manages; all teams with org scope) | `progress.read.team` | |
| `GET /teams/:id/dashboard` | | `TeamDashboard` | `progress.read.team` @ team | |
| `GET /teams/:id/members/:userId` | | `MemberDetail` | `progress.read.team` @ team | |
| `GET /assignments?team=&user=&cohort=&state=` | `AssignmentQuery` | `Page<Assignment>` | `assignment.manage` @ team/cohort (filtered to what the caller covers) | |
| `GET /assignments/:id` | | `AssignmentDetail` | `assignment.manage` @ target | |
| `POST /assignments` | `CreateAssignmentRequest` | `201 CreateAssignmentResponse` | `assignment.manage` @ every target (user target: a team the caller manages contains the user) | `assignment.create` |
| `DELETE /assignments/:id` | | 204 | `assignment.manage` @ target | `assignment.delete` |
| `GET /reports/progress.csv?team=&from=&to=` | | `text/csv` (`ProgressCsvColumn`) | `report.export` @ team | `report.export` |

## Instructor

| Method + path | Request | Response | Permission | Audit |
|---|---|---|---|---|
| `GET /cohorts` | | `Cohort[]` (instructed; all with org scope) | `cohort.manage` or `progress.read.team` @ cohort | |
| `POST /cohorts` | `CreateCohortRequest` | `201 Cohort` | `cohort.manage` (instructor creates own cohorts) | `cohort.create` |
| `GET /cohorts/:id` | | `Cohort` | `progress.read.team` @ cohort | |
| `PATCH /cohorts/:id` | `UpdateCohortRequest` | `Cohort` | `cohort.manage` @ cohort | `cohort.update` |
| `POST /cohorts/:id/members` | `AddCohortMembersRequest` | `Cohort` | `cohort.manage` @ cohort | `cohort.member_add` |
| `DELETE /cohorts/:id/members/:userId` | | 204 | `cohort.manage` @ cohort | `cohort.member_remove` |
| `GET /cohorts/:id/board` | | `CohortBoard` | `progress.read.team` @ cohort | |
| `POST /cohorts/:id/broadcast` | `BroadcastRequest` | 204 | `session.control` @ cohort | `cohort.broadcast` |
| `POST /sessions/:id/extend` | `ExtendSessionRequest` | `SessionControlResponse` (`spec.expiresAt`) | `session.control` @ the learner's cohort / org | `session.extend` |
| `POST /sessions/:id/reset` | | `SessionControlResponse` (`spec.resetGeneration` + 1) | `session.control` | `session.reset` |
| `POST /sessions/:id/terminate` | | `SessionControlResponse` (LabSession deleted) | `session.control` | `session.terminate` |
| `GET /sessions/:id/terminal?observe=1` (WebSocket) | | read-only terminal (input dropped); the learner gets an `observed` notice | `session.observe` @ the learner's cohort / org | `session.observe` |

## Org admin

| Method + path | Request | Response | Permission | Audit |
|---|---|---|---|---|
| `GET /admin/overview` | | `AdminOverview` | `user.manage` | |
| `GET /admin/users` | `UserQuery` | `Page<OrgUser>` | `user.manage` | |
| `GET /admin/users/:id` | | `OrgUser` | `user.manage` | |
| `POST /admin/users` | `InviteUserRequest` | `201 InviteUserResponse` (email sent) | `user.manage` + `role.assign` | `user.invite` |
| `PATCH /admin/users/:id` | `UpdateUserRequest` | `UpdateUserResponse` | `user.manage` (+ `role.assign` for roles, `team.manage` for teams) | `user.update` / `user.deactivate` / `user.reactivate` |
| `GET /admin/invitations` | | `Invitation[]` | `user.manage` | |
| `DELETE /admin/invitations/:id` | | 204 | `user.manage` | `invitation.revoke` |
| `GET /admin/teams` | | `Team[]` | `team.manage` | |
| `POST /admin/teams` | `CreateTeamRequest` | `201 Team` | `team.manage` | `team.create` |
| `GET /admin/teams/:id` | | `TeamDetail` | `team.manage` | |
| `PATCH /admin/teams/:id` | `UpdateTeamRequest` | `Team` | `team.manage` | `team.update` |
| `DELETE /admin/teams/:id` | | 204 (409 while it has children) | `team.manage` | `team.delete` |
| `POST /admin/teams/:id/members` | `AddTeamMemberRequest` | `TeamDetail` | `team.manage` | `team.member_add` |
| `DELETE /admin/teams/:id/members/:userId` | | 204 | `team.manage` | `team.member_remove` |
| `GET /admin/sso` | | `SsoOverview` | `sso.manage` | |
| `POST /admin/sso` | `CreateSsoConnectionRequest` | `201 SsoConnection` (Keycloak IdP + org link created) | `sso.manage` | `sso.create` |
| `PATCH /admin/sso/:id` | `UpdateSsoConnectionRequest` | `SsoConnection` | `sso.manage` | `sso.update` |
| `DELETE /admin/sso/:id` | | 204 | `sso.manage` | `sso.delete` |
| `POST /admin/sso/:id/test` | | `SsoTestResult` | `sso.manage` | `sso.test` |
| `GET /admin/sso/domains` | | `OrgDomain[]` | `sso.manage` | |
| `POST /admin/sso/domains` | `AddDomainRequest` | `201 OrgDomain` | `sso.manage` | `domain.add` |
| `POST /admin/sso/domains/:domain/verify` | | `VerifyDomainResponse` (DNS TXT lookup; `CT_DEV_DOMAIN_VERIFY_BYPASS=1` accepts without DNS in dev) | `sso.manage` | `domain.verify` |
| `DELETE /admin/sso/domains/:domain` | | 204 | `sso.manage` | `domain.remove` |
| `GET /admin/content` | | `ContentVisibility` | `content.visibility` | |
| `PUT /admin/content` | `UpdateContentVisibilityRequest` | `ContentVisibility` | `content.visibility` | `content.visibility` |
| `GET /admin/sessions` | | `LiveSession[]` | `session.control` @ org | |
| `GET /admin/usage?from=&to=` | `TimeRange` | `Usage` | `quota.manage` | |
| `GET /admin/quotas` | | `Quotas` | `quota.manage` | |
| `PUT /admin/quotas` | `UpdateQuotasRequest` | `Quotas` | `quota.manage` | `quota.update` |
| `GET /admin/audit` | `AuditQuery` | `Page<AuditEvent>` | `audit.read` | |
| `GET /admin/audit.csv` | `AuditQuery` | `text/csv` | `audit.read` | `audit.export` |
| `GET /admin/settings` | | `OrgSettingsResponse` | `settings.manage` | |
| `PATCH /admin/settings` | `UpdateOrgSettingsRequest` | `OrgSettingsResponse` | `settings.manage` | `settings.update` |

Terminating a live session from the admin Sessions view uses `POST /sessions/:id/terminate`.

## Platform admin

| Method + path | Request | Response | Permission | Audit |
|---|---|---|---|---|
| `GET /platform/orgs` | | `PlatformOrg[]` | `org.manage` @ platform | |
| `POST /platform/orgs` | `CreatePlatformOrgRequest` | `201 PlatformOrg` | `org.manage` | `platform.org_create` |
| `GET /platform/orgs/:id` | | `PlatformOrg` | `org.manage` | |
| `PATCH /platform/orgs/:id` | `UpdatePlatformOrgRequest` | `PlatformOrg` | `org.manage` | `platform.org_update` |
| `POST /platform/orgs/:id/suspend` | | `PlatformOrg` (sessions of its users revoked) | `org.manage` | `platform.org_suspend` |
| `POST /platform/orgs/:id/reactivate` | | `PlatformOrg` | `org.manage` | `platform.org_reactivate` |
| `DELETE /platform/orgs/:id` | | 204 (409 unless suspended) | `org.manage` | `platform.org_delete` |
| `GET /platform/capacity` | | `Capacity` | `capacity.read` @ platform | |

Platform audit rows are written into the affected org's audit log.
