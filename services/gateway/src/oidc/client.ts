import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/*
 * Minimal OIDC relying party for the gateway (BFF): authorization code + PKCE
 * with a confidential client, refresh, RP-initiated logout and back-channel
 * logout token verification. Tokens never leave the server.
 */

export interface OidcClientConfig {
  /** e.g. http://localhost:8180/realms/cloudtrain */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL registered with the client. */
  redirectUri: string;
  scopes?: string[];
  fetch?: typeof fetch;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export interface TokenSet {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
}

export class OidcError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export const b64url = (b: Buffer) => b.toString('base64url');
export const randomToken = (bytes = 32) => b64url(randomBytes(bytes));
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

export interface AuthorizeParams {
  state: string;
  nonce: string;
  verifier: string;
  /** Email typed on the identity-first screen. */
  loginHint?: string;
  /** Keycloak identity provider alias: skip Keycloak's screen and go straight to the org's IdP. */
  idpHint?: string;
  prompt?: 'login' | 'none';
}

export class OidcClient {
  private discovery?: Promise<Discovery>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly f: typeof fetch;

  constructor(readonly cfg: OidcClientConfig) {
    this.f = cfg.fetch ?? fetch;
  }

  async meta(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const r = await this.f(`${this.cfg.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
      if (!r.ok) throw new OidcError(`OIDC discovery failed: HTTP ${r.status}`, r.status);
      return (await r.json()) as Discovery;
    })();
    try {
      return await this.discovery;
    } catch (e) {
      this.discovery = undefined;
      throw e;
    }
  }

  private async keys() {
    const m = await this.meta();
    this.jwks ??= createRemoteJWKSet(new URL(m.jwks_uri));
    return this.jwks;
  }

  async authorizationUrl(p: AuthorizeParams): Promise<string> {
    const m = await this.meta();
    const u = new URL(m.authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('scope', (this.cfg.scopes ?? ['openid', 'profile', 'email']).join(' '));
    u.searchParams.set('state', p.state);
    u.searchParams.set('nonce', p.nonce);
    u.searchParams.set('code_challenge', pkceChallenge(p.verifier));
    u.searchParams.set('code_challenge_method', 'S256');
    if (p.loginHint) u.searchParams.set('login_hint', p.loginHint);
    if (p.idpHint) u.searchParams.set('kc_idp_hint', p.idpHint);
    if (p.prompt) u.searchParams.set('prompt', p.prompt);
    return u.toString();
  }

  private async token(body: Record<string, string>): Promise<TokenSet> {
    const m = await this.meta();
    const r = await this.f(m.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...body, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }).toString(),
    });
    const json = (await r.json().catch(() => ({}))) as TokenSet & { error?: string; error_description?: string };
    if (!r.ok) throw new OidcError(`token endpoint: ${json.error ?? r.status}${json.error_description ? ` (${json.error_description})` : ''}`, r.status);
    return json;
  }

  exchangeCode(code: string, verifier: string): Promise<TokenSet> {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.cfg.redirectUri });
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Verifies signature, issuer, audience, expiry and nonce of an ID token. */
  async verifyIdToken(idToken: string, nonce?: string): Promise<JWTPayload & Record<string, unknown>> {
    const m = await this.meta();
    const { payload } = await jwtVerify(idToken, await this.keys(), { issuer: m.issuer, audience: this.cfg.clientId, clockTolerance: 30 });
    if (nonce !== undefined && payload.nonce !== nonce) throw new OidcError('ID token nonce mismatch');
    return payload as JWTPayload & Record<string, unknown>;
  }

  /** Back-channel logout token (OIDC Back-Channel Logout 1.0, section 2.6). */
  async verifyLogoutToken(token: string): Promise<{ sub?: string; sid?: string }> {
    const m = await this.meta();
    const { payload } = await jwtVerify(token, await this.keys(), { issuer: m.issuer, audience: this.cfg.clientId, clockTolerance: 30 });
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || !('http://schemas.openid.net/event/backchannel-logout' in events)) throw new OidcError('not a logout token');
    if ('nonce' in payload) throw new OidcError('logout token must not carry a nonce');
    if (!payload.sub && !payload.sid) throw new OidcError('logout token needs sub or sid');
    return { ...(payload.sub ? { sub: payload.sub } : {}), ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}) };
  }

  async endSessionUrl(idTokenHint: string | undefined, postLogoutRedirectUri: string): Promise<string> {
    const m = await this.meta();
    if (!m.end_session_endpoint) return postLogoutRedirectUri;
    const u = new URL(m.end_session_endpoint);
    if (idTokenHint) u.searchParams.set('id_token_hint', idTokenHint);
    else u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    return u.toString();
  }
}
