import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
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
  /** Readiness checks for GET /readyz (e.g. Postgres); each resolves or throws. */
  readiness?: Record<string, () => Promise<unknown>>;
  /**
   * The public website (`/api/public/*`, no sign-in): site configuration plus the read-only
   * catalog from content/ and the exam catalog. Omitted = not served.
   */
  site?: { config: SiteConfig; exams?: ExamCatalog; ratePerMinute?: number };
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
 * The gateway's HTTP surface: the paths and shapes apps/web uses (see
 * packages/api-types and docs/api/platform.md). Every /api route declares
 * the permission it needs (`config.permission`) or is explicitly public;
 * a route without either fails closed.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { content, auth, sessions, cluster, platform: ps } = deps;
  const hub = deps.hub ?? new TerminalHub();
  const options: FastifyServerOptions = { logger: deps.logger ?? false, trustProxy: deps.trustProxy ?? '127.0.0.1' };
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
    app.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (!origin || !cors.has(origin) || !req.url.startsWith('/api/')) return;
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
    });
    app.options('/api/*', { config: { public: true } }, async (req, reply) => {
      if (!req.headers.origin || !cors.has(req.headers.origin)) return reply.code(403).send({ error: 'Origin not allowed', code: 'forbidden' });
      reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
      reply.header('access-control-allow-headers', `content-type, ${CSRF_HEADER}`);
      reply.header('access-control-max-age', '600');
      return reply.code(204).send();
    });
  }
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });
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
    if (!req.url.startsWith('/api/') || !req.routeOptions.url) return; // unknown routes: 404 below
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
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message ?? 'Bad request' });
    req.log.error({ err }, 'request failed');
    return reply.code(502).send({ error: `Upstream error: ${e.message ?? 'unknown'}` });
  });

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true, labs: content.labs.size, contentIssues: content.issues.length, platform: !!ps }));
  // Kubernetes probes, outside /api so the Ingress/HTTPRoute (which routes /api only) never
  // exposes them. Liveness: the process answers. Readiness: content loaded and every
  // dependency check (Postgres) passes; details are only check names and error messages.
  app.get('/healthz', { config: { public: true }, logLevel: 'warn' }, async () => ({ ok: true }));
  app.get('/readyz', { config: { public: true }, logLevel: 'warn' }, async (_req, reply) => {
    const loaded = async () => {
      if (content.labs.size === 0) throw new Error('no labs loaded');
    };
    const r = await runReadiness({ content: loaded, ...(deps.readiness ?? {}) });
    return reply.code(r.ok ? 200 : 503).send(r);
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

  app.get('/api/catalog', run, async (req) => (ps ? ps.catalog(req.principal) : { domains: content.domains, paths: content.paths, labs: content.summaries }));

  app.get<{ Params: { id: string } }>('/api/labs/:id', run, async (req) => {
    const lab = labViews.get(req.params.id);
    if (!lab) throw notFound('Lab');
    await ps?.assertLabVisible(req.principal, req.params.id);
    return lab;
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

  app.post<{ Params: { id: string } }>('/api/labs/:id/sessions', run, async (req, reply) => {
    const s = await sessions.start(req.principal, req.params.id);
    return reply.code(201).send(s);
  });
  app.get<{ Params: { id: string } }>('/api/labs/:id/sessions', run, async (req) => {
    if (!content.labs.has(req.params.id)) throw notFound('Lab');
    return sessions.list(req.principal, req.params.id);
  });
  app.get('/api/sessions', run, async (req) => sessions.list(req.principal));
  app.get<{ Params: { id: string } }>('/api/sessions/:id', run, async (req) => sessions.get(req.principal, req.params.id));
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', run, async (req, reply) => {
    await sessions.end(req.principal, req.params.id);
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
          send(socket, { t: 'error', m: err.status === 403 ? 'You may not observe this session.' : err.message });
          socket.close(1008, 'forbidden');
        },
      );
      return;
    }
    const planned = sessions.owned(req.principal, id).then(({ ls, lab }) => planTerminal(ls, lab.lab, req.query.node));
    planned.catch(() => undefined); // reported to the client by bridge()
    const tap = hub.addLearner(id, socket);
    void bridge(socket, cluster, planned, { cols: clampSize(req.query.cols, 120, 1000), rows: clampSize(req.query.rows, 32, 500) }, req.log, tap);
  });

  if (deps.answers) registerAnswerRoutes(app, deps.answers);
  if (deps.events) registerEventRoutes(app, deps.events);

  if (ps) registerPlatformRoutes(app, ps, sessions, deps.clusterInfo ?? null);

  /* ---------------------------------- public --------------------------------- */

  if (deps.site) registerPublicRoutes(app, { content, site: deps.site.config, ...(deps.site.exams ? { exams: deps.site.exams } : {}), ...(deps.site.ratePerMinute ? { ratePerMinute: deps.site.ratePerMinute } : {}) });

  /* ---------------------------------- exams ---------------------------------- */

  if (deps.exams) registerExamRoutes(app, deps.exams, cluster);

  return app;
}
