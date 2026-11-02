import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * The hero's live-looking lab: a window on the lab `node-will-not-join`. At the
 * top of the page it is a cluster view: the lab's objective, the four machines as
 * cards (the workstation, the control plane, the two workers, one of them
 * NotReady) joined by their wires, and below them a terminal next to a panel of
 * what the session costs and gives. As the story scrolls (src/site/LabStory.tsx)
 * the cards shrink into the compact topology (the pills), the canvas collapses
 * onto it and the terminal takes the whole width: the story mode window, whose
 * terminal and checks the scroll story drives from there.
 *
 * Drawn in HTML and SVG from the theme tokens (no image to load, sharp at every
 * size, every theme). Decorative: one label describes it to assistive technology.
 * The markup is the complete, finished state (the cluster view, every line of the
 * session, the checks), so a prerendered page, a reader without motion and an
 * engine that never loads see the whole lab; the story only ever hides and reveals
 * what is here. Nothing comes from the API.
 *
 * Two things are measured rather than sized by hand, so they fit at every width
 * and in whatever face is loaded: the pills of the topology are as wide as their
 * label (getComputedTextLength, estimated from the character count until the SVG
 * can be measured), and the wires between the cards are drawn from the cards'
 * positions.
 */

type Line = { k: 'cmd' | 'out' | 'ok' | 'err' | 'dim'; t: string };

/**
 * The terminal, in order. The story shows them in runs (`LINE`): the hero's
 * `kubectl get nodes`, then the lab started, the diagnosis and the fix, the
 * validation. Older lines scroll off the top as the terminal fills.
 */
const LINES: Line[] = [
  { k: 'cmd', t: 'kubectl get nodes' },
  { k: 'out', t: 'NAME       STATUS     ROLES' },
  { k: 'out', t: 'cp-1       Ready      control-plane' },
  { k: 'err', t: 'worker-1   NotReady   <none>' },
  { k: 'out', t: 'worker-2   Ready      <none>' },
  { k: 'cmd', t: 'ct start node-will-not-join' },
  { k: 'dim', t: 'provisioning: kubeadm, 3 nodes, warm pool' },
  { k: 'dim', t: 'cp-1 ready · worker-2 ready · worker-1 joined' },
  { k: 'dim', t: 'session started · metered per minute' },
  { k: 'cmd', t: 'ssh worker-1 journalctl -u kubelet -n1' },
  { k: 'dim', t: 'kubelet: running with swap on is not supported' },
  {
    k: 'cmd',
    t: "ssh worker-1 'sudo swapoff -a && sudo systemctl restart kubelet'",
  },
  { k: 'cmd', t: 'kubectl get nodes worker-1' },
  { k: 'ok', t: 'worker-1   Ready      <none>' },
  { k: 'cmd', t: 'ct validate' },
];

/** Where each run of the story starts in LINES (and the line that ends it). */
export const LINE = { hero: 0, heroEnd: 4, start: 5, startEnd: 8, work: 9, workEnd: 13, validate: 14 } as const;
export const LINE_COUNT = LINES.length;

const CHECKS: { t: string; pass: boolean }[] = [
  { t: 'worker-1 is Ready', pass: true },
  { t: 'kubelet is active and enabled', pass: true },
  { t: 'Workloads schedule on worker-1', pass: true },
  { t: 'Swap stays off after a reboot', pass: false },
];
export const STORY_PASSED = CHECKS.filter((c) => c.pass).length;
export const PROMPT = 'lena@workstation:~$ ';

type NodeName = 'workstation' | 'cp-1' | 'worker-1' | 'worker-2';
const NODES: NodeName[] = ['workstation', 'cp-1', 'worker-1', 'worker-2'];

/** The cards of the cluster view. `state` is the card's resting state (the lab's premise: worker-1 is down). */
const CARDS: { node: NodeName; badge?: string; tab?: string; lines: [string, string]; state?: 'down' }[] = [
  { node: 'workstation', lines: ['lena@workstation', 'kubectl · ssh · k9s'] },
  { node: 'cp-1', badge: 'control-plane', lines: ['Ready · 10.0.0.10', 'etcd ok · api 6443'] },
  { node: 'worker-1', tab: 'NotReady · 4m', lines: ['kubelet: inactive (dead)', 'cni: not initialized'], state: 'down' },
  { node: 'worker-2', lines: ['Ready · 10.0.0.12', '12 pods · 0 pending'] },
];
const WIRES: [NodeName, NodeName][] = [
  ['workstation', 'cp-1'],
  ['cp-1', 'worker-1'],
  ['cp-1', 'worker-2'],
];
const FACTS: { k: string; v: string; ok?: boolean }[] = [
  { k: 'warm pool', v: 'booted in 9s' },
  { k: 'billing', v: 'per minute' },
  { k: 'hints', v: '3 remaining' },
  { k: 'on success', v: 'tier II unlocked', ok: true },
];
export const OBJECTIVE = 'get worker-1 to Ready without recreating it';

/* ------------------------------------------------------------- topology */

const TOPO_W = 520;
const PILL = { h: 28, textX: 23, padRight: 11, charW: 6.6, rowY: { single: 18, top: 2, bottom: 34 } } as const;

/** The pills' layout from their label widths (SVG user units): x, width and the wires between them. */
function topoLayout(lens: Partial<Record<NodeName, number>>) {
  const w = (n: NodeName) => Math.ceil(PILL.textX + (lens[n] ?? n.length * PILL.charW) + PILL.padRight);
  const ws = { x: 8, w: w('workstation') };
  const cp = { w: w('cp-1') };
  const wk = { w: Math.max(w('worker-1'), w('worker-2')) };
  const gap = Math.max(40, (TOPO_W - 16 - ws.w - cp.w - wk.w) / 2);
  const cpX = ws.x + ws.w + gap;
  const wkX = Math.round(cpX + cp.w + gap);
  const a = Math.round(cpX + cp.w);
  const c1 = Math.round(a + (wkX - a) * 0.3);
  const c2 = Math.round(wkX - (wkX - a) * 0.35);
  return {
    nodes: {
      workstation: { x: ws.x, y: PILL.rowY.single, w: ws.w },
      'cp-1': { x: Math.round(cpX), y: PILL.rowY.single, w: cp.w },
      'worker-1': { x: wkX, y: PILL.rowY.top, w: wk.w },
      'worker-2': { x: wkX, y: PILL.rowY.bottom, w: wk.w },
    } as Record<NodeName, { x: number; y: number; w: number }>,
    paths: [`M${ws.x + ws.w} 32 H${Math.round(cpX)}`, `M${a} 32 C${c1} 32 ${c1} 16 ${c2} 16 H${wkX}`, `M${a} 32 C${c1} 32 ${c1} 48 ${c2} 48 H${wkX}`],
  };
}

/** The label lengths of the pills, measured from the SVG (zero when it cannot be measured yet). */
function usePillLengths(svg: React.RefObject<SVGSVGElement | null>) {
  const [lens, setLens] = useState<Partial<Record<NodeName, number>>>({});
  useLayoutEffect(() => {
    let dead = false;
    const measure = () => {
      if (dead || !svg.current) return;
      const next: Partial<Record<NodeName, number>> = {};
      for (const el of svg.current.querySelectorAll<SVGTextElement>('.lab-preview-node text')) {
        const n = el.parentElement?.getAttribute('data-node') as NodeName | null;
        const len = el.getComputedTextLength();
        if (n && len > 0) next[n] = len;
      }
      setLens((cur) => (NODES.some((n) => next[n] !== undefined && Math.abs((next[n] ?? 0) - (cur[n] ?? -1)) > 0.5) ? next : cur));
    };
    measure();
    document.fonts?.ready.then(measure);
    return () => {
      dead = true;
    };
  }, [svg]);
  return lens;
}

/** The wires of the cluster view: paths between the cards, from their positions (offset geometry: transforms do not move them). */
function useWires(cluster: React.RefObject<HTMLDivElement | null>) {
  const [wires, setWires] = useState<string[]>([]);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const el = cluster.current;
    if (!el) return;
    const measure = () => {
      const card = (n: NodeName) => el.querySelector<HTMLElement>(`.lab-preview-card[data-node="${n}"]`);
      const box = (c: HTMLElement) => ({ l: c.offsetLeft, t: c.offsetTop, r: c.offsetLeft + c.offsetWidth, b: c.offsetTop + c.offsetHeight, my: c.offsetTop + c.offsetHeight / 2, mx: c.offsetLeft + c.offsetWidth / 2 });
      const next = WIRES.map(([from, to]) => {
        const a = card(from);
        const b = card(to);
        if (!a || !b) return '';
        const A = box(a);
        const B = box(b);
        if (B.l >= A.r - 1) {
          // side by side: out of the right edge, into the left edge
          const m = (A.r + B.l) / 2;
          return A.my === B.my ? `M${A.r} ${A.my} H${B.l}` : `M${A.r} ${A.my} C${m} ${A.my} ${m} ${B.my} ${B.l} ${B.my}`;
        }
        // stacked (a phone): out of the bottom edge, into the top edge
        const m = (A.b + B.t) / 2;
        return `M${A.mx} ${A.b} C${A.mx} ${m} ${B.mx} ${m} ${B.mx} ${B.t}`;
      });
      setWires((cur) => (cur.length === next.length && cur.every((d, i) => d === next[i]) ? cur : next));
      setSize((cur) => (cur[0] === el.offsetWidth && cur[1] === el.offsetHeight ? cur : [el.offsetWidth, el.offsetHeight]));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [cluster]);
  return { wires, size };
}

/* ------------------------------------------------------------ component */

function useReducedMotion(): boolean {
  // Read after mount, so a prerendered page and its first render agree.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return setReduced(false);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** The session clock, from 18:42 upwards (a session already under way). */
function useClock(running: boolean): string {
  const [s, setS] = useState(18 * 60 + 42);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setS((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `00:${mm}:${ss}`;
}

export function LabPreview({ tierLabel = 'VM lab' }: { tierLabel?: string }) {
  const reduced = useReducedMotion();
  const clock = useClock(!reduced);
  const svg = useRef<SVGSVGElement>(null);
  const cluster = useRef<HTMLDivElement>(null);
  const topo = topoLayout(usePillLengths(svg));
  const { wires, size } = useWires(cluster);
  return (
    <div
      className="lab-preview lab-preview-story"
      role="img"
      aria-label="A lab session in progress: a three-node kubeadm cluster whose worker-1 is NotReady, and a terminal in which the learner finds that swap stops its kubelet, turns it off and validates. Three of four checks pass; the open one asks for swap to stay off after a reboot. The session is metered per minute."
    >
      <div className="lab-preview-bar" aria-hidden>
        <span className="lab-preview-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lab-preview-title">
          <span className="lab-preview-lab">node-will-not-join</span>
          <span className="lab-preview-title-rest">
            <span className="lab-preview-sep">·</span> kubeadm · 3 nodes · v1.31
          </span>
        </span>
        <span className="lab-preview-meter">
          <span className="lab-preview-live" />
          <span className="tnum">{clock}</span>
          <span className="lab-preview-tier">{tierLabel}</span>
        </span>
      </div>

      {/* The stage: the cluster view, and over it (hidden until the story morphs into it) the compact topology. */}
      <div className="lab-preview-stage" aria-hidden>
        <div className="lab-preview-canvas">
          <div className="lab-preview-canvas-bg" />
          <p className="lab-preview-objective">
            <span>Objective</span>
            {OBJECTIVE}
          </p>
          <div className="lab-preview-cluster" ref={cluster}>
            <svg className="lab-preview-wires" width={size[0] || undefined} height={size[1] || undefined} viewBox={size[0] ? `0 0 ${size[0]} ${size[1]}` : undefined}>
              {wires.map((d, i) => (
                <path key={i} d={d} className={WIRES[i]![1] === 'worker-1' ? 'is-down' : undefined} />
              ))}
            </svg>
            {CARDS.map((c) => (
              <div key={c.node} className="lab-preview-card" data-node={c.node} data-state={c.state ?? 'up'}>
                {c.tab && <span className="lab-preview-tab">{c.tab}</span>}
                <div className="lab-preview-card-head">
                  <i className="lab-preview-dot" />
                  <span className="lab-preview-card-name">{c.node}</span>
                  {c.badge && <span className="lab-preview-badge">{c.badge}</span>}
                </div>
                <div className="lab-preview-card-lines">
                  <span>{c.lines[0]}</span>
                  <span>{c.lines[1]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lab-preview-topo">
          <svg ref={svg} viewBox={`0 0 ${TOPO_W} 64`} preserveAspectRatio="xMidYMid meet">
            <g className="lab-preview-links">
              {topo.paths.map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
            <g className="lab-preview-packets">
              {topo.paths.map((d, i) => (
                <circle key={d} r="2.5" style={{ offsetPath: `path('${d}')`, animationDelay: `${i * 0.8}s` }} />
              ))}
            </g>
            {NODES.map((n) => (
              <Pill key={n} label={n} {...topo.nodes[n]} />
            ))}
          </svg>
        </div>
      </div>

      <div className="lab-preview-body" aria-hidden>
        <div className="lab-preview-term">
          <div className="lab-preview-lines">
            {/* The empty prompt the hero starts on, before its first command is typed. */}
            <div className="lab-preview-line is-cmd lab-preview-idle">
              <span className="lab-preview-prompt">{PROMPT}</span>
              <span className="lab-preview-cursor" />
            </div>
            {LINES.map((l, i) => (
              <div key={i} className={`lab-preview-line is-${l.k}`} data-chars={(l.k === 'cmd' ? PROMPT.length : 0) + l.t.length}>
                {l.k === 'cmd' && <span className="lab-preview-prompt">{PROMPT}</span>}
                {l.t}
              </div>
            ))}
            <div className="lab-preview-line is-cmd lab-preview-rest">
              <span className="lab-preview-prompt">{PROMPT}</span>
              <span className="lab-preview-cursor" />
            </div>
          </div>
        </div>
        <dl className="lab-preview-kv">
          {FACTS.map((f) => (
            <div key={f.k} className={f.ok ? 'is-ok' : undefined}>
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="lab-preview-checks" aria-hidden>
        <div className="lab-preview-checks-head">
          <span>Checks</span>
          <span className="tnum">
            <span className="lab-preview-passed">{STORY_PASSED}</span> / {CHECKS.length} passed
          </span>
        </div>
        <ul>
          {CHECKS.map((c) => (
            <li key={c.t} className={c.pass ? 'is-pass' : 'is-open'}>
              <span className="lab-preview-check-icon">{c.pass ? '✓' : '○'}</span>
              {c.t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Pill({ x, y, w, label }: { x: number; y: number; w: number; label: NodeName }) {
  return (
    <g className="lab-preview-node" data-node={label} transform={`translate(${x} ${y})`}>
      <rect width={w} height={PILL.h} rx={7} />
      <circle cx={13} cy={14} r={3.5} className="lab-preview-status" />
      <text x={PILL.textX} y={18.5}>
        {label}
      </text>
    </g>
  );
}
