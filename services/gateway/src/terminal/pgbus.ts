import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { isBusMessage, type BusMessage, type TerminalBus } from './hub.js';

/** The NOTIFY channel shared by the gateway replicas of one database. */
export const TERMINAL_CHANNEL = 'ct_terminal';
/** Postgres refuses NOTIFY payloads of 8000 bytes or more. */
const MAX_PAYLOAD = 7900;
/**
 * pg_notify calls in flight above which output (`out`, `back`) is dropped:
 * pg.Client queues queries in memory without limit, and a stalled
 * connection would otherwise buffer every watched terminal's output.
 */
export const MAX_IN_FLIGHT = 64;
/** Above this even control messages (watch, unwatch, notice) are dropped. */
const MAX_IN_FLIGHT_CONTROL = 256;
/** A query (NOTIFY, LISTEN) not answered within this means the connection is stalled: it is replaced. */
const QUERY_TIMEOUT_MS = 10_000;
/**
 * Messages sent longer ago than this (or this far in the future: clock skew
 * between replicas) are dropped, and a message seen once within it (same
 * IV) is not delivered again: a database role that captured sealed payloads
 * cannot replay them (a stale "observation stopped" notice, old output).
 */
export const REPLAY_WINDOW_MS = 30_000;

interface Log {
  warn(o: object, m: string): void;
}

export interface PgTerminalBusOptions {
  /**
   * Secret shared by the gateway replicas (CT_SESSION_SECRET). Payloads are
   * encrypted and authenticated with a key derived from it (AES-256-GCM),
   * so another role of the database that LISTENs on the channel reads no
   * terminal output, and cannot inject any.
   */
  secret: string;
  log?: Log;
}

const busKey = (secret: string) => Buffer.from(hkdfSync('sha256', secret, 'cloudtrain', 'ct-terminal-bus/v1', 32));

/** Encrypts a bus message: base64(iv | tag | ciphertext). */
export function sealBusPayload(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

/** Decrypts a bus payload; undefined when it was not sealed with this key. */
export function openBusPayload(key: Buffer, payload: string): string | undefined {
  try {
    const raw = Buffer.from(payload, 'base64');
    if (raw.length < 28) return undefined;
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), { authTagLength: 16 });
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** The sealed plaintext: the message with its send time. */
interface Envelope {
  t: number;
  m: unknown;
}

/**
 * Freshness of sealed payloads: a message is accepted once, within
 * REPLAY_WINDOW_MS of its send time. The IV (random per message, covered by
 * the authentication tag) identifies a payload; IVs are remembered for the
 * window only.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs = REPLAY_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether a payload with this IV, sent at t, is fresh (and records it). */
  accept(iv: string, t: number): boolean {
    const now = this.now();
    for (const [k, until] of this.seen) {
      if (until > now) break; // insertion order = expiry order
      this.seen.delete(k);
    }
    if (!Number.isFinite(t) || Math.abs(now - t) > this.windowMs) return false;
    if (this.seen.has(iv)) return false;
    this.seen.set(iv, now + 2 * this.windowMs);
    return true;
  }

  /** IVs remembered (tests). */
  get size(): number {
    return this.seen.size;
  }
}

/** Seals a bus message with its send time. */
export function sealBusMessage(key: Buffer, m: BusMessage, now = Date.now()): string {
  return sealBusPayload(key, JSON.stringify({ t: now, m } satisfies Envelope));
}

/**
 * Opens a bus payload: the message when it was sealed with this key, has
 * the expected shape and is fresh (guard), otherwise undefined.
 */
export function openBusMessage(key: Buffer, payload: string, guard: ReplayGuard): BusMessage | undefined {
  const text = openBusPayload(key, payload);
  if (text === undefined) return undefined; // not from a gateway of this deployment
  let e: Envelope;
  try {
    e = JSON.parse(text) as Envelope;
  } catch {
    return undefined;
  }
  if (typeof e !== 'object' || e === null || typeof e.t !== 'number' || !isBusMessage(e.m)) return undefined;
  // The IV is the first 12 bytes: the first 16 base64 characters.
  if (!guard.accept(payload.slice(0, 16), e.t)) return undefined;
  return e.m;
}

/**
 * Terminal shadowing across gateway replicas over Postgres LISTEN/NOTIFY:
 * one dedicated connection per replica listens and publishes. Messages only
 * flow while someone observes a session (hub.ts), and nothing is stored.
 * The connection is re-opened with backoff when it drops; messages published
 * meanwhile are lost (observers miss that output, nothing else breaks).
 * Payloads are encrypted with a key only the gateways hold, and messages
 * that do not decrypt, do not have the expected shape, are older than
 * REPLAY_WINDOW_MS or were seen before (replays) are ignored.
 */
export class PgTerminalBus implements TerminalBus {
  readonly id = randomUUID();
  private client: pg.Client | undefined;
  private readonly handlers: ((m: BusMessage) => void)[] = [];
  private closed = false;
  private reconnecting = false;
  private retry = 500;
  private inFlight = 0;
  private dropping = false;
  private readonly key: Buffer;
  private readonly guard = new ReplayGuard();
  private readonly log: Log | undefined;

  private constructor(
    private readonly connectionString: string,
    opts: PgTerminalBusOptions,
  ) {
    if (!opts.secret) throw new Error('terminal bus: a secret is required');
    this.key = busKey(opts.secret);
    this.log = opts.log;
  }

  /** Connects and listens; a failure to connect is retried in the background. */
  static async start(connectionString: string, opts: PgTerminalBusOptions): Promise<PgTerminalBus> {
    const bus = new PgTerminalBus(connectionString, opts);
    await bus.connect().catch((e: unknown) => bus.reconnect(e));
    return bus;
  }

  subscribe(fn: (m: BusMessage) => void): void {
    this.handlers.push(fn);
  }

  /** pg_notify calls sent and not answered yet (tests, diagnostics). */
  get pending(): number {
    return this.inFlight;
  }

  publish(m: BusMessage): void {
    const c = this.client;
    if (!c) return;
    const cap = m.k === 'out' || m.k === 'back' ? MAX_IN_FLIGHT : MAX_IN_FLIGHT_CONTROL;
    if (this.inFlight >= cap) {
      if (!this.dropping) this.log?.warn({ inFlight: this.inFlight }, 'terminal bus: Postgres is not keeping up, dropping relayed terminal output');
      this.dropping = true;
      return;
    }
    const payload = sealBusMessage(this.key, m);
    if (payload.length > MAX_PAYLOAD) {
      this.log?.warn({ kind: m.k, bytes: payload.length }, 'terminal bus: message too large, dropped');
      return;
    }
    this.inFlight++;
    c.query('SELECT pg_notify($1, $2)', [TERMINAL_CHANNEL, payload])
      .catch((e: unknown) => {
        this.log?.warn({ err: (e as Error).message }, 'terminal bus: notify failed');
        // A timed-out query means the connection is stalled: replace it.
        if (/timeout/i.test((e as Error).message)) this.lost(c, e);
      })
      .finally(() => {
        this.inFlight--;
        if (this.inFlight === 0) this.dropping = false;
      });
  }

  async close(): Promise<void> {
    this.closed = true;
    const c = this.client;
    this.client = undefined;
    await c?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    // keepAlive notices a half-open connection; query_timeout a stalled one
    // (its queued queries are dropped with it).
    const c = new pg.Client({ connectionString: this.connectionString, keepAlive: true, query_timeout: QUERY_TIMEOUT_MS });
    c.on('notification', (n) => {
      if (n.channel !== TERMINAL_CHANNEL || !n.payload) return;
      const m = openBusMessage(this.key, n.payload, this.guard);
      if (!m || m.from === this.id) return;
      for (const h of this.handlers) {
        try {
          h(m);
        } catch (e) {
          this.log?.warn({ err: (e as Error).message, kind: m.k }, 'terminal bus: handler failed');
        }
      }
    });
    c.on('error', (e) => this.lost(c, e));
    c.on('end', () => this.lost(c, new Error('connection ended')));
    try {
      await c.connect();
      await c.query(`LISTEN ${TERMINAL_CHANNEL}`);
    } catch (e) {
      this.drop(c);
      throw e;
    }
    if (this.closed) {
      this.drop(c);
      return;
    }
    this.client = c;
    this.retry = 500;
  }

  /** The listening connection failed: drop it and reconnect. */
  private lost(c: pg.Client, e: unknown) {
    if (c !== this.client) return; // a connection that never became the listener
    this.client = undefined;
    this.drop(c);
    this.reconnect(e);
  }

  private drop(c: pg.Client) {
    c.removeAllListeners();
    c.on('error', () => undefined);
    void c.end().catch(() => undefined);
  }

  private reconnect(e: unknown) {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.log?.warn({ err: e instanceof Error ? e.message : String(e), retryMs: this.retry }, 'terminal bus: no Postgres connection, reconnecting');
    const delay = this.retry;
    this.retry = Math.min(this.retry * 2, 30_000);
    setTimeout(() => {
      this.reconnecting = false;
      if (this.closed || this.client) return;
      this.connect().catch((err: unknown) => this.reconnect(err));
    }, delay).unref();
  }
}
