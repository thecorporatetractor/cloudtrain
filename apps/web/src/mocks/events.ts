import { http, HttpResponse, delay } from 'msw';
import type { CreateCtfEventRequest, CtfEventDetail, CtfEventReport, CtfEventSummary, CtfScoreboard, CtfScoreRow, CtfSolve, CtfTeam, JoinCtfEventRequest, UserRef } from '@/api/types';
import { stateOf } from './ctf';
import { labById } from './fixtures/labs';
import { userRef } from './fixtures/platform';
import { currentSession } from './platformHandlers';
import { newSession, randomSuffix, sessionEvents } from './sessionStore';

/*
 * Mock CTF events (mock mode only): a live team event with a seeded
 * scoreboard, an upcoming solo event and a finished one. Scoring mirrors
 * services/gateway/src/events/scoring.ts (static or dynamic values, penalties,
 * first bloods, ties by the last solve, freeze for learners).
 */

const MIN = 60_000;
const LAB = 'quill-ctf-gateway-breach';
const Q = [
  { id: 'q-attacker-ip', points: 100, penalty: 10 },
  { id: 'q-failed-count', points: 100, penalty: 20 },
  { id: 'q-victim', points: 150, penalty: 25 },
  { id: 'q-tool', points: 100, penalty: 15 },
  { id: 'q-exfil', points: 150, penalty: 25 },
];

interface MockEvent extends CreateCtfEventRequest {
  id: string;
  createdBy: string;
  teams: { id: string; name: string; members: string[] }[];
  /** Solo events: participant ids. Team events: everyone in a team or waiting for one. */
  participants: Map<string, { teamId?: string; joinedAt: number }>;
  /** Seeded solves: [entrant, question index, minutes after start, wrong answers before, solver]. */
  solves: [string, number, number, number, string][];
}

const now = () => Date.now();
const iso = (t: number) => new Date(t).toISOString();

function seed(): MockEvent[] {
  const t = now();
  const live: MockEvent = {
    id: 'ev-depot-night',
    title: 'Depot gateway night',
    description: 'Two hours, one break-in. Work as a team of up to three: a question one of you solves is solved for the whole team. Points drop as more teams solve a question, and the scoreboard freezes for the last 15 minutes.',
    labIds: [LAB],
    startsAt: iso(t - 50 * MIN),
    endsAt: iso(t + 70 * MIN),
    mode: 'team',
    teamSizeMax: 3,
    teamFormation: 'self',
    scoring: 'dynamic',
    dynamicMinPct: 40,
    dynamicDecay: 4,
    firstBlood: true,
    freezeMinutes: 15,
    published: true,
    createdBy: 'u-ingrid',
    teams: [
      { id: 'tm-owls', name: 'Night Owls', members: ['u-lena', 'u-tomas'] },
      { id: 'tm-signal', name: 'Signal Box', members: ['u-kofi', 'u-mira'] },
      { id: 'tm-yard', name: 'Yard Cats', members: ['u-bram', 'u-aino', 'u-greta'] },
      { id: 'tm-depot', name: 'Depot Rats', members: ['u-dana', 'u-ravi'] },
    ],
    participants: new Map(),
    solves: [
      ['tm-signal', 0, 6, 0, 'u-kofi'],
      ['tm-owls', 0, 9, 1, 'u-tomas'],
      ['tm-yard', 0, 12, 0, 'u-aino'],
      ['tm-signal', 1, 15, 0, 'u-mira'],
      ['tm-owls', 1, 21, 0, 'u-lena'],
      ['tm-owls', 2, 30, 1, 'u-tomas'],
      ['tm-depot', 0, 31, 2, 'u-dana'],
      ['tm-signal', 2, 33, 0, 'u-kofi'],
      ['tm-yard', 1, 38, 1, 'u-greta'],
      ['tm-owls', 3, 41, 0, 'u-lena'],
      ['tm-signal', 3, 46, 2, 'u-mira'],
    ],
  };
  for (const tm of live.teams) for (const m of tm.members) live.participants.set(m, { teamId: tm.id, joinedAt: t - 70 * MIN });
  const solo: MockEvent = {
    id: 'ev-friday-solo',
    title: 'Friday solo sprint',
    description: 'Thirty minutes, everyone for themselves, static points.',
    labIds: [LAB],
    startsAt: iso(t + 2 * 24 * 60 * MIN),
    endsAt: iso(t + 2 * 24 * 60 * MIN + 30 * MIN),
    mode: 'solo',
    scoring: 'static',
    firstBlood: false,
    freezeMinutes: 0,
    published: true,
    createdBy: 'u-ingrid',
    teams: [],
    participants: new Map([['u-tomas', { joinedAt: t - 60 * MIN }]]),
    solves: [],
  };
  const past: MockEvent = { ...solo, id: 'ev-q3-cup', title: 'Q3 investigation cup', description: 'The first CloudTrain CTF.', startsAt: iso(t - 20 * 24 * 60 * MIN), endsAt: iso(t - 20 * 24 * 60 * MIN + 90 * MIN), participants: new Map([['u-lena', { joinedAt: t - 21 * 24 * 60 * MIN }]]), solves: [['u-lena', 0, 12, 0, 'u-lena'], ['u-lena', 1, 25, 1, 'u-lena']] };
  return [live, solo, past];
}

let EVENTS = seed();
const mine = () => currentSession()?.userId ?? '';
const canManage = () => ['u-ingrid', 'u-samir', 'u-priya', 'u-elin'].includes(mine());

function status(e: MockEvent): CtfEventSummary['status'] {
  if (!e.published) return 'draft';
  const t = now();
  if (t < Date.parse(e.startsAt)) return 'upcoming';
  if (t < Date.parse(e.endsAt)) return 'running';
  return 'ended';
}

function summary(e: MockEvent): CtfEventSummary {
  const { teams, participants, solves: _s, createdBy, ...settings } = e;
  return { ...settings, status: status(e), createdBy: userRef(createdBy), participants: participants.size, teams: teams.length, joined: participants.has(mine()) };
}

const teamOf = (t: MockEvent['teams'][number]): CtfTeam => ({ id: t.id, name: t.name, members: t.members.map(userRef) });

function detail(e: MockEvent): CtfEventDetail {
  const me = e.participants.get(mine());
  const lab = labById.get(LAB)!;
  const myTeam = me?.teamId ? e.teams.find((t) => t.id === me.teamId) : undefined;
  const mySessions: Record<string, string> = {};
  for (const [sid, ev] of sessionEvents) if (ev.id === e.id) mySessions[LAB] = sid;
  return {
    ...summary(e),
    labs: [{ labId: LAB, title: lab.metadata.title, difficulty: lab.metadata.difficulty, estimatedMinutes: lab.metadata.estimatedMinutes, questionCount: Q.length, points: Q.reduce((n, q) => n + q.points, 0) }],
    teamList: e.mode === 'team' ? e.teams.map((t) => teamOf(t)) : [],
    ...(myTeam ? { myTeam: teamOf(myTeam) } : {}),
    mySessions,
    serverNow: iso(now()),
    canManage: canManage(),
  };
}

const value = (e: MockEvent, points: number, solves: number) => {
  if (e.scoring === 'static' || solves <= 1) return points;
  const min = Math.ceil((points * (e.dynamicMinPct ?? 30)) / 100);
  const d = e.dynamicDecay ?? 10;
  return Math.max(min, Math.ceil(points + ((min - points) / (d * d)) * (solves - 1) ** 2));
};

function scoreboard(e: MockEvent, live: boolean): CtfScoreboard {
  const start = Date.parse(e.startsAt);
  const freezeAt = e.freezeMinutes ? Date.parse(e.endsAt) - e.freezeMinutes * MIN : undefined;
  const frozen = !live && !!freezeAt && now() >= freezeAt && now() < Date.parse(e.endsAt);
  const solves = e.solves.filter(([, , m]) => !frozen || start + m * MIN <= freezeAt!);
  const counts = Q.map((_, i) => solves.filter((s) => s[1] === i).length);
  const firsts = Q.map((_, i) => solves.filter((s) => s[1] === i).sort((a, b) => a[2] - b[2])[0]?.[0]);
  const entrants: { id: string; name: string; members: UserRef[] }[] =
    e.mode === 'team' ? e.teams.map((t) => ({ id: t.id, name: t.name, members: t.members.map(userRef) })) : [...e.participants.keys()].map((u) => ({ id: u, name: userRef(u).name, members: [userRef(u)] }));
  const award = (s: MockEvent['solves'][number]) => Math.max(0, value(e, Q[s[1]]!.points, counts[s[1]]!) - Q[s[1]]!.penalty * s[3]);
  const rows: CtfScoreRow[] = entrants
    .map((en) => {
      const mineS = solves.filter((s) => s[0] === en.id);
      const last = Math.max(-1, ...mineS.map((s) => s[2]));
      return { rank: 0, id: en.id, name: en.name, members: en.members, points: mineS.reduce((n, s) => n + award(s), 0), solves: mineS.length, firstBloods: e.firstBlood ? mineS.filter((s) => firsts[s[1]] === en.id).length : 0, ...(last >= 0 ? { lastSolveAt: iso(start + last * MIN) } : {}) };
    })
    .sort((a, b) => b.points - a.points || (a.lastSolveAt ?? 'z').localeCompare(b.lastSolveAt ?? 'z'));
  rows.forEach((r, i) => (r.rank = i + 1));
  const name = new Map(entrants.map((x) => [x.id, x.name]));
  const feed: CtfSolve[] = solves
    .map((s) => ({ at: iso(start + s[2] * MIN), entrantId: s[0], entrantName: name.get(s[0]) ?? s[0], labId: LAB, checkId: Q[s[1]]!.id, questionNumber: s[1] + 1, points: award(s), firstBlood: e.firstBlood && firsts[s[1]] === s[0], solvedBy: userRef(s[4]) }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const my = e.participants.get(mine());
  return {
    eventId: e.id,
    title: e.title,
    mode: e.mode,
    scoring: e.scoring,
    status: status(e),
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    serverNow: iso(now()),
    frozen,
    ...(frozen ? { frozenAt: iso(freezeAt!) } : {}),
    rows,
    timeline: rows
      .filter((r) => r.solves)
      .slice(0, 6)
      .map((r) => {
        let total = 0;
        return { entrantId: r.id, name: r.name, points: [{ at: e.startsAt, total: 0 }, ...solves.filter((s) => s[0] === r.id).sort((a, b) => a[2] - b[2]).map((s) => ({ at: iso(start + s[2] * MIN), total: (total += award(s)) }))] };
      }),
    solves: feed,
    questions: Q.map((q, i) => ({ labId: LAB, checkId: q.id, questionNumber: i + 1, prompt: '', points: q.points, value: value(e, q.points, counts[i]!), solves: counts[i]!, ...(e.firstBlood && firsts[i] ? { firstBlood: { entrantName: name.get(firsts[i]!) ?? '', at: feed.filter((f) => f.questionNumber === i + 1).at(-1)!.at } } : {}) })),
    ...(my ? { mine: e.mode === 'team' ? my.teamId : mine() } : {}),
  };
}

const find = (id: string) => EVENTS.find((e) => e.id === id && (e.published || canManage()));
const notFound = () => HttpResponse.json({ error: 'Event not found', code: 'not_found' }, { status: 404 });
const forbidden = () => HttpResponse.json({ error: 'You do not have permission to do this (event.manage).', code: 'forbidden', permission: 'event.manage' }, { status: 403 });
const conflict = (error: string) => HttpResponse.json({ error, code: 'conflict' }, { status: 409 });

export const eventHandlers = [
  http.get('/api/events', async () => {
    await delay(150);
    return HttpResponse.json(EVENTS.filter((e) => e.published || canManage()).map(summary));
  }),
  http.post('/api/events', async ({ request }) => {
    await delay(250);
    if (!canManage()) return forbidden();
    const body = (await request.json()) as CreateCtfEventRequest;
    if (!body.title?.trim() || !body.labIds?.length) return HttpResponse.json({ error: 'The event is not valid.', code: 'invalid', details: { ...(!body.title?.trim() ? { title: 'A title is required.' } : {}), ...(!body.labIds?.length ? { labIds: 'Pick at least one CTF lab.' } : {}) } }, { status: 422 });
    const e: MockEvent = { ...body, id: `ev-${randomSuffix(6)}`, createdBy: mine(), teams: [], participants: new Map(), solves: [] };
    EVENTS = [e, ...EVENTS];
    return HttpResponse.json(detail(e), { status: 201 });
  }),
  http.get('/api/events/:id', async ({ params }) => {
    await delay(120);
    const e = find(String(params.id));
    return e ? HttpResponse.json(detail(e)) : notFound();
  }),
  http.patch('/api/events/:id', async ({ params, request }) => {
    await delay(200);
    if (!canManage()) return forbidden();
    const e = find(String(params.id));
    if (!e) return notFound();
    Object.assign(e, (await request.json()) as Partial<CreateCtfEventRequest>);
    return HttpResponse.json(detail(e));
  }),
  http.delete('/api/events/:id', async ({ params }) => {
    if (!canManage()) return forbidden();
    EVENTS = EVENTS.filter((e) => e.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/events/:id/join', async ({ params, request }) => {
    await delay(200);
    const e = find(String(params.id));
    if (!e) return notFound();
    const body = ((await request.json().catch(() => ({}))) ?? {}) as JoinCtfEventRequest;
    let teamId: string | undefined;
    if (e.mode === 'team' && body.teamName) {
      if (e.teams.some((t) => t.name.toLowerCase() === body.teamName!.trim().toLowerCase())) return conflict(`A team called ${body.teamName} already exists.`);
      teamId = `tm-${randomSuffix(5)}`;
      e.teams.push({ id: teamId, name: body.teamName.trim(), members: [] });
    } else if (e.mode === 'team' && body.teamId) teamId = body.teamId;
    const team = e.teams.find((t) => t.id === teamId);
    if (team) {
      if (team.members.length >= (e.teamSizeMax ?? 1)) return conflict('This team is full.');
      team.members.push(mine());
    }
    e.participants.set(mine(), { ...(teamId ? { teamId } : {}), joinedAt: now() });
    return HttpResponse.json(detail(e));
  }),
  http.post('/api/events/:id/leave', async ({ params }) => {
    const e = find(String(params.id));
    if (!e) return notFound();
    e.participants.delete(mine());
    for (const t of e.teams) t.members = t.members.filter((m) => m !== mine());
    return HttpResponse.json(detail(e));
  }),
  http.post('/api/events/:id/teams', async ({ params, request }) => {
    if (!canManage()) return forbidden();
    const e = find(String(params.id));
    if (!e) return notFound();
    const { name } = (await request.json()) as { name: string };
    e.teams.push({ id: `tm-${randomSuffix(5)}`, name, members: [] });
    return HttpResponse.json(detail(e));
  }),
  http.put('/api/events/:id/teams/:teamId/members', async ({ params, request }) => {
    if (!canManage()) return forbidden();
    const e = find(String(params.id));
    const team = e?.teams.find((t) => t.id === params.teamId);
    if (!e || !team) return notFound();
    const { userIds } = (await request.json()) as { userIds: string[] };
    team.members = userIds;
    for (const u of userIds) e.participants.set(u, { teamId: team.id, joinedAt: e.participants.get(u)?.joinedAt ?? now() });
    return HttpResponse.json(detail(e));
  }),
  http.post('/api/events/:id/labs/:labId/sessions', async ({ params }) => {
    await delay(300);
    const e = find(String(params.id));
    if (!e) return notFound();
    if (status(e) !== 'running') return conflict('This event is not running.');
    const me = e.participants.get(mine());
    if (!me) return HttpResponse.json({ error: 'Join the event first.', code: 'forbidden' }, { status: 403 });
    const s = newSession(String(params.labId));
    const team = e.teams.find((t) => t.id === me.teamId);
    sessionEvents.set(s.id, { id: e.id, title: e.title, ...(team ? { teamId: team.id, teamName: team.name } : {}), endsAt: e.endsAt, scoring: e.scoring });
    // Teammates already solved the first questions in the seeded live event.
    if (team) {
      const board = scoreboard(e, true);
      for (const [entrant, qi, m, , by] of e.solves) {
        if (entrant !== team.id) continue;
        const first = e.solves.filter((x) => x[1] === qi).sort((a, b) => a[2] - b[2])[0]?.[0] === team.id;
        stateOf(s.id).subs.push({ firstBlood: e.firstBlood && first, checkId: Q[qi]!.id, correct: true, points: board.solves.find((x) => x.entrantId === team.id && x.questionNumber === qi + 1)?.points ?? Q[qi]!.points, answer: ['203.0.113.77', '48', 'cato', 'python-requests/2.25.0', 'refunds-q3.csv'][qi]!, at: iso(Date.parse(e.startsAt) + m * MIN), by: userRef(by) });
      }
    }
    return HttpResponse.json(s, { status: 201 });
  }),
  http.get('/api/events/:id/scoreboard', async ({ params }) => {
    await delay(150);
    const e = find(String(params.id));
    return e ? HttpResponse.json(scoreboard(e, canManage())) : notFound();
  }),
  http.get('/api/events/:id/report', async ({ params }) => {
    await delay(200);
    if (!canManage()) return forbidden();
    const e = find(String(params.id));
    if (!e) return notFound();
    const teamName = new Map(e.teams.map((t) => [t.id, t.name]));
    const report: CtfEventReport = {
      event: detail(e),
      scoreboard: scoreboard(e, true),
      participants: [...e.participants].map(([u, p], i) => {
        const solved = e.solves.filter((s) => s[4] === u);
        return { user: userRef(u), ...(p.teamId ? { teamId: p.teamId, teamName: teamName.get(p.teamId) ?? '' } : {}), joinedAt: iso(p.joinedAt), submissions: solved.length + solved.reduce((n, s) => n + s[3], 0) + (i % 3), correct: solved.length, hints: i % 2, ...(solved.length ? { lastActivityAt: iso(Date.parse(e.startsAt) + Math.max(...solved.map((s) => s[2])) * MIN) } : {}) };
      }),
    };
    return HttpResponse.json(report);
  }),
  http.get('/api/events/:id/results.csv', async ({ params }) => {
    if (!canManage()) return forbidden();
    const e = find(String(params.id));
    if (!e) return notFound();
    const b = scoreboard(e, true);
    const csv = ['rank,team,points,solves,first_bloods,last_solve_at', ...b.rows.map((r) => [r.rank, r.name, r.points, r.solves, r.firstBloods, r.lastSolveAt ?? ''].join(','))].join('\r\n');
    return new HttpResponse(csv, { headers: { 'content-type': 'text/csv' } });
  }),
];
