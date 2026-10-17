import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import * as m0004 from '../src/db/migrations/0004_learner_goals.js';
import { recordRun, startAttempt } from '../src/learner/learning.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();
const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe.skipIf(!available)('learner goals (migration 0004, /api/me/goals, Home)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 60_000);
  afterAll(async () => h?.close());

  it('migration 0004 is additive and idempotent: a second run changes nothing and keeps rows', async () => {
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, (tx) => tx.insertInto('learner_goals').values({ org_id: h.orgs.quillmoor, user_id: Q.kenji, target_date: isoDay(30), weekly_target_minutes: 90 }).execute());
    await m0004.up(h.t.owner as unknown as Kysely<unknown>, 'cloudtrain_app');
    await m0004.up(h.t.owner as unknown as Kysely<unknown>, 'cloudtrain_app');
    const rls = await sql<{ relrowsecurity: boolean }>`SELECT relrowsecurity FROM pg_class WHERE relname = 'learner_goals'`.execute(h.t.owner);
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const policies = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'learner_goals'`.execute(h.t.owner);
    expect(policies.rows[0]!.n).toBe(1);
    const kept = await h.t.owner.selectFrom('learner_goals').select('weekly_target_minutes').where('user_id', '=', Q.kenji).executeTakeFirst();
    expect(kept?.weekly_target_minutes).toBe(90);
  });

  it('keeps goals inside the org (RLS)', async () => {
    const own = await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, (tx) => tx.selectFrom('learner_goals').selectAll().execute());
    expect(own.length).toBeGreaterThan(0);
    const other = await withTenant(h.t.db, { orgId: h.orgs.acme }, (tx) => tx.selectFrom('learner_goals').selectAll().execute());
    expect(other).toEqual([]);
    await expect(withTenant(h.t.db, { orgId: h.orgs.acme }, (tx) => tx.insertInto('learner_goals').values({ org_id: h.orgs.quillmoor, user_id: Q.mei, target_date: null, weekly_target_minutes: 60 }).execute())).rejects.toThrow(/row-level security/);
  });

  it('GET answers nulls before anything is set; PUT sets, merges and clears', async () => {
    const mei = as(h, Q.mei);
    expect((await mei.get('/api/me/goals')).json()).toEqual({ targetDate: null, weeklyTargetMinutes: null, updatedAt: null });
    const date = isoDay(60);
    const set = await mei.put('/api/me/goals', { targetDate: date });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ targetDate: date, weeklyTargetMinutes: null });
    // Fields left out stay as they are.
    expect((await mei.put('/api/me/goals', { weeklyTargetMinutes: 120 })).json()).toMatchObject({ targetDate: date, weeklyTargetMinutes: 120 });
    expect((await mei.get('/api/me/goals')).json()).toMatchObject({ targetDate: date, weeklyTargetMinutes: 120 });
    // null clears one field.
    expect((await mei.put('/api/me/goals', { weeklyTargetMinutes: null })).json()).toMatchObject({ targetDate: date, weeklyTargetMinutes: null });
  });

  it('validates the exam date and weekly target', async () => {
    const lucas = as(h, Q.lucas);
    for (const body of [{ targetDate: '2026-02-30' }, { targetDate: 'soon' }, { targetDate: isoDay(-10) }, { targetDate: isoDay(5 * 366) }, { weeklyTargetMinutes: 2 }, { weeklyTargetMinutes: 30.5 }, { weeklyTargetMinutes: '60' }, { weeklyTargetMinutes: 99999 }]) {
      const r = await lucas.put('/api/me/goals', body);
      expect(r.statusCode, JSON.stringify(body)).toBe(422);
    }
    expect((await lucas.get('/api/me/goals')).json().updatedAt).toBeNull();
  });

  it('imports browser goals once: fills only unset fields and drops stale values', async () => {
    const sofia = as(h, Q.sofia);
    const date = isoDay(45);
    expect((await sofia.put('/api/me/goals', { weeklyTargetMinutes: 150 })).statusCode).toBe(200);
    // A weekly target already on the server is kept; the date is new and taken.
    const imported = (await sofia.put('/api/me/goals', { source: 'browser', targetDate: date, weeklyTargetMinutes: 60 })).json();
    expect(imported).toMatchObject({ targetDate: date, weeklyTargetMinutes: 150 });
    // A second import (another browser) never overwrites.
    expect((await sofia.put('/api/me/goals', { source: 'browser', targetDate: isoDay(90) })).json().targetDate).toBe(date);
    // A stale local date (already past) is dropped instead of failing the import.
    const jonah = as(h, Q.jonah);
    const r = await jonah.put('/api/me/goals', { source: 'browser', targetDate: isoDay(-30), weeklyTargetMinutes: 90 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ targetDate: null, weeklyTargetMinutes: 90 });
  });

  it('is per user: one learner never sees or changes another one', async () => {
    const before = (await as(h, Q.mei).get('/api/me/goals')).json();
    await as(h, Q.amara).put('/api/me/goals', { targetDate: isoDay(20), weeklyTargetMinutes: 300 });
    expect((await as(h, Q.mei).get('/api/me/goals')).json()).toEqual(before);
  });

  it('Home plans with the learner’s own date and weekly target', async () => {
    const date = isoDay(100);
    await as(h, Q.priya).put('/api/me/goals', { targetDate: date, weeklyTargetMinutes: 210 });
    const home = (await as(h, Q.priya).get('/api/home')).json();
    expect(home.goal).toMatchObject({ targetDate: date, targetDateSource: 'learner', weeklyTargetMinutes: 210 });
    // Cleared: back to the placeholder (or an assignment's due date).
    await as(h, Q.priya).put('/api/me/goals', { targetDate: null, weeklyTargetMinutes: null });
    const after = (await as(h, Q.priya).get('/api/home')).json();
    expect(after.goal.targetDateSource).not.toBe('learner');
    expect(after.goal.weeklyTargetMinutes).toBeUndefined();
  });
});

describe.skipIf(!available)('practice minutes: manager views count what the learner sees', () => {
  let h: Harness;
  let teamId: string;
  beforeAll(async () => {
    h = await harness();
    teamId = (await as(h, Q.tomasz).get('/api/teams')).json()[0].id;
    const lab = h.ps.content.labs.values().next().value!.lab;
    const now = Date.now();
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, async (tx) => {
      // Opened and left to expire: an hour of environment, no practice.
      await startAttempt(tx, { orgId: h.orgs.quillmoor, userId: Q.lucas, lab, sessionName: 'idle-lucas-1', startedAt: new Date(now - 90 * 60_000) });
      await tx.updateTable('lab_attempts').set({ ended_at: new Date(now - 30 * 60_000), duration_s: 3600, outcome: 'abandoned' }).where('session_name', '=', 'idle-lucas-1').execute();
      // Practised: Validate 12 minutes in, environment kept for 50 minutes.
      const started = new Date(now - 60 * 60_000);
      await startAttempt(tx, { orgId: h.orgs.quillmoor, userId: Q.lucas, lab, sessionName: 'graded-lucas-1', startedAt: started });
      const checks = lab.spec.checks.map((c: { id: string; skills: string[] }) => ({ id: c.id, passed: false, skills: [...c.skills] }));
      await recordRun(tx, { orgId: h.orgs.quillmoor, userId: Q.lucas, sessionName: 'graded-lucas-1', lab, score: 0, checks, hintsUsed: 0, at: new Date(started.getTime() + 12 * 60_000) });
      await tx.updateTable('lab_attempts').set({ ended_at: new Date(started.getTime() + 50 * 60_000), duration_s: 3000, outcome: 'abandoned' }).where('session_name', '=', 'graded-lucas-1').execute();
    });
  }, 60_000);
  afterAll(async () => h?.close());

  it('team dashboard and member page show the minutes of the learner’s own Home', async () => {
    const me = (await as(h, Q.lucas).get('/api/me')).json();
    const dash = (await as(h, Q.tomasz).get(`/api/teams/${teamId}/dashboard`)).json();
    const row = dash.members.find((m: { user: { id: string } }) => m.user.id === Q.lucas);
    const member = (await as(h, Q.tomasz).get(`/api/teams/${teamId}/members/${Q.lucas}`)).json();
    expect(me.minutesThisWeek).toBeGreaterThanOrEqual(12);
    expect(row.minutesThisWeek).toBe(me.minutesThisWeek);
    expect(member.minutesThisWeek).toBe(me.minutesThisWeek);
    expect(member.minutesThisMonth).toBe(row.minutesThisMonth);
    // The weekly series counts practice too: this week's bucket never exceeds the rolling-week practice of the team.
    const weekTotal = dash.members.reduce((a: number, m: { minutesThisWeek: number }) => a + m.minutesThisWeek, 0);
    expect(dash.minutesByWeek.at(-1).minutes).toBeLessThanOrEqual(weekTotal);
  });

  it('attempt lists carry practice time next to environment time', async () => {
    const page = (await as(h, Q.lucas).get('/api/attempts/mine?limit=5')).json();
    const idle = page.items.find((a: { sessionName: string }) => a.sessionName === 'idle-lucas-1');
    const graded = page.items.find((a: { sessionName: string }) => a.sessionName === 'graded-lucas-1');
    expect(idle).toMatchObject({ durationS: 3600, practiceS: 0 });
    expect(graded).toMatchObject({ durationS: 3000, practiceS: 720 });
    const detail = (await as(h, Q.tomasz).get(`/api/attempts/${graded.id}`)).json();
    expect(detail.practiceS).toBe(720);
  });

  it('progress CSV: minutes = practice, environment_minutes = session lifetime', async () => {
    const csv = (await as(h, Q.tomasz).get(`/api/reports/progress.csv?team=${teamId}`)).body.split('\r\n');
    const header = csv[0]!.split(',');
    const line = csv.find((l) => l.startsWith(Q.lucas))!.split(',');
    const minutes = Number(line[header.indexOf('minutes')]);
    const env = Number(line[header.indexOf('environment_minutes')]);
    // The idle hour and the 38 minutes after the last Validate are environment only.
    expect(env - minutes).toBeGreaterThanOrEqual(60 + 38);
  });

  it('quota accounting keeps raw session time', async () => {
    const usage = (await as(h, Q.priya).get('/api/admin/usage')).json();
    const rows = await h.t.owner.selectFrom('lab_attempts').select(['duration_s', 'started_at']).where('org_id', '=', h.orgs.quillmoor).where('started_at', '>=', new Date(usage.from)).execute();
    const raw = Math.round((rows.reduce((a, r) => a + r.duration_s, 0) / 3600) * 10) / 10;
    expect(usage.labHours).toBe(raw);
  });
});
