import type { QuestionsView, SubmitAnswerResponse } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import type { ContentLab } from '../content/load.js';
import { HttpError, notFound } from '../errors.js';
import type { LabSession } from '../kube/types.js';
import { phaseOf } from '../sessions/map.js';
import type { SessionService } from '../sessions/service.js';
import { BrokenAnswerError, MAX_ANSWER_LENGTH, matchAnswer } from './match.js';
import { answerChecks, buildView, expectedFor, matchRules, NotReadyError, visibleParams, type ScopeRecords, type ViewOptions } from './questions.js';
import type { AnswerScope, AnswerStore, ScopeOps } from './store.js';

/**
 * Where a session's answers count and how they are scored. Solo labs: the
 * session itself, static points. CTF events (events/) override it: shared
 * team scope, event window, dynamic values, first bloods.
 */
export interface ScopeContext {
  scope: AnswerScope;
  /** Throws (409) when answers are not accepted now, e.g. outside the event window. */
  assertOpen?(): void;
  /** Event scoring for the view; called after every change, so dynamic values are current. */
  viewOptions?(ops: ScopeOps, rec: ScopeRecords): Promise<Partial<ViewOptions>>;
  /** After a correct answer was recorded (scoreboard updates). */
  solved?(checkId: string): void;
}

export type ScopeResolver = (p: Principal, ls: LabSession, lab: ContentLab) => Promise<ScopeContext>;

export const soloScope: ScopeResolver = async (_p, ls, lab) => ({ scope: { key: ls.metadata.name, sessionName: ls.metadata.name, labId: lab.lab.metadata.id } });

export interface AnswerServiceOptions {
  /** Answers one learner may submit per minute across all questions (default 10). */
  ratePerMinute?: number;
  now?: () => Date;
  resolve?: ScopeResolver;
}

const MINUTE = 60_000;

/**
 * Questions of a lab session: the learner-safe view, graded answer
 * submissions (rate-limited, audited) and question hints with a point cost.
 * Only the session's owner may read or answer.
 */
export class AnswerService {
  private readonly rate: number;
  private readonly now: () => Date;
  resolve: ScopeResolver;

  constructor(
    private readonly sessions: SessionService,
    private readonly store: AnswerStore,
    opts: AnswerServiceOptions = {},
  ) {
    this.rate = opts.ratePerMinute ?? 10;
    this.now = opts.now ?? (() => new Date());
    this.resolve = opts.resolve ?? soloScope;
  }

  private async load(p: Principal, sessionId: string) {
    const { ls, lab } = await this.sessions.owned(p, sessionId);
    if (!answerChecks(lab.lab).length) throw notFound('Questions');
    const ctx = await this.resolve(p, ls, lab);
    return { ls, lab, ctx };
  }

  private async view(p: Principal, ls: LabSession, lab: ContentLab, ctx: ScopeContext, ops: ScopeOps, rec: ScopeRecords): Promise<QuestionsView> {
    const extra: Partial<ViewOptions> = ctx.viewOptions ? await ctx.viewOptions(ops, rec) : {};
    const params = visibleParams(lab.lab, ls.status?.resolvedParams);
    let users = extra.users;
    if (!users && ctx.scope.teamId) {
      const ids = new Set([...rec.submissions.map((s) => s.userId), ...rec.reveals.map((r) => r.userId)]);
      users = await this.store.users(p, [...ids]);
    }
    return buildView(lab.lab, rec, { sessionId: ls.metadata.name, ...(params ? { params } : {}), ...extra, ...(users ? { users } : {}) });
  }

  async questions(p: Principal, sessionId: string): Promise<QuestionsView> {
    const { ls, lab, ctx } = await this.load(p, sessionId);
    return this.store.withScope(p, ctx.scope, undefined, async (ops) => this.view(p, ls, lab, ctx, ops, await ops.records()));
  }

  async submit(p: Principal, sessionId: string, checkId: string, answer: unknown, ip?: string): Promise<SubmitAnswerResponse> {
    if (typeof answer !== 'string' || !answer.trim()) throw new HttpError(422, 'Type an answer first.', { code: 'invalid' });
    if (answer.length > MAX_ANSWER_LENGTH) throw new HttpError(422, `Answers are at most ${MAX_ANSWER_LENGTH} characters.`, { code: 'invalid' });
    const { ls, lab, ctx } = await this.load(p, sessionId);
    const check = answerChecks(lab.lab).find((c) => c.id === checkId);
    if (!check) throw notFound('Question');
    const phase = phaseOf(ls);
    if (phase === 'expired' || phase === 'failed') throw new HttpError(409, 'This lab session has ended.', { code: 'conflict' });
    ctx.assertOpen?.();

    return this.store.withScope(p, ctx.scope, ip, async (ops) => {
      const now = this.now();
      const recent = await ops.submissionsSince(p.sub, new Date(now.getTime() - MINUTE));
      if (recent >= this.rate) {
        throw new HttpError(429, `Too many answers: at most ${this.rate} a minute. Wait a moment and try again.`, { code: 'rate_limited', details: { limit: this.rate, retryAfterSeconds: 60 } });
      }
      const rec = await ops.records();
      const before = await this.view(p, ls, lab, ctx, ops, rec);
      const q = before.questions.find((x) => x.id === checkId)!;
      if (q.state === 'locked') throw new HttpError(409, 'Answer the question before this one first.', { code: 'conflict' });
      if (q.state === 'solved') throw new HttpError(409, 'This question is already solved.', { code: 'conflict' });
      if (q.state === 'closed') throw new HttpError(409, 'No attempts left for this question.', { code: 'conflict' });

      let correct: boolean;
      try {
        const expected = expectedFor(check, ls.status?.resolvedParams, ls.status?.computedAnswers);
        correct = matchAnswer(matchRules(check.answer), expected, answer);
      } catch (e) {
        if (e instanceof NotReadyError) throw new HttpError(409, 'The lab is still being set up; try again in a moment.', { code: 'conflict' });
        if (e instanceof BrokenAnswerError) throw new HttpError(500, 'This question cannot be graded right now; your answer was not counted.', { code: 'lab_error' });
        throw e;
      }
      const points = correct ? q.available : 0;
      const text = answer.trim().slice(0, MAX_ANSWER_LENGTH);
      await ops.insertSubmission({ checkId, userId: p.sub, correct, points, answer: text, at: now, sessionName: ls.metadata.name });
      const attempt = q.wrongAttempts + 1;
      await ops.audit(
        'answer.submit',
        `${lab.lab.metadata.id}/${checkId}`,
        { session: ls.metadata.name, correct, attempt, points, ...(ctx.scope.eventId ? { event: ctx.scope.eventId } : {}), ...(ctx.scope.teamId ? { team: ctx.scope.teamId } : {}) },
        `${lab.lab.metadata.title}: ${checkId}`,
      );
      const after = await this.view(p, ls, lab, ctx, ops, await ops.records());
      const q2 = after.questions.find((x) => x.id === checkId)!;
      if (q2.state === 'solved' || q2.state === 'closed') {
        await ops.recordQuestion({
          lab: lab.lab,
          checkId,
          passed: q2.state === 'solved',
          hintsUsed: q2.hints.filter((h) => h.revealed).length,
          at: now,
          totals: { earned: after.earned, possible: after.possible, solved: after.solved, total: after.total },
        });
      }
      if (correct) ctx.solved?.(checkId);
      const message = correct
        ? `Correct: +${q2.awarded ?? points} points.`
        : q2.state === 'closed'
          ? 'Not correct. No attempts left: the question is closed.'
          : `Not correct.${q2.attemptsLeft !== undefined ? ` ${q2.attemptsLeft} attempt${q2.attemptsLeft === 1 ? '' : 's'} left.` : ''}${q2.penalty ? ` Each wrong answer costs ${q2.penalty} points.` : ''}`;
      return { correct, message, view: after };
    });
  }

  async revealHint(p: Principal, sessionId: string, checkId: string, index: number, ip?: string): Promise<QuestionsView> {
    const { ls, lab, ctx } = await this.load(p, sessionId);
    const check = answerChecks(lab.lab).find((c) => c.id === checkId);
    if (!check) throw notFound('Question');
    const hints = check.answer.hints ?? [];
    if (!Number.isInteger(index) || index < 0 || index >= hints.length) throw notFound('Hint');
    const phase = phaseOf(ls);
    if (phase === 'expired' || phase === 'failed') throw new HttpError(409, 'This lab session has ended.', { code: 'conflict' });
    ctx.assertOpen?.();
    return this.store.withScope(p, ctx.scope, ip, async (ops) => {
      const rec = await ops.records();
      const before = await this.view(p, ls, lab, ctx, ops, rec);
      const q = before.questions.find((x) => x.id === checkId)!;
      if (q.hints[index]?.revealed) return before;
      if (q.state !== 'open') throw new HttpError(409, q.state === 'locked' ? 'Answer the question before this one first.' : 'Hints are only available while the question is open.', { code: 'conflict' });
      const next = q.hints.findIndex((h) => !h.revealed);
      if (index !== next) throw new HttpError(409, 'Reveal hints in order.', { code: 'conflict' });
      const cost = q.hints[index]!.cost;
      await ops.insertReveal({ checkId, index, cost, userId: p.sub, at: this.now(), sessionName: ls.metadata.name });
      await ops.audit('answer.hint', `${lab.lab.metadata.id}/${checkId}`, { session: ls.metadata.name, hint: index, cost, ...(ctx.scope.eventId ? { event: ctx.scope.eventId } : {}) }, `${lab.lab.metadata.title}: ${checkId}`);
      return this.view(p, ls, lab, ctx, ops, await ops.records());
    });
  }
}
