import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/*
 * Offline license keys (docs/licensing-keys.md).
 *
 * A license is a JWS in compact serialization, signed with Ed25519:
 *
 *   base64url(header) . base64url(payload) . base64url(signature)
 *
 *   header  { "alg": "EdDSA", "typ": "ct-license+jws", "kid": "<key id>" }
 *   payload LicensePayload (below)
 *
 * Any JOSE library can verify it with the published public key. The gateway
 * embeds the accepted public keys (keys.ts, several at once for rotation) and
 * never calls home: verification, expiry and seats are evaluated locally.
 *
 * A license file may wrap the token in comment lines (`# ...`) for humans;
 * `extractToken` drops them and any whitespace.
 */

export const LICENSE_TYP = 'ct-license+jws';
export const LICENSE_VERSION = 1;

export interface Licensee {
  /** Legal name of the licensee (shown on /platform). */
  name: string;
  email?: string;
}

export interface LicensePayload {
  /** Format version (1). */
  v: number;
  licenseId: string;
  licensee: Licensee;
  /** Commercial edition label, e.g. `enterprise`. */
  edition: string;
  /** Premium features the license grants (unknown ones are kept and ignored, so newer licenses work on older gateways). */
  features: string[];
  /** Active members the license covers; 0 = unlimited. */
  seats: number;
  /** ISO 8601 instants. */
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
}

export interface PublicKeyEntry {
  /** Key id, the `kid` in the JWS header. */
  kid: string;
  /** SPKI PEM of the Ed25519 public key. */
  publicKey: string;
  /**
   * Rotation: licenses this key signed with `issuedAt` after this instant are
   * refused (the key was retired or leaked then). Licenses issued before keep working.
   */
  retiredAt?: string;
  /** Shown on /platform; never trusted for anything else. */
  label?: string;
}

export class LicenseError extends Error {
  constructor(
    public readonly reason: 'malformed' | 'unsupported' | 'unknown_key' | 'bad_signature' | 'retired_key' | 'invalid_claims',
    message: string,
  ) {
    super(message);
  }
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');
const B64U = /^[A-Za-z0-9_-]+$/;

/** The token inside a license file or env value: comment lines and whitespace dropped. */
export function extractToken(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join('')
    .replace(/\s+/g, '');
}

function decodeJson(part: string, what: string): Record<string, unknown> {
  if (!B64U.test(part)) throw new LicenseError('malformed', `License ${what} is not base64url`);
  try {
    const v = JSON.parse(fromB64u(part).toString('utf8')) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new LicenseError('malformed', `License ${what} is not valid JSON`);
  }
}

const isInstant = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Shape check of the claims; dates and the feature list must parse. */
export function checkPayload(p: Record<string, unknown>): LicensePayload {
  const bad = (m: string) => new LicenseError('invalid_claims', `License claims: ${m}`);
  if (p.v !== LICENSE_VERSION) throw new LicenseError('unsupported', `License format version ${String(p.v)} is not supported by this gateway (expects ${LICENSE_VERSION})`);
  if (typeof p.licenseId !== 'string' || !p.licenseId) throw bad('licenseId is required');
  const l = p.licensee as Licensee | undefined;
  if (!l || typeof l.name !== 'string' || !l.name.trim()) throw bad('licensee.name is required');
  if (l.email !== undefined && typeof l.email !== 'string') throw bad('licensee.email must be a string');
  if (typeof p.edition !== 'string' || !p.edition) throw bad('edition is required');
  if (!Array.isArray(p.features) || p.features.some((f) => typeof f !== 'string')) throw bad('features must be a list of strings');
  if (typeof p.seats !== 'number' || !Number.isInteger(p.seats) || p.seats < 0) throw bad('seats must be a whole number (0 = unlimited)');
  for (const k of ['issuedAt', 'notBefore', 'expiresAt'] as const) if (!isInstant(p[k])) throw bad(`${k} must be an ISO 8601 instant`);
  if (Date.parse(p.expiresAt as string) <= Date.parse(p.notBefore as string)) throw bad('expiresAt must be after notBefore');
  return {
    v: LICENSE_VERSION,
    licenseId: p.licenseId,
    licensee: { name: l.name, ...(l.email ? { email: l.email } : {}) },
    edition: p.edition,
    features: p.features as string[],
    seats: p.seats,
    issuedAt: p.issuedAt as string,
    notBefore: p.notBefore as string,
    expiresAt: p.expiresAt as string,
  };
}

/**
 * Verifies the signature against the accepted keys and returns the claims.
 * Says nothing about time: `evaluate` (state.ts) decides valid, expiring,
 * grace or expired, so an expired license can still be shown.
 */
export function verifyLicense(text: string, keys: readonly PublicKeyEntry[]): { kid: string; payload: LicensePayload } {
  const token = extractToken(text);
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) throw new LicenseError('malformed', 'A license key has three dot-separated parts (header.payload.signature)');
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h, 'header');
  if (header.alg !== 'EdDSA' || header.typ !== LICENSE_TYP) throw new LicenseError('unsupported', `Not a CloudTrain license (alg ${String(header.alg)}, typ ${String(header.typ)})`);
  if (header.crit !== undefined) throw new LicenseError('unsupported', 'License header has critical extensions this gateway does not understand');
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const entry = keys.find((k) => k.kid === kid);
  if (!entry) throw new LicenseError('unknown_key', `License signed with key "${kid}", which this gateway does not accept`);
  if (!B64U.test(s)) throw new LicenseError('malformed', 'License signature is not base64url');
  const ok = verify(null, Buffer.from(`${h}.${p}`, 'ascii'), publicKeyOf(entry), fromB64u(s));
  if (!ok) throw new LicenseError('bad_signature', 'License signature does not verify: the key was altered or not issued by CloudTrain');
  const payload = checkPayload(decodeJson(p, 'payload'));
  if (entry.retiredAt && Date.parse(payload.issuedAt) > Date.parse(entry.retiredAt)) {
    throw new LicenseError('retired_key', `License issued ${payload.issuedAt} with key "${kid}", retired on ${entry.retiredAt}`);
  }
  return { kid, payload };
}

const keyCache = new Map<string, KeyObject>();
function publicKeyOf(e: PublicKeyEntry): KeyObject {
  let k = keyCache.get(e.publicKey);
  if (!k) {
    k = createPublicKey(e.publicKey);
    if (k.asymmetricKeyType !== 'ed25519') throw new LicenseError('unsupported', `Key ${e.kid} is not an Ed25519 key`);
    keyCache.set(e.publicKey, k);
  }
  return k;
}

/** Signs claims into a license token (issuer CLI, tests, the in-memory dev license). */
export function signLicense(payload: LicensePayload, privateKey: KeyObject | string, kid: string): string {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The signing key must be an Ed25519 private key');
  const claims = checkPayload(payload as unknown as Record<string, unknown>);
  const h = b64u(JSON.stringify({ alg: 'EdDSA', typ: LICENSE_TYP, kid }));
  const p = b64u(JSON.stringify(claims));
  const s = sign(null, Buffer.from(`${h}.${p}`, 'ascii'), key);
  return `${h}.${p}.${b64u(s)}`;
}

/** A fresh Ed25519 key pair (PEM): PKCS#8 private, SPKI public. */
export function generateSigningKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
}

/** A license file: the token with a readable header of comment lines. */
export function licenseFile(token: string, p: LicensePayload, kid: string): string {
  const lines = [
    '# CloudTrain license key (docs/licensing-keys.md). Install with CT_LICENSE_FILE, CT_LICENSE_KEY or on /platform/license.',
    `# License:  ${p.licenseId}`,
    `# Licensee: ${p.licensee.name}${p.licensee.email ? ` <${p.licensee.email}>` : ''}`,
    `# Edition:  ${p.edition}`,
    `# Features: ${p.features.join(', ') || '(none)'}`,
    `# Seats:    ${p.seats || 'unlimited'}`,
    `# Valid:    ${p.notBefore} to ${p.expiresAt}`,
    `# Key id:   ${kid}`,
  ];
  // Wrapped at 76 characters so mail clients and terminals keep it intact.
  return `${lines.join('\n')}\n${token.match(/.{1,76}/g)!.join('\n')}\n`;
}
