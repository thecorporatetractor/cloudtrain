import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router';
import type { Difficulty, Domain, FrameworkId } from './api/types';
import { Shell } from './app/Shell';
import { NotFound } from './app/NotFound';
import { RouteError } from './app/RouteError';
import { PageSkeleton } from './components/ui';
import { CatalogIndex, RootIndex } from './routes/site/Hybrid';
import { ensureSampleMocks } from './mocks/sample';

// Screens that pull in React Flow or xterm are loaded on demand so the other
// pages do not download them (see vite.config.ts manualChunks). Role-specific
// areas are lazy too: a learner never downloads the admin bundle.
const LabOverview = lazyRouteComponent(() => import('./routes/LabOverview'), 'LabOverview');
const Workspace = lazyRouteComponent(() => import('./routes/Workspace'), 'Workspace');
const Skills = lazyRouteComponent(() => import('./routes/Skills'), 'Skills');
const Studio = lazyRouteComponent(() => import('./routes/Studio'), 'Studio');
const StudioDraft = lazyRouteComponent(() => import('./routes/StudioDraft'), 'StudioDraft');
const SignIn = lazyRouteComponent(() => import('./routes/SignIn'), 'SignIn');
const Assignments = lazyRouteComponent(() => import('./routes/Assignments'), 'Assignments');
const HistoryScreen = lazyRouteComponent(() => import('./routes/History'), 'History');
const Exams = lazyRouteComponent(() => import('./routes/Exams'), 'Exams');
const TeamExams = lazyRouteComponent(() => import('./routes/Exams'), 'TeamExams');
const Team = lazyRouteComponent(() => import('./routes/Team'), 'Team');
const TeamMember = lazyRouteComponent(() => import('./routes/TeamMember'), 'TeamMember');
const Assign = lazyRouteComponent(() => import('./routes/Assign'), 'Assign');
const TeamAssignments = lazyRouteComponent(() => import('./routes/TeamAssignments'), 'TeamAssignments');
const Cohorts = lazyRouteComponent(() => import('./routes/Cohorts'), 'Cohorts');
const CohortBoard = lazyRouteComponent(() => import('./routes/CohortBoard'), 'CohortBoard');
const Observe = lazyRouteComponent(() => import('./routes/Observe'), 'Observe');
const AdminLayout = lazyRouteComponent(() => import('./routes/admin/AdminLayout'), 'AdminLayout');
const AdminOverview = lazyRouteComponent(() => import('./routes/admin/Overview'), 'AdminOverview');
const AdminUsers = lazyRouteComponent(() => import('./routes/admin/Users'), 'AdminUsers');
const AdminTeams = lazyRouteComponent(() => import('./routes/admin/Teams'), 'AdminTeams');
const AdminSso = lazyRouteComponent(() => import('./routes/admin/Sso'), 'AdminSso');
const AdminContent = lazyRouteComponent(() => import('./routes/admin/Content'), 'AdminContent');
const AdminSessions = lazyRouteComponent(() => import('./routes/admin/Sessions'), 'AdminSessions');
const AdminUsage = lazyRouteComponent(() => import('./routes/admin/Usage'), 'AdminUsage');
const AdminAudit = lazyRouteComponent(() => import('./routes/admin/Audit'), 'AdminAudit');
const AdminSettings = lazyRouteComponent(() => import('./routes/admin/Settings'), 'AdminSettings');
const PlatformLayout = lazyRouteComponent(() => import('./routes/platform/PlatformLayout'), 'PlatformLayout');
const PlatformOrgs = lazyRouteComponent(() => import('./routes/platform/Orgs'), 'PlatformOrgs');
const PlatformCapacity = lazyRouteComponent(() => import('./routes/platform/Capacity'), 'PlatformCapacity');
const PlatformContent = lazyRouteComponent(() => import('./routes/platform/Content'), 'PlatformContent');
const PlatformLicense = lazyRouteComponent(() => import('./routes/platform/License'), 'PlatformLicense');
const ExamDetail = lazyRouteComponent(() => import('./routes/exams/ExamDetail'), 'ExamDetail');
const ExamWorkspace = lazyRouteComponent(() => import('./routes/exams/ExamWorkspace'), 'ExamWorkspace');
const ExamResults = lazyRouteComponent(() => import('./routes/exams/ExamResults'), 'ExamResults');
const Events = lazyRouteComponent(() => import('./routes/events/Events'), 'Events');
const EventDetail = lazyRouteComponent(() => import('./routes/events/EventDetail'), 'EventDetail');
const EventScoreboard = lazyRouteComponent(() => import('./routes/events/EventScoreboard'), 'EventScoreboard');
const EventManage = lazyRouteComponent(() => import('./routes/events/EventManage'), 'EventManage');
// The public website (no sign-in): detail pages and the small pages. `/` and `/catalog` are
// hybrid (routes/site/Hybrid.tsx): the landing page or the public catalog for visitors.
const PublicPath = lazyRouteComponent(() => import('./routes/site/PublicPath'), 'PublicPath');
const PublicExam = lazyRouteComponent(() => import('./routes/site/PublicExam'), 'PublicExam');
const Pricing = lazyRouteComponent(() => import('./routes/site/Pricing'), 'Pricing');
const About = lazyRouteComponent(() => import('./routes/site/Pages'), 'About');
const Faq = lazyRouteComponent(() => import('./routes/site/Pages'), 'Faq');
const Contact = lazyRouteComponent(() => import('./routes/site/Pages'), 'Contact');
const Terms = lazyRouteComponent(() => import('./routes/site/Pages'), 'Terms');
const Privacy = lazyRouteComponent(() => import('./routes/site/Pages'), 'Privacy');
const AccountBilling = lazyRouteComponent(() => import('./routes/Billing'), 'AccountBilling');
const AdminBilling = lazyRouteComponent(() => import('./routes/Billing'), 'AdminBilling');

function Pending() {
  return (
    <div className="page">
      <PageSkeleton />
    </div>
  );
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFound });

export const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: RootIndex });

/* ------------------------------------------------------------------ public website */

export const publicPathRoute = createRoute({ getParentRoute: () => rootRoute, path: '/catalog/paths/$pathId', component: PublicPath });
export const publicExamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/catalog/exams/$examId', component: PublicExam });
export const pricingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pricing', component: Pricing });
export const aboutRoute = createRoute({ getParentRoute: () => rootRoute, path: '/about', component: About });
export const faqRoute = createRoute({ getParentRoute: () => rootRoute, path: '/faq', component: Faq });
export const contactRoute = createRoute({ getParentRoute: () => rootRoute, path: '/contact', component: Contact });
export const termsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/legal/terms', component: Terms });
export const privacyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/legal/privacy', component: Privacy });

/* ------------------------------------------------------------------ auth */

export interface SignInSearch {
  returnTo?: string;
  reason?: 'expired';
  signedOut?: boolean;
}
export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  validateSearch: (s: Record<string, unknown>): SignInSearch => ({
    ...(str(s.returnTo) ? { returnTo: str(s.returnTo) } : {}),
    ...(s.reason === 'expired' ? { reason: 'expired' as const } : {}),
    ...(s.signedOut === true || s.signedOut === 'true' || s.signedOut === '1' ? { signedOut: true } : {}),
  }),
  component: SignIn,
});

/* ------------------------------------------------------------------ learner */

export interface BillingSearch {
  plan?: string;
  interval?: 'monthly' | 'yearly';
  checkout?: 'success' | 'cancelled';
  /** Back from Checkout in setup mode (a saved payment method). */
  setup?: 'success' | 'cancelled';
}
const billingSearch = (s: Record<string, unknown>): BillingSearch => ({
  ...(str(s.plan) ? { plan: str(s.plan) } : {}),
  ...(s.interval === 'monthly' || s.interval === 'yearly' ? { interval: s.interval } : {}),
  ...(s.checkout === 'success' || s.checkout === 'cancelled' ? { checkout: s.checkout } : {}),
  ...(s.setup === 'success' || s.setup === 'cancelled' ? { setup: s.setup } : {}),
});
/** The signed-in person's plan, entitlements and subscription (docs/billing.md). */
export const accountBillingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account/billing', validateSearch: billingSearch, component: AccountBilling });

export interface CatalogSearch {
  domain?: Domain;
  path?: string;
  q?: string;
  difficulty?: Difficulty;
  maxMinutes?: number;
}
const DOMAINS: Domain[] = ['kubernetes', 'linux', 'containers', 'iac', 'automation', 'networking'];
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

export const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  validateSearch: (s: Record<string, unknown>): CatalogSearch => {
    const out: CatalogSearch = {};
    if (DOMAINS.includes(s.domain as Domain)) out.domain = s.domain as Domain;
    if (typeof s.path === 'string' && s.path) out.path = s.path;
    if (typeof s.q === 'string' && s.q) out.q = s.q;
    if (DIFFS.includes(s.difficulty as Difficulty)) out.difficulty = s.difficulty as Difficulty;
    if (typeof s.maxMinutes === 'number' && s.maxMinutes > 0) out.maxMinutes = s.maxMinutes;
    return out;
  },
  component: CatalogIndex,
});

export const labRoute = createRoute({ getParentRoute: () => rootRoute, path: '/labs/$labId', component: LabOverview });

export interface WorkspaceSearch {
  s?: string;
}
export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/labs/$labId/work',
  validateSearch: (s: Record<string, unknown>): WorkspaceSearch => (typeof s.s === 'string' && s.s ? { s: s.s } : {}),
  component: Workspace,
});

export interface SkillsSearch {
  framework: FrameworkId;
  skill?: string;
  /** Another team member's skills (managers and admins). */
  member?: string;
}
/** Framework ids are content slugs (the set grows with the curriculum); Skills falls back when one is unknown. */
const FRAMEWORK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills',
  validateSearch: (s: Record<string, unknown>): SkillsSearch => ({
    framework: typeof s.framework === 'string' && FRAMEWORK_ID.test(s.framework) ? s.framework : 'cks',
    ...(typeof s.skill === 'string' && s.skill ? { skill: s.skill } : {}),
    ...(typeof s.member === 'string' && s.member ? { member: s.member } : {}),
  }),
  component: Skills,
});

export const assignmentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/assignments', component: Assignments });

export interface HistorySearch {
  lab?: string;
  outcome?: string;
  attempt?: string;
  page?: number;
}
export const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  validateSearch: (s: Record<string, unknown>): HistorySearch => ({
    ...(str(s.lab) ? { lab: str(s.lab) } : {}),
    ...(str(s.outcome) ? { outcome: str(s.outcome) } : {}),
    ...(str(s.attempt) ? { attempt: str(s.attempt) } : {}),
    ...(typeof s.page === 'number' && s.page > 0 ? { page: s.page } : {}),
  }),
  component: HistoryScreen,
});

export interface ExamsSearch {
  view?: 'attempts';
}
/** Exam simulations: catalog and the learner's attempts (lab.run). */
export const examsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/exams',
  validateSearch: (s: Record<string, unknown>): ExamsSearch => (s.view === 'attempts' ? { view: 'attempts' } : {}),
  component: Exams,
});
export const examDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/exams/$examId', component: ExamDetail });
export const eventsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/events', component: Events });
export const eventRoute = createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId', component: EventDetail });
export const eventScoreboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/scoreboard', component: EventScoreboard });
export const eventManageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/manage', component: EventManage });
export const examAttemptRoute = createRoute({ getParentRoute: () => rootRoute, path: '/exams/attempts/$attemptId', component: ExamWorkspace });
export const examResultsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/exams/attempts/$attemptId/results', component: ExamResults });

/* ------------------------------------------------------------------ author */

// Real mode: Studio's sample data lives in MSW, registered on first use (mocks/sample.ts).
export const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/studio', beforeLoad: () => ensureSampleMocks(), component: Studio });
export const studioDraftRoute = createRoute({ getParentRoute: () => rootRoute, path: '/studio/$draftId', beforeLoad: () => ensureSampleMocks(), component: StudioDraft });

/* ------------------------------------------------------------------ manager */

export interface TeamSearch {
  team?: string;
}
const teamSearch = (s: Record<string, unknown>): TeamSearch => (str(s.team) ? { team: str(s.team) } : {});
export const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/team', validateSearch: teamSearch, component: Team });
export const teamMemberRoute = createRoute({ getParentRoute: () => rootRoute, path: '/team/members/$userId', validateSearch: teamSearch, component: TeamMember });

export interface AssignSearch extends TeamSearch {
  item?: string;
  kind?: 'lab' | 'path' | 'framework';
  user?: string;
}
export const assignRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/team/assign',
  validateSearch: (s: Record<string, unknown>): AssignSearch => ({
    ...teamSearch(s),
    ...(str(s.item) ? { item: str(s.item) } : {}),
    ...(s.kind === 'lab' || s.kind === 'path' || s.kind === 'framework' ? { kind: s.kind } : {}),
    ...(str(s.user) ? { user: str(s.user) } : {}),
  }),
  component: Assign,
});
export interface TeamAssignmentsSearch extends TeamSearch {
  state?: string;
  open?: string;
}
export const teamAssignmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/team/assignments',
  validateSearch: (s: Record<string, unknown>): TeamAssignmentsSearch => ({ ...teamSearch(s), ...(str(s.state) ? { state: str(s.state) } : {}), ...(str(s.open) ? { open: str(s.open) } : {}) }),
  component: TeamAssignments,
});

export interface TeamExamsSearch extends TeamSearch {
  exam?: string;
}
/** Manager view of team exam readiness (GET /api/exams/team-readiness, progress.read.team). */
export const teamExamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/team/exams',
  validateSearch: (s: Record<string, unknown>): TeamExamsSearch => ({ ...teamSearch(s), ...(str(s.exam) ? { exam: str(s.exam) } : {}) }),
  component: TeamExams,
});

/* ------------------------------------------------------------------ instructor */

export const cohortsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cohorts', component: Cohorts });
export const cohortBoardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cohorts/$cohortId', component: CohortBoard });
export const observeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cohorts/$cohortId/observe/$sessionId', component: Observe });

/* ------------------------------------------------------------------ org admin */

export const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminLayout });
export const adminIndexRoute = createRoute({ getParentRoute: () => adminRoute, path: '/', component: AdminOverview });
export interface AdminUsersSearch {
  q?: string;
  role?: string;
  team?: string;
  status?: string;
  page?: number;
  user?: string;
  invite?: boolean;
}
export const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  validateSearch: (s: Record<string, unknown>): AdminUsersSearch => ({
    ...(str(s.q) ? { q: str(s.q) } : {}),
    ...(str(s.role) ? { role: str(s.role) } : {}),
    ...(str(s.team) ? { team: str(s.team) } : {}),
    ...(str(s.status) ? { status: str(s.status) } : {}),
    ...(typeof s.page === 'number' && s.page > 0 ? { page: s.page } : {}),
    ...(str(s.user) ? { user: str(s.user) } : {}),
    ...(s.invite === true ? { invite: true } : {}),
  }),
  component: AdminUsers,
});
export interface AdminTeamsSearch {
  team?: string;
}
export const adminTeamsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/teams', validateSearch: teamSearch, component: AdminTeams });
export interface AdminSsoSearch {
  connection?: string;
  add?: boolean;
}
export const adminSsoRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/sso',
  validateSearch: (s: Record<string, unknown>): AdminSsoSearch => ({ ...(str(s.connection) ? { connection: str(s.connection) } : {}), ...(s.add === true ? { add: true } : {}) }),
  component: AdminSso,
});
export const adminContentRoute = createRoute({ getParentRoute: () => adminRoute, path: '/content', component: AdminContent });
export const adminSessionsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/sessions', component: AdminSessions });
export const adminUsageRoute = createRoute({ getParentRoute: () => adminRoute, path: '/usage', component: AdminUsage });
export interface AdminAuditSearch {
  action?: string;
  actor?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page?: number;
  event?: string;
}
export const adminAuditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/audit',
  validateSearch: (s: Record<string, unknown>): AdminAuditSearch => ({
    ...(str(s.action) ? { action: str(s.action) } : {}),
    ...(str(s.actor) ? { actor: str(s.actor) } : {}),
    ...(str(s.targetType) ? { targetType: str(s.targetType) } : {}),
    ...(str(s.from) ? { from: str(s.from) } : {}),
    ...(str(s.to) ? { to: str(s.to) } : {}),
    ...(typeof s.page === 'number' && s.page > 0 ? { page: s.page } : {}),
    ...(str(s.event) ? { event: str(s.event) } : {}),
  }),
  component: AdminAudit,
});
export const adminSettingsRoute = createRoute({ getParentRoute: () => adminRoute, path: '/settings', component: AdminSettings });
/** The organisation's plan, seats and billing events (billing.manage). */
export const adminBillingRoute = createRoute({ getParentRoute: () => adminRoute, path: '/billing', validateSearch: billingSearch, component: AdminBilling });

/* ------------------------------------------------------------------ platform */

export const platformRoute = createRoute({ getParentRoute: () => rootRoute, path: '/platform', component: PlatformLayout });
export interface PlatformOrgsSearch {
  org?: string;
  create?: boolean;
}
export const platformOrgsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): PlatformOrgsSearch => ({ ...(str(s.org) ? { org: str(s.org) } : {}), ...(s.create === true ? { create: true } : {}) }),
  component: PlatformOrgs,
});
export const platformCapacityRoute = createRoute({ getParentRoute: () => platformRoute, path: '/capacity', component: PlatformCapacity });
export const platformContentRoute = createRoute({ getParentRoute: () => platformRoute, path: '/content', component: PlatformContent });
export const platformLicenseRoute = createRoute({ getParentRoute: () => platformRoute, path: '/license', component: PlatformLicense });

const routeTree = rootRoute.addChildren([
  homeRoute,
  signInRoute,
  publicPathRoute,
  publicExamRoute,
  pricingRoute,
  aboutRoute,
  faqRoute,
  contactRoute,
  termsRoute,
  privacyRoute,
  catalogRoute,
  accountBillingRoute,
  labRoute,
  workspaceRoute,
  skillsRoute,
  assignmentsRoute,
  historyRoute,
  examsRoute,
  examDetailRoute,
  examAttemptRoute,
  examResultsRoute,
  eventsRoute,
  eventRoute,
  eventScoreboardRoute,
  eventManageRoute,
  studioRoute,
  studioDraftRoute,
  teamRoute,
  teamMemberRoute,
  assignRoute,
  teamAssignmentsRoute,
  teamExamsRoute,
  cohortsRoute,
  cohortBoardRoute,
  observeRoute,
  adminRoute.addChildren([adminIndexRoute, adminUsersRoute, adminTeamsRoute, adminSsoRoute, adminContentRoute, adminSessionsRoute, adminUsageRoute, adminAuditRoute, adminSettingsRoute, adminBillingRoute]),
  platformRoute.addChildren([platformOrgsRoute, platformCapacityRoute, platformContentRoute, platformLicenseRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: Pending,
  defaultErrorComponent: RouteError,
  defaultPendingMs: 120,
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
