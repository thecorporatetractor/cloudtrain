// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionClocks } from '@/lib/labClock';
import { Timer } from './Timer';

/* Mounted with effects running and fake timers driving the countdown second by second. */
const START = Date.parse('2026-11-04T10:00:00Z');
type Session = Parameters<typeof Timer>[0]['session'];

let host: HTMLDivElement;
let root: Root;

function mount(session: Session, onWarn: (title: string, threshold: number) => void) {
  act(() => root.render(<Timer session={session} onWarn={onWarn} />));
}
const live = () => host.querySelector('[aria-live="assertive"]')?.textContent ?? '';
const tick = (sec: number) => act(() => void vi.advanceTimersByTime(sec * 1000));

describe('lab timer warnings (mounted)', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    resetSessionClocks();
  });

  const session = (expiresAt: number): Session => ({ id: 's-1', startedAt: new Date(START).toISOString(), deadlineMinutes: 60, expiresAt: new Date(expiresAt).toISOString() });

  it('warns once at 10 and once at 2 minutes left, and announces it', () => {
    vi.setSystemTime(START + 45 * 60_000); // 15 minutes left
    const onWarn = vi.fn();
    mount(session(START + 60 * 60_000), onWarn);
    expect(onWarn).not.toHaveBeenCalled();
    expect(live()).toBe('');

    tick(5 * 60); // 10:00 left
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn).toHaveBeenLastCalledWith('10 minutes left', 600);
    expect(live()).toMatch(/^10 minutes left in this lab/);

    tick(60); // still well above 2 minutes: no repeat
    expect(onWarn).toHaveBeenCalledTimes(1);

    tick(7 * 60); // 2:00 left
    expect(onWarn).toHaveBeenCalledTimes(2);
    expect(onWarn).toHaveBeenLastCalledWith('2 minutes left', 120);
    expect(live()).toMatch(/^2 minutes left in this lab/);

    tick(3 * 60); // past the deadline
    expect(onWarn).toHaveBeenCalledTimes(2);
  });

  it('does not warn again after a remount for the same session', () => {
    vi.setSystemTime(START + 51 * 60_000); // 9 minutes left
    const first = vi.fn();
    mount(session(START + 60 * 60_000), first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenLastCalledWith('Less than 9 minutes left', 600);

    act(() => root.unmount());
    root = createRoot(host);
    const second = vi.fn();
    mount(session(START + 60 * 60_000), second);
    tick(30);
    expect(second).not.toHaveBeenCalled();
  });

  it('an extension resets the warnings for the new deadline', () => {
    vi.setSystemTime(START + 55 * 60_000); // 5 minutes left
    const onWarn = vi.fn();
    mount(session(START + 60 * 60_000), onWarn);
    expect(onWarn).toHaveBeenCalledTimes(1);

    // Extended by 30 minutes: 35 minutes left, nothing due yet.
    mount(session(START + 90 * 60_000), onWarn);
    tick(1);
    expect(onWarn).toHaveBeenCalledTimes(1);

    tick(25 * 60); // 10:00 left on the new deadline
    expect(onWarn).toHaveBeenCalledTimes(2);
    expect(onWarn).toHaveBeenLastCalledWith('10 minutes left', 600);
  });

  it('an observer view (no onWarn) counts down without announcing', () => {
    vi.setSystemTime(START + 59 * 60_000);
    act(() => root.render(<Timer session={session(START + 60 * 60_000)} />));
    tick(5);
    expect(live()).toBe('');
    expect(host.querySelector('[role="timer"]')?.getAttribute('aria-label')).toBe('Time remaining 00:55');
  });
});
