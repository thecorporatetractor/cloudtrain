// Screenshots of the role-based platform views (mock mode), one persona per area.
//
//   pnpm --filter web dev -- --port 5199 &
//   node apps/web/scripts/platform-shots.mjs [--base http://localhost:5199] [--chromium /usr/bin/chromium] [--only sign-in,admin-users]
//
// Output: apps/web/docs/screenshots/platform/<view>-<theme>.png. Dark for every
// view, light and cream for a few. Exits non-zero on a page error.
//
// Real mode (a VITE_API_MODE=real dev server in front of a gateway): pass a
// Playwright storageState from deploy/scripts/dev-signin-as.mjs and an output
// directory. Every view is then taken as that signed-in user (personas are
// ignored), only the read-only views run unless --only names others, and the
// waitFor texts (written for the mock fixtures) are best effort.
//
//   node apps/web/scripts/platform-shots.mjs --base http://localhost:5197 --storage /tmp/me.json --out /tmp/shots [--only home-learner]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:5199');
const only = arg('only', '')?.split(',').filter(Boolean);
const storage = arg('storage', '');
if (storage && !arg('out', '')) throw new Error('--storage (real mode) needs --out <dir>: the committed screenshots are mock mode');
const out = arg('out', '') ? path.resolve(arg('out')) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/screenshots/platform');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
let failed = false;

const PERSONAS = { learner: { userId: 'u-lena', orgId: 'org-quillmoor' }, learner_impersonated: { userId: 'u-lena', orgId: 'org-quillmoor', impersonated: true }, manager: { userId: 'u-ingrid', orgId: 'org-quillmoor' }, instructor: { userId: 'u-samir', orgId: 'org-quillmoor' }, author: { userId: 'u-aino', orgId: 'org-quillmoor' }, org_admin: { userId: 'u-priya', orgId: 'org-quillmoor' }, platform_admin: { userId: 'u-elin', orgId: 'org-acme' } };

async function session(theme, persona, width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(storage ? { storageState: storage } : {}) });
  await ctx.addInitScript(
    ({ t, s }) => {
      localStorage.setItem('ct.theme', t);
      if (s !== null) localStorage.setItem('ct.mock.session', s);
      localStorage.setItem('ct.nav.collapsed', '0');
    },
    { t: theme, s: storage ? null : persona === 'none' ? 'none' : JSON.stringify(PERSONAS[persona]) },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    if (/ServiceWorker/.test(e.message)) return;
    console.log('PAGE ERROR', e.message);
    failed = true;
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ServiceWorker|favicon|net::ERR/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200));
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
  await page.waitForTimeout(600);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('saved', `${name}.png`);
}

/** CTF lab: one wrong and one right answer, a computed number, a revealed hint on question 3 (mock answers). */
async function ctfSteps(page, hint = true) {
  const answer = async (n, text) => {
    await page.getByLabel(`Answer to question ${n}`).fill(text);
    await page.getByLabel(`Answer to question ${n}`).press('Enter');
    await page.waitForTimeout(700);
  };
  await answer(1, '198.51.100.4');
  await answer(1, '203.0.113.77');
  await answer(2, '48');
  if (hint) {
    await page.getByRole('button', { name: 'Reveal · −30' }).click();
    await page.getByRole('button', { name: 'Reveal for 30 points' }).click();
    await page.waitForTimeout(700);
  }
}

/** [name, persona, url, waitFor, extra steps, viewport (default 1440 x 900)] */
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const VIEWS = [
  // The public website (signed out), then the same header once signed in.
  ['landing', 'none', '/', 'How a lab works'],
  ['landing-phone', 'none', '/', 'How a lab works', undefined, PHONE],
  ['landing-tablet', 'none', '/', 'How a lab works', undefined, TABLET],
  ['site-menu-phone', 'none', '/', 'How a lab works', async (p) => (await p.getByRole('button', { name: 'Open menu' }).click(), await p.getByRole('dialog').waitFor()), PHONE],
  ['catalog-public', 'none', '/catalog', 'Everything you can practise'],
  ['catalog-public-domain', 'none', '/catalog?domain=kubernetes', 'Kubernetes'],
  ['catalog-public-phone', 'none', '/catalog', 'Everything you can practise', undefined, PHONE],
  ['catalog-path-public', 'none', '/catalog/paths/cks-readiness', 'Network policy and least privilege'],
  ['catalog-exam-public', 'none', '/catalog/exams/sim-k8s-admin', 'Objectives and weights'],
  ['pricing', 'none', '/pricing', 'Plans are being finalised'],
  ['about', 'none', '/about', 'Why CloudTrain exists'],
  ['faq', 'none', '/faq', 'Frequently asked questions', async (p) => p.locator('details').first().click()],
  ['contact', 'none', '/contact', 'Talk to us'],
  ['legal-terms', 'none', '/legal/terms', 'Terms of service'],
  ['site-signed-in', 'learner', '/about', 'Go to dashboard'],
  ['sign-in', 'none', '/sign-in', 'Sign in'],
  ['sign-in-sso', 'none', '/sign-in', 'Sign in', async (p) => (await p.getByLabel('Work email').fill('lena.varga@quillmoor.example'), await p.getByRole('button', { name: 'Continue' }).click(), await p.getByText('Continue with').waitFor())],
  ['sign-in-password', 'none', '/sign-in', 'Sign in', async (p) => (await p.getByLabel('Work email').fill('june.park@acmefreight.example'), await p.getByRole('button', { name: 'Continue' }).click(), await p.getByLabel('Password').waitFor())],
  ['sign-in-expired', 'none', '/sign-in?reason=expired&returnTo=%2Fteam', 'session expired'],
  ['forbidden', 'learner', '/admin', 'not available to you'],
  ['home-learner', 'learner', '/', 'Assignments due'],
  ['assignments', 'learner', '/assignments', 'My assignments'],
  ['history', 'learner', '/history', 'History'],
  ['history-attempt', 'learner', '/history', 'History', async (p) => (await p.locator('tr.row-link').first().click(), await p.getByText('Checks').first().waitFor())],
  ['history-ctf-attempt', 'learner', '/history', 'CTF points', async (p) => (await p.locator('tr.row-link', { hasText: '(CTF)' }).first().click(), await p.getByText('Questions').first().waitFor())],
  ['skills-learner', 'learner', '/skills?framework=lfcs', 'CTF points'],
  ['ctf-questions', 'learner', '/labs/quill-ctf-gateway-breach/work', 'Questions', ctfSteps],
  ['ctf-hint-confirm', 'learner', '/labs/quill-ctf-gateway-breach/work', 'Questions', async (p) => (await ctfSteps(p, false), await p.getByRole('button', { name: 'Reveal · −30' }).click(), await p.getByText('Reveal hint 1?').waitFor())],
  ['ctf-questions-phone', 'learner', '/labs/quill-ctf-gateway-breach/work', 'Questions', ctfSteps, PHONE],
  ['events', 'learner', '/events', 'Depot gateway night'],
  ['event-detail', 'learner', '/events/ev-depot-night', 'Challenges'],
  ['event-scoreboard', 'learner', '/events/ev-depot-night/scoreboard', 'Solve timeline'],
  ['event-scoreboard-phone', 'learner', '/events/ev-depot-night/scoreboard', 'Solve timeline', undefined, PHONE],
  ['event-questions', 'learner', '/events/ev-depot-night', 'Challenges', async (p) => (await p.getByRole('button', { name: 'Start' }).first().click(), await p.getByText('answers count for the whole team').waitFor({ timeout: 20000 }), await p.waitForTimeout(800))],
  ['event-manage', 'manager', '/events/ev-depot-night/manage', 'Participants'],
  ['event-new', 'manager', '/events', 'Depot gateway night', async (p) => (await p.getByRole('button', { name: 'New event' }).click(), await p.getByText('New CTF event').waitFor())],
  ['exams', 'learner', '/exams', 'Exam simulations'],
  ['dev-signin-banner', 'learner_impersonated', '/', 'Assignments due', async (p) => p.getByText('Dev sign-in as').waitFor()],
  ['user-menu', 'manager', '/', 'Next best lab', async (p) => (await p.getByRole('button', { name: 'Account menu' }).click(), await p.getByText('Organisation').waitFor())],
  ['persona-switcher', 'manager', '/', 'Next best lab', async (p) => (await p.getByRole('button', { name: 'Demo persona' }).click(), await p.getByText('Demo persona · mock mode').waitFor())],
  ['team-dashboard', 'manager', '/team', 'Members × competencies'],
  ['team-member', 'manager', '/team/members/u-lena?team=t-platrel', 'Lena Varga'],
  ['team-assign', 'manager', '/team/assign?team=t-platrel', 'Assign work', async (p) => (await p.getByRole('radio', { name: /Isolate the payments/ }).click(), await p.waitForTimeout(200))],
  ['team-assignments', 'manager', '/team/assignments?team=t-platrel', 'Assignments'],
  ['team-assignment-detail', 'manager', '/team/assignments?team=t-platrel', 'Assignments', async (p) => (await p.locator('tr.row-link').first().click(), await p.getByText('People').waitFor())],
  ['team-exams', 'manager', '/team/exams?team=t-platrel', 'Exam readiness'],
  ['skills-framework-picker', 'manager', '/skills', 'Skills', async (p) => (await p.getByRole('button', { name: /^Framework:/ }).click(), await p.getByRole('combobox').waitFor(), await p.waitForTimeout(200))],
  ['cohorts', 'instructor', '/cohorts', 'Cohorts'],
  ['cohort-board', 'instructor', '/cohorts/c-cks-q4', 'Live board'],
  ['cohort-terminate', 'instructor', '/cohorts/c-cks-q4', 'Live board', async (p) => (await p.getByRole('button', { name: /Session actions for Lena/ }).click(), await p.getByText('Terminate').click(), await p.getByText('Terminate Lena').waitFor())],
  ['observe', 'instructor', '/cohorts/c-cks-q4/observe/ls-lena-netpol', 'Observing', async (p) => p.waitForTimeout(6000)],
  ['workspace-observed', 'learner', '/labs/orchard-netpol-isolation/work', 'CHECKS', async (p) => (await p.getByText('An instructor is observing').waitFor({ timeout: 30000 }), await p.waitForTimeout(500))],
  ['studio-author', 'author', '/studio', 'Scenario Studio'],
  ['admin-overview', 'org_admin', '/admin', 'Recent activity'],
  ['admin-users', 'org_admin', '/admin/users', 'Pending invitations'],
  ['admin-user-edit', 'org_admin', '/admin/users?user=u-samir', 'Samir Haddad', async (p) => p.getByText('Roles').first().waitFor()],
  ['admin-invite', 'org_admin', '/admin/users?invite=true', 'Invite someone'],
  ['admin-deactivate', 'org_admin', '/admin/users?user=u-kofi', 'Kofi Mensah', async (p) => (await p.getByRole('button', { name: 'Deactivate' }).click(), await p.getByText('running labs will be terminated').waitFor())],
  ['admin-teams', 'org_admin', '/admin/teams?team=t-platrel', 'Members'],
  ['admin-sso', 'org_admin', '/admin/sso', 'Identity providers'],
  ['admin-sso-connection', 'org_admin', '/admin/sso?connection=sso-1', 'Group → roles'],
  ['admin-sso-wizard', 'org_admin', '/admin/sso?add=true', 'Add an identity provider'],
  ['admin-content', 'org_admin', '/admin/content', 'Pinned paths'],
  ['admin-sessions', 'org_admin', '/admin/sessions', 'Running'],
  ['admin-usage', 'org_admin', '/admin/usage', 'Quotas'],
  ['admin-audit', 'org_admin', '/admin/audit', 'Export CSV'],
  ['admin-audit-detail', 'org_admin', '/admin/audit', 'Export CSV', async (p) => (await p.locator('tr.row-link').first().click(), await p.getByText('Details').waitFor())],
  ['admin-settings', 'org_admin', '/admin/settings', 'Organisation'],
  ['platform-orgs', 'platform_admin', '/platform', 'Organisations'],
  ['platform-org', 'platform_admin', '/platform?org=org-quillmoor', 'Quotas'],
  ['platform-capacity', 'platform_admin', '/platform/capacity', 'Cluster nodes'],
  ['platform-content', 'platform_admin', '/platform/content', 'Global packs'],
  // Below 1024px the sidebar is a drawer behind the menu button.
  ['home-phone', 'learner', '/', 'Assignments due', undefined, PHONE],
  ['nav-drawer-phone', 'manager', '/', 'Next best lab', async (p) => (await p.getByRole('button', { name: 'Open navigation' }).click(), await p.getByRole('dialog', { name: 'Navigation' }).waitFor()), PHONE],
  ['team-dashboard-phone', 'manager', '/team', 'Members × competencies', undefined, PHONE],
  ['home-tablet', 'learner', '/', 'Assignments due', undefined, TABLET],
];

try {
  for (const [name, persona, url, waitFor, extra, viewport] of VIEWS) {
    if (only?.length && !only.includes(name)) continue;
    // Real mode: no clicks that change state, no labs started, no sign-in pages (already signed in).
    if (storage && !only?.length && (extra || persona === 'none' || /\/work$|\/observe\//.test(url))) continue;
    const { ctx, page } = await session('dark', persona, viewport?.width, viewport?.height);
    try {
      await open(page, url, waitFor);
      if (extra) await extra(page);
      await page.waitForTimeout(300);
      await shot(page, `${name}-dark`);
    } catch (e) {
      console.log('FAILED', name, e.message.split('\n')[0]);
      failed = true;
      await shot(page, `${name}-dark-FAILED`).catch(() => {});
    }
    await ctx.close();
  }
  if (!storage) {
    for (const theme of ['light', 'cream']) {
      for (const [name, persona, url, waitFor] of [VIEWS.find((v) => v[0] === 'landing'), VIEWS.find((v) => v[0] === 'catalog-public'), VIEWS.find((v) => v[0] === 'sign-in'), VIEWS.find((v) => v[0] === 'team-dashboard'), VIEWS.find((v) => v[0] === 'cohort-board'), VIEWS.find((v) => v[0] === 'admin-users'), VIEWS.find((v) => v[0] === 'admin-sso')]) {
        if (only?.length && !only.includes(name)) continue;
        const { ctx, page } = await session(theme, persona);
        await open(page, url, waitFor);
        await shot(page, `${name}-${theme}`);
        await ctx.close();
      }
    }
    // Tables at 1280px.
    for (const [name, persona, url, waitFor] of [VIEWS.find((v) => v[0] === 'team-dashboard'), VIEWS.find((v) => v[0] === 'cohort-board'), VIEWS.find((v) => v[0] === 'admin-audit')]) {
      if (only?.length && !only.includes(name)) continue;
      const { ctx, page } = await session('dark', persona, 1280);
      await open(page, url, waitFor);
      await shot(page, `${name}-dark-1280`);
      await ctx.close();
    }
  }
} catch (e) {
  console.log('FAILED', e.message);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
