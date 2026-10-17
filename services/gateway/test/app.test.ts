import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DevAuthenticator, type Authenticator } from '../src/auth.js';
import { SessionService } from '../src/sessions/service.js';
import { loginShellCommand, planTerminal, sshCommand } from '../src/terminal/target.js';
import { alice, FakeCluster, FakeCompiler, realContent } from './fakes.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function make(auth: Authenticator = new DevAuthenticator(alice)) {
  const content = await realContent();
  const cluster = new FakeCluster();
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
  app = await buildApp({ content, auth, sessions, cluster });
  return { app, cluster, content };
}

describe('HTTP API', () => {
  it('serves the real catalog, labs and skills', async () => {
    const { app, content } = await make();
    const cat = (await app.inject('/api/catalog')).json();
    expect(cat.labs.filter((l: { domain: string }) => l.domain === 'kubernetes')).toHaveLength(content.summaries.filter((l) => l.domain === 'kubernetes').length);
    expect(cat.labs.length).toBe(content.summaries.length);
    expect(cat.paths.length).toBe(content.paths.length);
    const lab = await app.inject('/api/labs/etcd-snapshot-restore');
    expect(lab.statusCode).toBe(200);
    expect(lab.body).not.toMatch(/"solution"|"expect"|"misconceptions"/);
    expect((await app.inject('/api/labs/nope')).json()).toEqual({ error: 'Lab not found', code: 'not_found' });
    const skills = (await app.inject('/api/skills')).json();
    expect(skills.frameworks).toHaveLength(5);
    expect(skills.states.length).toBe(skills.skills.length);
    expect((await app.inject('/api/me')).json()).toMatchObject({ id: 'alice', name: 'Alice', role: 'learner' });
    const home = (await app.inject('/api/home')).json();
    for (const r of home.recommendations) expect(cat.labs.some((l: { id: string }) => l.id === r.labId)).toBe(true);
  });

  it('answers 401 without a principal (health stays open)', async () => {
    const { app } = await make({ csrf: false, authenticate: async () => null });
    expect((await app.inject('/api/catalog')).statusCode).toBe(401);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });

  it('runs the session lifecycle over HTTP', async () => {
    const { app, cluster } = await make();
    const created = await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/validate` })).statusCode).toBe(409);
    cluster.markReady(id);
    const v = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/validate` })).json();
    expect(v.grading.state).toBe('timeout');
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/hints/0` })).json().revealedHints).toEqual([0]);
    expect((await app.inject(`/api/labs/gateway-smoke/sessions`)).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${id}` })).statusCode).toBe(204);
    expect((await app.inject(`/api/sessions/${id}`)).statusCode).toBe(404);
  });
});

describe('terminal planning', () => {
  it('opens a login shell on the entry node and ssh for other lab nodes', async () => {
    const content = await realContent();
    const lab = content.labs.get('drain-yard-worker')!.lab;
    const ls = {
      apiVersion: 'labs.cloudtrain.dev/v1alpha1' as const,
      kind: 'LabSession' as const,
      metadata: { name: 's1' },
      spec: { templateRef: { name: 't' }, learner: { id: 'alice' }, seed: 1 },
      status: { phase: 'Ready' as const, entryNode: 'workstation', endpoints: [{ node: 'workstation', access: 'shell', protocol: 'k8s-exec', target: 'ns/pod-a/node' }] },
    };
    expect(planTerminal(ls, lab)).toEqual({ node: 'workstation', target: { namespace: 'ns', pod: 'pod-a', container: 'node' }, command: loginShellCommand(), via: 'shell on workstation' });
    const ssh = planTerminal(ls, lab, 'yard-wk-2');
    expect(ssh.target.pod).toBe('pod-a');
    expect(ssh.command).toEqual(sshCommand('yard-wk-2'));
    expect(ssh.command[2]).toContain("su - learner -c 'exec ssh yard-wk-2'");
    expect(() => planTerminal(ls, lab, 'elsewhere')).toThrow(/not part of this lab/);
    expect(() => sshCommand("x';rm -rf /")).toThrow(/invalid node name/);
    expect(() => planTerminal({ ...ls, status: { phase: 'Provisioning' as const } }, lab)).toThrow(/not ready/);
  });

  it('only su-s to the learner when running as root', () => {
    const script = loginShellCommand()[2]!;
    expect(script).toContain('if [ "$(id -u)" = 0 ] && id learner');
    expect(script).toContain('exec bash -l');
    expect(script).toContain('export TERM=xterm-256color');
  });
});

describe('terminal WebSocket', () => {
  async function connect(url: string) {
    const ws = new WebSocket(url);
    const frames: (string | Buffer)[] = [];
    ws.on('message', (d, bin) => frames.push(bin ? (d as Buffer) : d.toString()));
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    await new Promise<void>((r, j) => {
      ws.on('open', () => r());
      ws.on('error', j);
    });
    return { ws, frames, closed };
  }
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(cond()).toBe(true);
  };

  it('bridges input, output, resize and exit to an exec in the entry pod', async () => {
    const { app, cluster } = await make();
    const id = (await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions' })).json().id as string;
    cluster.markReady(id);
    cluster.onExec = (e) => {
      e.stdin.on('data', (d: Buffer) => e.stdout.write(`echo:${d.toString()}`));
      e.stdout.on('resize', () => e.stdout.write(`size:${e.stdout.columns}x${e.stdout.rows}`));
    };
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const { ws, frames, closed } = await connect(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal?cols=100&rows=30`);
    ws.send(JSON.stringify({ t: 'i', d: 'ls\r' })); // before the exec attached: must not be lost
    await until(() => cluster.execs.length === 1);
    const e = cluster.execs[0]!;
    expect(e.tty).toBe(true);
    expect(e.target).toEqual({ namespace: 'ns1', pod: `${id}-workstation-abc`, container: 'node' });
    expect([e.stdout.columns, e.stdout.rows]).toEqual([100, 30]);
    await until(() => frames.some((f) => typeof f === 'string' && f.includes('"ready"')));
    await until(() => frames.some((f) => Buffer.isBuffer(f) && f.toString() === 'echo:ls\r'));
    ws.send(JSON.stringify({ t: 'r', c: 132, r: 40 }));
    await until(() => frames.some((f) => Buffer.isBuffer(f) && f.toString() === 'size:132x40'));
    e.exit(0);
    await until(() => frames.some((f) => f === JSON.stringify({ t: 'exit', code: 0 })));
    expect(await closed).toBe(1000);
  });

  it('reports why a terminal cannot open', async () => {
    const { app } = await make();
    const id = (await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions' })).json().id as string;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const { frames, closed } = await connect(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal`);
    expect(await closed).toBe(1008);
    expect(frames).toEqual([JSON.stringify({ t: 'error', m: 'The lab environment is not ready yet.' })]);
  });

  it('closing the socket closes the exec', async () => {
    const { app, cluster } = await make();
    const id = (await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions' })).json().id as string;
    cluster.markReady(id);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const { ws, frames } = await connect(`ws://127.0.0.1:${port}/api/sessions/${id}/terminal?node=workstation`);
    await until(() => frames.length > 0);
    ws.close();
    await until(() => cluster.execs[0]?.closed === true);
  });
});

describe('request bodies', () => {
  it('accepts body-less POSTs that still carry content-type: application/json', async () => {
    const { app } = await make();
    const r = await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(201);
    const bad = await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('security headers', () => {
  it('sends nosniff and no-store on API responses', async () => {
    const { app } = await make();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
