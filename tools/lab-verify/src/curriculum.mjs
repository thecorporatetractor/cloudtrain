// Cross-checks for content/curriculum.yaml (the curriculum proposal / source of truth).
// Shape is validated by the JSON Schema in @cloudtrain/lab-schema; this file checks
// the references the schema cannot see: lab ids, skills, framework refs, images,
// packs, path prerequisites and exam pools.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import YAML from "yaml";
import { validateCurriculum } from "@cloudtrain/lab-schema";

/** Exam names, exam codes and certifying-body names that must not appear in titles. */
export const TITLE_DENY = [
  /\bCKA\b/, /\bCKAD\b/, /\bCKS\b/, /\bKCNA\b/, /\bLFCS\b/, /\bLFCA\b/, /\bRHCSA\b/, /\bRHCE\b/, /\bRHCA\b/,
  /\bEX\d{3}\b/i, /\bXK0-\d{3}\b/i, /Linux\+/, /\bCCNA\b/, /\bCCNP\b/, /\bCisco\b/i, /\bRed Hat\b/i, /\bCompTIA\b/i,
  /\bHashiCorp\b/i, /\bLPIC\b/i, /\bLPI\b/, /\bDCA\b/, /\bDocker Certified\b/i, /\bMirantis\b/i, /\bCNCF\b/,
  /\bLinux Foundation\b/i, /\bcertified\b/i, /\bcertification\b/i, /\bAssociate 00\d\b/i,
];

/** Detects a cycle in a graph given as Map<id, string[]>. Returns the first cycle found, or undefined. */
export function findCycle(edges) {
  const colour = new Map();
  let found;
  const visit = (id, stack) => {
    if (found) return;
    colour.set(id, 1);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      if (colour.get(next) === 1) {
        found = [...stack, id, next];
        return;
      }
      if (!colour.get(next)) visit(next, [...stack, id]);
    }
    colour.set(id, 2);
  };
  for (const id of edges.keys()) if (!colour.get(id)) visit(id, []);
  return found;
}

/**
 * @param {string} file path of content/curriculum.yaml
 * @param {{ skills: Map<string, unknown>, frameworkRefs: Map<string, Set<string>>, catalog?: { images: Map<string, unknown> },
 *           packLabs: Map<string, { domain?: string, frameworks?: string[] }> }} ctx
 * @param {import("./verify.mjs").Finding[]} findings
 */
export async function checkCurriculum(file, ctx, findings) {
  if (!existsSync(file)) return undefined;
  const err = (path, message) => findings.push({ level: "error", file, path, message });
  const warn = (path, message) => findings.push({ level: "warn", file, path, message });
  let doc;
  try {
    doc = YAML.parse(await readFile(file, "utf8"), { prettyErrors: true });
  } catch (e) {
    err(undefined, `YAML parse error: ${e.message}`);
    return undefined;
  }
  const v = validateCurriculum(doc);
  for (const i of v.issues) err(i.path, `schema: ${i.message}`);
  if (!doc || typeof doc !== "object") return undefined;

  const uniq = (list, kind, key = "id") => {
    const m = new Map();
    for (const x of list ?? []) {
      const id = x?.[key];
      if (m.has(id)) err(`${kind}/${id}`, `duplicate ${kind} id '${id}'`);
      m.set(id, x);
    }
    return m;
  };
  const labs = uniq(doc.labs, "lab");
  const paths = uniq(doc.paths, "path");
  const exams = uniq(doc.exams, "exam");
  const domains = uniq(doc.domains, "domain");
  const images = uniq(doc.images, "image", "ref");
  const newSkills = uniq(doc.newSkills, "newSkill");
  const localFw = uniq(doc.frameworks, "framework");
  for (const id of [...paths.keys()].filter((p) => labs.has(p) || exams.has(p))) err(`path/${id}`, `id '${id}' is also used by a lab or exam`);
  for (const id of [...exams.keys()].filter((x) => labs.has(x))) err(`exam/${id}`, `id '${id}' is also used by a lab`);

  // ---- skills
  const graphCompetencies = new Set([...ctx.skills.keys()].map((s) => s.split(".").slice(0, 2).join(".")));
  const declaredCompetencies = new Set();
  for (const d of domains.values()) for (const c of d.competencies ?? []) {
    declaredCompetencies.add(c.id);
    if (!graphCompetencies.has(c.id) && !c.new) err(`domain/${d.id}`, `competency '${c.id}' is not in skills.yaml; mark it new: true`);
    if (graphCompetencies.has(c.id) && c.new) warn(`domain/${d.id}`, `competency '${c.id}' already exists in skills.yaml but is marked new`);
  }
  for (const s of newSkills.values()) {
    if (ctx.skills.has(s.id)) err(`newSkill/${s.id}`, "already exists in skills.yaml");
    if (!s.id.startsWith(`${s.competency}.`)) err(`newSkill/${s.id}`, `id must start with its competency '${s.competency}.'`);
    if (!declaredCompetencies.has(s.competency) && !graphCompetencies.has(s.competency)) err(`newSkill/${s.id}`, `competency '${s.competency}' is not declared by any domain`);
    if (!s.competency.startsWith(`${s.domain}.`)) err(`newSkill/${s.id}`, `competency '${s.competency}' is not in skill domain '${s.domain}'`);
  }
  const allSkills = new Set([...ctx.skills.keys(), ...newSkills.keys()]);
  for (const s of newSkills.values()) for (const r of s.requires ?? []) if (!allSkills.has(r)) err(`newSkill/${s.id}`, `requires unknown skill '${r}'`);
  const skillEdges = new Map();
  for (const [id, s] of ctx.skills) skillEdges.set(id, s.requires ?? []);
  for (const [id, s] of newSkills) skillEdges.set(id, s.requires ?? []);
  const skillCycle = findCycle(skillEdges);
  if (skillCycle) err("newSkills", `prerequisite cycle: ${skillCycle.join(" -> ")}`);

  // ---- frameworks
  const refs = new Set(ctx.frameworkRefs.keys());
  const fwIds = new Set([...refs].map((r) => r.split(":")[0]));
  for (const f of localFw.values()) {
    if (fwIds.has(f.id)) err(`framework/${f.id}`, "already defined in content/frameworks; do not redeclare it");
    const seen = new Set();
    for (const o of f.objectives ?? []) {
      if (seen.has(o.id)) err(`framework/${f.id}`, `duplicate objective '${o.id}'`);
      seen.add(o.id);
      refs.add(`${f.id}:${o.id}`);
    }
    const weights = (f.objectives ?? []).map((o) => o.weight).filter((w) => w !== undefined);
    if (weights.length && Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 0.5) warn(`framework/${f.id}`, "objective weights do not sum to 100");
  }
  for (const f of localFw.keys()) fwIds.add(f);
  const refOk = (r) => refs.has(r);

  // ---- images
  const imageOk = (ref) => ctx.catalog?.images.has(ref) || images.has(ref);
  for (const i of images.values()) if (ctx.catalog?.images.has(i.ref)) warn(`image/${i.ref}`, "already in the image catalog; drop it from the proposal list");

  // ---- labs
  const examPoolOf = new Map();
  for (const x of exams.values()) for (const b of x.blueprint ?? []) for (const l of b.pool ?? []) {
    if (examPoolOf.has(l) && examPoolOf.get(l) !== x.id) err(`exam/${x.id}`, `exam task '${l}' is also in the pool of '${examPoolOf.get(l)}'`);
    examPoolOf.set(l, x.id);
  }
  const usedImages = new Set();
  for (const l of labs.values()) {
    const where = `lab/${l.id}`;
    if (!domains.has(l.domain)) err(where, `domain '${l.domain}' is not declared`);
    for (const s of l.skills ?? []) if (!allSkills.has(s)) err(where, `unknown skill '${s}' (add it to newSkills)`);
    for (const f of l.frameworks ?? []) if (!refOk(f)) err(where, `unknown framework objective '${f}'`);
    for (const i of l.images ?? []) {
      usedImages.add(i);
      if (!imageOk(i)) err(where, `image '${i}' is neither in the catalog nor in the proposed images`);
    }
    for (const d of l.dependsOn ?? []) if (!labs.has(d)) err(where, `dependsOn unknown lab '${d}'`);
    for (const re of TITLE_DENY) if (re.test(l.title ?? "")) err(where, `title names an exam or certifying body (${re}); keep alignment in frameworks`);
    const inPack = ctx.packLabs.get(l.id);
    if (l.status === "built" || l.status === "verified") {
      if (!inPack) err(where, `status '${l.status}' but no lab '${l.id}' exists in content/packs`);
      else {
        if (inPack.domain && inPack.domain !== l.domain) err(where, `domain '${l.domain}' differs from the pack lab's '${inPack.domain}'`);
        const a = [...(inPack.frameworks ?? [])].sort().join(","), b = [...(l.frameworks ?? [])].sort().join(",");
        if (a !== b) warn(where, `frameworks differ from the pack lab (${a})`);
      }
    } else if (inPack) err(where, `a lab '${l.id}' already exists in content/packs; its status must be built or verified`);
    if (l.type === "exam" && !examPoolOf.has(l.id) && !String(l.notes ?? "").startsWith("blocked:")) err(where, "exam task is in no exam pool"); // blocked tasks are held out of the pools until unblocked
    if (l.type !== "exam" && examPoolOf.has(l.id)) err(where, `only type exam labs may be drawn by exams (pool of '${examPoolOf.get(l.id)}')`);
  }
  for (const id of ctx.packLabs.keys()) if (!labs.has(id)) err(`lab/${id}`, `pack lab '${id}' is missing from the curriculum`);
  for (const i of images.keys()) if (!usedImages.has(i)) warn(`image/${i}`, "proposed image is used by no lab");
  const labCycle = findCycle(new Map([...labs.values()].map((l) => [l.id, l.dependsOn ?? []])));
  if (labCycle) err("labs", `dependsOn cycle: ${labCycle.join(" -> ")}`);

  // ---- paths
  const inPaths = new Set();
  for (const p of paths.values()) {
    const where = `path/${p.id}`;
    if (!domains.has(p.domain)) err(where, `domain '${p.domain}' is not declared`);
    for (const q of p.prerequisites ?? []) if (!paths.has(q)) err(where, `prerequisite '${q}' is not a path`);
    for (const f of p.frameworks ?? []) if (f.includes(":") ? !refOk(f) : !fwIds.has(f)) err(where, `unknown framework '${f}'`);
    for (const re of TITLE_DENY) if (re.test(p.title ?? "")) err(where, `title names an exam or certifying body (${re})`);
    const modIds = new Set();
    for (const m of p.modules ?? []) {
      if (modIds.has(m.id)) err(where, `duplicate module '${m.id}'`);
      modIds.add(m.id);
      for (const l of m.labs ?? []) {
        inPaths.add(l);
        if (!labs.has(l)) err(`${where}/${m.id}`, `unknown lab '${l}'`);
        else if (labs.get(l).type === "exam") err(`${where}/${m.id}`, `exam task '${l}' must not appear in a path`);
      }
    }
  }
  const pathCycle = findCycle(new Map([...paths.values()].map((p) => [p.id, p.prerequisites ?? []])));
  if (pathCycle) err("paths", `prerequisite cycle: ${pathCycle.join(" -> ")}`);
  for (const l of labs.values()) if (l.type !== "exam" && !inPaths.has(l.id)) warn(`lab/${l.id}`, "learning lab is in no path");

  // ---- exams
  for (const x of exams.values()) {
    const where = `exam/${x.id}`;
    for (const f of x.alignsTo ?? []) if (!fwIds.has(f)) err(where, `alignsTo unknown framework '${f}'`);
    for (const re of TITLE_DENY) if (re.test(x.title ?? "")) err(where, `title names an exam or certifying body (${re})`);
    let weight = 0, tasks = 0;
    const objectives = new Set();
    for (const b of x.blueprint ?? []) {
      weight += b.weight;
      tasks += b.tasks;
      if (objectives.has(b.objective)) err(where, `objective '${b.objective}' listed twice`);
      objectives.add(b.objective);
      if (!refOk(b.objective)) err(where, `unknown objective '${b.objective}'`);
      else if (!(x.alignsTo ?? []).includes(b.objective.split(":")[0])) err(where, `objective '${b.objective}' is outside alignsTo`);
      const need = b.tasks > 0 ? Math.max(2, 2 * b.tasks) : 0;
      if ((b.pool ?? []).length < need) err(where, `pool for '${b.objective}' has ${b.pool?.length ?? 0} tasks; needs at least ${need} for two disjoint attempts`);
      for (const l of b.pool ?? []) if (!labs.has(l)) err(where, `pool lab '${l}' does not exist`);
    }
    if (Math.abs(weight - 100) > 0.5) err(where, `blueprint weights sum to ${weight}, not 100`);
    if (tasks !== x.taskCount) err(where, `blueprint tasks sum to ${tasks}, taskCount is ${x.taskCount}`);
  }

  const count = (pred) => [...labs.values()].filter(pred).length;
  return {
    labs: labs.size,
    examTasks: count((l) => l.type === "exam"),
    built: count((l) => l.status === "built"),
    verified: count((l) => l.status === "verified"),
    proposed: count((l) => l.status === "proposed"),
    paths: paths.size,
    exams: exams.size,
    newSkills: newSkills.size,
  };
}
