import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { validateLab, type Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { Domain, DomainInfo, Framework, LabSummary, Path, Skill } from '@cloudtrain/api-types';

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
  /** Competencies (skills.yaml domain -> competency), for team heatmaps. */
  competencies: ContentCompetency[];
  frameworks: Framework[];
  /** Content packs and their labs (content visibility). */
  packs: ContentPack[];
  paths: Path[];
  domains: DomainInfo[];
  summaries: LabSummary[];
  /** Labs that failed validation; they are not served. */
  issues: ContentIssue[];
}

export interface ContentCompetency {
  id: string;
  name: string;
  domain: Domain;
  skillIds: string[];
}

export interface ContentPack {
  id: string;
  title: string;
  domain: Domain;
  labIds: string[];
}

/* ------------------------------ source shapes ------------------------------ */

interface SkillGraphDoc {
  kind: 'SkillGraph';
  domains: { id: string; title: string; competencies: { id: string; title: string; skills: { id: string; title: string; requires?: string[] }[] }[] }[];
}

/** content/frameworks/<id>.yaml: hand-written, or generated from content/curriculum.yaml (`generatedFrom`). */
interface FrameworkDoc {
  kind: 'Framework';
  id: string;
  title: string;
  shortName?: string;
  issuer?: string;
  /** Content domain, or `cross-domain`. */
  domain?: string;
  disclaimer?: string;
  /** Weights are optional where the certifying body publishes none. */
  objectives: { id: string; title: string; weight?: number; skills?: string[] }[];
}

interface PackDoc {
  kind: 'Pack';
  metadata: { id: string; title: string; domain: Domain; description?: string };
  courses?: { id: string; title: string; description?: string; level?: string; labs: string[] }[];
  paths?: { id: string; title: string; framework?: string; description?: string; courses: string[] }[];
}

/** skills.yaml domain ids are short; the API uses the long form. */
const DOMAIN_OF: Record<string, Domain> = {
  k8s: 'kubernetes',
  kubernetes: 'kubernetes',
  linux: 'linux',
  containers: 'containers',
  iac: 'iac',
  automation: 'automation',
  net: 'networking',
  networking: 'networking',
};
/** Always listed; the wave-2 domains appear once they have labs. */
const CORE_DOMAINS: readonly Domain[] = ['kubernetes', 'linux', 'networking'];
/** Picker group of frameworks that span domains (framework `domain: cross-domain`). */
const CROSS_DOMAIN_GROUP = 'Platform';

const DOMAIN_INFO: Record<Domain, { name: string; tagline: string }> = {
  kubernetes: { name: 'Kubernetes', tagline: 'Real kubeadm and virtual clusters, from etcd to admission.' },
  linux: { name: 'Linux', tagline: 'Full VMs for storage, services and access control.' },
  containers: { name: 'Containers', tagline: 'Build, ship and run images with a real container engine.' },
  iac: { name: 'Infrastructure as code', tagline: 'Terraform against real clusters and stores, fully offline.' },
  automation: { name: 'Automation', tagline: 'Idempotent configuration management across a fleet.' },
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

export function toSkills(doc: SkillGraphDoc): { skills: Skill[]; requires: Map<string, string[]>; competencies: ContentCompetency[] } {
  const skills: Skill[] = [];
  const requires = new Map<string, string[]>();
  const competencies: ContentCompetency[] = [];
  for (const d of doc.domains) {
    const domain = DOMAIN_OF[d.id];
    if (!domain) continue;
    for (const c of d.competencies) {
      competencies.push({ id: c.id, name: c.title, domain, skillIds: c.skills.map((s) => s.id) });
      for (const s of c.skills) {
        skills.push({ id: s.id, name: s.title, domain, competency: c.title });
        if (s.requires?.length) requires.set(s.id, s.requires);
      }
    }
  }
  return { skills, requires, competencies };
}

interface CurriculumSkillsDoc {
  domains?: { id: string; skillDomain?: string; competencies?: { id: string; title: string }[] }[];
  newSkills?: { id: string; name: string; domain: string; competency: string; requires?: string[] }[];
}

/**
 * Adds the approved curriculum's `newSkills` (content/curriculum.yaml) that skills.yaml
 * does not have yet and that a loaded lab uses (`used`). Pack labs may tag checks with
 * them until they are promoted into skills.yaml (lab-verify accepts the same set).
 */
export function addCurriculumSkills(
  doc: CurriculumSkillsDoc,
  graph: { skills: Skill[]; requires: Map<string, string[]>; competencies: ContentCompetency[] },
  used: ReadonlySet<string>,
): void {
  const known = new Set(graph.skills.map((s) => s.id));
  const titles = new Map<string, string>();
  for (const d of doc.domains ?? []) for (const c of d.competencies ?? []) titles.set(c.id, c.title);
  for (const n of doc.newSkills ?? []) {
    const domain = DOMAIN_OF[n.domain];
    if (!domain || known.has(n.id) || !used.has(n.id)) continue;
    known.add(n.id);
    let comp = graph.competencies.find((c) => c.id === n.competency);
    if (!comp) {
      comp = { id: n.competency, name: titles.get(n.competency) ?? n.competency, domain, skillIds: [] };
      graph.competencies.push(comp);
    }
    comp.skillIds.push(n.id);
    graph.skills.push({ id: n.id, name: n.name, domain, competency: comp.name });
    if (n.requires?.length) graph.requires.set(n.id, n.requires);
  }
}

/**
 * Objective weights are percentages; the API uses fractions of 1 that sum to 1. Without
 * weights (the body publishes none) objectives count equally. Parenthesised codes leave the
 * full name ("Certified Kubernetes Administrator (CKA)" -> "Certified Kubernetes Administrator").
 * `coverage` is filled in by `finishFrameworks` once the labs are loaded.
 */
export function toFramework(doc: FrameworkDoc): Framework {
  const id = doc.id;
  const total = doc.objectives.reduce((a, o) => a + (o.weight ?? 0), 0);
  const weightOf = (w: number | undefined) => (total > 0 ? (w ?? 0) / total : 1 / doc.objectives.length);
  const short = doc.shortName ?? /\(([^)]+)\)\s*$/.exec(doc.title)?.[1]?.split(/\s+/)[0] ?? id.toUpperCase();
  const domain = doc.domain ? DOMAIN_OF[doc.domain] : undefined;
  return {
    id,
    name: short,
    fullName: doc.title.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(),
    vendor: doc.issuer ?? '',
    ...(domain ? { domain } : {}),
    group: domain ? DOMAIN_INFO[domain].name : CROSS_DOMAIN_GROUP,
    coverage: 0,
    ...(doc.disclaimer ? { disclaimer: doc.disclaimer } : {}),
    domains: doc.objectives.map((o) => ({ id: `${id}:${o.id}`, name: o.title, weight: weightOf(o.weight), skillIds: o.skills ?? [] })),
  };
}

/**
 * Keeps only objective skills of the loaded skill graph (generated frameworks list the skills of
 * proposed labs too), sets `coverage` from the loaded labs (an objective is covered when a lab
 * is tagged with it or trains one of its skills) and orders frameworks by group, then name.
 */
export function finishFrameworks(frameworks: Framework[], skills: Skill[], labs: Pick<LabSummary, 'frameworks' | 'skillIds'>[]): Framework[] {
  const known = new Set(skills.map((s) => s.id));
  const trained = new Set(labs.flatMap((l) => l.skillIds));
  const tagged = new Set(labs.flatMap((l) => l.frameworks ?? []));
  const order = [...(Object.keys(DOMAIN_INFO) as Domain[]).map((d) => DOMAIN_INFO[d].name), CROSS_DOMAIN_GROUP];
  for (const f of frameworks) {
    for (const d of f.domains) d.skillIds = d.skillIds.filter((id) => known.has(id));
    const covered = f.domains.filter((d) => tagged.has(d.id) || d.skillIds.some((id) => trained.has(id))).length;
    f.coverage = f.domains.length ? Math.round((covered / f.domains.length) * 100) / 100 : 0;
  }
  return frameworks.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));
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
  const graph = toSkills(await readYaml<SkillGraphDoc>(path.join(contentDir, 'skills.yaml')));
  const { skills, requires, competencies } = graph;

  const frameworks: Framework[] = [];
  const fwDir = path.join(contentDir, 'frameworks');
  if (await exists(fwDir)) {
    for (const f of (await readdir(fwDir)).filter((n) => /\.ya?ml$/.test(n)).sort()) {
      frameworks.push(toFramework(await readYaml<FrameworkDoc>(path.join(fwDir, f))));
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

  const curriculumFile = path.join(contentDir, 'curriculum.yaml');
  if (await exists(curriculumFile)) {
    const used = new Set(Array.from(labs.values()).flatMap(({ lab }) => labSkills(lab)));
    addCurriculumSkills(await readYaml<CurriculumSkillsDoc>(curriculumFile), graph, used);
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
      const framework = frameworks.some((f) => f.id === p.framework) ? p.framework : undefined;
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
    const questionCount = lab.spec.checks.filter((c) => c.type === 'answer').length;
    return {
      ...lab.metadata,
      skillIds: labSkills(lab),
      ...(pathId ? { pathId } : {}),
      ...(questionCount ? { questionCount } : {}),
      completion: 'new',
    };
  });

  finishFrameworks(frameworks, skills, summaries);

  const domains: DomainInfo[] = (Object.keys(DOMAIN_INFO) as Domain[])
    .map((id) => ({
      id,
      ...DOMAIN_INFO[id],
      labCount: summaries.filter((l) => l.domain === id).length,
      pathCount: paths.filter((p) => p.domain === id).length,
    }))
    .filter((d) => CORE_DOMAINS.includes(d.id) || d.labCount > 0);

  const contentPacks: ContentPack[] = packs.map((p) => ({
    id: p.metadata.id,
    title: p.metadata.title,
    domain: p.metadata.domain,
    labIds: Array.from(labs.values()).filter((l) => l.pack === p.metadata.id).map((l) => l.lab.metadata.id),
  }));

  return { labs, skills, requires, competencies, frameworks, packs: contentPacks, paths, domains, summaries, issues };
}
