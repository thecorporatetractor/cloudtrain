import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { FakeOidcProvider } from './fake-oidc.js';
import { repo } from './fakes.js';
import { harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();

describe('CT_DEV_IMPERSONATE startup guard', () => {
  it('is off unless set to 1', () => {
    expect(loadConfig({}).devImpersonate).toBe(false);
    expect(loadConfig({ CT_DEV_IMPERSONATE: '0' }).devImpersonate).toBe(false);
    expect(loadConfig({ CT_DEV_IMPERSONATE: '1' }).devImpersonate).toBe(true);
    expect(loadConfig({ CT_DEV_IMPERSONATE: '1', CT_PUBLIC_URL: 'http://127.0.0.1:8797', CT_WEB_URL: 'http://localhost:5197' }).devImpersonate).toBe(true);
  });

  it('refuses production, non-loopback URLs and unknown values instead of ignoring the flag', () => {
    expect(() => loadConfig({ CT_DEV_IMPERSONATE: '1', NODE_ENV: 'production', CT_SESSION_SECRET: 'x'.repeat(32) })).toThrow(/NODE_ENV=production.*refusing to start/);
    expect(() => loadConfig({ CT_DEV_IMPERSONATE: '1', CT_PUBLIC_URL: 'https://cloudtrain.example.com' })).toThrow(/CT_PUBLIC_URL on localhost or 127.0.0.1/);
    expect(() => loadConfig({ CT_DEV_IMPERSONATE: '1', CT_WEB_URL: 'http://10.0.0.5:5173' })).toThrow(/CT_WEB_URL on localhost or 127.0.0.1/);
    expect(() => loadConfig({ CT_DEV_IMPERSONATE: '1', CT_PUBLIC_URL: 'http://localhost.evil.example:8787' })).toThrow(/refusing to start/);
    expect(() => loadConfig({ CT_DEV_IMPERSONATE: 'true' })).toThrow(/must be 1 or 0/);
  });

  it('the gateway process exits with the error when started in production with the flag', () => {
    const gw = path.join(repo, 'services/gateway');
    const r = spawnSync(path.join(gw, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: gw,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', CT_DEV_IMPERSONATE: '1', CT_SESSION_SECRET: 'x'.repeat(32), CT_OIDC_CLIENT_SECRET: 'x' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/CT_DEV_IMPERSONATE=1 is set with NODE_ENV=production.*refusing to start/);
  });
});

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const set = ([] as string[]).concat((res.headers['set-cookie'] as string | string[]) ?? []);
  return set.find((c) => c.startsWith('ct_session='))?.split(';')[0];
};

describe.skipIf(!available)('POST /api/dev/sign-in-as', () => {
  let op: FakeOidcProvider;
  let on: Harness;
  let off: Harness;

  beforeAll(async () => {
    op = await new FakeOidcProvider().start();
    [on, off] = await Promise.all([harness({ oidc: op, devImpersonate: true }), harness({ oidc: op })]);
  }, 90_000);
  afterAll(async () => {
    await on?.close();
    await off?.close();
    await op?.stop();
  });

  const signInAs = (h: Harness, payload: object, extra: { remoteAddress?: string; headers?: Record<string, string> } = {}) =>
    h.app.inject({ method: 'POST', url: '/api/dev/sign-in-as', payload, headers: { 'content-type': 'application/json', ...extra.headers }, ...(extra.remoteAddress ? { remoteAddress: extra.remoteAddress } : {}) });

  it('is not registered without the flag', async () => {
    const r = await signInAs(off, { email: 'priya.raman@quillmoor.example' });
    expect(r.statusCode).toBe(404);
    expect(cookieOf(r)).toBeUndefined();
  });

  it('refuses non-loopback callers (socket address; X-Forwarded-For is not trusted) and cross-site browsers', async () => {
    const email = 'priya.raman@quillmoor.example';
    expect((await signInAs(on, { email }, { remoteAddress: '10.1.2.3' })).statusCode).toBe(403);
    expect((await signInAs(on, { email }, { remoteAddress: '10.1.2.3', headers: { 'x-forwarded-for': '127.0.0.1' } })).statusCode).toBe(403);
    expect((await signInAs(on, { email }, { headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await signInAs(on, { email }, { headers: { 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
    expect((await signInAs(on, { email }, { headers: { host: 'rebound.evil.example:8787' } })).statusCode).toBe(403);
    const form = await on.app.inject({ method: 'POST', url: '/api/dev/sign-in-as', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `email=${email}` });
    expect(form.statusCode).toBe(415);
    expect(cookieOf(form)).toBeUndefined();
  });

  it('answers 404 for an unknown user and never creates one', async () => {
    const r = await signInAs(on, { email: 'nobody@nowhere.example' });
    expect(r.statusCode).toBe(404);
    expect(await on.t.owner.selectFrom('users').select('id').where('email', '=', 'nobody@nowhere.example').executeTakeFirst()).toBeUndefined();
    expect((await signInAs(on, { userId: 'no-such-user' })).statusCode).toBe(404);
    expect((await signInAs(on, {})).statusCode).toBe(422);
  });

  it('creates a normal session with the real roles, CSRF, impersonation flag and an audit row', async () => {
    const r = await signInAs(on, { email: 'Priya.Raman@quillmoor.example' }, { headers: { 'user-agent': 'agent-test' } });
    expect(r.statusCode).toBe(200);
    const raw = ([] as string[]).concat(r.headers['set-cookie'] as string).join(';');
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    const cookie = cookieOf(r)!;
    const me = (await on.app.inject({ url: '/api/me', headers: { cookie } })).json();
    expect(me).toMatchObject({ id: Q.priya, roles: ['learner', 'org_admin'], activeOrg: { slug: 'quillmoor' }, platformAdmin: false, auth: { method: 'dev-impersonation', impersonated: true } });
    expect(me.csrfToken).toBe(r.json().csrfToken);
    expect(me.csrfToken).toHaveLength(32);

    // An ordinary session for API calls: reads work, writes need the CSRF token.
    expect((await on.app.inject({ url: '/api/home', headers: { cookie } })).statusCode).toBe(200);
    expect((await on.app.inject({ url: '/api/admin/users', headers: { cookie } })).statusCode).toBe(200);
    expect((await on.app.inject({ url: '/api/platform/orgs', headers: { cookie } })).statusCode).toBe(403);
    expect((await on.app.inject({ method: 'POST', url: '/api/me/org', headers: { cookie }, payload: { orgId: on.orgs.quillmoor } })).statusCode).toBe(403);
    expect((await on.app.inject({ method: 'POST', url: '/api/me/org', headers: { cookie, 'x-csrf-token': me.csrfToken }, payload: { orgId: on.orgs.quillmoor } })).statusCode).toBe(200);

    // Never longer than a normal session (harness maxAgeSeconds 3600), never refreshed against an IdP.
    const row = await on.t.owner.selectFrom('auth_sessions').selectAll().where('user_id', '=', Q.priya).where('idp', '=', 'dev:impersonation').executeTakeFirstOrThrow();
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBeLessThanOrEqual(3600_000 + 5_000);
    expect(row.access_expires_at).toBeNull();
    expect(row.refresh_token).toBeNull();

    const audit = await on.t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'auth.dev_impersonate').where('target_id', '=', Q.priya).executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ org_id: on.orgs.quillmoor, actor_id: null, actor_name: 'dev-impersonation', target_type: 'user', target_label: 'priya.raman@quillmoor.example' });
    expect(audit.details).toMatchObject({ orgId: on.orgs.quillmoor, platformAdmin: false });

    // Logout ends it (no Keycloak end-session for a session Keycloak never saw).
    const out = await on.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': me.csrfToken } });
    expect(out.statusCode).toBe(200);
    expect(out.json().redirectUrl).toBe('http://web.test/');
    expect((await on.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('grants platform_admin only when the database says so, and only orgs the user belongs to', async () => {
    const rhea = await signInAs(on, { userId: Q.rhea });
    expect(rhea.statusCode).toBe(200);
    expect(rhea.json()).toMatchObject({ platformAdmin: true, auth: { impersonated: true } });
    expect((await on.app.inject({ url: '/api/platform/orgs', headers: { cookie: cookieOf(rhea)! } })).statusCode).toBe(200);

    const amara = await signInAs(on, { email: 'amara.nwosu@quillmoor.example' });
    expect(amara.json()).toMatchObject({ roles: ['learner'], platformAdmin: false });
    expect((await on.app.inject({ url: '/api/admin/users', headers: { cookie: cookieOf(amara)! } })).statusCode).toBe(403);
    expect((await signInAs(on, { email: 'amara.nwosu@quillmoor.example', orgId: on.orgs.acme })).statusCode).toBe(403);
    expect((await signInAs(on, { email: 'amara.nwosu@quillmoor.example', orgId: on.orgs.quillmoor })).statusCode).toBe(200);
    // Nothing was granted on the way.
    const m = await on.t.owner.selectFrom('memberships').select(['org_id', 'roles']).where('user_id', '=', Q.amara).execute();
    expect(m).toEqual([{ org_id: on.orgs.quillmoor, roles: ['learner'] }]);
  });
});
