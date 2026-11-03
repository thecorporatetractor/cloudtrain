import { sql, type Kysely } from 'kysely';

/*
 * The gateway serves requests as the RLS-bound app role. The schema owner (or
 * any superuser / BYPASSRLS role) ignores row-level security, so a gateway
 * connected as one would read across tenants. Migrations run as the owner in a
 * separate Job (deploy/charts/cloudtrain, gateway.migrate); the gateway only
 * waits for them, as the app role.
 */

export interface RoleFacts {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  /** Owner of the tenant tables (public.users), null before the first migration. */
  tableOwner: string | null;
  /**
   * Whether the role is the table owner or a (direct or indirect) member of it.
   * Postgres skips row-level security for any role with the owner's privileges
   * (ownership checks follow inherited membership), and a member without
   * INHERIT can still SET ROLE to the owner.
   */
  ownerMember: boolean;
}

export async function roleFacts(db: Kysely<unknown>): Promise<RoleFacts> {
  const r = await sql<{ role: string; superuser: boolean; bypass_rls: boolean; table_owner: string | null; owner_member: boolean | null }>`
    SELECT current_user AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls, t.tableowner AS table_owner,
           CASE WHEN t.tableowner IS NULL THEN false ELSE pg_has_role(current_user, t.tableowner, 'MEMBER') END AS owner_member
    FROM pg_roles r
    LEFT JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = 'users'
    WHERE r.rolname = current_user`.execute(db);
  const row = r.rows[0]!;
  return { role: row.role, superuser: row.superuser, bypassRls: row.bypass_rls, tableOwner: row.table_owner, ownerMember: row.owner_member === true };
}

/** Why `f` must not serve requests, or null when it is an RLS-bound role. */
export function roleProblem(f: RoleFacts): string | null {
  if (f.superuser) return `database role ${f.role} is a superuser`;
  if (f.bypassRls) return `database role ${f.role} has BYPASSRLS`;
  if (f.tableOwner && f.tableOwner === f.role) return `database role ${f.role} owns the schema (row-level security does not apply to the owner)`;
  if (f.tableOwner && f.ownerMember) return `database role ${f.role} is a member of the schema owner ${f.tableOwner} (row-level security does not apply to it)`;
  return null;
}

/** Names of the applied migrations; readable by the app role (migrateToLatest grants it). Null before the first run. */
export async function appliedMigrations(db: Kysely<unknown>): Promise<string[] | null> {
  const t = await sql<{ t: string | null }>`SELECT to_regclass('public.kysely_migration')::text AS t`.execute(db);
  if (!t.rows[0]?.t) return null;
  const r = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db);
  return r.rows.map((x) => x.name);
}

/** The migrations `want` that are not applied yet ([] = schema ready). Extra applied ones (a newer release) are fine. */
export function missingMigrations(want: string[], applied: string[] | null): string[] {
  const have = new Set(applied ?? []);
  return want.filter((n) => !have.has(n));
}

/**
 * Waits until every migration this code knows is applied (the migrate Job
 * runs them as the owner), polling as the app role.
 */
export async function waitForSchema(db: Kysely<unknown>, want: string[], opts: { timeoutMs: number; pollMs?: number; log?: (msg: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + opts.timeoutMs;
  let last = '';
  for (;;) {
    let missing: string[];
    try {
      missing = missingMigrations(want, await appliedMigrations(db));
    } catch (e) {
      missing = [`(database not reachable: ${(e as Error).message})`];
    }
    if (missing.length === 0) return;
    const msg = `waiting for migrations: ${missing.join(', ')}`;
    if (msg !== last) opts.log?.(msg);
    last = msg;
    if (now() >= deadline) throw new Error(`schema not ready after ${Math.round(opts.timeoutMs / 1000)}s; ${msg}`);
    await sleep(opts.pollMs ?? 2000);
  }
}
