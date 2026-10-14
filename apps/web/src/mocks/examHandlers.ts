import { delay, http, HttpResponse } from 'msw';
import type {
  ExamAttemptPhase,
  ExamAttemptState,
  ExamAttemptSummary,
  ExamDetail,
  ExamReport,
  ExamSummary,
  RetakeStatus,
  TeamExamMember,
  TeamExamReadiness,
} from '@/api/types';
import { drawTasks, fixtureExams, hash, MOCK_AVAILABLE, reportFor, terminalsFor, type MockTask } from './fixtures/exams';
import type { FixtureExam } from './fixtures/exams.generated';
import { teamData } from './fixtures/team';

/*
 * Mock exam API: the same routes as services/gateway src/exams/routes.ts.
 * An attempt prepares for a few seconds, runs on a real timer, and is graded
 * a few seconds after submit or time-out. Deterministic per attempt id.
 */

const PREPARE_MS = 3500;
const GRADE_MS = 3000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface MockAttempt {
  id: string;
  examId: string;
  number: number;
  phase: ExamAttemptPhase;
  startedAt: number;
  timerStartedAt?: number;
  deadline?: number;
  submittedAt?: number;
  frozenAt?: number;
  /** When grading started (the freeze was noticed); grading takes GRADE_MS from here. */
  gradeFrom?: number;
  completedAt?: number;
  tasks: MockTask[];
  flagged: Set<number>;
  report?: ExamReport;
}

const exams = new Map(fixtureExams.map((e) => [e.id, e]));
const attempts = new Map<string, MockAttempt>();
const latency = () => delay(120 + Math.random() * 180);

function seedHistory() {
  const now = Date.now();
  const past = (examId: string, id: string, daysAgo: number, number: number) => {
    const exam = exams.get(examId)!;
    const avoid = new Set([...attempts.values()].filter((a) => a.examId === examId).flatMap((a) => a.tasks.map((t) => t.taskId)));
    const start = now - daysAgo * DAY;
    const a: MockAttempt = { id, examId, number, phase: 'completed', startedAt: start, timerStartedAt: start + 60_000, flagged: new Set(), tasks: drawTasks(exam, id, avoid) };
    const used = Math.round(exam.durationMinutes * (0.78 + hash(id) * 0.2));
    a.deadline = a.timerStartedAt! + exam.durationMinutes * 60_000;
    a.submittedAt = a.timerStartedAt! + used * 60_000;
    a.frozenAt = a.submittedAt;
    a.completedAt = a.frozenAt + 90_000;
    a.report = reportFor(exam, id, number, a.tasks, { timerStartedAt: new Date(a.timerStartedAt!).toISOString(), gradedAt: new Date(a.completedAt).toISOString(), submittedAt: new Date(a.submittedAt).toISOString(), minutesUsed: used });
    attempts.set(id, a);
  };
  past('sim-k8s-admin', 'exam-3f9a1c02de', 9, 1);
  past('sim-k8s-developer', 'exam-8b21e47a90', 4, 1);
}
seedHistory();

function tick(a: MockAttempt) {
  const exam = exams.get(a.examId)!;
  const now = Date.now();
  if (a.phase === 'preparing' && now >= a.startedAt + PREPARE_MS) {
    a.phase = 'in-progress';
    a.timerStartedAt = a.startedAt + PREPARE_MS;
    a.deadline = a.timerStartedAt + exam.durationMinutes * 60_000;
  }
  if (a.phase === 'in-progress' && a.deadline !== undefined && now >= a.deadline) {
    a.phase = 'grading';
    a.frozenAt = a.deadline;
    a.gradeFrom = now;
  }
  if (a.phase === 'grading' && a.frozenAt !== undefined && now >= (a.gradeFrom ?? a.frozenAt) + GRADE_MS) {
    a.phase = 'completed';
    a.completedAt = now;
    const used = Math.max(1, Math.round((a.frozenAt - (a.timerStartedAt ?? a.startedAt)) / 60_000));
    a.report = reportFor(exam, a.id, a.number, a.tasks, {
      timerStartedAt: new Date(a.timerStartedAt!).toISOString(),
      gradedAt: new Date(now).toISOString(),
      ...(a.submittedAt ? { submittedAt: new Date(a.submittedAt).toISOString() } : {}),
      minutesUsed: used,
    });
  }
}

const iso = (t?: number) => (t === undefined ? undefined : new Date(t).toISOString());

function summary(a: MockAttempt): ExamAttemptSummary {
  tick(a);
  const exam = exams.get(a.examId)!;
  return {
    id: a.id,
    examId: a.examId,
    examTitle: exam.title,
    phase: a.phase,
    startedAt: iso(a.startedAt)!,
    ...(a.timerStartedAt ? { timerStartedAt: iso(a.timerStartedAt) } : {}),
    ...(a.deadline ? { deadline: iso(a.deadline) } : {}),
    ...(a.submittedAt ? { submittedAt: iso(a.submittedAt) } : {}),
    ...(a.completedAt ? { completedAt: iso(a.completedAt) } : {}),
    ...(a.report ? { score: a.report.score, passed: a.report.passed } : {}),
    number: a.number,
    counted: a.phase !== 'failed',
  };
}

function mine(examId?: string): MockAttempt[] {
  return [...attempts.values()].filter((a) => !examId || a.examId === examId).sort((x, y) => y.startedAt - x.startedAt);
}

function retake(exam: FixtureExam): RetakeStatus {
  const list = mine(exam.id).map((a) => (tick(a), a));
  const counted = list.filter((a) => a.phase !== 'failed');
  const recent = counted.filter((a) => Date.now() - a.startedAt < 30 * DAY);
  const freeRetakesLeft = Math.max(0, exam.retakePolicy.freeRetakes - Math.max(0, counted.length - 1));
  const base = { attemptsLast30Days: recent.length, attemptsTotal: counted.length, freeRetakesLeft };
  const active = list.find((a) => a.phase === 'preparing' || a.phase === 'in-progress' || a.phase === 'grading');
  if (active) return { ...base, allowed: false, reason: 'You have an attempt in progress. Resume it instead of starting another.', activeAttemptId: active.id };
  if (recent.length >= exam.retakePolicy.maxAttemptsPer30Days) {
    return { ...base, allowed: false, reason: `You have used all ${exam.retakePolicy.maxAttemptsPer30Days} attempts allowed in 30 days.`, nextAllowedAt: iso(recent[recent.length - 1]!.startedAt + 30 * DAY)! };
  }
  const last = counted[0];
  if (last && freeRetakesLeft === 0 && exam.retakePolicy.cooldownHours > 0) {
    const next = (last.completedAt ?? last.startedAt) + exam.retakePolicy.cooldownHours * HOUR;
    if (Date.now() < next) return { ...base, allowed: false, reason: `Retakes after the free ones wait ${exam.retakePolicy.cooldownHours} hours after your previous attempt.`, nextAllowedAt: iso(next)! };
  }
  return { ...base, allowed: true };
}

function examSummary(exam: FixtureExam): ExamSummary {
  const list = mine(exam.id);
  const graded = list.filter((a) => a.report);
  const available = MOCK_AVAILABLE.has(exam.id);
  return {
    id: exam.id,
    title: exam.title,
    domain: exam.domain,
    alignsTo: exam.alignsTo,
    disclaimer: exam.disclaimer,
    format: exam.format,
    durationMinutes: exam.durationMinutes,
    passMark: exam.passMark,
    ...(exam.passMarkNote ? { passMarkNote: exam.passMarkNote } : {}),
    taskCount: exam.taskCount,
    environment: exam.environment,
    availability: available ? 'available' : 'coming-soon',
    ...(available ? {} : { availabilityNote: `Exam tasks are still being authored for ${exam.blueprint.length} of ${exam.blueprint.length} objectives.` }),
    rules: exam.rules,
    retakePolicy: exam.retakePolicy,
    retake: retake(exam),
    ...(list[0] ? { lastAttempt: summary(list[0]) } : {}),
    ...(graded.length ? { bestScore: Math.max(...graded.map((a) => a.report!.score)) } : {}),
  };
}

function detail(exam: FixtureExam): ExamDetail {
  const s = examSummary(exam);
  const sum = exam.blueprint.filter((o) => o.tasks > 0).reduce((a, o) => a + o.weight, 0);
  const r = exam.rules;
  return {
    ...s,
    ...(exam.description ? { description: exam.description } : {}),
    ...(exam.simulationNote ? { simulationNote: exam.simulationNote } : {}),
    objectives: exam.blueprint.map((o) => ({ id: o.objective, name: o.name, weight: Math.round((1000 * o.weight) / sum) / 10, tasks: o.tasks, poolSize: o.pool.length })),
    reportIncludes: exam.reportIncludes,
    checklist: [
      `You have ${exam.durationMinutes} minutes for ${exam.taskCount} tasks on one timer that starts when your environment is ready.`,
      r.anyOrder ? 'Tasks can be done in any order; flag a task to come back to it.' : 'Work through the tasks in order.',
      'There are no hints and no validate button. Your work is graded once, after the exam ends.',
      ...(r.docsAllowed ? [`Documentation: ${r.docsAllowed}.`] : []),
      exam.environment === 'shared'
        ? 'All tasks share one environment. Each task names the context or host to use; changes outside a task can cost points elsewhere.'
        : 'Each task has its own environment.',
      ...(r.rebootBeforeGrade ? ['Machines are rebooted before grading: only configuration that persists scores.'] : []),
      ...(r.idempotencyRerun ? ['Saved automation is run again after the exam and must report no changes.'] : []),
      'When time is up the environment closes and your work is submitted automatically.',
    ],
    attempts: mine(exam.id).map(summary),
  };
}

function state(a: MockAttempt): ExamAttemptState {
  const s = summary(a);
  const exam = exams.get(a.examId)!;
  const showTasks = a.phase !== 'preparing' && a.phase !== 'failed';
  return {
    ...s,
    serverTime: new Date().toISOString(),
    durationMinutes: exam.durationMinutes,
    message:
      a.phase === 'preparing'
        ? 'Your exam environment is being prepared. The timer starts when it is ready.'
        : a.phase === 'in-progress'
          ? 'The exam is in progress.'
          : a.phase === 'grading'
            ? 'Time is up or the exam was submitted. Your work is being graded; the environment is closed.'
            : 'Your exam has been graded.',
    rules: exam.rules,
    disclaimer: exam.disclaimer,
    tasks: showTasks ? a.tasks.map((t) => ({ ...t, flagged: a.flagged.has(t.index) })) : [],
    terminals: a.phase === 'in-progress' ? terminalsFor(a.tasks) : [],
    ...(a.phase === 'preparing' ? { preparingProgress: Math.min(0.95, (Date.now() - a.startedAt) / PREPARE_MS) } : {}),
    reportReady: !!a.report,
  };
}

function team(): TeamExamReadiness {
  const members = teamData.members;
  return {
    team: { id: teamData.team.id, name: teamData.team.name },
    exams: fixtureExams
      .filter((e) => MOCK_AVAILABLE.has(e.id))
      .map((exam) => {
        const rows: TeamExamMember[] = members.map((m, i) => {
          const r = hash(`${exam.id}:${m.id}`);
          if (r < 0.22) return { userId: m.id, name: m.name, attempts: 0, passed: false, readiness: 'not-attempted' };
          const attemptsN = 1 + Math.floor(hash(`${exam.id}:${m.id}:n`) * 3);
          const last = Math.round((42 + r * 50) * 10) / 10;
          const best = Math.round(Math.min(98, last + hash(`${exam.id}:${m.id}:b`) * 8) * 10) / 10;
          const weakest = exam.blueprint[Math.floor(hash(`${exam.id}:${m.id}:w`) * exam.blueprint.length)]!;
          const readiness: TeamExamMember['readiness'] = best >= exam.passMark + 5 ? 'ready' : best >= exam.passMark - 10 ? 'close' : 'not-ready';
          return {
            userId: m.id,
            name: m.name,
            attempts: attemptsN,
            bestScore: best,
            lastScore: last,
            lastAttemptAt: new Date(Date.now() - (2 + i * 3) * DAY).toISOString(),
            passed: best >= exam.passMark,
            weakestObjective: { id: weakest.objective, name: weakest.name, score: Math.round(25 + hash(`${exam.id}:${m.id}:ws`) * 35) },
            readiness,
          };
        });
        const attempted = rows.filter((m) => m.lastScore !== undefined);
        return {
          examId: exam.id,
          examTitle: exam.title,
          passMark: exam.passMark,
          members: rows,
          ...(attempted.length ? { averageScore: Math.round((attempted.reduce((a, m) => a + m.lastScore!, 0) / attempted.length) * 10) / 10 } : {}),
          passRate: rows.length ? rows.filter((m) => m.passed).length / rows.length : 0,
        };
      }),
  };
}

const notFound = (what: string) => HttpResponse.json({ error: `${what} not found` }, { status: 404 });

export const examHandlers = [
  http.get('/api/exams', async () => {
    await latency();
    const list = fixtureExams.map(examSummary);
    list.sort((a, b) => (a.availability === b.availability ? a.title.localeCompare(b.title) : a.availability === 'available' ? -1 : 1));
    return HttpResponse.json({ exams: list });
  }),
  http.get('/api/exams/attempts/mine', async () => {
    await latency();
    return HttpResponse.json(mine().map(summary));
  }),
  http.get('/api/exams/team-readiness', async () => {
    await latency();
    return HttpResponse.json(team());
  }),
  http.get('/api/exams/attempts/:id', async ({ params }) => {
    await latency();
    const a = attempts.get(String(params.id));
    return a ? HttpResponse.json(state(a)) : notFound('Attempt');
  }),
  http.get('/api/exams/attempts/:id/report', async ({ params }) => {
    await latency();
    const a = attempts.get(String(params.id));
    if (!a) return notFound('Attempt');
    tick(a);
    return a.report ? HttpResponse.json(a.report) : HttpResponse.json({ error: 'The report is not ready yet.' }, { status: 409 });
  }),
  http.put('/api/exams/attempts/:id/tasks/:index/flag', async ({ params, request }) => {
    await delay(80);
    const a = attempts.get(String(params.id));
    if (!a) return notFound('Attempt');
    tick(a);
    if (a.phase !== 'in-progress') return HttpResponse.json({ error: 'Flags can only change while the exam is in progress.' }, { status: 409 });
    const { flagged } = (await request.json()) as { flagged: boolean };
    const i = Number(params.index);
    if (flagged) a.flagged.add(i);
    else a.flagged.delete(i);
    return HttpResponse.json(state(a));
  }),
  http.post('/api/exams/attempts/:id/submit', async ({ params }) => {
    await latency();
    const a = attempts.get(String(params.id));
    if (!a) return notFound('Attempt');
    tick(a); // past the deadline this already froze it as a time-out (no submittedAt)
    if (a.phase === 'in-progress') {
      a.phase = 'grading';
      a.submittedAt = Date.now();
      a.frozenAt = a.submittedAt;
      a.gradeFrom = a.submittedAt;
    }
    return HttpResponse.json(state(a));
  }),
  http.get('/api/exams/:examId', async ({ params }) => {
    await latency();
    const exam = exams.get(String(params.examId));
    return exam ? HttpResponse.json(detail(exam)) : notFound('Exam');
  }),
  http.post('/api/exams/:examId/attempts', async ({ params }) => {
    await delay(500);
    const exam = exams.get(String(params.examId));
    if (!exam) return notFound('Exam');
    if (!MOCK_AVAILABLE.has(exam.id)) return HttpResponse.json({ error: 'Exam tasks are still being authored for this simulation.' }, { status: 409 });
    const r = retake(exam);
    if (!r.allowed) return HttpResponse.json({ error: r.reason }, { status: 409 });
    const id = `exam-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`;
    const prior = mine(exam.id);
    const avoid = exam.retakePolicy.freshDraw ? new Set(prior.filter((a) => a.phase !== 'failed').flatMap((a) => a.tasks.map((t) => t.taskId))) : new Set<string>();
    const a: MockAttempt = { id, examId: exam.id, number: prior.length + 1, phase: 'preparing', startedAt: Date.now(), tasks: drawTasks(exam, id, avoid), flagged: new Set() };
    attempts.set(id, a);
    return HttpResponse.json({ attempt: state(a) }, { status: 201 });
  }),
];
