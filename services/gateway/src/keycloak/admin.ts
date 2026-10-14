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

  async idpMappers(alias: string): Promise<{ id: string; name: string }[]> {
    return (await this.request<{ id: string; name: string }[]>('GET', `/identity-provider/instances/${encodeURIComponent(alias)}/mappers`)).data;
  }

  /** Claim (OIDC) or attribute (SAML) -> user attribute, re-synced on every login. */
  async ensureAttributeMapper(alias: string, providerId: 'oidc' | 'saml', name: string, source: string, attribute: string): Promise<void> {
    const existing = (await this.idpMappers(alias)).find((m) => m.name === name);
    const mapper = {
      name,
      identityProviderAlias: alias,
      identityProviderMapper: providerId === 'oidc' ? 'oidc-user-attribute-idp-mapper' : 'saml-user-attribute-idp-mapper',
      config: providerId === 'oidc' ? { syncMode: 'FORCE', claim: source, 'user.attribute': attribute } : { syncMode: 'FORCE', 'attribute.name': source, 'user.attribute': attribute },
    };
    if (existing) await this.request('PUT', `/identity-provider/instances/${encodeURIComponent(alias)}/mappers/${existing.id}`, { ...mapper, id: existing.id });
    else await this.request('POST', `/identity-provider/instances/${encodeURIComponent(alias)}/mappers`, mapper);
  }

  /* ---------------------------------------------------------------- users */

  async findUserByEmail(email: string): Promise<KcUser | null> {
    const list = (await this.request<KcUser[]>('GET', `/users?email=${encodeURIComponent(email)}&exact=true`)).data;
    return list[0] ?? null;
  }

  async createUser(u: { email: string; firstName?: string; lastName?: string; attributes?: Record<string, string[]> }): Promise<string> {
    const r = await this.request('POST', '/users', { username: u.email, email: u.email, firstName: u.firstName, lastName: u.lastName, enabled: true, emailVerified: true, attributes: u.attributes ?? {} });
    const id = r.location?.split('/').pop();
    if (id) return id;
    const found = await this.findUserByEmail(u.email);
    if (!found) throw new KeycloakError('user not found after create', 500);
    return found.id;
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

  /** Keycloak's own "set your password" email (sent through the realm SMTP: Mailpit in dev). */
  async sendActionsEmail(id: string, actions: string[], clientId: string, redirectUri: string, lifespanSeconds = 7 * 86_400): Promise<void> {
    await this.request('PUT', `/users/${id}/execute-actions-email?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&lifespan=${lifespanSeconds}`, actions);
  }
}
