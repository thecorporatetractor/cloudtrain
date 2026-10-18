// Captures the product screenshots the public website shows (mock mode):
// content/site.yaml `hero.preview`, `differentiators[].figure` and `showcase[].figure`.
//
//   pnpm --filter web dev -- --port 5199 &
//   node apps/web/scripts/site-shots.mjs [--base http://localhost:5199] [--chromium /usr/bin/chromium] [--only workspace,skills]
//
// Output: apps/web/public/site/<name>-<dark|light>.webp, real screens of the mock
// world captured at 1440×900 with the navigation collapsed to its rail (the whole
// views) and at 2× for the cropped panels (topology, checks, skills summary) that
// the differentiators use. The light variants serve the light and cream themes.
// Every file is printed with its pixel size, which the configuration repeats as
// `width`/`height` so the page reserves the space before the image loads. The
// WebP encoding is Chromium's own (a canvas in a blank page), so no image library
// is needed.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:5199');
const only = arg('only', '')?.split(',').filter(Boolean);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/site');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
const encoder = await browser.newContext();
let failed = false;

// Mock-mode accounts (src/mocks/fixtures/platform.ts).
const PERSONAS = { learner: { userId: 'u-lena', orgId: 'org-quillmoor' }, manager: { userId: 'u-ingrid', orgId: 'org-quillmoor' } };
const THEMES = ['dark', 'light'];
const VIEW = { width: 1440, height: 900 };

async function session(theme, persona, scale = 1) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: scale });
  await ctx.addInitScript(
    ({ t, s }) => {
      localStorage.setItem('ct.theme', t);
      localStorage.setItem('ct.mock.session', s);
      localStorage.setItem('ct.nav.collapsed', '1');
    },
    { t: theme, s: JSON.stringify(PERSONAS[persona]) },
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
  await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
}

async function settled(page) {
  await page.getByText(/provisioning/i).first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Writes a WebP of the PNG capture (encoded by Chromium through a canvas) and prints its size. */
async function save(buffer, name, theme) {
  const file = path.join(out, `${name}-${theme}.webp`);
  const page = await encoder.newPage();
  const { data, width, height } = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { data: canvas.toDataURL('image/webp', 0.84).split(',')[1], width: canvas.width, height: canvas.height };
  }, buffer.toString('base64'));
  await page.close();
  await writeFile(file, Buffer.from(data, 'base64'));
  console.log('saved', path.basename(file), `${width}x${height}`);
}

const wanted = (name) => !only?.length || only.includes(name);

/** A 4:3 clip from the top-left of an element, so a crop never hides what the figure describes. */
async function clipOf(page, locator, maxWidth) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  const width = Math.min(box.width, maxWidth);
  const height = Math.round(width * 0.75);
  return { x: box.x, y: box.y, width, height: Math.min(height, VIEW.height - box.y) };
}

/** The workspace after a validation run, plus the topology and checks crops. */
async function workspace(theme) {
  const { ctx, page } = await session(theme, 'manager');
  await open(page, '/labs/orchard-netpol-isolation/work', 'CHECKS');
  await settled(page);
  const term = page.locator('.xterm').first();
  await term.click();
  await page.keyboard.type('kubectl get pods -n payments', { delay: 25 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /validate/i }).first().click();
  await page.getByText(/checks passed/i).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  // The toast would cover the terminal in the preview; it is not part of the view.
  await page.getByRole('button', { name: /dismiss|close/i }).last().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  if (wanted('workspace')) await save(await page.screenshot({ type: 'png' }), 'workspace', theme);
  await ctx.close();

  // Crops at 2× for the differentiator figures.
  const hi = await session(theme, 'manager', 2);
  await open(hi.page, '/labs/orchard-netpol-isolation/work', 'CHECKS');
  await settled(hi.page);
  await hi.page.locator('.xterm').first().click();
  await hi.page.keyboard.type('kubectl get nodes -o wide', { delay: 25 });
  await hi.page.keyboard.press('Enter');
  await hi.page.waitForTimeout(800);
  await hi.page.getByRole('button', { name: /validate/i }).first().click();
  await hi.page.getByText(/checks passed/i).first().waitFor({ timeout: 15000 });
  await hi.page.waitForTimeout(1200);
  await hi.page.getByRole('button', { name: /dismiss|close/i }).last().click({ timeout: 2000 }).catch(() => {});
  await hi.page.waitForTimeout(300);
  if (wanted('topology')) {
    const clip = await clipOf(hi.page, hi.page.locator('.react-flow').first(), 1120);
    await save(await hi.page.screenshot({ type: 'png', clip }), 'topology', theme);
  }
  if (wanted('checks')) {
    const section = hi.page.locator('.task-section', { has: hi.page.locator('.checks') }).first();
    const clip = await clipOf(hi.page, section, 480);
    await save(await hi.page.screenshot({ type: 'png', clip }), 'checks', theme);
  }
  await hi.ctx.close();
}

/** Mastery per objective (manager, default framework), plus the summary crop. */
async function skills(theme) {
  if (wanted('skills')) {
    const { ctx, page } = await session(theme, 'manager');
    await open(page, '/skills', 'Skills');
    await save(await page.screenshot({ type: 'png' }), 'skills', theme);
    await ctx.close();
  }
  if (wanted('skills-summary')) {
    const { ctx, page } = await session(theme, 'manager', 2);
    await open(page, '/skills', 'Skills');
    const clip = await clipOf(page, page.locator('.skills-summary').first(), 1000);
    await save(await page.screenshot({ type: 'png', clip }), 'skills-summary', theme);
    await ctx.close();
  }
}

/** A seeded exam attempt's report (learner). */
async function examResults(theme) {
  if (!wanted('exam-results')) return;
  const { ctx, page } = await session(theme, 'learner');
  await open(page, '/exams/attempts/exam-3f9a1c02de/results', 'By objective');
  await save(await page.screenshot({ type: 'png' }), 'exam-results', theme);
  await ctx.close();
}

/** The manager's team dashboard. */
async function team(theme) {
  if (!wanted('team')) return;
  const { ctx, page } = await session(theme, 'manager');
  await open(page, '/team', 'Members × competencies');
  await save(await page.screenshot({ type: 'png' }), 'team', theme);
  await ctx.close();
}

try {
  for (const theme of THEMES) {
    if (wanted('workspace') || wanted('topology') || wanted('checks')) await workspace(theme);
    await skills(theme);
    await examResults(theme);
    await team(theme);
  }
} catch (e) {
  console.log('FAILED', e.message);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
