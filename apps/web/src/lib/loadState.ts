import { ApiError } from '@/api/client';

/**
 * How a screen should treat a query. TanStack Query v5 keeps the last data when a background
 * refetch fails (isError with data), so only a query with nothing to show is an error page;
 * one with data stays on screen and says it is reconnecting (a deploy or a cold gateway must
 * not unmount a running lab or exam).
 */
export type LoadView = 'pending' | 'ready' | 'stale' | 'error';

export function loadView(q: { data: unknown; isError: boolean }): LoadView {
  if (q.data !== undefined) return q.isError ? 'stale' : 'ready';
  return q.isError ? 'error' : 'pending';
}

export interface ErrorCopy {
  title: string;
  description: string;
}

/** The lab session could not be loaded (anything but 404, which starts a new session). */
export function sessionLoadError(error: unknown): ErrorCopy {
  if (error instanceof ApiError && error.status === 403) {
    return { title: 'You do not have access to this lab session', description: 'It belongs to another account, or your access changed. Open the lab again from its overview page to start or resume your own session.' };
  }
  return { title: 'Could not load your lab session', description: 'The lab service did not answer. Your environment keeps running; try again in a moment.' };
}

/**
 * Whether the lab screen replaces the workspace with the session error page. A session that
 * never loaded shows it (except 404, which starts a new session). One that loaded keeps the
 * workspace through a failed poll (the connection banner), except on 403: access is gone and
 * retrying the connection will not bring it back, so it says so instead of "Lost contact".
 * (A 404 on a loaded session still starts a new one: tracked under web-2.)
 */
export function sessionErrorPage(view: LoadView, error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : undefined;
  if (view === 'error') return status !== 404;
  if (view === 'stale') return status === 403;
  return false;
}

/**
 * Whether the exam screen replaces the workspace with the attempt error page. An attempt that
 * never loaded shows it. One that loaded keeps the workspace through a failed poll (the
 * connection banner), except on 403 or 404: access is gone or the attempt was removed or
 * voided, so "reconnecting" would never resolve.
 */
export function attemptErrorPage(view: LoadView, error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : undefined;
  if (view === 'error') return true;
  if (view === 'stale') return status === 403 || status === 404;
  return false;
}

/** The exam attempt could not be loaded (or stopped loading with 403/404). */
export function attemptLoadError(error: unknown): ErrorCopy {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status === 403) {
    return { title: 'You do not have access to this attempt', description: 'It belongs to another account, or your access changed. Open the exam again from its page.' };
  }
  if (status === 404) {
    return { title: 'This attempt is no longer available', description: 'It was removed or ended by an administrator. Open the exam again from its page to see your attempts.' };
  }
  return { title: 'Attempt unavailable', description: 'The exam service did not answer. Your environment and the timer keep running; try again in a moment.' };
}

export interface ErrorToast {
  title: string;
  description?: string;
  tone: 'err';
  action?: { label: string; onClick: () => void };
}

/** A failed action as a toast: what failed, why, and a retry when one makes sense. */
export function errorToast(title: string, error: unknown, retry?: () => void): ErrorToast {
  const description = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return { title, ...(description ? { description } : {}), tone: 'err', ...(retry ? { action: { label: 'Try again', onClick: retry } } : {}) };
}
