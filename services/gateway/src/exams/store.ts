import type { ExamAttemptPhase, ExamReport } from '@cloudtrain/api-types';

/** One drawn task as persisted with the attempt. */
export interface AttemptTask {
  index: number;
  taskId: string;
  objective: string;
  title: string;
  /** Share of the total in percent. */
  weight: number;
}

/**
 * An exam attempt as the gateway persists it. The ExamSession in the cluster
 * is the live state; this record survives its deletion and is the history
 * the retake policy, reports and the manager view read.
 */
export interface AttemptRecord {
  /** = ExamSession name. */
  id: string;
  orgId: string;
  userId: string;
  userName: string;
  examId: string;
  examTitle: string;
  /** 1-based attempt number for (user, exam). */
  number: number;
  seed: number;
  phase: ExamAttemptPhase;
  startedAt: string;
  timerStartedAt?: string;
  deadline?: string;
  submittedAt?: string;
  completedAt?: string;
  durationMinutes: number;
  tasks: AttemptTask[];
  /** Task indexes flagged for review. */
  flagged: number[];
  score?: number;
  passed?: boolean;
  /** Final report (per task, per objective, per check). */
  report?: ExamReport;
  /** Skill evidence was fed to the learner model (exactly once). */
  evidenceRecorded: boolean;
  /** Ended by an admin/instructor (not scored, does not count); the ExamSession is deleted. */
  voided?: { at: string; by: string; reason?: string };
}

/** An audit_log row written in the same transaction as the change it records. */
export interface ExamAuditEntry {
  actorId: string;
  actorName: string;
  ip?: string;
  action: 'exam.start' | 'exam.submit' | 'exam.void' | 'exam.retake_grant';
  /** attempt id, or the candidate's user id for retake grants. */
  targetType: 'exam_attempt' | 'user';
  targetId: string;
  targetLabel?: string;
  details: Record<string, unknown>;
}

/** One extra attempt granted to a person for an exam (bypasses the cooldown and the 30-day cap once). */
export interface RetakeGrantRecord {
  id: string;
  orgId: string;
  userId: string;
  examId: string;
  grantedBy: string;
  reason?: string;
  createdAt: string;
  usedAt?: string;
  usedByAttempt?: string;
}

/** Thrown by `create` when the person already has a running attempt of the exam (unique index in Postgres). */
export class RunningAttemptExists extends Error {
  constructor() {
    super('You have an attempt in progress. Resume it instead of starting another.');
  }
}

/**
 * Persistence of attempts and their per-task results. Every method is scoped
 * to an org (Postgres: RLS with app.org_id, src/db/migrations/0003_exams.ts;
 * PgExamStore in pg.ts). `audit` entries are written atomically with the
 * change. MemoryExamStore serves unit tests.
 */
export interface ExamStore {
  /**
   * Inserts a new attempt; refuses (RunningAttemptExists) when the person has
   * a running attempt of the same exam. `useGrant` consumes one open retake
   * grant in the same transaction.
   */
  create(rec: AttemptRecord, opts?: { audit?: ExamAuditEntry; useGrant?: boolean }): Promise<void>;
  get(orgId: string, id: string): Promise<AttemptRecord | null>;
  /** Read-modify-write of one attempt (Postgres: SELECT ... FOR UPDATE in one transaction). */
  update(orgId: string, id: string, fn: (rec: AttemptRecord) => AttemptRecord, audit?: ExamAuditEntry): Promise<AttemptRecord>;
  /** A user's attempts, newest first, optionally for one exam. */
  listByUser(orgId: string, userId: string, examId?: string): Promise<AttemptRecord[]>;
  /** Attempts of several users (team readiness), newest first. */
  listByUsers(orgId: string, userIds: string[]): Promise<AttemptRecord[]>;
  /** Open (unused) retake grants of a person for an exam. */
  openGrants(orgId: string, userId: string, examId: string): Promise<RetakeGrantRecord[]>;
  addGrant(g: Omit<RetakeGrantRecord, 'id' | 'createdAt'>, audit: ExamAuditEntry): Promise<RetakeGrantRecord>;
}

const clone = <T>(v: T): T => structuredClone(v);
const newestFirst = (a: AttemptRecord, b: AttemptRecord) => b.startedAt.localeCompare(a.startedAt);

export class MemoryExamStore implements ExamStore {
  private readonly rows = new Map<string, AttemptRecord>();
  private readonly key = (orgId: string, id: string) => `${orgId}\u0000${id}`;

  readonly audits: (ExamAuditEntry & { orgId: string })[] = [];
  private readonly grants: RetakeGrantRecord[] = [];

  async create(rec: AttemptRecord, opts: { audit?: ExamAuditEntry; useGrant?: boolean } = {}): Promise<void> {
    const k = this.key(rec.orgId, rec.id);
    if (this.rows.has(k)) throw new Error(`attempt ${rec.id} exists`);
    const running = ['preparing', 'in-progress', 'grading'];
    if ([...this.rows.values()].some((r) => r.orgId === rec.orgId && r.userId === rec.userId && r.examId === rec.examId && running.includes(r.phase))) throw new RunningAttemptExists();
    if (opts.useGrant) {
      const g = this.grants.find((x) => x.orgId === rec.orgId && x.userId === rec.userId && x.examId === rec.examId && !x.usedAt);
      if (g) Object.assign(g, { usedAt: rec.startedAt, usedByAttempt: rec.id });
    }
    this.rows.set(k, clone(rec));
    if (opts.audit) this.audits.push({ ...clone(opts.audit), orgId: rec.orgId });
  }

  async get(orgId: string, id: string): Promise<AttemptRecord | null> {
    const r = this.rows.get(this.key(orgId, id));
    return r ? clone(r) : null;
  }

  async update(orgId: string, id: string, fn: (rec: AttemptRecord) => AttemptRecord, audit?: ExamAuditEntry): Promise<AttemptRecord> {
    const k = this.key(orgId, id);
    const r = this.rows.get(k);
    if (!r) throw new Error(`attempt ${id} not found`);
    const next = fn(clone(r));
    this.rows.set(k, clone(next));
    if (audit) this.audits.push({ ...clone(audit), orgId });
    return clone(next);
  }

  async openGrants(orgId: string, userId: string, examId: string): Promise<RetakeGrantRecord[]> {
    return this.grants.filter((g) => g.orgId === orgId && g.userId === userId && g.examId === examId && !g.usedAt).map(clone);
  }

  async addGrant(g: Omit<RetakeGrantRecord, 'id' | 'createdAt'>, audit: ExamAuditEntry): Promise<RetakeGrantRecord> {
    const rec: RetakeGrantRecord = { ...clone(g), id: `grant-${this.grants.length + 1}`, createdAt: new Date().toISOString() };
    this.grants.push(rec);
    this.audits.push({ ...clone(audit), orgId: g.orgId });
    return clone(rec);
  }

  async listByUser(orgId: string, userId: string, examId?: string): Promise<AttemptRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.orgId === orgId && r.userId === userId && (!examId || r.examId === examId))
      .sort(newestFirst)
      .map(clone);
  }

  async listByUsers(orgId: string, userIds: string[]): Promise<AttemptRecord[]> {
    const ids = new Set(userIds);
    return [...this.rows.values()].filter((r) => r.orgId === orgId && ids.has(r.userId)).sort(newestFirst).map(clone);
  }

}
