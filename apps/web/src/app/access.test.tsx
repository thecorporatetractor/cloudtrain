import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import type { Me } from '@/api/types';
import { AccountUnavailable, accountLoadFailed } from './access';

describe('account load failure', () => {
  it('is a failed /api/me with nothing cached, other than a 401 or 403', () => {
    expect(accountLoadFailed({ isError: true, error: new ApiError(503, 'Service unavailable') })).toBe(true);
    expect(accountLoadFailed({ isError: true, error: new TypeError('Failed to fetch') })).toBe(true);
    expect(accountLoadFailed({ isError: true, error: new ApiError(401, 'Not signed in') })).toBe(false);
    // A permission refusal is not a connection problem: retrying cannot fix it.
    expect(accountLoadFailed({ isError: true, error: new ApiError(403, 'Forbidden') })).toBe(false);
    expect(accountLoadFailed({ isError: true, error: new ApiError(503, 'x'), data: { id: 'me' } as Me })).toBe(false);
    expect(accountLoadFailed({ isError: false, error: null })).toBe(false);
  });

  it('shows an error with a retry, not a forbidden page', () => {
    const h = renderToStaticMarkup(<AccountUnavailable error={new ApiError(503, 'Service unavailable')} onRetry={() => undefined} />);
    expect(h).toContain('Could not load your account');
    expect(h).toContain('Try again');
    expect(h).not.toContain('not available to you');
  });
});
