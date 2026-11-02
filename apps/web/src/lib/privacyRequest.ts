import type { PrivacyAccepted, PrivacyConfirmResponse, PublicPrivacyRequest, PublicPrivacyRequestType } from '@/api/types';
import { apiUrl } from './runtimeConfig';
import { isEmail } from './waitlist';

/*
 * The public privacy request page's logic, free of React so it is unit tested. The two calls
 * are the whole contract, whichever backend answers them (the gateway, or the website's
 * Functions on the production site):
 *
 *   POST /api/public/privacy/requests  { email, type, website }
 *        202 { status: 'accepted', message }, the same for every address
 *        422 { code: 'invalid', details: { fields } }, 429 { code: 'rate_limited', details: { retryAfterSeconds } }
 *   POST /api/public/privacy/confirm   { token }
 *        200 { status: 'completed', type, removed?, data? }
 *        202 { status: 'pending', type }: not finished, never to be shown as done
 *        410: the link is invalid, expired or used, one answer for all three
 *        503: nothing was done or nothing is recorded yet; for a copy, the same link can be retried
 *
 * No cookies and no CSRF token: these are for visitors without a session.
 */

export interface PrivacyForm {
  email: string;
  type: PublicPrivacyRequestType | '';
  /** Honeypot: hidden from people, bots fill it. */
  website: string;
}

export type PrivacyField = 'email' | 'type';
export type PrivacyErrors = Partial<Record<PrivacyField, string>>;

export const emptyPrivacyForm: PrivacyForm = { email: '', type: '', website: '' };

export const PRIVACY_REQUEST_TYPES: { value: PublicPrivacyRequestType; label: string; hint: string }[] = [
  { value: 'erasure', label: 'Erase my waitlist entry', hint: 'We delete your entry on the early-access waitlist.' },
  { value: 'withdrawal', label: 'Withdraw my consent', hint: 'Your consent is the only reason we hold the entry, so withdrawing it removes the entry too.' },
  { value: 'export', label: 'Get a copy of my data', hint: 'We show you what the waitlist holds under this address.' },
];

export function validatePrivacyForm(form: PrivacyForm): PrivacyErrors {
  const e: PrivacyErrors = {};
  const email = form.email.trim();
  if (!email) e.email = 'Enter your email address';
  else if (!isEmail(email)) e.email = 'Enter a valid email address, like name@example.com';
  if (!form.type) e.type = 'Choose what you would like us to do';
  return e;
}

export const privacyPayload = (form: PrivacyForm): PublicPrivacyRequest => ({ email: form.email.trim(), type: form.type as PublicPrivacyRequestType, website: form.website });

/** The token in the link from the mail: in the fragment, so it reaches no server log and no referrer. */
export function tokenFromHash(hash: string): string | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return v || null;
}

export class PrivacyError extends Error {
  constructor(
    public readonly kind: 'invalid' | 'rate_limited' | 'expired' | 'unavailable' | 'failed',
    message: string,
    public readonly fields: PrivacyErrors = {},
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

async function call(url: string, payload: unknown, fetchImpl: typeof fetch): Promise<{ res: Response; body: Record<string, unknown> & { error?: string; details?: { fields?: PrivacyErrors; retryAfterSeconds?: number } } }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {
    throw new PrivacyError('failed', 'The network request failed');
  }
  let body = {};
  try {
    body = (await res.json()) as object;
  } catch {
    /* no JSON body */
  }
  return { res, body };
}

export async function submitPrivacyRequest(payload: PublicPrivacyRequest, fetchImpl: typeof fetch = fetch, url: string = apiUrl('/api/public/privacy/requests')): Promise<PrivacyAccepted> {
  const { res, body } = await call(url, payload, fetchImpl);
  if (res.ok && body.status === 'accepted') return body as unknown as PrivacyAccepted;
  if (res.status === 422 && body.details?.fields) throw new PrivacyError('invalid', body.error ?? 'Check the highlighted fields', body.details.fields);
  if (res.status === 429) throw new PrivacyError('rate_limited', body.error ?? 'Too many requests', {}, body.details?.retryAfterSeconds);
  throw new PrivacyError('failed', body.error ?? `Request failed (${res.status})`);
}

export async function confirmPrivacyRequest(token: string, fetchImpl: typeof fetch = fetch, url: string = apiUrl('/api/public/privacy/confirm')): Promise<PrivacyConfirmResponse> {
  const { res, body } = await call(url, { token }, fetchImpl);
  if (res.ok && (body.status === 'completed' || body.status === 'pending')) return body as unknown as PrivacyConfirmResponse;
  if (res.status === 410) throw new PrivacyError('expired', body.error ?? 'This link is invalid or has expired');
  if (res.status === 429) throw new PrivacyError('rate_limited', body.error ?? 'Too many requests', {}, body.details?.retryAfterSeconds);
  if (res.status === 503) throw new PrivacyError('unavailable', body.error ?? 'Not available right now');
  throw new PrivacyError('failed', body.error ?? `Request failed (${res.status})`);
}

/** What the visitor reads after confirming. `pending` never says the data is gone: there is no evidence of that yet. */
export function resultMessage(r: PrivacyConfirmResponse): { title: string; body: string } {
  if (r.status === 'pending') return { title: 'Your request is still being processed', body: 'It is not finished yet. We keep trying, and we will email you as soon as it is complete. You do not need to do anything.' };
  if (r.type === 'export') return r.data?.waitlist.length ? { title: 'Your data', body: 'This is everything the waitlist holds under your address.' } : { title: 'We hold no waitlist entry for this address', body: 'There is nothing to send you. If you also have a CloudTrain account, you can download its data under Privacy in your account.' };
  if (!r.removed) return { title: 'We hold no waitlist entry for this address', body: 'There was nothing to remove. We have recorded that your request was handled.' };
  return r.type === 'withdrawal' ? { title: 'Your consent is withdrawn', body: 'Your waitlist entry has been erased, and we have recorded that this was done.' } : { title: 'Your waitlist entry is erased', body: 'We have recorded that this was done.' };
}
