import { describe, expect, it } from 'vitest';
import { csp, deferEntry, headersFile, injectRoot, siteBootJs, originOf, redirectsFile, rewriteHead, robotsFor, runtimeConfigJs, sitemapXml, sitePaths, staticWebAppConfig } from './site-hosting.mjs';

describe('static site host files', () => {
  it('originOf accepts an origin, normalises it and refuses paths and other schemes', () => {
    expect(originOf('', 'x')).toBe('');
    expect(originOf(undefined, 'x')).toBe('');
    expect(originOf(' https://api.example.com/ ', 'x')).toBe('https://api.example.com');
    expect(originOf('http://127.0.0.1:8787', 'x')).toBe('http://127.0.0.1:8787');
    for (const bad of ['api.example.com', 'ftp://x.io', 'https://x.io/api', 'https://x.io?a=1', 'javascript:alert(1)']) expect(() => originOf(bad, 'api base'), bad).toThrow(/api base/);
  });

  it('runtime-config.js is valid script that sets the config the app reads', () => {
    const js = runtimeConfigJs('https://api.example.com');
    const win = {};
    new Function('window', js)(win);
    expect(win.__CLOUDTRAIN_CONFIG__).toEqual({ apiBase: 'https://api.example.com', environment: 'website', appUrl: '', surface: 'site' });
    const withApp = {};
    new Function('window', runtimeConfigJs('https://app.example.com', 'website', 'https://app.example.com'))(withApp);
    expect(withApp.__CLOUDTRAIN_CONFIG__).toMatchObject({ appUrl: 'https://app.example.com', surface: 'site' });
    const same = {};
    new Function('window', runtimeConfigJs(''))(same);
    expect(same.__CLOUDTRAIN_CONFIG__.apiBase).toBe('');
  });

  it('the CSP allows the API origin for the waitlist and nothing inline for scripts', () => {
    expect(csp('https://api.example.com')).toContain("connect-src 'self' https://api.example.com;");
    expect(csp('')).toContain("connect-src 'self';");
    expect(csp('')).toContain("script-src 'self';");
    expect(csp('')).not.toContain('unsafe-eval');
  });

  it('headers, redirects and the Azure config cover the single-page fallback and caching', () => {
    expect(headersFile('')).toMatch(/\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
    expect(headersFile('')).toContain('Content-Security-Policy:');
    expect(redirectsFile).toBe('/*  /shell.html  200\n');
    const azure = JSON.parse(staticWebAppConfig('https://api.example.com'));
    expect(azure.navigationFallback.rewrite).toBe('/shell.html');
    expect(azure.globalHeaders['Content-Security-Policy']).toContain('https://api.example.com');
  });

  it('robots.txt names the sitemap only when the origin is known', () => {
    expect(robotsFor('')).toBe('User-agent: *\nAllow: /\n');
    expect(robotsFor('https://www.example.com')).toContain('Sitemap: https://www.example.com/sitemap.xml');
  });

  it('the sitemap lists the landing and legal pages when coming soon, every website page when live', () => {
    expect(sitePaths({ mode: 'coming-soon', pricing: true, catalog: true, paths: ['p'] })).toEqual(['/', '/legal/terms', '/legal/privacy']);
    const live = sitePaths({ mode: 'live', pricing: false, catalog: true, paths: ['cks'], exams: ['sim'] });
    expect(live).toContain('/catalog/paths/cks');
    expect(live).toContain('/catalog/exams/sim');
    expect(live).not.toContain('/pricing');
    const xml = sitemapXml('https://www.example.com', ['/', '/a&b'], '2026-10-21');
    expect(xml).toContain('<loc>https://www.example.com/</loc><lastmod>2026-10-21</lastmod>');
    expect(xml).toContain('https://www.example.com/a&amp;b');
  });

  it('rewrites the head with absolute social URLs and a canonical link', () => {
    const html = '<head>\n<title>X</title>\n<meta name="description" content="old" />\n<meta property="og:image" content="/brand/og.png" />\n</head>';
    const out = rewriteHead(html, { title: 'A "B"', description: 'New', image: '/site/og-image.png', siteUrl: 'https://www.example.com' });
    expect(out).toContain('<title>A &quot;B&quot;</title>');
    expect(out).toContain('<meta name="description" content="New" />');
    expect(out).toContain('<meta property="og:image" content="https://www.example.com/site/og-image.png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://www.example.com/site/og-image.png" />');
    expect(out).toContain('<meta property="og:url" content="https://www.example.com/" />');
    expect(out).toContain('<link rel="canonical" href="https://www.example.com/" />');
    expect(out.match(/og:image/g)).toHaveLength(1);
    const relative = rewriteHead(html, { title: 'T', image: '/site/og-image.png', siteUrl: '' });
    expect(relative).toContain('content="/site/og-image.png"');
    expect(relative).not.toContain('canonical');
  });

  it('injects prerendered markup into the root element in place of the boot splash', () => {
    const html = '<html><head></head><body>\n<div id="root">\n<div class="boot"><svg></svg></div>\n</div>\n</body></html>';
    expect(injectRoot(html, '<main>Hi</main>')).toBe('<html><head></head><body>\n<div id="root" data-prerendered><main>Hi</main></div>\n</body></html>');
    expect(() => injectRoot('<body></body>', 'x')).toThrow(/root/);
  });

  it('defers the entry module of a prerendered page to a loader that runs after the first paint', () => {
    const html = '<head>\n<script type="module" crossorigin src="/assets/index-A.js"></script>\n    <link rel="modulepreload" crossorigin href="/assets/react-B.js">\n</head>';
    expect(deferEntry(html)).toEqual({ entry: '/assets/index-A.js', html: '<head>\n<script defer src="/site-boot.js"></script>\n</head>' });
    expect(() => deferEntry('<head></head>')).toThrow(/entry module/);
    expect(siteBootJs('/assets/index-A.js')).toContain('"/assets/index-A.js"');
    expect(() => new Function(siteBootJs('/assets/index-A.js'))).not.toThrow();
    expect(() => siteBootJs('https://evil.example/x.js')).toThrow(/entry module/);
  });
});
