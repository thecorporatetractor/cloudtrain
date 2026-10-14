/**
 * Exam simulation API (services/gateway `/api/exams/*`, apps/web Exams area).
 *
 * Learner-safe by construction: during an attempt the client gets task
 * statements (params resolved), the timer and terminal targets, never checks,
 * hints, solutions or expected values. Reports carry learner-safe check
 * messages only. Source of truth for the shapes behind them:
 * services/lab-orchestrator/api/v1alpha1/exam_types.go.
 */

/** Curriculum domain of an exam (wider than the lab Domain: includes iac, automation, ...). */
export type ExamDomain = 'kubernetes' | 'linux' | 'containers' | 'iac' | 'automation' | 'networking' | 'cross-domain';

export interface ExamRules {
  timer: 'single' | 'per-task';
  anyOrder: boolean;
  flagForReview: boolean;
  /** VMs are rebooted before grading; only persistent state scores. */
  rebootBeforeGrade: boolean;
  /** Saved automation is re-run after the exam and must report no changes. */
  idempotencyRerun: boolean;
  partialCredit: 'per-check' | 'per-task' | 'none';
  docsAllowed?: string;
  notes?: string;
}

export interface RetakePolicy {
  /** Retakes allowed without waiting for the cooldown. */
  freeRetakes: number;
  cooldownHours: number;
  maxAttemptsPer30Days: number;
  /** A retake draws different tasks where the pools allow, and new params. */
  freshDraw: boolean;
  notes?: string;
}

/** Whether the caller may start an attempt now. */
export interface RetakeStatus {
  allowed: boolean;
  /** Why not (learner-facing), when not allowed. */
  reason?: string;
  /** When the next attempt becomes possible (cooldown or the 30-day window). */
  nextAllowedAt?: string;
  attemptsLast30Days: number;
  /** Counted (scored or running) attempts so far. */
  attemptsTotal: number;
  freeRetakesLeft: number;
  /** An attempt that is still running (resume it instead of starting another). */
  activeAttemptId?: string;
}

export interface ExamObjectiveInfo {
  /** Framework objective ref, e.g. "cka:storage". */
  id: string;
  /** Human name of the objective when known. */
  name?: string;
  /** Share of the score in percent (normalised over objectives that draw tasks). */
  weight: number;
  tasks: number;
  poolSize: number;
}

/** Availability: every objective's pool must hold enough built tasks. */
export type ExamAvailability = 'available' | 'coming-soon';

export interface ExamSummary {
  id: string;
  title: string;
  domain: ExamDomain;
  /** Framework ids the exam aligns to (e.g. "cka"); display only. */
  alignsTo: string[];
  /** Must be shown wherever the exam is offered and on the report. */
  disclaimer: string;
  format: 'practical' | 'practical-simulation';
  durationMinutes: number;
  /** Percent. */
  passMark: number;
  passMarkNote?: string;
  taskCount: number;
  environment: 'shared' | 'per-task';
  availability: ExamAvailability;
  /** Why it is not available yet (e.g. tasks still being authored). */
  availabilityNote?: string;
  rules: ExamRules;
  retakePolicy: RetakePolicy;
  retake: RetakeStatus;
  /** The caller's latest attempt. */
  lastAttempt?: ExamAttemptSummary;
  bestScore?: number;
}

export interface ExamDetail extends ExamSummary {
  description?: string;
  simulationNote?: string;
  objectives: ExamObjectiveInfo[];
  /** What the report contains (from the curriculum's scoreReport.includes). */
  reportIncludes: string[];
  /** Pre-exam checklist shown before start. */
  checklist: string[];
  attempts: ExamAttemptSummary[];
}

/**
 * Attempt lifecycle. `preparing`: environment provisioning (timer not
 * started); `in-progress`: timer running; `grading`: frozen and being graded;
 * `completed`: report ready; `failed`: the platform could not run it (not
 * scored, does not count against the retake policy).
 */
export type ExamAttemptPhase = 'preparing' | 'in-progress' | 'grading' | 'completed' | 'failed';

export interface ExamAttemptSummary {
  id: string;
  examId: string;
  examTitle: string;
  phase: ExamAttemptPhase;
  startedAt: string;
  /** Timer start (environment ready). */
  timerStartedAt?: string;
  deadline?: string;
  submittedAt?: string;
  completedAt?: string;
  /** Percent, once graded. */
  score?: number;
  passed?: boolean;
  /** 1-based attempt number for this exam. */
  number: number;
  /** Whether the attempt counts for the retake policy. */
  counted: boolean;
}

export interface ExamTerminalTarget {
  /** Opaque id passed to the terminal WebSocket as `?target=`. */
  id: string;
  node: string;
  /** Picker label, e.g. "workstation (contexts: qm-core, qm-edge)". */
  label: string;
  /** Opened by default. */
  entry: boolean;
  /** Per-task environments: the task this terminal belongs to. */
  task?: number;
}

export interface ExamTaskView {
  index: number;
  title: string;
  /** Framework objective ref. */
  objective: string;
  objectiveName?: string;
  /** Share of the total score in percent. */
  weight: number;
  /** Markdown task statement with params resolved. */
  statement: string;
  /** Kubeconfig contexts / hosts the task uses. */
  contexts: string[];
  nodes: string[];
  flagged: boolean;
  /** The candidate marked it done in the navigator (client-side aid only). */
  visited: boolean;
}

export interface ExamAttemptState extends ExamAttemptSummary {
  /** Server time, so the client timer does not trust the local clock. */
  serverTime: string;
  durationMinutes: number;
  /** Learner-safe status line. */
  message: string;
  rules: ExamRules;
  disclaimer: string;
  tasks: ExamTaskView[];
  /** Terminals the candidate can open (empty unless in-progress). */
  terminals: ExamTerminalTarget[];
  /** Environment readiness while preparing, 0..1. */
  preparingProgress?: number;
  /** Present once completed. */
  reportReady: boolean;
}

export interface ExamCheckScore {
  id: string;
  description?: string;
  passed: boolean;
  weight: number;
  skills: string[];
  /** Learner-safe; never the expected value. */
  message: string;
  failedAfterReboot?: boolean;
  failedOnRerun?: boolean;
}

export interface ExamTaskScore {
  index: number;
  taskId: string;
  title: string;
  objective: string;
  /** Share of the total in percent. */
  weight: number;
  outcome: 'pass' | 'partial' | 'fail';
  /** Percent. */
  score: number;
  /** Seconds of terminal activity on this task, when measured. */
  timeSpentSec?: number;
  checks: ExamCheckScore[];
}

export interface ExamObjectiveScore {
  id: string;
  name?: string;
  weight: number;
  tasks: number;
  /** Percent. */
  score: number;
}

export interface ExamSkillEvidence {
  skillId: string;
  passed: number;
  failed: number;
}

export interface ExamReport {
  attemptId: string;
  examId: string;
  examTitle: string;
  disclaimer: string;
  /** Percent, one decimal. */
  score: number;
  passMark: number;
  passed: boolean;
  partialCredit: ExamRules['partialCredit'];
  gradedAt: string;
  timerStartedAt?: string;
  submittedAt?: string;
  /** Minutes used of the allowed duration. */
  minutesUsed?: number;
  durationMinutes: number;
  /** Grading passes that ran: initial, rerun (idempotency), reboot. */
  passes: string[];
  objectives: ExamObjectiveScore[];
  tasks: ExamTaskScore[];
  skills: ExamSkillEvidence[];
  /** Labs recommended for the weakest objectives. */
  recommendations: { objective: string; labIds: string[] }[];
}

export interface StartExamResponse {
  attempt: ExamAttemptState;
}

export interface FlagTaskRequest {
  flagged: boolean;
}

/** Manager view: exam readiness of a team. */
export interface TeamExamMember {
  userId: string;
  name: string;
  attempts: number;
  bestScore?: number;
  lastScore?: number;
  lastAttemptAt?: string;
  passed: boolean;
  /** Weakest objective of the last graded attempt. */
  weakestObjective?: { id: string; name?: string; score: number };
  /** ready: passed with margin; close: within 10 points of the pass mark; not-ready; not-attempted. */
  readiness: 'ready' | 'close' | 'not-ready' | 'not-attempted';
}

export interface TeamExamReadiness {
  team: { id: string; name: string };
  exams: {
    examId: string;
    examTitle: string;
    passMark: number;
    members: TeamExamMember[];
    /** Mean of the members' last scores (attempted members only). */
    averageScore?: number;
    passRate: number;
  }[];
}
