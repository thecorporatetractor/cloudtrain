// Captures the screenshots used by the repository README (mock mode).
//
//   pnpm --filter web dev -- --port 5199 &
//   node apps/web/scripts/readme-shots.mjs [--base http://localhost:5199] [--chromium /usr/bin/chromium]
//
// Output: docs/images/*.png at the repository root. The screenshots the public
// website shows (apps/web/public/site/) come from scripts/site-shots.mjs.
//
// Real mode (a VITE_API_MODE=real dev server in front of a gateway): pass a
// Playwright storageState from deploy/scripts/dev-signin-as.mjs and an output
// directory. The read-only pages are taken as that signed-in user (no lab is
// started, personas are ignored, the mock-fixture waitFor texts are best effort):
//
//   node apps/web/scripts/readme-shots.mjs --base http://localhost:5197 --storage /tmp/me.json --out /tmp/shots
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:5199');
const storage = arg('storage', '');
if (storage && !arg('out', '')) throw new Error('--storage (real mode) needs --out <dir>: the committed README images are mock mode');
const out = arg('out', '') ? path.resolve(arg('out')) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/images');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
let failed = false;

// Mock-mode accounts (see src/mocks/fixtures/platform.ts): one per role.
const PERSONAS = { learner: { userId: 'u-lena', orgId: 'org-quillmoor' }, manager: { userId: 'u-ingrid', orgId: 'org-quillmoor' }, instructor: { userId: 'u-samir', orgId: 'org-quillmoor' }, author: { userId: 'u-aino', orgId: 'org-quillmoor' }, org_admin: { userId: 'u-priya', orgId: 'org-quillmoor' } };

async function session(theme, persona = 'manager', launch = 'live') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', ...(storage ? { storageState: storage } : {}) });
  await ctx.addInitScript(
    ({ t, s, l }) => {
      localStorage.setItem('ct.theme', t);
      if (s !== null) localStorage.setItem('ct.mock.session', s);
      // The website's launch mode (src/site/launch.ts); the README shows the live site and the coming-soon page.
      localStorage.setItem('ct.site.launch', l);
    },
    { t: theme, s: storage ? null : persona === 'none' ? 'none' : JSON.stringify(PERSONAS[persona]), l: launch },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    if (/ServiceWorker/.test(e.message)) return; // dev-server MSW update check, harmless
    console.log('PAGE ERROR', e.message);
    failed = true;
  });
  return { ctx, page };
}

async function open(page, url, waitFor) {
  await page.goto(base + url, { waitUntil: 'networkidle' });
  if (waitFor) {
    const seen = page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 });
    // Real mode: the texts match the mock fixtures, not the signed-in user's data.
    if (storage) await seen.catch(() => console.log(`note: "${waitFor}" not on ${url} (real data)`));
    else await seen;
  }
  await page.waitForTimeout(700);
}

/** Real mode: read-only pages as the storageState user; nothing that starts a lab or changes state. */
async function realMode() {
  const { ctx, page } = await session('dark');
  for (const [url, waitFor, name] of [
    ['/', 'Next best lab', 'home'],
    ['/catalog', 'Kubernetes', 'catalog'],
    ['/labs/orchard-netpol-isolation', 'Isolate', 'lab-overview'],
    ['/skills', 'Skills', 'skills'],
    ['/assignments', 'My assignments', 'assignments'],
    ['/history', 'History', 'history'],
    ['/exams', 'Exam', 'exams'],
  ]) {
    await open(page, url, waitFor);
    await shot(page, name);
  }
  await ctx.close();
}

async function settled(page) {
  await page.getByText(/provisioning/i).first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Answers the mock CTF lab's first questions: one wrong and one right answer, a computed number, then a hint on question 3. */
async function answerCtf(page) {
  const answer = async (n, text) => {
    await page.getByLabel(`Answer to question ${n}`).fill(text);
    await page.getByLabel(`Answer to question ${n}`).press('Enter');
    await page.waitForTimeout(700);
  };
  await answer(1, '198.51.100.4');
  await answer(1, '203.0.113.77');
  await answer(2, '48');
  await page.getByRole('button', { name: 'Reveal · −30' }).click();
  await page.getByRole('button', { name: 'Reveal for 30 points' }).click();
  await page.waitForTimeout(700);
  await page.getByLabel('Answer to question 3').fill('bram');
  await page.waitForTimeout(300);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('saved', `${name}.png`);
}

try {
  if (storage) {
    await realMode();
    await browser.close();
    process.exit(failed ? 1 : 0);
  }
  let { ctx, page } = await session('dark');

  await open(page, '/', 'Next best lab');
  await shot(page, 'home');

  await open(page, '/catalog', 'Kubernetes');
  await shot(page, 'catalog');

  await open(page, '/labs/orchard-netpol-isolation', 'Isolate');
  await shot(page, 'lab-overview');

  await open(page, '/labs/orchard-netpol-isolation/work', 'CHECKS');
  await settled(page);
  const term = page.locator('.xterm').first();
  await term.click();
  await page.keyboard.type('kubectl get nodes', { delay: 25 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /validate/i }).first().click();
  await page.getByText(/checks passed/i).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  await shot(page, 'workspace');

  await open(page, '/skills', 'Skills');
  await shot(page, 'skills');
  await ctx.close();

  // CTF lab: the questions panel after a few answers (learner).
  {
    const s = await session('dark', 'learner');
    await open(s.page, '/labs/quill-ctf-gateway-breach/work', 'Questions');
    await settled(s.page);
    await answerCtf(s.page);
    await shot(s.page, 'ctf-questions');
    await open(s.page, '/events/ev-depot-night/scoreboard', 'Solve timeline');
    await shot(s.page, 'ctf-scoreboard');
    await s.ctx.close();
  }
  ({ ctx, page } = await session('dark'));

  await open(page, '/team', 'Members × competencies');
  await shot(page, 'team');

  await open(page, '/team/assign?team=t-platrel', 'Assign work');
  await page.getByRole('radio', { name: /Isolate the payments/ }).click();
  await page.waitForTimeout(300);
  await shot(page, 'assign');

  await open(page, '/', 'Next best lab');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  await page.keyboard.type('net', { delay: 40 });
  await page.waitForTimeout(600);
  await shot(page, 'command-palette');
  await ctx.close();

  // Role-specific areas, each with the account that owns them.
  const views = [
    ['author', '/studio/draft-netpol-v4', 'Verification', 'studio'],
    ['instructor', '/cohorts/c-cks-q4', 'Live board', 'instructor-board'],
    ['org_admin', '/admin/users', 'Pending invitations', 'admin-users'],
    ['org_admin', '/admin/sso', 'Identity providers', 'admin-sso'],
    ['org_admin', '/admin/audit', 'Export CSV', 'audit-log'],
    ['none', '/sign-in', 'Sign in', 'sign-in'],
    // The public website (signed out): landing page and read-only catalog.
    ['none', '/', 'How a lab works', 'landing'],
    ['none', '/catalog', 'Everything you can practise', 'catalog-public'],
    ['none', '/catalog/paths/cks-readiness', 'Network policy and least privilege', 'catalog-path-public'],
    ['none', '/pricing', 'Compare plans', 'pricing'],
    ['learner', '/account/billing', 'Plans for you', 'billing'],
    ['none', '/', 'Three ways to run CloudTrain', 'coming-soon'],
  ];
  for (const [persona, url, waitFor, name] of views) {
    const s = await session('dark', persona, name === 'coming-soon' ? 'coming-soon' : 'live');
    await open(s.page, url, waitFor);
    await shot(s.page, name);
    await s.ctx.close();
  }

  for (const theme of ['light', 'cream']) {
    const s = await session(theme);
    await open(s.page, '/labs/orchard-netpol-isolation/work', 'CHECKS');
    await settled(s.page);
    await shot(s.page, `workspace-${theme}`);
    await open(s.page, '/', 'Next best lab');
    await shot(s.page, `home-${theme}`);
    await s.ctx.close();
  }
} catch (e) {
  console.log('FAILED', e.message);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
