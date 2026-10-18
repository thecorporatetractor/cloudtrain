import type { Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { LabQuestion, Question, QuestionHint, QuestionsView, UserRef } from '@cloudtrain/api-types';
import { fillParams, learnerParams } from '../content/view.js';
import { award, BrokenAnswerError, computedExpected, type MatchRules } from './match.js';

/*
 * Questions (answer checks) of a lab and their per-scope state. Pure: the
 * service loads the records, this module turns them into the learner-safe
 * view. Expected answers are only ever produced by `expectedFor`, which the
 * service passes straight to the matcher.
 */

export type SourceCheck = SourceLab['spec']['checks'][number];
export type SourceAnswer = NonNullable<SourceCheck['answer']>;
export type AnswerCheck = SourceCheck & { answer: SourceAnswer };

/** Defaults of lab.schema.json $defs/answer (the compiler applies the same). */
export const DEFAULT_POINTS = 100;
export const DEFAULT_HINT_COST = 10;

export function answerChecks(lab: SourceLab): AnswerCheck[] {
  return lab.spec.checks.filter((c): c is AnswerCheck => c.type === 'answer' && !!c.answer);
}

export function hasQuestions(lab: SourceLab): boolean {
  return answerChecks(lab).length > 0;
}

export function questionOrder(lab: SourceLab): 'free' | 'sequential' {
  return lab.spec.questionOrder === 'sequential' ? 'sequential' : 'free';
}

const pointsOf = (a: SourceAnswer) => a.points ?? DEFAULT_POINTS;
const hintCosts = (a: SourceAnswer) => (a.hints ?? []).map((h) => h.cost ?? DEFAULT_HINT_COST);

/** Static, learner-safe facts about a question (lab view). `params` fills the prompt when given. */
export function labQuestion(c: AnswerCheck, params?: Record<string, string>): LabQuestion {
  const a = c.answer;
  return {
    id: c.id,
    prompt: fillParams(c.description, params),
    skills: [...c.skills],
    input: a.match === 'number' ? 'number' : 'text',
    ...(a.placeholder ? { placeholder: fillParams(a.placeholder, params) } : {}),
    points: pointsOf(a),
    penalty: a.penalty ?? 0,
    ...(a.maxAttempts ? { maxAttempts: a.maxAttempts } : {}),
    hintCosts: hintCosts(a),
  };
}

export function labQuestions(lab: SourceLab): LabQuestion[] {
  return answerChecks(lab).map((c) => labQuestion(c));
}

export function matchRules(a: SourceAnswer): MatchRules {
  return {
    match: a.match,
    ...(a.caseSensitive !== undefined ? { caseSensitive: a.caseSensitive } : {}),
    ...(a.whitespace ? { whitespace: a.whitespace } : {}),
    ...(a.tolerance !== undefined ? { tolerance: a.tolerance } : {}),
  };
}

export class NotReadyError extends Error {}

const UNRESOLVED = /\{\{[^{}]*\}\}/;

/**
 * The accepted values of a question for one session: the templated value(s)
 * with the session's resolved params (secret ones included), or the computed
 * value. Never leaves the gateway.
 */
export function expectedFor(c: AnswerCheck, resolved: Record<string, string> | undefined, computed: Record<string, string> | undefined): string[] {
  const a = c.answer;
  if (a.compute) {
    const v = computed?.[c.id];
    if (v === undefined) throw new NotReadyError('the expected answer is not computed yet');
    const out = computedExpected(a.match, v);
    if (!out.length) throw new BrokenAnswerError('the computed answer is empty');
    return out;
  }
  if (!resolved) throw new NotReadyError('the session params are not resolved yet');
  const raw = a.value !== undefined ? [a.value] : [...(a.values ?? [])];
  const out = raw.map((v) => fillParams(v, resolved));
  if (out.some((v) => UNRESOLVED.test(v))) throw new BrokenAnswerError('unresolved param in the expected answer');
  return out;
}

/* ------------------------------------------------------------- records */

export interface SubmissionRecord {
  checkId: string;
  userId: string;
  correct: boolean;
  /** Award stored at solve time. */
  points: number;
  answer: string;
  at: Date;
}

export interface RevealRecord {
  checkId: string;
  index: number;
  cost: number;
  userId: string;
  at: Date;
}

export interface ScopeRecords {
  submissions: SubmissionRecord[];
  reveals: RevealRecord[];
}

export interface QuestionProgress {
  check: AnswerCheck;
  solved?: SubmissionRecord;
  /** Wrong answers before the solve (all of them when unsolved). */
  wrong: number;
  revealed: RevealRecord[];
  hintCost: number;
  closed: boolean;
  locked: boolean;
}

/** Per-question progress from a scope's records, in lab order, with sequential locking. */
export function progressOf(lab: SourceLab, rec: ScopeRecords): QuestionProgress[] {
  const order = questionOrder(lab);
  const out: QuestionProgress[] = [];
  let prevDone = true;
  for (const check of answerChecks(lab)) {
    const subs = rec.submissions.filter((s) => s.checkId === check.id).sort((a, b) => a.at.getTime() - b.at.getTime());
    const solved = subs.find((s) => s.correct);
    const wrong = subs.filter((s) => !s.correct && (!solved || s.at <= solved.at)).length;
    const revealed = rec.reveals.filter((r) => r.checkId === check.id).sort((a, b) => a.index - b.index);
    const hintCost = revealed.reduce((n, r) => n + r.cost, 0);
    const max = check.answer.maxAttempts;
    const closed = !solved && !!max && wrong >= max;
    const locked = order === 'sequential' && !prevDone;
    out.push({ check, ...(solved ? { solved } : {}), wrong, revealed, hintCost, closed, locked });
    prevDone = !!solved || closed;
  }
  return out;
}

export interface ViewOptions {
  sessionId: string;
  /** Learner-visible params (prompt and hint templating). */
  params?: Record<string, string>;
  /** Current value of a question (event dynamic scoring); default: its points. */
  pointsFor?: (checkId: string) => number;
  /** Awards are recomputed from pointsFor (dynamic scoring) instead of read from the solve. */
  recomputeAwards?: boolean;
  firstBlood?: (checkId: string, solve: SubmissionRecord) => boolean;
  users?: Map<string, UserRef>;
  event?: QuestionsView['event'];
}

/** The learner-safe questions view. */
export function buildView(lab: SourceLab, rec: ScopeRecords, o: ViewOptions): QuestionsView {
  const params = o.params;
  const questions: Question[] = progressOf(lab, rec).map((q): Question => {
    const a = q.check.answer;
    const base = labQuestion(q.check, params);
    const value = o.pointsFor ? o.pointsFor(q.check.id) : base.points;
    const hints: QuestionHint[] = (a.hints ?? []).map((h, index) => {
      const r = q.revealed.find((x) => x.index === index);
      const by = r ? o.users?.get(r.userId) : undefined;
      return { index, cost: h.cost ?? DEFAULT_HINT_COST, revealed: !!r, ...(r ? { body: fillParams(h.body, params) } : {}), ...(by ? { revealedBy: by } : {}) };
    });
    const state = q.solved ? 'solved' : q.closed ? 'closed' : q.locked ? 'locked' : 'open';
    const available = award(value, base.penalty, q.wrong, q.hintCost);
    const out: Question = {
      ...base,
      points: value,
      state,
      wrongAttempts: q.wrong,
      ...(a.maxAttempts ? { attemptsLeft: Math.max(0, a.maxAttempts - q.wrong) } : {}),
      hints,
      hintCost: q.hintCost,
      available: state === 'open' || state === 'locked' ? available : 0,
    };
    if (state === 'locked') {
      // A locked question shows no prompt yet: it may give the previous answer away.
      out.prompt = '';
      out.hints = hints.map(({ index, cost }) => ({ index, cost, revealed: false }));
    }
    if (q.solved) {
      out.awarded = o.recomputeAwards ? available : q.solved.points;
      out.solvedAt = q.solved.at.toISOString();
      out.answer = q.solved.answer;
      const by = o.users?.get(q.solved.userId);
      if (by) out.solvedBy = by;
      if (o.firstBlood?.(q.check.id, q.solved)) out.firstBlood = true;
    }
    return out;
  });
  const possible = questions.reduce((n, q) => n + q.points, 0);
  const earned = questions.reduce((n, q) => n + (q.awarded ?? 0), 0);
  return {
    sessionId: o.sessionId,
    labId: lab.metadata.id,
    order: questionOrder(lab),
    questions,
    earned,
    possible,
    solved: questions.filter((q) => q.state === 'solved').length,
    total: questions.length,
    ...(o.event ? { event: o.event } : {}),
  };
}

/** Learner-visible params of a session (secret ones removed). */
export const visibleParams = learnerParams;
