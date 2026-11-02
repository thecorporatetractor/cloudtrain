// Pure helpers of build-site.mjs: the small files a static host needs next to the bundle.
// Kept free of I/O so scripts/site-hosting.test.mjs can check them.

/** Validates an http(s) origin (no path); returns '' for empty input and throws on anything else. */
export function originOf(value, name) {
  const v = (value ?? '').trim();
  if (!v) return '';
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${name} must be an http(s) origin like https://api.example.com, got "${v}"`);
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    throw new Error(`${name} must be an http(s) origin without a path, got "${v}"`);
  }
  return u.origin;
}

/**
 * runtime-config.js (src/lib/runtimeConfig.ts): the API origin the waitlist form posts to
 * and the app's origin, where "Sign in" and every app path go (src/lib/surface.ts).
 */
export function runtimeConfigJs(apiBase, environment = 'website', appUrl = '') {
  return `// Rendered by apps/web/scripts/build-site.mjs. Edit apiBase (the waitlist form) or appUrl (sign-in) without rebuilding.\nwindow.__CLOUDTRAIN_CONFIG__ = ${JSON.stringify({ apiBase, environment, appUrl, surface: 'site' })};\n`;
}

/** Content-Security-Policy of the static site: the only cross-origin call is the waitlist POST to the API origin. */
export function csp(apiBase) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${apiBase ? ` ${apiBase}` : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Cloudflare Pages and Netlify `_headers`. */
export function headersFile(apiBase) {
  const security = ['X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy: camera=(), microphone=(), geolocation=()', `Content-Security-Policy: ${csp(apiBase)}`];
  return [
    '/*',
    ...security.map((h) => `  ${h}`),
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/data/*',
    '  Cache-Control: public, max-age=300',
    '  X-Robots-Tag: noindex',
    '/runtime-config.js',
    '  Cache-Control: no-cache',
    '/index.html',
    '  Cache-Control: no-cache',
    '/shell.html',
    '  Cache-Control: no-cache',
    '',
  ].join('\n');
}

/**
 * Website paths that have no page of their own in coming-soon mode (src/site/launch.ts) but that
 * people or old links may use: each goes to where the same content now is. Every host applies them
 * only when no page exists at the path, so `live` keeps its pages.
 */
export const HIDDEN_ROUTE_REDIRECTS = [
  ['/pricing', '/#pricing'],
  ['/faq', '/#faq'],
  ['/about', '/#what'],
  ['/contact', '/#faq'],
  ['/catalog', '/learn/labs'],
  ['/labs', '/learn/labs'],
  ['/learn', '/learn/labs'],
];

/**
 * Cloudflare Pages and Netlify `_redirects`. Every page is a file of its own and an unknown path gets
 * 404.html with a 404 status, so there is no catch-all. `appFallback` keeps one for a live site that
 * hands app paths over to the platform in the browser (src/lib/surface.ts): those paths have no file.
 */
export function redirectsFile({ mode = 'coming-soon', appFallback = false } = {}) {
  const rules = mode === 'coming-soon' ? HIDDEN_ROUTE_REDIRECTS.map(([from, to]) => `${from}  ${to}  301`) : [];
  return [...rules, ...(appFallback ? ['/*  /shell.html  200'] : []), ''].join('\n');
}

/** Azure Static Web Apps `staticwebapp.config.json`. */
export function staticWebAppConfig(apiBase, { mode = 'coming-soon', appFallback = false } = {}) {
  return (
    JSON.stringify(
      {
        ...(appFallback ? { navigationFallback: { rewrite: '/shell.html', exclude: ['/assets/*', '/data/*', '/brand/*', '/site/*', '/*.{js,css,json,webmanifest,svg,png,webp,ico,txt,xml}'] } } : {}),
        responseOverrides: { 404: { rewrite: '/404.html', statusCode: 404 } },
        globalHeaders: {
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Content-Security-Policy': csp(apiBase),
        },
        routes: [
          { route: '/assets/*', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
          { route: '/data/*', headers: { 'X-Robots-Tag': 'noindex' } },
          ...(mode === 'coming-soon' ? HIDDEN_ROUTE_REDIRECTS.map(([route, redirect]) => ({ route, redirect, statusCode: 301 })) : []),
        ],
      },
      null,
      2,
    ) + '\n'
  );
}

/** The API is off limits; everything else, scripts and styles too, stays crawlable. */
export const robotsTxt = 'User-agent: *\nDisallow: /api/\nAllow: /\n';

/** robots.txt; names the sitemap when the site's own origin is known. */
export function robotsFor(siteUrl) {
  return siteUrl ? `${robotsTxt}Sitemap: ${siteUrl}/sitemap.xml\n` : robotsTxt;
}

/**
 * The pages of the website outside /learn (learn-pages.mjs). Coming soon: the landing page, the
 * features page and the legal pages. Live: the website pages, plus every public path and exam detail
 * page. `/legal/privacy-request` is a page in both, for the links in mail: never for a crawler.
 */
export function sitePaths({ mode, pricing, catalog, cookies = false, features = false, paths = [], exams = [] }) {
  const legal = ['/legal/terms', '/legal/privacy', ...(cookies ? ['/legal/cookies'] : []), '/legal/privacy-request'];
  const featurePage = features ? ['/features'] : [];
  if (mode === 'coming-soon') return ['/', ...featurePage, ...legal];
  return [
    '/',
    ...(catalog ? ['/catalog'] : []),
    ...featurePage,
    ...(pricing ? ['/pricing'] : []),
    '/about',
    '/faq',
    '/contact',
    ...legal,
    ...(catalog ? [...paths.map((id) => `/catalog/paths/${id}`), ...exams.map((id) => `/catalog/exams/${id}`)] : []),
  ];
}

const attrEsc = (s) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);

/**
 * Rewrites the head of index.html for the deployment: title, description, Open Graph and
 * Twitter card (absolute URLs when the site's origin is known, as scrapers need), and the
 * canonical link. Tags that are missing are added before </head>.
 */
export function rewriteHead(html, { title, description, image, siteUrl }) {
  let out = html;
  const abs = (u) => (siteUrl && u.startsWith('/') ? siteUrl + u : u);
  const META = /<meta\s+(name|property)="([^"]+)"\s+content="[^"]*"\s*\/?>/g;
  const setMeta = (attr, key, value) => {
    if (value === undefined || value === '') return;
    const tag = `<meta ${attr}="${key}" content="${attrEsc(value)}" />`;
    let found = false;
    out = out.replace(META, (whole, a, k) => (a === attr && k === key ? ((found = true), tag) : whole));
    if (!found) out = out.replace('</head>', `  ${tag}\n  </head>`);
  };
  if (title) out = out.replace(/<title>[^<]*<\/title>/, `<title>${attrEsc(title)}</title>`);
  setMeta('name', 'description', description);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  if (image) setMeta('property', 'og:image', abs(image));
  if (siteUrl) setMeta('property', 'og:url', `${siteUrl}/`);
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  if (image) setMeta('name', 'twitter:image', abs(image));
  if (siteUrl && !/<link rel="canonical"/.test(out)) out = out.replace('</head>', `  <link rel="canonical" href="${siteUrl}/" />\n  </head>`);
  return out;
}

/**
 * Puts prerendered markup into the app's root element (replacing the boot splash), so the
 * first paint is the page itself; React then renders the same page over it.
 */
export function injectRoot(html, rootHtml) {
  const open = html.indexOf('<div id="root">');
  const end = html.lastIndexOf('</body>');
  if (open < 0 || end < 0) throw new Error('index.html has no <div id="root"> before </body>');
  const close = html.lastIndexOf('</div>', end);
  if (close < open) throw new Error('index.html: the root element is not closed');
  return `${html.slice(0, open)}<div id="root" data-prerendered>${rootHtml}${html.slice(close)}`;
}

/**
 * The loader of a prerendered page: the app's entry module (a built `/assets/*.js` path) is
 * requested only after the page has painted, so the first paint waits for HTML and CSS alone.
 */
export function siteBootJs(entry) {
  if (!/^\/assets\/[\w.-]+\.js$/.test(entry)) throw new Error(`unexpected entry module path "${entry}"`);
  return `// Rendered by apps/web/scripts/build-site.mjs: loads the app after the prerendered page has painted.
(function () {
  function load() {
    var s = document.createElement('script');
    s.type = 'module';
    s.crossOrigin = '';
    s.src = ${JSON.stringify(entry)};
    document.head.appendChild(s);
  }
  function later() {
    requestAnimationFrame(function () {
      setTimeout(load, 0);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later);
  else later();
})();
`;
}

const ENTRY = /<script type="module" crossorigin src="(\/assets\/[\w.-]+\.js)"><\/script>/;
// The URL carries the entry's content hash: a cache in front of the site (Cloudflare keeps .js by
// default) must never hand a new page the old loader, which would load the old app.
const loaderTag = (entry) => `<script defer src="/site-boot.js?v=${entry.replace(/^.*\/|\.js$/g, '')}"></script>`;

/** The entry module of index.html (for siteBootJs) and the page with that tag (and its modulepreloads) swapped for the loader. */
export function deferEntry(html) {
  const m = html.match(ENTRY);
  if (!m) throw new Error('index.html has no entry module script');
  return { entry: m[1], html: html.replace(ENTRY, loaderTag(m[1])).replace(/\s*<link rel="modulepreload"[^>]*>/g, '') };
}
