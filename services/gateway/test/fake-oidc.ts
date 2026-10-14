import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

/**
 * A tiny OpenID provider for auth-flow tests: discovery, JWKS, token endpoint
 * (authorization_code with PKCE, refresh_token), end-session. The "browser +
 * login page" step is `authorize(url, claims)`, which returns the code the
 * provider would have redirected back with.
 */
export class FakeOidcProvider {
  issuer = '';
  clientId = 'cloudtrain-gateway';
  clientSecret = 'test-secret';
  private server?: Server;
  private key?: CryptoKey;
  private jwk?: JWK;
  private codes = new Map<string, { claims: Record<string, unknown>; challenge: string; redirectUri: string; nonce: string; sid: string }>();
  private refresh = new Map<string, { claims: Record<string, unknown>; sid: string }>();
  tokenCalls = 0;
  accessTtl = 300;

  async start(): Promise<this> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.key = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/realms/test`;
    return this;
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  async sign(payload: Record<string, unknown>, ttl = 300): Promise<string> {
    return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(this.issuer).setAudience(this.clientId).setIssuedAt().setExpirationTime(`${ttl}s`).sign(this.key!);
  }

  /** Plays the browser at the IdP: the user authenticates with `claims`; returns the callback query. */
  authorize(authUrl: string, claims: Record<string, unknown>): { code: string; state: string } {
    const u = new URL(authUrl);
    const code = randomUUID();
    this.codes.set(code, { claims, challenge: u.searchParams.get('code_challenge')!, redirectUri: u.searchParams.get('redirect_uri')!, nonce: u.searchParams.get('nonce')!, sid: randomUUID() });
    return { code, state: u.searchParams.get('state')! };
  }

  logoutToken(sub: string, sid?: string): Promise<string> {
    return this.sign({ sub, ...(sid ? { sid } : {}), events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, jti: randomUUID() });
  }

  revokeRefreshTokens() {
    this.refresh.clear();
  }

  private async handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    const url = new URL(req.url!, this.issuer);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const base = new URL(this.issuer).pathname;
    if (url.pathname === `${base}/.well-known/openid-configuration`) {
      return json(200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/auth`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks`, end_session_endpoint: `${this.issuer}/logout` });
    }
    if (url.pathname === `${base}/jwks`) return json(200, { keys: [this.jwk] });
    if (url.pathname === `${base}/token` && req.method === 'POST') {
      this.tokenCalls++;
      let raw = '';
      for await (const c of req) raw += c;
      const f = new URLSearchParams(raw);
      if (f.get('client_id') !== this.clientId || f.get('client_secret') !== this.clientSecret) return json(401, { error: 'invalid_client' });
      let claims: Record<string, unknown>;
      let sid: string;
      let nonce: string | undefined;
      if (f.get('grant_type') === 'authorization_code') {
        const c = this.codes.get(f.get('code') ?? '');
        this.codes.delete(f.get('code') ?? '');
        if (!c) return json(400, { error: 'invalid_grant' });
        const challenge = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
        if (challenge !== c.challenge || f.get('redirect_uri') !== c.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'PKCE or redirect_uri mismatch' });
        ({ claims, sid, nonce } = c);
      } else if (f.get('grant_type') === 'refresh_token') {
        const r = this.refresh.get(f.get('refresh_token') ?? '');
        if (!r) return json(400, { error: 'invalid_grant' });
        ({ claims, sid } = r);
      } else return json(400, { error: 'unsupported_grant_type' });
      const refresh = randomUUID();
      this.refresh.set(refresh, { claims, sid });
      return json(200, { access_token: randomUUID(), refresh_token: refresh, expires_in: this.accessTtl, token_type: 'Bearer', id_token: await this.sign({ ...claims, sid, ...(nonce ? { nonce } : {}) }) });
    }
    return json(404, { error: 'not found' });
  }
}
