import { buildApp } from './app.js';
import { DevAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { loadContent } from './content/load.js';
import { KubeLabCluster, kubeConfigFor } from './kube/client.js';
import { LabctlCompiler } from './kube/compile.js';
import { SessionService } from './sessions/service.js';

async function main() {
  const config = loadConfig();
  const content = await loadContent(config.contentDir, config.extraLabDirs);
  const compiler = new LabctlCompiler(config.labctl);
  await compiler.check();
  const cluster = new KubeLabCluster(kubeConfigFor(config.kubeContext), config.namespace);
  const sessions = new SessionService(content, cluster, compiler, {
    validateTimeoutMs: config.validateTimeoutMs,
    ...(config.sessionTtlMinutes ? { sessionTtlMinutes: config.sessionTtlMinutes } : {}),
  });
  const app = await buildApp({ content, auth: new DevAuthenticator(), sessions, cluster, logger: { level: config.logLevel } });

  for (const i of content.issues) app.log.warn({ file: i.file }, `lab skipped: ${i.message}`);
  app.log.info({ labs: content.labs.size, skills: content.skills.length, frameworks: content.frameworks.length, context: config.kubeContext, namespace: config.namespace }, 'content loaded');
  app.log.warn('auth: development stub user (no OIDC)');

  const close = async () => {
    await app.close();
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
