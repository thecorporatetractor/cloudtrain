import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file (src/ or dist/ under services/gateway). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Sentinel for CT_KUBE_CONTEXT: use the pod's ServiceAccount instead of a kubeconfig context. */
export const IN_CLUSTER = 'in-cluster';

/** Fastify `trustProxy`: true (any peer) or a comma-separated list of proxy addresses/CIDRs. */
export type TrustProxy = boolean | string;

export interface Config {
  host: string;
  port: number;
  /**
   * Proxies whose X-Forwarded-* headers are trusted (CT_TRUST_PROXY): `true` or the
   * addresses/CIDRs of the Ingress/Gateway pods (e.g. the pod CIDR). Default loopback
   * (the Vite dev proxy).
   */
  trustProxy: TrustProxy;
  /** Web origins allowed to call /api cross-origin with cookies (CT_CORS_ORIGINS, comma-separated); empty = off. */
  corsOrigins: string[];
  /** Directory holding skills.yaml, frameworks/ and packs/. */
  contentDir: string;
  /** Extra lab directories (each containing <lab>/lab.yaml) served alongside the packs, e.g. test fixtures. */
  extraLabDirs: string[];
  /**
   * kubeconfig context to use. Only the in-memory KubeConfig is switched; the file is
   * never written. `in-cluster` (IN_CLUSTER) uses the pod's ServiceAccount token; it is
   * the default when the gateway runs in a pod (KUBERNETES_SERVICE_HOST set) and
   * CT_KUBE_CONTEXT is unset.
   */
  kubeContext: string;
  /** Namespace for LabTemplates and LabSessions. */
  namespace: string;
  /** Path to the Go `labctl` binary (one compiler for lab.yaml -> LabTemplate). */
  labctl: string;
  /** How long POST /validate waits for status.validation to answer the request. */
  validateTimeoutMs: number;
  /** Optional session TTL override in minutes (default: the controller's 2 x estimatedMinutes, min 30). */
  sessionTtlMinutes?: number;
  logLevel: string;
  /** Postgres as the RLS-bound app role (cloudtrain_app). */
  databaseUrl: string;
  /** Postgres as the schema owner (migrations, seed). */
  databaseOwnerUrl?: string;
  databaseAppRole: string;
  /** Where the browser reaches the gateway's /api (OIDC redirect URI base). */
  publicUrl: string;
  /** Where the web app lives (post-login and post-logout redirects). */
  webUrl: string;
  oidc: { issuer: string; clientId: string; clientSecret: string };
  keycloak: { baseUrl: string; realm: string; adminClientId: string; adminClientSecret: string };
  /** Seals refresh tokens at rest; at least 16 characters. */
  sessionSecret: string;
  sessionMaxAgeSeconds: number;
  sessionIdleSeconds: number;
  /** `Secure` cookie attribute; off only when publicUrl is plain http (local dev). */
  cookieSecure: boolean;
  smtp: { host: string; port: number; from: string };
  /** IdP aliases trusted to grant platform_admin through the CloudTrain.PlatformAdmin app role. */
  platformIdps: string[];
  /** Dev only: accept domain verification without the DNS TXT record. */
  devDomainVerifyBypass: boolean;
  /** How often open lab attempts are reconciled with the cluster (ms, 0 = off). */
  sweepIntervalMs: number;
  /** content/curriculum.yaml (exam simulations). */
  curriculumFile: string;
  /** Extra files with an `exams` list served alongside the curriculum (e.g. the orchestrator's test exam). */
  extraExamFiles: string[];
  /** Labels put on every ExamSession, e.g. a scoped orchestrator's session selector ("k=v,k2=v2"). */
  examSessionLabels: Record<string, string>;
  /** Dev/demo override of every exam's duration. */
  examDurationMinutes?: number;
  /** CTF answers one learner may submit per minute (CT_ANSWER_RATE_PER_MINUTE, default 10). */
  answerRatePerMinute: number;
  /** Public website configuration (CT_SITE_CONFIG, default <CT_CONTENT_DIR>/site.yaml; a deployment mounts its own). */
  siteConfigFile: string;
  /** Requests per minute one client address may make to `/api/public/*` (CT_PUBLIC_RATE_PER_MINUTE, default 120). */
  publicRatePerMinute: number;
  /**
   * DEV ONLY: `POST /api/dev/sign-in-as` (CT_DEV_IMPERSONATE=1). loadConfig refuses
   * to return a config with it on in production or on a non-loopback URL.
   */
  devImpersonate: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True for http(s)://localhost, 127.0.0.1 or [::1] (any port). */
export function isLoopbackUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * CT_DEV_IMPERSONATE: '1' turns dev sign-in-as on, unset/''/'0' leaves it off,
 * anything else is an error (never silently ignored). With it on, the gateway
 * refuses to start when NODE_ENV=production or when CT_PUBLIC_URL / CT_WEB_URL
 * is not a localhost / 127.0.0.1 URL.
 */
export function devImpersonationEnabled(env: NodeJS.ProcessEnv, publicUrl: string, webUrl: string): boolean {
  const v = env.CT_DEV_IMPERSONATE;
  if (v === undefined || v === '' || v === '0') return false;
  if (v !== '1') throw new Error(`CT_DEV_IMPERSONATE must be 1 or 0 (got ${JSON.stringify(v)}); refusing to start`);
  if (env.NODE_ENV === 'production') throw new Error('CT_DEV_IMPERSONATE=1 is set with NODE_ENV=production: dev sign-in-as is for local development only; refusing to start');
  for (const [k, u] of [
    ['CT_PUBLIC_URL', publicUrl],
    ['CT_WEB_URL', webUrl],
  ] as const) {
    if (!isLoopbackUrl(u)) throw new Error(`CT_DEV_IMPERSONATE=1 needs ${k} on localhost or 127.0.0.1 (got ${u}); refusing to start`);
  }
  return true;
}

/**
 * CT_TRUST_PROXY: unset = loopback only, `true`/`false`, or a comma-separated list of
 * addresses/CIDRs. Hop counts are refused: Fastify ignores X-Forwarded-* with them
 * (it cannot validate the immediate peer).
 */
export function trustProxyFrom(v: string | undefined): TrustProxy {
  const t = (v ?? '').trim();
  if (t === '') return '127.0.0.1';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^\d+$/.test(t)) throw new Error(`CT_TRUST_PROXY=${t}: hop counts are not supported; list the proxies' addresses or CIDRs (e.g. 10.0.0.0/8)`);
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

function labels(v: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (v ?? '').split(',')) {
    const [k, val] = kv.split('=');
    if (k?.trim() && val !== undefined) out[k.trim()] = val.trim();
  }
  return out;
}

/** CT_CORS_ORIGINS: comma-separated http(s) origins; anything else (paths, wildcards) is an error. */
export function corsOriginsFrom(v: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error(`CT_CORS_ORIGINS: ${JSON.stringify(raw)} is not an origin (e.g. https://labs.example.com)`);
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== raw.replace(/\/$/, '')) throw new Error(`CT_CORS_ORIGINS: ${JSON.stringify(raw)} is not an origin (scheme://host[:port], no path)`);
    out.push(u.origin);
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Relative paths in settings are relative to CT_BASE_DIR, else the repository root
  // (pnpm runs the gateway from its package dir). The container image sets absolute paths.
  const base = env.CT_BASE_DIR ? path.resolve(env.CT_BASE_DIR) : repoRoot;
  const fromRoot = (p: string) => path.resolve(base, p);
  const contentDir = fromRoot(env.CT_CONTENT_DIR ?? 'content');
  const list = (v: string | undefined) => (v ?? '').split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  const ttl = num(env.CT_SESSION_TTL_MINUTES, 0);
  const prod = env.NODE_ENV === 'production';
  const publicUrl = (env.CT_PUBLIC_URL ?? `http://localhost:${num(env.CT_PORT, 8787)}`).replace(/\/$/, '');
  const kcBase = (env.CT_KEYCLOAK_URL ?? 'http://localhost:8180').replace(/\/$/, '');
  const realm = env.CT_KEYCLOAK_REALM ?? 'cloudtrain';
  const webUrl = (env.CT_WEB_URL ?? publicUrl).replace(/\/$/, '');
  const devImpersonate = devImpersonationEnabled(env, publicUrl, webUrl);
  return {
    host: env.CT_HOST ?? '127.0.0.1',
    port: num(env.CT_PORT, 8787),
    trustProxy: trustProxyFrom(env.CT_TRUST_PROXY),
    corsOrigins: corsOriginsFrom(env.CT_CORS_ORIGINS),
    contentDir,
    extraLabDirs: list(env.CT_EXTRA_LAB_DIRS).map(fromRoot),
    kubeContext: env.CT_KUBE_CONTEXT || (env.KUBERNETES_SERVICE_HOST ? IN_CLUSTER : 'kind-cloudtrain-dev'),
    namespace: env.CT_NAMESPACE ?? 'cloudtrain-sessions',
    labctl: fromRoot(env.CT_LABCTL ?? 'services/lab-orchestrator/bin/labctl'),
    validateTimeoutMs: num(env.CT_VALIDATE_TIMEOUT_MS, 60_000),
    answerRatePerMinute: Math.max(1, num(env.CT_ANSWER_RATE_PER_MINUTE, 10)),
    siteConfigFile: env.CT_SITE_CONFIG ? fromRoot(env.CT_SITE_CONFIG) : path.join(contentDir, 'site.yaml'),
    publicRatePerMinute: Math.max(1, num(env.CT_PUBLIC_RATE_PER_MINUTE, 120)),
    ...(ttl > 0 ? { sessionTtlMinutes: ttl } : {}),
    logLevel: env.CT_LOG_LEVEL ?? 'info',
    databaseUrl: env.CT_DATABASE_URL ?? 'postgres://cloudtrain_app:app-dev-only@127.0.0.1:55432/cloudtrain',
    ...(env.CT_DATABASE_OWNER_URL || env.NODE_ENV !== 'production' ? { databaseOwnerUrl: env.CT_DATABASE_OWNER_URL ?? 'postgres://cloudtrain_owner:owner-dev-only@127.0.0.1:55432/cloudtrain' } : {}),
    databaseAppRole: env.CT_DATABASE_APP_ROLE ?? 'cloudtrain_app',
    publicUrl,
    webUrl,
    oidc: {
      issuer: env.CT_OIDC_ISSUER ?? `${kcBase}/realms/${realm}`,
      clientId: env.CT_OIDC_CLIENT_ID ?? 'cloudtrain-gateway',
      clientSecret: env.CT_OIDC_CLIENT_SECRET ?? (prod ? '' : 'gateway-dev-only-secret'),
    },
    keycloak: {
      baseUrl: kcBase,
      realm,
      adminClientId: env.CT_KEYCLOAK_ADMIN_CLIENT_ID ?? 'cloudtrain-gateway-admin',
      adminClientSecret: env.CT_KEYCLOAK_ADMIN_CLIENT_SECRET ?? (prod ? '' : 'gateway-admin-dev-only-secret'),
    },
    sessionSecret: env.CT_SESSION_SECRET ?? (prod ? '' : 'dev-only-session-secret-not-for-production'),
    sessionMaxAgeSeconds: num(env.CT_SESSION_MAX_AGE_SECONDS, 12 * 3600),
    sessionIdleSeconds: num(env.CT_SESSION_IDLE_SECONDS, 2 * 3600),
    cookieSecure: env.CT_COOKIE_SECURE ? env.CT_COOKIE_SECURE === 'true' : !publicUrl.startsWith('http://'),
    smtp: { host: env.CT_SMTP_HOST ?? '127.0.0.1', port: num(env.CT_SMTP_PORT, 1025), from: env.CT_SMTP_FROM ?? 'CloudTrain <no-reply@cloudtrain.local>' },
    platformIdps: (env.CT_PLATFORM_IDPS ?? 'azarguard-entra').split(',').map((s) => s.trim()).filter(Boolean),
    devDomainVerifyBypass: !prod && env.CT_DEV_DOMAIN_VERIFY_BYPASS === '1',
    sweepIntervalMs: num(env.CT_SWEEP_INTERVAL_MS, 60_000),
    curriculumFile: env.CT_CURRICULUM_FILE ? fromRoot(env.CT_CURRICULUM_FILE) : path.join(contentDir, 'curriculum.yaml'),
    extraExamFiles: list(env.CT_EXTRA_EXAM_FILES).map(fromRoot),
    examSessionLabels: labels(env.CT_EXAM_SESSION_LABELS),
    ...(num(env.CT_EXAM_DURATION_MINUTES, 0) > 0 ? { examDurationMinutes: num(env.CT_EXAM_DURATION_MINUTES, 0) } : {}),
    devImpersonate,
  };
}
