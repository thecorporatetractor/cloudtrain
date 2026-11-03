import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { HttpError } from '../src/errors.js';
import type { LabCluster } from '../src/kube/cluster.js';
import { bridge, isRefusal, observeFailure } from '../src/terminal/bridge.js';
import type { TerminalPlan } from '../src/terminal/target.js';

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closedWith: number | undefined;
  send(d: string) {
    this.sent.push(d);
  }
  close(code: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
}

const log = { warns: 0, warn() { this.warns += 1; } };
const noCluster = { exec: () => Promise.reject(new Error('not called')) } as unknown as LabCluster;

async function run(err: unknown) {
  const ws = new FakeWs();
  await bridge(ws as unknown as WebSocket, noCluster, Promise.reject(err) as Promise<TerminalPlan>, { cols: 80, rows: 24 }, log);
  return ws;
}

describe('bridge close codes when planning fails', () => {
  it.each([400, 403, 404, 409])('closes with 1008 (do not retry) for HTTP %i and passes the message on', async (status) => {
    const ws = await run(new HttpError(status, 'The lab environment is not ready yet.'));
    expect(ws.closedWith).toBe(1008);
    expect(ws.sent).toEqual([JSON.stringify({ t: 'error', m: 'The lab environment is not ready yet.' })]);
  });

  it('closes with 1011 (retry) for a transient failure and does not leak its message', async () => {
    const before = log.warns;
    const ws = await run(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    expect(ws.closedWith).toBe(1011);
    expect(ws.sent.join('')).not.toContain('ECONNREFUSED');
    expect(log.warns).toBe(before + 1);
  });

  it('treats a 5xx HttpError as transient', async () => {
    expect((await run(new HttpError(503, 'cluster unavailable'))).closedWith).toBe(1011);
    expect(isRefusal(new HttpError(500, 'x'))).toBe(false);
    expect(isRefusal(new HttpError(403, 'x'))).toBe(true);
  });
});

describe('observe close codes when startObserve fails', () => {
  it('refusals close with 1008 so the observer stops', () => {
    expect(observeFailure(new HttpError(403, 'Missing permission session.observe'))).toEqual({ m: 'You may not observe this session.', code: 1008, reason: 'forbidden' });
    expect(observeFailure(new HttpError(404, 'Session not found'))).toMatchObject({ m: 'Session not found', code: 1008 });
  });

  it('a DB blip or a 5xx closes with 1011 so the observer retries, without leaking internal text', () => {
    const f = observeFailure(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    expect(f.code).toBe(1011);
    expect(f.m).not.toContain('ECONNREFUSED');
    expect(observeFailure(new HttpError(503, 'Platform database unavailable')).code).toBe(1011);
  });
});
