import { randomBytes, randomInt } from 'node:crypto';
import type {
  ExamAttemptPhase,
  ExamAttemptState,
  ExamAttemptSummary,
  ExamDetail,
  ExamReport,
  ExamSummary,
  ExamTaskView,
  ExamRetakeGrant,
  ExamTerminalTarget,
  TeamExamMember,
  TeamExamReadiness,
} from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, type AuthzTarget } from '../authz.js';
import type { Content } from '../content/load.js';
import { HttpError, notFound } from '../errors.js';
import { ConflictError } from '../kube/cluster.js';
import { LABEL_LEARNER, LABEL_MANAGED_BY, LABEL_ORG, LABS_API_VERSION, MANAGED_BY } from '../kube/types.js';
import { labelValue } from '../sessions/service.js';
import { examDomain, examRules, objectives, retakePolicy, type CatalogExam, type ExamCatalog } from './catalog.js';
import type { ExamCompiler } from './compile.js';
import { skillEvidence, type ExamEvidenceSink } from './evidence.js';
import type { ExamCluster, ExamSession } from './kube.js';
import { counted, isActive, retakeStatus } from './policy.js';
import { RunningAttemptExists, type AttemptRecord, type ExamAuditEntry, type ExamStore } from './store.js';

export const LABEL_EXAM_ID = 'labs.cloudtrain.dev/exam-id';

/** Teams and people as the authz layer sees them (PgTeamDirectory: teams + team_members, cohort_members). */
export interface TeamDirectory {
  /**
   * The team (default: the principal's first managed team) with its members,
   * or null when the principal may not read its progress (progress.read.team
   * on that team).
   */
  team(principal: Principal, teamId?: string): Promise<{ id: string; name: string; members: { userId: string; name: string }[] } | null>;
  /** A person of the principal's org as an authz target (their teams and cohorts); null when not in the org. */
  subject(principal: Principal, userId: string): Promise<Extract<AuthzTarget, { kind: 'user' }> | null>;
}

export interface ExamServiceOptions {
  /** Extra labels on every ExamSession (e.g. a scoped manager's session selector). */
  sessionLabels?: Record<string, string>;
  /** Override every exam's duration (dev/demo only). */
  durationMinutes?: number;
  now?: () => Date;
}

const PHASES: Record<string, ExamAttemptPhase> = {
  Pending: 'preparing',
  Provisioning: 'preparing',
  InProgress: 'in-progress',
  Grading: 'grading',
  Completed: 'completed',
  Failed: 'failed',
};

export const PREPARING_MESSAGE = 'Your exam environment is being prepared. The timer starts when it is ready.';
const LOST_MESSAGE = 'The exam environment is no longer available. This attempt is not scored and does not count.';
const VOID_MESSAGE = 'This attempt was ended by an administrator. It is not scored and does not count against your retakes.';

const auditOf = (p: Principal, action: ExamAuditEntry['action'], targetType: ExamAuditEntry['targetType'], targetId: string, details: Record<string, unknown>, ip?: string, targetLabel?: string): ExamAuditEntry => ({
  actorId: p.sub,
  actorName: p.name,
  ...(ip ? { ip } : {}),
  action,
  targetType,
  targetId,
  ...(targetLabel ? { targetLabel } : {}),
  details,
});

/** Exam attempt names: "exam-<10 hex>" (short: environment names derive from it). */
export function attemptName(): string {
  return `exam-${randomBytes(5).toString('hex')}`;
}

const num = (s: string | undefined) => (s === undefined || s === '' ? 0 : Number(s));

/**
 * Exam simulations for the web app: catalog, retake policy, attempts backed
 * by ExamSessions, flags, submit, reports, learner-model evidence and the
 * manager's team readiness. Every method takes the caller and only touches
 * the caller's own attempts (team readiness: members of a team the caller
 * manages).
 */
export class ExamService {
  private readonly now: () => Date;

  constructor(
    private readonly catalog: ExamCatalog,
    private readonly content: Content,
    private readonly cluster: ExamCluster,
    private readonly compiler: ExamCompiler,
    private readonly store: ExamStore,
    private readonly evidence: ExamEvidenceSink,
    private readonly teams: TeamDirectory,
    private readonly opts: ExamServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  private exam(examId: string): CatalogExam {
    const ex = this.catalog.exams.get(examId);
    if (!ex) throw notFound('Exam');
    return ex;
  }

  private duration(ex: CatalogExam): number {
    return this.opts.durationMinutes ?? ex.def.durationMinutes;
  }

  /* ----------------------------------------------------------- catalog */

  private async summary(p: Principal, ex: CatalogExam, attempts?: AttemptRecord[]): Promise<ExamSummary> {
    const mine = attempts ?? (await this.syncAll(p, ex.def.id));
    const def = ex.def;
    const policy = retakePolicy(def);
    const grants = (await this.store.openGrants(p.orgId, p.sub, def.id)).length;
    const graded = mine.filter((a) => a.phase === 'completed' && a.score !== undefined);
    const best = graded.length ? Math.max(...graded.map((a) => a.score!)) : undefined;
    return {
      id: def.id,
      title: def.title,
      domain: examDomain(def),
      alignsTo: def.alignsTo,
      disclaimer: def.disclaimer,
      format: def.format,
      durationMinutes: this.duration(ex),
      passMark: def.passMark,
      ...(def.passMarkNote ? { passMarkNote: def.passMarkNote } : {}),
      taskCount: def.taskCount,
      environment: def.environment,
      availability: ex.availability,
      ...(ex.availabilityNote ? { availabilityNote: ex.availabilityNote } : {}),
      rules: examRules(def),
      retakePolicy: policy,
      retake: retakeStatus(policy, mine, this.now(), grants),
      ...(mine[0] ? { lastAttempt: this.attemptSummary(mine[0]) } : {}),
      ...(best !== undefined ? { bestScore: best } : {}),
    };
  }

  async list(p: Principal): Promise<ExamSummary[]> {
    const all = await this.store.listByUser(p.orgId, p.sub);
    const out: ExamSummary[] = [];
    for (const ex of this.catalog.exams.values()) {
      const mine = await this.syncList(all.filter((a) => a.examId === ex.def.id));
      out.push(await this.summary(p, ex, mine));
    }
    // Available first, then by title.
    return out.sort((a, b) => (a.availability === b.availability ? a.title.localeCompare(b.title) : a.availability === 'available' ? -1 : 1));
  }

  async detail(p: Principal, examId: string): Promise<ExamDetail> {
    const ex = this.exam(examId);
    const mine = await this.syncAll(p, examId);
    const s = await this.summary(p, ex, mine);
    const rules = s.rules;
    const checklist = [
      `You have ${s.durationMinutes} minutes for ${s.taskCount} tasks on one timer that starts when your environment is ready.`,
      rules.anyOrder ? 'Tasks can be done in any order; flag a task to come back to it.' : 'Work through the tasks in order.',
      'There are no hints and no validate button. Your work is graded once, after the exam ends.',
      ...(rules.docsAllowed ? [`Documentation: ${rules.docsAllowed}.`] : []),
      s.environment === 'shared'
        ? 'All tasks share one environment. Each task names the context or host to use; changes outside a task can cost points elsewhere.'
        : 'Each task has its own environment.',
      ...(rules.rebootBeforeGrade ? ['Machines are rebooted before grading: only configuration that persists scores.'] : []),
      ...(rules.idempotencyRerun ? ['Saved automation is run again after the exam and must report no changes.'] : []),
      'When time is up the environment closes and your work is submitted automatically.',
    ];
    return {
      ...s,
      ...(ex.def.description ? { description: ex.def.description } : {}),
      ...(ex.def.simulationNote ? { simulationNote: ex.def.simulationNote } : {}),
      objectives: objectives(this.catalog, ex),
      reportIncludes: ex.def.scoreReport.includes ?? [],
      checklist,
      attempts: mine.map((a) => this.attemptSummary(a)),
    };
  }

  /* ----------------------------------------------------------- attempts */

  private attemptSummary(a: AttemptRecord): ExamAttemptSummary {
    return {
      id: a.id,
      examId: a.examId,
      examTitle: a.examTitle,
      phase: a.phase,
      startedAt: a.startedAt,
      ...(a.timerStartedAt ? { timerStartedAt: a.timerStartedAt } : {}),
      ...(a.deadline ? { deadline: a.deadline } : {}),
      ...(a.submittedAt ? { submittedAt: a.submittedAt } : {}),
      ...(a.completedAt ? { completedAt: a.completedAt } : {}),
      ...(a.score !== undefined ? { score: a.score } : {}),
      ...(a.passed !== undefined ? { passed: a.passed } : {}),
      number: a.number,
      counted: counted(a),
      ...(a.voided ? { voided: { at: a.voided.at, ...(a.voided.reason ? { reason: a.voided.reason } : {}) } } : {}),
    };
  }

  async mine(p: Principal, examId?: string): Promise<ExamAttemptSummary[]> {
    const rows = await this.syncList(await this.store.listByUser(p.orgId, p.sub, examId));
    return rows.map((a) => this.attemptSummary(a));
  }

  private async syncAll(p: Principal, examId: string): Promise<AttemptRecord[]> {
    return this.syncList(await this.store.listByUser(p.orgId, p.sub, examId));
  }

  /** Brings running attempts up to date with their ExamSessions. */
  private async syncList(rows: AttemptRecord[]): Promise<AttemptRecord[]> {
    const out: AttemptRecord[] = [];
    for (const r of rows) out.push(isActive(r) || (r.phase === 'completed' && !r.report) ? (await this.sync(r)).rec : r);
    return out;
  }

  /**
   * Starts an attempt. The retake policy (curriculum `retakePolicy`) is
   * enforced here; the attempt row is written first, so the store's
   * one-running-attempt guarantee (a unique index in Postgres) also holds
   * under concurrent starts. Audited as exam.start.
   */
  async start(p: Principal, examId: string, ip?: string): Promise<ExamAttemptState> {
    const ex = this.exam(examId);
    if (ex.availability !== 'available') throw new HttpError(409, ex.availabilityNote ?? 'This exam simulation is not available yet.');
    const mine = await this.syncAll(p, examId);
    const policy = retakePolicy(ex.def);
    const grants = (await this.store.openGrants(p.orgId, p.sub, examId)).length;
    const status = retakeStatus(policy, mine, this.now(), grants);
    if (!status.allowed) throw new HttpError(409, status.reason ?? 'You cannot start this exam now.', { code: 'conflict', details: { ...(status.nextAllowedAt ? { nextAllowedAt: status.nextAllowedAt } : {}), ...(status.activeAttemptId ? { activeAttemptId: status.activeAttemptId } : {}) } });

    const avoid = policy.freshDraw ? Array.from(new Set(mine.filter(counted).flatMap((a) => a.tasks.map((t) => t.taskId)))) : [];
    const name = attemptName();
    const seed = randomInt(1, 2 ** 31 - 1);
    const minutes = this.duration(ex);
    const rec: AttemptRecord = {
      id: name,
      orgId: p.orgId,
      userId: p.sub,
      userName: p.name,
      examId,
      examTitle: ex.def.title,
      number: mine.length + 1,
      seed,
      phase: 'preparing',
      startedAt: this.now().toISOString(),
      durationMinutes: minutes,
      tasks: [],
      flagged: [],
      evidenceRecorded: false,
    };
    try {
      await this.store.create(rec, {
        audit: auditOf(p, 'exam.start', 'exam_attempt', name, { examId, number: rec.number, ...(status.viaGrant ? { retakeGrant: true } : {}), ...(avoid.length ? { avoidTasks: avoid.length } : {}) }, ip, ex.def.title),
        useGrant: !!status.viaGrant,
      });
    } catch (e) {
      if (e instanceof RunningAttemptExists) throw new HttpError(409, e.message, { code: 'conflict' });
      throw e;
    }

    try {
      const compiled = await this.compiler.compile(examId, ex.file);
      for (const t of compiled.tasks) {
        if (!(await this.cluster.getLabTemplate(t.metadata.name))) {
          try {
            await this.cluster.createLabTemplate(t);
          } catch (e) {
            if (!(e instanceof ConflictError)) throw e;
          }
        }
      }
      if (!(await this.cluster.getExamTemplate(compiled.exam.metadata.name))) {
        try {
          await this.cluster.createExamTemplate(compiled.exam);
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
        }
      }
      const es: ExamSession = {
        apiVersion: LABS_API_VERSION,
        kind: 'ExamSession',
        metadata: {
          name,
          // Configured labels win (e.g. a scoped manager's selector replacing
          // managed-by): the orchestrator copies them onto the environment
          // LabSessions, which exactly one manager must reconcile.
          labels: {
            [LABEL_EXAM_ID]: labelValue(examId),
            [LABEL_LEARNER]: labelValue(p.sub),
            [LABEL_ORG]: labelValue(p.orgId),
            [LABEL_MANAGED_BY]: MANAGED_BY,
            ...(this.opts.sessionLabels ?? {}),
          },
        },
        spec: {
          examTemplateRef: { name: compiled.exam.metadata.name },
          candidate: { id: p.sub, org: p.orgId },
          seed,
          ...(avoid.length ? { avoidTasks: avoid } : {}),
          ...(this.opts.durationMinutes ? { duration: `${this.opts.durationMinutes}m` } : {}),
        },
      };
      await this.cluster.createExamSession(es);
    } catch (e) {
      // The platform could not start it: not counted, the person may start again.
      await this.store.update(rec.orgId, rec.id, (r) => ({ ...r, phase: 'failed', completedAt: this.now().toISOString() }));
      throw e;
    }
    return this.state(rec, null);
  }

  private async owned(p: Principal, id: string): Promise<AttemptRecord> {
    const rec = await this.store.get(p.orgId, id);
    if (!rec || rec.userId !== p.sub) throw notFound('Attempt');
    return rec;
  }

  /** Reads the ExamSession and folds it into the record (persisting changes, report and evidence once). */
  private async sync(rec: AttemptRecord): Promise<{ rec: AttemptRecord; es: ExamSession | null }> {
    if (rec.voided) return { rec, es: null };
    const es = await this.cluster.getExamSession(rec.id);
    if (!es) {
      if (isActive(rec)) {
        rec = await this.store.update(rec.orgId, rec.id, (r) => ({ ...r, phase: 'failed', completedAt: this.now().toISOString() }));
      }
      return { rec, es: null };
    }
    const st = es.status ?? {};
    const phase = PHASES[st.phase ?? 'Pending'] ?? 'preparing';
    const ex = this.catalog.exams.get(rec.examId);
    let report: ExamReport | undefined = rec.report;
    if (phase === 'completed' && !report && st.report) report = this.toReport(rec, es, ex);
    const tasks =
      rec.tasks.length || !st.tasks?.length
        ? rec.tasks
        : st.tasks.map((t) => ({ index: t.index, taskId: t.id, objective: t.objective, title: t.title, weight: num(t.weight) }));
    const next: AttemptRecord = {
      ...rec,
      phase,
      tasks,
      ...(st.startedAt ? { timerStartedAt: st.startedAt } : {}),
      ...(st.deadline ? { deadline: st.deadline } : {}),
      ...(st.submittedAt ? { submittedAt: st.submittedAt } : {}),
      ...(st.completedAt ? { completedAt: st.completedAt } : {}),
      ...(report ? { report, score: report.score, passed: report.passed } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(rec)) {
      rec = await this.store.update(rec.orgId, rec.id, () => next);
    }
    if (rec.report && !rec.evidenceRecorded) {
      await this.recordEvidence(rec);
      rec = await this.store.update(rec.orgId, rec.id, (r) => ({ ...r, evidenceRecorded: true }));
    }
    return { rec, es };
  }

  private async recordEvidence(rec: AttemptRecord): Promise<void> {
    const report = rec.report!;
    await this.evidence.record({
      orgId: rec.orgId,
      userId: rec.userId,
      attemptId: rec.id,
      examId: rec.examId,
      at: new Date(report.gradedAt),
      startedAt: new Date(rec.timerStartedAt ?? rec.startedAt),
      tasks: report.tasks.map((t) => ({
        index: t.index,
        taskId: t.taskId,
        difficulty: this.content.labs.get(t.taskId)?.lab.metadata.difficulty ?? 'medium',
        score: t.score,
        checks: t.checks.map((c) => ({ id: c.id, passed: c.passed, weight: c.weight, skills: c.skills })),
      })),
    });
  }

  private toReport(rec: AttemptRecord, es: ExamSession, ex: CatalogExam | undefined): ExamReport {
    const st = es.status!;
    const r = st.report!;
    const names = this.catalog.objectiveNames;
    const tasks = r.tasks.map((t) => ({
      index: t.index,
      taskId: t.id,
      title: t.title,
      objective: t.objective,
      weight: num(t.weight),
      outcome: t.outcome,
      score: num(t.score),
      checks: t.checks.map((c) => ({
        id: c.id,
        ...(c.description ? { description: c.description } : {}),
        passed: c.passed,
        weight: c.weight ? num(c.weight) : 1,
        skills: c.skills ?? [],
        message: c.message ?? (c.passed ? 'passed' : 'not satisfied yet'),
        ...(c.failedAfterReboot ? { failedAfterReboot: true } : {}),
        ...(c.failedOnRerun ? { failedOnRerun: true } : {}),
      })),
    }));
    const objectivesOut = r.objectives.map((o) => ({ id: o.id, ...(names.get(o.id) ? { name: names.get(o.id)! } : {}), weight: num(o.weight), tasks: o.tasks, score: num(o.score) }));
    const threshold = Math.max(num(r.passMark), 70);
    const recommendations = objectivesOut
      .filter((o) => o.score < threshold)
      .sort((a, b) => a.score - b.score)
      .map((o) => ({ objective: o.id, labIds: (this.catalog.labsByObjective.get(o.id) ?? []).slice(0, 3) }))
      .filter((x) => x.labIds.length > 0);
    const started = st.startedAt ? Date.parse(st.startedAt) : undefined;
    const ended = st.frozenAt ? Date.parse(st.frozenAt) : undefined;
    const report: ExamReport = {
      attemptId: rec.id,
      examId: rec.examId,
      examTitle: rec.examTitle,
      disclaimer: ex?.def.disclaimer ?? '',
      score: num(r.score),
      passMark: num(r.passMark),
      passed: r.passed,
      partialCredit: r.partialCredit ?? 'per-check',
      gradedAt: r.gradedAt,
      ...(st.startedAt ? { timerStartedAt: st.startedAt } : {}),
      ...(st.submittedAt ? { submittedAt: st.submittedAt } : {}),
      ...(started !== undefined && ended !== undefined ? { minutesUsed: Math.max(0, Math.round((ended - started) / 60_000)) } : {}),
      durationMinutes: rec.durationMinutes,
      passes: r.passes ?? ['initial'],
      objectives: objectivesOut,
      tasks,
      skills: [],
      recommendations,
    };
    report.skills = skillEvidence(report);
    return report;
  }

  private terminals(es: ExamSession | null, rec: AttemptRecord): ExamTerminalTarget[] {
    if (!es || rec.phase !== 'in-progress' || es.status?.frozenAt) return [];
    const out: ExamTerminalTarget[] = [];
    const envs = es.status?.environments ?? [];
    for (const env of envs) {
      const contexts = Array.from(new Set((es.status?.tasks ?? []).filter((t) => t.environment === env.name).flatMap((t) => t.contexts ?? [])));
      const seen = new Set<string>();
      const nodes = (env.endpoints ?? []).map((e) => e.node).filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
      nodes.sort((a, b) => (a === env.entryNode ? -1 : b === env.entryNode ? 1 : a.localeCompare(b)));
      for (const node of nodes) {
        const entry = node === env.entryNode;
        const prefix = envs.length > 1 ? `Task ${env.tasks.join(', ')}: ` : '';
        out.push({
          id: `${env.name}/${node}`,
          node,
          label: `${prefix}${node}${entry && contexts.length ? ` (contexts: ${contexts.join(', ')})` : ''}`,
          entry: entry && out.every((t) => !t.entry),
          ...(envs.length > 1 ? { task: env.tasks[0]! } : {}),
        });
      }
    }
    return out;
  }

  private state(rec: AttemptRecord, es: ExamSession | null): ExamAttemptState {
    const ex = this.catalog.exams.get(rec.examId);
    const st = es?.status ?? {};
    const tasks: ExamTaskView[] = (st.tasks ?? []).map((t) => ({
      index: t.index,
      title: t.title,
      objective: t.objective,
      ...(this.catalog.objectiveNames.get(t.objective) ? { objectiveName: this.catalog.objectiveNames.get(t.objective)! } : {}),
      weight: num(t.weight),
      statement: t.statement,
      contexts: t.contexts ?? [],
      nodes: t.nodes ?? [],
      flagged: rec.flagged.includes(t.index),
      visited: false,
    }));
    const envs = st.environments ?? [];
    const ready = envs.filter((e) => e.phase === 'Ready' || e.phase === 'Grading').length;
    const message = rec.voided ? VOID_MESSAGE : rec.phase === 'failed' && !es ? LOST_MESSAGE : (st.message ?? (rec.phase === 'preparing' ? PREPARING_MESSAGE : ''));
    return {
      ...this.attemptSummary(rec),
      serverTime: this.now().toISOString(),
      durationMinutes: rec.durationMinutes,
      message,
      rules: ex ? examRules(ex.def) : { timer: 'single', anyOrder: true, flagForReview: true, rebootBeforeGrade: false, idempotencyRerun: false, partialCredit: 'per-check' },
      disclaimer: ex?.def.disclaimer ?? '',
      tasks,
      terminals: this.terminals(es, rec),
      ...(rec.phase === 'preparing' ? { preparingProgress: envs.length ? ready / envs.length : 0 } : {}),
      reportReady: !!rec.report,
    };
  }

  async attempt(p: Principal, id: string): Promise<ExamAttemptState> {
    const { rec, es } = await this.sync(await this.owned(p, id));
    return this.state(rec, es);
  }

  /** Terminal access check: the attempt is running and the target belongs to it. */
  async terminalTarget(p: Principal, id: string, target: string): Promise<{ environment: string; node: string }> {
    const { rec, es } = await this.sync(await this.owned(p, id));
    if (rec.phase !== 'in-progress' || !es || es.status?.frozenAt) throw new HttpError(409, 'The exam is not in progress; the environment is closed.');
    const t = this.terminals(es, rec).find((x) => x.id === target) ?? (target ? undefined : this.terminals(es, rec).find((x) => x.entry));
    if (!t) throw new HttpError(404, 'No such terminal in this attempt');
    const [environment, node] = t.id.split('/') as [string, string];
    return { environment, node };
  }

  async flag(p: Principal, id: string, index: number, flagged: boolean): Promise<ExamAttemptState> {
    const { rec, es } = await this.sync(await this.owned(p, id));
    const ex = this.catalog.exams.get(rec.examId);
    if (ex && !examRules(ex.def).flagForReview) throw new HttpError(409, 'This exam does not support flags.');
    if (rec.phase !== 'in-progress') throw new HttpError(409, 'Flags can only change while the exam is in progress.');
    if (!(es?.status?.tasks ?? []).some((t) => t.index === index)) throw notFound('Task');
    const next = await this.store.update(rec.orgId, rec.id, (r) => ({
      ...r,
      flagged: flagged ? Array.from(new Set([...r.flagged, index])).sort((a, b) => a - b) : r.flagged.filter((i) => i !== index),
    }));
    return this.state(next, es);
  }

  async submit(p: Principal, id: string, ip?: string): Promise<ExamAttemptState> {
    const { rec } = await this.sync(await this.owned(p, id));
    if (rec.phase === 'grading' || rec.phase === 'completed') return this.attempt(p, id);
    if (rec.phase !== 'in-progress') throw new HttpError(409, rec.phase === 'preparing' ? 'The exam has not started yet.' : 'This attempt has ended.');
    await this.cluster.patchExamSession(rec.id, { spec: { submit: true } });
    const at = this.now().toISOString();
    await this.store.update(rec.orgId, rec.id, (r) => ({ ...r, submittedAt: r.submittedAt ?? at }), auditOf(p, 'exam.submit', 'exam_attempt', rec.id, { examId: rec.examId, flagged: rec.flagged.length, ...(rec.deadline ? { secondsLeft: Math.max(0, Math.round((Date.parse(rec.deadline) - Date.parse(at)) / 1000)) } : {}) }, ip, rec.examTitle));
    return this.attempt(p, id);
  }

  /* ---------------------------------------------------- interventions */

  /**
   * Ends someone's running attempt (session.control on the candidate: an
   * instructor of their cohort, an org admin). The ExamSession and its
   * environments are deleted; the attempt is not scored and never counts.
   * Audited as exam.void.
   */
  async void(p: Principal, id: string, reason: string | undefined, ip?: string): Promise<ExamAttemptSummary> {
    const found = await this.store.get(p.orgId, id);
    if (!found) throw notFound('Attempt');
    const subject = await this.teams.subject(p, found.userId);
    if (!subject) throw notFound('Attempt');
    authorize(p, 'session.control', subject);
    const { rec } = await this.sync(found);
    if (!isActive(rec)) throw new HttpError(409, 'Only a running attempt can be voided.', { code: 'conflict' });
    await this.cluster.deleteExamSession(rec.id);
    const at = this.now().toISOString();
    const why = reason?.trim().slice(0, 500) || undefined;
    const next = await this.store.update(
      rec.orgId,
      rec.id,
      (r) => ({ ...r, phase: 'failed', completedAt: at, voided: { at, by: p.sub, ...(why ? { reason: why } : {}) } }),
      auditOf(p, 'exam.void', 'exam_attempt', rec.id, { examId: rec.examId, candidate: rec.userId, phase: rec.phase, ...(why ? { reason: why } : {}) }, ip, `${rec.examTitle} · ${rec.userName}`),
    );
    return this.attemptSummary(next);
  }

  /**
   * Grants one more attempt that ignores the cooldown and the 30-day cap
   * (assignment.manage on the candidate: their manager or instructor, an org
   * admin). Audited as exam.retake_grant.
   */
  async grantRetake(p: Principal, examId: string, userId: string, reason: string | undefined, ip?: string): Promise<ExamRetakeGrant> {
    const ex = this.exam(examId);
    if (!userId) throw new HttpError(422, 'userId is required', { code: 'invalid' });
    const subject = await this.teams.subject(p, userId);
    if (!subject) throw notFound('Member');
    authorize(p, 'assignment.manage', subject);
    const why = reason?.trim().slice(0, 500) || undefined;
    const g = await this.store.addGrant(
      { orgId: p.orgId, userId, examId, grantedBy: p.sub, ...(why ? { reason: why } : {}) },
      auditOf(p, 'exam.retake_grant', 'user', userId, { examId, ...(why ? { reason: why } : {}) }, ip, ex.def.title),
    );
    return { id: g.id, examId, userId, grantedBy: g.grantedBy, ...(g.reason ? { reason: g.reason } : {}), createdAt: g.createdAt };
  }

  async report(p: Principal, id: string): Promise<ExamReport> {
    const { rec } = await this.sync(await this.owned(p, id));
    if (!rec.report) throw new HttpError(409, rec.phase === 'failed' ? 'This attempt was not scored.' : 'The report is not ready yet.');
    return rec.report;
  }

  /* ---------------------------------------------------------- manager */

  async teamReadiness(p: Principal, teamId?: string): Promise<TeamExamReadiness> {
    const team = await this.teams.team(p, teamId);
    if (!team) throw new HttpError(403, 'You do not manage this team.');
    const rows = await this.store.listByUsers(p.orgId, team.members.map((m) => m.userId));
    const exams = [...this.catalog.exams.values()].filter((ex) => ex.availability === 'available' || rows.some((r) => r.examId === ex.def.id));
    return {
      team: { id: team.id, name: team.name },
      exams: exams.map((ex) => {
        const passMark = ex.def.passMark;
        const members: TeamExamMember[] = team.members.map((m) => {
          const mine = rows.filter((r) => r.userId === m.userId && r.examId === ex.def.id && counted(r));
          const graded = mine.filter((r) => r.score !== undefined);
          const last = graded[0];
          const best = graded.length ? Math.max(...graded.map((r) => r.score!)) : undefined;
          const weakest = last?.report?.objectives.slice().sort((a, b) => a.score - b.score)[0];
          const readiness: TeamExamMember['readiness'] =
            best === undefined ? 'not-attempted' : best >= passMark + 5 ? 'ready' : best >= passMark - 10 ? 'close' : 'not-ready';
          return {
            userId: m.userId,
            name: m.name,
            attempts: mine.length,
            ...(best !== undefined ? { bestScore: best } : {}),
            ...(last?.score !== undefined ? { lastScore: last.score } : {}),
            ...(mine[0] ? { lastAttemptAt: mine[0].startedAt } : {}),
            passed: graded.some((r) => r.passed),
            ...(weakest ? { weakestObjective: { id: weakest.id, ...(weakest.name ? { name: weakest.name } : {}), score: weakest.score } } : {}),
            readiness,
            ...(mine.find(isActive) ? { activeAttemptId: mine.find(isActive)!.id } : {}),
          };
        });
        const attempted = members.filter((m) => m.lastScore !== undefined);
        return {
          examId: ex.def.id,
          examTitle: ex.def.title,
          passMark,
          members,
          ...(attempted.length ? { averageScore: Math.round((attempted.reduce((a, m) => a + m.lastScore!, 0) / attempted.length) * 10) / 10 } : {}),
          passRate: members.length ? members.filter((m) => m.passed).length / members.length : 0,
        };
      }),
    };
  }
}
