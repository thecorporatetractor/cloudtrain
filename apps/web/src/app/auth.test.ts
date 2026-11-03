import { describe, expect, it } from 'vitest';
import { waitForMe } from './auth';

describe('AuthGate while /api/me loads', () => {
  it('app pages wait for the principal through every retry', () => {
    expect(waitForMe(false, { isPending: true, failureCount: 0 })).toBe(true);
    expect(waitForMe(false, { isPending: true, failureCount: 3 })).toBe(true);
  });

  it('hybrid pages wait only for the first answer, then render while /api/me retries', () => {
    expect(waitForMe(true, { isPending: true, failureCount: 0 })).toBe(true);
    expect(waitForMe(true, { isPending: true, failureCount: 1 })).toBe(false);
    expect(waitForMe(true, { isPending: false, failureCount: 0 })).toBe(false);
  });
});
