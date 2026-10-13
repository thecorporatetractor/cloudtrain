import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { Lab, TopologyLink, TopologyNode, AccessKind } from '@/api/types';
import { FakeCapture, FakeShell } from '@/lib/fakeShell';
import { useTheme } from '@/lib/theme';

export type TerminalSource = { kind: 'console'; node: TopologyNode; access: AccessKind } | { kind: 'capture'; link: TopologyLink };

interface Props {
  lab: Lab;
  source: TerminalSource;
  active: boolean;
  onOpenNode?: (name: string) => void;
  /** Keys the workspace owns; xterm must not swallow them. */
  ownsKey?: (e: KeyboardEvent) => boolean;
}

function readTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const fg = v('--term-fg');
  return {
    background: v('--term-bg'),
    foreground: fg,
    cursor: v('--term-cursor'),
    cursorAccent: v('--term-bg'),
    selectionBackground: v('--selection'),
    black: '#1c1f24',
    brightBlack: '#6b7280',
    white: fg,
    brightWhite: '#ffffff',
    red: v('--err'),
    green: v('--ok'),
    yellow: v('--warn'),
    blue: v('--accent'),
    magenta: v('--accent'),
    cyan: v('--accent'),
    brightRed: v('--err'),
    brightGreen: v('--ok'),
    brightYellow: v('--warn'),
    brightBlue: v('--accent'),
    brightMagenta: v('--accent'),
    brightCyan: v('--accent'),
  };
}

/**
 * One xterm instance. Stays mounted while its tab is hidden so scrollback and the fake shell survive.
 */
export function TerminalView({ lab, source, active, onOpenNode, ownsKey }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { theme } = useTheme();
  const openNodeRef = useRef(onOpenNode);
  openNodeRef.current = onOpenNode;
  const ownsKeyRef = useRef(ownsKey);
  ownsKeyRef.current = ownsKey;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 4000,
      allowProposedApi: true,
      theme: readTheme(),
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.attachCustomKeyEventHandler((e) => !(ownsKeyRef.current?.(e) ?? false));
    termRef.current = term;
    fitRef.current = fit;

    let session: { start(): void; dispose(): void };
    if (source.kind === 'console') {
      session = new FakeShell(term, { lab, node: source.node, access: source.access, onOpenNode: (n) => openNodeRef.current?.(n) });
    } else {
      session = new FakeCapture(term, source.link);
    }
    session.start();

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          /* ignore while hidden */
        }
      }
    });
    ro.observe(el);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });

    return () => {
      ro.disconnect();
      session.dispose();
      term.dispose();
      termRef.current = null;
    };
    // The source identity is stable for the lifetime of a tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // Wait a frame so the new CSS variables have applied.
    const id = requestAnimationFrame(() => {
      term.options.theme = readTheme();
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);

  useEffect(() => {
    if (active) {
      const id = requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        termRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

  return <div ref={ref} className="term" style={{ display: active ? 'block' : 'none' }} aria-label={source.kind === 'console' ? `${source.node.name} ${source.access} console` : `Capture on ${source.link.a} ↔ ${source.link.b}`} />;
}
