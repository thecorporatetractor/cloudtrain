import type { OrgRole, Permission, PermissionGrant, PermissionScope, Role } from '@cloudtrain/api-types';
import type { Principal } from './auth.js';
import { HttpError } from './errors.js';

/*
 * The permission matrix of docs/platform-identity.md, in one place. The web
 * only hides UI; every route declares a permission and handlers check the
 * scoped form with `authorize()`.
 */

export const ALL_PERMISSIONS: readonly Permission[] = [
  'lab.run',
  'progress.read.self',
  'progress.read.team',
  'assignment.manage',
  'report.export',
  'session.observe',
  'session.control',
  'cohort.manage',
  'event.manage',
  'studio.author',
  'content.publish',
  'content.visibility',
  'user.manage',
  'team.manage',
  'role.assign',
  'sso.manage',
  'settings.manage',
  'quota.manage',
  'audit.read',
  'billing.manage',
  'org.manage',
  'capacity.read',
  'support.access',
];

export const ORG_ROLES: readonly OrgRole[] = ['learner', 'manager', 'instructor', 'author', 'org_admin'];
const PLATFORM_ONLY: readonly Permission[] = ['org.manage', 'capacity.read', 'support.access'];

/** Role -> permission -> scope. A role not listed for a permission does not hold it. */
export const MATRIX: Record<OrgRole, Partial<Record<Permission, PermissionScope>>> = {
  learner: { 'lab.run': 'self', 'progress.read.self': 'self' },
  manager: { 'lab.run': 'self', 'progress.read.self': 'self', 'progress.read.team': 'team', 'assignment.manage': 'team', 'report.export': 'team', 'event.manage': 'org' },
  instructor: {
    'lab.run': 'self',
    'progress.read.self': 'self',
    'progress.read.team': 'cohort',
    'assignment.manage': 'cohort',
    'report.export': 'cohort',
    'session.observe': 'cohort',
    'session.control': 'cohort',
    'cohort.manage': 'own',
    'event.manage': 'org',
  },
  author: { 'lab.run': 'self', 'progress.read.self': 'self', 'studio.author': 'org', 'content.publish': 'pilot' },
  org_admin: Object.fromEntries(
    ALL_PERMISSIONS.filter((p) => !PLATFORM_ONLY.includes(p)).map((p) => [p, p === 'lab.run' || p === 'progress.read.self' ? 'self' : 'org']),
  ) as Partial<Record<Permission, PermissionScope>>,
};

/** Breadth order: a broader scope wins when roles overlap. */
const SCOPE_RANK: Record<PermissionScope, number> = { self: 0, pilot: 1, own: 2, cohort: 3, team: 4, org: 5, platform: 6 };

/** Every grant the principal holds, merged across roles (team/cohort grants carry their ids). */
export function grantsOf(p: Principal): PermissionGrant[] {
  if (p.platformAdmin) return ALL_PERMISSIONS.map((permission) => ({ permission, scope: 'platform' }));
  const out = new Map<Permission, PermissionGrant[]>();
  for (const role of p.roles) {
    if (role === 'platform_admin') continue;
    for (const [perm, scope] of Object.entries(MATRIX[role] ?? {}) as [Permission, PermissionScope][]) {
      const g: PermissionGrant = { permission: perm, scope };
      if (scope === 'team') g.teamIds = [...p.managedTeamIds];
      if (scope === 'cohort' || scope === 'own') g.cohortIds = [...p.instructedCohortIds];
      const list = out.get(perm) ?? [];
      list.push(g);
      out.set(perm, list);
    }
  }
  // Keep the broadest grant per permission, plus narrower ones of a different kind (team + cohort both matter).
  const result: PermissionGrant[] = [];
  for (const [, list] of out) {
    const top = Math.max(...list.map((g) => SCOPE_RANK[g.scope]));
    if (top >= SCOPE_RANK.org) {
      result.push(list.find((g) => SCOPE_RANK[g.scope] === top)!);
      continue;
    }
    const seen = new Set<PermissionScope>();
    for (const g of list) if (!seen.has(g.scope)) (seen.add(g.scope), result.push(g));
  }
  return result;
}

export function permissionsOf(p: Principal): Permission[] {
  return Array.from(new Set(grantsOf(p).map((g) => g.permission)));
}

/** What a permission is checked against. Objects are always in the principal's active org (RLS). */
export type AuthzTarget =
  | { kind: 'org' }
  | { kind: 'platform' }
  | { kind: 'team'; teamId: string }
  | { kind: 'cohort'; cohortId: string; createdBy?: string | null }
  /** Data about one person: allowed for self, or through a managed team / instructed cohort they belong to. */
  | { kind: 'user'; userId: string; teamIds: string[]; cohortIds: string[] }
  | { kind: 'publish'; stage: 'pilot' | 'published' };

/**
 * `can(principal, permission, target)`. Without a target: does the principal
 * hold the permission in any scope (list endpoints then filter by scope).
 */
export function can(p: Principal, perm: Permission, target?: AuthzTarget): boolean {
  if (p.platformAdmin) return true;
  if (!p.orgId) return false;
  const grants = grantsOf(p).filter((g) => g.permission === perm);
  if (!grants.length) return false;
  if (!target) return true;
  if (target.kind === 'platform') return false;
  return grants.some((g) => {
    switch (g.scope) {
      case 'org':
        return true;
      case 'self':
        return target.kind === 'user' && target.userId === p.sub;
      case 'team':
        if (target.kind === 'team') return (g.teamIds ?? []).includes(target.teamId);
        if (target.kind === 'user') return target.userId === p.sub || target.teamIds.some((t) => (g.teamIds ?? []).includes(t));
        return false;
      case 'cohort':
        if (target.kind === 'cohort') return (g.cohortIds ?? []).includes(target.cohortId);
        if (target.kind === 'user') return target.userId === p.sub || target.cohortIds.some((c) => (g.cohortIds ?? []).includes(c));
        return false;
      case 'own':
        return target.kind === 'cohort' && ((g.cohortIds ?? []).includes(target.cohortId) || (!!target.createdBy && target.createdBy === p.sub));
      case 'pilot':
        return target.kind === 'publish' && target.stage === 'pilot';
      default:
        return false;
    }
  });
}

function scopeLabel(t: AuthzTarget | undefined): string {
  if (!t) return 'any';
  switch (t.kind) {
    case 'team':
      return `team:${t.teamId}`;
    case 'cohort':
      return `cohort:${t.cohortId}`;
    case 'user':
      return `user:${t.userId}`;
    case 'publish':
      return `publish:${t.stage}`;
    default:
      return t.kind;
  }
}

export function forbidden(perm: Permission, target?: AuthzTarget): HttpError {
  return new HttpError(403, `You do not have permission to do this (${perm}).`, { code: 'forbidden', permission: perm, scope: scopeLabel(target) });
}

/** Throws the 403 `ApiError` unless `can()`. */
export function authorize(p: Principal, perm: Permission, target?: AuthzTarget): void {
  if (!can(p, perm, target)) throw forbidden(perm, target);
}

/** Legacy `Learner.role` for pre-platform callers. */
export function legacyRole(roles: readonly Role[]): 'learner' | 'manager' | 'admin' {
  if (roles.includes('org_admin') || roles.includes('platform_admin')) return 'admin';
  if (roles.includes('manager')) return 'manager';
  return 'learner';
}
