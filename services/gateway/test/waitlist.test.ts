import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SiteConfig, SiteWaitlist } from '@cloudtrain/api-types';
import { buildApp } from '../src/app.js';
import type { Principal } from '../src/auth.js';
import { RateLimiter } from '../src/routes/public.js';
import { SessionService } from '../src/sessions/service.js';
import { loadSiteConfig } from '../src/site/config.js';
import { MemoryWaitlistStore } from '../src/waitlist/store.js';
import { waitlistCsv } from '../src/waitlist/routes.js';
import { csvCell, isEmail, validateWaitlist } from '../src/waitlist/validate.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';

/*
 * The early-access waitlist: validation against the site configuration,
 * duplicates (case-insensitive), the honeypot, the per-address rate limit and
 * the admin-only export. No database: the store is in memory here; the Postgres
 * store, RLS and the admin export through real principals are in waitlist-pg.test.ts.
 */

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ADMIN: Principal = { sub: 'p1', name: 'Plat', email: 'p@x.io', orgId: '', orgName: '', orgSlug: '', team: '', roles: ['platform_admin'], teams: [], managedTeamIds: [], instructedCohortIds: [], cohortIds: [], platformAdmin: true };
const LEARNER: Principal = { ...ADMIN, sub: 'l1', roles: ['learner'], platformAdmin: false, orgId: 'o1' };

async function make(opts: { perHour?: number; store?: MemoryWaitlistStore | null; wl?: Partial<SiteWaitlist>; as?: Principal | null } = {}) {
  const content = await realContent();
  const base = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
  const site: SiteConfig = { ...base, waitlist: { ...base.waitlist!, ...opts.wl } };
  const store = opts.store === null ? undefined : (opts.store ?? new MemoryWaitlistStore());
  const cluster = new FakeCluster();
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
  const principal = opts.as ?? null;
  app = await buildApp({
    content,
    auth: { csrf: false, authenticate: async () => principal },
    sessions,
    cluster,
    site: { config: site, waitlist: { ...(store ? { store } : {}), ...(opts.perHour ? { perHour: opts.perHour } : {}) } },
  });
  return { app, store, site };
}

const join = (a: FastifyInstance, payload: unknown, remoteAddress?: string) => a.inject({ method: 'POST', url: '/api/public/waitlist', payload: payload as object, ...(remoteAddress ? { remoteAddress } : {}) });
const good = { email: 'ada@example.com', organisation: 'Analytical Engines', role: 'Engineer or developer', interest: 'enterprise', consent: true };

describe('waitlist configuration', () => {
  it('content/site.yaml ships an enabled waitlist whose role options are the configured ones', async () => {
    const { site } = await make();
    expect(site.waitlist?.enabled).toBe(true);
    expect(site.waitlist?.fields?.role?.options?.length).toBeGreaterThan(1);
    expect(site.legal.privacy.sections.some((s) => /waitlist/i.test(s.title))).toBe(true);
  });
});

describe('POST /api/public/waitlist', () => {
  it('stores an entry without a session and says it was created', async () => {
    const { app, store } = await make();
    const r = await join(app, good);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ status: 'created' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(store!.rows).toHaveLength(1);
    expect(store!.rows[0]).toMatchObject({ email: 'ada@example.com', organisation: 'Analytical Engines', role: 'Engineer or developer', interest: 'enterprise' });
    expect(Date.parse(store!.rows[0]!.consentAt)).not.toBeNaN();
  });

  it('accepts the email alone (every other field is optional by default)', async () => {
    const { app, store } = await make();
    expect((await join(app, { email: '  Grace@Navy.example.org ', consent: true })).statusCode).toBe(201);
    expect(store!.rows[0]).toMatchObject({ email: 'Grace@Navy.example.org', organisation: null, role: null, interest: null });
  });

  it('reports a duplicate address, ignoring case and spaces, and keeps the first entry', async () => {
    const { app, store } = await make();
    expect((await join(app, good)).statusCode).toBe(201);
    const again = await join(app, { ...good, email: ' ADA@Example.COM ', organisation: 'Someone else' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'duplicate' });
    expect(store!.rows).toHaveLength(1);
    expect(store!.rows[0]!.organisation).toBe('Analytical Engines');
  });

  it('rejects bad input with per-field messages and stores nothing', async () => {
    const { app, store } = await make({ perHour: 100 });
    const cases: [unknown, string][] = [
      [{ consent: true }, 'email'],
      [{ email: 'not-an-email', consent: true }, 'email'],
      [{ email: 'a@b', consent: true }, 'email'],
      [{ email: 'a..b@example.com', consent: true }, 'email'],
      [{ email: 42, consent: true }, 'email'],
      [{ email: `${'a'.repeat(250)}@example.com`, consent: true }, 'email'],
      [{ email: 'ada@example.com' }, 'consent'],
      [{ email: 'ada@example.com', consent: 'yes' }, 'consent'],
      [{ email: 'ada@example.com', consent: false }, 'consent'],
      [{ email: 'ada@example.com', consent: true, interest: 'both' }, 'interest'],
      [{ email: 'ada@example.com', consent: true, role: 'Wizard' }, 'role'],
      [{ email: 'ada@example.com', consent: true, organisation: 'x'.repeat(121) }, 'organisation'],
      [{ email: 'ada@example.com', consent: true, organisation: 'bad\u0000name' }, 'organisation'],
      [{ email: 'ada@example.com', consent: true, organisation: { a: 1 } }, 'organisation'],
    ];
    for (const [body, field] of cases) {
      const r = await join(app, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(422);
      expect(r.json().code).toBe('invalid');
      expect(Object.keys(r.json().details.fields), JSON.stringify(body)).toContain(field);
    }
    expect((await join(app, [])).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/public/waitlist', payload: '"text"', headers: { 'content-type': 'application/json' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/public/waitlist', payload: '{nope', headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
    expect(store!.rows).toHaveLength(0);
  });

  it('enforces the fields the site configuration requires and ignores the ones it disables', async () => {
    const { app } = await make({ wl: { fields: { organisation: { required: true }, role: { enabled: false }, interest: { required: true } } } });
    const r = await join(app, { email: 'ada@example.com', consent: true });
    expect(Object.keys(r.json().details.fields).sort()).toEqual(['interest', 'organisation']);
    const ok = await join(app, { email: 'ada@example.com', consent: true, organisation: 'Org', interest: 'individual', role: 'Wizard' });
    expect(ok.statusCode).toBe(201); // role is disabled: not validated, not stored
  });

  it('honeypot: a filled hidden field looks like a success but stores nothing', async () => {
    const { app, store } = await make();
    const r = await join(app, { ...good, website: 'http://spam.example' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ status: 'created' });
    expect(store!.rows).toHaveLength(0);
    // An empty honeypot is what a person sends.
    expect((await join(app, { ...good, website: '' })).statusCode).toBe(201);
    expect(store!.rows).toHaveLength(1);
  });

  it('rate-limits per client address with Retry-After; another address has its own budget', async () => {
    const { app, store } = await make({ perHour: 3 });
    for (let i = 0; i < 3; i++) expect((await join(app, { ...good, email: `u${i}@example.com` })).statusCode).toBe(201);
    const limited = await join(app, { ...good, email: 'u9@example.com' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(store!.rows).toHaveLength(3);
    expect((await join(app, { ...good, email: 'other@example.com' }, '10.9.8.7')).statusCode).toBe(201);
  });

  it('counts invalid and honeypot submissions against the limit too', async () => {
    const { app } = await make({ perHour: 2 });
    expect((await join(app, { email: 'bad' })).statusCode).toBe(422);
    expect((await join(app, { ...good, website: 'x' })).statusCode).toBe(201);
    expect((await join(app, good)).statusCode).toBe(429);
  });

  it('is not served when the waitlist is disabled, and answers 503 without a store', async () => {
    const off = await make({ wl: { enabled: false } });
    expect((await join(off.app, good)).statusCode).toBe(404);
    await app?.close();
    const noStore = await make({ store: null });
    const r = await join(noStore.app, good);
    expect(r.statusCode).toBe(503);
    expect((await join(noStore.app, { email: 'bad' })).statusCode).toBe(422); // validation still runs first
  });

  it('refuses an oversized body', async () => {
    const { app } = await make();
    const r = await join(app, { ...good, organisation: 'x'.repeat(20_000) });
    expect(r.statusCode).toBe(413);
  });
});

describe('admin list and export', () => {
  it('needs a platform admin: 401 anonymous, 403 for a learner', async () => {
    const anon = await make();
    expect((await anon.app.inject('/api/platform/waitlist')).statusCode).toBe(401);
    expect((await anon.app.inject('/api/platform/waitlist.csv')).statusCode).toBe(401);
    await app?.close();
    const learner = await make({ as: LEARNER });
    expect((await learner.app.inject('/api/platform/waitlist')).statusCode).toBe(403);
    expect((await learner.app.inject('/api/platform/waitlist.csv')).statusCode).toBe(403);
  });

  it('lists the entries newest first and exports them as CSV for a platform admin', async () => {
    const store = new MemoryWaitlistStore();
    const { app } = await make({ as: ADMIN, store });
    await join(app, good);
    await join(app, { email: 'grace@example.org', consent: true, organisation: '=HYPERLINK("http://evil")' });
    const list = (await app.inject('/api/platform/waitlist')).json();
    expect(list.total).toBe(2);
    expect(list.entries.map((e: { email: string }) => e.email)).toEqual(['grace@example.org', 'ada@example.com']);
    const csv = await app.inject('/api/platform/waitlist.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toContain('waitlist.csv');
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toBe('email,organisation,role,interest,consent_at,created_at');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect((await app.inject('/api/platform/waitlist?limit=1')).json().entries).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('isEmail', () => {
    for (const ok of ['a@b.io', 'first.last+tag@sub.example.co.uk', 'x_y@exa-mple.com']) expect(isEmail(ok), ok).toBe(true);
    for (const bad of ['', 'a', 'a@b', '@b.io', 'a b@c.io', 'a@b..io', '.a@b.io', 'a@-b.io', 'a@b.c']) expect(isEmail(bad), bad).toBe(false);
  });

  it('validateWaitlist trims and drops empty optional fields', () => {
    const cfg: SiteWaitlist = { enabled: true };
    expect(validateWaitlist({ email: ' a@b.io ', organisation: '  ', role: ' Dev ', consent: true }, cfg)).toEqual({ email: 'a@b.io', role: 'Dev' });
  });

  it('csvCell quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+x')).toBe("'+x");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell(null)).toBe('');
    expect(waitlistCsv([])).toBe('email,organisation,role,interest,consent_at,created_at\r\n');
  });

  it('RateLimiter honours a custom window and reports when it resets', () => {
    let t = 5_000_000;
    const l = new RateLimiter(1, () => t, 3_600_000);
    expect(l.take('a')).not.toBeNull();
    expect(l.take('a')).toBeNull();
    expect(l.resetIn('a')).toBe(3600);
    t += 1_800_000;
    expect(l.resetIn('a')).toBe(1800);
    expect(l.take('a')).toBeNull();
    t += 1_800_001;
    expect(l.take('a')).not.toBeNull();
  });
});

describe('static website export', () => {
  it('writes exactly the documents the public API serves, with pricing off by default', async () => {
    const { adaptSignInLinks, staticSiteFiles } = await import('../src/site/export.js');
    const { loadExamCatalog } = await import('../src/exams/catalog.js');
    const { publicCatalog, publicPaths } = await import('../src/routes/public.js');
    const content = await realContent();
    const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
    const exams = await loadExamCatalog(content, path.join(repo, 'content'), path.join(repo, 'content/curriculum.yaml'));
    const files = new Map(staticSiteFiles(content, site, exams).map((f) => [f.path, JSON.parse(f.body)]));
    const adapted = adaptSignInLinks(site);
    expect(files.get('data/site.json')).toEqual({ ...adapted, flags: { ...adapted.flags, showPricing: false } });
    expect(files.get('data/site.json').waitlist.enabled).toBe(true);
    expect(files.get('data/catalog.json')).toEqual(JSON.parse(JSON.stringify(publicCatalog(content, exams))));
    for (const p of publicPaths(content)) expect(files.has(`data/paths/${p.id}.json`), p.id).toBe(true);
    for (const id of exams.exams.keys()) expect(files.has(`data/exams/${id}.json`), id).toBe(true);
    expect(staticSiteFiles(content, site, exams, { pricing: true })[0]!.body).toContain('"showPricing":true');
    // Links into the platform: dropped without an app URL, absolute with one.
    const none = JSON.stringify(adaptSignInLinks(site));
    expect(none).not.toContain('/sign-in');
    expect(adaptSignInLinks(site).audiences!.every((a) => a.cta.to.startsWith('/'))).toBe(true);
    const withApp = adaptSignInLinks(site, 'https://app.example.com/');
    expect(JSON.stringify(withApp)).toContain('"to":"https://app.example.com/sign-in"');
    expect(JSON.stringify(withApp)).not.toContain('"to":"/sign-in"');
    expect(site.footer.columns.flatMap((c) => c.links).some((l) => l.to === '/sign-in')).toBe(true); // the input is not mutated
    // No exam pool task ids in any exported exam document.
    for (const [p, v] of files) if (p.startsWith('data/exams/')) expect(JSON.stringify(v)).not.toMatch(/"pool"/);
  });
});
