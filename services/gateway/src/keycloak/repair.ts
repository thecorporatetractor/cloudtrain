import { withTenant, type Db } from '../db/index.js';
import { foreignLinks } from '../platform/kc-address.js';
import { BROKER_ORIGIN_ATTRIBUTE, TENANT_BROKER_FLOW, type KcUser, type KeycloakAdmin } from './admin.js';

/*
 * Keycloak protections of tenant IdPs that must hold in production, not only
 * after someone runs `task kc:sync`. The gateway runs this at startup and every
 * CT_KC_REPAIR_MS (main.ts); kc:sync runs it too. Idempotent, safe to run from
 * several replicas at once.
 */

/** The operator's Entra ID IdP: platform-trusted, keeps Keycloak's built-in first broker login. */
export const ENTRA_ALIAS = 'azarguard-entra';

export interface RepairReport {
  /** Tenant IdPs moved to TENANT_BROKER_FLOW (created before it existed, or changed since). */
  brokerFlowFixed: string[];
  /**
   * Brokered users (`alias/userId`) whose address is on a domain another org verified: their link to
   * the IdP was dropped (the user deleted when it had nothing else), see platform/kc-address.ts.
   */
  foreignReleased: string[];
  /**
   * Brokered users (`alias/userId`) whose address is on a domain no org verified: the gateway does
   * not trust their email (emailTrusted). Listed for review, e.g. links made under the built-in
   * first broker login flow, which could link an IdP to an existing account by email.
   */
  untrustedLinks: string[];
  /**
   * Brokered users (`alias/userId`) given BROKER_ORIGIN_ATTRIBUTE = alias: linked before the mapper
   * existed, or linked to an IdP that did not create them (the mapper stamps new users only).
   */
  originsMarked: string[];
  /**
   * Steps that failed (`realm: …`, `alias: …` or `alias/userId: …`, with the error). A failure
   * skips only that IdP or user; the next run retries it.
   */
  failures: string[];
}

export interface RepairLog {
  warn(o: object, m: string): void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function repairTenantIdps(db: Db, kc: KeycloakAdmin, log?: RepairLog): Promise<RepairReport> {
  const report: RepairReport = { brokerFlowFixed: [], foreignReleased: [], untrustedLinks: [], originsMarked: [], failures: [] };
  const failed = (what: string, e: unknown) => {
    report.failures.push(`${what}: ${errText(e)}`);
    log?.warn({ err: e, target: what }, 'keycloak: tenant IdP repair step failed, continuing');
  };
  // Realm-wide steps; a failure here does not stop the per-IdP repairs below.
  try {
    // The origin stamp is an unmanaged attribute: users may not edit it, admins (and mappers) may.
    await kc.allowUnmanagedAttributes();
  } catch (e) {
    failed('realm (user profile)', e);
  }
  try {
    // Every run: the flow may have been loosened in the admin console since it was created.
    await kc.ensureTenantBrokerFlow();
  } catch (e) {
    failed('realm (tenant broker flow)', e);
  }
  const { conns, owners } = await withTenant(db, { platform: true }, async (tx) => ({
    conns: await tx.selectFrom('sso_connections').select(['kc_alias', 'org_id']).orderBy('kc_alias').execute(),
    owners: await tx.selectFrom('org_domains').select(['domain', 'org_id']).where('verified_at', 'is not', null).execute(),
  }));
  const domainOwner = new Map(owners.map((d) => [d.domain, d.org_id]));
  for (const c of conns) {
    if (c.kc_alias === ENTRA_ALIAS) continue;
    let users: KcUser[];
    try {
      const idp = await kc.getIdp(c.kc_alias);
      if (!idp) continue;
      // Tenant IdPs never link to an existing account.
      if (idp.firstBrokerLoginFlowAlias !== TENANT_BROKER_FLOW) {
        await kc.updateIdp({ ...idp, firstBrokerLoginFlowAlias: TENANT_BROKER_FLOW });
        report.brokerFlowFixed.push(c.kc_alias);
      }
      await kc.ensureBrokerOriginMapper(c.kc_alias);
      users = await kc.idpUsers(c.kc_alias, 200, true);
    } catch (e) {
      failed(c.kc_alias, e);
      continue;
    }
    for (const u of users) {
      try {
        // Every IdP the user is linked to is one of its origins, also the ones that did not create it.
        if (!(u.attributes?.[BROKER_ORIGIN_ATTRIBUTE] ?? []).includes(c.kc_alias)) {
          await kc.addUserAttribute(u.id, BROKER_ORIGIN_ATTRIBUTE, c.kc_alias);
          report.originsMarked.push(`${c.kc_alias}/${u.id}`);
        }
        // An address on another org's verified domain is released.
        const owner = domainOwner.get((u.email ?? '').toLowerCase().split('@')[1] ?? '');
        if (owner === c.org_id) continue;
        if (!owner) {
          report.untrustedLinks.push(`${c.kc_alias}/${u.id}`);
          continue;
        }
        const foreign = await foreignLinks(db, await kc.federatedIdentities(u.id), owner);
        if (foreign.length && (await kc.dropBrokeredLinks(u.id, foreign)) !== 'none') report.foreignReleased.push(`${c.kc_alias}/${u.id}`);
      } catch (e) {
        failed(`${c.kc_alias}/${u.id}`, e);
      }
    }
  }
  return report;
}

/** Runs repairTenantIdps now and every `everyMs` (0: only now). Returns a stop function. */
export function scheduleTenantIdpRepair(db: Db, kc: KeycloakAdmin, everyMs: number, log: { info(o: object, m: string): void; warn(o: object, m: string): void }): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void repairTenantIdps(db, kc, log)
      .then((r) => {
        if (r.brokerFlowFixed.length || r.foreignReleased.length || r.originsMarked.length) log.warn({ brokerFlowFixed: r.brokerFlowFixed, foreignReleased: r.foreignReleased, originsMarked: r.originsMarked.length }, 'keycloak: repaired tenant IdPs');
        if (r.failures.length) log.warn({ failures: r.failures.length }, 'keycloak: tenant IdP repair finished with failures (retried next run)');
        if (r.untrustedLinks.length) log.info({ untrustedLinks: r.untrustedLinks.length }, 'keycloak: brokered users with an email on a domain no org verified (not trusted for invitations)');
      })
      .catch((e: unknown) => log.warn({ err: e }, 'keycloak: tenant IdP repair failed'))
      .finally(() => {
        running = false;
      });
  };
  run();
  const t = everyMs > 0 ? setInterval(run, everyMs) : undefined;
  t?.unref();
  return () => {
    if (t) clearInterval(t);
  };
}
