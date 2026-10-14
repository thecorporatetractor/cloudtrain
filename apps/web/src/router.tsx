import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router';
import type { Difficulty, Domain, FrameworkId } from './api/types';
import { Shell } from './app/Shell';
import { NotFound } from './app/NotFound';
import { PageSkeleton } from './components/ui';
import { Home } from './routes/Home';
import { Catalog } from './routes/Catalog';

// Screens that pull in React Flow or xterm are loaded on demand so the other
// pages do not download them (see vite.config.ts manualChunks).
const LabOverview = lazyRouteComponent(() => import('./routes/LabOverview'), 'LabOverview');
const Workspace = lazyRouteComponent(() => import('./routes/Workspace'), 'Workspace');
const Skills = lazyRouteComponent(() => import('./routes/Skills'), 'Skills');
const Studio = lazyRouteComponent(() => import('./routes/Studio'), 'Studio');
const StudioDraft = lazyRouteComponent(() => import('./routes/StudioDraft'), 'StudioDraft');
const Team = lazyRouteComponent(() => import('./routes/Team'), 'Team');
const Exams = lazyRouteComponent(() => import('./routes/Exams'), 'Exams');
const TeamExams = lazyRouteComponent(() => import('./routes/Exams'), 'TeamExams');
const ExamDetail = lazyRouteComponent(() => import('./routes/exams/ExamDetail'), 'ExamDetail');
const ExamWorkspace = lazyRouteComponent(() => import('./routes/exams/ExamWorkspace'), 'ExamWorkspace');
const ExamResults = lazyRouteComponent(() => import('./routes/exams/ExamResults'), 'ExamResults');

function Pending() {
  return (
    <div className="page">
      <PageSkeleton />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFound });

export const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });

export interface CatalogSearch {
  domain?: Domain;
  path?: string;
  q?: string;
  difficulty?: Difficulty;
  maxMinutes?: number;
}
const DOMAINS: Domain[] = ['kubernetes', 'linux', 'networking'];
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
  component: Catalog,
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
const FRAMEWORKS: FrameworkId[] = ['cka', 'cks', 'lfcs', 'ccna'];
export const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills',
  validateSearch: (s: Record<string, unknown>): SkillsSearch => ({
    framework: FRAMEWORKS.includes(s.framework as FrameworkId) ? (s.framework as FrameworkId) : 'cks',
    ...(typeof s.skill === 'string' && s.skill ? { skill: s.skill } : {}),
    ...(typeof s.member === 'string' && s.member ? { member: s.member } : {}),
  }),
  component: Skills,
});

export const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/studio', component: Studio });
export const studioDraftRoute = createRoute({ getParentRoute: () => rootRoute, path: '/studio/$draftId', component: StudioDraft });
export const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/team', component: Team });

/* ------------------------------------------------------------------ exams (exam engine stream) */

export interface ExamsSearch {
  view?: 'attempts';
}
/** Exam simulations: catalog and the learner's attempts. */
export const examsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/exams',
  validateSearch: (s: Record<string, unknown>): ExamsSearch => (s.view === 'attempts' ? { view: 'attempts' } : {}),
  component: Exams,
});
export const examDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/exams/$examId', component: ExamDetail });
export const examAttemptRoute = createRoute({ getParentRoute: () => rootRoute, path: '/exams/attempts/$attemptId', component: ExamWorkspace });
export const examResultsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/exams/attempts/$attemptId/results', component: ExamResults });
export interface TeamExamsSearch {
  team?: string;
  exam?: string;
}
/** Manager view of team exam readiness. */
export const teamExamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/team/exams',
  validateSearch: (s: Record<string, unknown>): TeamExamsSearch => ({
    ...(typeof s.team === 'string' && s.team ? { team: s.team } : {}),
    ...(typeof s.exam === 'string' && s.exam ? { exam: s.exam } : {}),
  }),
  component: TeamExams,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  catalogRoute,
  labRoute,
  workspaceRoute,
  skillsRoute,
  studioRoute,
  studioDraftRoute,
  teamRoute,
  examsRoute,
  examDetailRoute,
  examAttemptRoute,
  examResultsRoute,
  teamExamsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: Pending,
  defaultPendingMs: 120,
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
