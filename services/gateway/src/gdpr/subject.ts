import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Pseudonymous keys and confirmation links.
 *
 * A ledger record never holds the address. It holds the subject key: HMAC-SHA-256 of the
 * normalised address under the server-side CT_GDPR_HMAC_KEY. That is still pseudonymous
 * personal data (whoever holds the key can test an address against it, docs/gdpr.md).
 *
 * The links in confirmation mails are signed with a key derived from the same secret, with
 * a domain label so a link signature can never collide with a subject key.
 */

/** Trim and lowercase: the same equality the unique indexes on lower(email) apply. NFC, so one address has one form. */
export const normaliseEmail = (email: string): string => email.normalize('NFC').trim().toLowerCase();

export const subjectKey = (email: string, hmacKey: string): string => createHmac('sha256', hmacKey).update(`email:${normaliseEmail(email)}`).digest('hex');

/** The same keyed hash over the user id: a restored row that still holds an older address is matched by this one. */
export const userKey = (userId: string, hmacKey: string): string => createHmac('sha256', hmacKey).update(`user:${userId}`).digest('hex');

const linkKey = (hmacKey: string) => createHmac('sha256', hmacKey).update('privacy-link-v1').digest();
const sign = (payload: string, hmacKey: string) => createHmac('sha256', linkKey(hmacKey)).update(payload).digest('base64url');

export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A signed, expiring link token: `v1.<request id>.<expiry ms>.<random>.<signature>`. Only its hash is stored. */
export function issueToken(requestId: string, expiresAt: Date, hmacKey: string): string {
  const payload = `v1.${requestId}.${expiresAt.getTime()}.${randomBytes(32).toString('base64url')}`;
  return `${payload}.${sign(payload, hmacKey)}`;
}

/** The token's request id when the signature holds and it has not expired, else null. */
export function verifyToken(token: unknown, nowMs: number, hmacKey: string): { requestId: string } | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const payload = parts.slice(0, 4).join('.');
  const given = Buffer.from(parts[4]!);
  const want = Buffer.from(sign(payload, hmacKey));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  return { requestId: parts[1]! };
}
