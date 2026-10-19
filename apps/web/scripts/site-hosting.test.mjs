import { describe, expect, it } from 'vitest';
import { csp, headersFile, originOf, redirectsFile, runtimeConfigJs, staticWebAppConfig } from './site-hosting.mjs';

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
    expect(win.__CLOUDTRAIN_CONFIG__).toEqual({ apiBase: 'https://api.example.com', environment: 'website' });
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
    expect(redirectsFile).toBe('/*  /index.html  200\n');
    const azure = JSON.parse(staticWebAppConfig('https://api.example.com'));
    expect(azure.navigationFallback.rewrite).toBe('/index.html');
    expect(azure.globalHeaders['Content-Security-Policy']).toContain('https://api.example.com');
  });
});
