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

/** runtime-config.js: the API origin the waitlist form posts to (src/lib/runtimeConfig.ts). */
export function runtimeConfigJs(apiBase, environment = 'website') {
  return `// Rendered by apps/web/scripts/build-site.mjs. Edit apiBase to repoint the waitlist form without rebuilding.\nwindow.__CLOUDTRAIN_CONFIG__ = ${JSON.stringify({ apiBase, environment })};\n`;
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
 * Cloudflare Pages and Netlify `_redirects`: every unknown path gets the single-page app. The
 * app shell is `shell.html` (index.html without the prerendered landing page, which only `/`
 * serves), so a deep link never shows the landing page before its own.
 */
export const redirectsFile = '/*  /shell.html  200\n';

/** Azure Static Web Apps `staticwebapp.config.json`. */
export function staticWebAppConfig(apiBase) {
  return (
    JSON.stringify(
      {
        navigationFallback: { rewrite: '/shell.html', exclude: ['/assets/*', '/data/*', '/brand/*', '/site/*', '/*.{js,css,json,webmanifest,svg,png,webp,ico,txt,xml}'] },
        globalHeaders: {
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Content-Security-Policy': csp(apiBase),
        },
        routes: [{ route: '/assets/*', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }],
      },
      null,
      2,
    ) + '\n'
  );
}

export const robotsTxt = 'User-agent: *\nAllow: /\n';

/** robots.txt; names the sitemap when the site's own origin is known. */
export function robotsFor(siteUrl) {
  return siteUrl ? `${robotsTxt}Sitemap: ${siteUrl}/sitemap.xml\n` : robotsTxt;
}

/**
 * The pages a crawler should know. Coming soon: the landing page and the legal pages (every
 * other path shows the same landing). Live: the website pages, plus every public path and
 * exam detail page.
 */
export function sitePaths({ mode, pricing, catalog, paths = [], exams = [] }) {
  const legal = ['/legal/terms', '/legal/privacy'];
  if (mode === 'coming-soon') return ['/', ...legal];
  return [
    '/',
    ...(catalog ? ['/catalog'] : []),
    ...(pricing ? ['/pricing'] : []),
    '/about',
    '/faq',
    '/contact',
    ...legal,
    ...(catalog ? [...paths.map((id) => `/catalog/paths/${id}`), ...exams.map((id) => `/catalog/exams/${id}`)] : []),
  ];
}

const xmlEsc = (s) => s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[c]);

/** sitemap.xml for absolute page URLs under the site's origin. */
export function sitemapXml(siteUrl, paths, lastmod) {
  const urls = paths.map((p) => `  <url><loc>${xmlEsc(siteUrl + p)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
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
const LOADER = '<script defer src="/site-boot.js"></script>';

/** The entry module of index.html (for siteBootJs) and the page with that tag (and its modulepreloads) swapped for the loader. */
export function deferEntry(html) {
  const m = html.match(ENTRY);
  if (!m) throw new Error('index.html has no entry module script');
  return { entry: m[1], html: html.replace(ENTRY, LOADER).replace(/\s*<link rel="modulepreload"[^>]*>/g, '') };
}
