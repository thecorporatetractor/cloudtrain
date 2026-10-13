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
