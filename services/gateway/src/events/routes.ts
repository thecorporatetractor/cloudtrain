import type { FastifyInstance } from 'fastify';
import type { CreateCtfEventRequest, JoinCtfEventRequest, UpdateCtfEventRequest } from '@cloudtrain/api-types';
import type { EventService } from './service.js';

/** `/api/events*`: CTF events. Learners: `lab.run`; managing, the live view and exports: `event.manage`. */
export function registerEventRoutes(app: FastifyInstance, events: EventService): void {
  const run = { config: { permission: 'lab.run' as const } };
  const manage = { config: { permission: 'event.manage' as const } };
  type Id = { Params: { id: string } };

  app.get('/api/events', run, async (req) => events.list(req.principal));
  app.post<{ Body: CreateCtfEventRequest }>('/api/events', manage, async (req, reply) => reply.code(201).send(await events.create(req.principal, req.body, req.ip)));
  app.get<Id>('/api/events/:id', run, async (req) => events.get(req.principal, req.params.id));
  app.patch<Id & { Body: UpdateCtfEventRequest }>('/api/events/:id', manage, async (req) => events.update(req.principal, req.params.id, req.body, req.ip));
  app.delete<Id>('/api/events/:id', manage, async (req, reply) => {
    await events.remove(req.principal, req.params.id, req.ip);
    return reply.code(204).send();
  });
  app.post<Id & { Body: JoinCtfEventRequest }>('/api/events/:id/join', run, async (req) => events.join(req.principal, req.params.id, req.body ?? {}, req.ip));
  app.post<Id>('/api/events/:id/leave', run, async (req) => events.leave(req.principal, req.params.id, req.ip));
  app.post<Id & { Body: { name: string } }>('/api/events/:id/teams', manage, async (req) => events.createTeam(req.principal, req.params.id, req.body?.name, req.ip));
  app.put<{ Params: { id: string; teamId: string }; Body: { userIds: string[] } }>('/api/events/:id/teams/:teamId/members', manage, async (req) =>
    events.setTeamMembers(req.principal, req.params.id, req.params.teamId, req.body?.userIds ?? [], req.ip),
  );
  app.delete<{ Params: { id: string; teamId: string } }>('/api/events/:id/teams/:teamId', manage, async (req) => events.deleteTeam(req.principal, req.params.id, req.params.teamId, req.ip));
  app.post<{ Params: { id: string; labId: string } }>('/api/events/:id/labs/:labId/sessions', run, async (req, reply) => reply.code(201).send(await events.startLab(req.principal, req.params.id, req.params.labId)));
  app.get<Id>('/api/events/:id/scoreboard', run, async (req) => events.scoreboard(req.principal, req.params.id));
  app.get<Id>('/api/events/:id/report', manage, async (req) => events.report(req.principal, req.params.id));
  app.get<Id>('/api/events/:id/results.csv', manage, async (req, reply) => {
    const { name, body } = await events.resultsCsv(req.principal, req.params.id, req.ip);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(body);
  });
}
