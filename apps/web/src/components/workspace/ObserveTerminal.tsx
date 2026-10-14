import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { isRealApi } from '@/api/mode';
import { FakeObserve, ObserveShell } from '@/lib/observeShell';
import { useTheme } from '@/lib/theme';
import { readTerminalTheme } from './TerminalView';

export type ObserveState = 'connecting' | 'live' | 'ended' | 'error';

/**
 * Read-only xterm mirror of a learner's session. Input is disabled at the xterm
 * level and never sent; the chrome around it says so.
 */
export function ObserveTerminal({ sessionId, learner, node, onState }: { sessionId: string; learner: string; node: string; onState: (s: ObserveState, detail?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { theme } = useTheme();
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: false,
      cursorStyle: 'underline',
      disableStdin: true,
      scrollback: 4000,
      allowProposedApi: true,
      theme: readTerminalTheme(),
      convertEol: !isRealApi,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    const session = isRealApi ? new ObserveShell(term, { sessionId, onState: (s, d) => onStateRef.current(s, d) }) : new FakeObserve(term, { learner, node, onState: (s) => onStateRef.current(s) });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const id = requestAnimationFrame(() => {
      term.options.theme = readTerminalTheme();
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);

  return <div ref={ref} className="term term-observe" aria-label={`Read-only view of ${learner}'s terminal on ${node}`} aria-readonly />;
}
