import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { Curriculum } from '@cloudtrain/lab-schema';
import type { ExamDomain, ExamObjectiveInfo, ExamRules, RetakePolicy } from '@cloudtrain/api-types';
import type { Content } from '../content/load.js';

/** One entry of `exams` in content/curriculum.yaml (packages/lab-schema curriculum schema). */
export type ExamDefinition = Curriculum['exams'][number];

/** An exam definition plus where it came from and what the catalog knows about it. */
export interface CatalogExam {
  def: ExamDefinition;
  /** File holding the definition (`labctl exam compile --exams`). */
  file: string;
  /** Pool tasks that have a lab in the content (per objective). */
  available: Map<string, string[]>;
  availability: 'available' | 'coming-soon';
  availabilityNote?: string;
}

export interface ExamCatalog {
  exams: Map<string, CatalogExam>;
  /** Objective ref ("cka:storage") -> human name, from content/frameworks and the curriculum. */
  objectiveNames: Map<string, string>;
  /** Lab ids per objective ref (non-exam labs), for report recommendations. */
  labsByObjective: Map<string, string[]>;
  issues: { file: string; message: string }[];
}

async function readExams(file: string): Promise<{ exams: ExamDefinition[]; frameworks: Curriculum['frameworks'] }> {
  // `yaml` parses YAML 1.2 (envTier `N` stays a string) and resolves the anchors shared rules use.
  const doc = parse(await readFile(file, 'utf8'), { maxAliasCount: -1 }) as Partial<Curriculum> | null;
  return { exams: doc?.exams ?? [], frameworks: doc?.frameworks ?? [] };
}

async function frameworkObjectiveNames(contentDir: string, into: Map<string, string>): Promise<void> {
  const dir = path.join(contentDir, 'frameworks');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.yaml'));
  } catch {
    return;
  }
  for (const f of files) {
    const doc = parse(await readFile(path.join(dir, f), 'utf8')) as { id?: string; objectives?: { id: string; title: string }[] } | null;
    if (!doc?.id) continue;
    for (const o of doc.objectives ?? []) into.set(`${doc.id}:${o.id}`, o.title);
  }
}

/**
 * Reads exam simulations from the curriculum plus any extra exam files (for
 * example the orchestrator's test exam). An exam is `available` when every
 * objective's pool has at least as many tasks with a lab in the content as
 * it draws.
 */
export async function loadExamCatalog(content: Content, contentDir: string, curriculumFile: string, extraFiles: string[] = []): Promise<ExamCatalog> {
  const cat: ExamCatalog = { exams: new Map(), objectiveNames: new Map(), labsByObjective: new Map(), issues: [] };
  await frameworkObjectiveNames(contentDir, cat.objectiveNames);
  for (const file of [curriculumFile, ...extraFiles]) {
    let parsed: Awaited<ReturnType<typeof readExams>>;
    try {
      parsed = await readExams(file);
    } catch (e) {
      cat.issues.push({ file, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const fw of parsed.frameworks ?? []) {
      for (const o of fw.objectives ?? []) {
        const ref = `${fw.id}:${o.id}`;
        if (!cat.objectiveNames.has(ref)) cat.objectiveNames.set(ref, o.title);
      }
    }
    for (const def of parsed.exams) {
      const available = new Map<string, string[]>();
      const short: string[] = [];
      for (const o of def.blueprint) {
        const have = o.pool.filter((id) => content.labs.has(id));
        available.set(o.objective, have);
        if (have.length < o.tasks) short.push(`${o.objective} (${have.length}/${o.tasks})`);
      }
      cat.exams.set(def.id, {
        def,
        file,
        available,
        availability: short.length === 0 ? 'available' : 'coming-soon',
        ...(short.length ? { availabilityNote: `Exam tasks are still being authored for ${short.length} of ${def.blueprint.length} objectives.` } : {}),
      });
    }
  }
  for (const l of content.labs.values()) {
    for (const ref of l.lab.metadata.frameworks ?? []) {
      if (l.lab.metadata.tags?.includes('exam-fixture')) continue;
      const list = cat.labsByObjective.get(ref) ?? [];
      list.push(l.lab.metadata.id);
      cat.labsByObjective.set(ref, list);
    }
  }
  return cat;
}

export function examRules(def: ExamDefinition): ExamRules {
  const r = def.rules;
  return {
    timer: r.timer,
    anyOrder: r.anyOrder ?? true,
    flagForReview: r.flagForReview ?? true,
    rebootBeforeGrade: r.rebootBeforeGrade,
    idempotencyRerun: r.idempotencyRerun ?? false,
    partialCredit: r.partialCredit ?? 'per-check',
    ...(r.docsAllowed ? { docsAllowed: r.docsAllowed } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
  };
}

export function retakePolicy(def: ExamDefinition): RetakePolicy {
  const p = def.retakePolicy;
  return {
    freeRetakes: p.freeRetakes ?? 0,
    cooldownHours: p.cooldownHours ?? 0,
    maxAttemptsPer30Days: p.maxAttemptsPer30Days ?? 3,
    freshDraw: p.freshDraw,
    ...(p.notes ? { notes: p.notes } : {}),
  };
}

/** Objective weights in percent, normalised over the objectives that draw tasks (as the orchestrator scores). */
export function objectives(cat: ExamCatalog, ex: CatalogExam): ExamObjectiveInfo[] {
  const drawn = ex.def.blueprint.filter((o) => o.tasks > 0);
  const sum = drawn.reduce((a, o) => a + o.weight, 0);
  return ex.def.blueprint.map((o) => ({
    id: o.objective,
    ...(cat.objectiveNames.get(o.objective) ? { name: cat.objectiveNames.get(o.objective)! } : {}),
    weight: o.tasks > 0 ? Math.round((sum > 0 ? (100 * o.weight) / sum : 100 / drawn.length) * 10) / 10 : 0,
    tasks: o.tasks,
    poolSize: o.pool.length,
  }));
}

export const examDomain = (def: ExamDefinition): ExamDomain => def.domain as ExamDomain;
