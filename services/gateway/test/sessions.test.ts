import { beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors.js';
import { SessionService, labelValue, sessionName } from '../src/sessions/service.js';
import { alice, bob, FakeCluster, FakeCompiler, realContent } from './fakes.js';

async function setup(opts: { validateTimeoutMs?: number } = {}) {
  const content = await realContent();
  const cluster = new FakeCluster();
  const compiler = new FakeCompiler();
  let t = 0;
  const svc = new SessionService(content, cluster, compiler, {
    validateTimeoutMs: opts.validateTimeoutMs ?? 5_000,
    pollMs: 100,
    // virtual clock: sleeping advances time instantly
    sleep: async (ms) => void (t += ms),
    now: () => t,
  });
  return { content, cluster, compiler, svc };
}

const status = (e: unknown) => (e instanceof HttpError ? e.status : undefined);

describe('naming', () => {
  it('builds DNS-safe session names and label values', () => {
    expect(sessionName('kubeadm-control-plane-upgrade')).toMatch(/^kubeadm-control-plane-upgrade-[0-9a-f]{6}$/);
    expect(sessionName('a'.repeat(60))).toHaveLength(47);
    expect(labelValue('user@example.com')).toBe('user-example.com');
    expect(labelValue('-x-')).toBe('x');
  });
});

describe('SessionService', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it('start: creates the template once and a LabSession owned by the caller', async () => {
    const { svc, cluster } = env;
    const a = await svc.start(alice, 'gateway-smoke');
    await svc.start(alice, 'gateway-smoke');
    expect(cluster.createdTemplates).toBe(1);
    const ls = cluster.sessions.get(a.id)!;
    expect(ls.spec.templateRef.name).toBe('gateway-smoke-v1-0123456789');
    expect(ls.spec.learner).toEqual({ id: 'alice', org: 'org-a' });
    expect(ls.spec.seed).toBeGreaterThan(0);
    expect(ls.metadata.labels).toMatchObject({ 'labs.cloudtrain.dev/lab-id': 'gateway-smoke', 'cloudtrain.dev/learner': 'alice', 'app.kubernetes.io/managed-by': 'cloudtrain-gateway' });
    // freshly created: every topology node is provisioning, results pending
    expect(a).toMatchObject({ labId: 'gateway-smoke', phase: 'pending', status: 'running', entryNode: 'workstation', score: 0, validations: 0 });
    expect(a.nodes).toEqual([{ name: 'workstation', status: 'provisioning' }]);
    expect(a.results.map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('start: unknown lab is 404', async () => {
    await expect(env.svc.start(alice, 'nope')).rejects.toSatisfy((e) => status(e) === 404);
  });

  it('get: maps Ready status (nodes, ip, params, expiry) and hides other learners\' sessions', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'gateway-smoke');
    cluster.markReady(s.id, { note: 'shift-b.txt' });
    const got = await svc.get(alice, s.id);
    expect(got).toMatchObject({ phase: 'ready', status: 'running', params: { note: 'shift-b.txt' }, deadlineMinutes: 30 });
    expect(got.nodes).toEqual([{ name: 'workstation', status: 'ready', ip: '10.244.1.7' }]);
    await expect(svc.get(bob, s.id)).rejects.toSatisfy((e) => status(e) === 404);
    await expect(svc.get(alice, 'missing')).rejects.toSatisfy((e) => status(e) === 404);
  });

  it('get: a failed session carries the controller\'s reason', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'drain-yard-worker');
    cluster.sessions.get(s.id)!.status = {
      phase: 'Failed',
      nodes: [
        { name: 'workstation', driver: 'container', phase: 'Ready' },
        { name: 'qm-yard', driver: 'k8s-cluster', phase: 'Failed', message: 'k8s-cluster driver: not implemented' },
      ],
      conditions: [{ type: 'Ready', status: 'False', reason: 'NodeFailed', message: 'node qm-yard: k8s-cluster driver: not implemented' }],
    };
    const got = await svc.get(alice, s.id);
    expect(got).toMatchObject({ phase: 'failed', status: 'failed', message: 'node qm-yard: k8s-cluster driver: not implemented' });
    expect(got.nodes.map((n) => n.status)).toEqual(['ready', 'degraded']);
  });

  it('validate: bumps validateRequest and maps the grader answer with skills per check', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'gateway-smoke');
    cluster.markReady(s.id, { note: 'shift-a.txt' });
    cluster.onPatch = (ls) => {
      const req = ls.spec.validateRequest ?? 0;
      ls.status!.validation = {
        observedRequest: req,
        phase: 'Complete',
        score: 33,
        checks: [
          { id: 'note-written', passed: false, weight: '2', skills: ['linux.shell.redirection'], message: 'file content does not match', output: 'SECRET expected ready', durationMs: 12 },
          { id: 'shell-used', passed: true, weight: '1', skills: ['linux.shell.navigation'], durationMs: 8 },
        ],
      };
    };
    const r = await svc.validate(alice, s.id);
    expect(cluster.sessions.get(s.id)!.spec.validateRequest).toBe(1);
    expect(r.grading).toEqual({ state: 'complete' });
    expect(r.summary).toEqual({ passed: 1, total: 2, score: 33, skillsTouched: ['linux.shell.redirection', 'linux.shell.navigation'] });
    expect(r.session.results).toEqual([
      { checkId: 'note-written', status: 'fail', skills: ['linux.shell.redirection'], message: 'file content does not match', durationMs: 12 },
      { checkId: 'shell-used', status: 'pass', skills: ['linux.shell.navigation'], durationMs: 8 },
    ]);
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(r.session).toMatchObject({ score: 33, validations: 1, status: 'running' });

    await svc.validate(alice, s.id);
    expect(cluster.sessions.get(s.id)!.spec.validateRequest).toBe(2);
  });

  it('validate: all checks passing marks the session passed', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'gateway-smoke');
    cluster.markReady(s.id);
    cluster.onPatch = (ls) => {
      ls.status!.validation = { observedRequest: ls.spec.validateRequest!, phase: 'Complete', score: 100, checks: [{ id: 'note-written', passed: true }, { id: 'shell-used', passed: true }] };
    };
    const r = await svc.validate(alice, s.id);
    expect(r.session.status).toBe('passed');
    // skills fall back to the lab's check skills when the grader omits them
    expect(r.summary.skillsTouched).toEqual(['linux.shell.redirection', 'linux.shell.navigation']);
  });

  it('validate: waits through Running until the answer for this request arrives', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'gateway-smoke');
    cluster.markReady(s.id);
    // an old answer and a Running one must not be taken as the result
    cluster.sessions.get(s.id)!.status!.validation = { observedRequest: 0, phase: 'Complete', score: 100, checks: [] };
    let polls = 0;
    const orig = cluster.getSession.bind(cluster);
    cluster.getSession = async (name) => {
      polls++;
      const ls = cluster.sessions.get(name)!;
      ls.status!.validation = polls < 3 ? { observedRequest: 1, phase: 'Running', score: 0 } : { observedRequest: 1, phase: 'Complete', score: 50, checks: [{ id: 'note-written', passed: true }, { id: 'shell-used', passed: false }] };
      return orig(name);
    };
    const r = await svc.validate(alice, s.id);
    expect(r.grading?.state).toBe('complete');
    expect(r.summary.score).toBe(50);
  });

  it('validate: no grader -> timeout state, results stay pending', async () => {
    env = await setup({ validateTimeoutMs: 2_000 });
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'gateway-smoke');
    cluster.markReady(s.id);
    const r = await svc.validate(alice, s.id);
    expect(r.grading).toMatchObject({ state: 'timeout' });
    expect(r.grading?.message).toMatch(/No grader answered within 2s/);
    expect(r.summary).toEqual({ passed: 0, total: 2, score: 0, skillsTouched: [] });
    expect(r.session.results.every((x) => x.status === 'pending')).toBe(true);
  });

  it('validate: grading itself failing marks every check as error', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'gateway-smoke');
    cluster.markReady(s.id);
    cluster.onPatch = (ls) => void (ls.status!.validation = { observedRequest: ls.spec.validateRequest!, phase: 'Failed', score: 0, message: 'grader pod unschedulable' });
    const r = await svc.validate(alice, s.id);
    expect(r.grading).toEqual({ state: 'failed', message: 'grader pod unschedulable' });
    expect(r.session.results.map((x) => x.status)).toEqual(['error', 'error']);
  });

  it('validate: refuses while provisioning (409)', async () => {
    const s = await env.svc.start(alice, 'gateway-smoke');
    await expect(env.svc.validate(alice, s.id)).rejects.toSatisfy((e) => status(e) === 409);
  });

  it('hints: reveal persists on the LabSession and returns the content with params filled', async () => {
    const { svc, cluster } = env;
    const s = await svc.start(alice, 'two-container-pod');
    cluster.sessions.get(s.id)!.status = { phase: 'Ready', resolvedParams: { pod: 'dock-display' } };
    const r = await svc.revealHint(alice, s.id, 1);
    expect(cluster.sessions.get(s.id)!.metadata.annotations?.['cloudtrain.dev/revealed-hints']).toBe('1');
    expect(r.revealedHints).toEqual([1]);
    expect(r.hints?.[1]?.command).toContain('run dock-display');
    expect((await svc.revealHint(alice, s.id, 0)).revealedHints).toEqual([0, 1]);
    await expect(svc.revealHint(alice, s.id, 42)).rejects.toSatisfy((e) => status(e) === 404);
  });

  it('list and end: only the caller\'s sessions; end deletes the LabSession', async () => {
    const { svc, cluster } = env;
    const a = await svc.start(alice, 'gateway-smoke');
    await svc.start(bob, 'gateway-smoke');
    expect((await svc.list(alice)).map((x) => x.id)).toEqual([a.id]);
    await expect(svc.end(bob, a.id)).rejects.toSatisfy((e) => status(e) === 404);
    await svc.end(alice, a.id);
    expect(cluster.sessions.has(a.id)).toBe(false);
  });
});
