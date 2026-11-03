import { useSyncExternalStore } from 'react';

/*
 * Terminal accessibility (WCAG 2.1.1 / 2.1.2):
 * - A terminal takes every key, Tab included, so keyboard users need a way out: F6 moves
 *   focus to the next focusable control after the terminal and Shift+F6 to the one before
 *   (F6 is the usual "next pane" key; Readline and most shells leave it unbound).
 * - xterm's screen-reader mode exposes the output as an accessible live region. It costs
 *   some rendering speed, so it is a per-viewer preference, off by default.
 */

export const FOCUS_ESCAPE_KEYS = 'f6';

export function isFocusEscape(e: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return e.type === 'keydown' && e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export type Where = 'before' | 'inside' | 'after';

/** The first item after the container (dir 1), or the last one before it (dir -1); wraps around the page. */
export function nextFocusOutside<T>(items: T[], where: (t: T) => Where, dir: 1 | -1): T | undefined {
  const before = items.filter((t) => where(t) === 'before');
  const after = items.filter((t) => where(t) === 'after');
  return dir === 1 ? (after[0] ?? before[0]) : (before[before.length - 1] ?? after[after.length - 1]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves keyboard focus out of `container` to the neighbouring focusable control. */
export function moveFocusOutOf(container: HTMLElement, dir: 1 | -1): boolean {
  const items = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  const target = nextFocusOutside(items, (el) => (container.contains(el) ? 'inside' : container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before'), dir);
  target?.focus();
  return !!target;
}

type KeyLike = Pick<KeyboardEvent, 'type' | 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'preventDefault'>;

/**
 * xterm custom key handler for a read-only terminal (the instructor's observe view). Input is
 * never sent, so nothing is lost by letting keys go: F6/Shift+F6 move focus out like in a live
 * terminal, and Tab/Shift+Tab are handed back to the browser (xterm would otherwise take Tab and
 * cancel it even with stdin disabled, trapping keyboard focus).
 */
export function readOnlyTerminalKeys(container: HTMLElement, move: (el: HTMLElement, dir: 1 | -1) => unknown = moveFocusOutOf) {
  return (e: KeyLike): boolean => {
    if (isFocusEscape(e)) {
      e.preventDefault();
      move(container, e.shiftKey ? -1 : 1);
      return false;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) return false;
    return true;
  };
}

const PREF_KEY = 'ct.term.screenReader';
const PREF_EVENT = 'ct:term-screen-reader';

export function readScreenReaderPref(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeScreenReaderPref(on: boolean, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()) {
  try {
    storage?.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the toggle still applies to this page */
  }
  memory = on;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PREF_EVENT));
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

// Survives a storage that refuses writes (private windows) for the life of the page.
let memory: boolean | undefined;
const snapshot = () => memory ?? readScreenReaderPref();
const subscribe = (cb: () => void) => {
  window.addEventListener(PREF_EVENT, cb);
  return () => window.removeEventListener(PREF_EVENT, cb);
};

/** Screen-reader mode for every terminal on the page; the toggle applies to all of them at once. */
export function useTerminalScreenReader(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot, () => false);
  return [on, writeScreenReaderPref];
}
