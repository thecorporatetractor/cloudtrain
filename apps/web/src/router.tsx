import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { Difficulty, Domain, FrameworkId } from './api/types';
import { Shell } from './app/Shell';
import { NotFound } from './app/NotFound';
import { Home } from './routes/Home';
import { Catalog } from './routes/Catalog';
import { LabOverview } from './routes/LabOverview';
import { Workspace } from './routes/Workspace';
import { Skills } from './routes/Skills';
import { Studio } from './routes/Studio';
import { StudioDraft } from './routes/StudioDraft';
import { Team } from './routes/Team';

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
}
const FRAMEWORKS: FrameworkId[] = ['cka', 'cks', 'lfcs', 'ccna'];
export const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills',
  validateSearch: (s: Record<string, unknown>): SkillsSearch => ({
    framework: FRAMEWORKS.includes(s.framework as FrameworkId) ? (s.framework as FrameworkId) : 'cks',
    ...(typeof s.skill === 'string' && s.skill ? { skill: s.skill } : {}),
  }),
  component: Skills,
});

export const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/studio', component: Studio });
export const studioDraftRoute = createRoute({ getParentRoute: () => rootRoute, path: '/studio/$draftId', component: StudioDraft });
export const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/team', component: Team });

const routeTree = rootRoute.addChildren([homeRoute, catalogRoute, labRoute, workspaceRoute, skillsRoute, studioRoute, studioDraftRoute, teamRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
