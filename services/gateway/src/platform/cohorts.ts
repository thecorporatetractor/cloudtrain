import type { BoardSession, BroadcastRequest, Cohort, CohortBoard, CohortBoardRow, CreateCohortRequest, LiveSession, SessionControlResponse, UpdateCohortRequest, UserRef } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, can } from '../authz.js';
import type { Tx } from '../db/index.js';
import type { CohortRow } from '../db/schema.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import type { LabSession } from '../kube/types.js';
import { endAttempt } from '../learner/learning.js';
import { labIdOf, phaseOf, resultsOf, revealedHints } from '../sessions/map.js';
import type { SessionService } from '../sessions/service.js';
import { actorOf, audit } from './audit.js';
import { userRef, type PlatformService } from './service.js';

const MIN = 60_000;

function statusOf(c: CohortRow, now: Date): Cohort['status'] {
  if (now < c.starts_at) return 'upcoming';
  if (now > c.ends_at) return 'ended';
  return 'live';
}

async function toCohorts(ps: PlatformService, tx: Tx, rows: CohortRow[]): Promise<Cohort[]> {
  if (!rows.length) return [];
  const userIds = [...new Set(rows.flatMap((r) => [...r.instructor_ids, ...(r.created_by ? [r.created_by] : [])]))];
  const users = userIds.length ? await tx.selectFrom('users').selectAll().where('id', 'in', userIds).execute() : [];
  const counts = await tx
    .selectFrom('cohort_members')
    .select(['cohort_id', (eb) => eb.fn.countAll<number>().as('n')])
    .where(
      'cohort_id',
      'in',
      rows.map((r) => r.id),
    )
    .groupBy('cohort_id')
    .execute();
  const now = ps.now();
  return rows.map((r) => {
    const creator = users.find((u) => u.id === r.created_by);
    return {
      id: r.id,
      name: r.name,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      status: statusOf(r, now),
      instructors: r.instructor_ids.map((id) => users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u).map(userRef),
      memberCount: Number(counts.find((c) => c.cohort_id === r.id)?.n ?? 0),
      ...(r.path_id ? { pathId: r.path_id } : {}),
      labIds: r.lab_ids,
      ...(creator ? { createdBy: userRef(creator) } : {}),
    };
  });
}

const cohortTarget = (r: CohortRow) => ({ kind: 'cohort' as const, cohortId: r.id, createdBy: r.created_by });

async function cohortRow(tx: Tx, id: string): Promise<CohortRow> {
  const r = await tx.selectFrom('cohorts').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw notFound('Cohort');
  return r;
}

export async function listCohorts(ps: PlatformService, p: Principal): Promise<Cohort[]> {
  if (!can(p, 'cohort.manage') && !can(p, 'progress.read.team')) authorize(p, 'cohort.manage');
  return ps.tx(p, async (tx) => {
    const rows = await tx.selectFrom('cohorts').selectAll().orderBy('starts_at', 'desc').execute();
    return toCohorts(
      ps,
      tx,
      rows.filter((r) => can(p, 'progress.read.team', cohortTarget(r)) || can(p, 'cohort.manage', cohortTarget(r))),
    );
  });
}

export async function getCohort(ps: PlatformService, p: Principal, id: string): Promise<Cohort> {
  return ps.tx(p, async (tx) => {
    const r = await cohortRow(tx, id);
    if (!can(p, 'cohort.manage', cohortTarget(r))) authorize(p, 'progress.read.team', cohortTarget(r));
    return (await toCohorts(ps, tx, [r]))[0]!;
  });
}

function validLabs(ps: PlatformService, ids: string[] | undefined): string[] {
  const labs = ids ?? [];
  const unknown = labs.filter((l) => !ps.content.labs.has(l));
  if (unknown.length) throw badRequest(`Unknown labs: ${unknown.join(', ')}`, { labIds: 'unknown' });
  return labs;
}

async function ensureMembers(tx: Tx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const found = await tx.selectFrom('memberships').select('user_id').where('user_id', 'in', ids).where('status', '=', 'active').execute();
  const missing = ids.filter((id) => !found.some((f) => f.user_id === id));
  if (missing.length) throw badRequest(`Not active members of this organization: ${missing.join(', ')}`, { userIds: 'unknown' });
}

export async function createCohort(ps: PlatformService, p: Principal, req: CreateCohortRequest, ip?: string): Promise<Cohort> {
  authorize(p, 'cohort.manage');
  if (!req?.name?.trim()) throw badRequest('name is required', { name: 'required' });
  const starts = new Date(req.startsAt);
  const ends = new Date(req.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) throw badRequest('startsAt/endsAt must be ISO timestamps with endsAt after startsAt.', { endsAt: 'invalid' });
  const pathLabs = req.pathId ? ps.content.paths.find((x) => x.id === req.pathId)?.labIds : undefined;
  if (req.pathId && !pathLabs) throw badRequest(`Unknown path ${req.pathId}`, { pathId: 'unknown' });
  const labs = Array.from(new Set([...(pathLabs ?? []), ...validLabs(ps, req.labIds)]));
  // An instructor creates cohorts they instruct; org admins may name anyone.
  const instructors = can(p, 'cohort.manage', { kind: 'org' }) && req.instructorIds?.length ? req.instructorIds : [p.sub];
  return ps.tx(p, async (tx) => {
    await ensureMembers(tx, [...instructors, ...(req.memberIds ?? [])]);
    const r = await tx
      .insertInto('cohorts')
      .values({ org_id: p.orgId, name: req.name.trim(), starts_at: starts, ends_at: ends, instructor_ids: instructors, path_id: req.pathId ?? null, lab_ids: labs, created_by: p.sub })
      .returningAll()
      .executeTakeFirstOrThrow();
    for (const u of new Set(req.memberIds ?? [])) await tx.insertInto('cohort_members').values({ org_id: p.orgId, cohort_id: r.id, user_id: u }).execute();
    await audit(tx, actorOf(p, ip), 'cohort.create', 'cohort', r.id, { instructors, members: req.memberIds?.length ?? 0, labs }, r.name);
    return (await toCohorts(ps, tx, [r]))[0]!;
  });
}

export async function updateCohort(ps: PlatformService, p: Principal, id: string, req: UpdateCohortRequest, ip?: string): Promise<Cohort> {
  return ps.tx(p, async (tx) => {
    const r = await cohortRow(tx, id);
    authorize(p, 'cohort.manage', cohortTarget(r));
    const set: Partial<{ name: string; starts_at: Date; ends_at: Date; instructor_ids: string[]; path_id: string | null; lab_ids: string[] }> = {};
    if (req.name !== undefined) set.name = req.name.trim();
    if (req.startsAt) set.starts_at = new Date(req.startsAt);
    if (req.endsAt) set.ends_at = new Date(req.endsAt);
    if (req.labIds) set.lab_ids = validLabs(ps, req.labIds);
    if (req.pathId !== undefined) set.path_id = req.pathId || null;
    if (req.instructorIds) {
      if (!can(p, 'cohort.manage', { kind: 'org' }) && !req.instructorIds.includes(p.sub)) throw badRequest('You cannot remove yourself as the instructor.', { instructorIds: 'invalid' });
      await ensureMembers(tx, req.instructorIds);
      set.instructor_ids = req.instructorIds;
    }
    if (Object.keys(set).length) await tx.updateTable('cohorts').set(set).where('id', '=', id).execute();
    if (req.memberIds) {
      await ensureMembers(tx, req.memberIds);
      await tx.deleteFrom('cohort_members').where('cohort_id', '=', id).execute();
      for (const u of new Set(req.memberIds)) await tx.insertInto('cohort_members').values({ org_id: p.orgId, cohort_id: id, user_id: u }).execute();
    }
    await audit(tx, actorOf(p, ip), 'cohort.update', 'cohort', id, { fields: Object.keys(req) }, r.name);
    return (await toCohorts(ps, tx, [await cohortRow(tx, id)]))[0]!;
  });
}

export async function addCohortMembers(ps: PlatformService, p: Principal, id: string, userIds: string[], ip?: string): Promise<Cohort> {
  if (!Array.isArray(userIds) || !userIds.length) throw badRequest('userIds is required', { userIds: 'required' });
  return ps.tx(p, async (tx) => {
    const r = await cohortRow(tx, id);
    authorize(p, 'cohort.manage', cohortTarget(r));
    await ensureMembers(tx, userIds);
    for (const u of new Set(userIds)) {
      await tx.insertInto('cohort_members').values({ org_id: p.orgId, cohort_id: id, user_id: u }).onConflict((oc) => oc.columns(['cohort_id', 'user_id']).doNothing()).execute();
    }
    await audit(tx, actorOf(p, ip), 'cohort.member_add', 'cohort', id, { userIds }, r.name);
    return (await toCohorts(ps, tx, [r]))[0]!;
  });
}

export async function removeCohortMember(ps: PlatformService, p: Principal, id: string, userId: string, ip?: string): Promise<void> {
  await ps.tx(p, async (tx) => {
    const r = await cohortRow(tx, id);
    authorize(p, 'cohort.manage', cohortTarget(r));
    const d = await tx.deleteFrom('cohort_members').where('cohort_id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!Number(d.numDeletedRows)) throw notFound('Cohort member');
    await audit(tx, actorOf(p, ip), 'cohort.member_remove', 'cohort', id, { userId }, r.name);
  });
}

/* --------------------------------------------------------------- live board */

async function observersBySession(tx: Tx, names: string[]): Promise<Map<string, UserRef[]>> {
  const out = new Map<string, UserRef[]>();
  if (!names.length) return out;
  const rows = await tx
    .selectFrom('session_notices as n')
    .innerJoin('users as u', 'u.id', 'n.from_id')
    .select(['n.session_name', 'u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url'])
    .where('n.kind', '=', 'observed')
    .where('n.active', '=', true)
    .where('n.session_name', 'in', names)
    .execute();
  for (const r of rows) {
    const list = out.get(r.session_name!) ?? [];
    if (!list.some((u) => u.id === r.id)) list.push(userRef(r));
    out.set(r.session_name!, list);
  }
  return out;
}

export function boardSession(ps: PlatformService, ls: LabSession, attempt: { hints_used: number; validations: number; checks_passed: number } | undefined, observedBy: UserRef[]): BoardSession {
  const labId = labIdOf(ls) ?? '';
  const lab = ps.content.labs.get(labId)?.lab;
  const results = lab ? resultsOf(ls, lab) : [];
  const passed = results.filter((r) => r.status === 'pass').length;
  const total = lab?.spec.checks.length ?? 0;
  const started = ls.metadata.creationTimestamp ?? ps.now().toISOString();
  const minutes = Math.max(0, Math.round((ps.now().getTime() - Date.parse(started)) / MIN));
  const hints = Math.max(revealedHints(ls).length, attempt?.hints_used ?? 0);
  const validations = ls.status?.validation?.observedRequest ?? attempt?.validations ?? 0;
  const est = lab?.metadata.estimatedMinutes ?? 30;
  // "Stuck": well past the estimate with half the checks open, several failing validates, or leaning on hints.
  const reasons: string[] = [];
  if (minutes > est * 1.5 && passed < total / 2) reasons.push(`${minutes} min on a ${est} min lab with ${passed}/${total} checks passing`);
  if (validations >= 3 && passed < total) reasons.push(`${validations} validates without passing every check`);
  if (hints >= 2 && passed < total) reasons.push(`${hints} hints used`);
  const v = ls.status?.validation;
  return {
    id: ls.metadata.name,
    labId,
    labTitle: lab?.metadata.title ?? labId,
    phase: phaseOf(ls),
    startedAt: started,
    ...((ls.status?.expiresAt ?? ls.spec.expiresAt) ? { expiresAt: ls.status?.expiresAt ?? ls.spec.expiresAt } : {}),
    checksPassed: passed,
    checksTotal: total,
    score: v?.phase === 'Complete' ? v.score : 0,
    hintsUsed: hints,
    validations,
    minutesOnTask: minutes,
    stuck: reasons.length > 0,
    ...(reasons.length ? { stuckReason: reasons.join('; ') } : {}),
    observedBy,
  };
}

const activeFirst = (a: LabSession, b: LabSession) => (b.metadata.creationTimestamp ?? '').localeCompare(a.metadata.creationTimestamp ?? '');

export async function board(ps: PlatformService, p: Principal, id: string): Promise<CohortBoard> {
  return ps.tx(p, async (tx) => {
    const r = await cohortRow(tx, id);
    authorize(p, 'progress.read.team', cohortTarget(r));
    const [cohort] = await toCohorts(ps, tx, [r]);
    const members = await tx
      .selectFrom('cohort_members as cm')
      .innerJoin('users as u', 'u.id', 'cm.user_id')
      .select(['u.id', 'u.name', 'u.email', 'u.title', 'u.avatar_url'])
      .where('cm.cohort_id', '=', id)
      .orderBy('u.name')
      .execute();
    const live = (await ps.liveClusterSessions(p.orgId)).sort(activeFirst);
    const names = live.map((s) => s.metadata.name);
    const attempts = names.length ? await tx.selectFrom('lab_attempts').select(['session_name', 'hints_used', 'validations', 'checks_passed']).where('session_name', 'in', names).execute() : [];
    const observers = await observersBySession(tx, names);
    const rows: CohortBoardRow[] = [];
    for (const m of members) {
      const ls = live.find((s) => s.spec.learner.id === m.id);
      const last = await tx
        .selectFrom('lab_attempts')
        .selectAll('lab_attempts')
        .select((eb) => eb.selectFrom('check_results as c').select((e) => e.fn.max('c.graded_at').as('m')).whereRef('c.attempt_id', '=', 'lab_attempts.id').as('last_run_at'))
        .where('user_id', '=', m.id)
        .orderBy('started_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      const passed = r.lab_ids.length
        ? (await tx.selectFrom('lab_attempts').select('lab_id').distinct().where('user_id', '=', m.id).where('outcome', '=', 'passed').where('lab_id', 'in', r.lab_ids).execute()).length
        : 0;
      rows.push({
        user: userRef(m),
        session: ls ? boardSession(ps, ls, attempts.find((a) => a.session_name === ls.metadata.name), observers.get(ls.metadata.name) ?? []) : null,
        ...(last ? { lastAttempt: ps.toAttempt(last) } : {}),
        progress: { labsPassed: passed, labsTotal: r.lab_ids.length },
      });
    }
    return { cohort: cohort!, rows, generatedAt: ps.now().toISOString() };
  });
}

export async function broadcast(ps: PlatformService, p: Principal, id: string, req: BroadcastRequest, ip?: string): Promise<void> {
  const message = req?.message?.trim();
  if (!message) throw badRequest('message is required', { message: 'required' });
  await ps.tx(p, async (tx) => {
    const r = await cohortRow(tx, id);
    authorize(p, 'session.control', cohortTarget(r));
    const members = await tx.selectFrom('cohort_members').select('user_id').where('cohort_id', '=', id).execute();
    const kind = req.kind === 'hint' ? 'hint' : 'broadcast';
    for (const m of members) await tx.insertInto('session_notices').values({ org_id: p.orgId, user_id: m.user_id, session_name: null, kind, message: message.slice(0, 1000), from_id: p.sub }).execute();
    await audit(tx, actorOf(p, ip), 'cohort.broadcast', 'cohort', id, { kind, recipients: members.length, message: message.slice(0, 200) }, r.name);
  });
}

/* --------------------------------------------------- session control/observe */

async function controlled(ps: PlatformService, sessions: SessionService, p: Principal, id: string, perm: 'session.control' | 'session.observe'): Promise<LabSession> {
  const found = await sessions.find(id);
  if (!found) throw notFound('Session');
  const subject = await ps.sessionSubject(p, found.ls);
  authorize(p, perm, subject);
  return found.ls;
}

export async function controlSession(ps: PlatformService, sessions: SessionService, p: Principal, id: string, action: 'extend' | 'reset' | 'terminate', minutes?: number, ip?: string): Promise<SessionControlResponse> {
  const ls = await controlled(ps, sessions, p, id, 'session.control');
  const orgId = ls.spec.learner.org ?? p.orgId;
  const learner = ls.spec.learner.id;
  let res: SessionControlResponse;
  let message: string;
  if (action === 'extend') {
    const m = Math.floor(Number(minutes));
    if (!Number.isFinite(m) || m < 1 || m > 240) throw badRequest('minutes must be between 1 and 240', { minutes: 'invalid' });
    const q = await ps.orgTx(orgId, p.sub, (tx) => ps.quotas(tx, orgId));
    const current = Date.parse(ls.status?.expiresAt ?? ls.spec.expiresAt ?? '') || ps.now().getTime();
    const next = Math.max(current, ps.now().getTime()) + m * MIN;
    const total = (next - (Date.parse(ls.metadata.creationTimestamp ?? '') || ps.now().getTime())) / MIN;
    // An extension may at most double the org's session length limit.
    if (total > q.maxSessionMinutes * 2) throw new HttpError(429, `A session may not run longer than ${q.maxSessionMinutes * 2} minutes in total.`, { code: 'quota_exceeded', details: { quota: 'max_session_minutes', limit: q.maxSessionMinutes * 2, current: Math.round(total) } });
    const expiresAt = (await sessions.extend(id, m)).spec.expiresAt!;
    res = { sessionId: id, action, expiresAt };
    message = `Your instructor gave you ${m} more minutes.`;
  } else if (action === 'reset') {
    const patched = await sessions.reset(id);
    res = { sessionId: id, action, resetGeneration: patched.spec.resetGeneration ?? 0 };
    message = 'Your lab environment is being reset to its starting state.';
  } else {
    await sessions.terminate(id);
    res = { sessionId: id, action };
    message = 'This lab session was ended by your instructor or administrator.';
  }
  await ps.orgTx(orgId, p.sub, async (tx) => {
    await tx.insertInto('session_notices').values({ org_id: orgId, user_id: learner, session_name: id, kind: action === 'extend' ? 'extended' : action === 'reset' ? 'reset' : 'terminated', message, from_id: p.sub }).execute();
    if (action === 'terminate') {
      await endAttempt(tx, id, ps.now(), revealedHints(ls).length);
      await tx.updateTable('session_notices').set({ active: false, ended_at: ps.now() }).where('session_name', '=', id).where('active', '=', true).execute();
    }
    await audit(tx, actorOf(p, ip, orgId), `session.${action}`, 'session', id, { learner, lab: labIdOf(ls), ...(action === 'extend' ? { minutes, expiresAt: res.expiresAt } : {}), ...(action === 'reset' ? { resetGeneration: res.resetGeneration } : {}) });
  });
  return res;
}

/** Starts a read-only observation: authorizes, records the learner-visible notice and the audit entry. */
export async function startObserve(ps: PlatformService, sessions: SessionService, p: Principal, id: string, ip?: string): Promise<{ noticeId: string; learnerId: string; orgId: string }> {
  const ls = await controlled(ps, sessions, p, id, 'session.observe');
  const orgId = ls.spec.learner.org ?? p.orgId;
  const learnerId = ls.spec.learner.id;
  return ps.orgTx(orgId, p.sub, async (tx) => {
    const n = await tx
      .insertInto('session_notices')
      .values({ org_id: orgId, user_id: learnerId, session_name: id, kind: 'observed', message: `${p.name} is watching your terminal (read-only).`, from_id: p.sub, active: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(tx, actorOf(p, ip, orgId), 'session.observe', 'session', id, { learner: learnerId, lab: labIdOf(ls), mode: 'read-only' });
    return { noticeId: n.id, learnerId, orgId };
  });
}

export async function endObserve(ps: PlatformService, orgId: string, noticeId: string): Promise<void> {
  await ps.orgTx(orgId, null, (tx) => tx.updateTable('session_notices').set({ active: false, ended_at: ps.now() }).where('id', '=', noticeId).execute());
}

/** Admin "Sessions" view: every live session in the org. */
export async function liveSessions(ps: PlatformService, p: Principal): Promise<LiveSession[]> {
  authorize(p, 'session.control', { kind: 'org' });
  const live = (await ps.liveClusterSessions(p.orgId)).sort(activeFirst);
  return ps.tx(p, async (tx) => {
    const ids = [...new Set(live.map((s) => s.spec.learner.id))];
    const users = ids.length ? await tx.selectFrom('users').selectAll().where('id', 'in', ids).execute() : [];
    const observers = await observersBySession(
      tx,
      live.map((s) => s.metadata.name),
    );
    return live.map((ls) => {
      const b = boardSession(ps, ls, undefined, observers.get(ls.metadata.name) ?? []);
      const u = users.find((x) => x.id === ls.spec.learner.id);
      return {
        id: b.id,
        user: u ? userRef(u) : { id: ls.spec.learner.id, name: ls.spec.learner.id, email: '' },
        labId: b.labId,
        labTitle: b.labTitle,
        phase: b.phase,
        startedAt: b.startedAt,
        ...(b.expiresAt ? { expiresAt: b.expiresAt } : {}),
        score: b.score,
        checksPassed: b.checksPassed,
        checksTotal: b.checksTotal,
        observedBy: b.observedBy,
      };
    });
  });
}
