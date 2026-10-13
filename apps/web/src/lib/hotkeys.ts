import { useEffect, useRef } from 'react';

export interface Hotkey {
  /** e.g. "mod+k", "shift+?", "g h" (sequence), "escape", "[", "mod+shift+arrowleft" */
  keys: string;
  description: string;
  group: string;
  /** Fire even when focus is inside an input/textarea/terminal. Default false for plain keys, true for mod/alt combos. */
  global?: boolean;
  /** Never fire while a terminal has focus, because the shell owns the key there (e.g. Ctrl+K kills the line). */
  skipTerminal?: boolean;
  handler: (e: KeyboardEvent) => void;
}

const isEditable = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest('.xterm')) return true;
  return false;
};

const isTerminal = (el: Element | null): boolean => !!el?.closest('.xterm');

interface Combo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
  /** KeyboardEvent.code for the key token, when it has a stable physical code. */
  code?: string;
}

const CODE_OF: Record<string, string> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
};

function codeFor(key: string): string | undefined {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CODE_OF[key];
}

function parseCombo(s: string): Combo {
  const parts = s.toLowerCase().split('+');
  const key = parts[parts.length - 1]!;
  return { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt'), key, code: codeFor(key) };
}

function matches(e: KeyboardEvent, c: Combo): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (c.mod !== mod) return false;
  if (c.alt !== e.altKey) return false;
  const isSymbol = c.key.length === 1 && !/[a-z0-9]/.test(c.key);
  if (c.mod || c.alt) {
    // Modifier combos match the physical key. With Option held, macOS reports e.key as a
    // layout character ('∫', '∂') or 'Dead', and with Shift held e.key is the shifted symbol.
    if (!isSymbol && c.shift !== e.shiftKey) return false;
    if (c.code && e.code === c.code) return true;
    // Symbols may live on a different physical key on non-US layouts: accept the typed character too.
    return isSymbol && e.key === c.key;
  }
  const k = e.key.toLowerCase();
  // For symbol keys (?, [, ], \) ignore shift state since the symbol already encodes it.
  if (isSymbol) return k === c.key;
  if (c.shift !== e.shiftKey) return false;
  return k === c.key || (c.key === 'escape' && k === 'esc');
}

/**
 * Register hotkeys for the lifetime of the component. Supports two-key sequences ("g h").
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  const pending = useRef<{ first: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const editable = isEditable(document.activeElement);
      const terminal = editable && isTerminal(document.activeElement);
      const wasPending = pending.current;
      // Modifier-only presses never resolve or cancel a sequence.
      const isModifierOnly = ['Shift', 'Control', 'Meta', 'Alt'].includes(e.key);
      if (!isModifierOnly) pending.current = null;
      for (const hk of ref.current) {
        const parts = hk.keys.split(' ');
        const isGlobal = hk.global ?? (parts.length === 1 && (parts[0]!.includes('mod') || parts[0]!.includes('alt')));
        if (editable && !isGlobal) continue;
        if (terminal && hk.skipTerminal) continue;
        if (parts.length === 2) {
          const [a, b] = parts as [string, string];
          const p = wasPending;
          if (p && p.first === a && Date.now() - p.at < 900 && matches(e, parseCombo(b))) {
            e.preventDefault();
            hk.handler(e);
            return;
          }
          if (matches(e, parseCombo(a))) {
            pending.current = { first: a, at: Date.now() };
            return;
          }
        } else if (matches(e, parseCombo(parts[0]!))) {
          e.preventDefault();
          hk.handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function formatKeys(keys: string): string[] {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return keys.split(' ').flatMap((combo, i) => {
    const parts = combo.split('+').map((p) => {
      switch (p) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'shift':
          return '⇧';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'escape':
          return 'Esc';
        case 'enter':
          return '↵';
        case 'arrowleft':
          return '←';
        case 'arrowright':
          return '→';
        case 'arrowup':
          return '↑';
        case 'arrowdown':
          return '↓';
        case 'pageup':
          return 'PgUp';
        case 'pagedown':
          return 'PgDn';
        default:
          return p.length === 1 ? p.toUpperCase() : p;
      }
    });
    return i === 0 ? parts : ['then', ...parts];
  });
}
