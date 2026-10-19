import type { SiteWaitlist, WaitlistInterest, WaitlistRequest, WaitlistResponse } from '@/api/types';
import { apiUrl } from './runtimeConfig';

/*
 * The waitlist form's logic, free of React so it is unit tested: the field
 * rules (the same the gateway applies, driven by content/site.yaml `waitlist`),
 * and the request to POST /api/public/waitlist on the configured API origin.
 */

export interface WaitlistForm {
  email: string;
  organisation: string;
  role: string;
  interest: WaitlistInterest | '';
  consent: boolean;
  /** Honeypot: hidden from people, bots fill it. */
  website: string;
}

export type WaitlistField = 'email' | 'organisation' | 'role' | 'interest' | 'consent';
export type WaitlistErrors = Partial<Record<WaitlistField, string>>;

export const emptyWaitlistForm: WaitlistForm = { email: '', organisation: '', role: '', interest: '', consent: false, website: '' };

const EMAIL = /^[^\s@.][^\s@]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const isEmail = (v: string): boolean => v.length <= 254 && EMAIL.test(v) && !v.includes('..');

/** Whether the optional field is shown (default yes). */
export const fieldOn = (cfg: SiteWaitlist, f: 'organisation' | 'role' | 'interest'): boolean => cfg.fields?.[f]?.enabled !== false;

export function validateWaitlistForm(form: WaitlistForm, cfg: SiteWaitlist): WaitlistErrors {
  const e: WaitlistErrors = {};
  const email = form.email.trim();
  if (!email) e.email = 'Enter your email address';
  else if (!isEmail(email)) e.email = 'Enter a valid email address, like name@example.com';
  const f = cfg.fields ?? {};
  if (fieldOn(cfg, 'organisation')) {
    if (form.organisation.trim().length > 120) e.organisation = 'Use at most 120 characters';
    else if (f.organisation?.required && !form.organisation.trim()) e.organisation = 'Enter your organisation';
  }
  if (fieldOn(cfg, 'role')) {
    if (form.role.trim().length > 80) e.role = 'Use at most 80 characters';
    else if (f.role?.required && !form.role.trim()) e.role = 'Choose your role';
  }
  if (fieldOn(cfg, 'interest') && f.interest?.required && !form.interest) e.interest = 'Choose the option that fits you';
  if (!form.consent) e.consent = 'Agree to the privacy notice to join the waitlist';
  return e;
}

/** The request body: only the enabled fields, trimmed; the honeypot is sent as is (empty for people). */
export function waitlistPayload(form: WaitlistForm, cfg: SiteWaitlist): WaitlistRequest {
  const organisation = form.organisation.trim();
  const role = form.role.trim();
  return {
    email: form.email.trim(),
    ...(fieldOn(cfg, 'organisation') && organisation ? { organisation } : {}),
    ...(fieldOn(cfg, 'role') && role ? { role } : {}),
    ...(fieldOn(cfg, 'interest') && form.interest ? { interest: form.interest } : {}),
    consent: form.consent,
    website: form.website,
  };
}

/** A failed submission: `fields` when the gateway rejected specific fields, `retryAfterSeconds` when rate limited. */
export class WaitlistError extends Error {
  constructor(
    public readonly kind: 'invalid' | 'rate_limited' | 'failed',
    message: string,
    public readonly fields: WaitlistErrors = {},
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/**
 * Posts the entry to the gateway (`/api/public/waitlist` on the API origin of
 * runtime-config.js, which a static deployment points at the gateway). No
 * cookies and no CSRF token: the endpoint is for visitors without a session.
 */
export async function submitWaitlist(payload: WaitlistRequest, fetchImpl: typeof fetch = fetch, url: string = apiUrl('/api/public/waitlist')): Promise<WaitlistResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {
    throw new WaitlistError('failed', 'The network request failed');
  }
  let body: { status?: string; error?: string; code?: string; details?: { fields?: WaitlistErrors; retryAfterSeconds?: number } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* no JSON body */
  }
  if (res.ok && (body.status === 'created' || body.status === 'duplicate')) return { status: body.status };
  if (res.status === 422 && body.details?.fields) throw new WaitlistError('invalid', body.error ?? 'Check the highlighted fields', body.details.fields);
  if (res.status === 429) throw new WaitlistError('rate_limited', body.error ?? 'Too many requests', {}, body.details?.retryAfterSeconds);
  throw new WaitlistError('failed', body.error ?? `Request failed (${res.status})`);
}
