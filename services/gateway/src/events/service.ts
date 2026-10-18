import { createHash } from 'node:crypto';
import type {
  CreateCtfEventRequest,
  CtfEventDetail,
  CtfEventLab,
  CtfEventReport,
  CtfEventStatus,
  CtfEventSummary,
  CtfScoreboard,
  CtfTeam,
  JoinCtfEventRequest,
  LabSession as WebSession,
  UpdateCtfEventRequest,
  UserRef,
} from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, can } from '../authz.js';
import type { ContentLab } from '../content/load.js';
import type { Tx } from '../db/index.js';
import type { CtfEventRow } from '../db/schema.js';
import { badRequest, conflict, HttpError, notFound } from '../errors.js';
import { LABEL_CTF_EVENT, LABEL_CTF_TEAM, LABEL_LAB, LABEL_LEARNER, LABEL_MANAGED_BY, MANAGED_BY, type LabSession } from '../kube/types.js';
import { answerChecks, DEFAULT_POINTS } from '../answers/questions.js';
import type { ScopeContext, ScopeResolver } from '../answers/service.js';
import { soloScope } from '../answers/service.js';
import { actorOf, audit } from '../platform/audit.js';
import { csvLine } from '../platform/manager.js';
import { UNKNOWN_USER, userRef, type PlatformService } from '../platform/service.js';
import { phaseOf } from '../sessions/map.js';
import { labelValue, type SessionService } from '../sessions/service.js';
import { qkey, questionValue, scoreEvent, type Entrant, type EventReveal, type EventSubmission, type QuestionDef, type ScoringRules } from './scoring.js';

const MIN = 60_000;

/** Seed of an event lab for one entrant: teammates share data (and answers), entrants differ. */
export function eventSeed(eventId: string, entrantId: string, labId: string): number {
  const h = createHash('sha256').update(`cloudtrain/ctf-event/v1|${eventId}|${entrantId}|${labId}`).digest();
  return (h.readUInt32BE(0) % (2 ** 31 - 2)) + 1;
}

export function eventStatus(e: Pick<CtfEventRow, 'published' | 'starts_at' | 'ends_at'>, now: Date): CtfEventStatus {
  if (!e.published) return 'draft';
  if (now < e.starts_at) return 'upcoming';
  if (now < e.ends_at) return 'running';
  return 'ended';
}

const rules = (e: CtfEventRow): ScoringRules => ({ scoring: e.scoring, dynamicMinPct: e.dynamic_min_pct, dynamicDecay: e.dynamic_decay, firstBlood: e.first_blood });

/**
 * CTF events: timed sets of CTF labs, solo or in teams, scored from the
 * answers submitted in event sessions (answers/). Managers (`event.manage`)
 * create and run them; learners (`lab.run`) join, play and see the
 * scoreboard (frozen during the last minutes when the event says so).
 */
export class EventService {
  constructor(
    private readonly ps: PlatformService,
    private readonly sessions: SessionService,
  ) {}

  private now() {
    return this.ps.now();
  }

  /* ------------------------------------------------------------ helpers */

  private async row(tx: Tx, p: Principal, id: string): Promise<CtfEventRow> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('Event');
    const e = await tx.selectFrom('ctf_events').selectAll().where('id', '=', id).executeTakeFirst();
    if (!e || (!e.published && !can(p, 'event.manage'))) throw notFound('Event');
    return e;
  }

  private labsOf(e: CtfEventRow): ContentLab[] {
    return e.lab_ids.map((id) => this.ps.content.labs.get(id)).filter((l): l is ContentLab => !!l);
  }

  private questionsOf(e: CtfEventRow): QuestionDef[] {
    return this.labsOf(e).flatMap((l) =>
      answerChecks(l.lab).map((c, i) => ({ labId: l.lab.metadata.id, checkId: c.id, number: i + 1, prompt: c.description, points: c.answer.points ?? DEFAULT_POINTS, penalty: c.answer.penalty ?? 0 })),
    );
  }

  private eventLabs(e: CtfEventRow): CtfEventLab[] {
    return this.labsOf(e).map((l) => {
      const qs = answerChecks(l.lab);
      return {
        labId: l.lab.metadata.id,
        title: l.lab.metadata.title,
        difficulty: l.lab.metadata.difficulty,
        estimatedMinutes: l.lab.metadata.estimatedMinutes,
        questionCount: qs.length,
        points: qs.reduce((n, c) => n + (c.answer.points ?? DEFAULT_POINTS), 0),
      };
    });
  }

  private async users(tx: Tx, ids: string[]): Promise<Map<string, UserRef>> {
    if (!ids.length) return new Map();
    const rows = await tx.selectFrom('users').select(['id', 'name', 'email', 'title', 'avatar_url']).where('id', 'in', [...new Set(ids)]).execute();
    return new Map(rows.map((u) => [u.id, userRef(u)]));
  }

  private async teams(tx: Tx, eventId: string): Promise<{ teams: CtfTeam[]; participants: { user_id: string; team_id: string | null; joined_at: Date }[]; users: Map<string, UserRef> }> {
    const teamRows = await tx.selectFrom('ctf_event_teams').select(['id', 'name']).where('event_id', '=', eventId).orderBy('created_at').execute();
    const participants = await tx.selectFrom('ctf_event_participants').select(['user_id', 'team_id', 'joined_at']).where('event_id', '=', eventId).execute();
    const users = await this.users(tx, participants.map((x) => x.user_id));
    const teams = teamRows.map((t) => ({ id: t.id, name: t.name, members: participants.filter((x) => x.team_id === t.id).map((x) => users.get(x.user_id) ?? { ...UNKNOWN_USER, id: x.user_id }) }));
    return { teams, participants, users };
  }

  private summary(e: CtfEventRow, creator: UserRef | undefined, participants: number, teams: number, joined: boolean): CtfEventSummary {
    return {
      id: e.id,
      title: e.title,
      ...(e.description ? { description: e.description } : {}),
      labIds: e.lab_ids,
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at.toISOString(),
      mode: e.mode,
      ...(e.mode === 'team' ? { teamSizeMax: e.team_size_max, teamFormation: e.team_formation } : {}),
      scoring: e.scoring,
      ...(e.scoring === 'dynamic' ? { dynamicMinPct: e.dynamic_min_pct, dynamicDecay: e.dynamic_decay } : {}),
      firstBlood: e.first_blood,
      freezeMinutes: e.freeze_minutes,
      published: e.published,
      status: eventStatus(e, this.now()),
      createdBy: creator ?? UNKNOWN_USER,
      participants,
      teams,
      joined,
    };
  }

  private validate(s: Partial<CreateCtfEventRequest>, full: boolean): void {
    const errors: Record<string, string> = {};
    if (full || s.title !== undefined) if (!s.title?.trim() || s.title.length > 120) errors.title = 'A title of 1-120 characters is required.';
    if (full || s.labIds !== undefined) {
      if (!Array.isArray(s.labIds) || !s.labIds.length || s.labIds.length > 50) errors.labIds = 'Pick 1-50 CTF labs.';
      else
        for (const id of s.labIds) {
          const l = this.ps.content.labs.get(id);
          if (!l) errors.labIds = `Unknown lab ${id}.`;
          else if (!answerChecks(l.lab).length) errors.labIds = `${l.lab.metadata.title} has no questions (answer checks).`;
        }
    }
    if (full || s.mode !== undefined) if (s.mode !== 'solo' && s.mode !== 'team') errors.mode = 'Mode is solo or team.';
    if (full || s.scoring !== undefined) if (s.scoring !== 'static' && s.scoring !== 'dynamic') errors.scoring = 'Scoring is static or dynamic.';
    if (s.teamSizeMax !== undefined && !(Number.isInteger(s.teamSizeMax) && s.teamSizeMax >= 1 && s.teamSizeMax <= 20)) errors.teamSizeMax = 'Team size is 1-20.';
    if (s.teamFormation !== undefined && s.teamFormation !== 'self' && s.teamFormation !== 'manager') errors.teamFormation = 'Teams are formed by learners (self) or by the manager.';
    if (s.dynamicMinPct !== undefined && !(Number.isInteger(s.dynamicMinPct) && s.dynamicMinPct >= 1 && s.dynamicMinPct <= 100)) errors.dynamicMinPct = 'Minimum is 1-100 %.';
    if (s.dynamicDecay !== undefined && !(Number.isInteger(s.dynamicDecay) && s.dynamicDecay >= 1 && s.dynamicDecay <= 1000)) errors.dynamicDecay = 'Decay is 1-1000 solves.';
    if (s.freezeMinutes !== undefined && !(Number.isInteger(s.freezeMinutes) && s.freezeMinutes >= 0 && s.freezeMinutes <= 1440)) errors.freezeMinutes = 'Freeze is 0-1440 minutes.';
    for (const k of ['startsAt', 'endsAt'] as const) if ((full || s[k] !== undefined) && Number.isNaN(Date.parse(s[k] ?? ''))) errors[k] = 'A date and time is required.';
    if (Object.keys(errors).length) throw badRequest('The event is not valid.', errors);
  }

  /* ------------------------------------------------------------ queries */

  async list(p: Principal): Promise<CtfEventSummary[]> {
    return this.ps.tx(p, async (tx) => {
      let q = tx.selectFrom('ctf_events').selectAll().orderBy('starts_at', 'desc');
      if (!can(p, 'event.manage')) q = q.where('published', '=', true);
      const rows = await q.execute();
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const parts = await tx.selectFrom('ctf_event_participants').select(['event_id', 'user_id']).where('event_id', 'in', ids).execute();
      const teams = await tx.selectFrom('ctf_event_teams').select(['event_id']).where('event_id', 'in', ids).execute();
      const creators = await this.users(tx, rows.map((r) => r.created_by).filter((x): x is string => !!x));
      return rows.map((e) =>
        this.summary(
          e,
          e.created_by ? creators.get(e.created_by) : undefined,
          parts.filter((x) => x.event_id === e.id).length,
          teams.filter((x) => x.event_id === e.id).length,
          parts.some((x) => x.event_id === e.id && x.user_id === p.sub),
        ),
      );
    });
  }

  async get(p: Principal, id: string): Promise<CtfEventDetail> {
    const detail = await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const { teams, participants, users } = await this.teams(tx, e.id);
      const me = participants.find((x) => x.user_id === p.sub);
      const creator = e.created_by ? (await this.users(tx, [e.created_by])).get(e.created_by) : undefined;
      const myTeam = me?.team_id ? teams.find((t) => t.id === me.team_id) : undefined;
      void users;
      return {
        ...this.summary(e, creator, participants.length, teams.length, !!me),
        labs: this.eventLabs(e),
        teamList: e.mode === 'team' ? teams : [],
        ...(myTeam ? { myTeam } : {}),
        mySessions: {} as Record<string, string>,
        serverNow: this.now().toISOString(),
        canManage: can(p, 'event.manage'),
      };
    });
    for (const s of await this.liveSessions(p, id)) detail.mySessions[s.labId] = s.id;
    return detail;
  }

  /** The caller's running sessions of an event (newest first). */
  private async liveSessions(p: Principal, eventId: string): Promise<{ id: string; labId: string }[]> {
    const items = await this.ps.cluster.listSessions(`${LABEL_LEARNER}=${labelValue(p.sub)},${LABEL_MANAGED_BY}=${MANAGED_BY},${LABEL_CTF_EVENT}=${eventId}`);
    return items
      .filter((ls) => ls.spec.learner.id === p.sub && !['expired', 'failed'].includes(phaseOf(ls)))
      .sort((a, b) => (b.metadata.creationTimestamp ?? '').localeCompare(a.metadata.creationTimestamp ?? ''))
      .map((ls) => ({ id: ls.metadata.name, labId: ls.metadata.labels?.[LABEL_LAB] ?? '' }));
  }

  /* ----------------------------------------------------------- manage */

  async create(p: Principal, body: CreateCtfEventRequest, ip?: string): Promise<CtfEventDetail> {
    authorize(p, 'event.manage', { kind: 'org' });
    this.validate(body ?? {}, true);
    for (const l of body.labIds) await this.ps.assertLabVisible(p, l);
    const id = await this.ps.tx(p, async (tx) => {
      const starts = new Date(body.startsAt);
      const ends = new Date(body.endsAt);
      if (ends <= starts) throw badRequest('The event is not valid.', { endsAt: 'The end must be after the start.' });
      const row = await tx
        .insertInto('ctf_events')
        .values({
          org_id: p.orgId,
          title: body.title.trim(),
          description: body.description?.trim() || null,
          lab_ids: [...new Set(body.labIds)],
          starts_at: starts,
          ends_at: ends,
          mode: body.mode,
          team_size_max: body.mode === 'team' ? (body.teamSizeMax ?? 4) : 1,
          team_formation: body.teamFormation ?? 'self',
          scoring: body.scoring,
          dynamic_min_pct: body.dynamicMinPct ?? 30,
          dynamic_decay: body.dynamicDecay ?? 10,
          first_blood: body.firstBlood ?? true,
          freeze_minutes: body.freezeMinutes ?? 0,
          published: body.published ?? false,
          created_by: p.sub,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(tx, actorOf(p, ip), 'event.create', 'ctf_event', row.id, { labs: body.labIds, mode: body.mode, scoring: body.scoring, startsAt: body.startsAt, endsAt: body.endsAt }, body.title);
      return row.id;
    });
    return this.get(p, id);
  }

  async update(p: Principal, id: string, body: UpdateCtfEventRequest, ip?: string): Promise<CtfEventDetail> {
    authorize(p, 'event.manage', { kind: 'org' });
    this.validate(body ?? {}, false);
    for (const l of body.labIds ?? []) await this.ps.assertLabVisible(p, l);
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const starts = body.startsAt ? new Date(body.startsAt) : e.starts_at;
      const ends = body.endsAt ? new Date(body.endsAt) : e.ends_at;
      if (ends <= starts) throw badRequest('The event is not valid.', { endsAt: 'The end must be after the start.' });
      const running = eventStatus(e, this.now()) === 'running' || eventStatus(e, this.now()) === 'ended';
      if (running && (body.mode !== undefined && body.mode !== e.mode)) throw conflict('The mode cannot change once the event has started.');
      await tx
        .updateTable('ctf_events')
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
          ...(body.labIds ? { lab_ids: [...new Set(body.labIds)] } : {}),
          starts_at: starts,
          ends_at: ends,
          ...(body.mode ? { mode: body.mode } : {}),
          ...(body.teamSizeMax !== undefined ? { team_size_max: body.teamSizeMax } : {}),
          ...(body.teamFormation ? { team_formation: body.teamFormation } : {}),
          ...(body.scoring ? { scoring: body.scoring } : {}),
          ...(body.dynamicMinPct !== undefined ? { dynamic_min_pct: body.dynamicMinPct } : {}),
          ...(body.dynamicDecay !== undefined ? { dynamic_decay: body.dynamicDecay } : {}),
          ...(body.firstBlood !== undefined ? { first_blood: body.firstBlood } : {}),
          ...(body.freezeMinutes !== undefined ? { freeze_minutes: body.freezeMinutes } : {}),
          ...(body.published !== undefined ? { published: body.published } : {}),
          updated_at: this.now(),
        })
        .where('id', '=', e.id)
        .execute();
      await audit(tx, actorOf(p, ip), 'event.update', 'ctf_event', e.id, { changed: Object.keys(body ?? {}) }, e.title);
    });
    return this.get(p, id);
  }

  async remove(p: Principal, id: string, ip?: string): Promise<void> {
    authorize(p, 'event.manage', { kind: 'org' });
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      await tx.deleteFrom('ctf_events').where('id', '=', e.id).execute();
      await audit(tx, actorOf(p, ip), 'event.delete', 'ctf_event', e.id, {}, e.title);
    });
  }

  async createTeam(p: Principal, id: string, name: string, ip?: string): Promise<CtfEventDetail> {
    authorize(p, 'event.manage', { kind: 'org' });
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      if (e.mode !== 'team') throw conflict('This is a solo event.');
      const teamId = await this.insertTeam(tx, p, e, name);
      await audit(tx, actorOf(p, ip), 'event.team_create', 'ctf_event', e.id, { team: teamId, name }, e.title);
    });
    return this.get(p, id);
  }

  private async insertTeam(tx: Tx, p: Principal, e: CtfEventRow, name: string): Promise<string> {
    const n = String(name ?? '').trim();
    if (!n || n.length > 60) throw badRequest('Team names are 1-60 characters.', { teamName: 'Team names are 1-60 characters.' });
    const dup = await tx.selectFrom('ctf_event_teams').select('id').where('event_id', '=', e.id).where((eb) => eb(eb.fn('lower', ['name']), '=', n.toLowerCase())).executeTakeFirst();
    if (dup) throw conflict(`A team called ${n} already exists.`);
    return (await tx.insertInto('ctf_event_teams').values({ org_id: p.orgId, event_id: e.id, name: n, created_by: p.sub }).returning('id').executeTakeFirstOrThrow()).id;
  }

  /** Sets a team's members (manager formation): participants only, at most teamSizeMax. */
  async setTeamMembers(p: Principal, id: string, teamId: string, userIds: string[], ip?: string): Promise<CtfEventDetail> {
    authorize(p, 'event.manage', { kind: 'org' });
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const team = await tx.selectFrom('ctf_event_teams').select(['id', 'name']).where('event_id', '=', e.id).where('id', '=', teamId).executeTakeFirst();
      if (!team) throw notFound('Team');
      const ids = [...new Set(Array.isArray(userIds) ? userIds.map(String) : [])];
      if (ids.length > e.team_size_max) throw badRequest(`Teams have at most ${e.team_size_max} members.`, { userIds: `At most ${e.team_size_max} members.` });
      const parts = await tx.selectFrom('ctf_event_participants').select('user_id').where('event_id', '=', e.id).where('user_id', 'in', ids.length ? ids : ['']).execute();
      const missing = ids.filter((u) => !parts.some((x) => x.user_id === u));
      if (missing.length) throw badRequest('Only people who joined the event can be put in a team.', { userIds: `Not joined: ${missing.join(', ')}` });
      await tx.updateTable('ctf_event_participants').set({ team_id: null }).where('event_id', '=', e.id).where('team_id', '=', team.id).execute();
      if (ids.length) await tx.updateTable('ctf_event_participants').set({ team_id: team.id }).where('event_id', '=', e.id).where('user_id', 'in', ids).execute();
      await audit(tx, actorOf(p, ip), 'event.team_members', 'ctf_event', e.id, { team: team.id, members: ids }, `${e.title}: ${team.name}`);
    });
    return this.get(p, id);
  }

  async deleteTeam(p: Principal, id: string, teamId: string, ip?: string): Promise<CtfEventDetail> {
    authorize(p, 'event.manage', { kind: 'org' });
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const res = await tx.deleteFrom('ctf_event_teams').where('event_id', '=', e.id).where('id', '=', teamId).executeTakeFirst();
      if (!Number(res.numDeletedRows)) throw notFound('Team');
      await audit(tx, actorOf(p, ip), 'event.team_delete', 'ctf_event', e.id, { team: teamId }, e.title);
    });
    return this.get(p, id);
  }

  /* ---------------------------------------------------------- learner */

  async join(p: Principal, id: string, body: JoinCtfEventRequest = {}, ip?: string): Promise<CtfEventDetail> {
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const status = eventStatus(e, this.now());
      if (status === 'draft') throw conflict('This event is not published yet.');
      if (status === 'ended') throw conflict('This event has ended.');
      const existing = await tx.selectFrom('ctf_event_participants').selectAll().where('event_id', '=', e.id).where('user_id', '=', p.sub).executeTakeFirst();
      let teamId: string | null = existing?.team_id ?? null;
      if (e.mode === 'team' && e.team_formation === 'self' && (body.teamId || body.teamName)) {
        if (existing?.team_id) throw conflict('You are already in a team for this event.');
        if (body.teamName) teamId = await this.insertTeam(tx, p, e, body.teamName);
        else {
          const team = await tx.selectFrom('ctf_event_teams').select('id').where('event_id', '=', e.id).where('id', '=', String(body.teamId)).executeTakeFirst();
          if (!team) throw notFound('Team');
          const size = await tx.selectFrom('ctf_event_participants').select((eb) => eb.fn.countAll<number>().as('n')).where('event_id', '=', e.id).where('team_id', '=', team.id).executeTakeFirstOrThrow();
          if (Number(size.n) >= e.team_size_max) throw conflict(`This team is full (${e.team_size_max} members).`);
          teamId = team.id;
        }
      }
      if (existing) {
        if (teamId !== existing.team_id) await tx.updateTable('ctf_event_participants').set({ team_id: teamId }).where('event_id', '=', e.id).where('user_id', '=', p.sub).execute();
      } else {
        await tx.insertInto('ctf_event_participants').values({ org_id: p.orgId, event_id: e.id, user_id: p.sub, team_id: teamId, joined_at: this.now() }).execute();
      }
      await audit(tx, actorOf(p, ip), 'event.join', 'ctf_event', e.id, { ...(teamId ? { team: teamId } : {}) }, e.title);
    });
    return this.get(p, id);
  }

  async leave(p: Principal, id: string, ip?: string): Promise<CtfEventDetail> {
    await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      if (eventStatus(e, this.now()) !== 'upcoming' && eventStatus(e, this.now()) !== 'draft') throw conflict('You can only leave an event before it starts.');
      const me = await tx.selectFrom('ctf_event_participants').selectAll().where('event_id', '=', e.id).where('user_id', '=', p.sub).executeTakeFirst();
      if (!me) return;
      await tx.deleteFrom('ctf_event_participants').where('event_id', '=', e.id).where('user_id', '=', p.sub).execute();
      if (me.team_id && e.team_formation === 'self') {
        const left = await tx.selectFrom('ctf_event_participants').select('user_id').where('team_id', '=', me.team_id).executeTakeFirst();
        if (!left) await tx.deleteFrom('ctf_event_teams').where('id', '=', me.team_id).execute();
      }
      await audit(tx, actorOf(p, ip), 'event.leave', 'ctf_event', e.id, {}, e.title);
    });
    return this.get(p, id);
  }

  /** Starts (or resumes) the caller's session of an event lab: seeded per entrant, ending with the event. */
  async startLab(p: Principal, id: string, labId: string): Promise<WebSession> {
    const { e, teamId } = await this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      if (!e.lab_ids.includes(labId)) throw notFound('Lab');
      const status = eventStatus(e, this.now());
      if (status !== 'running') throw conflict(status === 'ended' ? 'This event has ended.' : 'This event has not started yet.');
      const me = await tx.selectFrom('ctf_event_participants').selectAll().where('event_id', '=', e.id).where('user_id', '=', p.sub).executeTakeFirst();
      if (!me) throw new HttpError(403, 'Join the event first.', { code: 'forbidden' });
      if (e.mode === 'team' && !me.team_id) throw conflict('Join a team first.');
      return { e, teamId: me.team_id };
    });
    const live = (await this.liveSessions(p, e.id)).find((s) => s.labId === labelValue(labId));
    if (live) return this.sessions.get(p, live.id);
    const entrant = teamId ?? `u:${p.sub}`;
    return this.sessions.start(p, labId, {
      seed: eventSeed(e.id, entrant, labId),
      labels: { [LABEL_CTF_EVENT]: e.id, ...(teamId ? { [LABEL_CTF_TEAM]: teamId } : {}) },
      endsAt: e.ends_at,
    });
  }

  /* ------------------------------------------------------- scoreboard */

  private async scoreInputs(tx: Tx, e: CtfEventRow) {
    const { teams, participants, users } = await this.teams(tx, e.id);
    const entrants: Entrant[] =
      e.mode === 'team'
        ? teams.map((t) => ({ id: t.id, name: t.name, members: t.members }))
        : participants.map((x) => {
            const u = users.get(x.user_id) ?? { ...UNKNOWN_USER, id: x.user_id };
            return { id: x.user_id, name: u.name, members: [u] };
          });
    const subRows = await tx.selectFrom('answer_submissions').select(['user_id', 'team_id', 'lab_id', 'check_id', 'correct', 'submitted_at']).where('event_id', '=', e.id).execute();
    const revRows = await tx.selectFrom('answer_hint_reveals').select(['user_id', 'team_id', 'lab_id', 'check_id', 'cost', 'revealed_at']).where('event_id', '=', e.id).execute();
    const entrantOf = (r: { user_id: string; team_id: string | null }) => (e.mode === 'team' ? (r.team_id ?? '') : r.user_id);
    const submissions: EventSubmission[] = subRows.map((r) => ({ entrantId: entrantOf(r), userId: r.user_id, labId: r.lab_id, checkId: r.check_id, correct: r.correct, at: r.submitted_at }));
    const reveals: EventReveal[] = revRows.map((r) => ({ entrantId: entrantOf(r), labId: r.lab_id, checkId: r.check_id, cost: r.cost, at: r.revealed_at }));
    const solverIds = subRows.map((r) => r.user_id).filter((u) => !users.has(u));
    const allUsers = new Map([...users, ...(await this.users(tx, solverIds))]);
    return { entrants, submissions, reveals, users: allUsers, participants, teams };
  }

  private board(e: CtfEventRow, inputs: Awaited<ReturnType<EventService['scoreInputs']>>, live: boolean, mine?: string): CtfScoreboard {
    const now = this.now();
    const freezeAt = e.freeze_minutes > 0 ? new Date(e.ends_at.getTime() - e.freeze_minutes * MIN) : undefined;
    const frozen = !live && !!freezeAt && now >= freezeAt && now < e.ends_at;
    const r = scoreEvent({ rules: rules(e), questions: this.questionsOf(e), entrants: inputs.entrants, submissions: inputs.submissions, reveals: inputs.reveals, startsAt: e.starts_at, ...(frozen ? { cutoff: freezeAt } : {}), users: inputs.users });
    return {
      eventId: e.id,
      title: e.title,
      mode: e.mode,
      scoring: e.scoring,
      status: eventStatus(e, now),
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at.toISOString(),
      serverNow: now.toISOString(),
      frozen,
      ...(frozen && freezeAt ? { frozenAt: freezeAt.toISOString() } : {}),
      rows: r.rows,
      timeline: r.timeline,
      solves: r.solves.slice(0, 50),
      questions: r.questions,
      ...(mine ? { mine } : {}),
    };
  }

  async scoreboard(p: Principal, id: string): Promise<CtfScoreboard> {
    return this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const inputs = await this.scoreInputs(tx, e);
      const me = inputs.participants.find((x) => x.user_id === p.sub);
      const mine = me ? (e.mode === 'team' ? (me.team_id ?? undefined) : me.user_id) : undefined;
      return this.board(e, inputs, can(p, 'event.manage'), mine);
    });
  }

  async report(p: Principal, id: string): Promise<CtfEventReport> {
    authorize(p, 'event.manage', { kind: 'org' });
    const event = await this.get(p, id);
    return this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const inputs = await this.scoreInputs(tx, e);
      const subs = await tx.selectFrom('answer_submissions').select(['user_id', 'correct', 'submitted_at']).where('event_id', '=', e.id).execute();
      const hints = await tx.selectFrom('answer_hint_reveals').select(['user_id', 'revealed_at']).where('event_id', '=', e.id).execute();
      const teamName = new Map(inputs.teams.map((t) => [t.id, t.name]));
      const participants = inputs.participants.map((x) => {
        const mine = subs.filter((s) => s.user_id === x.user_id);
        const last = [...mine.map((s) => s.submitted_at), ...hints.filter((h) => h.user_id === x.user_id).map((h) => h.revealed_at)].sort((a, b) => b.getTime() - a.getTime())[0];
        return {
          user: inputs.users.get(x.user_id) ?? { ...UNKNOWN_USER, id: x.user_id },
          ...(x.team_id ? { teamId: x.team_id, teamName: teamName.get(x.team_id) ?? '' } : {}),
          joinedAt: x.joined_at.toISOString(),
          submissions: mine.length,
          correct: mine.filter((s) => s.correct).length,
          hints: hints.filter((h) => h.user_id === x.user_id).length,
          ...(last ? { lastActivityAt: last.toISOString() } : {}),
        };
      });
      return { event, scoreboard: this.board(e, inputs, true), participants };
    });
  }

  /** Final (or live) results as CSV: one row per entrant, one column per question (solve time). */
  async resultsCsv(p: Principal, id: string, ip?: string): Promise<{ name: string; body: string }> {
    authorize(p, 'event.manage', { kind: 'org' });
    return this.ps.tx(p, async (tx) => {
      const e = await this.row(tx, p, id);
      const inputs = await this.scoreInputs(tx, e);
      const qs = this.questionsOf(e);
      const r = scoreEvent({ rules: rules(e), questions: qs, entrants: inputs.entrants, submissions: inputs.submissions, reveals: inputs.reveals, startsAt: e.starts_at, users: inputs.users });
      const solveAt = new Map(r.solves.map((s) => [`${s.entrantId}|${qkey(s.labId, s.checkId)}`, s]));
      let body = csvLine(['rank', e.mode === 'team' ? 'team' : 'participant', 'members', 'points', 'solves', 'first_bloods', 'last_solve_at', ...qs.map((q) => `${q.labId}#${q.number}`)]);
      for (const row of r.rows) {
        body += csvLine([
          row.rank,
          row.name,
          row.members.map((m) => m.email || m.name).join('; '),
          row.points,
          row.solves,
          row.firstBloods,
          row.lastSolveAt ?? '',
          ...qs.map((q) => {
            const s = solveAt.get(`${row.id}|${qkey(q.labId, q.checkId)}`);
            return s ? `${s.at} (${s.points})` : '';
          }),
        ]);
      }
      await audit(tx, actorOf(p, ip), 'event.export', 'ctf_event', e.id, { rows: r.rows.length }, e.title);
      const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';
      return { name: `ctf-${slug}-results.csv`, body };
    });
  }

  /* ------------------------------------------------------ answer scope */

  /**
   * Answer scope of a session: solo labs keep their own session scope; event
   * sessions count for the entrant (team or person), only while the event
   * runs, with the event's scoring.
   */
  readonly resolveScope: ScopeResolver = async (p, ls, lab) => {
    const eventId = ls.metadata.labels?.[LABEL_CTF_EVENT];
    if (!eventId) return soloScope(p, ls, lab);
    const { e, me } = await this.ps.tx(p, async (tx) => {
      const e = await tx.selectFrom('ctf_events').selectAll().where('id', '=', eventId).executeTakeFirst();
      if (!e) throw notFound('Event');
      const me = await tx.selectFrom('ctf_event_participants').selectAll().where('event_id', '=', e.id).where('user_id', '=', p.sub).executeTakeFirst();
      return { e, me };
    });
    const teamLabel = ls.metadata.labels?.[LABEL_CTF_TEAM];
    if (!me || (e.mode === 'team' && (!me.team_id || me.team_id !== teamLabel))) throw new HttpError(403, 'You are no longer in this team for the event.', { code: 'forbidden' });
    const labId = lab.lab.metadata.id;
    const teamId = e.mode === 'team' ? me.team_id! : undefined;
    const teamName = teamId ? (await this.ps.tx(p, (tx) => tx.selectFrom('ctf_event_teams').select('name').where('id', '=', teamId).executeTakeFirst()))?.name : undefined;
    const ctx: ScopeContext = {
      scope: { key: `event:${e.id}:${teamId ?? `u:${p.sub}`}:${labId}`, sessionName: ls.metadata.name, labId, eventId: e.id, ...(teamId ? { teamId } : {}) },
      assertOpen: () => {
        const s = eventStatus(e, this.now());
        if (s !== 'running') throw conflict(s === 'ended' ? 'The event has ended: answers are closed.' : 'The event has not started yet.');
      },
      viewOptions: async (_ops, rec) => {
        // Event-wide solve counts (dynamic values) and first bloods for this lab.
        const correct = await this.ps.tx(p, (tx) =>
          tx.selectFrom('answer_submissions').select(['check_id', 'scope_key', 'submitted_at']).where('event_id', '=', e.id).where('lab_id', '=', labId).where('correct', '=', true).orderBy('submitted_at').execute(),
        );
        const counts = new Map<string, number>();
        const first = new Map<string, string>();
        for (const c of correct) {
          counts.set(c.check_id, (counts.get(c.check_id) ?? 0) + 1);
          if (!first.has(c.check_id)) first.set(c.check_id, c.scope_key);
        }
        const solvedHere = new Set(rec.submissions.filter((s) => s.correct).map((s) => s.checkId));
        const pts = new Map(answerChecks(lab.lab).map((c) => [c.id, c.answer.points ?? DEFAULT_POINTS]));
        const r = rules(e);
        return {
          ...(e.scoring === 'dynamic'
            ? {
                pointsFor: (checkId: string) => questionValue(pts.get(checkId) ?? DEFAULT_POINTS, (counts.get(checkId) ?? 0) + (solvedHere.has(checkId) ? 0 : 1), r),
                recomputeAwards: true,
              }
            : {}),
          ...(e.first_blood ? { firstBlood: (checkId: string) => first.get(checkId) === ctx.scope.key } : {}),
          event: { id: e.id, title: e.title, ...(teamId ? { teamId, teamName: teamName ?? '' } : {}), endsAt: e.ends_at.toISOString(), scoring: e.scoring },
        };
      },
    };
    return ctx;
  };
}

/** Labels of an event session (for tests and the scope resolver). */
export const eventOfSession = (ls: LabSession) => ls.metadata.labels?.[LABEL_CTF_EVENT];
