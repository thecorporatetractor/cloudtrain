import { StrictMode } from 'react';
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
import { router } from './router';
import { API_MODE } from './api/mode';
import { ThemeProvider } from './lib/theme';
import { TooltipProvider } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

async function boot() {
  if (API_MODE === 'real') {
    // The gateway serves everything except Scenario Studio, which stays sample data.
    const { startMocks } = await import('./mocks/browser');
    await startMocks({ sampleOnly: true });
  } else if (import.meta.env.DEV || import.meta.env.VITE_MOCK_API === '1') {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <RouterProvider router={router} />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
