import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

export async function startMocks() {
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
