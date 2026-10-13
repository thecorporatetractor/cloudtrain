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
}

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
    contentDir: path.resolve(env.CT_CONTENT_DIR ?? path.join(repoRoot, 'content')),
    extraLabDirs: list(env.CT_EXTRA_LAB_DIRS).map((p) => path.resolve(p)),
    kubeContext: env.CT_KUBE_CONTEXT ?? 'kind-cloudtrain-dev',
    namespace: env.CT_NAMESPACE ?? 'cloudtrain-sessions',
    labctl: path.resolve(env.CT_LABCTL ?? path.join(repoRoot, 'services/lab-orchestrator/bin/labctl')),
    validateTimeoutMs: num(env.CT_VALIDATE_TIMEOUT_MS, 60_000),
    ...(ttl > 0 ? { sessionTtlMinutes: ttl } : {}),
    logLevel: env.CT_LOG_LEVEL ?? 'info',
  };
}
