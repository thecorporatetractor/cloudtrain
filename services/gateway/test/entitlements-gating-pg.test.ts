import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entitlements } from '../src/entitlements/service.js';
import { LicenseManager } from '../src/license/manager.js';
import { generateSigningKeyPair, LICENSE_VERSION, signLicense, type LicensePayload } from '../src/license/token.js';
import { FakeOidcProvider } from './fake-oidc.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';
import type { TestDb } from './pg.js';

/*
 * Premium features are gated in the gateway (docs/licensing-keys.md): a
 * self-hosted deployment without a license (community edition) refuses them
 * with 402 feature_required, keeps everything else working and deletes nothing;
 * installing a license turns them on without a restart.
 */

const available = await pgAvailable();
const DAY = 86_400_000;
const KEY = generateSigningKeyPair();
const KEYS = [{ kid: 'test-gating', publicKey: KEY.publicKey }];

function license(over: Partial<LicensePayload> = {}): string {
  const now = new Date();
  return signLicense(
    {
      v: LICENSE_VERSION,
      licenseId: 'lic_gating',
      licensee: { name: 'Test Licensee' },
      edition: 'enterprise',
      features: ['sso', 'audit_export', 'advanced_analytics', 'custom_branding', 'multi_org'],
      seats: 0,
      issuedAt: now.toISOString(),
      notBefore: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90 * DAY).toISOString(),
      ...over,
    },
    KEY.privateKey,
    'test-gating',
  );
}

/** A self-hosted deployment, community edition until a license is installed. */
function community() {
  const box: { license?: LicenseManager } = {};
  const make = (t: TestDb) => {
    box.license = new LicenseManager({ edition: 'selfhosted', source: {}, db: t.db, keys: KEYS, refreshMs: 0 });
    return new Entitlements({ edition: 'selfhosted', license: box.license, db: t.db });
  };
  return { box, make };
}

const feature = (r: { statusCode: number; json: () => unknown }, f: string) => {
  expect(r.statusCode, JSON.stringify(r.json())).toBe(402);
  expect(r.json()).toMatchObject({ code: 'feature_required', details: { feature: f, edition: 'selfhosted', reason: 'no_license', href: '/platform/license' } });
};

describe.skipIf(!available)('premium features: gated on the community edition, on with a license', () => {
  let h: Harness;
  const c = community();
  let yard: string;
  beforeAll(async () => {
    h = await harness({ entitlements: c.make });
    await c.box.license!.init();
    yard = (await as(h, Q.tomasz).get('/api/teams')).json()[0].id;
  }, 60_000);
  afterAll(async () => h?.close());

  it('sso: managing connections needs the feature; viewing and switching off do not', async () => {
    const priya = as(h, Q.priya);
    feature(await priya.post('/api/admin/sso', { type: 'oidc', displayName: 'Quillmoor Entra', oidc: { discoveryUrl: 'https://login.example/.well-known/openid-configuration', clientId: 'x', clientSecret: 'y' } }), 'sso');
    expect((await priya.get('/api/admin/sso')).statusCode).toBe(200);
    // Acme Freight has the seeded SSO connection; the platform admin acts inside it.
    const acmeAdmin = Q.rhea;
    {
      const conn = (await as(h, acmeAdmin, h.orgs.acme).get('/api/admin/sso')).json().connections[0];
      feature(await as(h, acmeAdmin, h.orgs.acme).patch(`/api/admin/sso/${conn.id}`, { displayName: 'Renamed' }), 'sso');
      feature(await as(h, acmeAdmin, h.orgs.acme).post(`/api/admin/sso/${conn.id}/test`), 'sso');
      // Switching it off is never premium (here it reaches Keycloak, absent in tests: 502, not 402).
      expect((await as(h, acmeAdmin, h.orgs.acme).patch(`/api/admin/sso/${conn.id}`, { enforced: false })).statusCode).not.toBe(402);
    }
  });

  it('audit_export: the CSV export is premium, browsing the log is not', async () => {
    feature(await as(h, Q.priya).get('/api/admin/audit.csv'), 'audit_export');
    expect((await as(h, Q.priya).get('/api/admin/audit')).statusCode).toBe(200);
  });

  it('advanced_analytics: the dashboard stays useful (basic), readiness and trends are left out', async () => {
    const dash = (await as(h, Q.tomasz).get(`/api/teams/${yard}/dashboard`)).json();
    expect(dash).toMatchObject({ analytics: 'basic', frameworks: [], minutesByWeek: [] });
    expect(dash.members.length).toBeGreaterThan(0);
    expect(dash.members.every((m: { readiness: object; mastery: object }) => Object.keys(m.readiness).length === 0 && Object.keys(m.mastery).length > 0)).toBe(true);
    expect(dash.totals.members).toBe(dash.members.length);
    const member = (await as(h, Q.tomasz).get(`/api/teams/${yard}/members/${Q.amara}`)).json();
    expect(member).toMatchObject({ analytics: 'basic', readiness: {} });
    expect(member.skills.length).toBeGreaterThan(0);
    expect((await as(h, Q.tomasz).get(`/api/reports/progress.csv?team=${yard}`)).statusCode).toBe(200);
  });

  it('custom_branding: a new logo or colour is premium; other settings, clearing and saved values are not', async () => {
    const priya = as(h, Q.priya);
    feature(await priya.patch('/api/admin/settings', { settings: { logoUrl: 'https://cdn.quillmoor.example/logo.svg' } }), 'custom_branding');
    feature(await priya.patch('/api/admin/settings', { settings: { accentColor: '#3366ff' } }), 'custom_branding');
    expect((await priya.patch('/api/admin/settings', { settings: { timezone: 'Europe/Berlin' } })).statusCode).toBe(200);
    // A logo saved while licensed is kept but not shown.
    await h.t.owner.updateTable('orgs').set({ settings: JSON.stringify({ defaultSessionMinutes: 60, allowLocalLogin: true, timezone: 'Europe/Berlin', logoUrl: 'https://cdn.quillmoor.example/logo.svg' }) }).where('id', '=', h.orgs.quillmoor).execute();
    expect((await priya.get('/api/me')).json().activeOrg.logoUrl).toBeUndefined();
    expect((await priya.get('/api/admin/settings')).json().org.settings.logoUrl).toBe('https://cdn.quillmoor.example/logo.svg');
    // Saving the settings page again (unchanged logo) or clearing it never needs the feature.
    expect((await priya.patch('/api/admin/settings', { settings: { logoUrl: 'https://cdn.quillmoor.example/logo.svg', timezone: 'UTC' } })).statusCode).toBe(200);
  });

  it('multi_org: another organisation on the deployment is premium; existing ones keep working', async () => {
    feature(await as(h, Q.rhea).post('/api/platform/orgs', { slug: 'northwind', name: 'Northwind' }), 'multi_org');
    expect((await as(h, Q.rhea).get('/api/platform/orgs')).json().length).toBeGreaterThanOrEqual(2);
    expect((await as(h, Q.priya).get('/api/home')).statusCode).toBe(200);
  });

  it('community essentials stay on: labs, catalog, assignments, invitations', async () => {
    expect((await as(h, Q.lucas).get('/api/catalog')).statusCode).toBe(200);
    expect((await as(h, Q.priya).post('/api/admin/users', { email: 'new.hire@quillmoor.example', roles: ['learner'] })).statusCode).toBe(201);
    expect((await as(h, Q.priya).get('/api/me')).json().entitlements).toMatchObject({ edition: 'selfhosted', features: [], source: 'community' });
  });

  it('installing a license turns the features on at once; seats are a soft limit on new members', async () => {
    await c.box.license!.install(license(), { id: Q.rhea, name: 'Rhea' });
    expect((await as(h, Q.priya).get('/api/admin/audit.csv')).statusCode).toBe(200);
    expect((await as(h, Q.tomasz).get(`/api/teams/${yard}/dashboard`)).json()).toMatchObject({ analytics: 'advanced', minutesByWeek: expect.arrayContaining([expect.objectContaining({ minutes: expect.any(Number) })]) });
    expect((await as(h, Q.priya).get('/api/me')).json().activeOrg.logoUrl).toBe('https://cdn.quillmoor.example/logo.svg');
    expect((await as(h, Q.priya).patch('/api/admin/settings', { settings: { accentColor: '#3366ff' } })).statusCode).toBe(200);
    expect((await as(h, Q.rhea).post('/api/platform/orgs', { slug: 'northwind', name: 'Northwind' })).statusCode).toBe(201);
    // SSO management passes the gate (and stops at Keycloak, absent in tests).
    expect((await as(h, Q.priya).post('/api/admin/sso', { type: 'oidc', displayName: 'Quillmoor Entra' })).statusCode).not.toBe(402);

    const used = (await as(h, Q.rhea).get('/api/platform/license')).json().seats.used as number;
    await c.box.license!.install(license({ licenseId: 'lic_gating_seats', seats: used }), { id: Q.rhea, name: 'Rhea' });
    const full = await as(h, Q.priya).post('/api/admin/users', { email: 'one.more@quillmoor.example', roles: ['learner'] });
    expect(full.statusCode).toBe(402);
    expect(full.json()).toMatchObject({ code: 'seats_exceeded', details: { licensed: used, used } });
    // Already-active people never need a seat, and nobody active is affected.
    expect((await as(h, Q.priya).get('/api/home')).statusCode).toBe(200);
    expect((await as(h, Q.priya).get('/api/me')).json().entitlements.license).toBeUndefined();
  });
});

describe.skipIf(!available)('sso at sign-in: refused without the feature, local accounts and platform operators unaffected', () => {
  let op: FakeOidcProvider;
  let h: Harness;
  const c = community();
  beforeAll(async () => {
    op = await new FakeOidcProvider().start();
    h = await harness({ oidc: op, entitlements: c.make });
    await c.box.license!.init();
  }, 60_000);
  afterAll(async () => {
    await h?.close();
    await op?.stop();
  });

  async function signIn(email: string, claims: Record<string, unknown>) {
    const start = await h.app.inject(`/api/auth/login?email=${encodeURIComponent(email)}`);
    if (start.statusCode !== 302 || !String(start.headers.location).startsWith(op.issuer)) return { start, cb: start };
    const { code, state } = op.authorize(start.headers.location as string, claims);
    return { start, cb: await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`) };
  }

  it('an org IdP login is refused with sso_unlicensed; a local account signs in', async () => {
    const marcus = await signIn('marcus.bell@acme-freight.example', { sub: 'kc-marcus', email: 'marcus.bell@acme-freight.example', name: 'Marcus Bell', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] });
    expect(marcus.cb.headers.location).toMatch(/error=sso_unlicensed/);
    const priya = await signIn('priya.raman@quillmoor.example', { sub: Q.priya, email: 'priya.raman@quillmoor.example', name: 'Priya Raman' });
    expect(priya.cb.headers.location).toBe('http://web.test/');
  });

  it('enforced SSO no longer blocks local login when SSO is off', async () => {
    const olivia = await signIn('olivia.hart@acme-freight.example', { sub: 'kc-olivia-local', email: 'olivia.hart@acme-freight.example', name: 'Olivia Hart' });
    expect(olivia.cb.headers.location).not.toMatch(/error=sso_required/);
  });

  it('a platform operator still signs in through a platform IdP (to install the license)', async () => {
    const ari = await signIn('ari.lindgren@acme-freight.example', { sub: 'kc-ari', email: 'ari.lindgren@acme-freight.example', name: 'Ari Lindgren', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.PlatformAdmin'] });
    expect(ari.cb.headers.location).toBe('http://web.test/');
  });

  it('?idp= for an organisation IdP that is not a platform IdP is refused before leaving the gateway', async () => {
    await h.t.owner.insertInto('sso_connections').values({ org_id: h.orgs.quillmoor, kc_alias: 'quillmoor-okta', type: 'oidc', display_name: 'Quillmoor Okta', group_mappings: JSON.stringify([]), default_roles: ['learner'], settings: JSON.stringify({}), status: 'active' }).execute();
    const r = await h.app.inject('/api/auth/login?idp=quillmoor-okta');
    expect(r.headers.location).toMatch(/error=sso_unlicensed/);
  });

  it('with a license SSO works again', async () => {
    await c.box.license!.install(license(), { id: Q.rhea, name: 'Rhea' });
    expect((await h.app.inject('/api/auth/login?idp=quillmoor-okta')).headers.location).toMatch(/kc_idp_hint=quillmoor-okta/);
    const marcus = await signIn('marcus.bell@acme-freight.example', { sub: 'kc-marcus', email: 'marcus.bell@acme-freight.example', name: 'Marcus Bell', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] });
    expect(marcus.cb.headers.location).toBe('http://web.test/');
  });
});
