import type { LabSession } from '@/api/types';

/** When the lab environment goes away: the gateway's expiresAt (it moves with extensions), else start + limit. */
export function labDeadline(s: Pick<LabSession, 'startedAt' | 'deadlineMinutes' | 'expiresAt'>): number {
  const expires = s.expiresAt ? Date.parse(s.expiresAt) : NaN;
  return Number.isFinite(expires) ? expires : Date.parse(s.startedAt) + s.deadlineMinutes * 60_000;
}

/** Warnings before the environment is removed, in seconds left (most urgent last). */
export const EXPIRY_WARNINGS = [10 * 60, 2 * 60] as const;

/**
 * The warning to give now, if any: the most urgent threshold the remaining time has reached
 * that was not given yet. Every less urgent one counts as given with it, so opening a lab at
 * 90 seconds left warns once, not twice. Nothing once the time is up.
 */
export function dueWarning(remainingSec: number, given: ReadonlySet<number>): number | undefined {
  if (remainingSec <= 0) return undefined;
  const reached = EXPIRY_WARNINGS.filter((t) => remainingSec <= t);
  const due = reached[reached.length - 1];
  return due !== undefined && !given.has(due) ? due : undefined;
}

/**
 * The warning's headline, from the time actually left: at the threshold it names it ("10 minutes
 * left"); a lab opened past it (5 minutes left when the 10-minute warning is due) says "Less than
 * 5 minutes left", never the threshold's larger number.
 */
export function warningTitle(remainingSec: number, threshold: number): string {
  if (Math.abs(remainingSec - threshold) <= WARNING_SLACK_SEC) return `${Math.round(threshold / 60)} minutes left`;
  const n = Math.max(1, Math.ceil(remainingSec / 60));
  return `Less than ${n} ${n === 1 ? 'minute' : 'minutes'} left`;
}
/** A tick can land a little after the threshold (a hidden tab, a slow frame). */
const WARNING_SLACK_SEC = 5;

export function warningText(remainingSec: number, threshold: number): string {
  return `${warningTitle(remainingSec, threshold)} in this lab. The environment and anything in it are removed when the time is up.`;
}

/**
 * Per-session clock state kept outside the Timer component: the last offset from the gateway's
 * clock, and the warnings already given for a deadline. Only GET /api/sessions/:id carries
 * serverTime; the start, validate and hint responses replace the cached session without it,
 * and the header can remount the Timer. Neither may move the countdown or repeat a warning.
 */
interface SessionClock {
  offset?: number;
  deadline?: number;
  given: Set<number>;
}
const clocks = new Map<string, SessionClock>();

export function sessionClock(sessionId: string | undefined): SessionClock {
  if (!sessionId) return { given: new Set() };
  let c = clocks.get(sessionId);
  if (!c) {
    c = { given: new Set() };
    clocks.set(sessionId, c);
  }
  return c;
}

/** The offset (gateway minus browser, ms) to count with: a fresh serverTime, else the last one seen for this session, else none. */
export function clockOffset(sessionId: string | undefined, serverTime: string | undefined, browserNow = Date.now()): number {
  const c = sessionClock(sessionId);
  const at = serverTime ? Date.parse(serverTime) : NaN;
  if (Number.isFinite(at)) c.offset = at - browserNow;
  return c.offset ?? 0;
}

/** For tests. */
export function resetSessionClocks(): void {
  clocks.clear();
}
