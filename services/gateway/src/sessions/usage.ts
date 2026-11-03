import type { UsageEnd } from '../billing/service.js';
import type { LabSession } from '../kube/types.js';

/**
 * Ready=False reasons the orchestrator fails a session with: the lab stopped
 * for good (labsession_controller.go fail()).
 */
const FAILURE_REASONS = new Set(['NodeFailed', 'SetupFailed', 'ResetFailed', 'ProvisionTimeout', 'ProvisionDeadline', 'ParamResolutionFailed', 'PooledSessionLost']);

/**
 * When a lab session stopped being ready for good, if it did: it failed
 * (phase Failed, or Ready False with a failure reason, also while it is being
 * deleted), or it expired after it had stopped being ready. Expiry overwrites
 * the Ready reason but keeps its transition time (the status stays False), so
 * a lab that was not ready before its expiry (and was not hibernated) is
 * recognised by Ready going False before Expired went True. Ready False
 * reasons that leave the lab running (NamespaceNotLab: the namespace lost its
 * lab label) never cap the window: before expiry they are not failures, and
 * at expiry the orchestrator stamps the Ready transition with the expiry
 * (labsession_controller.go expire()).
 */
export function stoppedAt(ls: LabSession): number | undefined {
  const conds = ls.status?.conditions ?? [];
  const ready = conds.find((c) => c.type === 'Ready' && c.status === 'False');
  const t = Date.parse(ready?.lastTransitionTime ?? '');
  if (!ready || Number.isNaN(t)) return undefined;
  if ((ls.status?.phase ?? '').toLowerCase() === 'failed' || FAILURE_REASONS.has(ready.reason ?? '')) return t;
  const expired = conds.find((c) => c.type === 'Expired' && c.status === 'True');
  const expiredAt = Date.parse(expired?.lastTransitionTime ?? '');
  const hibernated = !!ls.spec.hibernate || conds.some((c) => c.type === 'Hibernated' && c.status === 'True');
  if (ready.reason === 'Expired' && !Number.isNaN(expiredAt) && t < expiredAt && !hibernated) return t;
  return undefined;
}

/**
 * The metered window of a lab session that ends now (or ended): it ends no
 * later than the session's expiry, and for a failed session when it stopped
 * being ready (whatever its phase now: expired or being deleted); it is billed
 * from the first Ready (status.readyAt), and not at all when the lab never
 * became ready (docs/billing.md).
 */
export function usageEnd(ls: LabSession, now: number = Date.now()): UsageEnd {
  let end = now;
  const exp = Date.parse(ls.status?.expiresAt ?? ls.spec.expiresAt ?? '');
  if (!Number.isNaN(exp)) end = Math.min(end, exp);
  const stopped = stoppedAt(ls);
  if (stopped !== undefined) end = Math.min(end, stopped);
  const readyAt = Date.parse(ls.status?.readyAt ?? '');
  return { end: new Date(end), readyAt: Number.isNaN(readyAt) ? null : new Date(readyAt) };
}
