import type { WebSocket } from 'ws';
import type { SessionNotice } from '@cloudtrain/api-types';
import { send } from './bridge.js';

/** Recent output an observer gets when it starts watching (per session). */
export const SCROLLBACK = 64 * 1024;
/** An observer socket with more than this queued is too slow and is closed. */
export const OBSERVER_MAX_BUFFERED = 4 * 1024 * 1024;
/** Output relayed to observers on other replicas, per session and flush. */
const RELAY_MAX_PER_FLUSH = 16 * 1024;
const RELAY_FLUSH_MS = 250;
/** Raw bytes per bus message (base64, JSON, then encrypted and base64 again: stays under Postgres NOTIFY's 8000 bytes). */
const RELAY_CHUNK = 3300;
/** A replica re-announces its observers this often; a watch not renewed in WATCH_TTL_MS lapses. */
const WATCH_HEARTBEAT_MS = 30_000;
const WATCH_TTL_MS = 75_000;
const TRUNCATED = Buffer.from('\r\n\x1b[2m[output truncated for observers]\x1b[0m\r\n');

/**
 * Messages between gateway replicas (one bus per process, see pgbus.ts).
 * `from` is the sending replica; a replica ignores its own messages.
 */
export type BusMessage =
  /** The sender has observers of session `s` (`r`: a new observer that needs the scrollback). */
  | { k: 'watch'; s: string; from: string; r?: string }
  | { k: 'unwatch'; s: string; from: string }
  /** Learner output of `s` (base64). */
  | { k: 'out'; s: string; d: string; from: string }
  /** Scrollback for observer request `r` on replica `to`, in order (`last` on the final part). */
  | { k: 'back'; s: string; d: string; from: string; to: string; r: string; last: boolean }
  /** A notice for the learner sockets of `s` wherever they are. */
  | { k: 'notice'; s: string; n: SessionNotice; from: string };

const str = (v: unknown): v is string => typeof v === 'string';

/** Checks a message received from the bus before the hub acts on it. */
export function isBusMessage(v: unknown): v is BusMessage {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  if (!str(m.s) || !str(m.from)) return false;
  switch (m.k) {
    case 'watch':
      return m.r === undefined || str(m.r);
    case 'unwatch':
      return true;
    case 'out':
      return str(m.d);
    case 'back':
      return str(m.d) && str(m.to) && str(m.r) && typeof m.last === 'boolean';
    case 'notice':
      return typeof m.n === 'object' && m.n !== null;
    default:
      return false;
  }
}

export interface TerminalBus {
  /** This replica's id. */
  readonly id: string;
  publish(m: BusMessage): void;
  subscribe(fn: (m: BusMessage) => void): void;
}

/** The last `max` bytes of a stream, without copying on every chunk. */
export class Scrollback {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly max = SCROLLBACK) {}

  push(chunk: Buffer): void {
    if (chunk.length >= this.max) {
      this.chunks = [Buffer.from(chunk.subarray(chunk.length - this.max))];
      this.size = this.max;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.max) {
      const head = this.chunks[0]!;
      const over = this.size - this.max;
      if (head.length <= over) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(over);
        this.size -= over;
      }
    }
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks, this.size);
  }

  get length(): number {
    return this.size;
  }
}

const sendBinary = (ws: WebSocket, chunk: Buffer) => {
  if (ws.readyState !== ws.OPEN) return;
  // A watcher that cannot keep up is dropped instead of buffering without limit.
  if (ws.bufferedAmount > OBSERVER_MAX_BUFFERED) {
    ws.terminate();
    return;
  }
  ws.send(chunk, { binary: true });
};

/**
 * Read-only shadowing: learner terminals of a session publish their output
 * here; observers (instructor/admin, `?observe=1`) receive a copy plus the
 * recent scrollback, and their input is never forwarded. Learner sockets get
 * `notice` frames when someone starts or stops watching.
 *
 * With a bus, learner and observer may be on different gateway replicas: a
 * replica with observers announces them (`watch`, renewed every 30 s), the
 * replica with the learner answers with the scrollback and then relays the
 * learner's output while a watch is live (rate-limited; a flood is truncated
 * for observers, never for the learner), and notices reach the learner
 * wherever it is connected.
 *
 * Scrollback is kept only while a learner or observer of the session is
 * connected to this replica, so terminal output (which may hold secrets)
 * does not outlive the session's sockets.
 */
export class TerminalHub {
  private readonly learners = new Map<string, Set<WebSocket>>();
  private readonly observers = new Map<string, Set<WebSocket>>();
  private readonly scrollback = new Map<string, Scrollback>();
  /** Sessions observed on other replicas: session -> replica -> lapse time. */
  private readonly remote = new Map<string, Map<string, number>>();
  /** Output waiting to be relayed: session -> chunks. */
  private readonly pending = new Map<string, { chunks: Buffer[]; size: number; dropped: boolean }>();
  /**
   * Observers waiting for their scrollback from another replica: request id
   * -> socket. A learner with sockets on several replicas gets an answer
   * from each: the first replica to answer (from) is taken, the others are
   * ignored, so the parts of two scrollbacks are never interleaved.
   */
  private readonly awaitingBack = new Map<string, { ws: WebSocket; parts: Buffer[]; from?: string }>();
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly heartbeat: NodeJS.Timeout | undefined;
  private seq = 0;

  constructor(
    private readonly bus?: TerminalBus,
    private readonly now: () => number = Date.now,
  ) {
    if (!bus) return;
    bus.subscribe((m) => this.onBus(m));
    this.heartbeat = setInterval(() => this.renew(), WATCH_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Returns the tap to pass to bridge() for a learner's terminal. */
  addLearner(session: string, ws: WebSocket): (chunk: Buffer) => void {
    const set = this.learners.get(session) ?? new Set();
    set.add(ws);
    this.learners.set(session, set);
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) this.learners.delete(session);
      this.release(session);
    });
    return (chunk) => {
      // Recorded only while this learner socket is registered (a tap that
      // outlives its socket must not bring the scrollback back).
      if (!this.learners.get(session)?.has(ws)) return;
      this.backOf(session).push(chunk);
      for (const o of this.observers.get(session) ?? []) sendBinary(o, chunk);
      if (this.watchedRemotely(session)) this.queue(session, chunk);
    };
  }

  addObserver(session: string, ws: WebSocket, onClose: () => void): void {
    const set = this.observers.get(session) ?? new Set();
    set.add(ws);
    this.observers.set(session, set);
    const local = this.learners.has(session);
    send(ws, { t: 'observe', readOnly: true, m: local || this.bus ? 'Watching the learner terminal (read-only).' : 'Waiting for the learner to open a terminal (read-only).' });
    const back = this.scrollback.get(session);
    if (back?.length) ws.send(back.bytes(), { binary: true });
    if (this.bus && !local) {
      // The learner may be connected to another replica: ask for its scrollback and output.
      const r = `${this.bus.id}:${++this.seq}`;
      this.awaitingBack.set(r, { ws, parts: [] });
      this.bus.publish({ k: 'watch', s: session, from: this.bus.id, r });
      ws.on('close', () => this.awaitingBack.delete(r));
    }
    ws.on('message', () => undefined); // input is dropped: read-only
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) {
        this.observers.delete(session);
        this.bus?.publish({ k: 'unwatch', s: session, from: this.bus.id });
      }
      this.release(session);
      onClose();
    });
  }

  notifyLearner(session: string, notice: SessionNotice): void {
    this.deliverNotice(session, notice);
    this.bus?.publish({ k: 'notice', s: session, n: notice, from: this.bus.id });
  }

  observerCount(session: string): number {
    return this.observers.get(session)?.size ?? 0;
  }

  /** Sessions with scrollback held in memory (tests, diagnostics). */
  heldSessions(): number {
    return this.scrollback.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  private deliverNotice(session: string, notice: SessionNotice) {
    for (const ws of this.learners.get(session) ?? []) send(ws, { t: 'notice', notice });
  }

  private backOf(session: string): Scrollback {
    let b = this.scrollback.get(session);
    if (!b) this.scrollback.set(session, (b = new Scrollback()));
    return b;
  }

  /** Frees what this replica holds for a session once none of its sockets are left. */
  private release(session: string) {
    if (this.learners.has(session) || this.observers.has(session)) return;
    this.scrollback.delete(session);
    this.pending.delete(session);
  }

  private watchedRemotely(session: string): boolean {
    const w = this.remote.get(session);
    if (!w) return false;
    const now = this.now();
    for (const [replica, until] of w) if (until <= now) w.delete(replica);
    if (!w.size) this.remote.delete(session);
    return w.size > 0;
  }

  private queue(session: string, chunk: Buffer) {
    let p = this.pending.get(session);
    if (!p) this.pending.set(session, (p = { chunks: [], size: 0, dropped: false }));
    if (p.size + chunk.length > RELAY_MAX_PER_FLUSH) {
      const room = RELAY_MAX_PER_FLUSH - p.size;
      if (room > 0) {
        p.chunks.push(chunk.subarray(0, room));
        p.size += room;
      }
      p.dropped = true;
    } else {
      p.chunks.push(chunk);
      p.size += chunk.length;
    }
    this.flushTimer ??= setTimeout(() => this.flush(), RELAY_FLUSH_MS);
  }

  private flush() {
    this.flushTimer = undefined;
    if (!this.bus) return;
    for (const [s, p] of this.pending) {
      const data = Buffer.concat(p.dropped ? [...p.chunks, TRUNCATED] : p.chunks);
      for (let i = 0; i < data.length; i += RELAY_CHUNK) this.bus.publish({ k: 'out', s, d: data.subarray(i, i + RELAY_CHUNK).toString('base64'), from: this.bus.id });
    }
    this.pending.clear();
  }

  private renew() {
    if (!this.bus) return;
    for (const s of this.observers.keys()) this.bus.publish({ k: 'watch', s, from: this.bus.id });
    for (const s of [...this.remote.keys()]) this.watchedRemotely(s); // prune lapsed watches
  }

  private onBus(m: BusMessage) {
    if (!this.bus || m.from === this.bus.id) return;
    switch (m.k) {
      case 'watch': {
        const w = this.remote.get(m.s) ?? new Map<string, number>();
        w.set(m.from, this.now() + WATCH_TTL_MS);
        this.remote.set(m.s, w);
        const back = this.learners.has(m.s) ? this.scrollback.get(m.s) : undefined;
        if (m.r && back) {
          const data = back.bytes();
          for (let i = 0; i < data.length; i += RELAY_CHUNK) {
            this.bus.publish({ k: 'back', s: m.s, d: data.subarray(i, i + RELAY_CHUNK).toString('base64'), from: this.bus.id, to: m.from, r: m.r, last: i + RELAY_CHUNK >= data.length });
          }
        }
        return;
      }
      case 'unwatch':
        this.remote.get(m.s)?.delete(m.from);
        if (!this.remote.get(m.s)?.size) this.remote.delete(m.s);
        return;
      case 'out':
        for (const o of this.observers.get(m.s) ?? []) sendBinary(o, Buffer.from(m.d, 'base64'));
        return;
      case 'back': {
        if (m.to !== this.bus.id) return;
        const a = this.awaitingBack.get(m.r);
        if (!a) return;
        a.from ??= m.from;
        if (a.from !== m.from) return; // another learner replica answered first
        a.parts.push(Buffer.from(m.d, 'base64'));
        if (m.last) {
          this.awaitingBack.delete(m.r);
          sendBinary(a.ws, Buffer.concat(a.parts));
        }
        return;
      }
      case 'notice':
        this.deliverNotice(m.s, m.n);
        return;
    }
  }
}
