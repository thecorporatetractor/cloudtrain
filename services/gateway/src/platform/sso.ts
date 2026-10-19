import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { CreateSsoConnectionRequest, OrgDomain, SsoConnection, SsoGroupMapping, SsoOverview, SsoTestResult, UpdateSsoConnectionRequest, VerifyDomainResponse } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, ORG_ROLES } from '../authz.js';
import type { Tx } from '../db/index.js';
import type { SsoConnectionRow } from '../db/schema.js';
import { badRequest, conflict, HttpError, notFound } from '../errors.js';
import type { KcIdentityProvider, KeycloakAdmin } from '../keycloak/admin.js';
import { actorOf, audit } from './audit.js';
import { orgOf } from './admin.js';
import { orgForDomain } from './identity.js';
import type { PlatformService } from './service.js';

/*
 * Self-service SSO: org admins manage IdP connections; the gateway mirrors
 * them into Keycloak (identity provider + claim mappers + organization link).
 * Client secrets go to Keycloak only and are never stored in Postgres.
 */

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ALIAS = /^[a-z0-9][a-z0-9-]{1,62}$/;

export const ROLE_ATTRIBUTE = 'idp_roles';
export const GROUP_ATTRIBUTE = 'idp_groups';

function kcOf(ps: PlatformService): KeycloakAdmin {
  if (!ps.kc) throw new HttpError(502, 'Keycloak admin access is not configured on this gateway.', { code: 'upstream' });
  return ps.kc;
}

export function toConnection(r: SsoConnectionRow): SsoConnection {
  const s = r.settings as Record<string, unknown>;
  return {
    id: r.id,
    alias: r.kc_alias,
    type: r.type,
    displayName: r.display_name,
    status: r.status,
    enforced: r.enforced,
    ...(r.type === 'oidc'
      ? { oidc: { discoveryUrl: String(s.discoveryUrl ?? ''), clientId: String(s.clientId ?? ''), hasClientSecret: s.hasClientSecret !== false, scopes: (s.scopes as string[]) ?? ['openid', 'profile', 'email'], roleClaim: String(s.roleClaim ?? 'roles') } }
      : { saml: { ...(s.metadataUrl ? { metadataUrl: String(s.metadataUrl) } : {}), ...(s.entityId ? { entityId: String(s.entityId) } : {}), groupAttribute: String(s.groupAttribute ?? 'groups') } }),
    groupMappings: r.group_mappings as SsoGroupMapping[],
    defaultRoles: r.default_roles as SsoConnection['defaultRoles'],
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    ...(r.last_test ? { lastTest: r.last_test as unknown as SsoTestResult } : {}),
  };
}

async function domains(tx: Tx, orgId: string): Promise<OrgDomain[]> {
  return (await orgOf(tx, orgId)).domains;
}

export async function ssoOverview(ps: PlatformService, p: Principal): Promise<SsoOverview> {
  authorize(p, 'sso.manage', { kind: 'org' });
  return ps.tx(p, async (tx) => ({
    connections: (await tx.selectFrom('sso_connections').selectAll().orderBy('created_at').execute()).map(toConnection),
    domains: await domains(tx, p.orgId),
  }));
}

async function checkMappings(tx: Tx, maps: SsoGroupMapping[] | undefined): Promise<SsoGroupMapping[]> {
  const list = maps ?? [];
  for (const m of list) {
    if (!m || typeof m.group !== 'string' || !m.group.trim()) throw badRequest('Each group mapping needs a group.', { groupMappings: 'invalid' });
    if (!Array.isArray(m.roles) || m.roles.some((r) => !(ORG_ROLES as readonly string[]).includes(r))) throw badRequest(`Mapping roles must be among ${ORG_ROLES.join(', ')}`, { groupMappings: 'invalid' });
    if (!Array.isArray(m.teams)) throw badRequest('Mapping teams must be a list', { groupMappings: 'invalid' });
  }
  const teamIds = [...new Set(list.flatMap((m) => m.teams.map((t) => t.teamId)))];
  if (teamIds.length) {
    const found = await tx.selectFrom('teams').select('id').where('id', 'in', teamIds).execute();
    if (found.length !== teamIds.length) throw notFound('Team');
  }
  return list.map((m) => ({ group: m.group.trim(), roles: m.roles, teams: m.teams.map((t) => ({ teamId: t.teamId, role: t.role === 'manager' ? 'manager' : 'member' })) }));
}

async function discover(url: string): Promise<{ issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string; end_session_endpoint?: string }> {
  // The URL comes from an org admin: allow only http(s) without credentials, refuse
  // link-local/metadata addresses, and never follow redirects (SSRF hardening).
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw badRequest('The discovery URL is not a valid URL', { discoveryUrl: 'invalid' });
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || /^(169\.254\.|\[?fe80:|metadata\.google\.internal$)/i.test(u.hostname)) {
    throw badRequest('The discovery URL must be an http(s) URL without credentials, not a link-local address', { discoveryUrl: 'invalid' });
  }
  let r: Response;
  try {
    r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw badRequest(`Could not reach the discovery URL: ${(e as Error).message}`, { discoveryUrl: 'unreachable' });
  }
  if (!r.ok) throw badRequest(`Discovery URL answered HTTP ${r.status}`, { discoveryUrl: 'invalid' });
  const d = (await r.json().catch(() => null)) as Record<string, string> | null;
  if (!d?.issuer || !d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw badRequest('Not an OpenID Connect discovery document', { discoveryUrl: 'invalid' });
  return d as never;
}

function oidcIdp(alias: string, displayName: string, d: Awaited<ReturnType<typeof discover>>, o: { clientId: string; clientSecret: string; scopes?: string[] }): KcIdentityProvider {
  return {
    alias,
    displayName,
    providerId: 'oidc',
    enabled: true,
    trustEmail: true,
    firstBrokerLoginFlowAlias: 'first broker login',
    hideOnLogin: true,
    config: {
      issuer: d.issuer,
      authorizationUrl: d.authorization_endpoint,
      tokenUrl: d.token_endpoint,
      jwksUrl: d.jwks_uri,
      ...(d.userinfo_endpoint ? { userInfoUrl: d.userinfo_endpoint } : {}),
      ...(d.end_session_endpoint ? { logoutUrl: d.end_session_endpoint } : {}),
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      clientAuthMethod: 'client_secret_post',
      defaultScope: (o.scopes ?? ['openid', 'profile', 'email']).join(' '),
      validateSignature: 'true',
      useJwksUrl: 'true',
      pkceEnabled: 'true',
      pkceMethod: 'S256',
      syncMode: 'FORCE',
    },
  };
}

/** Links an IdP to the org's Keycloak organization and routes the org's verified domains to it. */
export async function linkToOrganization(kc: KeycloakAdmin, kcOrgId: string | null, alias: string, verifiedDomains: string[]): Promise<void> {
  if (!kcOrgId) return;
  await kc.linkIdp(kcOrgId, alias);
  const idp = await kc.getIdp(alias);
  if (!idp) return;
  const config = { ...idp.config, 'kc.org.broker.redirect.mode.email-matches': 'true', ...(verifiedDomains[0] ? { 'kc.org.domain': verifiedDomains[0] } : {}) };
  await kc.updateIdp({ ...idp, config });
}

export async function createConnection(ps: PlatformService, p: Principal, req: CreateSsoConnectionRequest, ip?: string): Promise<SsoConnection> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const kc = kcOf(ps);
  if (!req || !['oidc', 'saml'].includes(req.type)) throw badRequest('type must be oidc or saml', { type: 'invalid' });
  if (!req.displayName?.trim()) throw badRequest('displayName is required', { displayName: 'required' });
  const alias = (req.alias ?? `${p.orgSlug}-${req.type}`).toLowerCase();
  if (!ALIAS.test(alias)) throw badRequest('alias must be lowercase letters, digits and dashes', { alias: 'invalid' });

  const prepared = await ps.tx(p, async (tx) => {
    if (await tx.selectFrom('sso_connections').select('id').where('kc_alias', '=', alias).executeTakeFirst()) throw conflict(`A connection ${alias} already exists.`);
    return { mappings: await checkMappings(tx, req.groupMappings), org: await tx.selectFrom('orgs').select(['kc_org_id']).where('id', '=', p.orgId).executeTakeFirstOrThrow(), doms: await domains(tx, p.orgId) };
  });
  if (await kc.getIdp(alias)) throw conflict(`Keycloak already has an identity provider ${alias}.`);

  let settings: Record<string, unknown>;
  if (req.type === 'oidc') {
    const o = req.oidc;
    if (!o?.discoveryUrl || !o.clientId || !o.clientSecret) throw badRequest('oidc.discoveryUrl, clientId and clientSecret are required', { oidc: 'required' });
    const d = await discover(o.discoveryUrl);
    await kc.createIdp(oidcIdp(alias, req.displayName.trim(), d, o));
    const roleClaim = o.roleClaim ?? 'roles';
    await kc.ensureAttributeMapper(alias, 'oidc', 'cloudtrain roles', roleClaim, ROLE_ATTRIBUTE);
    await kc.ensureAttributeMapper(alias, 'oidc', 'cloudtrain groups', 'groups', GROUP_ATTRIBUTE);
    settings = { discoveryUrl: o.discoveryUrl, clientId: o.clientId, hasClientSecret: true, scopes: o.scopes ?? ['openid', 'profile', 'email'], roleClaim, issuer: d.issuer };
  } else {
    const s = req.saml;
    if (!s?.metadataUrl) throw badRequest('saml.metadataUrl is required (metadata XML upload: use the URL form for now)', { saml: 'required' });
    const config = await kc.importIdpConfig('saml', s.metadataUrl);
    await kc.createIdp({ alias, displayName: req.displayName.trim(), providerId: 'saml', enabled: true, trustEmail: true, hideOnLogin: true, firstBrokerLoginFlowAlias: 'first broker login', config: { ...config, syncMode: 'FORCE', principalType: 'SUBJECT' } });
    const groupAttribute = s.groupAttribute ?? 'groups';
    await kc.ensureAttributeMapper(alias, 'saml', 'cloudtrain groups', groupAttribute, GROUP_ATTRIBUTE);
    settings = { metadataUrl: s.metadataUrl, entityId: config.idpEntityId ?? config.entityId, groupAttribute };
  }
  await linkToOrganization(
    kc,
    prepared.org.kc_org_id,
    alias,
    prepared.doms.filter((d) => d.verified).map((d) => d.domain),
  );

  return ps.tx(p, async (tx) => {
    const row = await tx
      .insertInto('sso_connections')
      .values({ org_id: p.orgId, kc_alias: alias, type: req.type, display_name: req.displayName.trim(), group_mappings: JSON.stringify(prepared.mappings), default_roles: req.defaultRoles ?? ['learner'], settings: JSON.stringify(settings), status: 'draft' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, actorOf(p, ip), 'sso.create', 'sso_connection', row.id, { alias, type: req.type, mappings: prepared.mappings.length }, req.displayName);
    return toConnection(row);
  });
}

async function connRow(tx: Tx, id: string): Promise<SsoConnectionRow> {
  const r = await tx.selectFrom('sso_connections').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw notFound('SSO connection');
  return r;
}

export async function updateConnection(ps: PlatformService, p: Principal, id: string, req: UpdateSsoConnectionRequest, ip?: string): Promise<SsoConnection> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const kc = kcOf(ps);
  const { row, mappings, doms } = await ps.tx(p, async (tx) => ({ row: await connRow(tx, id), mappings: req.groupMappings ? await checkMappings(tx, req.groupMappings) : undefined, doms: await domains(tx, p.orgId) }));
  if (req.enforced) {
    const status = req.status ?? row.status;
    if (status !== 'active') throw conflict('Test the connection successfully before enforcing it.');
    if (!doms.some((d) => d.verified)) throw conflict('Verify at least one domain before enforcing SSO.');
  }
  const settings = { ...(row.settings as Record<string, unknown>) };
  const idp = await kc.getIdp(row.kc_alias);
  if (idp) {
    const cfg = { ...idp.config };
    if (req.oidc && row.type === 'oidc') {
      if (req.oidc.discoveryUrl) {
        const d = await discover(req.oidc.discoveryUrl);
        Object.assign(cfg, oidcIdp(row.kc_alias, row.display_name, d, { clientId: req.oidc.clientId ?? String(settings.clientId), clientSecret: req.oidc.clientSecret ?? cfg.clientSecret ?? '' }).config);
        settings.discoveryUrl = req.oidc.discoveryUrl;
        settings.issuer = d.issuer;
      }
      if (req.oidc.clientId) cfg.clientId = settings.clientId = req.oidc.clientId;
      if (req.oidc.clientSecret) cfg.clientSecret = req.oidc.clientSecret;
      if (req.oidc.scopes) cfg.defaultScope = (settings.scopes = req.oidc.scopes).join(' ');
      if (req.oidc.roleClaim) {
        settings.roleClaim = req.oidc.roleClaim;
        await kc.ensureAttributeMapper(row.kc_alias, 'oidc', 'cloudtrain roles', req.oidc.roleClaim, ROLE_ATTRIBUTE);
      }
    }
    if (req.saml?.groupAttribute && row.type === 'saml') {
      settings.groupAttribute = req.saml.groupAttribute;
      await kc.ensureAttributeMapper(row.kc_alias, 'saml', 'cloudtrain groups', req.saml.groupAttribute, GROUP_ATTRIBUTE);
    }
    const enabled = req.status ? req.status === 'active' : idp.enabled;
    await kc.updateIdp({ ...idp, ...(req.displayName ? { displayName: req.displayName } : {}), enabled, config: cfg });
  }
  return ps.tx(p, async (tx) => {
    const set: Record<string, unknown> = { updated_at: new Date(), settings: JSON.stringify(settings) };
    if (req.displayName) set.display_name = req.displayName.trim();
    if (mappings) set.group_mappings = JSON.stringify(mappings);
    if (req.defaultRoles) {
      if (req.defaultRoles.some((r) => !(ORG_ROLES as readonly string[]).includes(r))) throw badRequest('defaultRoles invalid', { defaultRoles: 'invalid' });
      set.default_roles = req.defaultRoles;
    }
    if (req.enforced !== undefined) set.enforced = req.enforced;
    if (req.status) set.status = req.status;
    await tx.updateTable('sso_connections').set(set).where('id', '=', id).execute();
    const { oidc, ...rest } = req;
    await audit(tx, actorOf(p, ip), 'sso.update', 'sso_connection', id, { ...rest, ...(oidc ? { oidc: { ...oidc, ...(oidc.clientSecret ? { clientSecret: '[changed]' } : {}) } } : {}) }, row.display_name);
    return toConnection(await connRow(tx, id));
  });
}

export async function deleteConnection(ps: PlatformService, p: Principal, id: string, ip?: string): Promise<void> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const kc = kcOf(ps);
  const { row, org } = await ps.tx(p, async (tx) => ({ row: await connRow(tx, id), org: await tx.selectFrom('orgs').select('kc_org_id').where('id', '=', p.orgId).executeTakeFirstOrThrow() }));
  if (org.kc_org_id) await kc.unlinkIdp(org.kc_org_id, row.kc_alias);
  await kc.deleteIdp(row.kc_alias);
  await ps.tx(p, async (tx) => {
    await tx.deleteFrom('sso_connections').where('id', '=', id).execute();
    await audit(tx, actorOf(p, ip), 'sso.delete', 'sso_connection', id, { alias: row.kc_alias }, row.display_name);
  });
}

export async function testConnection(ps: PlatformService, p: Principal, id: string, ip?: string): Promise<SsoTestResult> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const kc = kcOf(ps);
  const { row, org, doms } = await ps.tx(p, async (tx) => ({ row: await connRow(tx, id), org: await tx.selectFrom('orgs').select('kc_org_id').where('id', '=', p.orgId).executeTakeFirstOrThrow(), doms: await domains(tx, p.orgId) }));
  const steps: SsoTestResult['steps'] = [];
  const idp = await kc.getIdp(row.kc_alias).catch((e: unknown) => {
    steps.push({ name: 'Keycloak reachable', ok: false, detail: (e as Error).message });
    return null;
  });
  steps.push({ name: 'Identity provider configured in Keycloak', ok: !!idp, ...(idp ? { detail: `${idp.providerId}, ${idp.enabled ? 'enabled' : 'disabled'}` } : {}) });
  if (row.type === 'oidc') {
    const url = String((row.settings as Record<string, unknown>).discoveryUrl ?? '');
    try {
      const d = await discover(url);
      steps.push({ name: 'Discovery document', ok: true, detail: d.issuer });
    } catch (e) {
      steps.push({ name: 'Discovery document', ok: false, detail: (e as Error).message });
    }
  } else {
    steps.push({ name: 'SAML metadata imported', ok: !!idp?.config.singleSignOnServiceUrl, ...(idp?.config.singleSignOnServiceUrl ? { detail: idp.config.singleSignOnServiceUrl } : {}) });
  }
  if (org.kc_org_id) {
    const linked = await kc.organizationIdps(org.kc_org_id).catch(() => []);
    steps.push({ name: 'Linked to the Keycloak organization', ok: linked.some((i) => i.alias === row.kc_alias) });
  } else steps.push({ name: 'Linked to the Keycloak organization', ok: false, detail: 'organization not synced (task dev:deps runs kc:sync)' });
  const verified = doms.filter((d) => d.verified).map((d) => d.domain);
  steps.push({ name: 'Verified domain', ok: verified.length > 0, detail: verified.join(', ') || 'none yet' });
  const required = steps.filter((s) => s.name !== 'Verified domain');
  const result: SsoTestResult = { ok: required.every((s) => s.ok), checkedAt: ps.now().toISOString(), steps, loginUrl: `${ps.config.publicUrl}/api/auth/login?idp=${encodeURIComponent(row.kc_alias)}` };
  await ps.tx(p, async (tx) => {
    await tx.updateTable('sso_connections').set({ last_test: JSON.stringify(result), ...(result.ok && row.status === 'draft' ? { status: 'active' as const } : {}), ...(!result.ok && row.status === 'active' ? { status: 'error' as const } : {}), updated_at: new Date() }).where('id', '=', id).execute();
    await audit(tx, actorOf(p, ip), 'sso.test', 'sso_connection', id, { ok: result.ok }, row.display_name);
  });
  return result;
}

/* ----------------------------------------------------------------- domains */

export async function listDomains(ps: PlatformService, p: Principal): Promise<OrgDomain[]> {
  authorize(p, 'sso.manage', { kind: 'org' });
  return ps.tx(p, (tx) => domains(tx, p.orgId));
}

export async function addDomain(ps: PlatformService, p: Principal, domainIn: string, ip?: string): Promise<OrgDomain> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const domain = (domainIn ?? '').trim().toLowerCase();
  if (!DOMAIN.test(domain)) throw badRequest('Not a valid domain name', { domain: 'invalid' });
  if (await orgForDomain(ps.db, domain)) throw conflict(`${domain} is already claimed by an organization.`);
  return ps.tx(p, async (tx) => {
    await tx.insertInto('org_domains').values({ org_id: p.orgId, domain, verification_token: randomBytes(16).toString('hex') }).execute();
    await audit(tx, actorOf(p, ip), 'domain.add', 'domain', domain, {}, domain);
    return (await domains(tx, p.orgId)).find((d) => d.domain === domain)!;
  });
}

export async function verifyDomain(ps: PlatformService, p: Principal, domainIn: string, ip?: string): Promise<VerifyDomainResponse> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const domain = domainIn.toLowerCase();
  const d = await ps.tx(p, async (tx) => (await domains(tx, p.orgId)).find((x) => x.domain === domain));
  if (!d) throw notFound('Domain');
  if (d.verified) return { domain: d, ok: true, detail: 'already verified' };
  let ok = false;
  let detail: string;
  if (ps.config.devDomainVerifyBypass) {
    ok = true;
    detail = 'verified by the development bypass (CT_DEV_DOMAIN_VERIFY_BYPASS=1); no DNS lookup was made';
  } else {
    try {
      const records = (await resolveTxt(d.verification.name)).map((chunks) => chunks.join(''));
      ok = records.includes(d.verification.value);
      detail = ok ? `found ${d.verification.name} TXT` : `TXT ${d.verification.name} does not contain ${d.verification.value} (found ${records.length} record(s))`;
    } catch (e) {
      detail = `DNS lookup of ${d.verification.name} failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`;
    }
  }
  const result = await ps.tx(p, async (tx) => {
    if (ok) await tx.updateTable('org_domains').set({ verified_at: new Date() }).where('domain', '=', domain).execute();
    await audit(tx, actorOf(p, ip), 'domain.verify', 'domain', domain, { ok, detail, bypass: ps.config.devDomainVerifyBypass }, domain);
    return { domain: (await domains(tx, p.orgId)).find((x) => x.domain === domain)!, org: await tx.selectFrom('orgs').select(['kc_org_id']).where('id', '=', p.orgId).executeTakeFirstOrThrow() };
  });
  if (ok && ps.kc && result.org.kc_org_id) {
    const kc = ps.kc;
    const orgs = await kc.request<{ id: string; name: string; alias: string; enabled: boolean; domains?: { name: string; verified: boolean }[] }>('GET', `/organizations/${result.org.kc_org_id}`).catch(() => null);
    if (orgs) {
      const doms = (orgs.data.domains ?? []).filter((x) => x.name !== domain);
      await kc.updateOrganization({ ...orgs.data, domains: [...doms, { name: domain, verified: true }] }).catch((e: unknown) => ps.log?.warn({ err: e }, 'keycloak domain sync failed'));
    }
  }
  return { domain: result.domain, ok, detail };
}

export async function removeDomain(ps: PlatformService, p: Principal, domainIn: string, ip?: string): Promise<void> {
  authorize(p, 'sso.manage', { kind: 'org' });
  const domain = domainIn.toLowerCase();
  await ps.tx(p, async (tx) => {
    const r = await tx.deleteFrom('org_domains').where('domain', '=', domain).executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw notFound('Domain');
    await audit(tx, actorOf(p, ip), 'domain.remove', 'domain', domain, {}, domain);
  });
}
