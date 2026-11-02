// Previews the emails: renders each one to out/ (HTML and text), and on request
// screenshots them with Chromium or sends them to a local Mailpit.
//
//   node scripts/preview.mjs                       # out/<name>.html and out/<name>.txt
//   node scripts/preview.mjs --shots <dir>         # plus PNGs: 600 and 360 wide, light and dark, and images blocked
//   node scripts/preview.mjs --send                # plus one message each to Mailpit (SMTP 127.0.0.1:1025)
//   node scripts/preview.mjs --site https://cloudtrain.app
//
// The screenshots use apps/web's playwright-core and the Chromium on PATH; build first
// (pnpm build), the script reads dist/. Dev-only, no dependency of the package.
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPrivacyConfirm, renderWaitlistLeft, renderWaitlistWelcome } from '../dist/index.js';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? true) : d;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../out');
const siteUrl = String(arg('site', 'https://cloudtrain.app'));
const shotsDir = arg('shots', null);
const send = process.argv.includes('--send');

const emails = {
  'waitlist-welcome': renderWaitlistWelcome({ siteUrl, leaveUrl: `${siteUrl}/waitlist/leave#token=example-leave-token` }),
  'privacy-confirm-erasure': renderPrivacyConfirm({ siteUrl, confirmUrl: `${siteUrl}/legal/privacy-request#token=example-confirm-token`, type: 'erasure' }),
  'privacy-confirm-withdrawal': renderPrivacyConfirm({ siteUrl, confirmUrl: `${siteUrl}/legal/privacy-request#token=example-confirm-token`, type: 'withdrawal' }),
  'privacy-confirm-export': renderPrivacyConfirm({ siteUrl, confirmUrl: `${siteUrl}/legal/privacy-request#token=example-confirm-token`, type: 'export' }),
  'waitlist-left': renderWaitlistLeft({ siteUrl }),
};

await mkdir(outDir, { recursive: true });
for (const [name, e] of Object.entries(emails)) {
  await writeFile(path.join(outDir, `${name}.html`), e.html);
  await writeFile(path.join(outDir, `${name}.txt`), `Subject: ${e.subject}\n\n${e.text}`);
  console.log(`${name}: ${Buffer.byteLength(e.html)} bytes html, ${Buffer.byteLength(e.text)} bytes text, subject "${e.subject}"`);
}

if (shotsDir) {
  const { chromium } = await import('../../../apps/web/node_modules/playwright-core/index.mjs');
  const dir = path.resolve(String(shotsDir));
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const runs = [
      { tag: '600-light', width: 600, scheme: 'light' },
      { tag: '600-dark', width: 600, scheme: 'dark' },
      { tag: '360-light', width: 360, scheme: 'light' },
      { tag: '360-dark', width: 360, scheme: 'dark' },
      { tag: '600-light-noimg', width: 600, scheme: 'light', noImages: true },
      { tag: '360-dark-noimg', width: 360, scheme: 'dark', noImages: true },
      // What a client that force-inverts a light message does: every colour flipped, images left alone.
      { tag: '600-forced-invert', width: 600, scheme: 'light', invert: true },
    ];
    for (const [name, e] of Object.entries(emails)) {
      for (const r of runs) {
        const ctx = await browser.newContext({ viewport: { width: r.width, height: 800 }, deviceScaleFactor: 2, colorScheme: r.scheme });
        const page = await ctx.newPage();
        // The logo is on the site; serve it from the working tree so the preview needs no network.
        await page.route('**/*', async (route) => {
          const url = route.request().url();
          if (route.request().resourceType() === 'image') {
            if (r.noImages) return route.abort();
            const file = path.resolve(here, '../../../apps/web/public', new URL(url).pathname.replace(/^\//, ''));
            return route.fulfill({ path: file, contentType: 'image/png' }).catch(() => route.abort());
          }
          return route.continue();
        });
        await page.setContent(e.html, { waitUntil: 'load' });
        if (r.invert) await page.addStyleTag({ content: 'html{filter:invert(1) hue-rotate(180deg)} img{filter:invert(1) hue-rotate(180deg)}' });
        await page.screenshot({ path: path.join(dir, `${name}-${r.tag}.png`), fullPage: true });
        await ctx.close();
      }
      console.log(`${name}: ${runs.length} screenshots in ${dir}`);
    }
  } finally {
    await browser.close();
  }
}

if (send) {
  for (const [name, e] of Object.entries(emails)) {
    await smtp('127.0.0.1', 1025, 'waitlist@cloudtrain.app', 'someone@example.com', mime(e, name));
    console.log(`${name}: sent to Mailpit`);
  }
}

/** The raw message, multipart/alternative, text first. Base64 keeps lines under the SMTP limit. */
function mime(e, name) {
  const b = `=_ct_${name}_${Date.now().toString(36)}`;
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const subject = `=?UTF-8?B?${Buffer.from(e.subject, 'utf8').toString('base64')}?=`;
  return [
    `From: CloudTrain <waitlist@cloudtrain.app>`,
    `Reply-To: hello@cloudtrain.app`,
    `To: someone@example.com`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${b}"`,
    ``,
    `--${b}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64(e.text),
    `--${b}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64(e.html),
    `--${b}--`,
    ``,
  ].join('\r\n');
}

/** A minimal SMTP client, enough for a local Mailpit. */
function smtp(host, port, from, to, data) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const steps = [`EHLO localhost`, `MAIL FROM:<${from}>`, `RCPT TO:<${to}>`, `DATA`, data.replace(/\r?\n\./g, '\r\n..') + '\r\n.', `QUIT`];
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buf += chunk;
      if (!/\r\n$/.test(buf) || /^\d{3}-/m.test(buf.split('\r\n').filter(Boolean).at(-1))) return;
      const code = Number(buf.slice(0, 3));
      buf = '';
      if (code >= 400) return reject(new Error(`SMTP ${code}`));
      const next = steps.shift();
      if (next === undefined) return sock.end(resolve());
      sock.write(next + '\r\n');
    });
  });
}
