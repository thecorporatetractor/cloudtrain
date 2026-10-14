import type { ApiError, ErrorCode, Permission } from '@cloudtrain/api-types';

/** An error with an HTTP status; the app turns it into an `ApiError` body with that status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: { code?: ErrorCode; permission?: Permission; scope?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
  }

  body(): ApiError {
    return { error: this.message, ...this.extra };
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, { code: 'not_found' });
export const badRequest = (message: string, details?: Record<string, unknown>) => new HttpError(422, message, { code: 'invalid', ...(details ? { details } : {}) });
export const conflict = (message: string) => new HttpError(409, message, { code: 'conflict' });
export const unauthenticated = (message = 'Not signed in') => new HttpError(401, message, { code: 'unauthenticated' });
