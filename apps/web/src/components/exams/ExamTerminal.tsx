import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { ExamTerminalTarget, Lab, TopologyNode } from '@/api/types';
import { isRealApi } from '@/api/mode';
import { FakeShell } from '@/lib/fakeShell';
import { RemoteShell } from '@/lib/remoteShell';
import { useTheme } from '@/lib/theme';

function readTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const blue = v('--term-blue');
  return {
    background: v('--term-bg'),
    foreground: v('--term-fg'),
    cursor: v('--term-cursor'),
    cursorAccent: v('--term-bg'),
    selectionBackground: v('--selection'),
    black: v('--term-black'),
    brightBlack: v('--term-bright-black'),
    white: v('--term-white'),
    brightWhite: v('--term-bright-white'),
    red: v('--term-red'),
    green: v('--term-green'),
    yellow: v('--term-yellow'),
    blue,
    magenta: blue,
    cyan: blue,
    brightRed: v('--term-red'),
    brightGreen: v('--term-green'),
    brightYellow: v('--term-yellow'),
    brightBlue: blue,
    brightMagenta: blue,
    brightCyan: blue,
  };
}

/** Mock mode: a topology for the in-browser fake shell (workstation + one virtual cluster per context, or the hosts). */
function fakeLab(target: ExamTerminalTarget, contexts: string[], hosts: string[]): Lab {
  const nodes: TopologyNode[] = contexts.length
    ? [{ name: target.node, driver: 'container', access: ['shell'] }, ...contexts.map((c): TopologyNode => ({ name: c, driver: 'k8s-cluster', cluster: { mode: 'virtual', context: c } }))]
    : hosts.map((h): TopologyNode => ({ name: h, driver: 'vm', access: ['ssh'] }));
  return {
    apiVersion: 'cloudtrain.dev/v3',
    kind: 'Lab',
    metadata: { id: 'exam', title: 'Exam', domain: 'kubernetes', difficulty: 'medium', estimatedMinutes: 120 },
    spec: { description: '', topology: { entry: target.node, nodes }, checks: [] },
  };
}

/**
 * One exam terminal. Real API: a WebSocket to /api/exams/attempts/:id/terminal
 * (refused by the gateway once the environment is frozen). Mock: the fake shell.
 */
export function ExamTerminal({ attemptId, target, active, contexts, hosts, closed }: { attemptId: string; target: ExamTerminalTarget; active: boolean; contexts: string[]; hosts: string[]; closed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 4000,
      theme: readTheme(),
      convertEol: !isRealApi,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    let session: { start(): void; dispose(): void };
    if (isRealApi) {
      session = new RemoteShell(term, {
        sessionId: attemptId,
        node: target.node,
        entry: target.entry,
        url: (q) => {
          q.set('target', target.id);
          return `/api/exams/attempts/${encodeURIComponent(attemptId)}/terminal?${q}`;
        },
      });
    } else {
      const lab = fakeLab(target, contexts, hosts);
      session = new FakeShell(term, { lab, node: lab.spec.topology.nodes[0]!, access: contexts.length ? 'shell' : 'ssh' });
    }
    session.start();
    disposeRef.current = () => session.dispose();
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          /* hidden */
        }
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      session.dispose();
      term.dispose();
      termRef.current = null;
    };
    // A terminal tab's target never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const id = requestAnimationFrame(() => (term.options.theme = readTheme()));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  // Time is up: the environment closed; stop input and say so.
  useEffect(() => {
    if (!closed || !termRef.current) return;
    disposeRef.current?.();
    termRef.current.write('\r\n\x1b[2m[the exam environment is closed]\x1b[0m\r\n');
    termRef.current.options.disableStdin = true;
  }, [closed]);

  return <div ref={ref} className="term" style={{ display: active ? 'block' : 'none' }} aria-label={`Terminal on ${target.node}`} />;
}
