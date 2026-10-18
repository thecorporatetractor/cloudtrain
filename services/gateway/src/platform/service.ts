import { sql } from 'kysely';
import type {
  Attempt,
  AttemptDetail,
  AttemptOutcome,
  AttemptQuery,
  CtfTotals,
  AssignmentItem,
  AssignmentTarget,
  HomeData,
  LabSession as WebSession,
  LearnerGoals,
  LabSummary,
  Me,
  MyAssignment,
  Page,
  Quotas,
  SessionNotice,
  SkillState,
  UpdateLearnerGoalsRequest,
  UserRef,
  ValidateResponse,
} from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { grantsOf, permissionsOf, can, authorize, legacyRole } from '../authz.js';
import type { Content, ContentLab } from '../content/load.js';
import { withTenant, type Db, type Tx } from '../db/index.js';
import type { AttemptRow, OrgSettingsJson } from '../db/schema.js';
import { HttpError, notFound } from '../errors.js';
import type { LabCluster } from '../kube/cluster.js';
import { LABEL_MANAGED_BY, LABEL_ORG, MANAGED_BY, type LabSession } from '../kube/types.js';
import type { KeycloakAdmin } from '../keycloak/admin.js';
import { readGoals, writeGoals } from '../learner/goals.js';
import { buildHome, minutesSince, practiceSeconds, skillStates, streakDays, type AttemptLite } from '../learner/home.js';
import { endAttempt, recordRun, startAttempt } from '../learner/learning.js';
import type { Mailer } from '../mail.js';
import type { SessionStore } from '../oidc/sessions.js';
import { phaseOf, revealedHints } from '../sessions/map.js';
import { labelValue, type SessionHooks } from '../sessions/service.js';
import { membershipsOf } from './identity.js';

export interface PlatformConfig {
  webUrl: string;
  publicUrl: string;
  oidcClientId: string;
  platformIdps: string[];
  devDomainVerifyBypass: boolean;
  kubeContext: string;
  namespace: string;
}

export interface PlatformDeps {
  db: Db;
  content: Content;
  cluster: LabCluster;
  mailer: Mailer;
  config: PlatformConfig;
  store?: SessionStore;
  kc?: KeycloakAdmin | null;
  now?: () => Date;
  log?: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export const DEFAULT_QUOTAS: Quotas = { maxConcurrentSessions: 20, monthlyLabHours: 500, maxSessionMinutes: 120 };
export const DEFAULT_SETTINGS = { defaultSessionMinutes: 60, allowLocalLogin: true, timezone: 'UTC' } as const;

const DAY = 86_400_000;

export const userRef = (u: { id: string; name: string; email: string; title?: string | null; avatar_url?: string | null }): UserRef => ({
  id: u.id,
  name: u.name,
  email: u.email,
  ...(u.title ? { title: u.title } : {}),
  ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}),
});

export const UNKNOWN_USER: UserRef = { id: '', name: 'Unknown', email: '' };

/** Opaque keyset cursors: base64url of a JSON tuple. */
export const encodeCursor = (v: unknown[]) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodeCursor<T extends unknown[]>(c: string | undefined): T | null {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T;
  } catch {
    throw new HttpError(422, 'Invalid cursor', { code: 'invalid' });
  }
}
export const pageLimit = (v: unknown, d = 50) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : d;
};

export interface Visibility {
  disabledPacks: Set<string>;
  disabledLabs: Set<string>;
  pinnedPaths: string[];
}

export class PlatformService implements SessionHooks {
  readonly db: Db;
  readonly content: Content;
  readonly cluster: LabCluster;
  readonly mailer: Mailer;
  readonly config: PlatformConfig;
  readonly store?: SessionStore;
  readonly kc: KeycloakAdmin | null;
  readonly now: () => Date;
  readonly log?: PlatformDeps['log'];

  constructor(d: PlatformDeps) {
    this.db = d.db;
    this.content = d.content;
    this.cluster = d.cluster;
    this.mailer = d.mailer;
    this.config = d.config;
    if (d.store) this.store = d.store;
    this.kc = d.kc ?? null;
    this.now = d.now ?? (() => new Date());
    this.log = d.log;
  }

  /** A transaction in the principal's org (RLS). */
  tx<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!p.orgId) throw new HttpError(409, 'Select an organization first.', { code: 'conflict' });
    return withTenant(this.db, { orgId: p.orgId, userId: p.sub }, fn);
  }

  /** A platform-scope transaction (every org visible). Callers must have checked `org.manage`/`capacity.read`. */
  ptx<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
    authorize(p, 'org.manage', { kind: 'platform' });
    return withTenant(this.db, { platform: true, userId: p.sub }, fn);
  }

  orgTx<T>(orgId: string, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { orgId, userId }, fn);
  }

  labTitle(id: string): string {
    return this.content.labs.get(id)?.lab.metadata.title ?? id;
  }

  /* ------------------------------------------------------------ visibility */

  async visibility(tx: Tx): Promise<Visibility> {
    const rows = await tx.selectFrom('content_visibility').selectAll().execute();
    return {
      disabledPacks: new Set(rows.filter((r) => r.kind === 'pack' && !r.enabled).map((r) => r.ref_id)),
      disabledLabs: new Set(rows.filter((r) => r.kind === 'lab' && !r.enabled).map((r) => r.ref_id)),
      pinnedPaths: rows.filter((r) => r.kind === 'path' && r.pinned).map((r) => r.ref_id),
    };
  }

  labVisible(v: Visibility, labId: string): boolean {
    const l = this.content.labs.get(labId);
    if (!l) return false;
    if (v.disabledLabs.has(labId)) return false;
    return !(l.pack && v.disabledPacks.has(l.pack));
  }

  /** The catalog as the org sees it: hidden packs/labs removed, pinned paths first, progress filled in. */
  async catalog(p: Principal) {
    return this.tx(p, async (tx) => {
      const v = await this.visibility(tx);
      const attempts = await tx.selectFrom('lab_attempts').select(['lab_id', 'outcome', 'score']).where('user_id', '=', p.sub).execute();
      const best = new Map<string, { passed: boolean; score: number }>();
      for (const a of attempts) {
        const b = best.get(a.lab_id) ?? { passed: false, score: 0 };
        best.set(a.lab_id, { passed: b.passed || a.outcome === 'passed', score: Math.max(b.score, a.score) });
      }
      const labs: LabSummary[] = this.content.summaries
        .filter((l) => this.labVisible(v, l.id))
        .map((l) => {
          const b = best.get(l.id);
          return { ...l, completion: b?.passed ? 'completed' : b ? 'in-progress' : 'new', ...(b ? { bestScore: b.score } : {}) };
        });
      const ids = new Set(labs.map((l) => l.id));
      const paths = this.content.paths
        .map((path) => {
          const labIds = path.labIds.filter((id) => ids.has(id));
          const done = labIds.filter((id) => best.get(id)?.passed).length;
          return { ...path, labIds, progress: labIds.length ? Math.round((done / labIds.length) * 100) / 100 : 0 };
        })
        .filter((path) => path.labIds.length > 0)
        .sort((a, b) => Number(v.pinnedPaths.includes(b.id)) - Number(v.pinnedPaths.includes(a.id)));
      const domains = this.content.domains.map((d) => ({ ...d, labCount: labs.filter((l) => l.domain === d.id).length, pathCount: paths.filter((x) => x.domain === d.id).length }));
      return { domains, paths, labs };
    });
  }

  async assertLabVisible(p: Principal, labId: string): Promise<void> {
    if (!p.orgId) return;
    const ok = await this.tx(p, async (tx) => this.labVisible(await this.visibility(tx), labId));
    if (!ok) throw notFound('Lab');
  }

  /* ---------------------------------------------------------------- quotas */

  async quotas(tx: Tx, orgId: string): Promise<Quotas> {
    const q = await tx.selectFrom('quotas').selectAll().where('org_id', '=', orgId).executeTakeFirst();
    return q ? { maxConcurrentSessions: q.max_concurrent_sessions, monthlyLabHours: q.monthly_lab_hours, maxSessionMinutes: q.max_session_minutes } : { ...DEFAULT_QUOTAS };
  }

  async settings(tx: Tx, orgId: string): Promise<OrgSettingsJson> {
    const o = await tx.selectFrom('orgs').select('settings').where('id', '=', orgId).executeTakeFirst();
    return { ...DEFAULT_SETTINGS, ...(o?.settings ?? {}) };
  }

  /** Lab hours used in the calendar month of `at` (running attempts count up to now). */
  async labHoursThisMonth(tx: Tx, at = this.now()): Promise<number> {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const r = await tx
      .selectFrom('lab_attempts')
      .select(sql<number>`coalesce(sum(CASE WHEN ended_at IS NULL THEN greatest(duration_s, extract(epoch FROM (${at}::timestamptz - started_at))) ELSE duration_s END), 0)`.as('s'))
      .where('started_at', '>=', start)
      .executeTakeFirstOrThrow();
    return Math.round((Number(r.s) / 3600) * 10) / 10;
  }

  /** Live LabSessions of an org in the cluster (not being deleted, not over). */
  async liveClusterSessions(orgId: string): Promise<LabSession[]> {
    const items = await this.cluster.listSessions(`${LABEL_ORG}=${labelValue(orgId)},${LABEL_MANAGED_BY}=${MANAGED_BY}`);
    return items.filter((s) => s.spec.learner.org === orgId && !['expired', 'failed'].includes(phaseOf(s)));
  }

  /* ------------------------------------------------------- session hooks */

  async beforeStart(p: Principal, lab: ContentLab): Promise<{ ttlMinutes?: number }> {
    if (!p.orgId) throw new HttpError(409, 'Select an organization before starting a lab.', { code: 'conflict' });
    return this.tx(p, async (tx) => {
      if (!this.labVisible(await this.visibility(tx), lab.lab.metadata.id)) throw notFound('Lab');
      const q = await this.quotas(tx, p.orgId);
      const live = (await this.liveClusterSessions(p.orgId)).length;
      if (live >= q.maxConcurrentSessions) {
        throw new HttpError(429, `Your organization already runs ${live} of ${q.maxConcurrentSessions} allowed concurrent lab sessions.`, {
          code: 'quota_exceeded',
          details: { quota: 'max_concurrent_sessions', limit: q.maxConcurrentSessions, current: live },
        });
      }
      const hours = await this.labHoursThisMonth(tx);
      if (hours >= q.monthlyLabHours) {
        throw new HttpError(429, `Your organization used ${hours} of ${q.monthlyLabHours} lab hours this month.`, {
          code: 'quota_exceeded',
          details: { quota: 'monthly_lab_hours', limit: q.monthlyLabHours, current: hours },
        });
      }
      const s = await this.settings(tx, p.orgId);
      return { ttlMinutes: Math.min(s.defaultSessionMinutes ?? DEFAULT_SETTINGS.defaultSessionMinutes, q.maxSessionMinutes) };
    });
  }

  async started(p: Principal, lab: ContentLab, ls: LabSession): Promise<void> {
    if (!p.orgId) return;
    await this.tx(p, (tx) => startAttempt(tx, { orgId: p.orgId, userId: p.sub, lab: lab.lab, sessionName: ls.metadata.name, startedAt: ls.metadata.creationTimestamp ? new Date(ls.metadata.creationTimestamp) : this.now() }));
  }

  async validated(p: Principal, lab: ContentLab, ls: LabSession, res: ValidateResponse): Promise<void> {
    const v = ls.status?.validation;
    if (!p.orgId || res.grading?.state !== 'complete' || !v || v.phase !== 'Complete') return;
    await this.tx(p, async (tx) => {
      // Idempotent per grader answer: a validate request number is recorded once.
      const a = await tx.selectFrom('lab_attempts').select(['validations']).where('session_name', '=', ls.metadata.name).executeTakeFirst();
      if (a && a.validations >= v.observedRequest) return;
      await recordRun(tx, {
        orgId: p.orgId,
        userId: p.sub,
        sessionName: ls.metadata.name,
        lab: lab.lab,
        score: v.score,
        checks: (v.checks ?? []).map((c) => ({ id: c.id, passed: c.passed, ...(c.weight !== undefined ? { weight: c.weight } : {}), ...(c.skills ? { skills: c.skills } : {}), ...(c.message ? { message: c.message } : {}) })),
        hintsUsed: revealedHints(ls).length,
        at: v.completedAt ? new Date(v.completedAt) : this.now(),
        ...(ls.metadata.creationTimestamp ? { startedAt: new Date(ls.metadata.creationTimestamp) } : {}),
      });
    });
  }

  async ended(p: Principal, sessionName: string, ls?: LabSession): Promise<void> {
    if (!p.orgId) return;
    await this.tx(p, (tx) => endAttempt(tx, sessionName, this.now(), ls ? revealedHints(ls).length : undefined));
  }

  async decorate(p: Principal, s: WebSession): Promise<WebSession> {
    if (!p.orgId) return s;
    const notices = await this.notices(p.orgId, p.sub, s.id);
    return notices.length ? { ...s, notices } : s;
  }

  async notices(orgId: string, userId: string, sessionName: string): Promise<SessionNotice[]> {
    return this.orgTx(orgId, userId, async (tx) => {
      const since = new Date(this.now().getTime() - 2 * 3600_000);
      const rows = await tx
        .selectFrom('session_notices as n')
        .leftJoin('users as u', 'u.id', 'n.from_id')
        .select(['n.id', 'n.kind', 'n.at', 'n.message', 'n.active', 'u.id as uid', 'u.name as uname', 'u.email as uemail'])
        .where('n.user_id', '=', userId)
        .where((eb) => eb.or([eb('n.session_name', '=', sessionName), eb('n.session_name', 'is', null)]))
        .where((eb) => eb.or([eb('n.at', '>', since), eb('n.active', '=', true)]))
        .orderBy('n.at', 'desc')
        .limit(20)
        .execute();
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as SessionNotice['kind'],
        at: r.at.toISOString(),
        message: r.message,
        ...(r.uid ? { from: { id: r.uid, name: r.uname ?? '', email: r.uemail ?? '' } } : {}),
        ...(r.kind === 'observed' ? { active: r.active } : {}),
      }));
    });
  }

  /** Closes attempts whose LabSession is gone or over (expiry, deletion outside the gateway). */
  async sweep(): Promise<number> {
    let closed = 0;
    const orgs = (await sql<{ sys_org_ids: string }>`SELECT sys_org_ids()`.execute(this.db)).rows.map((r) => r.sys_org_ids);
    for (const orgId of orgs) {
      await this.orgTx(orgId, null, async (tx) => {
        const open = await tx.selectFrom('lab_attempts').select(['session_name']).where('ended_at', 'is', null).execute();
        for (const a of open) {
          const ls = await this.cluster.getSession(a.session_name);
          if (ls && !['expired', 'failed'].includes(phaseOf(ls))) continue;
          await endAttempt(tx, a.session_name, ls?.status?.expiresAt ? new Date(Math.min(Date.parse(ls.status.expiresAt), this.now().getTime())) : this.now());
          await tx.updateTable('session_notices').set({ active: false, ended_at: this.now() }).where('session_name', '=', a.session_name).where('active', '=', true).execute();
          closed++;
        }
      });
    }
    return closed;
  }

  /* ---------------------------------------------------------------- me */

  async me(p: Principal): Promise<Me> {
    const memberships = await membershipsOf(this.db, p.sub);
    const stats = p.orgId
      ? await this.tx(p, async (tx) => {
          const attempts = await this.attemptsLite(tx, p.sub, 60);
          const user = await tx.selectFrom('users').select(['last_login_at', 'avatar_url']).where('id', '=', p.sub).executeTakeFirst();
          const cohorts = p.cohortIds.length || p.instructedCohortIds.length ? await tx.selectFrom('cohorts').select(['id', 'name']).where('id', 'in', [...p.cohortIds, ...p.instructedCohortIds]).execute() : [];
          const org = await tx.selectFrom('orgs').select(['settings']).where('id', '=', p.orgId).executeTakeFirst();
          return { attempts, user, cohorts, logoUrl: org?.settings.logoUrl };
        })
      : { attempts: [] as AttemptLite[], user: undefined, cohorts: [] as { id: string; name: string }[], logoUrl: undefined };
    const now = this.now();
    const cohortName = new Map(stats.cohorts.map((c) => [c.id, c.name]));
    const userRefFull = { id: p.sub, name: p.name, email: p.email, ...(p.title ? { title: p.title } : {}), ...(stats.user?.avatar_url ? { avatarUrl: stats.user.avatar_url } : {}), ...(stats.user?.last_login_at ? { lastLoginAt: stats.user.last_login_at.toISOString() } : {}) };
    return {
      id: p.sub,
      name: p.name,
      email: p.email,
      role: legacyRole(p.roles),
      team: p.team,
      org: p.orgName,
      streakDays: streakDays(stats.attempts, now),
      minutesThisWeek: minutesSince(stats.attempts, new Date(now.getTime() - 7 * DAY)),
      user: userRefFull,
      activeOrg: p.orgId ? { id: p.orgId, slug: p.orgSlug, name: p.orgName, ...(stats.logoUrl ? { logoUrl: stats.logoUrl } : {}) } : null,
      memberships: memberships
        .filter((m) => m.status !== 'deactivated' && m.org_status === 'active')
        .map((m) => ({ org: { id: m.org_id, slug: m.slug, name: m.name, ...(m.logo_url ? { logoUrl: m.logo_url } : {}) }, roles: m.roles as Me['memberships'][number]['roles'], status: m.status as 'invited' | 'active' })),
      roles: p.roles,
      permissions: permissionsOf(p),
      grants: grantsOf(p),
      teams: p.teams.map((t) => ({ id: t.id, name: t.name, role: t.role })),
      managedTeams: p.teams.filter((t) => p.managedTeamIds.includes(t.id)).map((t) => ({ id: t.id, name: t.name })),
      instructedCohorts: p.instructedCohortIds.map((id) => ({ id, name: cohortName.get(id) ?? id })),
      cohorts: p.cohortIds.map((id) => ({ id, name: cohortName.get(id) ?? id })),
      platformAdmin: p.platformAdmin,
      csrfToken: p.session?.csrf ?? '',
      auth: {
        method: p.session?.method ?? 'dev',
        ...(p.session?.idp ? { idp: p.session.idp } : {}),
        ...(p.session?.expiresAt ? { sessionExpiresAt: p.session.expiresAt } : {}),
        ...(p.session?.impersonated ? { impersonated: true } : {}),
      },
    };
  }

  /* ------------------------------------------------------------ learner */

  async attemptsLite(tx: Tx, userId: string, days: number): Promise<AttemptLite[]> {
    return (await this.attemptsLiteOf(tx, [userId], new Date(this.now().getTime() - days * DAY))).map(({ user_id: _u, ...a }) => a);
  }

  /**
   * Attempts of `userIds` started in [since, until], newest first, with the time
   * of their last graded run: what practiceSeconds() needs. Every view that
   * shows practice minutes (Home, team dashboard, member page, progress CSV)
   * reads attempts through here.
   */
  async attemptsLiteOf(tx: Tx, userIds: string[], since: Date, until?: Date): Promise<(AttemptLite & { user_id: string })[]> {
    if (!userIds.length) return [];
    let q = tx
      .selectFrom('lab_attempts as a')
      .select(['a.id', 'a.user_id', 'a.lab_id', 'a.started_at', 'a.ended_at', 'a.outcome', 'a.score', 'a.hints_used', 'a.duration_s', 'a.session_name', 'a.validations', 'a.checks_passed', 'a.checks_total'])
      .select((eb) => eb.selectFrom('check_results as c').select((e) => e.fn.max('c.graded_at').as('m')).whereRef('c.attempt_id', '=', 'a.id').as('last_run_at'))
      .where('a.user_id', 'in', userIds)
      .where('a.started_at', '>=', since);
    if (until) q = q.where('a.started_at', '<=', until);
    return q.orderBy('a.started_at', 'desc').execute() as Promise<(AttemptLite & { user_id: string })[]>;
  }

  /* ------------------------------------------------------------- goals */

  goals(p: Principal): Promise<LearnerGoals> {
    return this.tx(p, (tx) => readGoals(tx, p.sub));
  }

  setGoals(p: Principal, req: UpdateLearnerGoalsRequest): Promise<LearnerGoals> {
    return this.tx(p, (tx) => writeGoals(tx, p.orgId, p.sub, req ?? {}, this.now()));
  }

  async states(tx: Tx, userId: string) {
    return tx.selectFrom('learner_skill_state').select(['skill_id', 'mu', 'sigma', 'evidence', 'last_delta', 'updated_at']).where('user_id', '=', userId).execute();
  }

  async home(p: Principal): Promise<HomeData> {
    const me = await this.me(p);
    return this.tx(p, async (tx) => {
      const v = await this.visibility(tx);
      const labs = this.content.summaries.filter((l) => this.labVisible(v, l.id));
      const [states, attempts, assignments, goals] = await Promise.all([this.states(tx, p.sub), this.attemptsLite(tx, p.sub, 120), this.myAssignmentsTx(tx, p.sub), readGoals(tx, p.sub)]);
      const { user: _u, activeOrg: _o, memberships: _m, roles: _r, permissions: _p, grants: _g, teams: _t, managedTeams: _mt, instructedCohorts: _ic, cohorts: _c, platformAdmin: _pa, csrfToken: _cs, auth: _a, ...learner } = me;
      return buildHome({ learner, content: this.content, labs, states, attempts, assignments, pinnedPathIds: v.pinnedPaths, goals, now: this.now() });
    });
  }

  /** Who `userId` is to the authz layer: their teams and cohorts in the active org. */
  async subjectOf(tx: Tx, userId: string): Promise<{ kind: 'user'; userId: string; teamIds: string[]; cohortIds: string[] }> {
    const teams = await tx.selectFrom('team_members').select('team_id').where('user_id', '=', userId).execute();
    const cohorts = await tx.selectFrom('cohort_members').select('cohort_id').where('user_id', '=', userId).execute();
    return { kind: 'user', userId, teamIds: teams.map((t) => t.team_id), cohortIds: cohorts.map((c) => c.cohort_id) };
  }

  async skills(p: Principal, member?: string) {
    const who = member || p.sub;
    return this.tx(p, async (tx) => {
      let memberRef: { id: string; name: string; title: string } | undefined;
      if (who !== p.sub) {
        const subject = await this.subjectOf(tx, who);
        authorize(p, 'progress.read.team', subject);
        const u = await tx.selectFrom('users').select(['id', 'name', 'title']).where('id', '=', who).executeTakeFirst();
        if (!u) throw notFound('Member');
        memberRef = { id: u.id, name: u.name, title: u.title ?? '' };
      }
      const states: SkillState[] = skillStates(this.content, await this.states(tx, who), this.now());
      const ctf = await this.ctfTotals(tx, who);
      return { skills: this.content.skills, states, frameworks: this.content.frameworks, ...(ctf.labs ? { ctf } : {}), ...(memberRef ? { member: memberRef } : {}) };
    });
  }

  /** Personal CTF points: the best attempt per CTF lab, so retrying a lab never counts its points twice. */
  async ctfTotals(tx: Tx, userId: string): Promise<CtfTotals> {
    const rows = await tx
      .selectFrom('lab_attempts')
      .select(['lab_id', 'points_earned', 'questions_solved'])
      .where('user_id', '=', userId)
      .where('questions_total', '>', 0)
      .execute();
    const best = new Map<string, { points: number; solved: number }>();
    for (const r of rows) {
      const b = best.get(r.lab_id);
      if (!b || r.points_earned > b.points) best.set(r.lab_id, { points: r.points_earned, solved: r.questions_solved });
    }
    const vals = [...best.values()];
    return { points: vals.reduce((n, v) => n + v.points, 0), solved: vals.reduce((n, v) => n + v.solved, 0), labs: best.size };
  }

  itemOf(kind: 'lab' | 'path' | 'framework', id: string, labIds: string[]): AssignmentItem {
    const title =
      kind === 'lab' ? this.labTitle(id) : kind === 'path' ? (this.content.paths.find((x) => x.id === id)?.title ?? id) : (this.content.frameworks.find((f) => f.id === id)?.name ?? id.toUpperCase());
    return { kind, id, title, labIds };
  }

  /** Resolves an assignment item to its labs (path labs, or labs covering a framework's skills). */
  resolveItem(kind: 'lab' | 'path' | 'framework', id: string): string[] {
    if (kind === 'lab') return this.content.labs.has(id) ? [id] : [];
    if (kind === 'path') return this.content.paths.find((x) => x.id === id)?.labIds ?? [];
    const fw = this.content.frameworks.find((f) => f.id === id);
    if (!fw) return [];
    const skills = new Set(fw.domains.flatMap((d) => d.skillIds));
    return this.content.summaries.filter((l) => l.skillIds.some((s) => skills.has(s))).map((l) => l.id);
  }

  async targetName(tx: Tx, kind: string, id: string): Promise<string | undefined> {
    if (kind === 'team') return (await tx.selectFrom('teams').select('name').where('id', '=', id).executeTakeFirst())?.name;
    if (kind === 'cohort') return (await tx.selectFrom('cohorts').select('name').where('id', '=', id).executeTakeFirst())?.name;
    return (await tx.selectFrom('users').select('name').where('id', '=', id).executeTakeFirst())?.name;
  }

  async myAssignmentsTx(tx: Tx, userId: string): Promise<MyAssignment[]> {
    const rows = await tx
      .selectFrom('assignment_status as s')
      .innerJoin('assignments as a', 'a.id', 's.assignment_id')
      .leftJoin('users as u', 'u.id', 'a.assigned_by')
      .select([
        'a.id',
        'a.item_kind',
        'a.item_id',
        'a.lab_ids',
        'a.due_at',
        'a.required',
        'a.note',
        'a.created_at',
        's.via_kind',
        's.via_id',
        's.status',
        's.progress',
        's.completed_at',
        's.best_score',
        'u.id as by_id',
        'u.name as by_name',
        'u.email as by_email',
      ])
      .where('s.user_id', '=', userId)
      .orderBy('a.due_at', 'asc')
      .execute();
    // One row per assignment (a user can be covered through two targets).
    const seen = new Set<string>();
    const out: MyAssignment[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const via: AssignmentTarget = { kind: r.via_kind, id: r.via_id };
      const name = await this.targetName(tx, r.via_kind, r.via_id);
      if (name) via.name = name;
      out.push({
        id: r.id,
        item: this.itemOf(r.item_kind, r.item_id, r.lab_ids),
        via,
        dueAt: r.due_at?.toISOString() ?? null,
        required: r.required,
        ...(r.note ? { note: r.note } : {}),
        assignedBy: r.by_id ? { id: r.by_id, name: r.by_name ?? '', email: r.by_email ?? '' } : { id: '', name: 'CloudTrain', email: '' },
        createdAt: r.created_at.toISOString(),
        status: r.status,
        progress: Math.round(Number(r.progress) * 100) / 100,
        ...(r.completed_at ? { completedAt: r.completed_at.toISOString() } : {}),
        ...(r.best_score !== null ? { bestScore: r.best_score } : {}),
      });
    }
    return out;
  }

  myAssignments(p: Principal): Promise<MyAssignment[]> {
    return this.tx(p, (tx) => this.myAssignmentsTx(tx, p.sub));
  }

  /** `last_run_at`: time of the attempt's last graded run (max check_results.graded_at), for practiceS. */
  toAttempt(r: AttemptRow & { last_run_at: Date | null }): Attempt {
    return {
      id: r.id,
      labId: r.lab_id,
      labTitle: this.labTitle(r.lab_id),
      labVersion: r.lab_version,
      sessionName: r.session_name,
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at?.toISOString() ?? null,
      outcome: r.outcome as AttemptOutcome,
      score: r.score,
      hintsUsed: r.hints_used,
      validations: r.validations,
      durationS: r.ended_at ? r.duration_s : Math.max(r.duration_s, Math.round((this.now().getTime() - r.started_at.getTime()) / 1000)),
      practiceS: practiceSeconds(r),
      checksPassed: r.checks_passed,
      checksTotal: r.checks_total,
      ...(r.questions_total > 0 ? { points: { earned: r.points_earned, possible: r.points_possible, solved: r.questions_solved, total: r.questions_total } } : {}),
    };
  }

  async attemptsPage(tx: Tx, userId: string, q: AttemptQuery): Promise<Page<Attempt>> {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor<[string, string]>(q.cursor);
    let query = tx
      .selectFrom('lab_attempts')
      .selectAll('lab_attempts')
      .select((eb) => eb.selectFrom('check_results as c').select((e) => e.fn.max('c.graded_at').as('m')).whereRef('c.attempt_id', '=', 'lab_attempts.id').as('last_run_at'))
      .where('user_id', '=', userId);
    if (q.lab) query = query.where('lab_id', '=', q.lab);
    if (q.outcome) query = query.where('outcome', '=', q.outcome);
    if (q.from) query = query.where('started_at', '>=', new Date(q.from));
    if (q.to) query = query.where('started_at', '<=', new Date(q.to));
    if (cur) query = query.where((eb) => eb.or([eb('started_at', '<', new Date(cur[0])), eb.and([eb('started_at', '=', new Date(cur[0])), eb('id', '<', cur[1])])]));
    const rows = await query.orderBy('started_at', 'desc').orderBy('id', 'desc').limit(limit + 1).execute();
    const items = rows.slice(0, limit).map((r) => this.toAttempt(r));
    const last = rows[limit - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeCursor([last.started_at.toISOString(), last.id]) : null };
  }

  myAttempts(p: Principal, q: AttemptQuery): Promise<Page<Attempt>> {
    return this.tx(p, (tx) => this.attemptsPage(tx, p.sub, q));
  }

  async attemptDetail(p: Principal, id: string): Promise<AttemptDetail> {
    return this.tx(p, async (tx) => {
      const r = await tx.selectFrom('lab_attempts').selectAll().where('id', '=', id).executeTakeFirst();
      if (!r) throw notFound('Attempt');
      if (r.user_id !== p.sub) authorize(p, 'progress.read.team', await this.subjectOf(tx, r.user_id));
      const u = await tx.selectFrom('users').selectAll().where('id', '=', r.user_id).executeTakeFirst();
      const history = await tx.selectFrom('check_results').selectAll().where('attempt_id', '=', id).orderBy('run').orderBy('check_id').execute();
      const rec = history.map((c) => ({ checkId: c.check_id, passed: c.passed, weight: c.weight, skills: c.skills, run: c.run, gradedAt: c.graded_at.toISOString(), ...(c.message ? { message: c.message } : {}) }));
      const latest = new Map<string, (typeof rec)[number]>();
      for (const c of rec) latest.set(c.checkId, c);
      const lastRun = history.reduce<Date | null>((a, c) => (!a || c.graded_at > a ? c.graded_at : a), null);
      return { ...this.toAttempt({ ...r, last_run_at: lastRun }), user: u ? userRef(u) : UNKNOWN_USER, checks: [...latest.values()], history: rec };
    });
  }

  /** Whether `p` may act on another learner's session (session.observe / session.control). */
  async sessionSubject(p: Principal, ls: LabSession) {
    if (!p.orgId || ls.spec.learner.org !== p.orgId) {
      if (!p.platformAdmin) throw notFound('Session');
    }
    return withTenant(this.db, { orgId: ls.spec.learner.org ?? p.orgId, userId: p.sub }, (tx) => this.subjectOf(tx, ls.spec.learner.id));
  }

  canFor(p: Principal, perm: Parameters<typeof can>[1], target: Parameters<typeof can>[2]) {
    return can(p, perm, target);
  }
}
