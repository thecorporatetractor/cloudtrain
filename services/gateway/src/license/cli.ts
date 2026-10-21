import { randomBytes, createPrivateKey, createPublicKey } from 'node:crypto';
import { closeSync, fchmodSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FEATURES, featuresOf } from '../entitlements/features.js';
import { ACCEPTED_KEYS } from './keys.js';
import { evaluate } from './state.js';
import { generateSigningKeyPair, licenseFile, signLicense, verifyLicense, LICENSE_VERSION, type LicensePayload } from './token.js';

/*
 * License issuer (docs/licensing-keys.md, "Issuing"):
 *
 *   pnpm --filter @cloudtrain/gateway license:keygen [--out FILE] [--kid ID]
 *   pnpm --filter @cloudtrain/gateway license:issue --key FILE --licensee NAME [--email E]
 *        [--features all|sso,audit_export,...] [--seats N] [--days N | --expires DATE]
 *        [--not-before DATE] [--edition enterprise] [--license-id ID] [--out FILE]
 *   pnpm --filter @cloudtrain/gateway license:inspect FILE
 *
 * The private key never leaves the issuer's machine and is never printed.
 * keygen writes it with mode 600 (default ~/.config/cloudtrain/license-signing.key)
 * and prints only the public key, to commit in src/license/keys.ts.
 */

const DEFAULT_KEY = path.join(os.homedir(), '.config', 'cloudtrain', 'license-signing.key');
const KID_LINE = /^#\s*kid:\s*(\S+)\s*$/m;

function fail(m: string): never {
  process.stderr.write(`${m}\n`);
  process.exit(1);
}

function keygen(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, kid: { type: 'string' }, force: { type: 'boolean' } } });
  const out = path.resolve(values.out ?? DEFAULT_KEY);
  const now = new Date();
  const kid = values.kid ?? `ct-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(kid)) fail('--kid: lowercase letters, digits, dot, dash or underscore');
  const { privateKey, publicKey } = generateSigningKeyPair();
  mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  // Created exclusively (O_EXCL) unless --force: never overwrites a signing key by accident.
  let fd: number;
  try {
    fd = openSync(out, values.force ? 'w' : 'wx', 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') fail(`${out} exists; refusing to overwrite a signing key (--force replaces it, and every license it signed then needs the old public key kept in keys.ts).`);
    throw e;
  }
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `# CloudTrain license signing key. PRIVATE: never commit, copy or print it.\n# kid: ${kid}\n${privateKey}`);
  } finally {
    closeSync(fd);
  }
  process.stdout.write(`Private key written to ${out} (mode 600). It is not printed.\n\nAdd the public key to services/gateway/src/license/keys.ts:\n\n  {\n    kid: '${kid}',\n    label: 'CloudTrain license signing key (${now.toISOString().slice(0, 10)})',\n    publicKey: \`${publicKey.trim()}\`,\n  },\n`);
}

function readSigningKey(file: string): { key: ReturnType<typeof createPrivateKey>; kid?: string } {
  const abs = path.resolve(file);
  // One open file: the mode checked is the mode of the file read.
  let fd: number;
  try {
    fd = openSync(abs, 'r');
  } catch {
    fail(`No signing key at ${abs}`);
  }
  let text: string;
  try {
    const mode = fstatSync(fd).mode & 0o777;
    if (process.platform !== 'win32' && mode & 0o077) process.stderr.write(`warning: ${abs} is readable by others (mode ${mode.toString(8)}); chmod 600 it.\n`);
    text = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
  const pem = text.slice(text.indexOf('-----BEGIN'));
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    fail(`${abs} is not a PEM private key`);
  }
  if (key.asymmetricKeyType !== 'ed25519') fail(`${abs} is not an Ed25519 key`);
  const kid = KID_LINE.exec(text)?.[1];
  return { key, ...(kid ? { kid } : {}) };
}

function date(v: string, flag: string): Date {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) fail(`${flag}: not a date (YYYY-MM-DD or ISO 8601)`);
  return d;
}

function issue(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      key: { type: 'string' },
      kid: { type: 'string' },
      licensee: { type: 'string' },
      email: { type: 'string' },
      edition: { type: 'string', default: 'enterprise' },
      features: { type: 'string', default: 'all' },
      seats: { type: 'string', default: '0' },
      days: { type: 'string' },
      expires: { type: 'string' },
      'not-before': { type: 'string' },
      'license-id': { type: 'string' },
      out: { type: 'string' },
      'allow-unknown-key': { type: 'boolean' },
    },
  });
  if (!values.key) fail('--key <private-key-file> is required (license:keygen creates one)');
  if (!values.licensee?.trim()) fail('--licensee "<legal name>" is required');
  const { key, kid: fileKid } = readSigningKey(values.key);
  const kid = values.kid ?? fileKid;
  if (!kid) fail('--kid is required (the key file has no "# kid:" line)');
  const pub = createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString().trim();
  const accepted = ACCEPTED_KEYS.find((k) => k.kid === kid);
  if (!accepted && !values['allow-unknown-key']) fail(`Key id "${kid}" is not in src/license/keys.ts: gateways would refuse the license. Add the public key first (or pass --allow-unknown-key for a test license).`);
  if (accepted && accepted.publicKey.trim() !== pub) fail(`The key file does not match the public key "${kid}" in src/license/keys.ts.`);
  if (accepted?.retiredAt) fail(`Key "${kid}" was retired on ${accepted.retiredAt}; issue with the current key.`);

  const requested = values.features === 'all' ? [...FEATURES] : values.features.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((f) => !featuresOf([f]).length);
  if (unknown.length) fail(`Unknown feature(s): ${unknown.join(', ')}. Known: ${FEATURES.join(', ')}, or "all".`);
  const seats = Number(values.seats);
  if (!Number.isInteger(seats) || seats < 0) fail('--seats: a whole number, 0 = unlimited');
  const now = new Date();
  const notBefore = values['not-before'] ? date(values['not-before'], '--not-before') : now;
  let expires: Date;
  if (values.expires) expires = date(values.expires, '--expires');
  else {
    const days = Number(values.days ?? 365);
    if (!Number.isInteger(days) || days < 1) fail('--days: a whole number of days, at least 1');
    expires = new Date(notBefore.getTime() + days * 86_400_000);
  }
  const payload: LicensePayload = {
    v: LICENSE_VERSION,
    licenseId: values['license-id'] ?? `lic_${now.toISOString().slice(0, 10).replace(/-/g, '')}_${randomBytes(5).toString('hex')}`,
    licensee: { name: values.licensee.trim(), ...(values.email ? { email: values.email.trim() } : {}) },
    edition: values.edition,
    features: requested,
    seats,
    issuedAt: now.toISOString(),
    notBefore: notBefore.toISOString(),
    expiresAt: expires.toISOString(),
  };
  const token = signLicense(payload, key, kid);
  const file = licenseFile(token, payload, kid);
  if (values.out) {
    writeFileSync(path.resolve(values.out), file, { mode: 0o644 });
    process.stderr.write(`License ${payload.licenseId} for ${payload.licensee.name} written to ${path.resolve(values.out)} (valid ${payload.notBefore} to ${payload.expiresAt}).\n`);
  } else process.stdout.write(file);
}

function inspect(argv: string[]): void {
  const file = argv[0];
  if (!file) fail('usage: license:inspect <license-file>');
  try {
    const { kid, payload } = verifyLicense(readFileSync(path.resolve(file), 'utf8'), ACCEPTED_KEYS);
    const ev = evaluate(payload, new Date());
    process.stdout.write(`${JSON.stringify({ kid, ...payload, state: ev.state, daysLeft: ev.daysLeft, graceEndsAt: ev.graceEndsAt }, null, 2)}\n`);
  } catch (e) {
    fail(`Invalid license: ${(e as Error).message}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
if (cmd === 'keygen') keygen(rest);
else if (cmd === 'issue') issue(rest);
else if (cmd === 'inspect') inspect(rest);
else fail('usage: cli.ts keygen | issue | inspect (docs/licensing-keys.md)');
