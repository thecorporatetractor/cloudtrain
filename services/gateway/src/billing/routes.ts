import type { FastifyInstance } from 'fastify';
import type { BillingLimitRequest, CheckoutRequest, SeatAssignRequest, SeatCountRequest } from '@cloudtrain/api-types';
import { badRequest } from '../errors.js';
import type { BillingService } from './service.js';

/*
 * `/api/billing/*`. The summaries answer even when billing is off (default plan,
 * `enabled: false`); checkout, payment-method setup, portal and seat counts then
 * answer 409. Seats, limits and summaries are tenant data (RLS). The webhook is public
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

  const parseLimit = (body: unknown): BillingLimitRequest => {
    const b = (body ?? {}) as Partial<BillingLimitRequest>;
    if (typeof b.monthlyCap !== 'number' || !Number.isInteger(b.monthlyCap)) throw badRequest('monthlyCap must be a whole number of minor units', { monthlyCap: 'integer' });
    if (typeof b.hardStop !== 'boolean') throw badRequest('hardStop must be true or false', { hardStop: 'boolean' });
    return { monthlyCap: b.monthlyCap, hardStop: b.hardStop };
  };

  app.get('/api/billing/me', self, async (req) => billing.summary(req.principal, 'user'));
  app.post('/api/billing/me/checkout', self, async (req, reply) => reply.code(201).send(await billing.checkout(req.principal, 'user', parseCheckout(req.body), req.ip)));
  app.post('/api/billing/me/payment-method', self, async (req, reply) => reply.code(201).send(await billing.paymentMethod(req.principal, 'user', req.ip)));
  app.post('/api/billing/me/portal', self, async (req) => billing.portal(req.principal, 'user', req.ip));
  app.put('/api/billing/me/limits', self, async (req) => billing.setLimit(req.principal, 'user', parseLimit(req.body), req.ip));

  app.get('/api/billing/org', manage, async (req) => billing.summary(req.principal, 'org'));
  app.get('/api/billing/org/events', manage, async (req) => ({ events: await billing.orgEvents(req.principal) }));
  app.post('/api/billing/org/checkout', manage, async (req, reply) => reply.code(201).send(await billing.checkout(req.principal, 'org', parseCheckout(req.body), req.ip)));
  app.post('/api/billing/org/payment-method', manage, async (req, reply) => reply.code(201).send(await billing.paymentMethod(req.principal, 'org', req.ip)));
  app.post('/api/billing/org/portal', manage, async (req) => billing.portal(req.principal, 'org', req.ip));
  app.put('/api/billing/org/limits', manage, async (req) => billing.setLimit(req.principal, 'org', parseLimit(req.body), req.ip));
  app.get('/api/billing/org/seats', manage, async (req) => billing.seats(req.principal));
  app.put('/api/billing/org/seats', manage, async (req) => {
    const b = (req.body ?? {}) as Partial<SeatCountRequest>;
    if (typeof b.seats !== 'number' || !Number.isInteger(b.seats)) throw badRequest('seats must be an integer', { seats: 'integer' });
    return billing.setSeatCount(req.principal, b.seats, req.ip);
  });
  app.post('/api/billing/org/seats/assign', manage, async (req) => {
    const b = (req.body ?? {}) as Partial<SeatAssignRequest>;
    if (typeof b.userId !== 'string' || !b.userId) throw badRequest('userId is required', { userId: 'required' });
    return billing.assignSeat(req.principal, b.userId, req.ip);
  });
  app.delete<{ Params: { userId: string } }>('/api/billing/org/seats/:userId', manage, async (req) => billing.unassignSeat(req.principal, req.params.userId, req.ip));

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
