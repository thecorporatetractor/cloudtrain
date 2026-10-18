import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { verifyContent } from "../src/verify.mjs";

test("repository content verifies cleanly", async () => {
  const r = await verifyContent(fileURLToPath(new URL("../../../content", import.meta.url)));
  assert.deepEqual(r.findings.filter((f) => f.level === "error"), []);
  assert.deepEqual(r.denylistHits, []);
  assert.ok(r.labs.length >= 11);
});

test("framework files generated from the curriculum are skipped; hand-written ones are checked", async () => {
  const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { checkFrameworks } = await import("../src/verify.mjs");
  const dir = await mkdtemp(path.join(tmpdir(), "fw-"));
  await mkdir(path.join(dir, "frameworks"));
  await writeFile(path.join(dir, "frameworks/gen.yaml"), "id: gen\ngeneratedFrom: content/curriculum.yaml\nobjectives:\n  - { id: a, title: A, skills: [] }\n");
  await writeFile(path.join(dir, "frameworks/hand.yaml"), "id: hand\nobjectives:\n  - { id: a, title: A, weight: 100, skills: [x.y.z] }\n");
  const findings = [];
  const refs = await checkFrameworks(dir, new Map([["x.y.z", {}]]), findings);
  assert.deepEqual([...refs.keys()], ["hand:a"]);
  assert.deepEqual(findings, []);
});

test("renderFrameworks maps objectives to the skills of the labs that reference them", async () => {
  const { renderFrameworks, majorityDomain, shortNameOf } = await import("../../curriculum/frameworks.mjs");
  const YAML = await import("yaml");
  const doc = {
    frameworks: [
      { id: "acme", title: "Acme Certified Operator (ACO) themes", body: "Acme, Inc.", objectives: [{ id: "one", title: "One", weight: 60 }, { id: "two", title: "Two", weight: 40 }] },
      { id: "ct-x", title: "CloudTrain capstone", shortName: "Capstone", domain: "cross-domain", body: "CloudTrain", objectives: [{ id: "all", title: "All" }] },
    ],
    labs: [
      { id: "l1", domain: "linux", skills: ["linux.b", "linux.a"], frameworks: ["acme:one"] },
      { id: "l2", domain: "linux", skills: ["linux.c"], frameworks: ["acme:one", "acme:two"] },
      { id: "l3", domain: "iac", skills: ["iac.a"], frameworks: ["ct-x:all"] },
    ],
  };
  const files = renderFrameworks(doc, YAML);
  assert.deepEqual([...files.keys()], ["acme.yaml", "ct-x.yaml"]);
  const acme = YAML.parse(files.get("acme.yaml"));
  assert.equal(acme.generatedFrom, "content/curriculum.yaml");
  assert.equal(acme.shortName, "ACO");
  assert.equal(acme.domain, "linux");
  assert.match(acme.disclaimer, /not affiliated with or endorsed by Acme, Inc\./);
  assert.deepEqual(acme.objectives.map((o) => [o.id, o.weight, o.skills]), [["one", 60, ["linux.a", "linux.b", "linux.c"]], ["two", 40, ["linux.c"]]]);
  const ct = YAML.parse(files.get("ct-x.yaml"));
  assert.equal(ct.disclaimer, undefined);
  assert.equal(ct.domain, "cross-domain");
  assert.equal(majorityDomain([{ domain: "linux" }, { domain: "iac" }]), "cross-domain");
  assert.equal(shortNameOf({ id: "z", title: "No acronym here" }), "z");
});
