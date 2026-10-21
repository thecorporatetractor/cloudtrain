import type { LicenseState } from '@cloudtrain/api-types';
import type { LicensePayload } from './token.js';

/*
 * Time rules of a license (docs/licensing-keys.md):
 *
 *   notBefore - skew ........ expiresAt - 30 days ...... expiresAt ...... expiresAt + 14 days ......
 *   not_yet_valid | valid                  | expiring           | grace               | expired
 *
 * Features are on while valid, expiring or in grace; off before notBefore and
 * after the grace period. Nothing is deleted when they switch off.
 */

export const WARN_DAYS = 30;
export const GRACE_DAYS = 14;
/** Clock skew tolerated at notBefore (a license issued "now" on a machine a little ahead). */
export const SKEW_MS = 5 * 60_000;
const DAY = 86_400_000;

export interface Evaluation {
  state: Exclude<LicenseState, 'none' | 'invalid' | 'ignored'>;
  /** Premium features in force. */
  active: boolean;
  /** Whole days until expiresAt, rounded down (negative once past it). */
  daysLeft: number;
  graceEndsAt: string;
}

export function evaluate(p: Pick<LicensePayload, 'notBefore' | 'expiresAt'>, now: Date, o: { warnDays?: number; graceDays?: number } = {}): Evaluation {
  const warn = (o.warnDays ?? WARN_DAYS) * DAY;
  const grace = (o.graceDays ?? GRACE_DAYS) * DAY;
  const t = now.getTime();
  const nbf = Date.parse(p.notBefore);
  const exp = Date.parse(p.expiresAt);
  const graceEnds = exp + grace;
  const daysLeft = Math.floor((exp - t) / DAY);
  const graceEndsAt = new Date(graceEnds).toISOString();
  if (t < nbf - SKEW_MS) return { state: 'not_yet_valid', active: false, daysLeft, graceEndsAt };
  if (t >= graceEnds) return { state: 'expired', active: false, daysLeft, graceEndsAt };
  if (t >= exp) return { state: 'grace', active: true, daysLeft, graceEndsAt };
  if (t >= exp - warn) return { state: 'expiring', active: true, daysLeft, graceEndsAt };
  return { state: 'valid', active: true, daysLeft, graceEndsAt };
}
