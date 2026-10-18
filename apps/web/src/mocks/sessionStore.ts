import type { LabSession, QuestionsView } from '@/api/types';
import { labById } from './fixtures/labs';

/** Mock lab sessions (in memory, reset on reload), shared by the lab and event handlers. */
export const sessions = new Map<string, LabSession>();

/** Event sessions: session id -> the event context the questions panel shows. */
export const sessionEvents = new Map<string, NonNullable<QuestionsView['event']>>();

export function newSession(labId: string): LabSession {
  const lab = labById.get(labId);
  if (!lab) throw new Error('unknown lab');
  const id = `sess-${labId}-${Math.random().toString(36).slice(2, 8)}`;
  const session: LabSession = {
    id,
    labId,
    startedAt: new Date().toISOString(),
    deadlineMinutes: lab.metadata.estimatedMinutes * 2,
    nodes: lab.spec.topology.nodes.map((n, i) => ({ name: n.name, status: i === 0 ? 'ready' : 'provisioning', ip: `10.${40 + i}.0.${10 + i}` })),
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

