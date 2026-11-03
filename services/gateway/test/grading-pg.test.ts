import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();

const result = (req: number, completedAt: string) => ({
  observedRequest: req,
  phase: 'Complete' as const,
  score: 100,
  completedAt,
  checks: [
    { id: 'note-written', passed: true, weight: '1', skills: ['linux.shell.redirection'] },
    { id: 'shell-used', passed: true, weight: '2', skills: ['linux.shell.navigation'] },
  ],
});

describe.skipIf(!available)('grading records (content-1, grading-5)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);
  afterAll(async () => h?.close());

  const attempt = (session: string) =>
    withTenant(h.t.db, { orgId: h.orgs.quillmoor }, (tx) => tx.selectFrom('lab_attempts').selectAll().where('session_name', '=', session).executeTakeFirstOrThrow());

  it('a run that finishes after Validate timed out is recorded by the next session read, exactly once', async () => {
    const amara = as(h, Q.amara);
    const id = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(id);
    const v = await amara.post(`/api/sessions/${id}/validate`);
    expect(v.json().grading.state).toBe('timeout');
    expect((await attempt(id)).validations).toBe(0);
    // The grader answers later; the page keeps polling the session.
    h.cluster.sessions.get(id)!.status!.validation = result(1, new Date().toISOString());
    for (let i = 0; i < 3; i++) expect((await amara.get(`/api/sessions/${id}`)).statusCode).toBe(200);
    // A second gateway replica (fresh memo) reading it again does not double-record either.
    const lab = h.ps.content.labs.get('gateway-smoke')!;
    const ls = h.cluster.sessions.get(id)!;
    await h.ps.validated({ sub: Q.amara, orgId: h.orgs.quillmoor } as never, lab, ls, { grading: { state: 'complete' } } as never);
    const a = await attempt(id);
    expect(a).toMatchObject({ validations: 1, score: 100, outcome: 'passed' });
    await amara.del(`/api/sessions/${id}`);
  });

  it('records a run once even when request numbers ran ahead of recorded runs', async () => {
    const amara = as(h, Q.amara);
    const id = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(id);
    // Request 3 answered, but runs 1 and 2 were never recorded (session left before they finished).
    h.cluster.sessions.get(id)!.spec.validateRequest = 3;
    h.cluster.sessions.get(id)!.status!.validation = result(3, new Date().toISOString());
    await amara.get(`/api/sessions/${id}`);
    const lab = h.ps.content.labs.get('gateway-smoke')!;
    await h.ps.validated({ sub: Q.amara, orgId: h.orgs.quillmoor } as never, lab, h.cluster.sessions.get(id)!, { grading: { state: 'complete' } } as never);
    expect((await attempt(id)).validations).toBe(1);
    await amara.del(`/api/sessions/${id}`);
  });

  it('records two runs that finish within the same second (dedupe on the request, not the time)', async () => {
    const amara = as(h, Q.amara);
    const id = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(id);
    const lab = h.ps.content.labs.get('gateway-smoke')!;
    const ls = h.cluster.sessions.get(id)!;
    const at = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const p = { sub: Q.amara, orgId: h.orgs.quillmoor } as never;
    ls.status!.validation = result(1, at);
    await h.ps.validated(p, lab, ls, { grading: { state: 'complete' } } as never);
    ls.status!.validation = result(2, at);
    await h.ps.validated(p, lab, ls, { grading: { state: 'complete' } } as never);
    // Run 2 handed in again (a later read, another replica): still recorded once.
    await h.ps.validated(p, lab, ls, { grading: { state: 'complete' } } as never);
    expect(await attempt(id)).toMatchObject({ validations: 2, graded_request: 2 });
    await amara.del(`/api/sessions/${id}`);
  });

  it('records a run once when no attempt row exists yet and two replicas record it at the same time', async () => {
    const amara = as(h, Q.amara);
    const id = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(id);
    // started() never got to create the attempt row.
    await h.t.owner.deleteFrom('lab_attempts').where('session_name', '=', id).execute();
    const lab = h.ps.content.labs.get('gateway-smoke')!;
    const ls = h.cluster.sessions.get(id)!;
    ls.status!.validation = result(1, new Date().toISOString());
    const p = { sub: Q.amara, orgId: h.orgs.quillmoor } as never;
    await Promise.all([1, 2, 3].map(() => h.ps.validated(p, lab, ls, { grading: { state: 'complete' } } as never)));
    expect(await attempt(id)).toMatchObject({ validations: 1, graded_request: 1 });
    await amara.del(`/api/sessions/${id}`);
  });

  it('a hint revealed in a throwaway session counts against the solve in the next one', async () => {
    const lucas = as(h, Q.lucas);
    const a = (await lucas.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(a);
    expect((await lucas.post(`/api/sessions/${a}/hints/0`)).statusCode).toBe(200);
    expect((await lucas.post(`/api/sessions/${a}/hints/1`)).statusCode).toBe(200);
    // Recorded at once, before any validate or end.
    expect((await attempt(a)).hints_used).toBe(2);
    await lucas.del(`/api/sessions/${a}`);
    const b = (await lucas.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(b);
    h.cluster.onPatch = (s) => {
      if (s.spec.validateRequest) s.status!.validation = result(s.spec.validateRequest, new Date().toISOString());
    };
    expect((await lucas.post(`/api/sessions/${b}/validate`)).json().grading.state).toBe('complete');
    h.cluster.onPatch = undefined;
    expect((await attempt(b)).hints_used).toBe(2);
    await lucas.del(`/api/sessions/${b}`);
    // Reveals older than the carry window do not count.
    await h.t.owner.updateTable('lab_hint_reveals').set({ revealed_at: new Date(Date.now() - 30 * 86_400_000) }).where('session_name', 'in', [a, b]).execute();
    const c = (await lucas.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(c);
    h.cluster.onPatch = (s) => {
      if (s.spec.validateRequest) s.status!.validation = result(s.spec.validateRequest, new Date().toISOString());
    };
    await lucas.post(`/api/sessions/${c}/validate`);
    h.cluster.onPatch = undefined;
    expect((await attempt(c)).hints_used).toBe(0);
    await lucas.del(`/api/sessions/${c}`);
  });

  it('counts which hints were revealed across sessions, not the most in any one of them', async () => {
    const amara = as(h, Q.amara);
    const solve = (id: string) => {
      h.cluster.onPatch = (s) => {
        if (s.spec.validateRequest) s.status!.validation = result(s.spec.validateRequest, new Date().toISOString());
      };
      return amara.post(`/api/sessions/${id}/validate`).finally(() => (h.cluster.onPatch = undefined));
    };
    // Hint 0 in throwaway session A, hint 1 in throwaway session B, solve in C.
    const a = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(a);
    await amara.post(`/api/sessions/${a}/hints/0`);
    await amara.del(`/api/sessions/${a}`);
    const b = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(b);
    await amara.post(`/api/sessions/${b}/hints/1`);
    await amara.del(`/api/sessions/${b}`);
    const c = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(c);
    expect((await solve(c)).json().grading.state).toBe('complete');
    expect((await attempt(c)).hints_used).toBe(2);
    await amara.del(`/api/sessions/${c}`);
  });

  it('records a reveal again when the hint is requested again (the first recording may have failed)', async () => {
    const amara = as(h, Q.amara);
    const id = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(id);
    expect((await amara.post(`/api/sessions/${id}/hints/0`)).statusCode).toBe(200);
    // Simulate a lost first recording.
    await h.t.owner.deleteFrom('lab_hint_reveals').where('session_name', '=', id).execute();
    await h.t.owner.updateTable('lab_attempts').set({ hints_used: 0 }).where('session_name', '=', id).execute();
    expect((await amara.post(`/api/sessions/${id}/hints/0`)).statusCode).toBe(200);
    expect((await attempt(id)).hints_used).toBe(1);
    const rows = await h.t.owner.selectFrom('lab_hint_reveals').select('hint_index').where('session_name', '=', id).execute();
    expect(rows.map((r) => r.hint_index)).toEqual([0]);
    await amara.del(`/api/sessions/${id}`);
  });
  it('records the revealed hints when an abandoned session ends, so they count in the next one', async () => {
    const amara = as(h, Q.amara);
    const id = (await amara.post('/api/labs/gateway-smoke/sessions')).json().id as string;
    h.cluster.markReady(id);
    expect((await amara.post(`/api/sessions/${id}/hints/1`)).statusCode).toBe(200);
    // Simulate a reveal whose recording was lost; the learner then abandons the session.
    await h.t.owner.deleteFrom('lab_hint_reveals').where('session_name', '=', id).execute();
    expect((await amara.del(`/api/sessions/${id}`)).statusCode).toBeLessThan(300);
    const rows = await h.t.owner.selectFrom('lab_hint_reveals').select('hint_index').where('session_name', '=', id).execute();
    expect(rows.map((r) => r.hint_index)).toEqual([1]);
  });
});
