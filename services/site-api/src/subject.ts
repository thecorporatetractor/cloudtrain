import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normaliseEmail } from '@cloudtrain/waitlist-rules';

/*
 * Keys and confirmation links. The same derivations as services/gateway/src/gdpr/subject.ts, so
 * the website and the platform produce the same evidence for the same address and secret.
 *
 * The subject key does two jobs here: it is the `subjectKey` of a ledger record and the RowKey of
 * a waitlist row. An erasure request, or a ledger record after a restore, therefore points straight
 * at the row with no address and no scan. It is pseudonymous personal data: whoever holds
 * CT_GDPR_HMAC_KEY can test an address against it.
 */

export { normaliseEmail };

export type PrivacyRequestType = 'erasure' | 'withdrawal' | 'export';
export const REQUEST_TYPES: readonly PrivacyRequestType[] = ['erasure', 'withdrawal', 'export'];

export const subjectKey = (email: string, hmacKey: string): string => createHmac('sha256', hmacKey).update(`email:${normaliseEmail(email)}`).digest('hex');

const linkKey = (hmacKey: string) => createHmac('sha256', hmacKey).update('privacy-link-v1').digest();
const sign = (payload: string, hmacKey: string) => createHmac('sha256', linkKey(hmacKey)).update(payload).digest('base64url');

export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * `v1.<request id>.<expiry ms>.<type>-<random>.<signature>`: the gateway's format, whose verifyToken
 * accepts it. The fourth part starts with the type because the public app, which can read no row,
 * must still answer `{ status: 'pending', type }`.
 */
export function issueToken(requestId: string, expiresAt: Date, type: PrivacyRequestType, hmacKey: string): string {
  const payload = `v1.${requestId}.${expiresAt.getTime()}.${type}-${randomBytes(32).toString('base64url')}`;
  return `${payload}.${sign(payload, hmacKey)}`;
}

export interface VerifiedToken {
  requestId: string;
  expiresAtMs: number;
  type: PrivacyRequestType;
}

/** The token's contents when the signature holds and it has not expired, else null. */
export function verifyToken(token: unknown, nowMs: number, hmacKey: string): VerifiedToken | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const given = Buffer.from(parts[4]!);
  const want = Buffer.from(sign(parts.slice(0, 4).join('.'), hmacKey));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  const type = parts[3]!.split('-', 1)[0] as PrivacyRequestType;
  if (!REQUEST_TYPES.includes(type)) return null;
  return { requestId: parts[1]!, expiresAtMs: exp, type };
}

/*
 * The leave link in every waitlist mail: `l1.<subject key>.<expiry ms>.<nonce>.<signature>`, signed
 * with a key of its own derived from CT_GDPR_HMAC_KEY, so it is good for this purpose and this
 * subject only and a request token can never pass for one, or the reverse. It lasts as long as the
 * row can. The nonce is kept on the waitlist row by the worker, which the public identity cannot
 * change: a signature alone does not act on a row, so holding the HMAC key is not enough.
 */
const leaveKey = (hmacKey: string) => createHmac('sha256', hmacKey).update('waitlist-leave-v1').digest();
const signLeave = (payload: string, hmacKey: string) => createHmac('sha256', leaveKey(hmacKey)).update(payload).digest('base64url');

export function issueLeaveToken(key: string, expiresAt: Date, nonce: string, hmacKey: string): string {
  const payload = `l1.${key}.${expiresAt.getTime()}.${nonce}`;
  return `${payload}.${signLeave(payload, hmacKey)}`;
}

export const newLeaveNonce = (): string => randomBytes(16).toString('base64url');

export interface VerifiedLeaveToken {
  subjectKey: string;
  nonce: string;
  expiresAtMs: number;
}

export function verifyLeaveToken(token: unknown, nowMs: number, hmacKey: string): VerifiedLeaveToken | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'l1' || !/^[0-9a-f]{64}$/.test(parts[1]!)) return null;
  const given = Buffer.from(parts[4]!);
  const want = Buffer.from(signLeave(parts.slice(0, 4).join('.'), hmacKey));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  return { subjectKey: parts[1]!, nonce: parts[3]!, expiresAtMs: exp };
}

/** Where every mailed link points: the page acts only when the visitor presses its button, so mail scanners cannot. */
export const privacyLink = (siteUrl: string, token: string): string => `${siteUrl.replace(/\/$/, '')}/legal/privacy-request#token=${encodeURIComponent(token)}`;

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The partition of a privacy request: the UTC day it expires, so a day's rows expire together. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A waitlist row's address: a shard of the key, so the one row per address is a point lookup. */
export const waitlistShard = (key: string): string => key.slice(0, 2);
