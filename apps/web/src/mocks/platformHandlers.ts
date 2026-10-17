/**
 * Mock platform API (identity, roles, assignments, cohorts, admin, platform).
 * Mirrors docs/api/platform.md. State lives in memory and resets on reload,
 * except the signed-in persona, which is kept in localStorage so a reload (or a
 * screenshot run) lands on the same account.
 */
import { http, HttpResponse, delay } from 'msw';
import type {
  AddCohortMembersRequest,
  AddDomainRequest,
  AddTeamMemberRequest,
  AdminOverview,
  Assignment,
  AuditEvent,
  AuthDiscovery,
  Cohort,
  CreateAssignmentRequest,
  CreateCohortRequest,
  CreatePlatformOrgRequest,
  CreateSsoConnectionRequest,
  CreateTeamRequest,
  ExtendSessionRequest,
  InviteUserRequest,
  Me,
  OrgDomain,
  OrgRole,
  OrgUser,
  Page,
  PlatformOrg,
  Quotas,
  Role,
  SessionControlResponse,
  SsoConnection,
  SsoTestResult,
  Team,
  UpdateContentVisibilityRequest,
  UpdateOrgSettingsRequest,
  UpdatePlatformOrgRequest,
  UpdateSsoConnectionRequest,
  UpdateTeamRequest,
  UpdateUserRequest,
  UserRef,
} from '@/api/types';
import { labById, labSummaries, paths } from './fixtures/labs';
import { frameworks } from './fixtures/skills';
import {
  DEFAULT_PERSONA,
  ORG_ACME,
  ORG_QUILLMOOR,
  assignedUsers,
  assignmentSeeds,
  attemptsFor,
  auditOf,
  capacity,
  cohortBoard,
  cohortSeeds,
  contentVisibilityOf,
  domainsByOrg,
  grantsFor,
  invitations,
  liveSeeds,
  liveSession,
  liveSessionsOf,
  memberDetail,
  myAssignments,
  orgs,
  people,
  permissionsFor,
  personById,
  personas,
  platformOrgs,
  platformPacks,
  quotasByOrg,
  ssoByOrg,
  statusFor,
  teamDashboard,
  teamDetail,
  teamSeedById,
  teamsOfOrg,
  toAssignment,
  toCohort,
  usageOf,
  userRef,
  usersOfOrg,
  viewableTeams,
} from './fixtures/platform';

const latency = () => delay(150 + Math.random() * 250);
const json = <T>(body: T, status = 200) => HttpResponse.json(body as unknown as Record<string, unknown>, { status });
const notFound = (what: string) => HttpResponse.json({ error: `${what} not found`, code: 'not_found' }, { status: 404 });
const forbidden = (permission: string) => HttpResponse.json({ error: `You need the ${permission} permission for this`, code: 'forbidden', permission }, { status: 403 });
const unauthenticated = () => HttpResponse.json({ error: 'Not signed in', code: 'unauthenticated' }, { status: 401 });

/* ------------------------------------------------------------------ */
/* Session (persona)                                                    */
/* ------------------------------------------------------------------ */

const SESSION_KEY = 'ct.mock.session';
interface MockSession {
  userId: string;
  orgId: string;
  /** Mimics a gateway dev sign-in-as session (banner screenshots). */
  impersonated?: boolean;
}

function readSession(): MockSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === 'none') return null;
    if (raw) return JSON.parse(raw) as MockSession;
  } catch {
    /* ignore */
  }
  const p = personas.find((x) => x.id === DEFAULT_PERSONA)!;
  return { userId: p.userId, orgId: p.orgId };
}
function writeSession(s: MockSession | null) {
  try {
    localStorage.setItem(SESSION_KEY, s ? JSON.stringify(s) : 'none');
  } catch {
    /* ignore */
  }
}
/** Current mock principal, for other handlers (Home greeting, Studio author). */
export function currentUser(): UserRef | undefined {
  const s = readSession();
  return s ? userRef(s.userId) : undefined;
}
export function currentSession(): MockSession | null {
  return readSession();
}

const legacyRole = (roles: Role[]): 'learner' | 'manager' | 'admin' => (roles.includes('org_admin') || roles.includes('platform_admin') ? 'admin' : roles.includes('manager') ? 'manager' : 'learner');

function buildMe(s: MockSession): Me | undefined {
  const p = personById.get(s.userId);
  if (!p) return undefined;
  const orgRoles: Role[] = [...(p.orgs[s.orgId] ?? [])];
  if (!orgRoles.includes('learner')) orgRoles.unshift('learner');
  const roles: Role[] = p.platformAdmin ? [...orgRoles, 'platform_admin'] : orgRoles;
  const managed = viewableTeams(s.userId, s.orgId);
  const instructed = cohortSeeds.filter((c) => c.orgId === s.orgId && (c.instructors.some((i) => i.id === s.userId) || orgRoles.includes('org_admin'))).map((c) => ({ id: c.id, name: c.name }));
  const org = orgs[s.orgId];
  const teams = p.teams.filter((t) => teamSeedById(t.teamId)?.orgId === s.orgId).map((t) => ({ id: t.teamId, name: teamSeedById(t.teamId)!.name, role: t.role }));
  const supportAccess = p.platformAdmin && s.orgId === ORG_QUILLMOOR.id ? { orgId: s.orgId, expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString() } : undefined;
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    role: legacyRole(roles),
    team: teams[0]?.name ?? '',
    org: org?.name ?? '',
    // Like the gateway: only graded practice (a Validate run) counts toward streak and time.
    streakDays: p.id === 'u-ingrid' ? 6 : Math.round(attemptsFor(p.id).filter((a) => a.validations > 0).length / 3),
    minutesThisWeek: Math.round(attemptsFor(p.id).filter((a) => a.validations > 0 && Date.now() - new Date(a.startedAt).getTime() < 7 * 86_400_000).reduce((x, a) => x + a.durationS / 60, 0)),
    user: { ...userRef(p.id), lastLoginAt: p.lastLoginDaysAgo === undefined ? undefined : new Date(Date.now() - p.lastLoginDaysAgo * 86_400_000).toISOString() },
    activeOrg: org ? { id: org.id, slug: org.slug, name: org.name } : null,
    memberships: Object.entries(p.orgs).map(([orgId, r]) => ({ org: { id: orgs[orgId]!.id, slug: orgs[orgId]!.slug, name: orgs[orgId]!.name }, roles: r, status: p.status ?? 'active' })),
    roles,
    permissions: permissionsFor(roles),
    grants: grantsFor(
      roles,
      managed.map((t) => t.id),
      instructed.map((c) => c.id),
    ),
    teams,
    managedTeams: managed,
    instructedCohorts: instructed,
    cohorts: cohortSeeds.filter((c) => c.memberIds.includes(p.id) && c.orgId === s.orgId).map((c) => ({ id: c.id, name: c.name })),
    platformAdmin: !!p.platformAdmin,
    csrfToken: 'mock-csrf-token',
    auth: s.impersonated
      ? { method: 'dev-impersonation', impersonated: true, sessionExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString() }
      : { method: 'dev', idp: s.orgId === ORG_QUILLMOOR.id && !p.platformAdmin ? 'quillmoor-entra' : undefined, sessionExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString() },
    supportAccess,
  };
}

/** Principal of the current request, or undefined when signed out. */
function me(): Me | undefined {
  const s = readSession();
  return s ? buildMe(s) : undefined;
}
/** The mock principal (permissions, managed teams) for other handler modules (exams). */
export const currentMe = (): Me | undefined => me();

/* ------------------------------------------------------------------ */
/* Mutable state                                                        */
/* ------------------------------------------------------------------ */

const state = {
  overrides: new Map<string, Partial<OrgUser>>(),
  invitations: structuredClone(invitations),
  extraTeams: [] as Team[],
  teamRenames: new Map<string, string>(),
  extraMembers: new Map<string, { userId: string; role: 'member' | 'manager' }[]>(),
  assignments: [] as Assignment[],
  deletedAssignments: new Set<string>(),
  cohorts: [] as Cohort[],
  sso: structuredClone(ssoByOrg),
  domains: structuredClone(domainsByOrg),
  content: new Map<string, ReturnType<typeof contentVisibilityOf>>(),
  quotas: structuredClone(quotasByOrg),
  settings: structuredClone(orgs),
  platformOrgs: structuredClone(platformOrgs),
  audit: new Map<string, AuditEvent[]>(),
  extended: new Map<string, number>(),
  terminated: new Set<string>(),
  observing: new Map<string, UserRef[]>(),
  broadcasts: [] as { cohortId: string; message: string; kind: 'info' | 'hint'; at: string; from: UserRef }[],
};

function audit(orgId: string, actor: Me, action: string, targetType: string, targetId: string, targetLabel?: string, details: Record<string, unknown> = {}) {
  const list = state.audit.get(orgId) ?? [];
  list.unshift({ id: `ae-live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), actor: actor.user, action, targetType, targetId, targetLabel, ip: '10.20.4.17', details });
  state.audit.set(orgId, list);
}
function auditLog(orgId: string): AuditEvent[] {
  return [...(state.audit.get(orgId) ?? []), ...auditOf(orgId)];
}

const usersOf = (orgId: string): OrgUser[] => usersOfOrg(orgId).map((u) => ({ ...u, ...(state.overrides.get(`${orgId}:${u.id}`) ?? {}) }));
const teamsOf = (orgId: string): Team[] => [...teamsOfOrg(orgId), ...state.extraTeams].map((t) => ({ ...t, name: state.teamRenames.get(t.id) ?? t.name, memberCount: t.memberCount + (state.extraMembers.get(t.id)?.length ?? 0) }));

function requirePerm(m: Me | undefined, perm: Me['permissions'][number]) {
  if (!m) return unauthenticated();
  if (!m.permissions.includes(perm)) return forbidden(perm);
  return undefined;
}

const page = <T>(items: T[], url: URL): Page<T> => {
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
  const offset = Number(url.searchParams.get('cursor')) || 0;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, nextCursor: offset + limit < items.length ? String(offset + limit) : null, total: items.length };
};

const csv = (rows: (string | number | null | undefined)[][]) =>
  new HttpResponse(rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8' },
  });

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

export const authHandlers = [
  http.get('/api/auth/discover', async ({ request }) => {
    await delay(350);
    const email = (new URL(request.url).searchParams.get('email') ?? '').trim().toLowerCase();
    const domain = email.split('@')[1] ?? '';
    const base = `/api/auth/login?email=${encodeURIComponent(email)}`;
    let out: AuthDiscovery;
    if (domain === 'quillmoor.example' || domain === 'depot.quillmoor.example') out = { email, method: 'sso', org: ORG_QUILLMOOR, idpAlias: 'quillmoor-entra', idpDisplayName: 'Microsoft Entra ID', loginUrl: `${base}&org=quillmoor` };
    else if (domain === 'acmefreight.example') out = { email, method: 'local', org: ORG_ACME, loginUrl: `${base}&org=acme-freight` };
    else if (domain === 'azarguard.example') out = { email, method: 'sso', org: ORG_ACME, idpAlias: 'azarguard-entra', idpDisplayName: 'AzarGuard Entra ID', loginUrl: `${base}` };
    else out = { email, method: 'unknown', loginUrl: base };
    return json(out);
  }),
  /** Mock-only: completes a login the sign-in page would otherwise hand to Keycloak. */
  http.post('/api/auth/mock-login', async ({ request }) => {
    await delay(600);
    const body = (await request.json()) as { email: string; password?: string };
    const p = people.find((x) => x.email.toLowerCase() === body.email.trim().toLowerCase());
    if (!p) return HttpResponse.json({ error: 'No account with that email in this organisation', code: 'not_found' }, { status: 404 });
    if (p.status === 'deactivated') return HttpResponse.json({ error: 'This account has been deactivated. Ask your administrator.', code: 'deactivated' }, { status: 403 });
    if (body.password !== undefined && body.password.length < 4) return HttpResponse.json({ error: 'Wrong email or password', code: 'invalid' }, { status: 422 });
    const orgId = Object.keys(p.orgs)[0]!;
    writeSession({ userId: p.id, orgId });
    return json(buildMe({ userId: p.id, orgId }));
  }),
  http.post('/api/auth/logout', async () => {
    await delay(200);
    writeSession(null);
    return json({ redirectUrl: '/sign-in?signedOut=1' });
  }),
  /** Mock-only dev persona switcher. */
  http.get('/api/dev/personas', async () => json(personas)),
  http.post('/api/dev/persona', async ({ request }) => {
    await delay(120);
    const body = (await request.json()) as { persona?: string; userId?: string; orgId?: string };
    const p = personas.find((x) => x.id === body.persona);
    const s: MockSession | null = p ? { userId: p.userId, orgId: p.orgId } : body.userId && body.orgId ? { userId: body.userId, orgId: body.orgId } : null;
    writeSession(s);
    return s ? json(buildMe(s)) : new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/me', async () => {
    await delay(120);
    const m = me();
    return m ? json(m) : unauthenticated();
  }),
  http.post('/api/me/org', async ({ request }) => {
    await delay(300);
    const s = readSession();
    if (!s) return unauthenticated();
    const { orgId } = (await request.json()) as { orgId: string };
    const p = personById.get(s.userId);
    if (!p?.orgs[orgId]) return forbidden('org.manage');
    writeSession({ ...s, orgId });
    return json(buildMe({ ...s, orgId }));
  }),
];

/* ------------------------------------------------------------------ */
/* Learner                                                              */
/* ------------------------------------------------------------------ */

export const learnerHandlers = [
  http.get('/api/assignments/mine', async () => {
    await latency();
    const m = me();
    if (!m) return unauthenticated();
    const live = state.assignments.filter((a) => !state.deletedAssignments.has(a.id) && ((a.target.kind === 'user' && a.target.id === m.id) || (a.target.kind === 'team' && m.teams.some((t) => t.id === a.target.id)) || (a.target.kind === 'cohort' && m.cohorts.some((c) => c.id === a.target.id))));
    const mine = myAssignments(m.id).filter((a) => !state.deletedAssignments.has(a.id));
    return json([...live.map((a) => ({ id: a.id, item: a.item, via: a.target, dueAt: a.dueAt, required: a.required, note: a.note, assignedBy: a.assignedBy, createdAt: a.createdAt, status: 'not_started' as const, progress: 0 })), ...mine]);
  }),
  http.get('/api/attempts/mine', async ({ request }) => {
    await latency();
    const m = me();
    if (!m) return unauthenticated();
    const url = new URL(request.url);
    let items = attemptsFor(m.id);
    const lab = url.searchParams.get('lab');
    const outcome = url.searchParams.get('outcome');
    if (lab) items = items.filter((a) => a.labId === lab);
    if (outcome) items = items.filter((a) => a.outcome === outcome);
    return json(page(items, url));
  }),
  http.get('/api/attempts/:id', async ({ params }) => {
    await latency();
    const m = me();
    if (!m) return unauthenticated();
    const id = String(params.id);
    const owner = people.find((p) => attemptsFor(p.id).some((a) => a.id === id));
    const a = owner && attemptsFor(owner.id).find((x) => x.id === id);
    if (!a || !owner) return notFound('Attempt');
    const spec = labById.get(a.labId)?.spec.checks ?? [];
    const checks = Array.from({ length: a.checksTotal }, (_, i) => {
      const c = spec[i % Math.max(1, spec.length)];
      return { checkId: c?.id ?? `check-${i + 1}`, passed: i < a.checksPassed, weight: c?.weight ?? 1, skills: c?.skills ?? [], run: a.validations, gradedAt: a.endedAt ?? a.startedAt, message: c?.description };
    });
    return json({ ...a, user: userRef(owner.id), checks, history: checks });
  }),
];

/* ------------------------------------------------------------------ */
/* Manager                                                              */
/* ------------------------------------------------------------------ */

function allAssignments(orgId: string): Assignment[] {
  return [...state.assignments, ...assignmentSeeds.filter((a) => a.orgId === orgId).map(toAssignment)].filter((a) => !state.deletedAssignments.has(a.id));
}

export const managerHandlers = [
  http.get('/api/teams', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'progress.read.team');
    if (denied || !m) return denied ?? unauthenticated();
    const ids = new Set(m.managedTeams.map((t) => t.id));
    return json(teamsOf(m.activeOrg!.id).filter((t) => ids.has(t.id)));
  }),
  http.get('/api/teams/:id/dashboard', async ({ params }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'progress.read.team');
    if (denied || !m) return denied ?? unauthenticated();
    if (!m.managedTeams.some((t) => t.id === params.id)) return forbidden('progress.read.team');
    const d = teamDashboard(String(params.id), m.id, m.activeOrg!.id);
    return d ? json(d) : notFound('Team');
  }),
  http.get('/api/teams/:id/members/:userId', async ({ params }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'progress.read.team');
    if (denied || !m) return denied ?? unauthenticated();
    if (!m.managedTeams.some((t) => t.id === params.id)) return forbidden('progress.read.team');
    const d = memberDetail(String(params.id), String(params.userId));
    return d ? json(d) : notFound('Member');
  }),
  http.get('/api/assignments', async ({ request }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'assignment.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const url = new URL(request.url);
    const team = url.searchParams.get('team');
    const managed = new Set(m.managedTeams.map((t) => t.id));
    const cohorts = new Set(m.instructedCohorts.map((c) => c.id));
    const orgWide = m.grants.some((g) => g.permission === 'assignment.manage' && g.scope === 'org');
    let items = allAssignments(m.activeOrg!.id).filter((a) => orgWide || (a.target.kind === 'team' && managed.has(a.target.id)) || (a.target.kind === 'cohort' && cohorts.has(a.target.id)) || a.target.kind === 'user');
    if (team) items = items.filter((a) => (a.target.kind === 'team' && a.target.id === team) || (a.target.kind === 'user' && teamDetail(team)?.members.some((x) => x.user.id === a.target.id)));
    const st = url.searchParams.get('state');
    if (st) items = items.filter((a) => (a.counts[st as keyof typeof a.counts] ?? 0) > 0);
    return json(page(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), url));
  }),
  http.get('/api/assignments/:id', async ({ params }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'assignment.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const seed = assignmentSeeds.find((a) => a.id === params.id);
    const a = allAssignments(m.activeOrg!.id).find((x) => x.id === params.id);
    if (!a) return notFound('Assignment');
    const statuses = seed ? assignedUsers(seed).map((u) => ({ assignmentId: a.id, user: userRef(u), ...statusFor(seed, u) })) : [];
    return json({ assignment: a, statuses });
  }),
  http.post('/api/assignments', async ({ request }) => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'assignment.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as CreateAssignmentRequest;
    if (!body.targets?.length) return HttpResponse.json({ error: 'Pick at least one person or team', code: 'invalid', details: { targets: 'required' } }, { status: 422 });
    const item = body.item.kind === 'lab' ? { kind: 'lab' as const, id: body.item.id, title: labSummaries.find((l) => l.id === body.item.id)?.title, labIds: [body.item.id] } : body.item.kind === 'path' ? { kind: 'path' as const, id: body.item.id, title: paths.find((p) => p.id === body.item.id)?.title, labIds: paths.find((p) => p.id === body.item.id)?.labIds } : { kind: 'framework' as const, id: body.item.id, title: `${frameworks.find((f) => f.id === body.item.id)?.name ?? body.item.id} readiness`, labIds: paths.find((p) => p.framework === body.item.id)?.labIds };
    const created: Assignment[] = body.targets.map((t) => {
      const name = t.kind === 'team' ? teamsOf(m.activeOrg!.id).find((x) => x.id === t.id)?.name : t.kind === 'user' ? personById.get(t.id)?.name : cohortSeeds.find((c) => c.id === t.id)?.name;
      const size = t.kind === 'team' ? (teamDetail(t.id)?.members.length ?? 0) : t.kind === 'cohort' ? (cohortSeeds.find((c) => c.id === t.id)?.memberCount ?? 0) : 1;
      return { id: `as-${Math.random().toString(36).slice(2, 7)}`, target: { ...t, name }, item, dueAt: body.dueAt ?? null, required: !!body.required, note: body.note, assignedBy: m.user, createdAt: new Date().toISOString(), counts: { not_started: size, in_progress: 0, completed: 0, overdue: 0 } };
    });
    state.assignments.unshift(...created);
    created.forEach((a) => audit(m.activeOrg!.id, m, 'assignment.create', 'assignment', a.id, `${a.item.title} → ${a.target.name}`, { target: `${a.target.kind}:${a.target.id}`, dueAt: a.dueAt, required: a.required }));
    return json({ assignments: created }, 201);
  }),
  http.delete('/api/assignments/:id', async ({ params }) => {
    await delay(250);
    const m = me();
    const denied = requirePerm(m, 'assignment.manage');
    if (denied || !m) return denied ?? unauthenticated();
    state.deletedAssignments.add(String(params.id));
    audit(m.activeOrg!.id, m, 'assignment.delete', 'assignment', String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/reports/progress.csv', async ({ request }) => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'report.export');
    if (denied || !m) return denied ?? unauthenticated();
    const team = new URL(request.url).searchParams.get('team') ?? m.managedTeams[0]?.id ?? '';
    const t = teamDetail(team);
    if (!t) return notFound('Team');
    audit(m.activeOrg!.id, m, 'report.export', 'team', team, t.name, { format: 'csv' });
    const rows: (string | number | null)[][] = [['user_id', 'name', 'email', 'team', 'assignment_id', 'item_kind', 'item_id', 'due_at', 'status', 'progress', 'best_score', 'attempts', 'minutes']];
    for (const mem of t.members) {
      const attempts = attemptsFor(mem.user.id);
      const minutes = Math.round(attempts.reduce((s, a) => s + a.durationS / 60, 0));
      const mine = myAssignments(mem.user.id);
      if (!mine.length) rows.push([mem.user.id, mem.user.name, mem.user.email, t.name, '', '', '', '', '', '', '', attempts.length, minutes]);
      for (const a of mine) rows.push([mem.user.id, mem.user.name, mem.user.email, t.name, a.id, a.item.kind, a.item.id, a.dueAt, a.status, a.progress, a.bestScore ?? null, attempts.filter((x) => a.item.labIds?.includes(x.labId)).length, minutes]);
    }
    return csv(rows);
  }),
];

/* ------------------------------------------------------------------ */
/* Instructor                                                           */
/* ------------------------------------------------------------------ */

const cohortsOf = (m: Me): Cohort[] => {
  const orgWide = m.grants.some((g) => g.permission === 'cohort.manage' && g.scope === 'org');
  return [...state.cohorts, ...cohortSeeds.filter((c) => c.orgId === m.activeOrg!.id).map(toCohort)].filter((c) => orgWide || c.instructors.some((i) => i.id === m.id));
};

export const instructorHandlers = [
  http.get('/api/cohorts', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'cohort.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(cohortsOf(m));
  }),
  http.post('/api/cohorts', async ({ request }) => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'cohort.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as CreateCohortRequest;
    if (!body.name?.trim()) return HttpResponse.json({ error: 'A cohort needs a name', code: 'invalid', details: { name: 'required' } }, { status: 422 });
    const now = Date.now();
    const c: Cohort = {
      id: `c-${Math.random().toString(36).slice(2, 7)}`,
      name: body.name.trim(),
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      status: new Date(body.startsAt).getTime() > now ? 'upcoming' : new Date(body.endsAt).getTime() < now ? 'ended' : 'live',
      instructors: (body.instructorIds?.length ? body.instructorIds : [m.id]).map(userRef),
      memberCount: body.memberIds?.length ?? 0,
      pathId: body.pathId,
      labIds: body.labIds ?? (body.pathId ? (paths.find((p) => p.id === body.pathId)?.labIds ?? []) : []),
      createdBy: m.user,
    };
    state.cohorts.unshift(c);
    audit(m.activeOrg!.id, m, 'cohort.create', 'cohort', c.id, c.name, { members: c.memberCount, labs: c.labIds.length });
    return json(c, 201);
  }),
  http.get('/api/cohorts/:id', async ({ params }) => {
    await latency();
    const m = me();
    if (!m) return unauthenticated();
    const c = cohortsOf(m).find((x) => x.id === params.id);
    return c ? json(c) : notFound('Cohort');
  }),
  http.post('/api/cohorts/:id/members', async ({ params, request }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'cohort.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as AddCohortMembersRequest;
    const c = cohortsOf(m).find((x) => x.id === params.id);
    if (!c) return notFound('Cohort');
    c.memberCount += body.userIds.length;
    audit(m.activeOrg!.id, m, 'cohort.member_add', 'cohort', c.id, c.name, { userIds: body.userIds });
    return json(c);
  }),
  http.get('/api/cohorts/:id/board', async ({ params }) => {
    await delay(200);
    const m = me();
    const denied = requirePerm(m, 'progress.read.team');
    if (denied || !m) return denied ?? unauthenticated();
    const created = state.cohorts.find((c) => c.id === params.id);
    if (created) return json({ cohort: created, rows: [], generatedAt: new Date().toISOString() });
    const b = cohortBoard(String(params.id));
    if (!b) return notFound('Cohort');
    // Live edits: terminated sessions vanish, extensions move the expiry, observers show up.
    b.rows = b.rows.map((r) => {
      if (!r.session) return r;
      if (state.terminated.has(r.session.id)) return { ...r, session: null };
      const extra = state.extended.get(r.session.id);
      const observedBy = state.observing.get(r.session.id) ?? r.session.observedBy;
      return { ...r, session: { ...r.session, observedBy, expiresAt: extra && r.session.expiresAt ? new Date(new Date(r.session.expiresAt).getTime() + extra * 60_000).toISOString() : r.session.expiresAt } };
    });
    return json(b);
  }),
  http.post('/api/cohorts/:id/broadcast', async ({ params, request }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'session.control');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as { message: string; kind?: 'info' | 'hint' };
    state.broadcasts.push({ cohortId: String(params.id), message: body.message, kind: body.kind ?? 'info', at: new Date().toISOString(), from: m.user });
    audit(m.activeOrg!.id, m, 'cohort.broadcast', 'cohort', String(params.id), undefined, { kind: body.kind ?? 'info', message: body.message });
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/sessions/:id/extend', async ({ params, request }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'session.control');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as ExtendSessionRequest;
    const id = String(params.id);
    state.extended.set(id, (state.extended.get(id) ?? 0) + body.minutes);
    const seed = liveSeeds.find((s) => s.id === id);
    const expiresAt = seed ? new Date(new Date(liveSession(seed).expiresAt!).getTime() + state.extended.get(id)! * 60_000).toISOString() : undefined;
    audit(m.activeOrg!.id, m, 'session.extend', 'session', id, seed ? `${userRef(seed.userId).name} · ${labSummaries.find((l) => l.id === seed.labId)?.title}` : undefined, { minutes: body.minutes });
    return json({ sessionId: id, action: 'extend', expiresAt } satisfies SessionControlResponse);
  }),
  http.post('/api/sessions/:id/reset', async ({ params }) => {
    await delay(700);
    const m = me();
    const denied = requirePerm(m, 'session.control');
    if (denied || !m) return denied ?? unauthenticated();
    const id = String(params.id);
    audit(m.activeOrg!.id, m, 'session.reset', 'session', id);
    return json({ sessionId: id, action: 'reset', resetGeneration: 2 } satisfies SessionControlResponse);
  }),
  http.post('/api/sessions/:id/terminate', async ({ params }) => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'session.control');
    if (denied || !m) return denied ?? unauthenticated();
    const id = String(params.id);
    state.terminated.add(id);
    const seed = liveSeeds.find((s) => s.id === id);
    audit(m.activeOrg!.id, m, 'session.terminate', 'session', id, seed ? `${userRef(seed.userId).name} · ${labSummaries.find((l) => l.id === seed.labId)?.title}` : undefined);
    return json({ sessionId: id, action: 'terminate' } satisfies SessionControlResponse);
  }),
  /** Mock-only: the observe WebSocket cannot run in MSW; the shadow terminal registers here so the board and the learner banner reflect it. */
  http.post('/api/sessions/:id/observe', async ({ params }) => {
    const m = me();
    const denied = requirePerm(m, 'session.observe');
    if (denied || !m) return denied ?? unauthenticated();
    const id = String(params.id);
    const cur = state.observing.get(id) ?? [];
    if (!cur.some((u) => u.id === m.id)) state.observing.set(id, [...cur, m.user]);
    audit(m.activeOrg!.id, m, 'session.observe', 'session', id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('/api/sessions/:id/observe', async ({ params }) => {
    const m = me();
    if (!m) return unauthenticated();
    const id = String(params.id);
    state.observing.set(id, (state.observing.get(id) ?? []).filter((u) => u.id !== m.id));
    return new HttpResponse(null, { status: 204 });
  }),
];

/* ------------------------------------------------------------------ */
/* Org admin                                                            */
/* ------------------------------------------------------------------ */

const ssoOf = (orgId: string) => (state.sso[orgId] ??= []);
const domainsOf = (orgId: string) => (state.domains[orgId] ??= []);

function runSsoTest(c: SsoConnection): SsoTestResult {
  const ok = c.type === 'oidc' ? !!c.oidc?.discoveryUrl.includes('well-known') : !!(c.saml?.metadataUrl || c.saml?.entityId);
  const steps = c.type === 'oidc' ? [{ name: 'Discovery document', ok, detail: ok ? 'issuer resolved, 11 endpoints' : `GET ${c.oidc?.discoveryUrl}: 404` }, { name: 'JWKS reachable', ok, detail: ok ? '4 signing keys' : undefined }, { name: 'Client credentials', ok: ok && c.oidc!.hasClientSecret, detail: c.oidc?.hasClientSecret ? undefined : 'no client secret stored' }, { name: 'Role claim present', ok, detail: ok ? `${c.oidc?.roleClaim}: 2 values in the test token` : undefined }] : [{ name: 'Metadata download', ok, detail: ok ? '1 IdP descriptor' : 'metadata URL unreachable' }, { name: 'Signing certificate', ok, detail: ok ? 'expires in 380 days' : undefined }, { name: 'Assertion test', ok: ok && c.groupMappings.length > 0, detail: c.groupMappings.length ? undefined : 'no group mapping configured yet' }];
  const all = steps.every((s) => s.ok);
  return { ok: all, checkedAt: new Date().toISOString(), steps, loginUrl: all ? `/api/auth/login?org=${c.alias.split('-')[0]}&idp=${c.alias}` : undefined };
}

export const adminHandlers = [
  http.get('/api/admin/overview', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const orgId = m.activeOrg!.id;
    const users = usersOf(orgId);
    const out: AdminOverview = {
      org: state.settings[orgId]!,
      users: { active: users.filter((u) => u.status === 'active').length, invited: users.filter((u) => u.status === 'invited').length, deactivated: users.filter((u) => u.status === 'deactivated').length, activeLast7d: users.filter((u) => u.lastLoginAt && Date.now() - new Date(u.lastLoginAt).getTime() < 7 * 86_400_000).length },
      teams: teamsOf(orgId).length,
      runningSessions: liveSessionsOf(orgId).filter((s) => !state.terminated.has(s.id)).length,
      quotas: state.quotas[orgId]!,
      labHoursThisMonth: usageOf(orgId).labHoursThisMonth,
      ssoConnections: ssoOf(orgId).length,
      recentAudit: auditLog(orgId).slice(0, 8),
    };
    return json(out);
  }),

  http.get('/api/admin/users', async ({ request }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const role = url.searchParams.get('role');
    const team = url.searchParams.get('team');
    const status = url.searchParams.get('status');
    let items = usersOf(m.activeOrg!.id);
    if (q) items = items.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q));
    if (role) items = items.filter((u) => u.roles.includes(role as OrgRole));
    if (team) items = items.filter((u) => u.teams.some((t) => t.id === team));
    if (status) items = items.filter((u) => u.status === status);
    items.sort((a, b) => a.name.localeCompare(b.name));
    return json(page(items, url));
  }),
  http.get('/api/admin/users/:id', async ({ params }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const u = usersOf(m.activeOrg!.id).find((x) => x.id === params.id);
    return u ? json(u) : notFound('User');
  }),
  http.post('/api/admin/users', async ({ request }) => {
    await delay(600);
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as InviteUserRequest;
    const email = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return HttpResponse.json({ error: 'That does not look like an email address', code: 'invalid', details: { email: 'invalid' } }, { status: 422 });
    const orgId = m.activeOrg!.id;
    if (usersOf(orgId).some((u) => u.email === email)) return HttpResponse.json({ error: `${email} is already a member`, code: 'conflict' }, { status: 409 });
    const id = `u-inv-${Math.random().toString(36).slice(2, 6)}`;
    const teams = (body.teams ?? []).map((t) => ({ ...(teamsOf(orgId).find((x) => x.id === t.teamId) ?? { id: t.teamId, name: t.teamId }), role: t.role }));
    const user: OrgUser = { id, name: body.name?.trim() || email.split('@')[0]!.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), email, roles: body.roles, status: 'invited', teams: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })), cohorts: [], invitedBy: m.user, joinedAt: new Date().toISOString(), source: 'invite' };
    people.push({ id, name: user.name, email, title: '', orgs: { [orgId]: body.roles }, teams: body.teams ?? [], status: 'invited', joinedDaysAgo: 0, source: 'invite' });
    const invitation = { id: `inv-${id}`, email, roles: body.roles, teams: body.teams ?? [], invitedBy: m.user, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (body.expiresInDays ?? 7) * 86_400_000).toISOString(), status: 'pending' as const };
    state.invitations.unshift(invitation);
    audit(orgId, m, 'user.invite', 'user', id, email, { roles: body.roles, teams: (body.teams ?? []).map((t) => t.teamId) });
    return json({ invitation, user, emailSent: true }, 201);
  }),
  http.patch('/api/admin/users/:id', async ({ params, request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const orgId = m.activeOrg!.id;
    const body = (await request.json()) as UpdateUserRequest;
    const cur = usersOf(orgId).find((x) => x.id === params.id);
    if (!cur) return notFound('User');
    if (cur.id === m.id && body.status === 'deactivated') return HttpResponse.json({ error: 'You cannot deactivate your own account', code: 'conflict' }, { status: 409 });
    const patch: Partial<OrgUser> = {};
    if (body.roles) patch.roles = body.roles;
    if (body.teams) patch.teams = body.teams.map((t) => ({ ...(teamsOf(orgId).find((x) => x.id === t.teamId) ?? { id: t.teamId, name: t.teamId }), role: t.role })).map((t) => ({ id: t.id, name: t.name, role: t.role }));
    if (body.status) patch.status = body.status;
    if (body.title !== undefined) patch.title = body.title;
    state.overrides.set(`${orgId}:${cur.id}`, { ...(state.overrides.get(`${orgId}:${cur.id}`) ?? {}), ...patch });
    const user = { ...cur, ...patch };
    const deactivated = body.status === 'deactivated';
    const reactivated = body.status === 'active' && cur.status === 'deactivated';
    const running = liveSeeds.filter((s) => s.userId === cur.id && !state.terminated.has(s.id));
    if (deactivated) running.forEach((s) => state.terminated.add(s.id));
    audit(orgId, m, deactivated ? 'user.deactivate' : reactivated ? 'user.reactivate' : 'user.update', 'user', cur.id, cur.name, deactivated ? { revokedSessions: 1, terminatedLabs: running.length } : { changed: Object.keys(body) });
    return json({ user, ...(deactivated ? { revokedSessions: 1, terminatedLabs: running.length } : {}) });
  }),
  http.get('/api/admin/invitations', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(m.activeOrg!.id === ORG_QUILLMOOR.id ? state.invitations : state.invitations.filter((i) => i.email.endsWith('acmefreight.example')));
  }),
  http.delete('/api/admin/invitations/:id', async ({ params }) => {
    await delay(250);
    const m = me();
    const denied = requirePerm(m, 'user.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const inv = state.invitations.find((i) => i.id === params.id);
    if (inv) inv.status = 'revoked';
    audit(m.activeOrg!.id, m, 'invitation.revoke', 'invitation', String(params.id), inv?.email);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/admin/teams', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(teamsOf(m.activeOrg!.id));
  }),
  http.post('/api/admin/teams', async ({ request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as CreateTeamRequest;
    if (!body.name?.trim()) return HttpResponse.json({ error: 'A team needs a name', code: 'invalid', details: { name: 'required' } }, { status: 422 });
    const t: Team = { id: `t-${Math.random().toString(36).slice(2, 7)}`, name: body.name.trim(), parentId: body.parentId ?? null, memberCount: 0, managers: [], createdAt: new Date().toISOString() };
    state.extraTeams.push(t);
    audit(m.activeOrg!.id, m, 'team.create', 'team', t.id, t.name, { parentId: t.parentId });
    return json(t, 201);
  }),
  http.get('/api/admin/teams/:id', async ({ params }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const id = String(params.id);
    const extra = state.extraTeams.find((t) => t.id === id);
    const base = extra ? { ...extra, members: [], children: [] } : teamDetail(id);
    if (!base) return notFound('Team');
    const added = (state.extraMembers.get(id) ?? []).map((x) => ({ user: userRef(x.userId), role: x.role }));
    return json({ ...base, name: state.teamRenames.get(id) ?? base.name, members: [...base.members, ...added], memberCount: base.members.length + added.length });
  }),
  http.patch('/api/admin/teams/:id', async ({ params, request }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as UpdateTeamRequest;
    const id = String(params.id);
    if (body.name) state.teamRenames.set(id, body.name.trim());
    const t = teamsOf(m.activeOrg!.id).find((x) => x.id === id);
    if (!t) return notFound('Team');
    audit(m.activeOrg!.id, m, 'team.update', 'team', id, t.name, { changed: Object.keys(body) });
    return json(t);
  }),
  http.delete('/api/admin/teams/:id', async ({ params }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const id = String(params.id);
    if (teamsOf(m.activeOrg!.id).some((t) => t.parentId === id)) return HttpResponse.json({ error: 'Move or delete its sub-teams first', code: 'conflict' }, { status: 409 });
    const i = state.extraTeams.findIndex((t) => t.id === id);
    if (i >= 0) state.extraTeams.splice(i, 1);
    audit(m.activeOrg!.id, m, 'team.delete', 'team', id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/admin/teams/:id/members', async ({ params, request }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as AddTeamMemberRequest;
    const id = String(params.id);
    const list = state.extraMembers.get(id) ?? [];
    if (!list.some((x) => x.userId === body.userId)) list.push({ userId: body.userId, role: body.role });
    state.extraMembers.set(id, list);
    audit(m.activeOrg!.id, m, 'team.member_add', 'team', id, undefined, { userId: body.userId, role: body.role });
    const d = teamDetail(id) ?? { ...state.extraTeams.find((t) => t.id === id)!, members: [], children: [] };
    return json({ ...d, members: [...d.members, ...list.map((x) => ({ user: userRef(x.userId), role: x.role }))] });
  }),
  http.delete('/api/admin/teams/:id/members/:userId', async ({ params }) => {
    await delay(250);
    const m = me();
    const denied = requirePerm(m, 'team.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const id = String(params.id);
    state.extraMembers.set(id, (state.extraMembers.get(id) ?? []).filter((x) => x.userId !== params.userId));
    audit(m.activeOrg!.id, m, 'team.member_remove', 'team', id, undefined, { userId: params.userId });
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/admin/sso', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json({ connections: ssoOf(m.activeOrg!.id), domains: domainsOf(m.activeOrg!.id) });
  }),
  http.post('/api/admin/sso', async ({ request }) => {
    await delay(900);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as CreateSsoConnectionRequest;
    if (!body.displayName?.trim()) return HttpResponse.json({ error: 'Give the connection a display name', code: 'invalid', details: { displayName: 'required' } }, { status: 422 });
    if (body.type === 'oidc' && !body.oidc?.discoveryUrl) return HttpResponse.json({ error: 'OIDC needs a discovery URL', code: 'invalid', details: { discoveryUrl: 'required' } }, { status: 422 });
    const now = new Date().toISOString();
    const c: SsoConnection = {
      id: `sso-${Math.random().toString(36).slice(2, 6)}`,
      alias: body.alias ?? `${m.activeOrg!.slug}-${body.type}`,
      type: body.type,
      displayName: body.displayName.trim(),
      status: 'draft',
      enforced: false,
      oidc: body.oidc ? { discoveryUrl: body.oidc.discoveryUrl, clientId: body.oidc.clientId, hasClientSecret: !!body.oidc.clientSecret, scopes: body.oidc.scopes ?? ['openid', 'profile', 'email'], roleClaim: body.oidc.roleClaim ?? 'roles' } : undefined,
      saml: body.saml ? { metadataUrl: body.saml.metadataUrl, entityId: body.saml.metadataXml ? 'urn:parsed-from-metadata' : undefined, groupAttribute: body.saml.groupAttribute ?? 'groups' } : undefined,
      groupMappings: body.groupMappings ?? [],
      defaultRoles: body.defaultRoles ?? ['learner'],
      createdAt: now,
      updatedAt: now,
    };
    ssoOf(m.activeOrg!.id).push(c);
    audit(m.activeOrg!.id, m, 'sso.create', 'sso', c.id, c.displayName, { type: c.type, alias: c.alias });
    return json(c, 201);
  }),
  http.patch('/api/admin/sso/:id', async ({ params, request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as UpdateSsoConnectionRequest;
    const c = ssoOf(m.activeOrg!.id).find((x) => x.id === params.id);
    if (!c) return notFound('Connection');
    if (body.enforced && (c.status !== 'active' || !domainsOf(m.activeOrg!.id).some((d) => d.verified))) return HttpResponse.json({ error: 'Enforcing needs an active connection and at least one verified domain', code: 'conflict' }, { status: 409 });
    if (body.displayName) c.displayName = body.displayName;
    if (body.groupMappings) c.groupMappings = body.groupMappings;
    if (body.defaultRoles) c.defaultRoles = body.defaultRoles;
    if (body.oidc && c.oidc) c.oidc = { ...c.oidc, ...body.oidc, hasClientSecret: body.oidc.clientSecret ? true : c.oidc.hasClientSecret };
    if (body.saml && c.saml) c.saml = { ...c.saml, ...body.saml };
    if (body.enforced !== undefined) c.enforced = body.enforced;
    if (body.status) c.status = body.status;
    c.updatedAt = new Date().toISOString();
    audit(m.activeOrg!.id, m, 'sso.update', 'sso', c.id, c.displayName, { changed: Object.keys(body), ...(body.enforced !== undefined ? { enforced: body.enforced } : {}) });
    return json(c);
  }),
  http.delete('/api/admin/sso/:id', async ({ params }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const list = ssoOf(m.activeOrg!.id);
    const i = list.findIndex((x) => x.id === params.id);
    if (i >= 0) {
      audit(m.activeOrg!.id, m, 'sso.delete', 'sso', list[i]!.id, list[i]!.displayName);
      list.splice(i, 1);
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/admin/sso/:id/test', async ({ params }) => {
    await delay(1400);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const c = ssoOf(m.activeOrg!.id).find((x) => x.id === params.id);
    if (!c) return notFound('Connection');
    c.lastTest = runSsoTest(c);
    if (c.lastTest.ok && c.status === 'draft') c.status = 'active';
    if (!c.lastTest.ok && c.status === 'active') c.status = 'error';
    audit(m.activeOrg!.id, m, 'sso.test', 'sso', c.id, c.displayName, { ok: c.lastTest.ok });
    return json(c.lastTest);
  }),
  http.get('/api/admin/sso/domains', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(domainsOf(m.activeOrg!.id));
  }),
  http.post('/api/admin/sso/domains', async ({ request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as AddDomainRequest;
    const domain = body.domain.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return HttpResponse.json({ error: 'Enter a domain such as example.com', code: 'invalid', details: { domain: 'invalid' } }, { status: 422 });
    const list = domainsOf(m.activeOrg!.id);
    if (list.some((d) => d.domain === domain)) return HttpResponse.json({ error: `${domain} is already listed`, code: 'conflict' }, { status: 409 });
    const d: OrgDomain = { domain, verified: false, verification: { type: 'TXT', name: `_cloudtrain.${domain}`, value: `cloudtrain-verify=${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}-${domain.split('.')[0]}` } };
    list.push(d);
    audit(m.activeOrg!.id, m, 'domain.add', 'domain', domain);
    return json(d, 201);
  }),
  http.post('/api/admin/sso/domains/:domain/verify', async ({ params }) => {
    await delay(1600);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const d = domainsOf(m.activeOrg!.id).find((x) => x.domain === params.domain);
    if (!d) return notFound('Domain');
    // The depot sub-domain stays unverified so the failure path is visible; anything else verifies.
    const ok = d.domain !== 'depot.quillmoor.example';
    if (ok) {
      d.verified = true;
      d.verifiedAt = new Date().toISOString();
    }
    audit(m.activeOrg!.id, m, 'domain.verify', 'domain', d.domain, undefined, { ok });
    return json({ domain: d, ok, detail: ok ? `TXT ${d.verification.name} matched` : `No TXT record at ${d.verification.name} yet (DNS can take up to an hour to propagate)` });
  }),
  http.delete('/api/admin/sso/domains/:domain', async ({ params }) => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'sso.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const list = domainsOf(m.activeOrg!.id);
    const i = list.findIndex((x) => x.domain === params.domain);
    if (i >= 0) list.splice(i, 1);
    audit(m.activeOrg!.id, m, 'domain.remove', 'domain', String(params.domain));
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/admin/content', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'content.visibility');
    if (denied || !m) return denied ?? unauthenticated();
    const orgId = m.activeOrg!.id;
    if (!state.content.has(orgId)) state.content.set(orgId, contentVisibilityOf(orgId));
    return json(state.content.get(orgId));
  }),
  http.put('/api/admin/content', async ({ request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'content.visibility');
    if (denied || !m) return denied ?? unauthenticated();
    const orgId = m.activeOrg!.id;
    const body = (await request.json()) as UpdateContentVisibilityRequest;
    const cur = state.content.get(orgId) ?? contentVisibilityOf(orgId);
    for (const p of body.packs ?? []) {
      const pack = cur.packs.find((x) => x.packId === p.packId);
      if (pack) pack.enabled = p.enabled;
    }
    for (const l of body.labs ?? []) cur.packs.forEach((pack) => pack.labs.forEach((lab) => lab.labId === l.labId && (lab.enabled = l.enabled)));
    if (body.pinnedPaths) cur.pinnedPaths = body.pinnedPaths;
    state.content.set(orgId, cur);
    audit(orgId, m, 'content.visibility', body.packs?.length ? 'pack' : body.labs?.length ? 'lab' : 'paths', body.packs?.[0]?.packId ?? body.labs?.[0]?.labId ?? 'pinned', undefined, body as Record<string, unknown>);
    return json(cur);
  }),

  http.get('/api/admin/sessions', async () => {
    await delay(200);
    const m = me();
    const denied = requirePerm(m, 'session.control');
    if (denied || !m) return denied ?? unauthenticated();
    return json(liveSessionsOf(m.activeOrg!.id).filter((s) => !state.terminated.has(s.id)).map((s) => ({ ...s, observedBy: state.observing.get(s.id) ?? s.observedBy })));
  }),
  http.get('/api/admin/usage', async ({ request }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'quota.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const url = new URL(request.url);
    const u = usageOf(m.activeOrg!.id, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined);
    return json({ ...u, quotas: state.quotas[m.activeOrg!.id]! });
  }),
  http.get('/api/admin/quotas', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'quota.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(state.quotas[m.activeOrg!.id]);
  }),
  http.put('/api/admin/quotas', async ({ request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'quota.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as Partial<Quotas>;
    const orgId = m.activeOrg!.id;
    const before = state.quotas[orgId]!;
    state.quotas[orgId] = { ...before, ...body };
    audit(orgId, m, 'quota.update', 'org', orgId, m.activeOrg!.name, Object.fromEntries(Object.entries(body).map(([k, v]) => [k, { from: before[k as keyof Quotas], to: v }])));
    return json(state.quotas[orgId]);
  }),

  http.get('/api/admin/audit', async ({ request }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'audit.read');
    if (denied || !m) return denied ?? unauthenticated();
    const url = new URL(request.url);
    let items = auditLog(m.activeOrg!.id);
    const action = url.searchParams.get('action');
    const actor = url.searchParams.get('actor');
    const targetType = url.searchParams.get('targetType');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (action) items = items.filter((e) => (action.endsWith('.') ? e.action.startsWith(action) : e.action === action));
    if (actor) items = items.filter((e) => e.actor?.id === actor || e.actor?.name.toLowerCase().includes(actor.toLowerCase()));
    if (targetType) items = items.filter((e) => e.targetType === targetType);
    if (from) items = items.filter((e) => e.at >= from);
    if (to) items = items.filter((e) => e.at <= `${to}T23:59:59Z`);
    return json(page(items, url));
  }),
  http.get('/api/admin/audit.csv', async () => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'audit.read');
    if (denied || !m) return denied ?? unauthenticated();
    const items = auditLog(m.activeOrg!.id);
    audit(m.activeOrg!.id, m, 'audit.export', 'org', m.activeOrg!.id, m.activeOrg!.name, { rows: items.length });
    return csv([['id', 'at', 'actor', 'action', 'target_type', 'target_id', 'target_label', 'ip', 'details'], ...items.map((e) => [e.id, e.at, e.actor?.email ?? 'system', e.action, e.targetType, e.targetId, e.targetLabel ?? '', e.ip ?? '', JSON.stringify(e.details)])]);
  }),

  http.get('/api/admin/settings', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'settings.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json({ org: state.settings[m.activeOrg!.id] });
  }),
  http.patch('/api/admin/settings', async ({ request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'settings.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as UpdateOrgSettingsRequest;
    const org = state.settings[m.activeOrg!.id]!;
    if (body.name) org.name = body.name.trim();
    if (body.settings) org.settings = { ...org.settings, ...body.settings };
    audit(m.activeOrg!.id, m, 'settings.update', 'org', org.id, org.name, { changed: [...(body.name ? ['name'] : []), ...Object.keys(body.settings ?? {})] });
    return json({ org });
  }),
];

/* ------------------------------------------------------------------ */
/* Platform                                                             */
/* ------------------------------------------------------------------ */

export const platformHandlers = [
  http.get('/api/platform/orgs', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(state.platformOrgs);
  }),
  http.post('/api/platform/orgs', async ({ request }) => {
    await delay(700);
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as CreatePlatformOrgRequest;
    if (!/^[a-z0-9-]{3,}$/.test(body.slug ?? '')) return HttpResponse.json({ error: 'Slug: lowercase letters, digits and dashes', code: 'invalid', details: { slug: 'invalid' } }, { status: 422 });
    if (state.platformOrgs.some((o) => o.slug === body.slug)) return HttpResponse.json({ error: `An organisation with slug ${body.slug} exists`, code: 'conflict' }, { status: 409 });
    const o: PlatformOrg = { id: `org-${body.slug}`, slug: body.slug, name: body.name.trim(), status: 'active', createdAt: new Date().toISOString(), quotas: { maxConcurrentSessions: 10, monthlyLabHours: 100, maxSessionMinutes: 90, ...(body.quotas ?? {}) }, domains: body.domains ?? [], users: body.adminEmail ? 1 : 0, activeUsers30d: 0, runningSessions: 0, labHoursThisMonth: 0, ssoConnections: 0 };
    state.platformOrgs.unshift(o);
    audit(o.id, m, 'platform.org_create', 'org', o.id, o.name, { slug: o.slug, adminEmail: body.adminEmail });
    return json(o, 201);
  }),
  http.get('/api/platform/orgs/:id', async ({ params }) => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const o = state.platformOrgs.find((x) => x.id === params.id);
    return o ? json(o) : notFound('Organisation');
  }),
  http.patch('/api/platform/orgs/:id', async ({ params, request }) => {
    await delay(400);
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const body = (await request.json()) as UpdatePlatformOrgRequest;
    const o = state.platformOrgs.find((x) => x.id === params.id);
    if (!o) return notFound('Organisation');
    if (body.name) o.name = body.name;
    if (body.status) o.status = body.status;
    if (body.quotas) {
      o.quotas = { ...o.quotas, ...body.quotas };
      state.quotas[o.id] = o.quotas;
    }
    audit(o.id, m, 'platform.org_update', 'org', o.id, o.name, body as Record<string, unknown>);
    return json(o);
  }),
  http.post('/api/platform/orgs/:id/suspend', async ({ params }) => {
    await delay(600);
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const o = state.platformOrgs.find((x) => x.id === params.id);
    if (!o) return notFound('Organisation');
    o.status = 'suspended';
    o.runningSessions = 0;
    audit(o.id, m, 'platform.org_suspend', 'org', o.id, o.name);
    return json(o);
  }),
  http.post('/api/platform/orgs/:id/reactivate', async ({ params }) => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const o = state.platformOrgs.find((x) => x.id === params.id);
    if (!o) return notFound('Organisation');
    o.status = 'active';
    audit(o.id, m, 'platform.org_reactivate', 'org', o.id, o.name);
    return json(o);
  }),
  http.delete('/api/platform/orgs/:id', async ({ params }) => {
    await delay(500);
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    const i = state.platformOrgs.findIndex((x) => x.id === params.id);
    if (i < 0) return notFound('Organisation');
    if (state.platformOrgs[i]!.status !== 'suspended') return HttpResponse.json({ error: 'Suspend the organisation before deleting it', code: 'conflict' }, { status: 409 });
    state.platformOrgs.splice(i, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/platform/capacity', async () => {
    await delay(300);
    const m = me();
    const denied = requirePerm(m, 'capacity.read');
    if (denied || !m) return denied ?? unauthenticated();
    return json({ ...capacity, generatedAt: new Date().toISOString() });
  }),
  http.get('/api/platform/content', async () => {
    await latency();
    const m = me();
    const denied = requirePerm(m, 'org.manage');
    if (denied || !m) return denied ?? unauthenticated();
    return json(platformPacks);
  }),
];

/* ------------------------------------------------------------------ */
/* Session notices (learner workspace)                                  */
/* ------------------------------------------------------------------ */

/**
 * Simulated notices for a learner's running session: an instructor starts observing
 * 12 s in and stops a minute later, and a broadcast hint arrives at 25 s. Real mode
 * gets these from the gateway on the session and the terminal WebSocket.
 */
export function mockNotices(startedAt: string, sessionId: string) {
  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
  const notices = [];
  const observers = state.observing.get(sessionId) ?? [];
  if (observers.length) notices.push(...observers.map((u) => ({ id: `n-obs-${u.id}`, kind: 'observed' as const, at: new Date().toISOString(), from: u, message: `${u.name} is observing this session`, active: true })));
  else if (elapsed > 12 && elapsed < 72) notices.push({ id: 'n-obs-sim', kind: 'observed' as const, at: new Date(new Date(startedAt).getTime() + 12_000).toISOString(), from: userRef('u-samir'), message: 'Samir Haddad is observing this session', active: true });
  if (elapsed > 25) notices.push({ id: 'n-hint-sim', kind: 'hint' as const, at: new Date(new Date(startedAt).getTime() + 25_000).toISOString(), from: userRef('u-samir'), message: 'Cohort hint: a default-deny policy selects every pod with `podSelector: {}` and lists no ingress rules.' });
  for (const b of state.broadcasts) notices.push({ id: `n-b-${b.at}`, kind: b.kind, at: b.at, from: b.from, message: b.message });
  return notices;
}

export const allPlatformHandlers = [...authHandlers, ...learnerHandlers, ...managerHandlers, ...instructorHandlers, ...adminHandlers, ...platformHandlers];
