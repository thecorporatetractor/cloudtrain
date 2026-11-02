import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import { PostgresLedger, type LedgerRecordInput } from '../src/gdpr/ledger.js';
import { DEFAULT_RETENTION, monthsBefore, retentionConfig, sweepRetention, type RetentionConfig } from '../src/gdpr/retention.js';
import { subjectKey } from '../src/gdpr/subject.js';
import { harness, Q, TEST_GDPR_KEY, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();
const DAY = 86_400_000;
const NOW = new Date();
const just = (cutoff: Date, days: number) => new Date(cutoff.getTime() + days * DAY);

describe.skipIf(!available)('retention sweeps', () => {
  let h: Harness;
  const lines: unknown[] = [];
  const log = { info: (o: object) => lines.push(o), warn: (o: object) => lines.push(o) };
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => h?.close());

  const run = (config: Partial<RetentionConfig> = {}, extra: { batch?: number } = {}) => sweepRetention({ db: h.t.db, waitlist: h.waitlist, ledger: h.ledger, config: { ...DEFAULT_RETENTION, ledgerMonths: 0, closedDays: 0, inactiveMonths: 0, ...config }, now: () => NOW, log, ...extra });

  it('waitlist: gone one day past 24 months, kept one day before', async () => {
    const cutoff = monthsBefore(NOW, 24);
    await h.t.owner.insertInto('waitlist_entries').values([
      { email: 'expired@example.org', consent_at: just(cutoff, -1), created_at: just(cutoff, -1) },
      { email: 'kept@example.org', consent_at: just(cutoff, 1), created_at: just(cutoff, 1) },
    ] as never).execute();
    const r = await run();
    expect(r.waitlist).toBe(1);
    const left = (await h.t.owner.selectFrom('waitlist_entries').select('email').execute()).map((x) => x.email);
    expect(left).toContain('kept@example.org');
    expect(left).not.toContain('expired@example.org');
    expect((await run()).waitlist).toBe(0); // Idempotent.
  });

  it('audit log: gone one day past 13 months, kept one day before, through the narrow function', async () => {
    const cutoff = monthsBefore(NOW, 13);
    const org = h.orgs.quillmoor;
    await sql`DELETE FROM audit_log WHERE at < ${just(cutoff, 5)}`.execute(h.t.owner);
    await sql`INSERT INTO audit_log (org_id, at, actor_name, action, target_type, target_id) VALUES (${org}, ${just(cutoff, -1)}, 'old', 'auth.login', 'user', 'old-row'), (${org}, ${just(cutoff, 1)}, 'new', 'auth.login', 'user', 'new-row')`.execute(h.t.owner);
    expect((await run()).audit).toBe(1);
    const left = (await h.t.owner.selectFrom('audit_log').select('target_id').where('target_id', 'in', ['old-row', 'new-row']).execute()).map((x) => x.target_id);
    expect(left).toEqual(['new-row']);
    expect((await run()).audit).toBe(0);
  });

  it('audit log: the app role has no DELETE, and the function refuses a recent cutoff or a tenant caller', async () => {
    const grants = await sql<{ d: boolean }>`SELECT has_table_privilege('cloudtrain_app', 'audit_log', 'DELETE') AS d`.execute(h.t.owner);
    expect(grants.rows[0]!.d).toBe(false);
    await withTenant(h.t.db, { platform: true }, async (tx) => {
      await expect(sql`SELECT sys_prune_audit_log(now(), 10)`.execute(tx)).rejects.toThrow(/28 days/);
    });
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor, userId: Q.priya }, async (tx) => {
      await expect(sql`SELECT sys_prune_audit_log(now() - interval '2 years', 10)`.execute(tx)).rejects.toThrow(/platform code path/);
    });
  });

  it('privacy links: gone once expired, kept one day before; finished requests after 30 days', async () => {
    const row = (over: object) => ({ type: 'erasure', scope: 'waitlist', subject_key: 'a'.repeat(64), state: '{}', requested_at: NOW, ...over });
    await h.t.owner.insertInto('gdpr_requests').values([
      row({ status: 'awaiting_confirmation', expires_at: just(NOW, -1), token_hash: 'expired-link', email_sealed: 'x' }),
      row({ status: 'awaiting_confirmation', expires_at: just(NOW, 1), token_hash: 'live-link' }),
      row({ status: 'completed', completed_at: just(NOW, -31), token_hash: 'old-done' }),
      row({ status: 'completed', completed_at: just(NOW, -29), token_hash: 'recent-done' }),
      row({ status: 'processing', expires_at: just(NOW, -5), token_hash: 'in-flight' }),
    ] as never).execute();
    const r = await run();
    expect(r).toMatchObject({ expiredLinks: 1, finishedRequests: 1 });
    const left = (await h.t.owner.selectFrom('gdpr_requests').select('token_hash').execute()).map((x) => x.token_hash).sort();
    expect(left).toEqual(['in-flight', 'live-link', 'recent-done']);
    await h.t.owner.deleteFrom('gdpr_requests').execute();
  });

  it('sign-in state and expired sessions: only those past their time', async () => {
    await h.t.owner.insertInto('auth_sessions').values([
      { id_hash: 'dead', user_id: Q.lucas, csrf: 'x', expires_at: just(NOW, -1), ip: '203.0.113.1' },
      { id_hash: 'live', user_id: Q.lucas, csrf: 'x', expires_at: just(NOW, 1) },
    ] as never).execute();
    await h.t.owner.insertInto('auth_login_states').values([
      { state: 'old-state', verifier: 'v', nonce: 'n', created_at: new Date(NOW.getTime() - 16 * 60_000) },
      { state: 'new-state', verifier: 'v', nonce: 'n', created_at: new Date(NOW.getTime() - 14 * 60_000) },
    ] as never).execute();
    const r = await run();
    expect(r).toMatchObject({ authSessions: 1, loginStates: 1 });
    expect((await h.t.owner.selectFrom('auth_sessions').select('id_hash').where('id_hash', 'in', ['dead', 'live']).execute()).map((x) => x.id_hash)).toEqual(['live']);
    expect((await h.t.owner.selectFrom('auth_login_states').select('state').execute()).map((x) => x.state)).toEqual(['new-state']);
  });

  it('ledger: gone one day past the period under a signed checkpoint, chain still verifies, carries on', async () => {
    const cutoff = monthsBefore(NOW, 36);
    const rec = (n: number, completedAt: Date): LedgerRecordInput => ({ requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, type: 'erasure', scope: 'waitlist', subjectKey: subjectKey(`p${n}@x.io`, TEST_GDPR_KEY), dataCategories: [], outcomes: [], requestedAt: completedAt.toISOString(), verifiedAt: completedAt.toISOString(), completedAt: completedAt.toISOString(), actor: 'self' });
    await h.ledger.append(rec(1, just(cutoff, -40)));
    const expired = await h.ledger.append(rec(2, just(cutoff, -1)));
    const kept = await h.ledger.append(rec(3, just(cutoff, 1)));
    expect((await run({ ledgerMonths: 36 })).ledger).toBe(2);
    expect((await h.ledger.entries()).map((e) => e.seq)).toEqual([3]);
    const v = await h.ledger.verifyChain();
    expect(v).toMatchObject({ ok: true, count: 1, checkpoint: { throughSeq: 2, prunedTotal: 2 }, head: { seq: 3, hash: kept.hash } });
    expect(await h.ledger.checkpoint()).toMatchObject({ throughHash: expired.hash });
    expect((await run({ ledgerMonths: 36 })).ledger).toBe(0);
    const next = await h.ledger.append(rec(4, NOW));
    expect(next).toMatchObject({ seq: 4, prevHash: kept.hash });
    expect((await h.ledger.verifyChain()).ok).toBe(true);
    // Without the key the checkpoint cannot be vouched for.
    expect((await new PostgresLedger(h.t.db).verifyChain()).problems[0]).toMatchObject({ kind: 'checkpoint_invalid' });
    // Deleting the checkpoint to hide what was pruned shows.
    await sql`ALTER TABLE gdpr_ledger_checkpoints DISABLE TRIGGER gdpr_checkpoints_no_change`.execute(h.t.owner);
    const saved = await h.t.owner.selectFrom('gdpr_ledger_checkpoints').selectAll().execute();
    await sql`DELETE FROM gdpr_ledger_checkpoints`.execute(h.t.owner);
    expect((await h.ledger.verifyChain()).ok).toBe(false);
    await h.t.owner.insertInto('gdpr_ledger_checkpoints').values(saved as never).execute();
    await sql`ALTER TABLE gdpr_ledger_checkpoints ENABLE TRIGGER gdpr_checkpoints_no_change`.execute(h.t.owner);
    expect((await h.ledger.verifyChain()).ok).toBe(true);
  });

  it('ledger: the database refuses to prune anything newer than 12 months, whatever the code asks', async () => {
    const rec: LedgerRecordInput = { requestId: '00000000-0000-4000-8000-0000000000f0', type: 'export', scope: 'waitlist', subjectKey: subjectKey('recent@x.io', TEST_GDPR_KEY), dataCategories: [], outcomes: [], requestedAt: NOW.toISOString(), verifiedAt: NOW.toISOString(), completedAt: NOW.toISOString(), actor: 'self' };
    const e = await h.ledger.append(rec);
    await withTenant(h.t.db, { platform: true }, async (tx) => {
      await expect(sql`SELECT sys_prune_gdpr_ledger(${e.seq}, ${e.hash}, '{}')`.execute(tx)).rejects.toThrow(/12 months/);
    });
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, async (tx) => {
      await expect(sql`SELECT sys_prune_gdpr_ledger(${e.seq}, ${e.hash}, '{}')`.execute(tx)).rejects.toThrow(/platform code path/);
    });
  });

  it('0 turns a sweep off: nothing is touched and the result says null', async () => {
    const old = monthsBefore(NOW, 60);
    await h.t.owner.insertInto('waitlist_entries').values({ email: 'off@example.org', consent_at: old, created_at: old } as never).execute();
    await sql`INSERT INTO audit_log (org_id, at, action, target_type, target_id) VALUES (${h.orgs.quillmoor}, ${old}, 'auth.login', 'user', 'off-row')`.execute(h.t.owner);
    const r = await run({ waitlistMonths: 0, auditMonths: 0, ledgerMonths: 0, requestDays: 0 });
    expect(r).toMatchObject({ waitlist: null, audit: null, ledger: null, finishedRequests: null });
    expect(await h.t.owner.selectFrom('waitlist_entries').select('id').where('email', '=', 'off@example.org').executeTakeFirst()).toBeTruthy();
    expect(await h.t.owner.selectFrom('audit_log').select('id').where('target_id', '=', 'off-row').executeTakeFirst()).toBeTruthy();
    // The rest of the suite owes this cleanup.
    await h.t.owner.deleteFrom('waitlist_entries').where('email', '=', 'off@example.org').execute();
  });

  describe('accounts', () => {
    const cfg = { closedDays: 90, inactiveMonths: 24, warningDays: 30 };
    const user = (id: string, email: string, over: object) => h.t.owner.insertInto('users').values({ id, email, name: email, ...over } as never).execute();
    const exists = async (id: string) => !!(await h.t.owner.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst());
    const clean = async () => {
      await h.t.owner.deleteFrom('users').where('id', 'like', 'ret-%').execute();
    };
    const inactive = monthsBefore(NOW, 24);

    it('a closed account is deleted one day past the period, and not one day before', async () => {
      await clean();
      await user('ret-c-old', 'closed.old@example.org', { closed_at: just(NOW, -91) });
      await user('ret-c-new', 'closed.new@example.org', { closed_at: just(NOW, -89) });
      h.mailer.sent = [];
      const a = await h.gdpr.sweepAccounts({ ...cfg, inactiveMonths: 0 });
      expect(a).toMatchObject({ closed: 1, inactive: null });
      expect(await exists('ret-c-old')).toBe(false);
      expect(await exists('ret-c-new')).toBe(true);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey('closed.old@example.org', TEST_GDPR_KEY))!;
      expect(e).toMatchObject({ actor: 'self', reason: 'closure-period-ended', scope: 'account' });
      expect(JSON.stringify(e)).not.toContain('@');
      await h.gdpr.settled();
      expect(h.mailer.sent.find((m) => m.to === 'closed.old@example.org')?.text).toContain('closed');
      expect((await h.gdpr.sweepAccounts({ ...cfg, inactiveMonths: 0 })).closed).toBe(0);
    });

    it('inactivity: warned one day past the limit, not one day before, and only once', async () => {
      await clean();
      await user('ret-i-old', 'inactive.old@example.org', { last_login_at: just(inactive, -1), created_at: just(inactive, -400) });
      await user('ret-i-new', 'inactive.new@example.org', { last_login_at: just(inactive, 1), created_at: just(inactive, -400) });
      await user('ret-i-never', 'never.signed.in@example.org', { created_at: just(inactive, -1) });
      h.mailer.sent = [];
      const a = await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 });
      expect(a).toMatchObject({ warned: 2, inactive: 0, closed: null });
      expect(h.mailer.sent.map((m) => m.to).sort()).toEqual(['inactive.old@example.org', 'never.signed.in@example.org']);
      expect(h.mailer.sent[0]!.text).toContain('sign in before then');
      expect(await exists('ret-i-old')).toBe(true); // A warning first, always.
      h.mailer.sent = [];
      expect((await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 })).warned).toBe(0);
      expect(h.mailer.sent).toHaveLength(0);
    });

    it('inactivity: deleted one day past the warning period, not one day before', async () => {
      await clean();
      const old = { last_login_at: just(inactive, -60), created_at: just(inactive, -400) };
      await user('ret-w-due', 'warned.due@example.org', { ...old, inactivity_warned_at: just(NOW, -31) });
      await user('ret-w-wait', 'warned.wait@example.org', { ...old, inactivity_warned_at: just(NOW, -29) });
      const a = await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 });
      expect(a).toMatchObject({ inactive: 1, warned: 0 });
      expect(await exists('ret-w-due')).toBe(false);
      expect(await exists('ret-w-wait')).toBe(true);
      const e = (await h.ledger.entries()).find((x) => x.subjectKey === subjectKey('warned.due@example.org', TEST_GDPR_KEY))!;
      expect(e).toMatchObject({ actor: 'admin', reason: 'inactivity' });
    });

    it('signing in answers the warning', async () => {
      await clean();
      await user('ret-back', 'came.back@example.org', { last_login_at: just(inactive, -60), created_at: just(inactive, -400), inactivity_warned_at: just(NOW, -31) });
      const { provision } = await import('../src/platform/identity.js');
      await provision(h.t.db, { sub: 'ret-back', email: 'came.back@example.org', name: 'Came Back', idpRoles: [], idpGroups: [] }, { platformIdps: [] });
      expect((await h.t.owner.selectFrom('users').select('inactivity_warned_at').where('id', '=', 'ret-back').executeTakeFirstOrThrow()).inactivity_warned_at).toBeNull();
      await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 });
      expect(await exists('ret-back')).toBe(true);
    });

    it('never touches platform admins, restricted accounts or the sole admin of an org', async () => {
      await clean();
      const old = { last_login_at: just(inactive, -60), created_at: just(inactive, -400), inactivity_warned_at: just(NOW, -60) };
      await user('ret-admin', 'plat.admin@example.org', { ...old, platform_roles: ['platform_admin'] });
      await user('ret-restr', 'restr@example.org', { ...old, restricted_at: NOW });
      await user('ret-sole', 'sole.inactive@example.org', old);
      const org = await h.t.owner.insertInto('orgs').values({ slug: 'ret-sole-org', name: 'Ret Sole', settings: '{}' } as never).returning('id').executeTakeFirstOrThrow();
      await h.t.owner.insertInto('memberships').values({ org_id: org.id, user_id: 'ret-sole', roles: ['org_admin'], status: 'active', source: 'local' } as never).execute();
      const a = await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 });
      expect(a).toMatchObject({ inactive: 0, skipped: 1 });
      for (const id of ['ret-admin', 'ret-restr', 'ret-sole']) expect(await exists(id)).toBe(true);
    });

    it('no warning sent, no deletion later: a failed mail comes round again', async () => {
      await clean();
      await user('ret-m', 'mail.fails@example.org', { last_login_at: just(inactive, -5), created_at: just(inactive, -400) });
      const orig = h.mailer.send;
      h.mailer.send = async () => {
        throw new Error('smtp down');
      };
      const a = await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 });
      h.mailer.send = orig;
      expect(a).toMatchObject({ warned: 0, failed: 1 });
      expect((await h.t.owner.selectFrom('users').select('inactivity_warned_at').where('id', '=', 'ret-m').executeTakeFirstOrThrow()).inactivity_warned_at).toBeNull();
      expect((await h.gdpr.sweepAccounts({ ...cfg, closedDays: 0 })).warned).toBe(1);
      await clean();
    });

    it('runs from the sweep, with counts and no addresses in the log; 0 turns it off', async () => {
      await clean();
      await user('ret-s', 'sweep.closed@example.org', { closed_at: just(NOW, -100) });
      lines.length = 0;
      const off = await sweepRetention({ db: h.t.db, accounts: h.gdpr, config: { ...DEFAULT_RETENTION, closedDays: 0, inactiveMonths: 0 }, now: () => NOW, log });
      expect(off.closedAccounts).toBeNull();
      expect(await exists('ret-s')).toBe(true);
      const on = await sweepRetention({ db: h.t.db, accounts: h.gdpr, config: { ...DEFAULT_RETENTION, inactiveMonths: 0 }, now: () => NOW, log });
      expect(on.closedAccounts).toBe(1);
      expect(JSON.stringify(lines)).not.toContain('@');
    });

    it('the settings have their defaults, and 0 means off', () => {
      expect(retentionConfig({})).toMatchObject({ closedDays: 90, inactiveMonths: 24, warningDays: 30 });
      expect(retentionConfig({ CT_RETENTION_CLOSED_DAYS: '30', CT_RETENTION_INACTIVE_MONTHS: '0', CT_RETENTION_INACTIVE_WARNING_DAYS: '7' })).toMatchObject({ closedDays: 30, inactiveMonths: 0, warningDays: 7 });
    });
  });

  it('works in batches and finishes what a batch left', async () => {
    const old = monthsBefore(NOW, 30);
    await h.t.owner.insertInto('waitlist_entries').values(Array.from({ length: 7 }, (_, i) => ({ email: `b${i}@example.org`, consent_at: old, created_at: old })) as never).execute();
    expect((await run({}, { batch: 3 })).waitlist).toBe(7);
  });

  it('one failing part does not stop the others, and the log line names no one', async () => {
    const old = monthsBefore(NOW, 30);
    await h.t.owner.insertInto('waitlist_entries').values({ email: 'loggedperson@example.org', consent_at: old, created_at: old } as never).execute();
    lines.length = 0;
    const failingLedger = { ...h.ledger, prune: async () => { throw new Error('ledger@example.org is down'); } } as never;
    const r = await sweepRetention({ db: h.t.db, waitlist: h.waitlist, ledger: failingLedger, config: DEFAULT_RETENTION, now: () => NOW, log });
    expect(r.failed).toEqual(['ledger']);
    expect(r.waitlist).toBe(1);
    expect(JSON.stringify(lines)).not.toContain('@');
    expect(lines.length).toBeGreaterThan(0);
  });
});
