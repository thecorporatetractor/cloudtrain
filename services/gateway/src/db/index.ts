import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';
import * as m0001 from './migrations/0001_platform.js';
import * as m0002 from './migrations/0002_invitation_lookup.js';
import * as m0003 from './migrations/0003_exams.js';
import * as m0004 from './migrations/0004_learner_goals.js';
import * as m0005 from './migrations/0005_ctf_answers.js';
import * as m0006 from './migrations/0006_ctf_events.js';
import * as m0007 from './migrations/0007_billing.js';
import * as m0008 from './migrations/0008_waitlist.js';
import * as m0009 from './migrations/0009_billing_compute.js';
import * as m0010 from './migrations/0010_gdpr.js';
import * as m0011 from './migrations/0011_gdpr_lifecycle.js';
import * as m0012 from './migrations/0012_billing_usage_kind.js';
import * as m0013 from './migrations/0013_billing_usage_kind_validate.js';
import * as m0014 from './migrations/0014_session_reservations.js';
import * as m0015 from './migrations/0015_lab_hint_reveals.js';
import type { DB } from './schema.js';

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

// bigint (count(*), bigserial) as number; timestamps stay Date.
pg.types.setTypeParser(20, (v) => Number(v));

export function createDb(connectionString: string, max = 10): Db {
  // A request that cannot get a connection fails after 10 s instead of waiting
  // forever, so a saturated pool degrades into errors, never a hung gateway.
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 10_000 });
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
  return { getMigrations: async () => ({ '0001_platform': bind(m0001), '0002_invitation_lookup': bind(m0002), '0003_exams': bind(m0003), '0004_learner_goals': bind(m0004), '0005_ctf_answers': bind(m0005), '0006_ctf_events': bind(m0006), '0007_billing': bind(m0007), '0008_waitlist': bind(m0008), '0009_billing_compute': bind(m0009), '0010_gdpr': bind(m0010), '0011_gdpr_lifecycle': bind(m0011), '0012_billing_usage_kind': bind(m0012), '0013_billing_usage_kind_validate': bind(m0013), '0014_session_reservations': bind(m0014), '0015_lab_hint_reveals': bind(m0015) }) };
}

/**
 * Applies pending migrations, one transaction each; run as the schema owner. Kysely's
 * migrateToLatest runs every pending migration in one transaction, so a lock taken by an early
 * one (ALTER TABLE: ACCESS EXCLUSIVE) would be held through all later ones; migrateUp applies
 * one per call, each committed before the next starts.
 */
export async function migrateToLatest(ownerDb: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<string[]> {
  const migrator = new Migrator({ db: ownerDb, provider: migrationProvider(appRole) });
  const applied: string[] = [];
  for (;;) {
    const { error, results } = await migrator.migrateUp();
    if (error) throw error instanceof Error ? error : new Error(String(error));
    const done = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
    if (done.length === 0) break;
    applied.push(...done);
  }
  // The gateway (app role) waits on this list before it serves (src/db/role.ts, waitForSchema).
  // After the loop, not inside it: the loop only ends here, so the grant is never skipped.
  await sql`GRANT SELECT ON kysely_migration TO ${sql.id(appRole)}`.execute(ownerDb);
  return applied;
}
