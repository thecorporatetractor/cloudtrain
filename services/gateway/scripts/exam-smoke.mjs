// Live smoke test of the exam API: gateway -> orchestrator (ExamSession) -> cluster.
//
//   CT_NAMESPACE=<ns> CT_EXTRA_LAB_DIRS=services/lab-orchestrator/testdata/exams/tasks \
//   CT_EXTRA_EXAM_FILES=services/lab-orchestrator/testdata/exams/exams.yaml \
//   CT_EXAM_SESSION_LABELS=labs.cloudtrain.dev/exam-proof=true pnpm --filter @cloudtrain/gateway dev &
//   node services/gateway/scripts/exam-smoke.mjs [--base http://127.0.0.1:8787] [--exam sim-test-k8s-dev] [--out FILE]
//
// Starts an attempt, waits for the timer, checks the learner-safe state, runs a
// command in the exam terminal over the WebSocket, flags a task, submits
// untouched, waits for the report, then checks the terminal is refused and the
// retake policy state. Exit 1 on any failed check.
import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://127.0.0.1:8787');
const examId = arg('exam', 'sim-test-k8s-dev');
const out = arg('out', '');
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const results = [];
let failed = false;
const check = (ok, what, detail) => {
  results.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  log(ok ? 'ok  ' : 'FAIL', what, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : '');
  if (!ok) failed = true;
};
const api = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(path, until, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const r = await api('GET', path);
    const phase = r.json?.phase;
    if (phase !== last) log(`${label}: ${phase} ${r.json?.message ?? ''}`), (last = phase);
    if (until(r.json)) return r.json;
    if (Date.now() > end) throw new Error(`${label}: timed out in ${phase}`);
    await sleep(3000);
  }
}

/** Opens the exam terminal, runs `cmd`, resolves with the output (or the error frame). */
function terminal(attemptId, target, cmd, want) {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, 'ws')}/api/exams/attempts/${attemptId}/terminal?target=${encodeURIComponent(target)}&cols=160&rows=40`;
    const ws = new WebSocket(url);
    let outText = '';
    let ready = false;
    const done = (v) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closed */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done({ ready, output: outText, timeout: true }), 60_000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        outText += data.toString();
        if (want && want.test(outText)) done({ ready, output: outText });
        return;
      }
      const f = JSON.parse(data.toString());
      if (f.t === 'ready') {
        ready = true;
        setTimeout(() => ws.send(JSON.stringify({ t: 'i', d: `${cmd}\r` })), 800);
      } else if (f.t === 'error') done({ ready, error: f.m, output: outText });
      else if (f.t === 'exit') done({ ready, exit: f.code, output: outText });
    });
    ws.on('error', (e) => done({ ready, error: e.message, output: outText }));
  });
}

try {
  const list = await api('GET', '/api/exams');
  const ex = list.json.exams?.find((e) => e.id === examId);
  check(list.status === 200 && ex?.availability === 'available', `catalog lists ${examId} as available`, ex && { availability: ex.availability, retake: ex.retake });
  check(list.json.exams.some((e) => e.availability === 'coming-soon'), 'curriculum exams without tasks are coming-soon');
  const detail = await api('GET', `/api/exams/${examId}`);
  check(detail.json.objectives?.length > 0 && detail.json.checklist?.length > 0, 'detail has objectives and a pre-exam checklist', detail.json.objectives);

  const started = await api('POST', `/api/exams/${examId}/attempts`);
  check(started.status === 201 && started.json.attempt?.phase === 'preparing', 'start: 201, preparing', started.json.attempt?.id ?? started.json);
  const id = started.json.attempt.id;
  const again = await api('POST', `/api/exams/${examId}/attempts`);
  check(again.status === 409, 'a second start while one runs is refused (409)', again.json);

  const running = await poll(`/api/exams/attempts/${id}`, (a) => a.phase === 'in-progress' || a.phase === 'failed', 20 * 60_000, id);
  check(running.phase === 'in-progress' && running.deadline && running.timerStartedAt, 'timer started: in-progress with deadline', { timerStartedAt: running.timerStartedAt, deadline: running.deadline });
  check(running.tasks.length === 3 && running.tasks.every((t) => t.statement && !t.statement.includes('{{')), 'three tasks with resolved statements', running.tasks.map((t) => [t.index, t.title, t.weight, t.contexts]));
  check(!/solution|hint|"expect"|"checks"/i.test(JSON.stringify(running)), 'attempt state carries no checks, hints or solutions');
  const entry = running.terminals.find((t) => t.entry);
  check(!!entry, 'an entry terminal is offered', running.terminals);

  const term = await terminal(id, entry.id, 'kubectl config get-contexts -o name', /exam-core[\s\S]*exam-edge|exam-edge[\s\S]*exam-core/);
  check(term.ready && /exam-core/.test(term.output) && /exam-edge/.test(term.output), 'exam terminal runs kubectl as the learner and sees both contexts', term.output.split('\n').slice(-4).join(' | '));

  const flagged = await api('PUT', `/api/exams/attempts/${id}/tasks/2/flag`, { flagged: true });
  check(flagged.json.tasks?.find((t) => t.index === 2)?.flagged === true, 'task 2 flagged for review');

  const submitted = await api('POST', `/api/exams/attempts/${id}/submit`);
  check(submitted.status === 200, 'submit accepted', submitted.json.phase);
  const done = await poll(`/api/exams/attempts/${id}`, (a) => a.phase === 'completed' || a.phase === 'failed', 20 * 60_000, id);
  check(done.phase === 'completed' && done.reportReady, 'graded: completed with a report');
  check(done.terminals.length === 0, 'no terminals once graded');
  const rep = await api('GET', `/api/exams/attempts/${id}/report`);
  check(rep.status === 200 && typeof rep.json.score === 'number' && rep.json.objectives.length === 3 && rep.json.tasks.length === 3, 'report: score, 3 objectives, 3 tasks', {
    score: rep.json.score,
    passed: rep.json.passed,
    objectives: rep.json.objectives?.map((o) => [o.id, o.score]),
    tasks: rep.json.tasks?.map((t) => [t.taskId, t.outcome, t.score]),
    passes: rep.json.passes,
  });
  check(rep.json.passed === false, 'untouched submit does not pass');
  check(rep.json.skills.length > 0 && !/"output"/.test(JSON.stringify(rep.json)), 'skill evidence present, no grader output');
  const closed = await terminal(id, entry.id, 'id', null);
  check(!!closed.error && !closed.ready, 'terminal refused after the exam', closed.error);

  const mine = await api('GET', '/api/exams/attempts/mine');
  check(mine.json.some((a) => a.id === id && a.phase === 'completed'), 'attempt in history');
  const after = (await api('GET', '/api/exams')).json.exams.find((e) => e.id === examId);
  check(after.lastAttempt?.id === id && after.retake.attemptsTotal >= 1, 'catalog shows the last attempt and counts it', after.retake);
} catch (e) {
  check(false, 'smoke run', String(e));
}
if (out) await writeFile(out, JSON.stringify({ base, examId, ok: !failed, durationSeconds: (Date.now() - t0) / 1000, results }, null, 2) + '\n');
log(failed ? 'FAILED' : 'PASSED');
process.exit(failed ? 1 : 0);
