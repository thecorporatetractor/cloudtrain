// Captures the product screenshots of the features page (/features) and of the
// homepage callout that leads to it (mock mode): content/site.yaml `featurePage`.
//
//   pnpm --filter web exec vite --port 6985 &
//   node apps/web/scripts/feature-shots.mjs [--base http://localhost:6985] [--chromium /usr/bin/chromium]
//                                           [--only workspace,skills] [--themes dark,light]
//
// Output: apps/web/public/site/features/<name>-<dark|light>.webp (1440 wide, the 1x
// image) and <name>-<dark|light>@2x.webp (2880 wide, for high-density screens). Every
// view is a real screen of the mock world at 1440×900, captured at a device scale of 2
// so the 2x image is a true capture, not an upscale; the 1x image is the same capture
// scaled down. The light variants serve the light and cream themes. The WebP encoding is
// Chromium's own (a canvas in a blank page), like scripts/site-shots.mjs, so no image
// library is needed. The mock-mode persona switcher in the navigation is not part of
// the product and is hidden. Every file is printed with its pixel size and weight;
// the configuration repeats the 1x size as `width`/`height` so the page reserves the
// space before the image loads. Exits non-zero on a page error.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:6985');
const only = arg('only', '')?.split(',').filter(Boolean);
const themes = arg('themes', 'dark,light').split(',').filter(Boolean);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/site/features');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
const encoder = await browser.newContext();
let failed = false;
let bytes = 0;

// Mock-mode accounts (src/mocks/fixtures/platform.ts), one per role.
const PERSONAS = { learner: { userId: 'u-lena', orgId: 'org-quillmoor' }, manager: { userId: 'u-ingrid', orgId: 'org-quillmoor' }, instructor: { userId: 'u-samir', orgId: 'org-quillmoor' }, org_admin: { userId: 'u-priya', orgId: 'org-quillmoor' } };
const VIEW = { width: 1440, height: 900 };
const SCALE = 2;
/** WebP quality: the 2x image is viewed scaled down, so it can be lighter per pixel. */
const QUALITY = { '1x': 0.84, '2x': 0.76 };

async function session(theme, persona, nav = 'full') {
  // Reduced motion: the finished state of every entrance. The clock is installed per page where a view needs it.
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'reduce' });
  await ctx.addInitScript(
    ({ t, s, n }) => {
      localStorage.setItem('ct.theme', t);
      localStorage.setItem('ct.mock.session', s);
      localStorage.setItem('ct.nav.collapsed', n);
      localStorage.setItem('ct.site.launch', 'live');
      // The demo persona switcher (mock mode only, app/PersonaSwitcher.tsx) is not part of the product.
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.nav-persona { display: none !important; }';
        document.head.appendChild(style);
      });
    },
    { t: theme, s: JSON.stringify(PERSONAS[persona]), n: nav === 'rail' ? '1' : '0' },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    if (/ServiceWorker/.test(e.message)) return;
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

/** Encodes the PNG capture (2880×1800) as the 2x and the 1x WebP, through a canvas in Chromium. */
async function save(buffer, name, theme) {
  const page = await encoder.newPage();
  const files = await page.evaluate(
    async ({ png, q }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const encode = (scale, quality) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const c = canvas.getContext('2d');
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(img, 0, 0, canvas.width, canvas.height);
        return { data: canvas.toDataURL('image/webp', quality).split(',')[1], width: canvas.width, height: canvas.height };
      };
      return { '2x': encode(1, q['2x']), '1x': encode(0.5, q['1x']) };
    },
    { png: buffer.toString('base64'), q: QUALITY },
  );
  await page.close();
  for (const [density, f] of Object.entries(files)) {
    const file = path.join(out, `${name}-${theme}${density === '2x' ? '@2x' : ''}.webp`);
    const buf = Buffer.from(f.data, 'base64');
    await writeFile(file, buf);
    bytes += buf.length;
    console.log('saved', path.basename(file), `${f.width}x${f.height}`, `${Math.round(buf.length / 1024)} KiB`);
  }
}

/**
 * Subscribes the persona to Premium through the mock checkout (mock billing starts every
 * persona without a plan), then returns to `url`. The workspace lab runs a kubeadm cluster,
 * a Premium lab (content/site.yaml plans.premium), and the catalog of a subscriber carries
 * no upgrade banner.
 */
const subscribed = (url, waitFor) => async (page) => {
  await page.goto(`${base}/account/billing`, { waitUntil: 'networkidle' });
  const subscribe = page.getByRole('button', { name: 'Subscribe to Premium' });
  if (await subscribe.isVisible().catch(() => false)) {
    await subscribe.click();
    await page.getByText('Checkout complete').first().waitFor();
  }
  await open(page, url, waitFor);
};

/** The lab workspace after a command and a validation run (the toast is dismissed; it is not part of the view). */
async function workspaceSteps(page) {
  await subscribed('/labs/orchard-netpol-isolation/work', 'CHECKS')(page);
  await page.getByText(/provisioning/i).first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const term = page.locator('.xterm').first();
  await term.click();
  await page.keyboard.type('kubectl get pods -n payments', { delay: 25 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /validate/i }).first().click();
  await page.getByText(/checks passed/i).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /dismiss|close/i }).last().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/** The pre-exam page with the checklist ticked. */
async function examChecklistSteps(page) {
  for (const box of await page.locator('.exam-checklist input[type=checkbox]').all()) await box.check();
  await page.waitForTimeout(200);
}

/** An exam in progress: start it (the mock clock makes the environment ready), run a command, flag a task, open another. */
async function examWorkspaceSteps(page) {
  await examChecklistSteps(page);
  await page.getByRole('button', { name: /start exam/i }).click();
  await page.getByText(/Preparing your exam environment/).waitFor({ timeout: 15000 });
  await page.clock.runFor(5000);
  await page.getByText(/Task 1 of/).waitFor({ timeout: 20000 });
  await page.locator('.xterm').first().waitFor();
  await page.locator('.xterm').first().click();
  await page.keyboard.type('kubectl config get-contexts', { delay: 15 });
  await page.keyboard.press('Enter');
  await page.locator('.exam-nav-item').nth(1).click();
  await page.getByRole('button', { name: /flag for review/i }).click();
  await page.locator('.exam-nav-item').nth(4).click();
  await page.waitForTimeout(500);
}

/** [name, persona, url, waitFor, extra steps, options { nav: 'rail' | 'full', clock: boolean }] */
const VIEWS = [
  // Learn
  ['workspace', 'manager', '/labs/orchard-netpol-isolation/work', 'CHECKS', workspaceSteps, { nav: 'rail' }],
  ['lab-overview', 'learner', '/labs/orchard-netpol-isolation', 'Scenario'],
  ['catalog', 'manager', '/catalog', 'Paths', subscribed('/catalog', 'Paths')],
  ['home', 'learner', '/', 'Next best lab'],
  ['skills', 'manager', '/skills', 'Skills'],
  ['event-scoreboard', 'learner', '/events/ev-depot-night/scoreboard', 'Solve timeline'],
  // Exams
  ['exam-detail', 'learner', '/exams/sim-k8s-developer', 'Before you start', examChecklistSteps],
  ['exam-workspace', 'learner', '/exams/sim-k8s-developer', 'Before you start', examWorkspaceSteps, { clock: true }],
  ['exam-results', 'learner', '/exams/attempts/exam-3f9a1c02de/results', 'By objective'],
  // Teach and manage
  ['team', 'manager', '/team', 'Members × competencies'],
  ['team-exams', 'manager', '/team/exams?team=t-platrel', 'Exam readiness'],
  ['cohort-board', 'instructor', '/cohorts/c-cks-q4', 'Live board'],
  // Admin
  ['admin-users', 'org_admin', '/admin/users', 'Pending invitations'],
  ['admin-sso', 'org_admin', '/admin/sso', 'Identity providers'],
  ['admin-usage', 'org_admin', '/admin/usage', 'Quotas'],
  ['admin-audit', 'org_admin', '/admin/audit', 'Export CSV'],
];

try {
  for (const theme of themes) {
    for (const [name, persona, url, waitFor, extra, opts = {}] of VIEWS) {
      if (only?.length && !only.includes(name)) continue;
      const { ctx, page } = await session(theme, persona, opts.nav);
      try {
        if (opts.clock) await page.clock.install();
        await open(page, url, waitFor);
        if (extra) await extra(page);
        await page.waitForTimeout(300);
        await save(await page.screenshot({ type: 'png' }), name, theme);
      } catch (e) {
        console.log('FAILED', `${name}-${theme}`, e.message.split('\n')[0]);
        failed = true;
      }
      await ctx.close();
    }
  }
} catch (e) {
  console.log('FAILED', e.message);
  failed = true;
} finally {
  await browser.close();
}
console.log(`total ${Math.round(bytes / 1024)} KiB written to ${path.relative(process.cwd(), out)}`);
process.exit(failed ? 1 : 0);
