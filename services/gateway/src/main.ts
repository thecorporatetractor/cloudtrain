import { sql } from 'kysely';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loadContent } from './content/load.js';
import { createDb } from './db/index.js';
import { KubeClusterInfo } from './kube/capacity.js';
import { KubeLabCluster, kubeConfigFor } from './kube/client.js';
import { LabctlCompiler } from './kube/compile.js';
import { KeycloakAdmin } from './keycloak/admin.js';
import { SmtpMailer } from './mail.js';
import { OidcClient } from './oidc/client.js';
import { OidcAuthenticator, Sealer, SessionStore } from './oidc/sessions.js';
import { PlatformService } from './platform/service.js';
import { SessionService } from './sessions/service.js';
import { TerminalHub } from './terminal/hub.js';

async function main() {
  const config = loadConfig();
  for (const [k, v] of [
    ['CT_OIDC_CLIENT_SECRET', config.oidc.clientSecret],
    ['CT_SESSION_SECRET', config.sessionSecret],
  ] as const) {
    if (!v) throw new Error(`${k} must be set`);
  }
  const content = await loadContent(config.contentDir, config.extraLabDirs);
  const compiler = new LabctlCompiler(config.labctl);
  await compiler.check();
  const kc = kubeConfigFor(config.kubeContext);
  const cluster = new KubeLabCluster(kc, config.namespace);

  const db = createDb(config.databaseUrl);
  try {
    await sql`SELECT 1`.execute(db);
  } catch (e) {
    throw new Error(`Postgres not reachable at ${new URL(config.databaseUrl).host} (task dev:deps): ${(e as Error).message}`);
  }
  const oidc = new OidcClient({ issuer: config.oidc.issuer, clientId: config.oidc.clientId, clientSecret: config.oidc.clientSecret, redirectUri: `${config.publicUrl}/api/auth/callback` });
  const store = new SessionStore(db, new Sealer(config.sessionSecret), { maxAgeSeconds: config.sessionMaxAgeSeconds, idleSeconds: config.sessionIdleSeconds, secureCookie: config.cookieSecure });
  const kcAdmin = config.keycloak.adminClientSecret
    ? new KeycloakAdmin({ baseUrl: config.keycloak.baseUrl, realm: config.keycloak.realm, clientId: config.keycloak.adminClientId, clientSecret: config.keycloak.adminClientSecret })
    : null;

  const sessions = new SessionService(content, cluster, compiler, {
    validateTimeoutMs: config.validateTimeoutMs,
    ...(config.sessionTtlMinutes ? { sessionTtlMinutes: config.sessionTtlMinutes } : {}),
  });
  let log: PlatformService['log'];
  const platform = new PlatformService({
    db,
    content,
    cluster,
    mailer: new SmtpMailer(config.smtp.host, config.smtp.port, config.smtp.from),
    store,
    kc: kcAdmin,
    config: { webUrl: config.webUrl, publicUrl: config.publicUrl, oidcClientId: config.oidc.clientId, platformIdps: config.platformIdps, devDomainVerifyBypass: config.devDomainVerifyBypass, kubeContext: config.kubeContext, namespace: config.namespace },
    log: { info: (o, m) => log?.info(o, m), warn: (o, m) => log?.warn(o, m) },
  });
  sessions.hooks = platform;

  const app = await buildApp({
    content,
    auth: new OidcAuthenticator(db, store, oidc),
    sessions,
    cluster,
    platform,
    oidc: { client: oidc, store },
    clusterInfo: new KubeClusterInfo(kc),
    hub: new TerminalHub(),
    logger: { level: config.logLevel },
  });
  log = app.log;

  for (const i of content.issues) app.log.warn({ file: i.file }, `lab skipped: ${i.message}`);
  app.log.info({ labs: content.labs.size, skills: content.skills.length, frameworks: content.frameworks.length, context: config.kubeContext, namespace: config.namespace }, 'content loaded');
  app.log.info({ issuer: config.oidc.issuer, publicUrl: config.publicUrl, webUrl: config.webUrl, platformIdps: config.platformIdps, domainVerifyBypass: config.devDomainVerifyBypass }, 'auth: OIDC (BFF)');

  const sweep = config.sweepIntervalMs > 0 ? setInterval(() => void platform.sweep().catch((e: unknown) => app.log.warn({ err: e }, 'attempt sweep failed')), config.sweepIntervalMs) : undefined;
  const close = async () => {
    if (sweep) clearInterval(sweep);
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await app.listen({ host: config.host, port: config.port });
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
