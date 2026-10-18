import type { IDisposable, Terminal } from '@xterm/xterm';
import { wsUrl } from './runtimeConfig';

/**
 * Read-only mirror of a learner's terminal for instructors:
 * xterm.js <-> WebSocket `/api/sessions/:id/terminal?observe=1` <-> gateway.
 * The gateway drops any input on an observe connection; the client never sends
 * keystrokes either (xterm runs with stdin disabled). Resize is not sent: the
 * observer sees the learner's geometry.
 */
export class ObserveShell {
  private ws: WebSocket | null = null;
  private subs: IDisposable[] = [];
  private disposed = false;

  constructor(
    private readonly term: Terminal,
    private readonly opts: { sessionId: string; onState?: (s: 'connecting' | 'live' | 'ended' | 'error', detail?: string) => void },
  ) {}

  start() {
    this.connect();
  }

  private note(text: string, tone: 'dim' | 'err' = 'dim') {
    this.term.write(`\r\n\x1b[${tone === 'err' ? '31' : '2'}m${text}\x1b[0m\r\n`);
  }

  private connect() {
    if (this.disposed) return;
    const { sessionId, onState } = this.opts;
    onState?.('connecting');
    const q = new URLSearchParams({ observe: '1', cols: String(this.term.cols), rows: String(this.term.rows) });
    const ws = new WebSocket(wsUrl(`/api/sessions/${encodeURIComponent(sessionId)}/terminal?${q}`, location));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
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
      if (f.t === 'ready') onState?.('live');
      else if (f.t === 'exit') {
        ended = true;
        this.note(`[learner's shell ended${f.code ? ` with code ${f.code}` : ''}]`);
        onState?.('ended');
      } else if (f.t === 'error') {
        ended = true;
        this.note(f.m ?? 'observe unavailable', 'err');
        onState?.('error', f.m);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (!ended && !this.disposed) {
        this.note('[connection closed; retrying in 3 s]');
        onState?.('connecting');
        window.setTimeout(() => this.connect(), 3000);
      }
    };
  }

  dispose() {
    this.disposed = true;
    this.subs.forEach((s) => s.dispose());
    this.ws?.close();
    this.ws = null;
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
