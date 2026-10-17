#!/usr/bin/env node
// DEV ONLY: sign in as an existing user through the gateway's dev sign-in-as
// endpoint (POST /api/dev/sign-in-as), so agents can see the app as a real
// user, including Entra-brokered users whose real login needs MFA. The
// gateway must run with dev sign-in-as on (`task dev:gateway` does, on
// localhost only); see docs/dev-environment.md, "Signing in as a real user (agents)".
//
// As a module, the same session object as platform-login.mjs:
//
//   import { signInAs } from './dev-signin-as.mjs'
//   const s = await signInAs('http://localhost:8787', 'someone@example.com')
//   await s.api('GET', '/api/home')        // cookie + x-csrf-token handled
//
// As a CLI:
//
//   node deploy/scripts/dev-signin-as.mjs <email> [--base http://localhost:8787] [--org <org id>]
//        [--user-id <id> instead of <email>] [--playwright-storage <file>] [--web http://localhost:5173]
//        [--print-cookie]
//
// --playwright-storage writes a Playwright storageState (the ct_session cookie
// for the web app's host) for apps/web/scripts/{readme,platform}-shots.mjs --storage.
// The cookie is printed only with --print-cookie.

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Signs in as `email` (or `{ userId }`), optionally in `orgId`. Returns
 * `{ cookie, token, me, csrf, api(method, path, body) }`.
 */
export async function signInAs(gateway, who, { orgId } = {}) {
  const base = gateway.replace(/\/$/, '');
  const body = typeof who === 'string' ? { email: who } : { ...who };
  if (orgId) body.orgId = orgId;
  const res = await fetch(`${base}/api/dev/sign-in-as`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status === 404 && !text.includes('User not found')) throw new Error(`${base} has no dev sign-in-as endpoint: start the gateway with \`task dev:gateway\` (dev sign-in-as on, localhost only)`);
  if (!res.ok) throw new Error(`sign-in-as ${JSON.stringify(body)} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  const token = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('ct_session='))
    ?.slice('ct_session='.length);
  if (!token) throw new Error('no ct_session cookie in the response');
  const cookie = `ct_session=${token}`;
  const me = JSON.parse(text);
  const api = async (method, path, payload) => {
    const r = await fetch(`${base}${path}`, {
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
  return { cookie, token, me, api, csrf: me.csrfToken, trace: [`POST ${base}/api/dev/sign-in-as -> ${res.status}`] };
}

/** Playwright storageState with the session cookie for `webUrl`'s host (cookies are not port-scoped). */
export function playwrightStorage(token, webUrl, me) {
  const u = new URL(webUrl);
  const expires = me?.auth?.sessionExpiresAt ? Math.floor(Date.parse(me.auth.sessionExpiresAt) / 1000) : -1;
  return { cookies: [{ name: 'ct_session', value: token, domain: u.hostname, path: '/', expires, httpOnly: true, secure: u.protocol === 'https:', sameSite: 'Lax' }], origins: [] };
}

async function cli(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flags = new Set(['--base', '--org', '--user-id', '--playwright-storage', '--web']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !flags.has(argv[i - 1]));
  const email = positional[0];
  const userId = opt('user-id');
  if (!email && !userId) {
    console.error('usage: dev-signin-as.mjs <email> [--base http://localhost:8787] [--org <id>] [--user-id <id>] [--playwright-storage <file>] [--web <url>] [--print-cookie]');
    process.exit(2);
  }
  const base = opt('base') ?? 'http://localhost:8787';
  const s = await signInAs(base, userId ? { userId } : email, { orgId: opt('org') });
  const m = s.me;
  console.log(`signed in as ${m.name} <${m.email}> · org ${m.activeOrg?.name ?? '(none)'} · roles ${m.roles.join(', ')}${m.platformAdmin ? ' · platform admin' : ''} · impersonated=${!!m.auth?.impersonated} · until ${m.auth?.sessionExpiresAt ?? '?'}`);
  const storage = opt('playwright-storage');
  if (storage) {
    await writeFile(storage, `${JSON.stringify(playwrightStorage(s.token, opt('web') ?? base, m), null, 2)}\n`, { mode: 0o600 });
    console.log(`playwright storageState: ${storage}`);
  }
  if (argv.includes('--print-cookie')) console.log(s.cookie);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cli(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
