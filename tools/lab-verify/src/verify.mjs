import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { validateLab, referencedParams } from "@cloudtrain/lab-schema";
import { scanText } from "./denylist.mjs";
import { checkCurriculum } from "./curriculum.mjs";

/** @typedef {{ level: "error" | "warn" | "info", file: string, path?: string, message: string }} Finding */

/** A check tagged with more skills than this is probably padded. */
export const MAX_CHECK_SKILLS = 4;

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

async function loadYaml(file, findings) {
  try {
    const doc = YAML.parse(await readFile(file, "utf8"), { prettyErrors: true });
    return doc;
  } catch (err) {
    findings.push({ level: "error", file, message: `YAML parse error: ${err.message}` });
    return undefined;
  }
}

/** Loads content/skills.yaml and checks ids, prerequisite edges and acyclicity. */
export async function checkSkills(contentDir, findings) {
  const file = path.join(contentDir, "skills.yaml");
  const doc = await loadYaml(file, findings);
  const skills = new Map();
  if (!doc) return skills;
  const ids = new Set();
  const dup = (id, where) => {
    if (ids.has(id)) findings.push({ level: "error", file, path: where, message: `duplicate id '${id}'` });
    ids.add(id);
  };
  for (const d of doc.domains ?? []) {
    dup(d.id, d.id);
    for (const c of d.competencies ?? []) {
      dup(c.id, c.id);
      if (!c.id.startsWith(`${d.id}.`)) findings.push({ level: "error", file, path: c.id, message: `competency id must start with '${d.id}.'` });
      for (const s of c.skills ?? []) {
        dup(s.id, s.id);
        if (!s.id.startsWith(`${c.id}.`)) findings.push({ level: "error", file, path: s.id, message: `skill id must start with '${c.id}.'` });
        skills.set(s.id, s);
      }
    }
  }
  for (const [id, s] of skills) {
    for (const r of s.requires ?? []) {
      if (!skills.has(r)) findings.push({ level: "error", file, path: id, message: `requires unknown skill '${r}'` });
    }
  }
  // cycle detection (DFS, colour marking)
  const colour = new Map();
  const visit = (id, stack) => {
    colour.set(id, 1);
    for (const r of skills.get(id)?.requires ?? []) {
      if (!skills.has(r)) continue;
      if (colour.get(r) === 1) {
        findings.push({ level: "error", file, path: id, message: `prerequisite cycle: ${[...stack, id, r].join(" -> ")}` });
      } else if (!colour.get(r)) visit(r, [...stack, id]);
    }
    colour.set(id, 2);
  };
  for (const id of skills.keys()) if (!colour.get(id)) visit(id, []);
  return skills;
}

/**
 * Loads the hand-written content/frameworks/*.yaml; returns Map of 'fw:objective' ref -> Set of skill ids.
 * Files generated from content/curriculum.yaml (`generatedFrom`) are skipped: their objectives
 * resolve as curriculum-declared frameworks.
 * Topics are either plain strings or `{id, title, skills}`; structured topics must only
 * use skills the objective lists, and every objective skill should belong to a topic.
 */
export async function checkFrameworks(contentDir, skills, findings) {
  const dir = path.join(contentDir, "frameworks");
  const refs = new Map();
  if (!existsSync(dir)) return refs;
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".yaml")).sort()) {
    const file = path.join(dir, name);
    const doc = await loadYaml(file, findings);
    if (!doc) continue;
    if (doc.id !== path.basename(name, ".yaml")) findings.push({ level: "error", file, message: `framework id '${doc.id}' must match file name` });
    // Generated from a content/curriculum.yaml framework (tools/curriculum/render.mjs): the curriculum
    // entry is validated as the source, and `render.mjs --check` keeps this file in step with it.
    if (doc.generatedFrom === "content/curriculum.yaml") continue;
    for (const o of doc.objectives ?? []) {
      const ref = `${doc.id}:${o.id}`;
      if (refs.has(ref)) findings.push({ level: "error", file, path: o.id, message: `duplicate objective '${ref}'` });
      const own = new Set(o.skills ?? []);
      refs.set(ref, own);
      if (!own.size) findings.push({ level: "warn", file, path: o.id, message: "objective maps to no skills" });
      for (const s of own) {
        if (!skills.has(s)) findings.push({ level: "error", file, path: o.id, message: `unknown skill '${s}'` });
      }
      const structured = (o.topics ?? []).filter((t) => t && typeof t === "object");
      if (!structured.length) continue;
      const inTopics = new Set();
      const topicIds = new Set();
      for (const t of structured) {
        const where = `${o.id}/${t.id ?? "?"}`;
        if (!t.id) findings.push({ level: "error", file, path: where, message: "topic needs an id" });
        else if (topicIds.has(t.id)) findings.push({ level: "error", file, path: where, message: `duplicate topic '${t.id}'` });
        topicIds.add(t.id);
        if (!t.skills?.length) findings.push({ level: "warn", file, path: where, message: "topic maps to no skills" });
        for (const s of t.skills ?? []) {
          inTopics.add(s);
          if (!skills.has(s)) findings.push({ level: "error", file, path: where, message: `unknown skill '${s}'` });
          else if (!own.has(s)) findings.push({ level: "error", file, path: where, message: `topic skill '${s}' is missing from the objective's skills` });
        }
      }
      for (const s of own) {
        if (!inTopics.has(s)) findings.push({ level: "warn", file, path: o.id, message: `skill '${s}' belongs to no topic` });
      }
    }
  }
  return refs;
}

/**
 * Returns the RE2-incompatible features used by a regex (JS syntax), e.g.
 * backreferences and lookaround. Escapes and character classes are respected.
 * @param {string} re
 */
export function re2Problems(re) {
  const found = new Set();
  let inClass = false;
  for (let i = 0; i < re.length; i++) {
    const ch = re[i];
    if (ch === "\\") {
      const next = re[i + 1] ?? "";
      if (/[1-9]/.test(next)) found.add(`backreference '\\${next}'`);
      else if (next === "k" && re[i + 2] === "<") found.add("named backreference '\\k<...>'");
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      if (re[i + 1] === "^") i++;
      if (re[i + 1] === "]") i++; // literal ] first in class
      continue;
    }
    if (ch === "(" && re[i + 1] === "?") {
      const rest = re.slice(i + 2, i + 4);
      if (rest.startsWith("=")) found.add("lookahead '(?=...)'");
      else if (rest.startsWith("!")) found.add("negative lookahead '(?!...)'");
      else if (rest === "<=") found.add("lookbehind '(?<=...)'");
      else if (rest === "<!") found.add("negative lookbehind '(?<!...)'");
      else if (rest.startsWith(">")) found.add("atomic group '(?>...)'");
      continue;
    }
    if ("*+?}".includes(ch) && re[i + 1] === "+" && i > 0) found.add("possessive quantifier");
  }
  return [...found];
}

/**
 * Loads deploy/images/catalog.yaml. Returns `{ file, images: Map<ref, entry>, workload: Set<ref> }`,
 * or undefined (with a warning) when the catalog is missing.
 */
export async function loadCatalog(catalogFile, findings) {
  if (!catalogFile || !existsSync(catalogFile)) {
    findings.push({ level: "warn", file: catalogFile ?? "deploy/images/catalog.yaml", message: "image catalog not found; image refs were not checked" });
    return undefined;
  }
  const doc = await loadYaml(catalogFile, findings);
  if (!doc) return undefined;
  return {
    file: catalogFile,
    images: new Map(Object.entries(doc.images ?? {})),
    workload: new Set((doc.workloadImages ?? []).map(String)),
  };
}

const minorOf = (v) => String(v ?? "").replace(/^v/, "").split(".").slice(0, 2).join(".");

/**
 * Container image refs a text creates Pods with: `--image=X`, JSON `"image":"X"` and
 * YAML `image: X` (block or flow style). Refs with unresolved params or shell
 * variables are skipped. Jsonpath like `{.spec.containers[0].image}` never matches.
 * @param {string} text
 */
export function podImageRefs(text) {
  const refs = new Set();
  const patterns = [/--image[= ]+['"]?([^\s'"]+)/g, /"image"\s*:\s*"([^"]+)"/g, /(?<![\w.-])image:\s*['"]?([^\s'",}\]#]+)/g];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const ref = m[1];
      if (ref.includes("{{") || ref.includes("$") || ref.includes("<")) continue;
      refs.add(ref);
    }
  }
  return refs;
}

/** Validates one lab directory. */
export async function checkLab(labFile, skills, frameworkRefs, findings, ctx = {}) {
  const doc = await loadYaml(labFile, findings);
  if (!doc) return undefined;
  const { valid, issues } = validateLab(doc);
  for (const i of issues) findings.push({ level: "error", file: labFile, path: i.path, message: i.message });
  if (!valid) return doc;

  const dirName = path.basename(path.dirname(labFile));
  if (doc.metadata.id !== dirName) findings.push({ level: "error", file: labFile, path: "/metadata/id", message: `id '${doc.metadata.id}' must match directory '${dirName}'` });

  // Approved-curriculum references: framework objectives declared in content/curriculum.yaml
  // `frameworks` and skills in its `newSkills` are valid until merged into content/.
  const curFw = ctx.curriculumFrameworkRefs ?? new Set();
  const curSkills = ctx.curriculumSkills ?? new Set();
  for (const f of doc.metadata.frameworks ?? []) {
    // Objectives may also come from frameworks declared only in content/curriculum.yaml
    // (CloudTrain's own capstone frameworks, e.g. ct-platform); those carry no skill map.
    if (!frameworkRefs.has(f) && !curFw.has(f)) findings.push({ level: "error", file: labFile, path: "/metadata/frameworks", message: `unknown framework objective '${f}'` });
  }

  const spec = doc.spec;
  const checkIds = new Set();
  spec.checks.forEach((c, i) => {
    if (checkIds.has(c.id)) findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/id`, message: `duplicate check id '${c.id}'` });
    checkIds.add(c.id);
    for (const s of c.skills) {
      if (!skills.has(s) && !curSkills.has(s)) findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/skills`, message: `unknown skill '${s}'` });
      ctx.usedSkills?.add(s);
    }
    if (new Set(c.skills).size !== c.skills.length) findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/skills`, message: "duplicate skill" });
    if (c.skills.length > MAX_CHECK_SKILLS) {
      findings.push({ level: "warn", file: labFile, path: `/spec/checks/${i}/skills`, message: `check '${c.id}' is tagged with ${c.skills.length} skills (max ${MAX_CHECK_SKILLS}); tag only what it gives evidence for` });
    }
  });

  // Framework objectives must share at least one skill with the lab's checks.
  const labSkills = new Set(spec.checks.flatMap((c) => c.skills));
  for (const f of doc.metadata.frameworks ?? []) {
    const objSkills = frameworkRefs.get(f);
    if (objSkills && ![...objSkills].some((s) => labSkills.has(s))) {
      findings.push({ level: "warn", file: labFile, path: "/metadata/frameworks", message: `'${f}' maps none of the skills this lab's checks are tagged with` });
    }
  }

  // Node references in actions and checks must resolve to topology nodes.
  const nodes = new Map(spec.topology.nodes.map((n) => [n.name, n]));
  if (spec.topology.entry && !nodes.has(spec.topology.entry)) {
    findings.push({ level: "error", file: labFile, path: "/spec/topology/entry", message: `entry '${spec.topology.entry}' is not a node` });
  }
  const resolveOn = (on, where) => {
    if (on === undefined) return;
    const [top, sub] = on.split("/");
    const node = nodes.get(top);
    if (!node) return findings.push({ level: "error", file: labFile, path: where, message: `unknown node '${on}'` });
    if (sub !== undefined) {
      const members = node.cluster?.nodes?.map((m) => m.name) ?? [];
      if (node.driver !== "k8s-cluster" || node.cluster?.mode !== "kubeadm") {
        findings.push({ level: "error", file: labFile, path: where, message: `'${on}': only kubeadm clusters have addressable member nodes` });
      } else if (!members.includes(sub)) {
        findings.push({ level: "error", file: labFile, path: where, message: `'${sub}' is not a member node of '${top}'` });
      }
    }
  };
  const actions = [
    ["setup", spec.setup ?? []],
    ["teardown", spec.teardown ?? []],
    ["solution/steps", spec.solution.steps],
    ...(spec.solution.alternatives ?? []).map((a, i) => [`solution/alternatives/${i}/steps`, a.steps ?? []]),
    // Map before filtering so the path index matches the misconception's position.
    ...(spec.misconceptions ?? []).map((m, i) => [`misconceptions/${i}/mutation`, m.mutation ? [m.mutation] : []]),
  ];
  for (const [where, list] of actions) {
    list.forEach((a, i) => {
      const at = where.endsWith("/mutation") ? `/spec/${where}` : `/spec/${where}/${i}`;
      resolveOn(a.on, `${at}/on`);
      if (a.file?.source) {
        const src = path.resolve(path.dirname(labFile), a.file.source);
        if (!src.startsWith(path.dirname(labFile) + path.sep) || !existsSync(src)) {
          findings.push({ level: "error", file: labFile, path: `${at}/file/source`, message: `asset '${a.file.source}' not found beside lab.yaml` });
        }
      }
    });
  }
  spec.checks.forEach((c, i) => {
    resolveOn(c.on, `/spec/checks/${i}/on`);
    if (c.query?.cluster && nodes.get(c.query.cluster)?.driver !== "k8s-cluster") {
      findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/query/cluster`, message: `'${c.query.cluster}' is not a k8s-cluster node` });
    }
    if (["shell", "k8s-context", "file", "service-state", "reachability", "device-cmd"].includes(c.type) && !c.on) {
      findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}`, message: `check type '${c.type}' needs 'on'` });
    }
    if (["k8s-query", "k8s-can-i"].includes(c.type) && !c.query?.cluster) {
      findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}`, message: `check type '${c.type}' needs query.cluster` });
    }
    // The grader and orchestrator are Go: regex expectations must compile under RE2.
    if (c.expect?.match === "regex") {
      for (const problem of re2Problems(c.expect.value)) {
        findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/expect/value`, message: `regex uses ${problem}, which Go's RE2 does not support` });
      }
    }
  });

  // Images: node images and every Pod image must come from deploy/images/catalog.yaml
  // (lab VMs have no internet, so an unlisted image can never be pulled).
  const catalog = ctx.catalog;
  if (catalog) {
    spec.topology.nodes.forEach((n, i) => {
      const where = `/spec/topology/nodes/${i}/image`;
      const kubeadm = n.driver === "k8s-cluster" && n.cluster?.mode === "kubeadm";
      if (!n.image) {
        if (kubeadm) findings.push({ level: "error", file: labFile, path: where, message: `kubeadm cluster '${n.name}' needs a catalog image (e.g. kubeadm:1.37)` });
        return;
      }
      const entry = catalog.images.get(n.image);
      if (!entry) {
        findings.push({ level: "error", file: labFile, path: where, message: `image '${n.image}' is not in ${path.basename(catalog.file)}` });
        return;
      }
      if (kubeadm && entry.kubernetesVersion && n.cluster?.version && minorOf(entry.kubernetesVersion) !== minorOf(n.cluster.version)) {
        findings.push({ level: "error", file: labFile, path: `/spec/topology/nodes/${i}/cluster/version`, message: `cluster version '${n.cluster.version}' does not match image '${n.image}' (${entry.kubernetesVersion})` });
      }
    });
    const texts = [];
    for (const [where, list] of actions) {
      list.forEach((a, i) => {
        const at = where.endsWith("/mutation") ? `/spec/${where}` : `/spec/${where}/${i}`;
        for (const t of [a.run, a.apply, a.file?.content]) if (t) texts.push([at, t]);
      });
    }
    (spec.hints ?? []).forEach((h, i) => h.command && texts.push([`/spec/hints/${i}/command`, h.command]));
    // Pods only exist in labs with a Kubernetes cluster. Docker host labs (e.g. Compose
    // files with `image:` lines) build or preload their images on the VM itself.
    const hasCluster = spec.topology.nodes.some((n) => n.driver === "k8s-cluster");
    for (const [at, t] of hasCluster ? texts : []) {
      for (const ref of podImageRefs(t)) {
        if (!catalog.workload.has(ref)) {
          findings.push({ level: "error", file: labFile, path: at, message: `Pod image '${ref}' is not in workloadImages of ${path.basename(catalog.file)}` });
        }
      }
    }
  }

  // Misconceptions: every one should be a mutation test aimed at specific checks.
  const contextChecks = spec.checks.filter((c) => c.type === "k8s-context");
  (spec.misconceptions ?? []).forEach((m, i) => {
    const where = `/spec/misconceptions/${i}`;
    if (!m.mutation) {
      findings.push({ level: "warn", file: labFile, path: where, message: `misconception '${m.id}' has no mutation, so nothing proves a check catches it` });
      return;
    }
    for (const id of m.expectFail ?? []) {
      if (!checkIds.has(id)) findings.push({ level: "error", file: labFile, path: `${where}/expectFail`, message: `unknown check '${id}'` });
    }
    const aimed = (m.expectFail ?? []).filter((id) => !contextChecks.some((c) => c.id === id));
    if (contextChecks.length && (m.expectFail ?? []).length && !aimed.length) {
      findings.push({ level: "warn", file: labFile, path: `${where}/expectFail`, message: `misconception '${m.id}' is only caught by the context check` });
    }
    // A mutation that never switches context fails the context check for free, which hides weak checks.
    const text = JSON.stringify(m.mutation);
    for (const c of contextChecks) {
      const want = c.expect?.value;
      if (want && !(m.expectFail ?? []).includes(c.id) && !text.includes(`use-context ${want}`)) {
        findings.push({ level: "warn", file: labFile, path: `${where}/mutation`, message: `mutation does not run 'kubectl config use-context ${want}' like the solution, so it fails check '${c.id}' regardless` });
      }
    }
  });

  // Params: every {{ref}} declared; every declared param used.
  const used = referencedParams(doc);
  // file.source assets are templated too (platform round 3), so their {{refs}} count.
  const sources = [...(spec.setup ?? []), ...(spec.teardown ?? [])].map((a) => a?.file?.source).filter(Boolean);
  for (const src of new Set(sources)) {
    const f = path.join(path.dirname(labFile), src);
    if (!existsSync(f)) continue;
    const text = await readFile(f, "utf8").catch(() => "");
    for (const m of text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) used.add(m[1]);
  }
  const declared = new Set(Object.keys(spec.params ?? {}));
  for (const u of used) if (!declared.has(u)) findings.push({ level: "error", file: labFile, path: "/spec/params", message: `'{{${u}}}' is referenced but not declared` });
  for (const d of declared) if (!used.has(d)) findings.push({ level: "warn", file: labFile, path: `/spec/params/${d}`, message: "declared but never referenced" });
  for (const [name, p] of Object.entries(spec.params ?? {})) {
    if (p.type === "choice" && !(p.values?.length > 0)) findings.push({ level: "error", file: labFile, path: `/spec/params/${name}`, message: "choice param needs values" });
    if (p.type === "int" && !(Number.isInteger(p.min) && Number.isInteger(p.max) && p.min <= p.max)) findings.push({ level: "error", file: labFile, path: `/spec/params/${name}`, message: "int param needs min <= max" });
  }

  // Authoring quality bar for the pack. Exam tasks (curriculum type exam, or
  // tag `exam`) are graded without help, so they must have no hints instead.
  const isExam = ctx.examTasks?.has(doc.metadata.id) || (doc.metadata?.tags ?? []).includes("exam");
  if (isExam) {
    if (spec.hints?.length) findings.push({ level: "error", file: labFile, path: "/spec/hints", message: "exam task must not have hints" });
  } else if (!spec.hints?.length) findings.push({ level: "warn", file: labFile, message: "no hints" });
  if (!spec.misconceptions?.length) findings.push({ level: "warn", file: labFile, message: "no misconceptions" });

  return doc;
}

/** Checks pack.yaml course membership against the labs on disk. */
export async function checkPack(packDir, labIds, findings, examTasks = new Set()) {
  const file = path.join(packDir, "pack.yaml");
  if (!existsSync(file)) {
    findings.push({ level: "error", file: packDir, message: "missing pack.yaml" });
    return;
  }
  const doc = await loadYaml(file, findings);
  if (!doc) return;
  const inCourses = new Set();
  for (const c of doc.courses ?? []) {
    for (const l of c.labs ?? []) {
      if (!labIds.has(l)) findings.push({ level: "error", file, path: c.id, message: `course lists unknown lab '${l}'` });
      inCourses.add(l);
    }
  }
  // Exam tasks are drawn by exam simulations, never taken from a course.
  for (const l of examTasks) if (labIds.has(l) && inCourses.has(l)) findings.push({ level: "error", file, message: `exam task '${l}' must not be in a course` });
  for (const l of labIds) if (!inCourses.has(l) && !examTasks.has(l)) findings.push({ level: "warn", file, message: `lab '${l}' is not in any course` });
  const courseIds = new Set((doc.courses ?? []).map((c) => c.id));
  for (const p of doc.paths ?? []) {
    for (const c of p.courses ?? []) if (!courseIds.has(c)) findings.push({ level: "error", file, path: p.id, message: `path lists unknown course '${c}'` });
  }
}

/** Runs the denylist over every text file under contentDir. */
export async function scanDenylist(contentDir) {
  const hits = [];
  for (const file of await walk(contentDir)) {
    if ((await stat(file)).size > 2_000_000) continue;
    const text = await readFile(file, "utf8");
    if (text.includes("\0")) continue; // binary
    for (const h of scanText(text)) hits.push({ file, ...h });
    // file names are content too
    for (const h of scanText(path.relative(contentDir, file))) hits.push({ file, ...h, line: 0 });
  }
  return hits;
}

/**
 * Full run over a content directory.
 * @param {string} contentDir
 * @param {{ catalogFile?: string }} [opts] catalogFile defaults to ../deploy/images/catalog.yaml beside contentDir.
 */
export async function verifyContent(contentDir, opts = {}) {
  /** @type {Finding[]} */
  const findings = [];
  const skills = await checkSkills(contentDir, findings);
  const frameworkRefs = await checkFrameworks(contentDir, skills, findings);
  const catalog = await loadCatalog(opts.catalogFile ?? path.resolve(contentDir, "../deploy/images/catalog.yaml"), findings);
  const usedSkills = new Set();
  const labs = [];
  // Exam tasks (curriculum labs of type exam) follow exam rules: no hints, no course.
  const examTasks = new Set();
  // The approved curriculum's own framework objectives and newSkills are valid lab references.
  const curriculumFrameworkRefs = new Set();
  const curriculumSkills = new Set();
  const curriculumFile = path.join(contentDir, "curriculum.yaml");
  if (existsSync(curriculumFile)) {
    const cur = await loadYaml(curriculumFile, []);
    for (const l of cur?.labs ?? []) if (l?.type === "exam") examTasks.add(l.id);
    for (const f of cur?.frameworks ?? []) for (const o of f?.objectives ?? []) curriculumFrameworkRefs.add(`${f.id}:${o.id}`);
    for (const k of cur?.newSkills ?? []) if (k?.id) curriculumSkills.add(k.id);
  }
  /** @type {Map<string, { domain?: string, frameworks?: string[] }>} */
  const packLabs = new Map();
  const packsDir = path.join(contentDir, "packs");
  for (const pack of existsSync(packsDir) ? (await readdir(packsDir)).sort() : []) {
    const packDir = path.join(packsDir, pack);
    const labsDir = path.join(packDir, "labs");
    const labIds = new Set();
    const examIds = new Set();
    for (const lab of existsSync(labsDir) ? (await readdir(labsDir)).sort() : []) {
      const labFile = path.join(labsDir, lab, "lab.yaml");
      if (!existsSync(labFile)) {
        findings.push({ level: "error", file: path.join(labsDir, lab), message: "missing lab.yaml" });
        continue;
      }
      const before = findings.filter((f) => f.level === "error").length;
      const doc = await checkLab(labFile, skills, frameworkRefs, findings, { catalog, usedSkills, examTasks, curriculumFrameworkRefs, curriculumSkills });
      const ok = findings.filter((f) => f.level === "error").length === before;
      labs.push({ file: labFile, id: doc?.metadata?.id ?? lab, ok, checks: doc?.spec?.checks?.length ?? 0 });
      packLabs.set(doc?.metadata?.id ?? lab, { domain: doc?.metadata?.domain, frameworks: doc?.metadata?.frameworks ?? [], images: [...new Set((doc?.spec?.topology?.nodes ?? []).map((n) => n.image).filter(Boolean))] });
      labIds.add(lab);
      if ((doc?.metadata?.tags ?? []).includes("exam")) examIds.add(lab);
    }
    await checkPack(packDir, labIds, findings, new Set([...examTasks, ...examIds]));
  }
  // Info only: skills no lab gives evidence for yet (the lab backlog).
  const skillsFile = path.join(contentDir, "skills.yaml");
  for (const id of skills.keys()) {
    if (!usedSkills.has(id)) findings.push({ level: "info", file: skillsFile, path: id, message: "no lab check is tagged with this skill" });
  }
  // The curriculum (proposal and source of truth for paths and exams), when present.
  const curriculum = await checkCurriculum(path.join(contentDir, "curriculum.yaml"), { skills, frameworkRefs, catalog, packLabs }, findings);
  const denylistHits = await scanDenylist(contentDir);
  return { skills: skills.size, frameworks: frameworkRefs.size, labs, curriculum, findings, denylistHits };
}
