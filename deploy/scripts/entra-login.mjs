#!/usr/bin/env node
// LOCAL ONLY: a real, headless Entra ID sign-in for end-to-end tests, as the test
// account ct-e2e@azarguard.com. A Playwright browser walks the whole chain a person
// would: gateway /api/auth/login (identity-first by email) -> Keycloak -> the
// `azarguard-entra` identity provider -> the Microsoft sign-in page (email,
// password, "Stay signed in?") -> Keycloak -> gateway callback -> the web app.
//
// The account has no MFA and Conditional Access admits it only from this machine's
// public IP and only into the CloudTrain app, so it cannot run in CI (AADSTS53003
// there). See docs/dev-environment.md, "Headless Entra sign-in (local end-to-end tests)".
//
// Credentials: ENTRA_E2E_USER / ENTRA_E2E_PASSWORD from the environment, else from
// ~/.config/cloudtrain/entra-e2e.env (--env <file>). The password is never printed,
// logged or written anywhere; the storageState holds only the gateway session cookie.
//
// As a module, the same session object as dev-signin-as.mjs and platform-login.mjs:
//
//   import { entraLogin } from './entra-login.mjs'
//   const s = await entraLogin({ gateway: 'http://localhost:8787', web: 'http://localhost:5173' })
//   await s.api('GET', '/api/home')        // cookie + x-csrf-token handled
//
// As a CLI:
//
//   node deploy/scripts/entra-login.mjs [--base http://localhost:8787] [--web http://localhost:5173]
//        [--env <file>] [--playwright-storage <file>] [--screenshot <png>] [--chromium /usr/bin/chromium]
//        [--headed] [--print-cookie]

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV = path.join(os.homedir(), '.config/cloudtrain/entra-e2e.env');

/** playwright-core is a dev dependency of apps/web; resolve it from there. */
async function loadChromium() {
  const req = createRequire(path.resolve(here, '../../apps/web/package.json'));
  let entry;
  try {
    entry = req.resolve('playwright-core');
  } catch {
    throw new Error('playwright-core not found: run `pnpm install` (it is a dev dependency of apps/web)');
  }
  const mod = await import(pathToFileURL(entry).href);
  return (mod.chromium ?? mod.default.chromium);
}

/** Reads KEY=VALUE lines (optional quotes, `export`, comments). */
export async function readEnvFile(file) {
  const out = {};
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export async function e2eCredentials(envFile = DEFAULT_ENV) {
  let user = process.env.ENTRA_E2E_USER;
  let password = process.env.ENTRA_E2E_PASSWORD;
  if (!user || !password) {
    const env = await readEnvFile(envFile).catch((e) => {
      throw new Error(`no ENTRA_E2E_USER/ENTRA_E2E_PASSWORD in the environment and ${envFile} is unreadable (${e.code ?? e.message})`);
    });
    user ||= env.ENTRA_E2E_USER;
    password ||= env.ENTRA_E2E_PASSWORD;
  }
  if (!user || !password) throw new Error(`ENTRA_E2E_USER and ENTRA_E2E_PASSWORD must be set (environment or ${envFile})`);
  return { user, password };
}

/** An Entra sign-in error page: AADSTS code, message and the ids support needs. */
export class EntraError extends Error {
  constructor(code, message, details) {
    super(`${code}: ${message}${details.requestId ? ` (request id ${details.requestId}` : ''}${details.correlationId ? `, correlation id ${details.correlationId})` : details.requestId ? ')' : ''}`);
    this.code = code;
    this.details = details;
  }
}

async function entraErrorOf(page) {
  const html = await page.content();
  const text = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')) || '';
  const all = `${text}\n${html}`;
  const code = /AADSTS\d{5,}/.exec(all)?.[0];
  if (!code) return null;
  const pick = (re) => re.exec(all)?.[1];
  const details = {
    requestId: pick(/Request Id:?\s*<?\/?[^>]*>?\s*([0-9a-f-]{36})/i) ?? pick(/"sessionId"\s*:\s*"([0-9a-f-]{36})"/) ?? pick(/requestId["']?\s*[:=]\s*["']([0-9a-f-]{36})/i),
    correlationId: pick(/Correlation Id:?\s*<?\/?[^>]*>?\s*([0-9a-f-]{36})/i) ?? pick(/"correlationId"\s*:\s*"([0-9a-f-]{36})"/),
    timestamp: pick(/Timestamp:?\s*([0-9T:.\-Z ]{19,30})/),
    url: page.url().split('?')[0],
  };
  const msg = (text.split('\n').find((l) => l.includes(code)) ?? code).replace(code, '').replace(/^[\s:.-]+/, '').trim().slice(0, 300);
  return new EntraError(code, msg || 'sign-in refused by Entra ID', details);
}

const visible = async (page, sel) => {
  const l = page.locator(sel).first();
  return (await l.count()) > 0 && (await l.isVisible().catch(() => false));
};

/**
 * Signs in through Entra ID with Playwright. Returns
 * `{ cookie, token, me, csrf, api(method, path, body), storageState, trace }`.
 */
export async function entraLogin({ gateway = 'http://localhost:8787', web = 'http://localhost:5173', user, password, envFile, chromiumPath = '/usr/bin/chromium', headed = false, screenshot, timeoutMs = 120_000 } = {}) {
  if (!user || !password) ({ user, password } = await e2eCredentials(envFile));
  const base = gateway.replace(/\/$/, '');
  const webBase = web.replace(/\/$/, '');
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: !headed, args: ['--no-sandbox'] });
  const trace = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) {
        const u = new URL(r.url());
        trace.push(`${u.origin}${u.pathname}`);
      }
    });
    await page.goto(`${base}/api/auth/login?email=${encodeURIComponent(user)}&returnTo=${encodeURIComponent('/')}`, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + timeoutMs;
    const webOrigin = new URL(webBase).origin;
    for (;;) {
      if (Date.now() > deadline) {
        if (process.env.ENTRA_LOGIN_DEBUG_DIR) await writeFile(path.join(process.env.ENTRA_LOGIN_DEBUG_DIR, 'stuck.html'), (await page.content()).replace(/name="passwd"[^>]*/g, 'name="passwd"'), { mode: 0o600 });
        throw new Error(`Entra sign-in did not finish in ${timeoutMs / 1000}s; stuck at ${page.url().split('?')[0]}`);
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const url = new URL(page.url());
      // The callback redirects to CT_WEB_URL, which defaults to the gateway's own URL
      // (task dev:gateway does not set it): both mean the sign-in is complete.
      if ((url.origin === webOrigin || url.origin === new URL(base).origin) && !url.pathname.startsWith('/api/')) {
        if (url.searchParams.get('error') || url.pathname.includes('login-error')) {
          throw new Error(`gateway refused the sign-in: ${url.searchParams.get('error') ?? ''} ${url.searchParams.get('message') ?? url.pathname}`);
        }
        break;
      }
      if (/login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com/.test(url.host)) {
        const err = await entraErrorOf(page);
        if (err) throw err;
        if (await visible(page, 'input[name="loginfmt"]:not([aria-hidden="true"])')) {
          await page.fill('input[name="loginfmt"]', user);
          await page.click('#idSIButton9');
        } else if (await visible(page, 'input[name="passwd"]')) {
          await page.fill('input[name="passwd"]', password);
          await page.click('#idSIButton9');
        } else if (await visible(page, '#KmsiCheckboxField, #KmsiDescription')) {
          await page.click('#idBtn_Back'); // "Stay signed in?" -> No
        } else if (await visible(page, '#idSubmit_ProofUp_Redirect, #idDiv_SAOTCS_Title, #idDiv_SAOTCAS_Title')) {
          throw new Error('Entra asked for MFA or security info: the test account must be excluded from MFA');
        } else if (await visible(page, '#idSIButton9')) {
          await page.click('#idSIButton9'); // consent or "continue" interstitials
        }
        await page.waitForTimeout(1500);
        continue;
      }
      // Keycloak: first broker login ("Update account information") or a review page.
      if (await visible(page, '#kc-error-message, .kc-feedback-text.pf-m-danger, .alert-error')) {
        const msg = (await page.locator('#kc-error-message, .kc-feedback-text, .alert-error').first().innerText().catch(() => '')).trim();
        if (msg) throw new Error(`Keycloak error at ${url.pathname}: ${msg.slice(0, 300)}`);
      }
      if (await visible(page, 'form#kc-idp-review-profile-form, form#kc-update-profile-form, form#kc-register-form')) {
        // First broker login asks to review the profile. Entra sends no `email` claim for an
        // account without a mail attribute; fill it with the sign-in name, as a person would.
        const email = page.locator('form input[name="email"]').first();
        if ((await email.count()) > 0 && !(await email.inputValue())) {
          await email.fill(user);
          trace.push(`${url.origin}${url.pathname}#email-filled`);
        }
        await page.locator('form input[type="submit"], form button[type="submit"]').first().click();
        await page.waitForTimeout(1000);
        continue;
      }
      await page.waitForURL((u) => u.toString() !== url.toString(), { timeout: 15_000 }).catch(() => {});
    }
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const host = new URL(base).hostname;
    const token = (await context.cookies()).find((c) => c.name === 'ct_session' && c.domain.replace(/^\./, '') === host)?.value;
    if (!token) throw new Error(`signed in at Entra but no ct_session cookie for ${host}`);
    const cookie = `ct_session=${token}`;
    const meRes = await fetch(`${base}/api/me`, { headers: { cookie } });
    if (!meRes.ok) throw new Error(`/api/me after sign-in: HTTP ${meRes.status}`);
    const me = await meRes.json();
    if (screenshot) {
      await page.goto(`${webBase}/`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: screenshot, fullPage: true });
    }
    const storageState = await context.storageState();
    // Keep only the gateway session cookie: the Microsoft and Keycloak cookies are not needed to replay the session.
    storageState.cookies = storageState.cookies.filter((c) => c.name === 'ct_session');
    storageState.origins = [];
    const api = async (method, p, payload) => {
      const r = await fetch(`${base}${p}`, {
        method,
        headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': me.csrfToken } : {}) },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
      const t = await r.text();
      let json;
      try {
        json = t ? JSON.parse(t) : undefined;
      } catch {
        json = undefined;
      }
      return { status: r.status, json, text: t, headers: r.headers };
    };
    return { cookie, token, me, api, csrf: me.csrfToken, storageState, trace };
  } finally {
    await browser.close();
  }
}

async function cli(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = opt('base') ?? 'http://localhost:8787';
  const web = opt('web') ?? 'http://localhost:5173';
  let s;
  try {
    s = await entraLogin({ gateway: base, web, envFile: opt('env') ?? DEFAULT_ENV, chromiumPath: opt('chromium') ?? '/usr/bin/chromium', headed: argv.includes('--headed'), screenshot: opt('screenshot') });
  } catch (e) {
    if (e instanceof EntraError) {
      console.error(`Entra refused the sign-in: ${e.message}`);
      console.error(JSON.stringify({ code: e.code, ...e.details }));
      if (e.code === 'AADSTS53003') console.error('AADSTS53003 = blocked by Conditional Access (location/app fence). Do not change the tenant from here; give the request id to whoever owns the Terraform tenant config.');
      process.exit(3);
    }
    throw e;
  }
  const m = s.me;
  console.log(`signed in through Entra as ${m.name} <${m.email}> · org ${m.activeOrg?.name ?? '(none)'} · roles ${m.roles.join(', ')}${m.platformAdmin ? ' · platform admin' : ''} · idp ${m.auth?.method ?? '?'}${m.auth?.idp ? `/${m.auth.idp}` : ''} · until ${m.auth?.sessionExpiresAt ?? '?'}`);
  console.log(`path: ${s.trace.map((t) => new URL(t).host).filter((h, i, a) => h !== a[i - 1]).join(' -> ')}`);
  const storage = opt('playwright-storage');
  if (storage) {
    await writeFile(storage, `${JSON.stringify(s.storageState, null, 2)}\n`, { mode: 0o600 });
    console.log(`playwright storageState: ${storage}`);
  }
  if (opt('screenshot')) console.log(`screenshot: ${opt('screenshot')}`);
  if (argv.includes('--print-cookie')) console.log(s.cookie);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cli(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
