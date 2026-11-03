import { PassThrough, Writable } from 'node:stream';
import type { WebSocket } from 'ws';
import type { SessionNotice } from '@cloudtrain/api-types';
import type { ExecHandle, LabCluster } from '../kube/cluster.js';
import type { TerminalPlan } from './target.js';

/**
 * Terminal protocol between the web app and the gateway (one WebSocket per tab).
 *
 *   client -> gateway  text   {"t":"i","d":"<keystrokes>"}      input
 *                      text   {"t":"r","c":<cols>,"r":<rows>}  resize
 *   gateway -> client  binary <bytes>                         terminal output
 *                      text   {"t":"ready","via":"..."}       exec attached
 *                      text   {"t":"exit","code":<n>}         process ended
 *                      text   {"t":"error","m":"..."}         could not attach
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
    send(ws, { t: 'error', m: (e as Error).message });
    ws.close(1008, 'unavailable');
    return;
  }
  if (closed) return;
  try {
    handle = await cluster.exec(plan.target, plan.command, { stdout, stderr: null, stdin }, true);
  } catch (e) {
    log.warn({ err: e, target: plan.target }, 'terminal exec failed');
    send(ws, { t: 'error', m: `Could not open a shell on ${plan.node}: ${(e as Error).message}` });
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
