import { randomBytes, randomInt } from 'node:crypto';
import type { LabSession as WebSession, ValidateResponse } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import type { Content, ContentLab } from '../content/load.js';
import { HttpError, notFound } from '../errors.js';
import { ConflictError, type LabCluster } from '../kube/cluster.js';
import type { Compiler } from '../kube/compile.js';
import { ANNOTATION_HINTS, LABEL_LAB, LABEL_LEARNER, LABEL_MANAGED_BY, LABEL_ORG, LABS_API_VERSION, MANAGED_BY, type LabSession } from '../kube/types.js';
import { labIdOf, phaseOf, revealedHints, toWebSession } from './map.js';
import { endStateChecks } from '../content/view.js';

/**
 * Platform side effects around the session lifecycle (quotas, content
 * visibility, attempt persistence, notices). Optional: without a database the
 * gateway serves sessions alone (unit tests of the lab surface).
 */
export interface SessionHooks {
  /** Throws to refuse the start (404 hidden lab, 429 quota); may set the TTL. */
  beforeStart(p: Principal, lab: ContentLab): Promise<{ ttlMinutes?: number }>;
  started(p: Principal, lab: ContentLab, ls: LabSession): Promise<void>;
  validated(p: Principal, lab: ContentLab, ls: LabSession, res: ValidateResponse): Promise<void>;
  ended(p: Principal, sessionName: string, ls?: LabSession): Promise<void>;
  decorate(p: Principal, s: WebSession): Promise<WebSession>;
}

export interface SessionServiceOptions {
  validateTimeoutMs: number;
  /** Poll interval while waiting for status.validation. */
  pollMs?: number;
  sessionTtlMinutes?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  hooks?: SessionHooks;
}

/** Kubernetes label values: [a-z0-9A-Z._-], at most 63 characters, alphanumeric at both ends. */
export function labelValue(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 63).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '') || 'x';
}

/** Session names: "<lab id>-<6 hex>", a valid DNS-1123 label (the orchestrator derives pod names from it). */
export function sessionName(labId: string): string {
  return `${labId.slice(0, 40).replace(/-+$/, '')}-${randomBytes(3).toString('hex')}`;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lab sessions for the web app, backed by LabTemplate/LabSession objects.
 * Every method takes the caller and only ever touches sessions whose
 * spec.learner.id is that caller.
 */
export class SessionService {
  private readonly pollMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  hooks?: SessionHooks;

  constructor(
    private readonly content: Content,
    private readonly cluster: LabCluster,
    private readonly compiler: Compiler,
    private readonly opts: SessionServiceOptions,
  ) {
    this.pollMs = opts.pollMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    if (opts.hooks) this.hooks = opts.hooks;
  }

  private async view(principal: Principal, ls: LabSession, lab: ContentLab): Promise<WebSession> {
    const s = toWebSession(ls, lab.lab);
    return this.hooks ? this.hooks.decorate(principal, s) : s;
  }

  /** Any session by name (instructor/admin paths; the caller authorizes). */
  async find(id: string): Promise<{ ls: LabSession; lab: ContentLab | undefined } | null> {
    const ls = await this.cluster.getSession(id);
    if (!ls) return null;
    return { ls, lab: this.content.labs.get(labIdOf(ls) ?? '') };
  }

  /** Moves the expiry `minutes` later than the current one (or now). */
  async extend(id: string, minutes: number): Promise<LabSession> {
    const ls = await this.cluster.getSession(id);
    if (!ls) throw notFound('Session');
    const current = Date.parse(ls.status?.expiresAt ?? ls.spec.expiresAt ?? '') || this.now();
    const expiresAt = new Date(Math.max(current, this.now()) + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return this.cluster.patchSession(id, { spec: { expiresAt } });
  }

  /** Asks the orchestrator to reset every node and rerun setup (spec.resetGeneration + 1). */
  async reset(id: string): Promise<LabSession> {
    const ls = await this.cluster.getSession(id);
    if (!ls) throw notFound('Session');
    return this.cluster.patchSession(id, { spec: { resetGeneration: (ls.spec.resetGeneration ?? 0) + 1 } });
  }

  /** Deletes any session (the orchestrator's finalizer tears it down). */
  async terminate(id: string): Promise<void> {
    await this.cluster.deleteSession(id);
  }

  private lab(labId: string): ContentLab {
    const l = this.content.labs.get(labId);
    if (!l) throw notFound('Lab');
    return l;
  }

  /** The caller's session, or 404 (also for someone else's session: existence is not revealed). */
  async owned(principal: Principal, id: string): Promise<{ ls: LabSession; lab: ContentLab }> {
    const ls = await this.cluster.getSession(id);
    if (!ls || ls.spec.learner.id !== principal.sub) throw notFound('Session');
    const labId = labIdOf(ls);
    const lab = labId ? this.content.labs.get(labId) : undefined;
    if (!lab) throw new HttpError(410, `Lab ${labId ?? '(unknown)'} is no longer in the catalog`);
    return { ls, lab };
  }

  private async ensureTemplate(lab: ContentLab): Promise<string> {
    const t = await this.compiler.compile(lab.file);
    if (!(await this.cluster.getTemplate(t.metadata.name))) {
      try {
        await this.cluster.createTemplate(t);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e; // created concurrently: same name = same content
      }
    }
    return t.metadata.name;
  }

  /**
   * Starts a session. `opts` (CTF events): a fixed seed (teammates get the
   * same data and answers), extra labels, and an absolute end that caps the
   * TTL (the event's end).
   */
  async start(principal: Principal, labId: string, opts: { seed?: number; labels?: Record<string, string>; endsAt?: Date } = {}): Promise<WebSession> {
    const lab = this.lab(labId);
    const gate = this.hooks ? await this.hooks.beforeStart(principal, lab) : {};
    const ttl = gate.ttlMinutes ?? this.opts.sessionTtlMinutes;
    let expiresAt: string | undefined;
    if (opts.endsAt) {
      const cap = ttl ? Math.min(this.now() + ttl * 60_000, opts.endsAt.getTime()) : opts.endsAt.getTime();
      expiresAt = new Date(cap).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    const templateName = await this.ensureTemplate(lab);
    const ls: LabSession = {
      apiVersion: LABS_API_VERSION,
      kind: 'LabSession',
      metadata: {
        name: sessionName(labId),
        labels: {
          [LABEL_LAB]: labelValue(labId),
          [LABEL_LEARNER]: labelValue(principal.sub),
          [LABEL_ORG]: labelValue(principal.orgId),
          [LABEL_MANAGED_BY]: MANAGED_BY,
          ...(opts.labels ?? {}),
        },
      },
      spec: {
        templateRef: { name: templateName },
        learner: { id: principal.sub, org: principal.orgId },
        seed: opts.seed ?? randomInt(1, 2 ** 31 - 1),
        ...(expiresAt ? { expiresAt } : ttl ? { ttl: `${ttl}m` } : {}),
      },
    };
    const created = await this.cluster.createSession(ls);
    await this.hooks?.started(principal, lab, created);
    return toWebSession(created, lab.lab);
  }

  async get(principal: Principal, id: string): Promise<WebSession> {
    const { ls, lab } = await this.owned(principal, id);
    return this.view(principal, ls, lab);
  }

  /** The caller's sessions (newest first), optionally for one lab. */
  async list(principal: Principal, labId?: string): Promise<WebSession[]> {
    const sel = [`${LABEL_LEARNER}=${labelValue(principal.sub)}`, `${LABEL_MANAGED_BY}=${MANAGED_BY}`];
    if (labId) sel.push(`${LABEL_LAB}=${labelValue(labId)}`);
    const items = await this.cluster.listSessions(sel.join(','));
    return items
      .filter((ls) => ls.spec.learner.id === principal.sub)
      .flatMap((ls) => {
        const lab = this.content.labs.get(labIdOf(ls) ?? '');
        return lab ? [toWebSession(ls, lab.lab)] : [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async end(principal: Principal, id: string): Promise<void> {
    const { ls } = await this.owned(principal, id);
    await this.cluster.deleteSession(id);
    await this.hooks?.ended(principal, id, ls);
  }

  async revealHint(principal: Principal, id: string, index: number): Promise<WebSession> {
    const { ls, lab } = await this.owned(principal, id);
    const count = lab.lab.spec.hints?.length ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) throw notFound('Hint');
    const revealed = revealedHints(ls);
    if (!revealed.includes(index)) {
      const next = [...revealed, index].sort((a, b) => a - b).join(',');
      const patched = await this.cluster.patchSession(id, { metadata: { annotations: { [ANNOTATION_HINTS]: next } } });
      return toWebSession(patched, lab.lab);
    }
    return toWebSession(ls, lab.lab);
  }

  /**
   * Requests grading (spec.validateRequest + 1) and waits until
   * status.validation answers that request with Complete or Failed. Without
   * an answer in time it returns a `timeout` grading state and the session
   * as it is; the request stays in place and a later GET shows the result.
   */
  async validate(principal: Principal, id: string): Promise<ValidateResponse> {
    const { ls, lab } = await this.owned(principal, id);
    const phase = phaseOf(ls);
    if (phase !== 'ready' && phase !== 'grading') {
      throw new HttpError(409, phase === 'failed' || phase === 'expired' ? 'This lab session has ended.' : 'The lab environment is not ready yet.');
    }
    const request = (ls.spec.validateRequest ?? 0) + 1;
    let current = await this.cluster.patchSession(id, { spec: { validateRequest: request } });
    const deadline = this.now() + this.opts.validateTimeoutMs;
    const answered = (s: LabSession) => {
      const v = s.status?.validation;
      return !!v && v.observedRequest >= request && v.phase !== 'Running';
    };
    while (!answered(current) && this.now() < deadline) {
      await this.sleep(this.pollMs);
      const next = await this.cluster.getSession(id);
      if (!next) throw notFound('Session');
      current = next;
    }
    const session = toWebSession(current, lab.lab);
    const total = endStateChecks(lab.lab).length;
    const passed = session.results.filter((r) => r.status === 'pass').length;
    const skillsTouched = Array.from(new Set(session.results.flatMap((r) => r.skills ?? [])));
    const summary = { passed, total, score: session.score, skillsTouched };
    if (!answered(current)) {
      const secs = Math.round(this.opts.validateTimeoutMs / 1000);
      return {
        session,
        summary: { ...summary, passed: 0, score: 0, skillsTouched: [] },
        grading: { state: 'timeout', message: `No grader answered within ${secs}s. Your work is untouched; try Validate again later.` },
      };
    }
    const v = current.status!.validation!;
    if (v.phase === 'Failed') {
      return { session, summary: { ...summary, skillsTouched: [] }, grading: { state: 'failed', message: v.message || 'Grading failed before any check ran.' } };
    }
    const res: ValidateResponse = { session, summary, grading: { state: 'complete' } };
    await this.hooks?.validated(principal, lab, current, res);
    return res;
  }
}
