import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Lab } from '@cloudtrain/api-types';
import type { Authenticator } from './auth.js';
import type { Content } from './content/load.js';
import { learnerLab } from './content/view.js';
import { HttpError, notFound } from './errors.js';
import type { LabCluster } from './kube/cluster.js';
import { learnerOf, sampleHome, sampleSkillStates } from './learner/sample.js';
import type { SessionService } from './sessions/service.js';
import { bridge, clampSize } from './terminal/bridge.js';
import { planTerminal } from './terminal/target.js';
import { registerExamRoutes } from './exams/routes.js';
import type { ExamService } from './exams/service.js';

export interface AppDeps {
  content: Content;
  auth: Authenticator;
  sessions: SessionService;
  cluster: LabCluster;
  /** Exam simulations (`/api/exams/*`); omitted = not served. */
  exams?: ExamService;
  logger?: boolean | { level: string };
}

/**
 * The gateway's HTTP surface: the paths and shapes apps/web uses (see
 * packages/api-types and apps/web/src/mocks/handlers.ts). Team and Studio
 * endpoints are not served; the web app keeps mocking them.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { content, auth, sessions, cluster } = deps;
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });

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
    if (!req.url.startsWith('/api/') || req.url === '/api/health') return;
    const p = await auth.authenticate(req);
    if (!p) return reply.code(401).send({ error: 'Not signed in' });
    req.principal = p;
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message ?? 'Bad request' });
    req.log.error({ err }, 'request failed');
    return reply.code(502).send({ error: `Upstream error: ${e.message ?? 'unknown'}` });
  });

  app.get('/api/health', async () => ({ ok: true, labs: content.labs.size, contentIssues: content.issues.length }));

  /* ---------------------------- identity / learner --------------------------- */

  app.get('/api/me', async (req) => learnerOf(req.principal));
  app.get('/api/home', async (req) => sampleHome(content, req.principal));

  /* --------------------------------- catalog --------------------------------- */

  app.get('/api/catalog', async () => ({ domains: content.domains, paths: content.paths, labs: content.summaries }));

  app.get<{ Params: { id: string } }>('/api/labs/:id', async (req) => {
    const lab = labViews.get(req.params.id);
    if (!lab) throw notFound('Lab');
    return lab;
  });

  app.get<{ Querystring: { member?: string } }>('/api/skills', async (req) => {
    const member = req.query.member;
    const who = member || req.principal.sub;
    const body = { skills: content.skills, states: sampleSkillStates(content, who), frameworks: content.frameworks };
    if (member && member !== req.principal.sub) return { ...body, member: { id: member, name: member, title: 'Team member (sample data)' } };
    return body;
  });

  /* --------------------------------- sessions -------------------------------- */

  app.post<{ Params: { id: string } }>('/api/labs/:id/sessions', async (req, reply) => {
    const s = await sessions.start(req.principal, req.params.id);
    return reply.code(201).send(s);
  });
  app.get<{ Params: { id: string } }>('/api/labs/:id/sessions', async (req) => {
    if (!content.labs.has(req.params.id)) throw notFound('Lab');
    return sessions.list(req.principal, req.params.id);
  });
  app.get('/api/sessions', async (req) => sessions.list(req.principal));
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req) => sessions.get(req.principal, req.params.id));
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    await sessions.end(req.principal, req.params.id);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/sessions/:id/validate', async (req) => sessions.validate(req.principal, req.params.id));
  app.post<{ Params: { id: string; index: string } }>('/api/sessions/:id/hints/:index', async (req) => sessions.revealHint(req.principal, req.params.id, Number(req.params.index)));

  /* --------------------------------- terminal -------------------------------- */

  app.get<{ Params: { id: string }; Querystring: { node?: string; cols?: string; rows?: string } }>('/api/sessions/:id/terminal', { websocket: true }, (socket, req) => {
    const planned = sessions.owned(req.principal, req.params.id).then(({ ls, lab }) => planTerminal(ls, lab.lab, req.query.node));
    planned.catch(() => undefined); // reported to the client by bridge()
    void bridge(socket, cluster, planned, { cols: clampSize(req.query.cols, 120, 1000), rows: clampSize(req.query.rows, 32, 500) }, req.log);
  });

  /* ---------------------------------- exams ---------------------------------- */

  if (deps.exams) registerExamRoutes(app, deps.exams, cluster);

  return app;
}
