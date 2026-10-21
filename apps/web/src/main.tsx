import { startTransition, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/pages.css';
import './styles/workspace.css';
import './styles/platform.css';
import './styles/site.css';
import { router } from './router';
import { ThemeProvider } from './lib/theme';
import { TooltipProvider } from './components/ui';
import { SiteTheme } from './site/SiteTheme';
import { queries } from './api/client';
import { publicQueries } from './api/public';
import { STATIC_SITE } from './lib/siteMode';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

async function boot() {
  // The env check is inlined (not API_MODE) so the bundler drops the MSW chunk from builds that
  // never start it; Rolldown does not constant-fold the imported const. In real mode the gateway
  // serves everything except Scenario Studio, whose sample worker starts when a Studio route
  // loads (mocks/sample.ts): no service worker sits in front of the public website.
  if (import.meta.env.VITE_API_MODE === 'real') {
    /* nothing at boot */
  } else if (import.meta.env.DEV || import.meta.env.VITE_MOCK_API === '1') {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  }
  if (STATIC_SITE) {
    // The static website ships prerendered HTML (build-site.mjs): mount once the public data is
    // in the cache, so the first render is that same page instead of a skeleton.
    await Promise.allSettled([queryClient.prefetchQuery(queries.me()), queryClient.prefetchQuery(publicQueries.site()), queryClient.prefetchQuery(publicQueries.catalog()), router.load()]);
  }
  const app = (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <SiteTheme />
            <RouterProvider router={router} />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  const root = createRoot(document.getElementById('root')!);
  // A prerendered static page (build-site.mjs) stays on screen until React has rendered the same
  // page; rendering it as a transition yields to the browser instead of one long task.
  if (STATIC_SITE) startTransition(() => root.render(app));
  else root.render(app);
}

void boot();
