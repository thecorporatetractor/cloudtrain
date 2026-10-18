import { http, HttpResponse, delay } from 'msw';
import type { LabQuestion, Question, QuestionsView, SubmitAnswerResponse, UserRef } from '@/api/types';
import { labById } from './fixtures/labs';
import { sessionEvents } from './sessionStore';
import { userRef } from './fixtures/platform';

/*
 * Mock questions engine (MSW). Mirrors services/gateway/src/answers in
 * miniature: sequential unlocks, attempts, penalties, hint costs. Mock mode
 * only: the expected answers below are demo data in the dev bundle; the real
 * gateway grades server side and never sends expected answers.
 */

interface MockQuestion {
  prompt: string;
  accept: (a: string) => boolean;
  hints: string[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const MOCK: Record<string, Record<string, MockQuestion>> = {
  'quill-ctf-gateway-breach': {
    'q-attacker-ip': {
      prompt: 'Which IP address made the most failed login attempts?',
      accept: (a) => norm(a) === '203.0.113.77',
      hints: ['Keep only the failed logins (`result=fail`), then count the `ip=` values: `sort | uniq -c | sort -rn` ranks them.', "`grep -o 'ip=[^ ]*'` prints just the ip=... field of every matching line."],
    },
    'q-failed-count': {
      prompt: 'How many failed login attempts came from that address?',
      accept: (a) => /^\s*48(\.0*)?\s*$/.test(a),
      hints: ['`grep -c` counts matching lines. Match the address with a trailing space so 203.0.113.5 does not also match 203.0.113.50.'],
    },
    'q-victim': { prompt: 'Which staff account did the attacker get into?', accept: (a) => norm(a) === 'cato', hints: ["Follow only the attacker's lines and look for the one login that did not fail."] },
    'q-tool': {
      prompt: 'Which tool did the attacker use, according to the user agent? Give it as name/version.',
      accept: (a) => /^python-requests\/2\.25(\.0)?$/i.test(norm(a)),
      hints: ['The user agent is the quoted ua="..." field.'],
    },
    'q-exfil': { prompt: 'Which file did the attacker export? Give its name or full path.', accept: (a) => ['refunds-q3.csv', '/srv/exports/refunds-q3.csv'].includes(norm(a)), hints: ['Exports are `event=export` lines; the attacker exported right after the successful login.'] },
  },
};

interface Sub {
  /** Who answered (a teammate in event sessions). */
  by?: UserRef;
  firstBlood?: boolean;
  checkId: string;
  correct: boolean;
  points: number;
  answer: string;
  at: string;
}
const state = new Map<string, { subs: Sub[]; reveals: Map<string, number[]> }>();
export const stateOf = (sessionId: string) => {
  let s = state.get(sessionId);
  if (!s) state.set(sessionId, (s = { subs: [], reveals: new Map() }));
  return s;
};

export const labOfSession = (sessionId: string) => /^sess-(.+)-[a-z0-9]+$/.exec(sessionId)?.[1];

function view(sessionId: string, labId: string, me?: UserRef): QuestionsView {
  const lab = labById.get(labId)!;
  const defs = lab.spec.questions ?? [];
  const st = stateOf(sessionId);
  const sequential = lab.spec.questionOrder === 'sequential';
  let prevDone = true;
  const questions = defs.map((d: LabQuestion): Question => {
    const m = MOCK[labId]![d.id]!;
    const subs = st.subs.filter((s) => s.checkId === d.id);
    const solved = subs.find((s) => s.correct);
    const wrong = subs.filter((s) => !s.correct).length;
    const revealed = st.reveals.get(d.id) ?? [];
    const hintCost = revealed.reduce((n, i) => n + (d.hintCosts[i] ?? 0), 0);
    const closed = !solved && !!d.maxAttempts && wrong >= d.maxAttempts;
    const locked = sequential && !prevDone;
    prevDone = !!solved || closed;
    const qstate: Question['state'] = solved ? 'solved' : closed ? 'closed' : locked ? 'locked' : 'open';
    const available = Math.max(0, d.points - d.penalty * wrong - hintCost);
    return {
      ...d,
      prompt: locked ? '' : m.prompt,
      state: qstate,
      wrongAttempts: wrong,
      ...(d.maxAttempts ? { attemptsLeft: Math.max(0, d.maxAttempts - wrong) } : {}),
      hints: d.hintCosts.map((cost, index) => ({ index, cost, revealed: revealed.includes(index) && !locked, ...(revealed.includes(index) && !locked ? { body: m.hints[index] ?? '' } : {}) })),
      hintCost,
      available: qstate === 'open' || qstate === 'locked' ? available : 0,
      ...(solved ? { awarded: solved.points, solvedAt: solved.at, answer: solved.answer, ...((solved.by ?? me) ? { solvedBy: solved.by ?? me } : {}), ...(solved.firstBlood ? { firstBlood: true } : {}) } : {}),
    };
  });
  const possible = questions.reduce((n, q) => n + q.points, 0);
  const event = sessionEvents.get(sessionId);
  return { sessionId, labId, ...(event ? { event } : {}), order: sequential ? 'sequential' : 'free', questions, earned: questions.reduce((n, q) => n + (q.awarded ?? 0), 0), possible, solved: questions.filter((q) => q.state === 'solved').length, total: questions.length };
}

/** The signed-in mock user (team events show who solved what). */
function me(): UserRef | undefined {
  try {
    const raw = localStorage.getItem('ct.mock.session');
    const id = raw && raw !== 'none' ? (JSON.parse(raw) as { userId?: string }).userId : undefined;
    return id ? userRef(id) : undefined;
  } catch {
    return undefined;
  }
}

const err = (status: number, error: string, code: string) => HttpResponse.json({ error, code }, { status });

export const ctfHandlers = [
  http.get('/api/sessions/:id/questions', async ({ params }) => {
    await delay(120);
    const labId = labOfSession(String(params.id));
    if (!labId || !MOCK[labId]) return err(404, 'Questions not found', 'not_found');
    const ev = sessionEvents.get(String(params.id));
    return HttpResponse.json(view(String(params.id), labId, ev?.teamId ? me() : undefined));
  }),

  http.post('/api/sessions/:id/questions/:checkId/answer', async ({ params, request }) => {
    await delay(260);
    const id = String(params.id);
    const labId = labOfSession(id);
    const checkId = String(params.checkId);
    if (!labId || !MOCK[labId]?.[checkId]) return err(404, 'Question not found', 'not_found');
    const body = (await request.json()) as { answer?: string };
    const answer = String(body.answer ?? '').trim();
    if (!answer) return err(422, 'Type an answer first.', 'invalid');
    const before = view(id, labId).questions.find((q) => q.id === checkId)!;
    if (before.state === 'locked') return err(409, 'Answer the question before this one first.', 'conflict');
    if (before.state === 'solved') return err(409, 'This question is already solved.', 'conflict');
    if (before.state === 'closed') return err(409, 'No attempts left for this question.', 'conflict');
    const correct = MOCK[labId]![checkId]!.accept(answer);
    stateOf(id).subs.push({ checkId, correct, points: correct ? before.available : 0, answer, at: new Date().toISOString(), ...(sessionEvents.get(id)?.teamId ? { by: me() } : {}) });
    const v = view(id, labId);
    const q = v.questions.find((x) => x.id === checkId)!;
    const message = correct
      ? `Correct: +${q.awarded} points.`
      : q.state === 'closed'
        ? 'Not correct. No attempts left: the question is closed.'
        : `Not correct.${q.attemptsLeft !== undefined ? ` ${q.attemptsLeft} attempt${q.attemptsLeft === 1 ? '' : 's'} left.` : ''}${q.penalty ? ` Each wrong answer costs ${q.penalty} points.` : ''}`;
    return HttpResponse.json({ correct, message, view: v } satisfies SubmitAnswerResponse);
  }),

  http.post('/api/sessions/:id/questions/:checkId/hints/:index', async ({ params }) => {
    await delay(180);
    const id = String(params.id);
    const labId = labOfSession(id);
    const checkId = String(params.checkId);
    const index = Number(params.index);
    if (!labId || !MOCK[labId]?.[checkId]) return err(404, 'Question not found', 'not_found');
    const q = view(id, labId).questions.find((x) => x.id === checkId)!;
    if (!q.hints[index]) return err(404, 'Hint not found', 'not_found');
    if (q.hints[index]!.revealed) return HttpResponse.json(view(id, labId));
    if (q.state !== 'open') return err(409, 'Hints are only available while the question is open.', 'conflict');
    if (q.hints.findIndex((h) => !h.revealed) !== index) return err(409, 'Reveal hints in order.', 'conflict');
    const st = stateOf(id);
    st.reveals.set(checkId, [...(st.reveals.get(checkId) ?? []), index]);
    return HttpResponse.json(view(id, labId));
  }),
];
