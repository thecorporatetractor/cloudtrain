/*
 * The website and the app on separate origins (docs/deploy-website.md, "Website and app
 * on separate origins").
 *
 * One bundle serves both: the public website (landing page, catalog, pricing, about,
 * legal, ...) and the platform app (labs, exams, admin). In production the website is
 * the apex (`https://cloudtrain.com`) and the app a subdomain (`https://app.cloudtrain.com`);
 * locally `task dev:site` (:6969) and `task dev:web` (:5173). Each origin is a "surface":
 *
 * - `site`: website pages only. Every other path (sign-in, labs, admin, unknown paths)
 *   is sent to the app origin. Nobody is signed in on the site: it never asks `/api/me`,
 *   so "Sign in" always leads to the app, whose sign-in page forwards a signed-in
 *   visitor straight to the dashboard.
 * - `app`: everything except the website pages, which are sent to the site origin.
 * - `combined`: both on one origin, as before the split (mock mode, screenshots, a
 *   deployment that sets neither origin).
 *
 * The hybrid paths `/` and `/catalog` belong to both: on the site they are the landing
 * page and the public catalog, on the app the learner's Home and the full catalog, which
 * need a session like every other app page (a visitor is sent to sign-in, not to the
 * landing page). On one combined origin they stay hybrid: the website for visitors, the
 * app once signed in.
 *
 * The origins come from runtime-config.js (`siteUrl`, `appUrl`, `surface`), falling back
 * to the build-time VITE_SITE_URL / VITE_APP_URL / VITE_SURFACE. No host is hard-coded.
 */
import { runtimeConfig, type RuntimeConfig } from './runtimeConfig';
import { STATIC_SITE } from './siteMode';

export type Surface = 'site' | 'app' | 'combined';

export interface SurfaceConfig {
  surface: Surface;
  /** Website origin, '' = unknown (no links or redirects to it). */
  siteUrl: string;
  /** App origin, '' = unknown (no links or redirects to it). */
  appUrl: string;
}

/** Routes that render without a session and without any chrome (the sign-in card). */
export const PUBLIC_PATHS = ['/sign-in'];
/** The public website: rendered in the site layout (header, footer). */
export const SITE_PATHS = ['/catalog/paths', '/catalog/exams', '/pricing', '/about', '/faq', '/contact', '/legal'];
/** The website for visitors and the app for signed-in users on a combined origin (see above). */
export const HYBRID_PATHS = ['/', '/catalog'];

const under = (pathname: string, prefixes: string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
export const isSiteOnlyPath = (pathname: string) => under(pathname, SITE_PATHS);
export const isHybridRoute = (pathname: string) => HYBRID_PATHS.includes(pathname);

/** Which surface this page is, from the configuration and the page's own origin. */
export function resolveSurface(cfg: Pick<RuntimeConfig, 'siteUrl' | 'appUrl' | 'surface'>, pageOrigin: string, staticSite = false): SurfaceConfig {
  const { siteUrl, appUrl } = cfg;
  let surface: Surface = 'combined';
  // The static website build (build-site.mjs) has no app in it.
  if (staticSite) surface = 'site';
  else if (cfg.surface) surface = cfg.surface;
  else if (siteUrl && appUrl && siteUrl !== appUrl) surface = pageOrigin === siteUrl ? 'site' : pageOrigin === appUrl ? 'app' : 'combined';
  return { surface, siteUrl, appUrl };
}

/** Which surface a path belongs to: `both` for the hybrid paths. */
export function ownerOf(pathname: string): 'site' | 'app' | 'both' {
  if (isHybridRoute(pathname)) return 'both';
  return isSiteOnlyPath(pathname) ? 'site' : 'app';
}

/** The other origin, when this surface hands `pathname` over to it ('' = stays here). */
function otherOrigin(cfg: SurfaceConfig, pathname: string): string {
  const owner = ownerOf(pathname);
  if (cfg.surface === 'site' && owner === 'app' && cfg.appUrl) return cfg.appUrl;
  if (cfg.surface === 'app' && owner === 'site' && cfg.siteUrl) return cfg.siteUrl;
  return '';
}

/**
 * Where a page load or navigation to `pathname` must go instead, as an absolute URL, or
 * null when this origin serves it. `search` and `hash` are kept (with or without their
 * leading `?` / `#`).
 */
export function surfaceRedirect(cfg: SurfaceConfig, pathname: string, search = '', hash = ''): string | null {
  const origin = otherOrigin(cfg, pathname);
  if (!origin) return null;
  const q = search && !search.startsWith('?') ? `?${search}` : search;
  const h = hash && !hash.startsWith('#') ? `#${hash}` : hash;
  return `${origin}${pathname}${q === '?' ? '' : q}${h === '#' ? '' : h}`;
}

/** An internal link (`/pricing?x#y`) as an absolute URL on the other origin when it belongs there, else unchanged. */
export function hrefFor(cfg: SurfaceConfig, to: string): string {
  if (!to.startsWith('/') || to.startsWith('//')) return to;
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(to);
  const pathname = m?.[1] || '/';
  return surfaceRedirect(cfg, pathname, m?.[2] ?? '', m?.[3] ?? '') ?? to;
}

/** A safe in-app `returnTo` (a path on this origin), or undefined. */
const safeReturn = (p: string | undefined) => (p && p.startsWith('/') && !p.startsWith('//') ? p : undefined);

/**
 * The app's sign-in URL from this surface. On the site, website pages are not a useful
 * place to return to after signing in (the app would only send the visitor back), so
 * `returnTo` is kept only for app paths (`/labs/x`, `/account/billing?plan=...`).
 */
export function signInHref(cfg: SurfaceConfig, returnTo?: string): string {
  let back = safeReturn(returnTo);
  if (back && cfg.surface === 'site' && ownerOf(back.split(/[?#]/)[0] ?? '/') !== 'app') back = undefined;
  const path = `/sign-in${back ? `?returnTo=${encodeURIComponent(back)}` : ''}`;
  return cfg.surface === 'site' && cfg.appUrl ? `${cfg.appUrl}${path}` : path;
}

/** The website's home from this surface (the app's logo and "Back to the website"). */
export const siteHomeHref = (cfg: SurfaceConfig): string => (cfg.surface === 'app' && cfg.siteUrl ? `${cfg.siteUrl}/` : '/');

/** This page's surface. */
export const surfaceConfig: SurfaceConfig = resolveSurface(runtimeConfig, typeof window === 'undefined' ? '' : window.location.origin, STATIC_SITE);
export const SURFACE: Surface = surfaceConfig.surface;
/** True when the website and the app are split and this origin is the app. */
export const ON_APP = SURFACE === 'app';
/** True on the website origin (including the static website build): no session here. */
export const ON_SITE = SURFACE === 'site';
