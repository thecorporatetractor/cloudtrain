import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { buildApp, wsOriginAllowed } from '../src/app.js';
import type { Authenticator } from '../src/auth.js';
import { SessionService } from '../src/sessions/service.js';
import { TerminalHub } from '../src/terminal/hub.js';
import { alice, bob, FakeCluster, FakeCompiler, realContent } from './fakes.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** alice by default, bob with `x-user: bob`. */
const auth: Authenticator = { csrf: false, authenticate: async (req: FastifyRequest) => (req.headers['x-user'] === 'bob' ? bob : alice) };

async function make(corsOrigins: string[] = [], appUrls: string[] = []) {
  const content = await realContent();
  const cluster = new FakeCluster();
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
  const hub = new TerminalHub();
  app = await buildApp({ content, auth, sessions, cluster, hub, corsOrigins, appUrls });
  const id = (await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions' })).json().id as string;
  cluster.markReady(id);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return { app, cluster, hub, id, port };
}

/** Opens a socket; resolves with the HTTP status of a refused upgrade, or the open socket. */
function open(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  const frames: string[] = [];
  ws.on('message', (d, bin) => frames.push(bin ? `bin:${(d as Buffer).toString()}` : d.toString()));
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  return new Promise<{ status: number; ws: WebSocket; frames: string[]; closed: Promise<number> }>((resolve, reject) => {
    ws.on('open', () => resolve({ status: 101, ws, frames, closed }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0, ws, frames, closed }));
    ws.on('error', reject);
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('terminal WebSocket origin', () => {
  it('wsOriginAllowed: own host or a configured origin; never null or garbage', () => {
    const allowed = new Set(['https://app.example.com']);
    expect(wsOriginAllowed('https://app.example.com', 'gw.internal:8787', allowed)).toBe(true);
    expect(wsOriginAllowed('https://labs.example.com', 'labs.example.com', allowed)).toBe(true);
    expect(wsOriginAllowed('https://marketing.example.com', 'labs.example.com', allowed)).toBe(false);
    expect(wsOriginAllowed('null', 'labs.example.com', allowed)).toBe(false);
    expect(wsOriginAllowed('not a url', 'labs.example.com', allowed)).toBe(false);
    expect(wsOriginAllowed('https://labs.example.com.evil.test', 'labs.example.com', allowed)).toBe(false);
  });

  it('refuses an upgrade from a foreign origin before anything is attached', async () => {
    const { port, id, cluster } = await make();
    const r = await open(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`, { origin: 'https://www.example.com' });
    expect(r.status).toBe(403);
    r.ws.terminate();
    expect(cluster.execs).toHaveLength(0);
  });

  it('refuses a foreign origin on a percent-escaped path the router still matches (/%61pi/...)', async () => {
    const { port, id, cluster } = await make();
    for (const path of [`/%61pi/sessions/${id}/terminal`, `/%2561pi/sessions/${id}/terminal`, `/api/sessions/${id}/termin%61l`]) {
      const r = await open(`ws://127.0.0.1:${port}${path}`, { origin: 'https://evil.test' });
      expect(r.status).not.toBe(101);
      r.ws.terminate();
    }
    expect(cluster.execs).toHaveLength(0);
  });

  it('a percent-escaped /api path still needs a signed-in principal', async () => {
    const content = await realContent();
    const cluster = new FakeCluster();
    const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
    const nobody: Authenticator = { csrf: false, authenticate: async () => null };
    app = await buildApp({ content, auth: nobody, sessions, cluster, corsOrigins: ['https://app.example.com'] });
    for (const url of ['/api/me', '/%61pi/me', '/%61%70%69/me']) {
      const res = await app.inject({ method: 'GET', url, headers: { origin: 'https://app.example.com' } });
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['access-control-allow-origin'], url).toBe('https://app.example.com');
    }
  });

  it("accepts the app's own web URL without the platform database (labs-only dev behind Vite's proxy)", async () => {
    // No `platform`: the origins come from the gateway's own config. Vite's proxy rewrites Host to
    // the gateway's, while the browser's Origin stays the dev server's.
    const { port, id } = await make([], ['http://localhost:5173/', 'http://localhost:8787']);
    const ok = await open(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`, { origin: 'http://localhost:5173' });
    expect(ok.status).toBe(101);
    ok.ws.close();
    const other = await open(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`, { origin: 'http://localhost:6000' });
    expect(other.status).toBe(403);
    other.ws.terminate();
  });

  it('accepts the same origin, a configured origin, and clients that send no Origin', async () => {
    const { port, id } = await make(['https://app.example.com']);
    for (const headers of [{ origin: `http://127.0.0.1:${port}` }, { origin: 'https://app.example.com' }, {}] as Record<string, string>[]) {
      const r = await open(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`, headers);
      expect(r.status).toBe(101);
      r.ws.close();
    }
  });
});

describe('terminal WebSocket ownership', () => {
  it("a socket on someone else's session never joins its learners or sees their notices", async () => {
    const { port, id, hub, cluster } = await make();
    const owner = await open(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`);
    await until(() => owner.frames.some((f) => f.includes('"ready"')));
    const intruder = await open(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`, { 'x-user': 'bob' });
    expect(intruder.status).toBe(101);
    expect(await intruder.closed).toBe(1008);
    hub.notifyLearner(id, { id: 'n1', kind: 'observed', at: new Date().toISOString(), from: { id: 'x', name: 'Instructor', email: 'i@example.com' }, message: 'Instructor is watching your terminal (read-only).', active: true });
    await until(() => owner.frames.some((f) => f.includes('"notice"')));
    expect(intruder.frames.some((f) => f.includes('notice') || f.includes('i@example.com'))).toBe(false);
    expect(cluster.execs).toHaveLength(1);
    owner.ws.close();
  });
});
