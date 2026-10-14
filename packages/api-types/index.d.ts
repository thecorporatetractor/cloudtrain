/**
 * HTTP API shapes shared by apps/web (consumer, and its MSW mocks) and
 * services/gateway (producer). Lab-related shapes mirror
 * packages/lab-schema/schema/lab.schema.json (cloudtrain.dev/v3), reduced to
 * what a learner may see: the gateway never sends expected values, check
 * commands, solutions or misconceptions.
 */

export type Domain = 'kubernetes' | 'linux' | 'networking';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type NodeDriver = 'container' | 'vm' | 'k8s-cluster' | 'netdev';
export type AccessKind = 'shell' | 'ssh' | 'console' | 'web' | 'rdp';
export type FrameworkId = 'cka' | 'cks' | 'lfcs' | 'ccna';

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
  | 'http';

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
    checks: LabCheck[];
    hints?: LabHint[];
  };
}

export interface LabSummary extends LabMetadata {
  skillIds: string[];
  pathId?: string;
  completion?: 'completed' | 'in-progress' | 'new';
  bestScore?: number;
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
  name: string;
  fullName: string;
  vendor: string;
  domains: FrameworkDomain[];
}

export interface Recommendation {
  labId: string;
  score: number;
  predictedSuccess: number; // 0..1
  expectedGain: number; // skill points
  reasons: { kind: 'gain' | 'review' | 'goal' | 'prereq' | 'time' | 'variety'; text: string }[];
}

export interface GoalForecast {
  frameworkId: FrameworkId;
  targetDate: string;
  readiness: number; // 0..1
  forecastReadyDate: string;
  weeklyMinutes: number;
  perDomain: { domainId: string; readiness: number; delta7d: number }[];
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
  streakDays: number;
  minutesThisWeek: number;
}

export interface HomeData {
  learner: Learner;
  recommendations: Recommendation[];
  goal: GoalForecast;
  activity: Activity[];
  masteryByDomain: { domain: Domain; mastery: number; skills: number; practicedSkills: number }[];
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
