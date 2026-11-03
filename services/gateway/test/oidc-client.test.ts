import { describe, expect, it } from 'vitest';
import { OidcClient } from '../src/oidc/client.js';

describe('OidcClient', () => {
  it('bounds every call to the IdP with a timeout signal, so a hung IdP cannot hang a request', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      if (String(url).endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({ issuer: 'https://idp.example', authorization_endpoint: 'https://idp.example/auth', token_endpoint: 'https://idp.example/token', jwks_uri: 'https://idp.example/jwks' }));
      }
      return new Response(JSON.stringify({ access_token: 'a', expires_in: 60 }));
    }) as typeof fetch;
    const c = new OidcClient({ issuer: 'https://idp.example', clientId: 'c', clientSecret: 's', redirectUri: 'https://app.example/cb', fetch: f });
    await c.refresh('rt');
    expect(signals).toHaveLength(2);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
  });
});
