import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { loadConfig, repoRoot } from '../config.js';
import { loadContent } from '../content/load.js';
import { createDb, migrateToLatest, migrationProvider } from './index.js';
import { roleFacts, roleProblem, waitForSchema } from './role.js';
import { defaultPeopleFile, readPeople, seed } from './seed.js';

/*
 * Database tasks, run as the schema owner (CT_DATABASE_OWNER_URL):
 *   tsx src/db/cli.ts migrate
 *   tsx src/db/cli.ts seed [--if-empty]     DEV ONLY fictional data (deploy/dev/people.json)
 * and as the app role (CT_DATABASE_URL), the gateway's init container:
 *   tsx src/db/cli.ts wait                  until every migration of this build is applied
 *                                           (CT_MIGRATE_WAIT_SECONDS, default 600) and the
 *                                           role is RLS-bound
 */
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  if (cmd === 'wait') {
    const db = createDb(config.databaseUrl, 1) as unknown as Kysely<unknown>;
    try {
      const want = Object.keys(await migrationProvider(config.databaseAppRole).getMigrations());
      await waitForSchema(db, want, { timeoutMs: Number(process.env.CT_MIGRATE_WAIT_SECONDS ?? 600) * 1000, log: (m) => console.log(m) });
      const problem = roleProblem(await roleFacts(db));
      if (problem) throw new Error(`refusing to serve: ${problem}; CT_DATABASE_URL must be the RLS-bound app role`);
      console.log('schema ready');
    } finally {
      await db.destroy();
    }
    return;
  }
  if (!config.databaseOwnerUrl) throw new Error('CT_DATABASE_OWNER_URL is not set');
  if (cmd === 'migrate') {
    const raw = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: config.databaseOwnerUrl, max: 1 }) }) });
    const done = await migrateToLatest(raw, config.databaseAppRole);
    await raw.destroy();
    console.log(done.length ? `applied: ${done.join(', ')}` : 'schema up to date');
    return;
  }
  if (cmd === 'seed') {
    if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed fictional dev data with NODE_ENV=production');
    const db = createDb(config.databaseOwnerUrl, 2);
    try {
      if (args.includes('--if-empty')) {
        const n = await db.selectFrom('orgs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
        if (Number(n.n) > 0) {
          console.log(`seed skipped: ${n.n} org(s) present (run "task dev:seed" to reseed)`);
          return;
        }
      }
      const content = await loadContent(config.contentDir, config.extraLabDirs);
      const people = await readPeople(defaultPeopleFile(repoRoot));
      const s = await seed(db, content, people);
      console.log(`seeded: ${s.orgs} orgs, ${s.users} users, ${s.attempts} attempts, ${s.assignments} assignments`);
    } finally {
      await db.destroy();
    }
    return;
  }
  throw new Error(`usage: cli.ts migrate | wait | seed [--if-empty]`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
