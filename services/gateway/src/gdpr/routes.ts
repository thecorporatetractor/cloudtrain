import type { FastifyInstance } from 'fastify';
import type { AccountDeleteRequest, PrivacyAccepted, PrivacyConfirmRequest, PublicPrivacyRequest, PublicPrivacyRequestType } from '@cloudtrain/api-types';
import { HttpError, badRequest } from '../errors.js';
import type { SessionStore } from '../oidc/sessions.js';
import { RateLimiter } from '../routes/public.js';
import { honeypotTripped, isEmail } from '../waitlist/validate.js';
import type { GdprService } from './service.js';

/*
 * POST /api/public/privacy/requests   no sign-in: asks for a confirmation link. Same answer for every address.
 * POST /api/public/privacy/confirm    no sign-in: the token from that link performs the request.
 * GET  /api/me/privacy                the Privacy section: what can be done, what would block it.
 * POST /api/me/privacy/export         a JSON download of everything held about the caller.
 * POST /api/me/privacy/notice         the first-sign-in information notice was shown.
 * POST /api/me/privacy/withdraw       withdraws consent (the waitlist entry).
 * POST /api/me/privacy/delete         erases the caller's account.
 * PUT, DELETE /api/me/privacy/restriction  restricts processing (Art. 18), lifts it.
 * POST /api/me/privacy/objection       raises an objection (Art. 21) with the privacy inbox.
 * POST /api/me/privacy/close          closes the account: no access now, erasure after the grace period.
 * GET  /api/platform/privacy/requests platform admins: completed requests, no identifiers.
 * POST /api/platform/privacy/erase     platform admins: erases someone without an active membership.
 * POST /api/platform/privacy/reopen    platform admins: reopens a closed account.
 */

export interface GdprRouteDeps {
  gdpr: GdprService;
  store?: SessionStore;
  /** Requests for a link per client address per hour (default 10), as the waitlist form. */
  perHour?: number;
  now?: () => number;
}

const TYPES: readonly PublicPrivacyRequestType[] = ['erasure', 'withdrawal', 'export'];
const ACCEPTED: PrivacyAccepted = { status: 'accepted', message: 'If this address can receive email, a confirmation link is on its way. It works once and expires after a day.' };

export function registerGdprRoutes(app: FastifyInstance, deps: GdprRouteDeps): void {
  const { gdpr } = deps;
  const limiter = new RateLimiter(Math.max(1, deps.perHour ?? 10), deps.now, 3_600_000);
  const confirmLimiter = new RateLimiter(30, deps.now, 3_600_000);
  const accountLimiter = new RateLimiter(10, deps.now, 3_600_000);
  const adminLimiter = new RateLimiter(120, deps.now, 3_600_000);

  const take = (l: RateLimiter, key: string) => {
    if (!l.take(key)) throw new HttpError(429, 'Too many requests, try again later', { code: 'rate_limited', details: { retryAfterSeconds: l.resetIn(key) } });
  };

  app.post<{ Body: unknown }>('/api/public/privacy/requests', { config: { public: true }, bodyLimit: 8 * 1024 }, async (req, reply) => {
    take(limiter, req.ip);
    reply.header('cache-control', 'no-store');
    if (honeypotTripped(req.body)) return reply.code(202).send(ACCEPTED);
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Partial<PublicPrivacyRequest>;
    const fields: Record<string, string> = {};
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    if (!email) fields.email = 'Enter your email address';
    else if (!isEmail(email)) fields.email = 'Enter a valid email address';
    if (!TYPES.includes(b.type as PublicPrivacyRequestType)) fields.type = 'Choose what you would like us to do';
    if (Object.keys(fields).length) throw badRequest('Check the highlighted fields', { fields });
    await gdpr.requestPublic(email, b.type as PublicPrivacyRequestType);
    return reply.code(202).send(ACCEPTED);
  });

  app.post<{ Body: unknown }>('/api/public/privacy/confirm', { config: { public: true }, bodyLimit: 2 * 1024 }, async (req, reply) => {
    take(confirmLimiter, req.ip);
    reply.header('cache-control', 'no-store');
    const { pending, body } = await gdpr.confirmPublic(((req.body ?? {}) as Partial<PrivacyConfirmRequest>).token);
    return reply.code(pending ? 202 : 200).send(body);
  });

  const self = { config: { permission: 'progress.read.self' as const, anyOrg: true } };

  app.get('/api/me/privacy', self, async (req) => gdpr.summary(req.principal));

  app.post('/api/me/privacy/export', self, async (req, reply) => {
    take(accountLimiter, `export:${req.principal.sub}`);
    const data = await gdpr.exportAccount(req.principal);
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', 'attachment; filename="cloudtrain-my-data.json"').send(JSON.stringify(data, null, 2));
  });

  app.post('/api/me/privacy/withdraw', self, async (req, reply) => {
    take(accountLimiter, `withdraw:${req.principal.sub}`);
    const r = await gdpr.withdrawConsent(req.principal);
    return reply.code(r.status === 'completed' ? 200 : 202).send(r);
  });

  app.post<{ Body: { version?: unknown } }>('/api/me/privacy/notice', self, async (req, reply) => {
    await gdpr.acknowledgeNotice(req.principal, req.body?.version);
    return reply.code(204).send();
  });

  app.put('/api/me/privacy/restriction', self, async (req) => {
    take(accountLimiter, `restrict:${req.principal.sub}`);
    return gdpr.setRestriction(req.principal, true);
  });
  app.delete('/api/me/privacy/restriction', self, async (req) => {
    take(accountLimiter, `restrict:${req.principal.sub}`);
    return gdpr.setRestriction(req.principal, false);
  });

  app.post<{ Body: { processing?: unknown; note?: unknown } }>('/api/me/privacy/objection', { ...self, bodyLimit: 8 * 1024 }, async (req, reply) => {
    take(accountLimiter, `object:${req.principal.sub}`);
    return reply.code(202).send(await gdpr.object(req.principal, req.body));
  });

  app.post<{ Body: AccountDeleteRequest }>('/api/me/privacy/delete', self, async (req, reply) => {
    take(accountLimiter, `delete:${req.principal.sub}`);
    const r = await gdpr.deleteAccount(req.principal, req.body?.confirmEmail);
    deps.store?.clearCookie(reply); // The account's sessions are gone either way.
    return reply.code(r.status === 'completed' ? 200 : 202).send(r);
  });

  app.post<{ Body: AccountDeleteRequest }>('/api/me/privacy/close', self, async (req, reply) => {
    take(accountLimiter, `close:${req.principal.sub}`);
    const r = await gdpr.closeAccount(req.principal, req.body?.confirmEmail);
    deps.store?.clearCookie(reply);
    return r;
  });

  const platformOnly = { config: { permission: 'org.manage' as const, anyOrg: true } };
  app.post<{ Body: { email?: unknown; confirmEmail?: unknown } }>('/api/platform/privacy/erase', platformOnly, async (req, reply) => {
    take(adminLimiter, `admin:${req.principal.sub}`);
    const r = await gdpr.adminErase(req.principal, req.body);
    return reply.code(r.status === 'completed' ? 200 : 202).send(r);
  });
  app.post<{ Body: { email?: unknown } }>('/api/platform/privacy/reopen', platformOnly, async (req) => {
    take(adminLimiter, `admin:${req.principal.sub}`);
    return gdpr.reopenAccount(req.principal, req.body?.email);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/platform/privacy/requests', { config: { permission: 'org.manage', anyOrg: true } }, async (req) => {
    take(adminLimiter, `admin:${req.principal.sub}`);
    return gdpr.ledgerView(req.principal, Math.min(500, Math.max(1, Number.parseInt(req.query.limit ?? '', 10) || 100)));
  });
}
