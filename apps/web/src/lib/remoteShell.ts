import type { IDisposable, Terminal } from '@xterm/xterm';
import { wsUrl } from './runtimeConfig';

/**
 * A real shell in the lab: xterm.js <-> WebSocket <-> services/gateway <-> exec in the
 * node's pod. Protocol (see services/gateway/src/terminal/bridge.ts):
 *   out  {"t":"i","d":"..."} keystrokes, {"t":"r","c":cols,"r":rows} resize,
 *        {"t":"p"} keepalive (the gateway ignores frames it does not know)
 *   in   binary terminal output; {"t":"ready"|"exit"|"error", ...} control frames
 *
 * Resilience: a keepalive frame goes out every KEEPALIVE_MS so load balancers and proxies
 * with an idle timeout (the Azure LB drops idle flows after about 4 minutes) keep the socket.
 * A dropped connection reconnects on its own with backoff, keeping the scrollback. Keystrokes
 * typed before the FIRST shell attaches are buffered and sent on "ready", not when the socket
 * opens: until then no shell has seen them, so if that attempt fails (exec failed, a dropped
 * socket) they are kept for the automatic retry, and if it is refused or the attempts run out
 * the terminal says how many were not sent. Keystrokes typed
 * while reconnecting are not: the gateway starts a new login shell on each connection (other
 * cwd, environment, sudo/su context and foreground program), so replaying ":wq", a password or
 * "rm -rf *" into it could do damage. They are dropped and the terminal says how many were
 * not sent. A permanent refusal from the gateway (error frame and close 1008: the session is
 * gone or not yours, the node has no shell, the exam attempt is closed) is not retried. The
 * automatic attempts start over only once a shell has stayed up for STABLE_MS, so a shell that
 * drops right after attaching does not reconnect forever. After the shell exits, or once the
 * automatic attempts are spent, Enter (or the Reconnect control) connects again. An attempt
 * whose shell has not attached within READY_TIMEOUT_MS (the socket hangs, or planning or the
 * exec never answers) is closed and counts as a dropped connection, so the terminal never
 * stays in "connecting" with no way out.
 */

/** `connecting`: first attempt; `open`: shell attached; `reconnecting`: an automatic retry is scheduled or running; `closed`: gave up, waiting for the user; `ended`: the shell exited. */
export type ShellState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'ended';
export interface ShellStatus {
  state: ShellState;
  /** Automatic attempt number while reconnecting (1-based). */
  attempt?: number;
  /** Milliseconds until the next automatic attempt (reconnecting, before it starts). */
  retryInMs?: number;
  /** Last error the gateway reported. */
  message?: string;
}

/** The part of a WebSocket this class uses (tests pass a fake). */
export interface SocketLike {
  readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: ArrayBuffer | string }) => void) | null;
  onclose: ((ev: { code?: number } | undefined) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RemoteShellDeps {
  socket: (url: string) => SocketLike;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

/** The gateway closes with 1008 when it refuses the terminal for good (see bridge.ts). */
export const CLOSE_REFUSED = 1008;

const OPEN = 1;
export const KEEPALIVE_MS = 25_000;
/** Automatic reconnect delays; after the last one the user reconnects by hand. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** How long a shell must stay attached before the automatic attempts start over. */
export const STABLE_MS = 10_000;
/** How long an attempt may take to attach a shell ("ready") before it is abandoned and retried. */
export const READY_TIMEOUT_MS = 30_000;
/** Keystrokes kept until the first shell attaches (a paste larger than this is cut). */
const MAX_PENDING = 16_384;

const browserDeps = (): RemoteShellDeps => ({
  socket: (url) => new WebSocket(url) as unknown as SocketLike,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id as number),
});

type TermLike = Pick<Terminal, 'onData' | 'onResize' | 'write' | 'focus' | 'cols' | 'rows'>;

export class RemoteShell {
  private ws: SocketLike | null = null;
  private subs: IDisposable[] = [];
  private disposed = false;
  private status: ShellStatus = { state: 'connecting' };
  private pending = '';
  private attempts = 0;
  private everReady = false;
  private dropped = 0;
  private retryTimer: unknown = null;
  private stableTimer: unknown = null;
  private readyTimer: unknown = null;
  private keepalive: unknown = null;
  private readonly deps: RemoteShellDeps;

  constructor(
    private readonly term: TermLike,
    private readonly opts: {
      sessionId: string;
      node: string;
      entry: boolean;
      url?: (query: URLSearchParams) => string;
      onStatus?: (s: ShellStatus) => void;
      deps?: Partial<RemoteShellDeps>;
    },
  ) {
    this.deps = { ...browserDeps(), ...opts.deps };
  }

  get state(): ShellState {
    return this.status.state;
  }

  start() {
    this.subs.push(
      this.term.onData((d) => this.input(d)),
      this.term.onResize(({ cols, rows }) => this.send({ t: 'r', c: cols, r: rows })),
    );
    this.connect();
  }

  /** Connect now (the Reconnect control, or Enter after the shell ended); resets the automatic attempts. */
  reconnect() {
    if (this.disposed || this.status.state === 'open' || this.status.state === 'connecting') return;
    this.attempts = 0;
    this.clearRetry();
    this.connect();
  }

  private input(d: string) {
    const s = this.status.state;
    if (s === 'open') this.send({ t: 'i', d });
    // Input for a shell that has gone is not replayed into the next one (see the class comment).
    else if ((s === 'connecting' || s === 'reconnecting') && this.everReady) this.dropped += d.length;
    else if (s === 'connecting' || s === 'reconnecting') this.pending = (this.pending + d).slice(0, MAX_PENDING);
    else if (d === '\r') this.reconnect();
  }

  private setStatus(s: ShellStatus) {
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private send(f: unknown) {
    if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(f));
  }

  private note(text: string, tone: 'dim' | 'err' = 'dim') {
    this.term.write(`\r\n\x1b[${tone === 'err' ? '31' : '2'}m${text}\x1b[0m\r\n`);
  }

  private url(): string {
    const { sessionId, node, entry, url } = this.opts;
    const q = new URLSearchParams({ cols: String(this.term.cols), rows: String(this.term.rows) });
    if (url) return wsUrl(url(q), location);
    if (!entry) q.set('node', node);
    return wsUrl(`/api/sessions/${encodeURIComponent(sessionId)}/terminal?${q}`, location);
  }

  private connect() {
    if (this.disposed) return;
    this.retryTimer = null;
    // A manual reconnect can overlap an attempt in flight: drop that socket first.
    const previous = this.ws;
    this.ws = null;
    previous?.close();
    if (this.attempts > 0) this.setStatus({ state: 'reconnecting', attempt: this.attempts, message: this.status.message });
    else this.setStatus({ state: 'connecting' });
    const ws = this.deps.socket(this.url());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let ended = false;
    this.clearReady();
    this.readyTimer = this.deps.setTimeout(() => {
      this.readyTimer = null;
      if (this.ws !== ws || this.disposed) return;
      // No shell in time: drop this socket (its onclose is ignored) and retry like a dropped connection.
      this.ws = null;
      this.stopKeepalive();
      ws.close();
      this.setStatus({ ...this.status, message: 'The lab did not open a shell in time' });
      this.scheduleRetry();
    }, READY_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.stopKeepalive();
      this.keepalive = this.deps.setInterval(() => this.send({ t: 'p' }), KEEPALIVE_MS);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data !== 'string') {
        this.term.write(new Uint8Array(ev.data));
        return;
      }
      let f: { t: string; code?: number; m?: string; via?: string };
      try {
        f = JSON.parse(ev.data) as typeof f;
      } catch {
        return;
      }
      if (f.t === 'ready') {
        const again = this.everReady;
        this.everReady = true;
        this.clearReady();
        this.clearStable();
        this.stableTimer = this.deps.setTimeout(() => {
          this.stableTimer = null;
          this.attempts = 0;
        }, STABLE_MS);
        this.setStatus({ state: 'open' });
        // Sent only now: a shell is attached, so input buffered for the first one reaches it exactly once.
        if (this.pending) {
          ws.send(JSON.stringify({ t: 'i', d: this.pending }));
          this.pending = '';
        }
        if (again) {
          this.note(`[reconnected to ${this.opts.node}: this is a new shell; programs from the previous one are not attached]`);
          if (this.dropped) this.note(`[${this.dropped} ${this.dropped === 1 ? 'keystroke' : 'keystrokes'} typed while disconnected ${this.dropped === 1 ? 'was' : 'were'} not sent]`);
          this.dropped = 0;
        } else this.term.focus();
      } else if (f.t === 'exit') {
        ended = true;
        this.setStatus({ state: 'ended' });
        this.note(`[session on ${this.opts.node} ended${f.code ? ` with code ${f.code}` : ''}. Press Enter to reconnect]`);
      } else if (f.t === 'error') {
        this.setStatus({ ...this.status, message: f.m ?? 'terminal unavailable' });
        this.note(`${f.m ?? 'terminal unavailable'}`, 'err');
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopKeepalive();
      this.clearStable();
      this.clearReady();
      if (ended || this.disposed) return;
      // A refusal (1008) will not change by retrying: wait for the user.
      if (ev?.code === CLOSE_REFUSED) {
        this.discardPending();
        this.setStatus({ state: 'closed', message: this.status.message });
        this.note('[the lab refused the terminal. Press Enter or Reconnect to try again]');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    const delay = RECONNECT_DELAYS_MS[this.attempts];
    if (delay === undefined) {
      this.discardPending();
      this.setStatus({ state: 'closed', message: this.status.message });
      this.note('[connection to the lab closed. Press Enter or Reconnect to try again]');
      return;
    }
    this.attempts += 1;
    if (this.attempts === 1) this.note('[connection to the lab closed. Reconnecting…]');
    this.setStatus({ state: 'reconnecting', attempt: this.attempts, retryInMs: delay, message: this.status.message });
    this.retryTimer = this.deps.setTimeout(() => this.connect(), delay);
  }

  /** Buffered input that will never reach a shell: say so rather than lose it silently. */
  private discardPending() {
    const n = this.pending.length;
    this.pending = '';
    if (n) this.note(`[${n} ${n === 1 ? 'keystroke' : 'keystrokes'} typed before the shell attached ${n === 1 ? 'was' : 'were'} not sent]`);
  }

  private clearRetry() {
    if (this.retryTimer !== null) this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearReady() {
    if (this.readyTimer !== null) this.deps.clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  private clearStable() {
    if (this.stableTimer !== null) this.deps.clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  private stopKeepalive() {
    if (this.keepalive !== null) this.deps.clearInterval(this.keepalive);
    this.keepalive = null;
  }

  dispose() {
    this.disposed = true;
    this.clearRetry();
    this.clearStable();
    this.clearReady();
    this.stopKeepalive();
    this.subs.forEach((s) => s.dispose());
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
