import { HttpError } from '../errors.js';
import type { LabSession } from '../kube/types.js';
import { phaseOf } from '../sessions/map.js';

/**
 * Session capacity beyond the per-org quota (security review escape-6):
 * - perLearner: live lab sessions one learner may hold (0 = no limit), so
 *   one account cannot take the whole platform;
 * - maxActive: live sessions of the platform (0 = no limit), and
 *   examReserve of them kept for exams: a lab start is refused once
 *   maxActive - examReserve are taken, an exam start only at maxActive. The
 *   sessions namespace's ResourceQuota (count/labsessions) is the hard
 *   backstop at maxActive.
 *
 * How a start is admitted (PlatformService.reserveStart): it lists the
 * LabSessions by label before taking any lock, then, under a short
 * transaction-scoped advisory lock (CAPACITY_LOCK), counts them plus the
 * start reservations (session_reservations) not yet visible as sessions,
 * decides, and writes its own reservation. The lock is released at commit;
 * the Kubernetes create runs after it, and a failed start deletes its
 * reservation (releaseStart). Concurrent starts on every gateway replica
 * therefore see each other, and no lock is held across a cluster call.
 *
 * Billing (PR #364) gates a start before this and releases its own
 * reservation when the start throws afterwards, which includes a 429 from
 * here: the capacity check runs inside the create path its release covers.
 */
export interface CapacityConfig {
  perLearner: number;
  maxActive: number;
  examReserve: number;
}

export type StartKind = 'lab' | 'exam';

export const DEFAULT_CAPACITY: CapacityConfig = { perLearner: 3, maxActive: 0, examReserve: 0 };

/** How long an unconfirmed reservation counts on its own. */
export const RESERVATION_TTL_SECONDS: Record<StartKind, number> = { lab: 5 * 60, exam: 20 * 60 };

/** A confirmed reservation is pruned this long after its confirmation. */
export const CONFIRMED_RETENTION_SECONDS = 60;

/** The label exam environment LabSessions carry (the orchestrator's LabelExamSession). */
export const LABEL_EXAM_SESSION = 'labs.cloudtrain.dev/exam-session';

/** Teardown time allowed past the orchestrator's failed-session release before a session no longer counts. */
export const TEARDOWN_GRACE_MS = 5 * 60_000;

/**
 * The sessions that hold cluster resources: everything except sessions that
 * are over (Expired, Failed) and whose nodes are all torn down. A session
 * that is over but still holds nodes counts until its teardown finishes, at
 * most failedReleaseMs (the orchestrator's --failed-session-release, the same
 * chart value) plus TEARDOWN_GRACE_MS after it stopped being ready: past that
 * its teardown is stuck, it is reported (onStuck) and no longer holds a slot.
 * A failed session the orchestrator keeps for debugging (ResourcesReleased
 * False, reason KeptForDebugging: annotated keep-failed or a labctl verify
 * session) holds its resources on purpose and counts until it expires.
 * `now` is the database clock; failedReleaseMs 0 (the orchestrator keeps
 * failed sessions until their expiry) never treats a teardown as stuck.
 */
export function liveSessions(items: LabSession[], now = new Date(), failedReleaseMs = 5 * 60_000, onStuck?: (s: LabSession) => void): LabSession[] {
  return items.filter((s) => {
    if (!['expired', 'failed'].includes(phaseOf(s))) return true;
    const nodes = s.status?.nodes ?? [];
    if (!nodes.some((n) => n.phase !== 'Destroyed')) return false;
    const conditions = s.status?.conditions ?? [];
    if (phaseOf(s) === 'failed' && conditions.some((c) => c.type === 'ResourcesReleased' && c.status === 'False' && c.reason === 'KeptForDebugging')) return true;
    const ready = conditions.find((c) => c.type === 'Ready');
    // Written by the orchestrator's clock; never later than now (skew is reported by the caller).
    const since = Math.min(Date.parse(ready?.lastTransitionTime ?? s.metadata.creationTimestamp ?? ''), now.getTime());
    if (failedReleaseMs > 0 && Number.isFinite(since) && now.getTime() - since > failedReleaseMs + TEARDOWN_GRACE_MS) {
      onStuck?.(s);
      return false;
    }
    return true;
  });
}

export interface Reservation {
  session_name: string;
  kind: StartKind;
  org_id: string;
  user_id: string;
  /** Environments an exam reserves (1 for a lab). */
  units?: number;
  /** When its sessions were seen created (database clock); null until then. */
  confirmed_at?: Date | null;
}

/** What is taken: live sessions plus reservations not yet visible as sessions. */
export interface Occupancy {
  total: number;
  /** Every session of a learner: labs and exam environments (reserved ones included). */
  learnerSessions(user: string): number;
  /** Every session of an org, exam environments included (its concurrency quota). */
  orgSessions(org: string): number;
  /** Exam reservations whose environments are all listed now (to confirm). */
  examsSeen: Reservation[];
}

/**
 * `listedAt` is when the LIST of `live` began (database clock). A confirmed
 * reservation counts only when it was confirmed after that: the LIST may
 * have missed its sessions. One confirmed before it is in the LIST, or gone.
 * An unconfirmed exam counts the environments it reserved that are not
 * listed yet.
 */
export function occupancy(live: LabSession[], reservations: Reservation[], listedAt?: Date): Occupancy {
  const names = new Set(live.map((s) => s.metadata.name));
  const envs = new Map<string, number>();
  for (const s of live) {
    const a = s.metadata.labels?.[LABEL_EXAM_SESSION];
    if (a) envs.set(a, (envs.get(a) ?? 0) + 1);
  }
  const missedByList = (r: Reservation) => !!r.confirmed_at && (!listedAt || r.confirmed_at.getTime() >= listedAt.getTime());
  const pending = (r: Reservation): number => {
    const units = Math.max(1, r.units ?? 1);
    if (r.kind === 'lab') {
      if (names.has(r.session_name)) return 0;
      return !r.confirmed_at || missedByList(r) ? 1 : 0;
    }
    const seen = envs.get(r.session_name) ?? 0;
    if (!r.confirmed_at) return Math.max(0, units - seen);
    return seen === 0 && missedByList(r) ? units : 0;
  };
  const counted = reservations.map((r) => ({ r, n: pending(r) })).filter((x) => x.n > 0);
  const sum = (xs: { n: number }[]) => xs.reduce((a, x) => a + x.n, 0);
  return {
    total: live.length + sum(counted),
    learnerSessions: (u) => live.filter((s) => s.spec.learner.id === u).length + sum(counted.filter((x) => x.r.user_id === u)),
    orgSessions: (o) => live.filter((s) => s.spec.learner.org === o).length + sum(counted.filter((x) => x.r.org_id === o)),
    examsSeen: reservations.filter((r) => r.kind === 'exam' && !r.confirmed_at && (envs.get(r.session_name) ?? 0) >= Math.max(1, r.units ?? 1)),
  };
}

/** How far an orchestrator-written time may run ahead of the database clock before it is reported. */
export const CLOCK_SKEW_WARN_MS = 60_000;

/** The largest amount by which a session's condition time is ahead of `now` (0 if none is). */
export function clockSkewMs(items: LabSession[], now: Date): number {
  let skew = 0;
  for (const s of items) {
    for (const c of s.status?.conditions ?? []) {
      const t = Date.parse(c.lastTransitionTime ?? '');
      if (Number.isFinite(t)) skew = Math.max(skew, t - now.getTime());
    }
  }
  return skew;
}

/**
 * Throws 429 when this start, adding `units` sessions (an exam's
 * environments), would exceed a cap. The per-learner cap counts every
 * session of the learner, exam environments included, so nobody runs many
 * exams in parallel; an exam larger than the cap is admitted only when the
 * learner runs nothing else. The platform cap counts every session.
 */
export function assertCapacity(c: CapacityConfig, learner: string, occ: Occupancy, kind: StartKind = 'lab', units = 1): void {
  const need = Math.max(1, units);
  if (c.perLearner > 0) {
    const mine = occ.learnerSessions(learner);
    if (mine + need > c.perLearner && !(kind === 'exam' && mine === 0)) {
      throw new HttpError(429, `You already run ${mine} lab environments (at most ${c.perLearner}). Close one to start another.`, {
        code: 'quota_exceeded',
        details: { quota: 'sessions_per_learner', limit: c.perLearner, current: mine },
      });
    }
  }
  if (c.maxActive > 0) {
    const limit = kind === 'exam' ? c.maxActive : Math.max(0, c.maxActive - Math.max(0, c.examReserve));
    if (occ.total + need > limit) {
      throw new HttpError(429, 'The lab platform is at capacity right now. Please try again in a few minutes.', {
        code: 'quota_exceeded',
        details: { quota: 'platform_sessions', limit, current: occ.total },
      });
    }
  }
}

/**
 * Advisory lock keys. CAPACITY_LOCK is held only inside reserveStart's own
 * short transaction (no cluster call, no other lock taken while holding it).
 * The per-exam lock is taken inside the exam store's create transaction
 * (retake decision and attempt row together). PR #364's per-payer
 * 'billing-start:<org>:<payer>' lock is taken and released in its own
 * transaction before either. No transaction ever waits for a second pool
 * connection while holding one.
 */
export const CAPACITY_LOCK = 'cloudtrain-start:capacity';

/** How long a start tries for the capacity lock before it answers 503. */
export const CAPACITY_LOCK_BUDGET_MS = 5_000;

/** Starts of one gateway process that may wait for the capacity lock at once; more answer 503 at once. */
export const MAX_LOCK_WAITERS = 16;

/** The try-lock loop's backoff: doubling from the first delay up to the cap, with jitter. */
export const LOCK_BACKOFF_MS = { first: 20, cap: 400 };

/**
 * A start whose LIST is older than this when it holds the lock answers 503
 * (retry): the prune may already have dropped a confirmation that LIST
 * missed (CONFIRMED_RETENTION_SECONDS is larger).
 */
export const LIST_MAX_AGE_SECONDS = 30;

/** The retryable answer when capacity cannot be decided right now. */
export function busy(): HttpError {
  return new HttpError(503, 'The lab platform is busy starting other labs. Please try again in a moment.', { code: 'upstream', details: { retryAfterSeconds: 2 } });
}
export const examLock = (org: string, user: string, exam: string): string => `cloudtrain-start:exam:${org}:${user}:${exam}`;
