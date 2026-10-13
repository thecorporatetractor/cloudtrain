import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyContent } from "../src/verify.mjs";

const contentDir = fileURLToPath(new URL("../../../content", import.meta.url));

/** Copies content/, applies `edit` to one lab.yaml, and returns the findings for that lab. */
async function findingsAfter(lab, edit) {
  const dir = await mkdtemp(path.join(tmpdir(), "lab-verify-"));
  try {
    await cp(contentDir, dir, { recursive: true });
    const file = path.join(dir, "packs/kubernetes/labs", lab, "lab.yaml");
    const before = await readFile(file, "utf8");
    const after = edit(before);
    assert.notEqual(after, before, "edit did not change the lab");
    await writeFile(file, after);
    const r = await verifyContent(dir);
    return r.findings.filter((f) => f.file === file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("regex backreference is rejected (RE2)", async () => {
  const f = await findingsAfter("hostpath-pv-readonly", (s) => s.replace(`value: '^\\["ReadOnlyMany"\\]$'`, () => "value: '^(\\w+)\\1$'"));
  assert.ok(f.some((x) => x.level === "error" && /backreference/.test(x.message)), JSON.stringify(f));
});

test("mutation without use-context is flagged", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) => s.replace("kubectl config use-context qm-dispatch\n          kubectl -n dock-scheduling scale deployment --all", "kubectl -n dock-scheduling scale deployment --all"));
  assert.ok(f.some((x) => x.level === "warn" && x.path === "/spec/misconceptions/0/mutation"), JSON.stringify(f));
});

test("unknown expectFail id is an error", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) => s.replace("expectFail: [others-unchanged]", "expectFail: [no-such-check]"));
  assert.ok(f.some((x) => x.level === "error" && /unknown check 'no-such-check'/.test(x.message)), JSON.stringify(f));
});

test("misconception without a mutation warns at its own index", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) =>
    s.replace(/(    - id: wrong-namespace\n(?:      .*\n)*?)      expectFail: .*\n      mutation:\n(?:        .*\n)+?(?=    - id: )/, "$1"),
  );
  assert.ok(f.some((x) => x.level === "warn" && x.path === "/spec/misconceptions/1"), JSON.stringify(f));
});
