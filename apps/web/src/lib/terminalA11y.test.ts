import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFocusEscape, nextFocusOutside, readOnlyTerminalKeys, readScreenReaderPref, writeScreenReaderPref, type Where } from './terminalA11y';

const key = (k: Partial<KeyboardEvent>) => ({ type: 'keydown', key: 'F6', ctrlKey: false, metaKey: false, altKey: false, ...k }) as KeyboardEvent;

describe('terminal focus escape', () => {
  it('is F6 or Shift+F6 on keydown only', () => {
    expect(isFocusEscape(key({}))).toBe(true);
    expect(isFocusEscape(key({ shiftKey: true }))).toBe(true);
    expect(isFocusEscape(key({ type: 'keyup' }))).toBe(false);
    expect(isFocusEscape(key({ ctrlKey: true }))).toBe(false);
    expect(isFocusEscape(key({ altKey: true }))).toBe(false);
    expect(isFocusEscape(key({ key: 'Tab' }))).toBe(false);
  });

  it('picks the neighbour outside the terminal, wrapping around the page', () => {
    const page: [string, Where][] = [
      ['nav', 'before'],
      ['tab', 'before'],
      ['xterm-textarea', 'inside'],
      ['reconnect', 'inside'],
      ['validate', 'after'],
      ['footer', 'after'],
    ];
    const where = (t: [string, Where]) => t[1];
    expect(nextFocusOutside(page, where, 1)?.[0]).toBe('validate');
    expect(nextFocusOutside(page, where, -1)?.[0]).toBe('tab');
    expect(nextFocusOutside(page.slice(0, 4), where, 1)?.[0]).toBe('nav');
    expect(nextFocusOutside(page.slice(2), where, -1)?.[0]).toBe('footer');
    expect(nextFocusOutside(page.slice(2, 4), where, 1)).toBeUndefined();
  });
});

describe('screen-reader preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is off by default and remembered per viewer', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    vi.stubGlobal('window', { dispatchEvent: () => true });
    expect(readScreenReaderPref(storage)).toBe(false);
    writeScreenReaderPref(true, storage);
    expect(readScreenReaderPref(storage)).toBe(true);
    writeScreenReaderPref(false, storage);
    expect(readScreenReaderPref(storage)).toBe(false);
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('window', { dispatchEvent: () => true });
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readScreenReaderPref(broken)).toBe(false);
    expect(() => writeScreenReaderPref(true, broken)).not.toThrow();
  });
});

describe('read-only terminal keys (observe view)', () => {
  const ev = (k: Partial<KeyboardEvent>) => ({ type: 'keydown', key: 'F6', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), ...k }) as unknown as KeyboardEvent;
  const el = {} as HTMLElement;

  it('moves focus out on F6 / Shift+F6 and keeps the key from xterm', () => {
    const move = vi.fn();
    const handle = readOnlyTerminalKeys(el, move);
    const f6 = ev({});
    expect(handle(f6)).toBe(false);
    expect(f6.preventDefault).toHaveBeenCalled();
    expect(move).toHaveBeenLastCalledWith(el, 1);
    expect(handle(ev({ shiftKey: true }))).toBe(false);
    expect(move).toHaveBeenLastCalledWith(el, -1);
  });

  it('hands Tab and Shift+Tab back to the browser without cancelling them', () => {
    const move = vi.fn();
    const handle = readOnlyTerminalKeys(el, move);
    for (const shiftKey of [false, true]) {
      const tab = ev({ key: 'Tab', shiftKey });
      expect(handle(tab)).toBe(false);
      expect(tab.preventDefault).not.toHaveBeenCalled();
    }
    expect(move).not.toHaveBeenCalled();
  });

  it('leaves other keys (scrolling, copy) to xterm', () => {
    const handle = readOnlyTerminalKeys(el, vi.fn());
    expect(handle(ev({ key: 'PageUp' }))).toBe(true);
    expect(handle(ev({ key: 'c', ctrlKey: true }))).toBe(true);
    expect(handle(ev({ key: 'Tab', ctrlKey: true }))).toBe(true);
  });
});
