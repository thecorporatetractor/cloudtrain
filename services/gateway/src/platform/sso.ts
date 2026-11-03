import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { CreateSsoConnectionRequest, OrgDomain, SsoConnection, SsoGroupMapping, SsoOverview, SsoTestResult, UpdateSsoConnectionRequest, VerifyDomainResponse } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize, ORG_ROLES } from '../authz.js';
import type { Tx } from '../db/index.js';
import type { SsoConnectionRow } from '../db/schema.js';
import { badRequest, conflict, HttpError, notFound } from '../errors.js';
import { TENANT_BROKER_FLOW, type KcIdentityProvider, type KeycloakAdmin } from '../keycloak/admin.js';
import { actorOf, audit } from './audit.js';
import { orgOf } from './admin.js';
import { checkResolves, checkUrl, EgressError, fetchJson, fetchText } from './egress.js';
import { refusedEndpoint } from '../keycloak/repair.js';
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

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string; end_session_endpoint?: string };

/**
 * Fetches an org admin's OIDC discovery document under the SSO egress policy
 * (src/platform/egress.ts): https, public addresses only, optional host
 * allowlist, no redirects. The endpoints it names are what Keycloak will call,
 * so they get the same check. Errors say what is wrong, never what the far end
 * answered (no probing of internal services through the messages).
 */
export async function discover(ps: Pick<PlatformService, 'config' | 'log'>, url: string, log?: { warn(o: object, m?: string): void }): Promise<Discovery> {
  const policy = ps.config.ssoEgress ?? {};
  let d: Record<string, unknown> | null;
  try {
    d = (await fetchJson(url, policy)) as Record<string, unknown> | null;
  } catch (e) {
    const err = e instanceof EgressError ? e : new EgressError('could not be reached', (e as Error).message);
    (log ?? ps.log)?.warn({ url, reason: err.message, detail: err.detail }, 'SSO discovery refused or failed');
    throw badRequest(`The discovery URL ${err.message}.`, { discoveryUrl: 'invalid' });
  }
  if (!d || typeof d !== 'object' || ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'].some((k) => typeof d![k] !== 'string' || !d![k])) throw badRequest('Not an OpenID Connect discovery document', { discoveryUrl: 'invalid' });
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint', 'end_session_endpoint'] as const) {
    if (d[k] === undefined) continue;
    try {
      if (typeof d[k] !== 'string') throw new EgressError('is not a URL');
      // The browser goes to the authorization endpoint; Keycloak calls the others.
      const u = checkUrl(d[k], policy);
      if (k !== 'authorization_endpoint' && k !== 'end_session_endpoint') await checkResolves(u, policy);
    } catch (e) {
      (log ?? ps.log)?.warn({ url, field: k, reason: (e as Error).message, detail: (e as EgressError).detail }, 'SSO discovery endpoint refused');
      throw badRequest(`The discovery document's ${k} ${e instanceof EgressError ? e.message : 'is not acceptable'}.`, { discoveryUrl: 'invalid' });
    }
  }
  return d as unknown as Discovery;
}

/**
 * Keycloak settings every tenant IdP gets. The first-broker-login flow never
 * links a brokered identity to an existing Keycloak user (TENANT_BROKER_FLOW):
 * an org admin controls what its IdP asserts, so an IdP asserting another
 * org's user's email must not sign in as that user. trustEmail only makes
 * Keycloak report the IdP's email as verified (no verify-email step); the
 * gateway still trusts a brokered email only for a verified domain of the
 * IdP's own org (identity.ts, emailTrusted).
 */
export const TENANT_IDP = { enabled: true, trustEmail: true, hideOnLogin: true, firstBrokerLoginFlowAlias: TENANT_BROKER_FLOW } as const;

/**
 * Fetches SAML metadata in the gateway under the SSO egress policy (pinned
 * lookup, no redirects, size cap) and hands Keycloak the XML, not the URL:
 * Keycloak resolving the URL again could be answered with a private address
 * (DNS rebinding) or follow a redirect inward. Returns the XML.
 */
export async function fetchSamlMetadata(ps: Pick<PlatformService, 'config' | 'log'>, url: string): Promise<string> {
  const policy = ps.config.ssoEgress ?? {};
  let xml: string;
  try {
    xml = await fetchText(url, policy, { accept: 'application/samlmetadata+xml, application/xml, text/xml', maxBytes: 1024 * 1024 });
  } catch (e) {
    const err = e instanceof EgressError ? e : new EgressError('could not be reached', (e as Error).message);
    ps.log?.warn({ url, reason: err.message, detail: err.detail }, 'SAML metadata URL refused or failed');
    throw badRequest(`The metadata URL ${err.message}.`, { saml: 'invalid' });
  }
  if (!/<(?:[A-Za-z0-9_-]+:)?EntityDescriptor[\s>]/.test(xml)) throw badRequest('The metadata URL did not answer with SAML metadata (an EntityDescriptor).', { saml: 'invalid' });
  return xml;
}

/**
 * The imported SAML settings name endpoints. Keycloak calls some of them
 * itself (artifact resolution, back-channel logout), so they get the URL
 * policy too; the browser-facing ones at least the scheme and name checks.
 */
async function checkSamlEndpoints(ps: Pick<PlatformService, 'config' | 'log'>, config: Record<string, string>): Promise<void> {
  const policy = ps.config.ssoEgress ?? {};
  for (const [k, v] of Object.entries(config)) {
    if (!/Url$/.test(k) || !v) continue;
    try {
      const u = checkUrl(v, policy);
      if (k !== 'singleSignOnServiceUrl') await checkResolves(u, policy);
    } catch (e) {
      ps.log?.warn({ field: k, url: v, reason: (e as Error).message, detail: (e as EgressError).detail }, 'SAML metadata endpoint refused');
      throw badRequest(`The SAML metadata's ${k} ${e instanceof EgressError ? e.message : 'is not acceptable'}.`, { saml: 'invalid' });
    }
  }
}

export function oidcIdp(alias: string, displayName: string, d: Discovery, o: { clientId: string; clientSecret: string; scopes?: string[] }): KcIdentityProvider {
  return {
    alias,
    displayName,
    providerId: 'oidc',
    ...TENANT_IDP,
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
    const d = await discover(ps, o.discoveryUrl);
    await kc.ensureTenantBrokerFlow();
    await kc.createIdp(oidcIdp(alias, req.displayName.trim(), d, o));
    const roleClaim = o.roleClaim ?? 'roles';
    await kc.ensureAttributeMapper(alias, 'oidc', 'cloudtrain roles', roleClaim, ROLE_ATTRIBUTE);
    await kc.ensureAttributeMapper(alias, 'oidc', 'cloudtrain groups', 'groups', GROUP_ATTRIBUTE);
    settings = { discoveryUrl: o.discoveryUrl, clientId: o.clientId, hasClientSecret: true, scopes: o.scopes ?? ['openid', 'profile', 'email'], roleClaim, issuer: d.issuer };
  } else {
    const s = req.saml;
    if (!s?.metadataUrl) throw badRequest('saml.metadataUrl is required (metadata XML upload: use the URL form for now)', { saml: 'required' });
    const xml = await fetchSamlMetadata(ps, s.metadataUrl);
    let config: Record<string, string>;
    try {
      config = await kc.importIdpConfigFromDocument('saml', xml);
    } catch (e) {
      ps.log?.warn({ err: e, url: s.metadataUrl }, 'SAML metadata import failed');
      throw badRequest('Keycloak could not import the SAML metadata from that URL.', { saml: 'invalid' });
    }
    await checkSamlEndpoints(ps, config);
    await kc.ensureTenantBrokerFlow();
    await kc.createIdp({ alias, displayName: req.displayName.trim(), providerId: 'saml', ...TENANT_IDP, config: { ...config, syncMode: 'FORCE', principalType: 'SUBJECT' } });
    const groupAttribute = s.groupAttribute ?? 'groups';
    await kc.ensureAttributeMapper(alias, 'saml', 'cloudtrain groups', groupAttribute, GROUP_ATTRIBUTE);
    settings = { metadataUrl: s.metadataUrl, entityId: config.idpEntityId ?? config.entityId, groupAttribute };
  }
  // Every user this IdP brokers carries its alias for good (BROKER_ORIGIN_ATTRIBUTE).
  await kc.ensureBrokerOriginMapper(alias);
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
        const d = await discover(ps, req.oidc.discoveryUrl);
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
    // Turning an IdP (back) on re-checks every endpoint Keycloak will call, stored ones included:
    // the repair run may have disabled it for one, and connections made before the SSO egress
    // policy were never checked.
    if (enabled) {
      const refused = await refusedEndpoint(cfg, ps.config.ssoEgress ?? {});
      if (refused) {
        ps.log?.warn({ alias: row.kc_alias, refused }, 'SSO connection not enabled: an endpoint fails the SSO egress policy');
        throw badRequest(`The identity provider's ${refused.replace(/ \(/, ' ').replace(/\)$/, '')}. Update the discovery URL or metadata first.`, { status: 'invalid' });
      }
    }
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
    ps.log?.warn({ err: e }, 'SSO test: Keycloak not reachable');
    steps.push({ name: 'Keycloak reachable', ok: false, detail: 'Keycloak did not answer; see the gateway log.' });
    return null;
  });
  steps.push({ name: 'Identity provider configured in Keycloak', ok: !!idp, ...(idp ? { detail: `${idp.providerId}, ${idp.enabled ? 'enabled' : 'disabled'}` } : {}) });
  if (row.type === 'oidc') {
    const url = String((row.settings as Record<string, unknown>).discoveryUrl ?? '');
    try {
      const d = await discover(ps, url);
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
