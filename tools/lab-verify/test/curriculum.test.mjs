import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { checkCurriculum, findCycle } from "../src/curriculum.mjs";

const lab = (id, extra = {}) => ({
  id, domain: "linux", title: "Free the space held by a deleted log file", type: "fix", difficulty: "easy", minutes: 10,
  oneLine: "A log host at a fictional rail operator is full; free the space held by a deleted-but-open file without rebooting.",
  skills: ["linux.shell.navigation"], frameworks: ["lfcs:storage"], envTier: "A", images: ["el-lab:10"], status: "proposed", owner: "linux-content",
  ...extra,
});
const exam = (pool, extra = {}) => ({
  id: "sim-demo", title: "Linux practical exam simulation", domain: "linux", alignsTo: ["lfcs"],
  disclaimer: "CloudTrain is not affiliated with or endorsed by the certifying body. Completing this confers no certification.",
  format: "practical", durationMinutes: 60, passMark: 67, taskCount: 1, envTier: "C", environment: "shared",
  blueprint: [{ objective: "lfcs:storage", weight: 100, tasks: 1, pool }],
  rules: { hints: false, timer: "single", rebootBeforeGrade: false }, retakePolicy: { freshDraw: true },
  scoreReport: { breakdown: ["objective"] }, status: "proposed", owner: "assessment", ...extra,
});
const base = () => ({
  apiVersion: "cloudtrain.dev/v1", kind: "Curriculum", metadata: { version: 1, status: "proposal", updated: "2026-10-14" },
  envTiers: { A: { title: "Unprivileged pod", substrate: "pod" } },
  frameworks: [],
  images: [{ ref: "el-lab:10", kind: "container", tier: "A", description: "EL userland" }],
  domains: [{ id: "linux", title: "Linux", summary: "s", skillDomain: "linux", owner: "linux-content", competencies: [{ id: "linux.shell", title: "Shell" }] }],
  newSkills: [],
  labs: [lab("free-deleted-log"), lab("xlf-storage-a", { type: "exam" }), lab("xlf-storage-b", { type: "exam" })],
  paths: [{ id: "p0", domain: "linux", title: "Linux foundations", audience: "new admins", level: "beginner", prerequisites: [], estimatedHours: 2, frameworks: [], modules: [{ id: "m1", title: "Disk", labs: ["free-deleted-log"] }] }],
  exams: [exam(["xlf-storage-a", "xlf-storage-b"])],
});
const ctx = () => ({
  skills: new Map([["linux.shell.navigation", {}]]),
  frameworkRefs: new Map([["lfcs:storage", new Set()]]),
  catalog: { images: new Map([["jumphost:1", {}]]) },
  packLabs: new Map(),
});

async function run(doc, c = ctx()) {
  const dir = await mkdtemp(path.join(tmpdir(), "curriculum-"));
  const file = path.join(dir, "curriculum.yaml");
  await writeFile(file, YAML.stringify(doc));
  const findings = [];
  const summary = await checkCurriculum(file, c, findings);
  return { summary, errors: findings.filter((f) => f.level === "error").map((f) => f.message) };
}

test("a consistent curriculum has no errors", async () => {
  const { summary, errors } = await run(base());
  assert.deepEqual(errors, []);
  assert.equal(summary.labs, 3);
  assert.equal(summary.examTasks, 2);
});

test("unknown lab ids, skills and framework refs are errors", async () => {
  const doc = base();
  doc.paths[0].modules[0].labs.push("no-such-lab");
  doc.labs[0].skills.push("linux.shell.unknown");
  doc.labs[0].frameworks.push("lfcs:nope");
  const { errors } = await run(doc);
  assert.ok(errors.some((e) => e.includes("unknown lab 'no-such-lab'")));
  assert.ok(errors.some((e) => e.includes("unknown skill 'linux.shell.unknown'")));
  assert.ok(errors.some((e) => e.includes("unknown framework objective 'lfcs:nope'")));
});

test("newSkills make a skill id valid", async () => {
  const doc = base();
  doc.labs[0].skills.push("linux.shell.history");
  doc.newSkills.push({ id: "linux.shell.history", name: "Reuse shell history", domain: "linux", competency: "linux.shell" });
  assert.deepEqual((await run(doc)).errors, []);
});

test("built labs must exist in the packs and pack labs must be listed", async () => {
  const doc = base();
  doc.labs[0].status = "built";
  const c = ctx();
  c.packLabs.set("other-pack-lab", { domain: "kubernetes", frameworks: [] });
  const { errors } = await run(doc, c);
  assert.ok(errors.some((e) => e.includes("no lab 'free-deleted-log' exists in content/packs")));
  assert.ok(errors.some((e) => e.includes("pack lab 'other-pack-lab' is missing")));
});

test("exam pools need two disjoint draws and exam-type labs only", async () => {
  const doc = base();
  doc.exams[0].blueprint[0].pool = ["xlf-storage-a", "free-deleted-log"];
  const { errors } = await run(doc);
  assert.ok(errors.some((e) => e.includes("only type exam labs")));
  assert.ok(errors.some((e) => e.includes("exam task is in no exam pool")));
  const small = base();
  small.exams[0].blueprint[0].tasks = 2;
  small.exams[0].taskCount = 2;
  assert.ok((await run(small)).errors.some((e) => e.includes("needs at least 4")));
});

test("titles must not name exams or certifying bodies", async () => {
  const doc = base();
  doc.paths[0].title = "Towards LFCS";
  doc.labs[0].title = "RHCSA storage drill";
  const { errors } = await run(doc);
  assert.equal(errors.filter((e) => e.includes("names an exam")).length, 2);
});

test("findCycle reports prerequisite loops", () => {
  assert.deepEqual(findCycle(new Map([["a", ["b"]], ["b", ["a"]]])), ["a", "b", "a"]);
  assert.equal(findCycle(new Map([["a", ["b"]], ["b", []]])), undefined);
});
