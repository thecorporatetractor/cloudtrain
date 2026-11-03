import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { attemptErrorPage, attemptLoadError, errorToast, loadView, sessionErrorPage, sessionLoadError } from './loadState';

describe('loadView', () => {
  it('keeps a screen with data on a failed background refetch', () => {
    expect(loadView({ data: { id: 'a' }, isError: true })).toBe('stale');
    expect(loadView({ data: { id: 'a' }, isError: false })).toBe('ready');
  });

  it('is an error page only when nothing was ever loaded', () => {
    expect(loadView({ data: undefined, isError: true })).toBe('error');
    expect(loadView({ data: undefined, isError: false })).toBe('pending');
  });
});

describe('session load errors', () => {
  it('a 403 says the session is not yours', () => {
    expect(sessionLoadError(new ApiError(403, 'Forbidden')).title).toBe('You do not have access to this lab session');
  });

  it('anything else says the session could not be loaded', () => {
    for (const e of [new ApiError(502, 'Bad gateway'), new TypeError('Failed to fetch')]) expect(sessionLoadError(e).title).toBe('Could not load your lab session');
  });
});

describe('sessionErrorPage', () => {
  it('shows the error page for a session that never loaded, except 404 (a new session starts)', () => {
    expect(sessionErrorPage('error', new ApiError(502, 'Bad gateway'))).toBe(true);
    expect(sessionErrorPage('error', new ApiError(403, 'Forbidden'))).toBe(true);
    expect(sessionErrorPage('error', new TypeError('Failed to fetch'))).toBe(true);
    expect(sessionErrorPage('error', new ApiError(404, 'Not found'))).toBe(false);
  });

  it('keeps a loaded session on screen through a failed poll, but not after access is lost (403)', () => {
    expect(sessionErrorPage('stale', new ApiError(502, 'Bad gateway'))).toBe(false);
    expect(sessionErrorPage('stale', new TypeError('Failed to fetch'))).toBe(false);
    expect(sessionErrorPage('stale', new ApiError(403, 'Forbidden'))).toBe(true);
    expect(sessionErrorPage('ready', null)).toBe(false);
    expect(sessionErrorPage('pending', null)).toBe(false);
  });
});

describe('errorToast', () => {
  it('carries the reason and a retry', () => {
    const retry = vi.fn();
    const t = errorToast('Validation did not run', new ApiError(504, 'Gateway timeout'), retry);
    expect(t).toMatchObject({ title: 'Validation did not run', description: 'Gateway timeout', tone: 'err', action: { label: 'Try again' } });
    t.action!.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('has no action without a retry', () => {
    expect(errorToast('Could not flag the task', 'offline')).toEqual({ title: 'Could not flag the task', description: 'offline', tone: 'err' });
  });
});

describe('attemptErrorPage', () => {
  it('shows the error page for an attempt that never loaded, whatever the error', () => {
    expect(attemptErrorPage('error', new ApiError(502, 'Bad gateway'))).toBe(true);
    expect(attemptErrorPage('error', new ApiError(404, 'Not found'))).toBe(true);
    expect(attemptErrorPage('error', new TypeError('Failed to fetch'))).toBe(true);
  });

  it('keeps a loaded attempt through 5xx and network errors, but not through 403 or 404', () => {
    expect(attemptErrorPage('stale', new ApiError(502, 'Bad gateway'))).toBe(false);
    expect(attemptErrorPage('stale', new TypeError('Failed to fetch'))).toBe(false);
    expect(attemptErrorPage('stale', new ApiError(403, 'Forbidden'))).toBe(true);
    expect(attemptErrorPage('stale', new ApiError(404, 'Not found'))).toBe(true);
    expect(attemptErrorPage('ready', undefined)).toBe(false);
  });

  it('says why', () => {
    expect(attemptLoadError(new ApiError(403, 'Forbidden')).title).toMatch(/do not have access/);
    expect(attemptLoadError(new ApiError(404, 'Not found')).title).toMatch(/no longer available/);
    expect(attemptLoadError(new ApiError(503, 'Unavailable')).title).toBe('Attempt unavailable');
  });
});
