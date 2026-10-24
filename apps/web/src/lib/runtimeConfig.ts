/**
 * Per-environment settings read at page load, not at build time: one web image
 * serves every environment. The web server answers `/runtime-config.js` (loaded by
 * index.html before the app), which sets `window.__CLOUDTRAIN_CONFIG__`. In the
 * Helm chart it comes from a ConfigMap (values `web.runtimeConfig`); in dev it is
 * public/runtime-config.js (same-origin defaults).
 *
 * There are no OIDC settings here on purpose: the gateway is the OIDC client (BFF),
 * so the issuer, client and redirect URI live in the gateway's configuration.
 */
export interface RuntimeConfig {
  /**
   * Origin of the gateway's `/api` (e.g. `https://api.labs.example.com`); empty =
   * the page's own origin (the default: the Ingress routes `/api` to the gateway).
   * A different origin must be same-site (cookies are SameSite=Lax) and listed in
   * the gateway's CT_CORS_ORIGINS.
   */
  apiBase: string;
  /** Free-form environment label (e.g. `staging`), informational. */
  environment: string;
  /**
   * Origin of the public website (e.g. `https://cloudtrain.com`); empty = the website
   * and the app share one origin. See src/lib/surface.ts and docs/deploy-website.md.
   */
  siteUrl: string;
  /** Origin of the platform app (e.g. `https://app.cloudtrain.com`); empty = same origin as the website. */
  appUrl: string;
  /**
   * What this origin serves: `site`, `app`, or empty (inferred: the origin that matches
   * siteUrl or appUrl; neither = both on one origin, the default).
   */
  surface: '' | 'site' | 'app';
}

declare global {
  interface Window {
    __CLOUDTRAIN_CONFIG__?: Partial<RuntimeConfig>;
  }
}

/** An http(s) origin (any path dropped), or '' for anything else. */
export function originOf(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

/**
 * Validates the raw object: apiBase, siteUrl and appUrl must be empty or http(s) origins
 * (a path is dropped). An empty value falls back to `defaults` (the build-time VITE_*
 * values), so a deployment's runtime-config.js always wins over the build.
 */
export function parseRuntimeConfig(raw: unknown, defaults: Partial<Record<keyof RuntimeConfig, unknown>> = {}): RuntimeConfig {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof RuntimeConfig, unknown>>) : {};
  const origin = (k: 'apiBase' | 'siteUrl' | 'appUrl') => originOf(r[k]) || originOf(defaults[k]);
  const surf = (v: unknown) => (v === 'site' || v === 'app' ? v : '');
  return {
    apiBase: origin('apiBase'),
    environment: typeof r.environment === 'string' ? r.environment : '',
    siteUrl: origin('siteUrl'),
    appUrl: origin('appUrl'),
    surface: surf(r.surface) || surf(defaults.surface),
  };
}

/** Build-time defaults (Vite env): what `task dev:site` / `task dev:web` and build-site.mjs set. */
const buildDefaults = (): Partial<Record<keyof RuntimeConfig, unknown>> => {
  const env = (import.meta as { env?: Record<string, unknown> }).env ?? {};
  return { apiBase: env.VITE_API_BASE, siteUrl: env.VITE_SITE_URL, appUrl: env.VITE_APP_URL, surface: env.VITE_SURFACE };
};

export const runtimeConfig: RuntimeConfig = parseRuntimeConfig(typeof window === 'undefined' ? undefined : window.__CLOUDTRAIN_CONFIG__, buildDefaults());

/** Absolute or same-origin URL of a gateway path (`/api/...`); other URLs pass through. */
export function apiUrl(path: string, cfg: RuntimeConfig = runtimeConfig): string {
  return cfg.apiBase && path.startsWith('/api/') ? cfg.apiBase + path : path;
}

/** Origin the gateway is reached at, for display (e.g. OIDC redirect URIs). */
export function apiOrigin(pageOrigin: string, cfg: RuntimeConfig = runtimeConfig): string {
  return cfg.apiBase || pageOrigin;
}

/** WebSocket URL of a gateway path, on the API origin (ws/wss to match http/https). */
export function wsUrl(path: string, page: { protocol: string; host: string }, cfg: RuntimeConfig = runtimeConfig): string {
  if (cfg.apiBase) {
    const u = new URL(cfg.apiBase);
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}${path}`;
  }
  return `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}${path}`;
}

/** fetch credentials: cookies must be sent explicitly to a different (same-site) API origin. */
export function apiCredentials(cfg: RuntimeConfig = runtimeConfig): RequestCredentials {
  return cfg.apiBase ? 'include' : 'same-origin';
}
