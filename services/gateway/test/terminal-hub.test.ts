import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { SessionNotice } from '@cloudtrain/api-types';
import { OUTPUT_HIGH_WATER, OUTPUT_LOW_WATER, OUTPUT_MAX_QUEUED, OUTPUT_STALL_MS, SLOW_CLIENT_MESSAGE, TerminalOutput } from '../src/terminal/bridge.js';
import { OBSERVER_MAX_BUFFERED, SCROLLBACK, Scrollback, TerminalHub, type BusMessage, type TerminalBus } from '../src/terminal/hub.js';

/** Just enough of a ws WebSocket for the hub and the output stream. */
class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 1;
  bufferedAmount = 0;
  binary: Buffer[] = [];
  text: string[] = [];
  terminated = false;
  send(d: Buffer | string) {
    if (typeof d === 'string') this.text.push(d);
    else this.binary.push(Buffer.from(d));
  }
  terminate() {
    this.terminated = true;
    this.close();
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
  output() {
    return Buffer.concat(this.binary).toString();
  }
}
const asWs = (w: FakeWs) => w as unknown as WebSocket;

/** An in-process bus joining several hubs, like Postgres NOTIFY joins replicas. */
class MemoryNet {
  private readonly subs: { id: string; fn: (m: BusMessage) => void }[] = [];
  sent: BusMessage[] = [];
  bus(id: string): TerminalBus {
    return {
      id,
      publish: (m) => {
        this.sent.push(m);
        expect(Buffer.byteLength(JSON.stringify(m))).toBeLessThan(8000); // NOTIFY payload limit
        for (const s of this.subs) if (s.id !== id) s.fn(JSON.parse(JSON.stringify(m)) as BusMessage);
      },
      subscribe: (fn) => void this.subs.push({ id, fn }),
    };
  }
}

const notice = (active: boolean): SessionNotice => ({ id: 'n1', kind: 'observed', at: '2026-11-04T10:00:00Z', from: { id: 'i', name: 'Ina', email: 'ina@example.com' }, message: 'Ina is watching', active }) as SessionNotice;

afterEach(() => vi.useRealTimers());

describe('scrollback', () => {
  it('keeps the last bytes only', () => {
    const b = new Scrollback(10);
    b.push(Buffer.from('abcdef'));
    b.push(Buffer.from('ghijkl'));
    expect(b.bytes().toString()).toBe('cdefghijkl');
    b.push(Buffer.from('0123456789XYZ'));
    expect(b.bytes().toString()).toBe('3456789XYZ');
    expect(b.length).toBe(10);
  });

  it('is freed when the last learner and observer of a session leave', () => {
    const hub = new TerminalHub();
    const learner = new FakeWs();
    const tap = hub.addLearner('s1', asWs(learner));
    tap(Buffer.from('secret-token\r\n'));
    const obs = new FakeWs();
    hub.addObserver('s1', asWs(obs), () => undefined);
    expect(obs.output()).toBe('secret-token\r\n');
    expect(hub.heldSessions()).toBe(1);
    learner.close();
    expect(hub.heldSessions()).toBe(1); // an observer is still there
    obs.close();
    expect(hub.heldSessions()).toBe(0);
    // A later observer sees nothing of the old output.
    const late = new FakeWs();
    hub.addObserver('s1', asWs(late), () => undefined);
    expect(late.binary).toHaveLength(0);
    // Output of a learner socket that is gone is not recorded again.
    tap(Buffer.from('after close'));
    expect(late.binary).toHaveLength(0);
    late.close();
    expect(hub.heldSessions()).toBe(0);
  });

  it('bounds the scrollback per session', () => {
    const hub = new TerminalHub();
    const tap = hub.addLearner('s1', asWs(new FakeWs()));
    for (let i = 0; i < 100; i++) tap(Buffer.alloc(4096, 120));
    const obs = new FakeWs();
    hub.addObserver('s1', asWs(obs), () => undefined);
    expect(Buffer.concat(obs.binary).length).toBe(SCROLLBACK);
  });

  it('drops an observer that cannot keep up', () => {
    const hub = new TerminalHub();
    const tap = hub.addLearner('s1', asWs(new FakeWs()));
    const obs = new FakeWs();
    hub.addObserver('s1', asWs(obs), () => undefined);
    obs.bufferedAmount = OBSERVER_MAX_BUFFERED + 1;
    tap(Buffer.from('x'));
    expect(obs.terminated).toBe(true);
    expect(hub.observerCount('s1')).toBe(0);
  });
});

describe('shadowing across replicas', () => {
  it('relays scrollback, output and notices between gateway replicas', async () => {
    vi.useFakeTimers();
    const net = new MemoryNet();
    const a = new TerminalHub(net.bus('a')); // the learner's replica
    const b = new TerminalHub(net.bus('b')); // the observer's replica
    const learner = new FakeWs();
    const tap = a.addLearner('s1', asWs(learner));
    tap(Buffer.from('$ ls\r\n'));
    expect(net.sent).toHaveLength(0); // nobody watches: nothing on the bus

    const obs = new FakeWs();
    let closed = false;
    b.addObserver('s1', asWs(obs), () => (closed = true));
    b.notifyLearner('s1', notice(true));
    expect(obs.output()).toBe('$ ls\r\n'); // scrollback from replica a
    expect(learner.text.map((t) => JSON.parse(t) as { t: string })).toContainEqual(expect.objectContaining({ t: 'notice' }));

    tap(Buffer.from('file.txt\r\n'));
    await vi.advanceTimersByTimeAsync(300);
    expect(obs.output()).toBe('$ ls\r\nfile.txt\r\n');

    // A flood is truncated for observers, never for the learner.
    tap(Buffer.alloc(200_000, 121));
    await vi.advanceTimersByTimeAsync(300);
    expect(obs.output()).toContain('[output truncated for observers]');
    expect(Buffer.concat(obs.binary).length).toBeLessThan(40_000);

    // Watching stops: replica a no longer relays.
    obs.close();
    expect(closed).toBe(true);
    const before = net.sent.length;
    tap(Buffer.from('more'));
    await vi.advanceTimersByTimeAsync(300);
    expect(net.sent.filter((m) => m.k === 'out').length).toBe(net.sent.slice(0, before).filter((m) => m.k === 'out').length);
    a.close();
    b.close();
  });

  it('takes the scrollback of one learner replica when several answer', () => {
    const net = new MemoryNet();
    const b = new TerminalHub(net.bus('b')); // the observer's replica
    const obs = new FakeWs();
    b.addObserver('s1', asWs(obs), () => undefined);
    const watch = net.sent.find((m) => m.k === 'watch');
    expect(watch?.k === 'watch' && watch.r).toBeTruthy();
    const r = (watch as { r: string }).r;
    // The learner has sockets on replicas a and c; their parts interleave.
    const part = (from: string, d: string, last: boolean): BusMessage => ({ k: 'back', s: 's1', d: Buffer.from(d).toString('base64'), from, to: 'b', r, last });
    net.bus('a').publish(part('a', 'A1-', false));
    net.bus('c').publish(part('c', 'C1-', false));
    net.bus('c').publish(part('c', 'C2', true));
    net.bus('a').publish(part('a', 'A2', true));
    expect(obs.output()).toBe('A1-A2');
    // Late parts for the completed request are ignored.
    net.bus('c').publish(part('c', 'C3', true));
    expect(obs.output()).toBe('A1-A2');
    b.close();
  });

  it('a watch that is not renewed lapses (an observer replica died)', async () => {
    vi.useFakeTimers();
    let now = 0;
    const net = new MemoryNet();
    const a = new TerminalHub(net.bus('a'), () => now);
    const tap = a.addLearner('s1', asWs(new FakeWs()));
    net.bus('dead').publish({ k: 'watch', s: 's1', from: 'dead' });
    tap(Buffer.from('x'));
    await vi.advanceTimersByTimeAsync(300);
    expect(net.sent.some((m) => m.k === 'out')).toBe(true);
    now = 120_000;
    const outs = net.sent.filter((m) => m.k === 'out').length;
    tap(Buffer.from('y'));
    await vi.advanceTimersByTimeAsync(300);
    expect(net.sent.filter((m) => m.k === 'out').length).toBe(outs);
    a.close();
  });
});

describe('terminal output backpressure', () => {
  const write = (out: TerminalOutput, data: Buffer) => new Promise<void>((r) => out.write(data, () => r()));

  it('holds output while the client socket is backed up and resumes when it drains', async () => {
    vi.useFakeTimers();
    const ws = new FakeWs();
    const out = new TerminalOutput(asWs(ws), 80, 24);
    ws.bufferedAmount = OUTPUT_HIGH_WATER;
    let done = false;
    void write(out, Buffer.from('a')).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    ws.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
    expect(ws.terminated).toBe(false);
  });

  it('drops a client that makes no progress, with an error frame first', async () => {
    vi.useFakeTimers();
    const ws = new FakeWs();
    const out = new TerminalOutput(asWs(ws), 80, 24);
    ws.bufferedAmount = OUTPUT_HIGH_WATER;
    void write(out, Buffer.from('a'));
    await vi.advanceTimersByTimeAsync(OUTPUT_STALL_MS + 1000);
    expect(ws.readyState).toBe(ws.CLOSED);
    expect(ws.text.map((t) => JSON.parse(t) as unknown)).toContainEqual({ t: 'error', m: SLOW_CLIENT_MESSAGE });
  });

  it('drops a client whose backlog exceeds the limit', async () => {
    vi.useFakeTimers();
    const ws = new FakeWs();
    const out = new TerminalOutput(asWs(ws), 80, 24);
    ws.bufferedAmount = OUTPUT_MAX_QUEUED + 1;
    void write(out, Buffer.from('a'));
    await vi.advanceTimersByTimeAsync(100);
    expect(ws.readyState).toBe(ws.CLOSED);
  });

  it('pauses the exec stream on a slow link instead of buffering, and keeps a link that still drains', async () => {
    vi.useFakeTimers();
    const ws = new FakeWs();
    const out = new TerminalOutput(asWs(ws), 80, 24);
    const calls: string[] = [];
    out.source = { pause: () => calls.push('pause'), resume: () => calls.push('resume') };
    ws.bufferedAmount = OUTPUT_HIGH_WATER;
    let done = false;
    void write(out, Buffer.from('a')).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    // The write completes at once: the source is paused, nothing piles up here.
    expect(done).toBe(true);
    expect(calls).toEqual(['pause']);
    // A slow link (draining a little every few seconds) is kept far past the stall limit.
    for (let t = 0; t < 3 * OUTPUT_STALL_MS; t += 5000) {
      ws.bufferedAmount -= 1000;
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(ws.readyState).toBe(ws.OPEN);
    expect(calls).toEqual(['pause']);
    ws.bufferedAmount = OUTPUT_LOW_WATER - 1;
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(['pause', 'resume']);
    expect(ws.readyState).toBe(ws.OPEN);
  });
});
