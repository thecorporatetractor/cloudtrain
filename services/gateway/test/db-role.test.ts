import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationProvider } from '../src/db/index.js';
import { appliedMigrations, missingMigrations, roleFacts, roleProblem, waitForSchema } from '../src/db/role.js';
import { createTestDb, pgAvailable, type TestDb } from './pg.js';

const available = await pgAvailable();
const k = (db: unknown) => db as Kysely<unknown>;

describe('database role guard (pure)', () => {
  it('refuses superusers, BYPASSRLS and the schema owner; accepts an RLS-bound role', () => {
    const base = { role: 'cloudtrain_app', superuser: false, bypassRls: false, tableOwner: 'cloudtrain_owner', ownerMember: false };
    expect(roleProblem(base)).toBeNull();
    expect(roleProblem({ ...base, superuser: true })).toMatch(/superuser/);
    expect(roleProblem({ ...base, bypassRls: true })).toMatch(/BYPASSRLS/);
    expect(roleProblem({ ...base, role: 'cloudtrain_owner', ownerMember: true })).toMatch(/owns the schema/);
    // Granted the owner role (common on managed Postgres): owner privileges, so no RLS either.
    expect(roleProblem({ ...base, ownerMember: true })).toMatch(/member of the schema owner cloudtrain_owner/);
    expect(roleProblem({ ...base, tableOwner: null })).toBeNull();
  });

  it('a schema ahead of the code is ready; one behind is not', () => {
    expect(missingMigrations(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
    expect(missingMigrations(['a', 'b'], ['a'])).toEqual(['b']);
    expect(missingMigrations(['a'], null)).toEqual(['a']);
  });

  it('waitForSchema gives up after the timeout with what is missing', async () => {
    let t = 0;
    const db = { never: true } as unknown as Kysely<unknown>; // every query throws: not reachable
    await expect(waitForSchema(db, ['0001'], { timeoutMs: 5000, pollMs: 1000, now: () => t, sleep: async (ms) => void (t += ms) })).rejects.toThrow(/schema not ready after 5s; waiting for migrations: \(database not reachable/);
  });
});

describe.skipIf(!available)('database role guard (Postgres)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await t?.drop();
  });

  it('the app role passes, the owner does not', async () => {
    const app = await roleFacts(k(t.db));
    expect(app.ownerMember).toBe(false);
    expect(roleProblem(app)).toBeNull();
    const owner = await roleFacts(k(t.owner));
    expect(owner.ownerMember).toBe(true);
    expect(roleProblem(owner)).toMatch(/owns the schema/);
  });

  it('the app role can read which migrations ran, and waits for none once migrated', async () => {
    const want = Object.keys(await migrationProvider('cloudtrain_app').getMigrations());
    expect(await appliedMigrations(k(t.db))).toEqual(expect.arrayContaining(want));
    await expect(waitForSchema(k(t.db), want, { timeoutMs: 0 })).resolves.toBeUndefined();
    await expect(waitForSchema(k(t.db), [...want, '9999_from_the_future'], { timeoutMs: 0 })).rejects.toThrow(/9999_from_the_future/);
  });
});
