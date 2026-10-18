import type { Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { CheckResult, LabHint, LabSession as WebSession, NodeStatus as WebNodeStatus, SessionNodeState, SessionPhase } from '@cloudtrain/api-types';
import { endStateChecks, learnerParams, revealedHint } from '../content/view.js';
import { ANNOTATION_HINTS, LABEL_LAB, type LabSession, type NodePhase } from '../kube/types.js';

const NODE_STATUS: Record<NodePhase, WebNodeStatus> = {
  Pending: 'provisioning',
  Provisioning: 'provisioning',
  Ready: 'ready',
  Hibernated: 'stopped',
  Destroyed: 'stopped',
  Failed: 'degraded',
};

export function revealedHints(ls: LabSession): number[] {
  const raw = ls.metadata.annotations?.[ANNOTATION_HINTS] ?? '';
  return raw
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
}

export function labIdOf(ls: LabSession): string | undefined {
  return ls.metadata.labels?.[LABEL_LAB];
}

/** The phase the learner sees. A session being deleted is over, whatever the controller says. */
export function phaseOf(ls: LabSession): SessionPhase {
  if (ls.metadata.deletionTimestamp) return 'expired';
  const p = ls.status?.phase;
  return p ? (p.toLowerCase() as SessionPhase) : 'pending';
}

function messageOf(ls: LabSession, phase: SessionPhase): string | undefined {
  if (ls.metadata.deletionTimestamp) return 'The session is being torn down.';
  const conds = ls.status?.conditions ?? [];
  if (phase === 'failed') {
    const failedNode = ls.status?.nodes?.find((n) => n.phase === 'Failed' && n.message);
    const cond = conds.find((c) => c.type === 'Ready' && c.status === 'False') ?? conds.find((c) => c.status === 'False' && c.message);
    return cond?.message ?? (failedNode ? `${failedNode.name}: ${failedNode.message}` : 'The lab environment failed to start.');
  }
  if (phase === 'pending' || phase === 'provisioning') {
    const waiting = conds.find((c) => c.status !== 'True' && c.message);
    return waiting?.message;
  }
  if (phase === 'expired') return 'The session expired and its environment was removed.';
  return undefined;
}

function nodesOf(ls: LabSession, lab: SourceLab): SessionNodeState[] {
  const observed = new Map((ls.status?.nodes ?? []).map((n) => [n.name, n]));
  return lab.spec.topology.nodes.map((n) => {
    const o = observed.get(n.name);
    if (!o) return { name: n.name, status: 'provisioning' };
    return {
      name: n.name,
      status: NODE_STATUS[o.phase] ?? 'provisioning',
      ...(o.details?.ip ? { ip: o.details.ip } : {}),
      ...(o.message ? { message: o.message } : {}),
    };
  });
}

/** Per-check results in the lab's check order, from the latest finished grading run. */
export function resultsOf(ls: LabSession, lab: SourceLab): CheckResult[] {
  const v = ls.status?.validation;
  const finished = v && v.phase !== 'Running';
  const byId = new Map((finished ? (v.checks ?? []) : []).map((c) => [c.id, c]));
  return endStateChecks(lab).map((c): CheckResult => {
    if (!finished) return { checkId: c.id, status: 'pending', skills: [...c.skills] };
    if (v.phase === 'Failed') return { checkId: c.id, status: 'error', skills: [...c.skills], ...(v.message ? { message: v.message } : {}) };
    const r = byId.get(c.id);
    if (!r) return { checkId: c.id, status: 'error', skills: [...c.skills], message: 'The grader returned no result for this check.' };
    return {
      checkId: c.id,
      status: r.passed ? 'pass' : 'fail',
      skills: r.skills?.length ? r.skills : [...c.skills],
      ...(r.message ? { message: r.message } : {}),
      ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}),
      // r.output is for authors (it may contain expected values); learners never get it.
    };
  });
}

function minutesBetween(a: string | undefined, b: string | undefined): number | undefined {
  if (!a || !b) return undefined;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : undefined;
}

/** LabSession (cluster) -> LabSession (web API). */
export function toWebSession(ls: LabSession, lab: SourceLab): WebSession {
  const phase = phaseOf(ls);
  const results = resultsOf(ls, lab);
  const v = ls.status?.validation;
  const complete = v?.phase === 'Complete';
  const allPassed = complete && results.length > 0 && results.every((r) => r.status === 'pass');
  // Secret params (expected answers) never reach the browser.
  const params = learnerParams(lab, ls.status?.resolvedParams);
  const revealed = revealedHints(ls);
  const hints: Record<number, LabHint> = {};
  for (const i of revealed) {
    const h = revealedHint(lab, i, params);
    if (h) hints[i] = h;
  }
  const createdAt = ls.metadata.creationTimestamp ?? new Date().toISOString();
  const expiresAt = ls.status?.expiresAt ?? ls.spec.expiresAt;
  const message = messageOf(ls, phase);
  return {
    id: ls.metadata.name,
    labId: labIdOf(ls) ?? lab.metadata.id,
    startedAt: createdAt,
    deadlineMinutes: minutesBetween(createdAt, expiresAt) ?? Math.max(30, lab.metadata.estimatedMinutes * 2),
    nodes: nodesOf(ls, lab),
    results,
    revealedHints: revealed,
    score: complete ? v.score : 0,
    validations: v?.observedRequest ?? 0,
    status: phase === 'expired' ? 'expired' : phase === 'failed' ? 'failed' : allPassed ? 'passed' : 'running',
    phase,
    ...(message ? { message } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    entryNode: ls.status?.entryNode || lab.spec.topology.entry || lab.spec.topology.nodes[0].name,
    ...(params ? { params: { ...params } } : {}),
    ...(revealed.length ? { hints } : {}),
  };
}
