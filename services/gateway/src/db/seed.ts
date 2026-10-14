import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import type { Content } from '../content/load.js';
import { endAttempt, recordRun, startAttempt } from '../learner/learning.js';
import { expectedSuccess, DIFFICULTY } from '../learner/model.js';
import { mapSsoClaims } from '../platform/identity.js';
import type { Db } from './index.js';

/*
 * DEV ONLY seed: two fictional orgs from deploy/dev/people.json, every role,
 * teams, a cohort, assignments and plausible attempt history over the real
 * content labs (graded through the same recordRun() the gateway uses, so
 * skill states come out of the real learner model).
 *
 * Acme Freight people are brokered from acme-idp: their Keycloak sub is only
 * known after their first login, so the seed stores them as `pending-<idp id>`
 * and JIT provisioning claims the row by email on first login.
 */

interface PersonDoc {
  id?: string;
  idpId?: string;
  username: string;
  first: string;
  last: string;
  title: string;
  email?: string;
  roles?: string[];
  appRoles?: string[];
  groups?: string[];
  teams?: [string, 'member' | 'manager'][];
  profile?: 'strong' | 'steady' | 'struggling' | 'new';
  seed?: boolean;
}

interface OrgDoc {
  slug: string;
  name: string;
  domains: string[];
  login: 'local' | 'sso';
  idp?: { alias: string; displayName: string };
  teams: { key: string; name: string; parent?: string }[];
  groupMappings?: { group: string; roles: string[]; teams: [string, 'member' | 'manager'][] }[];
  people: PersonDoc[];
  cohort?: { name: string; instructor: string; members: string[]; labs: string[] };
}

export interface PeopleDoc {
  password: string;
  orgs: OrgDoc[];
  platformAdmins: PersonDoc[];
}

export async function readPeople(file: string): Promise<PeopleDoc> {
  return JSON.parse(await readFile(file, 'utf8')) as PeopleDoc;
}

/** Deterministic PRNG (mulberry32) from a string key. */
function rng(key: string): () => number {
  let a = createHash('sha256').update(key).digest().readUInt32BE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ABILITY: Record<string, number> = { strong: 0.72, steady: 0.55, struggling: 0.38, new: 0.3 };
const ATTEMPTS: Record<string, number> = { strong: 9, steady: 7, struggling: 6, new: 1 };
const DAY = 86_400_000;

export const userIdOf = (p: PersonDoc) => p.id ?? `pending-${p.idpId}`;
export const emailOf = (p: PersonDoc, domain: string) => (p.email ?? `${p.username}@${domain}`).toLowerCase();

export interface SeedSummary {
  orgs: number;
  users: number;
  attempts: number;
  assignments: number;
}

/** Removes the seeded orgs (cascade) and seeded users, then seeds again. Runs as the schema owner. */
export async function seed(db: Db, content: Content, people: PeopleDoc, now = new Date()): Promise<SeedSummary> {
  const slugs = people.orgs.map((o) => o.slug);
  await db.deleteFrom('orgs').where('slug', 'in', slugs).execute();
  const ids = [...people.orgs.flatMap((o) => o.people.map(userIdOf)), ...people.platformAdmins.map(userIdOf)];
  const emails = [...people.orgs.flatMap((o) => o.people.map((p) => emailOf(p, o.domains[0]!))), ...people.platformAdmins.map((p) => emailOf(p, 'cloudtrain-ops.example'))];
  await db.deleteFrom('users').where((eb) => eb.or([eb('id', 'in', ids), eb(sql`lower(email)`, 'in', emails)])).execute();

  const summary: SeedSummary = { orgs: 0, users: 0, attempts: 0, assignments: 0 };

  for (const pa of people.platformAdmins) {
    await db.insertInto('users').values({ id: userIdOf(pa), email: emailOf(pa, 'cloudtrain-ops.example'), name: `${pa.first} ${pa.last}`, title: pa.title, platform_roles: ['platform_admin'] }).execute();
    summary.users++;
  }

  for (const o of people.orgs) {
    const domain = o.domains[0]!;
    const org = await db
      .insertInto('orgs')
      .values({ slug: o.slug, name: o.name, settings: JSON.stringify({ defaultSessionMinutes: 60, allowLocalLogin: o.login === 'local', timezone: 'Europe/Amsterdam' }) })
      .returning('id')
      .executeTakeFirstOrThrow();
    const orgId = org.id;
    summary.orgs++;
    for (const d of o.domains) {
      await db.insertInto('org_domains').values({ org_id: orgId, domain: d, verification_token: randomBytes(12).toString('hex'), verified_at: new Date(now.getTime() - 30 * DAY) }).execute();
    }
    await db.insertInto('quotas').values({ org_id: orgId, max_concurrent_sessions: o.slug === 'acme-freight' ? 10 : 25, monthly_lab_hours: o.slug === 'acme-freight' ? 200 : 600, max_session_minutes: 120 }).execute();

    const teamIds = new Map<string, string>();
    for (const t of o.teams) {
      const row = await db.insertInto('teams').values({ org_id: orgId, name: t.name, parent_id: t.parent ? teamIds.get(t.parent)! : null }).returning('id').executeTakeFirstOrThrow();
      teamIds.set(t.key, row.id);
    }
    const mappings = (o.groupMappings ?? []).map((m) => ({ group: m.group, roles: m.roles, teams: m.teams.map(([k, role]) => ({ teamId: teamIds.get(k)!, role })) }));
    if (o.idp) {
      await db
        .insertInto('sso_connections')
        .values({
          org_id: orgId,
          kc_alias: o.idp.alias,
          type: 'oidc',
          display_name: o.idp.displayName,
          enforced: true,
          status: 'active',
          group_mappings: JSON.stringify(mappings),
          default_roles: ['learner'],
          settings: JSON.stringify({ discoveryUrl: 'http://localhost:8180/realms/acme-idp/.well-known/openid-configuration', clientId: 'cloudtrain-broker', scopes: ['openid', 'profile', 'email'], roleClaim: 'roles' }),
        })
        .execute();
    }

    // People: local accounts have their Keycloak id; brokered ones are pending until first login.
    const byUsername = new Map<string, string>();
    for (const p of o.people) {
      if (o.login === 'sso' && !p.seed) continue;
      const id = userIdOf(p);
      byUsername.set(p.username, id);
      await db.insertInto('users').values({ id, email: emailOf(p, domain), name: `${p.first} ${p.last}`, title: p.title }).execute();
      summary.users++;
      let roles = p.roles ?? ['learner'];
      let teams: { teamId: string; role: 'member' | 'manager'; source: 'manual' | 'sso' }[] = (p.teams ?? []).map(([k, role]) => ({ teamId: teamIds.get(k)!, role, source: 'manual' }));
      if (o.login === 'sso') {
        const mapped = mapSsoClaims({ idpRoles: p.appRoles ?? [], idpGroups: p.groups ?? [] }, mappings, ['learner']);
        roles = mapped.roles;
        teams = [...mapped.teams].map(([teamId, role]) => ({ teamId, role, source: 'sso' }));
      }
      await db.insertInto('memberships').values({ org_id: orgId, user_id: id, roles, status: 'active', source: 'seed' }).execute();
      for (const t of teams) await db.insertInto('team_members').values({ org_id: orgId, team_id: t.teamId, user_id: id, role: t.role, source: t.source }).execute();
    }

    // Cohort.
    let cohortId: string | undefined;
    if (o.cohort) {
      const c = await db
        .insertInto('cohorts')
        .values({
          org_id: orgId,
          name: o.cohort.name,
          starts_at: new Date(now.getTime() - 7 * DAY),
          ends_at: new Date(now.getTime() + 14 * DAY),
          instructor_ids: [byUsername.get(o.cohort.instructor)!],
          lab_ids: o.cohort.labs.filter((l) => content.labs.has(l)),
          created_by: byUsername.get(o.cohort.instructor)!,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      cohortId = c.id;
      for (const u of o.cohort.members) await db.insertInto('cohort_members').values({ org_id: orgId, cohort_id: c.id, user_id: byUsername.get(u)! }).execute();
    }

    // Attempt history over the real labs, in course order.
    const order = Array.from(new Set(content.paths.flatMap((p) => p.labIds))).filter((id) => content.labs.has(id));
    for (const p of o.people) {
      const id = byUsername.get(p.username);
      if (!id) continue;
      const profile = p.profile ?? ((p.roles ?? p.appRoles ?? []).length > 1 ? 'steady' : 'new');
      const rand = rng(`${o.slug}:${p.username}`);
      const count = p.profile ? ATTEMPTS[profile]! : 2;
      let ability = ABILITY[profile]!;
      for (let i = 0; i < count && order.length; i++) {
        const labId = order[Math.min(order.length - 1, Math.floor(i * 0.8 + rand() * 1.5))]!;
        const lab = content.labs.get(labId)!.lab;
        const daysAgo = Math.max(0.2, 45 - (i + 1) * (40 / (count + 1)) + rand() * 3);
        const started = new Date(now.getTime() - daysAgo * DAY);
        const sessionName = `seed-${labId.slice(0, 40)}-${createHash('sha1').update(`${id}:${i}`).digest('hex').slice(0, 6)}`;
        const d = DIFFICULTY[lab.metadata.difficulty] ?? 0.5;
        const runs = 1 + Math.floor(rand() * 3);
        const hints = rand() < 0.4 - ability * 0.3 ? 1 + Math.floor(rand() * 2) : 0;
        let minutes = lab.metadata.estimatedMinutes * (0.7 + rand() * 0.9);
        const passedSoFar = new Set<string>();
        await db.transaction().execute(async (tx) => {
          await startAttempt(tx, { orgId, userId: id, lab, sessionName, startedAt: started });
          for (let r = 1; r <= runs; r++) {
            const at = new Date(started.getTime() + (minutes * 60_000 * r) / runs);
            const checks = lab.spec.checks.map((c) => {
              const passed = passedSoFar.has(c.id) || rand() < expectedSuccess(ability + 0.08 * (r - 1), d);
              if (passed) passedSoFar.add(c.id);
              return { id: c.id, passed, weight: c.weight ?? 1, skills: [...c.skills] };
            });
            const total = checks.reduce((a, c) => a + Number(c.weight), 0) || 1;
            const score = Math.round((100 * checks.filter((c) => c.passed).reduce((a, c) => a + Number(c.weight), 0)) / total);
            await recordRun(tx, { orgId, userId: id, sessionName, lab, score, checks, hintsUsed: hints, at });
            if (score === 100) {
              minutes = (minutes * r) / runs;
              break;
            }
          }
          await endAttempt(tx, sessionName, new Date(started.getTime() + minutes * 60_000), hints);
        });
        summary.attempts++;
        ability = Math.min(0.9, ability + 0.025);
      }
    }

    // Assignments.
    const team = (k: string) => teamIds.get(k);
    const person = (u: string) => byUsername.get(u);
    const pathLabs = (pid: string) => content.paths.find((p) => p.id === pid)?.labIds ?? [];
    const assignments: { target_kind: 'team' | 'user' | 'cohort'; target_id: string | undefined; item_kind: 'lab' | 'path'; item_id: string; lab_ids: string[]; due: number; by?: string; note?: string }[] =
      o.slug === 'quillmoor'
        ? [
            { target_kind: 'team', target_id: team('yard-platform'), item_kind: 'path', item_id: 'k8s-admin-essentials', lab_ids: pathLabs('k8s-admin-essentials'), due: 10, by: 'tomasz.wierzbicki', note: 'Before the yard cluster migration.' },
            { target_kind: 'user', target_id: person('sofia.lindqvist'), item_kind: 'lab', item_id: 'etcd-snapshot-restore', lab_ids: ['etcd-snapshot-restore'], due: -3, by: 'tomasz.wierzbicki' },
            { target_kind: 'team', target_id: team('dispatch-sre'), item_kind: 'lab', item_id: 'rbac-pipeline-grant', lab_ids: ['rbac-pipeline-grant'], due: 14, by: 'ines.achterberg' },
            ...(cohortId ? [{ target_kind: 'cohort' as const, target_id: cohortId, item_kind: 'lab' as const, item_id: 'drain-yard-worker', lab_ids: ['drain-yard-worker'], due: 5, by: 'elena.duarte', note: 'Bootcamp week 2.' }] : []),
          ]
        : [
            { target_kind: 'team', target_id: team('linehaul'), item_kind: 'path', item_id: 'k8s-admin-essentials', lab_ids: pathLabs('k8s-admin-essentials'), due: 21 },
            { target_kind: 'team', target_id: team('terminal-it'), item_kind: 'lab', item_id: 'netpol-namespace-port', lab_ids: ['netpol-namespace-port'], due: -1 },
          ];
    for (const a of assignments) {
      if (!a.target_id || !a.lab_ids.every((l) => content.labs.has(l))) continue;
      const by = a.by ? person(a.by) ?? null : null;
      const row = await db
        .insertInto('assignments')
        .values({ org_id: orgId, target_kind: a.target_kind, target_id: a.target_id, item_kind: a.item_kind, item_id: a.item_id, lab_ids: a.lab_ids, due_at: new Date(now.getTime() + a.due * DAY), required: true, note: a.note ?? null, assigned_by: by, created_at: new Date(now.getTime() - 12 * DAY) })
        .returning('id')
        .executeTakeFirstOrThrow();
      summary.assignments++;
      await db
        .insertInto('audit_log')
        .values({ org_id: orgId, at: new Date(now.getTime() - 12 * DAY), actor_id: by, actor_name: a.by ?? 'seed', action: 'assignment.create', target_type: 'assignment', target_id: row.id, target_label: a.item_id, details: JSON.stringify({ seed: true, target: { kind: a.target_kind, id: a.target_id } }) })
        .execute();
    }
  }
  return summary;
}

export const defaultPeopleFile = (repoRoot: string) => path.join(repoRoot, 'deploy/dev/people.json');
