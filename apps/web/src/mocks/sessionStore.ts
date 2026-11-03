import type { LabSession, QuestionsView } from '@/api/types';
import { liveSession } from '@/lib/liveSession';
import { inProgress, labById } from './fixtures/labs';

/** Mock lab sessions (in memory, reset on reload), shared by the lab and event handlers. */
export const sessions = new Map<string, LabSession>();

/** Event sessions: session id -> the event context the questions panel shows. */
/** Short random id suffix (lowercase hex). */
export const randomSuffix = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);

export const sessionEvents = new Map<string, NonNullable<QuestionsView['event']>>();

/** Mock: a new session; `startedAt` (a session already running at load) brings every node up at once. */
export function newSession(labId: string, startedAt?: Date): LabSession {
  const lab = labById.get(labId);
  if (!lab) throw new Error('unknown lab');
  const id = `sess-${labId}-${randomSuffix(6)}`;
  const session: LabSession = {
    id,
    labId,
    startedAt: (startedAt ?? new Date()).toISOString(),
    deadlineMinutes: lab.metadata.estimatedMinutes * 2,
    nodes: lab.spec.topology.nodes.map((n, i) => ({ name: n.name, status: i === 0 || startedAt ? 'ready' : 'provisioning', ip: `10.${40 + i}.0.${10 + i}` })),
    results: lab.spec.checks.map((c) => ({ checkId: c.id, status: 'pending' })),
    revealedHints: [],
    score: 0,
    validations: 0,
    status: 'running',
  };
  sessions.set(id, session);
  // nodes come up over a few seconds
  session.nodes.forEach((n, i) => {
    if (n.status === 'provisioning') setTimeout(() => (n.status = 'ready'), 1500 + i * 1400);
  });
  return session;
}


/** When the mock loaded: the simulated notices of a seeded session (mockNotices) run from here, as for a session started on this page. */
export const seededAt = new Date().toISOString();

/** Sessions running at load: one per lab the demo learner has in progress, so its page offers Resume. */
export const seededSessionIds = new Set(
  [...inProgress].filter((id) => labById.has(id)).map((id, i) => newSession(id, new Date(Date.now() - (25 + i * 10) * 60_000)).id),
);

/**
 * The lab's running session to reattach to, as the gateway's POST does
 * (sessions.live()); `includeSeeded: false` for a learner who started nothing.
 */
export function liveSessionOf(labId: string, includeSeeded = true): LabSession | undefined {
  return liveSession([...sessions.values()].filter((s) => s.labId === labId && (includeSeeded || !seededSessionIds.has(s.id))));
}
