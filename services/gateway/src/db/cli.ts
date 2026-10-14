import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { loadConfig, repoRoot } from '../config.js';
import { loadContent } from '../content/load.js';
import { createDb, migrateToLatest } from './index.js';
import { defaultPeopleFile, readPeople, seed } from './seed.js';

/*
 * Database tasks, run as the schema owner (CT_DATABASE_OWNER_URL):
 *   tsx src/db/cli.ts migrate
 *   tsx src/db/cli.ts seed [--if-empty]     DEV ONLY fictional data (deploy/dev/people.json)
 */
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
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
  throw new Error(`usage: cli.ts migrate | seed [--if-empty]`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
