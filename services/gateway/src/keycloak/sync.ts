import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withTenant, type Db } from '../db/index.js';
import { syncKeycloakOrg } from '../platform/platform.js';
import type { PlatformService } from '../platform/service.js';
import { GROUP_ATTRIBUTE, linkToOrganization, ROLE_ATTRIBUTE } from '../platform/sso.js';
import type { KeycloakAdmin } from './admin.js';

/*
 * Makes Keycloak match the database: every org is a Keycloak organization
 * (alias = slug) with its verified domains, every SSO connection's IdP is
 * linked to its organization, local members are organization members, and
 * IdP claim mappers may write the idp_roles/idp_groups user attributes.
 *
 * Optional: AzarGuard's Entra ID tenant as IdP `azarguard-entra`, from
 * ~/.config/cloudtrain/entra-dev.env (never committed, never printed).
 */

export const ENTRA_ALIAS = 'azarguard-entra';
export const ENTRA_ENV_FILE = path.join(os.homedir(), '.config/cloudtrain/entra-dev.env');

/** KEY=VALUE lines (optional `export`, quotes); comments and blanks ignored. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export interface EntraSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  domains: string[];
  orgName: string;
  orgSlug: string;
}

export function entraFrom(env: Record<string, string>): EntraSettings | null {
  const pick = (...keys: string[]) => keys.map((k) => env[k]).find((v) => v && v.trim())?.trim();
  const tenantId = pick('ENTRA_TENANT_ID', 'AZURE_TENANT_ID', 'TENANT_ID');
  const clientId = pick('ENTRA_CLIENT_ID', 'AZURE_CLIENT_ID', 'CLIENT_ID');
  const clientSecret = pick('ENTRA_CLIENT_SECRET', 'AZURE_CLIENT_SECRET', 'CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    domains: (pick('ENTRA_DOMAINS', 'ENTRA_DOMAIN') ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
    orgName: pick('ENTRA_ORG_NAME') ?? 'AzarGuard',
    orgSlug: pick('ENTRA_ORG_SLUG') ?? 'azarguard',
  };
}

export async function readEntra(file = ENTRA_ENV_FILE): Promise<EntraSettings | null | 'incomplete'> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  return entraFrom(parseEnvFile(text)) ?? 'incomplete';
}

/** Creates/updates the Entra ID IdP (v2.0 issuer; app roles arrive in the `roles` claim). */
export async function ensureEntraIdp(kc: KeycloakAdmin, e: EntraSettings): Promise<void> {
  const base = `https://login.microsoftonline.com/${encodeURIComponent(e.tenantId)}`;
  const idp = {
    alias: ENTRA_ALIAS,
    displayName: `${e.orgName} (Entra ID)`,
    providerId: 'oidc',
    enabled: true,
    trustEmail: true,
    hideOnLogin: true,
    firstBrokerLoginFlowAlias: 'first broker login',
    config: {
      issuer: `${base}/v2.0`,
      authorizationUrl: `${base}/oauth2/v2.0/authorize`,
      tokenUrl: `${base}/oauth2/v2.0/token`,
      jwksUrl: `${base}/discovery/v2.0/keys`,
      logoutUrl: `${base}/oauth2/v2.0/logout`,
      clientId: e.clientId,
      clientSecret: e.clientSecret,
      clientAuthMethod: 'client_secret_post',
      defaultScope: 'openid profile email',
      validateSignature: 'true',
      useJwksUrl: 'true',
      pkceEnabled: 'true',
      pkceMethod: 'S256',
      syncMode: 'FORCE',
    },
  };
  if (await kc.getIdp(ENTRA_ALIAS)) await kc.updateIdp(idp);
  else await kc.createIdp(idp);
  await kc.ensureAttributeMapper(ENTRA_ALIAS, 'oidc', 'cloudtrain roles', 'roles', ROLE_ATTRIBUTE);
  await kc.ensureAttributeMapper(ENTRA_ALIAS, 'oidc', 'cloudtrain groups', 'groups', GROUP_ATTRIBUTE);
}

export interface SyncReport {
  orgs: string[];
  linkedIdps: string[];
  members: number;
  entra: 'absent' | 'incomplete' | 'configured';
}

export async function syncKeycloak(ps: PlatformService, kc: KeycloakAdmin, db: Db, opts: { entraFile?: string } = {}): Promise<SyncReport> {
  const report: SyncReport = { orgs: [], linkedIdps: [], members: 0, entra: 'absent' };
  await kc.allowUnmanagedAttributes();

  const entra = await readEntra(opts.entraFile);
  if (entra === 'incomplete') report.entra = 'incomplete';
  else if (entra) {
    await ensureEntraIdp(kc, entra);
    report.entra = 'configured';
    // The AzarGuard org: created once with the Entra connection, when domains are given.
    await withTenant(db, { platform: true }, async (tx) => {
      let org = await tx.selectFrom('orgs').selectAll().where('slug', '=', entra.orgSlug).executeTakeFirst();
      if (!org && entra.domains.length) {
        org = await tx.insertInto('orgs').values({ slug: entra.orgSlug, name: entra.orgName, settings: JSON.stringify({ defaultSessionMinutes: 60, allowLocalLogin: false, timezone: 'UTC' }) }).returningAll().executeTakeFirstOrThrow();
        await tx.insertInto('quotas').values({ org_id: org.id, max_concurrent_sessions: 20, monthly_lab_hours: 500, max_session_minutes: 120 }).execute();
      }
      if (!org) return;
      for (const d of entra.domains) {
        await tx.insertInto('org_domains').values({ org_id: org.id, domain: d, verification_token: randomBytes(16).toString('hex'), verified_at: new Date() }).onConflict((oc) => oc.column('domain').doNothing()).execute();
      }
      await tx
        .insertInto('sso_connections')
        .values({ org_id: org.id, kc_alias: ENTRA_ALIAS, type: 'oidc', display_name: `${entra.orgName} (Entra ID)`, status: 'active', group_mappings: '[]', default_roles: ['learner'], settings: JSON.stringify({ discoveryUrl: `https://login.microsoftonline.com/${entra.tenantId}/v2.0/.well-known/openid-configuration`, clientId: entra.clientId, hasClientSecret: true, scopes: ['openid', 'profile', 'email'], roleClaim: 'roles' }) })
        .onConflict((oc) => oc.column('kc_alias').doNothing())
        .execute();
    });
  }

  const orgs = await withTenant(db, { platform: true }, (tx) => tx.selectFrom('orgs').selectAll().orderBy('slug').execute());
  for (const o of orgs) {
    const { domains, conns, members } = await withTenant(db, { platform: true }, async (tx) => ({
      domains: (await tx.selectFrom('org_domains').select('domain').where('org_id', '=', o.id).where('verified_at', 'is not', null).execute()).map((d) => d.domain),
      conns: await tx.selectFrom('sso_connections').select('kc_alias').where('org_id', '=', o.id).execute(),
      members: await tx.selectFrom('memberships').select('user_id').where('org_id', '=', o.id).where('user_id', 'not like', 'pending-%').execute(),
    }));
    const kcId = await syncKeycloakOrg(ps, o, domains);
    if (kcId && kcId !== o.kc_org_id) await withTenant(db, { platform: true }, (tx) => tx.updateTable('orgs').set({ kc_org_id: kcId }).where('id', '=', o.id).execute());
    report.orgs.push(o.slug);
    if (!kcId) continue;
    for (const c of conns) {
      if (!(await kc.getIdp(c.kc_alias))) continue;
      await linkToOrganization(kc, kcId, c.kc_alias, domains);
      report.linkedIdps.push(c.kc_alias);
    }
    // Local accounts of the org become Keycloak organization members (brokered ones join on first login).
    for (const m of members) {
      try {
        await kc.addOrgMember(kcId, m.user_id);
        report.members++;
      } catch {
        /* not a Keycloak user of this realm (e.g. brokered and not yet logged in) */
      }
    }
  }
  return report;
}
