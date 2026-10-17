import { useEffect, useState } from 'react';

/**
 * Keyset paging for the list endpoints. The gateway's cursors are opaque (the
 * `nextCursor` of the previous page), so page n can only be reached through
 * page n-1. Cursors are remembered per filter `key`; a page whose cursor is not
 * known (a reload on page 3, or new filters) falls back to page 1.
 */
export function usePageCursor(key: string, page: number) {
  const [state, setState] = useState<{ key: string; cursors: (string | undefined)[] }>({ key, cursors: [undefined] });
  const cursors = state.key === key ? state.cursors : [undefined];
  const current = page >= 1 && page <= cursors.length ? page : 1;
  return {
    /** The page actually shown (1 when the requested page's cursor is unknown). */
    page: current,
    cursor: cursors[current - 1],
    /** Call with the shown page's `nextCursor` so the next page becomes reachable. */
    useRemember(nextCursor: string | null | undefined) {
      useEffect(() => {
        if (!nextCursor || cursors[current] === nextCursor) return;
        setState({ key, cursors: [...cursors.slice(0, current), nextCursor] });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key, current, nextCursor]);
    },
  };
}
