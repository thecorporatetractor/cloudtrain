import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { lookup as dnsLookup } from 'node:dns';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkResolves, checkUrl, EgressError, fetchJson, fetchText, isPrivateAddress } from '../src/platform/egress.js';
import { createConnection, discover, fetchSamlMetadata, updateConnection } from '../src/platform/sso.js';
import { KeycloakAdmin, TENANT_BROKER_FLOW } from '../src/keycloak/admin.js';
import type { PlatformService } from '../src/platform/service.js';
import { alice } from './fakes.js';
import type { PlatformConfig } from '../src/platform/service.js';
import { refusedEndpoint } from '../src/keycloak/repair.js';

/** A resolver that answers `addr` for every name. */
const resolvesTo = (...addrs: string[]) =>
  ((_h: string, _o: object, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => cb(null, addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))) as unknown as typeof dnsLookup;

describe('SSO egress policy', () => {
  it('classifies private, loopback, link-local, metadata and cluster ranges', () => {
    for (const a of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '168.63.129.16', '100.64.0.10', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'garbage']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '52.1.2.3', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('classifies the IPv6 forms that embed or route to a v4 address', () => {
    // IPv4-compatible, hex-form mapped, local-use NAT64, 6to4 and Teredo.
    for (const a of ['::7f00:1', '::a00:1', '::127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '64:ff9b:1::a00:1', '2002:a00:1::1', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:3fff:fdd2']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['2a00:1450:4001::200e', '2600:1f18::1']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('checkUrl: https only, no credentials, no private literals or internal names, optional allowlist', () => {
    expect(() => checkUrl('http://idp.example.com/x')).toThrow(/https/);
    expect(() => checkUrl('file:///etc/passwd')).toThrow(EgressError);
    expect(() => checkUrl('https://u:p@idp.example.com/')).toThrow(/credentials/);
    for (const u of ['https://10.1.2.3/', 'https://[::1]/', 'https://169.254.169.254/latest', 'https://keycloak.cloudtrain.svc/', 'https://postgres.default.svc.cluster.local/', 'https://metadata.google.internal/', 'https://localhost/', 'https://intranet/', 'https://x.svc.cluster.local./', 'https://localhost./', 'https://[::7f00:1]/', 'https://[2002:a00:1::1]/']) {
      expect(() => checkUrl(u), u).toThrow(/public address/);
    }
    expect(checkUrl('https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration').hostname).toBe('login.microsoftonline.com');
    const allow = { allowedHosts: ['login.microsoftonline.com', '*.okta.com'] };
    expect(() => checkUrl('https://acme.okta.com/', allow)).not.toThrow();
    expect(() => checkUrl('https://okta.com.evil.test/', allow)).toThrow(/allowed list/);
    expect(() => checkUrl('https://evilokta.com/', allow)).toThrow(/allowed list/);
    // Development: http and private addresses when the policy says so.
    expect(() => checkUrl('http://localhost:8180/realms/x', { allowHttp: true, allowPrivate: true })).not.toThrow();
  });

  it('checkResolves refuses a public-looking name that resolves to a private address', async () => {
    await expect(checkResolves(new URL('https://idp.example.com/'), {}, resolvesTo('10.0.0.7'))).rejects.toThrow(/public address/);
    await expect(checkResolves(new URL('https://idp.example.com/'), {}, resolvesTo('8.8.8.8', '10.0.0.7'))).rejects.toThrow(/public address/);
    await expect(checkResolves(new URL('https://idp.example.com/'), {}, resolvesTo('8.8.8.8'))).resolves.toBeUndefined();
  });

  describe('fetchJson against a local server', () => {
    let server: Server;
    let base: string;
    const dev = { allowHttp: true, allowPrivate: true };
    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === '/host') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ host: req.headers.host }));
        if (req.url === '/redirect') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
        if (req.url === '/big') return res.writeHead(200, { 'content-type': 'application/json' }).end(`"${'x'.repeat(300 * 1024)}"`);
        if (req.url === '/secret') return res.writeHead(500).end('internal stack trace with secrets');
        if (req.url === '/saml') return res.writeHead(200, { 'content-type': 'application/samlmetadata+xml' }).end('<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example/"></md:EntityDescriptor>');
        if (req.url === '/doc') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/auth`, token_endpoint: 'http://10.0.0.5/token', jwks_uri: `${base}/jwks` }));
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('refuses loopback in the strict policy, even when DNS says so at connect time', async () => {
      await expect(fetchJson(`${base}/`, { allowHttp: true })).rejects.toThrow(/public address/);
      // The name passes checkUrl; the address it is dialed at does not (DNS rebinding).
      await expect(fetchJson(`http://idp.example.com:${new URL(base).port}/`, { allowHttp: true }, { lookup: resolvesTo('127.0.0.1') })).rejects.toThrow(/public address/);
    });

    it('resolves once and dials that address: a second, private answer is never used (rebinding)', async () => {
      let calls = 0;
      // Each lookup answers differently: the request must dial the address that was checked, never look again.
      const rebinding = ((_h: string, _o: object, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => {
        calls++;
        cb(null, [{ address: calls === 1 ? '127.0.0.1' : '10.9.9.9', family: 4 }]);
      }) as unknown as typeof dnsLookup;
      const port = new URL(base).port;
      // Development policy (private allowed) so the pinned loopback answer is reachable: one lookup, the name in Host.
      expect(await fetchJson(`http://idp.example.com:${port}/host`, dev, { lookup: rebinding })).toEqual({ host: `idp.example.com:${port}` });
      expect(calls).toBe(1);
    });

    it('fetches under the development policy, never follows redirects, caps the size, hides upstream detail', async () => {
      expect(await fetchJson(`${base}/`, dev)).toEqual({ ok: true });
      await expect(fetchJson(`${base}/redirect`, dev)).rejects.toThrow('did not answer with a document');
      await expect(fetchJson(`${base}/big`, dev)).rejects.toThrow(/too large/);
      const e = (await fetchJson(`${base}/secret`, dev).catch((x: unknown) => x)) as EgressError;
      expect(e.message).not.toMatch(/stack|secret|500/);
      expect(e.detail).toBe('HTTP 500');
    });

    it('a SAML connection uses the tenant broker flow (never the linking first-broker-login flow)', async () => {
      const calls: string[] = [];
      let idp: Record<string, unknown> | undefined;
      const kc = {
        getIdp: async () => undefined,
        importIdpConfigFromDocument: async () => ({ singleSignOnServiceUrl: 'https://idp.example/sso', idpEntityId: 'https://idp.example/' }),
        ensureTenantBrokerFlow: async () => void calls.push('ensureTenantBrokerFlow'),
        createIdp: async (x: Record<string, unknown>) => {
          calls.push('createIdp');
          idp = x;
        },
        ensureAttributeMapper: async () => undefined,
        ensureBrokerOriginMapper: async () => undefined,
      };
      let txCall = 0;
      const ps = {
        kc,
        config: { ssoEgress: dev } as PlatformConfig,
        log: { info: () => undefined, warn: () => undefined },
        tx: async () => (txCall++ === 0 ? { mappings: [], org: { kc_org_id: null }, doms: [] } : { id: 'conn' }),
      } as unknown as PlatformService;
      const admin = { ...alice, roles: ['org_admin' as const] };
      expect(await createConnection(ps, admin, { type: 'saml', displayName: 'Acme SAML', saml: { metadataUrl: `${base}/saml` } } as never)).toEqual({ id: 'conn' });
      expect(calls).toEqual(['ensureTenantBrokerFlow', 'createIdp']);
      expect(idp).toMatchObject({ providerId: 'saml', firstBrokerLoginFlowAlias: TENANT_BROKER_FLOW, trustEmail: true, hideOnLogin: true });
    });

    it('SAML metadata is fetched by the gateway under the policy, never by Keycloak from the URL', async () => {
      const ps = { config: { ssoEgress: { allowHttp: true } } as PlatformConfig, log: { info: () => undefined, warn: () => undefined } };
      const strict = (await fetchSamlMetadata(ps, `${base}/saml`).catch((x: unknown) => x)) as { status: number; message: string };
      expect([strict.status, strict.message]).toEqual([422, 'The metadata URL must be a public address.']);
      const devPs = { config: { ssoEgress: dev } as PlatformConfig, log: ps.log };
      expect(await fetchSamlMetadata(devPs, `${base}/saml`)).toMatch(/EntityDescriptor/);
      await expect(fetchSamlMetadata(devPs, `${base}/redirect`)).rejects.toMatchObject({ status: 422 });
      await expect(fetchSamlMetadata(devPs, `${base}/`)).rejects.toThrow(/EntityDescriptor/);
      expect(await fetchText(`${base}/saml`, dev, { accept: 'application/xml' })).toMatch(/^<md:EntityDescriptor/);
      // Keycloak gets the document as an upload; no URL for it to fetch.
      let sent: FormData | undefined;
      const f = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }));
        sent = init?.body as FormData;
        return new Response(JSON.stringify({ singleSignOnServiceUrl: 'https://idp.example/sso' }));
      }) as typeof fetch;
      const kc = new KeycloakAdmin({ baseUrl: 'http://kc.test', realm: 'r', clientId: 'c', clientSecret: 's', fetch: f });
      expect(await kc.importIdpConfigFromDocument('saml', '<EntityDescriptor/>')).toEqual({ singleSignOnServiceUrl: 'https://idp.example/sso' });
      expect(sent).toBeInstanceOf(FormData);
      expect(sent!.get('providerId')).toBe('saml');
      expect(await (sent!.get('file') as Blob).text()).toBe('<EntityDescriptor/>');
      expect(sent!.has('fromUrl')).toBe(false);
    });

    it('discover refuses a document whose server-side endpoints point inside the network', async () => {
      const warn: object[] = [];
      const ps = { config: { ssoEgress: { allowHttp: true } } as PlatformConfig, log: { info: () => undefined, warn: (o: object) => void warn.push(o) } };
      // Strict on addresses: the discovery URL itself is refused, with a generic message.
      const strict = (await discover(ps, `${base}/doc`).catch((x: unknown) => x)) as { status: number; message: string };
      expect([strict.status, strict.message]).toEqual([422, 'The discovery URL must be a public address.']);
      // The endpoints Keycloak will call get the same policy as the discovery URL.
      const listed = { config: { ssoEgress: { ...dev, allowedHosts: ['127.0.0.1'] } } as PlatformConfig, log: ps.log };
      const ep = (await discover(listed, `${base}/doc`).catch((x: unknown) => x)) as { status: number; message: string };
      expect([ep.status, ep.message]).toEqual([422, "The discovery document's token_endpoint host is not on the allowed list for identity providers."]);
      expect(warn.length).toBeGreaterThan(0);
      const devPs = { config: { ssoEgress: dev } as PlatformConfig, log: ps.log };
      await expect(discover(devPs, `${base}/doc`)).resolves.toMatchObject({ token_endpoint: 'http://10.0.0.5/token' });
    });
  });
});

describe('the repair run re-validates the endpoints Keycloak calls for existing tenant IdPs', () => {
  it('refuses a private or internal back-channel endpoint, checks browser endpoints by URL only', async () => {
    expect(await refusedEndpoint({ authorizationUrl: 'https://idp.example.com/a', tokenUrl: 'https://10.0.0.5/token', jwksUrl: 'https://idp.example.com/j' }, {})).toMatch(/^tokenUrl \(must be a public address\)/);
    expect(await refusedEndpoint({ tokenUrl: 'https://keycloak.svc.cluster.local/t' }, {})).toMatch(/^tokenUrl/);
    expect(await refusedEndpoint({ singleLogoutServiceUrl: 'https://169.254.169.254/x' }, {})).toMatch(/^singleLogoutServiceUrl/);
    expect(await refusedEndpoint({ authorizationUrl: 'http://idp.example.com/a' }, {})).toMatch(/^authorizationUrl \(must be an https URL\)/);
    // Literal public addresses need no lookup; non-URL settings are ignored.
    expect(await refusedEndpoint({ tokenUrl: 'https://8.8.8.8/t', clientId: '10.0.0.1' }, {})).toBeNull();
    // Development policy: the dev IdP on http://localhost passes.
    expect(await refusedEndpoint({ tokenUrl: 'http://localhost:8180/t' }, { allowHttp: true, allowPrivate: true })).toBeNull();
  });
});

describe('a DNS outage is not a refusal; turning an IdP on re-checks its stored endpoints', () => {
  const failing = ((_h: string, _o: object, cb: (e: Error | null) => void) => cb(Object.assign(new Error('getaddrinfo EAI_AGAIN idp.example.com'), { code: 'EAI_AGAIN' }))) as unknown as typeof dnsLookup;

  it('a name that does not resolve is listed as unresolved, not refused', async () => {
    const unresolved: string[] = [];
    expect(await refusedEndpoint({ tokenUrl: 'https://idp.example.com/t', jwksUrl: 'https://idp.example.com/j' }, {}, unresolved, failing)).toBeNull();
    expect(unresolved).toEqual(['tokenUrl', 'jwksUrl']);
    // A definite refusal still wins over an unresolved name.
    expect(await refusedEndpoint({ tokenUrl: 'https://idp.example.com/t', jwksUrl: 'https://10.0.0.5/j' }, {}, [], failing)).toMatch(/^jwksUrl \(must be a public address\)/);
    expect(await refusedEndpoint({ tokenUrl: 'https://idp.example.com/t' }, {}, [], resolvesTo('10.1.1.1'))).toMatch(/^tokenUrl \(must be a public address\)/);
  });

  function connPs(config: Record<string, string>, enabled: boolean) {
    const updated: Record<string, unknown>[] = [];
    let txCall = 0;
    const ps = {
      kc: {
        getIdp: async () => ({ alias: 'acme-oidc', providerId: 'oidc', enabled, firstBrokerLoginFlowAlias: TENANT_BROKER_FLOW, config }),
        updateIdp: async (x: Record<string, unknown>) => void updated.push(x),
      },
      config: { ssoEgress: {} } as PlatformConfig,
      log: { info: () => undefined, warn: () => undefined },
      tx: async () => (txCall++ === 0 ? { row: { id: 'conn', kc_alias: 'acme-oidc', type: 'oidc', status: 'active', display_name: 'Acme', settings: {} }, mappings: undefined, doms: [] } : { id: 'conn' }),
    } as unknown as PlatformService;
    return { ps, updated };
  }
  const admin = { ...alice, roles: ['org_admin' as const] };

  it('re-enabling a connection whose stored token endpoint is private is refused', async () => {
    const { ps, updated } = connPs({ authorizationUrl: 'https://8.8.8.8/a', tokenUrl: 'https://10.0.0.5/t' }, false);
    const e = (await updateConnection(ps, admin, 'conn', { status: 'active' }).catch((x: unknown) => x)) as { status: number; message: string };
    expect([e.status, e.message]).toEqual([422, "The identity provider's tokenUrl must be a public address. Update the discovery URL or metadata first."]);
    expect(updated).toEqual([]);
    // Disabling it is always possible.
    const off = connPs({ tokenUrl: 'https://10.0.0.5/t' }, true);
    expect(await updateConnection(off.ps, admin, 'conn', { status: 'disabled' })).toEqual({ id: 'conn' });
    expect(off.updated[0]).toMatchObject({ enabled: false });
  });

  it('re-enabling a connection with public endpoints works', async () => {
    const { ps, updated } = connPs({ authorizationUrl: 'https://8.8.8.8/a', tokenUrl: 'https://8.8.4.4/t' }, false);
    expect(await updateConnection(ps, admin, 'conn', { status: 'active' })).toEqual({ id: 'conn' });
    expect(updated[0]).toMatchObject({ enabled: true });
  });
});
