import { setupWorker } from 'msw/browser';
import { handlers, sampleOnlyHandlers } from './handlers';

/** `sampleOnly`: real API mode, where MSW answers just the endpoints without a backend (team, studio). */
export async function startMocks({ sampleOnly = false }: { sampleOnly?: boolean } = {}) {
  const worker = setupWorker(...(sampleOnly ? sampleOnlyHandlers : handlers));
  await worker.start({
    onUnhandledFrame: 'bypass',
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
