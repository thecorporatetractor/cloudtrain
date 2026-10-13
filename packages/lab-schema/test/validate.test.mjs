import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLab, referencedParams } from "../dist/index.js";

const minimal = {
  apiVersion: "cloudtrain.dev/v3",
  kind: "Lab",
  metadata: { id: "demo-lab", title: "Demo", domain: "linux", difficulty: "easy", estimatedMinutes: 5 },
  spec: {
    description: "Write {{word}} to a file.",
    params: { word: { type: "choice", values: ["alpha", "beta"] } },
    topology: { entry: "box", nodes: [{ name: "box", driver: "container", image: "jumphost:1" }] },
    checks: [{ id: "c1", description: "file", type: "file", skills: ["linux.files.redirection"], on: "box", target: "/tmp/x" }],
    solution: {
      steps: [{ on: "box", run: "echo {{word}} > /tmp/x" }],
      alternatives: [{ id: "tee", description: "use tee", steps: [{ on: "box", file: { path: "/tmp/x", source: "assets/x" } }] }],
    },
  },
};

test("minimal lab is valid", () => {
  const r = validateLab(minimal);
  assert.deepEqual(r.issues, []);
  assert.equal(r.valid, true);
});

test("unknown property and missing skills are reported", () => {
  const bad = structuredClone(minimal);
  bad.spec.bogus = 1;
  delete bad.spec.checks[0].skills;
  const r = validateLab(bad);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.message.includes("bogus")));
  assert.ok(r.issues.some((i) => i.message.includes("skills")));
});

test("file action needs exactly one of content/source", () => {
  const bad = structuredClone(minimal);
  bad.spec.solution.steps = [{ on: "box", file: { path: "/x", content: "a", source: "b" } }];
  assert.equal(validateLab(bad).valid, false);
});

test("referencedParams finds template references", () => {
  assert.deepEqual([...referencedParams(minimal)], ["word"]);
});
