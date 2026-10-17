import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AddCohortMembersRequest,
  AddDomainRequest,
  AddTeamMemberRequest,
  AssignmentQuery,
  AttemptQuery,
  AuditQuery,
  BroadcastRequest,
  CreateAssignmentRequest,
  CreateCohortRequest,
  CreatePlatformOrgRequest,
  CreateSsoConnectionRequest,
  CreateTeamRequest,
  ExtendSessionRequest,
  InviteUserRequest,
  Permission,
  UpdateCohortRequest,
  UpdateLearnerGoalsRequest,
  UpdateContentVisibilityRequest,
  UpdateOrgSettingsRequest,
  UpdatePlatformOrgRequest,
  UpdateQuotasRequest,
  UpdateSsoConnectionRequest,
  UpdateTeamRequest,
  UpdateUserRequest,
  UserQuery,
} from '@cloudtrain/api-types';
import type { ClusterInfo } from '../kube/capacity.js';
import * as admin from '../platform/admin.js';
import * as cohorts from '../platform/cohorts.js';
import * as manager from '../platform/manager.js';
import * as platform from '../platform/platform.js';
import type { PlatformService } from '../platform/service.js';
import * as sso from '../platform/sso.js';
import type { SessionService } from '../sessions/service.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Permission every caller of the route must hold in some scope (handlers check the exact scope). */
    permission?: Permission;
    /** No session required (login flow, health). */
    public?: boolean;
    /** Also allowed without an active org (platform admins, /me). */
    anyOrg?: boolean;
  }
}

const perm = (permission: Permission, anyOrg = false) => ({ config: { permission, ...(anyOrg ? { anyOrg } : {}) } });

const csv = (reply: FastifyReply, name: string, body: string) => reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(body);

export function registerPlatformRoutes(app: FastifyInstance, ps: PlatformService, sessions: SessionService, clusterInfo: ClusterInfo | null): void {
  /* --------------------------------------------------------------- learner */
  app.get('/api/me/goals', perm('progress.read.self'), async (req) => ps.goals(req.principal));
  app.put<{ Body: UpdateLearnerGoalsRequest }>('/api/me/goals', perm('progress.read.self'), async (req) => ps.setGoals(req.principal, req.body));
  app.get('/api/assignments/mine', perm('progress.read.self'), async (req) => ps.myAssignments(req.principal));
  app.get<{ Querystring: AttemptQuery }>('/api/attempts/mine', perm('progress.read.self'), async (req) => ps.myAttempts(req.principal, req.query));
  app.get<{ Params: { id: string } }>('/api/attempts/:id', perm('progress.read.self'), async (req) => ps.attemptDetail(req.principal, req.params.id));

  /* --------------------------------------------------------------- manager */
  app.get('/api/teams', perm('progress.read.team'), async (req) => manager.listTeams(ps, req.principal));
  app.get<{ Params: { id: string } }>('/api/teams/:id/dashboard', perm('progress.read.team'), async (req) => manager.dashboard(ps, req.principal, req.params.id));
  app.get<{ Params: { id: string; userId: string } }>('/api/teams/:id/members/:userId', perm('progress.read.team'), async (req) => manager.memberDetail(ps, req.principal, req.params.id, req.params.userId));
  app.get<{ Querystring: AssignmentQuery }>('/api/assignments', perm('assignment.manage'), async (req) => manager.listAssignments(ps, req.principal, req.query));
  app.get<{ Params: { id: string } }>('/api/assignments/:id', perm('assignment.manage'), async (req) => manager.assignmentDetail(ps, req.principal, req.params.id));
  app.post<{ Body: CreateAssignmentRequest }>('/api/assignments', perm('assignment.manage'), async (req, reply) => reply.code(201).send({ assignments: await manager.createAssignments(ps, req.principal, req.body, req.ip) }));
  app.delete<{ Params: { id: string } }>('/api/assignments/:id', perm('assignment.manage'), async (req, reply) => {
    await manager.deleteAssignment(ps, req.principal, req.params.id, req.ip);
    return reply.code(204).send();
  });
  app.get<{ Querystring: { team?: string; from?: string; to?: string } }>('/api/reports/progress.csv', perm('report.export'), async (req, reply) => {
    if (!req.query.team) return reply.code(422).send({ error: 'team is required', code: 'invalid' });
    return csv(reply, `progress-${req.query.team}.csv`, await manager.progressCsv(ps, req.principal, req.query.team, req.query.from, req.query.to, req.ip));
  });

  /* ------------------------------------------------------------ instructor */
  app.get('/api/cohorts', perm('progress.read.team'), async (req) => cohorts.listCohorts(ps, req.principal));
  app.post<{ Body: CreateCohortRequest }>('/api/cohorts', perm('cohort.manage'), async (req, reply) => reply.code(201).send(await cohorts.createCohort(ps, req.principal, req.body, req.ip)));
  app.get<{ Params: { id: string } }>('/api/cohorts/:id', perm('progress.read.team'), async (req) => cohorts.getCohort(ps, req.principal, req.params.id));
  app.patch<{ Params: { id: string }; Body: UpdateCohortRequest }>('/api/cohorts/:id', perm('cohort.manage'), async (req) => cohorts.updateCohort(ps, req.principal, req.params.id, req.body ?? {}, req.ip));
  app.post<{ Params: { id: string }; Body: AddCohortMembersRequest }>('/api/cohorts/:id/members', perm('cohort.manage'), async (req) => cohorts.addCohortMembers(ps, req.principal, req.params.id, req.body?.userIds, req.ip));
  app.delete<{ Params: { id: string; userId: string } }>('/api/cohorts/:id/members/:userId', perm('cohort.manage'), async (req, reply) => {
    await cohorts.removeCohortMember(ps, req.principal, req.params.id, req.params.userId, req.ip);
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>('/api/cohorts/:id/board', perm('progress.read.team'), async (req) => cohorts.board(ps, req.principal, req.params.id));
  app.post<{ Params: { id: string }; Body: BroadcastRequest }>('/api/cohorts/:id/broadcast', perm('session.control'), async (req, reply) => {
    await cohorts.broadcast(ps, req.principal, req.params.id, req.body, req.ip);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string }; Body: ExtendSessionRequest }>('/api/sessions/:id/extend', perm('session.control', true), async (req) => cohorts.controlSession(ps, sessions, req.principal, req.params.id, 'extend', req.body?.minutes, req.ip));
  app.post<{ Params: { id: string } }>('/api/sessions/:id/reset', perm('session.control', true), async (req) => cohorts.controlSession(ps, sessions, req.principal, req.params.id, 'reset', undefined, req.ip));
  app.post<{ Params: { id: string } }>('/api/sessions/:id/terminate', perm('session.control', true), async (req) => cohorts.controlSession(ps, sessions, req.principal, req.params.id, 'terminate', undefined, req.ip));

  /* ----------------------------------------------------------------- admin */
  app.get('/api/admin/overview', perm('user.manage'), async (req) => admin.overview(ps, req.principal));
  app.get<{ Querystring: UserQuery }>('/api/admin/users', perm('user.manage'), async (req) => admin.listUsers(ps, req.principal, req.query));
  app.get<{ Params: { id: string } }>('/api/admin/users/:id', perm('user.manage'), async (req) => admin.getUser(ps, req.principal, req.params.id));
  app.post<{ Body: InviteUserRequest }>('/api/admin/users', perm('user.manage'), async (req, reply) => reply.code(201).send(await admin.inviteUser(ps, req.principal, req.body, req.ip)));
  app.patch<{ Params: { id: string }; Body: UpdateUserRequest }>('/api/admin/users/:id', perm('user.manage'), async (req) => admin.updateUser(ps, req.principal, req.params.id, req.body ?? {}, req.ip));
  app.get('/api/admin/invitations', perm('user.manage'), async (req) => admin.listInvitations(ps, req.principal));
  app.delete<{ Params: { id: string } }>('/api/admin/invitations/:id', perm('user.manage'), async (req, reply) => {
    await admin.revokeInvitation(ps, req.principal, req.params.id, req.ip);
    return reply.code(204).send();
  });

  app.get('/api/admin/teams', perm('team.manage'), async (req) => admin.adminTeams(ps, req.principal));
  app.post<{ Body: CreateTeamRequest }>('/api/admin/teams', perm('team.manage'), async (req, reply) => reply.code(201).send(await admin.createTeam(ps, req.principal, req.body, req.ip)));
  app.get<{ Params: { id: string } }>('/api/admin/teams/:id', perm('team.manage'), async (req) => admin.teamDetail(ps, req.principal, req.params.id));
  app.patch<{ Params: { id: string }; Body: UpdateTeamRequest }>('/api/admin/teams/:id', perm('team.manage'), async (req) => admin.updateTeam(ps, req.principal, req.params.id, req.body ?? {}, req.ip));
  app.delete<{ Params: { id: string } }>('/api/admin/teams/:id', perm('team.manage'), async (req, reply) => {
    await admin.deleteTeam(ps, req.principal, req.params.id, req.ip);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string }; Body: AddTeamMemberRequest }>('/api/admin/teams/:id/members', perm('team.manage'), async (req) => admin.addTeamMember(ps, req.principal, req.params.id, req.body, req.ip));
  app.delete<{ Params: { id: string; userId: string } }>('/api/admin/teams/:id/members/:userId', perm('team.manage'), async (req, reply) => {
    await admin.removeTeamMember(ps, req.principal, req.params.id, req.params.userId, req.ip);
    return reply.code(204).send();
  });

  app.get('/api/admin/sso', perm('sso.manage'), async (req) => sso.ssoOverview(ps, req.principal));
  app.get('/api/admin/sso/domains', perm('sso.manage'), async (req) => sso.listDomains(ps, req.principal));
  app.post<{ Body: AddDomainRequest }>('/api/admin/sso/domains', perm('sso.manage'), async (req, reply) => reply.code(201).send(await sso.addDomain(ps, req.principal, req.body?.domain, req.ip)));
  app.post<{ Params: { domain: string } }>('/api/admin/sso/domains/:domain/verify', perm('sso.manage'), async (req) => sso.verifyDomain(ps, req.principal, req.params.domain, req.ip));
  app.delete<{ Params: { domain: string } }>('/api/admin/sso/domains/:domain', perm('sso.manage'), async (req, reply) => {
    await sso.removeDomain(ps, req.principal, req.params.domain, req.ip);
    return reply.code(204).send();
  });
  app.post<{ Body: CreateSsoConnectionRequest }>('/api/admin/sso', perm('sso.manage'), async (req, reply) => reply.code(201).send(await sso.createConnection(ps, req.principal, req.body, req.ip)));
  app.patch<{ Params: { id: string }; Body: UpdateSsoConnectionRequest }>('/api/admin/sso/:id', perm('sso.manage'), async (req) => sso.updateConnection(ps, req.principal, req.params.id, req.body ?? {}, req.ip));
  app.delete<{ Params: { id: string } }>('/api/admin/sso/:id', perm('sso.manage'), async (req, reply) => {
    await sso.deleteConnection(ps, req.principal, req.params.id, req.ip);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/admin/sso/:id/test', perm('sso.manage'), async (req) => sso.testConnection(ps, req.principal, req.params.id, req.ip));

  app.get('/api/admin/content', perm('content.visibility'), async (req) => admin.contentVisibility(ps, req.principal));
  app.put<{ Body: UpdateContentVisibilityRequest }>('/api/admin/content', perm('content.visibility'), async (req) => admin.updateContentVisibility(ps, req.principal, req.body ?? {}, req.ip));
  app.get('/api/admin/sessions', perm('session.control'), async (req) => cohorts.liveSessions(ps, req.principal));
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/admin/usage', perm('quota.manage'), async (req) => admin.usage(ps, req.principal, req.query.from, req.query.to));
  app.get('/api/admin/quotas', perm('quota.manage'), async (req) => admin.getQuotas(ps, req.principal));
  app.put<{ Body: UpdateQuotasRequest }>('/api/admin/quotas', perm('quota.manage'), async (req) => admin.updateQuotas(ps, req.principal, req.body ?? {}, req.ip));
  app.get<{ Querystring: AuditQuery }>('/api/admin/audit', perm('audit.read'), async (req) => admin.auditPage(ps, req.principal, req.query));
  app.get<{ Querystring: AuditQuery }>('/api/admin/audit.csv', perm('audit.read'), async (req, reply) => csv(reply, 'audit.csv', await admin.auditCsv(ps, req.principal, req.query, req.ip)));
  app.get('/api/admin/settings', perm('settings.manage'), async (req) => admin.getSettings(ps, req.principal));
  app.patch<{ Body: UpdateOrgSettingsRequest }>('/api/admin/settings', perm('settings.manage'), async (req) => admin.updateSettings(ps, req.principal, req.body ?? {}, req.ip));

  /* -------------------------------------------------------------- platform */
  app.get('/api/platform/orgs', perm('org.manage', true), async (req) => platform.listOrgs(ps, req.principal));
  app.post<{ Body: CreatePlatformOrgRequest }>('/api/platform/orgs', perm('org.manage', true), async (req, reply) => reply.code(201).send(await platform.createOrg(ps, req.principal, req.body, req.ip)));
  app.get<{ Params: { id: string } }>('/api/platform/orgs/:id', perm('org.manage', true), async (req) => platform.getOrg(ps, req.principal, req.params.id));
  app.patch<{ Params: { id: string }; Body: UpdatePlatformOrgRequest }>('/api/platform/orgs/:id', perm('org.manage', true), async (req) => platform.updateOrg(ps, req.principal, req.params.id, req.body ?? {}, req.ip));
  app.post<{ Params: { id: string } }>('/api/platform/orgs/:id/suspend', perm('org.manage', true), async (req) => platform.suspendOrg(ps, req.principal, req.params.id, req.ip));
  app.post<{ Params: { id: string } }>('/api/platform/orgs/:id/reactivate', perm('org.manage', true), async (req) => platform.reactivateOrg(ps, req.principal, req.params.id, req.ip));
  app.delete<{ Params: { id: string } }>('/api/platform/orgs/:id', perm('org.manage', true), async (req, reply) => {
    await platform.deleteOrg(ps, req.principal, req.params.id);
    return reply.code(204).send();
  });
  app.get('/api/platform/capacity', perm('capacity.read', true), async (req) => platform.capacity(ps, req.principal, clusterInfo));
}
