import { describe, expect, it } from 'vitest';
import type { LabSession } from '@/api/types';
import { isLive, liveSession } from './liveSession';

const s = (id: string, startedAt: string, over: Partial<LabSession> = {}): LabSession => ({ id, labId: 'fix-crlf-script', startedAt, deadlineMinutes: 30, nodes: [], results: [], revealedHints: [], score: 0, validations: 0, status: 'running', phase: 'ready', ...over });

describe('resume: the live session of a lab', () => {
  it('is the newest session whose environment still runs', () => {
    const list = [s('a', '2026-11-01T10:00:00Z'), s('b', '2026-11-02T10:00:00Z'), s('c', '2026-11-03T10:00:00Z', { status: 'expired', phase: 'expired' })];
    expect(liveSession(list)?.id).toBe('b');
  });

  it('counts a session still coming up, and one whose checks all passed, as live', () => {
    expect(isLive(s('a', 'x', { phase: 'provisioning' }))).toBe(true);
    expect(isLive(s('a', 'x', { status: 'passed' }))).toBe(true);
    expect(isLive(s('a', 'x', { phase: undefined }))).toBe(true); // the mock has no phase
  });

  it('skips failed, expired and torn-down sessions, CTF event sessions and the one known to be gone', () => {
    const list = [s('failed', '2026-11-03T10:00:00Z', { status: 'failed', phase: 'failed' }), s('teardown', '2026-11-03T09:00:00Z', { phase: 'expired' }), s('event', '2026-11-03T08:00:00Z', { eventId: 'ev1' }), s('gone', '2026-11-03T07:00:00Z'), s('ok', '2026-11-01T07:00:00Z')];
    expect(liveSession(list, 'gone')?.id).toBe('ok');
    expect(liveSession([s('event', 'x', { eventId: 'ev1' })])).toBeUndefined();
    expect(liveSession(undefined)).toBeUndefined();
  });
});
