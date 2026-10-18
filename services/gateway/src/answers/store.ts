import { sql } from 'kysely';
import type { Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { UserRef } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import type { Tx } from '../db/index.js';
import { recordQuestion, type QuestionOutcome } from '../learner/learning.js';
import { actorOf, audit } from '../platform/audit.js';
import type { PlatformService } from '../platform/service.js';
import { userRef } from '../platform/service.js';
import type { RevealRecord, ScopeRecords, SubmissionRecord } from './questions.js';

/** Whose progress a submission counts for (see migration 0005_ctf_answers). */
export interface AnswerScope {
  /** The session name (solo), or "event:<event>:<team or user>:<lab>". */
  key: string;
  sessionName: string;
  labId: string;
  eventId?: string;
  teamId?: string;
}

export interface NewSubmission extends SubmissionRecord {
  sessionName: string;
}

export interface NewReveal extends RevealRecord {
  sessionName: string;
}

/** Operations inside one serialized section of a scope (one transaction in Postgres). */
export interface ScopeOps {
  records(): Promise<ScopeRecords>;
  /** Submissions by `userId` since `since`, across every scope (rate limit). */
  submissionsSince(userId: string, since: Date): Promise<number>;
  insertSubmission(s: NewSubmission): Promise<void>;
  insertReveal(r: NewReveal): Promise<void>;
  audit(action: 'answer.submit' | 'answer.hint', targetId: string, details: Record<string, unknown>, label: string): Promise<void>;
  /** History points and skill evidence of the answering learner. */
  recordQuestion(q: Omit<QuestionOutcome, 'orgId' | 'userId' | 'sessionName'> & { lab: SourceLab }): Promise<void>;
}

export interface AnswerStore {
  /** Runs `fn` with the scope locked: concurrent submits of one scope are graded one after the other. */
  withScope<T>(p: Principal, scope: AnswerScope, ip: string | undefined, fn: (ops: ScopeOps) => Promise<T>): Promise<T>;
  /** Display names of users (team events: who solved what). */
  users(p: Principal, ids: string[]): Promise<Map<string, UserRef>>;
}

/* --------------------------------------------------------------- memory */

interface MemSubmission extends NewSubmission {
  scopeKey: string;
  orgId: string;
}
interface MemReveal extends NewReveal {
  scopeKey: string;
  orgId: string;
}

/**
 * In-memory store for gateways without the platform database (sample mode,
 * unit tests). Same semantics as the Postgres store, minus history.
 */
export class MemoryAnswerStore implements AnswerStore {
  readonly submissions: MemSubmission[] = [];
  readonly reveals: MemReveal[] = [];
  readonly auditLog: { action: string; targetId: string; details: Record<string, unknown> }[] = [];
  private chain = new Map<string, Promise<unknown>>();

  async withScope<T>(p: Principal, scope: AnswerScope, _ip: string | undefined, fn: (ops: ScopeOps) => Promise<T>): Promise<T> {
    const lockKey = `${p.orgId}|${scope.key}`;
    const prev = this.chain.get(lockKey) ?? Promise.resolve();
    const run = prev.then(() => fn(this.ops(p, scope)));
    this.chain.set(
      lockKey,
      run.catch(() => undefined),
    );
    return run;
  }

  private ops(p: Principal, scope: AnswerScope): ScopeOps {
    const mine = <T extends { scopeKey: string; orgId: string }>(xs: T[]) => xs.filter((x) => x.scopeKey === scope.key && x.orgId === p.orgId);
    return {
      records: async () => ({ submissions: mine(this.submissions).map((s) => ({ ...s })), reveals: mine(this.reveals).map((r) => ({ ...r })) }),
      submissionsSince: async (userId, since) => this.submissions.filter((s) => s.orgId === p.orgId && s.userId === userId && s.at >= since).length,
      insertSubmission: async (s) => {
        if (s.correct && this.submissions.some((x) => x.orgId === p.orgId && x.scopeKey === scope.key && x.checkId === s.checkId && x.correct)) throw new Error('already solved');
        this.submissions.push({ ...s, scopeKey: scope.key, orgId: p.orgId });
      },
      insertReveal: async (r) => {
        if (!this.reveals.some((x) => x.orgId === p.orgId && x.scopeKey === scope.key && x.checkId === r.checkId && x.index === r.index)) this.reveals.push({ ...r, scopeKey: scope.key, orgId: p.orgId });
      },
      audit: async (action, targetId, details) => {
        this.auditLog.push({ action, targetId, details });
      },
      recordQuestion: async () => undefined,
    };
  }

  async users(_p: Principal, ids: string[]): Promise<Map<string, UserRef>> {
    return new Map(ids.map((id) => [id, { id, name: id, email: '' }]));
  }
}

/* ------------------------------------------------------------- postgres */

/** Postgres store: RLS-scoped transactions of the caller's org, audit rows in the same transaction. */
export class PgAnswerStore implements AnswerStore {
  constructor(private readonly ps: PlatformService) {}

  withScope<T>(p: Principal, scope: AnswerScope, ip: string | undefined, fn: (ops: ScopeOps) => Promise<T>): Promise<T> {
    return this.ps.tx(p, async (tx) => {
      // One grader at a time per scope: attempt counting and the single solve stay consistent.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`answers|${p.orgId}|${scope.key}`}))`.execute(tx);
      return fn(this.ops(tx, p, scope, ip));
    });
  }

  private ops(tx: Tx, p: Principal, scope: AnswerScope, ip: string | undefined): ScopeOps {
    return {
      records: async () => {
        const subs = await tx
          .selectFrom('answer_submissions')
          .select(['check_id', 'user_id', 'correct', 'points', 'answer', 'submitted_at'])
          .where('scope_key', '=', scope.key)
          .orderBy('submitted_at')
          .execute();
        const rev = await tx.selectFrom('answer_hint_reveals').select(['check_id', 'hint_index', 'cost', 'user_id', 'revealed_at']).where('scope_key', '=', scope.key).execute();
        return {
          submissions: subs.map((s) => ({ checkId: s.check_id, userId: s.user_id, correct: s.correct, points: s.points, answer: s.answer, at: s.submitted_at })),
          reveals: rev.map((r) => ({ checkId: r.check_id, index: r.hint_index, cost: r.cost, userId: r.user_id, at: r.revealed_at })),
        };
      },
      submissionsSince: async (userId, since) => {
        const r = await tx
          .selectFrom('answer_submissions')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('user_id', '=', userId)
          .where('submitted_at', '>=', since)
          .executeTakeFirstOrThrow();
        return Number(r.n);
      },
      insertSubmission: async (s) => {
        await tx
          .insertInto('answer_submissions')
          .values({
            org_id: p.orgId,
            scope_key: scope.key,
            user_id: s.userId,
            session_name: s.sessionName,
            lab_id: scope.labId,
            check_id: s.checkId,
            event_id: scope.eventId ?? null,
            team_id: scope.teamId ?? null,
            answer: s.answer,
            correct: s.correct,
            points: s.points,
            submitted_at: s.at,
          })
          .execute();
      },
      insertReveal: async (r) => {
        await tx
          .insertInto('answer_hint_reveals')
          .values({
            org_id: p.orgId,
            scope_key: scope.key,
            check_id: r.checkId,
            hint_index: r.index,
            user_id: r.userId,
            session_name: r.sessionName,
            lab_id: scope.labId,
            event_id: scope.eventId ?? null,
            team_id: scope.teamId ?? null,
            cost: r.cost,
            revealed_at: r.at,
          })
          .onConflict((oc) => oc.columns(['org_id', 'scope_key', 'check_id', 'hint_index']).doNothing())
          .execute();
      },
      audit: (action, targetId, details, label) => audit(tx, actorOf(p, ip), action, 'question', targetId, details, label),
      recordQuestion: (q) => recordQuestion(tx, { ...q, orgId: p.orgId, userId: p.sub, sessionName: scope.sessionName }),
    };
  }

  async users(p: Principal, ids: string[]): Promise<Map<string, UserRef>> {
    if (!ids.length) return new Map();
    return this.ps.tx(p, async (tx) => {
      const rows = await tx.selectFrom('users').select(['id', 'name', 'email', 'title', 'avatar_url']).where('id', 'in', ids).execute();
      return new Map(rows.map((u) => [u.id, userRef(u)]));
    });
  }
}
