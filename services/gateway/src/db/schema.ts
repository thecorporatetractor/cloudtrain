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
}

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
