import { describe, expect, it } from 'vitest';
import { KeycloakAdmin, TENANT_BROKER_FLOW } from '../src/keycloak/admin.js';
import { oidcIdp, TENANT_IDP } from '../src/platform/sso.js';

/** Just enough of Keycloak's authentication-flow admin API. */
function fakeKeycloak(initial?: { execs: { id: string; providerId?: string; requirement: string }[] }, opts: { raceCreate?: boolean } = {}) {
  const flows = new Map<string, { id: string; providerId?: string; requirement: string }[]>();
  if (initial) flows.set(TENANT_BROKER_FLOW, initial.execs);
  const calls: string[] = [];
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname.endsWith('/protocol/openid-connect/token')) return json(200, { access_token: 't', expires_in: 300 });
    const path = decodeURIComponent(url.pathname.replace('/admin/realms/r', ''));
    calls.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/authentication/flows' && method === 'GET') return json(200, [...flows.keys()].map((alias) => ({ alias })));
    if (path === '/authentication/flows' && method === 'POST') {
      expect(body).toMatchObject({ alias: TENANT_BROKER_FLOW, providerId: 'basic-flow', topLevel: true, builtIn: false });
      if (opts.raceCreate) {
        // Another createConnection created it between our GET and POST.
        flows.set(body.alias, [{ id: 'r0', providerId: 'idp-create-user-if-unique', requirement: 'DISABLED' }]);
        return json(409, { errorMessage: 'Flow already exists' });
      }
      flows.set(body.alias, []);
      return json(201);
    }
    const m = /^\/authentication\/flows\/(.+)\/executions(\/execution)?$/.exec(path);
    if (m && flows.has(m[1]!)) {
      const execs = flows.get(m[1]!)!;
      if (method === 'GET') return json(200, execs);
      if (method === 'POST' && m[2]) {
        execs.push({ id: `e${execs.length}`, providerId: body.provider, requirement: 'DISABLED' });
        return json(201);
      }
      if (method === 'PUT') {
        const e = execs.find((x) => x.id === body.id)!;
        e.requirement = body.requirement;
        return json(204);
      }
    }
    return json(404, { error: `unexpected ${method} ${path}` });
  }) as typeof fetch;
  return { kc: new KeycloakAdmin({ baseUrl: 'http://kc.test', realm: 'r', clientId: 'c', clientSecret: 's', fetch: f }), flows, calls };
}

describe('tenant IdPs never link a brokered login to an existing account', () => {
  it('creates the flow with Create User If Unique as the only, REQUIRED step', async () => {
    const { kc, flows } = fakeKeycloak();
    await kc.ensureTenantBrokerFlow();
    expect(flows.get(TENANT_BROKER_FLOW)).toEqual([{ id: 'e0', providerId: 'idp-create-user-if-unique', requirement: 'REQUIRED' }]);
  });

  it('is idempotent, and repairs a flow someone loosened (a linking step is disabled)', async () => {
    const { kc, flows, calls } = fakeKeycloak({
      execs: [
        { id: 'a', providerId: 'idp-create-user-if-unique', requirement: 'ALTERNATIVE' },
        { id: 'b', providerId: 'idp-auto-link', requirement: 'ALTERNATIVE' },
      ],
    });
    await kc.ensureTenantBrokerFlow();
    expect(flows.get(TENANT_BROKER_FLOW)).toEqual([
      { id: 'a', providerId: 'idp-create-user-if-unique', requirement: 'REQUIRED' },
      { id: 'b', providerId: 'idp-auto-link', requirement: 'DISABLED' },
    ]);
    calls.length = 0;
    await kc.ensureTenantBrokerFlow();
    expect(calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
  });

  it('a concurrent creation (409) is not an error: the flow is repaired like an existing one', async () => {
    const { kc, flows } = fakeKeycloak(undefined, { raceCreate: true });
    await kc.ensureTenantBrokerFlow();
    expect(flows.get(TENANT_BROKER_FLOW)).toEqual([{ id: 'r0', providerId: 'idp-create-user-if-unique', requirement: 'REQUIRED' }]);
  });

  it('tenant OIDC IdPs use the flow', () => {
    const idp = oidcIdp('acme-oidc', 'Acme', { issuer: 'https://idp.example', authorization_endpoint: 'https://idp.example/a', token_endpoint: 'https://idp.example/t', jwks_uri: 'https://idp.example/j' } as never, { clientId: 'c', clientSecret: 's' });
    expect(idp.firstBrokerLoginFlowAlias).toBe(TENANT_BROKER_FLOW);
    expect(TENANT_IDP.firstBrokerLoginFlowAlias).toBe(TENANT_BROKER_FLOW);
  });
});

describe('dropping a brokered link that holds an address', () => {
  /** Users with IdP links and credentials, behind Keycloak's user admin API. */
  function fakeUsers(users: Record<string, { links: string[]; credentials: number }>) {
    const calls: string[] = [];
    const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (url.pathname.endsWith('/protocol/openid-connect/token')) return json(200, { access_token: 't', expires_in: 300 });
      const path = decodeURIComponent(url.pathname.replace('/admin/realms/r', ''));
      calls.push(`${method} ${path}${url.search}`);
      if (path === '/users' && method === 'GET') {
        const first = Number(url.searchParams.get('first'));
        const max = Number(url.searchParams.get('max'));
        const all = Object.keys(users).filter((id) => users[id]!.links.includes(url.searchParams.get('idpAlias')!));
        return json(200, all.slice(first, first + max).map((id) => ({ id, username: id })));
      }
      const m = /^\/users\/([^/]+)(\/federated-identity(?:\/(.+))?|\/credentials)?$/.exec(path);
      const u = m && users[m[1]!];
      if (!u) return json(404, {});
      if (method === 'GET' && m![2] === '/credentials') return json(200, Array.from({ length: u.credentials }, () => ({})));
      if (method === 'GET' && m![2] === '/federated-identity') return json(200, u.links.map((identityProvider) => ({ identityProvider })));
      if (method === 'DELETE' && m![3]) {
        u.links = u.links.filter((l) => l !== m![3]);
        return json(204);
      }
      if (method === 'DELETE' && !m![2]) {
        delete users[m![1]!];
        return json(204);
      }
      return json(404, { error: `unexpected ${method} ${path}` });
    }) as typeof fetch;
    return { kc: new KeycloakAdmin({ baseUrl: 'http://kc.test', realm: 'r', clientId: 'c', clientSecret: 's', fetch: f }), users, calls };
  }

  it('deletes a user that only existed through the link, and only unlinks one with more', async () => {
    const { kc, users } = fakeUsers({
      squat: { links: ['evil-idp'], credentials: 0 },
      local: { links: ['evil-idp'], credentials: 1 },
      both: { links: ['evil-idp', 'own-idp'], credentials: 0 },
      clean: { links: ['own-idp'], credentials: 0 },
    });
    expect(await kc.dropBrokeredLinks('squat', ['evil-idp'])).toBe('deleted');
    expect(await kc.dropBrokeredLinks('local', ['evil-idp'])).toBe('unlinked');
    expect(await kc.dropBrokeredLinks('both', ['evil-idp'])).toBe('unlinked');
    expect(await kc.dropBrokeredLinks('clean', ['evil-idp'])).toBe('none');
    expect(users).toEqual({ local: { links: [], credentials: 1 }, both: { links: ['own-idp'], credentials: 0 }, clean: { links: ['own-idp'], credentials: 0 } });
  });

  it("lists an IdP's brokered users page by page", async () => {
    const all = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`u${i}`, { links: ['acme'], credentials: 0 }]));
    const { kc, calls } = fakeUsers({ ...all, other: { links: ['else'], credentials: 0 } });
    expect((await kc.idpUsers('acme', 2)).map((u) => u.id)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
    expect(calls.filter((c) => c.startsWith('GET /users?'))).toHaveLength(3);
  });
});
