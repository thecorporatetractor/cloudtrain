import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import { Entitlements } from '../src/entitlements/service.js';
import { LicenseManager } from '../src/license/manager.js';
import { generateSigningKeyPair, licenseFile, LICENSE_VERSION, signLicense, type LicensePayload } from '../src/license/token.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();
const DAY = 86_400_000;
const KEY = generateSigningKeyPair();
const KEYS = [{ kid: 'test-pg', publicKey: KEY.publicKey }];

function token(over: Partial<LicensePayload> = {}): string {
  const now = new Date();
  return signLicense(
    {
      v: LICENSE_VERSION,
      licenseId: 'lic_pg_1',
      licensee: { name: 'Quillmoor Logistics Ltd' },
      edition: 'enterprise',
      features: ['sso', 'audit_export'],
      seats: 0,
      issuedAt: now.toISOString(),
      notBefore: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90 * DAY).toISOString(),
      ...over,
    },
    KEY.privateKey,
    'test-pg',
  );
}

describe.skipIf(!available)('license routes and storage (/api/platform/license, platform_licenses)', () => {
  let h: Harness;
  let license: LicenseManager;
  beforeAll(async () => {
    h = await harness({
      entitlements: (t) => {
        license = new LicenseManager({ edition: 'selfhosted', source: {}, db: t.db, keys: KEYS, refreshMs: 0 });
        return new Entitlements({ edition: 'selfhosted', license, db: t.db });
      },
    });
    await license.init();
  }, 60_000);
  afterAll(async () => h?.close());

  it('starts as the community edition: no premium features in /api/me', async () => {
    const st = (await as(h, Q.rhea).get('/api/platform/license')).json();
    expect(st).toMatchObject({ edition: 'selfhosted', state: 'none', source: 'none', activeFeatures: [], uploadAllowed: true });
    expect(st.seats.used).toBeGreaterThan(5);
    expect(st.catalog.map((f: { id: string }) => f.id)).toContain('scim');
    const me = (await as(h, Q.priya).get('/api/me')).json();
    expect(me.entitlements).toEqual({ edition: 'selfhosted', features: [], source: 'community' });
  });

  it('only platform admins see or change the license', async () => {
    expect((await as(h, Q.priya).get('/api/platform/license')).statusCode).toBe(403);
    expect((await as(h, Q.priya).put('/api/platform/license', { license: token() })).statusCode).toBe(403);
    expect((await as(h, Q.priya).del('/api/platform/license')).statusCode).toBe(403);
  });

  it('refuses invalid, tampered and expired uploads with a reason', async () => {
    const bad = await as(h, Q.rhea).put('/api/platform/license', { license: 'not-a-license' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: 'invalid', details: { license: 'malformed' } });
    const t = token().split('.');
    t[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(t[1]!, 'base64url').toString()), seats: 1 })).toString('base64url');
    expect((await as(h, Q.rhea).put('/api/platform/license', { license: t.join('.') })).json().details).toEqual({ license: 'bad_signature' });
    const old = token({ issuedAt: '2020-01-01T00:00:00Z', notBefore: '2020-01-01T00:00:00Z', expiresAt: '2021-01-01T00:00:00Z' });
    expect((await as(h, Q.rhea).put('/api/platform/license', { license: old })).json().details).toEqual({ license: 'expired' });
    expect((await as(h, Q.rhea).put('/api/platform/license', {})).statusCode).toBe(422);
  });

  it('installs an uploaded license file: features on for every org, history kept', async () => {
    const file = licenseFile(token(), { v: 1, licenseId: 'lic_pg_1', licensee: { name: 'Quillmoor Logistics Ltd' }, edition: 'enterprise', features: ['sso', 'audit_export'], seats: 0, issuedAt: '', notBefore: '', expiresAt: '' }, 'test-pg');
    const r = await as(h, Q.rhea).put('/api/platform/license', { license: file });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ state: 'valid', source: 'upload', activeFeatures: ['sso', 'audit_export'], license: { licenseId: 'lic_pg_1', kid: 'test-pg' }, installedBy: expect.any(String) });
    expect((await as(h, Q.priya).get('/api/me')).json().entitlements).toMatchObject({ features: ['sso', 'audit_export'], source: 'license' });
    expect((await as(h, Q.rhea, h.orgs.acme).get('/api/me')).json().entitlements.features).toEqual(['sso', 'audit_export']);

    // A second install replaces the first; both rows stay.
    await as(h, Q.rhea).put('/api/platform/license', { license: token({ licenseId: 'lic_pg_2', features: ['sso'] }) });
    const rows = await h.t.owner.selectFrom('platform_licenses').selectAll().orderBy('installed_at').execute();
    expect(rows.map((x) => [x.license_id, x.removed_at === null])).toEqual([
      ['lic_pg_1', false],
      ['lic_pg_2', true],
    ]);
    expect(rows[1]!.token).not.toMatch(/#/);
  });

  it('a second gateway replica picks up the upload from the database', async () => {
    const replica = await new LicenseManager({ edition: 'selfhosted', source: {}, db: h.t.db, keys: KEYS }).init();
    expect(replica.status(0)).toMatchObject({ source: 'upload', license: { licenseId: 'lic_pg_2' } });
  });

  it('soft seat limit: invitations past the licensed seats are refused, nobody is locked out', async () => {
    const used = (await as(h, Q.rhea).get('/api/platform/license')).json().seats.used as number;
    await as(h, Q.rhea).put('/api/platform/license', { license: token({ licenseId: 'lic_pg_3', seats: used }) });
    const st = (await as(h, Q.rhea).get('/api/platform/license')).json();
    expect(st.seats).toEqual({ licensed: used, used, over: false });
    await expect(h.ps.entitlements.assertSeatAvailable(1)).rejects.toMatchObject({ status: 402, extra: { code: 'seats_exceeded', details: { licensed: used, used } } });
    await expect(h.ps.entitlements.assertSeatAvailable(0)).resolves.toBeUndefined();
    expect((await as(h, Q.priya).get('/api/me')).statusCode).toBe(200);
  });

  it('removing the license returns to the community edition without deleting anything', async () => {
    const r = await as(h, Q.rhea).del('/api/platform/license');
    expect(r.json()).toMatchObject({ state: 'none', activeFeatures: [] });
    expect((await as(h, Q.priya).get('/api/me')).json().entitlements.features).toEqual([]);
    expect(await h.t.owner.selectFrom('platform_licenses').select('id').execute()).toHaveLength(3);
  });

  it('RLS: the license table is invisible outside the platform context', async () => {
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor, userId: Q.priya }, async (tx) => {
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM platform_licenses`.execute(tx)).rows[0]!.n).toBe(0);
      await expect(sql`INSERT INTO platform_licenses (license_id, token) VALUES ('x', ${'y'.repeat(40)})`.execute(tx)).rejects.toThrow(/row-level security/);
    });
  });

  it('an environment license cannot be replaced by an upload', async () => {
    const fixed = await new LicenseManager({ edition: 'selfhosted', source: { key: token() }, db: h.t.db, keys: KEYS }).init();
    await expect(fixed.install(token(), { id: Q.rhea, name: 'Rhea' })).rejects.toMatchObject({ status: 409 });
    expect(fixed.status(0).uploadAllowed).toBe(false);
  });
});
