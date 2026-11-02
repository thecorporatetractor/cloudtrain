import type { SiteWaitlist } from '@cloudtrain/api-types';
import { checkWaitlist, type WaitlistInput } from '@cloudtrain/waitlist-rules';
import { badRequest } from '../errors.js';

/*
 * Input validation of POST /api/public/waitlist. The rules live in @cloudtrain/waitlist-rules,
 * shared with the website's Functions (services/site-api); this turns a refusal into the gateway's 422.
 */

export { EMAIL_MAX, HONEYPOT_FIELD, ORGANISATION_MAX, ROLE_MAX, honeypotTripped, isEmail } from '@cloudtrain/waitlist-rules';
export type { FieldErrors, WaitlistInput } from '@cloudtrain/waitlist-rules';

/** Validates the request body against the waitlist configuration; throws a 422 `invalid` with `details.fields`. */
export function validateWaitlist(body: unknown, cfg: SiteWaitlist): WaitlistInput {
  const r = checkWaitlist(body, cfg);
  if (!r.ok) throw badRequest(r.message, { fields: r.fields });
  return r.input;
}

/** Cells that a spreadsheet would run as a formula are prefixed with an apostrophe; fields with separators are quoted. */
export function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
