import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RetakePolicy } from '@cloudtrain/api-types';
import { buildApp } from '../src/app.js';
import { DevAuthenticator, type Principal } from '../src/auth.js';
import { MemoryEvidenceSink, skillEvidence } from '../src/exams/evidence.js';
import { retakeStatus } from '../src/exams/policy.js';
import { planExamTerminal } from '../src/exams/routes.js';
import { ExamService, type TeamDirectory } from '../src/exams/service.js';
import { can } from '../src/authz.js';
import { MemoryExamStore, type AttemptRecord } from '../src/exams/store.js';
import type { LabSession } from '../src/kube/types.js';
import { SessionService } from '../src/sessions/service.js';
import { alice, bob, FakeCluster, FakeCompiler } from './fakes.js';
import { catalog, EXAM, examContent, FakeExamCluster, StubExamCompiler } from './exam-fakes.js';

let now = new Date('2026-10-14T10:00:00Z');
const manager: Principal = { ...alice, sub: 'mara', name: 'Mara Lindqvist', roles: ['learner', 'manager'], managedTeamIds: ['t-ops'] };
const admin: Principal = { ...alice, sub: 'olga', name: 'Olga Admin', roles: ['learner', 'org_admin'] };

/** Stand-in for PgTeamDirectory (teams/team_members): team t-ops = mara (manager) + alice + bob. */
class StaticTeamDirectory implements TeamDirectory {
  async team(p: Principal, teamId?: string) {
    const id = teamId ?? p.managedTeamIds[0] ?? 't-ops';
    if (!can(p, 'progress.read.team', { kind: 'team', teamId: id })) return null;
    return { id, name: 'Ops', members: [{ userId: 'mara', name: 'Mara Lindqvist' }, { userId: 'alice', name: 'Alice' }] };
  }
  async subject(_p: Principal, userId: string) {
    return ['mara', 'alice', 'bob'].includes(userId) ? { kind: 'user' as const, userId, teamIds: ['t-ops'], cohortIds: [] } : null;
  }
}

async function make() {
  const cat = await catalog();
  const cluster = new FakeExamCluster();
  const store = new MemoryExamStore();
  const evidence = new MemoryEvidenceSink();
  const compiler = new StubExamCompiler();
  const svc = new ExamService(cat, await examContent(), cluster, compiler, store, evidence, new StaticTeamDirectory(), {
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

describe('exam interventions and audit', () => {
  afterEach(() => {
    now = new Date('2026-10-14T10:00:00Z');
  });

  it('audits start and submit; a failed cluster start leaves an uncounted attempt', async () => {
    const { svc, cluster, store } = await make();
    const { id } = await svc.start(alice, EXAM, '10.0.0.7');
    cluster.inProgress(id, '2026-10-14T10:05:00Z');
    now = new Date('2026-10-14T10:20:00Z');
    await svc.submit(alice, id, '10.0.0.7');
    expect(store.audits.map((a) => [a.action, a.targetId, a.actorId, a.ip])).toEqual([
      ['exam.start', id, 'alice', '10.0.0.7'],
      ['exam.submit', id, 'alice', '10.0.0.7'],
    ]);
    expect(store.audits[1]!.details).toMatchObject({ examId: EXAM, secondsLeft: 900 });

    const { svc: svc2, cluster: c2, store: s2 } = await make();
    c2.createExamSession = async () => {
      throw new Error('apiserver down');
    };
    await expect(svc2.start(alice, EXAM)).rejects.toThrow(/apiserver down/);
    const [rec] = await s2.listByUser(alice.orgId, 'alice', EXAM);
    expect(rec).toMatchObject({ phase: 'failed' });
    expect((await svc2.list(alice)).find((e) => e.id === EXAM)!.retake).toMatchObject({ allowed: true, attemptsTotal: 0 });
  });

  it('lets an org admin void a running attempt (not counted, environment deleted) and refuses learners and managers', async () => {
    const { svc, cluster, store } = await make();
    const { id } = await svc.start(alice, EXAM);
    cluster.inProgress(id, '2026-10-14T10:05:00Z');
    await expect(svc.void(bob, id, 'x')).rejects.toMatchObject({ status: 403 }); // a learner holds no session.control
    await expect(svc.void(manager, id, 'x')).rejects.toMatchObject({ status: 403 }); // managers hold no session.control
    const out = await svc.void(admin, id, 'Proctoring incident', '10.9.9.9');
    expect(out).toMatchObject({ phase: 'failed', counted: false, voided: { reason: 'Proctoring incident' } });
    expect(cluster.sessions.has(id)).toBe(false);
    const st = await svc.attempt(alice, id);
    expect(st.message).toMatch(/ended by an administrator/);
    expect(store.audits.at(-1)).toMatchObject({ action: 'exam.void', targetId: id, actorId: 'olga', details: { candidate: 'alice', reason: 'Proctoring incident' } });
    await expect(svc.void(admin, id, undefined)).rejects.toThrow(/Only a running attempt/);
    expect((await svc.list(alice)).find((e) => e.id === EXAM)!.retake).toMatchObject({ allowed: true, attemptsTotal: 0 });
  });

  it('enforces the 30-day cap from the curriculum retake policy server-side and lets a manager grant one retake past it', async () => {
    const { svc, cluster, store } = await make();
    // sim-test-k8s-dev: freeRetakes 1, cooldownHours 0, maxAttemptsPer30Days 5.
    for (const score of ['40', '45', '50', '55', '60']) {
      const { id } = await svc.start(alice, EXAM);
      cluster.inProgress(id, now.toISOString());
      cluster.completed(id, score, false);
      await svc.attempt(alice, id);
    }
    const blocked = await svc.start(alice, EXAM).catch((e: unknown) => e as { status: number; message: string; extra: { details?: { nextAllowedAt?: string } } });
    expect(blocked).toMatchObject({ status: 409 });
    expect((blocked as { message: string }).message).toMatch(/all 5 attempts allowed in 30 days/);
    expect((blocked as { extra: { details?: { nextAllowedAt?: string } } }).extra.details?.nextAllowedAt).toBeTruthy();

    await expect(svc.grantRetake(alice, EXAM, 'alice', 'self')).rejects.toMatchObject({ status: 403 });
    await expect(svc.grantRetake(manager, EXAM, 'nobody', undefined)).rejects.toThrow(/Member not found/);
    const g = await svc.grantRetake(manager, EXAM, 'alice', 'Network outage during attempt 2', '10.1.1.1');
    expect(g).toMatchObject({ examId: EXAM, userId: 'alice', grantedBy: 'mara', reason: 'Network outage during attempt 2' });
    expect((await svc.list(alice)).find((e) => e.id === EXAM)!.retake).toMatchObject({ allowed: true, viaGrant: true, retakeGrants: 1 });
    const third = await svc.start(alice, EXAM);
    expect(third.number).toBe(6);
    expect(store.audits.filter((a) => a.action === 'exam.start').at(-1)!.details).toMatchObject({ retakeGrant: true });
    expect(await store.openGrants(alice.orgId, 'alice', EXAM)).toEqual([]);
    expect(store.audits.find((a) => a.action === 'exam.retake_grant')).toMatchObject({ targetType: 'user', targetId: 'alice', actorId: 'mara' });
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
