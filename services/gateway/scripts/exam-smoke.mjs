// Live smoke test of the exam API with real auth: Keycloak login (local dev
// account, BFF session cookie) -> gateway (CSRF on writes) -> orchestrator
// (ExamSession) -> cluster.
//
//   task dev:deps && task dev:orchestrator
//   CT_EXTRA_LAB_DIRS=services/lab-orchestrator/testdata/exams/tasks \
//   CT_EXTRA_EXAM_FILES=services/lab-orchestrator/testdata/exams/exams.yaml task dev:gateway
//   node services/gateway/scripts/exam-smoke.mjs [--base http://localhost:8787] [--exam sim-test-k8s-dev]
//        [--learner amara.nwosu@quillmoor.example] [--manager tomasz.wierzbicki@quillmoor.example]
//        [--other-manager ines.achterberg@quillmoor.example] [--other-org hannah.vogel@acme-freight.example]
//        [--no-solve] [--out FILE]
//
// The gateway's ExamSessions carry app.kubernetes.io/managed-by=cloudtrain-gateway,
// which is the selector of the `task dev:orchestrator` manager (CT_EXAM_SESSION_LABELS
// only when another scoped manager should reconcile them).
//
// Logs in as the learner, checks unauthenticated and CSRF-less writes are refused,
// starts an attempt (a second start is 409), waits for the timer, runs kubectl in
// the exam terminal over the WebSocket, solves the config/secret task (unless
// --no-solve), flags a task, submits, waits for the report, then checks: terminal
// refused, history, team readiness for the learner's manager (200) and another
// team's manager (403), the attempt is invisible to another organization, and
// (with kubectl) the exam environments are released. DEV ONLY (dev passwords).
// Exit 1 on any failed check.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { login } from '../../../deploy/scripts/platform-login.mjs';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:8787').replace(/\/$/, '');
const examId = arg('exam', 'sim-test-k8s-dev');
const out = arg('out', '');
const password = process.env.CT_DEV_PASSWORD ?? 'CloudTrain-dev-only-1';
const learnerEmail = arg('learner', 'amara.nwosu@quillmoor.example');
const managerEmail = arg('manager', 'tomasz.wierzbicki@quillmoor.example');
const otherManagerEmail = arg('other-manager', 'ines.achterberg@quillmoor.example');
const otherOrgEmail = arg('other-org', 'hannah.vogel@acme-freight.example');
const solve = !process.argv.includes('--no-solve');
const kubeContext = arg('context', process.env.CT_KUBE_CONTEXT ?? 'kind-cloudtrain-dev');
const namespace = arg('namespace', process.env.CT_NAMESPACE ?? 'cloudtrain-sessions');

const t0 = Date.now();
const secs = (from) => Math.round((Date.now() - from) / 100) / 10;
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const results = [];
const timings = {};
let failed = false;
const check = (ok, what, detail) => {
  results.push({ ok: !!ok, what, ...(detail !== undefined ? { detail } : {}) });
  log(ok ? 'ok  ' : 'FAIL', what, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : '');
  if (!ok) failed = true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raw request without the session's CSRF token (or without any session). */
async function raw(method, path, cookie) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: method === 'GET' ? undefined : '{}',
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function poll(s, path, until, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const r = await s.api('GET', path);
    const phase = r.json?.phase;
    const progress = r.json?.preparingProgress !== undefined ? ` ${Math.round(r.json.preparingProgress * 100)}%` : '';
    const line = `${phase}${progress} ${r.json?.message ?? ''}`;
    if (line !== last) (log(`${label}: ${line}`), (last = line));
    if (until(r.json)) return r.json;
    if (Date.now() > end) throw new Error(`${label}: timed out in ${phase}`);
    await sleep(3000);
  }
}

/** Opens the exam terminal with the session cookie, runs `cmd`, resolves with the output (or the error frame). */
function terminal(cookie, attemptId, target, cmd, want, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, 'ws')}/api/exams/attempts/${attemptId}/terminal?target=${encodeURIComponent(target)}&cols=160&rows=40`;
    const ws = new WebSocket(url, { headers: { cookie, origin: base } });
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
    const timer = setTimeout(() => done({ ready, output: outText, timeout: true }), timeoutMs);
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
    ws.on('unexpected-response', (_req, res) => done({ ready, error: `HTTP ${res.statusCode}`, output: outText }));
    ws.on('error', (e) => done({ ready, error: e.message, output: outText }));
  });
}

/**
 * A learner's solution for the config/secret objective of sim-test-k8s-dev,
 * read from the statement only (parameters are drawn per attempt). The script
 * travels base64-encoded so the interactive shell sees one line; it ends by
 * printing SOLVED-42 (computed, so the echoed command line never matches).
 */
function solutionFor(task) {
  const st = task.statement;
  if (/cargo-auth/.test(st)) {
    const token = /value `([^`]+)`/.exec(st)?.[1];
    if (!token) return null;
    return `kubectl --context exam-core -n cargo-auth create secret generic cargo-api --from-literal=token=${token}`;
  }
  if (/berth-config/.test(st)) {
    const n = /`MAX_BERTHS` set to\s+`(\d+)`/.exec(st)?.[1];
    if (!n) return null;
    return [
      'mkdir -p /home/learner/exam',
      "cat > /home/learner/exam/berth-reader.yaml <<'YAML'",
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata: {name: berth-settings, namespace: berth-config}',
      `data: {MAX_BERTHS: "${n}"}`,
      '---',
      'apiVersion: v1',
      'kind: Pod',
      'metadata: {name: berth-reader, namespace: berth-config}',
      'spec:',
      '  containers:',
      '    - name: reader',
      '      image: busybox:1.37',
      '      command: [sleep, "3600"]',
      '      env:',
      '        - name: MAX_BERTHS',
      '          valueFrom: {configMapKeyRef: {name: berth-settings, key: MAX_BERTHS}}',
      'YAML',
      'kubectl --context exam-core apply -f /home/learner/exam/berth-reader.yaml',
      'kubectl --context exam-core -n berth-config wait pod/berth-reader --for=condition=Ready --timeout=100s',
    ].join('\n');
  }
  return null;
}

const summary = { base, examId, learner: learnerEmail };
try {
  const anon = await raw('GET', '/api/exams');
  check(anon.status === 401, 'unauthenticated exam catalog is refused (401)', anon.status);

  const s = await login(base, learnerEmail, password);
  check(s.me.permissions.includes('lab.run') && !!s.csrf, `logged in through Keycloak as ${learnerEmail} (org ${s.me.activeOrg?.name}, idp ${s.me.auth?.idp})`, s.me.roles);

  const list = await s.api('GET', '/api/exams');
  const ex = list.json?.exams?.find((e) => e.id === examId);
  check(list.status === 200 && ex?.availability === 'available', `catalog lists ${examId} as available`, ex && { availability: ex.availability, retake: ex.retake });
  check(
    list.json?.exams?.some((e) => e.availability === 'coming-soon'),
    'curriculum exams without tasks are coming-soon',
  );
  const detail = await s.api('GET', `/api/exams/${examId}`);
  check(
    detail.json?.objectives?.length > 0 && detail.json?.checklist?.length > 0,
    'detail has objectives and a pre-exam checklist',
    detail.json?.objectives?.map((o) => o.id ?? o),
  );

  const noCsrf = await raw('POST', `/api/exams/${examId}/attempts`, s.cookie);
  check(noCsrf.status === 403 && noCsrf.json?.code === 'csrf', 'start without the CSRF header is refused (403 csrf)', noCsrf.json);

  const tStart = Date.now();
  const started = await s.api('POST', `/api/exams/${examId}/attempts`);
  check(started.status === 201 && started.json?.attempt?.phase === 'preparing', 'start: 201, preparing', started.json?.attempt?.id ?? started.json);
  const id = started.json.attempt.id;
  summary.attemptId = id;
  const again = await s.api('POST', `/api/exams/${examId}/attempts`);
  check(again.status === 409, 'a second start while one runs is refused (409)', again.json);

  const running = await poll(s, `/api/exams/attempts/${id}`, (a) => a.phase === 'in-progress' || a.phase === 'failed', 20 * 60_000, id);
  timings.startToInProgress = secs(tStart);
  check(running.phase === 'in-progress' && running.deadline && running.timerStartedAt, 'timer started: in-progress with deadline', {
    timerStartedAt: running.timerStartedAt,
    deadline: running.deadline,
  });
  check(
    running.tasks.length === 3 && running.tasks.every((t) => t.statement && !t.statement.includes('{{')),
    'three tasks with resolved statements',
    running.tasks.map((t) => [t.index, t.title, t.weight, t.contexts]),
  );
  check(!/solution|hint|"expect"|"checks"/i.test(JSON.stringify(running)), 'attempt state carries no checks, hints or solutions');
  const entry = running.terminals.find((t) => t.entry);
  check(!!entry, 'an entry terminal is offered', running.terminals);
  summary.tasks = running.tasks.map((t) => ({
    index: t.index,
    title: t.title,
    weight: t.weight,
  }));

  const term = await terminal(s.cookie, id, entry.id, 'kubectl config get-contexts -o name', /exam-core[\s\S]*exam-edge|exam-edge[\s\S]*exam-core/);
  check(
    term.ready && /exam-core/.test(term.output) && /exam-edge/.test(term.output),
    'exam terminal runs kubectl as the learner and sees both contexts',
    term.output.split('\n').slice(-4).join(' | '),
  );
  const noCookie = await terminal('', id, entry.id, 'id', null, 10_000);
  check(!noCookie.ready, 'exam terminal without a session is refused', noCookie.error);

  if (solve) {
    const task = running.tasks.find((t) => solutionFor(t));
    check(
      !!task,
      'a config/secret task was drawn',
      running.tasks.map((t) => t.title),
    );
    if (task) {
      const tSolve = Date.now();
      const script = Buffer.from(solutionFor(task)).toString('base64');
      const solved = await terminal(s.cookie, id, entry.id, `echo ${script} | base64 -d | bash && echo SOLVED-$((40+2))`, /SOLVED-42/, 180_000);
      timings.solve = secs(tSolve);
      summary.solvedTask = {
        index: task.index,
        title: task.title,
        weight: task.weight,
      };
      check(/SOLVED-42/.test(solved.output), `solved task ${task.index} (${task.title}) in the exam terminal`, solved.output.split('\n').slice(-3).join(' | '));
    }
  }

  const flagged = await s.api('PUT', `/api/exams/attempts/${id}/tasks/2/flag`, {
    flagged: true,
  });
  check(flagged.json?.tasks?.find((t) => t.index === 2)?.flagged === true, 'task 2 flagged for review');

  const tSubmit = Date.now();
  const submitted = await s.api('POST', `/api/exams/attempts/${id}/submit`);
  check(submitted.status === 200, 'submit accepted', submitted.json?.phase);
  const done = await poll(s, `/api/exams/attempts/${id}`, (a) => a.phase === 'completed' || a.phase === 'failed', 20 * 60_000, id);
  timings.submitToReport = secs(tSubmit);
  check(done.phase === 'completed' && done.reportReady, 'graded: completed with a report');
  check(done.terminals.length === 0, 'no terminals once graded');
  const rep = await s.api('GET', `/api/exams/attempts/${id}/report`);
  summary.score = rep.json?.score;
  summary.passed = rep.json?.passed;
  summary.objectives = rep.json?.objectives?.map((o) => [o.id, o.score]);
  summary.taskOutcomes = rep.json?.tasks?.map((t) => [t.taskId, t.outcome, t.score]);
  check(rep.status === 200 && typeof rep.json.score === 'number' && rep.json.objectives.length === 3 && rep.json.tasks.length === 3, 'report: score, 3 objectives, 3 tasks', {
    score: rep.json?.score,
    passed: rep.json?.passed,
    objectives: summary.objectives,
    tasks: summary.taskOutcomes,
    passes: rep.json?.passes,
  });
  if (solve && summary.solvedTask) {
    check(rep.json.score > 0 && rep.json.passed === false, `partial solve scores above 0 and below the pass mark (${rep.json.score})`);
  } else {
    check(rep.json.passed === false, 'untouched submit does not pass');
  }
  check(rep.json.skills.length > 0 && !/"output"/.test(JSON.stringify(rep.json)), 'skill evidence present, no grader output');
  const closed = await terminal(s.cookie, id, entry.id, 'id', null, 15_000);
  check(!!closed.error && !closed.ready, 'terminal refused after the exam', closed.error);

  const mine = await s.api('GET', '/api/exams/attempts/mine');
  check(
    mine.json?.some((a) => a.id === id && a.phase === 'completed'),
    'attempt in history',
  );
  const after = (await s.api('GET', '/api/exams')).json.exams.find((e) => e.id === examId);
  check(after.lastAttempt?.id === id && after.retake.attemptsTotal >= 1, 'catalog shows the last attempt and counts it', after.retake);

  // Team readiness: the learner's manager sees the attempt; another team's manager is refused.
  const mgr = await login(base, managerEmail, password);
  const team = mgr.me.managedTeams.find((t) => s.me.teams.some((m) => m.id === t.id)) ?? mgr.me.managedTeams[0];
  const ready = await mgr.api('GET', `/api/exams/team-readiness?team=${encodeURIComponent(team?.id ?? '')}`);
  const row = ready.json?.exams?.find((e) => e.examId === examId)?.members?.find((m) => m.userId === s.me.user.id);
  check(ready.status === 200 && row?.attempts >= 1 && row.lastScore === rep.json.score, `manager ${managerEmail} sees the attempt in ${team?.name} readiness`, row);
  const other = await login(base, otherManagerEmail, password);
  const refused = await other.api('GET', `/api/exams/team-readiness?team=${encodeURIComponent(team?.id ?? '')}`);
  check(refused.status === 403, `manager of another team (${otherManagerEmail}) is refused (403)`, refused.status);
  const otherAttempt = await other.api('GET', `/api/exams/attempts/${id}`);
  check(otherAttempt.status === 404 || otherAttempt.status === 403, 'another learner cannot read the attempt', otherAttempt.status);

  const foreign = await login(base, otherOrgEmail, password);
  const cross = await foreign.api('GET', `/api/exams/attempts/${id}`);
  const crossReport = await foreign.api('GET', `/api/exams/attempts/${id}/report`);
  check(cross.status === 404 && crossReport.status === 404, `another organization (${foreign.me.activeOrg?.name}) cannot see the attempt (404)`, [cross.status, crossReport.status]);

  // Clean-up: the orchestrator releases the environments after grading.
  if (!process.argv.includes('--no-kubectl')) {
    const kc = (...a) => execFileSync('kubectl', ['--context', kubeContext, '-n', namespace, ...a], { encoding: 'utf8' });
    const end = Date.now() + 5 * 60_000;
    let es;
    let left;
    for (;;) {
      es = JSON.parse(kc('get', 'examsession', id, '-o', 'json'));
      left = kc('get', 'labsessions', '-l', `labs.cloudtrain.dev/exam-session=${id}`, '-o', 'name').trim();
      if ((es.status?.environmentReleased && !left) || Date.now() > end) break;
      await sleep(5000);
    }
    summary.managedBy = es.metadata.labels['app.kubernetes.io/managed-by'];
    check(summary.managedBy === 'cloudtrain-gateway', 'ExamSession carries managed-by=cloudtrain-gateway (the dev:orchestrator selector)', es.metadata.labels);
    check(es.status?.environmentReleased === true && !left, 'exam environments released after grading (no LabSessions left)', left || es.status?.conditions?.map((c) => [c.type, c.status]));
    timings.submitToReleased = secs(tSubmit);
  }
} catch (e) {
  check(false, 'smoke run', String(e?.stack ?? e));
}
summary.timings = timings;
log('summary', JSON.stringify(summary));
if (out)
  await writeFile(
    out,
    JSON.stringify(
      {
        ...summary,
        ok: !failed,
        durationSeconds: (Date.now() - t0) / 1000,
        results,
      },
      null,
      2,
    ) + '\n',
  );
log(failed ? 'FAILED' : 'PASSED');
process.exit(failed ? 1 : 0);
