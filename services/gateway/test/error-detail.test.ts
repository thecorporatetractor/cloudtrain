import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DevAuthenticator } from '../src/auth.js';
import { verifyWebhook, WebhookError } from '../src/billing/stripe.js';
import { SessionService } from '../src/sessions/service.js';
import { alice, FakeCluster, FakeCompiler, realContent } from './fakes.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const SECRET_TEXT = 'password authentication failed for user "cloudtrain_owner" at 10.0.4.7:5432';

async function make() {
  const content = await realContent();
  const cluster = new FakeCluster();
  const sessions = new SessionService(content, cluster, new FakeCompiler(), { validateTimeoutMs: 200, pollMs: 20 });
  app = await buildApp({ content, auth: new DevAuthenticator(alice), sessions, cluster });
  return { app, cluster };
}

describe('internal errors never reach the client', () => {
  it('an unexpected error answers with a generic message and a request id that is in the log', async () => {
    const { app } = await make();
    app.get('/api/test/boom', { config: { permission: 'lab.run' } }, async () => {
      throw new Error(SECRET_TEXT);
    });
    const a = await app.inject('/api/test/boom');
    const b = await app.inject('/api/test/boom');
    expect(a.statusCode).toBe(502);
    expect(a.body).not.toContain('cloudtrain_owner');
    expect(a.body).not.toContain('10.0.4.7');
    const body = a.json();
    expect(body).toMatchObject({ code: 'upstream', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(body.error).toContain(body.requestId);
    expect(b.json().requestId).not.toBe(body.requestId);
  });

  it("a dependency's error with a 4xx statusCode is internal too (only Fastify's own client errors pass)", async () => {
    const { app } = await make();
    app.get('/api/test/rest-error', { config: { permission: 'lab.run' } }, async () => {
      // Shaped like an @azure/data-tables RestError from the GDPR ledger.
      throw Object.assign(new Error(`The specified resource does not exist. RequestId:4b1c2e1f-0002-0021 Time:2026-11-04T02:00:00Z ${SECRET_TEXT}`), { name: 'RestError', statusCode: 404, code: 'ResourceNotFound' });
    });
    const r = await app.inject('/api/test/rest-error');
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('RequestId');
    expect(r.body).not.toContain('cloudtrain_owner');
    expect(r.json()).toMatchObject({ code: 'upstream', requestId: expect.any(String) });
    // Fastify's own: an unsupported media type keeps its status and message.
    const m = await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions', headers: { 'content-type': 'application/x-nope' }, payload: 'x' });
    expect(m.statusCode).toBe(415);
    expect(m.json().error).toMatch(/Unsupported Media Type/i);
  });

  it('client errors keep their message', async () => {
    const { app } = await make();
    const r = await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('Invalid JSON body');
  });

  it("a failed exec does not echo the cluster's error to the terminal", async () => {
    const { app, cluster } = await make();
    const id = (await app.inject({ method: 'POST', url: '/api/labs/gateway-smoke/sessions' })).json().id as string;
    cluster.markReady(id);
    cluster.exec = async () => {
      throw new Error(`pods "x" is forbidden: User "system:serviceaccount:cloudtrain:ct-gateway" ${SECRET_TEXT}`);
    };
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/sessions/${id}/terminal`);
    const frames: string[] = [];
    ws.on('message', (d) => frames.push(d.toString()));
    await new Promise<void>((r) => ws.on('close', () => r()));
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!)).toEqual({ t: 'error', m: 'Could not open a shell on workstation. Please try again.' });
  });
});

describe('Stripe signature decoding', () => {
  it('a v1 signature that is not hex is a WebhookError, not a RangeError (and not a 5xx)', () => {
    const t = Math.floor(Date.now() / 1000);
    const notHex = 'zz'.repeat(32);
    expect(() => verifyWebhook('{}', `t=${t},v1=${notHex}`, 'whsec_test')).toThrow(WebhookError);
    expect(() => verifyWebhook('{}', `t=${t},v1=${'0'.repeat(63)}g`, 'whsec_test')).toThrow(/signature mismatch/);
  });
});
