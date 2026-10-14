import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type {
  AddTeamMemberRequest,
  AdminOverview,
  AuditEvent,
  AuditQuery,
  ContentVisibility,
  CreateTeamRequest,
  Invitation,
  InviteUserRequest,
  InviteUserResponse,
  Org,
  OrgRole,
  OrgSettingsResponse,
  OrgUser,
  Page,
  Quotas,
  Team,
  TeamDetail,
  UpdateContentVisibilityRequest,
  UpdateOrgSettingsRequest,
  UpdateQuotasRequest,
  UpdateTeamRequest,
  UpdateUserRequest,
  UpdateUserResponse,
  Usage,
  UserQuery,
} from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, ORG_ROLES } from '../authz.js';
import type { Tx } from '../db/index.js';
import type { AuditRow } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { LABEL_LEARNER, LABEL_MANAGED_BY, LABEL_ORG, MANAGED_BY } from '../kube/types.js';
import { labelValue } from '../sessions/service.js';
import { endAttempt } from '../learner/learning.js';
import { actorOf, audit } from './audit.js';
import { normalizeRoles, orgForDomain } from './identity.js';
import { csvLine, teamsWithStats } from './manager.js';
import { DEFAULT_SETTINGS, decodeCursor, encodeCursor, pageLimit, userRef, UNKNOWN_USER, type PlatformService } from './service.js';

const DAY = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkRoles(roles: unknown): OrgRole[] {
  if (!Array.isArray(roles) || roles.some((r) => !(ORG_ROLES as readonly string[]).includes(r))) throw badRequest(`roles must be a subset of ${ORG_ROLES.join(', ')}`, { roles: 'invalid' });
  return normalizeRoles(roles as string[]);
}

/* -------------------------------------------------------------------- org */

export async function orgOf(tx: Tx, orgId: string): Promise<Org> {
  const o = await tx.selectFrom('orgs').selectAll().where('id', '=', orgId).executeTakeFirst();
  if (!o) throw notFound('Organization');
  const domains = await tx.selectFrom('org_domains').selectAll().where('org_id', '=', orgId).orderBy('domain').execute();
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    ...(o.settings.logoUrl ? { logoUrl: o.settings.logoUrl } : {}),
    status: o.status,
    settings: { ...DEFAULT_SETTINGS, ...o.settings } as Org['settings'],
    createdAt: o.created_at.toISOString(),
    domains: domains.map((d) => ({ domain: d.domain, verified: !!d.verified_at, ...(d.verified_at ? { verifiedAt: d.verified_at.toISOString() } : {}), verification: { type: 'TXT', name: `_cloudtrain-challenge.${d.domain}`, value: `cloudtrain-verify=${d.verification_token}` } })),
  };
}

export async function overview(ps: PlatformService, p: Principal): Promise<AdminOverview> {
  authorize(p, 'user.manage', { kind: 'org' });
  const running = (await ps.liveClusterSessions(p.orgId).catch(() => [])).length;
  return ps.tx(p, async (tx) => {
    const m = await tx.selectFrom('memberships').select(['status', (eb) => eb.fn.countAll<number>().as('n')]).groupBy('status').execute();
    const n = (s: string) => Number(m.find((x) => x.status === s)?.n ?? 0);
    const active7 = await tx
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('id', 'in', tx.selectFrom('memberships').select('user_id'))
      .where('last_login_at', '>', new Date(ps.now().getTime() - 7 * DAY))
      .executeTakeFirstOrThrow();
    const teams = await tx.selectFrom('teams').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const sso = await tx.selectFrom('sso_connections').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const recent = await tx.selectFrom('audit_log').selectAll().orderBy('at', 'desc').orderBy('id', 'desc').limit(8).execute();
    return {
      org: await orgOf(tx, p.orgId),
      users: { active: n('active'), invited: n('invited'), deactivated: n('deactivated'), activeLast7d: Number(active7.n) },
      teams: Number(teams.n),
      runningSessions: running,
      quotas: await ps.quotas(tx, p.orgId),
      labHoursThisMonth: await ps.labHoursThisMonth(tx),
      ssoConnections: Number(sso.n),
      recentAudit: await toAuditEvents(tx, recent),
    };
  });
}

/* ------------------------------------------------------------------ users */

async function orgUsers(tx: Tx, ids: string[]): Promise<OrgUser[]> {
  if (!ids.length) return [];
  const rows = await tx
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .leftJoin('users as inv', 'inv.id', 'm.invited_by')
    .select(['u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url', 'u.last_login_at', 'u.last_idp', 'm.roles', 'm.status', 'm.source', 'm.created_at', 'inv.id as inv_id', 'inv.name as inv_name', 'inv.email as inv_email'])
    .where('m.user_id', 'in', ids)
    .execute();
  const teams = await tx.selectFrom('team_members as tm').innerJoin('teams as t', 't.id', 'tm.team_id').select(['tm.user_id', 't.id', 't.name', 'tm.role']).where('tm.user_id', 'in', ids).orderBy('t.name').execute();
  const cohorts = await tx.selectFrom('cohort_members as cm').innerJoin('cohorts as c', 'c.id', 'cm.cohort_id').select(['cm.user_id', 'c.id', 'c.name']).where('cm.user_id', 'in', ids).execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      ...userRef(r),
      roles: normalizeRoles(r.roles),
      status: r.status,
      teams: teams.filter((t) => t.user_id === r.id).map((t) => ({ id: t.id, name: t.name, role: t.role })),
      cohorts: cohorts.filter((c) => c.user_id === r.id).map((c) => ({ id: c.id, name: c.name })),
      ...(r.last_login_at ? { lastLoginAt: r.last_login_at.toISOString() } : {}),
      ...(r.inv_id ? { invitedBy: { id: r.inv_id, name: r.inv_name ?? '', email: r.inv_email ?? '' } } : {}),
      joinedAt: r.created_at.toISOString(),
      source: r.source,
      ...(r.last_idp ? { idp: r.last_idp } : {}),
    }));
}

export async function listUsers(ps: PlatformService, p: Principal, q: UserQuery): Promise<Page<OrgUser>> {
  authorize(p, 'user.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const limit = pageLimit(q.limit);
    let query = tx.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['u.id', 'u.name']);
    if (q.q) {
      const like = `%${q.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) => eb.or([eb(sql`lower(u.name)`, 'like', like), eb(sql`lower(u.email)`, 'like', like)]));
    }
    if (q.role) query = query.where(sql<boolean>`${q.role} = ANY(m.roles)`);
    if (q.status) query = query.where('m.status', '=', q.status);
    if (q.team) query = query.where('u.id', 'in', tx.selectFrom('team_members').select('user_id').where('team_id', '=', q.team));
    const cur = decodeCursor<[string, string]>(q.cursor);
    if (cur) query = query.where((eb) => eb.or([eb('u.name', '>', cur[0]), eb.and([eb('u.name', '=', cur[0]), eb('u.id', '>', cur[1])])]));
    const total = await tx.selectFrom('memberships').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await query.orderBy('u.name').orderBy('u.id').limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await orgUsers(tx, page.map((r) => r.id)), nextCursor: rows.length > limit && last ? encodeCursor([last.name, last.id]) : null, total: Number(total.n) };
  });
}

export async function getUser(ps: PlatformService, p: Principal, id: string): Promise<OrgUser> {
  authorize(p, 'user.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const [u] = await orgUsers(tx, [id]);
    if (!u) throw notFound('User');
    return u;
  });
}

async function checkTeams(tx: Tx, teams: { teamId: string; role: string }[] | undefined) {
  const list = teams ?? [];
  if (list.some((t) => !t || typeof t.teamId !== 'string' || !['member', 'manager'].includes(t.role))) throw badRequest('teams must be [{ teamId, role: member|manager }]', { teams: 'invalid' });
  if (!list.length) return list as { teamId: string; role: 'member' | 'manager' }[];
  const found = await tx.selectFrom('teams').select('id').where('id', 'in', list.map((t) => t.teamId)).execute();
  if (found.length !== new Set(list.map((t) => t.teamId)).size) throw notFound('Team');
  return list as { teamId: string; role: 'member' | 'manager' }[];
}

function toInvitation(r: { id: string; email: string; roles: string[]; teams: { teamId: string; role: 'member' | 'manager' }[]; created_at: Date; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }, by: Invitation['invitedBy'], now: Date): Invitation {
  return {
    id: r.id,
    email: r.email,
    roles: normalizeRoles(r.roles),
    teams: r.teams,
    invitedBy: by,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    ...(r.accepted_at ? { acceptedAt: r.accepted_at.toISOString() } : {}),
    status: r.revoked_at ? 'revoked' : r.accepted_at ? 'accepted' : r.expires_at < now ? 'expired' : 'pending',
  };
}

export async function inviteUser(ps: PlatformService, p: Principal, req: InviteUserRequest, ip?: string): Promise<InviteUserResponse> {
  authorize(p, 'user.manage', { kind: 'org' });
  authorize(p, 'role.assign', { kind: 'org' });
  const email = req?.email?.trim().toLowerCase() ?? '';
  if (!EMAIL.test(email)) throw badRequest('A valid email is required.', { email: 'invalid' });
  const roles = checkRoles(req.roles ?? ['learner']);
  const days = Math.min(30, Math.max(1, Math.floor(Number(req.expiresInDays ?? 7)) || 7));
  const domain = email.split('@')[1]!;
  const domainOrg = await orgForDomain(ps.db, domain);
  const viaSso = !!(domainOrg?.idp_alias && domainOrg.org_id === p.orgId);

  const existing = (await sql<{ id: string }>`SELECT id FROM auth_user_by_email(${email})`.execute(ps.db)).rows[0];
  let userId = existing?.id;
  let kcCreated = false;
  if (!userId) {
    // Local-login orgs get a Keycloak account now (sub known); SSO domains are claimed at first login.
    if (!viaSso && ps.kc) {
      const found = await ps.kc.findUserByEmail(email);
      const [first, ...rest] = (req.name ?? email.split('@')[0]!).split(/\s+/);
      userId = found?.id ?? (await ps.kc.createUser({ email, firstName: first, lastName: rest.join(' ') || undefined }));
      kcCreated = !found;
    } else userId = `pending-${randomUUID()}`;
  }
  const token = randomBytes(24).toString('base64url');
  const result = await ps.tx(p, async (tx) => {
    const teams = await checkTeams(tx, req.teams);
    const member = await tx.selectFrom('memberships').selectAll().where('user_id', '=', userId!).executeTakeFirst();
    if (member && member.status !== 'invited') throw conflict(`${email} is already a member of this organization (${member.status}).`);
    if (!existing) await tx.insertInto('users').values({ id: userId!, email, name: req.name?.trim() || email }).execute();
    await tx
      .insertInto('memberships')
      .values({ org_id: p.orgId, user_id: userId!, roles, status: 'invited', source: 'invite', invited_by: p.sub })
      .onConflict((oc) => oc.columns(['org_id', 'user_id']).doUpdateSet({ roles, invited_by: p.sub, updated_at: new Date() }))
      .execute();
    await tx.updateTable('invitations').set({ revoked_at: new Date() }).where(sql`lower(email)`, '=', email).where('accepted_at', 'is', null).where('revoked_at', 'is', null).execute();
    const inv = await tx
      .insertInto('invitations')
      .values({ org_id: p.orgId, email, user_id: userId!, roles, teams: JSON.stringify(teams), token_hash: createHash('sha256').update(token).digest('hex'), invited_by: p.sub, expires_at: new Date(ps.now().getTime() + days * DAY) })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, actorOf(p, ip), 'user.invite', 'user', userId!, { email, roles, teams, viaSso }, email);
    const org = await tx.selectFrom('orgs').select(['name', 'kc_org_id']).where('id', '=', p.orgId).executeTakeFirstOrThrow();
    const [user] = await orgUsers(tx, [userId!]);
    return { inv, teams, org, user: user! };
  });

  if (ps.kc && result.org.kc_org_id && !userId.startsWith('pending-')) await ps.kc.addOrgMember(result.org.kc_org_id, userId).catch((e: unknown) => ps.log?.warn({ err: e }, 'keycloak org membership failed'));
  const link = `${ps.config.publicUrl}/api/auth/invite/${token}`;
  let emailSent = false;
  try {
    await ps.mailer.send({
      to: email,
      subject: `${p.name} invited you to ${result.org.name} on CloudTrain`,
      text: [
        `Hello${req.name ? ` ${req.name}` : ''},`,
        '',
        `${p.name} invited you to join ${result.org.name} on CloudTrain as ${roles.join(', ')}.`,
        viaSso ? `Sign in with your ${result.org.name} account (single sign-on):` : kcCreated ? 'Accept the invitation, then set your password from the separate "Update your account" email:' : 'Accept the invitation:',
        link,
        '',
        `This invitation expires on ${result.inv.expires_at.toISOString().slice(0, 10)}.`,
      ].join('\n'),
    });
    emailSent = true;
  } catch (e) {
    ps.log?.warn({ err: e }, 'invitation email failed');
  }
  if (kcCreated && ps.kc) await ps.kc.sendActionsEmail(userId, ['UPDATE_PASSWORD'], ps.config.oidcClientId, `${ps.config.webUrl}/`).catch((e: unknown) => ps.log?.warn({ err: e }, 'keycloak actions email failed'));
  return { invitation: toInvitation(result.inv, userRef({ id: p.sub, name: p.name, email: p.email }), ps.now()), user: result.user, emailSent };
}

export async function listInvitations(ps: PlatformService, p: Principal): Promise<Invitation[]> {
  authorize(p, 'user.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const rows = await tx.selectFrom('invitations as i').leftJoin('users as u', 'u.id', 'i.invited_by').selectAll('i').select(['u.name as by_name', 'u.email as by_email']).orderBy('i.created_at', 'desc').limit(200).execute();
    return rows.map((r) => toInvitation(r, r.invited_by ? { id: r.invited_by, name: r.by_name ?? '', email: r.by_email ?? '' } : UNKNOWN_USER, ps.now()));
  });
}

export async function revokeInvitation(ps: PlatformService, p: Principal, id: string, ip?: string): Promise<void> {
  authorize(p, 'user.manage', { kind: 'org' });
  await ps.tx(p, async (tx) => {
    const inv = await tx.selectFrom('invitations').selectAll().where('id', '=', id).executeTakeFirst();
    if (!inv) throw notFound('Invitation');
    await tx.updateTable('invitations').set({ revoked_at: new Date() }).where('id', '=', id).execute();
    if (inv.user_id) await tx.deleteFrom('memberships').where('user_id', '=', inv.user_id).where('status', '=', 'invited').execute();
    await audit(tx, actorOf(p, ip), 'invitation.revoke', 'invitation', id, { email: inv.email }, inv.email);
  });
}

/** Revokes the user's gateway sessions in this org and terminates their running labs. */
export async function cutOff(ps: PlatformService, orgId: string, userId: string): Promise<{ revokedSessions: number; terminatedLabs: number }> {
  const revokedSessions = ps.store ? await ps.store.revokeUser(userId, orgId) : 0;
  const labs = await ps.cluster.listSessions(`${LABEL_LEARNER}=${labelValue(userId)},${LABEL_ORG}=${labelValue(orgId)},${LABEL_MANAGED_BY}=${MANAGED_BY}`).catch(() => []);
  let terminatedLabs = 0;
  for (const ls of labs) {
    if (ls.spec.learner.id !== userId || ls.metadata.deletionTimestamp) continue;
    await ps.cluster.deleteSession(ls.metadata.name);
    await ps.orgTx(orgId, null, (tx) => endAttempt(tx, ls.metadata.name, ps.now()));
    terminatedLabs++;
  }
  return { revokedSessions, terminatedLabs };
}

export async function updateUser(ps: PlatformService, p: Principal, id: string, req: UpdateUserRequest, ip?: string): Promise<UpdateUserResponse> {
  authorize(p, 'user.manage', { kind: 'org' });
  if (req.roles) authorize(p, 'role.assign', { kind: 'org' });
  if (req.teams) authorize(p, 'team.manage', { kind: 'org' });
  if (req.status && !['active', 'deactivated'].includes(req.status)) throw badRequest('status must be active or deactivated', { status: 'invalid' });
  const roles = req.roles ? checkRoles(req.roles) : undefined;
  if (id === p.sub && (req.status === 'deactivated' || (roles && !roles.includes('org_admin') && p.roles.includes('org_admin')))) {
    throw conflict('You cannot deactivate yourself or remove your own org_admin role.');
  }
  const change = await ps.tx(p, async (tx) => {
    const m = await tx.selectFrom('memberships').selectAll().where('user_id', '=', id).executeTakeFirst();
    if (!m) throw notFound('User');
    const teams = req.teams ? await checkTeams(tx, req.teams) : undefined;
    const set: { roles?: string[]; status?: 'active' | 'deactivated'; updated_at: Date } = { updated_at: new Date() };
    if (roles) set.roles = roles;
    if (req.status && req.status !== m.status) set.status = req.status;
    await tx.updateTable('memberships').set(set).where('user_id', '=', id).execute();
    if (req.title !== undefined) await tx.updateTable('users').set({ title: req.title.slice(0, 120) || null }).where('id', '=', id).execute();
    if (teams) {
      await tx.deleteFrom('team_members').where('user_id', '=', id).execute();
      for (const t of teams) await tx.insertInto('team_members').values({ org_id: p.orgId, team_id: t.teamId, user_id: id, role: t.role, source: 'manual' }).execute();
    }
    const action = set.status === 'deactivated' ? 'user.deactivate' : set.status === 'active' && m.status === 'deactivated' ? 'user.reactivate' : 'user.update';
    await audit(tx, actorOf(p, ip), action, 'user', id, { ...(roles ? { roles, previousRoles: m.roles } : {}), ...(teams ? { teams } : {}), ...(set.status ? { status: set.status, previousStatus: m.status } : {}), ...(req.title !== undefined ? { title: req.title } : {}) });
    return { deactivated: set.status === 'deactivated' };
  });
  let cut: { revokedSessions: number; terminatedLabs: number } | undefined;
  if (change.deactivated) {
    cut = await cutOff(ps, p.orgId, id);
    await ps.tx(p, (tx) => audit(tx, actorOf(p, ip), 'user.deactivate', 'user', id, { phase: 'enforced', ...cut }));
  }
  return { user: await getUser(ps, p, id), ...(cut ?? {}) };
}

/* ------------------------------------------------------------------ teams */

export async function adminTeams(ps: PlatformService, p: Principal): Promise<Team[]> {
  authorize(p, 'team.manage', { kind: 'org' });
  return ps.tx(p, (tx) => teamsWithStats(tx));
}

export async function teamDetail(ps: PlatformService, p: Principal, id: string): Promise<TeamDetail> {
  authorize(p, 'team.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const [team] = await teamsWithStats(tx, [id]);
    if (!team) throw notFound('Team');
    const members = await tx.selectFrom('team_members as tm').innerJoin('users as u', 'u.id', 'tm.user_id').select(['u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url', 'tm.role']).where('tm.team_id', '=', id).orderBy('u.name').execute();
    const children = await tx.selectFrom('teams').select(['id', 'name']).where('parent_id', '=', id).orderBy('name').execute();
    return { ...team, members: members.map((m) => ({ user: userRef(m), role: m.role })), children };
  });
}

async function assertNoCycle(tx: Tx, id: string, parentId: string | null) {
  let cur = parentId;
  for (let i = 0; cur && i < 50; i++) {
    if (cur === id) throw badRequest('A team cannot be its own ancestor.', { parentId: 'cycle' });
    cur = (await tx.selectFrom('teams').select('parent_id').where('id', '=', cur).executeTakeFirst())?.parent_id ?? null;
  }
}

export async function createTeam(ps: PlatformService, p: Principal, req: CreateTeamRequest, ip?: string): Promise<Team> {
  authorize(p, 'team.manage', { kind: 'org' });
  const name = req?.name?.trim();
  if (!name) throw badRequest('name is required', { name: 'required' });
  return ps.tx(p, async (tx) => {
    if (req.parentId && !(await tx.selectFrom('teams').select('id').where('id', '=', req.parentId).executeTakeFirst())) throw notFound('Parent team');
    if (await tx.selectFrom('teams').select('id').where('name', '=', name).executeTakeFirst()) throw conflict(`A team named ${name} already exists.`);
    const t = await tx.insertInto('teams').values({ org_id: p.orgId, name, parent_id: req.parentId ?? null }).returning('id').executeTakeFirstOrThrow();
    await audit(tx, actorOf(p, ip), 'team.create', 'team', t.id, { parentId: req.parentId ?? null }, name);
    return (await teamsWithStats(tx, [t.id]))[0]!;
  });
}

export async function updateTeam(ps: PlatformService, p: Principal, id: string, req: UpdateTeamRequest, ip?: string): Promise<Team> {
  authorize(p, 'team.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const t = await tx.selectFrom('teams').selectAll().where('id', '=', id).executeTakeFirst();
    if (!t) throw notFound('Team');
    const set: { name?: string; parent_id?: string | null } = {};
    if (req.name !== undefined) {
      if (!req.name.trim()) throw badRequest('name cannot be empty', { name: 'required' });
      set.name = req.name.trim();
    }
    if (req.parentId !== undefined) {
      if (req.parentId && !(await tx.selectFrom('teams').select('id').where('id', '=', req.parentId).executeTakeFirst())) throw notFound('Parent team');
      await assertNoCycle(tx, id, req.parentId);
      set.parent_id = req.parentId;
    }
    if (Object.keys(set).length) {
      try {
        await tx.updateTable('teams').set(set).where('id', '=', id).execute();
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw conflict(`A team named ${set.name} already exists.`);
        throw e;
      }
    }
    await audit(tx, actorOf(p, ip), 'team.update', 'team', id, { ...set }, set.name ?? t.name);
    return (await teamsWithStats(tx, [id]))[0]!;
  });
}

export async function deleteTeam(ps: PlatformService, p: Principal, id: string, ip?: string): Promise<void> {
  authorize(p, 'team.manage', { kind: 'org' });
  await ps.tx(p, async (tx) => {
    const t = await tx.selectFrom('teams').selectAll().where('id', '=', id).executeTakeFirst();
    if (!t) throw notFound('Team');
    if (await tx.selectFrom('teams').select('id').where('parent_id', '=', id).executeTakeFirst()) throw conflict('Move or delete the sub-teams first.');
    await tx.deleteFrom('assignments').where('target_kind', '=', 'team').where('target_id', '=', id).execute();
    await tx.deleteFrom('teams').where('id', '=', id).execute();
    await audit(tx, actorOf(p, ip), 'team.delete', 'team', id, {}, t.name);
  });
}

export async function addTeamMember(ps: PlatformService, p: Principal, id: string, req: AddTeamMemberRequest, ip?: string): Promise<TeamDetail> {
  authorize(p, 'team.manage', { kind: 'org' });
  if (!req?.userId || !['member', 'manager'].includes(req.role)) throw badRequest('userId and role (member|manager) are required', { role: 'invalid' });
  await ps.tx(p, async (tx) => {
    const t = await tx.selectFrom('teams').select(['id', 'name']).where('id', '=', id).executeTakeFirst();
    if (!t) throw notFound('Team');
    if (!(await tx.selectFrom('memberships').select('user_id').where('user_id', '=', req.userId).executeTakeFirst())) throw notFound('User');
    await tx
      .insertInto('team_members')
      .values({ org_id: p.orgId, team_id: id, user_id: req.userId, role: req.role, source: 'manual' })
      .onConflict((oc) => oc.columns(['team_id', 'user_id']).doUpdateSet({ role: req.role, source: 'manual' }))
      .execute();
    await audit(tx, actorOf(p, ip), 'team.member_add', 'team', id, { userId: req.userId, role: req.role }, t.name);
  });
  return teamDetail(ps, p, id);
}

export async function removeTeamMember(ps: PlatformService, p: Principal, id: string, userId: string, ip?: string): Promise<void> {
  authorize(p, 'team.manage', { kind: 'org' });
  await ps.tx(p, async (tx) => {
    const d = await tx.deleteFrom('team_members').where('team_id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!Number(d.numDeletedRows)) throw notFound('Team member');
    await audit(tx, actorOf(p, ip), 'team.member_remove', 'team', id, { userId });
  });
}

/* -------------------------------------------------------- content visibility */

export async function contentVisibility(ps: PlatformService, p: Principal): Promise<ContentVisibility> {
  authorize(p, 'content.visibility', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const v = await ps.visibility(tx);
    return {
      packs: ps.content.packs.map((pk) => ({
        packId: pk.id,
        title: pk.title,
        domain: pk.domain,
        enabled: !v.disabledPacks.has(pk.id),
        labs: pk.labIds.map((id) => ({ labId: id, title: ps.labTitle(id), enabled: !v.disabledLabs.has(id) })),
      })),
      pinnedPaths: v.pinnedPaths,
      paths: ps.content.paths.map((x) => ({ id: x.id, title: x.title })),
    };
  });
}

export async function updateContentVisibility(ps: PlatformService, p: Principal, req: UpdateContentVisibilityRequest, ip?: string): Promise<ContentVisibility> {
  authorize(p, 'content.visibility', { kind: 'org' });
  const packs = req?.packs ?? [];
  const labs = req?.labs ?? [];
  for (const x of packs) if (!ps.content.packs.some((pk) => pk.id === x.packId)) throw badRequest(`Unknown pack ${x.packId}`, { packs: 'unknown' });
  for (const x of labs) if (!ps.content.labs.has(x.labId)) throw badRequest(`Unknown lab ${x.labId}`, { labs: 'unknown' });
  for (const id of req?.pinnedPaths ?? []) if (!ps.content.paths.some((x) => x.id === id)) throw badRequest(`Unknown path ${id}`, { pinnedPaths: 'unknown' });
  await ps.tx(p, async (tx) => {
    const upsert = (kind: 'pack' | 'lab' | 'path', ref: string, enabled: boolean, pinned: boolean) =>
      tx
        .insertInto('content_visibility')
        .values({ org_id: p.orgId, kind, ref_id: ref, enabled, pinned })
        .onConflict((oc) => oc.columns(['org_id', 'kind', 'ref_id']).doUpdateSet({ enabled, pinned }))
        .execute();
    for (const x of packs) await upsert('pack', x.packId, !!x.enabled, false);
    for (const x of labs) await upsert('lab', x.labId, !!x.enabled, false);
    if (req.pinnedPaths) {
      await tx.deleteFrom('content_visibility').where('kind', '=', 'path').execute();
      for (const id of req.pinnedPaths) await upsert('path', id, true, true);
    }
    await audit(tx, actorOf(p, ip), 'content.visibility', 'org', p.orgId, { packs, labs, ...(req.pinnedPaths ? { pinnedPaths: req.pinnedPaths } : {}) });
  });
  return contentVisibility(ps, p);
}

/* ---------------------------------------------------------- usage + quotas */

export async function usage(ps: PlatformService, p: Principal, fromQ?: string, toQ?: string): Promise<Usage> {
  authorize(p, 'quota.manage', { kind: 'org' });
  const now = ps.now();
  const from = fromQ ? new Date(fromQ) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = toQ ? new Date(toQ) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw badRequest('from/to must be ISO dates with from <= to');
  const concurrentNow = (await ps.liveClusterSessions(p.orgId).catch(() => [])).length;
  return ps.tx(p, async (tx) => {
    const rows = await tx.selectFrom('lab_attempts').select(['user_id', 'lab_id', 'started_at', 'ended_at', 'duration_s']).where('started_at', '>=', from).where('started_at', '<=', to).execute();
    const secs = (r: (typeof rows)[number]) => (r.ended_at ? r.duration_s : Math.max(r.duration_s, (now.getTime() - r.started_at.getTime()) / 1000));
    const h = (s: number) => Math.round((s / 3600) * 10) / 10;
    const byDay = new Map<string, { s: number; n: number }>();
    const byLab = new Map<string, { s: number; n: number }>();
    for (const r of rows) {
      const d = r.started_at.toISOString().slice(0, 10);
      const a = byDay.get(d) ?? { s: 0, n: 0 };
      byDay.set(d, { s: a.s + secs(r), n: a.n + 1 });
      const b = byLab.get(r.lab_id) ?? { s: 0, n: 0 };
      byLab.set(r.lab_id, { s: b.s + secs(r), n: b.n + 1 });
    }
    const tm = await tx.selectFrom('team_members as tm').innerJoin('teams as t', 't.id', 'tm.team_id').select(['tm.user_id', 't.id', 't.name']).execute();
    const byTeam = new Map<string, { name: string; s: number }>();
    for (const r of rows) {
      for (const t of tm.filter((x) => x.user_id === r.user_id)) {
        const a = byTeam.get(t.id) ?? { name: t.name, s: 0 };
        byTeam.set(t.id, { name: t.name, s: a.s + secs(r) });
      }
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      quotas: await ps.quotas(tx, p.orgId),
      labHours: h(rows.reduce((a, r) => a + secs(r), 0)),
      labHoursThisMonth: await ps.labHoursThisMonth(tx),
      sessions: rows.length,
      activeUsers: new Set(rows.map((r) => r.user_id)).size,
      concurrentNow,
      byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, labHours: h(v.s), sessions: v.n })),
      byLab: [...byLab].map(([labId, v]) => ({ labId, title: ps.labTitle(labId), sessions: v.n, labHours: h(v.s) })).sort((a, b) => b.labHours - a.labHours),
      byTeam: [...byTeam].map(([teamId, v]) => ({ teamId, name: v.name, labHours: h(v.s) })).sort((a, b) => b.labHours - a.labHours),
    };
  });
}

export async function getQuotas(ps: PlatformService, p: Principal): Promise<Quotas> {
  authorize(p, 'quota.manage', { kind: 'org' });
  return ps.tx(p, (tx) => ps.quotas(tx, p.orgId));
}

export function checkQuotas(req: UpdateQuotasRequest | undefined): UpdateQuotasRequest {
  const out: UpdateQuotasRequest = {};
  const int = (k: keyof Quotas, lo: number, hi: number) => {
    const v = req?.[k];
    if (v === undefined) return;
    if (!Number.isInteger(v) || v < lo || v > hi) throw badRequest(`${k} must be an integer between ${lo} and ${hi}`, { [k]: 'invalid' });
    out[k] = v;
  };
  int('maxConcurrentSessions', 0, 10_000);
  int('monthlyLabHours', 0, 1_000_000);
  int('maxSessionMinutes', 5, 1440);
  return out;
}

export async function writeQuotas(tx: Tx, orgId: string, cur: Quotas, q: UpdateQuotasRequest): Promise<Quotas> {
  const next = { ...cur, ...q };
  const v = { max_concurrent_sessions: next.maxConcurrentSessions, monthly_lab_hours: next.monthlyLabHours, max_session_minutes: next.maxSessionMinutes };
  await tx
    .insertInto('quotas')
    .values({ org_id: orgId, ...v })
    .onConflict((oc) => oc.column('org_id').doUpdateSet(v))
    .execute();
  return next;
}

export async function updateQuotas(ps: PlatformService, p: Principal, req: UpdateQuotasRequest, ip?: string): Promise<Quotas> {
  authorize(p, 'quota.manage', { kind: 'org' });
  const q = checkQuotas(req);
  return ps.tx(p, async (tx) => {
    const cur = await ps.quotas(tx, p.orgId);
    const next = await writeQuotas(tx, p.orgId, cur, q);
    await audit(tx, actorOf(p, ip), 'quota.update', 'org', p.orgId, { previous: cur, next });
    return next;
  });
}

/* ------------------------------------------------------------------- audit */

export async function toAuditEvents(tx: Tx, rows: AuditRow[]): Promise<AuditEvent[]> {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const users = ids.length ? await tx.selectFrom('users').selectAll().where('id', 'in', ids).execute() : [];
  return rows.map((r) => {
    const u = users.find((x) => x.id === r.actor_id);
    return {
      id: String(r.id),
      at: r.at.toISOString(),
      actor: r.actor_id ? (u ? userRef(u) : { id: r.actor_id, name: r.actor_name ?? r.actor_id, email: '' }) : null,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      ...(r.target_label ? { targetLabel: r.target_label } : {}),
      ...(r.ip ? { ip: r.ip } : {}),
      details: r.details,
    };
  });
}

function auditQuery(tx: Tx, q: AuditQuery) {
  let query = tx.selectFrom('audit_log').selectAll();
  if (q.from) query = query.where('at', '>=', new Date(q.from));
  if (q.to) query = query.where('at', '<=', new Date(q.to));
  if (q.actor) query = query.where('actor_id', '=', q.actor);
  if (q.action) query = q.action.endsWith('.') ? query.where('action', 'like', `${q.action.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : query.where('action', '=', q.action);
  if (q.targetType) query = query.where('target_type', '=', q.targetType);
  if (q.targetId) query = query.where('target_id', '=', q.targetId);
  return query.orderBy('at', 'desc').orderBy('id', 'desc');
}

export async function auditPage(ps: PlatformService, p: Principal, q: AuditQuery): Promise<Page<AuditEvent>> {
  authorize(p, 'audit.read', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const limit = pageLimit(q.limit);
    let query = auditQuery(tx, q);
    const cur = decodeCursor<[string, string]>(q.cursor);
    if (cur) query = query.where((eb) => eb.or([eb('at', '<', new Date(cur[0])), eb.and([eb('at', '=', new Date(cur[0])), eb('id', '<', cur[1])])]));
    const rows = await query.limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await toAuditEvents(tx, page), nextCursor: rows.length > limit && last ? encodeCursor([last.at.toISOString(), String(last.id)]) : null };
  });
}

export async function auditCsv(ps: PlatformService, p: Principal, q: AuditQuery, ip?: string): Promise<string> {
  authorize(p, 'audit.read', { kind: 'org' });
  return ps.tx(p, async (tx) => {
    const rows = await auditQuery(tx, q).limit(50_000).execute();
    const events = await toAuditEvents(tx, rows);
    let out = csvLine(['id', 'at', 'actor_id', 'actor_name', 'actor_email', 'action', 'target_type', 'target_id', 'target_label', 'ip', 'details']);
    for (const e of events) out += csvLine([e.id, e.at, e.actor?.id ?? '', e.actor?.name ?? '', e.actor?.email ?? '', e.action, e.targetType, e.targetId, e.targetLabel ?? '', e.ip ?? '', JSON.stringify(e.details)]);
    await audit(tx, actorOf(p, ip), 'audit.export', 'org', p.orgId, { rows: events.length, filter: q });
    return out;
  });
}

/* ---------------------------------------------------------------- settings */

export async function getSettings(ps: PlatformService, p: Principal): Promise<OrgSettingsResponse> {
  authorize(p, 'settings.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => ({ org: await orgOf(tx, p.orgId) }));
}

export async function updateSettings(ps: PlatformService, p: Principal, req: UpdateOrgSettingsRequest, ip?: string): Promise<OrgSettingsResponse> {
  authorize(p, 'settings.manage', { kind: 'org' });
  const s = req?.settings ?? {};
  if (s.defaultSessionMinutes !== undefined && (!Number.isInteger(s.defaultSessionMinutes) || s.defaultSessionMinutes < 5 || s.defaultSessionMinutes > 1440)) throw badRequest('defaultSessionMinutes must be 5..1440', { defaultSessionMinutes: 'invalid' });
  if (s.logoUrl !== undefined && s.logoUrl !== '' && !/^https?:\/\//.test(s.logoUrl)) throw badRequest('logoUrl must be an http(s) URL', { logoUrl: 'invalid' });
  if (s.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(s.accentColor)) throw badRequest('accentColor must be #rrggbb', { accentColor: 'invalid' });
  if (s.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: s.timezone });
    } catch {
      throw badRequest('timezone must be an IANA zone', { timezone: 'invalid' });
    }
  }
  if (req?.name !== undefined && !req.name.trim()) throw badRequest('name cannot be empty', { name: 'required' });
  return ps.tx(p, async (tx) => {
    const o = await tx.selectFrom('orgs').selectAll().where('id', '=', p.orgId).executeTakeFirstOrThrow();
    const settings = { ...o.settings, ...s };
    await tx.updateTable('orgs').set({ ...(req.name ? { name: req.name.trim() } : {}), settings: JSON.stringify(settings) }).where('id', '=', p.orgId).execute();
    await audit(tx, actorOf(p, ip), 'settings.update', 'org', p.orgId, { ...(req.name ? { name: req.name } : {}), settings: s });
    return { org: await orgOf(tx, p.orgId) };
  });
}

