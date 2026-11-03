import { describe, expect, it, vi } from 'vitest';
import { KeycloakAdmin } from '../src/keycloak/admin.js';

// The repair run reads its IdPs from Postgres; these tests give it a fixed list instead.
const conns = [
  { kc_alias: 'a-idp', org_id: 'org-a' },
  { kc_alias: 'b-idp', org_id: 'org-b' },
  { kc_alias: 'c-idp', org_id: 'org-c' },
];
vi.mock('../src/db/index.js', () => ({
  withTenant: async (_db: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const q = (rows: unknown[]) => {
      const b = { select: () => b, orderBy: () => b, where: () => b, execute: async () => rows };
      return b;
    };
    return fn({ selectFrom: (t: string) => q(t === 'sso_connections' ? conns : [{ domain: 'a.example', org_id: 'org-a' }]) });
  },
}));
vi.mock('../src/platform/kc-address.js', () => ({ foreignLinks: async () => [] }));
const { repairTenantIdps } = await import('../src/keycloak/repair.js');

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function fakeKc(opts: { failIdp?: string; failUser?: string; failFlow?: boolean } = {}) {
  const marked: string[] = [];
  const kc = {
    allowUnmanagedAttributes: async () => false,
    ensureTenantBrokerFlow: async () => {
      if (opts.failFlow) throw httpError(500);
    },
    getIdp: async (alias: string) => {
      if (alias === opts.failIdp) throw httpError(500);
      return { alias, providerId: 'oidc', enabled: true, firstBrokerLoginFlowAlias: 'cloudtrain tenant broker login', config: {} };
    },
    updateIdp: async () => {},
    ensureBrokerOriginMapper: async () => {},
    idpUsers: async (alias: string) => [
      { id: `${alias}-u1`, username: 'u1', enabled: true, email: 'u1@a.example' },
      { id: `${alias}-u2`, username: 'u2', enabled: true, email: 'u2@a.example' },
    ],
    addUserAttribute: async (id: string, _n: string, v: string) => {
      if (id === opts.failUser) throw httpError(403);
      marked.push(`${v}/${id}`);
    },
    federatedIdentities: async () => [],
    dropBrokeredLinks: async () => 'none' as const,
  };
  return { kc: kc as unknown as KeycloakAdmin, marked };
}

describe('tenant IdP repair: one failure does not stop the run', () => {
  it('a failing IdP is skipped and reported; the other IdPs are repaired', async () => {
    const { kc, marked } = fakeKc({ failIdp: 'b-idp' });
    const warn = vi.fn();
    const r = await repairTenantIdps({} as never, kc, {}, { warn });
    expect(marked).toEqual(['a-idp/a-idp-u1', 'a-idp/a-idp-u2', 'c-idp/c-idp-u1', 'c-idp/c-idp-u2']);
    expect(r.failures).toEqual(['b-idp: HTTP 500']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ target: 'b-idp' });
  });

  it('a failing user update is skipped and reported; the IdP\'s other users and the other IdPs are repaired', async () => {
    const { kc, marked } = fakeKc({ failUser: 'a-idp-u1' });
    const r = await repairTenantIdps({} as never, kc);
    expect(marked).toEqual(['a-idp/a-idp-u2', 'b-idp/b-idp-u1', 'b-idp/b-idp-u2', 'c-idp/c-idp-u1', 'c-idp/c-idp-u2']);
    expect(r.originsMarked).not.toContain('a-idp/a-idp-u1');
    expect(r.failures).toEqual(['a-idp/a-idp-u1: HTTP 403']);
  });

  it('a failing realm step is reported and the IdPs are still repaired', async () => {
    const { kc, marked } = fakeKc({ failFlow: true });
    const r = await repairTenantIdps({} as never, kc);
    expect(marked).toHaveLength(6);
    expect(r.failures).toEqual(['realm (tenant broker flow): HTTP 500']);
  });
});

/** Keycloak's IdP mapper admin API for one IdP, recording writes. */
function fakeMapperApi(existing: { id: string; name: string; identityProviderAlias: string; identityProviderMapper: string; config: Record<string, string> }[]) {
  const writes: { method: string; body: unknown }[] = [];
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/protocol/openid-connect/token')) return json(200, { access_token: 't', expires_in: 300 });
    const method = init?.method ?? 'GET';
    if (method === 'GET') return json(200, existing);
    writes.push({ method, body: JSON.parse(String(init!.body)) });
    return json(method === 'POST' ? 201 : 204);
  }) as typeof fetch;
  return { kc: new KeycloakAdmin({ baseUrl: 'http://kc.test', realm: 'r', clientId: 'c', clientSecret: 's', fetch: f }), writes };
}

const origin = (config: Record<string, string>) => ({ id: 'm1', name: 'cloudtrain broker origin', identityProviderAlias: 'acme-idp', identityProviderMapper: 'hardcoded-attribute-idp-mapper', config });

describe('broker origin mapper', () => {
  it('is created with sync mode IMPORT (a FORCE mapper would overwrite the origins of a user linked to several IdPs)', async () => {
    const { kc, writes } = fakeMapperApi([]);
    await kc.ensureBrokerOriginMapper('acme-idp');
    expect(writes).toEqual([{ method: 'POST', body: { name: 'cloudtrain broker origin', identityProviderAlias: 'acme-idp', identityProviderMapper: 'hardcoded-attribute-idp-mapper', config: { syncMode: 'IMPORT', attribute: 'ct_broker_origin', 'attribute.value': 'acme-idp' } } }]);
  });

  it('is not rewritten when unchanged', async () => {
    const { kc, writes } = fakeMapperApi([origin({ syncMode: 'IMPORT', attribute: 'ct_broker_origin', 'attribute.value': 'acme-idp' })]);
    await kc.ensureBrokerOriginMapper('acme-idp');
    expect(writes).toEqual([]);
  });

  it('an existing FORCE mapper is moved to IMPORT', async () => {
    const { kc, writes } = fakeMapperApi([origin({ syncMode: 'FORCE', attribute: 'ct_broker_origin', 'attribute.value': 'acme-idp' })]);
    await kc.ensureBrokerOriginMapper('acme-idp');
    expect(writes).toEqual([{ method: 'PUT', body: expect.objectContaining({ id: 'm1', config: { syncMode: 'IMPORT', attribute: 'ct_broker_origin', 'attribute.value': 'acme-idp' } }) }]);
  });

  it('a changed value is rewritten', async () => {
    const { kc, writes } = fakeMapperApi([origin({ syncMode: 'IMPORT', attribute: 'ct_broker_origin', 'attribute.value': 'other' })]);
    await kc.ensureBrokerOriginMapper('acme-idp');
    expect(writes).toHaveLength(1);
  });
});

describe('origins of a user linked to several IdPs', () => {
  it('the repair run adds an IdP to the origins and keeps the ones already there', async () => {
    let user = { id: 'u1', username: 'u1', enabled: true, attributes: { ct_broker_origin: ['other-idp'] } as Record<string, string[]> };
    const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/protocol/openid-connect/token')) return json(200, { access_token: 't', expires_in: 300 });
      if ((init?.method ?? 'GET') === 'GET') return json(200, user);
      user = JSON.parse(String(init!.body));
      return json(204);
    }) as typeof fetch;
    const kc = new KeycloakAdmin({ baseUrl: 'http://kc.test', realm: 'r', clientId: 'c', clientSecret: 's', fetch: f });
    await kc.addUserAttribute('u1', 'ct_broker_origin', 'acme-idp');
    await kc.addUserAttribute('u1', 'ct_broker_origin', 'acme-idp');
    expect(user.attributes.ct_broker_origin).toEqual(['other-idp', 'acme-idp']);
  });
});
