import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { validateLab, referencedParams } from "@cloudtrain/lab-schema";
import { scanText } from "./denylist.mjs";

/** @typedef {{ level: "error" | "warn", file: string, path?: string, message: string }} Finding */

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

/** Loads content/frameworks/*.yaml; returns Set of 'fw:objective' refs. */
export async function checkFrameworks(contentDir, skills, findings) {
  const dir = path.join(contentDir, "frameworks");
  const refs = new Set();
  if (!existsSync(dir)) return refs;
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".yaml")).sort()) {
    const file = path.join(dir, name);
    const doc = await loadYaml(file, findings);
    if (!doc) continue;
    if (doc.id !== path.basename(name, ".yaml")) findings.push({ level: "error", file, message: `framework id '${doc.id}' must match file name` });
    for (const o of doc.objectives ?? []) {
      const ref = `${doc.id}:${o.id}`;
      if (refs.has(ref)) findings.push({ level: "error", file, path: o.id, message: `duplicate objective '${ref}'` });
      refs.add(ref);
      if (!o.skills?.length) findings.push({ level: "warn", file, path: o.id, message: "objective maps to no skills" });
      for (const s of o.skills ?? []) {
        if (!skills.has(s)) findings.push({ level: "error", file, path: o.id, message: `unknown skill '${s}'` });
      }
    }
  }
  return refs;
}

/** Validates one lab directory. */
export async function checkLab(labFile, skills, frameworkRefs, findings) {
  const doc = await loadYaml(labFile, findings);
  if (!doc) return undefined;
  const { valid, issues } = validateLab(doc);
  for (const i of issues) findings.push({ level: "error", file: labFile, path: i.path, message: i.message });
  if (!valid) return doc;

  const dirName = path.basename(path.dirname(labFile));
  if (doc.metadata.id !== dirName) findings.push({ level: "error", file: labFile, path: "/metadata/id", message: `id '${doc.metadata.id}' must match directory '${dirName}'` });

  for (const f of doc.metadata.frameworks ?? []) {
    if (!frameworkRefs.has(f)) findings.push({ level: "error", file: labFile, path: "/metadata/frameworks", message: `unknown framework objective '${f}'` });
  }

  const spec = doc.spec;
  const checkIds = new Set();
  spec.checks.forEach((c, i) => {
    if (checkIds.has(c.id)) findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/id`, message: `duplicate check id '${c.id}'` });
    checkIds.add(c.id);
    for (const s of c.skills) {
      if (!skills.has(s)) findings.push({ level: "error", file: labFile, path: `/spec/checks/${i}/skills`, message: `unknown skill '${s}'` });
    }
  });

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
    ...(spec.misconceptions ?? []).filter((m) => m.mutation).map((m, i) => [`misconceptions/${i}/mutation`, [m.mutation]]),
  ];
  for (const [where, list] of actions) {
    list.forEach((a, i) => {
      resolveOn(a.on, `/spec/${where}/${i}/on`);
      if (a.file?.source) {
        const src = path.resolve(path.dirname(labFile), a.file.source);
        if (!src.startsWith(path.dirname(labFile) + path.sep) || !existsSync(src)) {
          findings.push({ level: "error", file: labFile, path: `/spec/${where}/${i}/file/source`, message: `asset '${a.file.source}' not found beside lab.yaml` });
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
  });

  // Params: every {{ref}} declared; every declared param used.
  const used = referencedParams(doc);
  const declared = new Set(Object.keys(spec.params ?? {}));
  for (const u of used) if (!declared.has(u)) findings.push({ level: "error", file: labFile, path: "/spec/params", message: `'{{${u}}}' is referenced but not declared` });
  for (const d of declared) if (!used.has(d)) findings.push({ level: "warn", file: labFile, path: `/spec/params/${d}`, message: "declared but never referenced" });
  for (const [name, p] of Object.entries(spec.params ?? {})) {
    if (p.type === "choice" && !(p.values?.length > 0)) findings.push({ level: "error", file: labFile, path: `/spec/params/${name}`, message: "choice param needs values" });
    if (p.type === "int" && !(Number.isInteger(p.min) && Number.isInteger(p.max) && p.min <= p.max)) findings.push({ level: "error", file: labFile, path: `/spec/params/${name}`, message: "int param needs min <= max" });
  }

  // Authoring quality bar for the pack.
  if (!spec.hints?.length) findings.push({ level: "warn", file: labFile, message: "no hints" });
  if (!spec.misconceptions?.some((m) => m.mutation)) findings.push({ level: "warn", file: labFile, message: "no misconception with a mutation" });

  return doc;
}

/** Checks pack.yaml course membership against the labs on disk. */
export async function checkPack(packDir, labIds, findings) {
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
  for (const l of labIds) if (!inCourses.has(l)) findings.push({ level: "warn", file, message: `lab '${l}' is not in any course` });
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

/** Full run over a content directory. */
export async function verifyContent(contentDir) {
  /** @type {Finding[]} */
  const findings = [];
  const skills = await checkSkills(contentDir, findings);
  const frameworkRefs = await checkFrameworks(contentDir, skills, findings);
  const labs = [];
  const packsDir = path.join(contentDir, "packs");
  for (const pack of existsSync(packsDir) ? (await readdir(packsDir)).sort() : []) {
    const packDir = path.join(packsDir, pack);
    const labsDir = path.join(packDir, "labs");
    const labIds = new Set();
    for (const lab of existsSync(labsDir) ? (await readdir(labsDir)).sort() : []) {
      const labFile = path.join(labsDir, lab, "lab.yaml");
      if (!existsSync(labFile)) {
        findings.push({ level: "error", file: path.join(labsDir, lab), message: "missing lab.yaml" });
        continue;
      }
      const before = findings.filter((f) => f.level === "error").length;
      const doc = await checkLab(labFile, skills, frameworkRefs, findings);
      const ok = findings.filter((f) => f.level === "error").length === before;
      labs.push({ file: labFile, id: doc?.metadata?.id ?? lab, ok, checks: doc?.spec?.checks?.length ?? 0 });
      labIds.add(lab);
    }
    await checkPack(packDir, labIds, findings);
  }
  const denylistHits = await scanDenylist(contentDir);
  return { skills: skills.size, frameworks: frameworkRefs.size, labs, findings, denylistHits };
}
