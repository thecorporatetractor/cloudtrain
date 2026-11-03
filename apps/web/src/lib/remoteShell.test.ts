import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_REFUSED, KEEPALIVE_MS, READY_TIMEOUT_MS, RECONNECT_DELAYS_MS, RemoteShell, STABLE_MS, type ShellStatus, type SocketLike } from './remoteShell';

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

function fakeTerm() {
  let onData: (d: string) => void = () => undefined;
  const written: string[] = [];
  return {
    cols: 80,
    rows: 24,
    written,
    type: (d: string) => onData(d),
    focus: vi.fn(),
    write: (d: string | Uint8Array) => void written.push(typeof d === 'string' ? d : new TextDecoder().decode(d)),
    onData: (fn: (d: string) => void) => {
      onData = fn;
      return { dispose: () => (onData = () => undefined) };
    },
    onResize: () => ({ dispose: () => undefined }),
  };
}

function setup(entry = true) {
  const sockets: FakeSocket[] = [];
  const statuses: ShellStatus[] = [];
  const term = fakeTerm();
  const shell = new RemoteShell(term as never, {
    sessionId: 's-1',
    node: 'jumphost',
    entry,
    onStatus: (s) => statuses.push(s),
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
  const last = () => sockets[sockets.length - 1]!;
  return { shell, sockets, statuses, term, last };
}

describe('RemoteShell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.example' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects to the session terminal and names a non-entry node', () => {
    expect(setup().last().url).toBe('wss://app.example/api/sessions/s-1/terminal?cols=80&rows=24');
    expect(setup(false).last().url).toContain('node=jumphost');
  });

  it('buffers keystrokes typed before the first shell attaches and sends them on ready', () => {
    const { term, last } = setup();
    term.type('ls');
    expect(last().sent).toEqual([]);
    last().open();
    term.type(' -l\r'); // socket open, shell not attached yet
    expect(last().sent).toEqual([]);
    last().frame({ t: 'ready', via: 'shell' });
    expect(last().sent).toEqual([{ t: 'i', d: 'ls -l\r' }]);
    term.type('x');
    expect(last().sent).toContainEqual({ t: 'i', d: 'x' });
  });

  it('keeps keystrokes buffered for the first shell when that attempt fails before ready, and sends them once', () => {
    const { sockets, term, last } = setup();
    term.type('whoami\r');
    last().open();
    last().frame({ t: 'error', m: 'Could not open a shell on jumphost: timeout' });
    last().drop(1011);
    expect(sockets[0]!.sent.filter((f) => (f as { t: string }).t === 'i')).toEqual([]);
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    last().open();
    last().frame({ t: 'ready' });
    expect(last().sent.filter((f) => (f as { t: string }).t === 'i')).toEqual([{ t: 'i', d: 'whoami\r' }]);
    expect(term.written.join('')).not.toContain('not sent');
  });

  it('says how many buffered keystrokes were not sent when the first connection is refused', () => {
    const { term, last } = setup();
    term.type('ls\r');
    last().open();
    last().frame({ t: 'error', m: 'session not found' });
    last().drop(CLOSE_REFUSED);
    expect(term.written.join('')).toContain('3 keystrokes typed before the shell attached were not sent');
  });

  it('sends a keepalive frame while open and stops after the socket closes', () => {
    const { last } = setup();
    last().open();
    last().frame({ t: 'ready' });
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(last().sent.filter((f) => (f as { t: string }).t === 'p')).toHaveLength(2);
    const s = last();
    s.drop();
    vi.advanceTimersByTime(KEEPALIVE_MS * 3);
    expect(s.sent.filter((f) => (f as { t: string }).t === 'p')).toHaveLength(2);
  });

  it('reconnects on its own with backoff after a dropped connection, and says the shell is new', () => {
    const { sockets, statuses, term, last } = setup();
    last().open();
    last().frame({ t: 'ready' });
    last().drop();
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', attempt: 1, retryInMs: RECONNECT_DELAYS_MS[0] });
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    expect(sockets).toHaveLength(2);
    // Typed while reconnecting: meant for the old shell, so never replayed into the new one.
    term.type('rm -rf *');
    term.type('\r');
    last().open();
    expect(last().sent.filter((f) => (f as { t: string }).t === 'i')).toEqual([]);
    last().frame({ t: 'ready' });
    expect(statuses.at(-1)).toEqual({ state: 'open' });
    expect(last().sent.filter((f) => (f as { t: string }).t === 'i')).toEqual([]);
    expect(term.written.join('')).toContain('reconnected to jumphost');
    expect(term.written.join('')).toContain('9 keystrokes typed while disconnected were not sent');
    // Typing in the new shell works as usual.
    term.type('pwd\r');
    expect(last().sent).toContainEqual({ t: 'i', d: 'pwd\r' });
    // Focus is not stolen on a reconnect.
    expect(term.focus).toHaveBeenCalledTimes(1);
  });

  it('backs off further on each failed attempt and gives up after the last delay', () => {
    const { sockets, statuses, last } = setup();
    last().drop();
    for (const [i, delay] of RECONNECT_DELAYS_MS.entries()) {
      expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', attempt: i + 1, retryInMs: delay });
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(i + 2);
      last().drop();
    }
    expect(statuses.at(-1)?.state).toBe('closed');
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(RECONNECT_DELAYS_MS.length + 1);
  });

  it('keeps the gateway error message while retrying', () => {
    const { statuses, last } = setup();
    last().open();
    last().frame({ t: 'error', m: 'The entry node jumphost has no shell endpoint yet.' });
    last().drop();
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', message: 'The entry node jumphost has no shell endpoint yet.' });
  });

  it('does not retry a refusal (close 1008); Enter does', () => {
    const { sockets, statuses, term, last } = setup();
    last().open();
    last().frame({ t: 'error', m: 'session not found' });
    last().drop(CLOSE_REFUSED);
    expect(statuses.at(-1)).toMatchObject({ state: 'closed', message: 'session not found' });
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(term.written.join('').match(/session not found/g)).toHaveLength(1);
    term.type('\r');
    expect(sockets).toHaveLength(2);
  });

  it('a shell that drops right after ready keeps backing off; one that stays up starts over', () => {
    const { sockets, statuses, last } = setup();
    // Each attempt attaches and drops at once: the attempts still run out.
    last().open();
    last().frame({ t: 'ready' });
    last().drop();
    for (const delay of RECONNECT_DELAYS_MS) {
      vi.advanceTimersByTime(delay);
      last().open();
      last().frame({ t: 'ready' });
      last().drop();
    }
    expect(statuses.at(-1)?.state).toBe('closed');
    const n = sockets.length;
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(n);

    // A shell that stayed up for STABLE_MS gets the full set of attempts again.
    const b = setup();
    b.last().open();
    b.last().frame({ t: 'ready' });
    b.last().drop();
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    b.last().open();
    b.last().frame({ t: 'ready' });
    vi.advanceTimersByTime(STABLE_MS);
    b.last().drop();
    expect(b.statuses.at(-1)).toMatchObject({ state: 'reconnecting', attempt: 1 });
  });

  it('does not reconnect by itself after the shell exits; Enter does', () => {
    const { sockets, statuses, term, last } = setup();
    last().open();
    last().frame({ t: 'ready' });
    last().frame({ t: 'exit', code: 0 });
    last().drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)?.state).toBe('ended');
    term.type('a');
    expect(sockets).toHaveLength(1);
    term.type('\r');
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)?.state).toBe('connecting');
  });

  it('reconnect() connects at once, cancels the pending retry and closes an attempt in flight', () => {
    const { shell, sockets, last } = setup();
    last().drop();
    shell.reconnect();
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    expect(sockets).toHaveLength(2);
    // An open shell ignores it.
    last().open();
    last().frame({ t: 'ready' });
    shell.reconnect();
    expect(sockets).toHaveLength(2);
  });

  it('dispose stops retries and keepalives and closes the socket', () => {
    const { shell, sockets, last } = setup();
    const first = last();
    first.drop();
    shell.dispose();
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    const b = setup();
    b.last().open();
    b.shell.dispose();
    expect(b.last().closed).toBe(true);
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(b.last().sent).toEqual([]);
  });

  it('abandons an attempt whose shell never attaches and retries it, keeping the first keystrokes', () => {
    const { sockets, statuses, last, term } = setup();
    last().open(); // the socket opens, but planning or the exec hangs: no "ready"
    term.type('ls\r');
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1);
    expect(statuses.at(-1)?.state).toBe('connecting');
    vi.advanceTimersByTime(1);
    expect(sockets[0]!.closed).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', attempt: 1, message: 'The lab did not open a shell in time' });
    sockets[0]!.drop(); // the late close of the abandoned socket is ignored
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!);
    expect(sockets).toHaveLength(2);
    last().open();
    last().frame({ t: 'ready', via: 'exec' });
    expect(last().sent).toContainEqual({ t: 'i', d: 'ls\r' });
    // An attached shell is not abandoned later.
    vi.advanceTimersByTime(READY_TIMEOUT_MS * 2);
    expect(last().closed).toBe(false);
    expect(statuses.at(-1)?.state).toBe('open');
  });
});
