import type { FastifyInstance } from 'fastify';
import type { Principal } from '../auth.js';
import type { BillingService } from '../billing/service.js';
import type { FlagTaskRequest, GrantExamRetakeRequest, VoidExamAttemptRequest } from '@cloudtrain/api-types';
import { HttpError } from '../errors.js';
import type { LabCluster } from '../kube/cluster.js';
import type { LabSession } from '../kube/types.js';
import { bridge, clampSize } from '../terminal/bridge.js';
import { nodeCommand, parseExecTarget, sshCommand, templateDriver, type TerminalPlan } from '../terminal/target.js';
import { attemptName, type ExamService } from './service.js';

/**
 * Where an exam terminal runs: like a lab terminal (own k8s-exec endpoint ->
 * its console command or a login shell, otherwise `ssh <node>` from the entry
 * node), but only while
 * the environment session is not frozen.
 */
export function planExamTerminal(ls: LabSession, node: string, sourceDriver?: string): TerminalPlan {
  const phase = ls.status?.phase;
  const revoked = ls.spec.accessRevoked || (ls.status?.conditions ?? []).some((c) => c.type === 'AccessRevoked' && c.status === 'True');
  if (revoked) throw new HttpError(409, 'Time is up: the exam environment is closed.');
  if (phase !== 'Ready' && phase !== 'Grading') throw new HttpError(409, 'The exam environment is not ready.');
  const eps = ls.status?.endpoints ?? [];
  const execEndpoint = (name: string) => eps.find((e) => e.node === name && e.protocol === 'k8s-exec');
  const exec = (name: string) => parseExecTarget(execEndpoint(name)?.target);
  const own = exec(node);
  if (own) {
    const ep = execEndpoint(node);
    return { node, target: own, command: nodeCommand(ls, node, ep, sourceDriver), via: ep?.command ? `console on ${node}` : `shell on ${node}` };
  }
  const entry = ls.status?.entryNode ?? '';
  const entryTarget = exec(entry);
  if (!entryTarget || !eps.some((e) => e.node === node)) throw new HttpError(404, `No terminal for ${node}`);
  return { node, target: entryTarget, command: sshCommand(node), via: `ssh ${node} from ${entry}` };
}

/**
 * Registers `/api/exams/*` (all JSON; the terminal is a WebSocket). Every
 * route declares its permission (the app's onRequest hook checks it in some
 * scope, plus the CSRF header on writes); the service checks the exact scope
 * (own attempts, a managed team, the candidate's teams/cohorts).
 */
export function registerExamRoutes(app: FastifyInstance, exams: ExamService, labs: LabCluster, assertMayStart?: (p: Principal) => Promise<void>, billing?: Pick<BillingService, 'assertExamStart' | 'meterStart' | 'release'>): void {
  const run = { config: { permission: 'lab.run' as const } };
  const team = { config: { permission: 'progress.read.team' as const } };
  const control = { config: { permission: 'session.control' as const } };
  const assign = { config: { permission: 'assignment.manage' as const } };
  app.get('/api/exams', run, async (req) => ({ exams: await exams.list(req.principal) }));
  app.get<{ Querystring: { exam?: string } }>('/api/exams/attempts/mine', run, async (req) => exams.mine(req.principal, req.query.exam || undefined));
  app.get<{ Querystring: { team?: string } }>('/api/exams/team-readiness', team, async (req) => exams.teamReadiness(req.principal, req.query.team || undefined));
  app.get<{ Params: { attemptId: string } }>('/api/exams/attempts/:attemptId', run, async (req) => exams.attempt(req.principal, req.params.attemptId));
  app.get<{ Params: { attemptId: string } }>('/api/exams/attempts/:attemptId/report', run, async (req) => exams.report(req.principal, req.params.attemptId));
  app.post<{ Params: { attemptId: string } }>('/api/exams/attempts/:attemptId/submit', run, async (req) => exams.submit(req.principal, req.params.attemptId, req.ip));
  app.post<{ Params: { attemptId: string }; Body: VoidExamAttemptRequest }>('/api/exams/attempts/:attemptId/void', control, async (req) => {
    const reason = (req.body as Partial<VoidExamAttemptRequest> | undefined)?.reason;
    if (reason !== undefined && typeof reason !== 'string') throw new HttpError(422, 'reason must be a string', { code: 'invalid' });
    return exams.void(req.principal, req.params.attemptId, reason, req.ip);
  });
  app.put<{ Params: { attemptId: string; index: string }; Body: FlagTaskRequest }>('/api/exams/attempts/:attemptId/tasks/:index/flag', run, async (req) => {
    const flagged = (req.body as Partial<FlagTaskRequest> | undefined)?.flagged;
    if (typeof flagged !== 'boolean') throw new HttpError(400, 'Body must be {"flagged": true|false}');
    return exams.flag(req.principal, req.params.attemptId, Number(req.params.index), flagged);
  });
  app.get<{ Params: { examId: string } }>('/api/exams/:examId', run, async (req) => exams.detail(req.principal, req.params.examId));
  app.post<{ Params: { examId: string } }>('/api/exams/:examId/attempts', run, async (req, reply) => {
    await assertMayStart?.(req.principal);
    // The billing gate (payment, dunning, spend cap, the plan's exam simulations; 402) and metering, as for labs.
    // The gate reserves the usage row under the attempt's name; a start that fails releases it.
    const name = attemptName();
    const decision = await billing?.assertExamStart(req.principal, exams.billingFacts(req.params.examId), name);
    let attempt;
    try {
      attempt = await exams.start(req.principal, req.params.examId, req.ip, name);
    } catch (e) {
      // An ExamSession that exists despite the error runs: the sweep confirms and meters it.
      if (await exams.environmentExists(name)) throw e;
      await billing?.release(req.principal, decision).catch((err: unknown) => req.log.error({ err, attempt: name }, 'billing: could not release a failed exam start; the sweep closes it unbilled'));
      throw e;
    }
    // The sweep confirms the attempt if this fails (the ExamSession exists).
    await billing?.meterStart(req.principal, decision, { id: attempt.id, startedAt: attempt.startedAt }).catch((e: unknown) => req.log.error({ err: e, attempt: attempt.id }, 'billing: could not confirm usage start; the sweep confirms it'));
    return reply.code(201).send({ attempt });
  });
  app.post<{ Params: { examId: string }; Body: GrantExamRetakeRequest }>('/api/exams/:examId/retake-grants', assign, async (req, reply) => {
    const b = (req.body ?? {}) as Partial<GrantExamRetakeRequest>;
    if (typeof b.userId !== 'string' || !b.userId) throw new HttpError(422, 'Body must be {"userId": "...", "reason"?: "..."}', { code: 'invalid' });
    if (b.reason !== undefined && typeof b.reason !== 'string') throw new HttpError(422, 'reason must be a string', { code: 'invalid' });
    return reply.code(201).send(await exams.grantRetake(req.principal, req.params.examId, b.userId, b.reason, req.ip));
  });

  app.get<{ Params: { attemptId: string }; Querystring: { target?: string; cols?: string; rows?: string } }>(
    '/api/exams/attempts/:attemptId/terminal',
    { websocket: true, ...run },
    (socket, req) => {
      const planned = exams.terminalTarget(req.principal, req.params.attemptId, req.query.target ?? '').then(async ({ environment, node }) => {
        const ls = await labs.getSession(environment);
        if (!ls) throw new HttpError(409, 'The exam environment is closed.');
        // The node's driver from the compiled template, so a device is never
        // given a shell because the session status does not list it yet.
        const tpl = await labs.getTemplate(ls.spec.templateRef.name);
        return planExamTerminal(ls, node, templateDriver(tpl, node));
      });
      planned.catch(() => undefined); // reported to the client by bridge()
      void bridge(socket, labs, planned, { cols: clampSize(req.query.cols, 120, 1000), rows: clampSize(req.query.rows, 32, 500) }, req.log);
    },
  );
}
