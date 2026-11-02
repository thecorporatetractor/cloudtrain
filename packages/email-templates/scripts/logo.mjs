// Renders the wordmark PNG the emails load (src/layout.ts LOGO_PATH) from the brand SVG:
//
//   node scripts/logo.mjs            # writes apps/web/public/brand/cloudtrain-email-logo.png
//
// One mid-grey (#6e7683) on a transparent background, at 2x of the 128x28 the email
// shows it at. The grey reads on the light and the dark background (about 4.2:1 on both,
// above the 3:1 asked of graphics) and is still grey when a client inverts the message,
// so there is no light/dark pair to swap and no client is left with an invisible logo.
// Dev-only: rasterised with the Chromium the website's screenshots use, through
// apps/web's playwright-core; nothing here is a dependency of the package.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../apps/web/node_modules/playwright-core/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const brand = path.resolve(here, '../../../apps/web/public/brand');
const GREY = '#6e7683';
const WIDTH = 128;
const HEIGHT = 28;

const svg = (await readFile(path.join(brand, 'cloudtrain-horizontal.svg'), 'utf8')).replace(/fill="#111111"/g, `fill="${GREY}"`);
const html = `<!doctype html><html><body style="margin:0;background:transparent"><img id="l" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${WIDTH}px;height:${HEIGHT}px"></body></html>`;

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForFunction(() => document.getElementById('l').complete);
  const png = await page.locator('#l').screenshot({ omitBackground: true, type: 'png' });
  const out = path.join(brand, 'cloudtrain-email-logo.png');
  await writeFile(out, png);
  console.log(`${path.relative(process.cwd(), out)}: ${WIDTH * 2}x${HEIGHT * 2}, ${png.length} bytes`);
} finally {
  await browser.close();
}
