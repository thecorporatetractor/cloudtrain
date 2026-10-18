/*
 * Real API mode (VITE_API_MODE=real): everything goes to the gateway except Scenario
 * Studio, which has no backend yet and keeps its sample data in MSW. The worker is
 * registered only when a Studio route loads (router.tsx `beforeLoad`), never on the
 * public website or the other app pages, so a visitor's page requests are not routed
 * through a service worker at all. Mock mode registers the full worker at boot.
 */
let started: Promise<void> | undefined;

export function ensureSampleMocks(): Promise<void> {
  if (import.meta.env.VITE_API_MODE !== 'real') return Promise.resolve();
  started ??= import('./browser').then(({ startMocks }) => startMocks({ sampleOnly: true }));
  return started;
}
