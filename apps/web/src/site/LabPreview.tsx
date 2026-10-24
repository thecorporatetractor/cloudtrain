import { useEffect, useState, type CSSProperties } from 'react';

/*
 * The hero's live-looking lab: a window with the lab's topology, a terminal in
 * which a learner fixes a node that will not join, and the checks panel of the
 * validation that follows, next to the per-minute compute meter. Drawn in HTML
 * and SVG from the theme tokens (no image to load, sharp at every size, every
 * theme). Decorative: one label describes it to assistive technology.
 *
 * Two modes. `auto` (the default) plays the sequence once on its own (CSS
 * animations); with prefers-reduced-motion it shows its end state and the meter
 * stands still. `story` leaves every step to the scroll story (src/site/LabStory.tsx):
 * the markup is the finished state, so a prerendered page and a reader without
 * motion see the complete lab, and the story's scrubbed timeline drives the
 * typing, the node status and the checks from the scroll position.
 */

type Line = { k: 'cmd' | 'out' | 'ok' | 'err' | 'dim'; t: string };

const LINES: Line[] = [
  { k: 'cmd', t: 'kubectl get nodes' },
  { k: 'out', t: 'NAME       STATUS     ROLES' },
  { k: 'out', t: 'cp-1       Ready      control-plane' },
  { k: 'err', t: 'worker-1   NotReady   <none>' },
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

const CHECKS: { t: string; pass: boolean }[] = [
  { t: 'worker-1 is Ready', pass: true },
  { t: 'kubelet is active and enabled', pass: true },
  { t: 'Workloads schedule on worker-1', pass: true },
  { t: 'Swap stays off after a reboot', pass: false },
];

/** Seconds into the sequence at which line `i` appears. */
const lineAt = (i: number) => 0.5 + i * 0.42;
const FIXED_AT = lineAt(8);
const CHECKS_AT = lineAt(LINES.length) + 0.2;

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

const at = (seconds: number) => ({ '--at': `${seconds}s` }) as CSSProperties;

/** How many terminal lines the story types before the checks (the last `.lab-preview-line` is the resting prompt). */
export const STORY_LINE_COUNT = LINES.length;
export const STORY_PASSED = CHECKS.filter((c) => c.pass).length;
export const PROMPT = 'lena@workstation:~$ ';
/** What the terminal shows while the environment comes up (story mode): the lab is provisioned, the nodes join. */
export const BOOT: readonly string[] = ['provisioning node-will-not-join: kubeadm, 3 nodes, warm pool', 'cp-1 ready · worker-2 ready · worker-1 joined', 'session started · metered per minute'];

export function LabPreview({ tierLabel = 'VM lab', mode = 'auto' }: { tierLabel?: string; mode?: 'auto' | 'story' }) {
  const reduced = useReducedMotion();
  const clock = useClock(!reduced);
  const passed = CHECKS.filter((c) => c.pass).length;
  const story = mode === 'story';
  return (
    <div
      className={story ? 'lab-preview lab-preview-story' : 'lab-preview'}
      role="img"
      aria-label="A lab session in progress: a terminal in which the learner finds that swap stops the kubelet on worker-1, turns it off and validates. Three of four checks pass; the open one asks for swap to stay off after a reboot. The session is metered per minute."
    >
      <div className="lab-preview-bar" aria-hidden>
        <span className="lab-preview-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lab-preview-title">
          <span className="lab-preview-lab">node-will-not-join</span>
          <span className="lab-preview-sep">·</span> kubeadm · 3 nodes
        </span>
        <span className="lab-preview-meter">
          <span className="lab-preview-live" />
          <span className="tnum">{clock}</span>
          <span className="lab-preview-tier">{tierLabel}</span>
        </span>
      </div>

      <div className="lab-preview-topo" aria-hidden>
        <svg viewBox="0 0 520 64" preserveAspectRatio="xMidYMid meet">
          <g className="lab-preview-links">
            <path d="M92 32 H196" />
            <path d="M268 32 C300 32 300 16 336 16 H372" />
            <path d="M268 32 C300 32 300 48 336 48 H372" />
          </g>
          <g className="lab-preview-packets">
            <circle r="2.5" style={{ offsetPath: "path('M92 32 H196')" }} />
            <circle
              r="2.5"
              style={{
                offsetPath: "path('M268 32 C300 32 300 16 336 16 H372')",
                animationDelay: '0.9s',
              }}
            />
            <circle
              r="2.5"
              style={{
                offsetPath: "path('M268 32 C300 32 300 48 336 48 H372')",
                animationDelay: '1.6s',
              }}
            />
          </g>
          <Node x={8} y={18} w={84} label="workstation" />
          <Node x={196} y={18} w={72} label="cp-1" />
          <Node x={372} y={2} w={84} label="worker-1" fixAt={story ? undefined : FIXED_AT} />
          <Node x={372} y={34} w={84} label="worker-2" />
        </svg>
      </div>

      <div className="lab-preview-term" aria-hidden>
        <div className="lab-preview-lines">
          {story &&
            BOOT.map((t) => (
              <div key={t} className="lab-preview-line is-dim lab-preview-boot">
                {t}
              </div>
            ))}
          {story && (
            // The empty prompt the story starts on, before the first command is typed.
            <div className="lab-preview-line is-cmd lab-preview-idle">
              <span className="lab-preview-prompt">{PROMPT}</span>
              <span className="lab-preview-cursor" />
            </div>
          )}
          {LINES.map((l, i) => (
            <div key={i} className={`lab-preview-line is-${l.k}`} style={story ? undefined : at(lineAt(i))} data-chars={(l.k === 'cmd' ? PROMPT.length : 0) + l.t.length}>
              {l.k === 'cmd' && <span className="lab-preview-prompt">{PROMPT}</span>}
              {l.t}
            </div>
          ))}
          <div className="lab-preview-line is-cmd lab-preview-rest" style={story ? undefined : at(CHECKS_AT + 1.4)}>
            <span className="lab-preview-prompt">{PROMPT}</span>
            <span className="lab-preview-cursor" />
          </div>
        </div>
      </div>

      <div className="lab-preview-checks" aria-hidden style={story ? undefined : at(CHECKS_AT)}>
        <div className="lab-preview-checks-head">
          <span>Checks</span>
          <span className="tnum">
            <span className="lab-preview-passed">{passed}</span> / {CHECKS.length} passed
          </span>
        </div>
        <ul>
          {CHECKS.map((c, i) => (
            <li key={c.t} className={c.pass ? 'is-pass' : 'is-open'} style={story ? undefined : at(CHECKS_AT + 0.15 * (i + 1))}>
              <span className="lab-preview-check-icon">{c.pass ? '✓' : '○'}</span>
              {c.t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Node({ x, y, w, label, fixAt }: { x: number; y: number; w: number; label: string; fixAt?: number }) {
  const broken = label === 'worker-1';
  return (
    <g className="lab-preview-node" data-node={label} transform={`translate(${x} ${y})`}>
      <rect width={w} height={28} rx={7} />
      <circle cx={13} cy={14} r={3.5} className={broken && fixAt !== undefined ? 'lab-preview-status is-fixing' : 'lab-preview-status'} style={fixAt !== undefined ? ({ animationDuration: `${fixAt}s` } as CSSProperties) : undefined} />
      <text x={23} y={18.5}>
        {label}
      </text>
    </g>
  );
}
