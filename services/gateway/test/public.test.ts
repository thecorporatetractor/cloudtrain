import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadExamCatalog } from '../src/exams/catalog.js';
import { RateLimiter, publicCatalog, publicPathDetail } from '../src/routes/public.js';
import { SessionService } from '../src/sessions/service.js';
import { loadSiteConfig } from '../src/site/config.js';
import { FakeCluster, FakeCompiler, realContent, repo } from './fakes.js';

/*
 * The public website API: served without a session, from content/ and the site
 * configuration only. These tests run without a database on purpose: nothing
 * public may depend on one.
 */

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

let clock = 0;
async function make(ratePerMinute?: number) {
  const content = await realContent();
  const site = await loadSiteConfig(path.join(repo, 'content/site.yaml'));
  const exams = await loadExamCatalog(content, path.join(repo, 'content'), path.join(repo, 'content/curriculum.yaml'));
  const cluster = new FakeCluster();
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
  // Nobody is signed in: every non-public route must answer 401.
  app = await buildApp({ content, auth: { csrf: false, authenticate: async () => null }, sessions, cluster, site: { config: site, exams, ...(ratePerMinute ? { ratePerMinute } : {}) } });
  return { app, content, site, exams };
}

describe('public website API', () => {
  it('content/site.yaml validates and is served as is', async () => {
    const { app, site } = await make();
    const r = await app.inject('/api/public/site');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toMatch(/^public, max-age=300/);
    expect(r.headers.etag).toMatch(/^W\//);
    expect(r.json()).toEqual(site);
    expect(site.brand.name).toBe('CloudTrain');
    expect(site.legal.alignmentNotice).toMatch(/not affiliated/);
  });

  it('refuses an invalid site file with the schema issues', async () => {
    await expect(loadSiteConfig(path.join(repo, 'content/curriculum.yaml'))).rejects.toThrow(/site config .* is invalid/);
    await expect(loadSiteConfig(path.join(repo, 'content/does-not-exist.yaml'))).rejects.toThrow(/site config/);
  });

  it('serves the catalog without org or learner data and without exam pool ids', async () => {
    const { app, content, exams } = await make();
    const r = await app.inject('/api/public/catalog');
    expect(r.statusCode).toBe(200);
    const cat = r.json();
    expect(cat.labs.length).toBe(content.summaries.filter((l) => !(l.tags ?? []).includes('exam-fixture')).length);
    expect(cat.paths.length).toBe(content.paths.filter((p) => p.labIds.length > 0).length);
    expect(cat.exams.length).toBe(exams.exams.size);
    expect(cat.domains.length).toBe(content.domains.length);
    for (const d of cat.domains) expect(d).toMatchObject({ labCount: expect.any(Number), pathCount: expect.any(Number), examCount: expect.any(Number) });
    expect(r.body).not.toMatch(/"completion"|"bestScore"|"progress"|"retake"|"lastAttempt"|"pool"|"attempts"/);
    for (const e of cat.exams) {
      expect(e.disclaimer).toMatch(/affiliated/);
      expect(e.title).not.toMatch(/\bCKA\b|\bCKAD\b|\bCKS\b|\bRHCSA\b|\bCCNA\b/);
    }
    for (const p of cat.paths) expect(['path', 'course']).toContain(p.kind);
    expect(cat.paths.some((p: { kind: string }) => p.kind === 'course')).toBe(true);
    expect(cat.paths.some((p: { kind: string }) => p.kind === 'path')).toBe(true);
    expect(Object.keys(cat.skillNames).length).toBeGreaterThan(10);
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const { app } = await make();
    const first = await app.inject('/api/public/catalog');
    const again = await app.inject({ url: '/api/public/catalog', headers: { 'if-none-match': first.headers.etag as string } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    const other = await app.inject({ url: '/api/public/catalog', headers: { 'if-none-match': 'W/"nope"' } });
    expect(other.statusCode).toBe(200);
  });

  it('serves a path with its sections and labs, an exam with objectives but no pool, and 404 otherwise', async () => {
    const { app, content, exams } = await make();
    const pack = content.packs.find((p) => p.paths.length > 0)!;
    const pathId = pack.paths[0]!.id;
    const detail = (await app.inject(`/api/public/paths/${pathId}`)).json();
    expect(detail.id).toBe(pathId);
    expect(detail.kind).toBe('path');
    expect(detail.sections.length).toBeGreaterThan(0);
    expect(detail.labs.length).toBe(detail.labCount);
    expect(detail.related.every((p: { domain: string }) => p.domain === detail.domain)).toBe(true);
    const course = publicPathDetail(content, pack.courses[0]!.id)!;
    expect(course.kind).toBe('course');
    expect(course.sections).toHaveLength(1);
    const examId = [...exams.exams.keys()][0]!;
    const ex = await app.inject(`/api/public/exams/${examId}`);
    expect(ex.statusCode).toBe(200);
    expect(ex.json().objectives.length).toBeGreaterThan(0);
    expect(ex.body).not.toMatch(/"pool"/);
    expect((await app.inject('/api/public/paths/nope')).statusCode).toBe(404);
    expect((await app.inject('/api/public/exams/nope')).statusCode).toBe(404);
  });

  it('keeps the signed-in routes closed while the public ones stay open', async () => {
    const { app } = await make();
    expect((await app.inject('/api/catalog')).statusCode).toBe(401);
    expect((await app.inject('/api/exams')).statusCode).toBe(404); // no exam service in this app: not registered
    expect((await app.inject('/api/public/catalog')).statusCode).toBe(200);
  });

  it('rate-limits per client address with Retry-After', async () => {
    const { app } = await make(3);
    for (let i = 0; i < 3; i++) expect((await app.inject('/api/public/site')).statusCode).toBe(200);
    const limited = await app.inject('/api/public/site');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    // Another address has its own budget.
    expect((await app.inject({ url: '/api/public/site', remoteAddress: '10.9.8.7' })).statusCode).toBe(200);
  });

  it('RateLimiter: fixed one-minute window', () => {
    clock = 1_000_000;
    const l = new RateLimiter(2, () => clock);
    expect(l.take('a')?.remaining).toBe(1);
    expect(l.take('a')?.remaining).toBe(0);
    expect(l.take('a')).toBeNull();
    expect(l.take('b')?.remaining).toBe(1);
    clock += 60_001;
    expect(l.take('a')?.remaining).toBe(1);
  });

  it('publicCatalog is deterministic and lab-only tags are kept', async () => {
    const content = await realContent();
    const a = publicCatalog(content);
    const b = publicCatalog(content);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.exams).toEqual([]);
  });
});
