import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, runReadiness } from '../src/app.js';
import { DevAuthenticator } from '../src/auth.js';
import { corsOriginsFrom, IN_CLUSTER, loadConfig, repoRoot, trustProxyFrom } from '../src/config.js';
import { kubeConfigFor } from '../src/kube/client.js';
import { SessionService } from '../src/sessions/service.js';
import { alice, FakeCluster, FakeCompiler, realContent } from './fakes.js';

describe('deployable configuration', () => {
  it('keeps the dev defaults: loopback, kind context, repo paths', () => {
    const c = loadConfig({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(8787);
    expect(c.trustProxy).toBe('127.0.0.1');
    expect(c.kubeContext).toBe('kind-cloudtrain-dev');
    expect(c.contentDir).toBe(path.join(repoRoot, 'content'));
    expect(c.curriculumFile).toBe(path.join(repoRoot, 'content', 'curriculum.yaml'));
    expect(c.labctl).toBe(path.join(repoRoot, 'services/lab-orchestrator/bin/labctl'));
  });

  it('takes bind address, port, paths and proxy trust from the environment (container image)', () => {
    const c = loadConfig({ CT_HOST: '0.0.0.0', CT_PORT: '8080', CT_CONTENT_DIR: '/opt/cloudtrain/content', CT_LABCTL: '/usr/local/bin/labctl', CT_TRUST_PROXY: '10.0.0.0/8' });
    expect(c).toMatchObject({ host: '0.0.0.0', port: 8080, contentDir: '/opt/cloudtrain/content', labctl: '/usr/local/bin/labctl', trustProxy: '10.0.0.0/8' });
    // The curriculum follows the content directory unless set on its own.
    expect(c.curriculumFile).toBe('/opt/cloudtrain/content/curriculum.yaml');
    expect(loadConfig({ CT_CONTENT_DIR: '/c', CT_CURRICULUM_FILE: '/x/cur.yaml' }).curriculumFile).toBe('/x/cur.yaml');
  });

  it('resolves relative paths against CT_BASE_DIR when set', () => {
    const c = loadConfig({ CT_BASE_DIR: '/srv/ct', CT_CONTENT_DIR: 'content', CT_LABCTL: 'bin/labctl', CT_EXTRA_LAB_DIRS: 'fixtures' });
    expect(c.contentDir).toBe('/srv/ct/content');
    expect(c.labctl).toBe('/srv/ct/bin/labctl');
    expect(c.extraLabDirs).toEqual(['/srv/ct/fixtures']);
  });

  it('uses the ServiceAccount in a pod unless a kubeconfig context is named', () => {
    expect(loadConfig({ KUBERNETES_SERVICE_HOST: '10.96.0.1' }).kubeContext).toBe(IN_CLUSTER);
    expect(loadConfig({ KUBERNETES_SERVICE_HOST: '10.96.0.1', CT_KUBE_CONTEXT: 'kind-x' }).kubeContext).toBe('kind-x');
    expect(loadConfig({ CT_KUBE_CONTEXT: IN_CLUSTER }).kubeContext).toBe(IN_CLUSTER);
  });

  it('refuses in-cluster auth outside a pod', () => {
    const saved = process.env.KUBERNETES_SERVICE_HOST;
    delete process.env.KUBERNETES_SERVICE_HOST;
    try {
      expect(() => kubeConfigFor(IN_CLUSTER)).toThrow(/needs to run in a pod/);
    } finally {
      if (saved !== undefined) process.env.KUBERNETES_SERVICE_HOST = saved;
    }
  });

  it('parses CT_CORS_ORIGINS strictly', () => {
    expect(loadConfig({}).corsOrigins).toEqual([]);
    expect(corsOriginsFrom('https://labs.example.com, http://localhost:5173/')).toEqual(['https://labs.example.com', 'http://localhost:5173']);
    expect(() => corsOriginsFrom('*')).toThrow(/not an origin/);
    expect(() => corsOriginsFrom('https://labs.example.com/app')).toThrow(/no path/);
    expect(() => corsOriginsFrom('ftp://x.example.com')).toThrow(/not an origin/);
  });

  it('parses CT_TRUST_PROXY', () => {
    expect(trustProxyFrom(undefined)).toBe('127.0.0.1');
    expect(trustProxyFrom('')).toBe('127.0.0.1');
    expect(trustProxyFrom('true')).toBe(true);
    expect(trustProxyFrom('false')).toBe(false);
    expect(() => trustProxyFrom('2')).toThrow(/hop counts are not supported/);
    expect(trustProxyFrom(' 10.0.0.0/8, 192.168.0.0/16 ')).toBe('10.0.0.0/8,192.168.0.0/16');
  });
});

describe('probes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function make(readiness?: Record<string, () => Promise<unknown>>, corsOrigins?: string[]) {
    const content = await realContent();
    const cluster = new FakeCluster();
    const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
    app = await buildApp({ content, auth: new DevAuthenticator(alice), sessions, cluster, trustProxy: '10.0.0.0/8', ...(readiness ? { readiness } : {}), ...(corsOrigins ? { corsOrigins } : {}) });
    return app;
  }

  it('answers /healthz and /readyz without a session', async () => {
    const a = await make({ postgres: async () => 1 });
    expect((await a.inject('/healthz')).json()).toEqual({ ok: true });
    const r = await a.inject('/readyz');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, checks: { content: 'ok', postgres: 'ok' } });
  });

  it('reports not ready while a dependency fails', async () => {
    const a = await make({ postgres: async () => Promise.reject(new Error('connection refused')) });
    const r = await a.inject('/readyz');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ ok: false, checks: { content: 'ok', postgres: 'connection refused' } });
  });

  it('times out a hanging check', async () => {
    const r = await runReadiness({ slow: () => new Promise(() => undefined) }, 20);
    expect(r).toEqual({ ok: false, checks: { slow: 'timed out after 20 ms' } });
  });

  it('takes the client address from X-Forwarded-For only from a trusted proxy', async () => {
    const a = await make();
    a.get('/whoami', async (req) => ({ ip: req.ip, protocol: req.protocol }));
    const fwd = { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' };
    expect((await a.inject({ url: '/whoami', remoteAddress: '10.244.0.7', headers: fwd })).json()).toEqual({ ip: '203.0.113.9', protocol: 'https' });
    expect((await a.inject({ url: '/whoami', remoteAddress: '198.51.100.4', headers: fwd })).json()).toEqual({ ip: '198.51.100.4', protocol: 'http' });
  });

  it('sends no CORS headers unless an origin is allowed', async () => {
    const a = await make();
    const r = await a.inject({ url: '/api/health', headers: { origin: 'https://evil.example.com' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect((await a.inject({ method: 'OPTIONS', url: '/api/me', headers: { origin: 'https://evil.example.com' } })).statusCode).toBe(404);
  });

  it('answers credentialed CORS for listed origins only', async () => {
    const a = await make(undefined, ['https://labs.example.com']);
    const pre = await a.inject({ method: 'OPTIONS', url: '/api/sessions', headers: { origin: 'https://labs.example.com', 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers).toMatchObject({ 'access-control-allow-origin': 'https://labs.example.com', 'access-control-allow-credentials': 'true' });
    expect(pre.headers['access-control-allow-headers']).toContain('x-csrf-token');
    const get = await a.inject({ url: '/api/health', headers: { origin: 'https://labs.example.com' } });
    expect(get.headers['access-control-allow-origin']).toBe('https://labs.example.com');
    const other = await a.inject({ method: 'OPTIONS', url: '/api/sessions', headers: { origin: 'https://evil.example.com' } });
    expect(other.statusCode).toBe(403);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
