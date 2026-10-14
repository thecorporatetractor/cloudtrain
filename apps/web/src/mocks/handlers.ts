import { http, HttpResponse, delay } from 'msw';
import type { CheckResult, LabSession, StudioDraft, ValidateResponse, VerificationGate } from '@/api/types';
import { domains, labById, labSummaries, paths } from './fixtures/labs';
import { frameworks, skillStates, skills } from './fixtures/skills';
import { homeData } from './fixtures/home';
import { memberById, memberSkillStates, teamData } from './fixtures/team';
import { drafts as seedDrafts, freshGates, specFromPrompt } from './fixtures/studio';
import { examHandlers } from './examHandlers';

/* ------------------------------------------------------------------ */
/* In-memory state (resets on reload)                                  */
/* ------------------------------------------------------------------ */

const sessions = new Map<string, LabSession>();
const drafts: StudioDraft[] = structuredClone(seedDrafts);
const verifyStarted = new Map<string, number>();

const latency = () => delay(180 + Math.random() * 260);

function newSession(labId: string): LabSession {
  const lab = labById.get(labId);
  if (!lab) throw new Error('unknown lab');
  const id = `sess-${labId}-${Math.random().toString(36).slice(2, 8)}`;
  const session: LabSession = {
    id,
    labId,
    startedAt: new Date().toISOString(),
    deadlineMinutes: lab.metadata.estimatedMinutes * 2,
    nodes: lab.spec.topology.nodes.map((n, i) => ({ name: n.name, status: i === 0 ? 'ready' : 'provisioning', ip: `10.${40 + i}.0.${10 + i}` })),
    results: lab.spec.checks.map((c) => ({ checkId: c.id, status: 'pending' })),
    revealedHints: [],
    score: 0,
    validations: 0,
    status: 'running',
  };
  sessions.set(id, session);
  // nodes come up over a few seconds
  session.nodes.forEach((n, i) => {
    if (n.status === 'provisioning') setTimeout(() => (n.status = 'ready'), 1500 + i * 1400);
  });
  return session;
}

function scoreOf(session: LabSession): number {
  const lab = labById.get(session.labId)!;
  const total = lab.spec.checks.reduce((a, c) => a + (c.weight ?? 1), 0);
  const got = lab.spec.checks.reduce((a, c) => a + (session.results.find((r) => r.checkId === c.id)?.status === 'pass' ? (c.weight ?? 1) : 0), 0);
  const hintCost = session.revealedHints.reduce((a, i) => a + (lab.spec.hints?.[i]?.cost ?? 1), 0);
  return Math.max(0, Math.round((got / total) * 100) - hintCost * 4);
}

const failMessages: Record<string, string> = {
  'k8s-query': 'resource not found or did not match expectation',
  reachability: 'connection to target timed out after 5s',
  'k8s-can-i': 'kubectl auth can-i returned "yes" (expected "no")',
  shell: 'command exit status 1',
  file: 'file not found',
  http: 'TLS handshake: certificate expires in 1 day',
  'device-cmd': 'neighbour state is Init on 1 of 3 devices',
  'service-state': 'unit active but running as root',
  'k8s-context': 'only one context used so far',
};

/** Each validate passes a few more checks so the flow is demonstrable. */
function runValidation(session: LabSession): ValidateResponse {
  const lab = labById.get(session.labId)!;
  session.validations += 1;
  const passTarget = Math.min(lab.spec.checks.length, session.validations + 1);
  const touched = new Set<string>();
  session.results = lab.spec.checks.map((c, i): CheckResult => {
    const pass = i < passTarget && !(session.validations === 1 && i === 1);
    c.skills.forEach((s) => touched.add(s));
    return {
      checkId: c.id,
      status: pass ? 'pass' : 'fail',
      durationMs: 120 + Math.round(Math.random() * 900),
      message: pass ? 'as expected' : failMessages[c.type] ?? 'expectation not met',
      observed: pass ? undefined : c.type === 'k8s-query' ? 'items: []' : c.type === 'reachability' ? 'curl: (28) Connection timed out' : undefined,
    };
  });
  session.score = scoreOf(session);
  const passed = session.results.filter((r) => r.status === 'pass').length;
  if (passed === lab.spec.checks.length) session.status = 'passed';
  return { session, summary: { passed, total: lab.spec.checks.length, score: session.score, skillsTouched: Array.from(touched) } };
}

/** Progress verification gates based on elapsed time since verify started. */
function progressGates(draft: StudioDraft) {
  const started = verifyStarted.get(draft.id);
  if (!started) return;
  const elapsed = (Date.now() - started) / 1000;
  const perGate = 4; // seconds per gate in the mock
  draft.gates = draft.gates.map((g, i): VerificationGate => {
    const start = i * perGate;
    if (elapsed < start) return { ...g, status: 'pending', items: [] };
    if (elapsed < start + perGate) {
      return { ...g, status: 'running', items: [{ label: 'running on verifier pool vp-2', status: 'running' }] };
    }
    const spec = draft.spec;
    const checks = spec?.spec.checks ?? [];
    const items: VerificationGate['items'] =
      g.id === 'fails-before' || g.id === 'passes-after'
        ? checks.map((c) => ({ label: c.id, status: 'passed' as const }))
        : g.id === 'mutations'
          ? [{ label: 'wrong-scope', status: 'passed', detail: 'state-fixed failed, as required' }, { label: 'partial-fix', status: 'passed', detail: 'still-healthy failed' }]
          : g.id === 'variants'
            ? [{ label: '5 variants sampled', status: 'passed' }]
            : [{ label: 'ok', status: 'passed' }];
    return { ...g, status: 'passed', durationSec: 18 + i * 11, items };
  });
  if (draft.gates.every((g) => g.status === 'passed')) {
    draft.stage = 'review';
    draft.diff = [
      { kind: 'ctx', text: 'metadata:' },
      { kind: 'add', text: `  id: ${draft.spec?.metadata.id}` },
      { kind: 'add', text: `  title: ${draft.spec?.metadata.title}` },
      { kind: 'add', text: `  domain: ${draft.spec?.metadata.domain}` },
      { kind: 'ctx', text: 'spec:' },
      { kind: 'add', text: '  checks: 3' },
      { kind: 'add', text: '  misconceptions: 2' },
    ];
    verifyStarted.delete(draft.id);
  }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                             */
/* ------------------------------------------------------------------ */

/** Everything the gateway serves in real mode (catalog, labs, sessions, skills, home). */
const coreHandlers = [
  http.get('/api/me', async () => {
    await latency();
    return HttpResponse.json(homeData.learner);
  }),
  http.get('/api/home', async () => {
    await latency();
    return HttpResponse.json(homeData);
  }),

  http.get('/api/catalog', async () => {
    await latency();
    return HttpResponse.json({ domains, paths, labs: labSummaries });
  }),
  http.get('/api/labs/:id', async ({ params }) => {
    await latency();
    const lab = labById.get(String(params.id));
    if (!lab) return HttpResponse.json({ error: 'Lab not found' }, { status: 404 });
    return HttpResponse.json(lab);
  }),

  http.post('/api/labs/:id/sessions', async ({ params }) => {
    await delay(600);
    const lab = labById.get(String(params.id));
    if (!lab) return HttpResponse.json({ error: 'Lab not found' }, { status: 404 });
    return HttpResponse.json(newSession(lab.metadata.id), { status: 201 });
  }),
  http.get('/api/sessions/:id', async ({ params }) => {
    await delay(120);
    const s = sessions.get(String(params.id));
    if (!s) return HttpResponse.json({ error: 'Session not found' }, { status: 404 });
    return HttpResponse.json(s);
  }),
  http.delete('/api/sessions/:id', async ({ params }) => {
    await delay(150);
    sessions.delete(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/sessions/:id/validate', async ({ params }) => {
    await delay(1200 + Math.random() * 600);
    const s = sessions.get(String(params.id));
    if (!s) return HttpResponse.json({ error: 'Session not found' }, { status: 404 });
    return HttpResponse.json(runValidation(s));
  }),
  http.post('/api/sessions/:id/hints/:index', async ({ params }) => {
    await delay(200);
    const s = sessions.get(String(params.id));
    if (!s) return HttpResponse.json({ error: 'Session not found' }, { status: 404 });
    const idx = Number(params.index);
    if (!s.revealedHints.includes(idx)) s.revealedHints.push(idx);
    s.score = scoreOf(s);
    return HttpResponse.json(s);
  }),

  http.get('/api/skills', async ({ request }) => {
    await latency();
    const memberId = new URL(request.url).searchParams.get('member');
    if (memberId && memberId !== homeData.learner.id) {
      const member = memberById(memberId);
      const states = memberSkillStates(memberId);
      if (!member || !states) return HttpResponse.json({ error: 'Team member not found' }, { status: 404 });
      return HttpResponse.json({ skills, states, frameworks, member: { id: member.id, name: member.name, title: member.title } });
    }
    return HttpResponse.json({ skills, states: skillStates, frameworks });
  }),

];


/**
 * Team and Scenario Studio have no backend yet: in real API mode (VITE_API_MODE=real)
 * only these run in the browser and every other request goes to the gateway.
 */
export const sampleOnlyHandlers = [
  http.get('/api/team', async () => {
    await latency();
    return HttpResponse.json(teamData);
  }),

  http.get('/api/studio/drafts', async () => {
    await latency();
    drafts.forEach(progressGates);
    return HttpResponse.json(drafts);
  }),
  http.get('/api/studio/drafts/:id', async ({ params }) => {
    await delay(150);
    const d = drafts.find((x) => x.id === params.id);
    if (!d) return HttpResponse.json({ error: 'Draft not found' }, { status: 404 });
    progressGates(d);
    return HttpResponse.json(d);
  }),
  http.post('/api/studio/drafts', async ({ request }) => {
    await delay(1800 + Math.random() * 800); // "planner" latency
    const body = (await request.json()) as { prompt: string };
    const id = `draft-${Math.random().toString(36).slice(2, 7)}`;
    const spec = specFromPrompt(body.prompt, id.replace('draft-', 'generated-'));
    const draft: StudioDraft = {
      id,
      title: spec.metadata.title,
      prompt: body.prompt,
      createdAt: new Date().toISOString(),
      author: homeData.learner.name,
      stage: 'spec',
      spec,
      gates: freshGates(),
    };
    drafts.unshift(draft);
    return HttpResponse.json(draft, { status: 201 });
  }),
  http.post('/api/studio/drafts/:id/verify', async ({ params }) => {
    await delay(400);
    const d = drafts.find((x) => x.id === params.id);
    if (!d) return HttpResponse.json({ error: 'Draft not found' }, { status: 404 });
    d.stage = 'verify';
    d.gates = freshGates();
    verifyStarted.set(d.id, Date.now());
    return HttpResponse.json(d);
  }),
  http.post('/api/studio/drafts/:id/publish', async ({ params }) => {
    await delay(700);
    const d = drafts.find((x) => x.id === params.id);
    if (!d) return HttpResponse.json({ error: 'Draft not found' }, { status: 404 });
    d.stage = 'pilot';
    d.pilot = { cohort: 'Platform Reliability pilot', learners: 7, startedAt: new Date().toISOString() };
    return HttpResponse.json(d);
  }),
];

export const handlers = [...coreHandlers, ...examHandlers, ...sampleOnlyHandlers];
