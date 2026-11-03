import type { Db } from '../db/index.js';
import { BROKER_ORIGIN_ATTRIBUTE, type KeycloakAdmin, type KcUser } from '../keycloak/admin.js';
import { orgForDomain, orgForIdp } from './identity.js';

/*
 * Keycloak-side guard for addresses on verified domains. Tenant IdPs only ever
 * create Keycloak users (TENANT_BROKER_FLOW): whoever first brings an address
 * into Keycloak keeps it, and Keycloak refuses the owner's later first login
 * through their own org's IdP before the gateway sees it. An org admin could
 * so lock out any SSO user of another org by pointing their own IdP at that
 * user's address. A brokered link to an IdP of an org other than the one that
 * verified the address's domain is therefore dropped (the user deleted when it
 * has nothing else), which frees the address again.
 */

/** IdP aliases among `links` that do not belong to org `ownerOrgId`. */
export async function foreignLinks(db: Db, links: { identityProvider: string }[], ownerOrgId: string): Promise<string[]> {
  const out: string[] = [];
  for (const l of links) {
    const o = await orgForIdp(db, l.identityProvider);
    if (o?.org_id !== ownerOrgId) out.push(l.identityProvider);
  }
  return out;
}

/**
 * Drops the links of Keycloak users holding `email` (as email or username) to IdPs of orgs other
 * than the one that verified its domain. Returns the touched user ids; nothing for an address on
 * a domain no org verified.
 */
export async function releaseForeignAddress(db: Db, kc: KeycloakAdmin, email: string): Promise<{ userId: string; result: 'deleted' | 'unlinked' }[]> {
  const address = email.trim().toLowerCase();
  const owner = await orgForDomain(db, address.split('@')[1] ?? '');
  if (!owner?.verified) return [];
  const users = new Map<string, KcUser>();
  for (const u of [await kc.findUserByEmail(address), await kc.findUserByUsername(address)]) if (u) users.set(u.id, u);
  const out: { userId: string; result: 'deleted' | 'unlinked' }[] = [];
  for (const u of users.values()) {
    const foreign = await foreignLinks(db, await kc.federatedIdentities(u.id), owner.org_id);
    if (!foreign.length) continue;
    const result = await kc.dropBrokeredLinks(u.id, foreign);
    if (result !== 'none') out.push({ userId: u.id, result });
  }
  return out;
}

/**
 * IdPs the Keycloak user `id` came from or is linked to: its IdP links plus the
 * BROKER_ORIGIN_ATTRIBUTE a tenant IdP stamped on it. A local (password) login of
 * such a user is only as trusted as those IdPs (platform/identity.ts): a brokered
 * user may add a password in the account console, and that login carries no
 * identity_provider claim. Throws when Keycloak cannot be asked.
 */
export async function brokerOrigins(kc: Pick<KeycloakAdmin, 'getUser' | 'federatedIdentities'>, id: string): Promise<string[]> {
  const [user, links] = await Promise.all([kc.getUser(id), kc.federatedIdentities(id).catch((e: unknown) => ((e as { status?: number }).status === 404 ? [] : Promise.reject(e)))]);
  return [...new Set([...links.map((l) => l.identityProvider), ...(user?.attributes?.[BROKER_ORIGIN_ATTRIBUTE] ?? [])])].filter(Boolean).sort();
}
