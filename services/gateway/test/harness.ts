import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Authenticator, Principal } from '../src/auth.js';
import { loadPrincipal, membershipsOf } from '../src/platform/identity.js';
import { defaultPeopleFile, readPeople, seed } from '../src/db/seed.js';
import { MemoryMailer } from '../src/mail.js';
import { OidcClient } from '../src/oidc/client.js';
import { OidcAuthenticator, Sealer, SessionStore } from '../src/oidc/sessions.js';
import { PlatformService } from '../src/platform/service.js';
import { SessionService } from '../src/sessions/service.js';
import { AnswerService } from '../src/answers/service.js';
import { PgAnswerStore } from '../src/answers/store.js';
import { EventService } from '../src/events/service.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';
import type { FakeOidcProvider } from './fake-oidc.js';
import { createTestDb, type TestDb } from './pg.js';
import { loadSiteConfig } from '../src/site/config.js';
import path from 'node:path';
import { PgWaitlistStore } from '../src/waitlist/store.js';
import { GdprService, type GdprDeps } from '../src/gdpr/service.js';
import { PostgresLedger, type ChainReport, type ErasureLedger, type LedgerRecordInput, type VerifyOptions } from '../src/gdpr/ledger.js';

/** Test auth: the principal is loaded from the database for the user named in `x-test-user`. */
export class HeaderAuthenticator implements Authenticator {
  readonly csrf: boolean = false;
  constructor(private readonly t: TestDb) {}
  async authenticate(req: FastifyRequest): Promise<Principal | null> {
    const id = req.headers['x-test-user'];
    if (typeof id !== 'string') return null;
    const org = req.headers['x-test-org'];
    const orgId = typeof org === 'string' ? org : ((await membershipsOf(this.t.db, id)).find((m) => m.status === 'active')?.org_id ?? null);
    return loadPrincipal(this.t.db, id, orgId);
  }
}

export const TEST_GDPR_KEY = 'test-gdpr-hmac-key-0123456789abcdef0123456789';

/** The Postgres ledger with an off switch: `failNext` appends throw, as an outage would. */
export class FlakyLedger implements ErasureLedger {
  failNext = 0;
  constructor(readonly inner: PostgresLedger) {}
  async append(input: LedgerRecordInput) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('ledger unavailable');
    }
    return this.inner.append(input);
  }
  entries() {
    return this.inner.entries();
  }
  verifyChain(opts?: VerifyOptions): Promise<ChainReport> {
    return this.inner.verifyChain(opts);
  }
  checkpoint() {
    return this.inner.checkpoint();
  }
  prune(cutoff: Date, limit: number) {
    return this.inner.prune(cutoff, limit);
  }
}

/** Keycloak's user endpoints the erasure uses. `failNext` makes deleteUser throw. */
export class FakeKeycloakUsers {
  deleted: string[] = [];
  loggedOut: string[] = [];
  failNext = 0;
  async getUser(id: string) {
    return this.deleted.includes(id) ? null : { id, username: 'someone', enabled: true };
  }
  enabled = new Map<string, boolean>();
  async setUserEnabled(id: string, on: boolean) {
    this.enabled.set(id, on);
  }
  async logoutUser(id: string) {
    this.loggedOut.push(id);
  }
  async deleteUser(id: string) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw Object.assign(new Error('Keycloak unavailable'), { status: 503 });
    }
    if (this.deleted.includes(id)) return false;
    this.deleted.push(id);
    return true;
  }
}

export interface Harness {
  gdpr: GdprService;
  ledger: FlakyLedger;
  kc: FakeKeycloakUsers;
  waitlist: PgWaitlistStore;
  t: TestDb;
  app: FastifyInstance;
  ps: PlatformService;
  sessions: SessionService;
  answers: AnswerService;
  events: EventService;
  cluster: FakeCluster;
  mailer: MemoryMailer;
  hub: TerminalHub;
  store: SessionStore;
  orgs: { quillmoor: string; acme: string };
  close(): Promise<void>;
}

export const Q = {
  priya: 'a1000000-0000-4000-8000-000000000001',
  tomasz: 'a1000000-0000-4000-8000-000000000002',
  ines: 'a1000000-0000-4000-8000-000000000003',
  elena: 'a1000000-0000-4000-8000-000000000004',
  kenji: 'a1000000-0000-4000-8000-000000000005',
  amara: 'a1000000-0000-4000-8000-000000000006',
  lucas: 'a1000000-0000-4000-8000-000000000007',
  sofia: 'a1000000-0000-4000-8000-000000000008',
  jonah: 'a1000000-0000-4000-8000-000000000009',
  mei: 'a1000000-0000-4000-8000-000000000010',
  rhea: 'a1000000-0000-4000-8000-0000000000aa',
};

export async function harness(opts: { oidc?: FakeOidcProvider; auth?: (t: TestDb) => Authenticator; devImpersonate?: boolean; answerRatePerMinute?: number; gdpr?: Partial<GdprDeps>; privacyPerHour?: number } = {}): Promise<Harness> {
  const t = await createTestDb();
  const content = await realContent();
  await seed(t.owner, content, await readPeople(defaultPeopleFile(repo)));
  const orgRows = await t.owner.selectFrom('orgs').select(['id', 'slug']).execute();
  const cluster = new FakeCluster();
  const mailer = new MemoryMailer();
  const store = new SessionStore(t.db, new Sealer('test-session-secret-0123456789'), { maxAgeSeconds: 3600, idleSeconds: 1800, secureCookie: false });
  const ps = new PlatformService({
    db: t.db,
    content,
    cluster,
    mailer,
    store,
    config: { webUrl: 'http://web.test', publicUrl: 'http://gw.test', oidcClientId: 'cloudtrain-gateway', platformIdps: ['azarguard-entra', 'acme-idp'], devDomainVerifyBypass: true, kubeContext: 'test', namespace: 'ns1', capacity: { perLearner: 0, maxActive: 0, examReserve: 0 } },
  });
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 300, pollMs: 10, hooks: ps });
  const hub = new TerminalHub();
  let auth: Authenticator = opts.auth ? opts.auth(t) : new HeaderAuthenticator(t);
  let oidc: { client: OidcClient; store: SessionStore } | undefined;
  if (opts.oidc) {
    const client = new OidcClient({ issuer: opts.oidc.issuer, clientId: opts.oidc.clientId, clientSecret: opts.oidc.clientSecret, redirectUri: 'http://gw.test/api/auth/callback' });
    auth = new OidcAuthenticator(t.db, store, client);
    oidc = { client, store };
  }
  const events = new EventService(ps, sessions);
  const answers = new AnswerService(sessions, new PgAnswerStore(ps), { ratePerMinute: opts.answerRatePerMinute ?? 20, resolve: events.resolveScope });
  // The public website routes are part of the surface (DAST scans them too).
  const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
  const waitlist = new PgWaitlistStore(t.db);
  const ledger = new FlakyLedger(new PostgresLedger(t.db, TEST_GDPR_KEY));
  const kc = new FakeKeycloakUsers();
  const gdpr = new GdprService({ db: t.db, ledger, hmacKey: TEST_GDPR_KEY, sealer: new Sealer('test-session-secret-0123456789'), mailer, webUrl: 'http://web.test', waitlist, cluster, kc, store, contact: 'gdpr@cloudtrain.test', identityAccountUrl: 'http://id.test/account/', ...(opts.gdpr ?? {}) });
  const app = await buildApp({ content, auth, sessions, cluster, platform: ps, hub, answers, events, clusterInfo: null, gdpr: { service: gdpr, ...(opts.privacyPerHour ? { perHour: opts.privacyPerHour } : {}) }, site: { config: site, waitlist: { store: waitlist } }, ...(oidc ? { oidc } : {}), ...(opts.devImpersonate ? { devImpersonate: true } : {}) });
  return {
    gdpr,
    ledger,
    kc,
    waitlist,
    t,
    app,
    ps,
    sessions,
    answers,
    events,
    cluster,
    mailer,
    hub,
    store,
    orgs: { quillmoor: orgRows.find((o) => o.slug === 'quillmoor')!.id, acme: orgRows.find((o) => o.slug === 'acme-freight')!.id },
    async close() {
      await app.close();
      await t.drop();
    },
  };
}

/** app.inject as a given user (HeaderAuthenticator). */
export function as(h: Harness, user: string, org?: string) {
  const headers = { 'x-test-user': user, ...(org ? { 'x-test-org': org } : {}) };
  return {
    get: (url: string) => h.app.inject({ method: 'GET', url, headers }),
    post: (url: string, payload?: unknown) => h.app.inject({ method: 'POST', url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) }),
    patch: (url: string, payload: unknown) => h.app.inject({ method: 'PATCH', url, headers, payload: payload as object }),
    put: (url: string, payload: unknown) => h.app.inject({ method: 'PUT', url, headers, payload: payload as object }),
    del: (url: string) => h.app.inject({ method: 'DELETE', url, headers }),
  };
}
