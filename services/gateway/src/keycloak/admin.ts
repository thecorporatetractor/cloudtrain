/*
 * Keycloak admin REST API (realm-scoped), authenticated as the
 * `cloudtrain-gateway-admin` service account (client credentials). Org admins
 * never talk to Keycloak; the gateway drives it on their behalf.
 */

export interface KeycloakAdminConfig {
  /** e.g. http://localhost:8180 */
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

export class KeycloakError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface KcOrganization {
  id: string;
  name: string;
  alias: string;
  enabled: boolean;
  domains?: { name: string; verified: boolean }[];
  description?: string;
}

export interface KcIdentityProvider {
  alias: string;
  displayName?: string;
  providerId: string;
  enabled: boolean;
  trustEmail?: boolean;
  firstBrokerLoginFlowAlias?: string;
  organizationId?: string;
  hideOnLogin?: boolean;
  config: Record<string, string>;
}

export interface KcIdpMapper {
  id: string;
  name: string;
  identityProviderAlias: string;
  identityProviderMapper: string;
  config: Record<string, string>;
}

export interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
}

/**
 * First-broker-login flow of tenant IdPs (org self-service SSO). It only ever
 * creates a new Keycloak user: "Create User If Unique" is REQUIRED, so a
 * brokered identity whose email or username already belongs to a Keycloak user
 * fails the login instead of being linked to that user. The built-in "first
 * broker login" flow may link it ("Verify Existing Account By Email" trusts an
 * IdP with trustEmail), and an org admin controls what its IdP asserts: an IdP
 * asserting another org's user's email would then sign in as that user.
 */
export const TENANT_BROKER_FLOW = 'cloudtrain tenant broker login';

/**
 * User attribute holding the tenant IdPs a Keycloak user came from (one value per IdP alias). Each
 * tenant IdP has a hardcoded-attribute mapper that sets it when the IdP creates the user (sync
 * mode IMPORT, first login only), and the gateway's repair run (keycloak/repair.ts) adds the alias
 * of every IdP a user is linked to, so a user linked to several IdPs keeps all of them. Nothing
 * removes a value: the stamp outlives the IdP link (a brokered user who sets a password in the
 * account console and unlinks the IdP still carries it), and users cannot edit it (unmanaged
 * attributes are admin-edit only). The gateway treats a local login of such a user like a login
 * through those IdPs when deciding whether to trust its email (platform/identity.ts).
 *
 * Not FORCE: Keycloak's hardcoded-attribute mapper then sets the attribute to the single value of
 * the IdP of each login, which would drop the other IdPs' origins. FORCE protects nothing more
 * either: it only re-stamps on a login through the IdP, i.e. while the link exists, and the repair
 * run re-stamps every linked user anyway.
 */
export const BROKER_ORIGIN_ATTRIBUTE = 'ct_broker_origin';
const BROKER_ORIGIN_MAPPER = 'cloudtrain broker origin';
const CREATE_IF_UNIQUE = 'idp-create-user-if-unique';

export class KeycloakAdmin {
  private token?: { value: string; until: number };
  private readonly f: typeof fetch;

  constructor(readonly cfg: KeycloakAdminConfig) {
    this.f = cfg.fetch ?? fetch;
  }

  private get base() {
    return `${this.cfg.baseUrl.replace(/\/$/, '')}/admin/realms/${encodeURIComponent(this.cfg.realm)}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 10_000) return this.token.value;
    const r = await this.f(`${this.cfg.baseUrl.replace(/\/$/, '')}/realms/${encodeURIComponent(this.cfg.realm)}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }).toString(),
    });
    if (!r.ok) throw new KeycloakError(`Keycloak admin login failed: HTTP ${r.status}`, r.status);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; data: T; location?: string }> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await this.f(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: raw ? (body as string) : JSON.stringify(body) } : {}) });
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { errorMessage?: string; error?: string; error_description?: string };
        msg = j.errorMessage ?? j.error_description ?? j.error ?? text;
      } catch {
        /* keep text */
      }
      throw new KeycloakError(`Keycloak ${method} ${path}: HTTP ${r.status} ${msg}`.trim(), r.status);
    }
    const location = r.headers.get('location') ?? undefined;
    return { status: r.status, data: (text ? JSON.parse(text) : undefined) as T, ...(location ? { location } : {}) };
  }

  /* --------------------------------------------------------------- realm */

  /**
   * Creates or repairs TENANT_BROKER_FLOW: Create User If Unique, REQUIRED,
   * and nothing else enabled. Idempotent.
   */
  async ensureTenantBrokerFlow(): Promise<void> {
    const flows = (await this.request<{ alias: string }[]>('GET', '/authentication/flows')).data;
    if (!flows.some((f) => f.alias === TENANT_BROKER_FLOW)) {
      try {
        await this.request('POST', '/authentication/flows', {
          alias: TENANT_BROKER_FLOW,
          description: 'CloudTrain tenant IdPs: create a new user, never link to an existing account',
          providerId: 'basic-flow',
          topLevel: true,
          builtIn: false,
        });
      } catch (e) {
        // A concurrent call created it first: repair it below like any existing flow.
        if (!(e instanceof KeycloakError && e.status === 409)) throw e;
      }
    }
    const path = `/authentication/flows/${encodeURIComponent(TENANT_BROKER_FLOW)}/executions`;
    type Exec = { id: string; providerId?: string; requirement: string; level?: number; index?: number };
    let execs = (await this.request<Exec[]>('GET', path)).data;
    if (!execs.some((e) => e.providerId === CREATE_IF_UNIQUE)) {
      await this.request('POST', `${path}/execution`, { provider: CREATE_IF_UNIQUE });
      execs = (await this.request<Exec[]>('GET', path)).data;
    }
    for (const e of execs) {
      const want = e.providerId === CREATE_IF_UNIQUE ? 'REQUIRED' : 'DISABLED';
      if (e.requirement !== want) await this.request('PUT', path, { ...e, requirement: want });
    }
  }

  async userProfile(): Promise<Record<string, unknown>> {
    return (await this.request<Record<string, unknown>>('GET', '/users/profile')).data;
  }

  /** Lets IdP mappers store `idp_roles`/`idp_groups`/`title` (unmanaged attributes, admin-editable). */
  async allowUnmanagedAttributes(): Promise<boolean> {
    const p = await this.userProfile();
    if (p.unmanagedAttributePolicy === 'ADMIN_EDIT' || p.unmanagedAttributePolicy === 'ENABLED') return false;
    await this.request('PUT', '/users/profile', { ...p, unmanagedAttributePolicy: 'ADMIN_EDIT' });
    return true;
  }

  /* -------------------------------------------------------- organizations */

  async findOrganization(alias: string): Promise<KcOrganization | null> {
    const list = (await this.request<KcOrganization[]>('GET', `/organizations?search=${encodeURIComponent(alias)}&briefRepresentation=false`)).data;
    return list.find((o) => o.alias === alias) ?? null;
  }

  async createOrganization(o: { name: string; alias: string; domains: { name: string; verified: boolean }[]; description?: string }): Promise<KcOrganization> {
    await this.request('POST', '/organizations', { ...o, enabled: true });
    const created = await this.findOrganization(o.alias);
    if (!created) throw new KeycloakError(`organization ${o.alias} not found after create`, 500);
    return created;
  }

  async updateOrganization(o: KcOrganization): Promise<void> {
    await this.request('PUT', `/organizations/${o.id}`, o);
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.request('DELETE', `/organizations/${id}`);
  }

  async organizationIdps(orgId: string): Promise<KcIdentityProvider[]> {
    return (await this.request<KcIdentityProvider[]>('GET', `/organizations/${orgId}/identity-providers`)).data;
  }

  async linkIdp(orgId: string, alias: string): Promise<void> {
    try {
      await this.request('POST', `/organizations/${orgId}/identity-providers`, JSON.stringify(alias), true);
    } catch (e) {
      if (!(e instanceof KeycloakError && e.status === 409)) throw e;
    }
  }

  async unlinkIdp(orgId: string, alias: string): Promise<void> {
    try {
      await this.request('DELETE', `/organizations/${orgId}/identity-providers/${encodeURIComponent(alias)}`);
    } catch (e) {
      if (!(e instanceof KeycloakError && e.status === 404)) throw e;
    }
  }

  async addOrgMember(orgId: string, userId: string): Promise<void> {
    try {
      await this.request('POST', `/organizations/${orgId}/members`, JSON.stringify(userId), true);
    } catch (e) {
      if (!(e instanceof KeycloakError && e.status === 409)) throw e;
    }
  }

  /* --------------------------------------------------- identity providers */

  async getIdp(alias: string): Promise<KcIdentityProvider | null> {
    try {
      return (await this.request<KcIdentityProvider>('GET', `/identity-provider/instances/${encodeURIComponent(alias)}`)).data;
    } catch (e) {
      if (e instanceof KeycloakError && e.status === 404) return null;
      throw e;
    }
  }

  async createIdp(idp: KcIdentityProvider): Promise<void> {
    await this.request('POST', '/identity-provider/instances', idp);
  }

  async updateIdp(idp: KcIdentityProvider): Promise<void> {
    await this.request('PUT', `/identity-provider/instances/${encodeURIComponent(idp.alias)}`, idp);
  }

  async deleteIdp(alias: string): Promise<void> {
    try {
      await this.request('DELETE', `/identity-provider/instances/${encodeURIComponent(alias)}`);
    } catch (e) {
      if (!(e instanceof KeycloakError && e.status === 404)) throw e;
    }
  }

  /** SAML/OIDC metadata import (`fromUrl`), as the admin console does. */
  async importIdpConfig(providerId: 'oidc' | 'saml', fromUrl: string): Promise<Record<string, string>> {
    return (await this.request<Record<string, string>>('POST', '/identity-provider/import-config', { providerId, fromUrl })).data;
  }

  async idpMappers(alias: string): Promise<KcIdpMapper[]> {
    return (await this.request<KcIdpMapper[]>('GET', `/identity-provider/instances/${encodeURIComponent(alias)}/mappers`)).data;
  }

  /**
   * Creates the IdP mapper named `mapper.name`, or updates it when its type or one of the config
   * values in `mapper` differs (left alone when equal: no write per repair run).
   */
  private async ensureIdpMapper(alias: string, mapper: Omit<KcIdpMapper, 'id' | 'identityProviderAlias'>): Promise<void> {
    const path = `/identity-provider/instances/${encodeURIComponent(alias)}/mappers`;
    const want = { ...mapper, identityProviderAlias: alias };
    const existing = (await this.idpMappers(alias)).find((m) => m.name === mapper.name);
    if (!existing) await this.request('POST', path, want);
    else if (existing.identityProviderMapper !== mapper.identityProviderMapper || Object.entries(mapper.config).some(([k, v]) => existing.config?.[k] !== v)) {
      await this.request('PUT', `${path}/${existing.id}`, { ...want, id: existing.id, config: { ...existing.config, ...mapper.config } });
    }
  }

  /** Claim (OIDC) or attribute (SAML) -> user attribute, re-synced on every login. */
  async ensureAttributeMapper(alias: string, providerId: 'oidc' | 'saml', name: string, source: string, attribute: string): Promise<void> {
    await this.ensureIdpMapper(alias, {
      name,
      identityProviderMapper: providerId === 'oidc' ? 'oidc-user-attribute-idp-mapper' : 'saml-user-attribute-idp-mapper',
      config: providerId === 'oidc' ? { syncMode: 'FORCE', claim: source, 'user.attribute': attribute } : { syncMode: 'FORCE', 'attribute.name': source, 'user.attribute': attribute },
    });
  }

  /**
   * Stamps BROKER_ORIGIN_ATTRIBUTE = `alias` on the users the IdP creates (IMPORT: once, at their
   * first login; see BROKER_ORIGIN_ATTRIBUTE). Moves a FORCE mapper to IMPORT. Idempotent.
   */
  async ensureBrokerOriginMapper(alias: string): Promise<void> {
    await this.ensureIdpMapper(alias, { name: BROKER_ORIGIN_MAPPER, identityProviderMapper: 'hardcoded-attribute-idp-mapper', config: { syncMode: 'IMPORT', attribute: BROKER_ORIGIN_ATTRIBUTE, 'attribute.value': alias } });
  }

  /* ---------------------------------------------------------------- users */

  async findUserByEmail(email: string): Promise<KcUser | null> {
    const list = (await this.request<KcUser[]>('GET', `/users?email=${encodeURIComponent(email)}&exact=true`)).data;
    return list[0] ?? null;
  }

  async findUserByUsername(username: string): Promise<KcUser | null> {
    const list = (await this.request<KcUser[]>('GET', `/users?username=${encodeURIComponent(username)}&exact=true`)).data;
    return list[0] ?? null;
  }

  /** Users brokered from (linked to) the IdP `alias`; `full` includes their attributes. */
  async idpUsers(alias: string, page = 200, full = false): Promise<KcUser[]> {
    const out: KcUser[] = [];
    for (let first = 0; ; first += page) {
      const list = (await this.request<KcUser[]>('GET', `/users?idpAlias=${encodeURIComponent(alias)}&briefRepresentation=${full ? 'false' : 'true'}&first=${first}&max=${page}`)).data;
      out.push(...list);
      if (list.length < page) return out;
    }
  }

  async federatedIdentities(id: string): Promise<{ identityProvider: string; userId?: string; userName?: string }[]> {
    return (await this.request<{ identityProvider: string }[]>('GET', `/users/${encodeURIComponent(id)}/federated-identity`)).data;
  }

  /**
   * Takes the IdP links `aliases` away from user `id`. A user with nothing else (no other link,
   * no credential such as a password) only existed through them and is deleted, which frees its
   * email and username in Keycloak.
   */
  async dropBrokeredLinks(id: string, aliases: string[]): Promise<'deleted' | 'unlinked' | 'none'> {
    const links = await this.federatedIdentities(id);
    const drop = links.filter((l) => aliases.includes(l.identityProvider));
    if (!drop.length) return 'none';
    const creds = (await this.request<unknown[]>('GET', `/users/${encodeURIComponent(id)}/credentials`)).data;
    if (drop.length === links.length && creds.length === 0) {
      await this.deleteUser(id);
      return 'deleted';
    }
    for (const l of drop) await this.request('DELETE', `/users/${encodeURIComponent(id)}/federated-identity/${encodeURIComponent(l.identityProvider)}`);
    return 'unlinked';
  }

  async createUser(u: { email: string; firstName?: string; lastName?: string; attributes?: Record<string, string[]> }): Promise<string> {
    const r = await this.request('POST', '/users', { username: u.email, email: u.email, firstName: u.firstName, lastName: u.lastName, enabled: true, emailVerified: true, attributes: u.attributes ?? {} });
    const id = r.location?.split('/').pop();
    if (id) return id;
    const found = await this.findUserByEmail(u.email);
    if (!found) throw new KeycloakError('user not found after create', 500);
    return found.id;
  }

  /** Adds `value` to the user's attribute `name` (kept when already there). */
  async addUserAttribute(id: string, name: string, value: string): Promise<void> {
    const u = (await this.request<KcUser>('GET', `/users/${encodeURIComponent(id)}`)).data;
    const values = u.attributes?.[name] ?? [];
    if (values.includes(value)) return;
    await this.request('PUT', `/users/${encodeURIComponent(id)}`, { ...u, attributes: { ...(u.attributes ?? {}), [name]: [...values, value] } });
  }

  async setUserEnabled(id: string, enabled: boolean): Promise<void> {
    const u = (await this.request<KcUser>('GET', `/users/${id}`)).data;
    await this.request('PUT', `/users/${id}`, { ...u, enabled });
  }

  /** Ends the user's Keycloak sessions (and through back-channel logout, every client's). */
  async logoutUser(id: string): Promise<void> {
    try {
      await this.request('POST', `/users/${id}/logout`);
    } catch (e) {
      if (!(e instanceof KeycloakError && e.status === 404)) throw e;
    }
  }

  async getUser(id: string): Promise<KcUser | null> {
    try {
      return (await this.request<KcUser>('GET', `/users/${encodeURIComponent(id)}`)).data;
    } catch (e) {
      if (e instanceof KeycloakError && e.status === 404) return null;
      throw e;
    }
  }

  /** Permanently deletes the user (GDPR erasure). False when there was no such user: deleting twice is not an error. */
  async deleteUser(id: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/users/${encodeURIComponent(id)}`);
      return true;
    } catch (e) {
      if (e instanceof KeycloakError && e.status === 404) return false;
      throw e;
    }
  }

  /** Keycloak's own "set your password" email (sent through the realm SMTP: Mailpit in dev). */
  async sendActionsEmail(id: string, actions: string[], clientId: string, redirectUri: string, lifespanSeconds = 7 * 86_400): Promise<void> {
    await this.request('PUT', `/users/${id}/execute-actions-email?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&lifespan=${lifespanSeconds}`, actions);
  }
}
