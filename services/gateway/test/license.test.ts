import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SitePlan } from '@cloudtrain/api-types';
import { describe, expect, it } from 'vitest';
import { editionFrom, licenseSourceFrom, loadConfig } from '../src/config.js';
import { Entitlements, type PlanSource } from '../src/entitlements/service.js';
import { ACCEPTED_KEYS } from '../src/license/keys.js';
import { DEV_KID, LicenseManager } from '../src/license/manager.js';
import { evaluate, GRACE_DAYS, WARN_DAYS } from '../src/license/state.js';
import { extractToken, generateSigningKeyPair, licenseFile, LICENSE_VERSION, LicenseError, signLicense, verifyLicense, type LicensePayload, type PublicKeyEntry } from '../src/license/token.js';
import { devPrincipal } from '../src/auth.js';
import { HttpError } from '../src/errors.js';

const DAY = 86_400_000;
const NOW = new Date('2026-10-21T12:00:00Z');

// Ephemeral test key pairs: the real signing key never takes part in tests.
const A = generateSigningKeyPair();
const B = generateSigningKeyPair();
const KEYS: PublicKeyEntry[] = [
  { kid: 'test-a', publicKey: A.publicKey },
  { kid: 'test-b', publicKey: B.publicKey },
];

function claims(over: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: LICENSE_VERSION,
    licenseId: 'lic_test_1',
    licensee: { name: 'Quillmoor Logistics Ltd', email: 'it@quillmoor.example' },
    edition: 'enterprise',
    features: ['sso', 'audit_export', 'advanced_analytics', 'custom_branding', 'multi_org'],
    seats: 50,
    issuedAt: NOW.toISOString(),
    notBefore: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 365 * DAY).toISOString(),
    ...over,
  };
}

const issue = (over: Partial<LicensePayload> = {}, key = A.privateKey, kid = 'test-a') => signLicense(claims(over), key, kid);

function tamper(token: string, part: 0 | 1 | 2, edit: (s: string) => string): string {
  const parts = token.split('.');
  parts[part] = edit(parts[part]!);
  return parts.join('.');
}

const json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('license tokens: signature verification', () => {
  it('round-trips: a signed license verifies with its key and returns the claims', () => {
    const { kid, payload } = verifyLicense(issue(), KEYS);
    expect(kid).toBe('test-a');
    expect(payload).toEqual(claims());
  });

  it('is a standard JWS: EdDSA header with the key id', () => {
    const [h] = issue().split('.');
    expect(json(h!)).toEqual({ alg: 'EdDSA', typ: 'ct-license+jws', kid: 'test-a' });
  });

  it('refuses a payload changed after signing (more seats, more features, later expiry)', () => {
    const t = issue();
    for (const edit of [{ seats: 5000 }, { features: ['sso', 'scim', 'multi_org', 'audit_export'] }, { expiresAt: '2099-01-01T00:00:00.000Z' }]) {
      const forged = tamper(t, 1, (p) => b64({ ...json(p), ...edit }));
      expect(() => verifyLicense(forged, KEYS)).toThrow(expect.objectContaining({ reason: 'bad_signature' }));
    }
  });

  it('refuses a flipped signature byte and a truncated signature', () => {
    const t = issue();
    const flip = tamper(t, 2, (s) => {
      const b = Buffer.from(s, 'base64url');
      b[0] = b[0]! ^ 0x01;
      return b.toString('base64url');
    });
    expect(() => verifyLicense(flip, KEYS)).toThrow(expect.objectContaining({ reason: 'bad_signature' }));
    expect(() => verifyLicense(tamper(t, 2, (s) => s.slice(0, 20)), KEYS)).toThrow(LicenseError);
  });

  it('refuses a token re-labelled with another accepted key id', () => {
    const t = tamper(issue(), 0, (h) => b64({ ...json(h), kid: 'test-b' }));
    expect(() => verifyLicense(t, KEYS)).toThrow(expect.objectContaining({ reason: 'bad_signature' }));
  });

  it('refuses a license signed by a key the gateway does not accept, even with an accepted kid', () => {
    const rogue = generateSigningKeyPair();
    expect(() => verifyLicense(issue({}, rogue.privateKey, 'test-a'), KEYS)).toThrow(expect.objectContaining({ reason: 'bad_signature' }));
    expect(() => verifyLicense(issue({}, rogue.privateKey, 'rogue'), KEYS)).toThrow(expect.objectContaining({ reason: 'unknown_key' }));
  });

  it('refuses other algorithms and token types (no alg=none downgrade)', () => {
    const t = issue();
    expect(() => verifyLicense(tamper(t, 0, (h) => b64({ ...json(h), alg: 'none' })), KEYS)).toThrow(expect.objectContaining({ reason: 'unsupported' }));
    expect(() => verifyLicense(tamper(t, 0, (h) => b64({ ...json(h), typ: 'JWT' })), KEYS)).toThrow(expect.objectContaining({ reason: 'unsupported' }));
    expect(() => verifyLicense(tamper(t, 0, (h) => b64({ ...json(h), crit: ['x'] })), KEYS)).toThrow(expect.objectContaining({ reason: 'unsupported' }));
  });

  it('refuses malformed input', () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', '!!.??.**', `${b64({ alg: 'EdDSA' })}.not-json.sig`]) {
      expect(() => verifyLicense(bad, KEYS)).toThrow(LicenseError);
    }
  });

  it('refuses claims that do not make sense, even when signed', () => {
    expect(() => signLicense(claims({ seats: -1 }), A.privateKey, 'test-a')).toThrow(/seats/);
    expect(() => signLicense(claims({ expiresAt: NOW.toISOString(), notBefore: NOW.toISOString() }), A.privateKey, 'test-a')).toThrow(/expiresAt/);
    expect(() => signLicense({ ...claims(), v: 2 }, A.privateKey, 'test-a')).toThrow(/version/);
  });

  it('reads a license file with comment lines and wrapped lines', () => {
    const t = issue();
    const file = licenseFile(t, claims(), 'test-a');
    expect(file).toMatch(/^# CloudTrain license key/);
    expect(file.split('\n').every((l) => l.length <= 120)).toBe(true);
    expect(extractToken(file)).toBe(t);
    expect(verifyLicense(file, KEYS).payload.licenseId).toBe('lic_test_1');
  });

  it('keeps unknown feature names in the claims (newer licenses on older gateways)', () => {
    const { payload } = verifyLicense(issue({ features: ['sso', 'quantum_labs'] }), KEYS);
    expect(payload.features).toEqual(['sso', 'quantum_labs']);
  });
});

describe('license tokens: key rotation', () => {
  it('accepts licenses from every listed key', () => {
    expect(verifyLicense(issue({}, A.privateKey, 'test-a'), KEYS).kid).toBe('test-a');
    expect(verifyLicense(issue({}, B.privateKey, 'test-b'), KEYS).kid).toBe('test-b');
  });

  it('a retired key keeps its older licenses valid and refuses ones issued after retirement', () => {
    const keys: PublicKeyEntry[] = [{ kid: 'test-a', publicKey: A.publicKey, retiredAt: '2026-10-01T00:00:00Z' }, KEYS[1]!];
    const old = issue({ issuedAt: '2026-09-15T00:00:00.000Z', notBefore: '2026-09-15T00:00:00.000Z' });
    expect(verifyLicense(old, keys).kid).toBe('test-a');
    expect(() => verifyLicense(issue(), keys)).toThrow(expect.objectContaining({ reason: 'retired_key' }));
    expect(verifyLicense(issue({}, B.privateKey, 'test-b'), keys).kid).toBe('test-b');
  });

  it('a key removed from the list invalidates its licenses', () => {
    expect(() => verifyLicense(issue(), [KEYS[1]!])).toThrow(expect.objectContaining({ reason: 'unknown_key' }));
  });

  it('the embedded keys are Ed25519 public keys only', () => {
    expect(ACCEPTED_KEYS.length).toBeGreaterThan(0);
    for (const k of ACCEPTED_KEYS) {
      expect(k.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
      expect(k.publicKey).not.toMatch(/PRIVATE/);
      expect(new Set(ACCEPTED_KEYS.map((x) => x.kid)).size).toBe(ACCEPTED_KEYS.length);
    }
    // A license signed with a test key never verifies against the embedded keys.
    expect(() => verifyLicense(issue({}, A.privateKey, ACCEPTED_KEYS[0]!.kid), ACCEPTED_KEYS)).toThrow(expect.objectContaining({ reason: 'bad_signature' }));
  });
});

describe('license expiry: warning, grace, expired', () => {
  const exp = new Date('2027-01-31T00:00:00Z');
  const p = { notBefore: '2026-01-01T00:00:00Z', expiresAt: exp.toISOString() };
  const at = (days: number) => new Date(exp.getTime() + days * DAY);

  it(`is valid until ${WARN_DAYS} days before expiry, then expiring`, () => {
    expect(evaluate(p, at(-WARN_DAYS - 1))).toMatchObject({ state: 'valid', active: true });
    expect(evaluate(p, at(-WARN_DAYS))).toMatchObject({ state: 'expiring', active: true, daysLeft: WARN_DAYS });
    expect(evaluate(p, at(-1))).toMatchObject({ state: 'expiring', active: true, daysLeft: 1 });
  });

  it(`keeps features on for a ${GRACE_DAYS}-day grace period after expiry`, () => {
    expect(evaluate(p, at(0))).toMatchObject({ state: 'grace', active: true });
    expect(evaluate(p, new Date(at(GRACE_DAYS).getTime() - 1))).toMatchObject({ state: 'grace', active: true });
    expect(evaluate(p, at(GRACE_DAYS)).graceEndsAt).toBe(at(GRACE_DAYS).toISOString());
  });

  it('switches features off after the grace period', () => {
    expect(evaluate(p, at(GRACE_DAYS))).toMatchObject({ state: 'expired', active: false });
    expect(evaluate(p, at(400))).toMatchObject({ state: 'expired', active: false });
  });

  it('is not valid before notBefore (5 minutes of clock skew allowed)', () => {
    const nb = new Date('2026-01-01T00:00:00Z');
    expect(evaluate(p, new Date(nb.getTime() - 3600_000))).toMatchObject({ state: 'not_yet_valid', active: false });
    expect(evaluate(p, new Date(nb.getTime() - 60_000))).toMatchObject({ active: true });
  });
});

describe('LicenseManager', () => {
  const mgr = (source: ConstructorParameters<typeof LicenseManager>[0]['source'], now = NOW, edition: 'selfhosted' | 'hosted' = 'selfhosted') => new LicenseManager({ edition, source, keys: KEYS, now: () => now }).init();

  it('community edition without a license', async () => {
    const m = await mgr({});
    expect(m.state()).toBe('none');
    expect(m.features()).toEqual([]);
    expect(m.status(3)).toMatchObject({ state: 'none', source: 'none', activeFeatures: [], seats: { licensed: 0, used: 3, over: false } });
  });

  it('reads CT_LICENSE_KEY and CT_LICENSE_FILE (with comments)', async () => {
    expect((await mgr({ key: issue() })).features()).toEqual(['sso', 'audit_export', 'advanced_analytics', 'custom_branding', 'multi_org']);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ct-lic-'));
    const file = path.join(dir, 'license.txt');
    writeFileSync(file, licenseFile(issue(), claims(), 'test-a'));
    const m = await mgr({ file });
    expect(m.state()).toBe('valid');
    expect(m.status(1)).toMatchObject({ source: 'file', uploadAllowed: false, license: { licenseId: 'lic_test_1', kid: 'test-a', seats: 50 } });
    const missing = await mgr({ file: path.join(dir, 'nope') });
    expect(missing.state()).toBe('invalid');
    expect(missing.status(0).error).toMatch(/Cannot read CT_LICENSE_FILE/);
  });

  it('an invalid license is reported and grants nothing', async () => {
    const m = await mgr({ key: tamper(issue(), 1, (p) => b64({ ...json(p), seats: 9999 })) });
    expect(m.state()).toBe('invalid');
    expect(m.features()).toEqual([]);
    expect(m.offReason()).toBe('license_invalid');
    expect(m.notice()?.message).toMatch(/invalid/);
  });

  it('expiry follows the clock without a restart: warns, keeps features in grace, then turns them off', async () => {
    let now = NOW;
    const m = await new LicenseManager({ edition: 'selfhosted', source: { key: issue({ expiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString() }) }, keys: KEYS, now: () => now }).init();
    expect(m.notice()).toBeUndefined();
    now = new Date(NOW.getTime() + 20 * DAY);
    expect(m.notice()).toMatchObject({ state: 'expiring', daysLeft: 20 });
    now = new Date(NOW.getTime() + 45 * DAY);
    expect(m.state()).toBe('grace');
    expect(m.features()).toContain('sso');
    expect(m.notice()?.message).toMatch(/stay on until/);
    now = new Date(NOW.getTime() + 55 * DAY);
    expect(m.state()).toBe('expired');
    expect(m.features()).toEqual([]);
    expect(m.offReason()).toBe('license_expired');
    expect(m.notice()?.message).toMatch(/Nothing was deleted/);
  });

  it('flags seats over the license', async () => {
    const m = await mgr({ key: issue({ seats: 2 }) });
    expect(m.seats()).toBe(2);
    expect(m.status(3).seats).toEqual({ licensed: 2, used: 3, over: true });
    expect(m.notice(3)).toMatchObject({ seatsOver: true });
    expect(m.notice(2)).toBeUndefined();
  });

  it('is ignored on the hosted edition', async () => {
    const m = await mgr({ key: issue() }, NOW, 'hosted');
    expect(m.state()).toBe('ignored');
    expect(m.features()).toEqual([]);
  });

  it('CT_DEV_LICENSE signs a development license with a key that exists only in this process', async () => {
    const m = await new LicenseManager({ edition: 'selfhosted', source: { dev: true } }).init();
    expect(m.isDev).toBe(true);
    expect(m.state()).toBe('valid');
    expect(m.features()).toHaveLength(7);
    expect(m.status(0)).toMatchObject({ source: 'dev', uploadAllowed: false, license: { kid: DEV_KID, edition: 'development' } });
    // Another process (or gateway) does not know the key: its token is worthless elsewhere.
    const other = await new LicenseManager({ edition: 'selfhosted', source: { dev: true } }).init();
    expect(other.isDev).toBe(true);
    expect(ACCEPTED_KEYS.some((k) => k.kid === DEV_KID)).toBe(false);
  });

  it('refuses CT_DEV_LICENSE in production, even if config were bypassed', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(new LicenseManager({ edition: 'selfhosted', source: { dev: true } }).init()).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('configuration', () => {
  const urls = ['http://localhost:8787', 'http://localhost:5173'] as const;
  it('CT_EDITION defaults to selfhosted and refuses anything else', () => {
    expect(editionFrom(undefined)).toBe('selfhosted');
    expect(editionFrom('hosted')).toBe('hosted');
    expect(() => editionFrom('saas')).toThrow(/CT_EDITION/);
    expect(loadConfig({}).edition).toBe('selfhosted');
  });

  it('CT_DEV_LICENSE only on loopback and never in production', () => {
    expect(licenseSourceFrom({ CT_DEV_LICENSE: '1' }, ...urls)).toEqual({ dev: true });
    expect(() => licenseSourceFrom({ CT_DEV_LICENSE: '1', NODE_ENV: 'production' }, ...urls)).toThrow(/production/);
    expect(() => licenseSourceFrom({ CT_DEV_LICENSE: '1' }, 'https://labs.example.com', urls[1])).toThrow(/localhost/);
    expect(() => licenseSourceFrom({ CT_DEV_LICENSE: 'yes' }, ...urls)).toThrow(/must be 1 or 0/);
    // A real license wins; the dev one is then not even checked.
    expect(licenseSourceFrom({ CT_DEV_LICENSE: '1', CT_LICENSE_KEY: 'x', NODE_ENV: 'production' }, ...urls)).toEqual({ key: 'x' });
    expect(licenseSourceFrom({ CT_DEV_LICENSE: '0' }, ...urls)).toEqual({});
  });

  it('CT_LICENSE_KEY wins over CT_LICENSE_FILE; relative files resolve against the base dir', () => {
    expect(licenseSourceFrom({ CT_LICENSE_KEY: 'k', CT_LICENSE_FILE: 'f' }, ...urls)).toEqual({ key: 'k' });
    expect(loadConfig({ CT_LICENSE_FILE: 'deploy/license.txt', CT_BASE_DIR: '/srv/ct' }).license).toEqual({ file: '/srv/ct/deploy/license.txt' });
  });
});

describe('Entitlements', () => {
  const plan = (id: string, kind: SitePlan['kind'], features: SitePlan['features']): SitePlan => ({ id, name: id[0]!.toUpperCase() + id.slice(1), kind, description: '', entitlements: { labHoursPerMonth: 'unlimited', concurrentLabs: 1, envTiers: [], examSimulationsPerMonth: 0, ctfEvents: false }, includes: [], cta: { label: '', action: 'contact' }, ...(features ? { features } : {}) });
  const PLANS = [plan('free', 'free', []), plan('pro', 'individual', ['exam_certificates']), plan('team', 'organisation', ['sso', 'audit_export', 'advanced_analytics', 'exam_certificates', 'custom_branding'])];
  const source = (m: Record<string, { org?: string; user?: string; seated?: boolean }>): PlanSource => ({
    plans: PLANS,
    async plansOf(orgId, userId) {
      const r = m[`${orgId}/${userId ?? ''}`] ?? m[orgId] ?? {};
      const find = (id?: string) => PLANS.find((p) => p.id === id);
      return { ...(find(r.org) ? { org: find(r.org)! } : {}), ...(find(r.user) ? { user: find(r.user)! } : {}), seated: !!r.seated };
    },
  });
  const lic = (s: ConstructorParameters<typeof LicenseManager>[0]['source'], edition: 'selfhosted' | 'hosted' = 'selfhosted', now = NOW) => new LicenseManager({ edition, source: s, keys: KEYS, now: () => now }).init();
  const admin = devPrincipal({ roles: ['learner', 'org_admin'], orgId: 'o1' });
  const learner = devPrincipal({ orgId: 'o1' });

  it('community edition: no premium feature, 402 with a license action for platform admins', async () => {
    const e = new Entitlements({ edition: 'selfhosted', license: await lic({}) });
    expect((await e.resolve({ orgId: 'o1' })).source).toBe('community');
    expect(await e.has('sso', { orgId: 'o1' })).toBe(false);
    const err = await e.assert('sso', admin).catch((x: unknown) => x as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err!.status).toBe(402);
    expect(err!.body()).toMatchObject({ code: 'feature_required', details: { feature: 'sso', edition: 'selfhosted', reason: 'no_license', action: 'contact_admin', href: '/platform/license' } });
    const pa = await e.assert('sso', devPrincipal({ platformAdmin: true, orgId: 'o1' })).catch((x: unknown) => x as HttpError);
    expect(pa!.body().details).toMatchObject({ action: 'license' });
  });

  it('self-hosted license: its features for every org and person, not more', async () => {
    const e = new Entitlements({ edition: 'selfhosted', license: await lic({ key: issue({ features: ['sso', 'audit_export'] }) }) });
    expect(await e.has('sso', { orgId: 'o1' })).toBe(true);
    expect(await e.has('sso', { orgId: 'o2', userId: 'u' })).toBe(true);
    expect(await e.has('advanced_analytics', { orgId: 'o1' })).toBe(false);
    expect((await e.view(learner)).features).toEqual(['sso', 'audit_export']);
    expect((await e.view(learner)).source).toBe('license');
  });

  it('an expired license: features off, reason license_expired', async () => {
    const e = new Entitlements({ edition: 'selfhosted', license: await lic({ key: issue() }, 'selfhosted', new Date(NOW.getTime() + 400 * DAY)) });
    expect(await e.has('sso', { orgId: 'o1' })).toBe(false);
    expect(e.details('sso', admin)).toMatchObject({ reason: 'license_expired' });
  });

  it('hosted: organisation features from the org plan, personal ones from the own plan or a seat', async () => {
    const plans = source({ 'o1/': { org: 'team' }, 'o1/u-seated': { org: 'team', seated: true }, 'o1/u-plain': { org: 'team' }, 'o2/u-pro': { user: 'pro' }, o3: {} });
    const e = new Entitlements({ edition: 'hosted', license: await lic({}, 'hosted'), plans });
    expect(await e.has('sso', { orgId: 'o1' })).toBe(true);
    expect(await e.has('sso', { orgId: 'o1', userId: 'u-plain' })).toBe(true);
    expect(await e.has('exam_certificates', { orgId: 'o1', userId: 'u-seated' })).toBe(true);
    expect(await e.has('exam_certificates', { orgId: 'o1', userId: 'u-plain' })).toBe(false);
    expect(await e.has('exam_certificates', { orgId: 'o2', userId: 'u-pro' })).toBe(true);
    expect(await e.has('sso', { orgId: 'o2', userId: 'u-pro' })).toBe(false);
    expect(await e.has('multi_org', { orgId: 'o3' })).toBe(true);
    expect(await e.has('scim', { orgId: 'o1' })).toBe(false);
  });

  it('hosted: a license key grants nothing; upsell names the plans', async () => {
    const e = new Entitlements({ edition: 'hosted', license: await lic({ key: issue() }, 'hosted'), plans: source({}) });
    expect(await e.has('sso', { orgId: 'o9' })).toBe(false);
    expect(e.details('sso', admin)).toMatchObject({ reason: 'not_in_plan', action: 'upgrade', href: '/admin/billing', plans: [{ id: 'team', name: 'Team' }] });
    expect(e.details('sso', learner)).toMatchObject({ action: 'contact_admin' });
    expect((await e.view(learner)).upgrade?.sso).toEqual([{ id: 'team', name: 'Team' }]);
  });

  it('self-hosted with billing on: license and plans add up', async () => {
    const e = new Entitlements({ edition: 'selfhosted', license: await lic({ key: issue({ features: ['sso'] }) }), plans: source({ o1: { org: 'team' } }) });
    expect(await e.has('sso', { orgId: 'o1' })).toBe(true);
    expect(await e.has('custom_branding', { orgId: 'o1' })).toBe(true);
    expect(await e.has('custom_branding', { orgId: 'o2' })).toBe(false);
    expect(await e.has('multi_org', { orgId: 'o2' })).toBe(false);
  });

  it('unrestricted (tests only) grants everything', async () => {
    expect((await Entitlements.unrestricted().view(learner)).features).toHaveLength(7);
    await expect(Entitlements.unrestricted().assertSeatAvailable(1000)).resolves.toBeUndefined();
  });
});
