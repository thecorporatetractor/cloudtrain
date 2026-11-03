import { describe, expect, it } from 'vitest';
import { inProgress } from './fixtures/labs';
import { liveSessionOf, newSession, seededSessionIds, sessions } from './sessionStore';

describe('mock sessions: Resume in the demo', () => {
  it('runs a session for every lab the demo learner has in progress, so its page offers Resume', () => {
    for (const labId of inProgress) {
      const live = liveSessionOf(labId);
      expect(live?.labId).toBe(labId);
      expect(seededSessionIds.has(live!.id)).toBe(true);
      expect(live!.nodes.every((n) => n.status === 'ready')).toBe(true);
    }
  });

  it('reattaches to the running session, hides the seeded one from a learner who started nothing, and skips event sessions', () => {
    const labId = [...inProgress][0]!;
    const seeded = liveSessionOf(labId)!;
    expect(liveSessionOf(labId, false)).toBeUndefined();
    const own = newSession(labId);
    expect(liveSessionOf(labId, false)?.id).toBe(own.id);
    const event = newSession(labId);
    event.eventId = 'ev-1';
    expect(liveSessionOf(labId)?.id).not.toBe(event.id);
    sessions.delete(own.id);
    sessions.delete(event.id);
    expect(liveSessionOf(labId)?.id).toBe(seeded.id);
  });
});
