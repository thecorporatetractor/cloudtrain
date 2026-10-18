import type { Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { AttemptOutcomeDb } from '../db/schema.js';
import type { Tx } from '../db/index.js';
import { DIFFICULTY, prior, update, type SkillBelief } from './model.js';
import { endStateChecks } from '../content/view.js';

/*
 * Persistence of learning (docs/platform-identity.md): every graded validate
 * becomes check_results rows, skill_evidence rows and learner_skill_state
 * updates, all inside the caller's org-scoped transaction (RLS).
 */

export interface GradedCheck {
  id: string;
  passed: boolean;
  /** Decimal from the grader / template; falls back to the lab's check weight. */
  weight?: string | number;
  skills?: string[];
  message?: string;
}

export interface RunInput {
  orgId: string;
  userId: string;
  sessionName: string;
  lab: SourceLab;
  /** Weighted score 0-100 of this run. */
  score: number;
  checks: GradedCheck[];
  hintsUsed: number;
  at: Date;
  /** When the session started (used if the attempt row has to be created now). */
  startedAt?: Date;
}

export function labDifficulty(lab: SourceLab): number {
  return DIFFICULTY[lab.metadata.difficulty] ?? 0.5;
}

function checkWeight(lab: SourceLab, c: GradedCheck): number {
  const n = Number(c.weight);
  if (c.weight !== undefined && c.weight !== '' && Number.isFinite(n)) return n;
  const src = lab.spec.checks.find((x) => x.id === c.id);
  return src?.weight ?? 1;
}

export async function startAttempt(tx: Tx, a: { orgId: string; userId: string; lab: SourceLab; sessionName: string; startedAt: Date }): Promise<string> {
  const row = await tx
    .insertInto('lab_attempts')
    .values({
      org_id: a.orgId,
      user_id: a.userId,
      lab_id: a.lab.metadata.id,
      lab_version: a.lab.metadata.version ?? 1,
      difficulty: a.lab.metadata.difficulty,
      session_name: a.sessionName,
      started_at: a.startedAt,
      checks_total: endStateChecks(a.lab).length,
    })
    .onConflict((oc) => oc.column('session_name').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (row) return row.id;
  return (await tx.selectFrom('lab_attempts').select('id').where('session_name', '=', a.sessionName).executeTakeFirstOrThrow()).id;
}

export interface RunResult {
  attemptId: string;
  run: number;
  evidence: number;
  skillsUpdated: string[];
}

/**
 * Records one finished grading run. A check is evidence when it is the first
 * run of the attempt or its result changed since the previous run, so
 * repeated validates do not multiply evidence.
 */
export async function recordRun(tx: Tx, r: RunInput): Promise<RunResult> {
  const attemptId = await startAttempt(tx, { orgId: r.orgId, userId: r.userId, lab: r.lab, sessionName: r.sessionName, startedAt: r.startedAt ?? r.at });
  const attempt = await tx.selectFrom('lab_attempts').selectAll().where('id', '=', attemptId).forUpdate().executeTakeFirstOrThrow();
  const run = attempt.validations + 1;
  const prev = new Map(
    (await tx.selectFrom('check_results').select(['check_id', 'passed']).where('attempt_id', '=', attemptId).where('run', '=', run - 1).execute()).map((c) => [c.check_id, c.passed]),
  );

  const checks = r.checks.map((c) => {
    const src = r.lab.spec.checks.find((x) => x.id === c.id);
    return { ...c, weight: checkWeight(r.lab, c), skills: c.skills?.length ? c.skills : [...(src?.skills ?? [])] };
  });
  if (checks.length) {
    await tx
      .insertInto('check_results')
      .values(checks.map((c) => ({ org_id: r.orgId, attempt_id: attemptId, check_id: c.id, run, passed: c.passed, weight: c.weight, skills: c.skills, message: c.message ?? null, graded_at: r.at })))
      .execute();
  }

  const counted = checks.filter((c) => run === 1 || prev.get(c.id) !== c.passed);
  const difficulty = labDifficulty(r.lab);
  const skillIds = Array.from(new Set(counted.flatMap((c) => c.skills)));
  const states = new Map<string, SkillBelief>();
  if (skillIds.length) {
    const rows = await tx.selectFrom('learner_skill_state').selectAll().where('user_id', '=', r.userId).where('skill_id', 'in', skillIds).forUpdate().execute();
    for (const s of rows) states.set(s.skill_id, { mu: s.mu, sigma: s.sigma, evidence: s.evidence, lastDelta: s.last_delta, updatedAt: s.updated_at });
  }
  const evidence: { skill_id: string; check_id: string; outcome: number; weight: number }[] = [];
  for (const c of counted) {
    for (const skill of c.skills) {
      const before = states.get(skill) ?? prior(r.at);
      states.set(skill, update(before, { passed: c.passed, weight: c.weight, difficulty, hintsUsed: r.hintsUsed, at: r.at }));
      evidence.push({ skill_id: skill, check_id: c.id, outcome: c.passed ? 1 : 0, weight: c.weight });
    }
  }
  if (evidence.length) {
    await tx
      .insertInto('skill_evidence')
      .values(evidence.map((e) => ({ org_id: r.orgId, user_id: r.userId, attempt_id: attemptId, difficulty, at: r.at, ...e })))
      .execute();
  }
  for (const [skill, b] of states) {
    if (!skillIds.includes(skill)) continue;
    const v = { mu: b.mu, sigma: b.sigma, evidence: b.evidence, last_delta: b.lastDelta, updated_at: b.updatedAt };
    await tx
      .insertInto('learner_skill_state')
      .values({ org_id: r.orgId, user_id: r.userId, skill_id: skill, ...v })
      .onConflict((oc) => oc.columns(['org_id', 'user_id', 'skill_id']).doUpdateSet(v))
      .execute();
  }

  const passed = checks.filter((c) => c.passed).length;
  // A lab with questions also needs every question solved to count as passed.
  const questions = r.lab.spec.checks.length - endStateChecks(r.lab).length;
  const allPassed = checks.length > 0 && passed === endStateChecks(r.lab).length && attempt.questions_solved >= questions;
  await tx
    .updateTable('lab_attempts')
    .set({
      validations: run,
      score: Math.max(attempt.score, Math.round(r.score)),
      checks_passed: Math.max(attempt.checks_passed, passed),
      checks_total: endStateChecks(r.lab).length,
      hints_used: Math.max(attempt.hints_used, r.hintsUsed),
      duration_s: Math.max(0, Math.round((r.at.getTime() - attempt.started_at.getTime()) / 1000)),
      ...(allPassed ? { outcome: 'passed' as const } : {}),
    })
    .where('id', '=', attemptId)
    .execute();
  return { attemptId, run, evidence: evidence.length, skillsUpdated: skillIds };
}

/** Marks an attempt finished (session deleted, terminated or expired). Idempotent. */
export async function endAttempt(tx: Tx, sessionName: string, at: Date, hintsUsed?: number): Promise<void> {
  const a = await tx.selectFrom('lab_attempts').selectAll().where('session_name', '=', sessionName).executeTakeFirst();
  if (!a || a.ended_at) return;
  const outcome: AttemptOutcomeDb = a.outcome === 'passed' ? 'passed' : a.score > 0 ? 'partial' : a.validations > 0 ? 'failed' : 'abandoned';
  await tx
    .updateTable('lab_attempts')
    .set({
      ended_at: at,
      outcome,
      duration_s: Math.max(a.duration_s, Math.round((at.getTime() - a.started_at.getTime()) / 1000)),
      ...(hintsUsed !== undefined ? { hints_used: Math.max(a.hints_used, hintsUsed) } : {}),
    })
    .where('id', '=', a.id)
    .execute();
}

export interface QuestionOutcome {
  orgId: string;
  userId: string;
  sessionName: string;
  lab: SourceLab;
  checkId: string;
  /** true: solved; false: closed (out of attempts). Skill evidence either way. */
  passed: boolean;
  /** Question hints revealed (discount the evidence like lab hints do). */
  hintsUsed: number;
  at: Date;
  /** Totals of the scope after this answer (shown in history). */
  totals: { earned: number; possible: number; solved: number; total: number };
}

/**
 * Records a question's outcome for the person who answered it: one skill
 * evidence per skill of the answer check (outcome 1 solved, 0 closed) and
 * the CTF totals on their attempt. For a lab with questions only, the
 * attempt's score is the share of questions solved and it is passed once
 * every question is solved; a lab with end-state checks keeps its Validate
 * score.
 */
export async function recordQuestion(tx: Tx, q: QuestionOutcome): Promise<void> {
  const attemptId = await startAttempt(tx, { orgId: q.orgId, userId: q.userId, lab: q.lab, sessionName: q.sessionName, startedAt: q.at });
  const check = q.lab.spec.checks.find((c) => c.id === q.checkId);
  const skills = [...(check?.skills ?? [])];
  const weight = check?.weight ?? 1;
  const difficulty = labDifficulty(q.lab);
  if (skills.length) {
    const rows = await tx.selectFrom('learner_skill_state').selectAll().where('user_id', '=', q.userId).where('skill_id', 'in', skills).forUpdate().execute();
    const states = new Map<string, SkillBelief>(rows.map((s) => [s.skill_id, { mu: s.mu, sigma: s.sigma, evidence: s.evidence, lastDelta: s.last_delta, updatedAt: s.updated_at }]));
    for (const skill of skills) {
      const b = update(states.get(skill) ?? prior(q.at), { passed: q.passed, weight, difficulty, hintsUsed: q.hintsUsed, at: q.at });
      const v = { mu: b.mu, sigma: b.sigma, evidence: b.evidence, last_delta: b.lastDelta, updated_at: b.updatedAt };
      await tx
        .insertInto('learner_skill_state')
        .values({ org_id: q.orgId, user_id: q.userId, skill_id: skill, ...v })
        .onConflict((oc) => oc.columns(['org_id', 'user_id', 'skill_id']).doUpdateSet(v))
        .execute();
    }
    await tx
      .insertInto('skill_evidence')
      .values(skills.map((skill_id) => ({ org_id: q.orgId, user_id: q.userId, attempt_id: attemptId, skill_id, check_id: q.checkId, outcome: q.passed ? 1 : 0, weight, difficulty, at: q.at })))
      .execute();
  }
  await updateAttemptPoints(tx, attemptId, q.lab, q.totals);
}

/** Writes the CTF totals onto an attempt (and the score/outcome of a questions-only lab). */
export async function updateAttemptPoints(tx: Tx, attemptId: string, lab: SourceLab, t: QuestionOutcome['totals']): Promise<void> {
  const a = await tx.selectFrom('lab_attempts').select(['score', 'outcome', 'checks_passed', 'checks_total']).where('id', '=', attemptId).forUpdate().executeTakeFirstOrThrow();
  const questionsOnly = endStateChecks(lab).length === 0;
  const pct = t.total ? Math.round((100 * t.solved) / t.total) : 0;
  const allSolved = t.total > 0 && t.solved === t.total;
  const endStateDone = !questionsOnly && a.checks_total > 0 && a.checks_passed >= a.checks_total;
  await tx
    .updateTable('lab_attempts')
    .set({
      points_earned: t.earned,
      points_possible: t.possible,
      questions_solved: t.solved,
      questions_total: t.total,
      ...(questionsOnly ? { score: Math.max(a.score, pct) } : {}),
      ...(allSolved && (questionsOnly || endStateDone) ? { outcome: 'passed' as const } : {}),
    })
    .where('id', '=', attemptId)
    .execute();
}
