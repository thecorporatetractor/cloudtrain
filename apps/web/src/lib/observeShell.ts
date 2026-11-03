import type { Terminal } from '@xterm/xterm';
import { CLOSE_REFUSED, KEEPALIVE_MS, RECONNECT_DELAYS_MS, type RemoteShellDeps, type SocketLike, STABLE_MS } from './remoteShell';
import { wsUrl } from './runtimeConfig';

type ObserveState = 'connecting' | 'live' | 'ended' | 'error';

/**
 * Read-only mirror of a learner's terminal for instructors:
 * xterm.js <-> WebSocket `/api/sessions/:id/terminal?observe=1` <-> gateway.
 * The gateway drops any input on an observe connection; the client never sends
 * keystrokes either (xterm runs with stdin disabled). Resize is not sent: the
 * observer sees the learner's geometry.
 *
 * Like RemoteShell it sends a keepalive frame every KEEPALIVE_MS (the gateway ignores it; the
 * Azure LB drops flows idle for about 4 minutes, and a quiet learner sends nothing), and a
 * dropped connection reconnects with the same backoff. A refusal (close 1008) is not retried;
 * an error frame followed by 1011 (the gateway hit a transient failure) is. The gateway replays the learner's recent output on every connection, so the
 * terminal is cleared when a reconnected socket first answers (not before: the old output
 * stays readable while disconnected), and the replay does not show twice.
 */
export class ObserveShell {
  private ws: SocketLike | null = null;
  private disposed = false;
  private attempts = 0;
  private retryTimer: unknown = null;
  private stableTimer: unknown = null;
  private keepalive: unknown = null;
  private readonly deps: RemoteShellDeps;

  constructor(
    private readonly term: Pick<Terminal, 'write' | 'reset' | 'cols' | 'rows'>,
    private readonly opts: { sessionId: string; onState?: (s: ObserveState, detail?: string) => void; deps?: Partial<RemoteShellDeps> },
  ) {
    this.deps = {
      socket: (url) => new WebSocket(url) as unknown as SocketLike,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id as number),
      ...opts.deps,
    };
  }

  start() {
    this.connect();
  }

  private note(text: string, tone: 'dim' | 'err' = 'dim') {
    this.term.write(`\r\n\x1b[${tone === 'err' ? '31' : '2'}m${text}\x1b[0m\r\n`);
  }

  private connect() {
    if (this.disposed) return;
    this.retryTimer = null;
    const { sessionId, onState } = this.opts;
    onState?.('connecting');
    const q = new URLSearchParams({ observe: '1', cols: String(this.term.cols), rows: String(this.term.rows) });
    const ws = this.deps.socket(wsUrl(`/api/sessions/${encodeURIComponent(sessionId)}/terminal?${q}`, location));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let ended = false;
    // A reconnect: the old output is replaced by the gateway's replay on this socket's first frame.
    let stale = this.attempts > 0;
    let errorMessage: string | undefined;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.stopTimers();
      this.keepalive = this.deps.setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'p' }));
      }, KEEPALIVE_MS);
      this.stableTimer = this.deps.setTimeout(() => {
        this.stableTimer = null;
        this.attempts = 0;
      }, STABLE_MS);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (stale) {
        stale = false;
        this.term.reset();
      }
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
      if (f.t === 'ready' || f.t === 'observe') onState?.('live');
      else if (f.t === 'exit') {
        ended = true;
        this.note(`[learner's shell ended${f.code ? ` with code ${f.code}` : ''}]`);
        onState?.('ended');
      } else if (f.t === 'error') {
        // Final only if the close that follows is a refusal (1008); 1011 is retried.
        errorMessage = f.m ?? 'observe unavailable';
        this.note(errorMessage, 'err');
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopTimers();
      if (ended || this.disposed) return;
      if (ev?.code === CLOSE_REFUSED) {
        onState?.('error', errorMessage);
        return;
      }
      const delay = RECONNECT_DELAYS_MS[this.attempts];
      if (delay === undefined) {
        this.note('[connection closed. Reload the page to watch again]');
        onState?.('error', 'connection closed');
        return;
      }
      this.attempts += 1;
      this.note(`[connection closed; retrying in ${Math.round(delay / 1000)} s]`);
      onState?.('connecting');
      this.retryTimer = this.deps.setTimeout(() => this.connect(), delay);
    };
  }

  private stopTimers() {
    if (this.keepalive !== null) this.deps.clearInterval(this.keepalive);
    if (this.stableTimer !== null) this.deps.clearTimeout(this.stableTimer);
    this.keepalive = null;
    this.stableTimer = null;
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer !== null) this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

/**
 * Mock-mode stand-in: replays a scripted learner session so the shadow terminal
 * can be demoed without a cluster. The script loops with small pauses, like a
 * person typing.
 */
export class FakeObserve {
  private timer: number | undefined;
  private disposed = false;

  constructor(
    private readonly term: Terminal,
    private readonly opts: { learner: string; node: string; onState?: (s: 'connecting' | 'live' | 'ended' | 'error') => void },
  ) {}

  start() {
    this.opts.onState?.('connecting');
    const { learner, node } = this.opts;
    const prompt = `\x1b[1m${learner}@${node}\x1b[0m:~$ `;
    const script: { type?: string; out?: string; pause: number }[] = [
      { out: `\x1b[2mCloudTrain lab session · observing ${learner} on ${node} (read-only)\x1b[0m\r\n\r\n`, pause: 400 },
      { type: 'kubectl get networkpolicy -n payments', pause: 900 },
      { out: 'NAME           POD-SELECTOR   AGE\r\ndefault-deny   <none>         6m\r\n', pause: 1800 },
      { type: 'kubectl exec -n checkout probe -- curl -s -m 3 settlement-api.payments:8443', pause: 1400 },
      { out: '\x1b[31mcurl: (28) Connection timed out after 3001 milliseconds\x1b[0m\r\ncommand terminated with exit code 28\r\n', pause: 2600 },
      { type: 'kubectl get ns checkout --show-labels', pause: 800 },
      { out: 'NAME       STATUS   AGE   LABELS\r\ncheckout   Active   12d   kubernetes.io/metadata.name=checkout,team=payments\r\n', pause: 2200 },
      { type: 'vim allow-checkout.yaml', pause: 600 },
      { out: '\x1b[2m[editing allow-checkout.yaml … 14 lines]\x1b[0m\r\n', pause: 4200 },
      { type: 'kubectl apply -f allow-checkout.yaml', pause: 900 },
      { out: 'networkpolicy.networking.k8s.io/allow-checkout created\r\n', pause: 1500 },
      { type: 'kubectl exec -n checkout probe -- curl -s -m 3 settlement-api.payments:8443', pause: 1300 },
      { out: '\x1b[31mcurl: (28) Connection timed out after 3002 milliseconds\x1b[0m\r\n', pause: 3000 },
      { type: 'kubectl describe netpol allow-checkout -n payments | tail -8', pause: 900 },
      { out: '  Ingress:\r\n    To Port: 8443/TCP\r\n    From:\r\n      PodSelector: app=probe\r\n  Policy Types: Ingress\r\n', pause: 3500 },
      { out: `\x1b[2m[${learner} is idle]\x1b[0m\r\n`, pause: 2500 },
    ];
    let i = 0;
    const step = () => {
      if (this.disposed) return;
      const s = script[i % script.length]!;
      if (i === 1) this.opts.onState?.('live');
      if (s.type) {
        this.term.write(prompt);
        const chars = s.type.split('');
        let k = 0;
        const typeNext = () => {
          if (this.disposed) return;
          if (k < chars.length) {
            this.term.write(chars[k++]!);
            this.timer = window.setTimeout(typeNext, 35 + Math.random() * 70);
          } else {
            this.term.write('\r\n');
            i++;
            this.timer = window.setTimeout(step, s.pause);
          }
        };
        this.timer = window.setTimeout(typeNext, 200);
        return;
      }
      if (s.out) this.term.write(s.out);
      i++;
      this.timer = window.setTimeout(step, s.pause);
    };
    this.timer = window.setTimeout(step, 300);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) window.clearTimeout(this.timer);
  }
}
