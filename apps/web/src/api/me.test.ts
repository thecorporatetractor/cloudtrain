import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, queries } from './client';

/*
 * A visitor's `/api/me` answers 401. The public website renders many components
 * that call useMe() (header button, calls to action, "Start lab" rows), and they
 * mount and unmount as pages change: none of that may refetch the 401 (no retry,
 * no retry on mount), or the browser loops on /api/me.
 */

const settled = () => new Promise((r) => setTimeout(r, 0));

describe('me query for a signed-out visitor', () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Not signed in', code: 'unauthenticated' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    // request() announces 401s on window; node has none.
    vi.stubGlobal('window', { dispatchEvent: () => true, location: { pathname: '/' } });
    fetchMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches once for any number of observers and never retries a 401', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
    const first = new QueryObserver(qc, queries.me());
    const unsubscribe = first.subscribe(() => {});
    for (let i = 0; i < 10 && first.getCurrentResult().status === 'pending'; i++) await settled();
    const result = first.getCurrentResult();
    expect(result.status).toBe('error');
    expect(result.error).toBeInstanceOf(ApiError);
    expect((result.error as ApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Components come and go on the public pages: later observers must reuse the 401.
    for (let i = 0; i < 5; i++) {
      const o = new QueryObserver(qc, queries.me());
      const off = o.subscribe(() => {});
      await settled();
      expect(o.getCurrentResult().status).toBe('error');
      off();
    }
    unsubscribe();
    const again = new QueryObserver(qc, queries.me());
    const off = again.subscribe(() => {});
    await settled();
    off();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    qc.clear();
  });

  it('declares the options the public pages rely on', () => {
    const o = queries.me();
    expect(o.retryOnMount).toBe(false);
    expect(typeof o.retry).toBe('function');
    const retry = o.retry as (count: number, err: unknown) => boolean;
    expect(retry(0, new ApiError(401, 'Not signed in', 'unauthenticated'))).toBe(false);
    expect(retry(0, new ApiError(403, 'Forbidden', 'forbidden'))).toBe(false);
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(1, new Error('network'))).toBe(false);
  });
});
