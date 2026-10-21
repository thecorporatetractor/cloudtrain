import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/* Kysely table types for the platform schema (src/db/migrations). */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
/** Has a database default and can be set. */
type DefaultedTime = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T> = ColumnType<T, string | T, string | T>;

export interface OrgSettingsJson {
  defaultSessionMinutes?: number;
  logoUrl?: string;
  accentColor?: string;
  allowLocalLogin?: boolean;
  timezone?: string;
}

export interface GroupMappingJson {
  group: string;
  roles: string[];
  teams: { teamId: string; role: 'member' | 'manager' }[];
}

export interface OrgsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  status: Generated<'active' | 'suspended'>;
  settings: Json<OrgSettingsJson>;
  kc_org_id: string | null;
  created_at: CreatedAt;
}

export interface UsersTable {
  id: string;
  email: string;
  name: string;
  title: string | null;
  avatar_url: string | null;
  platform_roles: ColumnType<string[], string[] | undefined, string[]>;
  last_login_at: Timestamp | null;
  last_idp: string | null;
  created_at: CreatedAt;
}

export interface OrgDomainsTable {
  org_id: string;
  domain: string;
  verification_token: string;
  verified_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface SsoConnectionsTable {
  id: Generated<string>;
  org_id: string;
  kc_alias: string;
  type: 'oidc' | 'saml';
  display_name: string;
  enforced: Generated<boolean>;
  group_mappings: Json<GroupMappingJson[]>;
  default_roles: ColumnType<string[], string[] | undefined, string[]>;
  settings: Json<Record<string, unknown>>;
  status: Generated<'draft' | 'active' | 'error' | 'disabled'>;
  last_test: Json<Record<string, unknown>> | null;
  created_at: CreatedAt;
  updated_at: DefaultedTime;
}

export type MembershipStatusDb = 'invited' | 'active' | 'deactivated';

export interface MembershipsTable {
  org_id: string;
  user_id: string;
  roles: string[];
  status: Generated<MembershipStatusDb>;
  source: Generated<'sso' | 'local' | 'invite' | 'seed'>;
  invited_by: string | null;
  created_at: CreatedAt;
  updated_at: DefaultedTime;
}

export interface InvitationsTable {
  id: Generated<string>;
  org_id: string;
  email: string;
  user_id: string | null;
  roles: string[];
  teams: Json<{ teamId: string; role: 'member' | 'manager' }[]>;
  token_hash: string;
  invited_by: string | null;
  created_at: CreatedAt;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface TeamsTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  parent_id: string | null;
  created_at: CreatedAt;
}

export interface TeamMembersTable {
  org_id: string;
  team_id: string;
  user_id: string;
  role: Generated<'member' | 'manager'>;
  source: Generated<'manual' | 'sso'>;
}

export interface CohortsTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  instructor_ids: string[];
  path_id: string | null;
  lab_ids: string[];
  created_by: string | null;
  created_at: CreatedAt;
}

export interface CohortMembersTable {
  org_id: string;
  cohort_id: string;
  user_id: string;
}

export interface AssignmentsTable {
  id: Generated<string>;
  org_id: string;
  target_kind: 'team' | 'user' | 'cohort';
  target_id: string;
  item_kind: 'lab' | 'path' | 'framework';
  item_id: string;
  lab_ids: string[];
  due_at: Timestamp | null;
  required: Generated<boolean>;
  note: string | null;
  assigned_by: string | null;
  created_at: CreatedAt;
}

export type AttemptOutcomeDb = 'in_progress' | 'passed' | 'partial' | 'failed' | 'abandoned';

export interface LabAttemptsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  lab_id: string;
  lab_version: number;
  difficulty: string;
  session_name: string;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  outcome: Generated<AttemptOutcomeDb>;
  score: Generated<number>;
  hints_used: Generated<number>;
  validations: Generated<number>;
  duration_s: Generated<number>;
  checks_total: Generated<number>;
  checks_passed: Generated<number>;
  /** CTF totals (0005_ctf_answers). */
  points_earned: Generated<number>;
  points_possible: Generated<number>;
  questions_solved: Generated<number>;
  questions_total: Generated<number>;
}

export interface AnswerSubmissionsTable {
  id: Generated<string>;
  org_id: string;
  scope_key: string;
  user_id: string;
  session_name: string;
  lab_id: string;
  check_id: string;
  event_id: string | null;
  team_id: string | null;
  answer: string;
  correct: boolean;
  points: Generated<number>;
  submitted_at: DefaultedTime;
}

export interface CtfEventsTable {
  id: Generated<string>;
  org_id: string;
  title: string;
  description: string | null;
  lab_ids: string[];
  starts_at: Timestamp;
  ends_at: Timestamp;
  mode: 'solo' | 'team';
  team_size_max: Generated<number>;
  team_formation: Generated<'self' | 'manager'>;
  scoring: 'static' | 'dynamic';
  dynamic_min_pct: Generated<number>;
  dynamic_decay: Generated<number>;
  first_blood: Generated<boolean>;
  freeze_minutes: Generated<number>;
  published: Generated<boolean>;
  created_by: string | null;
  created_at: CreatedAt;
  updated_at: DefaultedTime;
}

export interface CtfEventTeamsTable {
  id: Generated<string>;
  org_id: string;
  event_id: string;
  name: string;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface CtfEventParticipantsTable {
  org_id: string;
  event_id: string;
  user_id: string;
  team_id: string | null;
  joined_at: DefaultedTime;
}

export interface AnswerHintRevealsTable {
  org_id: string;
  scope_key: string;
  check_id: string;
  hint_index: number;
  user_id: string;
  session_name: string;
  lab_id: string;
  event_id: string | null;
  team_id: string | null;
  cost: number;
  revealed_at: DefaultedTime;
}

export interface CheckResultsTable {
  org_id: string;
  attempt_id: string;
  check_id: string;
  run: number;
  passed: boolean;
  weight: number;
  skills: string[];
  message: string | null;
  graded_at: Timestamp;
}

export interface SkillEvidenceTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  skill_id: string;
  attempt_id: string;
  check_id: string;
  outcome: number;
  weight: number;
  difficulty: number;
  at: Timestamp;
}

export interface LearnerSkillStateTable {
  org_id: string;
  user_id: string;
  skill_id: string;
  mu: number;
  sigma: number;
  evidence: number;
  last_delta: number;
  updated_at: Timestamp;
}

export interface ContentVisibilityTable {
  org_id: string;
  kind: 'pack' | 'lab' | 'path';
  ref_id: string;
  enabled: boolean;
  pinned: boolean;
}

export interface QuotasTable {
  org_id: string;
  max_concurrent_sessions: number;
  monthly_lab_hours: number;
  max_session_minutes: number;
}

export interface AuditLogTable {
  id: Generated<string>;
  org_id: string;
  at: DefaultedTime;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
  ip: string | null;
  details: Json<Record<string, unknown>>;
}

export interface SessionNoticesTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  session_name: string | null;
  kind: string;
  message: string;
  from_id: string | null;
  at: DefaultedTime;
  active: Generated<boolean>;
  ended_at: Timestamp | null;
}

export interface AuthLoginStatesTable {
  state: string;
  verifier: string;
  nonce: string;
  return_to: string;
  email: string | null;
  org_id: string | null;
  invite: string | null;
  created_at: CreatedAt;
}

export interface AuthSessionsTable {
  id_hash: string;
  user_id: string;
  org_id: string | null;
  csrf: string;
  kc_sid: string | null;
  idp: string | null;
  id_token: string | null;
  refresh_token: string | null;
  access_expires_at: Timestamp | null;
  expires_at: Timestamp;
  created_at: CreatedAt;
  last_seen_at: DefaultedTime;
  ip: string | null;
  user_agent: string | null;
}

export interface AssignmentStatusView {
  assignment_id: string;
  org_id: string;
  user_id: string;
  via_kind: 'team' | 'user' | 'cohort';
  via_id: string;
  due_at: Date | null;
  required: boolean;
  labs_total: number;
  labs_passed: string;
  labs_touched: string;
  best_score: number | null;
  completed_at: Date | null;
  status: 'not_started' | 'in_progress' | 'completed' | 'overdue';
  progress: number;
}

export interface AssignmentTargetsView {
  assignment_id: string;
  org_id: string;
  user_id: string;
  via_kind: 'team' | 'user' | 'cohort';
  via_id: string;
}

export interface ExamAttemptsTable {
  org_id: string;
  id: string;
  user_id: string;
  exam_id: string;
  exam_title: string;
  number: number;
  seed: number;
  phase: 'preparing' | 'in-progress' | 'grading' | 'completed' | 'failed';
  started_at: Timestamp;
  timer_started_at: Timestamp | null;
  deadline: Timestamp | null;
  submitted_at: Timestamp | null;
  completed_at: Timestamp | null;
  duration_minutes: number;
  tasks: Json<unknown[]>;
  flagged: number[];
  /** numeric(5,1): read as a string. */
  score: ColumnType<string | null, number | string | null, number | string | null>;
  passed: boolean | null;
  report: Json<unknown> | null;
  evidence_recorded: Generated<boolean>;
  voided_at: Timestamp | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface ExamTaskResultsTable {
  org_id: string;
  attempt_id: string;
  task_index: number;
  task_id: string;
  objective: string;
  weight: ColumnType<string, number | string, number | string>;
  outcome: 'pass' | 'partial' | 'fail';
  score: ColumnType<string, number | string, number | string>;
  checks: Json<unknown[]>;
}

export interface ExamRetakeGrantsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  exam_id: string;
  granted_by: string | null;
  reason: string | null;
  created_at: CreatedAt;
  used_at: Timestamp | null;
  used_by_attempt: string | null;
}

export interface LearnerGoalsTable {
  org_id: string;
  user_id: string;
  /** Postgres `date`; select it as `target_date::text` (YYYY-MM-DD, no time zone shift). */
  target_date: string | null;
  weekly_target_minutes: number | null;
  updated_at: Generated<Date>;
}

export interface BillingCustomersTable {
  id: Generated<string>;
  org_id: string;
  user_id: string | null;
  scope_key: Generated<string>;
  stripe_customer_id: string;
  email: string | null;
  livemode: Generated<boolean>;
  created_at: Generated<Date>;
  has_payment_method: Generated<boolean>;
  invoice_failed_at: Date | null;
  delinquent_since: Date | null;
  compute_subscription_id: string | null;
  updated_at: Generated<Date>;
}

export interface BillingSubscriptionsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string | null;
  customer_id: string;
  stripe_subscription_id: string;
  /** `plan` (a site plan) or `compute` (the metered compute subscription). */
  kind: Generated<'plan' | 'compute'>;
  plan_id: string;
  price_lookup_key: string | null;
  billing_interval: 'monthly' | 'yearly';
  seats: Generated<number>;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: Generated<boolean>;
  livemode: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BillingEntitlementsTable {
  org_id: string;
  user_id: string | null;
  scope_key: Generated<string>;
  plan_id: string;
  /** PlanEntitlements as JSON (written with JSON.stringify). */
  entitlements: unknown;
  source: 'subscription' | 'default' | 'manual';
  subscription_id: string | null;
  updated_at: Generated<Date>;
}

export interface BillingEventsTable {
  id: Generated<string>;
  stripe_event_id: string;
  type: string;
  org_id: string | null;
  user_id: string | null;
  livemode: Generated<boolean>;
  received_at: Generated<Date>;
  processed_at: Date | null;
  status: Generated<'received' | 'processed' | 'ignored' | 'failed'>;
  error: string | null;
  summary: Generated<unknown>;
}

/** One metered lab session (0009_billing_compute). */
export interface BillingUsageTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  lab_id: string;
  session_name: string;
  compute_tier: 'pod' | 'vm' | 'heavy';
  units_per_minute: number;
  /** numeric: pg returns a string. */
  unit_price: string | number;
  /** The paying scope: a user id, or '' for the organisation. */
  payer_key: string;
  customer_id: string | null;
  trial: Generated<boolean>;
  billable: boolean;
  started_at: Date;
  ended_at: Date | null;
  minutes: number | null;
  units: number | null;
  created_at: Generated<Date>;
}

export interface BillingMeterOutboxTable {
  id: Generated<string>;
  org_id: string;
  usage_id: string;
  identifier: string;
  event_name: string;
  stripe_customer_id: string;
  value: number;
  event_at: Date;
  status: Generated<'pending' | 'sent' | 'failed'>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error: string | null;
  sent_at: Date | null;
  created_at: Generated<Date>;
}

export interface BillingSeatsTable {
  org_id: string;
  user_id: string;
  assigned_by: string | null;
  assigned_at: Generated<Date>;
}

export interface BillingLimitsTable {
  org_id: string;
  user_id: string | null;
  scope_key: Generated<string>;
  monthly_cap: number;
  hard_stop: boolean;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface DB {
  orgs: OrgsTable;
  users: UsersTable;
  org_domains: OrgDomainsTable;
  sso_connections: SsoConnectionsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  teams: TeamsTable;
  team_members: TeamMembersTable;
  cohorts: CohortsTable;
  cohort_members: CohortMembersTable;
  assignments: AssignmentsTable;
  lab_attempts: LabAttemptsTable;
  check_results: CheckResultsTable;
  skill_evidence: SkillEvidenceTable;
  learner_skill_state: LearnerSkillStateTable;
  content_visibility: ContentVisibilityTable;
  quotas: QuotasTable;
  audit_log: AuditLogTable;
  session_notices: SessionNoticesTable;
  auth_login_states: AuthLoginStatesTable;
  auth_sessions: AuthSessionsTable;
  assignment_status: AssignmentStatusView;
  assignment_targets: AssignmentTargetsView;
  exam_attempts: ExamAttemptsTable;
  exam_task_results: ExamTaskResultsTable;
  exam_retake_grants: ExamRetakeGrantsTable;
  learner_goals: LearnerGoalsTable;
  answer_submissions: AnswerSubmissionsTable;
  answer_hint_reveals: AnswerHintRevealsTable;
  ctf_events: CtfEventsTable;
  ctf_event_teams: CtfEventTeamsTable;
  ctf_event_participants: CtfEventParticipantsTable;
  billing_customers: BillingCustomersTable;
  billing_subscriptions: BillingSubscriptionsTable;
  billing_entitlements: BillingEntitlementsTable;
  billing_events: BillingEventsTable;
  billing_usage: BillingUsageTable;
  billing_meter_outbox: BillingMeterOutboxTable;
  billing_seats: BillingSeatsTable;
  billing_limits: BillingLimitsTable;
  waitlist_entries: WaitlistEntriesTable;
  platform_licenses: PlatformLicensesTable;
}

/** Early-access waitlist (0008_waitlist): not tenant data, no org_id. */
export interface WaitlistEntriesTable {
  id: Generated<string>;
  email: string;
  organisation: string | null;
  role: string | null;
  interest: 'enterprise' | 'individual' | null;
  consent_at: Timestamp;
  created_at: CreatedAt;
}

/** Uploaded self-hosted license keys (0010_license): platform scope, no org_id. */
export interface PlatformLicensesTable {
  id: Generated<string>;
  license_id: string;
  token: string;
  installed_by: string | null;
  installed_at: CreatedAt;
  removed_at: Date | null;
  removed_by: string | null;
}

export type CtfEventRow = Selectable<CtfEventsTable>;

export type OrgRow = Selectable<OrgsTable>;
export type UserRow = Selectable<UsersTable>;
export type MembershipRow = Selectable<MembershipsTable>;
export type TeamRow = Selectable<TeamsTable>;
export type CohortRow = Selectable<CohortsTable>;
export type AssignmentRow = Selectable<AssignmentsTable>;
export type AttemptRow = Selectable<LabAttemptsTable>;
export type SsoConnectionRow = Selectable<SsoConnectionsTable>;
export type AuditRow = Selectable<AuditLogTable>;
export type AuthSessionRow = Selectable<AuthSessionsTable>;
export type NewAttempt = Insertable<LabAttemptsTable>;
export type AttemptUpdate = Updateable<LabAttemptsTable>;
