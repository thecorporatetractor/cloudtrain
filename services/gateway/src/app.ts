import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { Lab, SiteConfig } from '@cloudtrain/api-types';
import type { Authenticator } from './auth.js';
import type { TrustProxy } from './config.js';
import { can, forbidden } from './authz.js';
import type { Content } from './content/load.js';
import { learnerLab } from './content/view.js';
import { HttpError, notFound } from './errors.js';
import type { ClusterInfo } from './kube/capacity.js';
import type { LabCluster } from './kube/cluster.js';
import { learnerOf, sampleHome, sampleSkillStates } from './learner/sample.js';
import type { OidcClient } from './oidc/client.js';
import { CSRF_HEADER, csrfMatches, type SessionStore } from './oidc/sessions.js';
import { endObserve, startObserve } from './platform/cohorts.js';
import type { PlatformService } from './platform/service.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDevImpersonation } from './routes/dev.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerBillingRoutes } from './billing/routes.js';
import type { BillingService, StartDecision } from './billing/service.js';
import type { WaitlistStore } from './waitlist/store.js';
import { registerWaitlistRoutes } from './waitlist/routes.js';
import type { SessionService } from './sessions/service.js';
import { bridge, clampSize, send } from './terminal/bridge.js';
import { TerminalHub } from './terminal/hub.js';
import { planTerminal } from './terminal/target.js';
import { registerExamRoutes } from './exams/routes.js';
import type { ExamService } from './exams/service.js';
import type { ExamCatalog } from './exams/catalog.js';
import { registerAnswerRoutes } from './answers/routes.js';
import type { AnswerService } from './answers/service.js';
import { registerEventRoutes } from './events/routes.js';
import type { EventService } from './events/service.js';
import { registerGdprRoutes } from './gdpr/routes.js';
import type { GdprService } from './gdpr/service.js';
import { usageEnd } from './sessions/usage.js';

export interface AppDeps {
  content: Content;
  auth: Authenticator;
  sessions: SessionService;
  cluster: LabCluster;
  /** Exam simulations (`/api/exams/*`); omitted = not served. */
  exams?: ExamService;
  /** Questions of CTF labs (`/api/sessions/:id/questions*`); omitted = not served. */
  answers?: AnswerService;
  /** CTF events (`/api/events*`; needs the platform database); omitted = not served. */
  events?: EventService;
  logger?: boolean | { level: string };
  /** Postgres-backed platform (identity, persistence, admin). Without it the gateway serves labs/sessions with sample learner data. */
  platform?: PlatformService;
  /** OIDC BFF login routes (needs `platform`). */
  oidc?: { client: OidcClient; store: SessionStore };
  clusterInfo?: ClusterInfo | null;
  hub?: TerminalHub;
  /** DEV ONLY: `POST /api/dev/sign-in-as` (CT_DEV_IMPERSONATE=1; needs `platform` and `oidc`). Absent = not registered. */
  devImpersonate?: boolean;
  /** Fastify trustProxy (CT_TRUST_PROXY); default loopback. */
  trustProxy?: TrustProxy;
  /**
   * Web origins allowed to call /api cross-origin with cookies (CT_CORS_ORIGINS), for a
   * web app served from another same-site origin. Empty (default) = same-origin only.
   */
  corsOrigins?: string[];
  /**
   * The app's own URLs (CT_WEB_URL, CT_PUBLIC_URL): their origins may open terminal WebSockets.
   * Given apart from `platform`, so a gateway without the platform database (labs-only dev,
   * the web app on Vite's :5173 behind a proxy that rewrites Host) still accepts its own app.
   */
  appUrls?: string[];
  /** Readiness checks for GET /readyz (e.g. Postgres); each resolves or throws. */
  readiness?: Record<string, () => Promise<unknown>>;
  /**
   * The public website (`/api/public/*`, no sign-in): site configuration plus the read-only
   * catalog from content/ and the exam catalog. Omitted = not served.
   */
  site?: { config: SiteConfig; exams?: ExamCatalog; ratePerMinute?: number; waitlist?: { store?: WaitlistStore; perHour?: number } };
  /** Plans, entitlements and Stripe (test mode) under `/api/billing/*`; omitted = not served. */
  billing?: BillingService;
  /** Data-subject rights (`/api/public/privacy/*`, `/api/me/privacy*`); omitted = not served. */
  gdpr?: { service: GdprService; perHour?: number };
}

/** Each readiness check must answer within this time, or the pod reports not ready. */
export const READINESS_TIMEOUT_MS = 2_000;

/** Runs every readiness check with a timeout; ok only when all of them pass. */
export async function runReadiness(checks: Record<string, () => Promise<unknown>>, timeoutMs = READINESS_TIMEOUT_MS): Promise<{ ok: boolean; checks: Record<string, 'ok' | string> }> {
  const out: Record<string, 'ok' | string> = {};
  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([check(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)))]);
        out[name] = 'ok';
      } catch (e) {
        out[name] = (e as Error).message || 'failed';
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return { ok: Object.values(out).every((v) => v === 'ok'), checks: out };
}

/** onRoute hook: an /api route without `config.permission` or `config.public` is a startup error. */
export function requireDeclaredPermission(r: { url: string; method: string | string[]; config?: unknown }): void {
  const cfg = (r.config ?? {}) as { permission?: string; public?: boolean };
  if (r.url.startsWith('/api/') && !cfg.permission && !cfg.public) throw new Error(`route ${String(r.method)} ${r.url} declares no permission`);
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether the request matched an /api route. Decided on the matched route pattern, never the raw
 * URL: the router decodes percent-escapes, so `/%61pi/me` reaches the `/api/me` route while
 * `req.url` does not start with `/api/`.
 */
const isApiRoute = (req: FastifyRequest): boolean => (req.routeOptions.url ?? '').startsWith('/api/');

/**
 * The gateway's HTTP surface: the paths and shapes apps/web uses (see
 * packages/api-types and docs/api/platform.md). Every /api route declares
 * the permission it needs (`config.permission`) or is explicitly public;
 * a route without either fails closed.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { content, auth, sessions, cluster, platform: ps } = deps;
  // Labs ended by an instructor, admin or offboarding are metered like the learner's own end.
  if (ps && deps.billing) {
    const billing = deps.billing;
    ps.labEnded = (orgId, ls) => billing.meterEnd(orgId, ls.metadata.name, usageEnd(ls, billing.now().getTime()));
  }
  const hub = deps.hub ?? new TerminalHub();
  // Request ids are unique across replicas and restarts: a client quotes one from an error, the log has it.
  const options: FastifyServerOptions = { logger: deps.logger ?? false, trustProxy: deps.trustProxy ?? '127.0.0.1', genReqId: () => randomUUID() };
  const app: FastifyInstance = Fastify(options);
  // Fail at startup, not at request time: every /api route must declare a permission or be public.
  app.addHook('onRoute', requireDeclaredPermission);
  // Every response is per-user API data or a download: never sniffed, never cached.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
  const cors = new Set(deps.corsOrigins ?? []);
  if (cors.size) {
    // Credentialed CORS for the listed origins only (never a wildcard). The CSRF header
    // still applies; SameSite=Lax cookies only flow between same-site origins.
    // The allowed value is the configured origin itself, never the request header.
    const allowed = (origin: string | undefined) => [...cors].find((o) => o === origin);
    app.addHook('onRequest', async (req, reply) => {
      const origin = allowed(req.headers.origin);
      if (!origin || !isApiRoute(req)) return;
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
    });
    app.options('/api/*', { config: { public: true } }, async (req, reply) => {
      if (!allowed(req.headers.origin)) return reply.code(403).send({ error: 'Origin not allowed', code: 'forbidden' });
      reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
      reply.header('access-control-allow-headers', `content-type, ${CSRF_HEADER}`);
      reply.header('access-control-max-age', '600');
      return reply.code(204).send();
    });
  }
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });
  // Cross-site WebSocket hijacking: a browser sends the cookie with a WebSocket upgrade from any
  // page of the same site (a sibling subdomain included), and CORS does not apply to WebSockets.
  // Only the app's own origins may open one: the request's own host, the web and public URLs and
  // CT_CORS_ORIGINS. A client without an Origin header is not a browser page.
  const wsOrigins = new Set([...cors, ...[...(deps.appUrls ?? []), ps?.config.webUrl, ps?.config.publicUrl].flatMap((u) => (u ? [originOf(u)] : []))]);
  // After the websocket plugin: its own onRequest hook must have run for a refused upgrade's socket to be closed.
  // Every upgrade is checked whatever its path: the router decodes percent-escapes (`/%61pi/...`
  // matches `/api/...`), so a test on the raw URL would let a disguised path through.
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.upgrade?.toLowerCase() !== 'websocket') return;
    const origin = req.headers.origin;
    if (origin === undefined || wsOriginAllowed(origin, req.headers.host, wsOrigins)) return;
    req.log.warn({ origin, url: req.url }, 'WebSocket from a foreign origin refused');
    return reply.code(403).send({ error: 'Origin not allowed', code: 'forbidden' });
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));

  // The web client sends content-type: application/json on body-less POSTs; treat an empty body as none.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, 'Invalid JSON body'), undefined);
    }
  });

  const labViews = new Map<string, Lab>(Array.from(content.labs.values(), (l) => [l.lab.metadata.id, learnerLab(l.lab)]));

  app.decorateRequest('principal', null as never);
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiRoute(req)) return; // unknown routes: 404 below
    const cfg = req.routeOptions.config ?? {};
    if (cfg.public) return;
    const p = await auth.authenticate(req);
    if (!p) return reply.code(401).send({ error: 'Not signed in', code: 'unauthenticated' });
    req.principal = p;
    if (auth.csrf && UNSAFE.has(req.method) && !csrfMatches(p.session?.csrf ?? '', req.headers[CSRF_HEADER])) {
      return reply.code(403).send({ error: 'Missing or invalid CSRF token', code: 'csrf' });
    }
    if (!cfg.permission) {
      req.log.error({ route: req.routeOptions.url }, 'route declares no permission');
      return reply.code(500).send({ error: 'Route has no permission declared', code: 'forbidden' });
    }
    if (!can(p, cfg.permission)) return reply.code(403).send(forbidden(cfg.permission).body());
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found', code: 'not_found' }));

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      const retry = err.extra.details?.retryAfterSeconds;
      if (err.status === 429 && typeof retry === 'number') reply.header('retry-after', String(retry));
      return reply.code(err.status).send(err.body());
    }
    // Only Fastify's own client errors (body too large, unsupported media type, schema
    // validation) keep their message: it describes the request. A dependency's error that
    // happens to carry a 4xx statusCode (an Azure RestError, say) is internal like any other.
    const e = err as { statusCode?: number; message?: string; code?: unknown; validation?: unknown };
    if (e.statusCode && e.statusCode < 500 && ((typeof e.code === 'string' && e.code.startsWith('FST_')) || e.validation)) return reply.code(e.statusCode).send({ error: e.message ?? 'Bad request' });
    // Anything else is ours or a dependency's (Postgres, Kubernetes, Keycloak, labctl): its text
    // can carry internals, so it goes to the log under the request id and the client gets the id.
    req.log.error({ err, reqId: req.id }, 'request failed');
    return reply.code(502).send({ error: `Something went wrong on our side. Reference: ${req.id}`, code: 'upstream', requestId: req.id });
  });

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true, labs: content.labs.size, contentIssues: content.issues.length, platform: !!ps }));
  // Kubernetes probes, outside /api so the Ingress/HTTPRoute (which routes /api only) never
  // exposes them. Liveness: the process answers. Readiness: content loaded and every
  // dependency check (Postgres) passes; the response names each check and says ok or failed
  // (the error text is logged).
  app.get('/healthz', { config: { public: true }, logLevel: 'warn' }, async () => ({ ok: true }));
  app.get('/readyz', { config: { public: true }, logLevel: 'warn' }, async (req, reply) => {
    const loaded = async () => {
      if (content.labs.size === 0) throw new Error('no labs loaded');
    };
    const r = await runReadiness({ content: loaded, ...(deps.readiness ?? {}) });
    if (r.ok) return reply.send(r);
    // A dependency's error text (a Postgres address, a role name) goes to the log, not the response.
    req.log.warn({ checks: r.checks }, 'not ready');
    return reply.code(503).send({ ok: false, checks: Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, v === 'ok' ? 'ok' : 'failed'])) });
  });

  const run = { config: { permission: 'lab.run' as const } };
  const self = { config: { permission: 'progress.read.self' as const } };

  /* ---------------------------- identity / learner --------------------------- */

  if (deps.oidc && ps) registerAuthRoutes(app, { ps, oidc: deps.oidc.client, store: deps.oidc.store });
  else if (ps) app.get('/api/me', { config: { permission: 'progress.read.self', anyOrg: true } }, async (req) => ps.me(req.principal));
  else app.get('/api/me', self, async (req) => learnerOf(req.principal));
  if (deps.devImpersonate) {
    if (!deps.oidc || !ps) throw new Error('dev sign-in-as needs the platform database and gateway sessions');
    registerDevImpersonation(app, { ps, store: deps.oidc.store });
  }
  app.get('/api/home', self, async (req) => (ps ? ps.home(req.principal) : sampleHome(content, req.principal)));

  /* --------------------------------- catalog --------------------------------- */

  app.get('/api/catalog', run, async (req) => {
    const catalog = ps ? await ps.catalog(req.principal) : { domains: content.domains, paths: content.paths, labs: content.summaries };
    return deps.billing ? deps.billing.annotateCatalog(req.principal, catalog) : catalog;
  });

  app.get<{ Params: { id: string } }>('/api/labs/:id', run, async (req) => {
    const lab = labViews.get(req.params.id);
    if (!lab) throw notFound('Lab');
    await ps?.assertLabVisible(req.principal, req.params.id);
    return deps.billing ? deps.billing.annotateLab(req.principal, lab) : lab;
  });

  app.get<{ Querystring: { member?: string } }>('/api/skills', self, async (req) => {
    if (ps) return ps.skills(req.principal, req.query.member);
    const member = req.query.member;
    const who = member || req.principal.sub;
    const body = { skills: content.skills, states: sampleSkillStates(content, who), frameworks: content.frameworks };
    if (member && member !== req.principal.sub) return { ...body, member: { id: member, name: member, title: 'Team member (sample data)' } };
    return body;
  });

  /* --------------------------------- sessions -------------------------------- */

  // Billing gate (premium plan, free trial, payment method, dunning, spend cap, plan limits;
  // 402 when CT_BILLING_ENFORCE is on) and metering from the start, on every path that starts
  // a lab session: here and CTF event labs (src/billing). Exams: registerExamRoutes.
  if (deps.billing) {
    const billing = deps.billing;
    sessions.billing = {
      gate: (p, labId, kind, name) => billing.assertLabStart(p, labId, kind, name),
      // Confirms the gate's reservation now that the session exists, retried; if it still fails,
      // the sweep confirms it (the session runs, the row stays open and is billed either way).
      metered: async (p, decision, s) => {
        for (let attempt = 1; ; attempt++) {
          try {
            if (!(await billing.meterStart(p, decision as StartDecision | undefined, s))) app.log.error({ session: s.id }, 'billing: no usage row to confirm for a started session');
            return;
          } catch (e) {
            if (attempt >= 3) return void app.log.error({ err: e, session: s.id }, 'billing: could not confirm usage start; the sweep confirms it');
            await new Promise((r) => setTimeout(r, 200 * attempt));
          }
        }
      },
      confirm: (p, name) => billing.confirmSession(p, name).then(() => undefined, (e: unknown) => app.log.error({ err: e, session: name }, 'billing: could not confirm a reattached session; the sweep confirms it')),
      // A release that fails leaves an orphan reservation: the sweep (or the person's next start) closes it unbilled after START_TIMEOUT_MS.
      release: (p, decision) =>
        billing.release(p, decision as StartDecision | undefined).catch((e: unknown) => app.log.error({ err: e, session: (decision as StartDecision | undefined)?.sessionName }, 'billing: could not release a failed start; the sweep closes it unbilled')),
    };
  }

  app.post<{ Params: { id: string } }>('/api/labs/:id/sessions', run, async (req, reply) => {
    // Starting a lab that already runs for this person reattaches to it (200): one environment, metered once.
    const live = await sessions.live(req.principal, req.params.id);
    if (live) return reply.code(200).send(live);
    return reply.code(201).send(await sessions.start(req.principal, req.params.id));
  });
  app.get<{ Params: { id: string } }>('/api/labs/:id/sessions', run, async (req) => {
    if (!content.labs.has(req.params.id)) throw notFound('Lab');
    return sessions.list(req.principal, req.params.id);
  });
  app.get('/api/sessions', run, async (req) => sessions.list(req.principal));
  // serverTime: the client anchors its countdown to the gateway's clock, not the browser's.
  app.get<{ Params: { id: string } }>('/api/sessions/:id', run, async (req) => ({ ...(await sessions.get(req.principal, req.params.id)), serverTime: new Date().toISOString() }));
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', run, async (req, reply) => {
    const ended = await sessions.end(req.principal, req.params.id);
    // Billed from the first Ready up to now (at most until expiry); a lab that never became ready is free.
    const billing = deps.billing;
    if (req.principal.orgId && billing) await billing.meterEnd(req.principal.orgId, req.params.id, usageEnd(ended, billing.now().getTime())).catch((e: unknown) => req.log.error({ err: e, session: req.params.id }, 'billing: could not record usage end'));
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/sessions/:id/validate', run, async (req) => sessions.validate(req.principal, req.params.id));
  app.post<{ Params: { id: string; index: string } }>('/api/sessions/:id/hints/:index', run, async (req) => sessions.revealHint(req.principal, req.params.id, Number(req.params.index)));

  /* --------------------------------- terminal -------------------------------- */

  app.get<{ Params: { id: string }; Querystring: { node?: string; cols?: string; rows?: string; observe?: string } }>('/api/sessions/:id/terminal', { websocket: true, ...run }, (socket, req) => {
    const id = req.params.id;
    if (req.query.observe === '1' || req.query.observe === 'true') {
      // Read-only shadow of the learner's terminal: authorized as session.observe on the learner (cohort/org), audited, announced.
      if (!ps) {
        send(socket, { t: 'error', m: 'Observing needs the platform database.' });
        socket.close(1008, 'unavailable');
        return;
      }
      startObserve(ps, sessions, req.principal, id, req.ip).then(
        ({ noticeId, orgId }) => {
          const notice = { id: noticeId, kind: 'observed' as const, at: new Date().toISOString(), from: { id: req.principal.sub, name: req.principal.name, email: req.principal.email }, message: `${req.principal.name} is watching your terminal (read-only).` };
          hub.notifyLearner(id, { ...notice, active: true });
          hub.addObserver(id, socket, () => {
            void endObserve(ps, orgId, noticeId).catch(() => undefined);
            hub.notifyLearner(id, { ...notice, at: new Date().toISOString(), message: `${req.principal.name} stopped watching.`, active: false });
          });
        },
        (e: unknown) => {
          const err = e as HttpError;
          if (!(e instanceof HttpError)) req.log.warn({ err: e }, 'observe failed');
          send(socket, { t: 'error', m: err.status === 403 ? 'You may not observe this session.' : e instanceof HttpError ? err.message : 'The terminal could not be observed. Please try again.' });
          socket.close(1008, 'forbidden');
        },
      );
      return;
    }
    // The socket joins the session's learners (observer notices, the observers' copy of the
    // output) only once the caller is known to own the session and the terminal is planned.
    let tap: ((chunk: Buffer) => void) | undefined;
    const planned = sessions.owned(req.principal, id).then(({ ls, lab }) => {
      const plan = planTerminal(ls, lab.lab, req.query.node);
      if (socket.readyState === socket.OPEN) tap = hub.addLearner(id, socket);
      return plan;
    });
    planned.catch(() => undefined); // reported to the client by bridge()
    void bridge(socket, cluster, planned, { cols: clampSize(req.query.cols, 120, 1000), rows: clampSize(req.query.rows, 32, 500) }, req.log, (chunk) => tap?.(chunk));
  });

  if (deps.answers) registerAnswerRoutes(app, deps.answers);
  if (deps.events) registerEventRoutes(app, deps.events);

  if (ps) registerPlatformRoutes(app, ps, sessions, deps.clusterInfo ?? null);

  /* ---------------------------------- public --------------------------------- */

  if (deps.billing) registerBillingRoutes(app, deps.billing);
  if (deps.site) registerPublicRoutes(app, { content, site: deps.site.config, ...(deps.site.exams ? { exams: deps.site.exams } : {}), ...(deps.site.ratePerMinute ? { ratePerMinute: deps.site.ratePerMinute } : {}) });
  if (deps.site) registerWaitlistRoutes(app, { site: deps.site.config, ...(deps.site.waitlist?.store ? { store: deps.site.waitlist.store } : {}), ...(deps.site.waitlist?.perHour ? { perHour: deps.site.waitlist.perHour } : {}) });

  if (deps.gdpr) registerGdprRoutes(app, { gdpr: deps.gdpr.service, ...(deps.oidc ? { store: deps.oidc.store } : {}), ...(deps.gdpr.perHour ? { perHour: deps.gdpr.perHour } : {}) });

  /* ---------------------------------- exams ---------------------------------- */

  if (deps.exams) registerExamRoutes(app, deps.exams, cluster, ps ? (p) => ps.ensureNotRestricted(p) : undefined, deps.billing);

  return app;
}

const originOf = (u: string): string => {
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
};

/** A WebSocket Origin is allowed when it is the request's own host or one of the app's origins. */
export function wsOriginAllowed(origin: string, host: string | undefined, allowed: Set<string>): boolean {
  const o = originOf(origin);
  if (!o || o === 'null') return false;
  if (allowed.has(o)) return true;
  return !!host && new URL(o).host === host.toLowerCase();
}
