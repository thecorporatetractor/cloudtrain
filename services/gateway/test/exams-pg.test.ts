import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Principal } from '../src/auth.js';
import { withTenant } from '../src/db/index.js';
import { EXAM_TENANT_TABLES } from '../src/db/migrations/0003_exams.js';
import { defaultPeopleFile, readPeople, seed } from '../src/db/seed.js';
import { PgEvidenceSink, PgExamStore, PgTeamDirectory } from '../src/exams/pg.js';
import { ExamService } from '../src/exams/service.js';
import { SessionService } from '../src/sessions/service.js';
import { catalog, EXAM, examContent, FakeExamCluster, StubExamCompiler } from './exam-fakes.js';
import { FakeCluster, FakeCompiler, repo } from './fakes.js';
import { HeaderAuthenticator, Q } from './harness.js';
import { createTestDb, pgAvailable, type TestDb } from './pg.js';

const available = await pgAvailable();

/** HeaderAuthenticator with the BFF's CSRF rule on: the session token is "tok-<user>". */
class CsrfHeaderAuthenticator extends HeaderAuthenticator {
  override readonly csrf = true;
  override async authenticate(req: FastifyRequest): Promise<Principal | null> {
    const p = await super.authenticate(req);
    return p ? { ...p, session: { idHash: 'h', csrf: `tok-${p.sub}`, expiresAt: new Date(Date.now() + 3600_000).toISOString(), method: 'oidc' } } : null;
  }
}

/** Acme Freight (the other org): an org admin and the Linehaul manager, added by the test (the seed leaves SSO people pending). */
const ACME = { olivia: 'c3000000-0000-4000-8000-000000000001', marcus: 'c3000000-0000-4000-8000-000000000002' };

describe.skipIf(!available)('exam simulations on Postgres (RLS, learner model, teams, audit, CSRF)', () => {
  let t: TestDb;
  let app: FastifyInstance;
  let exams: FakeExamCluster;
  let orgs: { quillmoor: string; acme: string };
  let teams: Record<string, string>;
  let now = new Date('2026-10-14T10:00:00Z');

  const call = (user: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, csrf: boolean | string = true, org?: string) =>
    app.inject({
      method,
      url,
      headers: { 'x-test-user': user, ...(org ? { 'x-test-org': org } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf === true ? `tok-${user}` : csrf } : {}), ...(payload ? {} : { 'content-type': 'application/json' }) },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    t = await createTestDb();
    const content = await examContent();
    await seed(t.owner, content, await readPeople(defaultPeopleFile(repo)));
    const orgRows = await t.owner.selectFrom('orgs').select(['id', 'slug']).execute();
    orgs = { quillmoor: orgRows.find((o) => o.slug === 'quillmoor')!.id, acme: orgRows.find((o) => o.slug === 'acme-freight')!.id };
    teams = Object.fromEntries((await t.owner.selectFrom('teams').select(['id', 'name']).execute()).map((r) => [r.name, r.id]));
    const linehaul = (await t.owner.selectFrom('teams').select('id').where('org_id', '=', orgs.acme).where('name', '=', 'Linehaul Operations').executeTakeFirstOrThrow()).id;
    for (const [id, name, roles] of [
      [ACME.olivia, 'Olivia Exam-Test', ['learner', 'org_admin']],
      [ACME.marcus, 'Marcus Exam-Test', ['learner', 'manager']],
    ] as const) {
      await t.owner.insertInto('users').values({ id, email: `${id}@acme-freight.example`, name, title: null }).execute();
      await t.owner.insertInto('memberships').values({ org_id: orgs.acme, user_id: id, roles: [...roles], status: 'active', source: 'seed' }).execute();
    }
    await t.owner.insertInto('team_members').values({ org_id: orgs.acme, team_id: linehaul, user_id: ACME.marcus, role: 'manager', source: 'manual' }).execute();
    exams = new FakeExamCluster();
    const svc = new ExamService(await catalog(), content, exams, new StubExamCompiler(), new PgExamStore(t.db), new PgEvidenceSink(t.db, content), new PgTeamDirectory(t.db), { now: () => now });
    const labs = new FakeCluster();
    app = await buildApp({ content, auth: new CsrfHeaderAuthenticator(t), sessions: new SessionService(content, labs, new FakeCompiler(), { validateTimeoutMs: 100 }), cluster: labs, exams: svc });
  }, 90_000);
  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  let attemptId = '';

  it('requires the CSRF header on exam writes', async () => {
    expect((await call(Q.amara, 'POST', `/api/exams/${EXAM}/attempts`, undefined, false)).json()).toMatchObject({ code: 'csrf' });
    expect((await call(Q.amara, 'POST', `/api/exams/${EXAM}/attempts`, undefined, 'tok-someone-else')).statusCode).toBe(403);
    expect(await t.owner.selectFrom('exam_attempts').select('id').execute()).toEqual([]);
  });

  it('starts once, refuses a second start (409), persists the attempt and audits the start', async () => {
    const started = await call(Q.amara, 'POST', `/api/exams/${EXAM}/attempts`);
    expect(started.statusCode).toBe(201);
    attemptId = started.json().attempt.id;
    const again = await call(Q.amara, 'POST', `/api/exams/${EXAM}/attempts`);
    expect(again.statusCode).toBe(409);
    expect(again.json().details.activeAttemptId).toBe(attemptId);
    const row = await t.owner.selectFrom('exam_attempts').selectAll().where('id', '=', attemptId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ org_id: orgs.quillmoor, user_id: Q.amara, exam_id: EXAM, number: 1, phase: 'preparing' });
    const audit = await t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'exam.start').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ org_id: orgs.quillmoor, actor_id: Q.amara, target_type: 'exam_attempt', target_id: attemptId });
  });

  it('holds one running attempt per person and exam under concurrent starts (unique index)', async () => {
    const [a, b] = await Promise.all([call(Q.lucas, 'POST', `/api/exams/${EXAM}/attempts`), call(Q.lucas, 'POST', `/api/exams/${EXAM}/attempts`)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const rows = await t.owner.selectFrom('exam_attempts').select(['id', 'phase']).where('user_id', '=', Q.lucas).execute();
    expect(rows.filter((r) => r.phase !== 'failed')).toHaveLength(1);
  });

  it('flags, submits (audited) and persists the graded report, task results and learner-model evidence', async () => {
    exams.inProgress(attemptId, '2026-10-14T10:05:00Z');
    now = new Date('2026-10-14T10:10:00Z');
    expect((await call(Q.amara, 'GET', `/api/exams/attempts/${attemptId}`)).json().phase).toBe('in-progress');
    expect((await call(Q.amara, 'PUT', `/api/exams/attempts/${attemptId}/tasks/2/flag`, { flagged: true })).json().tasks[1].flagged).toBe(true);
    expect((await call(Q.amara, 'POST', `/api/exams/attempts/${attemptId}/submit`)).statusCode).toBe(200);
    expect(exams.sessions.get(attemptId)!.spec.submit).toBe(true);
    expect(await t.owner.selectFrom('audit_log').select('target_id').where('action', '=', 'exam.submit').execute()).toEqual([{ target_id: attemptId }]);

    exams.completed(attemptId, '80', true);
    now = new Date('2026-10-14T10:20:00Z');
    const rep = await call(Q.amara, 'GET', `/api/exams/attempts/${attemptId}/report`);
    expect(rep.statusCode).toBe(200);
    expect(rep.json()).toMatchObject({ score: 80, passed: true });

    const row = await t.owner.selectFrom('exam_attempts').selectAll().where('id', '=', attemptId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ phase: 'completed', score: '80.0', passed: true, evidence_recorded: true, flagged: [2] });
    expect((row.report as { score: number }).score).toBe(80);
    const results = await t.owner.selectFrom('exam_task_results').select(['task_index', 'task_id', 'outcome', 'score']).where('attempt_id', '=', attemptId).orderBy('task_index').execute();
    expect(results.map((r) => [r.task_index, r.task_id, r.outcome, Number(r.score)])).toEqual([
      [1, 'xt-scale-manifest-api', 'pass', 100],
      [2, 'xt-secret-literal', 'partial', 50],
      [3, 'xt-expose-clusterip', 'fail', 0],
    ]);
    // Evidence: one lab attempt per task (session "<attempt>/t<n>", hints 0, ended), check results and skill evidence.
    const la = await t.owner.selectFrom('lab_attempts').selectAll().where('session_name', 'like', `${attemptId}/t%`).orderBy('session_name').execute();
    expect(la.map((a) => [a.session_name, a.lab_id, a.hints_used, a.score, !!a.ended_at])).toEqual([
      [`${attemptId}/t1`, 'xt-scale-manifest-api', 0, 100, true],
      [`${attemptId}/t2`, 'xt-secret-literal', 0, 50, true],
      [`${attemptId}/t3`, 'xt-expose-clusterip', 0, 0, true],
    ]);
    const ev = await t.owner.selectFrom('skill_evidence').select(['skill_id', 'outcome']).where('user_id', '=', Q.amara).where('attempt_id', 'in', la.map((a) => a.id)).execute();
    expect(ev.length).toBeGreaterThanOrEqual(4);
    const states = await t.owner.selectFrom('learner_skill_state').select('skill_id').where('user_id', '=', Q.amara).where('skill_id', '=', 'k8s.security.secrets').execute();
    expect(states).toHaveLength(1);
    // Reads do not record evidence twice.
    await call(Q.amara, 'GET', `/api/exams/attempts/${attemptId}`);
    expect(await t.owner.selectFrom('lab_attempts').select('id').where('session_name', 'like', `${attemptId}/t%`).execute()).toHaveLength(3);
  });

  it("shows team readiness to the manager of the learner's team only", async () => {
    const yard = await call(Q.tomasz, 'GET', '/api/exams/team-readiness');
    expect(yard.statusCode).toBe(200);
    expect(yard.json().team).toEqual({ id: teams['Yard Platform'], name: 'Yard Platform' });
    const ex = yard.json().exams.find((e: { examId: string }) => e.examId === EXAM);
    const amara = ex.members.find((m: { userId: string }) => m.userId === Q.amara);
    expect(amara).toMatchObject({ bestScore: 80, lastScore: 80, passed: true, readiness: 'ready', attempts: 1 });
    expect(ex.members.map((m: { userId: string }) => m.userId)).toContain(Q.sofia);

    // Another team's manager: refused for Yard Platform; their own team does not list Amara.
    expect((await call(Q.ines, 'GET', `/api/exams/team-readiness?team=${teams['Yard Platform']}`)).statusCode).toBe(403);
    const dispatch = (await call(Q.ines, 'GET', '/api/exams/team-readiness')).json();
    expect(dispatch.team.name).toBe('Dispatch SRE');
    expect(JSON.stringify(dispatch)).not.toContain(Q.amara);
    // Learners and instructors (cohort scope) get 403.
    expect((await call(Q.amara, 'GET', '/api/exams/team-readiness')).statusCode).toBe(403);
    expect((await call(Q.elena, 'GET', `/api/exams/team-readiness?team=${teams['Yard Platform']}`)).statusCode).toBe(403);
    // Org admin sees any team of the org.
    expect((await call(Q.priya, 'GET', `/api/exams/team-readiness?team=${teams['Yard Platform']}`)).statusCode).toBe(200);
  });

  it('keeps attempts invisible across orgs (HTTP and RLS)', async () => {
    // Acme's org admin and manager: no access to Quillmoor attempts or teams.
    expect((await call(ACME.olivia, 'GET', `/api/exams/attempts/${attemptId}`)).statusCode).toBe(404);
    expect((await call(ACME.olivia, 'POST', `/api/exams/attempts/${attemptId}/void`, { reason: 'x' })).statusCode).toBe(404);
    expect((await call(ACME.olivia, 'POST', `/api/exams/${EXAM}/retake-grants`, { userId: Q.amara })).statusCode).toBe(404);
    const foreign = await call(ACME.olivia, 'GET', `/api/exams/team-readiness?team=${teams['Yard Platform']}`);
    expect(foreign.statusCode).toBe(404);
    const acmeTeam = (await call(ACME.marcus, 'GET', '/api/exams/team-readiness')).json();
    expect(acmeTeam.team.name).toBe('Linehaul Operations');
    expect(JSON.stringify(acmeTeam)).not.toContain(Q.amara);

    // RLS: an acme transaction sees no quillmoor exam rows and cannot write any.
    await withTenant(t.db, { orgId: orgs.acme }, async (tx) => {
      for (const table of EXAM_TENANT_TABLES) {
        const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(tx);
        expect(r.rows[0]!.n, table).toBe(0);
      }
    });
    await expect(
      withTenant(t.db, { orgId: orgs.acme }, (tx) =>
        tx.insertInto('exam_attempts').values({ org_id: orgs.quillmoor, id: 'exam-00000000aa', user_id: Q.amara, exam_id: EXAM, exam_title: 'x', number: 9, seed: 1, phase: 'completed', started_at: new Date(), duration_minutes: 1, tasks: '[]', flagged: [], score: null, passed: null, report: null, timer_started_at: null, deadline: null, submitted_at: null, completed_at: null, voided_at: null, voided_by: null, void_reason: null }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await withTenant(t.db, { orgId: orgs.acme }, (tx) => tx.updateTable('exam_attempts').set({ score: 100 }).where('id', '=', attemptId).executeTakeFirst());
    expect(Number(upd.numUpdatedRows)).toBe(0);
    const del = await withTenant(t.db, { orgId: orgs.acme }, (tx) => tx.deleteFrom('exam_task_results').executeTakeFirst());
    expect(Number(del.numDeletedRows)).toBe(0);
    expect(await withTenant(t.db, {}, (tx) => tx.selectFrom('exam_attempts').select('id').execute())).toEqual([]);
    const own = await withTenant(t.db, { orgId: orgs.quillmoor }, (tx) => tx.selectFrom('exam_attempts').select('id').execute());
    expect(own.map((r) => r.id)).toContain(attemptId);
  });

  it('lets an org admin void a running attempt and a manager grant a retake, both audited; others are refused', async () => {
    const running = await t.owner.selectFrom('exam_attempts').select('id').where('user_id', '=', Q.lucas).where('phase', '=', 'preparing').executeTakeFirstOrThrow();
    expect((await call(Q.tomasz, 'POST', `/api/exams/attempts/${running.id}/void`, { reason: 'x' })).statusCode).toBe(403); // manager: no session.control
    const voided = await call(Q.priya, 'POST', `/api/exams/attempts/${running.id}/void`, { reason: 'Proctoring incident' });
    expect(voided.statusCode).toBe(200);
    expect(voided.json()).toMatchObject({ phase: 'failed', counted: false, voided: { reason: 'Proctoring incident' } });
    expect(exams.sessions.has(running.id)).toBe(false);
    const row = await t.owner.selectFrom('exam_attempts').select(['phase', 'voided_by', 'void_reason']).where('id', '=', running.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ phase: 'failed', voided_by: Q.priya, void_reason: 'Proctoring incident' });

    expect((await call(Q.ines, 'POST', `/api/exams/${EXAM}/retake-grants`, { userId: Q.amara })).statusCode).toBe(403); // not her team
    expect((await call(Q.amara, 'POST', `/api/exams/${EXAM}/retake-grants`, { userId: Q.amara })).statusCode).toBe(403);
    const g = await call(Q.tomasz, 'POST', `/api/exams/${EXAM}/retake-grants`, { userId: Q.amara, reason: 'Outage' });
    expect(g.statusCode).toBe(201);
    const audit = await t.owner.selectFrom('audit_log').select(['action', 'actor_id', 'target_type', 'target_id', 'details']).where('action', 'in', ['exam.void', 'exam.retake_grant']).orderBy('id').execute();
    expect(audit.map((a) => [a.action, a.actor_id, a.target_type, a.target_id])).toEqual([
      ['exam.void', Q.priya, 'exam_attempt', running.id],
      ['exam.retake_grant', Q.tomasz, 'user', Q.amara],
    ]);
    const list = (await call(Q.amara, 'GET', '/api/exams')).json().exams.find((e: { id: string }) => e.id === EXAM);
    expect(list.retake).toMatchObject({ allowed: true, retakeGrants: 1, attemptsTotal: 1 });
  });

  it('declares a permission on every exam route', async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain('/api/exams');
    // Unknown permissions or missing declarations fail at startup (requireDeclaredPermission); a learner is refused manager/admin routes at the hook.
    expect((await call(Q.amara, 'POST', `/api/exams/attempts/${attemptId}/void`, {})).json()).toMatchObject({ code: 'forbidden', permission: 'session.control' });
    expect((await call(Q.amara, 'POST', `/api/exams/${EXAM}/retake-grants`, { userId: Q.amara })).json()).toMatchObject({ code: 'forbidden' });
  });
});
