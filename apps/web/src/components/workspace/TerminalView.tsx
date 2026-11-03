import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import type { Lab, TopologyLink, TopologyNode, AccessKind } from '@/api/types';
import { FakeCapture, FakeShell } from '@/lib/fakeShell';
import { RemoteShell, type ShellStatus } from '@/lib/remoteShell';
import { isFocusEscape, moveFocusOutOf, useTerminalScreenReader } from '@/lib/terminalA11y';
import { useTheme } from '@/lib/theme';
import { TerminalStatusBar } from './TerminalStatus';

export type TerminalSource = { kind: 'console'; node: TopologyNode; access: AccessKind } | { kind: 'capture'; link: TopologyLink };

interface Props {
  lab: Lab;
  source: TerminalSource;
  active: boolean;
  onOpenNode?: (name: string) => void;
  /** Keys the workspace owns; xterm must not swallow them. */
  ownsKey?: (e: KeyboardEvent) => boolean;
  /** Real API mode: consoles attach to this lab session through the gateway instead of the fake shell. */
  sessionId?: string;
}

/** The whole xterm palette comes from the --term-* tokens, so every theme (including the light ones) applies to the terminal. */
export function readTerminalTheme(): ITheme {
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

/**
 * What runs behind a terminal tab. A real session never gets simulated output: the gateway
 * has no packet capture yet, so a capture tab in a real lab says so instead of inventing traffic.
 */
export type TerminalBackend = 'remote' | 'fake-shell' | 'fake-capture' | 'capture-unavailable';
export function terminalBackend(source: TerminalSource, sessionId: string | undefined): TerminalBackend {
  if (source.kind === 'console') return sessionId ? 'remote' : 'fake-shell';
  return sessionId ? 'capture-unavailable' : 'fake-capture';
}

export const CAPTURE_UNAVAILABLE = 'Packet capture is not available in live labs yet. Run tcpdump in a console on one of the link\'s nodes instead.';

/**
 * One xterm instance. Stays mounted while its tab is hidden so scrollback and the fake shell survive.
 */
export function TerminalView({ lab, source, active, onOpenNode, ownsKey, sessionId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { theme } = useTheme();
  const openNodeRef = useRef(onOpenNode);
  openNodeRef.current = onOpenNode;
  const ownsKeyRef = useRef(ownsKey);
  ownsKeyRef.current = ownsKey;
  const shellRef = useRef<RemoteShell | null>(null);
  const [status, setStatus] = useState<ShellStatus | null>(null);
  const [screenReader] = useTerminalScreenReader();
  const backend = terminalBackend(source, sessionId);

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
      theme: readTerminalTheme(),
      screenReaderMode: screenReader,
      // A real PTY already sends CRLF; the fake shell writes bare LF.
      convertEol: backend !== 'remote',
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.attachCustomKeyEventHandler((e) => {
      if (isFocusEscape(e)) {
        e.preventDefault();
        moveFocusOutOf(el, e.shiftKey ? -1 : 1);
        return false;
      }
      return !(ownsKeyRef.current?.(e) ?? false);
    });
    termRef.current = term;
    fitRef.current = fit;

    let session: { start(): void; dispose(): void };
    if (backend === 'remote' && source.kind === 'console' && sessionId) {
      const entry = lab.spec.topology.entry ?? lab.spec.topology.nodes[0]?.name;
      const remote = new RemoteShell(term, { sessionId, node: source.node.name, entry: source.node.name === entry, onStatus: setStatus });
      shellRef.current = remote;
      session = remote;
    } else if (source.kind === 'console') {
      session = new FakeShell(term, { lab, node: source.node, access: source.access, onOpenNode: (n) => openNodeRef.current?.(n) });
    } else if (backend === 'fake-capture') {
      session = new FakeCapture(term, source.link);
    } else {
      session = { start: () => term.write(`\x1b[2m${CAPTURE_UNAVAILABLE}\x1b[0m\r\n`), dispose: () => undefined };
      term.options.disableStdin = true;
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
      shellRef.current = null;
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
      term.options.theme = readTerminalTheme();
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.screenReaderMode = screenReader;
  }, [screenReader]);

  useEffect(() => {
    if (active) {
      const id = requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        // Keep focus in the tab strip while the user is arrowing through tabs.
        if (!document.activeElement?.closest('.tabstrip')) termRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

  const label = source.kind === 'console' ? `${source.node.name} ${source.access} console` : `Capture on ${source.link.a} ↔ ${source.link.b}`;
  return (
    <div className="term-wrap" style={{ display: active ? 'flex' : 'none' }}>
      <div ref={ref} className="term" aria-label={`${label}. Press F6 to move focus out of the terminal.`} />
      {status && source.kind === 'console' && <TerminalStatusBar status={status} node={source.node.name} onReconnect={() => shellRef.current?.reconnect()} />}
    </div>
  );
}
