import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/index.js';
import { as, harness, Q, type Harness } from './harness.js';
import { pgAvailable } from './pg.js';

const available = await pgAvailable();

describe.skipIf(!available)('waitlist in Postgres (unique lowercased email, RLS, admin export)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => h?.close());

  const join = (payload: object) => h.app.inject({ method: 'POST', url: '/api/public/waitlist', payload });

  it('inserts anonymously, treats a different case as a duplicate and keeps one row', async () => {
    const first = await join({ email: 'Ada@Example.com', organisation: 'Analytical Engines', role: 'Engineer or developer', interest: 'enterprise', consent: true });
    expect(first.statusCode).toBe(201);
    const again = await join({ email: 'ada@example.COM', consent: true });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'duplicate' });
    const rows = await h.t.owner.selectFrom('waitlist_entries').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'Ada@Example.com', organisation: 'Analytical Engines', interest: 'enterprise' });
    expect(rows[0]!.consent_at).toBeInstanceOf(Date);
  });

  it('the database refuses what the endpoint would: unknown interest, empty email, duplicate by case', async () => {
    const bad = (v: Record<string, unknown>) => h.t.owner.insertInto('waitlist_entries').values({ email: 'x@y.io', consent_at: new Date(), ...v } as never).execute();
    await expect(bad({ interest: 'both' })).rejects.toThrow();
    await expect(bad({ email: 'a' })).rejects.toThrow();
    await expect(bad({ email: 'ADA@example.com' })).rejects.toThrow(/waitlist_entries_email/);
  });

  it('RLS: the app role can insert but not read or change entries without the platform context', async () => {
    await withTenant(h.t.db, {}, async (tx) => {
      const seen = await sql<{ n: number }>`SELECT count(*)::int AS n FROM waitlist_entries`.execute(tx);
      expect(seen.rows[0]!.n).toBe(0);
    });
    await withTenant(h.t.db, { orgId: h.orgs.quillmoor }, async (tx) => {
      const seen = await sql<{ n: number }>`SELECT count(*)::int AS n FROM waitlist_entries`.execute(tx);
      expect(seen.rows[0]!.n).toBe(0);
    });
    await withTenant(h.t.db, { platform: true }, async (tx) => {
      const seen = await sql<{ n: number }>`SELECT count(*)::int AS n FROM waitlist_entries`.execute(tx);
      expect(seen.rows[0]!.n).toBe(1);
    });
    await withTenant(h.t.db, {}, async (tx) => {
      const r = await sql`UPDATE waitlist_entries SET role = 'x'`.execute(tx).catch((e: Error) => e);
      expect(r).toBeInstanceOf(Error); // no UPDATE grant
    });
  });

  it('only a platform admin lists and exports', async () => {
    await join({ email: 'grace@example.org', consent: true });
    expect((await as(h, Q.lucas).get('/api/platform/waitlist')).statusCode).toBe(403);
    expect((await as(h, Q.priya).get('/api/platform/waitlist.csv')).statusCode).toBe(403);
    const list = (await as(h, Q.rhea).get('/api/platform/waitlist')).json();
    expect(list.total).toBe(2);
    expect(list.entries[0].email).toBe('grace@example.org');
    const csv = await as(h, Q.rhea).get('/api/platform/waitlist.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Ada@Example.com');
  });
});
