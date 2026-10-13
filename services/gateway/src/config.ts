import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file (src/ or dist/ under services/gateway). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  host: string;
  port: number;
  /** Directory holding skills.yaml, frameworks/ and packs/. */
  contentDir: string;
  /** Extra lab directories (each containing <lab>/lab.yaml) served alongside the packs, e.g. test fixtures. */
  extraLabDirs: string[];
  /** kubeconfig context to use. Only the in-memory KubeConfig is switched; the file is never written. */
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
}

/** Relative paths in settings are relative to the repository root (pnpm runs the gateway from its package dir). */
const fromRoot = (p: string) => path.resolve(repoRoot, p);

function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const list = (v: string | undefined) => (v ?? '').split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  const ttl = num(env.CT_SESSION_TTL_MINUTES, 0);
  return {
    host: env.CT_HOST ?? '127.0.0.1',
    port: num(env.CT_PORT, 8787),
    contentDir: fromRoot(env.CT_CONTENT_DIR ?? 'content'),
    extraLabDirs: list(env.CT_EXTRA_LAB_DIRS).map(fromRoot),
    kubeContext: env.CT_KUBE_CONTEXT ?? 'kind-cloudtrain-dev',
    namespace: env.CT_NAMESPACE ?? 'cloudtrain-sessions',
    labctl: fromRoot(env.CT_LABCTL ?? 'services/lab-orchestrator/bin/labctl'),
    validateTimeoutMs: num(env.CT_VALIDATE_TIMEOUT_MS, 60_000),
    ...(ttl > 0 ? { sessionTtlMinutes: ttl } : {}),
    logLevel: env.CT_LOG_LEVEL ?? 'info',
    databaseUrl: env.CT_DATABASE_URL ?? 'postgres://cloudtrain_app:app-dev-only@127.0.0.1:55432/cloudtrain',
    ...(env.CT_DATABASE_OWNER_URL || env.NODE_ENV !== 'production' ? { databaseOwnerUrl: env.CT_DATABASE_OWNER_URL ?? 'postgres://cloudtrain_owner:owner-dev-only@127.0.0.1:55432/cloudtrain' } : {}),
    databaseAppRole: env.CT_DATABASE_APP_ROLE ?? 'cloudtrain_app',
  };
}
