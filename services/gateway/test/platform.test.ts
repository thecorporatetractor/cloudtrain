import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { requireDeclaredPermission } from '../src/app.js';
import { withTenant } from '../src/db/index.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();

describe.skipIf(!available)('platform API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);
  afterAll(async () => h?.close());

  it('refuses to register an /api route without a declared permission (so every built route has one)', () => {
    expect(() => requireDeclaredPermission({ url: '/api/undeclared', method: 'GET', config: {} })).toThrow(/declares no permission/);
    expect(() => requireDeclaredPermission({ url: '/api/x', method: 'GET', config: { permission: 'lab.run' } })).not.toThrow();
    expect(() => requireDeclaredPermission({ url: '/api/auth/login', method: 'GET', config: { public: true } })).not.toThrow();
    expect(h.app.printRoutes().length).toBeGreaterThan(0); // buildApp registered ~90 routes through the hook
  });

  it('persists attempts, check results, evidence and skill state on validate (evidence only on change)', async () => {
    const amara = as(h, Q.amara);
    const start = await amara.post('/api/labs/gateway-smoke/sessions');
    expect(start.statusCode).toBe(201);
    const id = start.json().id as string;
    h.cluster.markReady(id);
    let pass = false;
    h.cluster.onPatch = (s) => {
      const req = s.spec.validateRequest ?? 0;
      if (!req || s.status?.validation?.observedRequest === req) return;
      s.status!.validation = {
        observedRequest: req,
        phase: 'Complete',
        score: pass ? 100 : 50,
        completedAt: new Date().toISOString(),
        checks: [
          { id: 'note-written', passed: true, weight: '1', skills: ['linux.shell.redirection'] },
          { id: 'shell-used', passed: pass, weight: '2', skills: ['linux.shell.navigation'] },
        ],
      };
    };
    const lab = (await h.ps.content.labs.get('gateway-smoke'))!.lab;
    expect(lab.spec.checks.map((c) => c.id)).toEqual(['note-written', 'shell-used']);
    const v1 = await amara.post(`/api/sessions/${id}/validate`);
    expect(v1.json().grading.state).toBe('complete');
    const v2 = await amara.post(`/api/sessions/${id}/validate`); // same result: no new evidence
    expect(v2.statusCode).toBe(200);
    pass = true;
    await amara.post(`/api/sessions/${id}/validate`);
    const rows = await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, async (tx) => ({
      attempt: await tx.selectFrom('lab_attempts').selectAll().where('session_name', '=', id).executeTakeFirstOrThrow(),
      checks: await tx.selectFrom('check_results').select(['run', 'check_id', 'passed']).where('attempt_id', 'in', tx.selectFrom('lab_attempts').select('id').where('session_name', '=', id)).orderBy('run').execute(),
      evidence: await tx.selectFrom('skill_evidence').select(['skill_id', 'outcome']).where('attempt_id', 'in', tx.selectFrom('lab_attempts').select('id').where('session_name', '=', id)).execute(),
      state: await tx.selectFrom('learner_skill_state').selectAll().where('user_id', '=', Q.amara).where('skill_id', '=', 'linux.shell.navigation').executeTakeFirst(),
    }));
    expect(rows.attempt).toMatchObject({ validations: 3, score: 100, outcome: 'passed', user_id: Q.amara, org_id: h.orgs.quillmoor });
    expect(rows.checks).toHaveLength(6);
    // run 1: both checks; run 2: unchanged -> none; run 3: greeting-content flipped -> one
    expect(rows.evidence.map((e) => `${e.skill_id}:${e.outcome}`).sort()).toEqual(['linux.shell.navigation:0', 'linux.shell.navigation:1', 'linux.shell.redirection:1']);
    expect(rows.state!.evidence).toBe(2);
    const detail = (await amara.get(`/api/attempts/${rows.attempt.id}`)).json();
    expect(detail.history).toHaveLength(6);
    expect(detail.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
    // Ending the session closes the attempt.
    expect((await amara.del(`/api/sessions/${id}`)).statusCode).toBe(204);
    const ended = await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, (tx) => tx.selectFrom('lab_attempts').select(['ended_at', 'outcome']).where('session_name', '=', id).executeTakeFirstOrThrow());
    expect(ended.ended_at).not.toBeNull();
    expect(ended.outcome).toBe('passed');
    h.cluster.onPatch = undefined;
  });

  it('computes assignment status per learner (not started, in progress, completed, overdue)', async () => {
    const tomasz = as(h, Q.tomasz);
    const yard = (await tomasz.get('/api/teams')).json()[0];
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const r = await tomasz.post('/api/assignments', { targets: [{ kind: 'user', id: Q.lucas }], item: { kind: 'lab', id: 'gateway-smoke' }, dueAt: past });
    expect(r.statusCode).toBe(201);
    const aid = r.json().assignments[0].id;
    const statusOf = async () => (await as(h, Q.lucas).get('/api/assignments/mine')).json().find((a: { id: string }) => a.id === aid);
    expect((await statusOf()).status).toBe('overdue');
    const future = await tomasz.post('/api/assignments', { targets: [{ kind: 'user', id: Q.lucas }], item: { kind: 'lab', id: 'gateway-smoke' }, dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const fid = future.json().assignments[0].id;
    const st = async () => (await as(h, Q.lucas).get('/api/assignments/mine')).json().find((a: { id: string }) => a.id === fid).status;
    expect(await st()).toBe('not_started');
    const s = await as(h, Q.lucas).post('/api/labs/gateway-smoke/sessions');
    expect(await st()).toBe('in_progress');
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, (tx) => tx.updateTable('lab_attempts').set({ outcome: 'passed', score: 100, ended_at: new Date() }).where('session_name', '=', s.json().id).execute());
    expect(await st()).toBe('completed');
    expect((await statusOf()).status).toBe('completed'); // completing also clears overdue
    const detail = (await tomasz.get(`/api/assignments/${fid}`)).json();
    expect(detail.statuses).toEqual([expect.objectContaining({ user: expect.objectContaining({ id: Q.lucas }), status: 'completed', progress: 1 })]);
    const list = (await tomasz.get(`/api/assignments?team=${yard.id}`)).json();
    expect(list.items.every((a: { target: { id: string } }) => a.target.id === yard.id)).toBe(true);
    // A user outside the manager's teams cannot be targeted.
    expect((await tomasz.post('/api/assignments', { targets: [{ kind: 'user', id: Q.jonah }], item: { kind: 'lab', id: 'gateway-smoke' } })).statusCode).toBe(403);
    expect((await tomasz.del(`/api/assignments/${aid}`)).statusCode).toBe(204);
  });

  it('enforces quotas when starting a lab', async () => {
    const priya = as(h, Q.priya);
    expect((await priya.put('/api/admin/quotas', { maxConcurrentSessions: 1, maxSessionMinutes: 45 })).statusCode).toBe(200);
    expect((await priya.patch('/api/admin/settings', { settings: { defaultSessionMinutes: 90 } })).statusCode).toBe(200);
    for (const s of h.cluster.sessions.values()) h.cluster.sessions.delete(s.metadata.name);
    const first = await as(h, Q.sofia).post('/api/labs/gateway-smoke/sessions');
    expect(first.statusCode).toBe(201);
    expect(h.cluster.sessions.get(first.json().id)!.spec.ttl).toBe('45m'); // min(default 90, max 45)
    const second = await as(h, Q.mei).post('/api/labs/gateway-smoke/sessions');
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ code: 'quota_exceeded', details: { quota: 'max_concurrent_sessions', limit: 1, current: 1 } });
    // Another org's sessions do not count against this org.
    expect((await as(h, Q.priya).get('/api/admin/sessions')).json()).toHaveLength(1);
    await priya.put('/api/admin/quotas', { maxConcurrentSessions: 50, monthlyLabHours: 1 });
    const hours = await as(h, Q.mei).post('/api/labs/gateway-smoke/sessions');
    expect(hours.statusCode).toBe(429);
    expect(hours.json().details.quota).toBe('monthly_lab_hours');
    // Room for the seeded attempts on any day of the month (they add up to several hundred hours by month end).
    await priya.put('/api/admin/quotas', { maxConcurrentSessions: 20, monthlyLabHours: 5000, maxSessionMinutes: 120 });
    expect((await priya.put('/api/admin/quotas', { maxSessionMinutes: 1 })).statusCode).toBe(422);
  });

  it('filters the catalog by content visibility and refuses hidden labs', async () => {
    const priya = as(h, Q.priya);
    expect((await priya.put('/api/admin/content', { labs: [{ labId: 'etcd-snapshot-restore', enabled: false }], pinnedPaths: ['k8s-access-and-networking'] })).statusCode).toBe(200);
    const cat = (await as(h, Q.amara).get('/api/catalog')).json();
    expect(cat.labs.some((l: { id: string }) => l.id === 'etcd-snapshot-restore')).toBe(false);
    expect(cat.paths[0].id).toBe('k8s-access-and-networking');
    expect((await as(h, Q.amara).get('/api/labs/etcd-snapshot-restore')).statusCode).toBe(404);
    expect((await as(h, Q.amara).post('/api/labs/etcd-snapshot-restore/sessions')).statusCode).toBe(404);
    // Acme is unaffected.
    const acmeHannah = (await h.t.owner.selectFrom('users').select('id').where('email', '=', 'hannah.vogel@acme-freight.example').executeTakeFirstOrThrow()).id;
    expect((await as(h, acmeHannah).get('/api/labs/etcd-snapshot-restore')).statusCode).toBe(200);
    await priya.put('/api/admin/content', { packs: [{ packId: 'kubernetes', enabled: false }] });
    expect((await as(h, Q.amara).get('/api/catalog')).json().labs.filter((l: { domain: string }) => l.domain === 'kubernetes')).toHaveLength(0);
    await priya.put('/api/admin/content', { packs: [{ packId: 'kubernetes', enabled: true }], labs: [{ labId: 'etcd-snapshot-restore', enabled: true }], pinnedPaths: [] });
  });

  it('serves real home, skills and team dashboards from history, gated by scope', async () => {
    const home = (await as(h, Q.amara).get('/api/home')).json();
    expect(home.source).toBe('live');
    expect(home.recommendations.length).toBeGreaterThan(0);
    const tomasz = as(h, Q.tomasz);
    const yard = (await tomasz.get('/api/teams')).json()[0];
    const dash = (await tomasz.get(`/api/teams/${yard.id}/dashboard`)).json();
    expect(dash.members.map((m: { user: { id: string } }) => m.user.id)).toEqual(expect.arrayContaining([Q.amara, Q.sofia]));
    expect(Object.keys(dash.members[0].mastery).length).toBe(h.ps.content.competencies.length);
    expect((await tomasz.get(`/api/teams/${yard.id}/members/${Q.amara}`)).json().attempts.length).toBeGreaterThan(0);
    expect((await tomasz.get(`/api/skills?member=${Q.amara}`)).statusCode).toBe(200);
    expect((await tomasz.get(`/api/skills?member=${Q.jonah}`)).statusCode).toBe(403);
    const ines = as(h, Q.ines);
    expect((await ines.get(`/api/teams/${yard.id}/dashboard`)).statusCode).toBe(403);
    const csv = await tomasz.get(`/api/reports/progress.csv?team=${yard.id}`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\r\n')[0]).toBe('user_id,name,email,team,assignment_id,item_kind,item_id,due_at,status,progress,best_score,attempts,minutes,environment_minutes');
    // New learner with no history: empty-state home still renders.
    const mei = (await as(h, Q.mei).get('/api/home')).json();
    expect(mei.recommendations.length).toBeGreaterThan(0);
  });

  it('lets cohort instructors observe read-only, with an audit entry and a learner notice', async () => {
    for (const s of h.cluster.sessions.values()) h.cluster.sessions.delete(s.metadata.name);
    const start = await as(h, Q.amara).post('/api/labs/gateway-smoke/sessions');
    const id = start.json().id as string;
    h.cluster.sessions.get(id)!.metadata.creationTimestamp = new Date().toISOString();
    h.cluster.markReady(id);
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (h.app.server.address() as AddressInfo).port;
    const learnerFrames: unknown[] = [];
    const learner = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`, { headers: { 'x-test-user': Q.amara } });
    learner.on('message', (d, bin) => {
      if (!bin) learnerFrames.push(JSON.parse(d.toString()));
    });
    await new Promise((r) => learner.once('open', r));
    await new Promise((r) => setTimeout(r, 100));
    const exec = h.cluster.execs.at(-1)!;
    // Manager is not allowed to observe.
    const denied = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal?observe=1`, { headers: { 'x-test-user': Q.tomasz } });
    const deniedMsg = await new Promise<string>((r) => denied.once('message', (d) => r(d.toString())));
    expect(deniedMsg).toMatch(/may not observe/);
    // The cohort instructor may.
    const obs = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal?observe=1`, { headers: { 'x-test-user': Q.elena } });
    const got: Buffer[] = [];
    const ready = new Promise<string>((r) => obs.on('message', (d, bin) => (bin ? got.push(d as Buffer) : r(d.toString()))));
    expect(await ready).toMatch(/read-only/);
    exec.stdout.write(Buffer.from('learner$ kubectl get nodes\r\n'));
    obs.send(JSON.stringify({ t: 'i', d: 'rm -rf /\n' }));
    await new Promise((r) => setTimeout(r, 150));
    expect(Buffer.concat(got).toString()).toContain('kubectl get nodes');
    let typed = '';
    exec.stdin.on('data', (c: Buffer) => (typed += c.toString()));
    await new Promise((r) => setTimeout(r, 50));
    expect(typed).not.toContain('rm -rf');
    expect(learnerFrames).toContainEqual(expect.objectContaining({ t: 'notice', notice: expect.objectContaining({ kind: 'observed', active: true }) }));
    const sess = (await as(h, Q.amara).get(`/api/sessions/${id}`)).json();
    expect(sess.notices).toContainEqual(expect.objectContaining({ kind: 'observed', active: true }));
    const board = (await as(h, Q.elena).get(`/api/cohorts/${(await as(h, Q.elena).get('/api/cohorts')).json()[0].id}/board`)).json();
    expect(board.rows.find((r: { user: { id: string } }) => r.user.id === Q.amara).session.observedBy).toHaveLength(1);
    obs.close();
    learner.close();
    await new Promise((r) => setTimeout(r, 150));
    const audit = (await as(h, Q.priya).get('/api/admin/audit?action=session.observe')).json();
    expect(audit.items[0]).toMatchObject({ action: 'session.observe', targetId: id, actor: expect.objectContaining({ id: Q.elena }) });
    // Instructor controls: extend + reset patch the LabSession spec, terminate deletes it.
    const ext = await as(h, Q.elena).post(`/api/sessions/${id}/extend`, { minutes: 10 });
    expect(ext.statusCode).toBe(200);
    expect(h.cluster.sessions.get(id)!.spec.expiresAt).toBe(ext.json().expiresAt);
    expect((await as(h, Q.elena).post(`/api/sessions/${id}/reset`)).json().resetGeneration).toBe(1);
    expect((await as(h, Q.ines).post(`/api/sessions/${id}/terminate`)).statusCode).toBe(403);
    expect((await as(h, Q.elena).post(`/api/sessions/${id}/terminate`)).statusCode).toBe(200);
    expect(h.cluster.sessions.has(id)).toBe(false);
  });

  it('deactivation revokes sessions and terminates labs immediately; invitations email the invitee', async () => {
    const store = h.store;
    await store.create({ userId: Q.jonah, orgId: h.orgs.quillmoor, tokens: { access_token: 'x', expires_in: 300 } });
    const s = await as(h, Q.jonah).post('/api/labs/gateway-smoke/sessions');
    expect(s.statusCode, s.body).toBe(201);
    const r = await as(h, Q.priya).patch(`/api/admin/users/${Q.jonah}`, { status: 'deactivated' });
    expect(r.json()).toMatchObject({ user: { status: 'deactivated' }, revokedSessions: 1, terminatedLabs: 1 });
    expect((await as(h, Q.jonah).get('/api/me')).statusCode).toBe(401);
    expect((await as(h, Q.priya).patch(`/api/admin/users/${Q.priya}`, { status: 'deactivated' })).statusCode).toBe(409);
    await as(h, Q.priya).patch(`/api/admin/users/${Q.jonah}`, { status: 'active' });

    const inv = await as(h, Q.priya).post('/api/admin/users', { email: 'Rafael.Okoye@acme-freight.example', roles: ['learner'] });
    expect(inv.statusCode).toBe(201);
    expect(inv.json().user.id).toMatch(/^pending-/); // SSO domain of another org: claimed at first login
    const local = await as(h, Q.priya).post('/api/admin/users', { email: 'noor.haddad@quillmoor.example', name: 'Noor Haddad', roles: ['learner', 'manager'] });
    expect(local.json()).toMatchObject({ emailSent: true, user: { status: 'invited', roles: ['learner', 'manager'] } });
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: 'noor.haddad@quillmoor.example', subject: expect.stringMatching(/invited you to Quillmoor Logistics/) });
    expect(h.mailer.sent.at(-1)!.text).toMatch(/http:\/\/gw.test\/api\/auth\/invite\/[A-Za-z0-9_-]{20,}/);
    expect((await as(h, Q.priya).post('/api/admin/users', { email: 'amara.nwosu@quillmoor.example', roles: ['learner'] })).statusCode).toBe(409);
    expect((await as(h, Q.tomasz).post('/api/admin/users', { email: 'x@quillmoor.example', roles: ['learner'] })).statusCode).toBe(403);
  });

  it('isolates orgs over HTTP and limits platform routes to platform admins', async () => {
    const acmeTeam = (await h.t.owner.selectFrom('teams').select('id').where('org_id', '=', h.orgs.acme).executeTakeFirstOrThrow()).id;
    const priya = as(h, Q.priya);
    expect((await priya.get(`/api/teams/${acmeTeam}/dashboard`)).statusCode).toBe(404);
    expect((await priya.get(`/api/admin/teams/${acmeTeam}`)).statusCode).toBe(404);
    expect((await priya.post('/api/assignments', { targets: [{ kind: 'team', id: acmeTeam }], item: { kind: 'lab', id: 'two-container-pod' } })).statusCode).toBe(404);
    expect((await priya.get('/api/platform/orgs')).statusCode).toBe(403);
    const rhea = as(h, Q.rhea);
    const orgs = (await rhea.get('/api/platform/orgs')).json();
    expect(orgs.map((o: { slug: string }) => o.slug).sort()).toEqual(['acme-freight', 'quillmoor']);
    const created = await rhea.post('/api/platform/orgs', { slug: 'harbor-test', name: 'Harbor Test Co', domains: ['harbor-test.example'], quotas: { maxConcurrentSessions: 3 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ slug: 'harbor-test', quotas: { maxConcurrentSessions: 3 } });
    expect((await rhea.del(`/api/platform/orgs/${created.json().id}`)).statusCode).toBe(409);
    expect((await rhea.post(`/api/platform/orgs/${created.json().id}/suspend`)).json().status).toBe('suspended');
    expect((await rhea.del(`/api/platform/orgs/${created.json().id}`)).statusCode).toBe(204);
    const cap = (await rhea.get('/api/platform/capacity')).json();
    expect(cap.cluster.reachable).toBe(false);
  });

  it('writes an audit row for every mutating admin action, readable and exportable by org admins only', async () => {
    const priya = as(h, Q.priya);
    const team = await priya.post('/api/admin/teams', { name: 'Customs Desk' });
    expect(team.statusCode).toBe(201);
    await priya.post(`/api/admin/teams/${team.json().id}/members`, { userId: Q.mei, role: 'member' });
    await priya.patch(`/api/admin/teams/${team.json().id}`, { name: 'Customs Desk Ops' });
    await priya.del(`/api/admin/teams/${team.json().id}/members/${Q.mei}`);
    await priya.del(`/api/admin/teams/${team.json().id}`);
    const dom = await priya.post('/api/admin/sso/domains', { domain: 'quillmoor-tools.example' });
    expect(dom.json().verification.name).toBe('_cloudtrain-challenge.quillmoor-tools.example');
    expect((await priya.post('/api/admin/sso/domains/quillmoor-tools.example/verify')).json()).toMatchObject({ ok: true });
    expect((await priya.post('/api/admin/sso/domains', { domain: 'acme-freight.example' })).statusCode).toBe(409);
    const actions = (await priya.get('/api/admin/audit?limit=200')).json().items.map((e: { action: string }) => e.action);
    for (const a of ['team.create', 'team.member_add', 'team.update', 'team.member_remove', 'team.delete', 'domain.add', 'domain.verify', 'quota.update', 'settings.update', 'content.visibility', 'user.deactivate', 'user.invite', 'assignment.create', 'session.extend', 'session.reset', 'session.terminate', 'session.observe']) {
      expect(actions, a).toContain(a);
    }
    const page1 = (await priya.get('/api/admin/audit?limit=5')).json();
    const page2 = (await priya.get(`/api/admin/audit?limit=5&cursor=${page1.nextCursor}`)).json();
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
    const csv = await priya.get('/api/admin/audit.csv?action=team.');
    expect(csv.body.split('\r\n').filter(Boolean).length).toBe(6);
    expect((await as(h, Q.amara).get('/api/admin/audit')).statusCode).toBe(403);
    const usage = (await priya.get('/api/admin/usage')).json();
    expect(usage.sessions).toBeGreaterThan(0);
  });
});
