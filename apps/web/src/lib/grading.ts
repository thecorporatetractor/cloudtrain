import type { LabSession } from '@/api/types';

type SessionView = Pick<LabSession, 'validations' | 'phase' | 'results'>;

const pending = (s: SessionView) => s.results.some((r) => r.status === 'pending');

/**
 * Whether the grading run a Validate stopped waiting for (it timed out and goes
 * on in the background) has since finished in the polled session: the session
 * is not grading, has finished results, and either a newer run answered or the
 * results were still pending when Validate gave up.
 */
export function timedOutRunFinished(timedOut: SessionView, latest: SessionView): boolean {
  if (latest.phase === 'grading' || pending(latest)) return false;
  return latest.validations > timedOut.validations || pending(timedOut);
}
