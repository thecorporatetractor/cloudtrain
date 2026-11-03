import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Mock mode only: the whole API in the browser. A real-API build never starts a service worker. */
export async function startMocks() {
  const worker = setupWorker(...handlers);
  await worker.start({
    onUnhandledFrame: 'bypass',
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
