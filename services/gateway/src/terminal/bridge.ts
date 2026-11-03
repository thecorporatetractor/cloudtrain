import { PassThrough, Writable } from 'node:stream';
import type { WebSocket } from 'ws';
import type { SessionNotice } from '@cloudtrain/api-types';
import { HttpError } from '../errors.js';
import type { ExecHandle, LabCluster } from '../kube/cluster.js';
import type { TerminalPlan } from './target.js';

/**
 * Terminal protocol between the web app and the gateway (one WebSocket per tab).
 *
 *   client -> gateway  text   {"t":"i","d":"<keystrokes>"}      input
 *                      text   {"t":"r","c":<cols>,"r":<rows>}  resize
 *                      text   {"t":"p"}                        keepalive (ignored, like any unknown frame)
 *   gateway -> client  binary <bytes>                         terminal output
 *                      text   {"t":"ready","via":"..."}       exec attached
 *                      text   {"t":"exit","code":<n>}         process ended
 *                      text   {"t":"error","m":"..."}         could not attach
 *
 * Close codes: 1000 the process exited; 1008 refused for good (400/403/404/409 while
 * planning: the client does not retry); 1011 a failure that may pass (planning hit a DB or
 * cluster error, or the exec failed: the client retries with backoff); 1013 the client read
 * terminal output too slowly (the backpressure limit was hit: the client reconnects).
 */
export type ClientFrame = { t: 'i'; d: string } | { t: 'r'; c: number; r: number };
export type ServerFrame = { t: 'ready'; via: string } | { t: 'exit'; code: number } | { t: 'error'; m: string } | { t: 'notice'; notice: SessionNotice } | { t: 'observe'; readOnly: true; m: string };

export const clampSize = (n: unknown, d: number, max: number) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, max) : d;
};

/** Output queued on the client socket above which the exec output is paused (backpressure). */
export const OUTPUT_HIGH_WATER = 1024 * 1024;
/** Below this the output flows again. */
export const OUTPUT_LOW_WATER = 256 * 1024;
/**
 * Last resort against a client that cannot keep up: output queued for it
 * (socket plus this stream's own buffer) above OUTPUT_MAX_QUEUED, or a
 * backlog that makes no progress at all for OUTPUT_STALL_MS, closes the
 * socket (with an error frame first), which ends the exec. A slow link that
 * still drains only slows the program's output down.
 */
export const OUTPUT_MAX_QUEUED = 8 * 1024 * 1024;
export const OUTPUT_STALL_MS = 30_000;
const OUTPUT_POLL_MS = 25;
/** A dropped socket that does not finish closing within this is terminated. */
const CLOSE_GRACE_MS = 5_000;
export const SLOW_CLIENT_MESSAGE = 'The terminal was closed: the connection could not keep up with the output (nothing was received for 30 seconds).';

/** The exec output's source, paused while the client is backed up. */
export interface OutputSource {
  pause(): void;
  resume(): void;
}

/** Output sink that is also a "resizable stream" for client-node's TTY resize channel. */
export class TerminalOutput extends Writable {
  columns: number;
  rows: number;
  /** The exec stream (set once attached): paused instead of buffering its output here. */
  source: OutputSource | undefined;
  private paused = false;
  private dropped = false;

  constructor(
    private readonly ws: WebSocket,
    cols: number,
    rows: number,
    /** Copy of every output chunk (read-only observers of this terminal). */
    private readonly tap?: (chunk: Buffer) => void,
  ) {
    super();
    this.columns = cols;
    this.rows = rows;
  }

  resize(cols: number, rows: number) {
    if (cols === this.columns && rows === this.rows) return;
    this.columns = cols;
    this.rows = rows;
    this.emit('resize');
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    const ws = this.ws;
    this.tap?.(chunk);
    if (ws.readyState !== ws.OPEN || this.dropped) return cb();
    ws.send(chunk, { binary: true });
    if (ws.bufferedAmount < OUTPUT_HIGH_WATER) return cb();
    if (ws.bufferedAmount + this.writableLength > OUTPUT_MAX_QUEUED) {
      this.drop();
      return cb();
    }
    if (this.source) {
      // Pause the exec stream until the socket drains: output in flight
      // still arrives, nothing more is read meanwhile.
      if (!this.paused) {
        this.paused = true;
        this.source.pause();
        this.whenDrained(() => {
          this.paused = false;
          this.source?.resume();
        });
      }
      return cb();
    }
    // No pausable source: hold the callback (client-node ignores write()'s
    // return value, so what arrives meanwhile queues in this stream and
    // counts towards OUTPUT_MAX_QUEUED).
    this.whenDrained(() => cb());
  }

  /** Calls done once the socket drained below the low-water mark (or closed); drops a socket that makes no progress. */
  private whenDrained(done: () => void) {
    const ws = this.ws;
    let low = ws.bufferedAmount;
    let progress = Date.now();
    const wait = () => {
      if (ws.readyState !== ws.OPEN || this.dropped || ws.bufferedAmount < OUTPUT_LOW_WATER) return done();
      if (ws.bufferedAmount + this.writableLength > OUTPUT_MAX_QUEUED) {
        this.drop();
        return done();
      }
      if (ws.bufferedAmount < low) {
        low = ws.bufferedAmount;
        progress = Date.now();
      } else if (Date.now() - progress > OUTPUT_STALL_MS) {
        this.drop();
        return done();
      }
      setTimeout(wait, OUTPUT_POLL_MS);
    };
    setTimeout(wait, OUTPUT_POLL_MS);
  }

  /** Closes a socket that cannot keep up ('close' ends the exec, see bridge). */
  private drop() {
    if (this.dropped) return;
    this.dropped = true;
    const ws = this.ws;
    send(ws, { t: 'error', m: SLOW_CLIENT_MESSAGE });
    ws.close(1013, 'terminal output too slow');
    setTimeout(() => {
      if (ws.readyState !== ws.CLOSED) ws.terminate();
    }, CLOSE_GRACE_MS).unref();
  }
}

export const send = (ws: WebSocket, f: ServerFrame) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(f));
};

/** Attaches a client WebSocket to an exec session in the lab and shuttles bytes both ways until either side ends. */
export async function bridge(ws: WebSocket, cluster: LabCluster, planned: Promise<TerminalPlan>, size: { cols: number; rows: number }, log: { warn(o: object, m: string): void }, tap?: (chunk: Buffer) => void) {
  // Listeners go on synchronously so keystrokes sent while the exec is being set up are buffered, not lost.
  const stdin = new PassThrough();
  const stdout = new TerminalOutput(ws, size.cols, size.rows, tap);
  let handle: ExecHandle | undefined;
  let closed = false;

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      stdin.write(raw as Buffer);
      return;
    }
    let f: ClientFrame;
    try {
      f = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return;
    }
    if (f.t === 'i' && typeof f.d === 'string') stdin.write(f.d);
    else if (f.t === 'r') stdout.resize(clampSize(f.c, stdout.columns, 1000), clampSize(f.r, stdout.rows, 500));
  });
  ws.on('close', () => {
    closed = true;
    stdin.end();
    handle?.close();
  });

  let plan: TerminalPlan;
  try {
    plan = await planned;
  } catch (e) {
    // 1008 tells the client not to retry, so it is kept for answers that will not change by
    // retrying (bad node, not yours, gone, not ready/closed). Anything else (a DB or cluster
    // blip) closes with 1011 and the client reconnects with backoff. HttpErrors are written for
    // the learner; anything else (Kubernetes, Postgres) stays in the log.
    if (isRefusal(e)) {
      send(ws, { t: 'error', m: e.message });
      ws.close(1008, 'unavailable');
    } else {
      if (!(e instanceof HttpError)) log.warn({ err: e }, 'terminal planning failed');
      send(ws, { t: 'error', m: e instanceof HttpError ? e.message : 'The terminal could not be opened just now. Please try again.' });
      ws.close(1011, 'planning failed');
    }
    return;
  }
  if (closed) return;
  try {
    handle = await cluster.exec(plan.target, plan.command, { stdout, stderr: null, stdin }, true);
  } catch (e) {
    log.warn({ err: e, target: plan.target }, 'terminal exec failed');
    send(ws, { t: 'error', m: `Could not open a shell on ${plan.node}. Please try again.` });
    ws.close(1011, 'exec failed');
    return;
  }
  if (closed) {
    handle.close();
    return;
  }
  const { pause, resume } = handle;
  if (pause && resume) stdout.source = { pause, resume };
  send(ws, { t: 'ready', via: plan.via });
  const code = await handle.exited;
  send(ws, { t: 'exit', code });
  if (ws.readyState === ws.OPEN) ws.close(1000, 'exit');
}

const REFUSAL_STATUSES = new Set([400, 403, 404, 409]);

/** A planning error the client should not retry: see the 1008/1011 split in bridge(). */
export function isRefusal(e: unknown): e is HttpError {
  return e instanceof HttpError && REFUSAL_STATUSES.has(e.status);
}

/**
 * How an observe connection that could not start is closed: the same split as bridge().
 * Refusals (400/403/404/409) close with 1008 and the observer stops; anything else (a DB
 * blip) closes with 1011 and a generic message, and the observer's client retries.
 */
export function observeFailure(e: unknown): { m: string; code: 1008 | 1011; reason: string } {
  if (isRefusal(e)) return { m: e.status === 403 ? 'You may not observe this session.' : e.message, code: 1008, reason: 'forbidden' };
  return { m: e instanceof HttpError ? e.message : 'The terminal could not be observed just now. Please try again.', code: 1011, reason: 'observe failed' };
}
