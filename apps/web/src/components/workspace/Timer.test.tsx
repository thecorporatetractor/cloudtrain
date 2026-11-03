import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionClocks } from '@/lib/labClock';
import { Timer } from './Timer';

describe('lab timer', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetSessionClocks();
  });

  it("counts against the gateway's clock, not a skewed browser clock", () => {
    vi.useFakeTimers();
    // The browser clock runs 40 minutes fast.
    vi.setSystemTime(new Date('2026-11-04T10:50:00Z'));
    const h = renderToStaticMarkup(<Timer session={{ startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60, expiresAt: '2026-11-04T11:00:00Z', serverTime: '2026-11-04T10:10:00Z' }} onWarn={() => undefined} />);
    expect(h).toContain('Time remaining 50:00');
    expect(h).toContain('role="timer"');
    expect(h).toContain('aria-live="assertive"');
  });

  it('without serverTime (the in-browser demo) it uses the local clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:30:00Z'));
    expect(renderToStaticMarkup(<Timer session={{ startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60 }} />)).toContain('Time remaining 30:00');
  });

  it('a cached session without serverTime (after Validate or a hint) keeps the gateway offset', () => {
    vi.useFakeTimers();
    // The browser clock runs 25 minutes fast; 30 minutes are really left.
    vi.setSystemTime(new Date('2026-11-04T10:55:00Z'));
    const base = { id: 's-1', startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60, expiresAt: '2026-11-04T11:00:00Z' };
    expect(renderToStaticMarkup(<Timer session={{ ...base, serverTime: '2026-11-04T10:30:00Z' }} onWarn={() => undefined} />)).toContain('Time remaining 30:00');
    vi.setSystemTime(new Date('2026-11-04T10:55:05Z'));
    // The validate/hint response replaced the cached session: no serverTime on it.
    expect(renderToStaticMarkup(<Timer session={base} onWarn={() => undefined} />)).toContain('Time remaining 29:55');
  });
});
