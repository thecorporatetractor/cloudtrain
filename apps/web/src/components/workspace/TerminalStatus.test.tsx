import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui';
import { ScreenReaderToggle, TerminalStatusBar, terminalStatusText } from './TerminalStatus';

const noop = () => undefined;
const bar = (status: Parameters<typeof TerminalStatusBar>[0]['status']) => renderToStaticMarkup(<TerminalStatusBar status={status} node="jumphost" onReconnect={noop} />);

describe('terminal status bar', () => {
  it('is an empty live region while the shell is attached', () => {
    expect(terminalStatusText({ state: 'open' }, 'jumphost')).toBeUndefined();
    const h = bar({ state: 'open' });
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-live="polite"');
    expect(h).not.toContain('<button');
  });

  it('says it is reconnecting, with the attempt, and offers to reconnect now', () => {
    const h = bar({ state: 'reconnecting', attempt: 3, retryInMs: 4000 });
    expect(h).toContain('Connection to jumphost lost. Reconnecting (attempt 3)');
    expect(h).toContain('Reconnect now');
  });

  it('offers Reconnect once it gave up, with the gateway reason', () => {
    const h = bar({ state: 'closed', message: 'session not found' });
    expect(h).toContain('Disconnected from jumphost: session not found.');
    expect(h).toContain('>Reconnect<');
    expect(h).toContain('term-status-down');
    expect(bar({ state: 'ended' })).toContain('The shell on jumphost has ended.');
  });

  it('has no button while the first connection is in progress', () => {
    const h = bar({ state: 'connecting' });
    expect(h).toContain('Connecting to jumphost');
    expect(h).not.toContain('<button');
  });

  it('the screen-reader toggle is a labelled toggle button, off by default', () => {
    const h = renderToStaticMarkup(
      <TooltipProvider>
        <ScreenReaderToggle />
      </TooltipProvider>,
    );
    expect(h).toContain('aria-label="Terminal screen-reader mode"');
    expect(h).toContain('aria-pressed="false"');
  });
});
