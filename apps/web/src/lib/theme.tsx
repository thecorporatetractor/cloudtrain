import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light' | 'cream';
export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'Low light, high focus' },
  { id: 'light', label: 'Light', hint: 'Neutral daylight' },
  { id: 'cream', label: 'Cream', hint: 'Warm, low contrast' },
];

const STORAGE_KEY = 'ct.theme';

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'cream') return v;
  } catch {
    /* ignore */
  }
  return 'dark';
}

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  cycle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const cycle = useCallback(() => {
    setThemeState((t) => THEMES[(THEMES.findIndex((x) => x.id === t) + 1) % THEMES.length]!.id);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, cycle }), [theme, setTheme, cycle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
