import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import { buildApp } from './app.js';
import { AnswerService } from './answers/service.js';
import { PgAnswerStore } from './answers/store.js';
import { EventService } from './events/service.js';
import { loadConfig } from './config.js';
import { loadContent } from './content/load.js';
import { createDb } from './db/index.js';
import { roleFacts, roleProblem } from './db/role.js';
import { KubeClusterInfo } from './kube/capacity.js';
import { KubeLabCluster, kubeConfigFor } from './kube/client.js';
import { LabctlCompiler } from './kube/compile.js';
import { KeycloakAdmin } from './keycloak/admin.js';
import { scheduleTenantIdpRepair } from './keycloak/repair.js';
import { SmtpMailer } from './mail.js';
import { OidcClient } from './oidc/client.js';
import { OidcAuthenticator, Sealer, SessionStore } from './oidc/sessions.js';
import { PlatformService } from './platform/service.js';
import { SessionService } from './sessions/service.js';
import { phaseOf } from './sessions/map.js';
import { TerminalHub } from './terminal/hub.js';
import { PgTerminalBus } from './terminal/pgbus.js';
import { usageEnd } from './sessions/usage.js';
import { loadExamCatalog } from './exams/catalog.js';
import { LabctlExamCompiler } from './exams/compile.js';
import { KubeExamCluster } from './exams/kube.js';
import { PgEvidenceSink, PgExamStore, PgTeamDirectory } from './exams/pg.js';
import { ExamService } from './exams/service.js';
import { loadSiteConfig } from './site/config.js';
import { BillingService, type SessionEndResolver } from './billing/service.js';
import { StripeApi, maskKey } from './billing/stripe.js';
import { PgWaitlistStore } from './waitlist/store.js';
import { createLedger } from './gdpr/ledger.js';
import { GdprService } from './gdpr/service.js';
import { sweepRetention } from './gdpr/retention.js';

async function main() {
  const config = loadConfig();
  for (const [k, v] of [
    ['CT_OIDC_CLIENT_SECRET', config.oidc.clientSecret],
    ['CT_SESSION_SECRET', config.sessionSecret],
    // Fail closed: without it there is no subject key, so no evidence and no rights flow.
    ['CT_GDPR_HMAC_KEY', config.gdpr.hmacKey],
  ] as const) {
    if (!v) throw new Error(`${k} must be set`);
  }
  if (process.env.NODE_ENV === 'production' && (config.gdpr.hmacKey.length < 32 || config.gdpr.hmacKey.startsWith('dev-only'))) throw new Error('CT_GDPR_HMAC_KEY must be at least 32 characters of real key material in production');
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
  // Row-level security only binds a non-owner role without BYPASSRLS (src/db/role.ts).
  const roleIssue = roleProblem(await roleFacts(db as unknown as Kysely<unknown>));
  if (roleIssue && process.env.NODE_ENV === 'production') throw new Error(`refusing to start: ${roleIssue}; CT_DATABASE_URL must be the RLS-bound app role, the owner only runs migrations`);
  if (roleIssue) console.warn(`WARNING: ${roleIssue}; tenant isolation is not enforced by the database`);
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
  // Instructor shadowing across gateway replicas (Postgres LISTEN/NOTIFY, src/terminal/hub.ts).
  const terminalBus = await PgTerminalBus.start(config.databaseUrl, { secret: config.sessionSecret, log: { warn: (o, m) => log?.warn(o, m) } });
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
  const examCluster = new KubeExamCluster(kc, config.namespace);
  const exams = new ExamService(
    examCatalog,
    content,
    examCluster,
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
  // Pay for compute: lab sessions are metered and reported to a Stripe Billing Meter; the
  // lab-start gate is on with billing unless CT_BILLING_ENFORCE=0 (docs/billing.md).
  // When a metered session ended (while it runs: null, or for a lab its first Ready): a LabSession for labs and CTF event labs, the
  // ExamSession for an exam attempt (its environments run until it completes or fails).
  const sessionEnd: SessionEndResolver = async (name, kind) => {
    if (kind === 'exam') {
      const es = await examCluster.getExamSession(name);
      const phase = es?.status?.phase;
      if (!es) return 'missing';
      if (phase !== 'Completed' && phase !== 'Failed') return null;
      const done = Date.parse(es?.status?.completedAt ?? es?.status?.frozenAt ?? '');
      return new Date(Number.isNaN(done) ? Date.now() : Math.min(done, Date.now()));
    }
    const ls = await cluster.getSession(name);
    if (!ls) return 'missing';
    // Running: its first Ready, so running estimates (spend cap, /billing) count like the final charge.
    if (!['expired', 'failed'].includes(phaseOf(ls))) {
      const readyAt = Date.parse(ls.status?.readyAt ?? '');
      return { readyAt: Number.isNaN(readyAt) ? null : new Date(readyAt) };
    }
    // Billed from the first Ready to the end (expiry, or when a failed lab stopped being ready).
    return usageEnd(ls);
  };
  const billing = new BillingService({
    db,
    sessionEnd,
    site,
    ...(config.billing.enabled ? { stripe: new StripeApi(config.billing.secretKey), webhookSecret: config.billing.webhookSecret } : {}),
    enforce: config.billing.enforce,
    labs: content.labs,
    mailer: new SmtpMailer(config.smtp.host, config.smtp.port, config.smtp.from),
    webUrl: config.webUrl,
    log: { info: (o, m) => log?.info(o, m), warn: (o, m) => log?.warn(o, m) },
  });

  // Data-subject rights and their evidence (docs/gdpr.md). The ledger is Azure Tables when
  // CT_GDPR_LEDGER_TABLE_URL is set, else the append-only Postgres table.
  const waitlist = new PgWaitlistStore(db);
  const ledger = await createLedger(config.gdpr.ledger, db, [config.gdpr.hmacKey, ...config.gdpr.previousHmacKeys]);
  const stripe = config.billing.enabled ? new StripeApi(config.billing.secretKey) : undefined;
  const gdpr = new GdprService({
    db,
    ledger,
    hmacKey: config.gdpr.hmacKey,
    previousHmacKeys: config.gdpr.previousHmacKeys,
    sealer: new Sealer(config.sessionSecret),
    mailer: new SmtpMailer(config.smtp.host, config.smtp.port, config.smtp.from),
    webUrl: config.webUrl,
    waitlist,
    brand: site.brand.name,
    cluster,
    exams: examCluster,
    kc: kcAdmin,
    ...(stripe ? { stripe } : {}),
    billing,
    store,
    tokenTtlMs: config.gdpr.tokenTtlMinutes * 60_000,
    recentSignInMs: config.gdpr.recentSignInMinutes * 60_000,
    closureDays: config.retention.closedDays,
    contact: config.gdpr.contact,
    identityAccountUrl: config.gdpr.identityAccountUrl,
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
    hub: new TerminalHub(terminalBus),
    exams,
    answers,
    events,
    logger: { level: config.logLevel },
    devImpersonate: config.devImpersonate,
    site: { config: site, exams: examCatalog, ratePerMinute: config.publicRatePerMinute, waitlist: { store: waitlist, perHour: config.waitlistRatePerHour } },
    trustProxy: config.trustProxy,
    corsOrigins: config.corsOrigins,
    appUrls: [config.webUrl, config.publicUrl],
    readiness: { postgres: () => sql`SELECT 1`.execute(db) },
    billing,
    gdpr: { service: gdpr, perHour: config.gdpr.perHour },
  });
  log = app.log;
  for (const i of examCatalog.issues) app.log.warn({ file: i.file }, `exams skipped: ${i.message}`);
  app.log.info({ exams: examCatalog.exams.size, available: [...examCatalog.exams.values()].filter((e) => e.availability === 'available').map((e) => e.def.id) }, 'exam catalog loaded');

  for (const i of content.issues) app.log.warn({ file: i.file }, `lab skipped: ${i.message}`);
  app.log.info({ labs: content.labs.size, skills: content.skills.length, frameworks: content.frameworks.length, context: config.kubeContext, namespace: config.namespace, contentDir: config.contentDir }, 'content loaded');
  if (config.devImpersonate) app.log.warn({ publicUrl: config.publicUrl }, 'DEV ONLY: CT_DEV_IMPERSONATE=1, POST /api/dev/sign-in-as is enabled (loopback callers only)');
  app.log.info({ file: config.siteConfigFile, brand: site.brand.name, flags: site.flags, plans: site.plans?.items.map((p) => p.id) ?? [] }, 'public website config loaded');
  if (config.billing.enabled) app.log.info({ mode: 'test', key: maskKey(config.billing.secretKey), checkoutEnabled: !!site.flags.checkoutEnabled, enforce: config.billing.enforce }, 'billing: Stripe TEST MODE on (CT_BILLING_ENABLED=1)');
  else app.log.info({}, 'billing: off (CT_BILLING_ENABLED unset); plans are informational');
  app.log.info({ issuer: config.oidc.issuer, publicUrl: config.publicUrl, webUrl: config.webUrl, platformIdps: config.platformIdps, domainVerifyBypass: config.devDomainVerifyBypass }, 'auth: OIDC (BFF)');

  const sweep = config.sweepIntervalMs > 0 ? setInterval(() => void platform.sweep().catch((e: unknown) => app.log.warn({ err: e }, 'attempt sweep failed')), config.sweepIntervalMs) : undefined;
  // Metered usage: close sessions that ended outside the gateway (expiry, admin), flush the meter outbox.
  if (config.billing.enabled && config.billing.sweepMs === 0) app.log.warn({}, 'billing: CT_BILLING_SWEEP_MS=0: usage of sessions that end outside the gateway and orphaned start reservations are only closed when that person starts again');
  const billingSweep = config.billing.sweepMs > 0 ? setInterval(() => void billing.sweep(sessionEnd).catch((e: unknown) => app.log.warn({ err: e }, 'billing sweep failed')), config.billing.sweepMs) : undefined;
  // Webhooks can be missed or fail for good: re-read subscriptions from Stripe and replay failed events.
  const billingReconcile =
    config.billing.enabled && config.billing.reconcileMs > 0
      ? setInterval(
          () =>
            void billing
              .reconcile()
              .then((r) => (r.changed || r.replayed || r.errors ? app.log.info(r, 'billing reconciled with Stripe') : undefined))
              .catch((e: unknown) => app.log.warn({ err: e }, 'billing reconcile failed')),
          config.billing.reconcileMs,
        )
      : undefined;
  const gdprSweep = config.gdpr.sweepMs > 0 ? setInterval(() => void gdpr.sweep().catch((e: unknown) => app.log.warn({ code: (e as { code?: string }).code }, 'gdpr sweep failed')), config.gdpr.sweepMs) : undefined;
  const retention = () => void sweepRetention({ db, waitlist, ledger, accounts: gdpr, config: config.retention, log: app.log }).catch((e: unknown) => app.log.warn({ code: (e as { code?: string }).code }, 'retention sweep failed'));
  const retentionSweep = config.retention.sweepMs > 0 ? setInterval(retention, config.retention.sweepMs) : undefined;
  // Tenant IdP protections (broker flow, origin stamps, foreign addresses) hold without kc:sync.
  const stopKcRepair = kcAdmin ? scheduleTenantIdpRepair(db, kcAdmin, config.keycloak.repairMs, app.log) : undefined;
  if (!kcAdmin) app.log.warn({}, 'keycloak: no admin client (CT_KEYCLOAK_ADMIN_CLIENT_SECRET unset); tenant IdP protections are not re-applied and local logins are not checked for IdP origins');
  const close = async () => {
    stopKcRepair?.();
    if (gdprSweep) clearInterval(gdprSweep);
    if (retentionSweep) clearInterval(retentionSweep);
    await gdpr.settled();
    if (sweep) clearInterval(sweep);
    if (billingSweep) clearInterval(billingSweep);
    if (billingReconcile) clearInterval(billingReconcile);
    await billing.settle();
    await app.close();
    await terminalBus.close();
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
