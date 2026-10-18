/**
 * HTTP API shapes shared by apps/web (consumer, and its MSW mocks) and
 * services/gateway (producer). Lab-related shapes mirror
 * packages/lab-schema/schema/lab.schema.json (cloudtrain.dev/v3), reduced to
 * what a learner may see: the gateway never sends expected values, check
 * commands, solutions or misconceptions.
 *
 * Platform shapes (identity, tenancy, roles, assignments, cohorts, admin,
 * platform) live in ./platform.d.ts and are re-exported here.
 */

import type { MyAssignment, SessionNotice } from './platform.js';
import type { LabQuestion } from './ctf.js';

export * from './platform.js';
export * from './ctf.js';

export type Domain = 'kubernetes' | 'linux' | 'containers' | 'iac' | 'automation' | 'networking';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type NodeDriver = 'container' | 'vm' | 'k8s-cluster' | 'netdev';
export type AccessKind = 'shell' | 'ssh' | 'console' | 'web' | 'rdp';
/**
 * Framework id: a content/frameworks/<id>.yaml file (hand-written, or generated from the
 * curriculum's `frameworks`), e.g. `cka`, `rhcsa-aligned`, `tf-associate`. Open-ended: the
 * set grows with the curriculum, so clients must not hard-code it.
 */
export type FrameworkId = string;

export interface LabMetadata {
  id: string;
  title: string;
  domain: Domain;
  frameworks?: string[];
  difficulty: Difficulty;
  estimatedMinutes: number;
  tags?: string[];
  version?: number;
}

export interface ClusterNode {
  name: string;
  role: 'control-plane' | 'worker';
  taints?: string[];
  labels?: Record<string, string>;
  state?: 'ready' | 'notready';
}

export interface TopologyNode {
  name: string;
  driver: NodeDriver;
  image?: string;
  resources?: { cpu?: number; memoryMiB?: number; disks?: string[] };
  access?: AccessKind[];
  cluster?: {
    mode?: 'virtual' | 'kubeadm';
    version?: string;
    context?: string;
    nodes?: ClusterNode[];
  };
}

export interface TopologyLink {
  a: string;
  b: string;
  subnet?: string;
  impair?: { latencyMs?: number; lossPct?: number; mtu?: number };
}

export interface Topology {
  entry?: string;
  nodes: TopologyNode[];
  links?: TopologyLink[];
}

export type CheckType =
  | 'shell'
  | 'k8s-query'
  | 'k8s-can-i'
  | 'k8s-context'
  | 'file'
  | 'service-state'
  | 'reachability'
  | 'device-cmd'
  | 'http'
  | 'answer';

export interface LabCheck {
  id: string;
  description: string;
  skills: string[];
  weight?: number;
  type: CheckType;
  on?: string;
  command?: string;
  target?: string;
  port?: number;
  expect?: { match: 'exact' | 'not_exact' | 'contains' | 'not_contains' | 'regex'; value: string };
  timeoutSec?: number;
}

export interface LabHint {
  title: string;
  /** Empty while `redacted`; the session carries the content once the hint is revealed. */
  body: string;
  command?: string;
  cost?: number;
  /** True when the server withheld body/command until the hint is revealed (real API). */
  redacted?: boolean;
}

export interface Lab {
  apiVersion: 'cloudtrain.dev/v3';
  kind: 'Lab';
  metadata: LabMetadata;
  spec: {
    description: string;
    objectives?: string[];
    topology: Topology;
    /** End-state checks (graded by Validate). Answer checks are listed in `questions`. */
    checks: LabCheck[];
    hints?: LabHint[];
    /** Questions (answer checks) of a CTF lab, in order; their state is per session (`GET /sessions/:id/questions`). */
    questions?: LabQuestion[];
    questionOrder?: 'free' | 'sequential';
  };
}

export interface LabSummary extends LabMetadata {
  skillIds: string[];
  pathId?: string;
  completion?: 'completed' | 'in-progress' | 'new';
  bestScore?: number;
  /** Number of questions when the lab has answer checks (CTF). */
  questionCount?: number;
}

export interface Path {
  id: string;
  title: string;
  domain: Domain;
  description: string;
  framework?: FrameworkId;
  labIds: string[];
  estimatedMinutes: number;
  progress: number; // 0..1
}

export interface DomainInfo {
  id: Domain;
  name: string;
  tagline: string;
  labCount: number;
  pathCount: number;
}

export interface Skill {
  id: string;
  name: string;
  domain: Domain;
  competency: string;
}

export interface SkillState {
  skillId: string;
  mu: number; // 0..1 mastery estimate
  sigma: number; // 0..0.5 uncertainty
  evidence: number;
  lastPracticed?: string;
  trend: 'up' | 'flat' | 'down';
}

export interface FrameworkDomain {
  id: string;
  name: string;
  weight: number; // exam weight 0..1
  skillIds: string[];
}

export interface Framework {
  id: FrameworkId;
  /** Short name for pickers and badges (CKA, RHCSA, Terraform Associate). */
  name: string;
  fullName: string;
  /** Certifying body, or CloudTrain for its own frameworks. */
  vendor: string;
  /** Content domain the framework belongs to; absent for cross-domain frameworks. */
  domain?: Domain;
  /**
   * Picker group label from content ("Kubernetes", "Infrastructure as code", "Platform" for
   * cross-domain). The list arrives ordered by group, then name.
   */
  group: string;
  /** Share of objectives (0..1) that at least one published lab targets; below 1, labs are still being built. */
  coverage: number;
  /** Alignment disclaimer (not affiliated, no certification conferred); absent for CloudTrain's own frameworks. */
  disclaimer?: string;
  domains: FrameworkDomain[];
}

/**
 * How much evidence stands behind a model number. `prior`: none of the inputs
 * have evidence yet, so the value is the model's default for someone it does
 * not know (label it "no data yet", never as a prediction). `estimate`: based
 * on graded practice.
 */
export type EstimateConfidence = 'prior' | 'estimate';

export interface Recommendation {
  labId: string;
  /** Internal ranking score (0..1). Not meant for learners. */
  score: number;
  predictedSuccess: number; // 0..1
  expectedGain: number; // skill points (internal unit)
  /** Whether predictedSuccess rests on evidence about the lab's skills. */
  confidence?: EstimateConfidence;
  /** Lab skills with graded evidence (of skillIds.length). */
  evidenceSkills?: number;
  /** Goal readiness change (0..1, absolute) if the learner passes the lab. */
  readinessGain?: number;
  /** Goal framework domains (FrameworkDomain ids) the lab counts toward. */
  goalDomainIds?: string[];
  /** A lab practised in the last two weeks that shares skills with this one. */
  buildsOn?: { labId: string; title: string };
  reasons: { kind: 'gain' | 'review' | 'goal' | 'prereq' | 'time' | 'variety'; text: string }[];
}

export interface GoalDomain {
  domainId: string;
  readiness: number;
  delta7d: number;
  /** Exam weight 0..1. */
  weight?: number;
  /** Skills of the domain with graded evidence / all skills of the domain. */
  practisedSkills?: number;
  skills?: number;
  /** A lab to practise this domain next (best recommendation that covers it). */
  labId?: string;
}

export interface GoalForecast {
  frameworkId: FrameworkId;
  targetDate: string;
  /**
   * `learner`: the learner's own exam date (`PUT /me/goals`); `assignment`:
   * due date of an assigned framework goal; `default`: placeholder (no date chosen yet).
   */
  targetDateSource?: 'learner' | 'assignment' | 'default';
  /** The learner's own weekly practice target in minutes (`PUT /me/goals`), when set. */
  weeklyTargetMinutes?: number;
  readiness: number; // 0..1
  /** Readiness at which the plan counts the learner as exam-ready (0..1). */
  readyAt?: number;
  /** Only meaningful when confidence is `estimate`. */
  forecastReadyDate: string;
  confidence?: EstimateConfidence;
  /** Graded practice sessions in the last four weeks behind the forecast. */
  sessions?: number;
  /** Average practice minutes per week over the last four weeks (actual, not a target). */
  weeklyMinutes: number;
  /** Planning estimate of practice minutes still needed to reach readyAt. */
  minutesToReady?: number;
  /** Minutes per day from today needed to be ready by targetDate. */
  dailyMinutesNeeded?: number;
  /** Ordered by exam weight x gap (most valuable first). */
  perDomain: GoalDomain[];
}

/** An unfinished attempt worth picking up again (most recent first). */
export interface ResumeItem {
  labId: string;
  startedAt: string;
  /** Times the lab was opened without passing in the last 14 days. */
  attempts: number;
  checksPassed: number;
  checksTotal: number;
  /** Graded runs (Validate) in the latest attempt. */
  validations: number;
  /** Live session to reattach to; absent when the environment has expired. */
  sessionId?: string;
}

/** What a learner without graded practice sees instead of model numbers. */
export interface ColdStart {
  /** Short labs across the heaviest exam domains: a baseline that seeds the model. */
  baselineLabIds: string[];
  baselineMinutes: number;
  /** First-week plan: one entry per practice day. */
  plan: { day: number; title: string; labId?: string; minutes: number }[];
}

export interface Activity {
  id: string;
  kind: 'lab_completed' | 'lab_started' | 'check_passed' | 'hint_used' | 'skill_up' | 'path_completed';
  at: string;
  labId?: string;
  text: string;
}

export interface Learner {
  id: string;
  name: string;
  email: string;
  role: 'learner' | 'manager' | 'admin';
  team: string;
  org: string;
  /** Consecutive days with graded practice (a Validate run). */
  streakDays: number;
  /** Practice minutes in the last 7 days: time in labs where a Validate ran, up to the last run. */
  minutesThisWeek: number;
}

export interface HomeData {
  learner: Learner;
  recommendations: Recommendation[];
  goal: GoalForecast;
  activity: Activity[];
  masteryByDomain: { domain: Domain; mastery: number; skills: number; practicedSkills: number }[];
  /** Open assignments, soonest due first (platform API). */
  assignmentsDue?: MyAssignment[];
  /** The most recent unfinished lab, offered above the next best lab. */
  resume?: ResumeItem;
  /** Present while the learner has no graded practice. */
  coldStart?: ColdStart;
  /** `live`: computed from the learner's history; `empty`: no history yet, cold-start defaults. */
  source?: 'live' | 'empty';
}

export type NodeStatus = 'provisioning' | 'ready' | 'degraded' | 'stopped';

export interface SessionNodeState {
  name: string;
  status: NodeStatus;
  ip?: string;
  /** Driver message, e.g. why a node is still provisioning or failed. */
  message?: string;
}

export interface CheckResult {
  checkId: string;
  status: 'pass' | 'fail' | 'error' | 'pending';
  message?: string;
  durationMs?: number;
  observed?: string;
  /** Skills this check is evidence for (real API; the mock derives them from the lab). */
  skills?: string[];
}

/** Lifecycle of the environment behind a session (LabSession status.phase in the cluster). */
export type SessionPhase = 'pending' | 'provisioning' | 'ready' | 'grading' | 'hibernated' | 'expired' | 'failed';

export interface LabSession {
  id: string;
  labId: string;
  startedAt: string;
  deadlineMinutes: number;
  nodes: SessionNodeState[];
  results: CheckResult[];
  revealedHints: number[];
  score: number;
  validations: number;
  status: 'running' | 'passed' | 'expired' | 'failed';
  /** Environment phase (real API). Absent in the mock, where nodes alone tell the story. */
  phase?: SessionPhase;
  /** Why the session failed or what it is waiting for. */
  message?: string;
  expiresAt?: string;
  /** Node the learner's first terminal opens on. */
  entryNode?: string;
  /** Resolved {{param}} values for this attempt; the client substitutes them into the task text. */
  params?: Record<string, string>;
  /** Content of revealed hints, by index, when the lab's hints are redacted. */
  hints?: Record<number, LabHint>;
  /** Observer banners and cohort broadcasts for this session (platform API). */
  notices?: SessionNotice[];
}

export interface ValidateResponse {
  session: LabSession;
  summary: { passed: number; total: number; score: number; skillsTouched: string[] };
  /**
   * How grading ended (real API). `failed`: the grader itself broke; `timeout`: no grader
   * answered in time (results stay pending). Absent means complete.
   */
  grading?: { state: 'complete' | 'failed' | 'timeout'; message?: string };
}

// ---- Scenario Studio ----

export type GateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface GateItem {
  label: string;
  status: GateStatus;
  detail?: string;
}

export interface VerificationGate {
  id:
    | 'setup-idempotent'
    | 'fails-before'
    | 'passes-after'
    | 'mutations'
    | 'alt-solutions'
    | 'teardown-clean'
    | 'variants';
  name: string;
  description: string;
  status: GateStatus;
  durationSec?: number;
  items: GateItem[];
}

export interface StudioDraft {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  author: string;
  stage: 'describe' | 'spec' | 'verify' | 'review' | 'pilot' | 'published';
  spec?: Lab;
  gates: VerificationGate[];
  diff?: DiffLine[];
  pilot?: { cohort: string; learners: number; startedAt: string };
}

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
}

// ---- Team ----

export interface TeamMember {
  id: string;
  name: string;
  title: string;
  skills: Record<string, number>; // competency id -> mastery
  certs: { frameworkId: FrameworkId; deadline: string; readiness: number; forecast: string }[];
  minutesThisMonth: number;
}

export interface Workshop {
  id: string;
  title: string;
  competencyId: string;
  reason: string;
  memberIds: string[];
  durationMinutes: number;
}

export interface TeamData {
  team: { id: string; name: string; manager: string };
  competencies: { id: string; name: string; domain: Domain }[];
  members: TeamMember[];
  workshops: Workshop[];
}

// ---- Exam simulations (exam engine stream) ----

export * from './exam.js';
