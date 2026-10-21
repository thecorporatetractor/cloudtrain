/**
 * Platform API shapes: identity, tenancy, roles, assignments, cohorts, admin
 * and platform operations. Contract: docs/platform-identity.md; endpoint list
 * with the permission each one requires: docs/api/platform.md.
 *
 * Conventions
 * - Every path is under `/api`, JSON in and out, cookie session (`ct_session`,
 *   HttpOnly). State-changing requests (POST/PUT/PATCH/DELETE) carry the CSRF
 *   token from `Me.csrfToken` in the `x-csrf-token` header.
 * - Timestamps are ISO 8601 strings (UTC); dates without time are `YYYY-MM-DD`.
 * - Errors are `ApiError` with an HTTP status (401 unauthenticated, 403
 *   forbidden, 404 not found, 409 conflict, 422 invalid, 429 quota exceeded).
 * - Lists that can grow without bound use `Page<T>` with an opaque cursor.
 * - Additive changes only: new optional fields, new union members, new types.
 */

import type { Domain, FrameworkId, Learner, SessionPhase, SkillState } from './index.js';

/* ================================================================ roles */

/** Org-scoped roles (`memberships.roles`) plus the platform role. Additive: a user can hold several. */
export type Role = 'learner' | 'manager' | 'instructor' | 'author' | 'org_admin' | 'platform_admin';

/** Roles an org admin can grant inside an org (`platform_admin` is granted by the platform only). */
export type OrgRole = Exclude<Role, 'platform_admin'>;

/** Every permission the gateway checks with `can(principal, permission, scope)`. */
export type Permission =
  | 'lab.run'
  | 'progress.read.self'
  | 'progress.read.team'
  | 'assignment.manage'
  | 'report.export'
  | 'session.observe'
  | 'session.control'
  | 'cohort.manage'
  /** Create and run CTF events (org-wide), see the scoreboard live and export results. */
  | 'event.manage'
  | 'studio.author'
  | 'content.publish'
  | 'content.visibility'
  | 'user.manage'
  | 'team.manage'
  | 'role.assign'
  | 'sso.manage'
  | 'settings.manage'
  | 'quota.manage'
  | 'audit.read'
  /** The organisation's plan and billing: see entitlements, start checkout, open the customer portal, read billing events. */
  | 'billing.manage'
  | 'org.manage'
  | 'capacity.read'
  | 'support.access';

/**
 * Where a grant applies. `team`: teams the principal manages; `cohort`: cohorts
 * they instruct; `own`: objects they created (cohorts); `pilot`: publishing to
 * pilot only; `org`: the whole active org; `platform`: every org.
 */
export type PermissionScope = 'self' | 'team' | 'cohort' | 'own' | 'pilot' | 'org' | 'platform';

export interface PermissionGrant {
  permission: Permission;
  scope: PermissionScope;
  /** For `team` scope: the team ids the grant covers. */
  teamIds?: string[];
  /** For `cohort` scope: the cohort ids the grant covers. */
  cohortIds?: string[];
}

/* ================================================================ errors + paging */

export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'csrf'
  | 'quota_exceeded'
  /** 402: billing refuses a lab start (`details`: `BillingBlockDetails`). */
  | 'payment_required'
  | 'org_suspended'
  | 'deactivated'
  | 'upstream'
  /** 429: too many answers in a short time (`details.retryAfterSeconds`). */
  | 'rate_limited'
  /** 500: the lab itself cannot grade a question right now. */
  | 'lab_error';

/** Error body for every non-2xx answer. `error` is a human-readable sentence. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
  /** On 403: the permission that was missing. */
  permission?: Permission;
  /** On 403: the scope the request needed (e.g. `team:<id>`). */
  scope?: string;
  /** On 422: field -> message. On 429: the quota that was hit (`QuotaExceededDetails`). */
  details?: Record<string, unknown>;
}

export interface QuotaExceededDetails {
  quota: 'max_concurrent_sessions' | 'monthly_lab_hours' | 'max_session_minutes';
  limit: number;
  current: number;
}

/** Query parameters every paged list accepts. */
export interface PageQuery {
  /** Opaque cursor from a previous `Page.nextCursor`. */
  cursor?: string;
  /** Page size, default 50, max 200. */
  limit?: number;
}

export interface Page<T> {
  items: T[];
  /** Null on the last page. */
  nextCursor: string | null;
  /** Total matching rows when cheap to compute. */
  total?: number;
}

/** Inclusive time window filter (`from`/`to` as ISO dates or timestamps). */
export interface TimeRange {
  from?: string;
  to?: string;
}

/* ================================================================ references */

export interface UserRef {
  id: string;
  name: string;
  email: string;
  title?: string;
  avatarUrl?: string;
}

export interface OrgRef {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string;
}

export interface TeamRef {
  id: string;
  name: string;
}

export interface CohortRef {
  id: string;
  name: string;
}

/* ================================================================ auth + me */

/** `GET /auth/discover?email=`: where identity-first login will send this email. */
export interface AuthDiscovery {
  email: string;
  /** `sso`: the org's IdP; `local`: Keycloak password (+ MFA/passkey); `unknown`: no org claims the domain. */
  method: 'sso' | 'local' | 'unknown';
  org?: OrgRef;
  /** Keycloak identity provider alias (`kc_idp_hint`) when method is `sso`. */
  idpAlias?: string;
  idpDisplayName?: string;
  /** Where the browser goes next (`GET /auth/login?email=...`). */
  loginUrl: string;
}

/** `POST /auth/logout` -> where to send the browser (Keycloak end-session, then back to the app). */
export interface LogoutResponse {
  redirectUrl: string;
}

export type TeamRole = 'member' | 'manager';

/** One org the user belongs to (org switcher). */
export interface MembershipSummary {
  org: OrgRef;
  roles: OrgRole[];
  status: MembershipStatus;
}

/**
 * `GET /me`: the principal. Extends the legacy `Learner` (id, name, email,
 * role, team, org name, streak, minutes) so pre-platform callers keep working.
 */
export interface Me extends Learner {
  user: UserRef & { lastLoginAt?: string };
  /** Active org. Null only for a platform admin without any membership. */
  activeOrg: OrgRef | null;
  /** All orgs the user can switch to (`POST /me/org`). */
  memberships: MembershipSummary[];
  /** Roles in the active org, plus `platform_admin` when held. */
  roles: Role[];
  /** Every permission held in any scope (UI hint only; the gateway enforces). */
  permissions: Permission[];
  /** The same permissions with their scopes. */
  grants: PermissionGrant[];
  /** Teams the user is a member of (any team role). */
  teams: (TeamRef & { role: TeamRole })[];
  /** Teams the user manages (`progress.read.team` / `assignment.manage` scope). */
  managedTeams: TeamRef[];
  /** Cohorts the user instructs. */
  instructedCohorts: CohortRef[];
  /** Cohorts the user is enrolled in as a learner. */
  cohorts: CohortRef[];
  platformAdmin: boolean;
  /** Send as `x-csrf-token` on every state-changing request. */
  csrfToken: string;
  /**
   * How this session was established. `dev-impersonation` + `impersonated: true`:
   * a local-dev "sign in as" session (`POST /api/dev/sign-in-as`, CT_DEV_IMPERSONATE=1),
   * no IdP login behind it; the web app shows a banner.
   */
  auth: { method: 'oidc' | 'dev' | 'dev-impersonation'; idp?: string; sessionExpiresAt?: string; impersonated?: boolean };
  /** True while a platform admin acts inside an org through support access. */
  supportAccess?: { orgId: string; expiresAt: string };
}

/**
 * `GET /me/goals` / `PUT /me/goals`: the learner's own study goals in the
 * active org. Null = not set (Home falls back to an assigned due date or a
 * placeholder). The Home goal card reads these through `GoalForecast`.
 */
export interface LearnerGoals {
  /** Exam date, YYYY-MM-DD. */
  targetDate: string | null;
  /** Weekly practice target in minutes. */
  weeklyTargetMinutes: number | null;
  updatedAt: string | null;
}

/** `PUT /me/goals`: fields left out stay as they are, null clears. */
export interface UpdateLearnerGoalsRequest {
  targetDate?: string | null;
  weeklyTargetMinutes?: number | null;
  /**
   * `browser`: a one-time import of goals the web app kept in localStorage
   * before goals were stored on the server. Applied only to fields that are
   * not set yet, so it never overwrites a goal set elsewhere.
   */
  source?: 'browser';
}

/** `POST /me/org`. Answers the new `Me`. */
export interface SwitchOrgRequest {
  orgId: string;
}

/* ================================================================ orgs */

export type OrgStatus = 'active' | 'suspended';

export interface OrgSettings {
  /** Default lab session length in minutes (capped by `Quotas.maxSessionMinutes`). */
  defaultSessionMinutes: number;
  logoUrl?: string;
  /** Hex colour for the org's accent in the UI. */
  accentColor?: string;
  /** Allow Keycloak password logins for domains without an enforced SSO connection. */
  allowLocalLogin: boolean;
  /** Timezone for reports and due dates (IANA). */
  timezone: string;
}

export interface Org extends OrgRef {
  status: OrgStatus;
  settings: OrgSettings;
  createdAt: string;
  domains: OrgDomain[];
}

/** `GET /admin/settings`. */
export interface OrgSettingsResponse {
  org: Org;
}

/** `PATCH /admin/settings`. */
export interface UpdateOrgSettingsRequest {
  name?: string;
  settings?: Partial<OrgSettings>;
}

/* ================================================================ users + memberships */

export type MembershipStatus = 'invited' | 'active' | 'deactivated';

/** A user as seen inside one org (admin Users list). */
export interface OrgUser extends UserRef {
  roles: OrgRole[];
  status: MembershipStatus;
  teams: (TeamRef & { role: TeamRole })[];
  cohorts: CohortRef[];
  lastLoginAt?: string;
  invitedBy?: UserRef;
  joinedAt: string;
  /** How the membership came to be. */
  source: 'sso' | 'local' | 'invite' | 'seed';
  /** Keycloak IdP alias the user last signed in through. */
  idp?: string;
}

/** `GET /admin/users` filters (plus `PageQuery`). */
export interface UserQuery extends PageQuery {
  /** Matches name or email. */
  q?: string;
  role?: OrgRole;
  team?: string;
  status?: MembershipStatus;
}

/** `POST /admin/users`: invite someone (email lands in their inbox; dev: Mailpit). */
export interface InviteUserRequest {
  email: string;
  name?: string;
  roles: OrgRole[];
  teams?: { teamId: string; role: TeamRole }[];
  /** Days until the invitation expires (default 7, max 30). */
  expiresInDays?: number;
}

export interface Invitation {
  id: string;
  email: string;
  roles: OrgRole[];
  teams: { teamId: string; role: TeamRole }[];
  invitedBy: UserRef;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

/** `POST /admin/users` answer. */
export interface InviteUserResponse {
  invitation: Invitation;
  /** The membership row created in `invited` state. */
  user: OrgUser;
  emailSent: boolean;
}

/**
 * `PATCH /admin/users/:id`. `teams` replaces the user's team memberships.
 * `status: 'deactivated'` revokes every gateway session of the user in this org
 * and terminates their running labs immediately.
 */
export interface UpdateUserRequest {
  roles?: OrgRole[];
  teams?: { teamId: string; role: TeamRole }[];
  status?: 'active' | 'deactivated';
  title?: string;
}

export interface UpdateUserResponse {
  user: OrgUser;
  /** Present when the user was deactivated. */
  revokedSessions?: number;
  terminatedLabs?: number;
}

/* ================================================================ teams */

export interface Team extends TeamRef {
  parentId: string | null;
  memberCount: number;
  managers: UserRef[];
  createdAt: string;
}

export interface TeamMember {
  user: UserRef;
  role: TeamRole;
}

/** `GET /admin/teams/:id`. */
export interface TeamDetail extends Team {
  members: TeamMember[];
  children: TeamRef[];
}

export interface CreateTeamRequest {
  name: string;
  parentId?: string | null;
}

export interface UpdateTeamRequest {
  name?: string;
  parentId?: string | null;
}

/** `POST /admin/teams/:id/members` (adds or changes the role). */
export interface AddTeamMemberRequest {
  userId: string;
  role: TeamRole;
}

/* ================================================================ assignments */

export type AssignmentTargetKind = 'team' | 'user' | 'cohort';
export type AssignmentItemKind = 'lab' | 'path' | 'framework';
export type AssignmentState = 'not_started' | 'in_progress' | 'completed' | 'overdue';

export interface AssignmentTarget {
  kind: AssignmentTargetKind;
  id: string;
  /** Resolved display name (team/user/cohort). */
  name?: string;
}

export interface AssignmentItem {
  kind: AssignmentItemKind;
  /** Lab id, path id or framework id. */
  id: string;
  title?: string;
  /** Labs that make up the item (a path's labs, a framework's labs). */
  labIds?: string[];
}

/** An assignment as its manager sees it, with per-state counts over the people it covers. */
export interface Assignment {
  id: string;
  target: AssignmentTarget;
  item: AssignmentItem;
  dueAt: string | null;
  required: boolean;
  note?: string;
  assignedBy: UserRef;
  createdAt: string;
  counts: Record<AssignmentState, number>;
}

/** Per user x assignment (the `assignment_status` view). */
export interface AssignmentStatusRow {
  assignmentId: string;
  user: UserRef;
  status: AssignmentState;
  /** 0..1: share of the item's labs passed. */
  progress: number;
  completedAt?: string;
  bestScore?: number;
}

/** `GET /assignments/:id`. */
export interface AssignmentDetail {
  assignment: Assignment;
  statuses: AssignmentStatusRow[];
}

/** `GET /assignments` filters (manager). */
export interface AssignmentQuery extends PageQuery {
  team?: string;
  user?: string;
  cohort?: string;
  state?: AssignmentState;
}

/** `POST /assignments`: one assignment per target. */
export interface CreateAssignmentRequest {
  targets: { kind: AssignmentTargetKind; id: string }[];
  item: { kind: AssignmentItemKind; id: string };
  dueAt?: string | null;
  required?: boolean;
  note?: string;
}

export interface CreateAssignmentResponse {
  assignments: Assignment[];
}

/** `GET /assignments/mine`: the learner's own assignments. */
export interface MyAssignment {
  id: string;
  item: AssignmentItem;
  /** Through which target the learner is covered. */
  via: AssignmentTarget;
  dueAt: string | null;
  required: boolean;
  note?: string;
  assignedBy: UserRef;
  createdAt: string;
  status: AssignmentState;
  progress: number;
  completedAt?: string;
  bestScore?: number;
}

/* ================================================================ attempts */

export type AttemptOutcome = 'in_progress' | 'passed' | 'partial' | 'failed' | 'abandoned';

/** One graded check as persisted (`check_results`); one row per check per validate run. */
export interface CheckResultRecord {
  checkId: string;
  passed: boolean;
  weight: number;
  skills: string[];
  /** Validate run number within the attempt (1 = first `POST /validate`). */
  run: number;
  gradedAt: string;
  message?: string;
}

/** A lab attempt (one LabSession) as persisted in `lab_attempts`. */
export interface Attempt {
  id: string;
  labId: string;
  labTitle: string;
  labVersion: number;
  sessionName: string;
  startedAt: string;
  endedAt: string | null;
  outcome: AttemptOutcome;
  /** Best weighted score over the attempt's validate runs, 0-100. */
  score: number;
  hintsUsed: number;
  validations: number;
  /** Environment time (session open to close): what quotas bill. */
  durationS: number;
  /**
   * Practice time: start of the attempt to its last Validate, 0 when no
   * Validate ran. The learner's own pages, manager views and reports count
   * this, so both sides see the same minutes.
   */
  practiceS: number;
  checksPassed: number;
  checksTotal: number;
  /** CTF labs: points and questions of this attempt (questions answered in the lab view). */
  points?: { earned: number; possible: number; solved: number; total: number };
}

/** `GET /attempts/:id`: the attempt with the full per-run check history. */
export interface AttemptDetail extends Attempt {
  user: UserRef;
  /** Latest result of each check. */
  checks: CheckResultRecord[];
  /** Every graded check of every run, oldest first. */
  history: CheckResultRecord[];
}

/** `GET /attempts/mine` filters. */
export interface AttemptQuery extends PageQuery, TimeRange {
  lab?: string;
  outcome?: AttemptOutcome;
}

/* ================================================================ manager views */

export interface CompetencyRef {
  id: string;
  name: string;
  domain: Domain;
}

/** One cell value: mastery 0..1, or null when the member has no evidence. */
export type MasteryCell = number | null;

export interface DashboardMember {
  user: UserRef;
  role: TeamRole;
  /** Competency id -> mastery (mean mu of practised skills). */
  mastery: Record<string, MasteryCell>;
  /** Framework id -> readiness 0..1. */
  readiness: Partial<Record<FrameworkId, number>>;
  /** Practice minutes (graded time, see `Attempt.practiceS`) in attempts started this calendar month (UTC). */
  minutesThisMonth: number;
  /** Practice minutes in the last 7 days: the number on the learner's own Home. */
  minutesThisWeek: number;
  attemptsThisMonth: number;
  lastActiveAt?: string;
  assignments: { total: number; completed: number; overdue: number; inProgress: number };
  /** Overdue required work, or a due date within 3 days with no progress. */
  atRisk: boolean;
}

export interface AtRiskItem {
  user: UserRef;
  assignmentId: string;
  item: AssignmentItem;
  dueAt: string | null;
  status: AssignmentState;
  reason: 'overdue' | 'due_soon_not_started' | 'stalled';
}

/** `GET /teams/:id/dashboard`. */
export interface TeamDashboard {
  team: Team;
  /** Every team the caller may view (team selector). */
  teams: TeamRef[];
  competencies: CompetencyRef[];
  members: DashboardMember[];
  /** Team-average readiness per framework. */
  frameworks: { frameworkId: FrameworkId; name: string; readiness: number; ready: number; members: number }[];
  /** Practice minutes per ISO week (graded time), oldest first (last 8 weeks). */
  minutesByWeek: { weekStart: string; minutes: number }[];
  /** `activeThisWeek`: members with graded practice in the last 7 days. */
  totals: { members: number; activeThisWeek: number; minutesThisMonth: number; assignmentsOverdue: number; completionRate: number };
  atRisk: AtRiskItem[];
  /** `empty` when nobody in the team has any history yet (the UI shows an empty state). */
  source: 'live' | 'empty';
  generatedAt: string;
}

/** `GET /teams/:id/members/:userId`. */
export interface MemberDetail {
  user: UserRef & { lastLoginAt?: string };
  team: TeamRef;
  role: TeamRole;
  skills: SkillState[];
  mastery: Record<string, MasteryCell>;
  readiness: Partial<Record<FrameworkId, number>>;
  attempts: Attempt[];
  assignments: MyAssignment[];
  /** Practice minutes this calendar month (UTC), as on the team dashboard. */
  minutesThisMonth: number;
  /** Practice minutes in the last 7 days, as on the learner's own Home. */
  minutesThisWeek: number;
}

/** `GET /reports/progress.csv?team=&from=&to=`: text/csv with these columns. */
export type ProgressCsvColumn =
  | 'user_id'
  | 'name'
  | 'email'
  | 'team'
  | 'assignment_id'
  | 'item_kind'
  | 'item_id'
  | 'due_at'
  | 'status'
  | 'progress'
  | 'best_score'
  | 'attempts'
  /** Practice minutes (graded time) in the range; what the learner sees. */
  | 'minutes'
  /** Environment minutes (session lifetime) in the range; what quotas bill. */
  | 'environment_minutes';

/* ================================================================ cohorts + instructor */

export type CohortStatus = 'upcoming' | 'live' | 'ended';

export interface Cohort extends CohortRef {
  startsAt: string;
  endsAt: string;
  status: CohortStatus;
  instructors: UserRef[];
  memberCount: number;
  pathId?: string;
  labIds: string[];
  createdBy?: UserRef;
}

export interface CreateCohortRequest {
  name: string;
  startsAt: string;
  endsAt: string;
  /** Defaults to the caller. */
  instructorIds?: string[];
  memberIds?: string[];
  pathId?: string;
  labIds?: string[];
}

export type UpdateCohortRequest = Partial<CreateCohortRequest>;

/** `POST /cohorts/:id/members`. */
export interface AddCohortMembersRequest {
  userIds: string[];
}

/** A learner's live session as the instructor board shows it. */
export interface BoardSession {
  id: string;
  labId: string;
  labTitle: string;
  phase: SessionPhase;
  startedAt: string;
  expiresAt?: string;
  checksPassed: number;
  checksTotal: number;
  score: number;
  hintsUsed: number;
  validations: number;
  /** Minutes since the live session started (environment time, for the live board; not practice minutes). */
  minutesOnTask: number;
  /** No new passing check for a while, repeated failing validates, or many hints. */
  stuck: boolean;
  stuckReason?: string;
  observedBy: UserRef[];
}

export interface CohortBoardRow {
  user: UserRef;
  session: BoardSession | null;
  lastAttempt?: Attempt;
  /** Over the cohort's labs. */
  progress: { labsPassed: number; labsTotal: number };
}

/** `GET /cohorts/:id/board`. */
export interface CohortBoard {
  cohort: Cohort;
  rows: CohortBoardRow[];
  generatedAt: string;
}

/** `POST /cohorts/:id/broadcast`. */
export interface BroadcastRequest {
  message: string;
  /** `hint` renders as a hint card, `info` as a banner. */
  kind?: 'info' | 'hint';
}

/** `POST /sessions/:id/extend`. */
export interface ExtendSessionRequest {
  /** Minutes to add to the current expiry (1..240). */
  minutes: number;
}

/** Answer of `POST /sessions/:id/extend|reset|terminate`. */
export interface SessionControlResponse {
  sessionId: string;
  action: 'extend' | 'reset' | 'terminate';
  expiresAt?: string;
  resetGeneration?: number;
}

/**
 * Shown to a learner whose session is observed or who got a cohort broadcast.
 * Carried on `LabSession.notices` and pushed on the terminal WebSocket as
 * `{"t":"notice","notice":SessionNotice}`.
 */
export interface SessionNotice {
  id: string;
  kind: 'observed' | 'broadcast' | 'hint' | 'extended' | 'reset' | 'terminated';
  at: string;
  from?: UserRef;
  message: string;
  /** For `observed`: still watching. */
  active?: boolean;
}

/* ================================================================ SSO */

export type SsoType = 'oidc' | 'saml';
export type SsoStatus = 'draft' | 'active' | 'error' | 'disabled';

/** IdP group (or app-role value) -> CloudTrain roles and teams, applied on every login. */
export interface SsoGroupMapping {
  /** Group name/id or role claim value, e.g. `CloudTrain.Manager`. */
  group: string;
  roles: OrgRole[];
  teams: { teamId: string; role: TeamRole }[];
}

export interface OidcSettings {
  /** `.../.well-known/openid-configuration`. */
  discoveryUrl: string;
  clientId: string;
  /** Write-only; reads say whether one is set. */
  hasClientSecret: boolean;
  scopes: string[];
  /** Claim carrying roles/groups (default `roles`, Entra app roles). */
  roleClaim: string;
}

export interface SamlSettings {
  metadataUrl?: string;
  entityId?: string;
  /** SAML attribute carrying groups. */
  groupAttribute: string;
}

export interface SsoConnection {
  id: string;
  /** Keycloak identity provider alias (`kc_idp_hint`). */
  alias: string;
  type: SsoType;
  displayName: string;
  status: SsoStatus;
  /** Local passwords disabled for the org's verified domains. */
  enforced: boolean;
  oidc?: OidcSettings;
  saml?: SamlSettings;
  groupMappings: SsoGroupMapping[];
  /** Roles every user from this IdP gets (default `['learner']`). */
  defaultRoles: OrgRole[];
  createdAt: string;
  updatedAt: string;
  lastTest?: SsoTestResult;
}

export interface CreateSsoConnectionRequest {
  type: SsoType;
  displayName: string;
  /** Defaults to `<org slug>-<type>`. */
  alias?: string;
  oidc?: { discoveryUrl: string; clientId: string; clientSecret: string; scopes?: string[]; roleClaim?: string };
  saml?: { metadataUrl?: string; metadataXml?: string; groupAttribute?: string };
  groupMappings?: SsoGroupMapping[];
  defaultRoles?: OrgRole[];
}

export interface UpdateSsoConnectionRequest {
  displayName?: string;
  oidc?: Partial<{ discoveryUrl: string; clientId: string; clientSecret: string; scopes: string[]; roleClaim: string }>;
  saml?: Partial<{ metadataUrl: string; metadataXml: string; groupAttribute: string }>;
  groupMappings?: SsoGroupMapping[];
  defaultRoles?: OrgRole[];
  /** Enforcing requires status `active` and at least one verified domain. */
  enforced?: boolean;
  status?: 'active' | 'disabled';
}

/** `POST /admin/sso/:id/test`. */
export interface SsoTestResult {
  ok: boolean;
  checkedAt: string;
  steps: { name: string; ok: boolean; detail?: string }[];
  /** Open in a new tab to try a real login through this IdP. */
  loginUrl?: string;
}

export interface OrgDomain {
  domain: string;
  verified: boolean;
  verifiedAt?: string;
  /** Publish this TXT record, then `POST /admin/sso/domains/:domain/verify`. */
  verification: { type: 'TXT'; name: string; value: string };
}

/** `GET /admin/sso`. */
export interface SsoOverview {
  connections: SsoConnection[];
  domains: OrgDomain[];
}

export interface AddDomainRequest {
  domain: string;
}

export interface VerifyDomainResponse {
  domain: OrgDomain;
  ok: boolean;
  detail?: string;
}

/* ================================================================ content visibility */

export interface ContentVisibilityLab {
  labId: string;
  title: string;
  enabled: boolean;
}

export interface ContentVisibilityPack {
  packId: string;
  title: string;
  domain: Domain;
  enabled: boolean;
  labs: ContentVisibilityLab[];
}

/** `GET /admin/content`. Disabled packs/labs disappear from the org's catalog and cannot be started. */
export interface ContentVisibility {
  packs: ContentVisibilityPack[];
  /** Path ids pinned to the top of the catalog and Home. */
  pinnedPaths: string[];
  paths: { id: string; title: string }[];
}

/** `PUT /admin/content`. Only the listed packs/labs change. */
export interface UpdateContentVisibilityRequest {
  packs?: { packId: string; enabled: boolean }[];
  labs?: { labId: string; enabled: boolean }[];
  pinnedPaths?: string[];
}

/* ================================================================ quotas + usage */

export interface Quotas {
  maxConcurrentSessions: number;
  monthlyLabHours: number;
  maxSessionMinutes: number;
}

export type UpdateQuotasRequest = Partial<Quotas>;

/** `GET /admin/usage?from=&to=`. */
export interface Usage {
  from: string;
  to: string;
  quotas: Quotas;
  labHours: number;
  /** Lab hours in the current calendar month (what `monthlyLabHours` is checked against). */
  labHoursThisMonth: number;
  sessions: number;
  activeUsers: number;
  concurrentNow: number;
  byDay: { date: string; labHours: number; sessions: number }[];
  byLab: { labId: string; title: string; sessions: number; labHours: number }[];
  byTeam: { teamId: string; name: string; labHours: number }[];
}

/* ================================================================ admin: overview + live sessions */

/** `GET /admin/sessions`: live sessions across the org. */
export interface LiveSession {
  id: string;
  user: UserRef;
  labId: string;
  labTitle: string;
  phase: SessionPhase;
  startedAt: string;
  expiresAt?: string;
  score: number;
  checksPassed: number;
  checksTotal: number;
  observedBy: UserRef[];
}

/** `GET /admin/overview`. */
export interface AdminOverview {
  org: Org;
  users: { active: number; invited: number; deactivated: number; activeLast7d: number };
  teams: number;
  runningSessions: number;
  quotas: Quotas;
  labHoursThisMonth: number;
  ssoConnections: number;
  recentAudit: AuditEvent[];
}

/* ================================================================ audit */

/** Dotted `<area>.<verb>` action names; new values may appear. */
export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_denied'
  | 'auth.dev_impersonate'
  | 'org.switch'
  | 'user.invite'
  | 'user.update'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'invitation.revoke'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'team.member_add'
  | 'team.member_remove'
  | 'assignment.create'
  | 'assignment.delete'
  | 'report.export'
  | 'exam.start'
  | 'exam.submit'
  | 'exam.void'
  | 'exam.retake_grant'
  | 'answer.submit'
  | 'answer.hint'
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'event.join'
  | 'event.leave'
  | 'event.team_create'
  | 'event.team_members'
  | 'event.team_delete'
  | 'event.export'
  | 'cohort.create'
  | 'cohort.update'
  | 'cohort.member_add'
  | 'cohort.member_remove'
  | 'cohort.broadcast'
  | 'session.observe'
  | 'session.extend'
  | 'session.reset'
  | 'session.terminate'
  | 'sso.create'
  | 'sso.update'
  | 'sso.delete'
  | 'sso.test'
  | 'domain.add'
  | 'domain.verify'
  | 'domain.remove'
  | 'content.visibility'
  | 'quota.update'
  | 'settings.update'
  | 'audit.export'
  | 'platform.org_create'
  | 'platform.org_update'
  | 'platform.org_suspend'
  | 'platform.org_reactivate'
  | 'platform.org_delete'
  | 'billing.checkout'
  | 'billing.portal'
  | 'billing.subscription'
  | 'billing.webhook'
  | 'billing.payment_method'
  | 'billing.seats'
  | 'billing.seat_assign'
  | 'billing.seat_unassign'
  | 'billing.limit'
  | 'billing.dunning'
  | (string & {});

export interface AuditEvent {
  id: string;
  at: string;
  /** Null for system actions. */
  actor: UserRef | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  ip?: string;
  details: Record<string, unknown>;
}

/** `GET /admin/audit` (and `.csv`) filters. */
export interface AuditQuery extends PageQuery, TimeRange {
  actor?: string;
  /** Exact action or a prefix ending in `.` (e.g. `session.`). */
  action?: string;
  targetType?: string;
  targetId?: string;
}

/* ================================================================ platform */

export interface PlatformOrg extends OrgRef {
  status: OrgStatus;
  createdAt: string;
  quotas: Quotas;
  domains: string[];
  users: number;
  activeUsers30d: number;
  runningSessions: number;
  labHoursThisMonth: number;
  ssoConnections: number;
}

export interface CreatePlatformOrgRequest {
  slug: string;
  name: string;
  domains?: string[];
  quotas?: Partial<Quotas>;
  /** Invite this person as the first org_admin. */
  adminEmail?: string;
}

export interface UpdatePlatformOrgRequest {
  name?: string;
  status?: OrgStatus;
  quotas?: Partial<Quotas>;
}

export interface CapacityNode {
  name: string;
  roles: string[];
  ready: boolean;
  kvm: boolean;
  /** The node runs Kata sandboxes (label katacontainers.io/kata-runtime=true): tier-B sandbox capacity. */
  sandbox?: boolean;
  /** requested includes the RuntimeClass overhead of sandboxed pods (pod.spec.overhead). */
  cpu: { capacity: number; allocatable: number; requested: number };
  memoryMiB: { capacity: number; allocatable: number; requested: number };
  pods: number;
  vms: number;
  /** Lab pods running in a tier sandbox (a Kata VM per pod), counted apart from KubeVirt VMs. */
  sandboxes?: number;
}

export interface WarmPoolInfo {
  name: string;
  namespace: string;
  template: string;
  size: number;
  ready: number;
}

/** `GET /platform/capacity`: live from the cluster (nodes, KubeVirt VMIs, tier sandboxes, WarmPools, LabSessions). */
export interface Capacity {
  generatedAt: string;
  cluster: { context: string; reachable: boolean; error?: string };
  nodes: CapacityNode[];
  vms: { running: number; total: number };
  /** Tier sandboxes: lab pods running in a sandbox RuntimeClass, and the nodes that can run them. */
  sandboxes?: { running: number; nodes: number };
  warmPools: WarmPoolInfo[];
  sessions: { total: number; byPhase: Record<string, number>; byOrg: { orgId: string; name: string; count: number }[] };
}
