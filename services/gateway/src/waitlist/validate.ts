import type { SiteWaitlist, WaitlistInterest } from '@cloudtrain/api-types';
import { badRequest } from '../errors.js';

/*
 * Input validation of POST /api/public/waitlist. Hand written like the rest of
 * the gateway's request checks: strict types, trimmed strings, length limits,
 * no control characters, and the field rules (enabled, required, role choices)
 * come from the site configuration so the form and the endpoint agree.
 */

export const HONEYPOT_FIELD = 'website';
export const EMAIL_MAX = 254;
export const ORGANISATION_MAX = 120;
export const ROLE_MAX = 80;

export interface WaitlistInput {
  email: string;
  organisation?: string;
  role?: string;
  interest?: WaitlistInterest;
}

export type FieldErrors = Partial<Record<'email' | 'organisation' | 'role' | 'interest' | 'consent', string>>;

// Local part up to 64 characters, a dotted domain with a 2+ letter TLD, no spaces, no consecutive dots.
const EMAIL = /^[^\s@.][^\s@]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function isEmail(v: string): boolean {
  return v.length <= EMAIL_MAX && EMAIL.test(v) && !v.includes('..');
}

/** True when the honeypot field holds anything: a person never sees it. */
export function honeypotTripped(body: unknown): boolean {
  const v = body && typeof body === 'object' ? (body as Record<string, unknown>)[HONEYPOT_FIELD] : undefined;
  return v !== undefined && v !== null && v !== '' && v !== false;
}

function text(raw: unknown, max: number, errors: FieldErrors, key: keyof FieldErrors, label: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    errors[key] = `${label} must be text`;
    return undefined;
  }
  const v = raw.trim();
  if (!v) return undefined;
  if (CONTROL.test(v)) errors[key] = `${label} contains characters that are not allowed`;
  else if (v.length > max) errors[key] = `${label} must be at most ${max} characters`;
  else return v;
  return undefined;
}

/** Validates the request body against the waitlist configuration; throws a 422 `invalid` with `details.fields`. */
export function validateWaitlist(body: unknown, cfg: SiteWaitlist): WaitlistInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Expected a JSON object', { fields: {} });
  const b = body as Record<string, unknown>;
  const errors: FieldErrors = {};
  const fields = cfg.fields ?? {};
  const on = (f: { enabled?: boolean } | undefined) => f?.enabled !== false;

  let email: string | undefined;
  if (typeof b.email !== 'string' || !b.email.trim()) errors.email = 'Enter your email address';
  else {
    email = b.email.trim();
    if (!isEmail(email)) {
      errors.email = 'Enter a valid email address';
      email = undefined;
    }
  }

  const organisation = on(fields.organisation) ? text(b.organisation, ORGANISATION_MAX, errors, 'organisation', 'Organisation') : undefined;
  if (on(fields.organisation) && fields.organisation?.required && !organisation && !errors.organisation) errors.organisation = 'Enter your organisation';

  let role = on(fields.role) ? text(b.role, ROLE_MAX, errors, 'role', 'Role') : undefined;
  if (role && fields.role?.options?.length && !fields.role.options.includes(role)) {
    errors.role = 'Choose one of the listed roles';
    role = undefined;
  }
  if (on(fields.role) && fields.role?.required && !role && !errors.role) errors.role = 'Choose your role';

  let interest: WaitlistInterest | undefined;
  if (on(fields.interest) && b.interest !== undefined && b.interest !== null && b.interest !== '') {
    if (b.interest === 'enterprise' || b.interest === 'individual') interest = b.interest;
    else errors.interest = 'Choose enterprise or individual';
  }
  if (on(fields.interest) && fields.interest?.required && !interest && !errors.interest) errors.interest = 'Choose enterprise or individual';

  if (b.consent !== true) errors.consent = 'Please agree to the privacy notice to join the waitlist';

  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields', { fields: errors });
  return { email: email!, ...(organisation ? { organisation } : {}), ...(role ? { role } : {}), ...(interest ? { interest } : {}) };
}

/** Cells that a spreadsheet would run as a formula are prefixed with an apostrophe; fields with separators are quoted. */
export function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
