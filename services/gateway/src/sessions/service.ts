import { randomBytes, randomInt } from 'node:crypto';
import type { LabSession as WebSession, ValidateResponse } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import type { Content, ContentLab } from '../content/load.js';
import { HttpError, notFound } from '../errors.js';
import { ConflictError, type LabCluster } from '../kube/cluster.js';
import type { Compiler } from '../kube/compile.js';
import { ANNOTATION_HINTS, LABEL_CTF_EVENT, LABEL_LAB, LABEL_LEARNER, LABEL_MANAGED_BY, LABEL_ORG, LABS_API_VERSION, MANAGED_BY, type LabSession } from '../kube/types.js';
import { labIdOf, phaseOf, revealedHints, toWebSession } from './map.js';
import { endStateChecks } from '../content/view.js';
import { RateLimiter } from '../routes/public.js';

/**
 * Platform side effects around the session lifecycle (quotas, content
 * visibility, attempt persistence, notices). Optional: without a database the
 * gateway serves sessions alone (unit tests of the lab surface).
 */
export interface SessionHooks {
  /** Throws to refuse the start (404 hidden lab, 429 quota); may set the TTL. */
  beforeStart(p: Principal, lab: ContentLab): Promise<{ ttlMinutes?: number }>;
  /** Throws to refuse reattaching to a running session (404 hidden lab, 409 restricted processing); no quotas: it runs already. */
  beforeResume?(p: Principal, lab: ContentLab): Promise<void>;
  /** Admits the start and reserves its slot (429, 503 when the lock is busy), before the create. */
  reserveStart?(p: Principal, kind: 'lab' | 'exam', name: string, units?: number): Promise<void>;
  /** Drops the reservation of a start whose create failed. */
  releaseStart?(orgId: string, name: string): Promise<void>;
  /** Marks the reservation's session as created. */
  confirmStart?(orgId: string, name: string): Promise<void>;
  started(p: Principal, lab: ContentLab, ls: LabSession): Promise<void>;
  /** Records a finished grading run. Idempotent per run: called from Validate and again from session reads. */
  validated(p: Principal, lab: ContentLab, ls: LabSession, res: ValidateResponse): Promise<void>;
  /** A hint was revealed (recorded at once, so a hint cannot be dodged by solving in another session). */
  hintRevealed?(p: Principal, lab: ContentLab, ls: LabSession): Promise<void>;
  ended(p: Principal, sessionName: string, ls?: LabSession): Promise<void>;
  decorate(p: Principal, s: WebSession): Promise<WebSession>;
}

/**
 * The billing gate and metering (src/billing) on every start path: lab
 * sessions and CTF event labs alike. `gate` throws to refuse (402) and
 * otherwise reserves the start (its usage row) under the session's name;
 * `metered` confirms it once the session exists, `release` when the start failed.
 */
export interface SessionBilling<D = unknown> {
  gate(p: Principal, labId: string, kind: 'lab' | 'event', sessionName: string): Promise<D>;
  metered(p: Principal, decision: D, session: WebSession): Promise<void>;
  release(p: Principal, decision: D): Promise<void>;
  /** Reattach: confirm the session's usage row if a start lost its confirmation. */
  confirm(p: Principal, sessionName: string): Promise<void>;
}

export interface SessionServiceOptions {
  validateTimeoutMs: number;
  /**
   * New grading runs a person may request per minute (joining a run in
   * flight is free). Default 6. Counted in memory per gateway replica, so
   * with N replicas behind a non-sticky balancer the effective limit is up to
   * N times this; the per-session single run in flight (spec.validateRequest
   * is only bumped when no run is pending) is what bounds grader load.
   */
  validatePerMinute?: number;
  /** Poll interval while waiting for status.validation. */
  pollMs?: number;
  sessionTtlMinutes?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  hooks?: SessionHooks;
  log?: { warn(o: object, msg: string): void };
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
  private readonly validateLimiter: RateLimiter;
  /** Grading runs already handed to hooks.validated ("<session>#<request>"), so polling reads skip the database. */
  private readonly recordedRuns = new Set<string>();
  /** One status poll per grading run ("<session>#<request>") on this replica, shared by every Validate waiting on it. */
  private readonly waits = new Map<string, Promise<LabSession>>();
  hooks?: SessionHooks;
  billing?: SessionBilling;

  constructor(
    private readonly content: Content,
    private readonly cluster: LabCluster,
    private readonly compiler: Compiler,
    private readonly opts: SessionServiceOptions,
  ) {
    this.pollMs = opts.pollMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.validateLimiter = new RateLimiter(Math.max(1, opts.validatePerMinute ?? 6), this.now);
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
    if (!ls || !this.mine(principal, ls)) throw notFound('Session');
    const labId = labIdOf(ls);
    const lab = labId ? this.content.labs.get(labId) : undefined;
    if (!lab) throw new HttpError(410, `Lab ${labId ?? '(unknown)'} is no longer in the catalog`);
    return { ls, lab };
  }

  /** The caller's session in the caller's current organisation (after switching orgs, the other org's sessions are not theirs here). */
  private mine(principal: Principal, ls: LabSession): boolean {
    return ls.spec.learner.id === principal.sub && (ls.spec.learner.org ?? '') === (principal.orgId ?? '');
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
    const name = sessionName(labId);
    const decision = await this.billing?.gate(principal, labId, opts.labels?.[LABEL_CTF_EVENT] ? 'event' : 'lab', name);
    const ttl = gate.ttlMinutes ?? this.opts.sessionTtlMinutes;
    let expiresAt: string | undefined;
    if (opts.endsAt) {
      const cap = ttl ? Math.min(this.now() + ttl * 60_000, opts.endsAt.getTime()) : opts.endsAt.getTime();
      expiresAt = new Date(cap).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    let created: LabSession;
    try {
      created = await this.create(principal, lab, labId, name, opts, expiresAt, ttl);
    } catch (e) {
      // The write may have committed although the call failed (a client timeout): then the
      // session runs and is metered. Only a start that left no session releases its reservation.
      const existing = await this.cluster.getSession(name).catch(() => null);
      if (!existing) {
        await this.billing?.release(principal, decision);
        throw e;
      }
      created = existing;
    }
    const session = toWebSession(created, lab.lab);
    // Metered before anything else can fail: the session exists from here on.
    await this.billing?.metered(principal, decision, session);
    await this.hooks?.started(principal, lab, created);
    return session;
  }

  private async create(principal: Principal, lab: ContentLab, labId: string, name: string, opts: { seed?: number; labels?: Record<string, string> }, expiresAt: string | undefined, ttl: number | undefined): Promise<LabSession> {
    const templateName = await this.ensureTemplate(lab);
    const ls: LabSession = {
      apiVersion: LABS_API_VERSION,
      kind: 'LabSession',
      metadata: {
        name,
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
    // Capacity: admitted and reserved under a short lock, created outside it.
    // A refusal (429) or a failed create throws out of create(), and start()
    // then releases the billing gate's reservation as for any failed start.
    await this.hooks?.reserveStart?.(principal, 'lab', ls.metadata.name);
    let created: LabSession;
    try {
      created = await this.cluster.createSession(ls);
    } catch (e) {
      // The write may have committed although the call failed: then the
      // session runs and keeps its slot (confirmed); otherwise it is freed.
      // When even that read fails, it may run: the reservation is kept (it lapses on its own).
      const exists = await this.cluster.getSession(ls.metadata.name).then((x) => !!x, () => true);
      if (exists) await this.hooks?.confirmStart?.(principal.orgId, ls.metadata.name).catch(() => undefined);
      else await this.hooks?.releaseStart?.(principal.orgId, ls.metadata.name).catch(() => undefined);
      throw e;
    }
    // A failure here only keeps the reservation counted until it expires.
    await this.hooks?.confirmStart?.(principal.orgId, ls.metadata.name).catch(() => undefined);
    return created;
  }

  /**
   * The caller's running session of a lab started from the lab page (not a
   * CTF event's), newest first: starting the lab again reattaches to it
   * instead of creating, and paying for, a second environment.
   */
  async live(principal: Principal, labId: string): Promise<WebSession | null> {
    const lab = this.lab(labId);
    const sel = [`${LABEL_LEARNER}=${labelValue(principal.sub)}`, `${LABEL_ORG}=${labelValue(principal.orgId)}`, `${LABEL_MANAGED_BY}=${MANAGED_BY}`, `${LABEL_LAB}=${labelValue(labId)}`].join(',');
    const running = (await this.cluster.listSessions(sel))
      .filter((ls) => this.mine(principal, ls) && labIdOf(ls) === labId && !ls.metadata.labels?.[LABEL_CTF_EVENT] && !['expired', 'failed'].includes(phaseOf(ls)))
      .sort((a, b) => (b.metadata.creationTimestamp ?? '').localeCompare(a.metadata.creationTimestamp ?? ''));
    if (!running[0]) return null;
    // Reattaching is access too: a hidden lab or restricted processing refuses it like a start (no quotas: it already runs).
    await this.hooks?.beforeResume?.(principal, lab);
    await this.billing?.confirm(principal, running[0].metadata.name);
    return this.view(principal, running[0], lab);
  }

  async get(principal: Principal, id: string): Promise<WebSession> {
    const { ls, lab } = await this.owned(principal, id);
    // A run that finished after Validate stopped waiting is recorded here (the page polls the session).
    // A database error must not break the read: the run is not memoized, so the next poll retries.
    try {
      await this.recordFinished(principal, lab, ls);
    } catch (err) {
      this.opts.log?.warn({ err, session: id }, 'recording a finished grading run failed; the next session read retries');
    }
    return this.view(principal, ls, lab);
  }

  /** Hands the session's latest finished grading run to hooks.validated once (it is idempotent too). */
  private async recordFinished(principal: Principal, lab: ContentLab, ls: LabSession, res?: ValidateResponse): Promise<void> {
    const v = ls.status?.validation;
    if (!this.hooks || !v || v.phase !== 'Complete') return;
    const key = `${ls.metadata.name}#${v.observedRequest}`;
    if (this.recordedRuns.has(key)) return;
    const session = toWebSession(ls, lab.lab);
    const response: ValidateResponse = res ?? {
      session,
      summary: {
        passed: session.results.filter((r) => r.status === 'pass').length,
        total: endStateChecks(lab.lab).length,
        score: session.score,
        skillsTouched: Array.from(new Set(session.results.flatMap((r) => r.skills ?? []))),
      },
      grading: { state: 'complete' },
    };
    await this.hooks.validated(principal, lab, ls, response);
    if (this.recordedRuns.size > 10_000) this.recordedRuns.clear();
    this.recordedRuns.add(key);
  }

  /** The caller's sessions (newest first), optionally for one lab. */
  async list(principal: Principal, labId?: string): Promise<WebSession[]> {
    const sel = [`${LABEL_LEARNER}=${labelValue(principal.sub)}`, `${LABEL_ORG}=${labelValue(principal.orgId)}`, `${LABEL_MANAGED_BY}=${MANAGED_BY}`];
    if (labId) sel.push(`${LABEL_LAB}=${labelValue(labId)}`);
    const items = await this.cluster.listSessions(sel.join(','));
    return items
      .filter((ls) => this.mine(principal, ls))
      .flatMap((ls) => {
        const lab = this.content.labs.get(labIdOf(ls) ?? '');
        return lab ? [toWebSession(ls, lab.lab)] : [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Ends (deletes) a session; returns it as it was, for metering (sessions/usage.ts). */
  async end(principal: Principal, id: string): Promise<LabSession> {
    const { ls } = await this.owned(principal, id);
    await this.cluster.deleteSession(id);
    await this.hooks?.ended(principal, id, ls);
    return ls;
  }

  async revealHint(principal: Principal, id: string, index: number): Promise<WebSession> {
    const { ls, lab } = await this.owned(principal, id);
    const count = lab.lab.spec.hints?.length ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) throw notFound('Hint');
    const revealed = revealedHints(ls);
    if (!revealed.includes(index)) {
      const next = [...revealed, index].sort((a, b) => a - b).join(',');
      // Recorded before the annotation is patched: if recording fails the
      // request fails with the hint still hidden, so a hint is never shown
      // without being counted for the person's other sessions of the lab.
      const pending: LabSession = { ...ls, metadata: { ...ls.metadata, annotations: { ...ls.metadata.annotations, [ANNOTATION_HINTS]: next } } };
      await this.hooks?.hintRevealed?.(principal, lab, pending);
      const patched = await this.cluster.patchSession(id, { metadata: { annotations: { [ANNOTATION_HINTS]: next } } });
      return toWebSession(patched, lab.lab);
    }
    // Already revealed: record it again (idempotent). Recording now comes
    // first, so this only matters for a reveal patched by an older gateway.
    await this.hooks?.hintRevealed?.(principal, lab, ls);
    return toWebSession(ls, lab.lab);
  }

  /**
   * Polls a session until `answered` (or validateTimeoutMs). Concurrent
   * Validates of the same run share one poll, so firing many of them does
   * not multiply reads of the Kubernetes API; a Validate that joins late gets
   * what is left of the shared wait.
   */
  private waitFor(id: string, request: number, start: LabSession, answered: (s: LabSession) => boolean): Promise<LabSession> {
    const key = `${id}#${request}`;
    let w = this.waits.get(key);
    if (!w) {
      const deadline = this.now() + this.opts.validateTimeoutMs;
      w = (async () => {
        let current = start;
        while (!answered(current) && this.now() < deadline) {
          await this.sleep(this.pollMs);
          const next = await this.cluster.getSession(id);
          if (!next) throw notFound('Session');
          current = next;
        }
        return current;
      })().finally(() => this.waits.delete(key));
      this.waits.set(key, w);
    }
    return w;
  }

  /**
   * Requests grading (spec.validateRequest + 1) and waits until
   * status.validation answers that request with Complete or Failed. A run
   * already in flight is joined instead of starting another one (one run per
   * session at a time; checks never run twice for a double click or a retry),
   * and new runs are rate limited per person. Without an answer in time it
   * returns a `timeout` grading state and the session as it is; the run goes
   * on, and the session read that sees it finish records it.
   */
  async validate(principal: Principal, id: string): Promise<ValidateResponse> {
    const { ls, lab } = await this.owned(principal, id);
    const phase = phaseOf(ls);
    if (phase !== 'ready' && phase !== 'grading') {
      throw new HttpError(409, phase === 'failed' || phase === 'expired' ? 'This lab session has ended.' : 'The lab environment is not ready yet.');
    }
    const pending = ls.spec.validateRequest ?? 0;
    const v0 = ls.status?.validation;
    const inFlight = pending > 0 && (!v0 || v0.observedRequest < pending || v0.phase === 'Running');
    let request = pending;
    let current = ls;
    if (!inFlight) {
      if (!this.validateLimiter.take(principal.sub)) {
        const retryAfterSeconds = this.validateLimiter.resetIn(principal.sub);
        throw new HttpError(429, `You validated several times in the last minute; try again in ${retryAfterSeconds}s.`, { code: 'rate_limited', details: { retryAfterSeconds } });
      }
      request = pending + 1;
      current = await this.cluster.patchSession(id, { spec: { validateRequest: request } });
    }
    const answered = (s: LabSession) => {
      const v = s.status?.validation;
      return !!v && v.observedRequest >= request && v.phase !== 'Running';
    };
    if (!answered(current)) current = await this.waitFor(id, request, current, answered);
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
        grading: { state: 'timeout', message: `Grading is taking longer than ${secs}s. It goes on in the background and the results appear here when it finishes; Validate again joins it.` },
      };
    }
    const v = current.status!.validation!;
    if (v.phase === 'Failed') {
      return { session, summary: { ...summary, skillsTouched: [] }, grading: { state: 'failed', message: v.message || 'Grading failed before any check ran.' } };
    }
    const res: ValidateResponse = { session, summary, grading: { state: 'complete' } };
    await this.recordFinished(principal, lab, current, res);
    return res;
  }
}
