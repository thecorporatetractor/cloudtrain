import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { checkSite } from "../src/site.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const siteFile = path.join(repoRoot, "content/site.yaml");
const domains = new Set(["kubernetes", "linux", "containers", "iac", "automation", "networking"]);

test("content/site.yaml passes the site checks", async () => {
  const findings = [];
  const r = await checkSite(siteFile, { domainsWithLabs: domains, repoRoot }, findings);
  assert.deepEqual(findings.filter((f) => f.level === "error"), []);
  assert.equal(r.brand, "CloudTrain");
  assert.ok(r.features >= 3);
});

test("schema errors, unknown routes, missing screenshots and a weak notice are reported", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  doc.footer.columns[0].links.push({ label: "Nowhere", to: "/nowhere" });
  doc.screenshots = [{ image: "/site/does-not-exist.png", alt: "x" }];
  doc.legal.alignmentNotice = "We love every vendor.";
  doc.highlightDomains = ["linux"];
  doc.bogus = 1;
  const dir = await mkdtemp(path.join(tmpdir(), "site-"));
  const file = path.join(dir, "site.yaml");
  await writeFile(file, YAML.stringify(doc));
  let findings = [];
  await checkSite(file, { domainsWithLabs: domains, repoRoot }, findings);
  assert.ok(findings.some((f) => f.message.includes("bogus")), "schema issue");
  // The schema failure stops the cross-checks; fix it and run again.
  delete doc.bogus;
  await writeFile(file, YAML.stringify(doc));
  findings = [];
  await checkSite(file, { domainsWithLabs: new Set(["kubernetes"]), repoRoot }, findings);
  const messages = findings.map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("'/nowhere' is not a website route")));
  assert.ok(messages.some((m) => m.includes("does-not-exist.png")));
  assert.ok(messages.some((m) => m.includes("not affiliated")));
  assert.ok(messages.some((m) => m.includes("highlighted domain 'linux'")));
});
