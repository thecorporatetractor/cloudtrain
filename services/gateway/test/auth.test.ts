import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeOidcProvider } from './fake-oidc.js';
import { harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const set = ([] as string[]).concat((res.headers['set-cookie'] as string | string[]) ?? []);
  return set.find((c) => c.startsWith('ct_session='))?.split(';')[0];
};

describe.skipIf(!available)('OIDC BFF auth flow (fake provider)', () => {
  let op: FakeOidcProvider;
  let h: Harness;

  beforeAll(async () => {
    op = await new FakeOidcProvider().start();
    h = await harness({ oidc: op });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
    await op?.stop();
  });

  /** login -> provider authorize -> callback; returns the callback response. */
  async function signIn(email: string, claims: Record<string, unknown>, extra = '') {
    const start = await h.app.inject(`/api/auth/login?email=${encodeURIComponent(email)}&returnTo=%2Fteam${extra}`);
    expect(start.statusCode).toBe(302);
    const auth = new URL(start.headers.location as string);
    const { code, state } = op.authorize(auth.toString(), claims);
    const cb = await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`);
    return { start: auth, cb };
  }

  it('limits how often one address can start a login', async () => {
    const from = { remoteAddress: '203.0.113.77' };
    for (let i = 0; i < 120; i++) expect((await h.app.inject({ url: '/api/auth/login', ...from })).statusCode).toBe(302);
    const over = await h.app.inject({ url: '/api/auth/login', ...from });
    expect(over.statusCode).toBe(429);
    expect((await h.app.inject({ url: '/api/auth/login', remoteAddress: '203.0.113.78' })).statusCode).toBe(302);
  });

  it('discovers the org by verified email domain', async () => {
    expect((await h.app.inject('/api/auth/discover?email=hannah.vogel@acme-freight.example')).json()).toMatchObject({ method: 'sso', idpAlias: 'acme-idp', org: { slug: 'acme-freight' } });
    expect((await h.app.inject('/api/auth/discover?email=priya.raman@quillmoor.example')).json()).toMatchObject({ method: 'local', org: { slug: 'quillmoor' } });
    expect((await h.app.inject('/api/auth/discover?email=x@nowhere.example')).json()).toMatchObject({ method: 'unknown' });
  });

  it('logs a local user in with code + PKCE and sets an HttpOnly SameSite=Lax session cookie', async () => {
    const { start, cb } = await signIn('priya.raman@quillmoor.example', { sub: Q.priya, email: 'priya.raman@quillmoor.example', name: 'Priya Raman' });
    expect(start.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.searchParams.get('login_hint')).toBe('priya.raman@quillmoor.example');
    expect(start.searchParams.get('kc_idp_hint')).toBeNull();
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('http://web.test/team');
    const raw = ([] as string[]).concat(cb.headers['set-cookie'] as string).join(';');
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    const cookie = cookieOf(cb)!;
    const me = (await h.app.inject({ url: '/api/me', headers: { cookie } })).json();
    expect(me).toMatchObject({ id: Q.priya, roles: ['learner', 'org_admin'], activeOrg: { slug: 'quillmoor' }, auth: { method: 'oidc', idp: 'local' } });
    expect(me.permissions).toContain('audit.read');
    expect(me.csrfToken).toHaveLength(32);
    // Tokens never reach the browser.
    expect(JSON.stringify(me)).not.toMatch(/eyJ/);

    // Writes need the CSRF token.
    const noCsrf = await h.app.inject({ method: 'PUT', url: '/api/admin/quotas', headers: { cookie }, payload: { monthlyLabHours: 700 } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'csrf' });
    const ok = await h.app.inject({ method: 'PUT', url: '/api/admin/quotas', headers: { cookie, 'x-csrf-token': me.csrfToken }, payload: { monthlyLabHours: 700 } });
    expect(ok.statusCode).toBe(200);
  });

  it('routes SSO domains to the IdP and maps app roles and groups (JIT, re-evaluated every login)', async () => {
    const claims = { sub: 'kc-marcus', email: 'marcus.bell@acme-freight.example', name: 'Marcus Bell', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner', 'CloudTrain.Manager'], idp_groups: ['acme-linehaul-leads'] };
    const { start, cb } = await signIn(claims.email, claims);
    expect(start.searchParams.get('kc_idp_hint')).toBe('acme-idp');
    const cookie = cookieOf(cb)!;
    let me = (await h.app.inject({ url: '/api/me', headers: { cookie } })).json();
    expect(me.roles).toEqual(['learner', 'manager']);
    expect(me.managedTeams.map((t: { name: string }) => t.name)).toEqual(['Linehaul Operations']);
    // The IdP drops the manager role: the next login takes it away.
    const again = await signIn(claims.email, { ...claims, idp_roles: ['CloudTrain.Learner'], idp_groups: [] });
    me = (await h.app.inject({ url: '/api/me', headers: { cookie: cookieOf(again.cb)! } })).json();
    expect(me.roles).toEqual(['learner']);
    expect(me.teams).toEqual([]);
  });

  it('claims a seeded identity by email on first SSO login, keeping its history', async () => {
    const before = await h.t.owner.selectFrom('lab_attempts').select('id').where('user_id', '=', 'pending-b2000000-0000-4000-8000-000000000005').execute();
    expect(before.length).toBeGreaterThan(0);
    const { cb } = await signIn('hannah.vogel@acme-freight.example', { sub: 'kc-hannah', email: 'hannah.vogel@acme-freight.example', name: 'Hannah Vogel', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'], idp_groups: ['acme-linehaul-ops'] });
    const cookie = cookieOf(cb)!;
    const attempts = (await h.app.inject({ url: '/api/attempts/mine?limit=200', headers: { cookie } })).json();
    expect(attempts.items).toHaveLength(before.length);
  });

  it('honours CloudTrain.PlatformAdmin only from trusted IdPs', async () => {
    const { cb } = await signIn('ari.lindgren@acme-freight.example', { sub: 'kc-ari', email: 'ari.lindgren@acme-freight.example', name: 'Ari Lindgren', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.PlatformAdmin'] });
    const me = (await h.app.inject({ url: '/api/me', headers: { cookie: cookieOf(cb)! } })).json();
    expect(me).toMatchObject({ platformAdmin: true, activeOrg: null });
    // A local login cannot self-assert the platform role.
    const local = await signIn('kenji.morita@quillmoor.example', { sub: Q.kenji, email: 'kenji.morita@quillmoor.example', name: 'Kenji Morita', idp_roles: ['CloudTrain.PlatformAdmin'] });
    expect((await h.app.inject({ url: '/api/me', headers: { cookie: cookieOf(local.cb)! } })).json().platformAdmin).toBe(false);
  });

  it('refuses local login for a domain with enforced SSO, and unknown people', async () => {
    const enforced = await signIn('olivia.hart@acme-freight.example', { sub: 'kc-olivia-local', email: 'olivia.hart@acme-freight.example', name: 'Olivia Hart' });
    expect(enforced.cb.headers.location).toMatch(/error=sso_required/);
    const stranger = await signIn('nobody@elsewhere.example', { sub: 'kc-nobody', email: 'nobody@elsewhere.example', name: 'Nobody' });
    expect(stranger.cb.headers.location).toMatch(/error=no_membership/);
    expect(cookieOf(stranger.cb)).toBeUndefined();
  });

  it('rejects a replayed or forged state', async () => {
    const start = await h.app.inject('/api/auth/login?email=amara.nwosu@quillmoor.example');
    const { code, state } = op.authorize(start.headers.location as string, { sub: Q.amara, email: 'amara.nwosu@quillmoor.example', name: 'Amara Nwosu' });
    expect((await h.app.inject(`/api/auth/callback?code=${code}&state=forged`)).headers.location).toMatch(/error=invalid_state/);
    expect((await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`)).statusCode).toBe(302);
    expect((await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`)).headers.location).toMatch(/error=invalid_state/);
  });

  it('refreshes server-side, and a refused refresh ends the session', async () => {
    op.accessTtl = -10; // access token already expired: every request refreshes
    const { cb } = await signIn('lucas.ferreira@quillmoor.example', { sub: Q.lucas, email: 'lucas.ferreira@quillmoor.example', name: 'Lucas Ferreira' });
    const cookie = cookieOf(cb)!;
    const calls = op.tokenCalls;
    expect((await h.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
    expect(op.tokenCalls).toBe(calls + 1);
    op.revokeRefreshTokens();
    expect((await h.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
    op.accessTtl = 300;
  });

  it('logs out (RP-initiated) and honours back-channel logout tokens', async () => {
    const a = await signIn('jonah.brandt@quillmoor.example', { sub: Q.jonah, email: 'jonah.brandt@quillmoor.example', name: 'Jonah Brandt' });
    const cookie = cookieOf(a.cb)!;
    const me = (await h.app.inject({ url: '/api/me', headers: { cookie } })).json();
    const out = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': me.csrfToken } });
    expect(out.json().redirectUrl).toMatch(/\/logout\?id_token_hint=.*post_logout_redirect_uri=http%3A%2F%2Fweb.test%2F/);
    expect((await h.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);

    const b = await signIn('jonah.brandt@quillmoor.example', { sub: Q.jonah, email: 'jonah.brandt@quillmoor.example', name: 'Jonah Brandt' });
    const cookie2 = cookieOf(b.cb)!;
    expect((await h.app.inject({ url: '/api/me', headers: { cookie: cookie2 } })).statusCode).toBe(200);
    const bad = await h.app.inject({ method: 'POST', url: '/api/auth/backchannel-logout', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'logout_token=not-a-jwt' });
    expect(bad.statusCode).toBe(400);
    const token = await op.logoutToken(Q.jonah);
    const ok = await h.app.inject({ method: 'POST', url: '/api/auth/backchannel-logout', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `logout_token=${token}` });
    expect(ok.statusCode).toBe(200);
    expect((await h.app.inject({ url: '/api/me', headers: { cookie: cookie2 } })).statusCode).toBe(401);
  });

  it('switches org only into orgs the user belongs to', async () => {
    const { cb } = await signIn('ines.achterberg@quillmoor.example', { sub: Q.ines, email: 'ines.achterberg@quillmoor.example', name: 'Ines Achterberg' });
    const cookie = cookieOf(cb)!;
    const me = (await h.app.inject({ url: '/api/me', headers: { cookie } })).json();
    const r = await h.app.inject({ method: 'POST', url: '/api/me/org', headers: { cookie, 'x-csrf-token': me.csrfToken }, payload: { orgId: h.orgs.acme } });
    expect(r.statusCode).toBe(403);
  });

  it('only redirects back inside the app', async () => {
    const start = await h.app.inject('/api/auth/login?returnTo=%2F%2Fevil.example%2Fx');
    const { code, state } = op.authorize(start.headers.location as string, { sub: Q.sofia, email: 'sofia.lindqvist@quillmoor.example', name: 'Sofia Lindqvist' });
    expect((await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`)).headers.location).toBe('http://web.test/');
  });
});

describe('recent sign-in before a download or a deletion', () => {
  it('asks again once auth_time is older than the window, and login with reauth=1 forces the prompt', async () => {
    const oidc = await new FakeOidcProvider().start();
    const h = await harness({ oidc, gdpr: { recentSignInMs: 60_000 } });
    try {
      const login = await h.app.inject({ method: 'GET', url: `/api/auth/login?email=${encodeURIComponent('lucas.brandt@quillmoor.example')}&reauth=1` });
      expect(new URL(login.headers.location as string).searchParams.get('prompt')).toBe('login');
      const plain = await h.app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(new URL(plain.headers.location as string).searchParams.get('prompt')).toBeNull();

      const p = await h.t.owner.selectFrom('users').select(['id', 'email', 'name']).where('id', '=', Q.lucas).executeTakeFirstOrThrow();
      const principal = { sub: p.id, email: p.email, name: p.name, orgId: h.orgs.quillmoor, orgName: '', orgSlug: '', team: '', roles: ['learner' as const], teams: [], managedTeamIds: [], instructedCohortIds: [], cohortIds: [], platformAdmin: false };
      const session = (at?: Date) => ({ idHash: 'x', csrf: 'x', expiresAt: '', method: 'oidc' as const, ...(at ? { authenticatedAt: at.toISOString() } : {}) });
      const stale = { ...principal, session: session(new Date(Date.now() - 61_000)) };
      const fresh = { ...principal, session: session(new Date(Date.now() - 59_000)) };
      await expect(h.gdpr.exportAccount(stale)).rejects.toMatchObject({ status: 403, extra: { code: 'reauth_required' } });
      await expect(h.gdpr.deleteAccount(stale, p.email)).rejects.toMatchObject({ status: 403, extra: { code: 'reauth_required' } });
      // No auth_time at all is not proof of anything.
      await expect(h.gdpr.exportAccount({ ...principal, session: session() })).rejects.toMatchObject({ extra: { code: 'reauth_required' } });
      expect((await h.gdpr.summary(stale)).recentSignIn).toBe(false);
      expect((await h.gdpr.summary(fresh)).recentSignIn).toBe(true);
      await expect(h.gdpr.exportAccount(fresh)).resolves.toMatchObject({ profile: { id: p.id } });

      // The whole way through: an old auth_time in the ID token reaches the session and the route.
      const start = await h.app.inject(`/api/auth/login?email=${encodeURIComponent(p.email)}`);
      const { code, state } = oidc.authorize(start.headers.location as string, { sub: p.id, email: p.email, name: p.name, auth_time: Math.floor(Date.now() / 1000) - 3600 });
      const cb = await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`);
      const cookie = ([cb.headers['set-cookie']].flat() as string[]).find((c) => c.startsWith('ct_session='))!.split(';')[0]!;
      const row = await h.t.owner.selectFrom('auth_sessions').select('authenticated_at').where('user_id', '=', p.id).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow();
      expect(row.authenticated_at!.getTime()).toBeLessThan(Date.now() - 3000_000);
      const me = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      const csrf = me.json().csrfToken as string;
      expect((await h.app.inject({ method: 'GET', url: '/api/me/privacy', headers: { cookie } })).json().recentSignIn).toBe(false);
      const refused = await h.app.inject({ method: 'POST', url: '/api/me/privacy/export', headers: { cookie, 'x-csrf-token': csrf } });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('reauth_required');
    } finally {
      await h.close();
      await oidc.stop();
    }
  });
});
