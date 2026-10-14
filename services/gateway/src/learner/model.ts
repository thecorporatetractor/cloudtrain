/*
 * Learner model: per-skill ability (mu, sigma), Glicko/Kalman-style.
 *
 *   mu     in [0, 1]       mastery estimate
 *   sigma  in [0.04, 0.45] uncertainty (standard deviation on the mu scale)
 *   prior  mu0 = 0.30, sigma0 = 0.35 for a skill with no evidence
 *
 * One piece of evidence = one graded check tagged with the skill:
 *
 *   time decay     sigma_t^2 = min(SIGMA_MAX^2, sigma^2 + TAU2 * days_since_update)
 *   difficulty     d = 0.30 easy, 0.50 medium, 0.70 hard (lab metadata.difficulty)
 *   expectation    E = 1 / (1 + exp(-K_SLOPE * (mu - d)))
 *   weight         w = clamp(check weight, 0.25, 3) * (passed ? HINT_DISCOUNT^hints : 1)
 *   gain           K = sigma_t^2 / (sigma_t^2 + R / w)
 *   update         mu'      = clamp01(mu + K * (o - E))          o = 1 pass, 0 fail
 *                  sigma'^2 = max(SIGMA_MIN^2, (1 - K) * sigma_t^2)
 *
 * So evidence moves mu more while the model is unsure (high sigma) and for
 * heavier checks; a pass on a hard lab moves it more than a pass on an easy
 * one (larger surprise o - E); hints discount passes; sigma shrinks with every
 * piece of evidence and grows back with time (forgetting / staleness).
 *
 * Repeated validates in one attempt only count a check when its result
 * changed since the previous run (first run always counts), so pressing
 * Validate five times is not five times the evidence (see learning.ts).
 */

export const MU0 = 0.3;
export const SIGMA0 = 0.35;
export const SIGMA_MIN = 0.04;
export const SIGMA_MAX = 0.45;
/** Variance added per day without evidence. */
export const TAU2 = 0.0004;
/** Observation noise. */
export const R = 0.05;
export const K_SLOPE = 5;
export const HINT_DISCOUNT = 0.75;

export const DIFFICULTY: Record<string, number> = { easy: 0.3, medium: 0.5, hard: 0.7 };

const DAY = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SkillBelief {
  mu: number;
  sigma: number;
  evidence: number;
  /** Change of mu at the last update (trend). */
  lastDelta: number;
  updatedAt: Date;
}

export interface Evidence {
  passed: boolean;
  /** Check weight from the lab (default 1). */
  weight: number;
  /** 0..1 (see DIFFICULTY). */
  difficulty: number;
  hintsUsed: number;
  at: Date;
}

export function prior(at: Date): SkillBelief {
  return { mu: MU0, sigma: SIGMA0, evidence: 0, lastDelta: 0, updatedAt: at };
}

/** Sigma after `at - updatedAt` without evidence. */
export function decayedSigma(b: Pick<SkillBelief, 'sigma' | 'updatedAt'>, at: Date): number {
  const days = Math.max(0, (at.getTime() - b.updatedAt.getTime()) / DAY);
  return Math.sqrt(Math.min(SIGMA_MAX ** 2, b.sigma ** 2 + TAU2 * days));
}

export function expectedSuccess(mu: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-K_SLOPE * (mu - difficulty)));
}

export function evidenceWeight(e: Pick<Evidence, 'passed' | 'weight' | 'hintsUsed'>): number {
  const w = clamp(Number.isFinite(e.weight) ? e.weight : 1, 0.25, 3);
  return e.passed ? w * HINT_DISCOUNT ** Math.max(0, e.hintsUsed) : w;
}

export function update(b: SkillBelief, e: Evidence): SkillBelief {
  const s2 = decayedSigma(b, e.at) ** 2;
  const w = evidenceWeight(e);
  const k = s2 / (s2 + R / w);
  const o = e.passed ? 1 : 0;
  const mu = clamp(b.mu + k * (o - expectedSuccess(b.mu, e.difficulty)), 0, 1);
  const sigma = Math.sqrt(Math.max(SIGMA_MIN ** 2, (1 - k) * s2));
  return { mu, sigma, evidence: b.evidence + 1, lastDelta: mu - b.mu, updatedAt: e.at };
}

export function trendOf(b: Pick<SkillBelief, 'lastDelta' | 'updatedAt'>, at: Date): 'up' | 'flat' | 'down' {
  if (at.getTime() - b.updatedAt.getTime() > 30 * DAY) return 'flat';
  if (b.lastDelta > 0.02) return 'up';
  if (b.lastDelta < -0.02) return 'down';
  return 'flat';
}

/** Expected gain in mu (skill points x100) from attempting a lab of difficulty d. */
export function expectedGain(b: SkillBelief | undefined, d: number, at: Date): number {
  const cur = b ?? prior(at);
  const s2 = decayedSigma(cur, at) ** 2;
  const k = s2 / (s2 + R);
  const e = expectedSuccess(cur.mu, d);
  // Expected change when passing (prob e) weighted: e * k * (1 - e).
  return 100 * e * k * (1 - e);
}
