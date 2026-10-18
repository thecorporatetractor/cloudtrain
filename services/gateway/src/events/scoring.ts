import type { CtfQuestionStat, CtfScoreRow, CtfSolve, UserRef } from '@cloudtrain/api-types';
import { award } from '../answers/match.js';

/*
 * CTF event scoring, pure: submissions and hint reveals of an event in,
 * ranks, solves and the timeline out.
 *
 * - static: a question is worth its points.
 * - dynamic: the value drops with the number of entrants that solved it
 *   (CTFd's curve): v(s) = P + (min - P) / decay^2 * (s - 1)^2, never below
 *   min = ceil(P * minPct / 100). Retroactive: every solver gets the current
 *   value, so the first solver is not punished for the later ones.
 * - Each solver's award is the value minus their penalties (wrong answers
 *   before the solve) and their revealed hints' costs, never below 0.
 * - Rank: points, then the earlier last solve (ties broken by time).
 */

export interface ScoringRules {
  scoring: 'static' | 'dynamic';
  dynamicMinPct: number;
  dynamicDecay: number;
  firstBlood: boolean;
}

export interface QuestionDef {
  labId: string;
  checkId: string;
  /** 1-based position in the lab. */
  number: number;
  prompt: string;
  points: number;
  penalty: number;
}

export interface EventSubmission {
  entrantId: string;
  userId: string;
  labId: string;
  checkId: string;
  correct: boolean;
  at: Date;
}

export interface EventReveal {
  entrantId: string;
  labId: string;
  checkId: string;
  cost: number;
  at: Date;
}

export interface Entrant {
  id: string;
  name: string;
  members: UserRef[];
}

export const qkey = (labId: string, checkId: string) => `${labId}/${checkId}`;

/** Value of a question solved by `solves` entrants. */
export function questionValue(points: number, solves: number, r: ScoringRules): number {
  if (r.scoring === 'static' || solves <= 1) return points;
  const min = Math.ceil((points * r.dynamicMinPct) / 100);
  const decay = Math.max(1, r.dynamicDecay);
  const v = points + ((min - points) / (decay * decay)) * (solves - 1) ** 2;
  return Math.max(min, Math.ceil(v));
}

export interface Solve {
  entrantId: string;
  userId: string;
  q: QuestionDef;
  at: Date;
  wrong: number;
  hintCost: number;
}

export interface ScoreResult {
  rows: CtfScoreRow[];
  solves: CtfSolve[];
  questions: CtfQuestionStat[];
  timeline: { entrantId: string; name: string; points: { at: string; total: number }[] }[];
  /** Per question: solve count (counted submissions only). */
  solveCounts: Map<string, number>;
  /** Per question: the first solve. */
  firstSolves: Map<string, { entrantId: string; at: Date }>;
}

/** Scores an event. Submissions and reveals after `cutoff` (scoreboard freeze) are ignored. */
export function scoreEvent(o: {
  rules: ScoringRules;
  questions: QuestionDef[];
  entrants: Entrant[];
  submissions: EventSubmission[];
  reveals: EventReveal[];
  startsAt: Date;
  cutoff?: Date;
  users?: Map<string, UserRef>;
  timelineTop?: number;
}): ScoreResult {
  const { rules } = o;
  const inTime = <T extends { at: Date }>(x: T) => !o.cutoff || x.at <= o.cutoff;
  const subs = o.submissions.filter(inTime).sort((a, b) => a.at.getTime() - b.at.getTime());
  const reveals = o.reveals.filter(inTime);
  const qByKey = new Map(o.questions.map((q) => [qkey(q.labId, q.checkId), q]));

  // First correct submission per (entrant, question), wrong answers before it, hint costs.
  const solves: Solve[] = [];
  const seen = new Set<string>();
  for (const s of subs) {
    const k = qkey(s.labId, s.checkId);
    const q = qByKey.get(k);
    if (!q || !s.correct) continue;
    const ek = `${s.entrantId}|${k}`;
    if (seen.has(ek)) continue;
    seen.add(ek);
    const wrong = subs.filter((x) => x.entrantId === s.entrantId && qkey(x.labId, x.checkId) === k && !x.correct && x.at <= s.at).length;
    const hintCost = reveals.filter((r) => r.entrantId === s.entrantId && qkey(r.labId, r.checkId) === k).reduce((n, r) => n + r.cost, 0);
    solves.push({ entrantId: s.entrantId, userId: s.userId, q, at: s.at, wrong, hintCost });
  }

  const solveCounts = new Map<string, number>();
  const firstSolves = new Map<string, { entrantId: string; at: Date }>();
  for (const s of solves) {
    const k = qkey(s.q.labId, s.q.checkId);
    solveCounts.set(k, (solveCounts.get(k) ?? 0) + 1);
    if (!firstSolves.has(k)) firstSolves.set(k, { entrantId: s.entrantId, at: s.at });
  }
  const valueOf = (q: QuestionDef) => questionValue(q.points, solveCounts.get(qkey(q.labId, q.checkId)) ?? 0, rules);
  const awardOf = (s: Solve) => award(valueOf(s.q), s.q.penalty, s.wrong, s.hintCost);
  const isFirst = (s: Solve) => rules.firstBlood && firstSolves.get(qkey(s.q.labId, s.q.checkId))?.entrantId === s.entrantId;

  const entrantName = new Map(o.entrants.map((e) => [e.id, e.name]));
  const stats = new Map(o.entrants.map((e) => [e.id, { points: 0, solves: 0, firstBloods: 0, last: undefined as Date | undefined }]));
  for (const s of solves) {
    const st = stats.get(s.entrantId);
    if (!st) continue;
    st.points += awardOf(s);
    st.solves++;
    if (isFirst(s)) st.firstBloods++;
    if (!st.last || s.at > st.last) st.last = s.at;
  }
  const ordered = o.entrants
    .map((e) => ({ e, st: stats.get(e.id)! }))
    .sort((a, b) => b.st.points - a.st.points || (a.st.last?.getTime() ?? Infinity) - (b.st.last?.getTime() ?? Infinity) || a.e.name.localeCompare(b.e.name));
  const rows: CtfScoreRow[] = [];
  ordered.forEach(({ e, st }, i) => {
    const prev = rows[i - 1];
    const tie = prev && prev.points === st.points && prev.lastSolveAt === st.last?.toISOString();
    rows.push({
      rank: tie ? prev.rank : i + 1,
      id: e.id,
      name: e.name,
      members: e.members,
      points: st.points,
      solves: st.solves,
      firstBloods: st.firstBloods,
      ...(st.last ? { lastSolveAt: st.last.toISOString() } : {}),
    });
  });

  const feed: CtfSolve[] = solves
    .map((s) => {
      const by = o.users?.get(s.userId);
      return {
        at: s.at.toISOString(),
        entrantId: s.entrantId,
        entrantName: entrantName.get(s.entrantId) ?? s.entrantId,
        labId: s.q.labId,
        checkId: s.q.checkId,
        questionNumber: s.q.number,
        points: awardOf(s),
        firstBlood: isFirst(s),
        ...(by ? { solvedBy: by } : {}),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  const questions: CtfQuestionStat[] = o.questions.map((q) => {
    const k = qkey(q.labId, q.checkId);
    const fb = firstSolves.get(k);
    return {
      labId: q.labId,
      checkId: q.checkId,
      questionNumber: q.number,
      prompt: q.prompt,
      points: q.points,
      value: valueOf(q),
      solves: solveCounts.get(k) ?? 0,
      ...(fb && rules.firstBlood ? { firstBlood: { entrantName: entrantName.get(fb.entrantId) ?? fb.entrantId, at: fb.at.toISOString() } } : {}),
    };
  });

  const top = rows.slice(0, o.timelineTop ?? 10).filter((r) => r.solves > 0);
  const timeline = top.map((r) => {
    let total = 0;
    const points = [{ at: o.startsAt.toISOString(), total: 0 }];
    for (const s of solves.filter((x) => x.entrantId === r.id)) {
      total += awardOf(s);
      points.push({ at: s.at.toISOString(), total });
    }
    return { entrantId: r.id, name: r.name, points };
  });

  return { rows, solves: feed, questions, timeline, solveCounts, firstSolves };
}
