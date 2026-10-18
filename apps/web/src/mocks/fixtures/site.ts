import { parse } from 'yaml';
import type { PublicCatalog, PublicExam, PublicExamDetail, PublicLab, PublicPath, PublicPathDetail, SiteConfig } from '@/api/types';
import siteYaml from '../../../../../content/site.yaml?raw';
import { fixtureExams, type FixtureExam } from './exams.generated';
import { domains, labSummaries, paths } from './labs';
import { frameworks, skills } from './skills';

/*
 * Mock public API data. The site configuration is the real content/site.yaml
 * (bundled as text in mock mode only), so the mock website shows exactly what
 * the gateway would serve. The catalog is the mock lab world (fixtures/labs.ts)
 * plus the real exam catalog, reduced to the public shapes.
 */

export const site: SiteConfig = parse(siteYaml) as SiteConfig;

/** Courses: short groups of labs; the mock paths are split into them. */
const courses: { id: string; pathId: string; title: string; description: string; labIds: string[] }[] = [
  { id: 'k8s-netpol-rbac', pathId: 'cks-readiness', title: 'Network policy and least privilege', description: 'Isolate workloads and trim RBAC to what each service needs.', labIds: ['orchard-netpol-isolation', 'ledger-rbac-least-privilege'] },
  { id: 'k8s-admission-audit-runtime', pathId: 'cks-readiness', title: 'Admission, audit and runtime', description: 'Pod Security, audit policy and host hardening on a kubeadm cluster.', labIds: ['orchard-psa-baseline', 'orchard-audit-policy', 'harbor-systemd-hardening'] },
  { id: 'k8s-cluster-lifecycle', pathId: 'cka-foundations', title: 'Cluster lifecycle', description: 'Back up and restore etcd, upgrade a worker, rotate ingress TLS.', labIds: ['orchard-etcd-snapshot-restore', 'orchard-worker-upgrade', 'orchard-ingress-tls-rotation'] },
  { id: 'linux-storage-services', pathId: 'lfcs-sysadmin', title: 'Storage and services', description: 'Grow a volume, harden a unit, rotate logs.', labIds: ['quill-lvm-extend', 'harbor-systemd-hardening', 'quill-log-rotation'] },
];

const toLab = (l: (typeof labSummaries)[number]): PublicLab => ({
  id: l.id,
  title: l.title,
  domain: l.domain,
  difficulty: l.difficulty,
  estimatedMinutes: l.estimatedMinutes,
  ...(l.frameworks?.length ? { frameworks: l.frameworks } : {}),
  ...(l.tags?.length ? { tags: l.tags } : {}),
  skillIds: l.skillIds,
  ...(l.pathId ? { pathId: l.pathId } : {}),
  ...(l.questionCount ? { questionCount: l.questionCount } : {}),
});

const publicLabs: PublicLab[] = labSummaries.map(toLab).sort((a, b) => a.title.localeCompare(b.title));
const labMinutes = (ids: string[]) => ids.reduce((a, id) => a + (labSummaries.find((l) => l.id === id)?.estimatedMinutes ?? 0), 0);
const disclaimerOf = (fw: string | undefined) => (fw ? frameworks.find((f) => f.id === fw)?.disclaimer : undefined);

const publicPaths: PublicPath[] = [
  ...paths.map(
    (p): PublicPath => ({
      id: p.id,
      kind: 'path',
      title: p.title,
      domain: p.domain,
      description: p.description,
      ...(p.framework ? { framework: p.framework } : {}),
      labCount: p.labIds.length,
      estimatedMinutes: p.estimatedMinutes,
      ...(disclaimerOf(p.framework) ? { disclaimer: disclaimerOf(p.framework) } : {}),
    }),
  ),
  ...courses.map(
    (c): PublicPath => ({
      id: c.id,
      kind: 'course',
      title: c.title,
      domain: paths.find((p) => p.id === c.pathId)?.domain ?? 'kubernetes',
      description: c.description,
      labCount: c.labIds.length,
      estimatedMinutes: labMinutes(c.labIds),
    }),
  ),
];

const MOCK_AVAILABLE = new Set(['sim-k8s-developer', 'sim-k8s-admin', 'sim-k8s-security', 'sim-linux-sysadmin', 'sim-el-sysadmin']);

function toExam(e: FixtureExam): PublicExam {
  const available = MOCK_AVAILABLE.has(e.id);
  return {
    id: e.id,
    title: e.title,
    domain: e.domain,
    alignsTo: e.alignsTo,
    disclaimer: e.disclaimer,
    format: e.format,
    durationMinutes: e.durationMinutes,
    passMark: e.passMark,
    ...(e.passMarkNote ? { passMarkNote: e.passMarkNote } : {}),
    taskCount: e.taskCount,
    environment: e.environment,
    availability: available ? 'available' : 'coming-soon',
    ...(available ? {} : { availabilityNote: 'Exam tasks are still being authored for some objectives.' }),
    rules: e.rules,
    retakePolicy: e.retakePolicy,
  };
}

const publicExams: PublicExam[] = fixtureExams.map(toExam).sort((a, b) => (a.availability === b.availability ? a.title.localeCompare(b.title) : a.availability === 'available' ? -1 : 1));

export const publicCatalog: PublicCatalog = {
  domains: domains.map((d) => ({ ...d, pathCount: publicPaths.filter((p) => p.kind === 'path' && p.domain === d.id).length, examCount: publicExams.filter((e) => e.domain === d.id).length })),
  paths: publicPaths,
  labs: publicLabs,
  exams: publicExams,
  frameworks: frameworks.map((f) => ({ id: f.id, name: f.name, fullName: f.fullName, vendor: f.vendor, ...(f.domain ? { domain: f.domain } : {}), group: f.group, coverage: f.coverage, ...(f.disclaimer ? { disclaimer: f.disclaimer } : {}) })),
  skillNames: Object.fromEntries(skills.map((s) => [s.id, s.name])),
};

export function publicPathDetail(id: string): PublicPathDetail | undefined {
  const path = publicPaths.find((p) => p.id === id);
  if (!path) return undefined;
  const byId = new Map(publicLabs.map((l) => [l.id, l]));
  const labIds = path.kind === 'course' ? courses.find((c) => c.id === id)!.labIds : paths.find((p) => p.id === id)!.labIds;
  const own = courses.filter((c) => c.pathId === id);
  const sections = path.kind === 'path' && own.length ? own.map((c) => ({ id: c.id, title: c.title, description: c.description, labIds: c.labIds })) : [{ id: path.id, title: path.title, labIds }];
  return {
    ...path,
    sections,
    labs: labIds.map((l) => byId.get(l)).filter((l): l is PublicLab => !!l),
    related: publicPaths.filter((p) => p.id !== id && p.domain === path.domain).slice(0, 6),
  };
}

export function publicExamDetail(id: string): PublicExamDetail | undefined {
  const e = fixtureExams.find((x) => x.id === id);
  if (!e) return undefined;
  const drawn = e.blueprint.filter((o) => o.tasks > 0);
  const sum = drawn.reduce((a, o) => a + o.weight, 0);
  return {
    ...toExam(e),
    ...(e.description ? { description: e.description } : {}),
    ...(e.simulationNote ? { simulationNote: e.simulationNote } : {}),
    objectives: e.blueprint.map((o) => ({ id: o.objective, name: o.name, weight: o.tasks > 0 ? Math.round((sum > 0 ? (100 * o.weight) / sum : 100 / drawn.length) * 10) / 10 : 0, tasks: o.tasks, poolSize: o.pool.length })),
    reportIncludes: e.reportIncludes,
  };
}
