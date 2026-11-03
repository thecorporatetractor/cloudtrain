import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthDiscovery, LogoutResponse, SwitchOrgRequest } from '@cloudtrain/api-types';
import { withTenant } from '../db/index.js';
import { badRequest, HttpError, unauthenticated } from '../errors.js';
import { randomToken, type OidcClient } from '../oidc/client.js';
import type { SessionStore } from '../oidc/sessions.js';
import { audit } from '../platform/audit.js';
import { loadPrincipal, membershipsOf, orgForDomain, orgForIdp, provision, type IdentityClaims } from '../platform/identity.js';
import { brokerOrigins, releaseForeignAddress } from '../platform/kc-address.js';
import type { PlatformService } from '../platform/service.js';
import { RateLimiter } from './public.js';

export interface AuthRouteDeps {
  ps: PlatformService;
  oidc: OidcClient;
  store: SessionStore;
}

const STATE_TTL_MS = 15 * 60_000;
/** Starting a login writes a state row. Per IP, and high enough for an office behind one address. */
const LOGIN_PER_MINUTE = 120;

/** Only same-app relative paths: no scheme, no protocol-relative `//host`. */
export function safeReturnTo(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v.slice(0, 500) : '/';
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

/** Gateway ID token -> the claims JIT provisioning reads. */
export function claimsOf(t: Record<string, unknown>): IdentityClaims {
  const email = String(t.email ?? '').toLowerCase();
  const name = String(t.name ?? ([t.given_name, t.family_name].filter(Boolean).join(' ') || email));
  return {
    sub: String(t.sub),
    email,
    // Only an explicit true: a provider that does not say has not verified it.
    emailVerified: t.email_verified === true,
    name,
    ...(typeof t.title === 'string' && t.title ? { title: t.title } : {}),
    ...(typeof t.identity_provider === 'string' && t.identity_provider ? { identityProvider: t.identity_provider } : {}),
    idpRoles: strings(t.idp_roles),
    idpGroups: strings(t.idp_groups),
  };
}

export function registerAuthRoutes(app: FastifyInstance, d: AuthRouteDeps): void {
  const { ps, oidc, store } = d;
  const web = ps.config.webUrl;
  const pub = { public: true } as const;
  const loginLimiter = new RateLimiter(LOGIN_PER_MINUTE);

  const loginError = (reply: FastifyReply, reason: string, message: string) => reply.redirect(`${web}/login?error=${encodeURIComponent(reason)}&message=${encodeURIComponent(message)}`, 302);

  async function discovery(emailRaw: string): Promise<AuthDiscovery> {
    const email = emailRaw.trim().toLowerCase();
    const loginUrl = `${ps.config.publicUrl}/api/auth/login?email=${encodeURIComponent(email)}`;
    const domain = email.split('@')[1];
    const org = domain ? await orgForDomain(ps.db, domain) : null;
    if (!org || !org.verified) return { email, method: org ? 'local' : 'unknown', loginUrl, ...(org ? { org: { id: org.org_id, slug: org.slug, name: org.name } } : {}) };
    return {
      email,
      method: org.idp_alias ? 'sso' : 'local',
      org: { id: org.org_id, slug: org.slug, name: org.name },
      ...(org.idp_alias ? { idpAlias: org.idp_alias, idpDisplayName: org.idp_name ?? org.idp_alias } : {}),
      loginUrl,
    };
  }

  app.get<{ Querystring: { email?: string } }>('/api/auth/discover', { config: pub }, async (req) => {
    if (!req.query.email?.includes('@')) throw badRequest('email is required', { email: 'required' });
    return discovery(req.query.email);
  });

  /** A live (not revoked, not expired) invitation by the hash of its link token; accepted ones too unless `open`. */
  async function invitationByHash(hash: string, open = false) {
    const inv = (await sql<{ org_id: string; email: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>`SELECT * FROM auth_invitation_by_token(${hash})`.execute(ps.db)).rows[0];
    return inv && !inv.revoked_at && inv.expires_at >= new Date() && !(open && inv.accepted_at) ? inv : null;
  }

  /**
   * Frees an address on a verified domain that another org's IdP brought into Keycloak
   * (platform/kc-address.ts): otherwise Keycloak refuses its owner's first login (through the
   * owner's own IdP, or the local account an invitation creates). Best effort: a Keycloak
   * outage does not stop the login.
   */
  async function freeAddress(req: FastifyRequest, email: string) {
    if (!ps.kc) return;
    try {
      const released = await releaseForeignAddress(ps.db, ps.kc, email);
      if (released.length) req.log.warn({ released }, 'keycloak: dropped links of other orgs\' IdPs holding an address on a verified domain');
    } catch (e) {
      req.log.warn({ err: e }, 'keycloak: could not check the address for foreign IdP links');
    }
  }

  /** Writes the login state and sends the browser to the provider. `invite` is set only by the invitation link. */
  async function startLogin(req: FastifyRequest, reply: FastifyReply, p: { email?: string; returnTo?: string; orgId: string | null; idpHint?: string; invite?: string; reauth?: boolean }) {
    if (!loginLimiter.take(req.ip)) throw new HttpError(429, 'Too many requests, try again later', { code: 'rate_limited', details: { retryAfterSeconds: loginLimiter.resetIn(req.ip) } });
    const state = randomToken(24);
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    await ps.db.deleteFrom('auth_login_states').where('created_at', '<', new Date(Date.now() - STATE_TTL_MS)).execute();
    await ps.db
      .insertInto('auth_login_states')
      .values({ state, verifier, nonce, return_to: safeReturnTo(p.returnTo), email: p.email?.trim().toLowerCase() ?? null, org_id: p.orgId, invite: p.invite ?? null })
      .execute();
    const url = await oidc.authorizationUrl({ state, nonce, verifier, ...(p.email ? { loginHint: p.email.trim() } : {}), ...(p.idpHint ? { idpHint: p.idpHint } : {}), ...(p.reauth ? { prompt: 'login' } : {}) });
    return reply.redirect(url, 302);
  }

  /** Identity-first: email -> org by verified domain -> the org's IdP (kc_idp_hint) or Keycloak's local login. */
  app.get<{ Querystring: { email?: string; returnTo?: string; org?: string; idp?: string; reauth?: string } }>('/api/auth/login', { config: { ...pub, rateLimit: { perMinute: LOGIN_PER_MINUTE } } }, async (req, reply) => {
    const q = req.query;
    let orgId: string | null = null;
    let idpHint: string | undefined;
    if (q.idp) {
      const o = await orgForIdp(ps.db, q.idp);
      if (!o) throw badRequest('Unknown identity provider', { idp: 'unknown' });
      idpHint = q.idp;
      orgId = o.org_id;
    } else if (q.email?.includes('@')) {
      const disc = await discovery(q.email);
      if (disc.method === 'sso') idpHint = disc.idpAlias;
      await freeAddress(req, q.email);
      orgId = disc.org?.id ?? null;
    }
    if (q.org && /^[0-9a-f-]{36}$/.test(q.org)) orgId = q.org;
    return startLogin(req, reply, { ...(q.email ? { email: q.email } : {}), ...(q.returnTo ? { returnTo: q.returnTo } : {}), orgId, ...(idpHint ? { idpHint } : {}), reauth: q.reauth === '1' });
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/api/auth/callback', { config: pub }, async (req, reply) => {
    const q = req.query;
    if (q.error) return loginError(reply, q.error, q.error_description ?? 'Sign-in was cancelled or failed.');
    if (!q.code || !q.state) return loginError(reply, 'invalid_request', 'Missing code or state.');
    const st = await ps.db.deleteFrom('auth_login_states').where('state', '=', q.state).returningAll().executeTakeFirst();
    if (!st || st.created_at.getTime() < Date.now() - STATE_TTL_MS) return loginError(reply, 'invalid_state', 'The sign-in request expired; please try again.');
    let tokens;
    let idt: Record<string, unknown>;
    try {
      tokens = await oidc.exchangeCode(q.code, st.verifier);
      if (!tokens.id_token) throw new Error('no ID token');
      idt = await oidc.verifyIdToken(tokens.id_token, st.nonce);
    } catch (e) {
      req.log.warn({ err: e }, 'OIDC code exchange failed');
      return loginError(reply, 'token_error', 'Could not complete sign-in with the identity provider.');
    }
    const claims = claimsOf(idt);
    if (!claims.email) return loginError(reply, 'no_email', 'Your identity provider did not send an email address.');
    // A password login carries no identity_provider claim, even for an account a tenant IdP brokered
    // (its user may add a password in the account console): ask Keycloak where the account came from.
    if (!claims.identityProvider && ps.kc) {
      try {
        claims.brokerOrigins = await brokerOrigins(ps.kc, claims.sub);
      } catch (e) {
        req.log.warn({ err: e }, 'keycloak: could not read the IdP links of a local login; its email is not trusted for this login');
        claims.brokerOrigins = null;
      }
    }
    const invitation = st.invite ? await invitationByHash(st.invite, true) : null;
    const result = await provision(ps.db, claims, { platformIdps: ps.config.platformIdps, preferredOrgId: st.org_id, invitation: invitation ? { orgId: invitation.org_id, email: invitation.email } : null, ip: req.ip });
    if (!result.ok) {
      if (result.reason === 'email_conflict' && claims.identityProvider) await freeAddress(req, claims.email);
      if (result.orgId) {
        await withTenant(ps.db, { orgId: result.orgId }, (tx) => audit(tx, { orgId: result.orgId!, actorId: null, actorName: claims.email, ip: req.ip }, 'auth.login_denied', 'user', claims.sub, { reason: result.reason, idp: claims.identityProvider ?? 'local' }, claims.email)).catch(() => undefined);
      }
      return loginError(reply, result.reason, result.message);
    }
    const s = await store.create({
      userId: result.userId,
      orgId: result.orgId,
      tokens,
      ...(typeof idt.sid === 'string' ? { kcSid: idt.sid } : {}),
      idp: claims.identityProvider ?? 'local',
      ...(typeof idt.auth_time === 'number' ? { authenticatedAt: new Date(idt.auth_time * 1000) } : {}),
      ip: req.ip,
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    });
    store.setCookie(reply, s.token);
    return reply.redirect(`${web}${safeReturnTo(st.return_to)}`, 302);
  });

  app.post('/api/auth/logout', { config: { permission: 'progress.read.self', anyOrg: true } }, async (req, reply): Promise<LogoutResponse> => {
    const sess = req.principal.session;
    let idToken: string | undefined;
    if (sess) {
      const row = await ps.db.selectFrom('auth_sessions').select(['id_token', 'org_id']).where('id_hash', '=', sess.idHash).executeTakeFirst();
      idToken = row?.id_token ?? undefined;
      await store.revoke(sess.idHash);
      if (row?.org_id) await withTenant(ps.db, { orgId: row.org_id, userId: req.principal.sub }, (tx) => audit(tx, { orgId: row.org_id!, actorId: req.principal.sub, actorName: req.principal.name, ip: req.ip }, 'auth.logout', 'user', req.principal.sub)).catch(() => undefined);
    }
    store.clearCookie(reply);
    // A dev sign-in-as session has no Keycloak session to end.
    if (sess?.impersonated) return { redirectUrl: `${web}/` };
    return { redirectUrl: await oidc.endSessionUrl(idToken, `${web}/`) };
  });

  /** OIDC back-channel logout (Keycloak -> gateway): ends the matching gateway sessions. */
  app.post<{ Body: { logout_token?: string } }>('/api/auth/backchannel-logout', { config: pub }, async (req, reply) => {
    const token = req.body?.logout_token;
    if (!token) return reply.code(400).send({ error: 'logout_token required', code: 'invalid' });
    try {
      const t = await oidc.verifyLogoutToken(token);
      const n = await store.revokeKeycloak(t);
      req.log.info({ sid: t.sid, sub: t.sub, revoked: n }, 'back-channel logout');
      return reply.code(200).header('cache-control', 'no-store').send();
    } catch (e) {
      req.log.warn({ err: e }, 'invalid logout token');
      return reply.code(400).send({ error: 'invalid logout token', code: 'invalid' });
    }
  });

  /** Invitation link: resolves the invitation, then identity-first login with the invited email and org. */
  app.get<{ Params: { token: string } }>('/api/auth/invite/:token', { config: { ...pub, rateLimit: { perMinute: LOGIN_PER_MINUTE } } }, async (req, reply) => {
    const hash = createHash('sha256').update(req.params.token).digest('hex');
    const inv = await invitationByHash(hash);
    if (!inv) return loginError(reply, 'invitation_invalid', 'This invitation link is invalid or has expired.');
    // The login state carries the token's hash, binding the invitation to this sign-in.
    const disc = await discovery(inv.email);
    await freeAddress(req, inv.email);
    return startLogin(req, reply, { email: inv.email, orgId: inv.org_id, ...(disc.method === 'sso' && disc.idpAlias ? { idpHint: disc.idpAlias } : {}), invite: hash });
  });

  app.get('/api/me', { config: { permission: 'progress.read.self', anyOrg: true } }, async (req) => ps.me(req.principal));

  app.post<{ Body: SwitchOrgRequest }>('/api/me/org', { config: { permission: 'progress.read.self', anyOrg: true } }, async (req) => {
    const p = req.principal;
    const orgId = req.body?.orgId;
    if (!orgId) throw badRequest('orgId is required', { orgId: 'required' });
    if (!p.session) throw new HttpError(409, 'Org switching needs a signed-in session.', { code: 'conflict' });
    const member = (await membershipsOf(ps.db, p.sub)).find((m) => m.org_id === orgId && m.status === 'active' && m.org_status === 'active');
    if (!member && !p.platformAdmin) throw new HttpError(403, 'You are not a member of that organization.', { code: 'forbidden' });
    const next = await loadPrincipal(ps.db, p.sub, orgId);
    if (!next) throw unauthenticated();
    await store.setOrg(p.session.idHash, orgId);
    await withTenant(ps.db, { orgId, userId: p.sub }, (tx) => audit(tx, { orgId, actorId: p.sub, actorName: p.name, ip: req.ip }, 'org.switch', 'org', orgId, { from: p.orgId || null, supportAccess: !member }));
    return ps.me({ ...next, session: p.session });
  });
}
