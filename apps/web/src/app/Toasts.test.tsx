import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastList } from './Shell';
import { autoDismissMs } from './shell-context';

describe('toasts', () => {
  it('render an action button (e.g. Try again) when the toast has one', () => {
    const h = renderToStaticMarkup(<ToastList toasts={[{ id: 1, title: 'Validation did not run', description: 'Gateway timeout', tone: 'err', action: { label: 'Try again', onClick: () => undefined } }]} onDismiss={() => undefined} />);
    expect(h).toContain('Validation did not run');
    expect(h).toContain('Gateway timeout');
    expect(h).toContain('>Try again<');
    expect(h).toContain('aria-live="polite"');
  });

  it('render no action otherwise', () => {
    const h = renderToStaticMarkup(<ToastList toasts={[{ id: 1, title: 'Lab ended', tone: 'neutral' }]} onDismiss={() => undefined} />);
    expect(h).not.toContain('Try again');
  });

  it('stay until dismissed when they carry an action', () => {
    expect(autoDismissMs({})).toBe(4200);
    expect(autoDismissMs({ action: { label: 'Try again', onClick: () => undefined } })).toBeUndefined();
  });
});
