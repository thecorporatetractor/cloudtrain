import type { Selectable } from 'kysely';
import type { ExamReport } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { can } from '../authz.js';
import type { Content } from '../content/load.js';
import { withTenant, type Db, type Tx } from '../db/index.js';
import type { ExamAttemptsTable } from '../db/schema.js';
import { notFound } from '../errors.js';
import { endAttempt, recordRun } from '../learner/learning.js';
import { audit } from '../platform/audit.js';
import type { ExamEvidenceInput, ExamEvidenceSink } from './evidence.js';
import type { TeamDirectory } from './service.js';
import { RunningAttemptExists, type AttemptRecord, type AttemptTask, type ExamAuditEntry, type ExamStore, type RetakeGrantRecord } from './store.js';

/*
 * Postgres adapters of the exam engine (tables: src/db/migrations/0003_exams.ts).
 * Every query runs inside withTenant (RLS on app.org_id), so one org never
 * sees another org's attempts, results or grants.
 */

type Row = Selectable<ExamAttemptsTable> & { user_name: string | null };

const iso = (d: Date | string | null | undefined): string | undefined => (d ? new Date(d).toISOString() : undefined);
const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

function toRecord(r: Row): AttemptRecord {
  const timer = iso(r.timer_started_at);
  const deadline = iso(r.deadline);
  const submitted = iso(r.submitted_at);
  const completed = iso(r.completed_at);
  const voidedAt = iso(r.voided_at);
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    userName: r.user_name ?? r.user_id,
    examId: r.exam_id,
    examTitle: r.exam_title,
    number: r.number,
    seed: Number(r.seed),
    phase: r.phase,
    startedAt: iso(r.started_at)!,
    ...(timer ? { timerStartedAt: timer } : {}),
    ...(deadline ? { deadline } : {}),
    ...(submitted ? { submittedAt: submitted } : {}),
    ...(completed ? { completedAt: completed } : {}),
    durationMinutes: r.duration_minutes,
    tasks: json<AttemptTask[]>(r.tasks) ?? [],
    flagged: (r.flagged ?? []).map(Number),
    ...(r.score !== null ? { score: Number(r.score) } : {}),
    ...(r.passed !== null ? { passed: r.passed } : {}),
    ...(r.report ? { report: json<ExamReport>(r.report) } : {}),
    evidenceRecorded: r.evidence_recorded,
    ...(voidedAt ? { voided: { at: voidedAt, by: r.voided_by ?? '', ...(r.void_reason ? { reason: r.void_reason } : {}) } } : {}),
  };
}

function toColumns(rec: AttemptRecord) {
  return {
    phase: rec.phase,
    timer_started_at: rec.timerStartedAt ?? null,
    deadline: rec.deadline ?? null,
    submitted_at: rec.submittedAt ?? null,
    completed_at: rec.completedAt ?? null,
    duration_minutes: rec.durationMinutes,
    tasks: JSON.stringify(rec.tasks),
    flagged: rec.flagged,
    score: rec.score ?? null,
    passed: rec.passed ?? null,
    report: rec.report ? JSON.stringify(rec.report) : null,
    evidence_recorded: rec.evidenceRecorded,
    voided_at: rec.voided?.at ?? null,
    voided_by: rec.voided?.by || null,
    void_reason: rec.voided?.reason ?? null,
  };
}

async function writeAudit(tx: Tx, orgId: string, a: ExamAuditEntry | undefined): Promise<void> {
  if (!a) return;
  await audit(tx, { orgId, actorId: a.actorId, actorName: a.actorName, ip: a.ip }, a.action, a.targetType, a.targetId, a.details, a.targetLabel);
}

const isUniqueViolation = (e: unknown, constraint: string) => {
  const err = e as { code?: string; constraint?: string };
  return err.code === '23505' && err.constraint === constraint;
};

export class PgExamStore implements ExamStore {
  constructor(private readonly db: Db) {}

  private tx<T>(orgId: string, actor: string | null | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { orgId, userId: actor ?? null }, fn);
  }

  private select(tx: Tx) {
    return tx.selectFrom('exam_attempts as a').leftJoin('users as u', 'u.id', 'a.user_id').selectAll('a').select('u.name as user_name');
  }

  async create(rec: AttemptRecord, opts: { audit?: ExamAuditEntry; useGrant?: boolean } = {}): Promise<void> {
    try {
      await this.tx(rec.orgId, rec.userId, async (tx) => {
        await tx
          .insertInto('exam_attempts')
          .values({
            org_id: rec.orgId,
            id: rec.id,
            user_id: rec.userId,
            exam_id: rec.examId,
            exam_title: rec.examTitle,
            number: rec.number,
            seed: rec.seed,
            started_at: rec.startedAt,
            ...toColumns(rec),
          })
          .execute();
        if (opts.useGrant) {
          const g = await tx.selectFrom('exam_retake_grants').select('id').where('user_id', '=', rec.userId).where('exam_id', '=', rec.examId).where('used_at', 'is', null).orderBy('created_at').limit(1).forUpdate().executeTakeFirst();
          if (g) await tx.updateTable('exam_retake_grants').set({ used_at: rec.startedAt, used_by_attempt: rec.id }).where('id', '=', g.id).execute();
        }
        await writeAudit(tx, rec.orgId, opts.audit);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'exam_attempts_one_running')) throw new RunningAttemptExists();
      throw e;
    }
  }

  async get(orgId: string, id: string): Promise<AttemptRecord | null> {
    const r = await this.tx(orgId, null, (tx) => this.select(tx).where('a.id', '=', id).executeTakeFirst());
    return r ? toRecord(r as unknown as Row) : null;
  }

  async update(orgId: string, id: string, fn: (rec: AttemptRecord) => AttemptRecord, a?: ExamAuditEntry): Promise<AttemptRecord> {
    return this.tx(orgId, a?.actorId, async (tx) => {
      const row = await this.select(tx).where('a.id', '=', id).forUpdate('a').executeTakeFirst();
      if (!row) throw notFound('Attempt');
      const prev = toRecord(row as unknown as Row);
      const next = fn(structuredClone(prev));
      await tx.updateTable('exam_attempts').set(toColumns(next)).where('id', '=', id).execute();
      if (next.report && !prev.report) {
        const results = next.report.tasks.map((t) => ({
          org_id: orgId,
          attempt_id: id,
          task_index: t.index,
          task_id: t.taskId,
          objective: t.objective,
          weight: t.weight,
          outcome: t.outcome,
          score: t.score,
          checks: JSON.stringify(t.checks),
        }));
        if (results.length) await tx.insertInto('exam_task_results').values(results).onConflict((oc) => oc.columns(['org_id', 'attempt_id', 'task_index']).doNothing()).execute();
      }
      await writeAudit(tx, orgId, a);
      return next;
    });
  }

  async listByUser(orgId: string, userId: string, examId?: string): Promise<AttemptRecord[]> {
    const rows = await this.tx(orgId, userId, (tx) => {
      let q = this.select(tx).where('a.user_id', '=', userId);
      if (examId) q = q.where('a.exam_id', '=', examId);
      return q.orderBy('a.started_at', 'desc').execute();
    });
    return rows.map((r) => toRecord(r as unknown as Row));
  }

  async listByUsers(orgId: string, userIds: string[]): Promise<AttemptRecord[]> {
    if (!userIds.length) return [];
    const rows = await this.tx(orgId, null, (tx) => this.select(tx).where('a.user_id', 'in', userIds).orderBy('a.started_at', 'desc').execute());
    return rows.map((r) => toRecord(r as unknown as Row));
  }

  async openGrants(orgId: string, userId: string, examId: string): Promise<RetakeGrantRecord[]> {
    const rows = await this.tx(orgId, userId, (tx) => tx.selectFrom('exam_retake_grants').selectAll().where('user_id', '=', userId).where('exam_id', '=', examId).where('used_at', 'is', null).orderBy('created_at').execute());
    return rows.map((g) => ({
      id: g.id,
      orgId: g.org_id,
      userId: g.user_id,
      examId: g.exam_id,
      grantedBy: g.granted_by ?? '',
      ...(g.reason ? { reason: g.reason } : {}),
      createdAt: g.created_at.toISOString(),
    }));
  }

  async addGrant(g: Omit<RetakeGrantRecord, 'id' | 'createdAt'>, a: ExamAuditEntry): Promise<RetakeGrantRecord> {
    return this.tx(g.orgId, a.actorId, async (tx) => {
      const row = await tx
        .insertInto('exam_retake_grants')
        .values({ org_id: g.orgId, user_id: g.userId, exam_id: g.examId, granted_by: g.grantedBy, reason: g.reason ?? null, used_at: null, used_by_attempt: null })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();
      await writeAudit(tx, g.orgId, a);
      return { ...g, id: row.id, createdAt: row.created_at.toISOString() };
    });
  }
}

/**
 * Exam results into the real learner model: one `recordRun` per graded task
 * (session `<attempt>/t<index>`, hints 0, the task's lab and checks), then the
 * lab attempt is closed. Same Glicko-style update as labs, so exam evidence
 * and lab evidence are one stream (History, skills, team heatmaps).
 */
export class PgEvidenceSink implements ExamEvidenceSink {
  constructor(
    private readonly db: Db,
    private readonly content: Content,
  ) {}

  async record(input: ExamEvidenceInput): Promise<void> {
    await withTenant(this.db, { orgId: input.orgId, userId: input.userId }, async (tx) => {
      for (const t of input.tasks) {
        const lab = this.content.labs.get(t.taskId)?.lab;
        if (!lab) continue; // a task whose lab is no longer served: the exam report still has it
        const sessionName = `${input.attemptId}/t${t.index}`;
        await recordRun(tx, {
          orgId: input.orgId,
          userId: input.userId,
          sessionName,
          lab,
          score: t.score,
          checks: t.checks.map((c) => ({ id: c.id, passed: c.passed, weight: c.weight, skills: c.skills })),
          hintsUsed: 0,
          at: input.at,
          startedAt: input.startedAt,
        });
        await endAttempt(tx, sessionName, input.at, 0);
      }
    });
  }
}

/** Managed teams from teams/team_members; people as authz targets from team_members/cohort_members. */
export class PgTeamDirectory implements TeamDirectory {
  constructor(private readonly db: Db) {}

  async team(p: Principal, teamId?: string) {
    if (!p.orgId) return null;
    return withTenant(this.db, { orgId: p.orgId, userId: p.sub }, async (tx) => {
      let id = teamId ?? p.managedTeamIds[0];
      if (!id && can(p, 'progress.read.team', { kind: 'org' })) id = (await tx.selectFrom('teams').select('id').orderBy('name').limit(1).executeTakeFirst())?.id;
      if (!id || !can(p, 'progress.read.team', { kind: 'team', teamId: id })) return null;
      const uuid = /^[0-9a-f-]{36}$/i.test(id);
      const team = uuid ? await tx.selectFrom('teams').select(['id', 'name']).where('id', '=', id).executeTakeFirst() : undefined;
      if (!team) throw notFound('Team');
      const members = await tx
        .selectFrom('team_members as tm')
        .innerJoin('users as u', 'u.id', 'tm.user_id')
        .select(['u.id as userId', 'u.name as name'])
        .where('tm.team_id', '=', id)
        .orderBy('u.name')
        .execute();
      return { id: team.id, name: team.name, members };
    });
  }

  async subject(p: Principal, userId: string) {
    if (!p.orgId) return null;
    return withTenant(this.db, { orgId: p.orgId, userId: p.sub }, async (tx) => {
      const m = await tx.selectFrom('memberships').select('user_id').where('user_id', '=', userId).executeTakeFirst();
      if (!m) return null;
      const teams = await tx.selectFrom('team_members').select('team_id').where('user_id', '=', userId).execute();
      const cohorts = await tx.selectFrom('cohort_members').select('cohort_id').where('user_id', '=', userId).execute();
      return { kind: 'user' as const, userId, teamIds: teams.map((t) => t.team_id), cohortIds: cohorts.map((c) => c.cohort_id) };
    });
  }
}
