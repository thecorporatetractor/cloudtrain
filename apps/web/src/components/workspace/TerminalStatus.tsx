import { Accessibility, Loader2, RotateCw, Unplug } from 'lucide-react';
import type { ShellStatus } from '@/lib/remoteShell';
import { useTerminalScreenReader } from '@/lib/terminalA11y';
import { Button, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';

/** What the bar under a live terminal says; undefined while the shell is attached (no bar). */
export function terminalStatusText(status: ShellStatus, node: string): string | undefined {
  switch (status.state) {
    case 'open':
      return undefined;
    case 'connecting':
      return `Connecting to ${node}…`;
    case 'reconnecting':
      return `Connection to ${node} lost. Reconnecting${status.attempt && status.attempt > 1 ? ` (attempt ${status.attempt})` : ''}…`;
    case 'closed':
      return `Disconnected from ${node}${status.message ? `: ${status.message}` : ''}.`;
    case 'ended':
      return `The shell on ${node} has ended.`;
  }
}

/**
 * Connection state of a real terminal, with a Reconnect control: shown below the terminal
 * whenever the shell is not attached. Announced politely to screen readers.
 */
export function TerminalStatusBar({ status, node, onReconnect }: { status: ShellStatus; node: string; onReconnect: () => void }) {
  const text = terminalStatusText(status, node);
  const busy = status.state === 'connecting' || status.state === 'reconnecting';
  return (
    <div className={cn('term-status', text && 'is-shown', (status.state === 'closed' || status.state === 'ended') && 'term-status-down')} role="status" aria-live="polite">
      {text && (
        <>
          {busy ? <Loader2 size={12} className="spin" aria-hidden /> : <Unplug size={12} aria-hidden />}
          <span className="truncate">{text}</span>
          {status.state !== 'connecting' && (
            <Button variant="ghost" size="sm" icon={<RotateCw size={12} />} onClick={onReconnect}>
              {busy ? 'Reconnect now' : 'Reconnect'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Toggles xterm's screen-reader mode for every terminal on the page (kept per viewer). */
export function ScreenReaderToggle({ className }: { className?: string }) {
  const [on, setOn] = useTerminalScreenReader();
  return (
    <Tooltip content={on ? 'Screen-reader mode on. F6 leaves the terminal' : 'Screen-reader mode for terminals. F6 leaves the terminal'}>
      <button className={cn('tab-action', on && 'is-active', className)} aria-pressed={on} aria-label="Terminal screen-reader mode" onClick={() => setOn(!on)}>
        <Accessibility size={13} />
      </button>
    </Tooltip>
  );
}
