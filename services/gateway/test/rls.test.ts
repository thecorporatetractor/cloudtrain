import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import { TENANT_TABLES as PLATFORM_TABLES } from '../src/db/migrations/0001_platform.js';
import { EXAM_TENANT_TABLES } from '../src/db/migrations/0003_exams.js';
import { GOAL_TENANT_TABLES } from '../src/db/migrations/0004_learner_goals.js';

/** Every tenant table of every migration. */
const TENANT_TABLES = [...PLATFORM_TABLES, ...EXAM_TENANT_TABLES, ...GOAL_TENANT_TABLES];
import { defaultPeopleFile, readPeople, seed } from '../src/db/seed.js';
import { createTestDb, pgAvailable, type TestDb } from './pg.js';
import { realContent, repo } from './fakes.js';

const available = await pgAvailable();

describe.skipIf(!available)('row-level security', () => {
  let t: TestDb;
  let quillmoor: string;
  let acme: string;

  beforeAll(async () => {
    t = await createTestDb();
    await seed(t.owner, await realContent(), await readPeople(defaultPeopleFile(repo)));
    const orgs = await t.owner.selectFrom('orgs').select(['id', 'slug']).execute();
    quillmoor = orgs.find((o) => o.slug === 'quillmoor')!.id;
    acme = orgs.find((o) => o.slug === 'acme-freight')!.id;
  }, 60_000);
  afterAll(async () => t?.drop());

  it('connects as a role that is neither superuser nor BYPASSRLS nor table owner', async () => {
    const r = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(t.db);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owners = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`.execute(t.db);
    expect(owners.rows[0]!.n).toBe(0);
  });

  it('has RLS enabled with a policy on every tenant table', async () => {
    const r = await sql<{ relname: string; relrowsecurity: boolean }>`SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${[...TENANT_TABLES, 'orgs', 'users']})`.execute(t.db);
    expect(r.rows).toHaveLength(TENANT_TABLES.length + 2);
    for (const row of r.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('sees no tenant rows without app.org_id', async () => {
    await withTenant(t.db, {}, async (tx) => {
      for (const table of TENANT_TABLES) {
        const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(tx);
        expect(r.rows[0]!.n, table).toBe(0);
      }
      expect(await tx.selectFrom('orgs').selectAll().execute()).toEqual([]);
    });
  });

  it('sees exactly its own org in every tenant table', async () => {
    for (const table of TENANT_TABLES) {
      const own = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)} WHERE org_id = ${quillmoor}`.execute(t.owner);
      const seen = await withTenant(t.db, { orgId: quillmoor }, async (tx) => {
        const all = await sql<{ n: number; foreign: number }>`SELECT count(*)::int AS n, count(*) FILTER (WHERE org_id <> ${quillmoor})::int AS foreign FROM ${sql.table(table)}`.execute(tx);
        return all.rows[0]!;
      });
      expect(seen.foreign, table).toBe(0);
      expect(seen.n, table).toBe(own.rows[0]!.n);
    }
    const attempts = await withTenant(t.db, { orgId: quillmoor }, (tx) => tx.selectFrom('lab_attempts').select('org_id').execute());
    expect(attempts.length).toBeGreaterThan(0);
  });

  it('only shows users who are members of the active org (plus the caller)', async () => {
    const names = await withTenant(t.db, { orgId: quillmoor, userId: 'a1000000-0000-4000-8000-000000000001' }, (tx) => tx.selectFrom('users').select('email').execute());
    expect(names.length).toBeGreaterThan(5);
    expect(names.every((u) => u.email.endsWith('@quillmoor.example'))).toBe(true);
    const status = await withTenant(t.db, { orgId: quillmoor }, (tx) => tx.selectFrom('assignment_status').select('org_id').execute());
    expect(status.every((s) => s.org_id === quillmoor)).toBe(true);
  });

  it('rejects cross-org writes', async () => {
    // Insert a row for another org.
    await expect(withTenant(t.db, { orgId: quillmoor }, (tx) => tx.insertInto('teams').values({ org_id: acme, name: 'Smuggled' }).execute())).rejects.toThrow(/row-level security/);
    await expect(
      withTenant(t.db, { orgId: quillmoor }, (tx) => tx.insertInto('audit_log').values({ org_id: acme, action: 'x', target_type: 't', target_id: '1', details: '{}', actor_id: null, actor_name: null, target_label: null, ip: null }).execute()),
    ).rejects.toThrow(/row-level security/);
    // Update / delete another org's rows: nothing matches.
    const upd = await withTenant(t.db, { orgId: quillmoor }, (tx) => tx.updateTable('teams').set({ name: 'Hijacked' }).where('org_id', '=', acme).executeTakeFirst());
    expect(Number(upd.numUpdatedRows)).toBe(0);
    const del = await withTenant(t.db, { orgId: quillmoor }, (tx) => tx.deleteFrom('lab_attempts').where('org_id', '=', acme).executeTakeFirst());
    expect(Number(del.numDeletedRows)).toBe(0);
    // Moving an own row into another org fails the WITH CHECK.
    await expect(withTenant(t.db, { orgId: quillmoor }, (tx) => tx.updateTable('teams').set({ org_id: acme }).where('org_id', '=', quillmoor).execute())).rejects.toThrow(/row-level security/);
    const acmeTeams = await t.owner.selectFrom('teams').select('name').where('org_id', '=', acme).execute();
    expect(acmeTeams.map((x) => x.name)).not.toContain('Hijacked');
    expect(acmeTeams.map((x) => x.name)).not.toContain('Smuggled');
  });

  it('keeps the audit log append-only', async () => {
    await withTenant(t.db, { orgId: quillmoor }, (tx) => tx.insertInto('audit_log').values({ org_id: quillmoor, action: 'test.append', target_type: 't', target_id: '1', details: '{}', actor_id: null, actor_name: null, target_label: null, ip: null }).execute());
    await expect(withTenant(t.db, { orgId: quillmoor }, (tx) => tx.updateTable('audit_log').set({ action: 'tampered' }).execute())).rejects.toThrow(/permission denied/);
    await expect(withTenant(t.db, { orgId: quillmoor }, (tx) => tx.deleteFrom('audit_log').execute())).rejects.toThrow(/permission denied/);
  });

  it('does not leak the tenant setting across pooled transactions', async () => {
    await withTenant(t.db, { orgId: quillmoor }, (tx) => tx.selectFrom('teams').select('id').execute());
    const r = await sql<{ v: string | null }>`SELECT current_setting('app.org_id', true) AS v`.execute(t.db);
    expect(r.rows[0]!.v ?? '').toBe('');
  });

  it('routes logins through the narrow definer functions only', async () => {
    const d = await sql<{ slug: string; idp_alias: string | null; enforced: boolean }>`SELECT slug, idp_alias, enforced FROM auth_org_for_domain('acme-freight.example')`.execute(t.db);
    expect(d.rows[0]).toEqual({ slug: 'acme-freight', idp_alias: 'acme-idp', enforced: true });
    const m = await sql<{ slug: string }>`SELECT slug FROM auth_user_memberships('a1000000-0000-4000-8000-000000000002')`.execute(t.db);
    expect(m.rows.map((r) => r.slug)).toEqual(['quillmoor']);
  });

  it('lets platform code paths see every org only when app.platform is on', async () => {
    const orgs = await withTenant(t.db, { platform: true }, (tx) => tx.selectFrom('orgs').select('slug').execute());
    expect(orgs.map((o) => o.slug).sort()).toEqual(['acme-freight', 'quillmoor']);
  });
});
