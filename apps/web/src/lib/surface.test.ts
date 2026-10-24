import { describe, expect, it } from 'vitest';
import { hrefFor, ownerOf, resolveSurface, signInHref, siteHomeHref, surfaceRedirect, type SurfaceConfig } from './surface';

const SITE = 'https://cloudtrain.com';
const APP = 'https://app.cloudtrain.com';
const origins = { siteUrl: SITE, appUrl: APP, surface: '' as const };
const site: SurfaceConfig = { surface: 'site', siteUrl: SITE, appUrl: APP };
const app: SurfaceConfig = { surface: 'app', siteUrl: SITE, appUrl: APP };
const combined: SurfaceConfig = { surface: 'combined', siteUrl: '', appUrl: '' };

describe('resolveSurface', () => {
  it('infers the surface from the page origin when both origins are configured', () => {
    expect(resolveSurface(origins, SITE).surface).toBe('site');
    expect(resolveSurface(origins, APP).surface).toBe('app');
    // Neither (a preview host, an IP): everything stays on this origin.
    expect(resolveSurface(origins, 'http://10.0.0.5:8080').surface).toBe('combined');
  });

  it('is combined without two distinct origins', () => {
    expect(resolveSurface({ siteUrl: '', appUrl: '', surface: '' }, SITE).surface).toBe('combined');
    expect(resolveSurface({ siteUrl: SITE, appUrl: '', surface: '' }, SITE).surface).toBe('combined');
    expect(resolveSurface({ siteUrl: SITE, appUrl: SITE, surface: '' }, SITE).surface).toBe('combined');
  });

  it('takes an explicit surface over the origin, and the static build is always the site', () => {
    expect(resolveSurface({ ...origins, surface: 'site' }, 'http://localhost:6969').surface).toBe('site');
    expect(resolveSurface({ ...origins, surface: 'app' }, SITE).surface).toBe('app');
    expect(resolveSurface({ siteUrl: '', appUrl: '', surface: 'app' }, APP, true)).toEqual({ surface: 'site', siteUrl: '', appUrl: '' });
  });
});

describe('ownerOf', () => {
  it('splits the routes between the website and the app', () => {
    for (const p of ['/pricing', '/about', '/faq', '/contact', '/legal/terms', '/legal/privacy', '/catalog/paths/cka', '/catalog/exams/cks-sim']) expect(ownerOf(p), p).toBe('site');
    for (const p of ['/', '/catalog']) expect(ownerOf(p), p).toBe('both');
    for (const p of ['/sign-in', '/labs/x', '/labs/x/work', '/exams', '/account/billing', '/admin/billing', '/platform', '/nope', '/pricingx', '/catalogue']) expect(ownerOf(p), p).toBe('app');
  });
});

describe('surfaceRedirect', () => {
  it('sends website pages from the app to the site, keeping search and hash', () => {
    expect(surfaceRedirect(app, '/pricing', '?interval=yearly', 'plans')).toBe(`${SITE}/pricing?interval=yearly#plans`);
    expect(surfaceRedirect(app, '/legal/terms')).toBe(`${SITE}/legal/terms`);
    expect(surfaceRedirect(app, '/catalog/paths/cka', '', '#x')).toBe(`${SITE}/catalog/paths/cka#x`);
  });

  it('keeps app pages and the hybrid paths on the app', () => {
    for (const p of ['/', '/catalog', '/sign-in', '/labs/x', '/admin/billing']) expect(surfaceRedirect(app, p), p).toBeNull();
  });

  it('sends app pages (and unknown paths) from the site to the app', () => {
    expect(surfaceRedirect(site, '/sign-in', 'returnTo=%2Flabs%2Fx')).toBe(`${APP}/sign-in?returnTo=%2Flabs%2Fx`);
    expect(surfaceRedirect(site, '/labs/x/work', '?s=1')).toBe(`${APP}/labs/x/work?s=1`);
    expect(surfaceRedirect(site, '/account/billing', '?plan=pro&interval=monthly')).toBe(`${APP}/account/billing?plan=pro&interval=monthly`);
    expect(surfaceRedirect(site, '/no-such-page')).toBe(`${APP}/no-such-page`);
  });

  it('keeps website pages and the hybrid paths on the site', () => {
    for (const p of ['/', '/catalog', '/pricing', '/about', '/legal/privacy', '/catalog/exams/e1']) expect(surfaceRedirect(site, p), p).toBeNull();
  });

  it('never redirects on a combined origin or without the other origin', () => {
    for (const p of ['/', '/pricing', '/labs/x', '/sign-in']) expect(surfaceRedirect(combined, p), p).toBeNull();
    // The static website without an app (build-site.mjs without --app-url): /sign-in explains itself.
    expect(surfaceRedirect({ surface: 'site', siteUrl: '', appUrl: '' }, '/sign-in')).toBeNull();
    expect(surfaceRedirect({ surface: 'app', siteUrl: '', appUrl: APP }, '/pricing')).toBeNull();
  });

  it('drops an empty search or hash', () => {
    expect(surfaceRedirect(app, '/faq', '?', '#')).toBe(`${SITE}/faq`);
  });
});

describe('cross-links', () => {
  it('hrefFor turns links into the other origin into absolute URLs', () => {
    expect(hrefFor(site, '/sign-in')).toBe(`${APP}/sign-in`);
    expect(hrefFor(site, '/#how-it-works')).toBe('/#how-it-works');
    expect(hrefFor(site, '/catalog#paths')).toBe('/catalog#paths');
    expect(hrefFor(app, '/legal/privacy')).toBe(`${SITE}/legal/privacy`);
    expect(hrefFor(app, '/contact?topic=billing#form')).toBe(`${SITE}/contact?topic=billing#form`);
    expect(hrefFor(app, '/labs/x')).toBe('/labs/x');
    expect(hrefFor(app, 'https://github.com/x')).toBe('https://github.com/x');
    expect(hrefFor(combined, '/sign-in')).toBe('/sign-in');
  });

  it('signInHref leads to the app, returning only to app pages', () => {
    expect(signInHref(site)).toBe(`${APP}/sign-in`);
    expect(signInHref(site, '/labs/k8s-1')).toBe(`${APP}/sign-in?returnTo=%2Flabs%2Fk8s-1`);
    expect(signInHref(site, '/account/billing?plan=pro&interval=yearly')).toBe(`${APP}/sign-in?returnTo=%2Faccount%2Fbilling%3Fplan%3Dpro%26interval%3Dyearly`);
    // Website pages and the hybrid paths are not worth returning to from the app.
    expect(signInHref(site, '/pricing')).toBe(`${APP}/sign-in`);
    expect(signInHref(site, '/catalog')).toBe(`${APP}/sign-in`);
    expect(signInHref(site, '//evil.example.com')).toBe(`${APP}/sign-in`);
    // One origin: the in-app sign-in page, returning anywhere.
    expect(signInHref(combined, '/pricing')).toBe('/sign-in?returnTo=%2Fpricing');
    expect(signInHref(combined)).toBe('/sign-in');
  });

  it('siteHomeHref leads from the app to the website', () => {
    expect(siteHomeHref(app)).toBe(`${SITE}/`);
    expect(siteHomeHref(site)).toBe('/');
    expect(siteHomeHref(combined)).toBe('/');
  });
});
