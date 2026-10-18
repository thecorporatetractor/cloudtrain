#!/usr/bin/env node
// Renders content/curriculum.yaml into docs/curriculum.md, the curriculum
// table of README.md (between the curriculum-table markers) and one
// content/frameworks/<id>.yaml per curriculum framework (see frameworks.mjs).
//   node tools/curriculum/render.mjs [--check]
// --check exits 1 when any of them is out of date (for CI).
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { GENERATED_FROM, renderFrameworks } from "./frameworks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// yaml is a dependency of tools/lab-verify; resolve it from there so this script needs no install of its own.
const YAML = createRequire(path.join(root, "tools/lab-verify/package.json"))("yaml");
const src = path.join(root, "content/curriculum.yaml");
const out = path.join(root, "docs/curriculum.md");
const readme = path.join(root, "README.md");
const doc = YAML.parse(readFileSync(src, "utf8"));

const DOMAIN_ORDER = ["kubernetes", "linux", "containers", "iac", "automation", "networking", "secops"];
const TIERS = ["A", "B", "C", "K", "V", "N"];
const TYPES = ["learn", "do", "fix", "hack", "ctf"];
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
const table = (head, rows) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const code = (s) => (s ? `\`${s}\`` : "");
const mix = (counts, order) => order.filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(", ") || "-";
const tally = (list, key) => list.reduce((m, x) => ((m[x[key]] = (m[x[key]] ?? 0) + 1), m), {});

const labs = doc.labs ?? [];
const labById = new Map(labs.map((l) => [l.id, l]));
const domains = [...(doc.domains ?? [])].sort((a, b) => DOMAIN_ORDER.indexOf(a.id) - DOMAIN_ORDER.indexOf(b.id));
const examsOf = (d) => (doc.exams ?? []).filter((x) => x.domain === d);
const pathsOf = (d) => (doc.paths ?? []).filter((p) => p.domain === d);
const learning = (d) => labs.filter((l) => l.domain === d && l.type !== "exam");
const examTasks = (d) => labs.filter((l) => l.domain === d && l.type === "exam");
const fwTitle = new Map((doc.frameworks ?? []).map((f) => [f.id, f.title]));

const lines = [];
const push = (...xs) => lines.push(...xs);

push(
  "# CloudTrain curriculum (proposal)",
  "",
  "<!-- GENERATED from content/curriculum.yaml by tools/curriculum/render.mjs. Do not edit by hand. -->",
  "",
  `Status: **${doc.metadata.status}**, version ${doc.metadata.version}, updated ${doc.metadata.updated}. ` +
    "Source of truth: `content/curriculum.yaml` (schema `packages/lab-schema/schema/curriculum.schema.json`, cross-checked by `tools/lab-verify`).",
  "",
  cell(doc.metadata.summary),
  "",
  "Legend. **Type**: learn = guided first exposure, do = complete a task, fix = repair a broken system, hack = attack then mitigate, exam = exam task (no hints, drawn only by exam simulations). " +
    "**Tier**: " + TIERS.map((t) => `${t} = ${doc.envTiers?.[t]?.title ?? t}`).join(", ") + ". " +
    "**Status**: verified = passed the full verifier cycle on a live stack, built = exists in `content/packs`, proposed = awaiting approval.",
  "",
);

// ---------------------------------------------------------------- summary
push("## Summary", "");
const sumRows = [];
const total = { paths: 0, learn: 0, exam: 0, exams: 0, verified: 0, built: 0, proposed: 0, minutes: 0, tiers: {} };
for (const d of domains) {
  const all = labs.filter((l) => l.domain === d.id);
  const st = tally(all, "status");
  const tiers = tally(all, "envTier");
  const mins = learning(d.id).reduce((a, l) => a + l.minutes, 0);
  sumRows.push([d.title, pathsOf(d.id).length, learning(d.id).length, examTasks(d.id).length, examsOf(d.id).length, st.verified ?? 0, st.built ?? 0, st.proposed ?? 0, mix(tiers, TIERS), (mins / 60).toFixed(0)]);
  total.paths += pathsOf(d.id).length;
  total.learn += learning(d.id).length;
  total.exam += examTasks(d.id).length;
  total.exams += examsOf(d.id).length;
  total.verified += st.verified ?? 0;
  total.built += st.built ?? 0;
  total.proposed += st.proposed ?? 0;
  total.minutes += mins;
  for (const [t, n] of Object.entries(tiers)) total.tiers[t] = (total.tiers[t] ?? 0) + n;
}
const cross = (doc.exams ?? []).filter((x) => x.domain === "cross-domain");
total.exams += cross.length;
sumRows.push(["**Total**", total.paths, total.learn, total.exam, total.exams, total.verified, total.built, total.proposed, mix(total.tiers, TIERS), (total.minutes / 60).toFixed(0)]);
push(
  table(["Domain", "Paths", "Learning labs", "Exam tasks", "Exams", "Verified", "Built", "Proposed", "Tier mix (all labs)", "Learning hours"], sumRows),
  "",
  `Cross-domain exams: ${cross.map((x) => x.title).join(", ") || "none"}. Exam tasks are counted under the domain of each task. ` +
    `Learning labs by type: ${mix(tally(labs.filter((l) => l.type !== "exam"), "type"), TYPES)}. New skills proposed: ${(doc.newSkills ?? []).length}.`,
  "",
);

// ---------------------------------------------------------------- domains
for (const d of domains) {
  push(`## ${d.title}`, "");
  push(cell(d.summary), "");
  if (d.organisation) push(`Fictional organisation: **${d.organisation.name}**${d.organisation.summary ? ` (${cell(d.organisation.summary)})` : ""}.`, "");
  if (d.notes) push(cell(d.notes), "");
  if (d.licensingNote) push(`**Licensing.** ${cell(d.licensingNote)}`, "");
  push(`Competencies: ${d.competencies.map((c) => `${code(c.id)}${c.new ? " (new)" : ""}`).join(", ")}.`, "");

  const ps = pathsOf(d.id);
  push(`### Paths (${ps.length})`, "");
  push(
    table(
      ["Path", "Title", "Level", "Hours", "Labs", "Prerequisites", "Aligns to", "Audience"],
      ps.map((p) => {
        const n = new Set(p.modules.flatMap((m) => m.labs)).size;
        return [code(p.id), p.title + (p.status === "deferred" ? " (deferred)" : ""), p.level, p.estimatedHours, n, p.prerequisites.map(code).join(", ") || "-", p.frameworks.join(", ") || "-", p.audience];
      }),
    ),
    "",
  );
  for (const p of ps) {
    push(`<details><summary><b>${cell(p.title)}</b>: modules</summary>`, "");
    for (const m of p.modules) push(`- **${cell(m.title)}**: ${m.labs.map(code).join(", ")}`);
    if (p.disclaimer) push("", `_${cell(p.disclaimer)}_`);
    if (p.notes) push("", cell(p.notes));
    push("", "</details>", "");
  }

  const ls = learning(d.id);
  push(`### Labs (${ls.length})`, "");
  push(
    table(
      ["Lab", "Title", "Type", "Difficulty", "Min", "Tier", "Status", "Frameworks", "Scenario"],
      ls.map((l) => [code(l.id), l.title, l.type, l.difficulty, l.minutes, l.envTier, l.status, l.frameworks.join(", "), l.oneLine]),
    ),
    "",
  );
}

// ---------------------------------------------------------------- exams
const exams = doc.exams ?? [];
push("## Exam simulations", "");
push(
  table(
    ["Exam", "Title", "Aligns to", "Format", "Duration", "Pass mark", "Tasks", "Pool", "Environment", "Reboot before grade", "Tier"],
    exams.map((x) => {
      const pool = x.blueprint.reduce((a, b) => a + b.pool.length, 0);
      return [code(x.id), x.title, x.alignsTo.join(", "), x.format, `${x.durationMinutes} min`, `${x.passMark}%`, x.taskCount, pool, x.environment, x.rules.rebootBeforeGrade ? "yes" : "no", x.envTier];
    }),
  ),
  "",
);
for (const x of exams) {
  push(`### ${x.title}`, "");
  push(`Aligns to: ${x.alignsTo.map((f) => fwTitle.get(f) ?? f).join("; ")}.`, "");
  if (x.description) push(cell(x.description), "");
  if (x.simulationNote) push(`**Simulation note.** ${cell(x.simulationNote)}`, "");
  push(`**Duration** ${x.durationMinutes} min. **Pass mark** ${x.passMark}%${x.passMarkNote ? ` (${cell(x.passMarkNote)})` : ""}. **Tasks** ${x.taskCount}, environment ${x.environment}, tier ${x.envTier}.`, "");
  push(
    table(
      ["Objective", "Weight", "Tasks", "Pool"],
      x.blueprint.map((b) => [b.objective, `${b.weight}%`, b.tasks, b.pool.length]),
    ),
    "",
  );
  const r = x.rules;
  push(
    `**Rules.** Hints: ${r.hints ? "yes" : "none"}. Timer: ${r.timer === "single" ? "one timer across all tasks" : "per task"}. ` +
      `${r.anyOrder ? "Tasks in any order. " : ""}${r.flagForReview ? "Flag for review. " : ""}` +
      `Reboot before grading: ${r.rebootBeforeGrade ? "yes" : "no"}. ${r.docsAllowed ? `Docs: ${cell(r.docsAllowed)}. ` : ""}` +
      `${r.partialCredit ? `Partial credit: ${r.partialCredit}. ` : ""}${r.notes ? cell(r.notes) : ""}`,
    "",
  );
  const rp = x.retakePolicy;
  push(
    `**Retakes.** ${rp.freeRetakes !== undefined ? `${rp.freeRetakes} free retake(s); ` : ""}${rp.cooldownHours !== undefined ? `${rp.cooldownHours} h cooldown; ` : ""}` +
      `${rp.maxAttemptsPer30Days ? `at most ${rp.maxAttemptsPer30Days} attempts per 30 days; ` : ""}${rp.freshDraw ? "every attempt draws fresh tasks and parameters" : "same tasks"}. ${rp.notes ? cell(rp.notes) : ""}`,
    "",
  );
  push(`**Score report.** Breakdown by ${x.scoreReport.breakdown.join(", ")}${x.scoreReport.showsExpectedValues === false ? "; expected values are never shown" : ""}. ${(x.scoreReport.includes ?? []).map(cell).join("; ")}.`, "");
  push(`_${cell(x.disclaimer)}_`, "");
  push(`<details><summary>Task pool (${x.blueprint.reduce((a, b) => a + b.pool.length, 0)} tasks)</summary>`, "");
  push(
    table(
      ["Task", "Objective", "Title", "Difficulty", "Min", "Tier", "Scenario"],
      x.blueprint.flatMap((b) => b.pool.map((id) => labById.get(id)).filter(Boolean).map((l) => [code(l.id), b.objective, l.title, l.difficulty, l.minutes, l.envTier, l.oneLine])),
    ),
    "",
    "</details>",
    "",
  );
}

// ---------------------------------------------------------------- appendices
push("## Appendix: proposed new skills", "");
push(`${(doc.newSkills ?? []).length} skills to merge into \`content/skills.yaml\` after approval.`, "");
push(
  "<details><summary>New skills</summary>",
  "",
  table(["Skill", "Name", "Competency", "Requires"], (doc.newSkills ?? []).map((s) => [code(s.id), s.name, s.competency, (s.requires ?? []).join(", ")])),
  "",
  "</details>",
  "",
);
push("## Appendix: proposed images", "");
push(table(["Ref", "Kind", "Tier", "Status", "Description"], (doc.images ?? []).map((i) => [code(i.ref), i.kind, i.tier, i.status ?? "proposed", i.description])), "");
push("## Appendix: alignment frameworks declared here", "");
push(
  "Hand-written frameworks in `content/frameworks/` (cka, ckad, cks, lfcs, ccna) are not repeated. Each framework below is generated into `content/frameworks/<id>.yaml` with its objectives mapped to the skills of the labs that reference them. Weights marked *cloudtrain* are CloudTrain estimates where the body publishes none.",
  "",
  table(["Framework", "Title", "Body", "Weights", "Objectives"], (doc.frameworks ?? []).map((f) => [code(f.id), f.title, f.body ?? "", f.weightsSource ?? "", f.objectives.map((o) => (o.weight !== undefined ? `${o.id} (${o.weight})` : o.id)).join(", ")])),
  "",
);

const text = lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";

// ---------------------------------------------------------------- README table
const START = "<!-- curriculum-table:start (generated by tools/curriculum/render.mjs) -->";
const END = "<!-- curriculum-table:end -->";
const dash = (n) => (n ? n : "—");
const readmeRows = sumRows.slice(0, -1).map((r) => [r[0], r[1], r[2] + r[3], r[4], dash(r[6]), dash(r[5])]);
readmeRows.push(["**Total**", `**${total.paths}**`, `**${total.learn + total.exam}** (${total.learn} learning, ${total.exam} exam tasks)`, `**${total.exams}**`, `**${total.built}**`, `**${total.verified}**`]);
const readmeTable = table(["Domain", "Paths", "Learning labs + exam tasks", "Exam simulations", "Built", "Verified live"], readmeRows);
const readmeCurrent = readFileSync(readme, "utf8");
const a = readmeCurrent.indexOf(START);
const b = readmeCurrent.indexOf(END);
if (a < 0 || b < a) {
  console.error(`README.md has no curriculum table markers (${START} ... ${END})`);
  process.exit(1);
}
const readmeText = readmeCurrent.slice(0, a + START.length) + "\n" + readmeTable + "\n" + readmeCurrent.slice(b);

// ---------------------------------------------------------------- framework files
const fwDir = path.join(root, "content/frameworks");
const fwFiles = renderFrameworks(doc, YAML);
// Generated files whose framework left the curriculum are removed (hand-written files never carry the marker).
const orphans = readdirSync(fwDir).filter((n) => n.endsWith(".yaml") && !fwFiles.has(n) && YAML.parse(readFileSync(path.join(fwDir, n), "utf8"))?.generatedFrom === GENERATED_FROM);
for (const name of fwFiles.keys()) {
  const file = path.join(fwDir, name);
  if (existsSync(file) && YAML.parse(readFileSync(file, "utf8"))?.generatedFrom !== GENERATED_FROM) {
    console.error(`content/frameworks/${name} is hand-written; drop framework ${name.replace(/\.yaml$/, "")} from content/curriculum.yaml frameworks`);
    process.exit(1);
  }
}

if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  let stale = false;
  for (const [name, body] of fwFiles) {
    const file = path.join(fwDir, name);
    if (!existsSync(file) || readFileSync(file, "utf8") !== body) {
      console.error(`content/frameworks/${name} is out of date; run node tools/curriculum/render.mjs`);
      stale = true;
    }
  }
  for (const name of orphans) {
    console.error(`content/frameworks/${name} was generated for a framework no longer in the curriculum; run node tools/curriculum/render.mjs`);
    stale = true;
  }
  if (current !== text) {
    console.error("docs/curriculum.md is out of date; run node tools/curriculum/render.mjs");
    stale = true;
  }
  if (readmeCurrent !== readmeText) {
    console.error("README.md curriculum table is out of date; run node tools/curriculum/render.mjs");
    stale = true;
  }
  if (stale) process.exit(1);
  console.log(`docs/curriculum.md, the README curriculum table and ${fwFiles.size} generated framework files are up to date`);
} else {
  writeFileSync(out, text);
  writeFileSync(readme, readmeText);
  for (const [name, body] of fwFiles) writeFileSync(path.join(fwDir, name), body);
  for (const name of orphans) unlinkSync(path.join(fwDir, name));
  console.log(`wrote ${fwFiles.size} framework files to content/frameworks${orphans.length ? ` (removed ${orphans.join(", ")})` : ""}`);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${labs.length} labs, ${(doc.paths ?? []).length} paths, ${exams.length} exams) and the README curriculum table`);
}
