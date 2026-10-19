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
    '',
  ].join('\n');
}

/** Cloudflare Pages and Netlify `_redirects`: every unknown path gets the single-page app. */
export const redirectsFile = '/*  /index.html  200\n';

/** Azure Static Web Apps `staticwebapp.config.json`. */
export function staticWebAppConfig(apiBase) {
  return (
    JSON.stringify(
      {
        navigationFallback: { rewrite: '/index.html', exclude: ['/assets/*', '/data/*', '/brand/*', '/site/*', '/*.{js,css,json,webmanifest,svg,png,webp,ico,txt}'] },
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
