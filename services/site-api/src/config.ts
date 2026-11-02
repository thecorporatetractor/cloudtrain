import { DefaultAzureCredential, ManagedIdentityCredential, type TokenCredential } from '@azure/identity';

/*
 * Every name and id comes from the app settings; none is in the code. docs/deploy-site-vm.md has
 * the full table. CT_GDPR_HMAC_KEY is the same secret as the gateway's: in Azure, a Key Vault
 * reference in the app settings.
 */

type Env = Record<string, string | undefined>;

export function required(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

function positive(env: Env, name: string, def: number): number {
  const raw = env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

/** Local development against Azurite. Never set in Azure. */
const local = (env: Env) => env.SITE_STORAGE_CONNECTION_STRING?.trim() || undefined;

export function storageTarget(env: Env, service: 'TABLE' | 'QUEUE' | 'BLOB', credential: () => TokenCredential) {
  const connectionString = local(env);
  if (connectionString) return { connectionString };
  return { endpoint: required(env, `SITE_${service}_ENDPOINT`), credential: credential() };
}

/** Explicit client id: an app can hold several identities, and the wrong one must not work by accident. */
export const managedIdentity = (env: Env): TokenCredential => new ManagedIdentityCredential({ clientId: required(env, 'AZURE_CLIENT_ID') });
/** The operator's CLI: the signed-in `az` user, with the worker's data roles granted for the job. */
export const operatorCredential = (): TokenCredential => new DefaultAzureCredential();

export const tableNames = (env: Env) => ({
  waitlist: env.SITE_WAITLIST_TABLE?.trim() || 'waitlist',
  intake: env.SITE_PRIVACY_REQUESTS_TABLE?.trim() || 'privacyrequests',
  state: env.SITE_PRIVACY_STATE_TABLE?.trim() || 'privacystate',
  ledger: env.CT_GDPR_LEDGER_TABLE?.trim() || 'gdprledger',
});

export const queueName = (env: Env): string => env.SITE_QUEUE_NAME?.trim() || 'privacy-requests';

export const publicSettings = (env: Env) => ({
  hmacKey: required(env, 'CT_GDPR_HMAC_KEY'),
  allowedPrincipalId: required(env, 'SITE_ALLOWED_PRINCIPAL_ID'),
  // Off: nobody can test whether an address is on the list. Only an explicit `true` turns it on.
  revealDuplicates: env.SITE_WAITLIST_REVEAL_DUPLICATES?.trim() === 'true',
  requestTtlMs: positive(env, 'SITE_REQUEST_TTL_HOURS', 24) * 3_600_000,
  writesPerSecond: positive(env, 'SITE_WRITES_PER_SECOND', 5),
  writeBurst: positive(env, 'SITE_WRITE_BURST', 5),
  logSample: positive(env, 'SITE_LOG_SAMPLE', 0.01),
});

export const workerSettings = (env: Env) => ({
  hmacKey: required(env, 'CT_GDPR_HMAC_KEY'),
  siteUrl: required(env, 'SITE_PUBLIC_URL'),
  requestTtlMs: positive(env, 'SITE_REQUEST_TTL_HOURS', 24) * 3_600_000,
  perSubjectPerHour: positive(env, 'SITE_MAIL_PER_SUBJECT_PER_HOUR', 3),
  dailyMailCap: positive(env, 'SITE_MAIL_DAILY_CAP', 500),
  acsEndpoint: env.SITE_ACS_ENDPOINT?.trim() || '',
  mailSender: env.SITE_MAIL_SENDER?.trim() || 'no-reply@notify.cloudtrain.app',
  mailReplyTo: env.SITE_MAIL_REPLY_TO?.trim() || 'hello@cloudtrain.app',
  backupContainer: env.SITE_BACKUP_CONTAINER?.trim() || 'waitlist-backup',
  ledgerCopyContainer: env.SITE_LEDGER_COPY_CONTAINER?.trim() || '',
});
