import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RetakePolicy } from '@cloudtrain/api-types';
import { buildApp } from '../src/app.js';
import { DevAuthenticator, type Principal } from '../src/auth.js';
import { loadContent, type Content } from '../src/content/load.js';
import { loadExamCatalog, type ExamCatalog } from '../src/exams/catalog.js';
import { parseCompiled, type CompiledExam, type ExamCompiler } from '../src/exams/compile.js';
import { MemoryEvidenceSink, skillEvidence } from '../src/exams/evidence.js';
import type { ExamCluster, ExamSession, ExamTemplate } from '../src/exams/kube.js';
import { retakeStatus } from '../src/exams/policy.js';
import { planExamTerminal } from '../src/exams/routes.js';
import { AttemptTeamDirectory, ExamService } from '../src/exams/service.js';
import { MemoryExamStore, type AttemptRecord } from '../src/exams/store.js';
import type { LabSession, LabTemplate } from '../src/kube/types.js';
import { SessionService } from '../src/sessions/service.js';
import { alice, bob, FakeCluster, FakeCompiler, fixtureLabs, repo } from './fakes.js';

const EXAM = 'sim-test-k8s-dev';
const examDir = path.join(repo, 'services/lab-orchestrator/testdata/exams');

let content: Promise<Content> | undefined;
function examContent(): Promise<Content> {
  content ??= loadContent(path.join(repo, 'content'), [fixtureLabs, path.join(examDir, 'tasks')]);
  return content;
}
async function catalog(): Promise<ExamCatalog> {
  return loadExamCatalog(await examContent(), path.join(repo, 'content'), path.join(repo, 'content/curriculum.yaml'), [path.join(examDir, 'exams.yaml')]);
}

const clone = <T>(v: T): T => structuredClone(v);
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = mergePatch((target[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    else target[k] = v;
  }
  return target;
}

/** In-memory exam objects; tests play the orchestrator by setting status. */
class FakeExamCluster implements ExamCluster {
  labTemplates = new Map<string, LabTemplate>();
  examTemplates = new Map<string, ExamTemplate>();
  sessions = new Map<string, ExamSession>();
  async getLabTemplate(name: string) {
    return this.labTemplates.get(name) ?? null;
  }
  async createLabTemplate(t: LabTemplate) {
    this.labTemplates.set(t.metadata.name, clone(t));
  }
  async getExamTemplate(name: string) {
    return this.examTemplates.get(name) ?? null;
  }
  async createExamTemplate(t: ExamTemplate) {
    this.examTemplates.set(t.metadata.name, clone(t));
  }
  async getExamSession(name: string) {
    const s = this.sessions.get(name);
    return s ? clone(s) : null;
  }
  async createExamSession(s: ExamSession) {
    this.sessions.set(s.metadata.name, clone(s));
    return clone(s);
  }
  async patchExamSession(name: string, patch: Record<string, unknown>) {
    const s = this.sessions.get(name)!;
    mergePatch(s as unknown as Record<string, unknown>, patch);
    return clone(s);
  }
  async deleteExamSession(name: string) {
    this.sessions.delete(name);
  }

  /** The controller drew two tasks and the shared environment is ready. */
  inProgress(name: string, startedAt: string) {
    const s = this.sessions.get(name)!;
    s.status = {
      phase: 'InProgress',
      message: 'The exam is in progress.',
      examID: EXAM,
      startedAt,
      deadline: new Date(Date.parse(startedAt) + 30 * 60_000).toISOString(),
      tasks: [
        { index: 1, id: 'xt-scale-manifest-api', objective: 'ckad:deployment', weight: '40', seed: 1, templateRef: 't1', title: 'Scale the manifest API', statement: 'Scale to **4** replicas.', environment: `${name}-env`, nodes: ['workstation', 'exam-core'], contexts: ['exam-core'] },
        { index: 2, id: 'xt-secret-literal', objective: 'ckad:environment-config-security', weight: '35', seed: 2, templateRef: 't2', title: 'Store the cargo API token', statement: 'Token qltok-abcde', environment: `${name}-env`, nodes: ['workstation', 'exam-core'], contexts: ['exam-core'] },
        { index: 3, id: 'xt-expose-clusterip', objective: 'ckad:services-networking', weight: '25', seed: 3, templateRef: 't3', title: 'Expose', statement: 'Port 8080', environment: `${name}-env`, nodes: ['workstation', 'exam-edge'], contexts: ['exam-edge'] },
      ],
      environments: [
        {
          name: `${name}-env`,
          tasks: [1, 2, 3],
          phase: 'Ready',
          entryNode: 'workstation',
          nodes: ['workstation', 'exam-core', 'exam-edge'],
          endpoints: [{ node: 'workstation', access: 'shell', protocol: 'k8s-exec', target: `ns/${name}-env-workstation-x/node` }],
        },
      ],
    };
  }

  /** The controller graded the attempt. */
  completed(name: string, score: string, passed: boolean) {
    const s = this.sessions.get(name)!;
    s.status = {
      ...s.status,
      phase: 'Completed',
      message: 'Your exam has been graded.',
      submittedAt: s.status?.startedAt,
      frozenAt: new Date(Date.parse(s.status!.startedAt!) + 12 * 60_000).toISOString(),
      completedAt: new Date(Date.parse(s.status!.startedAt!) + 13 * 60_000).toISOString(),
      environmentReleased: true,
      environments: s.status!.environments!.map((e) => ({ ...e, endpoints: [] })),
      report: {
        score,
        passMark: '66',
        passed,
        partialCredit: 'per-check',
        passes: ['initial', 'rerun'],
        gradedAt: new Date(Date.parse(s.status!.startedAt!) + 13 * 60_000).toISOString(),
        objectives: [
          { id: 'ckad:deployment', weight: '40', tasks: 1, score: '100' },
          { id: 'ckad:environment-config-security', weight: '35', tasks: 1, score: '50' },
          { id: 'ckad:services-networking', weight: '25', tasks: 1, score: '0' },
        ],
        tasks: [
          { index: 1, id: 'xt-scale-manifest-api', title: 'Scale', objective: 'ckad:deployment', weight: '40', outcome: 'pass', score: '100', checks: [{ id: 'desired-replicas', passed: true, weight: '1', skills: ['k8s.workloads.scaling'], message: 'passed' }] },
          {
            index: 2,
            id: 'xt-secret-literal',
            title: 'Secret',
            objective: 'ckad:environment-config-security',
            weight: '35',
            outcome: 'partial',
            score: '50',
            checks: [
              { id: 'token-value', passed: true, weight: '1', skills: ['k8s.security.secrets'], message: 'passed' },
              { id: 'generic-type', passed: false, weight: '1', skills: ['k8s.security.secrets'], message: 'no longer satisfied after the idempotency re-run', failedOnRerun: true },
            ],
          },
          { index: 3, id: 'xt-expose-clusterip', title: 'Expose', objective: 'ckad:services-networking', weight: '25', outcome: 'fail', score: '0', checks: [{ id: 'service-ports', passed: false, weight: '1', skills: ['k8s.networking.services'], message: 'not satisfied yet' }] },
        ],
      },
    };
  }
}

/** labctl stand-in: compiles nothing, returns an ExamTemplate + one task template. */
class StubExamCompiler implements ExamCompiler {
  calls = 0;
  async compile(examId: string): Promise<CompiledExam> {
    this.calls++;
    return parseCompiled(`apiVersion: labs.cloudtrain.dev/v1alpha1
kind: LabTemplate
metadata: {name: xt-scale-manifest-api-v1-0123456789, creationTimestamp: null}
spec: {source: {id: xt-scale-manifest-api, version: 1}}
---
apiVersion: labs.cloudtrain.dev/v1alpha1
kind: ExamTemplate
metadata: {name: ${examId}-abcdef0123}
spec: {source: {id: ${examId}, title: T}, durationMinutes: 30, passMark: "66"}
`);
  }
}

let now = new Date('2026-10-14T10:00:00Z');
const manager: Principal = { ...alice, sub: 'mara', name: 'Mara Lindqvist', roles: ['manager'] };

async function make() {
  const cat = await catalog();
  const cluster = new FakeExamCluster();
  const store = new MemoryExamStore();
  const evidence = new MemoryEvidenceSink();
  const compiler = new StubExamCompiler();
  const svc = new ExamService(cat, await examContent(), cluster, compiler, store, evidence, new AttemptTeamDirectory(store), {
    sessionLabels: { 'labs.cloudtrain.dev/exam-proof': 'true' },
    now: () => now,
  });
  return { cat, cluster, store, evidence, compiler, svc };
}

describe('exam catalog', () => {
  it('serves the test exam as available and curriculum exams as coming soon', async () => {
    const cat = await catalog();
    expect(cat.exams.get(EXAM)?.availability).toBe('available');
    const cka = cat.exams.get('sim-k8s-admin');
    expect(cka?.availability).toBe('coming-soon');
    expect(cka?.def.envTier).toBe('K');
    expect(cat.exams.get('sim-net-associate')?.def.envTier).toBe('N'); // YAML 1.2
    expect(cat.objectiveNames.get('ckad:deployment')).toBeTruthy();
    expect(cat.issues).toEqual([]);
  });
});

describe('retake policy', () => {
  const policy: RetakePolicy = { freeRetakes: 1, cooldownHours: 24, maxAttemptsPer30Days: 3, freshDraw: true };
  const at = (iso: string, phase: AttemptRecord['phase'] = 'completed', id = iso): AttemptRecord => ({
    id, orgId: 'o', userId: 'u', userName: 'U', examId: EXAM, examTitle: 'T', number: 1, seed: 1, phase, startedAt: iso,
    completedAt: new Date(Date.parse(iso) + 3600_000).toISOString(), durationMinutes: 30, tasks: [], flagged: [], evidenceRecorded: false,
  });
  const t = new Date('2026-10-14T12:00:00Z');
  it('allows the first attempt and one free retake, then applies the cooldown', () => {
    expect(retakeStatus(policy, [], t)).toMatchObject({ allowed: true, freeRetakesLeft: 1, attemptsTotal: 0 });
    expect(retakeStatus(policy, [at('2026-10-14T09:00:00Z')], t)).toMatchObject({ allowed: true, freeRetakesLeft: 1 });
    const two = [at('2026-10-14T09:00:00Z', 'completed', 'b'), at('2026-10-14T06:00:00Z', 'completed', 'a')];
    const s = retakeStatus(policy, two, t);
    expect(s).toMatchObject({ allowed: false, freeRetakesLeft: 0 });
    expect(s.nextAllowedAt).toBe('2026-10-15T10:00:00.000Z');
    expect(retakeStatus(policy, two, new Date('2026-10-15T10:00:01Z')).allowed).toBe(true);
  });
  it('caps attempts per 30 days and ignores attempts the platform could not run', () => {
    const three = [at('2026-10-01T09:00:00Z', 'completed', 'a'), at('2026-10-05T09:00:00Z', 'completed', 'b'), at('2026-10-10T09:00:00Z', 'completed', 'c')];
    const s = retakeStatus(policy, three, t);
    expect(s.allowed).toBe(false);
    expect(s.reason).toMatch(/3 attempts allowed in 30 days/);
    expect(s.nextAllowedAt).toBe('2026-10-31T09:00:00.000Z');
    const failed = [at('2026-10-14T09:00:00Z', 'failed', 'x'), at('2026-10-14T10:00:00Z', 'failed', 'y')];
    expect(retakeStatus(policy, failed, t)).toMatchObject({ allowed: true, attemptsTotal: 0, freeRetakesLeft: 1 });
  });
  it('blocks a second attempt while one is running', () => {
    const s = retakeStatus(policy, [at('2026-10-14T11:00:00Z', 'in-progress', 'run1')], t);
    expect(s).toMatchObject({ allowed: false, activeAttemptId: 'run1' });
  });
});

describe('exam service', () => {
  afterEach(() => {
    now = new Date('2026-10-14T10:00:00Z');
  });

  it('starts an attempt: templates, ExamSession with labels, preparing state', async () => {
    const { svc, cluster, store } = await make();
    const list = await svc.list(alice);
    const ex = list.find((e) => e.id === EXAM)!;
    expect(ex).toMatchObject({ availability: 'available', durationMinutes: 30, passMark: 66, taskCount: 3, retake: { allowed: true } });
    expect(ex.disclaimer).toMatch(/not affiliated/);
    expect(list[0]!.availability).toBe('available');

    const st = await svc.start(alice, EXAM);
    expect(st).toMatchObject({ phase: 'preparing', number: 1, counted: true, tasks: [], terminals: [], reportReady: false, preparingProgress: 0 });
    const es = cluster.sessions.get(st.id)!;
    expect(st.id).toMatch(/^exam-[0-9a-f]{10}$/);
    expect(es.metadata.labels).toMatchObject({ 'labs.cloudtrain.dev/exam-proof': 'true', 'labs.cloudtrain.dev/exam-id': EXAM, 'cloudtrain.dev/learner': 'alice' });
    expect(es.spec).toMatchObject({ examTemplateRef: { name: `${EXAM}-abcdef0123` }, candidate: { id: 'alice' } });
    expect(es.spec.avoidTasks).toBeUndefined();
    expect(cluster.labTemplates.size).toBe(1);
    expect(cluster.examTemplates.size).toBe(1);
    expect((await store.get(alice.orgId, st.id))?.phase).toBe('preparing');

    // A second start while one runs is refused.
    await expect(svc.start(alice, EXAM)).rejects.toThrow(/in progress/);
    // Coming-soon exams cannot start.
    await expect(svc.start(alice, 'sim-k8s-admin')).rejects.toThrow(/still being authored/);
  });

  it('serves the running attempt without checks, hints or solutions; flags; submit', async () => {
    const { svc, cluster } = await make();
    const { id } = await svc.start(alice, EXAM);
    cluster.inProgress(id, '2026-10-14T10:05:00Z');
    now = new Date('2026-10-14T10:10:00Z');
    const st = await svc.attempt(alice, id);
    expect(st).toMatchObject({ phase: 'in-progress', timerStartedAt: '2026-10-14T10:05:00Z', deadline: '2026-10-14T10:35:00.000Z', serverTime: '2026-10-14T10:10:00.000Z' });
    expect(st.tasks.map((t) => [t.index, t.weight, t.flagged])).toEqual([[1, 40, false], [2, 35, false], [3, 25, false]]);
    expect(st.tasks[0]!.statement).toBe('Scale to **4** replicas.');
    expect(st.tasks[0]!.objectiveName).toBeTruthy();
    expect(st.terminals).toEqual([{ id: `${id}-env/workstation`, node: 'workstation', label: 'workstation (contexts: exam-core, exam-edge)', entry: true }]);
    expect(JSON.stringify(st)).not.toMatch(/solution|hint|expect|"checks"/i);

    expect((await svc.flag(alice, id, 2, true)).tasks[1]!.flagged).toBe(true);
    expect((await svc.flag(alice, id, 3, true)).tasks.filter((t) => t.flagged).map((t) => t.index)).toEqual([2, 3]);
    expect((await svc.flag(alice, id, 2, false)).tasks.filter((t) => t.flagged).map((t) => t.index)).toEqual([3]);
    await expect(svc.flag(alice, id, 9, true)).rejects.toThrow(/Task not found/);
    await expect(svc.terminalTarget(alice, id, `${id}-env/exam-core`)).rejects.toThrow(/No such terminal/);
    expect(await svc.terminalTarget(alice, id, '')).toEqual({ environment: `${id}-env`, node: 'workstation' });

    // Someone else's attempt does not exist for bob.
    await expect(svc.attempt(bob, id)).rejects.toThrow(/Attempt not found/);

    await svc.submit(alice, id);
    expect(cluster.sessions.get(id)!.spec.submit).toBe(true);
    await expect(svc.report(alice, id)).rejects.toThrow(/not ready/);
  });

  it('turns a graded attempt into the report, records evidence once, and applies freshDraw on retakes', async () => {
    const { svc, cluster, evidence, store } = await make();
    const { id } = await svc.start(alice, EXAM);
    cluster.inProgress(id, '2026-10-14T10:05:00Z');
    cluster.completed(id, '52.5', false);
    now = new Date('2026-10-14T10:20:00Z');
    const st = await svc.attempt(alice, id);
    expect(st).toMatchObject({ phase: 'completed', score: 52.5, passed: false, reportReady: true, terminals: [] });
    const rep = await svc.report(alice, id);
    expect(rep).toMatchObject({ score: 52.5, passMark: 66, passed: false, minutesUsed: 12, durationMinutes: 30, passes: ['initial', 'rerun'] });
    expect(rep.disclaimer).toMatch(/not affiliated/);
    expect(rep.objectives.map((o) => [o.id, o.score])).toEqual([['ckad:deployment', 100], ['ckad:environment-config-security', 50], ['ckad:services-networking', 0]]);
    expect(rep.tasks[1]!.checks[1]).toMatchObject({ passed: false, failedOnRerun: true, weight: 1 });
    expect(rep.skills).toEqual(skillEvidence(rep));
    expect(rep.skills.find((s) => s.skillId === 'k8s.security.secrets')).toEqual({ skillId: 'k8s.security.secrets', passed: 1, failed: 1 });
    expect(JSON.stringify(rep)).not.toMatch(/"output"|expected/);
    // Evidence once, even across reads.
    await svc.attempt(alice, id);
    await svc.report(alice, id);
    expect(evidence.recorded).toHaveLength(1);
    expect(evidence.recorded[0]).toMatchObject({ userId: 'alice', attemptId: id, examId: EXAM });
    expect(evidence.recorded[0]!.tasks.map((t) => [t.taskId, t.difficulty, t.score])).toEqual([
      ['xt-scale-manifest-api', 'easy', 100],
      ['xt-secret-literal', 'easy', 50],
      ['xt-expose-clusterip', 'easy', 0],
    ]);
    expect((await store.get(alice.orgId, id))?.evidenceRecorded).toBe(true);

    // Retake (free): avoids the first attempt's tasks.
    const retake = await svc.start(alice, EXAM);
    expect(retake.number).toBe(2);
    expect(cluster.sessions.get(retake.id)!.spec.avoidTasks).toEqual(['xt-scale-manifest-api', 'xt-secret-literal', 'xt-expose-clusterip']);
    const mine = await svc.mine(alice, EXAM);
    expect(mine.map((a) => a.number)).toEqual([2, 1]);
    const detail = await svc.detail(alice, EXAM);
    expect(detail.checklist.join(' ')).toMatch(/no hints/);
    expect(detail.checklist.join(' ')).toMatch(/run again after the exam/);
    expect(detail.objectives.map((o) => o.weight)).toEqual([40, 35, 25]);
    expect(detail.bestScore).toBe(52.5);
  });

  it('marks an attempt whose ExamSession vanished as failed (not counted)', async () => {
    const { svc, cluster } = await make();
    const { id } = await svc.start(alice, EXAM);
    cluster.sessions.delete(id);
    const st = await svc.attempt(alice, id);
    expect(st).toMatchObject({ phase: 'failed', counted: false });
    expect(st.message).toMatch(/not scored/);
    expect((await svc.list(alice)).find((e) => e.id === EXAM)!.retake).toMatchObject({ allowed: true, attemptsTotal: 0 });
  });

  it('gives managers team readiness and refuses learners', async () => {
    const { svc, cluster } = await make();
    const { id } = await svc.start(alice, EXAM);
    cluster.inProgress(id, '2026-10-14T10:05:00Z');
    cluster.completed(id, '80', true);
    await svc.attempt(alice, id);
    await expect(svc.teamReadiness(alice)).rejects.toThrow(/do not manage/);
    const r = await svc.teamReadiness(manager);
    const ex = r.exams.find((e) => e.examId === EXAM)!;
    expect(ex.members.map((m) => [m.userId, m.readiness])).toEqual([['mara', 'not-attempted'], ['alice', 'ready']]);
    expect(ex.members[1]).toMatchObject({ bestScore: 80, lastScore: 80, passed: true, weakestObjective: { id: 'ckad:services-networking', score: 0 } });
    expect(ex).toMatchObject({ averageScore: 80, passRate: 0.5 });
  });
});

describe('exam terminal planning', () => {
  const ls = (over: Partial<LabSession['status']> = {}, revoked = false): LabSession => ({
    apiVersion: 'labs.cloudtrain.dev/v1alpha1',
    kind: 'LabSession',
    metadata: { name: 'exam-x-env' },
    spec: { templateRef: { name: 'exam-x-env' }, learner: { id: 'alice' }, seed: 1, ...(revoked ? { accessRevoked: true } : {}) },
    status: {
      phase: 'Ready',
      entryNode: 'workstation',
      endpoints: [
        { node: 'workstation', access: 'shell', protocol: 'k8s-exec', target: 'ns/pod-ws/node' },
        { node: 'db', access: 'ssh', protocol: 'ssh', host: 'db' },
      ],
      ...over,
    },
  });
  it('opens a shell on the entry node and ssh to VMs, and refuses after the freeze', () => {
    expect(planExamTerminal(ls(), 'workstation')).toMatchObject({ target: { namespace: 'ns', pod: 'pod-ws', container: 'node' }, via: 'shell on workstation' });
    expect(planExamTerminal(ls(), 'db').via).toBe('ssh db from workstation');
    expect(() => planExamTerminal(ls(), 'nope')).toThrow(/No terminal/);
    expect(() => planExamTerminal(ls({}, ), 'workstation')).not.toThrow();
    expect(() => planExamTerminal(ls({}, true), 'workstation')).toThrow(/closed/);
    expect(() => planExamTerminal(ls({ conditions: [{ type: 'AccessRevoked', status: 'True' }] }), 'workstation')).toThrow(/closed/);
    expect(() => planExamTerminal(ls({ phase: 'Provisioning' }), 'workstation')).toThrow(/not ready/);
  });
});

describe('exam HTTP routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  it('lists, starts, flags, submits and reports over HTTP', async () => {
    const { svc, cluster: exams } = await make();
    const c = await examContent();
    const labs = new FakeCluster();
    app = await buildApp({ content: c, auth: new DevAuthenticator(alice), sessions: new SessionService(c, labs, new FakeCompiler(), { validateTimeoutMs: 100 }), cluster: labs, exams: svc });
    const list = (await app.inject('/api/exams')).json();
    expect(list.exams.some((e: { id: string }) => e.id === EXAM)).toBe(true);
    expect((await app.inject('/api/exams/nope')).statusCode).toBe(404);
    const detail = (await app.inject(`/api/exams/${EXAM}`)).json();
    expect(detail.objectives).toHaveLength(3);
    const started = await app.inject({ method: 'POST', url: `/api/exams/${EXAM}/attempts`, headers: { 'content-type': 'application/json' } });
    expect(started.statusCode).toBe(201);
    const id = started.json().attempt.id as string;
    expect((await app.inject({ method: 'POST', url: `/api/exams/${EXAM}/attempts` })).statusCode).toBe(409);
    exams.inProgress(id, '2026-10-14T10:05:00Z');
    expect((await app.inject(`/api/exams/attempts/${id}`)).json().phase).toBe('in-progress');
    const bad = await app.inject({ method: 'PUT', url: `/api/exams/attempts/${id}/tasks/1/flag`, payload: { flagged: 'yes' } });
    expect(bad.statusCode).toBe(400);
    const flagged = await app.inject({ method: 'PUT', url: `/api/exams/attempts/${id}/tasks/1/flag`, payload: { flagged: true } });
    expect(flagged.json().tasks[0].flagged).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/exams/attempts/${id}/submit` })).statusCode).toBe(200);
    expect((await app.inject(`/api/exams/attempts/${id}/report`)).statusCode).toBe(409);
    exams.completed(id, '100', true);
    const rep = (await app.inject(`/api/exams/attempts/${id}/report`)).json();
    expect(rep).toMatchObject({ passed: true, score: 100 });
    expect((await app.inject('/api/exams/attempts/mine')).json()).toHaveLength(1);
    expect((await app.inject('/api/exams/team-readiness')).statusCode).toBe(403);
  });
});
