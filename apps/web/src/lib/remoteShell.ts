import type { IDisposable, Terminal } from '@xterm/xterm';

/**
 * A real shell in the lab: xterm.js <-> WebSocket <-> services/gateway <-> exec in the
 * node's pod. Protocol (see services/gateway/src/terminal/bridge.ts):
 *   out  {"t":"i","d":"..."} keystrokes, {"t":"r","c":cols,"r":rows} resize
 *   in   binary terminal output; {"t":"ready"|"exit"|"error", ...} control frames
 * After the shell exits or the connection drops, Enter reconnects.
 */
export class RemoteShell {
  private ws: WebSocket | null = null;
  private subs: IDisposable[] = [];
  private live = false;
  private disposed = false;

  constructor(
    private readonly term: Terminal,
    private readonly opts: { sessionId: string; node: string; entry: boolean; url?: (query: URLSearchParams) => string },
  ) {}

  start() {
    this.subs.push(
      this.term.onData((d) => {
        if (this.live) this.send({ t: 'i', d });
        else if (d === '\r') this.connect();
      }),
      this.term.onResize(({ cols, rows }) => this.send({ t: 'r', c: cols, r: rows })),
    );
    this.connect();
  }

  private send(f: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(f));
  }

  private note(text: string, tone: 'dim' | 'err' = 'dim') {
    this.term.write(`\r\n\x1b[${tone === 'err' ? '31' : '2'}m${text}\x1b[0m\r\n`);
  }

  private connect() {
    if (this.disposed) return;
    const { sessionId, node, entry, url } = this.opts;
    const q = new URLSearchParams({ cols: String(this.term.cols), rows: String(this.term.rows) });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let path: string;
    if (url) path = url(q);
    else {
      if (!entry) q.set('node', node);
      path = `/api/sessions/${encodeURIComponent(sessionId)}/terminal?${q}`;
    }
    const ws = new WebSocket(`${proto}://${location.host}${path}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.live = true;
    let ended = false;
    ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
      if (typeof ev.data !== 'string') {
        this.term.write(new Uint8Array(ev.data));
        return;
      }
      let f: { t: string; code?: number; m?: string };
      try {
        f = JSON.parse(ev.data) as typeof f;
      } catch {
        return;
      }
      if (f.t === 'ready') this.term.focus();
      else if (f.t === 'exit') {
        ended = true;
        this.live = false;
        this.note(`[session on ${node} ended${f.code ? ` with code ${f.code}` : ''}. Press Enter to reconnect]`);
      } else if (f.t === 'error') {
        ended = true;
        this.live = false;
        this.note(`${f.m ?? 'terminal unavailable'}`, 'err');
        this.note('[Press Enter to retry]');
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.live = false;
      if (!ended && !this.disposed) this.note('[connection to the lab closed. Press Enter to reconnect]');
    };
  }

  dispose() {
    this.disposed = true;
    this.live = false;
    this.subs.forEach((s) => s.dispose());
    this.ws?.close();
    this.ws = null;
  }
}
