// Captures the screenshots used by the repository README (mock mode).
//
//   pnpm --filter web dev -- --port 5199 &
//   node apps/web/scripts/readme-shots.mjs [--base http://localhost:5199] [--chromium /usr/bin/chromium]
//
// Output: docs/images/*.png at the repository root.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:5199');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/images');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
let failed = false;

// Mock-mode accounts (see src/mocks/fixtures/platform.ts): one per role.
const PERSONAS = { learner: { userId: 'u-lena', orgId: 'org-quillmoor' }, manager: { userId: 'u-ingrid', orgId: 'org-quillmoor' }, instructor: { userId: 'u-samir', orgId: 'org-quillmoor' }, author: { userId: 'u-aino', orgId: 'org-quillmoor' }, org_admin: { userId: 'u-priya', orgId: 'org-quillmoor' } };

async function session(theme, persona = 'manager') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ({ t, s }) => {
      localStorage.setItem('ct.theme', t);
      localStorage.setItem('ct.mock.session', s);
    },
    { t: theme, s: persona === 'none' ? 'none' : JSON.stringify(PERSONAS[persona]) },
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
  if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
}

async function settled(page) {
  await page.getByText(/provisioning/i).first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('saved', `${name}.png`);
}

try {
  const { ctx, page } = await session('dark');

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
  ];
  for (const [persona, url, waitFor, name] of views) {
    const s = await session('dark', persona);
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
