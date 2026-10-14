import type { RetakePolicy, RetakeStatus } from '@cloudtrain/api-types';
import type { AttemptRecord } from './store.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Attempts that count for the retake policy: everything except attempts the platform could not run. */
export function counted(a: AttemptRecord): boolean {
  return a.phase !== 'failed';
}

export function isActive(a: AttemptRecord): boolean {
  return a.phase === 'preparing' || a.phase === 'in-progress' || a.phase === 'grading';
}

/**
 * Whether a candidate may start an attempt now.
 *
 *  - one running attempt per exam at a time (resume it instead);
 *  - the first attempt and `freeRetakes` retakes start immediately; every
 *    later retake waits `cooldownHours` after the previous attempt ended;
 *  - at most `maxAttemptsPer30Days` counted attempts in any rolling 30 days.
 *
 * Attempts the platform failed to run (environment failure) never count.
 */
export function retakeStatus(policy: RetakePolicy, attempts: AttemptRecord[], now: Date): RetakeStatus {
  const t = now.getTime();
  const countedAttempts = attempts.filter(counted).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const active = attempts.find(isActive);
  const recent = countedAttempts.filter((a) => t - Date.parse(a.startedAt) < 30 * DAY);
  const retakesUsed = Math.max(0, countedAttempts.length - 1);
  const freeRetakesLeft = Math.max(0, policy.freeRetakes - retakesUsed);
  const base = { attemptsLast30Days: recent.length, attemptsTotal: countedAttempts.length, freeRetakesLeft };
  if (active) {
    return { ...base, allowed: false, reason: 'You have an attempt in progress. Resume it instead of starting another.', activeAttemptId: active.id };
  }
  if (recent.length >= policy.maxAttemptsPer30Days) {
    const oldest = recent[0]!;
    const next = new Date(Date.parse(oldest.startedAt) + 30 * DAY);
    return {
      ...base,
      allowed: false,
      reason: `You have used all ${policy.maxAttemptsPer30Days} attempts allowed in 30 days.`,
      nextAllowedAt: next.toISOString(),
    };
  }
  const last = countedAttempts[countedAttempts.length - 1];
  if (last && freeRetakesLeft === 0 && policy.cooldownHours > 0) {
    const ended = Date.parse(last.completedAt ?? last.startedAt);
    const next = ended + policy.cooldownHours * HOUR;
    if (t < next) {
      return {
        ...base,
        allowed: false,
        reason: `Retakes after the free ones wait ${policy.cooldownHours} hours after your previous attempt.`,
        nextAllowedAt: new Date(next).toISOString(),
      };
    }
  }
  return { ...base, allowed: true };
}
