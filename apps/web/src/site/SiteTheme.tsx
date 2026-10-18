import { useEffect, useMemo } from 'react';
import { useSite } from '@/api/public';
import type { SiteTokenMap } from '@/api/types';
import { THEMES, useTheme, type Theme } from '@/lib/theme';

const TOKEN = /^--[a-z][a-z0-9-]*$/;
const VALUE = /^[^;{}<>]*$/;

/** CSS for the configured token overrides: `all` first, then one block per theme. */
export function tokenOverridesCss(tokens: { all?: SiteTokenMap; dark?: SiteTokenMap; light?: SiteTokenMap; cream?: SiteTokenMap } | undefined): string {
  if (!tokens) return '';
  const decl = (map: SiteTokenMap | undefined) =>
    Object.entries(map ?? {})
      .filter(([k, v]) => TOKEN.test(k) && VALUE.test(v))
      .map(([k, v]) => `${k}:${v};`)
      .join('');
  const blocks: string[] = [];
  const all = decl(tokens.all);
  if (all) blocks.push(`:root{${all}}`);
  for (const t of THEMES.map((x) => x.id)) {
    const d = decl(tokens[t]);
    if (d) blocks.push(`:root[data-theme='${t}']{${d}}`);
  }
  return blocks.join('\n');
}

/**
 * Applies the site configuration to the document: design-token overrides, the
 * configured favicon, and the default theme for first-time visitors (a stored
 * choice always wins). Mounted once, under the ThemeProvider.
 */
export function SiteTheme() {
  const site = useSite().data;
  const { setTheme } = useTheme();
  const css = useMemo(() => tokenOverridesCss(site?.theme?.tokens), [site?.theme?.tokens]);

  useEffect(() => {
    const d = site?.theme?.default;
    if (!d) return;
    try {
      if (localStorage.getItem('ct.theme') === null) setTheme(d as Theme);
    } catch {
      /* ignore */
    }
  }, [site?.theme?.default, setTheme]);

  useEffect(() => {
    const href = site?.brand.favicon;
    if (!href) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previous = link.href;
    link.href = href;
    return () => {
      link.href = previous;
    };
  }, [site?.brand.favicon]);

  return css ? <style data-site-tokens>{css}</style> : null;
}
