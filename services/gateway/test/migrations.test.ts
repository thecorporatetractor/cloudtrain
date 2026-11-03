import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrationProvider } from '../src/db/index.js';

// The Migrator runs with Kysely's default allowUnorderedMigrations: false. A
// database that has applied migration N refuses to apply any migration named
// before N ("corrupted migrations") and the gateway does not start. So the
// provider must list 0001..N with no gap: a gap means a lower-numbered
// migration from another branch is still to come, and deploying this one first
// would make that one impossible to apply. This test is what stops a branch
// with a gap from merging before the branch that fills it.
describe('migrations', () => {
  it('are numbered 0001..N with no gap, in the provider and on disk', async () => {
    const names = Object.keys(await migrationProvider('cloudtrain_app').getMigrations());
    const nums = names.map((n) => Number(n.slice(0, 4)));
    expect(nums, `migration names: ${names.join(', ')}`).toEqual(nums.map((_, i) => i + 1));
    expect([...names].sort()).toEqual(names);
    const dir = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
    const files = readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.ts$/.test(f))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort();
    expect(files).toEqual(names);
  });
});
