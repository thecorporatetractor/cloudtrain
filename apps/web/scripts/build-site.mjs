// Builds the public marketing website as a static bundle (docs/deploy-website.md).
//
//   pnpm --filter web build:site -- [--out dist-site] [--api-base https://api.example.com]
//                                   [--app-url https://app.example.com] [--pricing]
//                                   [--launch coming-soon|live] [--site-url https://www.example.com]
//
//   --api-base  Origin of the gateway the waitlist form posts to (env CT_API_BASE).
//               Empty: same origin as the site (a reverse proxy routes /api).
//               The gateway must list the site's origin in CT_CORS_ORIGINS.
//   --app-url   Origin of the platform for "Sign in" (env CT_APP_URL). Empty: the
//               site has no sign-in button and /sign-in explains itself.
//   --pricing   Keep the pricing page (its plan buttons need the platform).
//   --launch    Override content/site.yaml `launch.mode` (env CT_LAUNCH_MODE):
//               coming-soon (one standalone landing, no sign-in) or live.
//   --no-prerender  Skip prerendering `/` (needs playwright-core and a Chromium; CT_CHROMIUM
//               names the binary). Without it the page renders in the browser only.
//   --site-url  The site's own origin (env CT_SITE_URL), for absolute Open Graph
//               URLs, the canonical link and sitemap.xml. Empty: no sitemap, and
//               social cards use relative image URLs (most scrapers then skip them).
//
// Steps: export the public data (site.json, catalog, path and exam documents) from
// content/ with the gateway's own code, run `vite build` in static website mode
// (VITE_SITE_MODE=static, API mode real, so no mock service worker), then add the
// data, runtime-config.js and the host files (404.html, _redirects, _headers,
// staticwebapp.config.json, .nojekyll, robots.txt, sitemap.xml), and rewrites the head of
// index.html (title, description, Open Graph and Twitter card) from the site configuration. No account, domain or host is
// needed; the output directory is plain files for any static host.
import { spawnSync } from 'node:child_process';
import { access, cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deferEntry, headersFile, injectRoot, originOf, redirectsFile, rewriteHead, robotsFor, runtimeConfigJs, siteBootJs, sitemapXml, sitePaths, staticWebAppConfig } from './site-hosting.mjs';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const repo = path.resolve(web, '../..');
const out = path.resolve(process.cwd(), arg('out', 'dist-site'));
const pricing = process.argv.includes('--pricing');
const apiBase = originOf(arg('api-base', process.env.CT_API_BASE), 'api base');
const appUrl = originOf(arg('app-url', process.env.CT_APP_URL), 'app url');
const siteUrl = originOf(arg('site-url', process.env.CT_SITE_URL), 'site url');
const launchArg = (arg('launch', process.env.CT_LAUNCH_MODE) ?? '').trim();
const prerenderOn = !process.argv.includes('--no-prerender');
if (launchArg && launchArg !== 'coming-soon' && launchArg !== 'live') throw new Error(`--launch must be coming-soon or live, got "${launchArg}"`);

let prerendered = '';

/** A Chromium for prerendering: CT_CHROMIUM, a system browser, or Playwright's own download. */
async function chromiumPath(chromium) {
  const candidates = [process.env.CT_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', chromium.executablePath?.()].filter(Boolean);
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      /* next */
    }
  }
  return undefined;
}

/**
 * Renders `/` in a headless browser against the finished output and writes its markup into
 * index.html, so the first paint (and what a crawler reads) is the page, not a splash. Skipped,
 * with a note, when no browser is available: the site works the same, it just paints later.
 */
async function prerender(dir, shell) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    prerendered = 'skipped: playwright-core is not installed';
    return;
  }
  const exe = await chromiumPath(chromium);
  if (!exe) {
    prerendered = 'skipped: no Chromium (set CT_CHROMIUM)';
    return;
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir) || url.pathname === '/' || !(await stat(file).then((s) => s.isFile()).catch(() => false))) file = path.join(dir, 'shell.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // The API is not part of the page; the waitlist only posts on submit.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main h1', { timeout: 20000 });
    const root = await page.evaluate(() => document.getElementById('root').innerHTML);
    // The page is there before any script runs; the app loads once it has painted (site-boot.js).
    // The text face is preloaded so the prerendered text does not reflow when it arrives.
    const inter = (await readdir(path.join(dir, 'assets'))).find((f) => /^inter-latin-wght-normal.*\.woff2$/.test(f));
    const font = inter ? `  <link rel="preload" href="/assets/${inter}" as="font" type="font/woff2" crossorigin />\n  </head>` : '</head>';
    const deferred = deferEntry(injectRoot(shell, root));
    await writeFile(path.join(dir, 'index.html'), deferred.html.replace('</head>', font));
    await writeFile(path.join(dir, 'site-boot.js'), siteBootJs(deferred.entry));
    prerendered = `yes (${Math.round(root.length / 1024)} KiB of markup)`;
  } finally {
    await browser.close();
    server.close();
  }
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`build-site: "${cmd} ${args.join(' ')}" failed (${r.status ?? r.signal})`);
    process.exit(r.status ?? 1);
  }
}

const data = await mkdtemp(path.join(os.tmpdir(), 'ct-site-data-'));
try {
  console.log('1/3 exporting the public data from content/');
  run('pnpm', ['--filter', '@cloudtrain/gateway', 'site:export', '--out', data, ...(pricing ? ['--pricing'] : []), ...(appUrl ? ['--app-url', appUrl] : [])]);

  // The launch mode is fixed at build time, so the first render already knows which website this is.
  const exported = JSON.parse(await readFile(path.join(data, 'data', 'site.json'), 'utf8'));
  const mode = launchArg || exported.launch?.mode || 'live';

  console.log('2/3 building the static site');
  await rm(out, { recursive: true, force: true });
  run('pnpm', ['--filter', 'web', 'exec', 'vite', 'build', '--outDir', out, '--emptyOutDir'], { VITE_API_MODE: 'real', VITE_SITE_MODE: 'static', VITE_APP_URL: appUrl, VITE_LAUNCH_MODE: mode });

  console.log('3/3 adding data and host files');
  await cp(path.join(data, 'data'), path.join(out, 'data'), { recursive: true });
  await rm(path.join(out, 'mockServiceWorker.js'), { force: true });
  await writeFile(path.join(out, 'runtime-config.js'), runtimeConfigJs(apiBase));

  // The head of index.html: what link previews and search results show for this deployment.
  const site = JSON.parse(await readFile(path.join(out, 'data', 'site.json'), 'utf8'));
  const brand = site.brand?.name ?? 'CloudTrain';
  const soon = mode === 'coming-soon';
  const title = soon ? `${brand}: ${site.launch?.title ?? site.hero.title}` : `${brand}: ${site.brand.tagline}`;
  const description = (soon ? (site.launch?.subtitle ?? site.hero.subtitle) : site.hero.subtitle).slice(0, 300);
  const index = rewriteHead(await readFile(path.join(out, 'index.html'), 'utf8'), { title, description, image: '/site/og-image.png', siteUrl })
    // The first render waits for the configuration: start fetching it with the HTML.
    .replace('</head>', '  <link rel="preload" href="/data/site.json" as="fetch" crossorigin />\n  </head>')
    // Not render-blocking: deferred scripts and the module script still run in document order.
    .replace('<script src="/runtime-config.js"></script>', '<script defer src="/runtime-config.js"></script>');
  // shell.html: the app without prerendered content, for every path but `/` (_redirects, Azure's
  // fallback, and 404.html, which GitHub Pages serves for unknown paths).
  await writeFile(path.join(out, 'index.html'), index);
  await writeFile(path.join(out, 'shell.html'), index);
  await writeFile(path.join(out, '404.html'), index);
  await writeFile(path.join(out, '_redirects'), redirectsFile);
  await writeFile(path.join(out, '_headers'), headersFile(apiBase));
  await writeFile(path.join(out, 'staticwebapp.config.json'), staticWebAppConfig(apiBase));
  await writeFile(path.join(out, '.nojekyll'), '');
  await writeFile(path.join(out, 'robots.txt'), robotsFor(siteUrl));
  if (siteUrl) {
    const ids = async (dir) => (await readdir(path.join(out, 'data', dir)).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    const pages = sitePaths({ mode, pricing: site.flags?.showPricing, catalog: site.flags?.showCatalog, paths: await ids('paths'), exams: await ids('exams') });
    await writeFile(path.join(out, 'sitemap.xml'), sitemapXml(siteUrl, pages, new Date().toISOString().slice(0, 10)));
  }

  if (!index.includes('src="/runtime-config.js"')) throw new Error('index.html does not load runtime-config.js');
  if (prerenderOn) await prerender(out, index);
  await stat(path.join(out, 'data', 'site.json'));
  console.log(`\nStatic site ready in ${out}`);
  console.log(`  API base for the waitlist form: ${apiBase || '(same origin as the site)'}`);
  console.log(`  Launch mode:                    ${mode}${launchArg ? ' (from --launch)' : ' (from site.yaml)'}`);
  console.log(`  Sign-in hands over to:          ${soon ? '(nothing: coming soon hides sign-in)' : appUrl || '(nothing: no sign-in on this site)'}`);
  console.log(`  Prerendered /:                  ${prerendered || '(no)'}`);
  console.log(`  Site origin (sitemap, OG URLs): ${siteUrl || '(not set: no sitemap.xml, relative social image)'}`);
  if (!apiBase) console.log('  note: no --api-base, the waitlist form posts to this site\'s own /api (a proxy must route it)');
  console.log(`  Preview: pnpm --filter web exec vite preview --outDir ${out}`);
} finally {
  await rm(data, { recursive: true, force: true });
}
