import type { FastifyInstance } from 'fastify';
import type { SiteConfig, WaitlistEntry, WaitlistResponse } from '@cloudtrain/api-types';
import { authorize } from '../authz.js';
import { HttpError } from '../errors.js';
import { RateLimiter } from '../routes/public.js';
import type { WaitlistStore } from './store.js';
import { csvCell, honeypotTripped, validateWaitlist } from './validate.js';

/*
 * The early-access waitlist.
 *
 * POST /api/public/waitlist   unauthenticated; validated against site.yaml
 *                             `waitlist`, rate limited per client address, with a
 *                             honeypot field. No email is sent, no third party is called.
 * GET  /api/platform/waitlist       platform admins: the entries as JSON
 * GET  /api/platform/waitlist.csv   platform admins: the same as a CSV download
 */

export interface WaitlistDeps {
  site: SiteConfig;
  /** Absent: the endpoint answers 503 (no database behind this gateway). */
  store?: WaitlistStore;
  /** Submissions per client address per hour (default 10). */
  perHour?: number;
  now?: () => number;
}

const MAX_EXPORT = 10_000;
export const CSV_HEADER = 'email,organisation,role,interest,consent_at,created_at';

export function waitlistCsv(entries: WaitlistEntry[]): string {
  const rows = entries.map((e) => [e.email, e.organisation, e.role, e.interest, e.consentAt, e.createdAt].map(csvCell).join(','));
  return [CSV_HEADER, ...rows].join('\r\n') + '\r\n';
}

export function registerWaitlistRoutes(app: FastifyInstance, deps: WaitlistDeps): void {
  const cfg = deps.site.waitlist;
  const perHour = Math.max(1, deps.perHour ?? 10);
  const limiter = new RateLimiter(perHour, deps.now, 3_600_000);

  if (cfg?.enabled) {
    app.post<{ Body: unknown }>('/api/public/waitlist', { config: { public: true }, bodyLimit: 8 * 1024 }, async (req, reply) => {
      if (!limiter.take(req.ip)) {
        throw new HttpError(429, 'Too many requests, try again later', { code: 'rate_limited', details: { retryAfterSeconds: limiter.resetIn(req.ip) } });
      }
      reply.header('cache-control', 'no-store');
      // The honeypot: a bot that filled the hidden field is told it worked and nothing is stored.
      if (honeypotTripped(req.body)) return reply.code(201).send({ status: 'created' } satisfies WaitlistResponse);
      const input = validateWaitlist(req.body, cfg);
      if (!deps.store) throw new HttpError(503, 'The waitlist is not available right now', { code: 'upstream' });
      const created = await deps.store.add(input, new Date(deps.now?.() ?? Date.now()));
      return reply.code(created ? 201 : 200).send({ status: created ? 'created' : 'duplicate' } satisfies WaitlistResponse);
    });
  }

  if (!deps.store) return;
  const store = deps.store;
  const admin = { config: { permission: 'org.manage' as const, anyOrg: true } };
  const limitOf = (q: { limit?: string }) => Math.min(MAX_EXPORT, Math.max(1, Number.parseInt(q.limit ?? '', 10) || MAX_EXPORT));

  app.get<{ Querystring: { limit?: string } }>('/api/platform/waitlist', admin, async (req) => {
    authorize(req.principal, 'org.manage', { kind: 'platform' });
    return store.list(limitOf(req.query));
  });
  app.get<{ Querystring: { limit?: string } }>('/api/platform/waitlist.csv', admin, async (req, reply) => {
    authorize(req.principal, 'org.manage', { kind: 'platform' });
    const { entries } = await store.list(limitOf(req.query));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="waitlist.csv"').send(waitlistCsv(entries));
  });
}
