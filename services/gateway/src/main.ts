import path from 'node:path';
import { buildApp } from './app.js';
import { DevAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { loadContent } from './content/load.js';
import { KubeLabCluster, kubeConfigFor } from './kube/client.js';
import { LabctlCompiler } from './kube/compile.js';
import { SessionService } from './sessions/service.js';
import { loadExamCatalog } from './exams/catalog.js';
import { LabctlExamCompiler } from './exams/compile.js';
import { MemoryEvidenceSink } from './exams/evidence.js';
import { KubeExamCluster } from './exams/kube.js';
import { AttemptTeamDirectory, ExamService } from './exams/service.js';
import { MemoryExamStore } from './exams/store.js';

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
  // Exam simulations. Persistence and learner-model evidence are in-memory
  // until the platform-api Postgres adapters are wired in (see exams/schema.sql).
  const kc = kubeConfigFor(config.kubeContext);
  const examCatalog = await loadExamCatalog(content, config.contentDir, config.curriculumFile, config.extraExamFiles);
  const examStore = new MemoryExamStore();
  const exams = new ExamService(
    examCatalog,
    content,
    new KubeExamCluster(kc, config.namespace),
    new LabctlExamCompiler(config.labctl, [path.join(config.contentDir, 'packs'), ...config.extraLabDirs]),
    examStore,
    new MemoryEvidenceSink(),
    new AttemptTeamDirectory(examStore),
    { sessionLabels: config.examSessionLabels, ...(config.examDurationMinutes ? { durationMinutes: config.examDurationMinutes } : {}) },
  );
  const app = await buildApp({ content, auth: new DevAuthenticator(), sessions, cluster, exams, logger: { level: config.logLevel } });
  for (const i of examCatalog.issues) app.log.warn({ file: i.file }, `exams skipped: ${i.message}`);
  app.log.info({ exams: examCatalog.exams.size, available: [...examCatalog.exams.values()].filter((e) => e.availability === 'available').map((e) => e.def.id) }, 'exam catalog loaded');

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
