import { randomUUID } from 'node:crypto';
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
  /** The provider asserts that the user proved control of `email` (OIDC `email_verified`). */
  emailVerified: boolean;
  name: string;
  title?: string;
  /** Keycloak IdP alias the user came through (user session note), absent for local login. */
  identityProvider?: string;
  /**
   * Local login only: IdPs the Keycloak user was brokered from or is linked to
   * (kc-address.ts, brokerOrigins). null: Keycloak could not be asked, so the
   * email is not trusted. Absent: not checked (no Keycloak admin client).
   */
  brokerOrigins?: string[] | null;
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
  /**
   * Invitation the login was started from (its link, sent to the invited
   * mailbox). Holding the link proves control of that mailbox for that one
   * invitation, so it may be accepted even when the email is otherwise untrusted.
   */
  invitation?: { orgId: string; email: string } | null;
  ip?: string;
}

/**
 * Whether the login's email may be matched to identities and invitations that
 * other orgs created for it. The email must be verified, and a brokered login
 * (a tenant IdP, whose org admin controls what it asserts) is only believed for
 * a verified domain of the IdP's own org: otherwise any org admin could add an
 * IdP that asserts someone else's address and take over their invitations.
 * Platform IdPs (CT_PLATFORM_IDPS, the operator's Entra) follow the same rule:
 * trusted for their own org's verified domains only. A platform IdP with no
 * org, or an address outside those domains, accepts invitations only through
 * the invitation link (docs/platform-identity.md).
 */
export function emailTrusted(c: Pick<IdentityClaims, 'emailVerified' | 'identityProvider'>, ssoOrgId: string | null, domainOrg: Pick<OrgForDomain, 'org_id' | 'verified'> | null): boolean {
  if (!c.emailVerified) return false;
  if (!c.identityProvider) return true;
  return !!(ssoOrgId && domainOrg?.verified && domainOrg.org_id === ssoOrgId);
}

/**
 * A local login's email is trusted only as far as the account's origin allows: an account a
 * tenant IdP brokered (or one linked to an IdP) stays as trusted as that IdP when it signs in with
 * a password it added later. `origins` null (unknown) is untrusted. Returns the origin that decides
 * (the first untrusted one, else the first), for last_idp.
 */
async function originsTrust(db: Db, origins: string[] | null, domainOrg: Pick<OrgForDomain, 'org_id' | 'verified'> | null): Promise<{ trusted: boolean; origin?: string }> {
  if (origins === null) return { trusted: false };
  for (const alias of origins) {
    const o = await orgForIdp(db, alias);
    if (!emailTrusted({ emailVerified: true, identityProvider: alias }, o?.org_id ?? null, domainOrg)) return { trusted: false, origin: alias };
  }
  return { trusted: true, ...(origins[0] ? { origin: origins[0] } : {}) };
}

export type ProvisionResult =
  | { ok: true; userId: string; orgId: string | null; platformAdmin: boolean }
  | { ok: false; reason: 'no_membership' | 'deactivated' | 'sso_required' | 'org_suspended' | 'email_conflict'; message: string; orgId?: string };

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

  if (!c.identityProvider && domainOrg?.verified && domainOrg.enforced) {
    return { ok: false, reason: 'sso_required', message: `${domainOrg.name} requires single sign-on for ${domain}.`, orgId: domainOrg.org_id };
  }
  if (ssoOrg && ssoOrg.status === 'suspended') return { ok: false, reason: 'org_suspended', message: 'This organization is suspended.', orgId: ssoOrg.org_id };
  // A brokered login may not assert an address in a domain that another org verified: that org's
  // own IdP signs those people in. (The gateway then drops the Keycloak user's link to this IdP,
  // routes/auth.ts, so the address is free in Keycloak for its owner's first login.)
  if (c.identityProvider && domainOrg?.verified && domainOrg.org_id !== ssoOrg?.org_id) {
    return { ok: false, reason: 'email_conflict', message: `This identity provider may not sign in addresses of ${domain}: ${domainOrg.name} has verified that domain.`, orgId: domainOrg.org_id };
  }

  // A local login of an account that came from an IdP (Keycloak says so, or an earlier login came
  // through one: last_idp) is judged by that IdP: otherwise a tenant IdP could broker an address,
  // add a password in Keycloak's account console and sign in "locally" with a trusted email.
  let localOrigin: string | undefined;
  let trusted = emailTrusted(c, ssoOrg?.org_id ?? null, domainOrg);
  if (!c.identityProvider) {
    const prev = await withTenant(db, { userId: c.sub }, (tx) => tx.selectFrom('users').select('last_idp').where('id', '=', c.sub).executeTakeFirst());
    const sticky = prev?.last_idp && prev.last_idp !== 'local' ? [prev.last_idp] : [];
    const origins = c.brokerOrigins === null ? null : [...new Set([...(c.brokerOrigins ?? []), ...sticky])];
    const o = await originsTrust(db, origins, domainOrg);
    localOrigin = o.origin;
    if (!o.trusted) trusted = false;
  }
  const invitedOrg = opts.invitation && opts.invitation.email.toLowerCase() === email ? opts.invitation.orgId : null;
  // Orgs whose pending invitations this login may accept: any (a trusted email), else only
  // the IdP's own org and the org whose invitation link started the login.
  const acceptable = trusted ? null : [ssoOrg?.org_id, invitedOrg].filter((o): o is string => !!o);

  // A pre-provisioned identity ('pending-…', from the seed or an invitation) with this email becomes this sub.
  const existing = (await sql<{ id: string; platform_roles: string[] }>`SELECT * FROM auth_user_by_email(${email})`.execute(db)).rows[0];
  if (existing && existing.id !== c.sub && !existing.id.startsWith('pending-')) {
    // A real account holds the address. A login that proves it (a trusted email, or the invitation
    // link for it) takes it over from an account that only had it from an untrusted login; otherwise
    // the first untrusted login for an address would lock its owner out (account squatting).
    const proven = trusted || !!invitedOrg;
    if (!proven || !(await releaseUntrustedAddress(db, existing.id, email, domainOrg, c, opts.ip))) {
      return { ok: false, reason: 'email_conflict', message: 'Another account already uses this email address.' };
    }
  } else if (existing && existing.id !== c.sub) {
    const pendingOrgs = await membershipsOf(db, existing.id);
    // Claiming moves every membership of the pending identity: an untrusted email may only
    // claim one whose memberships all lie in orgs it may accept.
    if (!trusted && !pendingOrgs.every((m) => acceptable!.includes(m.org_id))) {
      return { ok: false, reason: 'email_conflict', message: 'This sign-in cannot be matched to the account for this email address. Use the invitation link, or sign in with a verified email address.' };
    }
    const claimOrg = ssoOrg?.org_id ?? domainOrg?.org_id ?? invitedOrg ?? pendingOrgs[0]?.org_id ?? null;
    const inClaimOrg = !!claimOrg && pendingOrgs.some((m) => m.org_id === claimOrg);
    // Claim inside an org that owns this login (its IdP or its domain) or invited the email. A trusted
    // email claims the identity wherever it was invited (another org invited an SSO user of this IdP).
    const tenantOrg = inClaimOrg ? claimOrg : trusted ? (pendingOrgs[0]?.org_id ?? null) : null;
    if (tenantOrg) {
      await db.transaction().execute(async (tx) => {
        await setTenant(tx, tenantOrg, c.sub);
        await tx.updateTable('users').set({ id: c.sub }).where('id', '=', existing.id).execute();
      });
    }
  }

  const platformClaim = c.identityProvider && opts.platformIdps.includes(c.identityProvider) ? c.idpRoles.includes('CloudTrain.PlatformAdmin') : undefined;

  // A closed account stays closed until an admin reopens it (src/gdpr, docs/gdpr.md).
  const closed = await withTenant(db, { userId: c.sub }, (tx) => tx.selectFrom('users').select('closed_at').where('id', '=', c.sub).executeTakeFirst());
  if (closed?.closed_at) return { ok: false, reason: 'deactivated', message: 'This account is closed. Write to us if you would like it reopened.' };

  // Upsert the user (RLS: a user may always write its own row).
  const user = await withTenant(db, { userId: c.sub, orgId: ssoOrg?.org_id ?? null }, async (tx) => {
    const prev = await tx.selectFrom('users').select(['platform_roles']).where('id', '=', c.sub).executeTakeFirst();
    let platformRoles = prev?.platform_roles ?? [];
    if (platformClaim === true && !platformRoles.includes('platform_admin')) platformRoles = [...platformRoles, 'platform_admin'];
    if (platformClaim === false) platformRoles = platformRoles.filter((r) => r !== 'platform_admin');
    // Signing in answers an inactivity warning.
    const values = { email, name: c.name || email, last_login_at: new Date(), last_idp: c.identityProvider ?? localOrigin ?? 'local', platform_roles: platformRoles, inactivity_warned_at: null, ...(c.title ? { title: c.title } : {}) };
    await tx
      .insertInto('users')
      .values({ id: c.sub, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
    return { platformAdmin: platformRoles.includes('platform_admin') };
  });

  // SSO: membership + roles + teams from the IdP, every login.
  if (ssoOrg) {
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

  // Pending invitations for this email: any org that invited it when the email is trusted.
  await acceptInvitations(db, c.sub, email, acceptable ?? undefined);

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

/**
 * Takes `email` away from the account `holderId` when that account only holds it from an
 * untrusted login (emailTrusted: a tenant IdP asserting an address outside its own org's
 * verified domains) and gives it to the login `c`, which proved it. The holder keeps its account
 * under a placeholder address; its open invitations for the address (other orgs invited the
 * address, not the holder) move to `c`. A local account, or one whose IdP's org owns the domain,
 * keeps the address: false.
 */
export async function releaseUntrustedAddress(db: Db, holderId: string, email: string, domainOrg: OrgForDomain | null, c: IdentityClaims, ip?: string): Promise<boolean> {
  const holder = await withTenant(db, { platform: true }, (tx) => tx.selectFrom('users').select(['id', 'last_idp']).where('id', '=', holderId).executeTakeFirst());
  if (!holder?.last_idp || holder.last_idp === 'local') return false;
  const holderOrg = await orgForIdp(db, holder.last_idp);
  if (emailTrusted({ emailVerified: true, identityProvider: holder.last_idp }, holderOrg?.org_id ?? null, domainOrg)) return false;
  await withTenant(db, { platform: true }, async (tx) => {
    await tx.updateTable('users').set({ email: `unverified-${randomUUID()}@invalid` }).where('id', '=', holderId).execute();
    await tx
      .insertInto('users')
      .values({ id: c.sub, email, name: c.name || email })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    // Open invitations of other orgs were made out to the address; the holder's own IdP org keeps its.
    const moved = await tx
      .updateTable('memberships')
      .set({ user_id: c.sub, updated_at: new Date() })
      .where('user_id', '=', holderId)
      .where('status', '=', 'invited')
      .$if(!!holderOrg, (q) => q.where('org_id', '<>', holderOrg!.org_id))
      .where('org_id', 'not in', (eb) => eb.selectFrom('memberships').select('org_id').where('user_id', '=', c.sub))
      .returning('org_id')
      .execute();
    const orgs = moved.map((m) => m.org_id);
    if (orgs.length) {
      await tx.updateTable('invitations').set({ user_id: c.sub }).where('user_id', '=', holderId).where('accepted_at', 'is', null).where('org_id', 'in', orgs).execute();
    }
    for (const orgId of new Set([...(holderOrg ? [holderOrg.org_id] : []), ...orgs])) {
      await audit(tx, { orgId, actorId: c.sub, actorName: c.name, ip }, 'auth.email_reclaimed', 'user', holderId, { idp: c.identityProvider ?? 'local', from: holderId, invitationsMoved: orgs }, email);
    }
  });
  return true;
}

/**
 * Turns open invitations for `email` into active memberships (with their roles
 * and teams). `onlyOrgs` limits acceptance to those orgs (an untrusted email).
 */
export async function acceptInvitations(db: Db, userId: string, email: string, onlyOrgs?: string[]): Promise<number> {
  let accepted = 0;
  // The invited user already has a membership row (status 'invited') in each inviting org.
  for (const m of await membershipsOf(db, userId)) {
    if (m.status !== 'invited') continue;
    if (onlyOrgs && !onlyOrgs.includes(m.org_id)) continue;
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
    if (!user || user.closed_at) return null;
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
