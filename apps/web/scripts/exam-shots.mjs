// Screenshots of the exam simulation flow (mock mode), in the three themes.
//
//   pnpm --filter web exec vite --port 5288 &
//   node apps/web/scripts/exam-shots.mjs [--base http://localhost:5288] [--chromium /usr/bin/chromium] [--themes dark,light,cream]
//
// Output: apps/web/docs/screenshots/exams/<screen>-<theme>.png
// The exam clock is driven with Playwright's clock API (the mock API runs in the page),
// so "time is up" and grading are captured without waiting two hours.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:5288');
const themes = arg('themes', 'dark,light,cream').split(',');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/screenshots/exams');
await mkdir(out, { recursive: true });

const PERSONAS = { learner: { userId: 'u-lena', orgId: 'org-quillmoor' }, manager: { userId: 'u-ingrid', orgId: 'org-quillmoor' } };

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
let failed = false;

async function shot(page, name, theme) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}-${theme}.png`) });
  console.log('saved', `${name}-${theme}.png`);
}

async function run(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Mock personas (platform fixtures): the learner takes the exam, the manager of
  // her team (Platform Reliability) looks at team readiness.
  await ctx.addInitScript(
    ({ t, learner }) => {
      localStorage.setItem('ct.theme', t);
      localStorage.setItem('ct.mock.session', sessionStorage.getItem('ct.shots.session') ?? learner);
    },
    { t: theme, learner: JSON.stringify(PERSONAS.learner) },
  );
  const page = await ctx.newPage();
  await page.clock.install();
  page.on('pageerror', (e) => {
    if (/ServiceWorker/.test(e.message)) return;
    console.log('PAGE ERROR', e.message);
    failed = true;
  });
  const go = async (url, text) => {
    await page.goto(base + url, { waitUntil: 'networkidle' });
    if (text) await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
  };

  // 1. Catalog with the alignment disclaimers, durations, pass marks and rules.
  await go('/exams', 'Exam simulations');
  await page.locator('.exam-card').first().waitFor();
  await shot(page, '01-catalog', theme);

  // 2. Pre-exam checklist, ticked.
  await go('/exams/sim-k8s-developer', 'Before you start');
  for (const box of await page.locator('.exam-checklist input[type=checkbox]').all()) await box.check();
  await shot(page, '02-pre-exam-checklist', theme);

  // 3. Start -> preparing (timer not running yet).
  await page.getByRole('button', { name: /start exam/i }).click();
  await page.getByText(/Preparing your exam environment/).waitFor({ timeout: 15000 });
  await shot(page, '03-preparing', theme);

  // 4. Environment ready: workspace with timer, navigator, statement, terminal.
  await page.clock.runFor(5000);
  await page.getByText(/Task 1 of/).waitFor({ timeout: 20000 });
  await page.locator('.xterm').first().waitFor();
  await page.locator('.xterm').first().click();
  await page.keyboard.type('kubectl config get-contexts', { delay: 15 });
  await page.keyboard.press('Enter');
  // Flag task 2, open task 3.
  await page.locator('.exam-nav-item').nth(1).click();
  await page.getByRole('button', { name: /flag for review/i }).click();
  await page.locator('.exam-nav-item').nth(2).click();
  await page.locator('.exam-nav-item').nth(4).click();
  await page.waitForTimeout(400);
  await shot(page, '04-workspace', theme);

  // 5. Submit confirmation (flagged and unopened tasks listed).
  await page.getByRole('button', { name: /submit exam/i }).click();
  await page.getByText(/Submit your exam\?/).waitFor();
  await shot(page, '05-submit-confirm', theme);
  await page.getByRole('button', { name: /keep working/i }).click();

  // 6. Time is up: jump past the deadline and hold the clock there, so the
  // overlay is captured before the auto-submit's response lands.
  const t = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(t + 2 * 60 * 60 * 1000 + 2000);
  await page.getByText(/Time is up/).first().waitFor({ timeout: 15000 });
  await shot(page, '06-time-up', theme);
  await page.clock.resume();

  // 7. Grading, then the results with the per-objective breakdown.
  await page.getByText(/Time is up. Grading your work/).first().waitFor({ timeout: 15000 });
  await shot(page, '07-grading', theme);
  await page.clock.runFor(5000);
  await page.getByRole('button', { name: /view results/i }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /view results/i }).click();
  await page.getByText(/By objective/).waitFor({ timeout: 15000 });
  await shot(page, '08-results', theme);
  await page.mouse.wheel(0, 700);
  await shot(page, '09-results-tasks', theme);

  // 10. A failed attempt's report (seeded history).
  await go('/exams/attempts/exam-3f9a1c02de/results', 'By objective');
  await shot(page, '10-results-fail', theme);

  // 11. Attempts history.
  await go('/exams?view=attempts', 'Attempt history');
  await shot(page, '11-attempts', theme);

  // 12. Manager view of team exam readiness (switch to the manager persona; the
  // learner's attempt above shows up in her row).
  await page.evaluate((m) => sessionStorage.setItem('ct.shots.session', m), JSON.stringify(PERSONAS.manager));
  await go('/team/exams', 'Exam readiness');
  await page.getByText('Lena Varga').first().waitFor({ timeout: 15000 });
  await page.locator('.table').first().waitFor();
  await shot(page, '12-team-readiness', theme);

  await ctx.close();
}

try {
  for (const t of themes) await run(t);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
