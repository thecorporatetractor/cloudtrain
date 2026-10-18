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
}

declare global {
  interface Window {
    __CLOUDTRAIN_CONFIG__?: Partial<RuntimeConfig>;
  }
}

/** Validates the raw object: apiBase must be empty or an http(s) origin without a path. */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof RuntimeConfig, unknown>>) : {};
  let apiBase = typeof r.apiBase === 'string' ? r.apiBase.trim() : '';
  if (apiBase) {
    try {
      const u = new URL(apiBase);
      apiBase = u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
    } catch {
      apiBase = '';
    }
  }
  return { apiBase, environment: typeof r.environment === 'string' ? r.environment : '' };
}

export const runtimeConfig: RuntimeConfig = parseRuntimeConfig(typeof window === 'undefined' ? undefined : window.__CLOUDTRAIN_CONFIG__);

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
