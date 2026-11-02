#!/usr/bin/env node
// What Caddy answers for the built site: the real Caddyfile in the image compose.yaml pins, against a
// built dist-site, on a local port, with throwaway certificates and no sidecar. Touches nothing else.
//
//   node deploy/site-vm/test-routes.mjs apps/web/dist-site [--port 16244]
//
// Needs Docker and openssl. Every route in the manifest must answer 200 with its own canonical,
// everything else a real 404, and the paths in live emails and the API must still behave.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(process.argv[2] ?? 'apps/web/dist-site');
const portAt = process.argv.indexOf('--port');
const port = portAt > 0 ? Number(process.argv[portAt + 1]) : 16244;
const image = /image: (caddy:[^\s]+)/.exec(readFileSync(path.join(here, 'compose.yaml'), 'utf8'))?.[1];
if (!image) throw new Error('no caddy image in compose.yaml');
const name = `ct-site-routes-${process.pid}`;
const work = mkdtempSync(path.join(os.tmpdir(), 'ct-site-routes-'));

const sh = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let agent;
/** One request, redirects not followed. */
const get = (pathname, { method = 'GET', host = 'localhost', body } = {}) =>
  new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: pathname, method, agent, servername: host, headers: { Host: host, ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });

const problems = [];
let passed = 0;
const check = (ok, what) => {
  if (ok) passed += 1;
  else problems.push(what);
};

try {
  const certs = path.join(work, 'certs');
  sh('mkdir', '-p', certs);
  sh('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,DNS:www.localhost', '-keyout', path.join(certs, 'origin.key'), '-out', path.join(certs, 'origin.pem'));
  sh('cp', path.join(certs, 'origin.pem'), path.join(certs, 'origin-pull-ca.pem'));
  // Verified against the throwaway certificate made above.
  agent = new https.Agent({ ca: readFileSync(path.join(certs, 'origin.pem')), keepAlive: true, maxSockets: 8 });
  for (const f of ['origin.key', 'origin.pem', 'origin-pull-ca.pem']) chmodSync(path.join(certs, f), 0o644);
  sh('docker', 'run', '-d', '--rm', '--name', name, '--add-host', 'site-proxy:127.0.0.1', '-p', `127.0.0.1:${port}:443`, '-e', 'SITE_HOST=localhost', '-e', 'SITE_CLIENT_AUTH_MODE=verify_if_given', '-v', `${path.join(here, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, '-v', `${certs}:/certs:ro`, '-v', `${site}:/srv/site:ro`, image);
  for (let i = 0; i < 40; i += 1) {
    try {
      await get('/robots.txt');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /* ---------------------------------------- every route in the manifest */
  const routes = JSON.parse(sh('docker', 'exec', name, 'cat', '/srv/site/routes.json'));
  await Promise.all(
    routes.map(async (r) => {
      const res = await get(r.path);
      check(res.status === 200, `${r.path}: ${res.status}`);
      check(/text\/html/.test(res.headers['content-type'] ?? ''), `${r.path}: type ${res.headers['content-type']}`);
      check(res.headers['cache-control'] === 'no-cache', `${r.path}: cache ${res.headers['cache-control']}`);
      check(res.body.includes(`<link rel="canonical" href="https://cloudtrain.app${r.path}" />`), `${r.path}: wrong canonical`);
      check(/<h1\b/.test(res.body), `${r.path}: no h1`);
      check(/noindex/.test(res.body.slice(0, res.body.indexOf('</head>'))) === r.noindex, `${r.path}: noindex is not ${r.noindex}`);
    }),
  );

  /* ---------------------------------------------------------- true 404s */
  for (const p of ['/nonexistent-xyz', '/wp-login.php', '/.env', '/sign-in', '/admin', '/labs/drain-yard-worker', '/exams', '/catalog/paths/x', '/learn/labs/not-a-lab', '/learn/labs/xka-etcd-snapshot-save', '/learn/nope', '/assets/nope.js', '/data/nope.json', '/shell.html', '/404.html', '/404', '/routes.json', '/_headers', '/_redirects', '/data', '/assets', '/learn/labs/drain-yard-worker/work', '/index.htm', '/FEATURES']) {
    const res = await get(p);
    check(res.status === 404, `${p}: ${res.status}, wanted 404`);
    check(res.body.includes('<meta name="robots" content="noindex" />'), `${p}: the 404 page is not noindex`);
    check(res.body.includes('<h1'), `${p}: the 404 page has no heading`);
    check(!/site-boot\.js/.test(res.body), `${p}: the 404 page loads the app`);
    check((res.headers['content-security-policy'] ?? '').includes("script-src 'self'"), `${p}: no CSP on the 404`);
    check(/text\/html/.test(res.headers['content-type'] ?? ''), `${p}: 404 type ${res.headers['content-type']}`);
  }

  /* ---------------------------------------------- one URL for each page */
  const redirects = {
    '/features/': '/features',
    '/legal/terms/': '/legal/terms',
    '/learn/labs/?a=1': '/learn/labs?a=1',
    '/index.html': '/',
    '/features/index.html': '/features',
    '/pricing': '/#pricing',
    '/faq': '/#faq',
    '/about': '/#what',
    '/contact': '/#faq',
    '/catalog': '/learn/labs',
    '/labs': '/learn/labs',
    '/learn': '/learn/labs',
  };
  for (const [from, to] of Object.entries(redirects)) {
    const res = await get(from);
    check(res.status === 301, `${from}: ${res.status}, wanted 301`);
    check(res.headers.location === to, `${from}: to ${res.headers.location}, wanted ${to}`);
  }
  const www = await get('/features?x=1', { host: 'www.localhost' });
  check(www.status === 301 && www.headers.location === 'https://localhost/features?x=1', `www: ${www.status} ${www.headers.location}`);

  /* ------------------------------------------- what live emails link to */
  for (const p of ['/legal/privacy-request', '/legal/privacy-request?utm=x', '/legal/privacy', '/legal/terms', '/legal/cookies']) {
    const res = await get(p);
    check(res.status === 200, `${p}: ${res.status}`);
  }
  const request = await get('/legal/privacy-request');
  check(/<meta name="robots" content="noindex"/.test(request.body), '/legal/privacy-request is not noindex');
  check(!readFileSync(path.join(site, 'sitemap-pages.xml'), 'utf8').includes('privacy-request'), '/legal/privacy-request is in the sitemap');

  /* ----------------------------------------------------------- the API */
  for (const p of ['/api/public/waitlist', '/api/public/privacy/requests', '/api/public/privacy/confirm']) {
    const res = await get(p, { method: 'POST', body: '{}' });
    check(res.status === 503 && /upstream/.test(res.body), `POST ${p} does not reach the sidecar's route: ${res.status}`);
    const read = await get(p);
    check(read.status === 404 && /not_found/.test(read.body), `GET ${p}: ${read.status}`);
  }
  const other = await get('/api/public/site');
  check(other.status === 404 && /json/.test(other.headers['content-type'] ?? ''), `/api/public/site: ${other.status}`);
  const big = await get('/api/public/waitlist', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(20000) }) });
  check(big.status === 413 || big.status === 503, `a body over the limit: ${big.status}`);

  /* ------------------------------------------------- files and headers */
  const robots = await get('/robots.txt');
  check(robots.status === 200 && robots.body.includes('Disallow: /api/') && robots.body.includes('Sitemap: https://cloudtrain.app/sitemap.xml'), 'robots.txt');
  for (const p of ['/sitemap.xml', '/sitemap-pages.xml', '/sitemap-labs.xml']) check((await get(p)).status === 200, `${p} is missing`);
  const data = await get('/data/site.json');
  check(data.status === 200 && data.headers['x-robots-tag'] === 'noindex' && data.headers['cache-control'] === 'public, max-age=300', '/data headers');
  const home = await get('/');
  for (const h of ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy']) check(home.headers[h], `/ has no ${h}`);
  check(!home.headers['set-cookie'], '/ sets a cookie');
} finally {
  try {
    sh('docker', 'rm', '-f', name);
  } catch {
    /* already gone */
  }
  rmSync(work, { recursive: true, force: true });
  agent?.destroy();
}
for (const p of problems.slice(0, 60)) console.error(p);
console.log(`${passed} passed, ${problems.length} failed`);
process.exit(problems.length ? 1 : 0);
