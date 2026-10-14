// Headless browser-style login against the local stack (gateway BFF -> Keycloak
// -> optionally the brokered acme-idp realm), with a per-origin cookie jar.
// No dependencies: Node 22 fetch with manual redirects and form parsing.
//
//   import { login } from './platform-login.mjs'
//   const s = await login('http://localhost:8787', 'priya.raman@quillmoor.example', 'CloudTrain-dev-only-1')
//   await s.api('GET', '/api/me')
//
// DEV ONLY: used by platform-proof.mjs and the integration test.

class Jar {
  constructor() {
    this.cookies = new Map(); // `${host}|${path}|${name}` -> { host, path, name, value }
  }
  store(url, res) {
    const u = new URL(url);
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';').map((x) => x.trim());
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      const pathAttr = attrs.find((a) => /^path=/i.test(a));
      const path = pathAttr ? pathAttr.slice(5) || '/' : u.pathname.replace(/\/[^/]*$/, '') || '/';
      const key = `${u.host}|${path}|${name}`;
      const expired = attrs.some((a) => /^max-age=0$/i.test(a) || /^expires=Thu, 01 Jan 1970/i.test(a));
      if (expired || value === '') this.cookies.delete(key);
      else this.cookies.set(key, { host: u.host, path, name, value });
    }
  }
  header(url) {
    const u = new URL(url);
    return [...this.cookies.values()]
      .filter((c) => c.host === u.host && (u.pathname === c.path || u.pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/'))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }
  get(host, name) {
    return [...this.cookies.values()].find((c) => c.host === host && c.name === name)?.value;
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function go(jar, url, init = {}, trace = []) {
  let current = url;
  let opts = init;
  for (let hop = 0; hop < 25; hop++) {
    const res = await fetch(current, { ...opts, redirect: 'manual', headers: { ...(opts.headers ?? {}), cookie: jar.header(current) } });
    jar.store(current, res);
    trace.push(`${opts.method ?? 'GET'} ${new URL(current).origin}${new URL(current).pathname} -> ${res.status}`);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      opts = {};
      continue;
    }
    return { res, url: current, body: await res.text() };
  }
  throw new Error('too many redirects');
}

/** Fills and submits the first form on a Keycloak page (login, review profile). */
function formOf(html, base) {
  const m = /<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!m) return null;
  const fields = {};
  for (const i of m[2].matchAll(/<input[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(i[0])?.[1];
    const value = /value="([^"]*)"/.exec(i[0])?.[1] ?? '';
    const type = /type="([^"]+)"/.exec(i[0])?.[1] ?? 'text';
    if (name && type !== 'checkbox') fields[name] = decode(value);
  }
  return { action: new URL(decode(m[1]), base).toString(), fields };
}

export async function login(gateway, email, password, { returnTo = '/' } = {}) {
  const jar = new Jar();
  const trace = [];
  let page = await go(jar, `${gateway}/api/auth/login?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`, {}, trace);
  for (let step = 0; step < 6; step++) {
    if (jar.get(new URL(gateway).host, 'ct_session')) break;
    const form = formOf(page.body, page.url);
    if (!form) throw new Error(`login stuck at ${page.url} (HTTP ${page.res.status}): ${page.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`);
    if ('password' in form.fields || /name="password"/.test(page.body)) {
      form.fields.username = email;
      form.fields.password = password;
    }
    page = await go(jar, form.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form.fields).toString() }, trace);
  }
  const token = jar.get(new URL(gateway).host, 'ct_session');
  if (!token) {
    const err = new URL(page.url).searchParams;
    throw new Error(`no gateway session for ${email}: ${err.get('error') ?? ''} ${err.get('message') ?? page.url}`);
  }
  const cookie = `ct_session=${token}`;
  const me = await (await fetch(`${gateway}/api/me`, { headers: { cookie } })).json();
  const api = async (method, path, body) => {
    const res = await fetch(`${gateway}${path}`, {
      method,
      headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': me.csrfToken } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { cookie, me, api, trace, csrf: me.csrfToken };
}
