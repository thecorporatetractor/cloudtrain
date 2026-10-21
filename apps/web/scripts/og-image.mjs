// Renders the website's social card (Open Graph / Twitter, 1200x630) from an HTML template
// with the brand lockup and the theme's dark tokens, using the same headless Chromium as the
// screenshot scripts. No network, no extra dependency.
//
//   node apps/web/scripts/og-image.mjs [--chromium /usr/bin/chromium] [--title "..."] [--line "..."]
//
// Output: apps/web/public/site/og-image.png (served as /site/og-image.png; build-site.mjs
// points og:image and twitter:image at it, absolute when --site-url is given).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockup = await readFile(path.join(web, 'public/brand/cloudtrain-horizontal-white.svg'), 'utf8');
const font = async (rel) => `data:font/woff2;base64,${(await readFile(path.join(web, 'node_modules/@fontsource-variable', rel))).toString('base64')}`;
const inter = await font('inter/files/inter-latin-wght-normal.woff2');
const mono = await font('jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2');
const title = arg('title', 'Learn infrastructure by operating it.');
const line = arg('line', 'Real VMs, clusters and network devices in your browser. Pay only for the minutes your labs run.');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url('${inter}') format('woff2'); font-weight: 100 900; }
@font-face { font-family: Mono; src: url('${mono}') format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #0e0f11; color: #e6e8eb; font-family: Inter, sans-serif; position: relative; }
.bg { position: absolute; inset: 0;
  background: radial-gradient(ellipse 55% 70% at 85% 20%, rgba(169,180,201,.22), transparent 70%),
              radial-gradient(ellipse 40% 60% at 0% 0%, rgba(109,187,139,.12), transparent 70%),
              radial-gradient(circle at 1px 1px, rgba(230,232,235,.13) 1px, transparent 1.3px) 0 0 / 24px 24px;
  -webkit-mask-image: linear-gradient(180deg, #000 40%, rgba(0,0,0,.35)); }
.wrap { position: absolute; inset: 64px 72px; display: flex; flex-direction: column; }
.logo svg { height: 40px; width: auto; }
.pill { margin-top: 44px; align-self: flex-start; display: inline-flex; gap: 12px; align-items: center; padding: 8px 18px 8px 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; font-size: 22px; color: #e6e8eb; background: rgba(20,22,24,.8); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: #6dbb8b; box-shadow: 0 0 0 5px rgba(109,187,139,.18); }
h1 { margin-top: 26px; font-size: 72px; line-height: 1.02; letter-spacing: -0.045em; font-weight: 650; max-width: 15ch;
  background: linear-gradient(180deg, #e6e8eb 35%, #b9bfca 100%); -webkit-background-clip: text; color: transparent; }
p { margin-top: 22px; font-size: 27px; line-height: 1.4; color: #9aa0a8; max-width: 34ch; }
.term { position: absolute; right: 72px; bottom: 64px; width: 360px; border: 1px solid rgba(255,255,255,.16); border-radius: 14px; background: #0b0c0e; font-family: Mono, monospace; font-size: 17px; line-height: 1.7; padding: 16px 20px; box-shadow: 0 24px 60px -12px rgba(0,0,0,.7); }
.term .p { color: #a9b4c9; } .ok { color: #6dbb8b; } .meter { margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,.12); color: #9aa0a8; display: flex; justify-content: space-between; }
</style></head><body><div class="bg"></div><div class="wrap">
<div class="logo">${lockup.replace(/<title[^>]*>.*?<\/title>/, '')}</div>
<div class="pill"><span class="dot"></span>Coming soon · join the waitlist</div>
<h1>${esc(title)}</h1><p>${esc(line)}</p></div>
<div class="term"><div><span class="p">$</span> ct validate</div><div class="ok">✓ worker-1 is Ready</div><div class="ok">✓ kubelet active and enabled</div><div class="meter"><span>VM lab · per minute</span><span>00:18:42</span></div></div>
</body></html>`;

const browser = await chromium.launch({ executablePath: arg('chromium', '/usr/bin/chromium'), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(web, 'public/site/og-image.png');
  await page.screenshot({ path: out });
  console.log('wrote', path.relative(process.cwd(), out));
} finally {
  await browser.close();
}
