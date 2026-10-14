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

/** Output sink that is also a "resizable stream" for client-node's TTY resize channel. */
export class TerminalOutput extends Writable {
  columns: number;
  rows: number;

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
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(chunk, { binary: true });
    this.tap?.(chunk);
    cb();
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
  send(ws, { t: 'ready', via: plan.via });
  const code = await handle.exited;
  send(ws, { t: 'exit', code });
  if (ws.readyState === ws.OPEN) ws.close(1000, 'exit');
}
