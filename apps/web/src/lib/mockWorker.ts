/** The MSW worker script (public/mockServiceWorker.js). */
export const isMockWorker = (scriptUrl: string | undefined) => !!scriptUrl && /\/mockServiceWorker\.js(\?|$)/.test(scriptUrl);

type Registration = { active?: { scriptURL: string } | null; installing?: { scriptURL: string } | null; waiting?: { scriptURL: string } | null; unregister(): Promise<boolean> };

/** Unregisters every mock service worker on this origin; returns how many. Never throws. */
export async function removeMockWorkers(container: { getRegistrations(): Promise<readonly Registration[]> } | undefined): Promise<number> {
  if (!container) return 0;
  try {
    const regs = await container.getRegistrations();
    const mock = regs.filter((r) => isMockWorker((r.active ?? r.waiting ?? r.installing)?.scriptURL));
    await Promise.all(mock.map((r) => r.unregister()));
    return mock.length;
  } catch {
    return 0;
  }
}
