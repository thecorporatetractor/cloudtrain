import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObserveShell } from './observeShell';
import { CLOSE_REFUSED, KEEPALIVE_MS, RECONNECT_DELAYS_MS, type SocketLike, STABLE_MS } from './remoteShell';

class FakeSocket implements SocketLike {
  readyState = 0;
  binaryType = 'blob';
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  sent: unknown[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  frame(f: object) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const states: string[] = [];
  const written: string[] = [];
  const shell = new ObserveShell({ cols: 80, rows: 24, write: (d: string | Uint8Array) => void written.push(typeof d === 'string' ? d : new TextDecoder().decode(d)), reset: () => void written.splice(0) } as never, {
    sessionId: 's-1',
    onState: (s) => states.push(s),
    deps: {
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    },
  });
  shell.start();
  return { shell, sockets, states, written, last: () => sockets[sockets.length - 1]! };
}

describe('ObserveShell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.example' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is live on the observe frame and sends keepalives (never keystrokes) while open', () => {
    const { states, last } = setup();
    expect(last().url).toBe('wss://app.example/api/sessions/s-1/terminal?observe=1&cols=80&rows=24');
    last().open();
    last().frame({ t: 'observe', readOnly: true, m: 'Watching' });
    expect(states.at(-1)).toBe('live');
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(last().sent).toEqual([{ t: 'p' }, { t: 'p' }]);
  });

  it('reconnects with backoff after a drop and gives up after the last delay', () => {
    const { sockets, states, last } = setup();
    last().drop();
    for (const [i, delay] of RECONNECT_DELAYS_MS.entries()) {
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(i + 2);
      last().drop();
    }
    expect(states.at(-1)).toBe('error');
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(RECONNECT_DELAYS_MS.length + 1);
  });

  it('starts the attempts over once a connection stayed up', () => {
    const { sockets, last } = setup();
    last().drop();
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    last().open();
    vi.advanceTimersByTime(STABLE_MS);
    last().drop();
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    expect(sockets).toHaveLength(3);
  });

  it('does not retry a refusal, and dispose stops everything', () => {
    const a = setup();
    a.last().frame({ t: 'error', m: 'You may not observe this session.' });
    a.last().drop(CLOSE_REFUSED);
    vi.advanceTimersByTime(120_000);
    expect(a.sockets).toHaveLength(1);
    expect(a.states.at(-1)).toBe('error');

    const b = setup();
    b.last().drop();
    b.shell.dispose();
    vi.advanceTimersByTime(120_000);
    expect(b.sockets).toHaveLength(1);
  });

  it('replaces the old output with the replay on a reconnect, so the scrollback does not show twice', () => {
    const { last, written } = setup();
    last().open();
    last().frame({ t: 'observe', readOnly: true, m: 'watching' });
    last().onmessage?.({ data: new TextEncoder().encode('$ ls\r\n').buffer });
    last().drop();
    // Still readable while disconnected.
    expect(written.join('')).toContain('$ ls');
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    last().open();
    expect(written.join('')).toContain('$ ls');
    last().frame({ t: 'observe', readOnly: true, m: 'watching' });
    expect(written.join('')).not.toContain('$ ls');
    last().onmessage?.({ data: new TextEncoder().encode('$ ls\r\n').buffer });
    expect(written.join('').split('$ ls')).toHaveLength(2);
  });

  it('retries a transient failure (error frame, then 1011), unlike a refusal', () => {
    const { last, sockets, states } = setup();
    last().frame({ t: 'error', m: 'The terminal could not be observed just now. Please try again.' });
    last().drop(1011);
    expect(states.at(-1)).toBe('connecting');
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    expect(sockets).toHaveLength(2);
    last().frame({ t: 'error', m: 'You may not observe this session.' });
    last().drop(CLOSE_REFUSED);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(2);
    expect(states.at(-1)).toBe('error');
  });
});
