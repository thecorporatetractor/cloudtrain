import { sql } from 'kysely';
import type { OrgRole, Role, TeamRole } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { ORG_ROLES } from '../authz.js';
import { withTenant, type Db, type Tx } from '../db/index.js';
import type { GroupMappingJson } from '../db/schema.js';
import { audit } from './audit.js';

/** Entra ID app-role values (and the acme-idp stand-in) -> CloudTrain roles. */
export const APP_ROLE_MAP: Record<string, Role> = {
  'CloudTrain.Learner': 'learner',
  'CloudTrain.Manager': 'manager',
  'CloudTrain.Instructor': 'instructor',
  'CloudTrain.Author': 'author',
  'CloudTrain.OrgAdmin': 'org_admin',
  'CloudTrain.PlatformAdmin': 'platform_admin',
};

const isOrgRole = (r: string): r is OrgRole => (ORG_ROLES as readonly string[]).includes(r);

/** Roles, sorted in matrix order, always including learner. */
export function normalizeRoles(roles: Iterable<string>): OrgRole[] {
  const set = new Set<string>(roles);
  set.add('learner');
  return ORG_ROLES.filter((r) => set.has(r));
}

/** The claims JIT provisioning reads from the gateway's ID token / userinfo. */
export interface IdentityClaims {
  sub: string;
  email: string;
  name: string;
  title?: string;
  /** Keycloak IdP alias the user came through (user session note), absent for local login. */
  identityProvider?: string;
  /** IdP app roles (`roles` claim of the IdP, mapped to the `idp_roles` attribute). */
  idpRoles: string[];
  /** IdP groups (`groups` claim, mapped to `idp_groups`). */
  idpGroups: string[];
}

export interface ProvisionOptions {
  /** IdP aliases whose `CloudTrain.PlatformAdmin` claim is honoured (AzarGuard's Entra tenant). */
  platformIdps: string[];
  /** Org the login started for (identity-first). */
  preferredOrgId?: string | null;
  ip?: string;
  /**
   * Whether the org may use SSO (the `sso` premium feature, docs/licensing-keys.md).
   * Without it a login through the org's IdP is refused, SSO is not enforced on its
   * domains, and local accounts keep working. Omitted: always allowed.
   */
  ssoAllowed?: (orgId: string) => Promise<boolean>;
}

export type ProvisionResult =
  | { ok: true; userId: string; orgId: string | null; platformAdmin: boolean }
  | { ok: false; reason: 'no_membership' | 'deactivated' | 'sso_required' | 'sso_unlicensed' | 'org_suspended' | 'email_conflict'; message: string; orgId?: string };

interface OrgForDomain {
  org_id: string;
  slug: string;
  name: string;
  status: string;
  verified: boolean;
  idp_alias: string | null;
  idp_name: string | null;
  enforced: boolean;
}

export async function orgForDomain(db: Db, domain: string): Promise<OrgForDomain | null> {
  const r = await sql<OrgForDomain>`SELECT * FROM auth_org_for_domain(${domain})`.execute(db);
  return r.rows[0] ?? null;
}

export async function orgForIdp(db: Db, alias: string): Promise<{ org_id: string; status: string } | null> {
  const r = await sql<{ org_id: string; status: string }>`SELECT * FROM auth_org_for_idp(${alias})`.execute(db);
  return r.rows[0] ?? null;
}

export interface MembershipInfo {
  org_id: string;
  slug: string;
  name: string;
  org_status: string;
  logo_url: string | null;
  roles: string[];
  status: string;
}

export async function membershipsOf(db: Db, userId: string): Promise<MembershipInfo[]> {
  const r = await sql<MembershipInfo>`SELECT * FROM auth_user_memberships(${userId})`.execute(db);
  return r.rows;
}

/** Roles and teams an SSO login grants: app-role values, group mappings, connection defaults. */
export function mapSsoClaims(claims: Pick<IdentityClaims, 'idpRoles' | 'idpGroups'>, mappings: GroupMappingJson[], defaultRoles: string[]) {
  const values = new Set([...claims.idpRoles, ...claims.idpGroups]);
  const roles = new Set<string>();
  let platformAdmin = false;
  for (const v of claims.idpRoles) {
    const r = APP_ROLE_MAP[v];
    if (r === 'platform_admin') platformAdmin = true;
    else if (r) roles.add(r);
  }
  const teams = new Map<string, TeamRole>();
  for (const m of mappings) {
    if (!values.has(m.group)) continue;
    m.roles.filter(isOrgRole).forEach((r) => roles.add(r));
    for (const t of m.teams) if (teams.get(t.teamId) !== 'manager') teams.set(t.teamId, t.role);
  }
  if (roles.size === 0) defaultRoles.filter(isOrgRole).forEach((r) => roles.add(r));
  return { roles: normalizeRoles(roles), teams, platformAdmin };
}

async function setTenant(tx: Tx, orgId: string | null, userId: string) {
  await sql`SELECT set_config('app.org_id', ${orgId ?? ''}, true), set_config('app.user_id', ${userId}, true)`.execute(tx);
}

/**
 * Just-in-time provisioning, run on every login: claims a pre-provisioned
 * identity (seed/invite) by email, upserts the user, applies the SSO role and
 * team mapping (re-evaluated each login), accepts pending invitations and
 * picks the active org.
 */
export async function provision(db: Db, c: IdentityClaims, opts: ProvisionOptions): Promise<ProvisionResult> {
  const email = c.email.toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const ssoOrg = c.identityProvider ? await orgForIdp(db, c.identityProvider) : null;
  const domainOrg = await orgForDomain(db, domain);

  const ssoOn = async (orgId: string) => !opts.ssoAllowed || (await opts.ssoAllowed(orgId));
  if (!c.identityProvider && domainOrg?.verified && domainOrg.enforced && (await ssoOn(domainOrg.org_id))) {
    return { ok: false, reason: 'sso_required', message: `${domainOrg.name} requires single sign-on for ${domain}.`, orgId: domainOrg.org_id };
  }
  if (ssoOrg && ssoOrg.status === 'suspended') return { ok: false, reason: 'org_suspended', message: 'This organization is suspended.', orgId: ssoOrg.org_id };
  // SSO without the feature: refused, except a platform operator through a platform IdP
  // (who must always be able to sign in and install the license); they get no SSO membership.
  const ssoOff = !!ssoOrg && !(await ssoOn(ssoOrg.org_id));
  if (ssoOff && !(opts.platformIdps.includes(c.identityProvider!) && c.idpRoles.includes('CloudTrain.PlatformAdmin'))) {
    return { ok: false, reason: 'sso_unlicensed', message: 'Single sign-on is not available for this organization: it needs a CloudTrain license or plan that includes SSO. Sign in with a local account, or ask your administrator.', orgId: ssoOrg!.org_id };
  }

  // A pre-provisioned identity ('pending-…', from the seed or an invitation) with this email becomes this sub.
  const existing = (await sql<{ id: string; platform_roles: string[] }>`SELECT * FROM auth_user_by_email(${email})`.execute(db)).rows[0];
  if (existing && existing.id !== c.sub) {
    if (!existing.id.startsWith('pending-')) {
      return { ok: false, reason: 'email_conflict', message: 'Another account already uses this email address.' };
    }
    const pendingOrgs = await membershipsOf(db, existing.id);
    const claimOrg = ssoOrg?.org_id ?? domainOrg?.org_id ?? pendingOrgs[0]?.org_id ?? null;
    // Only claim inside an org that owns this login (its IdP or its domain) or invited the email.
    if (claimOrg && pendingOrgs.some((m) => m.org_id === claimOrg)) {
      await db.transaction().execute(async (tx) => {
        await setTenant(tx, claimOrg, c.sub);
        await tx.updateTable('users').set({ id: c.sub }).where('id', '=', existing.id).execute();
      });
    }
  }

  const platformClaim = c.identityProvider && opts.platformIdps.includes(c.identityProvider) ? c.idpRoles.includes('CloudTrain.PlatformAdmin') : undefined;

  // Upsert the user (RLS: a user may always write its own row).
  const user = await withTenant(db, { userId: c.sub, orgId: ssoOrg?.org_id ?? null }, async (tx) => {
    const prev = await tx.selectFrom('users').select(['platform_roles']).where('id', '=', c.sub).executeTakeFirst();
    let platformRoles = prev?.platform_roles ?? [];
    if (platformClaim === true && !platformRoles.includes('platform_admin')) platformRoles = [...platformRoles, 'platform_admin'];
    if (platformClaim === false) platformRoles = platformRoles.filter((r) => r !== 'platform_admin');
    const values = { email, name: c.name || email, last_login_at: new Date(), last_idp: c.identityProvider ?? 'local', platform_roles: platformRoles, ...(c.title ? { title: c.title } : {}) };
    await tx
      .insertInto('users')
      .values({ id: c.sub, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
    return { platformAdmin: platformRoles.includes('platform_admin') };
  });

  // SSO: membership + roles + teams from the IdP, every login.
  if (ssoOrg && !ssoOff) {
    const denied = await withTenant(db, { orgId: ssoOrg.org_id, userId: c.sub }, async (tx) => {
      const conn = await tx.selectFrom('sso_connections').selectAll().where('kc_alias', '=', c.identityProvider!).executeTakeFirstOrThrow();
      const mapped = mapSsoClaims(c, conn.group_mappings, conn.default_roles);
      const m = await tx.selectFrom('memberships').selectAll().where('user_id', '=', c.sub).executeTakeFirst();
      if (m?.status === 'deactivated') return true;
      // Only CloudTrain.PlatformAdmin (no org app role, no mapped team): a platform operator, no org membership.
      const orgRoleClaimed = c.idpRoles.some((v) => APP_ROLE_MAP[v] && APP_ROLE_MAP[v] !== 'platform_admin');
      if (mapped.platformAdmin && !orgRoleClaimed && mapped.teams.size === 0 && !m) return false;
      await tx
        .insertInto('memberships')
        .values({ org_id: ssoOrg.org_id, user_id: c.sub, roles: mapped.roles, status: 'active', source: 'sso' })
        .onConflict((oc) => oc.columns(['org_id', 'user_id']).doUpdateSet({ roles: mapped.roles, status: 'active', updated_at: new Date() }))
        .execute();
      const teamIds = [...mapped.teams.keys()];
      const known = teamIds.length ? (await tx.selectFrom('teams').select('id').where('id', 'in', teamIds).execute()).map((t) => t.id) : [];
      for (const teamId of known) {
        const role = mapped.teams.get(teamId)!;
        await tx
          .insertInto('team_members')
          .values({ org_id: ssoOrg.org_id, team_id: teamId, user_id: c.sub, role, source: 'sso' })
          .onConflict((oc) => oc.columns(['team_id', 'user_id']).doUpdateSet({ role, source: 'sso' }))
          .execute();
      }
      let stale = tx.deleteFrom('team_members').where('user_id', '=', c.sub).where('source', '=', 'sso');
      if (known.length) stale = stale.where('team_id', 'not in', known);
      await stale.execute();
      return false;
    });
    if (denied) {
      await withTenant(db, { orgId: ssoOrg.org_id, userId: c.sub }, (tx) => audit(tx, { orgId: ssoOrg.org_id, actorId: c.sub, actorName: c.name, ip: opts.ip }, 'auth.login_denied', 'user', c.sub, { reason: 'deactivated' }, email));
      return { ok: false, reason: 'deactivated', message: 'Your account has been deactivated in this organization.', orgId: ssoOrg.org_id };
    }
  }

  // Pending invitations for this email (any org that invited it).
  await acceptInvitations(db, c.sub, email);

  const memberships = await membershipsOf(db, c.sub);
  const active = memberships.filter((m) => m.status === 'active' && m.org_status === 'active');
  const deactivatedPreferred = memberships.find((m) => m.org_id === (opts.preferredOrgId ?? ssoOrg?.org_id) && m.status === 'deactivated');
  const pick = active.find((m) => m.org_id === opts.preferredOrgId) ?? active.find((m) => m.org_id === ssoOrg?.org_id) ?? active[0];
  if (!pick && !user.platformAdmin) {
    if (deactivatedPreferred) return { ok: false, reason: 'deactivated', message: 'Your account has been deactivated in this organization.', orgId: deactivatedPreferred.org_id };
    if (memberships.some((m) => m.org_status === 'suspended')) return { ok: false, reason: 'org_suspended', message: 'This organization is suspended.' };
    return { ok: false, reason: 'no_membership', message: 'You are not a member of any CloudTrain organization yet. Ask your administrator for an invitation.' };
  }
  if (pick) {
    await withTenant(db, { orgId: pick.org_id, userId: c.sub }, (tx) =>
      audit(tx, { orgId: pick.org_id, actorId: c.sub, actorName: c.name, ip: opts.ip }, 'auth.login', 'user', c.sub, { idp: c.identityProvider ?? 'local' }, email),
    );
  }
  return { ok: true, userId: c.sub, orgId: pick?.org_id ?? null, platformAdmin: user.platformAdmin };
}

/** Turns open invitations for `email` into active memberships (with their roles and teams). */
export async function acceptInvitations(db: Db, userId: string, email: string): Promise<number> {
  let accepted = 0;
  // The invited user already has a membership row (status 'invited') in each inviting org.
  for (const m of await membershipsOf(db, userId)) {
    if (m.status !== 'invited') continue;
    await withTenant(db, { orgId: m.org_id, userId }, async (tx) => {
      const inv = await tx
        .selectFrom('invitations')
        .selectAll()
        .where(sql`lower(email)`, '=', email.toLowerCase())
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      if (!inv) return;
      await tx.updateTable('memberships').set({ status: 'active', roles: normalizeRoles(inv.roles), updated_at: new Date() }).where('user_id', '=', userId).execute();
      for (const t of inv.teams) {
        await tx
          .insertInto('team_members')
          .values({ org_id: m.org_id, team_id: t.teamId, user_id: userId, role: t.role, source: 'manual' })
          .onConflict((oc) => oc.columns(['team_id', 'user_id']).doUpdateSet({ role: t.role }))
          .execute();
      }
      await tx.updateTable('invitations').set({ accepted_at: new Date(), user_id: userId }).where('id', '=', inv.id).execute();
      accepted++;
    });
  }
  return accepted;
}

/**
 * Builds the request principal for `userId` in `orgId` from the database.
 * Null when the membership is not active (deactivated, invited, or gone) or the
 * org is suspended, unless the user is a platform admin (who may enter any org).
 */
export async function loadPrincipal(db: Db, userId: string, orgId: string | null): Promise<Principal | null> {
  return withTenant(db, { orgId, userId }, async (tx) => {
    const user = await tx.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();
    if (!user) return null;
    const platformAdmin = user.platform_roles.includes('platform_admin');
    const base: Principal = {
      sub: user.id,
      name: user.name,
      email: user.email,
      ...(user.title ? { title: user.title } : {}),
      orgId: '',
      orgName: '',
      orgSlug: '',
      team: '',
      roles: platformAdmin ? ['platform_admin'] : [],
      teams: [],
      managedTeamIds: [],
      instructedCohortIds: [],
      cohortIds: [],
      platformAdmin,
    };
    if (!orgId) return platformAdmin ? base : null;
    const org = await tx.selectFrom('orgs').selectAll().where('id', '=', orgId).executeTakeFirst();
    if (!org) return platformAdmin ? base : null;
    if (org.status === 'suspended' && !platformAdmin) return null;
    const m = await tx.selectFrom('memberships').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if ((!m || m.status !== 'active') && !platformAdmin) return null;
    const teams = await tx
      .selectFrom('team_members as tm')
      .innerJoin('teams as t', 't.id', 'tm.team_id')
      .select(['t.id', 't.name', 'tm.role'])
      .where('tm.user_id', '=', userId)
      .orderBy('t.name')
      .execute();
    const cohorts = await tx
      .selectFrom('cohorts')
      .select(['id', 'instructor_ids'])
      .where((eb) => eb.or([eb(sql.val(userId), '=', sql<string>`ANY(instructor_ids)`), eb('id', 'in', eb.selectFrom('cohort_members').select('cohort_id').where('user_id', '=', userId))]))
      .execute();
    const roles: Role[] = m?.status === 'active' ? normalizeRoles(m.roles) : [];
    if (platformAdmin) roles.push('platform_admin');
    const managed = teams.filter((t) => t.role === 'manager').map((t) => t.id);
    const instructed = cohorts.filter((c) => c.instructor_ids.includes(userId)).map((c) => c.id);
    const enrolled = (await tx.selectFrom('cohort_members').select('cohort_id').where('user_id', '=', userId).execute()).map((r) => r.cohort_id);
    return {
      ...base,
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      team: teams[0]?.name ?? '',
      roles,
      teams: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })),
      // Managing a team means the manager role and a manager seat on that team.
      managedTeamIds: roles.includes('manager') ? managed : [],
      instructedCohortIds: roles.includes('instructor') ? instructed : [],
      cohortIds: enrolled,
    };
  });
}
