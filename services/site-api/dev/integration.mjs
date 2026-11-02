// The checks of the local integration run: dev/run-local.sh must be up. A real browser drives the
// form against Caddy, the sidecar, the Functions' handlers and Azurite.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const HTTPS_PORT = process.env.HTTPS_PORT ?? '16143';
const DEV = `http://127.0.0.1:${process.env.SITE_DEV_PORT ?? '16110'}`;
const SITE = `https://localhost:${HTTPS_PORT}`;
const CT = 'ct-siteapi-local';
const WORK = process.env.SITE_LOCAL_WORK;
if (!WORK) throw new Error('SITE_LOCAL_WORK must be the work dir of dev/run-local.sh');
const CLIENT = { cert: readFileSync(`${WORK}/client.pem`), key: readFileSync(`${WORK}/client.key`) };
// The local origin certificate from dev/run-local.sh is what we trust, under the names it holds.
const ORIGIN_CA = readFileSync(`${WORK}/vm/certs/origin.pem`);
const WRONG = { cert: readFileSync(`${WORK}/wrong-client.pem`), key: readFileSync(`${WORK}/wrong-client.key`) };

let checks = 0;
const ok = (name) => {
  checks++;
  console.log(`ok ${checks} ${name}`);
};

function raw(method, path, body, ip = '198.51.100.1', extra = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request({ ...CLIENT, host: '127.0.0.1', port: HTTPS_PORT, path, method, ca: ORIGIN_CA, servername: 'localhost', headers: { host: 'localhost', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...extra } }, (res) => {
      let t = '';
      res.on('data', (c) => (t += c));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(t);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, json, text: t, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Waits out the global cap, which this script reaches by itself; the limit tests below use raw(). */
async function api(...args) {
  for (;;) {
    const r = await raw(...args);
    if (r.status !== 429 || Number(r.headers['retry-after']) > 3) return r;
    await new Promise((res) => setTimeout(res, Number(r.headers['retry-after']) * 1000));
  }
}

const dev = async (path) => (await fetch(`${DEV}${path}`)).json();
const mail = async () => (await dev('/__dev/mail')).sent;
async function waitFor(what, fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
const mailTo = (to, text) => waitFor(`mail to ${to} with "${text}"`, async () => (await mail()).filter((m) => m.to === to).find((m) => `${m.subject} ${m.text}`.includes(text)));
const tokenIn = (m) => decodeURIComponent(/#token=(\S+)/.exec(m.text)[1]);
const entry = (email) => ({ email, consent: true, website: '' });

/* ------------------------------------------------- Authenticated Origin Pulls */
function bare(servername, tlsOptions = {}) {
  return new Promise((resolve) => {
    const req = https.get({ ...tlsOptions, agent: false, host: '127.0.0.1', port: HTTPS_PORT, path: '/', ca: ORIGIN_CA, servername, headers: { host: servername } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', (e) => resolve({ error: e.code ?? e.message }));
  });
}
for (const host of ['localhost', 'www.localhost']) {
  const none = await bare(host);
  assert.ok(none.error, `${host} served without a client certificate: ${JSON.stringify(none)}`);
  const wrong = await bare(host, WRONG);
  assert.ok(wrong.error, `${host} served a certificate from another CA: ${JSON.stringify(wrong)}`);
  assert.ok((await bare(host, CLIENT)).status, `${host} refused the right client certificate`);
}
ok('no client certificate, or one from another CA: refused in the handshake, on both hosts');

/* --------------------------------------------------------------- the routes */
assert.equal((await api('GET', '/api/public/site')).status, 404);
assert.equal((await api('GET', '/api/public/catalog')).status, 404);
assert.equal((await api('GET', '/api/public/privacy/confirm?token=x')).status, 404);
assert.equal((await api('POST', '/api/auth/login', {})).status, 404);
assert.equal((await api('GET', '/api/public/waitlist')).status, 404);
ok('everything else under /api is a 404');
const shell = await api('GET', '/');
assert.equal(shell.status, 200);
assert.match(shell.headers['content-security-policy'], /default-src 'self'/);
assert.doesNotMatch(shell.headers['content-security-policy'], /google/);
assert.equal(shell.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
ok('the site is served with its headers and a CSP free of Google hosts');
assert.equal((await api('GET', '/legal/privacy-request')).status, 200);
const www = await new Promise((resolve) => https.get({ ...CLIENT, host: '127.0.0.1', port: HTTPS_PORT, path: '/a', ca: ORIGIN_CA, servername: 'www.localhost', headers: { host: 'www.localhost' } }, resolve));
www.resume();
assert.equal(www.statusCode, 301);
assert.equal(www.headers.location, 'https://localhost/a');
ok('www redirects to the apex');
assert.equal((await api('POST', '/api/public/waitlist', entry('nokey@example.com'), null)).status, 400);
ok('no CF-Connecting-IP: refused');

/* ---------------------------------------------------------------- the form */
const browser = await chromium.launch({ executablePath: process.env.CT_CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] });
const context = await browser.newContext({ clientCertificates: [{ origin: SITE, cert: CLIENT.cert, key: CLIENT.key }], ignoreHTTPSErrors: true, extraHTTPHeaders: { 'CF-Connecting-IP': '198.51.100.2' } });
const page = await context.newPage();
const requests = [];
page.on('request', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#waitlist form');
const noteLink = page.locator('.site-wl-note a');
assert.equal(await noteLink.getAttribute('href'), '/legal/privacy-request');
assert.equal(await page.locator('.site-wl-consent a[href="/legal/privacy-request"]').count(), 1);
ok('the note and the consent label link the privacy request page');

async function submit(email) {
  await page.fill('#waitlist input[name=email]', email);
  await page.check('#waitlist input[name=consent]');
  await page.click('#waitlist button[type=submit]');
}
await submit('browser@example.com');
await page.waitForSelector('.site-wl-done');
assert.match(await page.textContent('.site-wl-done'), /You are on the list/);
assert.equal(await page.locator('.site-wl-done a[href="/legal/privacy-request"]').count(), 1);
ok('the browser form: created, and the success text links the page');
assert.deepEqual(requests.filter((r) => r.includes('/api/')), ['POST /api/public/waitlist']);
ok('the coming-soon page makes no API call but the form');
assert.deepEqual(errors, []);
ok('no script errors');

const welcome = await mailTo('browser@example.com', 'waitlist');
assert.match(welcome.text, new RegExp(`${SITE}/legal/privacy-request#token=l1\\.`));
assert.match(welcome.text, /wasn.t you/);
ok('the welcome mail came, with a leave link, once');
const firstAnswer = await page.textContent('.site-wl-done');
await page.click('.site-wl-done button');
await submit('BROWSER@example.com');
await page.waitForSelector('.site-wl-done');
assert.equal(await page.textContent('.site-wl-done'), firstAnswer);
assert.doesNotMatch(firstAnswer, /already|registered/i);
ok('the browser form: a duplicate reads exactly like a new signup');
const raw1 = await api('POST', '/api/public/waitlist', entry('same@example.com'), '198.51.100.8');
const raw2 = await api('POST', '/api/public/waitlist', entry('same@example.com'), '198.51.100.8');
assert.equal(raw1.status, 201);
assert.equal(raw2.status, raw1.status);
assert.deepEqual(raw2.json, raw1.json);
ok('the API: a duplicate gets the same status and body');
await mailTo('same@example.com', 'waitlist');
await new Promise((r) => setTimeout(r, 1500));
assert.equal((await mail()).filter((m) => m.to.toLowerCase() === 'browser@example.com').length, 1);
assert.equal((await mail()).filter((m) => m.to === 'same@example.com').length, 1);
ok('no second welcome for a duplicate');
await browser.close();

assert.deepEqual((await api('POST', '/api/public/waitlist', { ...entry('bot@example.com'), website: 'x' })).json, { status: 'created' });
await new Promise((r) => setTimeout(r, 800));
assert.equal((await mail()).filter((m) => m.to === 'bot@example.com').length, 0);
ok('the honeypot answers the same, stores and mails nothing');
const invalid = await api('POST', '/api/public/waitlist', { email: 'nope' });
assert.equal(invalid.status, 422);
assert.ok(invalid.json.details.fields.email);
ok('422 with fields');

/* ---------------------------------------------------- requests and the ledger */
const known = await api('POST', '/api/public/privacy/requests', { email: 'browser@example.com', type: 'export', website: '' }, '198.51.100.3');
const unknown = await api('POST', '/api/public/privacy/requests', { email: 'nobody@example.com', type: 'export', website: '' }, '198.51.100.3');
const honey = await api('POST', '/api/public/privacy/requests', { email: 'honey@example.com', type: 'export', website: 'x' }, '198.51.100.3');
assert.equal(known.status, 202);
assert.deepEqual(known.json, unknown.json);
assert.deepEqual(known.json, honey.json);
ok('a privacy request answers the same for known, unknown and the honeypot');

const confirmMail = await mailTo('browser@example.com', 'Confirm your');
const exportToken = tokenIn(confirmMail);
assert.ok(confirmMail.text.includes(`${SITE}/legal/privacy-request#token=`));
const pending = await api('POST', '/api/public/privacy/confirm', { token: exportToken }, '198.51.100.3');
assert.equal(pending.status, 202);
assert.deepEqual(pending.json, { status: 'pending', type: 'export' });
ok('confirm: 202 pending with the type and no data in the response');
const copy = await mailTo('browser@example.com', 'everything the waitlist holds');
assert.ok(copy.text.includes('consentAt'));
ok('the copy went by mail to the verified address');
const again = await api('POST', '/api/public/privacy/confirm', { token: exportToken }, '198.51.100.3');
assert.equal(again.status, 410);
const bad = await api('POST', '/api/public/privacy/confirm', { token: 'nope' }, '198.51.100.3');
assert.equal(bad.status, 410);
assert.deepEqual(again.json, bad.json);
ok('a used link and a bad link answer the same 410');

await api('POST', '/api/public/waitlist', entry('erase@example.com'), '198.51.100.4');
await mailTo('erase@example.com', 'waitlist');
await api('POST', '/api/public/privacy/requests', { email: 'erase@example.com', type: 'erasure', website: '' }, '198.51.100.4');
const eraseMail = await mailTo('erase@example.com', 'Confirm your');
// Stays erased: the restore below brings this one back, and reapply must erase it again.
await api('POST', '/api/public/waitlist', entry('gone@example.com'), '198.51.100.4');
await mailTo('gone@example.com', 'waitlist');
await api('POST', '/api/public/privacy/requests', { email: 'gone@example.com', type: 'withdrawal', website: '' }, '198.51.100.4');
const goneMail = await mailTo('gone@example.com', 'Confirm your');
const backup1 = await dev('/__dev/run/backup');
assert.ok(backup1.rows >= 2);
assert.equal(backup1.written, true);
const backup2 = await dev('/__dev/run/backup');
assert.equal(backup2.name, backup1.name);
assert.equal(backup2.written, false);
ok('the nightly backup wrote a blob; a second run the same date is a success that changes nothing');
assert.deepEqual((await api('POST', '/api/public/privacy/confirm', { token: tokenIn(eraseMail) }, '198.51.100.4')).json, { status: 'pending', type: 'erasure' });
await mailTo('erase@example.com', 'is erased');
await api('POST', '/api/public/privacy/confirm', { token: tokenIn(goneMail) }, '198.51.100.4');
await mailTo('gone@example.com', 'left');
assert.equal((await api('POST', '/api/public/waitlist', entry('erase@example.com'), '198.51.100.5')).status, 201);
await mailTo('erase@example.com', 'waitlist');
ok('erasure done, and the same address can join again as new');

/* -------------------------------------------------------------------- leave */
await api('POST', '/api/public/waitlist', entry('leave@example.com'), '198.51.100.6');
const leaveMail = await mailTo('leave@example.com', '#token=l1.');
const leaveToken = tokenIn(leaveMail);
const left = await api('POST', '/api/public/privacy/confirm', { token: leaveToken }, '198.51.100.6');
assert.deepEqual(left.json, { status: 'pending', type: 'withdrawal' });
await mailTo('leave@example.com', 'left');
ok('the leave link withdraws, without asking for the address, and sends one brief notice');
assert.equal((await api('POST', '/api/public/privacy/confirm', { token: leaveToken }, '198.51.100.6')).status, 410);
ok('the leave link used again: 410');

/* ---------------------------------------------------------- restore and reapply */
const chain = await dev('/__dev/run/verify');
assert.equal(chain.ok, true);
assert.ok(chain.count >= 3);
ok(`the ledger chain verifies over ${chain.count} records in the Azure layout`);
const sweep = await dev('/__dev/run/sweep');
assert.equal(sweep.stuck, 0);
const retention = await dev('/__dev/run/retention');
assert.equal(retention.chainOk, true);
assert.equal((await dev('/__dev/run/retention')).chainOk, true);
ok('the sweep and retention run against real table filters');

const restored = await dev(`/__dev/run/restore?name=${encodeURIComponent(backup1.name)}`);
assert.ok(restored.present >= 1);
const reapplied = await dev('/__dev/run/reapply');
assert.ok(restored.added >= 1);
assert.ok(reapplied.erased >= 1, JSON.stringify(reapplied));
assert.ok(reapplied.keptNewer >= 1, JSON.stringify(reapplied));
assert.equal((await dev('/__dev/run/reapply')).erased, 0);
ok(`restore and reapply: ${restored.added} added, ${reapplied.erased} erased again, ${reapplied.keptNewer} newer kept`);
assert.equal((await dev('/__dev/run/verify')).ok, true);

/* -------------------------------------------------------------- rate limits */
// Bodies that fail validation: the budget is the sidecar's, and no row or mail comes of them.
const statuses = [];
for (let i = 0; i < 60; i++) {
  statuses.push((await api('POST', '/api/public/waitlist', { email: 'not-an-address' }, '198.51.100.50')).status);
  await new Promise((r) => setTimeout(r, 210));
}
assert.equal(statuses.filter((s) => s === 422).length, 60, statuses.join(','));
const over = await raw('POST', '/api/public/waitlist', entry('rate-over@example.com'), '198.51.100.50');
assert.equal(over.status, 429);
assert.equal(over.json.code, 'rate_limited');
assert.ok(Number(over.headers['retry-after']) > 3000);
assert.equal(over.json.details.retryAfterSeconds, Number(over.headers['retry-after']));
ok('60 an hour per address, then 429 with Retry-After in the form the browser reads');
await new Promise((r) => setTimeout(r, 1500));
const v6a = await api('POST', '/api/public/waitlist', entry('v6a@example.com'), '2001:db8:1:2::1');
assert.equal(v6a.status, 201);
ok('IPv6 passes end to end');
await new Promise((r) => setTimeout(r, 1500));
const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => raw('POST', '/api/public/waitlist', { email: 'not-an-address' }, `198.51.100.${100 + i}`)));
const counts = burst.reduce((o, r) => ((o[r.status] = (o[r.status] ?? 0) + 1), o), {});
assert.ok(counts[429] >= 25, JSON.stringify(counts));
assert.ok((counts[422] ?? 0) <= 10, JSON.stringify(counts));
ok(`global cap: 40 at once from 40 addresses: ${JSON.stringify(counts)}`);

/* -------------------------------------------------------------------- logs */
const logs = execSync(`docker logs ${CT}-caddy-1 2>&1; docker logs ${CT}-site-proxy-1 2>&1`, { maxBuffer: 1 << 26 }).toString();
assert.ok(logs.length > 100);
for (const leak of ['browser@example.com', 'erase@example.com', 'leave@example.com', '198.51.100.', '2001:db8', exportToken, leaveToken, 'local-dev-token']) assert.ok(!logs.includes(leak), `the VM's logs hold ${leak}`);
ok("the VM's container logs hold no address, email, token or visitor IP");

/* ---------------------------------------------------------------- kill switch */
execSync(`docker stop ${CT}-site-proxy-1`, { stdio: 'ignore' });
const killed = await raw('POST', '/api/public/waitlist', entry('killed@example.com'), '198.51.100.7');
assert.equal(killed.status, 503);
assert.equal(killed.json.code, 'upstream');
assert.equal((await api('GET', '/')).status, 200);
ok('kill switch: the sidecar stopped, the form gets a generic 503, the site still serves');
execSync(`docker start ${CT}-site-proxy-1`, { stdio: 'ignore' });

const q = await dev('/__dev/mail');
assert.equal(q.failures, 0);
console.log(`\nall ${checks} checks passed; ${q.sent.length} mails`);
process.exit(0);
