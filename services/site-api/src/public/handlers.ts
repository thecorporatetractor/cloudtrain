import { randomUUID } from 'node:crypto';
import type { SiteWaitlist } from '@cloudtrain/api-types';
import { checkWaitlist, honeypotTripped, isEmail, normaliseEmail } from '@cloudtrain/waitlist-rules';
import type { AddOnlyTable, Log, QueueSender } from '../model.js';
import type { WriteCap } from '../ratelimit.js';
import { dayOf, REQUEST_TYPES, subjectKey, tokenHash, verifyLeaveToken, verifyToken, waitlistShard, type PrivacyRequestType } from '../subject.js';

/*
 * The public Function app. Its identity can add rows, send to one queue and read the HMAC secret;
 * it can never read or delete a row, and this code is written so it never needs to.
 *
 * The browser contract is the gateway's: apps/web/src/lib/waitlist.ts and privacyRequest.ts.
 * Difference: POST /api/public/privacy/confirm answers 202 `pending`, never 200: only the worker can
 * read and delete, so it finishes the request and reports by mail. A used link still gets the 410,
 * from a claim row: adding it a second time answers 409, with no read.
 */

export interface ApiRequest {
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface ApiResponse {
  status: number;
  body: object;
  headers?: Record<string, string>;
}

/** What a row records about the consent given: which wording, under which notice, on which form. Never an IP. */
export interface ConsentEvidence {
  labelHash: string;
  noticeUpdated: string;
  source: string;
}

export interface PublicDeps {
  hmacKey: string;
  /** The object id of the VM's managed identity. Nothing else may call. */
  allowedPrincipalId: string;
  waitlist: SiteWaitlist | null;
  consent: ConsentEvidence | null;
  /** False (the default): an address already on the list gets the same answer as a new one. */
  revealDuplicates: boolean;
  /** How long a confirmation link lasts (default a day). */
  requestTtlMs: number;
  waitlistTable: AddOnlyTable;
  intakeTable: AddOnlyTable;
  queue: QueueSender;
  writeCap: WriteCap;
  now: () => Date;
  log: Log;
  /** Share of successful requests logged (default 1%); failures always are. */
  logSample: number;
  random?: () => number;
}

export const MAX_BODY_CHARS = 8 * 1024;
const WELCOME_TTL_SECONDS = 2 * 86_400;
const CONFIRM_TTL_SECONDS = 7 * 86_400;

export const ACCEPTED = { status: 'accepted', message: 'If this address can receive email, a confirmation link is on its way. It works once and expires after a day.' } as const;
const INVALID_LINK = { error: 'This link is invalid, has expired or was already used. You can send a new request.', code: 'invalid' };

const json = (status: number, body: object, headers?: Record<string, string>): ApiResponse => ({ status, body, headers: { 'cache-control': 'no-store', ...headers } });

const rateLimited = () => json(429, { error: 'Too many requests, try again later', code: 'rate_limited', details: { retryAfterSeconds: 1 } }, { 'retry-after': '1' });

/** The network, never the host: enough to see abuse in a log, not enough to name a visitor. Never an identity. */
export function ipPrefix(raw: string | null): string {
  if (!raw) return '';
  if (raw.includes(':')) return `${raw.split(':').slice(0, 3).join(':')}::/48`;
  const p = raw.split('.');
  return p.length === 4 ? `${p.slice(0, 3).join('.')}.0/24` : '';
}

/** The platform authenticated the caller and sets this header; here it must also be the one expected caller. */
function callerAllowed(req: ApiRequest, d: PublicDeps): boolean {
  const id = req.headers.get('x-ms-client-principal-id');
  if (!d.allowedPrincipalId || !id) return false;
  return id.toLowerCase() === d.allowedPrincipalId.toLowerCase();
}

async function readJson(req: ApiRequest): Promise<{ tooLarge: boolean; body: unknown }> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return { tooLarge: true, body: undefined };
  try {
    return { tooLarge: false, body: JSON.parse(raw) };
  } catch {
    return { tooLarge: false, body: undefined };
  }
}

function logged(d: PublicDeps, route: string, req: ApiRequest, r: ApiResponse): ApiResponse {
  const sampled = (d.random ?? Math.random)() < d.logSample;
  if (r.status >= 500) d.log.warn({ route, status: r.status, net: ipPrefix(req.headers.get('x-ct-client-ip')) }, 'request failed');
  else if (sampled) d.log.info({ route, status: r.status, net: ipPrefix(req.headers.get('x-ct-client-ip')) }, 'request');
  return r;
}

function guarded(route: string, d: PublicDeps, req: ApiRequest, inner: (body: unknown) => Promise<ApiResponse>): Promise<ApiResponse> {
  const run = async () => {
    if (!callerAllowed(req, d)) {
      d.log.warn({ route }, 'caller refused');
      return json(403, { error: 'Forbidden', code: 'forbidden' });
    }
    const { tooLarge, body } = await readJson(req);
    if (tooLarge) return json(413, { error: 'Request too large', code: 'invalid' });
    return inner(body);
  };
  return run().then((r) => logged(d, route, req, r));
}

export function postWaitlist(req: ApiRequest, d: PublicDeps): Promise<ApiResponse> {
  return guarded('waitlist', d, req, async (body) => {
    if (!d.waitlist || !d.consent) return json(503, { error: 'The waitlist is not available right now', code: 'upstream' });
    if (!d.waitlist.enabled) return json(404, { error: 'Not found', code: 'not_found' });
    // The honeypot: a bot that filled the hidden field is told it worked and nothing is stored.
    if (honeypotTripped(body)) return json(201, { status: 'created' });
    const check = checkWaitlist(body, d.waitlist);
    if (!check.ok) return json(422, { error: check.message, code: 'invalid', details: { fields: check.fields } });
    // The row and the welcome message.
    if (!d.writeCap.take(2)) return rateLimited();

    const { input } = check;
    const key = subjectKey(input.email, d.hmacKey);
    const at = d.now().toISOString();
    try {
      const added = await d.waitlistTable.add({
        partitionKey: waitlistShard(key),
        rowKey: key,
        email: input.email,
        ...(input.organisation ? { organisation: input.organisation } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.interest ? { interest: input.interest } : {}),
        consentAt: at,
        consentLabelHash: d.consent.labelHash,
        privacyNoticeUpdated: d.consent.noticeUpdated,
        formSource: d.consent.source,
        createdAt: at,
      });
      if (added) {
        // The signup is saved: a failure here costs the welcome mail, and never the answer.
        await d.queue.send({ v: 1, kind: 'welcome', subjectKey: key }, WELCOME_TTL_SECONDS).catch(() => d.log.warn({ route: 'waitlist' }, 'welcome message not queued'));
        return json(201, { status: 'created' });
      }
      return d.revealDuplicates ? json(200, { status: 'duplicate' }) : json(201, { status: 'created' });
    } catch {
      return json(503, { error: 'The waitlist is not available right now', code: 'upstream' });
    }
  });
}

export function postPrivacyRequest(req: ApiRequest, d: PublicDeps): Promise<ApiResponse> {
  return guarded('privacy-requests', d, req, async (raw) => {
    if (honeypotTripped(raw)) return json(202, ACCEPTED);
    const b = (raw && typeof raw === 'object' ? raw : {}) as { email?: unknown; type?: unknown };
    const fields: Record<string, string> = {};
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    if (!email) fields.email = 'Enter your email address';
    else if (!isEmail(email)) fields.email = 'Enter a valid email address';
    if (!REQUEST_TYPES.includes(b.type as PrivacyRequestType)) fields.type = 'Choose what you would like us to do';
    if (Object.keys(fields).length) return json(422, { error: 'Check the highlighted fields', code: 'invalid', details: { fields } });
    if (!d.writeCap.take(2)) return rateLimited();

    // The row is the same whether the address is known or not; this code cannot tell which it is.
    const now = d.now();
    const expires = now.getTime() + d.requestTtlMs;
    const requestId = randomUUID();
    const partition = dayOf(expires);
    try {
      await d.intakeTable.add({ partitionKey: partition, rowKey: requestId, email: normaliseEmail(email), type: b.type as PrivacyRequestType, requestedAt: now.toISOString(), expiresAt: new Date(expires).toISOString() });
      await d.queue.send({ v: 1, kind: 'send-confirmation', requestId, partition }, Math.ceil(d.requestTtlMs / 1000));
    } catch {
      return json(503, { error: 'We could not send your request just now. Please try again in a few minutes.', code: 'upstream' });
    }
    return json(202, ACCEPTED);
  });
}

export function postPrivacyConfirm(req: ApiRequest, d: PublicDeps): Promise<ApiResponse> {
  return guarded('privacy-confirm', d, req, async (raw) => {
    const token = raw && typeof raw === 'object' ? (raw as { token?: unknown }).token : undefined;
    const now = d.now().getTime();
    const request = verifyToken(token, now, d.hmacKey);
    const leave = request ? null : verifyLeaveToken(token, now, d.hmacKey);
    if (!request && !leave) return json(410, INVALID_LINK);
    // The message and the claim.
    if (!d.writeCap.take(2)) return rateLimited();
    const expiresAtMs = (request ?? leave)!.expiresAtMs;
    try {
      // Message first: if it fails nothing is claimed and the same link can be tried again. A
      // duplicate message from a double click changes nothing: the worker's checks are single-use too.
      await d.queue.send(request ? { v: 1, kind: 'confirm', token: token as string } : { v: 1, kind: 'leave', token: token as string }, CONFIRM_TTL_SECONDS);
      const first = await d.intakeTable.add({ partitionKey: dayOf(expiresAtMs), rowKey: `claim-${tokenHash(token as string)}`, expiresAt: new Date(expiresAtMs).toISOString() });
      if (!first) return json(410, INVALID_LINK);
    } catch {
      return json(503, { error: 'We could not complete this just now. Please try again in a few minutes.', code: 'upstream' });
    }
    return json(202, { status: 'pending', type: request ? request.type : 'withdrawal' });
  });
}
