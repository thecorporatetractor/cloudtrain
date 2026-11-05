import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeOidcProvider } from './fake-oidc.js';
import { harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';
import { Sealer, SessionStore } from '../src/oidc/sessions.js';
import { createDb } from '../src/db/index.js';
import { inviteUser } from '../src/platform/admin.js';
import { loadPrincipal, provision } from '../src/platform/identity.js';
import { repairTenantIdps } from '../src/keycloak/repair.js';

/** Keycloak users with IdP links: the admin calls invitations and the address guard make. */
class FakeKcUsers {
  users = new Map<string, { id: string; email: string; links: string[]; credentials: number; origin?: string }>();
  failReads = false;
  created: string[] = [];
  deleted: string[] = [];
  unlinked: [string, string][] = [];
  add(u: { id: string; email: string; links: string[]; credentials?: number; origin?: string }) {
    this.users.set(u.id, { credentials: 0, ...u });
  }
  async getUser(id: string) {
    if (this.failReads) throw Object.assign(new Error('Keycloak unavailable'), { status: 503 });
    const u = this.users.get(id);
    return u ? { id, username: u.email, email: u.email, enabled: true, attributes: u.origin ? { ct_broker_origin: [u.origin] } : {} } : null;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findUserByUsername(username: string) {
    return this.findUserByEmail(username);
  }
  async createUser(u: { email: string }) {
    this.created.push(u.email);
    this.add({ id: `kc-new-${this.created.length}`, email: u.email, links: [] });
    return `kc-new-${this.created.length}`;
  }
  async addOrgMember() {}
  async sendActionsEmail() {}
  async federatedIdentities(id: string) {
    if (this.failReads) throw Object.assign(new Error('Keycloak unavailable'), { status: 503 });
    return (this.users.get(id)?.links ?? []).map((identityProvider) => ({ identityProvider }));
  }
  async dropBrokeredLinks(id: string, aliases: string[]) {
    const u = this.users.get(id);
    if (!u) return 'none';
    if (u.links.every((l) => aliases.includes(l)) && !u.credentials) {
      this.users.delete(id);
      this.deleted.push(id);
      return 'deleted';
    }
    for (const a of aliases) this.unlinked.push([id, a]);
    u.links = u.links.filter((l) => !aliases.includes(l));
    return 'unlinked';
  }
}

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

  it('parallel requests after expiry refresh once, so refresh-token rotation does not end the session', async () => {
    op.accessTtl = -10;
    const { cb } = await signIn('lucas.ferreira@quillmoor.example', { sub: Q.lucas, email: 'lucas.ferreira@quillmoor.example', name: 'Lucas Ferreira' });
    const cookie = cookieOf(cb)!;
    op.accessTtl = 300;
    op.rotateRefreshTokens = true;
    try {
      const calls = op.tokenCalls;
      const all = await Promise.all(Array.from({ length: 6 }, () => h.app.inject({ url: '/api/me', headers: { cookie } })));
      expect(all.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(op.tokenCalls).toBe(calls + 1);
      expect((await h.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
    } finally {
      op.rotateRefreshTokens = false;
    }
  });

  it('two gateway replicas refresh one session once (claimed lease), the second finds it fresh', async () => {
    op.accessTtl = -10;
    const { cb } = await signIn('lucas.ferreira@quillmoor.example', { sub: Q.lucas, email: 'lucas.ferreira@quillmoor.example', name: 'Lucas Ferreira' });
    op.accessTtl = 300;
    const idHash = (await h.t.owner.selectFrom('auth_sessions').select('id_hash').where('user_id', '=', Q.lucas).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow()).id_hash;
    expect(cookieOf(cb)).toBeTruthy();
    const replica = () => new SessionStore(h.t.db, new Sealer('test-session-secret-0123456789'), { maxAgeSeconds: 3600, idleSeconds: 1800, secureCookie: false });
    let refreshes = 0;
    const slow = async () => {
      refreshes++;
      await new Promise((r) => setTimeout(r, 200));
      return { access_token: 'a', refresh_token: 'r2', expires_in: 300 };
    };
    const outcomes = await Promise.all([replica().refreshOnce(idHash, slow), replica().refreshOnce(idHash, slow)]);
    expect(outcomes.sort()).toEqual(['fresh', 'refreshed']);
    expect(refreshes).toBe(1);
    expect(await replica().refreshOnce('no-such-session', slow)).toBe('gone');
  });

  it('a refresh whose lease another writer moved keeps the session (fresh), one revoked meanwhile is gone', async () => {
    op.accessTtl = -10;
    await signIn('lucas.ferreira@quillmoor.example', { sub: Q.lucas, email: 'lucas.ferreira@quillmoor.example', name: 'Lucas Ferreira' });
    op.accessTtl = 300;
    const idHash = (await h.t.owner.selectFrom('auth_sessions').select('id_hash').where('user_id', '=', Q.lucas).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow()).id_hash;
    const store = new SessionStore(h.t.db, new Sealer('test-session-secret-0123456789'), { maxAgeSeconds: 3600, idleSeconds: 1800, secureCookie: false });
    // A re-auth stores fresh tokens (a new expiry) while the IdP call runs.
    const reauth = async () => {
      await h.t.owner.updateTable('auth_sessions').set({ access_expires_at: new Date(Date.now() + 600_000) }).where('id_hash', '=', idHash).execute();
      return { access_token: 'a', refresh_token: 'r-moved', expires_in: 300 };
    };
    expect(await store.refreshOnce(idHash, reauth)).toBe('fresh');
    expect(await h.t.owner.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', idHash).executeTakeFirst()).toBeTruthy();
    // Expired again, and logged out while the IdP call runs.
    await h.t.owner.updateTable('auth_sessions').set({ access_expires_at: new Date(Date.now() - 10_000) }).where('id_hash', '=', idHash).execute();
    const logout = async () => {
      await h.t.owner.deleteFrom('auth_sessions').where('id_hash', '=', idHash).execute();
      return { access_token: 'a', expires_in: 300 };
    };
    expect(await store.refreshOnce(idHash, logout)).toBe('gone');
  });

  it('a hung token endpoint holds no database connection, and a failed refresh is retried', async () => {
    op.accessTtl = -10;
    await signIn('lucas.ferreira@quillmoor.example', { sub: Q.lucas, email: 'lucas.ferreira@quillmoor.example', name: 'Lucas Ferreira' });
    op.accessTtl = 300;
    const idHash = (await h.t.owner.selectFrom('auth_sessions').select('id_hash').where('user_id', '=', Q.lucas).orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow()).id_hash;
    // A pool of ONE connection: if the refresh kept it while the IdP stalls, the query below would hang.
    const one = createDb(h.t.appUrl, 1);
    try {
      const store = new SessionStore(one, new Sealer('test-session-secret-0123456789'), { maxAgeSeconds: 3600, idleSeconds: 1800, secureCookie: false });
      let release!: (e: Error) => void;
      const stalled = store.refreshOnce(idHash, () => new Promise<never>((_, rej) => (release = rej)));
      await new Promise((r) => setTimeout(r, 100));
      const probe = await Promise.race([
        one.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', idHash).executeTakeFirst().then(() => 'db ok'),
        new Promise((r) => setTimeout(() => r('db blocked'), 2000)),
      ]);
      expect(probe).toBe('db ok');
      // While the claim is held, another replica treats the session as fresh rather than spending the same refresh token.
      const other = new SessionStore(h.t.db, new Sealer('test-session-secret-0123456789'), { maxAgeSeconds: 3600, idleSeconds: 1800, secureCookie: false });
      expect(await other.refreshOnce(idHash, async () => ({ access_token: 'x', expires_in: 300 }))).toBe('fresh');
      release(new Error('IdP timed out'));
      await expect(stalled).rejects.toThrow('IdP timed out');
      // The lease was given back: the next request refreshes.
      expect(await other.refreshOnce(idHash, async () => ({ access_token: 'x', refresh_token: 'r3', expires_in: 300 }))).toBe('refreshed');
    } finally {
      await one.destroy();
    }
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

  describe('invitations and pre-provisioned identities only go to a trusted email', () => {
    /** Quillmoor (priya) invites `email`; returns the pending user id and the link token. */
    async function invite(email: string) {
      const priya = (await loadPrincipal(h.t.db, Q.priya, h.orgs.quillmoor))!;
      const r = await inviteUser(h.ps, priya, { email, roles: ['learner', 'org_admin'] });
      const token = /\/api\/auth\/invite\/([A-Za-z0-9_-]+)/.exec(h.mailer.sent.at(-1)!.text)![1]!;
      return { userId: r.user.id, token };
    }
    const membership = (userId: string) => h.t.owner.selectFrom('memberships').select(['status', 'user_id']).where('org_id', '=', h.orgs.quillmoor).where('user_id', '=', userId).executeTakeFirst();
    /** Runs `fn` with `kc` as the gateway's Keycloak admin client. */
    async function withKc<T>(kc: FakeKcUsers, fn: () => Promise<T>): Promise<T> {
      const ps = h.ps as unknown as { kc: unknown };
      const before = ps.kc;
      ps.kc = kc;
      try {
        return await fn();
      } finally {
        ps.kc = before;
      }
    }

    it("another org's IdP cannot take over an invitation by asserting the invited email", async () => {
      // Acme's org admin controls acme-idp; the invited address is on a Quillmoor domain, then on nobody's.
      for (const email of ['zoe.invited@quillmoor.example', 'zoe.invited@freemail.example']) {
        const { userId } = await invite(email);
        expect(userId).toMatch(/^pending-/);
        const { cb } = await signIn(email, { sub: `kc-mallory-${email}`, email, name: 'Mallory', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] });
        expect(cb.headers.location).toMatch(/error=email_conflict/);
        expect(cookieOf(cb)).toBeUndefined();
        expect(await membership(userId)).toMatchObject({ status: 'invited' });
      }
    });

    it('an unverified email claims nothing, unless the login came through the invitation link', async () => {
      const email = 'yusuf.invited@quillmoor.example';
      const { userId, token } = await invite(email);
      const plain = await signIn(email, { sub: 'kc-yusuf', email, email_verified: false, name: 'Yusuf' });
      expect(plain.cb.headers.location).toMatch(/error=email_conflict/);
      expect(await membership(userId)).toMatchObject({ status: 'invited' });

      // A forged invite parameter on the plain login route is ignored.
      const forged = await signIn(email, { sub: 'kc-yusuf', email, email_verified: false, name: 'Yusuf' }, '&invite=1');
      expect(forged.cb.headers.location).toMatch(/error=email_conflict/);

      // The link went to the invited mailbox: holding it proves the address for that invitation.
      const link = await h.app.inject(`/api/auth/invite/${token}`);
      expect(link.statusCode).toBe(302);
      const { code, state } = op.authorize(link.headers.location as string, { sub: 'kc-yusuf', email, email_verified: false, name: 'Yusuf' });
      const cb = await h.app.inject(`/api/auth/callback?code=${code}&state=${state}`);
      expect(cb.headers.location).toBe('http://web.test/');
      expect(await membership('kc-yusuf')).toMatchObject({ status: 'active' });
    });

    it("a hostile IdP's login before the invitation does not lock the owner out of the address", async () => {
      // An address on a domain no org verified (an address on a verified domain is refused outright, below).
      const email = 'nora.first@freemail.example';
      const mallory = { sub: 'kc-mallory-nora', email, name: 'Mallory', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] };
      // Mallory signs in first: her account gets the address, untrusted (acme does not own freemail.example).
      expect((await signIn(email, mallory)).cb.headers.location).not.toMatch(/error=/);
      // Quillmoor then invites the address: the invitation lands on Mallory's account, which may not accept it.
      const { userId } = await invite(email);
      expect(userId).toBe('kc-mallory-nora');
      await signIn(email, mallory);
      expect(await membership('kc-mallory-nora')).toMatchObject({ status: 'invited' });

      // Nora signs in with the verified address: she takes it over, with Quillmoor's invitation.
      const { cb } = await signIn(email, { sub: 'kc-nora', email, name: 'Nora' });
      expect(cb.headers.location).toBe('http://web.test/team');
      expect(await membership('kc-nora')).toMatchObject({ status: 'active' });
      expect(await membership('kc-mallory-nora')).toBeUndefined();
      const users = await h.t.owner.selectFrom('users').select(['id', 'email']).where('id', 'in', ['kc-nora', 'kc-mallory-nora']).orderBy('id').execute();
      expect(users[0]).toMatchObject({ id: 'kc-mallory-nora', email: expect.stringMatching(/@invalid$/) });
      expect(users[1]).toMatchObject({ id: 'kc-nora', email });
      const reclaimed = await h.t.owner.selectFrom('audit_log').select(['org_id', 'target_id']).where('action', '=', 'auth.email_reclaimed').execute();
      expect(reclaimed).toEqual(expect.arrayContaining([expect.objectContaining({ org_id: h.orgs.quillmoor, target_id: 'kc-mallory-nora' })]));

      // Mallory cannot take it back, and an untrusted login never takes an address over.
      expect((await signIn(email, mallory)).cb.headers.location).toMatch(/error=email_conflict/);
      expect((await signIn(email, { sub: 'kc-other', email, email_verified: false, name: 'Other' })).cb.headers.location).toMatch(/error=email_conflict/);
      expect(await h.t.owner.selectFrom('users').select('email').where('id', '=', 'kc-nora').executeTakeFirst()).toEqual({ email });
    });

    it('a brokered account that adds a password and signs in locally is still judged by its IdP', async () => {
      // Mallory (acme-idp's admin) brokers an address on a domain no org verified, then sets a password
      // in Keycloak's account console: her password login has no identity_provider claim.
      const email = 'vic.victim@freemail.example';
      const kc = new FakeKcUsers();
      kc.add({ id: 'kc-mallory-vic', email, links: ['acme-idp'], credentials: 1, origin: 'acme-idp' });
      await withKc(kc, async () => {
        expect((await signIn(email, { sub: 'kc-mallory-vic', email, name: 'Mallory', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] })).cb.headers.location).not.toMatch(/error=/);
        const { userId } = await invite(email);
        expect(userId).toBe('kc-mallory-vic');
        // The password login does not make her email trusted: Quillmoor's invitation stays open.
        await signIn(email, { sub: 'kc-mallory-vic', email, name: 'Mallory' });
        expect(await membership('kc-mallory-vic')).toMatchObject({ status: 'invited' });
        // Unlinking the IdP changes nothing: the origin stamp stays, and so does last_idp.
        kc.users.get('kc-mallory-vic')!.links = [];
        await signIn(email, { sub: 'kc-mallory-vic', email, name: 'Mallory' });
        expect(await membership('kc-mallory-vic')).toMatchObject({ status: 'invited' });
        expect(await h.t.owner.selectFrom('users').select('last_idp').where('id', '=', 'kc-mallory-vic').executeTakeFirst()).toEqual({ last_idp: 'acme-idp' });
        // So the real owner can still take the address over.
        const { cb } = await signIn(email, { sub: 'kc-vic', email, name: 'Vic' });
        expect(cb.headers.location).toBe('http://web.test/team');
        expect(await membership('kc-vic')).toMatchObject({ status: 'active' });
      });
    });

    it('a brokered-origin account whose first gateway login is local cannot claim a pending identity', async () => {
      const email = 'wes.pending@freemail.example';
      const { userId } = await invite(email);
      expect(userId).toMatch(/^pending-/);
      const kc = new FakeKcUsers();
      // Brokered by acme-idp, then a password set and the link removed before ever reaching the gateway.
      kc.add({ id: 'kc-mallory-wes', email, links: [], credentials: 1, origin: 'acme-idp' });
      await withKc(kc, async () => {
        expect((await signIn(email, { sub: 'kc-mallory-wes', email, name: 'Mallory' })).cb.headers.location).toMatch(/error=email_conflict/);
        expect(await membership(userId)).toMatchObject({ status: 'invited' });
        // Keycloak unreachable: a local login is not trusted either.
        kc.failReads = true;
        expect((await signIn(email, { sub: 'kc-someone-wes', email, name: 'Someone' })).cb.headers.location).toMatch(/error=email_conflict/);
        expect(await membership(userId)).toMatchObject({ status: 'invited' });
        // A plain local account (no IdP origin) claims it.
        kc.failReads = false;
        expect((await signIn(email, { sub: 'kc-wes', email, name: 'Wes' })).cb.headers.location).toBe('http://web.test/team');
        expect(await membership('kc-wes')).toMatchObject({ status: 'active' });
      });
    });

    it('the gateway re-applies the tenant IdP protections itself (no kc:sync needed)', async () => {
      const calls: string[] = [];
      const users = [
        { id: 'u-own', email: 'own@acme-freight.example', attributes: { ct_broker_origin: ['acme-idp'] } },
        { id: 'u-old', email: 'old@freemail.example' },
        { id: 'u-foreign', email: 'foreign@quillmoor.example', attributes: { ct_broker_origin: ['acme-idp'] } },
      ];
      const kc = {
        allowUnmanagedAttributes: async () => false,
        ensureTenantBrokerFlow: async () => void calls.push('flow'),
        getIdp: async (alias: string) => ({ alias, providerId: 'oidc', enabled: true, firstBrokerLoginFlowAlias: 'first broker login', config: {} }),
        updateIdp: async (idp: { alias: string; firstBrokerLoginFlowAlias: string }) => void calls.push(`idp ${idp.alias} -> ${idp.firstBrokerLoginFlowAlias}`),
        ensureBrokerOriginMapper: async (alias: string) => void calls.push(`mapper ${alias}`),
        idpUsers: async () => users,
        addUserAttribute: async (id: string, _n: string, v: string) => void calls.push(`mark ${id} ${v}`),
        federatedIdentities: async () => [{ identityProvider: 'acme-idp' }],
        dropBrokeredLinks: async (id: string, aliases: string[]) => (calls.push(`drop ${id} ${aliases.join(',')}`), 'unlinked' as const),
      };
      const r = await repairTenantIdps(h.t.db, kc as never);
      expect(calls).toEqual(['flow', 'idp acme-idp -> cloudtrain tenant broker login', 'mapper acme-idp', 'mark u-old acme-idp', 'drop u-foreign acme-idp']);
      expect(r).toEqual({ brokerFlowFixed: ['acme-idp'], foreignReleased: ['acme-idp/u-foreign'], untrustedLinks: ['acme-idp/u-old'], originsMarked: ['acme-idp/u-old'], failures: [] });
    });

    it('a trusted login never takes an address from an account that holds it trusted', async () => {
      const email = 'otto.local@quillmoor.example';
      await signIn(email, { sub: 'kc-otto', email, name: 'Otto' }); // a local account, no org yet
      expect((await invite(email)).userId).toBe('kc-otto');
      expect((await signIn(email, { sub: 'kc-otto-2', email, name: 'Otto 2' })).cb.headers.location).toMatch(/error=email_conflict/);
      expect(await h.t.owner.selectFrom('users').select('email').where('id', '=', 'kc-otto').executeTakeFirst()).toEqual({ email });
    });

    it("an IdP may not sign in an address on another org's verified domain; its Keycloak user is dropped", async () => {
      const email = 'nadia.owner@quillmoor.example';
      const kc = new FakeKcUsers();
      kc.add({ id: 'kc-mallory-nadia', email, links: ['acme-idp'] }); // brokered by acme-idp, nothing else
      kc.add({ id: 'kc-linked-local', email: 'leo.local@quillmoor.example', links: ['acme-idp'], credentials: 1 });
      kc.add({ id: 'kc-squatter', email: 'quinn.new@quillmoor.example', links: ['acme-idp'] });
      await withKc(kc, async () => {
        const { cb } = await signIn(email, { sub: 'kc-mallory-nadia', email, name: 'Mallory', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] });
        expect(cb.headers.location).toMatch(/error=email_conflict/);
        expect(cookieOf(cb)).toBeUndefined();
        // Keycloak no longer holds the address for acme-idp: its owner's first login is not refused there.
        expect(kc.deleted).toEqual(['kc-mallory-nadia']);
        expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', 'kc-mallory-nadia').executeTakeFirst()).toBeUndefined();
        const denied = await h.t.owner.selectFrom('audit_log').select(['org_id', 'target_id']).where('action', '=', 'auth.login_denied').where('target_id', '=', 'kc-mallory-nadia').execute();
        expect(denied).toEqual([{ org_id: h.orgs.quillmoor, target_id: 'kc-mallory-nadia' }]);

        // Starting a login for an address on a verified domain drops another org's link there too.
        // An account with more than that link (here a password) keeps everything else.
        const start = await h.app.inject(`/api/auth/login?email=${encodeURIComponent('leo.local@quillmoor.example')}`);
        expect(start.statusCode).toBe(302);
        expect(kc.unlinked).toEqual([['kc-linked-local', 'acme-idp']]);
        expect(kc.deleted).toEqual(['kc-mallory-nadia']);

        // Inviting an address another org's IdP brought into Keycloak frees it and creates the real account.
        const { userId } = await invite('quinn.new@quillmoor.example');
        expect(kc.deleted).toEqual(['kc-mallory-nadia', 'kc-squatter']);
        expect(kc.created).toEqual(['quinn.new@quillmoor.example']);
        expect(userId).toBe('kc-new-1');
      });
    });

    it('inviting an SSO user of another org creates no Keycloak user, and their first SSO login accepts it', async () => {
      // Quillmoor (local login here, with Keycloak) invites an address on Acme's verified, SSO-enforced domain.
      const email = 'ingrid.sso@acme-freight.example';
      const kc = new FakeKcUsers();
      const { userId, token } = await withKc(kc, () => invite(email));
      expect(userId).toMatch(/^pending-/);
      expect(kc.created).toEqual([]);
      expect(h.mailer.sent.at(-1)!.text).toContain('Sign in with your Acme Freight account (single sign-on)');
      // The link sends her to Acme's IdP.
      const link = await h.app.inject(`/api/auth/invite/${token}`);
      expect(new URL(link.headers.location as string).searchParams.get('kc_idp_hint')).toBe('acme-idp');
      // Her first login through Acme's IdP (trusted: Acme verified the domain) claims the identity and accepts.
      const { cb } = await signIn(email, { sub: 'kc-ingrid', email, name: 'Ingrid', identity_provider: 'acme-idp', idp_roles: ['CloudTrain.Learner'] });
      expect(cb.headers.location).not.toMatch(/error=/);
      expect(await membership('kc-ingrid')).toMatchObject({ status: 'active' });
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst()).toBeUndefined();
    });

    it('a platform IdP with no org of its own is not trusted for other orgs\' invitations (documented); the link works', async () => {
      const email = 'pia.platform@freemail.example';
      const { userId } = await invite(email);
      const claims = { sub: 'kc-pia', email, emailVerified: true, name: 'Pia', identityProvider: 'azarguard-entra', idpRoles: [], idpGroups: [] };
      expect(await provision(h.t.db, claims, { platformIdps: ['azarguard-entra'] })).toMatchObject({ ok: false, reason: 'email_conflict' });
      expect(await membership(userId)).toMatchObject({ status: 'invited' });
      expect(await provision(h.t.db, claims, { platformIdps: ['azarguard-entra'], invitation: { orgId: h.orgs.quillmoor, email } })).toMatchObject({ ok: true });
      expect(await membership('kc-pia')).toMatchObject({ status: 'active' });
    });

    it('a verified email accepts its invitations on a normal sign-in', async () => {
      const email = 'vera.invited@quillmoor.example';
      await invite(email);
      const { cb } = await signIn(email, { sub: 'kc-vera', email, name: 'Vera' });
      expect(cb.headers.location).toBe('http://web.test/team');
      expect(await membership('kc-vera')).toMatchObject({ status: 'active' });
    });
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
