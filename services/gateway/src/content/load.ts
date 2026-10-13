import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { validateLab, type Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { Domain, DomainInfo, Framework, FrameworkId, LabSummary, Path, Skill } from '@cloudtrain/api-types';

/** A lab.yaml from content/ (or an extra lab directory), validated against the v3 schema. */
export interface ContentLab {
  lab: SourceLab;
  /** Absolute path of lab.yaml; `labctl compile` reads it (and its assets) from here. */
  file: string;
  pack?: string;
}

export interface ContentIssue {
  file: string;
  message: string;
}

/** Everything the catalog endpoints serve, read once at startup. */
export interface Content {
  labs: Map<string, ContentLab>;
  skills: Skill[];
  /** Prerequisite edges from skills.yaml (`requires`). */
  requires: Map<string, string[]>;
  frameworks: Framework[];
  paths: Path[];
  domains: DomainInfo[];
  summaries: LabSummary[];
  /** Labs that failed validation; they are not served. */
  issues: ContentIssue[];
}

/* ------------------------------ source shapes ------------------------------ */

interface SkillGraphDoc {
  kind: 'SkillGraph';
  domains: { id: string; title: string; competencies: { id: string; title: string; skills: { id: string; title: string; requires?: string[] }[] }[] }[];
}

interface FrameworkDoc {
  kind: 'Framework';
  id: string;
  title: string;
  issuer?: string;
  objectives: { id: string; title: string; weight: number; skills?: string[] }[];
}

interface PackDoc {
  kind: 'Pack';
  metadata: { id: string; title: string; domain: Domain; description?: string };
  courses?: { id: string; title: string; description?: string; level?: string; labs: string[] }[];
  paths?: { id: string; title: string; framework?: string; description?: string; courses: string[] }[];
}

/** skills.yaml domain ids are short; the API uses the long form. */
const DOMAIN_OF: Record<string, Domain> = { k8s: 'kubernetes', kubernetes: 'kubernetes', linux: 'linux', net: 'networking', networking: 'networking' };
const FRAMEWORK_IDS: readonly FrameworkId[] = ['cka', 'cks', 'lfcs', 'ccna'];

const DOMAIN_INFO: Record<Domain, { name: string; tagline: string }> = {
  kubernetes: { name: 'Kubernetes', tagline: 'Real kubeadm and virtual clusters, from etcd to admission.' },
  linux: { name: 'Linux', tagline: 'Full VMs for storage, services and access control.' },
  networking: { name: 'Networking', tagline: 'Routers, switches and firewalls on real L2 wires.' },
};

async function readYaml<T>(file: string): Promise<T> {
  return parse(await readFile(file, 'utf8')) as T;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort();
}

/* --------------------------------- mapping --------------------------------- */

export function toSkills(doc: SkillGraphDoc): { skills: Skill[]; requires: Map<string, string[]> } {
  const skills: Skill[] = [];
  const requires = new Map<string, string[]>();
  for (const d of doc.domains) {
    const domain = DOMAIN_OF[d.id];
    if (!domain) continue;
    for (const c of d.competencies) {
      for (const s of c.skills) {
        skills.push({ id: s.id, name: s.title, domain, competency: c.title });
        if (s.requires?.length) requires.set(s.id, s.requires);
      }
    }
  }
  return { skills, requires };
}

/** Objective weights are published percentages; the API uses fractions of 1 that sum to 1. */
export function toFramework(doc: FrameworkDoc): Framework | null {
  const id = doc.id as FrameworkId;
  if (!FRAMEWORK_IDS.includes(id)) return null;
  const total = doc.objectives.reduce((a, o) => a + o.weight, 0) || 1;
  const short = /\(([^)]+)\)\s*$/.exec(doc.title)?.[1]?.split(/\s+/)[0] ?? id.toUpperCase();
  return {
    id,
    name: short,
    fullName: doc.title.replace(/\s*\([^)]*\)\s*$/, ''),
    vendor: doc.issuer ?? '',
    domains: doc.objectives.map((o) => ({ id: `${id}:${o.id}`, name: o.title, weight: o.weight / total, skillIds: o.skills ?? [] })),
  };
}

function labSkills(lab: SourceLab): string[] {
  return Array.from(new Set(lab.spec.checks.flatMap((c) => c.skills)));
}

/* ---------------------------------- loader --------------------------------- */

async function loadLab(file: string, pack: string | undefined, labs: Map<string, ContentLab>, issues: ContentIssue[]) {
  let doc: unknown;
  try {
    doc = await readYaml<unknown>(file);
  } catch (e) {
    issues.push({ file, message: `parse: ${(e as Error).message}` });
    return;
  }
  const { valid, issues: schemaIssues } = validateLab(doc);
  if (!valid) {
    issues.push({ file, message: schemaIssues.map((i) => `${i.path}: ${i.message}`).join('; ') });
    return;
  }
  const lab = doc as SourceLab;
  if (labs.has(lab.metadata.id)) {
    issues.push({ file, message: `duplicate lab id ${lab.metadata.id} (first: ${labs.get(lab.metadata.id)!.file})` });
    return;
  }
  labs.set(lab.metadata.id, { lab, file, ...(pack ? { pack } : {}) });
}

/** Reads content/ (skill graph, frameworks, packs) plus optional extra lab directories. */
export async function loadContent(contentDir: string, extraLabDirs: string[] = []): Promise<Content> {
  const issues: ContentIssue[] = [];
  const { skills, requires } = toSkills(await readYaml<SkillGraphDoc>(path.join(contentDir, 'skills.yaml')));

  const frameworks: Framework[] = [];
  const fwDir = path.join(contentDir, 'frameworks');
  if (await exists(fwDir)) {
    for (const f of (await readdir(fwDir)).filter((n) => /\.ya?ml$/.test(n)).sort()) {
      const fw = toFramework(await readYaml<FrameworkDoc>(path.join(fwDir, f)));
      if (fw) frameworks.push(fw);
    }
  }

  const labs = new Map<string, ContentLab>();
  const packs: PackDoc[] = [];
  for (const packDir of await subdirs(path.join(contentDir, 'packs'))) {
    const packFile = path.join(packDir, 'pack.yaml');
    const pack = (await exists(packFile)) ? await readYaml<PackDoc>(packFile) : undefined;
    if (pack) packs.push(pack);
    for (const labDir of await subdirs(path.join(packDir, 'labs'))) {
      const file = path.join(labDir, 'lab.yaml');
      if (await exists(file)) await loadLab(file, pack?.metadata.id, labs, issues);
    }
  }
  for (const dir of extraLabDirs) {
    for (const labDir of await subdirs(dir)) {
      const file = path.join(labDir, 'lab.yaml');
      if (await exists(file)) await loadLab(file, undefined, labs, issues);
    }
  }

  // Paths: every course is a path; a pack path concatenates its courses.
  const minutes = (ids: string[]) => ids.reduce((a, id) => a + (labs.get(id)?.lab.metadata.estimatedMinutes ?? 0), 0);
  const known = (ids: string[]) => ids.filter((id) => labs.has(id));
  const paths: Path[] = [];
  for (const pack of packs) {
    const courses = pack.courses ?? [];
    for (const c of courses) {
      const labIds = known(c.labs);
      paths.push({ id: c.id, title: c.title, domain: pack.metadata.domain, description: c.description ?? '', labIds, estimatedMinutes: minutes(labIds), progress: 0 });
    }
    for (const p of pack.paths ?? []) {
      const parts = p.courses.map((id) => courses.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
      const labIds = known(parts.flatMap((c) => c.labs));
      const framework = FRAMEWORK_IDS.includes(p.framework as FrameworkId) ? (p.framework as FrameworkId) : undefined;
      paths.push({
        id: p.id,
        title: p.title,
        domain: pack.metadata.domain,
        description: p.description ?? `${parts.map((c) => c.title).join(', ')}.`,
        ...(framework ? { framework } : {}),
        labIds,
        estimatedMinutes: minutes(labIds),
        progress: 0,
      });
    }
  }

  const summaries: LabSummary[] = Array.from(labs.values()).map(({ lab }) => {
    const pathId = paths.find((p) => p.labIds.includes(lab.metadata.id))?.id;
    return {
      ...lab.metadata,
      skillIds: labSkills(lab),
      ...(pathId ? { pathId } : {}),
      completion: 'new',
    };
  });

  const domains: DomainInfo[] = (Object.keys(DOMAIN_INFO) as Domain[]).map((id) => ({
    id,
    ...DOMAIN_INFO[id],
    labCount: summaries.filter((l) => l.domain === id).length,
    pathCount: paths.filter((p) => p.domain === id).length,
  }));

  return { labs, skills, requires, frameworks, paths, domains, summaries, issues };
}
