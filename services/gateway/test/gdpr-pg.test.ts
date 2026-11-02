import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '../src/auth.js';
import { withTenant } from '../src/db/index.js';
import { CASCADE_TABLES, PERSONAL_COLUMNS } from '../src/gdpr/erase.js';
import { PostgresLedger } from '../src/gdpr/ledger.js';
import { GdprService } from '../src/gdpr/service.js';
import { subjectKey } from '../src/gdpr/subject.js';
import { Sealer } from '../src/oidc/sessions.js';
import { StripeApi } from '../src/billing/stripe.js';
import { FakeStripe } from './fake-stripe.js';
import { as, FakeKeycloakUsers, harness, Q, TEST_GDPR_KEY, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';
import { MemoryMailer } from '../src/mail.js';

const available = await pgAvailable();

const NEW_ID = 'b2000000-0000-4000-8000-000000000001';
const EMAIL = 'Erin.Erased@Quillmoor.example';
const NAME = 'Erin Erased-Person';
const SECOND_ORG_NOTE = 'left-over-rows-in-an-org-she-left';

/** A label for test rows that does not contain the id: the erasure test scans every table for the id. */
const tag = (id: string) => id.slice(-6);

/** One person with a row in every table that can hold a person, across two orgs. */
async function seedPerson(h: Harness, id = NEW_ID, email = EMAIL, name = NAME) {
  const o = h.t.owner;
  const org = h.orgs.quillmoor;
  const other = h.orgs.acme;
  await o.insertInto('users').values({ id, email, name, title: 'Tester', avatar_url: 'http://x/a.png', platform_roles: [], last_login_at: new Date(), last_idp: 'local' } as never).execute();
  await o.insertInto('memberships').values({ org_id: org, user_id: id, roles: ['learner'], status: 'active', source: 'local' } as never).execute();
  const team = await o.selectFrom('teams').select('id').where('org_id', '=', org).limit(1).executeTakeFirstOrThrow();
  await o.insertInto('team_members').values({ org_id: org, team_id: team.id, user_id: id, role: 'member', source: 'manual' } as never).execute();
  const cohort = await o.insertInto('cohorts').values({ org_id: org, name: `C ${tag(id)}`, starts_at: new Date(), ends_at: new Date(Date.now() + 86_400_000), instructor_ids: [id], lab_ids: [] } as never).returning('id').executeTakeFirstOrThrow();
  await o.insertInto('cohort_members').values({ org_id: org, cohort_id: cohort.id, user_id: id } as never).execute();
  await o.insertInto('assignments').values({ org_id: org, target_kind: 'user', target_id: id, item_kind: 'lab', item_id: 'l', lab_ids: ['l'], assigned_by: id } as never).execute();
  await o.insertInto('invitations').values({ org_id: org, email: email.toUpperCase(), user_id: null, roles: ['learner'], teams: '[]', token_hash: `h-${tag(id)}`, expires_at: new Date(Date.now() + 3600_000) } as never).execute();
  // Rows in an org whose membership is long gone: a per-org loop would miss them.
  const attempt = await o.insertInto('lab_attempts').values({ org_id: other, user_id: id, lab_id: SECOND_ORG_NOTE, session_name: `s-${tag(id)}` } as never).returning('id').executeTakeFirstOrThrow();
  await o.insertInto('check_results').values({ org_id: other, attempt_id: attempt.id, check_id: 'c', run: 1, passed: true, skills: [] } as never).execute();
  await o.insertInto('skill_evidence').values({ org_id: other, user_id: id, skill_id: 's', attempt_id: attempt.id, check_id: 'c', outcome: 1, weight: 1, difficulty: 0.5 } as never).execute();
  await o.insertInto('learner_skill_state').values({ org_id: other, user_id: id, skill_id: 's', mu: 0.5, sigma: 0.1 } as never).execute();
  await o.insertInto('learner_goals').values({ org_id: org, user_id: id, weekly_target_minutes: 60 } as never).execute();
  await o.insertInto('session_notices').values({ org_id: org, user_id: id, kind: 'x', message: 'hello' } as never).execute();
  // She observed someone else: their notice names her.
  await o.insertInto('session_notices').values({ org_id: org, user_id: Q.lucas, kind: 'observed', message: `${name} is watching your terminal (read-only).`, from_id: id } as never).execute();
  const examId = `exam-${id.slice(0, 2)}${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  await o.insertInto('exam_attempts').values({ org_id: org, id: examId, user_id: id, exam_id: 'e', exam_title: 'E', number: 1, seed: 1, phase: 'completed', started_at: new Date(), duration_minutes: 10 } as never).execute();
  await o.insertInto('exam_task_results').values({ org_id: org, attempt_id: examId, task_index: 0, task_id: 't', objective: 'o', weight: 1, outcome: 'pass', score: 1, checks: '[]' } as never).execute();
  await o.insertInto('exam_retake_grants').values({ org_id: org, user_id: id, exam_id: 'e', granted_by: id } as never).execute();
  await o.insertInto('answer_submissions').values({ org_id: org, scope_key: `s:${id}`, user_id: id, session_name: 's', lab_id: 'l', check_id: 'c', answer: 'a', correct: false } as never).execute();
  await o.insertInto('answer_hint_reveals').values({ org_id: org, scope_key: `s:${id}`, check_id: 'c', hint_index: 0, user_id: id, session_name: 's', lab_id: 'l', cost: 1 } as never).execute();
  const ev = await o.insertInto('ctf_events').values({ org_id: org, title: `E ${tag(id)}`, lab_ids: ['l'], starts_at: new Date(), ends_at: new Date(Date.now() + 3600_000), mode: 'solo', scoring: 'static', created_by: id } as never).returning('id').executeTakeFirstOrThrow();
  await o.insertInto('ctf_event_participants').values({ org_id: org, event_id: ev.id, user_id: id } as never).execute();
  await o.insertInto('billing_seats').values({ org_id: org, user_id: id, assigned_by: id } as never).execute();
  await o.insertInto('billing_seats').values({ org_id: org, user_id: Q.lucas, assigned_by: id } as never).onConflict((c) => c.doNothing()).execute();
  await o.insertInto('billing_limits').values({ org_id: org, user_id: id, monthly_cap: 1, hard_stop: false, updated_by: id } as never).execute();
  await o.insertInto('billing_usage').values({ org_id: org, user_id: id, lab_id: 'l', session_name: `u-${tag(id)}`, compute_tier: 'pod', units_per_minute: 1, unit_price: 0, payer_key: '', billable: true, started_at: new Date(Date.now() - 7200_000), ended_at: new Date(Date.now() - 3600_000), minutes: 60, units: 60 } as never).execute();
  await o.insertInto('auth_sessions').values({ id_hash: `sess-${id}`, user_id: id, csrf: 'x', expires_at: new Date(Date.now() + 3600_000), ip: '203.0.113.9', user_agent: 'UA' } as never).execute();
  await o.insertInto('auth_login_states').values({ state: `st-${id}`, verifier: 'v', nonce: 'n', email: email.toLowerCase() } as never).execute();
  await o.insertInto('waitlist_entries').values({ email, organisation: 'Org', role: 'Engineer', consent_at: new Date() } as never).execute();
  // The audit log: her own actions, actions on her, and a refused login under the attempted address.
  await sql`INSERT INTO audit_log (org_id, actor_id, actor_name, action, target_type, target_id, target_label, ip, details) VALUES
    (${org}, ${id}, ${name}, 'auth.login', 'user', ${id}, ${email}, '203.0.113.9', '{"idp":"local"}'::jsonb),
    (${org}, ${Q.priya}, 'Priya', 'team.member_add', 'team', ${team.id}, 'Team', '198.51.100.1', ${JSON.stringify({ userId: id })}::jsonb),
    (${org}, ${Q.priya}, 'Priya', 'user.invite', 'user', ${id}, ${email}, '198.51.100.1', ${JSON.stringify({ email: email.toUpperCase() })}::jsonb),
    (${org}, ${Q.priya}, 'Priya', 'billing.seat_assign', 'user', ${id}, ${name}, '198.51.100.1', '{}'::jsonb),
    (${org}, NULL, ${email.toLowerCase()}, 'auth.login_denied', 'user', ${id}, ${email.toLowerCase()}, '203.0.113.77', '{"reason":"no_membership"}'::jsonb)`.execute(o);
}

const principal = (over: Partial<Principal> = {}): Principal => ({ sub: NEW_ID, name: NAME, email: EMAIL, orgId: '', orgName: '', orgSlug: '', team: '', roles: ['learner'], teams: [], managedTeamIds: [], instructedCohortIds: [], cohortIds: [], platformAdmin: false, ...over });

/** Every row of every table as text: a person who is gone is not in any of them. */
async function scanFor(h: Harness, needle: string, skip: string[] = []): Promise<string[]> {
  const tables = await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'kysely%'`.execute(h.t.owner);
  const found: string[] = [];
  for (const { table_name } of tables.rows) {
    if (skip.includes(table_name)) continue;
    const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.id(table_name)} t WHERE t::text ILIKE ${`%${needle}%`}`.execute(h.t.owner);
    if (r.rows[0]!.n > 0) found.push(table_name);
  }
  return found;
}

const tokenFrom = (h: Harness) => {
  const m = /#token=([^\s]+)/.exec(h.mailer.sent[h.mailer.sent.length - 1]!.text);
  return decodeURIComponent(m![1]!);
};

describe.skipIf(!available)('GDPR rights in Postgres', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness({ privacyPerHour: 1000 });
  });
  afterAll(async () => h?.close());

  const ask = (payload: object) => h.app.inject({ method: 'POST', url: '/api/public/privacy/requests', payload, headers: { 'x-forwarded-for': '198.51.100.200' } });
  const confirm = (token: unknown) => h.app.inject({ method: 'POST', url: '/api/public/privacy/confirm', payload: { token } });
  const join = (email: string) => h.app.inject({ method: 'POST', url: '/api/public/waitlist', payload: { email, consent: true, organisation: 'Org' } });

  describe('the schema', () => {
    it('every column that can name a person is in the data map', async () => {
      const cols = await sql<{ table_name: string; column_name: string }>`
        SELECT table_name, column_name FROM information_schema.columns c
        WHERE table_schema = 'public'
          AND (column_name IN ('user_id', 'email', 'name', 'actor_id', 'actor_name', 'ip', 'user_agent', 'from_id', 'payer_key') OR column_name LIKE '%\_by' OR column_name LIKE '%\_email')
          AND table_name NOT LIKE 'kysely%'
          AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`.execute(h.t.owner);
      // Names of things, not of people; and the Stripe-reported webhook row that holds no name.
      const notPeople = new Set(['orgs.name', 'teams.name', 'cohorts.name', 'ctf_event_teams.name']);
      const unmapped = cols.rows.map((c) => `${c.table_name}.${c.column_name}`).filter((k) => !notPeople.has(k)).filter((k) => {
        const [t, c] = k.split('.') as [string, string];
        return !PERSONAL_COLUMNS[t]?.includes(c);
      });
      expect(unmapped).toEqual([]);
    });

    it('every foreign key to users that cascades is counted by the erasure', async () => {
      const r = await sql<{ table_name: string; delete_rule: string }>`
        SELECT tc.table_name, rc.delete_rule FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc USING (constraint_name, constraint_schema)
        JOIN information_schema.constraint_column_usage u ON u.constraint_name = rc.unique_constraint_name AND u.constraint_schema = rc.unique_constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND u.table_name = 'users'`.execute(h.t.owner);
      const cascading = r.rows.filter((x) => x.delete_rule === 'CASCADE').map((x) => x.table_name);
      for (const t of cascading) expect(Object.keys(CASCADE_TABLES)).toContain(t);
      expect(r.rows.filter((x) => x.table_name === 'billing_usage').map((x) => x.delete_rule)).toEqual(['SET NULL']);
    });

    it('the app role cannot rewrite the ledger or the audit log; only platform paths read the ledger', async () => {
      await h.ledger.append({ requestId: '00000000-0000-4000-8000-0000000000aa', type: 'export', scope: 'waitlist', subjectKey: subjectKey('x@y.io', TEST_GDPR_KEY), dataCategories: [], outcomes: [], requestedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), completedAt: new Date().toISOString(), actor: 'self' });
      await withTenant(h.t.db, { platform: true }, async (tx) => {
        await expect(sql`UPDATE gdpr_ledger SET type = 'export'`.execute(tx)).rejects.toThrow(/permission denied/);
      });
      await withTenant(h.t.db, { platform: true }, async (tx) => {
        await expect(sql`DELETE FROM gdpr_ledger`.execute(tx)).rejects.toThrow(/permission denied/);
      });
      await withTenant(h.t.db, { platform: true }, async (tx) => {
        await expect(sql`DELETE FROM audit_log`.execute(tx)).rejects.toThrow(/permission denied/);
      });
      await withTenant(h.t.db, { orgId: h.orgs.quillmoor, userId: Q.priya }, async (tx) => {
        expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM gdpr_ledger`.execute(tx)).rows[0]!.n).toBe(0);
        expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM gdpr_requests`.execute(tx)).rows[0]!.n).toBe(0);
      });
      await withTenant(h.t.db, { orgId: h.orgs.quillmoor, userId: Q.priya }, async (tx) => {
        await expect(sql`SELECT gdpr_scrub_audit_log('x', 'x@y.io', 'x', '{}'::text[])`.execute(tx)).rejects.toThrow(/platform code path/);
      });
      await withTenant(h.t.db, { orgId: h.orgs.quillmoor, userId: Q.priya }, async (tx) => {
        await expect(sql`SELECT sys_prune_audit_log(now() - interval '1 year', 10)`.execute(tx)).rejects.toThrow(/platform code path/);
      });
      // A tenant-scoped request cannot delete a user row either: RLS leaves it in place.
      await withTenant(h.t.db, { orgId: h.orgs.quillmoor, userId: Q.priya }, (tx) => sql`DELETE FROM users WHERE id = ${Q.lucas}`.execute(tx));
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', Q.lucas).executeTakeFirst()).toBeTruthy();
    });

    it('the owner is stopped by the append-only trigger; turning it off to tamper is detected by verifyChain', async () => {
      await expect(sql`UPDATE gdpr_ledger SET record = '{}'`.execute(h.t.owner)).rejects.toThrow(/append-only/);
      await expect(sql`DELETE FROM gdpr_ledger`.execute(h.t.owner)).rejects.toThrow(/append-only/);
      await expect(sql`TRUNCATE gdpr_ledger`.execute(h.t.owner)).rejects.toThrow(/append-only/);
      expect((await h.ledger.verifyChain()).ok).toBe(true);
      const first = await h.t.owner.selectFrom('gdpr_ledger').select(['seq', 'record']).orderBy('seq').limit(1).executeTakeFirstOrThrow();
      await sql`ALTER TABLE gdpr_ledger DISABLE TRIGGER gdpr_ledger_no_change`.execute(h.t.owner);
      await sql`UPDATE gdpr_ledger SET record = replace(record, '"actor":"self"', '"actor":"admin"') WHERE seq = ${first.seq}`.execute(h.t.owner);
      const r = await h.ledger.verifyChain();
      expect(r.ok).toBe(false);
      expect(r.problems).toContainEqual({ seq: Number(first.seq), kind: 'hash_mismatch' });
      // Undo, so the rest of the suite works on a whole chain.
      await sql`UPDATE gdpr_ledger SET record = ${first.record} WHERE seq = ${first.seq}`.execute(h.t.owner);
      await sql`ALTER TABLE gdpr_ledger ENABLE TRIGGER gdpr_ledger_no_change`.execute(h.t.owner);
      expect((await h.ledger.verifyChain()).ok).toBe(true);
    });
  });

  describe('public requests', () => {
    beforeEach(() => {
      h.mailer.sent = [];
    });

    const waitlisted = (email: string) => sql<{ n: number }>`SELECT count(*)::int AS n FROM waitlist_entries WHERE lower(email) = lower(${email})`.execute(h.t.owner).then((r) => r.rows[0]!.n);

    it('answers the same, byte for byte, for a known and an unknown address, and mails both', async () => {
      await join('known@example.org');
      const known = await ask({ email: 'known@example.org', type: 'erasure' });
      const unknown = await ask({ email: 'nobody@example.org', type: 'erasure' });
      expect(known.statusCode).toBe(202);
      expect(unknown.statusCode).toBe(202);
      expect(known.body).toBe(unknown.body);
      expect(known.headers['cache-control']).toBe('no-store');
      await h.gdpr.settled();
      expect(h.mailer.sent.map((m) => m.to).sort()).toEqual(['known@example.org', 'nobody@example.org']);
      expect(h.mailer.sent[0]!.text).not.toMatch(/waitlist entry was found|no entry/i);
    });

    it('a failing mailer does not change the answer', async () => {
      const orig = h.mailer.send;
      h.mailer.send = async () => {
        throw new Error('smtp down');
      };
      const r = await ask({ email: 'mailfail@example.org', type: 'erasure' });
      expect(r.statusCode).toBe(202);
      await h.gdpr.settled();
      h.mailer.send = orig;
    });

    it('the honeypot gets the same answer and nothing happens', async () => {
      const before = (await h.t.owner.selectFrom('gdpr_requests').select('id').execute()).length;
      const r = await ask({ email: 'bot@example.org', type: 'erasure', website: 'http://spam' });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe('accepted');
      await h.gdpr.settled();
      expect(h.mailer.sent).toHaveLength(0);
      expect((await h.t.owner.selectFrom('gdpr_requests').select('id').execute()).length).toBe(before);
    });

    it('validates like the waitlist: bad input is a 422 with fields, about the input and not the address', async () => {
      const r = await ask({ email: 'not-an-email', type: 'nonsense' });
      expect(r.statusCode).toBe(422);
      expect(r.json().details.fields).toEqual({ email: 'Enter a valid email address', type: 'Choose what you would like us to do' });
    });

    it('stores only a hash of the token and a sealed address, never the plain ones', async () => {
      await ask({ email: 'hashme@example.org', type: 'erasure' });
      await h.gdpr.settled();
      const token = tokenFrom(h);
      const row = await h.t.owner.selectFrom('gdpr_requests').selectAll().where('subject_key', '=', subjectKey('hashme@example.org', TEST_GDPR_KEY)).executeTakeFirstOrThrow();
      expect(JSON.stringify(row)).not.toContain('hashme@example.org');
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the link does nothing until confirmed by POST; confirming erases and writes evidence without the address', async () => {
      await join('Grace@Example.org');
      await ask({ email: 'grace@example.org', type: 'erasure' });
      await h.gdpr.settled();
      const token = tokenFrom(h);
      expect(h.mailer.sent.at(-1)!.text).toContain('http://web.test/legal/privacy-request#token=');
      expect(await waitlisted('grace@example.org')).toBe(1); // A mail scanner fetching the link would not get this far.
      const r = await confirm(token);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'completed', type: 'erasure', removed: 1 });
      expect(await waitlisted('grace@example.org')).toBe(0);
      const entries = await h.ledger.entries();
      const e = entries.find((x) => x.subjectKey === subjectKey('grace@example.org', TEST_GDPR_KEY))!;
      expect(e).toMatchObject({ type: 'erasure', actor: 'self', scope: 'waitlist' });
      expect(e.outcomes).toContainEqual({ system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 });
      const raw = JSON.stringify(entries);
      expect(raw.toLowerCase()).not.toContain('grace');
      expect(raw).not.toContain('@');
      const dbRaw = JSON.stringify(await h.t.owner.selectFrom('gdpr_ledger').selectAll().execute());
      expect(dbRaw).not.toContain('@');
      expect(e.requestedAt <= e.verifiedAt && e.verifiedAt <= e.completedAt).toBe(true);
      const row = await h.t.owner.selectFrom('gdpr_requests').selectAll().where('id', '=', e.requestId).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: 'completed', email_sealed: null, token_hash: null });
    });

    it('a link works once, also when clicked twice at the same moment', async () => {
      await join('twice@example.org');
      await ask({ email: 'twice@example.org', type: 'erasure' });
      await h.gdpr.settled();
      const token = tokenFrom(h);
      const [a, b] = await Promise.all([confirm(token), confirm(token)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 410]);
      expect((await confirm(token)).statusCode).toBe(410);
    });

    it('one answer for a forged, an altered and an expired link', async () => {
      const expired = await harness({ gdpr: { tokenTtlMs: -1000 } });
      try {
        await expired.app.inject({ method: 'POST', url: '/api/public/privacy/requests', payload: { email: 'late@example.org', type: 'erasure' } });
        await expired.gdpr.settled();
        const old = decodeURIComponent(/#token=([^\s]+)/.exec(expired.mailer.sent.at(-1)!.text)![1]!);
        const late = await expired.app.inject({ method: 'POST', url: '/api/public/privacy/confirm', payload: { token: old } });
        const forged = await confirm('v1.00000000-0000-4000-8000-000000000000.99999999999999.abc.def');
        const nothing = await confirm(undefined);
        expect(late.statusCode).toBe(410);
        expect(forged.statusCode).toBe(410);
        expect(nothing.statusCode).toBe(410);
        expect(late.body).toBe(forged.body);
        expect(nothing.body).toBe(forged.body);
      } finally {
        await expired.close();
      }
    });

    it('withdrawal removes the entry and is recorded as a withdrawal', async () => {
      await join('withdraw@example.org');
      await ask({ email: 'withdraw@example.org', type: 'withdrawal' });
      await h.gdpr.settled();
      expect((await confirm(tokenFrom(h))).json()).toMatchObject({ status: 'completed', type: 'withdrawal', removed: 1 });
      expect(await waitlisted('withdraw@example.org')).toBe(0);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey('withdraw@example.org', TEST_GDPR_KEY))!;
      expect(e.type).toBe('withdrawal');
    });

    it('a copy of the data goes only to the mailbox, with evidence, and removes nothing', async () => {
      await join('copy@example.org');
      await ask({ email: 'copy@example.org', type: 'export' });
      await h.gdpr.settled();
      const r = await confirm(tokenFrom(h));
      expect(r.json()).toMatchObject({ status: 'completed', type: 'export', data: { waitlist: [{ email: 'copy@example.org', organisation: 'Org' }] } });
      expect(await waitlisted('copy@example.org')).toBe(1);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey('copy@example.org', TEST_GDPR_KEY))!;
      expect(e.type).toBe('export');
      expect(JSON.stringify(e)).not.toContain('@');
    });

    it('an address with nothing held still gets a truthful record, and the mailbox holder learns it', async () => {
      await ask({ email: 'empty@example.org', type: 'erasure' });
      await h.gdpr.settled();
      expect((await confirm(tokenFrom(h))).json()).toMatchObject({ status: 'completed', removed: 0 });
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey('empty@example.org', TEST_GDPR_KEY))!;
      expect(e.outcomes[0]).toMatchObject({ action: 'none', rows: 0 });
    });

    it('erasing an address without an account clears the refused login from the audit log', async () => {
      const addr = 'refused.person@example.org';
      await sql`INSERT INTO audit_log (org_id, actor_name, action, target_type, target_id, target_label, ip, details) VALUES (${h.orgs.quillmoor}, ${addr}, 'auth.login_denied', 'user', 'kc-sub-refused', ${addr}, '203.0.113.50', '{"reason":"no_membership"}'::jsonb)`.execute(h.t.owner);
      await ask({ email: addr, type: 'erasure' });
      await h.gdpr.settled();
      expect((await confirm(tokenFrom(h))).statusCode).toBe(200);
      const row = await h.t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'auth.login_denied').where('target_id', '=', '[erased]').orderBy('id', 'desc').limit(1).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ actor_name: '[erased]', target_label: '[erased]', ip: null });
      expect(await scanFor(h, addr)).toEqual([]);
    });

    it('a waitlist erasure leaves the account of the same address alone', async () => {
      await seedPerson(h, 'b2000000-0000-4000-8000-0000000000ff', 'both@example.org', 'Both Ways');
      await ask({ email: 'both@example.org', type: 'erasure' });
      await h.gdpr.settled();
      expect((await confirm(tokenFrom(h))).json()).toMatchObject({ removed: 1 });
      expect(await h.t.owner.selectFrom('users').select('id').where('email', '=', 'both@example.org').executeTakeFirst()).toBeTruthy();
      expect(await h.t.owner.selectFrom('audit_log').select('id').where('target_label', '=', 'both@example.org').executeTakeFirst()).toBeTruthy();
    });

    it('limits how often one address can be mailed, silently', async () => {
      for (let i = 0; i < 5; i++) expect((await ask({ email: 'bombed@example.org', type: 'erasure' })).statusCode).toBe(202);
      await h.gdpr.settled();
      expect(h.mailer.sent.filter((m) => m.to === 'bombed@example.org')).toHaveLength(3);
    });

    it('rate limits per client address, like the waitlist route', async () => {
      const low = await harness({ privacyPerHour: 2 });
      try {
        const go = () => low.app.inject({ method: 'POST', url: '/api/public/privacy/requests', payload: { email: 'r@example.org', type: 'erasure' } });
        await go();
        await go();
        const third = await go();
        expect(third.statusCode).toBe(429);
        expect(third.json().code).toBe('rate_limited');
      } finally {
        await low.gdpr.settled();
        await low.close();
      }
    });
  });

  describe('when the ledger is down', () => {
    it('public erasure: not reported done; the sweep finishes it, records it and mails the result', async () => {
      await join('outage@example.org');
      await ask({ email: 'outage@example.org', type: 'erasure' });
      await h.gdpr.settled();
      const token = tokenFrom(h);
      h.ledger.failNext = 1;
      const r = await confirm(token);
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe('pending');
      expect(JSON.stringify(r.json())).not.toMatch(/deleted|erased|removed/i);
      const key = subjectKey('outage@example.org', TEST_GDPR_KEY);
      expect((await h.ledger.entries()).some((e) => e.subjectKey === key)).toBe(false);
      const row = await h.t.owner.selectFrom('gdpr_requests').selectAll().where('subject_key', '=', key).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: 'evidence_pending', last_error: 'ledger_unavailable' });
      expect(row.email_sealed).toBeTruthy();
      expect((await confirm(token)).statusCode).toBe(410);

      h.ledger.failNext = 1; // Still down at the first sweep.
      expect((await h.gdpr.sweep()).pending).toBeGreaterThan(0);
      expect((await h.ledger.entries()).some((e) => e.subjectKey === key)).toBe(false);

      h.mailer.sent = [];
      expect((await h.gdpr.sweep()).completed).toBeGreaterThan(0);
      await h.gdpr.settled();
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === key)!;
      // The rows counted before the outage are the ones in the record.
      expect(e.outcomes).toContainEqual({ system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 });
      expect(h.mailer.sent.map((m) => [m.to, m.subject])).toContainEqual(['outage@example.org', 'Your CloudTrain privacy request is complete']);
      expect(await h.t.owner.selectFrom('gdpr_requests').select(['status', 'email_sealed']).where('subject_key', '=', key).executeTakeFirst()).toEqual({ status: 'completed', email_sealed: null });
    });

    it('public export: no evidence, no data; the same link works once the ledger is back', async () => {
      await join('copyoutage@example.org');
      await ask({ email: 'copyoutage@example.org', type: 'export' });
      await h.gdpr.settled();
      const token = tokenFrom(h);
      h.ledger.failNext = 1;
      const r = await confirm(token);
      expect(r.statusCode).toBe(503);
      expect(r.body).not.toContain('copyoutage');
      const again = await confirm(token);
      expect(again.statusCode).toBe(200);
      expect(again.json().data.waitlist).toHaveLength(1);
      expect((await confirm(token)).statusCode).toBe(410);
    });

    it('signed-in download: no evidence, no data', async () => {
      h.ledger.failNext = 1;
      const r = await as(h, Q.lucas).post('/api/me/privacy/export');
      expect(r.statusCode).toBe(503);
      expect(r.json().code).toBe('upstream');
      expect(r.body).not.toContain('lab_attempts');
    });
  });

  describe('signed in: download, withdraw', () => {
    it('downloads the caller\'s data only, across orgs, without tokens, and records the export', async () => {
      const r = await as(h, Q.tomasz).post('/api/me/privacy/export');
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-disposition']).toContain('attachment');
      const data = r.json();
      const tomasz = await h.t.owner.selectFrom('users').selectAll().where('id', '=', Q.tomasz).executeTakeFirstOrThrow();
      expect(data.profile).toMatchObject({ id: Q.tomasz, email: tomasz.email });
      const others = await h.t.owner.selectFrom('users').select(['id', 'email']).where('id', '<>', Q.tomasz).execute();
      for (const o of others) {
        expect(r.body).not.toContain(o.email);
      }
      for (const a of data.sections.labAttempts) expect(a.user_id).toBe(Q.tomasz);
      expect(r.body).not.toMatch(/refresh_token|id_token|csrf|token_hash/);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey(tomasz.email, TEST_GDPR_KEY) && x.type === 'export')!;
      expect(e).toMatchObject({ scope: 'account', actor: 'self' });
      expect(JSON.stringify(e)).not.toContain('@');
    });

    it('needs a session, and a CSRF-protected method', async () => {
      expect((await h.app.inject({ method: 'POST', url: '/api/me/privacy/export' })).statusCode).toBe(401);
      expect((await h.app.inject({ method: 'POST', url: '/api/me/privacy/delete', payload: { confirmEmail: 'x@y.io' } })).statusCode).toBe(401);
      expect((await h.app.inject({ method: 'GET', url: '/api/me/privacy/export', headers: { 'x-test-user': Q.lucas } })).statusCode).toBe(404);
    });

    it('withdraws consent: the caller\'s own entry and no one else\'s', async () => {
      const mine = await h.t.owner.selectFrom('users').select('email').where('id', '=', Q.mei).executeTakeFirstOrThrow();
      await join(mine.email);
      await join('bystander@example.org');
      expect((await (await as(h, Q.mei).get('/api/me/privacy')).json()).waitlistEntry).toBe(true);
      const r = await as(h, Q.mei).post('/api/me/privacy/withdraw');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ status: 'completed', removed: 1 });
      expect((await (await as(h, Q.mei).get('/api/me/privacy')).json()).waitlistEntry).toBe(false);
      expect(await h.t.owner.selectFrom('waitlist_entries').select('id').where('email', '=', 'bystander@example.org').executeTakeFirst()).toBeTruthy();
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', Q.mei).executeTakeFirst()).toBeTruthy();
    });

    it('a support session cannot download, withdraw or delete in someone\'s name', async () => {
      const imp = principal({ sub: Q.lucas, session: { idHash: 'x', csrf: 'x', expiresAt: '', method: 'dev-impersonation', impersonated: true } });
      await expect(h.gdpr.exportAccount(imp)).rejects.toMatchObject({ status: 403 });
      await expect(h.gdpr.withdrawConsent(imp)).rejects.toMatchObject({ status: 403 });
      await expect(h.gdpr.deleteAccount(imp, imp.email)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('delete my account', () => {
    it('demands the typed address', async () => {
      const r = await as(h, Q.lucas).post('/api/me/privacy/delete', { confirmEmail: 'wrong@example.org' });
      expect(r.statusCode).toBe(422);
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', Q.lucas).executeTakeFirst()).toBeTruthy();
    });

    it('removes the person from every table, across orgs, and writes evidence without the address', async () => {
      await seedPerson(h);
      const session = { apiVersion: 'x', kind: 'LabSession', metadata: { name: 'lab-erin', labels: { 'cloudtrain.dev/learner': NEW_ID, 'app.kubernetes.io/managed-by': 'cloudtrain-gateway' } }, spec: { learner: { id: NEW_ID, org: h.orgs.quillmoor } } };
      h.cluster.sessions.set('lab-erin', session as never);
      const other = await h.t.owner.selectFrom('lab_attempts').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', Q.lucas).executeTakeFirstOrThrow();

      const r = await as(h, NEW_ID, h.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: EMAIL.toLowerCase() });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'completed' });
      expect(r.json().retained.map((x: { category: string }) => x.category)).toContain('invoices');

      // Every table, as text: no id, no address, no name.
      expect(await scanFor(h, EMAIL)).toEqual([]);
      expect(await scanFor(h, NAME)).toEqual([]);
      expect(await scanFor(h, NEW_ID)).toEqual([]);
      expect(h.cluster.sessions.has('lab-erin')).toBe(false);
      expect(h.kc.deleted).toContain(NEW_ID);
      expect(h.kc.loggedOut).toContain(NEW_ID);

      // Nobody else lost anything.
      const after = await h.t.owner.selectFrom('lab_attempts').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', Q.lucas).executeTakeFirstOrThrow();
      expect(after.n).toBe(other.n);
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', Q.priya).executeTakeFirst()).toBeTruthy();

      // The audit rows stay, anonymised, and the log gained a mark.
      const denied = await h.t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'auth.login_denied').where('ip', 'is', null).where('target_id', '=', '[erased]').executeTakeFirst();
      expect(denied).toMatchObject({ actor_name: '[erased]', target_label: '[erased]', ip: null });
      const login = await h.t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'auth.login').where('actor_name', '=', '[erased]').executeTakeFirst();
      expect(login).toMatchObject({ actor_id: null, ip: null, target_id: '[erased]', target_label: '[erased]' });
      expect(await h.t.owner.selectFrom('audit_log').select('id').where('action', '=', 'billing.seat_assign').where('target_label', '=', '[erased]').executeTakeFirst()).toBeTruthy();
      expect(await h.t.owner.selectFrom('audit_log').select('id').where('action', '=', 'gdpr.erasure').executeTakeFirst()).toBeTruthy();
      // Someone else's IP in the row about her is not hers to erase.
      const invite = await h.t.owner.selectFrom('audit_log').selectAll().where('action', '=', 'user.invite').where('actor_id', '=', Q.priya).where('target_id', '=', '[erased]').executeTakeFirst();
      expect(invite).toMatchObject({ ip: '198.51.100.1', actor_name: 'Priya' });

      // Her usage stays on the org's bill, under no name.
      const usage = await h.t.owner.selectFrom('billing_usage').selectAll().where('session_name', '=', `u-${tag(NEW_ID)}`).executeTakeFirstOrThrow();
      expect(usage).toMatchObject({ user_id: null, payer_key: '', units: 60 });
      const notice = await h.t.owner.selectFrom('session_notices').selectAll().where('user_id', '=', Q.lucas).where('kind', '=', 'observed').where('message', 'like', 'A staff member%').executeTakeFirst();
      expect(notice).toMatchObject({ from_id: null });

      const key = subjectKey(EMAIL, TEST_GDPR_KEY);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === key && x.scope === 'account' && x.type === 'erasure')!;
      expect(e).toMatchObject({ actor: 'self' });
      const serialised = JSON.stringify(e);
      expect(serialised).not.toContain('@');
      expect(serialised.toLowerCase()).not.toContain(EMAIL.toLowerCase());
      expect(serialised).not.toContain(NEW_ID);
      expect(serialised).not.toContain(NAME);
      const of = (s: string) => e.outcomes.find((o) => o.system === s);
      for (const t of Object.keys(CASCADE_TABLES)) expect(of(`postgres.${t}`)).toBeTruthy();
      expect(of('postgres.users')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('postgres.memberships')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('postgres.lab_attempts')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('postgres.check_results')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('postgres.exam_task_results')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('postgres.billing_usage')).toMatchObject({ action: 'anonymised', rows: 1 });
      expect(of('postgres.audit_log')?.rows).toBe(5);
      expect(of('postgres.audit_log')?.legalBasis).toBeTruthy();
      expect(of('keycloak')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('cluster.lab_sessions')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('waitlist')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(of('backups')).toMatchObject({ action: 'expires' });
      expect((await h.ledger.verifyChain()).ok).toBe(true);

      // She is signed out: the next request has no one behind it.
      expect((await as(h, NEW_ID).get('/api/me/privacy')).statusCode).toBe(401);
    });

    it('never touches a colleague with a similar name or address', async () => {
      const id = 'b2000000-0000-4000-8000-000000000002';
      await seedPerson(h, id, 'jo@example.org', 'Jo');
      await h.t.owner.insertInto('users').values({ id: 'b2000000-0000-4000-8000-000000000003', email: 'jo.bloggs@example.org', name: 'Jo Bloggs' } as never).execute();
      await sql`INSERT INTO audit_log (org_id, actor_id, actor_name, action, target_type, target_id, target_label, ip, details) VALUES (${h.orgs.quillmoor}, 'b2000000-0000-4000-8000-000000000003', 'Jo Bloggs', 'auth.login', 'user', 'b2000000-0000-4000-8000-000000000003', 'jo.bloggs@example.org', '192.0.2.3', '{"note":"jo.bloggs@example.org"}'::jsonb)`.execute(h.t.owner);
      expect((await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'jo@example.org' })).statusCode).toBe(200);
      const row = await h.t.owner.selectFrom('audit_log').selectAll().where('actor_id', '=', 'b2000000-0000-4000-8000-000000000003').executeTakeFirstOrThrow();
      expect(row).toMatchObject({ actor_name: 'Jo Bloggs', target_label: 'jo.bloggs@example.org', ip: '192.0.2.3', details: { note: 'jo.bloggs@example.org' } });
    });

    it('blocks the sole admin of an org, with a clear message, and changes nothing', async () => {
      const id = 'b2000000-0000-4000-8000-000000000010';
      await h.t.owner.insertInto('users').values({ id, email: 'sole@example.org', name: 'Sole Admin' } as never).execute();
      const org = await h.t.owner.insertInto('orgs').values({ slug: 'sole-org', name: 'Sole Org', settings: '{}' } as never).returning('id').executeTakeFirstOrThrow();
      await h.t.owner.insertInto('memberships').values({ org_id: org.id, user_id: id, roles: ['org_admin'], status: 'active', source: 'local' } as never).execute();
      const summary = await (await as(h, id, org.id).get('/api/me/privacy')).json();
      expect(summary.blockers.map((b: { code: string }) => b.code)).toEqual(['sole_org_admin']);
      expect(summary.blockers[0].message).toContain('Sole Org');
      const r = await as(h, id, org.id).post('/api/me/privacy/delete', { confirmEmail: 'sole@example.org' });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe('conflict');
      expect(r.json().error).toContain('Sole Org');
      expect(r.json().details.blockers[0].code).toBe('sole_org_admin');
      expect(await h.t.owner.selectFrom('memberships').select('status').where('user_id', '=', id).executeTakeFirst()).toEqual({ status: 'active' });
      expect(await h.t.owner.selectFrom('gdpr_requests').select('id').where('user_id', '=', id).executeTakeFirst()).toBeUndefined();

      // With a second admin it goes through.
      const second = 'b2000000-0000-4000-8000-000000000011';
      await h.t.owner.insertInto('users').values({ id: second, email: 'second@example.org', name: 'Second' } as never).execute();
      await h.t.owner.insertInto('memberships').values({ org_id: org.id, user_id: second, roles: ['org_admin'], status: 'active', source: 'local' } as never).execute();
      expect((await as(h, id, org.id).post('/api/me/privacy/delete', { confirmEmail: 'sole@example.org' })).statusCode).toBe(200);
      // And now the second is the sole admin: not left ownerless.
      expect((await as(h, second, org.id).post('/api/me/privacy/delete', { confirmEmail: 'second@example.org' })).statusCode).toBe(409);
    });

    it('two admins deleting themselves at once: one goes, the org keeps the other', async () => {
      const a = 'b2000000-0000-4000-8000-000000000020';
      const b = 'b2000000-0000-4000-8000-000000000021';
      const org = await h.t.owner.insertInto('orgs').values({ slug: 'race-org', name: 'Race Org', settings: '{}' } as never).returning('id').executeTakeFirstOrThrow();
      for (const [id, email] of [[a, 'a.race@example.org'], [b, 'b.race@example.org']] as const) {
        await h.t.owner.insertInto('users').values({ id, email, name: email } as never).execute();
        await h.t.owner.insertInto('memberships').values({ org_id: org.id, user_id: id, roles: ['org_admin'], status: 'active', source: 'local' } as never).execute();
      }
      const [ra, rb] = await Promise.all([as(h, a, org.id).post('/api/me/privacy/delete', { confirmEmail: 'a.race@example.org' }), as(h, b, org.id).post('/api/me/privacy/delete', { confirmEmail: 'b.race@example.org' })]);
      expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
      const left = await h.t.owner.selectFrom('memberships').select(['user_id', 'status']).where('org_id', '=', org.id).execute();
      expect(left).toHaveLength(1);
      expect(left[0]!.status).toBe('active');
    });

    it('org isolation: an org admin cannot erase or export a member through these routes', async () => {
      // There is no user parameter: the routes act on the caller. A body naming someone else changes nothing.
      const r = await as(h, Q.priya).post('/api/me/privacy/delete', { confirmEmail: 'someone@else.example', userId: Q.lucas });
      expect(r.statusCode).toBe(422);
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', Q.lucas).executeTakeFirst()).toBeTruthy();
    });

    it('only a platform admin sees the ledger view, and it holds no keys', async () => {
      expect((await as(h, Q.lucas).get('/api/platform/privacy/requests')).statusCode).toBe(403);
      expect((await as(h, Q.priya).get('/api/platform/privacy/requests')).statusCode).toBe(403);
      const view = await as(h, Q.rhea).get('/api/platform/privacy/requests');
      expect(view.statusCode).toBe(200);
      expect(view.json().chain.ok).toBe(true);
      expect(view.json().requests.length).toBeGreaterThan(0);
      expect(view.body).not.toMatch(/subjectKey|userKey|@/);
    });
  });

  describe('restriction (Art. 18)', () => {
    const id = 'b2000000-0000-4000-8000-000000000070';
    const email = 'restrict@example.org';
    const entries = async () => (await h.ledger.entries()).filter((e) => e.subjectKey === subjectKey(email, TEST_GDPR_KEY) && e.type === 'restriction');
    beforeAll(async () => {
      await seedPerson(h, id, email, 'Re Strict');
    });

    it('stops new labs and exams, ends the running lab, drops out of reports, keeps the data, and is recorded', async () => {
      h.cluster.sessions.set('lab-res', { apiVersion: 'x', kind: 'LabSession', metadata: { name: 'lab-res', labels: { 'cloudtrain.dev/learner': id } }, spec: { learner: { id, org: h.orgs.quillmoor } } } as never);
      const team = await h.t.owner.selectFrom('team_members').select('team_id').where('user_id', '=', id).executeTakeFirstOrThrow();
      const inReport = async () => (await as(h, Q.priya, h.orgs.quillmoor).get(`/api/teams/${team.team_id}/dashboard`)).body.includes(id);
      expect(await inReport()).toBe(true);

      h.mailer.sent = [];
      const on = await as(h, id, h.orgs.quillmoor).put('/api/me/privacy/restriction', {});
      expect(on.statusCode).toBe(200);
      expect(on.json().endedLabs).toBe(1);
      expect(h.cluster.sessions.has('lab-res')).toBe(false);
      const start = await as(h, id, h.orgs.quillmoor).post('/api/labs/gateway-smoke/sessions');
      expect(start.statusCode).toBe(409);
      expect(start.json().error).toContain('restricted');
      expect(await h.t.owner.selectFrom('lab_attempts').select('id').where('user_id', '=', id).executeTakeFirst()).toBeTruthy(); // Kept.
      expect(await inReport()).toBe(false);
      await expect(h.ps.ensureNotRestricted(principal({ sub: id, email, orgId: h.orgs.quillmoor }))).rejects.toMatchObject({ status: 409 });
      expect((await as(h, id, h.orgs.quillmoor).get('/api/me/privacy')).json().restrictedAt).toBeTruthy();
      await h.gdpr.settled();
      expect(h.mailer.sent.map((m) => m.to)).toContain('gdpr@cloudtrain.test');

      const [rec] = await entries();
      expect(rec).toMatchObject({ scope: 'account', actor: 'self', reason: 'restriction-applied' });
      expect(rec!.outcomes[0]).toMatchObject({ action: 'restricted', rows: 1 });
      expect(JSON.stringify(rec)).not.toContain('@');
    });

    it('asking twice does nothing new; lifting works and is recorded', async () => {
      await as(h, id, h.orgs.quillmoor).put('/api/me/privacy/restriction', {});
      expect(await entries()).toHaveLength(1);
      const off = await as(h, id, h.orgs.quillmoor).del('/api/me/privacy/restriction');
      expect(off.statusCode).toBe(200);
      expect(off.json().restrictedAt).toBeNull();
      expect((await entries()).map((e) => e.reason)).toEqual(['restriction-applied', 'restriction-lifted']);
      expect((await as(h, id, h.orgs.quillmoor).post('/api/labs/gateway-smoke/sessions')).statusCode).not.toBe(409);
    });

    it('no evidence, no restriction', async () => {
      for (const s of h.cluster.sessions.values()) if (s.spec.learner.id === id) h.cluster.sessions.delete(s.metadata.name);
      h.ledger.failNext = 1;
      const r = await as(h, id, h.orgs.quillmoor).put('/api/me/privacy/restriction', {});
      expect(r.statusCode).toBe(503);
      expect((await as(h, id, h.orgs.quillmoor).get('/api/me/privacy')).json().restrictedAt).toBeNull();
    });

    it('waits for a running exam', async () => {
      const uid = 'b2000000-0000-4000-8000-000000000071';
      await seedPerson(h, uid, 'exam.running@example.org', 'Ex Am');
      await h.t.owner.updateTable('exam_attempts').set({ phase: 'in-progress' }).where('user_id', '=', uid).execute();
      expect((await as(h, uid, h.orgs.quillmoor).put('/api/me/privacy/restriction', {})).statusCode).toBe(409);
    });
  });

  describe('objection (Art. 21) and rectification (Art. 16)', () => {
    const email = 'object@example.org';
    const id = 'b2000000-0000-4000-8000-000000000072';
    beforeAll(async () => {
      await seedPerson(h, id, email, 'Ob Ject');
    });
    const raise = (body: object) => as(h, id, h.orgs.quillmoor).post('/api/me/privacy/objection', body);

    it('reaches the inbox with the note, and the ledger without it', async () => {
      h.mailer.sent = [];
      const r = await raise({ processing: 'progress_reporting', note: 'My manager is my neighbour, Secret Reason' });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toMatchObject({ status: 'raised', contact: 'gdpr@cloudtrain.test' });
      await h.gdpr.settled();
      const inbox = h.mailer.sent.find((m) => m.to === 'gdpr@cloudtrain.test')!;
      expect(inbox.text).toContain('Secret Reason');
      expect(inbox.text).toContain(email);
      expect(h.mailer.sent.map((m) => m.to)).toContain(email);
      const e = (await h.ledger.entries()).find((x) => x.requestId === r.json().requestId)!;
      expect(e).toMatchObject({ type: 'objection', actor: 'self', reason: 'objection-raised', dataCategories: ['progress_reporting'] });
      expect(e.outcomes[0]).toMatchObject({ system: 'gdpr-inbox', action: 'requested' });
      const raw = JSON.stringify(e);
      expect(raw).not.toContain('Secret');
      expect(raw).not.toContain('@');
      expect((await h.ledger.verifyChain()).ok).toBe(true);
    });

    it('refuses a missing choice, and an undelivered objection is not recorded', async () => {
      expect((await raise({ processing: 'nonsense' })).statusCode).toBe(422);
      const before = (await h.ledger.entries()).length;
      const orig = h.mailer.send;
      h.mailer.send = async () => {
        throw new Error('smtp down');
      };
      const r = await raise({ processing: 'other' });
      h.mailer.send = orig;
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toContain('gdpr@cloudtrain.test');
      expect((await h.ledger.entries()).length).toBe(before);
    });

    it('says who corrects name and address', async () => {
      const s = (await as(h, id, h.orgs.quillmoor).get('/api/me/privacy')).json();
      expect(s.rectification).toEqual({ managedBy: 'identity_account', url: 'http://id.test/account/' });
      const managed = await h.gdpr.summary(principal({ sub: id, email, orgName: 'Quillmoor', session: { idHash: 'x', csrf: 'x', expiresAt: '', method: 'oidc', idp: 'acme-idp' } }));
      expect(managed.rectification).toEqual({ managedBy: 'organisation', organisation: 'Quillmoor' });
    });
  });

  describe('admin-initiated erasure', () => {
    const id = 'b2000000-0000-4000-8000-000000000080';
    const email = 'writes.in@example.org';
    const erase = (who: string, body: object) => as(h, who).post('/api/platform/privacy/erase', body);
    beforeAll(async () => {
      await seedPerson(h, id, email, 'Writes In');
    });

    it('is for platform admins only', async () => {
      expect((await erase(Q.priya, { email, confirmEmail: email })).statusCode).toBe(403);
      expect((await erase(Q.lucas, { email, confirmEmail: email })).statusCode).toBe(403);
    });

    it('refuses someone with an active membership, an unknown address and a mistyped confirmation', async () => {
      const active = await erase(Q.rhea, { email, confirmEmail: email });
      expect(active.statusCode).toBe(409);
      expect(active.json().error).toContain('active membership');
      expect((await erase(Q.rhea, { email: 'nobody@example.org', confirmEmail: 'nobody@example.org' })).statusCode).toBe(404);
      await h.t.owner.updateTable('memberships').set({ status: 'deactivated' }).where('user_id', '=', id).execute();
      expect((await erase(Q.rhea, { email, confirmEmail: 'writes.out@example.org' })).statusCode).toBe(422);
      expect((await erase(Q.rhea, { email: 'rhea@x', confirmEmail: 'rhea@x' })).statusCode).toBe(404);
    });

    it('erases a deactivated user, records actor admin without the address, and tells them', async () => {
      h.mailer.sent = [];
      const r = await erase(Q.rhea, { email: email.toUpperCase(), confirmEmail: email });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('completed');
      expect(await scanFor(h, email)).toEqual([]);
      expect(await scanFor(h, id)).toEqual([]);
      expect(h.kc.deleted).toContain(id);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey(email, TEST_GDPR_KEY) && x.scope === 'account')!;
      expect(e).toMatchObject({ actor: 'admin', reason: 'admin-request', type: 'erasure' });
      expect(JSON.stringify(e)).not.toContain('@');
      await h.gdpr.settled();
      expect(h.mailer.sent.find((m) => m.to === email.toLowerCase())?.subject).toContain('has been deleted');
    });

    it('an admin cannot erase themselves here', async () => {
      const rhea = await h.t.owner.selectFrom('users').select('email').where('id', '=', Q.rhea).executeTakeFirstOrThrow();
      expect((await erase(Q.rhea, { email: rhea.email, confirmEmail: rhea.email })).statusCode).toBe(409);
    });
  });

  describe('closure', () => {
    const id = 'b2000000-0000-4000-8000-000000000090';
    const email = 'closing@example.org';
    beforeAll(async () => {
      await seedPerson(h, id, email, 'Clo Sing');
    });

    it('needs the address, blocks a sole admin, and otherwise ends access at once while keeping the data', async () => {
      expect((await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/close', { confirmEmail: 'x@y.io' })).statusCode).toBe(422);
      h.cluster.sessions.set('lab-closing', { apiVersion: 'x', kind: 'LabSession', metadata: { name: 'lab-closing', labels: { 'cloudtrain.dev/learner': id } }, spec: { learner: { id, org: h.orgs.quillmoor } } } as never);
      h.mailer.sent = [];
      const r = await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/close', { confirmEmail: email });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('closed');
      expect(Date.parse(r.json().deleteAfter)).toBeGreaterThan(Date.now() + 89 * 86_400_000);
      expect((await as(h, id, h.orgs.quillmoor).get('/api/me/privacy')).statusCode).toBe(401);
      expect(h.cluster.sessions.has('lab-closing')).toBe(false);
      expect(h.kc.enabled.get(id)).toBe(false);
      expect(await h.t.owner.selectFrom('lab_attempts').select('id').where('user_id', '=', id).executeTakeFirst()).toBeTruthy();
      await h.gdpr.settled();
      expect(h.mailer.sent.find((m) => m.to === email)?.subject).toContain('closed');
    });

    it('a closed account cannot sign in, even with a live identity-provider session', async () => {
      const { provision } = await import('../src/platform/identity.js');
      const res = await provision(h.t.db, { sub: id, email, name: 'Clo Sing', idpRoles: [], idpGroups: [] }, { platformIdps: [] });
      expect(res).toMatchObject({ ok: false, reason: 'deactivated' });
      expect((res as { message: string }).message).toContain('closed');
    });

    it('a platform admin can reopen it, with the memberships it had', async () => {
      expect((await as(h, Q.priya).post('/api/platform/privacy/reopen', { email })).statusCode).toBe(403);
      expect((await as(h, Q.rhea).post('/api/platform/privacy/reopen', { email })).statusCode).toBe(200);
      expect((await as(h, id, h.orgs.quillmoor).get('/api/me/privacy')).statusCode).toBe(200);
      expect(h.kc.enabled.get(id)).toBe(true);
      expect((await as(h, Q.rhea).post('/api/platform/privacy/reopen', { email })).statusCode).toBe(409);
    });

    it('a sole admin cannot close', async () => {
      const uid = 'b2000000-0000-4000-8000-000000000091';
      await h.t.owner.insertInto('users').values({ id: uid, email: 'sole.close@example.org', name: 'Sole Close' } as never).execute();
      const org = await h.t.owner.insertInto('orgs').values({ slug: 'sole-close', name: 'Sole Close Org', settings: '{}' } as never).returning('id').executeTakeFirstOrThrow();
      await h.t.owner.insertInto('memberships').values({ org_id: org.id, user_id: uid, roles: ['org_admin'], status: 'active', source: 'local' } as never).execute();
      expect((await as(h, uid, org.id).post('/api/me/privacy/close', { confirmEmail: 'sole.close@example.org' })).statusCode).toBe(409);
    });
  });

  describe('outages during account erasure', () => {
    it('a Keycloak outage leaves it pending and signed out; the sweep finishes without double counting', async () => {
      const id = 'b2000000-0000-4000-8000-000000000030';
      await seedPerson(h, id, 'kcdown@example.org', 'Kc Down');
      h.kc.failNext = 1;
      const r = await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'kcdown@example.org' });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe('pending');
      const row = await h.t.owner.selectFrom('gdpr_requests').selectAll().where('user_id', '=', id).executeTakeFirstOrThrow();
      expect(row.status).toBe('processing');
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst()).toBeTruthy();
      expect((await as(h, id, h.orgs.quillmoor).get('/api/me/privacy')).statusCode).toBe(401); // deactivated
      const key = subjectKey('kcdown@example.org', TEST_GDPR_KEY);
      expect((await h.ledger.entries()).some((e) => e.subjectKey === key && e.scope === 'account')).toBe(false);
      await h.gdpr.sweep();
      expect(await h.t.owner.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst()).toBeUndefined();
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === key && x.scope === 'account')!;
      expect(e.outcomes.filter((o) => o.system === 'keycloak')).toHaveLength(1);
      expect(e.outcomes.filter((o) => o.system === 'postgres.users')).toHaveLength(1);
    });

    it('a ledger outage: erased but not reported done; evidence follows', async () => {
      const id = 'b2000000-0000-4000-8000-000000000031';
      await seedPerson(h, id, 'evidence@example.org', 'Ev Idence');
      h.ledger.failNext = 1;
      const r = await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'evidence@example.org' });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe('pending');
      const key = subjectKey('evidence@example.org', TEST_GDPR_KEY);
      expect(await h.t.owner.selectFrom('gdpr_requests').select('status').where('subject_key', '=', key).executeTakeFirst()).toEqual({ status: 'evidence_pending' });
      await h.gdpr.sweep();
      expect((await h.ledger.entries()).find((x) => x.subjectKey === key && x.scope === 'account')).toBeTruthy();
    });
  });

  describe('billing', () => {
    let fs: FakeStripe;
    let hb: Harness;
    const id = 'b2000000-0000-4000-8000-000000000040';
    beforeAll(async () => {
      fs = new FakeStripe();
      const stripe = new StripeApi('sk_test_x', fs.fetch);
      hb = await harness({ gdpr: { stripe } });
      await seedPerson(hb, id, 'payer@example.org', 'Pay Er');
      const created = await stripe.customers.create({ email: 'payer@example.org' });
      const cus = await hb.t.owner.insertInto('billing_customers').values({ org_id: hb.orgs.quillmoor, user_id: id, stripe_customer_id: created.id, email: 'payer@example.org' } as never).returning(['id', 'stripe_customer_id']).executeTakeFirstOrThrow();
      await hb.t.owner.insertInto('billing_subscriptions').values({ org_id: hb.orgs.quillmoor, user_id: id, customer_id: cus.id, stripe_subscription_id: 'sub_plan1', plan_id: 'pro', billing_interval: 'monthly', status: 'active', kind: 'plan' } as never).execute();
    });
    afterAll(async () => hb?.close());

    it('blocks a paying subscriber until the subscription has ended', async () => {
      const r = await as(hb, id, hb.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'payer@example.org' });
      expect(r.statusCode).toBe(409);
      expect(r.json().details.blockers.map((b: { code: string }) => b.code)).toEqual(['subscription']);
      expect(fs.customers.size).toBe(1);
    });

    it('blocks an open balance and unbilled usage, each with its own message', async () => {
      await hb.t.owner.updateTable('billing_subscriptions').set({ status: 'canceled' }).where('user_id', '=', id).execute();
      await hb.t.owner.updateTable('billing_customers').set({ delinquent_since: new Date() }).where('user_id', '=', id).execute();
      await hb.t.owner.insertInto('billing_usage').values({ org_id: hb.orgs.quillmoor, user_id: id, lab_id: 'l', session_name: `mine-${tag(id)}`, compute_tier: 'pod', units_per_minute: 1, unit_price: 0, payer_key: id, billable: true, started_at: new Date(Date.now() - 7200_000), ended_at: new Date(Date.now() - 3600_000), minutes: 60, units: 60 } as never).execute();
      const s = await (await as(hb, id, hb.orgs.quillmoor).get('/api/me/privacy')).json();
      expect(s.blockers.map((b: { code: string }) => b.code).sort()).toEqual(['open_balance', 'unbilled_usage']);
    });

    it('then deletes the Stripe customer, keeps invoices on record and the usage without a name', async () => {
      await hb.t.owner.updateTable('billing_customers').set({ delinquent_since: null }).where('user_id', '=', id).execute();
      await hb.t.owner.updateTable('billing_usage').set({ ended_at: new Date(Date.now() - 40 * 86_400_000) }).where('session_name', '=', `mine-${tag(id)}`).execute();
      const cus = await hb.t.owner.selectFrom('billing_customers').select(['id', 'stripe_customer_id']).where('user_id', '=', id).executeTakeFirstOrThrow();
      const usage = await hb.t.owner.selectFrom('billing_usage').select('id').where('session_name', '=', `mine-${tag(id)}`).executeTakeFirstOrThrow();
      await hb.t.owner.insertInto('billing_meter_outbox').values({ org_id: hb.orgs.quillmoor, usage_id: usage.id, identifier: `i-${tag(id)}`, event_name: 'e', stripe_customer_id: cus.stripe_customer_id, value: 1, event_at: new Date(), status: 'sent' } as never).execute();
      await hb.t.owner.insertInto('billing_events').values({ stripe_event_id: 'evt_gdpr1', type: 'x', org_id: hb.orgs.quillmoor, user_id: id, summary: JSON.stringify({ customer: cus.stripe_customer_id }) } as never).execute();
      const r = await as(hb, id, hb.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'payer@example.org' });
      expect(r.statusCode).toBe(200);
      expect(fs.customers.size).toBe(0);
      expect(await scanFor(hb, id)).toEqual([]);
      expect(await scanFor(hb, cus.stripe_customer_id)).toEqual([]);
      expect(await scanFor(hb, 'payer@example.org')).toEqual([]);
      const u = await hb.t.owner.selectFrom('billing_usage').selectAll().where('session_name', '=', `mine-${tag(id)}`).executeTakeFirstOrThrow();
      expect(u).toMatchObject({ user_id: null, payer_key: 'erased', customer_id: null, units: 60 });
      const e = (await hb.ledger.entries()).find((x) => x.subjectKey === subjectKey('payer@example.org', TEST_GDPR_KEY) && x.scope === 'account')!;
      const invoices = e.outcomes.find((o) => o.system === 'stripe.invoices')!;
      expect(invoices).toMatchObject({ action: 'retained', category: 'invoices' });
      expect(invoices.legalBasis).toMatch(/tax/i);
      expect(e.outcomes.find((o) => o.system === 'stripe.customer')).toMatchObject({ action: 'deleted', rows: 1 });
      expect(e.dataCategories).toContain('invoices');
    });

    it('a Stripe customer already gone is not an error, and metering on its way waits', async () => {
      const uid = 'b2000000-0000-4000-8000-000000000041';
      await seedPerson(hb, uid, 'gone@example.org', 'Go Ne');
      const cus = await hb.t.owner.insertInto('billing_customers').values({ org_id: hb.orgs.quillmoor, user_id: uid, stripe_customer_id: 'cus_alreadygone', email: 'gone@example.org' } as never).returning('id').executeTakeFirstOrThrow();
      const u = await hb.t.owner.insertInto('billing_usage').values({ org_id: hb.orgs.quillmoor, user_id: uid, lab_id: 'l', session_name: `w-${tag(uid)}`, compute_tier: 'pod', units_per_minute: 1, unit_price: 0, payer_key: uid, customer_id: cus.id, billable: false, started_at: new Date(), ended_at: new Date(), minutes: 1, units: 1 } as never).returning('id').executeTakeFirstOrThrow();
      await hb.t.owner.insertInto('billing_meter_outbox').values({ org_id: hb.orgs.quillmoor, usage_id: u.id, identifier: `i-${uid}`, event_name: 'e', stripe_customer_id: 'cus_alreadygone', value: 1, event_at: new Date(), status: 'pending' } as never).execute();
      const r = await as(hb, uid, hb.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'gone@example.org' });
      expect(r.statusCode).toBe(202); // The meter event is still pending: Stripe must get it first.
      expect(await hb.t.owner.selectFrom('users').select('id').where('id', '=', uid).executeTakeFirst()).toBeTruthy();
      await hb.t.owner.updateTable('billing_meter_outbox').set({ status: 'sent' }).where('identifier', '=', `i-${uid}`).execute();
      await hb.gdpr.sweep();
      expect(await hb.t.owner.selectFrom('users').select('id').where('id', '=', uid).executeTakeFirst()).toBeUndefined();
    });
  });

  describe('the first-sign-in notice', () => {
    it('shows until acknowledged, for a learner who was added by their org, and comes back with a new version', async () => {
      const id = 'b2000000-0000-4000-8000-0000000000a1';
      await seedPerson(h, id, 'first.login@example.org', 'First Login');
      const me = async () => (await as(h, id, h.orgs.quillmoor).get('/api/me')).json().privacyNotice;
      const first = await me();
      expect(first.required).toBe(true);
      expect((await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/notice', { version: first.version })).statusCode).toBe(204);
      expect((await me()).required).toBe(false);
      const row = await h.t.owner.selectFrom('users').select(['privacy_notice_version', 'privacy_notice_at']).where('id', '=', id).executeTakeFirstOrThrow();
      expect(row.privacy_notice_version).toBe(first.version);
      expect(row.privacy_notice_at).toBeInstanceOf(Date);
      await h.t.owner.updateTable('users').set({ privacy_notice_version: 'older' }).where('id', '=', id).execute();
      expect((await me()).required).toBe(true);
      expect((await as(h, id, h.orgs.quillmoor).post('/api/me/privacy/notice', {})).statusCode).toBe(422);
    });

    it('the invitation mail links the notice and the request page', async () => {
      h.mailer.sent = [];
      const r = await as(h, Q.priya, h.orgs.quillmoor).post('/api/admin/users', { email: 'invited.person@quillmoor.example', roles: ['learner'] });
      expect(r.statusCode).toBe(201);
      const text = h.mailer.sent.find((m) => m.to === 'invited.person@quillmoor.example')!.text;
      expect(text).toContain('http://web.test/legal/privacy\n');
      expect(text).toContain('http://web.test/legal/privacy-request');
      expect(text).toContain('can see your progress');
    });
  });

  describe('rotating the key', () => {
    const OLD = 'old-gdpr-key-0123456789abcdef0123456789abcdef';
    const NEW = 'new-gdpr-key-0123456789abcdef0123456789abcdef';

    it('old records still match after a rotation: reapply, links in flight, checkpoints and lookup', async () => {
      const r = await harness();
      try {
        const ledger = new PostgresLedger(r.t.db, OLD);
        const before = new GdprService({ db: r.t.db, ledger, hmacKey: OLD, sealer: new Sealer('test-session-secret-0123456789'), mailer: r.mailer, webUrl: 'http://x', waitlist: r.waitlist });
        await r.waitlist.add({ email: 'rotated@example.org' }, new Date(Date.now() - 86_400_000));
        await before.requestPublic('rotated@example.org', 'erasure');
        await before.settled();
        await before.confirmPublic(decodeURIComponent(/#token=([^\s]+)/.exec(r.mailer.sent.at(-1)!.text)![1]!));
        await before.requestPublic('inflight@example.org', 'erasure');
        await before.settled();
        const inflight = decodeURIComponent(/#token=([^\s]+)/.exec(r.mailer.sent.at(-1)!.text)![1]!);

        // The rotation: same ledger, new key first, old key kept for matching.
        const rotated = new PostgresLedger(r.t.db, [NEW, OLD]);
        const after = new GdprService({ db: r.t.db, ledger: rotated, hmacKey: NEW, previousHmacKeys: [OLD], sealer: new Sealer('test-session-secret-0123456789'), mailer: r.mailer, webUrl: 'http://x', waitlist: r.waitlist });
        expect((await after.confirmPublic(inflight)).body.status).toBe('completed');
        expect(await after.recordsFor('rotated@example.org')).toHaveLength(1);
        await r.t.owner.insertInto('waitlist_entries').values({ email: 'rotated@example.org', consent_at: new Date(Date.now() - 86_400_000), created_at: new Date(Date.now() - 86_400_000) } as never).execute();
        expect(await after.reapply()).toMatchObject({ waitlist: 1 });
        expect(await r.waitlist.find('rotated@example.org')).toBeNull();
        // New records use the new key.
        const newest = (await rotated.entries()).at(-1)!;
        expect(newest.subjectKey).toBe(subjectKey('rotated@example.org', NEW));
        expect((await rotated.verifyChain()).ok).toBe(true);
        // Dropping the old key too early is exactly what the procedure warns about: the old record no longer matches.
        const dropped = new GdprService({ db: r.t.db, ledger: rotated, hmacKey: NEW, sealer: new Sealer('test-session-secret-0123456789'), mailer: r.mailer, webUrl: 'http://x', waitlist: r.waitlist });
        expect((await dropped.recordsFor('inflight@example.org'))).toHaveLength(0);
      } finally {
        await r.close();
      }
    });
  });

  describe('after a restore', () => {
    it('re-erases what came back, in the scope asked for, and leaves those who returned later alone', async () => {
      // A separate database so the counts are this test's own.
      const r = await harness();
      try {
        const eraseId = 'b2000000-0000-4000-8000-000000000050';
        await seedPerson(r, eraseId, 'restored@example.org', 'Re Stored');
        expect((await as(r, eraseId, r.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'restored@example.org' })).statusCode).toBe(200);

        const join2 = (email: string) => r.app.inject({ method: 'POST', url: '/api/public/waitlist', payload: { email, consent: true } });
        await join2('waitonly@example.org');
        const svc = r.gdpr;
        await svc.requestPublic('waitonly@example.org', 'erasure');
        await svc.settled();
        await svc.confirmPublic(decodeURIComponent(/#token=([^\s]+)/.exec(r.mailer.sent.at(-1)!.text)![1]!));

        // The dump comes back: rows older than the erasures reappear...
        const longAgo = new Date(Date.now() - 10 * 86_400_000);
        await r.t.owner.insertInto('users').values({ id: eraseId, email: 'restored@example.org', name: 'Re Stored', created_at: longAgo } as never).execute();
        await r.t.owner.insertInto('memberships').values({ org_id: r.orgs.quillmoor, user_id: eraseId, roles: ['learner'], status: 'active', source: 'local' } as never).execute();
        await r.t.owner.insertInto('waitlist_entries').values({ email: 'WaitOnly@example.org', consent_at: longAgo, created_at: longAgo } as never).execute();
        await sql`INSERT INTO audit_log (org_id, actor_name, action, target_type, target_id, target_label, ip, at) VALUES (${r.orgs.quillmoor}, 'waitonly@example.org', 'auth.login_denied', 'user', 'kc-x', 'waitonly@example.org', '203.0.113.5', ${longAgo})`.execute(r.t.owner);
        // ...and someone who erased a waitlist entry but holds an account keeps the account,
        const keeper = 'b2000000-0000-4000-8000-000000000051';
        await r.t.owner.insertInto('users').values({ id: keeper, email: 'keeper@example.org', name: 'Keeper', created_at: longAgo } as never).execute();
        await join2('keeper@example.org');
        await svc.requestPublic('keeper@example.org', 'erasure');
        await svc.settled();
        await svc.confirmPublic(decodeURIComponent(/#token=([^\s]+)/.exec(r.mailer.sent.at(-1)!.text)![1]!));
        // ...and whoever came back after their erasure stays.
        await svc.requestPublic('returned@example.org', 'erasure');
        await svc.settled();
        await svc.confirmPublic(decodeURIComponent(/#token=([^\s]+)/.exec(r.mailer.sent.at(-1)!.text)![1]!));
        await new Promise((res) => setTimeout(res, 5));
        await join2('returned@example.org');
        await r.t.owner.insertInto('users').values({ id: 'b2000000-0000-4000-8000-000000000052', email: 'returned@example.org', name: 'Returned' } as never).execute();

        const before = (await r.ledger.entries()).length;
        const dry = await svc.reapply({ dryRun: true });
        expect(dry).toEqual({ waitlist: 1, accounts: 1, audit: 1, records: 0 });
        expect(await r.t.owner.selectFrom('users').select('id').where('id', '=', eraseId).executeTakeFirst()).toBeTruthy();

        r.kc.deleted = [];
        const done = await svc.reapply();
        expect(done).toMatchObject({ waitlist: 1, accounts: 1, audit: 1, records: 3 });
        expect(await scanFor(r, 'restored@example.org')).toEqual([]);
        expect(await scanFor(r, 'waitonly@example.org')).toEqual([]);
        expect(r.kc.deleted).toContain(eraseId);
        expect(await r.t.owner.selectFrom('users').select('id').where('id', '=', keeper).executeTakeFirst()).toBeTruthy();
        expect(await r.t.owner.selectFrom('waitlist_entries').select('id').where('email', '=', 'returned@example.org').executeTakeFirst()).toBeTruthy();
        expect(await r.t.owner.selectFrom('users').select('id').where('email', '=', 'returned@example.org').executeTakeFirst()).toBeTruthy();

        const after = await r.ledger.entries();
        const added = after.slice(before);
        expect(added).toHaveLength(3);
        for (const e of added) expect(e).toMatchObject({ actor: 'admin', reason: 'post-restore-reapply' });
        expect(JSON.stringify(added)).not.toContain('@');
        expect((await r.ledger.verifyChain()).ok).toBe(true);
        expect(await svc.reapply()).toEqual({ waitlist: 0, accounts: 0, audit: 0, records: 0 }); // Idempotent.
      } finally {
        await r.close();
      }
    });

    it('matches a restored row that holds an older address, by the keyed user id', async () => {
      const r = await harness();
      try {
        const id = 'b2000000-0000-4000-8000-000000000060';
        await seedPerson(r, id, 'newaddress@example.org', 'Addr Change');
        expect((await as(r, id, r.orgs.quillmoor).post('/api/me/privacy/delete', { confirmEmail: 'newaddress@example.org' })).statusCode).toBe(200);
        await r.t.owner.insertInto('users').values({ id, email: 'oldaddress@example.org', name: 'Addr Change', created_at: new Date(Date.now() - 86_400_000) } as never).execute();
        expect(await r.gdpr.reapply()).toMatchObject({ accounts: 1 });
        expect(await r.t.owner.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst()).toBeUndefined();
      } finally {
        await r.close();
      }
    });

    it('a ledger export restores what the rollback took, and refuses one that does not continue the chain', async () => {
      const r = await harness();
      try {
        const ledger = new PostgresLedger(r.t.db, TEST_GDPR_KEY);
        const rec = (n: number) => ({ requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, type: 'erasure' as const, scope: 'waitlist' as const, subjectKey: subjectKey(`p${n}@x.io`, TEST_GDPR_KEY), dataCategories: [], outcomes: [], requestedAt: '2026-01-01T00:00:00Z', verifiedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:00Z', actor: 'self' as const });
        for (const n of [1, 2, 3]) await ledger.append(rec(n));
        const exported = await ledger.entries();
        // The restore: the table is back to one record.
        await sql`ALTER TABLE gdpr_ledger DISABLE TRIGGER gdpr_ledger_no_change`.execute(r.t.owner);
        await sql`DELETE FROM gdpr_ledger WHERE seq > 1`.execute(r.t.owner);
        await sql`ALTER TABLE gdpr_ledger ENABLE TRIGGER gdpr_ledger_no_change`.execute(r.t.owner);
        expect(await ledger.importMissing(exported)).toBe(2);
        expect((await ledger.verifyChain()).ok).toBe(true);
        expect(await ledger.importMissing(exported)).toBe(0);
        const forged = exported.map((e) => (e.seq === 2 ? { ...e, type: 'export' as const } : e));
        await expect(ledger.importMissing(forged)).rejects.toThrow(/fails verification/);
        // A fork: a different chain from a different start.
        const other = await harness();
        try {
          const l2 = new PostgresLedger(other.t.db, TEST_GDPR_KEY);
          for (const n of [7, 8, 9, 10]) await l2.append(rec(n));
          await expect(ledger.importMissing(await l2.entries())).rejects.toThrow(/does not continue/);
        } finally {
          await other.close();
        }
      } finally {
        await r.close();
      }
    });
  });

  it('webhooks for a deleted customer of an erased person are ignored, not failed', async () => {
    const fs = new FakeStripe();
    const { BillingService } = await import('../src/billing/service.js');
    const { signWebhook } = await import('../src/billing/stripe.js');
    const site = (await import('../src/site/config.js')).loadSiteConfig;
    const path = await import('node:path');
    const { repo } = await import('./fakes.js');
    const billing = new BillingService({ db: h.t.db, site: await site(path.join(repo, 'content/site.yaml')), stripe: new StripeApi('sk_test_x', fs.fetch), webhookSecret: 'whsec_test', enforce: false, labs: new Map(), mailer: new MemoryMailer(), webUrl: 'http://web.test' });
    const body = JSON.stringify({ id: 'evt_afterErasure', type: 'customer.subscription.deleted', livemode: false, created: 1, data: { object: { id: 'sub_gone', object: 'subscription', customer: 'cus_gone', status: 'canceled', cancel_at_period_end: false, metadata: { ct_user_id: 'b2000000-0000-4000-8000-00000000dead', ct_org_id: h.orgs.quillmoor, ct_kind: 'plan', ct_plan_id: 'pro' }, items: { object: 'list', data: [], has_more: false } } } });
    const out = await billing.webhook(body, signWebhook(body, 'whsec_test'));
    expect(out).toMatchObject({ status: 'ignored' });
    const ev = await h.t.owner.selectFrom('billing_events').selectAll().where('stripe_event_id', '=', 'evt_afterErasure').executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ status: 'ignored', user_id: null });
    expect(JSON.stringify(ev)).not.toContain('b2000000-0000-4000-8000-00000000dead');
  });

  it('a fresh service with no Keycloak refuses to start an account erasure it could not finish', async () => {
    const svc = new GdprService({ db: h.t.db, ledger: h.ledger, hmacKey: TEST_GDPR_KEY, sealer: new Sealer('test-session-secret-0123456789'), mailer: h.mailer, webUrl: 'http://x', waitlist: h.waitlist });
    await expect(svc.deleteAccount(principal({ sub: Q.lucas, email: 'lucas@x.io' }), 'lucas@x.io')).rejects.toMatchObject({ status: 409 });
    expect(new FakeKeycloakUsers().deleted).toEqual([]);
  });
});
