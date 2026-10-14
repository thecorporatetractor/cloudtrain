import { randomBytes } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createDb, migrateToLatest, type Db } from '../src/db/index.js';

/**
 * Throwaway databases for tests. CT_TEST_DATABASE_URL is an owner connection
 * (default: the compose Postgres, `task dev:deps`); each suite creates its own
 * database, migrates it as the owner and connects as the RLS-bound app role.
 * Without a reachable server the DB suites are skipped.
 */
export const OWNER_URL = process.env.CT_TEST_DATABASE_URL ?? 'postgres://cloudtrain_owner:owner-dev-only@127.0.0.1:55432/cloudtrain';
const APP_USER = process.env.CT_TEST_APP_USER ?? 'cloudtrain_app';
const APP_PASSWORD = process.env.CT_TEST_APP_PASSWORD ?? 'app-dev-only';

function withDb(url: string, db: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password !== undefined) u.password = password;
  return u.toString();
}

export async function pgAvailable(): Promise<boolean> {
  const c = new pg.Client({ connectionString: OWNER_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

export interface TestDb {
  /** Connected as the app role: RLS applies. */
  db: Db;
  /** Connected as the owner (seed, assertions that must see everything). */
  owner: Db;
  appUrl: string;
  ownerUrl: string;
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `ct_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: OWNER_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const ownerUrl = withDb(OWNER_URL, name);
  const appUrl = withDb(OWNER_URL, name, APP_USER, APP_PASSWORD);
  const ownerRaw = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: ownerUrl, max: 2 }) }) });
  await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(APP_USER)}`.execute(ownerRaw);
  await migrateToLatest(ownerRaw, APP_USER);
  await ownerRaw.destroy();
  const db = createDb(appUrl, 5);
  const owner = createDb(ownerUrl, 3);
  return {
    db,
    owner,
    appUrl,
    ownerUrl,
    async drop() {
      await db.destroy();
      await owner.destroy();
      const c = new pg.Client({ connectionString: OWNER_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
