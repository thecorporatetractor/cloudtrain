import { useSyncExternalStore } from 'react';

/** Matches the CSS breakpoint below which the sidebar becomes a drawer (styles/shell.css). */
export const COMPACT_NAV_QUERY = '(max-width: 1023px)';

/** Live `window.matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
