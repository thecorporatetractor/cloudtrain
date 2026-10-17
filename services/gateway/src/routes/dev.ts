import { sql } from 'kysely';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Me } from '@cloudtrain/api-types';
import { isLoopbackUrl } from '../config.js';
import { withTenant } from '../db/index.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import type { SessionStore } from '../oidc/sessions.js';
import { audit } from '../platform/audit.js';
import { loadPrincipal, membershipsOf } from '../platform/identity.js';
import type { PlatformService } from '../platform/service.js';

/*
 * DEV ONLY: "sign in as" an existing user, so automated agents (screenshots,
 * smoke tests) see the app as a real user, including Entra-brokered users whose
 * real login needs MFA. Registered only when CT_DEV_IMPERSONATE=1, which
 * loadConfig refuses with NODE_ENV=production or a non-loopback public/web URL.
 *
 * It creates an ordinary gateway session (same cookie, same CSRF token) for a
 * user that already exists in Postgres, in an org where the user already has an
 * active membership. It never creates users, memberships or roles, and never
 * talks to Keycloak or Entra: roles, teams and platform_admin come from the
 * database exactly as for a real session. See docs/dev-environment.md.
 */

export const DEV_IMPERSONATION_ACTOR = 'dev-impersonation';

export interface DevSignInAsRequest {
  email?: string;
  userId?: string;
  orgId?: string;
}

/** 127.0.0.0/8 and ::1 (also IPv4-mapped). */
export function isLoopbackAddress(a: string | undefined): boolean {
  if (!a) return false;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

const forbiddenLocal = (why: string) => new HttpError(403, `Dev sign-in-as is only accepted from this machine (${why}).`, { code: 'forbidden' });

/**
 * Loopback only, judged on the TCP peer (never X-Forwarded-For), plus browser
 * guards: a page on another site cannot drive it (Origin / Sec-Fetch-Site), and
 * a DNS-rebound name is refused (Host).
 */
function assertLocalCaller(req: FastifyRequest): void {
  if (!isLoopbackAddress(req.raw.socket.remoteAddress)) throw forbiddenLocal('remote address is not loopback');
  const host = req.headers.host ?? '';
  if (!isLoopbackUrl(`http://${host}`)) throw forbiddenLocal('Host is not localhost');
  const origin = req.headers.origin;
  if (origin !== undefined && !isLoopbackUrl(origin)) throw forbiddenLocal('cross-origin request');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw forbiddenLocal('cross-site request');
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send a JSON body (content-type: application/json).', { code: 'invalid' });
}

export function registerDevImpersonation(app: FastifyInstance, d: { ps: PlatformService; store: SessionStore }): void {
  if (process.env.NODE_ENV === 'production') throw new Error('dev sign-in-as must never be registered with NODE_ENV=production');
  const { ps, store } = d;

  app.post<{ Body: DevSignInAsRequest }>('/api/dev/sign-in-as', { config: { public: true } }, async (req, reply): Promise<Me> => {
    assertLocalCaller(req);
    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const byId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!email && !byId) throw badRequest('email or userId is required', { email: 'required' });
    if (body.orgId !== undefined && (typeof body.orgId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.orgId))) throw badRequest('orgId must be an org id', { orgId: 'invalid' });

    // Look the user up; never create one.
    const userId = email
      ? (await sql<{ id: string }>`SELECT id FROM auth_user_by_email(${email})`.execute(ps.db)).rows[0]?.id
      : await withTenant(ps.db, { userId: byId, orgId: null }, async (tx) => (await tx.selectFrom('users').select('id').where('id', '=', byId).executeTakeFirst())?.id);
    if (!userId) throw notFound('User');

    // The org: one where the user already has an active membership (platform admins may enter any org, as with /me/org).
    const base = await loadPrincipal(ps.db, userId, null);
    const platformAdmin = base?.platformAdmin ?? false;
    const active = (await membershipsOf(ps.db, userId)).filter((m) => m.status === 'active' && m.org_status === 'active');
    let orgId: string | null;
    if (body.orgId) {
      if (!active.some((m) => m.org_id === body.orgId) && !platformAdmin) throw new HttpError(403, 'That user has no active membership in that organization.', { code: 'forbidden' });
      orgId = body.orgId;
    } else {
      orgId = active[0]?.org_id ?? null;
    }
    const principal = await loadPrincipal(ps.db, userId, orgId);
    if (!principal) throw new HttpError(403, 'That user has no active membership in any organization.', { code: 'forbidden' });

    const peer = req.raw.socket.remoteAddress;
    const s = await store.create({
      userId,
      orgId,
      tokens: { access_token: '' }, // none: no IdP behind this session
      impersonated: true,
      ...(peer ? { ip: peer } : {}),
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
    });
    const details = { orgId, email: principal.email, roles: principal.roles, platformAdmin: principal.platformAdmin };
    if (orgId) {
      await withTenant(ps.db, { orgId, userId }, (tx) => audit(tx, { orgId, actorId: null, actorName: DEV_IMPERSONATION_ACTOR, ip: peer }, 'auth.dev_impersonate', 'user', userId, details, principal.email));
    }
    req.log.warn({ userId, ...details, audited: !!orgId }, 'DEV sign-in-as: impersonated session created');

    store.setCookie(reply, s.token);
    const row = await store.get(s.token);
    return ps.me({ ...principal, session: { idHash: row!.id_hash, csrf: s.csrf, expiresAt: row!.expires_at.toISOString(), method: 'dev-impersonation', impersonated: true } });
  });
}
