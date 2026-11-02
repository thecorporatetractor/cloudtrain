// Builds the public marketing website as a static bundle (docs/deploy-website.md).
//
//   pnpm --filter web build:site -- [--out dist-site] [--api-base https://api.example.com]
//                                   [--app-url https://app.example.com] [--pricing]
//                                   [--launch coming-soon|live] [--site-url https://www.example.com]
//
//   --api-base  Origin of the gateway the waitlist form posts to (env CT_API_BASE).
//               Empty: same origin as the site (a reverse proxy routes /api).
//               The gateway must list the site's origin in CT_CORS_ORIGINS.
//   --app-url   Origin of the platform (env CT_APP_URL), e.g. https://app.example.com:
//               "Sign in", plan buttons and every app path go there (src/lib/surface.ts).
//               Empty: the site has no sign-in button and /sign-in explains itself.
//   --pricing   Keep the pricing page (its plan buttons need the platform).
//   --launch    Override content/site.yaml `launch.mode` (env CT_LAUNCH_MODE):
//               coming-soon (one standalone landing, no sign-in) or live.
//   --no-prerender  Skip prerendering (needs playwright-core and a Chromium; CT_CHROMIUM names
//               the binary). Without it the pages render in the browser only, unknown paths still
//               get 404.html, and the check of the finished pages (site-check.mjs) does not run.
//   --site-url  The site's own origin (env CT_SITE_URL), for absolute Open Graph
//               URLs, the canonical link and sitemap.xml. Empty: no sitemap, and
//               social cards use relative image URLs (most scrapers then skip them).
//
// Steps: export the public data (site.json, catalog, path and exam documents) from
// content/ with the gateway's own code, run `vite build` in static website mode
// (VITE_SITE_MODE=static, API mode real, so no mock service worker), then add the
// data, runtime-config.js and the host files (404.html, _redirects, _headers,
// staticwebapp.config.json, .nojekyll, robots.txt, the sitemap files, routes.json), generates the
// /learn pages from content/curriculum.yaml (learn-pages.mjs) and prerenders every route into a file
// of its own with its own head (site-seo.mjs). No account, domain or host is needed; the output
// directory is plain files for any static host. routes.json is the route manifest: a known path has
// a file, every other path is a 404 (deploy/site-vm/Caddyfile, 404.html on other hosts).
import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { buildLearn, catalogSummary, examTasks, learnDocFile } from './learn-pages.mjs';
import { checkSite, privateText, range } from './site-check.mjs';
import { deferEntry, HIDDEN_ROUTE_REDIRECTS, headersFile, injectRoot, originOf, redirectsFile, rewriteHead, robotsFor, runtimeConfigJs, siteBootJs, sitePaths, staticWebAppConfig } from './site-hosting.mjs';
import { breadcrumbLd, faqPageLd, gitDates, newestDate, organizationLd, pageHead, sitemapFiles, websiteLd, withoutApp } from './site-seo.mjs';

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
let checked = '';

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

/** Where a route's page lives under the site root. */
const fileOf = (route) => (route === '/' ? 'index.html' : `${route.slice(1)}/index.html`);

/**
 * Renders every route in a headless browser against the finished output and writes its markup and its
 * head into a file of its own, so the first paint (and what a crawler reads) is the page, not a splash.
 * Skipped, with a note, when no browser is available: every route is then the bare app shell.
 * The website's own pages each get a page load; the /learn pages, which are many and alike, are one
 * in-app navigation apiece, which keeps the browser's run short.
 */
async function prerender(dir, shell, routes, { siteUrl, renderedHead }) {
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
  // Everything the page reads is in /data, exported above. A production VM answers 404 under /api
  // except for the forms (docs/deploy-site-vm.md), so a page that calls it would break there.
  const apiCalls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname.startsWith('/api/')) apiCalls.push(`${req.method} ${url.pathname}`);
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir) || url.pathname === '/' || !(await stat(file).then((s) => s.isFile()).catch(() => false))) file = path.join(dir, 'shell.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    // The still page: with reduced motion the motion engine never loads, so no entrance state (src/site/motion) ends up in the markup.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    // The API is not part of the page; the waitlist only posts on submit.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const inter = (await readdir(path.join(dir, 'assets'))).find((f) => /^inter-latin-wght-normal.*\.woff2$/.test(f));
    const font = inter ? `  <link rel="preload" href="/assets/${inter}" as="font" type="font/woff2" crossorigin />\n  </head>` : '</head>';
    let entry;
    let bytes = 0;
    const capture = async (route) => {
      const { root, faq } = await page.evaluate(() => ({
        root: document.getElementById('root').innerHTML,
        // The questions as the page shows them: the source of its FAQPage data, so the two cannot differ.
        faq: [...document.querySelectorAll('.site-faq-item')].map((d) => ({ q: d.querySelector('summary')?.textContent?.trim() ?? '', a: d.querySelector('p')?.textContent?.trim() ?? '' })),
      }));
      const head = pageHead(shell, { path: route.path, title: route.title, description: route.description, noindex: route.noindex, siteUrl, jsonLd: [...(route.jsonLd ?? []), ...renderedHead(route, faq)], preload: route.kind.startsWith('site') ? [] : [`/${learnDocFile(route.path)}`] });
      // The page is there before any script runs; the app loads once it has painted (site-boot.js).
      // The text face is preloaded so the prerendered text does not reflow when it arrives.
      const deferred = deferEntry(injectRoot(head, root));
      entry = deferred.entry;
      const html = deferred.html.replace('</head>', font);
      const out = route.path === '/404' ? '404.html' : fileOf(route.path);
      await mkdir(path.dirname(path.join(dir, out)), { recursive: true });
      await writeFile(path.join(dir, out), route.path === '/404' ? withoutApp(html) : html);
      bytes += root.length;
    };
    const learn = routes.filter((r) => !r.kind.startsWith('site'));
    for (const r of routes.filter((x) => x.kind.startsWith('site'))) {
      await page.goto(`${origin}${r.path}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main h1', { timeout: 20000 });
      await capture(r);
    }
    if (learn.length) {
      await page.goto(`${origin}${learn[0].path}`, { waitUntil: 'networkidle' });
      for (const r of learn) {
        await page.evaluate((p) => {
          if (window.location.pathname === p) return;
          window.history.pushState({}, '', p);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, r.path);
        await page.waitForSelector(`[data-learn-page="${r.path}"] h1`, { timeout: 20000 });
        await capture(r);
      }
    }
    if (apiCalls.length) throw new Error(`the static site called the API while loading: ${[...new Set(apiCalls)].join(', ')}`);
    if (entry) await writeFile(path.join(dir, 'site-boot.js'), siteBootJs(entry));
    prerendered = `yes (${routes.length} pages, ${Math.round(bytes / 1024 / 1024)} MiB of markup)`;
    return true;
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
  await writeFile(path.join(out, 'runtime-config.js'), runtimeConfigJs(apiBase, 'website', appUrl));

  // The head every page starts from: what link previews and search results show for this deployment.
  const site = JSON.parse(await readFile(path.join(out, 'data', 'site.json'), 'utf8'));
  const brand = site.brand?.name ?? 'CloudTrain';
  const soon = mode === 'coming-soon';
  const home = site.seo?.pages?.['/'];
  const title = home?.title ?? (soon ? `${brand}: ${site.launch?.title ?? site.hero.title}` : `${brand}: ${site.brand.tagline}`);
  const description = home?.description ?? (soon ? (site.launch?.subtitle ?? site.hero.subtitle) : site.hero.subtitle).slice(0, 300);
  const index = rewriteHead(await readFile(path.join(out, 'index.html'), 'utf8'), { title, description, image: '/site/og-image.png', siteUrl })
    // The first render waits for the configuration: start fetching it with the HTML.
    .replace('</head>', '  <link rel="preload" href="/data/site.json" as="fetch" crossorigin />\n  </head>')
    // Not render-blocking: deferred scripts and the module script still run in document order.
    .replace('<script src="/runtime-config.js"></script>', '<script defer src="/runtime-config.js"></script>');
  // shell.html: the app without any page in it, for the browser that renders the pages below, and on
  // a live site with a platform, for the app paths it hands over in the browser. Nothing else serves it.
  const appFallback = !soon && !!appUrl;
  await writeFile(path.join(out, 'index.html'), index);
  await writeFile(path.join(out, 'shell.html'), index);
  await writeFile(path.join(out, '404.html'), index);
  await writeFile(path.join(out, '_redirects'), redirectsFile({ mode, appFallback }));
  await writeFile(path.join(out, '_headers'), headersFile(apiBase));
  await writeFile(path.join(out, 'staticwebapp.config.json'), staticWebAppConfig(apiBase, { mode, appFallback }));
  await writeFile(path.join(out, '.nojekyll'), '');
  await writeFile(path.join(out, 'robots.txt'), robotsFor(siteUrl));
  if (!index.includes('src="/runtime-config.js"')) throw new Error('index.html does not load runtime-config.js');

  /* ---------------------------------------------------- the /learn pages */
  const contentDir = process.env.CT_CONTENT_DIR ? path.resolve(process.env.CT_CONTENT_DIR) : path.join(repo, 'content');
  const curriculum = parseYaml(await readFile(path.join(contentDir, 'curriculum.yaml'), 'utf8'), { merge: true });
  const catalog = JSON.parse(await readFile(path.join(out, 'data', 'catalog.json'), 'utf8'));
  const examDetails = new Map();
  for (const f of await readdir(path.join(out, 'data', 'exams')).catch(() => [])) examDetails.set(f.slice(0, -5), JSON.parse(await readFile(path.join(out, 'data', 'exams', f), 'utf8')));
  await writeFile(path.join(out, 'data', 'catalog-summary.json'), `${JSON.stringify(catalogSummary(catalog, curriculum))}\n`);
  const seo = site.seo ?? { pages: {}, domains: {} };
  const { pages: learnPages, report } = buildLearn({ curriculum, catalog, exams: examDetails, seo, siteUrl });
  for (const p of learnPages) {
    const file = path.join(out, learnDocFile(p.path));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(p.doc)}\n`);
  }

  /* --------------------------------------------------- the route manifest */
  const ids = async (dir) => (await readdir(path.join(out, 'data', dir)).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const sitePageList = sitePaths({ mode, pricing: site.flags?.showPricing, catalog: site.flags?.showCatalog, cookies: !!site.legal?.cookies, features: !!site.featurePage, paths: await ids('paths'), exams: await ids('exams') });
  const email = site.contact?.email;
  const dynamicHead = async (p) => {
    const m = /^\/catalog\/(paths|exams)\/(.+)$/.exec(p);
    if (!m) return undefined;
    const doc = JSON.parse(await readFile(path.join(out, 'data', m[1], `${m[2]}.json`), 'utf8'));
    return { title: `${doc.title}: catalog | ${brand}`, description: doc.description ?? `${doc.title}: hands-on infrastructure training on ${brand}.` };
  };
  const siteRoutes = [];
  for (const p of sitePageList) {
    const h = site.seo?.pages?.[p] ?? (await dynamicHead(p)) ?? { title: `${brand} ${p}`, description };
    siteRoutes.push({ path: p, kind: 'site', title: h.title, description: h.description, noindex: !!h.noindex, sources: ['content/site.yaml'] });
  }
  const notFound = { path: '/404', kind: 'site-404', title: `Page not found | ${brand}`, description: `This page does not exist on ${brand}.`, noindex: true };
  const learnRoutes = learnPages.map((p) => ({ path: p.path, kind: p.kind, title: p.title, description: p.description, noindex: p.noindex, jsonLd: p.jsonLd, sources: p.sources }));
  // Structured data that needs the rendered page or the site configuration.
  const renderedHead = (route, faq) => {
    const blocks = [];
    if (!siteUrl || route.path === '/404' || !route.kind.startsWith('site')) return blocks;
    if (route.path === '/') blocks.push(organizationLd(siteUrl, { name: brand, email }), websiteLd(siteUrl, { name: brand, description }));
    if (faq.length && (route.path === '/' || route.path === '/faq')) blocks.push(faqPageLd(faq));
    const parts = route.path.split('/').filter(Boolean);
    if (parts.length > 1) blocks.push(breadcrumbLd(siteUrl, [{ label: 'Home', to: '/' }, { label: route.heading ?? route.title.split(' | ')[0] }]));
    return blocks;
  };
  const dates = gitDates(repo);
  const manifest = [...siteRoutes, ...learnRoutes].map((r) => ({ path: r.path, file: fileOf(r.path), kind: r.kind, noindex: !!r.noindex, ...(newestDate(dates, r.sources) ? { lastmod: newestDate(dates, r.sources) } : {}) }));
  await writeFile(path.join(out, 'routes.json'), `${JSON.stringify(manifest)}\n`);
  if (siteUrl) for (const [f, xml] of sitemapFiles(siteUrl, manifest)) await writeFile(path.join(out, f), xml);

  let rendered = false;
  if (prerenderOn) rendered = await prerender(out, index, [...siteRoutes, notFound, ...learnRoutes], { siteUrl, renderedHead });
  if (!rendered) {
    // No browser: each route still gets a file and its head, and the app renders the page. Without this
    // only `/` would answer on a host that serves files and nothing else.
    for (const r of [...siteRoutes, notFound, ...learnRoutes]) {
      const file = r.path === '/404' ? '404.html' : fileOf(r.path);
      await mkdir(path.dirname(path.join(out, file)), { recursive: true });
      await writeFile(path.join(out, file), pageHead(index, { path: r.path, title: r.title, description: r.description, noindex: r.noindex, siteUrl, jsonLd: [...(r.jsonLd ?? []), ...renderedHead(r, [])] }));
    }
  }
  if (!appFallback && rendered) await rm(path.join(out, 'shell.html'), { force: true });

  /* ------------------------------------------------- the finished pages */
  // No third-party analytics anywhere: neither the shell nor a prerendered page may mention Google tags.
  for (const f of ['index.html', '404.html']) {
    const html = await readFile(path.join(out, f), 'utf8');
    if (/googletagmanager|google-analytics|gtag\(/.test(html)) throw new Error(`${f} must not load analytics`);
  }
  if (rendered && siteUrl) {
    const secrets = {};
    const labsDir = path.join(contentDir, 'packs');
    for (const pack of await readdir(labsDir).catch(() => [])) {
      for (const id of await readdir(path.join(labsDir, pack, 'labs')).catch(() => [])) {
        const lab = await readFile(path.join(labsDir, pack, 'labs', id, 'lab.yaml'), 'utf8').catch(() => undefined);
        if (lab) secrets[id] = privateText(parseYaml(lab, { merge: true, logLevel: 'silent' })?.spec);
      }
    }
    const allowed = [...curriculum.labs.filter((l) => l.type !== 'exam').flatMap((l) => [l.title, l.oneLine ?? '']), ...Object.values(catalog.skillNames), ...curriculum.paths.flatMap((p) => [p.title, p.audience ?? '', ...p.modules.map((m) => m.title)]), ...Object.values(seo.domains ?? {}).flatMap((d) => [d.lead, d.description])];
    const { errors, stats } = checkSite({ dir: out, siteUrl, secrets, allowed, redirects: soon ? HIDDEN_ROUTE_REDIRECTS.map(([from]) => from) : [], strictMarks: soon, examTasks: soon ? examTasks(curriculum) : [], verifiedLabs: catalogSummary(catalog, curriculum).counts.labs });
    // The pages of a live site outside /learn (its catalog, built for visitors signed in or about to)
    // have had no pass over them yet: reported, so that it happens before launch, but not fatal.
    const fatal = soon ? errors : errors.filter((e) => /^(\/learn|data\/learn|sitemap)/.test(e));
    if (fatal.length) {
      for (const e of fatal.slice(0, 100)) console.error(`site-check: ${e}`);
      throw new Error(`site-check: ${fatal.length} problems in the built site`);
    }
    if (errors.length) console.warn(`site-check: ${errors.length} problems outside /learn on the live pages, first: ${errors.slice(0, 5).join('; ')}`);
    checked = `${stats.pages} pages, ${errors.length} problems; titles ${range(stats.titleLengths)} characters, descriptions ${range(stats.descLengths)}`;
  }
  await stat(path.join(out, 'data', 'site.json'));
  console.log(`\nStatic site ready in ${out}`);
  console.log(`  API base for the waitlist form: ${apiBase || '(same origin as the site)'}`);
  console.log(`  Launch mode:                    ${mode}${launchArg ? ' (from --launch)' : ' (from site.yaml)'}`);
  console.log(`  Sign-in hands over to:          ${soon ? '(nothing: coming soon hides sign-in)' : appUrl || '(nothing: no sign-in on this site)'}`);
  console.log(`  Prerendered:                    ${prerendered || '(no)'}`);
  console.log(`  Checked (site-check.mjs):       ${checked || '(no: needs prerendering and --site-url)'}`);
  console.log(`  Site origin (sitemap, OG URLs): ${siteUrl || '(not set: no sitemap.xml, relative social image)'}`);
  console.log(`  /learn:                         ${JSON.stringify(report.counts)}; noindex: ${report.thinLabs.length} labs, ${report.thinPaths.length} paths, ${report.noindexExams.length} exams; excluded labs ${JSON.stringify(report.excludedLabs)}; labs in no path ${report.labsWithoutPath}`);
  console.log(`    thin labs: ${report.thinLabs.join(' ')}`);
  console.log(`    thin paths: ${report.thinPaths.join(' ')}; paths without a published lab: ${report.skippedPaths.join(' ')}; domains without a hub: ${report.skippedDomains.join(' ')}`);
  if (!apiBase) console.log('  note: no --api-base, the waitlist form posts to this site\'s own /api (a proxy must route it)');
  console.log(`  Preview: pnpm --filter web exec vite preview --outDir ${out}`);
} finally {
  await rm(data, { recursive: true, force: true });
}
