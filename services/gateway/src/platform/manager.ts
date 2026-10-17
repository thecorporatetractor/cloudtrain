import type {
  Assignment,
  AssignmentDetail,
  AssignmentQuery,
  AssignmentState,
  AssignmentStatusRow,
  AtRiskItem,
  CreateAssignmentRequest,
  DashboardMember,
  FrameworkId,
  MemberDetail,
  Page,
  Team,
  TeamDashboard,
  TeamRef,
} from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, can, type AuthzTarget } from '../authz.js';
import type { Tx } from '../db/index.js';
import type { AssignmentRow } from '../db/schema.js';
import { badRequest, notFound } from '../errors.js';
import { competencyMastery, environmentMinutesSince, readinessOf, skillStates } from '../learner/home.js';
import { actorOf, audit } from './audit.js';
import { decodeCursor, encodeCursor, pageLimit, userRef, type PlatformService } from './service.js';

const DAY = 86_400_000;
const STATES: AssignmentState[] = ['not_started', 'in_progress', 'completed', 'overdue'];

/** Team rows with member counts and managers. */
export async function teamsWithStats(tx: Tx, ids?: string[]): Promise<Team[]> {
  let q = tx.selectFrom('teams').selectAll().orderBy('name');
  if (ids) {
    if (!ids.length) return [];
    q = q.where('id', 'in', ids);
  }
  const teams = await q.execute();
  if (!teams.length) return [];
  const members = await tx
    .selectFrom('team_members as tm')
    .innerJoin('users as u', 'u.id', 'tm.user_id')
    .select(['tm.team_id', 'tm.role', 'u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url'])
    .where(
      'tm.team_id',
      'in',
      teams.map((t) => t.id),
    )
    .execute();
  return teams.map((t) => {
    const ms = members.filter((m) => m.team_id === t.id);
    return { id: t.id, name: t.name, parentId: t.parent_id, memberCount: ms.length, managers: ms.filter((m) => m.role === 'manager').map(userRef), createdAt: t.created_at.toISOString() };
  });
}

/** Teams the principal may read progress for. */
export async function visibleTeamIds(tx: Tx, p: Principal): Promise<string[]> {
  if (can(p, 'progress.read.team', { kind: 'org' })) return (await tx.selectFrom('teams').select('id').execute()).map((t) => t.id);
  return p.managedTeamIds;
}

export async function listTeams(ps: PlatformService, p: Principal): Promise<Team[]> {
  return ps.tx(p, async (tx) => teamsWithStats(tx, await visibleTeamIds(tx, p)));
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  avatar_url: string | null;
  role: 'member' | 'manager';
  last_login_at: Date | null;
}

async function teamMembers(tx: Tx, teamId: string): Promise<MemberRow[]> {
  return tx
    .selectFrom('team_members as tm')
    .innerJoin('users as u', 'u.id', 'tm.user_id')
    .select(['u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url', 'tm.role', 'u.last_login_at'])
    .where('tm.team_id', '=', teamId)
    .orderBy('u.name')
    .execute();
}

function statusCounts(rows: { status: AssignmentState }[]) {
  return {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'completed').length,
    overdue: rows.filter((r) => r.status === 'overdue').length,
    inProgress: rows.filter((r) => r.status === 'in_progress').length,
  };
}

export async function dashboard(ps: PlatformService, p: Principal, teamId: string): Promise<TeamDashboard> {
  authorize(p, 'progress.read.team', { kind: 'team', teamId });
  return ps.tx(p, async (tx) => {
    const [team] = await teamsWithStats(tx, [teamId]);
    if (!team) throw notFound('Team');
    const now = ps.now();
    const members = await teamMembers(tx, teamId);
    const ids = members.map((m) => m.id);
    const states = ids.length ? await tx.selectFrom('learner_skill_state').select(['user_id', 'skill_id', 'mu']).where('user_id', 'in', ids).execute() : [];
    const attempts = ids.length
      ? await tx
          .selectFrom('lab_attempts')
          .select(['id', 'user_id', 'lab_id', 'started_at', 'ended_at', 'outcome', 'score', 'hints_used', 'duration_s'])
          .where('user_id', 'in', ids)
          .where('started_at', '>', new Date(now.getTime() - 70 * DAY))
          .execute()
      : [];
    const statuses = ids.length
      ? await tx.selectFrom('assignment_status as s').innerJoin('assignments as a', 'a.id', 's.assignment_id').select(['s.user_id', 's.assignment_id', 's.status', 's.progress', 's.due_at', 's.required', 'a.item_kind', 'a.item_id', 'a.lab_ids']).where('s.user_id', 'in', ids).execute()
      : [];

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const frameworks = ps.content.frameworks;
    const atRisk: AtRiskItem[] = [];
    const dm: DashboardMember[] = members.map((m) => {
      const mu = new Map(states.filter((s) => s.user_id === m.id).map((s) => [s.skill_id, s.mu]));
      const mine = attempts.filter((a) => a.user_id === m.id);
      const st = statuses.filter((s) => s.user_id === m.id);
      // One row per assignment.
      const byAssignment = new Map(st.map((s) => [s.assignment_id, s]));
      const counts = statusCounts([...byAssignment.values()]);
      let risky = false;
      for (const s of byAssignment.values()) {
        const due = s.due_at?.getTime();
        const reason: AtRiskItem['reason'] | null =
          s.status === 'overdue' ? 'overdue' : s.status === 'not_started' && due && due - now.getTime() < 3 * DAY ? 'due_soon_not_started' : s.status === 'in_progress' && due && due - now.getTime() < 2 * DAY && Number(s.progress) < 0.5 ? 'stalled' : null;
        if (reason && s.required) {
          risky = true;
          atRisk.push({ user: userRef(m), assignmentId: s.assignment_id, item: ps.itemOf(s.item_kind, s.item_id, s.lab_ids), dueAt: s.due_at?.toISOString() ?? null, status: s.status, reason });
        }
      }
      const last = mine.reduce<Date | null>((a, x) => (!a || x.started_at > a ? x.started_at : a), null);
      return {
        user: userRef(m),
        role: m.role,
        mastery: competencyMastery(ps.content, mu),
        readiness: Object.fromEntries(frameworks.map((f) => [f.id, readinessOf(ps.content, f.id, mu)])) as Partial<Record<FrameworkId, number>>,
        minutesThisMonth: environmentMinutesSince(mine, monthStart),
        attemptsThisMonth: mine.filter((a) => a.started_at >= monthStart).length,
        ...(last ? { lastActiveAt: last.toISOString() } : {}),
        assignments: counts,
        atRisk: risky,
      };
    });

    // Weekly minutes, last 8 ISO weeks (Monday starts).
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const minutesByWeek = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(monday.getTime() - (7 - i) * 7 * DAY);
      const end = new Date(start.getTime() + 7 * DAY);
      return { weekStart: start.toISOString().slice(0, 10), minutes: Math.round(attempts.filter((a) => a.started_at >= start && a.started_at < end).reduce((x, a) => x + a.duration_s, 0) / 60) };
    });

    const allAssignments = [...new Map(statuses.map((s) => [`${s.user_id}:${s.assignment_id}`, s])).values()];
    const visible = await teamsWithStats(tx, await visibleTeamIds(tx, p));
    const teams: TeamRef[] = visible.map((t) => ({ id: t.id, name: t.name }));
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    return {
      team,
      teams,
      competencies: ps.content.competencies.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
      members: dm,
      frameworks: frameworks.map((f) => {
        const vals = dm.map((m) => m.readiness[f.id] ?? 0);
        return { frameworkId: f.id, name: f.name, readiness: vals.length ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 100) / 100 : 0, ready: vals.filter((v) => v >= 0.8).length, members: vals.length };
      }),
      minutesByWeek,
      totals: {
        members: members.length,
        activeThisWeek: new Set(attempts.filter((a) => a.started_at >= weekAgo).map((a) => a.user_id)).size,
        minutesThisMonth: dm.reduce((a, m) => a + m.minutesThisMonth, 0),
        assignmentsOverdue: allAssignments.filter((s) => s.status === 'overdue').length,
        completionRate: allAssignments.length ? Math.round((allAssignments.filter((s) => s.status === 'completed').length / allAssignments.length) * 100) / 100 : 0,
      },
      atRisk: atRisk.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
      source: attempts.length || states.length ? 'live' : 'empty',
      generatedAt: now.toISOString(),
    };
  });
}

export async function memberDetail(ps: PlatformService, p: Principal, teamId: string, userId: string): Promise<MemberDetail> {
  authorize(p, 'progress.read.team', { kind: 'team', teamId });
  return ps.tx(p, async (tx) => {
    const team = await tx.selectFrom('teams').select(['id', 'name']).where('id', '=', teamId).executeTakeFirst();
    if (!team) throw notFound('Team');
    const m = (await teamMembers(tx, teamId)).find((x) => x.id === userId);
    if (!m) throw notFound('Member');
    const rows = await ps.states(tx, userId);
    const mu = new Map(rows.map((r) => [r.skill_id, r.mu]));
    const attempts = await ps.attemptsPage(tx, userId, { limit: 50 });
    const lite = await ps.attemptsLite(tx, userId, 40);
    const now = ps.now();
    return {
      user: { ...userRef(m), ...(m.last_login_at ? { lastLoginAt: m.last_login_at.toISOString() } : {}) },
      team: { id: team.id, name: team.name },
      role: m.role,
      skills: skillStates(ps.content, rows, now),
      mastery: competencyMastery(ps.content, mu),
      readiness: Object.fromEntries(ps.content.frameworks.map((f) => [f.id, readinessOf(ps.content, f.id, mu)])) as Partial<Record<FrameworkId, number>>,
      attempts: attempts.items,
      assignments: await ps.myAssignmentsTx(tx, userId),
      minutesThisMonth: environmentMinutesSince(lite, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    };
  });
}

/* --------------------------------------------------------------- assignments */

async function targetAuthz(ps: PlatformService, tx: Tx, kind: string, id: string): Promise<AuthzTarget> {
  if (kind === 'team') return { kind: 'team', teamId: id };
  if (kind === 'cohort') return { kind: 'cohort', cohortId: id };
  return ps.subjectOf(tx, id);
}

async function toAssignments(ps: PlatformService, tx: Tx, rows: AssignmentRow[]): Promise<Assignment[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const statuses = await tx.selectFrom('assignment_status').select(['assignment_id', 'user_id', 'status']).where('assignment_id', 'in', ids).execute();
  const byIds = [...new Set(rows.map((r) => r.assigned_by).filter((x): x is string => !!x))];
  const users = byIds.length ? await tx.selectFrom('users').selectAll().where('id', 'in', byIds).execute() : [];
  const out: Assignment[] = [];
  for (const r of rows) {
    const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<AssignmentState, number>;
    const seen = new Set<string>();
    for (const s of statuses) {
      if (s.assignment_id !== r.id || seen.has(s.user_id)) continue;
      seen.add(s.user_id);
      counts[s.status]++;
    }
    const by = users.find((u) => u.id === r.assigned_by);
    const name = await ps.targetName(tx, r.target_kind, r.target_id);
    out.push({
      id: r.id,
      target: { kind: r.target_kind, id: r.target_id, ...(name ? { name } : {}) },
      item: ps.itemOf(r.item_kind, r.item_id, r.lab_ids),
      dueAt: r.due_at?.toISOString() ?? null,
      required: r.required,
      ...(r.note ? { note: r.note } : {}),
      assignedBy: by ? userRef(by) : { id: '', name: 'CloudTrain', email: '' },
      createdAt: r.created_at.toISOString(),
      counts,
    });
  }
  return out;
}

export async function listAssignments(ps: PlatformService, p: Principal, q: AssignmentQuery): Promise<Page<Assignment>> {
  authorize(p, 'assignment.manage');
  return ps.tx(p, async (tx) => {
    let query = tx.selectFrom('assignments').selectAll().orderBy('created_at', 'desc').orderBy('id', 'desc');
    if (q.team) query = query.where('target_kind', '=', 'team').where('target_id', '=', q.team);
    if (q.cohort) query = query.where('target_kind', '=', 'cohort').where('target_id', '=', q.cohort);
    if (q.user) query = query.where('id', 'in', tx.selectFrom('assignment_targets').select('assignment_id').where('user_id', '=', q.user));
    if (q.state) query = query.where('id', 'in', tx.selectFrom('assignment_status').select('assignment_id').where('status', '=', q.state));
    const cur = decodeCursor<[string, string]>(q.cursor);
    if (cur) query = query.where((eb) => eb.or([eb('created_at', '<', new Date(cur[0])), eb.and([eb('created_at', '=', new Date(cur[0])), eb('id', '<', cur[1])])]));
    const all = await query.execute();
    const allowed: AssignmentRow[] = [];
    for (const r of all) if (can(p, 'assignment.manage', await targetAuthz(ps, tx, r.target_kind, r.target_id))) allowed.push(r);
    const limit = pageLimit(q.limit);
    const page = allowed.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await toAssignments(ps, tx, page), nextCursor: allowed.length > limit && last ? encodeCursor([last.created_at.toISOString(), last.id]) : null };
  });
}

export async function assignmentDetail(ps: PlatformService, p: Principal, id: string): Promise<AssignmentDetail> {
  return ps.tx(p, async (tx) => {
    const r = await tx.selectFrom('assignments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Assignment');
    authorize(p, 'assignment.manage', await targetAuthz(ps, tx, r.target_kind, r.target_id));
    const [assignment] = await toAssignments(ps, tx, [r]);
    const rows = await tx
      .selectFrom('assignment_status as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.user_id', 's.status', 's.progress', 's.completed_at', 's.best_score', 'u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url'])
      .where('s.assignment_id', '=', id)
      .orderBy('u.name')
      .execute();
    const seen = new Set<string>();
    const statuses: AssignmentStatusRow[] = [];
    for (const s of rows) {
      if (seen.has(s.user_id)) continue;
      seen.add(s.user_id);
      statuses.push({ assignmentId: id, user: userRef(s), status: s.status, progress: Math.round(Number(s.progress) * 100) / 100, ...(s.completed_at ? { completedAt: s.completed_at.toISOString() } : {}), ...(s.best_score !== null ? { bestScore: s.best_score } : {}) });
    }
    return { assignment: assignment!, statuses };
  });
}

export async function createAssignments(ps: PlatformService, p: Principal, req: CreateAssignmentRequest, ip?: string): Promise<Assignment[]> {
  authorize(p, 'assignment.manage');
  if (!req || !Array.isArray(req.targets) || !req.targets.length) throw badRequest('At least one target is required.', { targets: 'required' });
  if (!req.item || !['lab', 'path', 'framework'].includes(req.item.kind)) throw badRequest('item.kind must be lab, path or framework.', { item: 'invalid' });
  const labIds = ps.resolveItem(req.item.kind, req.item.id);
  if (!labIds.length) throw badRequest(`Unknown ${req.item.kind} ${req.item.id}.`, { item: 'unknown' });
  let due: Date | null = null;
  if (req.dueAt) {
    due = new Date(req.dueAt);
    if (Number.isNaN(due.getTime())) throw badRequest('dueAt must be an ISO date.', { dueAt: 'invalid' });
  }
  return ps.tx(p, async (tx) => {
    const created: AssignmentRow[] = [];
    for (const t of req.targets) {
      if (!['team', 'user', 'cohort'].includes(t.kind)) throw badRequest('target.kind must be team, user or cohort.', { targets: 'invalid' });
      const exists =
        t.kind === 'team'
          ? await tx.selectFrom('teams').select('id').where('id', '=', t.id).executeTakeFirst()
          : t.kind === 'cohort'
            ? await tx.selectFrom('cohorts').select('id').where('id', '=', t.id).executeTakeFirst()
            : await tx.selectFrom('memberships').select('user_id').where('user_id', '=', t.id).executeTakeFirst();
      if (!exists) throw notFound(t.kind === 'user' ? 'User' : t.kind === 'team' ? 'Team' : 'Cohort');
      authorize(p, 'assignment.manage', await targetAuthz(ps, tx, t.kind, t.id));
      const row = await tx
        .insertInto('assignments')
        .values({ org_id: p.orgId, target_kind: t.kind, target_id: t.id, item_kind: req.item.kind, item_id: req.item.id, lab_ids: labIds, due_at: due, required: req.required ?? true, note: req.note?.slice(0, 500) ?? null, assigned_by: p.sub })
        .returningAll()
        .executeTakeFirstOrThrow();
      created.push(row);
      await audit(tx, actorOf(p, ip), 'assignment.create', 'assignment', row.id, { target: t, item: req.item, dueAt: due?.toISOString() ?? null, required: row.required }, ps.itemOf(req.item.kind, req.item.id, labIds).title);
    }
    return toAssignments(ps, tx, created);
  });
}

export async function deleteAssignment(ps: PlatformService, p: Principal, id: string, ip?: string): Promise<void> {
  await ps.tx(p, async (tx) => {
    const r = await tx.selectFrom('assignments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Assignment');
    authorize(p, 'assignment.manage', await targetAuthz(ps, tx, r.target_kind, r.target_id));
    await tx.deleteFrom('assignments').where('id', '=', id).execute();
    await audit(tx, actorOf(p, ip), 'assignment.delete', 'assignment', id, { target: { kind: r.target_kind, id: r.target_id }, item: { kind: r.item_kind, id: r.item_id } }, r.item_id);
  });
}

/* ----------------------------------------------------------------------- CSV */

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',') + '\r\n';

export async function progressCsv(ps: PlatformService, p: Principal, teamId: string, from?: string, to?: string, ip?: string): Promise<string> {
  authorize(p, 'report.export', { kind: 'team', teamId });
  const fromD = from ? new Date(from) : new Date(ps.now().getTime() - 30 * DAY);
  const toD = to ? new Date(to) : ps.now();
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) throw badRequest('from/to must be ISO dates.');
  return ps.tx(p, async (tx) => {
    const team = await tx.selectFrom('teams').select(['id', 'name']).where('id', '=', teamId).executeTakeFirst();
    if (!team) throw notFound('Team');
    const members = await teamMembers(tx, teamId);
    const header = ['user_id', 'name', 'email', 'team', 'assignment_id', 'item_kind', 'item_id', 'due_at', 'status', 'progress', 'best_score', 'attempts', 'minutes'];
    let out = csvLine(header);
    for (const m of members) {
      const attempts = await tx.selectFrom('lab_attempts').select(['lab_id', 'duration_s']).where('user_id', '=', m.id).where('started_at', '>=', fromD).where('started_at', '<=', toD).execute();
      const minutes = Math.round(attempts.reduce((a, x) => a + x.duration_s, 0) / 60);
      const mine = await ps.myAssignmentsTx(tx, m.id);
      if (!mine.length) out += csvLine([m.id, m.name, m.email, team.name, '', '', '', '', '', '', '', attempts.length, minutes]);
      for (const a of mine) {
        const n = attempts.filter((x) => (a.item.labIds ?? []).includes(x.lab_id)).length;
        out += csvLine([m.id, m.name, m.email, team.name, a.id, a.item.kind, a.item.id, a.dueAt ?? '', a.status, a.progress, a.bestScore ?? '', n, minutes]);
      }
    }
    await audit(tx, actorOf(p, ip), 'report.export', 'team', teamId, { report: 'progress.csv', from: fromD.toISOString(), to: toD.toISOString(), rows: members.length }, team.name);
    return out;
  });
}

