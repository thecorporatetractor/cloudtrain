import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface ShortcutEntry {
  keys: string;
  description: string;
}
export interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

interface ShellState {
  /** Left navigation: full width, icon rail, or hidden (fullscreen terminal). */
  navMode: 'full' | 'rail' | 'hidden';
  setNavMode: (m: ShellState['navMode']) => void;
  /** User preference when not in a workspace. */
  navCollapsed: boolean;
  toggleNavCollapsed: () => void;
  chromeless: boolean;
  setChromeless: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
  /** Screen-specific shortcut groups shown in the cheatsheet. */
  extraShortcuts: ShortcutGroup[];
  setExtraShortcuts: (g: ShortcutGroup[]) => void;
  toast: (t: { title: string; description?: string; tone?: 'ok' | 'warn' | 'err' | 'neutral' }) => void;
  toasts: ToastItem[];
  dismissToast: (id: number) => void;
}

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: 'ok' | 'warn' | 'err' | 'neutral';
}

const Ctx = createContext<ShellState | null>(null);

const NAV_KEY = 'ct.nav.collapsed';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NAV_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [navMode, setNavMode] = useState<ShellState['navMode']>(navCollapsed ? 'rail' : 'full');
  const [chromeless, setChromeless] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [extraShortcuts, setExtraShortcuts] = useState<ShortcutGroup[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, navCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [navCollapsed]);

  const toggleNavCollapsed = useCallback(() => {
    setNavCollapsed((c) => {
      setNavMode(c ? 'full' : 'rail');
      return !c;
    });
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<ShellState['toast']>(
    ({ title, description, tone = 'neutral' }) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, title, description, tone }]);
      window.setTimeout(() => dismissToast(id), 4200);
    },
    [dismissToast],
  );

  const value = useMemo<ShellState>(
    () => ({
      navMode,
      setNavMode,
      navCollapsed,
      toggleNavCollapsed,
      chromeless,
      setChromeless,
      paletteOpen,
      setPaletteOpen,
      shortcutsOpen,
      setShortcutsOpen,
      extraShortcuts,
      setExtraShortcuts,
      toast,
      toasts,
      dismissToast,
    }),
    [navMode, navCollapsed, toggleNavCollapsed, chromeless, paletteOpen, shortcutsOpen, extraShortcuts, toast, toasts, dismissToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): ShellState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside ShellProvider');
  return v;
}

/** Register screen-specific shortcuts for the cheatsheet while mounted. */
export function useScreenShortcuts(groups: ShortcutGroup[]) {
  const { setExtraShortcuts } = useShell();
  const key = JSON.stringify(groups);
  useEffect(() => {
    setExtraShortcuts(groups);
    return () => setExtraShortcuts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setExtraShortcuts]);
}
