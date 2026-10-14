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
}

/**
 * Persistence of attempts and their per-task results. Every method is scoped
 * to an org (Postgres: RLS with app.org_id, see schema.sql). The in-memory
 * adapter serves tests and the dev gateway until the platform-api Postgres
 * adapter is wired in.
 */
export interface ExamStore {
  create(rec: AttemptRecord): Promise<void>;
  get(orgId: string, id: string): Promise<AttemptRecord | null>;
  /** Read-modify-write of one attempt (Postgres: SELECT ... FOR UPDATE in one transaction). */
  update(orgId: string, id: string, fn: (rec: AttemptRecord) => AttemptRecord): Promise<AttemptRecord>;
  /** A user's attempts, newest first, optionally for one exam. */
  listByUser(orgId: string, userId: string, examId?: string): Promise<AttemptRecord[]>;
  /** Attempts of several users (team readiness), newest first. */
  listByUsers(orgId: string, userIds: string[]): Promise<AttemptRecord[]>;
}

const clone = <T>(v: T): T => structuredClone(v);
const newestFirst = (a: AttemptRecord, b: AttemptRecord) => b.startedAt.localeCompare(a.startedAt);

export class MemoryExamStore implements ExamStore {
  private readonly rows = new Map<string, AttemptRecord>();
  private readonly key = (orgId: string, id: string) => `${orgId}\u0000${id}`;

  async create(rec: AttemptRecord): Promise<void> {
    const k = this.key(rec.orgId, rec.id);
    if (this.rows.has(k)) throw new Error(`attempt ${rec.id} exists`);
    this.rows.set(k, clone(rec));
  }

  async get(orgId: string, id: string): Promise<AttemptRecord | null> {
    const r = this.rows.get(this.key(orgId, id));
    return r ? clone(r) : null;
  }

  async update(orgId: string, id: string, fn: (rec: AttemptRecord) => AttemptRecord): Promise<AttemptRecord> {
    const k = this.key(orgId, id);
    const r = this.rows.get(k);
    if (!r) throw new Error(`attempt ${id} not found`);
    const next = fn(clone(r));
    this.rows.set(k, clone(next));
    return clone(next);
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

  /** Everyone with an attempt in the org (dev team directory). */
  async allUsers(orgId: string): Promise<{ userId: string; name: string }[]> {
    const by = new Map<string, string>();
    for (const r of this.rows.values()) if (r.orgId === orgId) by.set(r.userId, r.userName);
    return [...by].map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name));
  }
}
