import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devPrincipal, type Principal } from '../src/auth.js';
import { createDb, type Db } from '../src/db/index.js';
import { PgEvidenceSink, PgExamStore, PgTeamDirectory } from '../src/exams/pg.js';
import { ExamService } from '../src/exams/service.js';
import type { LabSession } from '../src/kube/types.js';
import { CAPACITY_LOCK } from '../src/platform/capacity.js';
import { PlatformService } from '../src/platform/service.js';
import { SessionService } from '../src/sessions/service.js';
import { catalog, EXAM, examContent, FakeExamCluster, StubExamCompiler } from './exam-fakes.js';
import { FakeCluster, FakeCompiler, realContent } from './fakes.js';
import { harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();
// CI provides Postgres (ci.yml); there a missing server fails this suite instead of skipping it.
const required = !!process.env.CI;
const LAB = 'gateway-smoke';

/** A cluster whose creates take a while (concurrent starts overlap), and can fail after or before the write. */
class SlowCluster extends FakeCluster {
  failAfterWrite = false;
  failBeforeWrite = false;
  override async createSession(s: LabSession) {
    await new Promise((r) => setTimeout(r, 40));
    if (this.failBeforeWrite) throw new Error('create failed');
    const created = await super.createSession(s);
    if (this.failAfterWrite) throw new Error('client timeout after the write');
    return created;
  }
}

describe.skipIf(!available && !required)('start capacity through SessionService.start and ExamService.start', () => {
  let h: Harness;
  let db: Db;
  let ps: PlatformService;
  let cluster: SlowCluster;
  let sessions: SessionService;
  let p: (sub: string, org?: string) => Principal;
  const reservations = () => h.t.owner.selectFrom('session_reservations').selectAll().execute();

  beforeAll(async () => {
    if (!available) throw new Error('Postgres is required in CI (CT_TEST_DATABASE_URL)');
    h = await harness();
    // A small pool: a start that held one connection while waiting for another would hang here.
    db = createDb(h.t.appUrl, 2);
    cluster = new SlowCluster();
    const content = await realContent();
    ps = new PlatformService({ db, content, cluster, mailer: h.mailer, config: { ...h.ps.config, capacity: { perLearner: 2, maxActive: 7, examReserve: 2 } } });
    sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 100, hooks: ps });
    p = (sub, org = h.orgs.quillmoor) => devPrincipal({ sub, name: sub, email: `${sub}@quillmoor.example`, orgId: org, orgName: 'Org', orgSlug: 'org', team: 'Ops', roles: ['learner'] });
  }, 90_000);
  afterAll(async () => {
    await db?.destroy();
    await h?.close();
  });

  it('parallel starts of one learner cannot pass the per-learner cap', async () => {
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => sessions.start(p(Q.lucas), LAB)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(res.filter((r) => r.status === 'rejected').every((r) => /at most 2/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    // Both created sessions are confirmed; the refused ones left nothing.
    expect((await reservations()).filter((r) => r.user_id === Q.lucas).every((r) => r.confirmed_at)).toBe(true);
  });

  it('a create that fails before the write frees its slot; one that wrote anyway keeps it', async () => {
    cluster.failBeforeWrite = true;
    await expect(sessions.start(p(Q.sofia), LAB)).rejects.toThrow(/create failed/);
    cluster.failBeforeWrite = false;
    expect((await reservations()).filter((r) => r.user_id === Q.sofia)).toEqual([]);
    cluster.failAfterWrite = true;
    const s = await sessions.start(p(Q.sofia), LAB); // the session exists: start() returns it
    cluster.failAfterWrite = false;
    const kept = (await reservations()).filter((r) => r.user_id === Q.sofia);
    expect(kept.map((r) => r.session_name)).toEqual([s.id]);
    expect(kept[0]!.confirmed_at).not.toBeNull();
  });

  it('parallel starts of many learners stop at the cap minus the exam reserve', async () => {
    const users = [Q.priya, Q.tomasz, Q.ines, Q.elena, Q.kenji];
    const res = await Promise.allSettled(users.map((u) => sessions.start(p(u), LAB)));
    // 3 running + 2 more = 5 = maxActive 7 - reserve 2.
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(cluster.sessions.size).toBe(5);
  });

  it('reservations are keyed by org: the same session name in two orgs does not collide', async () => {
    await ps.reserveStart(p(Q.mei), 'exam', 'same-name');
    await ps.reserveStart(p(Q.mei, h.orgs.acme), 'exam', 'same-name');
    await ps.releaseStart(h.orgs.quillmoor, 'same-name');
    const left = (await reservations()).filter((r) => r.session_name === 'same-name');
    expect(left.map((r) => r.org_id)).toEqual([h.orgs.acme]);
    await ps.releaseStart(h.orgs.acme, 'same-name');
  });

  it('answers 503 instead of waiting when the capacity lock is held', async () => {
    const holder = createDb(h.t.appUrl, 1);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holding = holder.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${CAPACITY_LOCK}))`.execute(tx);
      await held;
    });
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    // A storm: beyond the waiter limit, starts are refused at once instead of queueing.
    const storm = Array.from({ length: 24 }, (_, i) => ps.reserveStart(p(Q.jonah), 'lab', `blocked-${i}`).then(() => 'ok', (e: { status?: number }) => ({ status: e.status, at: Date.now() - t0 })));
    const results = await Promise.all(storm);
    expect(results.every((r) => typeof r === 'object' && r.status === 503)).toBe(true);
    expect(results.filter((r) => typeof r === 'object' && r.at < 2_000).length).toBeGreaterThanOrEqual(24 - 16);
    expect(Date.now() - t0).toBeLessThan(15_000);
    release();
    await holding;
    await holder.destroy();
  }, 30_000);

  it('an exam that needs more environments than the headroom left is refused, for the platform cap and the org quota', async () => {
    // 5 labs run (maxActive 7): an exam may use the reserve, so 2 sessions are left.
    await expect(ps.reserveStart(p(Q.rhea), 'exam', 'too-big', 3)).rejects.toMatchObject({ status: 429, extra: { details: { quota: 'platform_sessions' } } });
    await ps.reserveStart(p(Q.rhea), 'exam', 'fits', 2);
    await ps.releaseStart(h.orgs.quillmoor, 'fits');
    // The org quota counts an exam's environments too.
    await h.t.owner.insertInto('quotas').values({ org_id: h.orgs.quillmoor, max_concurrent_sessions: 6, monthly_lab_hours: 500, max_session_minutes: 120 })
      .onConflict((oc) => oc.column('org_id').doUpdateSet({ max_concurrent_sessions: 6 })).execute();
    await expect(ps.reserveStart(p(Q.rhea), 'exam', 'org-too-big', 2)).rejects.toMatchObject({ status: 429, extra: { details: { quota: 'max_concurrent_sessions' } } });
    await h.t.owner.updateTable('quotas').set({ max_concurrent_sessions: 20 }).where('org_id', '=', h.orgs.quillmoor).execute();
  });

  it('the sweep prunes stale reservations even when nobody starts anything', async () => {
    await h.t.owner.insertInto('session_reservations').values({ org_id: h.orgs.quillmoor, session_name: 'stale', kind: 'lab', units: 1, user_id: Q.mei, expires_at: sql<Date>`now() - interval '1 minute'` }).execute();
    await ps.sweep();
    expect((await reservations()).some((r) => r.session_name === 'stale')).toBe(false);
  });

  it('concurrent exam starts (reserve by environment count, per-exam lock, create) neither hang a 2-connection pool nor pass the cap', async () => {
    const content = await examContent();
    const ec = new FakeExamCluster();
    const exams = new ExamService(await catalog(), content, ec, new StubExamCompiler(), new PgExamStore(db), new PgEvidenceSink(db, content), new PgTeamDirectory(db));
    exams.gate = ps;
    const candidates = [Q.amara, Q.jonah, Q.mei, Q.rhea, Q.lucas, Q.sofia];
    // Two starts per candidate, all at once: the retake check runs under the per-exam lock.
    const starts = candidates.flatMap((u) => [exams.start(p(u), EXAM), exams.start(p(u), EXAM)]);
    const res = await Promise.race([
      Promise.allSettled(starts),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('exam starts hung')), 25_000)),
    ]);
    const ok = res.filter((r) => r.status === 'fulfilled');
    // 5 lab sessions run; exams may use the reserve up to maxActive 7, each reserving its environments.
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.length).toBeLessThanOrEqual(2);
    const reasons = res.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    expect(reasons.filter((r) => !/capacity|already|running|cannot start|in progress/i.test(r))).toEqual([]);
    const rows = await h.t.owner.selectFrom('exam_attempts').select(['user_id']).execute();
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(rows.length);
    // Each started exam reserved its environment count.
    const def = (await catalog()).exams.get(EXAM)!.def;
    const units = def.environment === 'shared' ? 1 : def.taskCount;
    expect((await reservations()).filter((r) => r.kind === 'exam').every((r) => r.units === units)).toBe(true);
    // An attempt whose ExamSession fails gives its units back as soon as it is synced.
    const started = (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    const who = (await h.t.owner.selectFrom('exam_attempts').select('user_id').where('id', '=', started).executeTakeFirstOrThrow()).user_id;
    const es = ec.sessions.get(started)!;
    es.status = { ...(es.status ?? {}), phase: 'Failed' };
    // The sweep settles it without anyone looking at the attempt.
    expect(await exams.sweep()).toBeGreaterThanOrEqual(1);
    void who;
    expect((await reservations()).some((r) => r.session_name === started)).toBe(false);
  }, 60_000);

  it('an exam start without a capacity gate is refused', async () => {
    const content = await examContent();
    const exams = new ExamService(await catalog(), content, new FakeExamCluster(), new StubExamCompiler(), new PgExamStore(db), new PgEvidenceSink(db, content), new PgTeamDirectory(db));
    await expect(exams.start(p(Q.kenji), EXAM)).rejects.toMatchObject({ status: 503 });
  });
});
