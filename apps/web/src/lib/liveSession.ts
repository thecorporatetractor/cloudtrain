import type { LabSession } from '@/api/types';

/*
 * Resume: a lab's running session is reattached to, never replaced by a new
 * one (a second environment is billed separately and starts with fresh
 * progress). Sessions of a CTF event are the event's, not the lab page's.
 */

/** Whether the session's environment still runs (or is still coming up). */
export function isLive(s: LabSession): boolean {
  return s.status !== 'expired' && s.status !== 'failed' && s.phase !== 'expired' && s.phase !== 'failed';
}

/** The newest running session of the lab started from the lab page, if any; `except`: one known to be gone. */
export function liveSession(sessions: readonly LabSession[] | undefined, except?: string): LabSession | undefined {
  return (sessions ?? [])
    .filter((s) => isLive(s) && !s.eventId && s.id !== except)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}
