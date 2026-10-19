import type { FastifyInstance } from 'fastify';
import type { CheckoutRequest } from '@cloudtrain/api-types';
import { badRequest } from '../errors.js';
import type { BillingService } from './service.js';

/*
 * `/api/billing/*`. The summaries answer even when billing is off (default plan,
 * `enabled: false`); checkout and portal then answer 409. The webhook is public
 * (Stripe signs it) and registered only when billing is on; it lives in its own
 * plugin scope with a raw-body parser, because signature verification needs the
 * exact bytes Stripe sent and the app parses JSON everywhere else.
 */
export function registerBillingRoutes(app: FastifyInstance, billing: BillingService): void {
  const self = { config: { permission: 'progress.read.self' as const } };
  const manage = { config: { permission: 'billing.manage' as const } };

  const parseCheckout = (body: unknown): CheckoutRequest => {
    const b = (body ?? {}) as Partial<CheckoutRequest>;
    if (typeof b.planId !== 'string' || !b.planId) throw badRequest('planId is required', { planId: 'required' });
    if (b.interval !== 'monthly' && b.interval !== 'yearly') throw badRequest('interval must be monthly or yearly', { interval: 'monthly or yearly' });
    if (b.seats !== undefined && (typeof b.seats !== 'number' || !Number.isInteger(b.seats))) throw badRequest('seats must be an integer', { seats: 'integer' });
    return { planId: b.planId, interval: b.interval, ...(b.seats !== undefined ? { seats: b.seats } : {}) };
  };

  app.get('/api/billing/me', self, async (req) => billing.summary(req.principal, 'user'));
  app.post('/api/billing/me/checkout', self, async (req, reply) => reply.code(201).send(await billing.checkout(req.principal, 'user', parseCheckout(req.body), req.ip)));
  app.post('/api/billing/me/portal', self, async (req) => billing.portal(req.principal, 'user', req.ip));

  app.get('/api/billing/org', manage, async (req) => billing.summary(req.principal, 'org'));
  app.get('/api/billing/org/events', manage, async (req) => ({ events: await billing.orgEvents(req.principal) }));
  app.post('/api/billing/org/checkout', manage, async (req, reply) => reply.code(201).send(await billing.checkout(req.principal, 'org', parseCheckout(req.body), req.ip)));
  app.post('/api/billing/org/portal', manage, async (req) => billing.portal(req.principal, 'org', req.ip));

  if (billing.enabled) {
    void app.register(async (scope) => {
      scope.removeContentTypeParser('application/json');
      scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
      scope.post<{ Body: Buffer }>('/api/billing/webhook', { config: { public: true } }, async (req) => {
        const r = await billing.webhook(req.body ?? Buffer.alloc(0), req.headers['stripe-signature'] as string | undefined);
        return { received: true, ...r };
      });
    });
  }
}
