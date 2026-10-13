// Headless smoke run of the real-API flow (task dev:orchestrator, dev:gateway with
// CT_EXTRA_LAB_DIRS=services/gateway/test/fixtures/labs, dev:web must be running).
//
//   node apps/web/scripts/smoke-real.mjs [--base http://localhost:5173] [--chromium /usr/bin/chromium]
//
// Catalog shows the real Kubernetes labs -> lab overview -> Start lab -> provisioning
// -> real terminal (types a command, reads the output back from xterm) -> Validate
// (no grader yet: expects the timeout state) -> End lab. Also starts one real
// Kubernetes lab to capture how the UI reports an environment that cannot start.
// Screenshots go to apps/web/docs/screenshots/real/.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:5173');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/screenshots/real');
await mkdir(out, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`, ...a);
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  log('screenshot', `${name}.png`);
};

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => log('PAGE ERROR', e.message));
let failed = false;
const check = (ok, what) => {
  log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failed = true;
};

try {
  // Catalog: the 11 real Kubernetes labs
  await page.goto(`${base}/catalog?domain=kubernetes`);
  await page.locator('a.lab-row').first().waitFor();
  const rows = await page.locator('a.lab-row').count();
  check(rows === 11, `catalog lists ${rows} Kubernetes labs`);
  await shot(page, 'catalog-kubernetes');

  // A real lab overview: task text with params as ‹name›, real topology
  await page.goto(`${base}/labs/drain-yard-worker`);
  await page.getByText('Take a worker out of service').first().waitFor();
  check(await page.getByText('‹target›').first().isVisible(), 'overview shows unresolved params as ‹target›');
  await shot(page, 'overview-drain-yard-worker');

  // Smoke lab (container node only, runs on the current orchestrator)
  await page.goto(`${base}/labs/gateway-smoke`);
  await page.getByRole('link', { name: /Start lab/ }).click();
  await page.waitForURL(/\/work\?s=/);
  const sessionId = new URL(page.url()).searchParams.get('s');
  log('session', sessionId);
  const env = page.locator('.ws-env');
  if (await env.isVisible().catch(() => false)) await shot(page, 'workspace-provisioning');

  const term = page.locator('.pane.is-active .xterm');
  await term.waitFor({ timeout: 120_000 });
  const screen = page.locator('.pane.is-active .xterm-rows');
  await page.waitForFunction(() => /learner@workstation/.test(document.querySelector('.pane.is-active .xterm-rows')?.textContent ?? ''), null, { timeout: 30_000 });
  check(true, 'terminal shows the learner prompt on workstation');

  const session = await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).json(), sessionId);
  const note = session.params.note;
  check(await page.locator('.task').getByText(`~/handover/${note}`).first().isVisible(), `task panel shows the resolved param (${note})`);
  await term.click();
  await page.keyboard.type(`echo ready > ~/handover/${note} && echo "wrote $(cat ~/handover/${note}) on $(hostname) as $(whoami)"\n`, { delay: 5 });
  await page.waitForFunction(() => /wrote ready on workstation as learner/.test(document.querySelector('.pane.is-active .xterm-rows')?.textContent ?? ''), null, { timeout: 15_000 });
  check(true, 'command typed in xterm ran in the pod and its output came back');
  await shot(page, 'workspace-terminal');

  // Validate: no grader on this orchestrator yet -> clear timeout state
  await page.getByRole('button', { name: 'Validate' }).click();
  await page.getByText('No grading result yet').first().waitFor({ timeout: 90_000 });
  check(true, 'validate without a grader shows the timeout state');
  await shot(page, 'workspace-validate-timeout');
  log('terminal text:', (await screen.textContent())?.replace(/\s+/g, ' ').slice(0, 300));

  await page.getByRole('button', { name: 'End lab' }).click();
  await page.waitForURL(/\/labs\/gateway-smoke$/);
  const gone = await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).status, sessionId);
  check(gone === 404 || gone === 200, `End lab deleted the session (GET -> ${gone}, 200 while the finalizer runs)`);

  // A real Kubernetes lab on an orchestrator without the k8s-cluster driver: failure state
  await page.goto(`${base}/labs/two-container-pod/work`);
  await page.waitForURL(/\/work\?s=/);
  const realId = new URL(page.url()).searchParams.get('s');
  await page.locator('.ws-env').waitFor();
  const outcome = await Promise.race([
    page.getByText('could not start').first().waitFor({ timeout: 90_000 }).then(() => 'failed'),
    page.locator('.pane.is-active .xterm').waitFor({ timeout: 90_000 }).then(() => 'ready'),
  ]);
  log('two-container-pod environment:', outcome, (await page.locator('.ws-env-msg').textContent().catch(() => '')) ?? '');
  await shot(page, outcome === 'failed' ? 'workspace-environment-failed' : 'workspace-real-lab');
  await page.evaluate(async (id) => fetch(`/api/sessions/${id}`, { method: 'DELETE' }), realId);
  log('deleted', realId);
} catch (e) {
  failed = true;
  log('ERROR', e instanceof Error ? e.message : e);
  await shot(page, 'error').catch(() => {});
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
