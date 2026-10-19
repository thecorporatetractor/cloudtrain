import path from 'node:path';
import { sql } from 'kysely';
import { buildApp } from './app.js';
import { AnswerService } from './answers/service.js';
import { PgAnswerStore } from './answers/store.js';
import { EventService } from './events/service.js';
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
import { loadExamCatalog } from './exams/catalog.js';
import { LabctlExamCompiler } from './exams/compile.js';
import { KubeExamCluster } from './exams/kube.js';
import { PgEvidenceSink, PgExamStore, PgTeamDirectory } from './exams/pg.js';
import { ExamService } from './exams/service.js';
import { loadSiteConfig } from './site/config.js';
import { BillingService } from './billing/service.js';
import { StripeApi, maskKey } from './billing/stripe.js';
import { PgWaitlistStore } from './waitlist/store.js';

async function main() {
  const config = loadConfig();
  for (const [k, v] of [
    ['CT_OIDC_CLIENT_SECRET', config.oidc.clientSecret],
    ['CT_SESSION_SECRET', config.sessionSecret],
  ] as const) {
    if (!v) throw new Error(`${k} must be set`);
  }
  const content = await loadContent(config.contentDir, config.extraLabDirs);
  const site = await loadSiteConfig(config.siteConfigFile);
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

  // Exam simulations: attempts, results and retake grants in Postgres (RLS),
  // evidence into the learner model, teams from teams/team_members.
  const examCatalog = await loadExamCatalog(content, config.contentDir, config.curriculumFile, config.extraExamFiles);
  const exams = new ExamService(
    examCatalog,
    content,
    new KubeExamCluster(kc, config.namespace),
    new LabctlExamCompiler(config.labctl, [path.join(config.contentDir, 'packs'), ...config.extraLabDirs]),
    new PgExamStore(db),
    new PgEvidenceSink(db, content),
    new PgTeamDirectory(db),
    { sessionLabels: config.examSessionLabels, ...(config.examDurationMinutes ? { durationMinutes: config.examDurationMinutes } : {}) },
  );

  // CTF questions: submissions and hint reveals in Postgres (RLS, audited, rate-limited).
  // CTF events: event sessions answer for their team (or entrant), with the event's scoring.
  const events = new EventService(platform, sessions);
  const answers = new AnswerService(sessions, new PgAnswerStore(platform), { ratePerMinute: config.answerRatePerMinute, resolve: events.resolveScope });

  // Billing (Stripe, test mode only, behind CT_BILLING_ENABLED): plans from the site configuration.
  const billing = new BillingService({
    db,
    site,
    ...(config.billing.enabled ? { stripe: new StripeApi(config.billing.secretKey), webhookSecret: config.billing.webhookSecret } : {}),
    webUrl: config.webUrl,
    log: { info: (o, m) => log?.info(o, m), warn: (o, m) => log?.warn(o, m) },
  });

  const app = await buildApp({
    content,
    auth: new OidcAuthenticator(db, store, oidc),
    sessions,
    cluster,
    platform,
    oidc: { client: oidc, store },
    clusterInfo: new KubeClusterInfo(kc),
    hub: new TerminalHub(),
    exams,
    answers,
    events,
    logger: { level: config.logLevel },
    devImpersonate: config.devImpersonate,
    site: { config: site, exams: examCatalog, ratePerMinute: config.publicRatePerMinute, waitlist: { store: new PgWaitlistStore(db), perHour: config.waitlistRatePerHour } },
    trustProxy: config.trustProxy,
    corsOrigins: config.corsOrigins,
    readiness: { postgres: () => sql`SELECT 1`.execute(db) },
    billing,
  });
  log = app.log;
  for (const i of examCatalog.issues) app.log.warn({ file: i.file }, `exams skipped: ${i.message}`);
  app.log.info({ exams: examCatalog.exams.size, available: [...examCatalog.exams.values()].filter((e) => e.availability === 'available').map((e) => e.def.id) }, 'exam catalog loaded');

  for (const i of content.issues) app.log.warn({ file: i.file }, `lab skipped: ${i.message}`);
  app.log.info({ labs: content.labs.size, skills: content.skills.length, frameworks: content.frameworks.length, context: config.kubeContext, namespace: config.namespace, contentDir: config.contentDir }, 'content loaded');
  if (config.devImpersonate) app.log.warn({ publicUrl: config.publicUrl }, 'DEV ONLY: CT_DEV_IMPERSONATE=1, POST /api/dev/sign-in-as is enabled (loopback callers only)');
  app.log.info({ file: config.siteConfigFile, brand: site.brand.name, flags: site.flags, plans: site.plans?.items.map((p) => p.id) ?? [] }, 'public website config loaded');
  if (config.billing.enabled) app.log.info({ mode: 'test', key: maskKey(config.billing.secretKey), checkoutEnabled: !!site.flags.checkoutEnabled }, 'billing: Stripe TEST MODE on (CT_BILLING_ENABLED=1)');
  else app.log.info({}, 'billing: off (CT_BILLING_ENABLED unset); plans are informational');
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
