import type { ExamAttemptPhase, ExamCheckScore, ExamReport, ExamTaskView, ExamTerminalTarget } from '@/api/types';
import { fixtureExams, fixtureTasks, type FixtureExam } from './exams.generated';

/*
 * Mock exam world built over the real curriculum (exams.generated.ts is
 * generated from content/curriculum.yaml). Draws, statements, outcomes and
 * reports are deterministic per attempt id so screenshots are stable.
 */

export { fixtureExams };

/** Exams the mock treats as built; the others show as "coming soon". */
export const MOCK_AVAILABLE = new Set(['sim-k8s-developer', 'sim-k8s-admin', 'sim-k8s-security', 'sim-linux-sysadmin', 'sim-el-sysadmin']);

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 0xffffffff;
}

/** Seeded shuffle (Fisher-Yates over a hash stream). */
function shuffle<T>(xs: T[], key: string): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(hash(`${key}:${i}`) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface MockTask extends ExamTaskView {
  taskId: string;
}

const K8S_CONTEXTS: Record<string, string[]> = {
  'sim-k8s-admin': ['qm-yard', 'qm-archive', 'qm-dispatch'],
  'sim-k8s-developer': ['qm-apps', 'qm-edge'],
  'sim-k8s-security': ['qm-vault', 'qm-gate'],
};

function contextFor(exam: FixtureExam, taskId: string, oneLine: string): string[] {
  const named = oneLine.match(/\bqm-[a-z]+(?:-[a-z]+)?\b/)?.[0];
  if (named) return [named];
  const pool = K8S_CONTEXTS[exam.id];
  if (pool) return [pool[Math.floor(hash(taskId) * pool.length)]!];
  return [];
}

function hostFor(exam: FixtureExam, taskId: string): string {
  if (exam.domain === 'linux' || exam.domain === 'automation' || exam.domain === 'containers') return hash(taskId) > 0.7 ? 'el-node' : exam.id.startsWith('sim-el') ? 'node1' : 'ubuntu-main';
  if (exam.domain === 'networking') return 'district-core';
  return 'workstation';
}

const PARAMS = ['3', '4', '5', '1Gi', '2Gi', '8080', '30081', 'ql-ops', 'harbour', 'berth-07', 'tide-feed'];

/** Markdown statement with drawn params (only what a candidate sees). */
function statement(exam: FixtureExam, taskId: string, ctx: string[]): string {
  const t = fixtureTasks[taskId]!;
  const p = PARAMS[Math.floor(hash(`p:${taskId}`) * PARAMS.length)]!;
  const head = ctx.length
    ? `Use context \`${ctx[0]}\`:\n\n\`\`\`bash\nkubectl config use-context ${ctx[0]}\n\`\`\``
    : `Work on host \`${hostFor(exam, taskId)}\` (\`ssh ${hostFor(exam, taskId)}\` from your terminal).`;
  return `${head}\n\n${t.oneLine}\n\nWhere the task leaves a value open, use \`${p}\`. Leave everything the task does not mention as it is.`;
}

export function drawTasks(exam: FixtureExam, attemptId: string, avoid: Set<string>): MockTask[] {
  const sum = exam.blueprint.filter((o) => o.tasks > 0).reduce((a, o) => a + o.weight, 0);
  const out: MockTask[] = [];
  for (const o of exam.blueprint) {
    if (o.tasks <= 0) continue;
    const fresh = shuffle(o.pool.filter((id) => !avoid.has(id)), `${attemptId}:${o.objective}`);
    const reused = shuffle(o.pool.filter((id) => avoid.has(id)), `${attemptId}:${o.objective}:r`);
    for (const id of [...fresh, ...reused].slice(0, o.tasks)) {
      const t = fixtureTasks[id]!;
      const ctx = contextFor(exam, id, t.oneLine);
      out.push({
        index: out.length + 1,
        taskId: id,
        title: t.title,
        objective: o.objective,
        objectiveName: o.name,
        weight: Math.round(((100 * o.weight) / sum / o.tasks) * 100) / 100,
        statement: statement(exam, id, ctx),
        contexts: ctx,
        nodes: ctx.length ? ['workstation', ...ctx] : [hostFor(exam, id)],
        flagged: false,
        visited: false,
      });
    }
  }
  return out;
}

export function terminalsFor(tasks: MockTask[]): ExamTerminalTarget[] {
  const contexts = Array.from(new Set(tasks.flatMap((t) => t.contexts)));
  if (contexts.length) return [{ id: 'env/workstation', node: 'workstation', label: `workstation (contexts: ${contexts.join(', ')})`, entry: true }];
  const hosts = Array.from(new Set(tasks.flatMap((t) => t.nodes)));
  return hosts.map((h, i) => ({ id: `env/${h}`, node: h, label: h, entry: i === 0 }));
}

function checksFor(exam: FixtureExam, taskId: string, outcome: number, attemptId: string): ExamCheckScore[] {
  const t = fixtureTasks[taskId]!;
  const base = [
    { id: 'end-state', description: `${t.title}: the requested end state is in place`, weight: 1 },
    { id: 'scope', description: 'Nothing outside the task was changed', weight: 0.5 },
    { id: 'works', description: 'The result works when exercised', weight: 1 },
  ];
  return base.map((c, i) => {
    const passed = outcome >= 1 ? true : outcome <= 0 ? false : i !== 2 - Math.floor(hash(`${attemptId}:${taskId}:c`) * 2);
    const afterReboot = !passed && exam.rules.rebootBeforeGrade && i === 0 && hash(`${attemptId}:${taskId}:rb`) > 0.5;
    return {
      ...c,
      passed,
      skills: t.skills.slice(i % Math.max(1, t.skills.length), (i % Math.max(1, t.skills.length)) + 1).concat(t.skills.length ? [] : ['k8s.cli.scoped-changes']),
      message: passed ? 'passed' : afterReboot ? 'not satisfied after the reboot' : 'not satisfied yet',
      ...(afterReboot ? { failedAfterReboot: true } : {}),
    };
  });
}

/** Deterministic report; `skill` (0..1) shifts outcomes so retakes tend to improve. */
export function reportFor(exam: FixtureExam, attemptId: string, number: number, tasks: MockTask[], times: { timerStartedAt: string; gradedAt: string; submittedAt?: string; minutesUsed: number }): ExamReport {
  const skill = 0.5 + 0.25 * (number - 1);
  const scored = tasks.map((t) => {
    const r = hash(`${attemptId}:${t.taskId}`);
    const outcome = r < skill - 0.12 ? 1 : r < skill + 0.12 ? 0.5 : 0;
    const checks = checksFor(exam, t.taskId, outcome, attemptId);
    const total = checks.reduce((a, c) => a + c.weight, 0);
    const got = checks.reduce((a, c) => a + (c.passed ? c.weight : 0), 0);
    const score = exam.rules.partialCredit === 'per-check' ? Math.round((1000 * got) / total) / 10 : got === total ? 100 : 0;
    return {
      index: t.index,
      taskId: t.taskId,
      title: t.title,
      objective: t.objective,
      weight: t.weight,
      outcome: (score >= 100 ? 'pass' : score <= 0 ? 'fail' : 'partial') as 'pass' | 'partial' | 'fail',
      score,
      timeSpentSec: Math.round(240 + hash(`${attemptId}:${t.taskId}:t`) * 600),
      checks,
    };
  });
  const drawn = exam.blueprint.filter((o) => o.tasks > 0);
  const sum = drawn.reduce((a, o) => a + o.weight, 0);
  const objectives = drawn.map((o) => {
    const mine = scored.filter((t) => t.objective === o.objective);
    const score = mine.length ? mine.reduce((a, t) => a + t.score, 0) / mine.length : 0;
    return { id: o.objective, name: o.name, weight: Math.round((1000 * o.weight) / sum) / 10, tasks: mine.length, score: Math.round(score * 10) / 10 };
  });
  const total = Math.round(drawn.reduce((a, o, i) => a + ((o.weight / sum) * objectives[i]!.score), 0) * 10) / 10;
  const skills = new Map<string, { skillId: string; passed: number; failed: number }>();
  for (const t of scored) for (const c of t.checks) for (const s of c.skills) {
    const e = skills.get(s) ?? { skillId: s, passed: 0, failed: 0 };
    if (c.passed) e.passed++;
    else e.failed++;
    skills.set(s, e);
  }
  const weak = objectives.filter((o) => o.score < Math.max(exam.passMark, 70)).sort((a, b) => a.score - b.score);
  return {
    attemptId,
    examId: exam.id,
    examTitle: exam.title,
    disclaimer: exam.disclaimer,
    score: total,
    passMark: exam.passMark,
    passed: total >= exam.passMark,
    partialCredit: exam.rules.partialCredit,
    gradedAt: times.gradedAt,
    timerStartedAt: times.timerStartedAt,
    ...(times.submittedAt ? { submittedAt: times.submittedAt } : {}),
    minutesUsed: times.minutesUsed,
    durationMinutes: exam.durationMinutes,
    passes: ['initial', ...(exam.rules.idempotencyRerun ? ['rerun'] : []), ...(exam.rules.rebootBeforeGrade ? ['reboot'] : [])],
    objectives,
    tasks: scored,
    skills: [...skills.values()].sort((a, b) => a.skillId.localeCompare(b.skillId)),
    recommendations: weak
      .slice(0, 3)
      .map((o) => {
        const pool = MOCK_LABS_BY_DOMAIN[exam.domain] ?? [];
        return { objective: o.id, labIds: shuffle(pool, `${attemptId}:${o.id}:labs`).slice(0, 2) };
      })
      .filter((r) => r.labIds.length),
  };
}

/** Real catalog lab ids (apps/web mock catalog) recommended for weak objectives. */
const MOCK_LABS_BY_DOMAIN: Record<string, string[]> = {
  kubernetes: ['orchard-netpol-isolation', 'ledger-rbac-least-privilege', 'orchard-worker-upgrade', 'orchard-etcd-snapshot-restore', 'orchard-psa-baseline', 'orchard-ingress-tls-rotation', 'orchard-audit-policy'],
  linux: ['quill-lvm-extend', 'harbor-systemd-hardening'],
};

export const PHASE_ORDER: ExamAttemptPhase[] = ['preparing', 'in-progress', 'grading', 'completed', 'failed'];
