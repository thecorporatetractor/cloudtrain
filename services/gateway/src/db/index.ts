import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';
import * as m0001 from './migrations/0001_platform.js';
import * as m0002 from './migrations/0002_invitation_lookup.js';
import * as m0003 from './migrations/0003_exams.js';
import * as m0004 from './migrations/0004_learner_goals.js';
import * as m0005 from './migrations/0005_ctf_answers.js';
import * as m0006 from './migrations/0006_ctf_events.js';
import type { DB } from './schema.js';

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

// bigint (count(*), bigserial) as number; timestamps stay Date.
pg.types.setTypeParser(20, (v) => Number(v));

export function createDb(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client that loses its connection (server restart, 57P01) emits 'error' on the pool;
  // with no listener that is an uncaught exception. The pool drops the dead client and the next
  // query opens a new one, so log and carry on.
  pool.on('error', (err) => console.error('pg pool: idle client error:', err.message));
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/** The RLS context of one transaction. */
export interface TenantContext {
  /** Active org; omitted = no tenant rows visible. */
  orgId?: string | null;
  /** The caller (Keycloak sub). */
  userId?: string | null;
  /** Platform-admin code paths only: policies admit every org. */
  platform?: boolean;
}

/**
 * Runs `fn` in a transaction with `app.org_id`, `app.user_id` and
 * `app.platform` set LOCAL (they vanish at commit/rollback, so a pooled
 * connection never leaks one request's tenant into the next).
 */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT set_config('app.org_id', ${ctx.orgId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true), set_config('app.platform', ${ctx.platform ? 'on' : ''}, true)`.execute(tx);
    return fn(tx);
  });
}

/** Migrations in order. `appRole` is the role that gets DML grants (RLS-bound). */
export function migrationProvider(appRole: string): MigrationProvider {
  const bind = (mod: { up: (db: Kysely<unknown>, appRole: string) => Promise<void>; down: (db: Kysely<unknown>) => Promise<void> }): Migration => ({
    up: (db) => mod.up(db, appRole),
    down: (db) => mod.down(db),
  });
  return { getMigrations: async () => ({ '0001_platform': bind(m0001), '0002_invitation_lookup': bind(m0002), '0003_exams': bind(m0003), '0004_learner_goals': bind(m0004), '0005_ctf_answers': bind(m0005), '0006_ctf_events': bind(m0006) }) };
}

/** Applies pending migrations; run as the schema owner. */
export async function migrateToLatest(ownerDb: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<string[]> {
  const migrator = new Migrator({ db: ownerDb, provider: migrationProvider(appRole) });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
