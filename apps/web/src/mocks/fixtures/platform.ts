/**
 * Platform fixtures: two fictional organisations with people in every role.
 *
 *   Quillmoor Logistics  (quillmoor.example)   SSO through Entra ID, enforced
 *   Acme Freight         (acmefreight.example) local passwords, no SSO yet
 *
 * Everything derives from a small set of seeds so it is stable between reloads
 * and consistent across screens (the same attempt shows up in History, the
 * member drill-down, the cohort board and the audit log). All names fictional.
 */
import type {
  Assignment,
  AssignmentItem,
  AssignmentState,
  AssignmentTarget,
  Attempt,
  AttemptOutcome,
  AuditEvent,
  Capacity,
  Cohort,
  CohortBoard,
  CohortBoardRow,
  ContentVisibility,
  DashboardMember,
  Invitation,
  LiveSession,
  MemberDetail,
  MyAssignment,
  Org,
  OrgDomain,
  OrgRef,
  OrgRole,
  OrgUser,
  Permission,
  PermissionGrant,
  PlatformOrg,
  Quotas,
  Role,
  SessionPhase,
  SkillState,
  SsoConnection,
  Team,
  TeamDashboard,
  TeamDetail,
  TeamRef,
  TeamRole,
  Usage,
  UserRef,
} from '@/api/types';
import { frameworkReadiness } from '@/lib/readiness';
import { labSummaries, paths } from './labs';
import { frameworks, seeded, skillStates } from './skills';
import { memberSkillStates, teamData } from './team';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();
const round2 = (v: number) => Math.round(v * 100) / 100;

/* ================================================================ orgs */

export const ORG_QUILLMOOR: OrgRef = { id: 'org-quillmoor', slug: 'quillmoor', name: 'Quillmoor Logistics' };
export const ORG_ACME: OrgRef = { id: 'org-acme', slug: 'acme-freight', name: 'Acme Freight' };
const ORG_NORTHWIND: OrgRef = { id: 'org-northwind', slug: 'northwind-rail', name: 'Northwind Rail' };

export const domainsByOrg: Record<string, OrgDomain[]> = {
  [ORG_QUILLMOOR.id]: [
    { domain: 'quillmoor.example', verified: true, verifiedAt: ago(41 * DAY), verification: { type: 'TXT', name: '_cloudtrain.quillmoor.example', value: 'cloudtrain-verify=q7m2-5f1a-9c3e-quillmoor' } },
    { domain: 'depot.quillmoor.example', verified: false, verification: { type: 'TXT', name: '_cloudtrain.depot.quillmoor.example', value: 'cloudtrain-verify=d4k8-2a7b-1e6f-depot' } },
  ],
  [ORG_ACME.id]: [{ domain: 'acmefreight.example', verified: false, verification: { type: 'TXT', name: '_cloudtrain.acmefreight.example', value: 'cloudtrain-verify=a1c3-8e2d-6b9f-acme' } }],
};

export const orgs: Record<string, Org> = {
  [ORG_QUILLMOOR.id]: {
    ...ORG_QUILLMOOR,
    status: 'active',
    settings: { defaultSessionMinutes: 60, allowLocalLogin: false, timezone: 'Europe/Amsterdam', accentColor: undefined },
    createdAt: ago(120 * DAY),
    domains: domainsByOrg[ORG_QUILLMOOR.id]!,
  },
  [ORG_ACME.id]: {
    ...ORG_ACME,
    status: 'active',
    settings: { defaultSessionMinutes: 45, allowLocalLogin: true, timezone: 'America/Chicago' },
    createdAt: ago(33 * DAY),
    domains: domainsByOrg[ORG_ACME.id]!,
  },
};

export const quotasByOrg: Record<string, Quotas> = {
  [ORG_QUILLMOOR.id]: { maxConcurrentSessions: 25, monthlyLabHours: 400, maxSessionMinutes: 120 },
  [ORG_ACME.id]: { maxConcurrentSessions: 8, monthlyLabHours: 80, maxSessionMinutes: 90 },
  [ORG_NORTHWIND.id]: { maxConcurrentSessions: 10, monthlyLabHours: 120, maxSessionMinutes: 90 },
};

/* ================================================================ teams */

interface TeamSeed {
  id: string;
  name: string;
  parentId: string | null;
  orgId: string;
}
const teamSeeds: TeamSeed[] = [
  { id: 't-eng', name: 'Engineering', parentId: null, orgId: ORG_QUILLMOOR.id },
  { id: 't-platrel', name: 'Platform Reliability', parentId: 't-eng', orgId: ORG_QUILLMOOR.id },
  { id: 't-edge', name: 'Edge Network', parentId: 't-eng', orgId: ORG_QUILLMOOR.id },
  { id: 't-data', name: 'Data Platform', parentId: 't-eng', orgId: ORG_QUILLMOOR.id },
  { id: 't-ops', name: 'Operations', parentId: null, orgId: ORG_QUILLMOOR.id },
  { id: 't-depot', name: 'Depot Systems', parentId: 't-ops', orgId: ORG_QUILLMOOR.id },
  { id: 't-acme-it', name: 'IT Operations', parentId: null, orgId: ORG_ACME.id },
];
const teamRef = (id: string): TeamRef => {
  const t = teamSeeds.find((x) => x.id === id)!;
  return { id: t.id, name: t.name };
};

/* ================================================================ people */

interface PersonSeed {
  id: string;
  name: string;
  email: string;
  title: string;
  /** Org id -> roles. */
  orgs: Record<string, OrgRole[]>;
  teams: { teamId: string; role: TeamRole }[];
  status?: OrgUser['status'];
  platformAdmin?: boolean;
  lastLoginDaysAgo?: number;
  joinedDaysAgo?: number;
  source?: OrgUser['source'];
  /** Competency scores in teamData.competencies order (people outside the sample team). */
  skills?: number[];
}

const Q = ORG_QUILLMOOR.id;
const A = ORG_ACME.id;

export const people: PersonSeed[] = [
  { id: 'u-ingrid', name: 'Ingrid Solvang', email: 'ingrid.solvang@quillmoor.example', title: 'Staff SRE', orgs: { [Q]: ['learner', 'manager'], [A]: ['learner'] }, teams: [{ teamId: 't-platrel', role: 'manager' }, { teamId: 't-edge', role: 'manager' }], lastLoginDaysAgo: 0, joinedDaysAgo: 118 },
  { id: 'u-tomas', name: 'Tomas Ferreira', email: 'tomas.ferreira@quillmoor.example', title: 'Platform engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-platrel', role: 'member' }], lastLoginDaysAgo: 1, joinedDaysAgo: 110 },
  { id: 'u-mira', name: 'Mira Adeyemi', email: 'mira.adeyemi@quillmoor.example', title: 'Network engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-platrel', role: 'member' }, { teamId: 't-edge', role: 'member' }], lastLoginDaysAgo: 0, joinedDaysAgo: 95 },
  { id: 'u-samir', name: 'Samir Haddad', email: 'samir.haddad@quillmoor.example', title: 'SRE · instructor', orgs: { [Q]: ['learner', 'instructor'] }, teams: [{ teamId: 't-platrel', role: 'member' }], lastLoginDaysAgo: 0, joinedDaysAgo: 118 },
  { id: 'u-lena', name: 'Lena Varga', email: 'lena.varga@quillmoor.example', title: 'Junior SRE', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-platrel', role: 'member' }], lastLoginDaysAgo: 0, joinedDaysAgo: 60 },
  { id: 'u-kofi', name: 'Kofi Mensah', email: 'kofi.mensah@quillmoor.example', title: 'Platform engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-platrel', role: 'member' }], lastLoginDaysAgo: 4, joinedDaysAgo: 88 },
  { id: 'u-aino', name: 'Aino Lehto', email: 'aino.lehto@quillmoor.example', title: 'Security engineer', orgs: { [Q]: ['learner', 'author'] }, teams: [{ teamId: 't-platrel', role: 'member' }], lastLoginDaysAgo: 1, joinedDaysAgo: 101 },
  { id: 'u-priya', name: 'Priya Natarajan', email: 'priya.natarajan@quillmoor.example', title: 'Head of Engineering Enablement', orgs: { [Q]: ['learner', 'org_admin'] }, teams: [{ teamId: 't-eng', role: 'manager' }], lastLoginDaysAgo: 0, joinedDaysAgo: 120, skills: [0.3, 0.25, 0.2, 0.2, 0.3, 0.4, 0.3, 0.45, 0.1, 0.1, 0.15] },
  { id: 'u-bram', name: 'Bram Oosterhuis', email: 'bram.oosterhuis@quillmoor.example', title: 'Network engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-edge', role: 'member' }], lastLoginDaysAgo: 2, joinedDaysAgo: 70, skills: [0.2, 0.18, 0.4, 0.15, 0.3, 0.5, 0.35, 0.55, 0.8, 0.76, 0.62] },
  { id: 'u-yuki', name: 'Yuki Tanaka', email: 'yuki.tanaka@quillmoor.example', title: 'Network engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-edge', role: 'member' }], lastLoginDaysAgo: 9, joinedDaysAgo: 64, skills: [0.25, 0.2, 0.35, 0.18, 0.28, 0.45, 0.3, 0.5, 0.66, 0.58, 0.44] },
  { id: 'u-ravi', name: 'Ravi Menon', email: 'ravi.menon@quillmoor.example', title: 'Data platform lead', orgs: { [Q]: ['learner', 'manager'] }, teams: [{ teamId: 't-data', role: 'manager' }], lastLoginDaysAgo: 3, joinedDaysAgo: 100, skills: [0.55, 0.5, 0.42, 0.3, 0.5, 0.6, 0.7, 0.58, 0.1, 0.12, 0.2] },
  { id: 'u-dana', name: 'Dana Whitfield', email: 'dana.whitfield@quillmoor.example', title: 'Data engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-data', role: 'member' }], lastLoginDaysAgo: 1, joinedDaysAgo: 55, skills: [0.4, 0.35, 0.3, 0.22, 0.38, 0.5, 0.62, 0.5, 0.05, 0.08, 0.1] },
  { id: 'u-olu', name: 'Oluwaseun Bello', email: 'oluwaseun.bello@quillmoor.example', title: 'Data engineer', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-data', role: 'member' }], lastLoginDaysAgo: 12, joinedDaysAgo: 40, skills: [0.3, 0.28, 0.22, 0.15, 0.3, 0.42, 0.55, 0.4, 0.05, 0.05, 0.08] },
  { id: 'u-chloe', name: 'Chloé Dubois', email: 'chloe.dubois@quillmoor.example', title: 'Depot systems lead', orgs: { [Q]: ['learner', 'manager'] }, teams: [{ teamId: 't-depot', role: 'manager' }], lastLoginDaysAgo: 6, joinedDaysAgo: 90, skills: [0.2, 0.2, 0.15, 0.1, 0.25, 0.7, 0.66, 0.72, 0.3, 0.28, 0.35] },
  { id: 'u-greta', name: 'Greta Lindqvist', email: 'greta.lindqvist@quillmoor.example', title: 'Depot systems administrator', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-depot', role: 'member' }], lastLoginDaysAgo: 2, joinedDaysAgo: 45, skills: [0.1, 0.1, 0.1, 0.05, 0.15, 0.62, 0.58, 0.64, 0.22, 0.2, 0.3] },
  // Signed up this week: no graded practice yet (Home cold start, see fixtures/home.ts).
  { id: 'u-noor', name: 'Noor Aziz', email: 'noor.aziz@quillmoor.example', title: 'Platform engineer (new starter)', orgs: { [Q]: ['learner'] }, teams: [], lastLoginDaysAgo: 0, joinedDaysAgo: 3 },
  { id: 'u-hugo', name: 'Hugo Marchetti', email: 'hugo.marchetti@quillmoor.example', title: 'Depot systems administrator', orgs: { [Q]: ['learner'] }, teams: [{ teamId: 't-depot', role: 'member' }], status: 'invited', joinedDaysAgo: 2, source: 'invite' },
  { id: 'u-sven', name: 'Sven Aalto', email: 'sven.aalto@quillmoor.example', title: 'SRE (left)', orgs: { [Q]: ['learner'] }, teams: [], status: 'deactivated', lastLoginDaysAgo: 34, joinedDaysAgo: 118 },
  // Acme Freight
  { id: 'u-ray', name: 'Raymond Okafor', email: 'raymond.okafor@acmefreight.example', title: 'IT manager', orgs: { [A]: ['learner', 'manager', 'org_admin'] }, teams: [{ teamId: 't-acme-it', role: 'manager' }], lastLoginDaysAgo: 1, joinedDaysAgo: 33, source: 'local', skills: [0.35, 0.3, 0.25, 0.2, 0.3, 0.55, 0.5, 0.6, 0.4, 0.38, 0.42] },
  { id: 'u-june', name: 'June Park', email: 'june.park@acmefreight.example', title: 'Systems administrator', orgs: { [A]: ['learner'] }, teams: [{ teamId: 't-acme-it', role: 'member' }], lastLoginDaysAgo: 0, joinedDaysAgo: 30, source: 'local', skills: [0.2, 0.15, 0.2, 0.1, 0.25, 0.6, 0.55, 0.62, 0.3, 0.25, 0.3] },
  { id: 'u-nate', name: 'Nate Kowalski', email: 'nate.kowalski@acmefreight.example', title: 'Network administrator', orgs: { [A]: ['learner'] }, teams: [{ teamId: 't-acme-it', role: 'member' }], lastLoginDaysAgo: 5, joinedDaysAgo: 28, source: 'local', skills: [0.1, 0.1, 0.2, 0.05, 0.15, 0.4, 0.3, 0.45, 0.7, 0.62, 0.5] },
  { id: 'u-ivy', name: 'Ivy Chen', email: 'ivy.chen@acmefreight.example', title: 'Training lead', orgs: { [A]: ['learner', 'instructor', 'author'] }, teams: [{ teamId: 't-acme-it', role: 'member' }], lastLoginDaysAgo: 0, joinedDaysAgo: 31, source: 'local', skills: [0.5, 0.45, 0.4, 0.35, 0.5, 0.6, 0.5, 0.65, 0.35, 0.3, 0.4] },
  // AzarGuard operator (platform admin); member of Acme Freight as org admin and of Quillmoor through support access.
  { id: 'u-elin', name: 'Elin Marsh', email: 'elin.marsh@azarguard.example', title: 'Platform operations, AzarGuard', orgs: { [A]: ['org_admin'], [Q]: ['org_admin'] }, teams: [], platformAdmin: true, lastLoginDaysAgo: 0, joinedDaysAgo: 120, source: 'seed', skills: [0.6, 0.6, 0.5, 0.5, 0.6, 0.7, 0.6, 0.7, 0.4, 0.4, 0.5] },
];

export const personById = new Map(people.map((p) => [p.id, p]));
export const userRef = (id: string): UserRef => {
  const p = personById.get(id);
  return p ? { id: p.id, name: p.name, email: p.email, title: p.title } : { id, name: id, email: `${id}@example` };
};
const teamsOf = (p: PersonSeed, orgId: string) => p.teams.filter((t) => teamSeeds.find((s) => s.id === t.teamId)?.orgId === orgId);
export const membersOfTeam = (teamId: string) => people.filter((p) => p.status !== 'deactivated' && p.teams.some((t) => t.teamId === teamId));

/* ================================================================ permissions */

const ROLE_PERMS: Record<Role, Permission[]> = {
  learner: ['lab.run', 'progress.read.self'],
  manager: ['progress.read.team', 'assignment.manage', 'report.export', 'event.manage'],
  instructor: ['progress.read.team', 'assignment.manage', 'report.export', 'session.observe', 'session.control', 'cohort.manage', 'event.manage'],
  author: ['studio.author', 'content.publish'],
  org_admin: ['progress.read.team', 'assignment.manage', 'report.export', 'session.observe', 'session.control', 'cohort.manage', 'event.manage', 'studio.author', 'content.publish', 'content.visibility', 'user.manage', 'team.manage', 'role.assign', 'sso.manage', 'settings.manage', 'quota.manage', 'audit.read'],
  platform_admin: ['org.manage', 'capacity.read', 'support.access'],
};
const ALL_PERMS = Array.from(new Set(Object.values(ROLE_PERMS).flat()));

export function permissionsFor(roles: Role[]): Permission[] {
  if (roles.includes('platform_admin')) return ALL_PERMS;
  const out = new Set<Permission>(ROLE_PERMS.learner);
  roles.forEach((r) => ROLE_PERMS[r].forEach((p) => out.add(p)));
  return ALL_PERMS.filter((p) => out.has(p));
}

export function grantsFor(roles: Role[], managed: string[], cohorts: string[]): PermissionGrant[] {
  const org = roles.includes('org_admin') || roles.includes('platform_admin');
  return permissionsFor(roles).map((permission) => {
    if (['org.manage', 'capacity.read', 'support.access'].includes(permission)) return { permission, scope: 'platform' };
    if (permission === 'lab.run' || permission === 'progress.read.self') return { permission, scope: 'self' };
    if (org) return { permission, scope: 'org' };
    if (['session.observe', 'session.control', 'cohort.manage'].includes(permission)) return { permission, scope: permission === 'cohort.manage' ? 'own' : 'cohort', cohortIds: cohorts };
    if (permission === 'content.publish') return { permission, scope: 'pilot' };
    if (permission === 'studio.author' || permission === 'event.manage') return { permission, scope: 'org' };
    if (roles.includes('instructor') && !roles.includes('manager')) return { permission, scope: 'cohort', cohortIds: cohorts };
    return { permission, scope: 'team', teamIds: managed };
  });
}

/* ================================================================ personas (dev switcher) */

export interface Persona {
  id: string;
  userId: string;
  orgId: string;
  label: string;
  /** What the persona demonstrates. */
  hint: string;
}
export const personas: Persona[] = [
  { id: 'learner', userId: 'u-lena', orgId: Q, label: 'Learner', hint: 'Lena Varga · Junior SRE' },
  { id: 'new_learner', userId: 'u-noor', orgId: Q, label: 'New learner', hint: 'Noor Aziz · no history yet' },
  { id: 'manager', userId: 'u-ingrid', orgId: Q, label: 'Manager', hint: 'Ingrid Solvang · two teams' },
  { id: 'instructor', userId: 'u-samir', orgId: Q, label: 'Instructor', hint: 'Samir Haddad · CKS bootcamp' },
  { id: 'author', userId: 'u-aino', orgId: Q, label: 'Author', hint: 'Aino Lehto · Scenario Studio' },
  { id: 'org_admin', userId: 'u-priya', orgId: Q, label: 'Org admin', hint: 'Priya Natarajan · Quillmoor' },
  { id: 'platform_admin', userId: 'u-elin', orgId: A, label: 'Platform admin', hint: 'Elin Marsh · AzarGuard' },
];
export const DEFAULT_PERSONA = 'manager';

/* ================================================================ cohorts */

interface CohortSeed extends Cohort {
  orgId: string;
  memberIds: string[];
}
const cksLabs = paths.find((p) => p.id === 'cks-readiness')!.labIds;
const lfcsLabs = paths.find((p) => p.id === 'lfcs-sysadmin')!.labIds;
const ckaLabs = paths.find((p) => p.id === 'cka-foundations')!.labIds;

export const cohortSeeds: CohortSeed[] = [
  { id: 'c-cks-q4', orgId: Q, name: 'CKS bootcamp · Q4', startsAt: ago(6 * DAY), endsAt: ahead(22 * DAY), status: 'live', instructors: [userRef('u-samir')], memberCount: 6, pathId: 'cks-readiness', labIds: cksLabs, createdBy: userRef('u-samir'), memberIds: ['u-lena', 'u-tomas', 'u-kofi', 'u-mira', 'u-aino', 'u-bram'] },
  { id: 'c-lfcs-nov', orgId: Q, name: 'LFCS fundamentals · November', startsAt: ahead(12 * DAY), endsAt: ahead(40 * DAY), status: 'upcoming', instructors: [userRef('u-samir')], memberCount: 4, pathId: 'lfcs-sysadmin', labIds: lfcsLabs, createdBy: userRef('u-samir'), memberIds: ['u-greta', 'u-dana', 'u-olu', 'u-yuki'] },
  { id: 'c-cka-sep', orgId: Q, name: 'CKA sprint · September', startsAt: ago(50 * DAY), endsAt: ago(29 * DAY), status: 'ended', instructors: [userRef('u-samir'), userRef('u-priya')], memberCount: 5, pathId: 'cka-foundations', labIds: ckaLabs, createdBy: userRef('u-priya'), memberIds: ['u-tomas', 'u-kofi', 'u-mira', 'u-ravi', 'u-dana'] },
  { id: 'c-acme-onboard', orgId: A, name: 'Acme IT onboarding', startsAt: ago(3 * DAY), endsAt: ahead(25 * DAY), status: 'live', instructors: [userRef('u-ivy')], memberCount: 2, pathId: 'lfcs-sysadmin', labIds: lfcsLabs, createdBy: userRef('u-ivy'), memberIds: ['u-june', 'u-nate'] },
];
export const toCohort = ({ orgId: _o, memberIds: _m, ...c }: CohortSeed): Cohort => c;

/* ================================================================ attempts */

const labTitle = (id: string) => labSummaries.find((l) => l.id === id)?.title ?? id;

/** Deterministic attempt history per user (richer for the sample team). */
export function attemptsFor(userId: string): Attempt[] {
  const p = personById.get(userId);
  if (!p || p.status === 'invited') return [];
  if (userId === 'u-noor') {
    // Opened the same lab twice, never validated; both environments expired after an hour.
    const lab = labSummaries.find((l) => l.id === 'orchard-netpol-isolation')!;
    return [50, 50.1].map((hoursAgo, i) => {
      const startedAt = ago(Math.round(hoursAgo * HOUR));
      return { id: `att-noor-${i}`, labId: lab.id, labTitle: lab.title, labVersion: lab.version ?? 1, sessionName: `ls-orchard-netp-noor${i}`, startedAt, endedAt: new Date(new Date(startedAt).getTime() + 3600_000).toISOString(), outcome: 'abandoned' as const, score: 0, hintsUsed: 0, validations: 0, durationS: 3600, practiceS: 0, checksPassed: 0, checksTotal: 5 };
    });
  }
  const n = userId === 'u-ingrid' ? 14 : 4 + Math.round(seeded(`${userId}:n`) * 9);
  const out: Attempt[] = [];
  // Generated history uses the end-state labs; CTF attempts are added explicitly below.
  const pool = labSummaries.filter((l) => !l.questionCount);
  for (let i = 0; i < n; i++) {
    const r = seeded(`${userId}:att:${i}`);
    const lab = pool[Math.floor(seeded(`${userId}:lab:${i}`) * pool.length)]!;
    const daysAgo = Math.round(r * 58) + (i === 0 ? 0 : 1);
    const checks = 3 + Math.floor(seeded(`${userId}:chk:${i}`) * 3);
    const q = seeded(`${userId}:q:${i}`);
    const outcome: AttemptOutcome = q > 0.55 ? 'passed' : q > 0.3 ? 'partial' : q > 0.15 ? 'failed' : 'abandoned';
    const passed = outcome === 'passed' ? checks : outcome === 'partial' ? Math.max(1, Math.floor(checks * 0.6)) : outcome === 'failed' ? Math.floor(checks * 0.25) : 0;
    const hints = Math.floor(seeded(`${userId}:h:${i}`) * 3);
    const score = outcome === 'abandoned' ? 0 : Math.max(0, Math.round((passed / checks) * 100) - hints * 4);
    const durationS = Math.round((lab.estimatedMinutes * (0.6 + seeded(`${userId}:d:${i}`) * 1.1)) * 60);
    const startedAt = ago(daysAgo * DAY + Math.round(seeded(`${userId}:t:${i}`) * 10) * HOUR);
    const validations = 1 + Math.floor(seeded(`${userId}:v:${i}`) * 4);
    out.push({
      id: `att-${userId.slice(2)}-${i}`,
      labId: lab.id,
      labTitle: lab.title,
      labVersion: lab.version ?? 1,
      sessionName: `ls-${lab.id.slice(0, 12)}-${seeded(`${userId}:s:${i}`).toString(36).slice(2, 7)}`,
      startedAt,
      endedAt: new Date(new Date(startedAt).getTime() + durationS * 1000).toISOString(),
      outcome,
      score,
      hintsUsed: hints,
      validations,
      durationS,
      // Graded time ends at the last Validate; the environment usually runs a while longer.
      practiceS: outcome === 'abandoned' && validations < 2 ? 0 : Math.round(durationS * (0.55 + seeded(`${userId}:p:${i}`) * 0.4)),
      checksPassed: passed,
      checksTotal: checks,
    });
  }
  const ctf = ctfAttemptOf(userId);
  if (ctf) out.push(ctf);
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** A solo CTF attempt (questions answered in the lab view) for the sample learners. */
function ctfAttemptOf(userId: string): Attempt | undefined {
  if (!['u-lena', 'u-ingrid', 'u-tomas'].includes(userId)) return undefined;
  const lab = labSummaries.find((l) => l.id === 'quill-ctf-gateway-breach')!;
  const startedAt = ago(2 * DAY + 3 * HOUR);
  const solved = userId === 'u-tomas' ? 5 : 4;
  const earned = userId === 'u-tomas' ? 530 : 390;
  return {
    id: `att-${userId.slice(2)}-ctf`,
    labId: lab.id,
    labTitle: lab.title,
    labVersion: 1,
    sessionName: `ls-quill-ctf-ga-${userId.slice(2, 6)}`,
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + 24 * 60_000).toISOString(),
    outcome: solved === 5 ? 'passed' : 'partial',
    score: Math.round((solved / 5) * 100),
    hintsUsed: 2,
    validations: 1,
    durationS: 24 * 60,
    practiceS: 21 * 60,
    checksPassed: 1,
    checksTotal: 1,
    points: { earned, possible: 600, solved, total: 5 },
  };
}

/** Personal CTF points from the mock attempts (best per lab), as GET /skills returns them. */
export function ctfTotalsOf(userId: string): { points: number; solved: number; labs: number } | undefined {
  const a = attemptsFor(userId).filter((x) => x.points);
  if (!a.length) return undefined;
  return { points: a.reduce((n, x) => n + x.points!.earned, 0), solved: a.reduce((n, x) => n + x.points!.solved, 0), labs: new Set(a.map((x) => x.labId)).size };
}

/** Practice minutes (graded time) in attempts started in the last `days` days: the gateway's single measure of learner time. */
export const practiceMinutes = (userId: string, days: number) => Math.round(attemptsFor(userId).filter((a) => NOW - new Date(a.startedAt).getTime() < days * DAY).reduce((s, a) => s + a.practiceS / 60, 0));
const minutesThisMonth = (userId: string) => practiceMinutes(userId, 30);
/** Environment minutes (session lifetime): quota accounting only. */
const environmentMinutesThisMonth = (userId: string) => Math.round(attemptsFor(userId).filter((a) => NOW - new Date(a.startedAt).getTime() < 30 * DAY).reduce((s, a) => s + a.durationS / 60, 0));

/* ================================================================ assignments */

interface AssignmentSeed {
  id: string;
  orgId: string;
  target: AssignmentTarget;
  item: AssignmentItem;
  dueAt: string | null;
  required: boolean;
  note?: string;
  assignedBy: string;
  createdAt: string;
}

const itemLab = (id: string): AssignmentItem => ({ kind: 'lab', id, title: labTitle(id), labIds: [id] });
const itemPath = (id: string): AssignmentItem => {
  const p = paths.find((x) => x.id === id)!;
  return { kind: 'path', id, title: p.title, labIds: p.labIds };
};
const itemFramework = (id: 'cka' | 'cks' | 'lfcs' | 'ccna'): AssignmentItem => {
  const fw = frameworks.find((f) => f.id === id)!;
  const p = paths.find((x) => x.framework === id);
  return { kind: 'framework', id, title: `${fw.name} readiness`, labIds: p?.labIds ?? [] };
};

export const assignmentSeeds: AssignmentSeed[] = [
  { id: 'as-1', orgId: Q, target: { kind: 'team', id: 't-platrel', name: 'Platform Reliability' }, item: itemPath('cks-readiness'), dueAt: ahead(20 * DAY), required: true, note: 'Exam vouchers are booked for early December.', assignedBy: 'u-ingrid', createdAt: ago(18 * DAY) },
  { id: 'as-2', orgId: Q, target: { kind: 'team', id: 't-platrel', name: 'Platform Reliability' }, item: itemLab('orchard-etcd-snapshot-restore'), dueAt: ago(3 * DAY), required: true, note: 'Follow-up to the October incident review.', assignedBy: 'u-ingrid', createdAt: ago(16 * DAY) },
  { id: 'as-3', orgId: Q, target: { kind: 'team', id: 't-edge', name: 'Edge Network' }, item: itemFramework('ccna'), dueAt: ahead(45 * DAY), required: false, assignedBy: 'u-ingrid', createdAt: ago(10 * DAY) },
  { id: 'as-4', orgId: Q, target: { kind: 'user', id: 'u-lena', name: 'Lena Varga' }, item: itemLab('harbor-ssh-key-only'), dueAt: ahead(2 * DAY), required: true, note: 'Before you join the on-call rotation.', assignedBy: 'u-ingrid', createdAt: ago(5 * DAY) },
  { id: 'as-5', orgId: Q, target: { kind: 'team', id: 't-edge', name: 'Edge Network' }, item: itemLab('edge-ospf-convergence'), dueAt: ahead(10 * DAY), required: true, assignedBy: 'u-ingrid', createdAt: ago(4 * DAY) },
  { id: 'as-6', orgId: Q, target: { kind: 'cohort', id: 'c-cks-q4', name: 'CKS bootcamp · Q4' }, item: itemLab('orchard-netpol-isolation'), dueAt: ahead(1 * DAY), required: true, note: 'Day-2 exercise; we debrief on Thursday.', assignedBy: 'u-samir', createdAt: ago(2 * DAY) },
  { id: 'as-7', orgId: Q, target: { kind: 'team', id: 't-data', name: 'Data Platform' }, item: itemPath('lfcs-sysadmin'), dueAt: null, required: false, assignedBy: 'u-ravi', createdAt: ago(20 * DAY) },
  { id: 'as-8', orgId: Q, target: { kind: 'team', id: 't-platrel', name: 'Platform Reliability' }, item: itemLab('quill-lvm-extend'), dueAt: ago(12 * DAY), required: false, assignedBy: 'u-ingrid', createdAt: ago(30 * DAY) },
  { id: 'as-9', orgId: A, target: { kind: 'team', id: 't-acme-it', name: 'IT Operations' }, item: itemPath('lfcs-sysadmin'), dueAt: ahead(30 * DAY), required: true, assignedBy: 'u-ray', createdAt: ago(3 * DAY) },
];

/** Does an assignment target cover this user? */
function covers(a: AssignmentSeed, userId: string): boolean {
  const p = personById.get(userId);
  if (!p) return false;
  if (a.target.kind === 'user') return a.target.id === userId;
  if (a.target.kind === 'team') return p.teams.some((t) => t.teamId === a.target.id);
  return cohortSeeds.find((c) => c.id === a.target.id)?.memberIds.includes(userId) ?? false;
}

/** Per user x assignment status, derived from the user's attempt history (stable). */
export function statusFor(a: AssignmentSeed, userId: string): { status: AssignmentState; progress: number; completedAt?: string; bestScore?: number } {
  const attempts = attemptsFor(userId);
  const labIds = a.item.labIds ?? [];
  const passed = labIds.filter((id) => attempts.some((x) => x.labId === id && x.outcome === 'passed'));
  const touched = labIds.filter((id) => attempts.some((x) => x.labId === id));
  // The seeded histories rarely cover a whole path; nudge a share of users to completion so every state shows up.
  const lucky = seeded(`${a.id}:${userId}:done`) > 0.72;
  const progress = labIds.length === 0 ? 0 : lucky ? 1 : passed.length / labIds.length;
  const overdue = !!a.dueAt && new Date(a.dueAt).getTime() < NOW;
  if (progress >= 1) {
    const best = attempts.filter((x) => labIds.includes(x.labId)).map((x) => x.score);
    return { status: 'completed', progress: 1, completedAt: ago((1 + Math.round(seeded(`${a.id}:${userId}:c`) * 9)) * DAY), bestScore: best.length ? Math.max(...best) : 88 };
  }
  if (overdue) return { status: 'overdue', progress: round2(progress) };
  if (touched.length > 0 || progress > 0) return { status: 'in_progress', progress: round2(Math.max(progress, 0.1)) };
  return { status: 'not_started', progress: 0 };
}

export function assignedUsers(a: AssignmentSeed): string[] {
  return people.filter((p) => p.status !== 'deactivated' && covers(a, p.id)).map((p) => p.id);
}

export function toAssignment(a: AssignmentSeed): Assignment {
  const counts: Record<AssignmentState, number> = { not_started: 0, in_progress: 0, completed: 0, overdue: 0 };
  assignedUsers(a).forEach((u) => counts[statusFor(a, u).status]++);
  return { id: a.id, target: a.target, item: a.item, dueAt: a.dueAt, required: a.required, note: a.note, assignedBy: userRef(a.assignedBy), createdAt: a.createdAt, counts };
}

export function myAssignments(userId: string): MyAssignment[] {
  return assignmentSeeds
    .filter((a) => covers(a, userId))
    .map((a) => ({ id: a.id, item: a.item, via: a.target, dueAt: a.dueAt, required: a.required, note: a.note, assignedBy: userRef(a.assignedBy), createdAt: a.createdAt, ...statusFor(a, userId) }))
    .sort((x, y) => (x.dueAt ?? '9').localeCompare(y.dueAt ?? '9'));
}

/* ================================================================ users (admin) */

export function orgUser(p: PersonSeed, orgId: string): OrgUser {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    title: p.title,
    roles: p.orgs[orgId] ?? [],
    status: p.status ?? 'active',
    teams: teamsOf(p, orgId).map((t) => ({ ...teamRef(t.teamId), role: t.role })),
    cohorts: cohortSeeds.filter((c) => c.orgId === orgId && c.memberIds.includes(p.id)).map((c) => ({ id: c.id, name: c.name })),
    lastLoginAt: p.lastLoginDaysAgo === undefined ? undefined : ago(p.lastLoginDaysAgo * DAY + 3 * HOUR),
    invitedBy: p.source === 'invite' ? userRef('u-priya') : undefined,
    joinedAt: ago((p.joinedDaysAgo ?? 30) * DAY),
    source: p.source ?? (orgId === Q ? 'sso' : 'local'),
    idp: orgId === Q && p.source !== 'invite' ? 'quillmoor-entra' : undefined,
  };
}

export const usersOfOrg = (orgId: string) => people.filter((p) => p.orgs[orgId]).map((p) => orgUser(p, orgId));

export const invitations: Invitation[] = [
  { id: 'inv-1', email: 'hugo.marchetti@quillmoor.example', roles: ['learner'], teams: [{ teamId: 't-depot', role: 'member' }], invitedBy: userRef('u-priya'), createdAt: ago(2 * DAY), expiresAt: ahead(5 * DAY), status: 'pending' },
  { id: 'inv-2', email: 'nadia.rahimi@quillmoor.example', roles: ['learner', 'instructor'], teams: [{ teamId: 't-platrel', role: 'member' }], invitedBy: userRef('u-priya'), createdAt: ago(9 * DAY), expiresAt: ago(2 * DAY), status: 'expired' },
];

/* ================================================================ teams (admin + manager) */

export function toTeam(seed: TeamSeed): Team {
  const members = membersOfTeam(seed.id);
  return { id: seed.id, name: seed.name, parentId: seed.parentId, memberCount: members.length, managers: members.filter((m) => m.teams.find((t) => t.teamId === seed.id)?.role === 'manager').map((m) => userRef(m.id)), createdAt: ago(100 * DAY) };
}
export const teamsOfOrg = (orgId: string) => teamSeeds.filter((t) => t.orgId === orgId).map(toTeam);
export const teamSeedById = (id: string) => teamSeeds.find((t) => t.id === id);

export function teamDetail(id: string): TeamDetail | undefined {
  const seed = teamSeeds.find((t) => t.id === id);
  if (!seed) return undefined;
  return {
    ...toTeam(seed),
    members: membersOfTeam(id).map((m) => ({ user: userRef(m.id), role: m.teams.find((t) => t.teamId === id)!.role })),
    children: teamSeeds.filter((t) => t.parentId === id).map((t) => ({ id: t.id, name: t.name })),
  };
}

/** Teams whose progress a user may read: managed teams, or every team of the org for org-wide grants. */
export function viewableTeams(userId: string, orgId: string): TeamRef[] {
  const p = personById.get(userId);
  if (!p) return [];
  const roles = p.orgs[orgId] ?? [];
  if (roles.includes('org_admin') || p.platformAdmin) return teamsOfOrg(orgId).map((t) => ({ id: t.id, name: t.name }));
  return teamsOf(p, orgId)
    .filter((t) => t.role === 'manager')
    .map((t) => teamRef(t.teamId));
}

/* ================================================================ mastery */

const competencies = teamData.competencies;
const sampleMember = (id: string) => teamData.members.find((m) => m.id === id);

/** Competency mastery for anyone: the sample team keeps its data, everyone else comes from their seed. */
export function masteryOf(userId: string): Record<string, number | null> {
  const s = sampleMember(userId);
  if (s) return { ...s.skills };
  const p = personById.get(userId);
  if (!p?.skills) return Object.fromEntries(competencies.map((c) => [c.id, null]));
  return Object.fromEntries(competencies.map((c, i) => [c.id, p.skills![i] ?? null]));
}

export function skillStatesOf(userId: string): SkillState[] {
  const known = memberSkillStates(userId);
  if (known) return known;
  const mastery = masteryOf(userId);
  const byPrefix = (skillId: string) => {
    const key = skillId.split('.').slice(0, 2).join('.');
    const comp = competencies.find((c) => c.id.endsWith(key.replace('k8s.wl', 'k8s.arch').replace('k8s.storage', 'k8s.arch').replace('linux.cmd', 'linux.ops').replace('linux.net', 'linux.ops').replace('net.svc', 'net.l3')));
    return comp ? (mastery[comp.id] ?? 0.3) : 0.3;
  };
  return skillStates.map((st) => {
    const base = byPrefix(st.skillId);
    const r = seeded(`${userId}:${st.skillId}`);
    return { ...st, mu: round2(Math.max(0.05, Math.min(0.97, base + (r - 0.5) * 0.2))), sigma: round2(0.12 + r * 0.2), evidence: base < 0.12 ? 0 : Math.round(1 + r * 10) };
  });
}

export function readinessOf(userId: string): Partial<Record<'cka' | 'cks' | 'lfcs' | 'ccna', number>> {
  const states = skillStatesOf(userId);
  return Object.fromEntries(frameworks.map((f) => [f.id, round2(frameworkReadiness(f, states).readiness)]));
}

function dashboardMember(userId: string, teamId: string): DashboardMember {
  const p = personById.get(userId)!;
  const mine = myAssignments(userId);
  const overdue = mine.filter((a) => a.status === 'overdue').length;
  const soon = mine.some((a) => a.status === 'not_started' && a.required && a.dueAt && new Date(a.dueAt).getTime() - NOW < 3 * DAY);
  const attempts = attemptsFor(userId);
  return {
    user: userRef(userId),
    role: p.teams.find((t) => t.teamId === teamId)?.role ?? 'member',
    mastery: masteryOf(userId),
    readiness: readinessOf(userId),
    minutesThisMonth: minutesThisMonth(userId),
    minutesThisWeek: practiceMinutes(userId, 7),
    attemptsThisMonth: attempts.filter((a) => NOW - new Date(a.startedAt).getTime() < 30 * DAY).length,
    lastActiveAt: attempts[0]?.startedAt,
    assignments: { total: mine.length, completed: mine.filter((a) => a.status === 'completed').length, overdue, inProgress: mine.filter((a) => a.status === 'in_progress').length },
    atRisk: overdue > 0 || soon,
  };
}

export function teamDashboard(teamId: string, viewerId: string, orgId: string): TeamDashboard | undefined {
  const seed = teamSeeds.find((t) => t.id === teamId);
  if (!seed) return undefined;
  const memberIds = membersOfTeam(teamId).map((m) => m.id);
  const members = memberIds.map((id) => dashboardMember(id, teamId));
  const fws = frameworks.map((f) => {
    const vals = members.map((m) => m.readiness[f.id] ?? 0);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { frameworkId: f.id, name: f.name, readiness: round2(mean), ready: vals.filter((v) => v >= 0.7).length, members: vals.length };
  });
  const atRisk = assignmentSeeds
    .flatMap((a) =>
      assignedUsers(a)
        .filter((u) => memberIds.includes(u))
        .map((u) => ({ a, u, s: statusFor(a, u) })),
    )
    .filter(({ a, s }) => s.status === 'overdue' || (s.status === 'not_started' && a.dueAt && new Date(a.dueAt).getTime() - NOW < 3 * DAY) || (s.status === 'in_progress' && a.required && a.dueAt && new Date(a.dueAt).getTime() - NOW < 2 * DAY))
    .map(({ a, u, s }) => ({ user: userRef(u), assignmentId: a.id, item: a.item, dueAt: a.dueAt, status: s.status, reason: (s.status === 'overdue' ? 'overdue' : s.status === 'not_started' ? 'due_soon_not_started' : 'stalled') as 'overdue' | 'due_soon_not_started' | 'stalled' }))
    .sort((x, y) => (x.dueAt ?? '9').localeCompare(y.dueAt ?? '9'));
  const allAssignments = members.reduce((s, m) => s + m.assignments.total, 0);
  const completed = members.reduce((s, m) => s + m.assignments.completed, 0);
  const minutesByWeek = Array.from({ length: 8 }, (_, i) => {
    const weekStart = new Date(NOW - (7 - i) * 7 * DAY);
    weekStart.setUTCHours(0, 0, 0, 0);
    const minutes = memberIds.reduce((s, u) => s + attemptsFor(u).filter((a) => Math.floor((NOW - new Date(a.startedAt).getTime()) / (7 * DAY)) === 7 - i).reduce((x, a) => x + a.practiceS / 60, 0), 0);
    return { weekStart: weekStart.toISOString().slice(0, 10), minutes: Math.round(minutes) };
  });
  return {
    team: toTeam(seed),
    teams: viewableTeams(viewerId, orgId),
    competencies,
    members,
    frameworks: fws,
    minutesByWeek,
    totals: {
      members: members.length,
      activeThisWeek: members.filter((m) => m.minutesThisWeek > 0).length,
      minutesThisMonth: members.reduce((s, m) => s + m.minutesThisMonth, 0),
      assignmentsOverdue: members.reduce((s, m) => s + m.assignments.overdue, 0),
      completionRate: allAssignments ? round2(completed / allAssignments) : 0,
    },
    atRisk,
    source: members.length ? 'live' : 'empty',
    generatedAt: new Date().toISOString(),
  };
}

export function memberDetail(teamId: string, userId: string): MemberDetail | undefined {
  const p = personById.get(userId);
  const team = teamSeeds.find((t) => t.id === teamId);
  if (!p || !team || !p.teams.some((t) => t.teamId === teamId)) return undefined;
  return {
    user: { ...userRef(userId), lastLoginAt: p.lastLoginDaysAgo === undefined ? undefined : ago(p.lastLoginDaysAgo * DAY) },
    team: { id: team.id, name: team.name },
    role: p.teams.find((t) => t.teamId === teamId)!.role,
    skills: skillStatesOf(userId),
    mastery: masteryOf(userId),
    readiness: readinessOf(userId),
    attempts: attemptsFor(userId),
    assignments: myAssignments(userId),
    minutesThisMonth: minutesThisMonth(userId),
    minutesThisWeek: practiceMinutes(userId, 7),
  };
}

/* ================================================================ live sessions + cohort boards */

interface LiveSeed {
  id: string;
  userId: string;
  labId: string;
  phase: SessionPhase;
  startedMinAgo: number;
  checksPassed: number;
  checksTotal: number;
  hintsUsed: number;
  validations: number;
  stuck?: string;
  observedBy?: string[];
  deadlineMinutes?: number;
}
export const liveSeeds: LiveSeed[] = [
  { id: 'ls-lena-netpol', userId: 'u-lena', labId: 'orchard-netpol-isolation', phase: 'ready', startedMinAgo: 38, checksPassed: 1, checksTotal: 5, hintsUsed: 2, validations: 6, stuck: 'No new check passed in 19 min; 4 failing validates in a row' },
  { id: 'ls-tomas-netpol', userId: 'u-tomas', labId: 'orchard-netpol-isolation', phase: 'ready', startedMinAgo: 31, checksPassed: 3, checksTotal: 5, hintsUsed: 0, validations: 2 },
  { id: 'ls-kofi-rbac', userId: 'u-kofi', labId: 'ledger-rbac-least-privilege', phase: 'provisioning', startedMinAgo: 1, checksPassed: 0, checksTotal: 4, hintsUsed: 0, validations: 0 },
  { id: 'ls-mira-psa', userId: 'u-mira', labId: 'orchard-psa-baseline', phase: 'grading', startedMinAgo: 12, checksPassed: 3, checksTotal: 4, hintsUsed: 1, validations: 3 },
  { id: 'ls-bram-netpol', userId: 'u-bram', labId: 'orchard-netpol-isolation', phase: 'hibernated', startedMinAgo: 95, checksPassed: 2, checksTotal: 5, hintsUsed: 3, validations: 5, stuck: 'Idle for 40 min, 3 hints used' },
  { id: 'ls-dana-lvm', userId: 'u-dana', labId: 'quill-lvm-extend', phase: 'ready', startedMinAgo: 9, checksPassed: 1, checksTotal: 3, hintsUsed: 0, validations: 1 },
  { id: 'ls-greta-ssh', userId: 'u-greta', labId: 'harbor-ssh-key-only', phase: 'ready', startedMinAgo: 22, checksPassed: 2, checksTotal: 3, hintsUsed: 0, validations: 2 },
  { id: 'ls-june-lvm', userId: 'u-june', labId: 'quill-lvm-extend', phase: 'ready', startedMinAgo: 15, checksPassed: 0, checksTotal: 3, hintsUsed: 1, validations: 2 },
];

export function liveSession(s: LiveSeed): LiveSession {
  const lab = labSummaries.find((l) => l.id === s.labId)!;
  const deadline = s.deadlineMinutes ?? lab.estimatedMinutes * 2;
  return {
    id: s.id,
    user: userRef(s.userId),
    labId: s.labId,
    labTitle: lab.title,
    phase: s.phase,
    startedAt: ago(s.startedMinAgo * 60_000),
    expiresAt: new Date(NOW - s.startedMinAgo * 60_000 + deadline * 60_000).toISOString(),
    score: Math.max(0, Math.round((s.checksPassed / s.checksTotal) * 100) - s.hintsUsed * 4),
    checksPassed: s.checksPassed,
    checksTotal: s.checksTotal,
    observedBy: (s.observedBy ?? []).map(userRef),
  };
}

export function liveSessionsOf(orgId: string): LiveSession[] {
  return liveSeeds.filter((s) => personById.get(s.userId)?.orgs[orgId]).map(liveSession);
}

export function cohortBoard(cohortId: string): CohortBoard | undefined {
  const c = cohortSeeds.find((x) => x.id === cohortId);
  if (!c) return undefined;
  const rows: CohortBoardRow[] = c.memberIds.map((u) => {
    const seed = liveSeeds.find((s) => s.userId === u && c.labIds.includes(s.labId));
    const attempts = attemptsFor(u);
    const passed = c.labIds.filter((id) => attempts.some((a) => a.labId === id && a.outcome === 'passed')).length;
    const session = seed ? { ...liveSession(seed), hintsUsed: seed.hintsUsed, validations: seed.validations, minutesOnTask: seed.phase === 'hibernated' ? 55 : seed.startedMinAgo, stuck: !!seed.stuck, stuckReason: seed.stuck } : null;
    return { user: userRef(u), session, lastAttempt: attempts[0], progress: { labsPassed: Math.min(passed + (u === 'u-aino' ? 3 : 0), c.labIds.length), labsTotal: c.labIds.length } };
  });
  return { cohort: toCohort(c), rows, generatedAt: new Date().toISOString() };
}

/* ================================================================ SSO */

export const ssoByOrg: Record<string, SsoConnection[]> = {
  [Q]: [
    {
      id: 'sso-1',
      alias: 'quillmoor-entra',
      type: 'oidc',
      displayName: 'Microsoft Entra ID',
      status: 'active',
      enforced: true,
      oidc: { discoveryUrl: 'https://login.microsoftonline.example/5d2c0e7a-quillmoor/v2.0/.well-known/openid-configuration', clientId: '3f8c1a2e-7b4d-4e9a-9c6f-quillmoor', hasClientSecret: true, scopes: ['openid', 'profile', 'email'], roleClaim: 'roles' },
      groupMappings: [
        { group: 'CloudTrain.Learner', roles: ['learner'], teams: [] },
        { group: 'CloudTrain.Manager', roles: ['manager'], teams: [] },
        { group: 'CloudTrain.Instructor', roles: ['instructor'], teams: [] },
        { group: 'CloudTrain.Author', roles: ['author'], teams: [] },
        { group: 'CloudTrain.OrgAdmin', roles: ['org_admin'], teams: [] },
        { group: 'SG-Platform-Reliability', roles: ['learner'], teams: [{ teamId: 't-platrel', role: 'member' }] },
        { group: 'SG-Edge-Network', roles: ['learner'], teams: [{ teamId: 't-edge', role: 'member' }] },
      ],
      defaultRoles: ['learner'],
      createdAt: ago(41 * DAY),
      updatedAt: ago(6 * DAY),
      lastTest: { ok: true, checkedAt: ago(6 * DAY), steps: [{ name: 'Discovery document', ok: true, detail: 'issuer https://login.microsoftonline.example/5d2c0e7a-quillmoor/v2.0' }, { name: 'JWKS reachable', ok: true, detail: '6 signing keys' }, { name: 'Client credentials', ok: true }, { name: 'Role claim present', ok: true, detail: 'roles: ["CloudTrain.OrgAdmin"]' }], loginUrl: '/api/auth/login?org=quillmoor&idp=quillmoor-entra' },
    },
    {
      id: 'sso-2',
      alias: 'quillmoor-depot-okta',
      type: 'saml',
      displayName: 'Okta (Depot contractors)',
      status: 'draft',
      enforced: false,
      saml: { metadataUrl: 'https://depot-contractors.okta.example/app/exk9q2/sso/saml/metadata', entityId: 'http://www.okta.example/exk9q2', groupAttribute: 'groups' },
      groupMappings: [{ group: 'depot-admins', roles: ['learner'], teams: [{ teamId: 't-depot', role: 'member' }] }],
      defaultRoles: ['learner'],
      createdAt: ago(3 * DAY),
      updatedAt: ago(1 * DAY),
      lastTest: { ok: false, checkedAt: ago(1 * DAY), steps: [{ name: 'Metadata download', ok: true, detail: '1 IdP descriptor' }, { name: 'Signing certificate', ok: true, detail: 'expires in 412 days' }, { name: 'Assertion test', ok: false, detail: 'SAML response has no `groups` attribute; the Okta app must release it' }] },
    },
  ],
  [A]: [],
};

/* ================================================================ content */

const packDomain = { 'pack-k8s-core': 'kubernetes', 'pack-linux-core': 'linux', 'pack-net-core': 'networking' } as const;
const packTitle = { 'pack-k8s-core': 'Kubernetes core', 'pack-linux-core': 'Linux administration', 'pack-net-core': 'Networking fundamentals' } as const;

export function contentVisibilityOf(orgId: string): ContentVisibility {
  const disabledLabs = orgId === Q ? new Set(['edge-acl-dmz']) : new Set(['orchard-audit-policy', 'orchard-etcd-snapshot-restore']);
  const disabledPacks = orgId === Q ? new Set<string>() : new Set(['pack-net-core']);
  return {
    packs: (Object.keys(packDomain) as (keyof typeof packDomain)[]).map((packId) => ({
      packId,
      title: packTitle[packId],
      domain: packDomain[packId],
      enabled: !disabledPacks.has(packId),
      labs: labSummaries.filter((l) => l.domain === packDomain[packId]).map((l) => ({ labId: l.id, title: l.title, enabled: !disabledLabs.has(l.id) })),
    })),
    pinnedPaths: orgId === Q ? ['cks-readiness', 'cka-foundations'] : ['lfcs-sysadmin'],
    paths: paths.map((p) => ({ id: p.id, title: p.title })),
  };
}

/* ================================================================ usage */

export function usageOf(orgId: string, from?: string, to?: string): Usage {
  const end = to ? new Date(to) : new Date(NOW);
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * DAY);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY) + 1);
  const scale = orgId === Q ? 1 : 0.22;
  const byDay = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const r = seeded(`${orgId}:usage:${d.toISOString().slice(0, 10)}`);
    const sessions = Math.round((weekend ? 1 + r * 3 : 6 + r * 14) * scale);
    return { date: d.toISOString().slice(0, 10), labHours: round2(sessions * (0.5 + r * 0.4)), sessions };
  });
  const labHours = round2(byDay.reduce((s, d) => s + d.labHours, 0));
  const monthStart = new Date(NOW);
  monthStart.setUTCDate(1);
  const thisMonth = round2(byDay.filter((d) => new Date(d.date).getTime() >= monthStart.getTime() - DAY).reduce((s, d) => s + d.labHours, 0));
  const members = usersOfOrg(orgId).filter((u) => u.status === 'active');
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    quotas: quotasByOrg[orgId]!,
    labHours,
    labHoursThisMonth: orgId === Q ? Math.max(thisMonth, 262) : thisMonth,
    sessions: byDay.reduce((s, d) => s + d.sessions, 0),
    activeUsers: members.length - 2,
    concurrentNow: liveSessionsOf(orgId).length,
    byDay,
    byLab: labSummaries
      .map((l) => ({ labId: l.id, title: l.title, sessions: Math.round((4 + seeded(`${orgId}:bylab:${l.id}`) * 30) * scale), labHours: 0 }))
      .map((x) => ({ ...x, labHours: round2(x.sessions * 0.6) }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 8),
    byTeam: teamsOfOrg(orgId)
      .filter((t) => t.memberCount > 0)
      .map((t) => ({ teamId: t.id, name: t.name, labHours: round2(membersOfTeam(t.id).reduce((s, m) => s + environmentMinutesThisMonth(m.id) / 60, 0)) })),
  };
}

/* ================================================================ audit */

interface AuditSeed {
  minutesAgo: number;
  actor: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  details?: Record<string, unknown>;
}
const auditSeeds: AuditSeed[] = [
  { minutesAgo: 4, actor: 'u-samir', action: 'session.observe', targetType: 'session', targetId: 'ls-lena-netpol', targetLabel: 'Lena Varga · Isolate the payments namespace', details: { learner: 'u-lena', cohort: 'c-cks-q4' } },
  { minutesAgo: 11, actor: 'u-samir', action: 'cohort.broadcast', targetType: 'cohort', targetId: 'c-cks-q4', targetLabel: 'CKS bootcamp · Q4', details: { kind: 'hint', message: 'Remember: a default-deny policy selects all pods with podSelector: {}' } },
  { minutesAgo: 25, actor: 'u-samir', action: 'session.extend', targetType: 'session', targetId: 'ls-bram-netpol', targetLabel: 'Bram Oosterhuis · Isolate the payments namespace', details: { minutes: 30 } },
  { minutesAgo: 48, actor: 'u-ingrid', action: 'assignment.create', targetType: 'assignment', targetId: 'as-5', targetLabel: 'Bring the depot back online with OSPF area 0 → Edge Network', details: { target: 'team:t-edge', dueAt: ahead(10 * DAY), required: true } },
  { minutesAgo: 70, actor: 'u-priya', action: 'user.invite', targetType: 'user', targetId: 'u-hugo', targetLabel: 'hugo.marchetti@quillmoor.example', details: { roles: ['learner'], teams: ['t-depot'] } },
  { minutesAgo: 95, actor: null, action: 'auth.login', targetType: 'user', targetId: 'u-mira', targetLabel: 'Mira Adeyemi', details: { idp: 'quillmoor-entra', method: 'oidc' } },
  { minutesAgo: 140, actor: 'u-priya', action: 'sso.test', targetType: 'sso', targetId: 'sso-2', targetLabel: 'Okta (Depot contractors)', details: { ok: false, failedStep: 'Assertion test' } },
  { minutesAgo: 160, actor: 'u-priya', action: 'sso.update', targetType: 'sso', targetId: 'sso-2', targetLabel: 'Okta (Depot contractors)', details: { changed: ['groupMappings'] } },
  { minutesAgo: 300, actor: 'u-priya', action: 'domain.add', targetType: 'domain', targetId: 'depot.quillmoor.example', details: {} },
  { minutesAgo: 420, actor: 'u-ingrid', action: 'report.export', targetType: 'team', targetId: 't-platrel', targetLabel: 'Platform Reliability', details: { format: 'csv', from: ago(30 * DAY).slice(0, 10), to: ago(0).slice(0, 10) } },
  { minutesAgo: 26 * 60, actor: 'u-priya', action: 'content.visibility', targetType: 'lab', targetId: 'edge-acl-dmz', targetLabel: 'Segment the depot DMZ with ACLs', details: { enabled: false, reason: 'ACL syntax differs from the depot firewalls; re-enable after the content refresh' } },
  { minutesAgo: 27 * 60, actor: 'u-samir', action: 'session.terminate', targetType: 'session', targetId: 'ls-old-1', targetLabel: 'Kofi Mensah · Rotate the expiring TLS certificate', details: { reason: 'learner asked for a clean restart' } },
  { minutesAgo: 30 * 60, actor: 'u-priya', action: 'quota.update', targetType: 'org', targetId: Q, targetLabel: 'Quillmoor Logistics', details: { maxConcurrentSessions: { from: 20, to: 25 } } },
  { minutesAgo: 2 * 24 * 60, actor: 'u-priya', action: 'user.deactivate', targetType: 'user', targetId: 'u-sven', targetLabel: 'Sven Aalto', details: { revokedSessions: 1, terminatedLabs: 0 } },
  { minutesAgo: 2 * 24 * 60 + 30, actor: 'u-priya', action: 'team.member_remove', targetType: 'team', targetId: 't-platrel', targetLabel: 'Platform Reliability', details: { userId: 'u-sven' } },
  { minutesAgo: 3 * 24 * 60, actor: 'u-samir', action: 'cohort.create', targetType: 'cohort', targetId: 'c-lfcs-nov', targetLabel: 'LFCS fundamentals · November', details: { members: 4, labs: 4 } },
  { minutesAgo: 4 * 24 * 60, actor: 'u-ingrid', action: 'assignment.create', targetType: 'assignment', targetId: 'as-4', targetLabel: 'Move harbor-vm to key-only SSH → Lena Varga', details: { target: 'user:u-lena', required: true } },
  { minutesAgo: 5 * 24 * 60, actor: 'u-priya', action: 'settings.update', targetType: 'org', targetId: Q, targetLabel: 'Quillmoor Logistics', details: { defaultSessionMinutes: { from: 45, to: 60 } } },
  { minutesAgo: 6 * 24 * 60, actor: 'u-elin', action: 'platform.org_update', targetType: 'org', targetId: Q, targetLabel: 'Quillmoor Logistics', details: { quotas: { monthlyLabHours: { from: 300, to: 400 } }, supportAccess: true } },
  { minutesAgo: 6 * 24 * 60 + 20, actor: 'u-priya', action: 'sso.update', targetType: 'sso', targetId: 'sso-1', targetLabel: 'Microsoft Entra ID', details: { enforced: { from: false, to: true } } },
  { minutesAgo: 6 * 24 * 60 + 25, actor: 'u-priya', action: 'sso.test', targetType: 'sso', targetId: 'sso-1', targetLabel: 'Microsoft Entra ID', details: { ok: true } },
  { minutesAgo: 9 * 24 * 60, actor: 'u-priya', action: 'user.invite', targetType: 'user', targetId: 'inv-2', targetLabel: 'nadia.rahimi@quillmoor.example', details: { roles: ['learner', 'instructor'] } },
  { minutesAgo: 10 * 24 * 60, actor: 'u-ingrid', action: 'assignment.create', targetType: 'assignment', targetId: 'as-3', targetLabel: 'CCNA readiness → Edge Network', details: { target: 'team:t-edge', required: false } },
  { minutesAgo: 12 * 24 * 60, actor: null, action: 'auth.login_denied', targetType: 'user', targetId: 'sven.aalto@quillmoor.example', details: { reason: 'membership deactivated', idp: 'quillmoor-entra' } },
];

export function auditOf(orgId: string): AuditEvent[] {
  const logins = people
    .filter((p) => p.orgs[orgId] && p.lastLoginDaysAgo !== undefined && p.status !== 'deactivated')
    .map((p, i): AuditSeed => ({ minutesAgo: (p.lastLoginDaysAgo ?? 0) * 24 * 60 + 180 + i * 7, actor: null, action: 'auth.login', targetType: 'user', targetId: p.id, targetLabel: p.name, details: { idp: orgId === Q ? 'quillmoor-entra' : 'local', method: orgId === Q ? 'oidc' : 'password' } }));
  const seeds = orgId === Q ? [...auditSeeds, ...logins] : logins;
  return seeds
    .map((s, i) => ({ id: `ae-${orgId.slice(4)}-${i}`, at: ago(s.minutesAgo * 60_000), actor: s.actor ? userRef(s.actor) : null, action: s.action, targetType: s.targetType, targetId: s.targetId, targetLabel: s.targetLabel, ip: `10.${20 + (i % 5)}.${(i * 7) % 200}.${(i * 13) % 250}`, details: s.details ?? {} }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/* ================================================================ platform */

export const platformOrgs: PlatformOrg[] = [
  { ...ORG_QUILLMOOR, status: 'active', createdAt: ago(120 * DAY), quotas: quotasByOrg[Q]!, domains: ['quillmoor.example', 'depot.quillmoor.example'], users: 17, activeUsers30d: 14, runningSessions: 7, labHoursThisMonth: 262, ssoConnections: 2 },
  { ...ORG_ACME, status: 'active', createdAt: ago(33 * DAY), quotas: quotasByOrg[A]!, domains: ['acmefreight.example'], users: 5, activeUsers30d: 5, runningSessions: 1, labHoursThisMonth: 31, ssoConnections: 0 },
  { ...ORG_NORTHWIND, status: 'suspended', createdAt: ago(200 * DAY), quotas: quotasByOrg[ORG_NORTHWIND.id]!, domains: ['northwind-rail.example'], users: 42, activeUsers30d: 0, runningSessions: 0, labHoursThisMonth: 0, ssoConnections: 1 },
];

export const capacity: Capacity = {
  generatedAt: new Date().toISOString(),
  cluster: { context: 'ct-prod-eu1', reachable: true },
  nodes: [
    { name: 'ct-cp-1', roles: ['control-plane'], ready: true, kvm: false, cpu: { capacity: 8, allocatable: 7.5, requested: 2.1 }, memoryMiB: { capacity: 32768, allocatable: 30720, requested: 9800 }, pods: 31, vms: 0 },
    { name: 'ct-w-1', roles: ['worker', 'kvm'], ready: true, kvm: true, cpu: { capacity: 32, allocatable: 31, requested: 24.5 }, memoryMiB: { capacity: 131072, allocatable: 126976, requested: 98304 }, pods: 58, vms: 5 },
    { name: 'ct-w-2', roles: ['worker', 'kvm'], ready: true, kvm: true, cpu: { capacity: 32, allocatable: 31, requested: 19 }, memoryMiB: { capacity: 131072, allocatable: 126976, requested: 71680 }, pods: 49, vms: 4 },
    { name: 'ct-w-3', roles: ['worker', 'kvm'], ready: false, kvm: true, cpu: { capacity: 32, allocatable: 31, requested: 6 }, memoryMiB: { capacity: 131072, allocatable: 126976, requested: 20480 }, pods: 12, vms: 2 },
  ],
  vms: { running: 11, total: 14 },
  warmPools: [
    { name: 'ubuntu-2404', namespace: 'cloudtrain-pools', template: 'vm-ubuntu-24.04', size: 4, ready: 4 },
    { name: 'rocky-9', namespace: 'cloudtrain-pools', template: 'vm-rocky-9', size: 2, ready: 1 },
    { name: 'kubeadm-3n', namespace: 'cloudtrain-pools', template: 'cluster-kubeadm-1.35-3n', size: 3, ready: 2 },
    { name: 'frr-edge', namespace: 'cloudtrain-pools', template: 'netdev-frr-3r', size: 2, ready: 2 },
  ],
  sessions: {
    total: 8,
    byPhase: { ready: 5, provisioning: 1, grading: 1, hibernated: 1 },
    byOrg: [
      { orgId: Q, name: 'Quillmoor Logistics', count: 7 },
      { orgId: A, name: 'Acme Freight', count: 1 },
    ],
  },
};

export const platformPacks = [
  { id: 'pack-k8s-core', title: 'Kubernetes core', domain: 'kubernetes' as const, version: '3.4.0', labs: labSummaries.filter((l) => l.domain === 'kubernetes').length, orgsEnabled: 3, global: true, updatedAt: ago(4 * DAY) },
  { id: 'pack-linux-core', title: 'Linux administration', domain: 'linux' as const, version: '2.9.1', labs: labSummaries.filter((l) => l.domain === 'linux').length, orgsEnabled: 3, global: true, updatedAt: ago(11 * DAY) },
  { id: 'pack-net-core', title: 'Networking fundamentals', domain: 'networking' as const, version: '1.7.0', labs: labSummaries.filter((l) => l.domain === 'networking').length, orgsEnabled: 2, global: true, updatedAt: ago(25 * DAY) },
  { id: 'pack-quillmoor-depot', title: 'Quillmoor depot runbooks', domain: 'linux' as const, version: '0.3.0', labs: 2, orgsEnabled: 1, global: false, updatedAt: ago(2 * DAY) },
];
