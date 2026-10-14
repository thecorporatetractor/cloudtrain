import { describe, expect, it } from 'vitest';
import type { OrgRole, Permission } from '@cloudtrain/api-types';
import { devPrincipal, type Principal } from '../src/auth.js';
import { ALL_PERMISSIONS, authorize, can, grantsOf, permissionsOf } from '../src/authz.js';
import { HttpError } from '../src/errors.js';

const who = (roles: OrgRole[], over: Partial<Principal> = {}): Principal => devPrincipal({ sub: 'u1', roles, ...over });

/** The contract table (docs/platform-identity.md), row by row: '' = not held. */
const TABLE: Record<Permission, Record<OrgRole, string>> = {
  'lab.run': { learner: 'self', manager: 'self', instructor: 'self', author: 'self', org_admin: 'self' },
  'progress.read.self': { learner: 'self', manager: 'self', instructor: 'self', author: 'self', org_admin: 'self' },
  'progress.read.team': { learner: '', manager: 'team', instructor: 'cohort', author: '', org_admin: 'org' },
  'assignment.manage': { learner: '', manager: 'team', instructor: 'cohort', author: '', org_admin: 'org' },
  'report.export': { learner: '', manager: 'team', instructor: 'cohort', author: '', org_admin: 'org' },
  'session.observe': { learner: '', manager: '', instructor: 'cohort', author: '', org_admin: 'org' },
  'session.control': { learner: '', manager: '', instructor: 'cohort', author: '', org_admin: 'org' },
  'cohort.manage': { learner: '', manager: '', instructor: 'own', author: '', org_admin: 'org' },
  'studio.author': { learner: '', manager: '', instructor: '', author: 'org', org_admin: 'org' },
  'content.publish': { learner: '', manager: '', instructor: '', author: 'pilot', org_admin: 'org' },
  'content.visibility': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'user.manage': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'team.manage': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'role.assign': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'sso.manage': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'settings.manage': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'quota.manage': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'audit.read': { learner: '', manager: '', instructor: '', author: '', org_admin: 'org' },
  'org.manage': { learner: '', manager: '', instructor: '', author: '', org_admin: '' },
  'capacity.read': { learner: '', manager: '', instructor: '', author: '', org_admin: '' },
  'support.access': { learner: '', manager: '', instructor: '', author: '', org_admin: '' },
};

describe('permission matrix', () => {
  for (const role of ['learner', 'manager', 'instructor', 'author', 'org_admin'] as OrgRole[]) {
    it(`grants ${role} exactly its column`, () => {
      const p = who(role === 'learner' ? ['learner'] : ['learner', role]);
      const grants = grantsOf(p);
      for (const perm of ALL_PERMISSIONS) {
        const want = TABLE[perm][role];
        const got = grants.filter((g) => g.permission === perm).map((g) => g.scope);
        if (!want) expect(got, `${role} ${perm}`).toEqual([]);
        else expect(got, `${role} ${perm}`).toContain(want);
      }
    });
  }

  it('platform_admin holds everything at platform scope, including platform-only permissions', () => {
    const p = devPrincipal({ roles: ['platform_admin'], platformAdmin: true, orgId: '' });
    expect(permissionsOf(p).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(can(p, 'org.manage', { kind: 'platform' })).toBe(true);
    expect(can(p, 'capacity.read', { kind: 'platform' })).toBe(true);
    expect(can(who(['org_admin']), 'org.manage', { kind: 'platform' })).toBe(false);
  });

  it('scopes a manager to the teams they manage', () => {
    const m = who(['learner', 'manager'], { managedTeamIds: ['t1'] });
    expect(can(m, 'progress.read.team', { kind: 'team', teamId: 't1' })).toBe(true);
    expect(can(m, 'progress.read.team', { kind: 'team', teamId: 't2' })).toBe(false);
    expect(can(m, 'assignment.manage', { kind: 'user', userId: 'x', teamIds: ['t1'], cohortIds: [] })).toBe(true);
    expect(can(m, 'assignment.manage', { kind: 'user', userId: 'x', teamIds: ['t2'], cohortIds: ['c1'] })).toBe(false);
    expect(can(m, 'progress.read.team', { kind: 'cohort', cohortId: 'c1' })).toBe(false);
    expect(can(m, 'session.observe')).toBe(false);
  });

  it('scopes an instructor to the cohorts they instruct', () => {
    const i = who(['learner', 'instructor'], { instructedCohortIds: ['c1'] });
    expect(can(i, 'session.observe', { kind: 'user', userId: 'x', teamIds: [], cohortIds: ['c1'] })).toBe(true);
    expect(can(i, 'session.control', { kind: 'user', userId: 'x', teamIds: [], cohortIds: ['c2'] })).toBe(false);
    expect(can(i, 'cohort.manage')).toBe(true); // may create cohorts
    expect(can(i, 'cohort.manage', { kind: 'cohort', cohortId: 'c1' })).toBe(true);
    expect(can(i, 'cohort.manage', { kind: 'cohort', cohortId: 'c9', createdBy: 'u1' })).toBe(true);
    expect(can(i, 'cohort.manage', { kind: 'cohort', cohortId: 'c9', createdBy: 'other' })).toBe(false);
    expect(can(i, 'progress.read.team', { kind: 'team', teamId: 't1' })).toBe(false);
  });

  it('lets an org admin reach every team and cohort in the org', () => {
    const a = who(['learner', 'org_admin']);
    expect(can(a, 'progress.read.team', { kind: 'team', teamId: 'any' })).toBe(true);
    expect(can(a, 'session.control', { kind: 'user', userId: 'x', teamIds: [], cohortIds: [] })).toBe(true);
    expect(can(a, 'content.publish', { kind: 'publish', stage: 'published' })).toBe(true);
  });

  it('limits an author to publishing to pilot', () => {
    const a = who(['learner', 'author']);
    expect(can(a, 'content.publish', { kind: 'publish', stage: 'pilot' })).toBe(true);
    expect(can(a, 'content.publish', { kind: 'publish', stage: 'published' })).toBe(false);
  });

  it('keeps self scope to the caller', () => {
    const l = who(['learner']);
    expect(can(l, 'progress.read.self', { kind: 'user', userId: 'u1', teamIds: [], cohortIds: [] })).toBe(true);
    expect(can(l, 'progress.read.self', { kind: 'user', userId: 'u2', teamIds: [], cohortIds: [] })).toBe(false);
  });

  it('holds nothing without an active org (unless platform admin)', () => {
    expect(can(who(['learner', 'org_admin'], { orgId: '' }), 'lab.run')).toBe(false);
  });

  it('throws the 403 ApiError shape', () => {
    try {
      authorize(who(['learner']), 'audit.read', { kind: 'org' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).body()).toEqual({ error: 'You do not have permission to do this (audit.read).', code: 'forbidden', permission: 'audit.read', scope: 'org' });
    }
  });
});
