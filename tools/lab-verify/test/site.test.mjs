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
  assert.equal(r.plans, 3);
});

test("plan cross-checks: duplicate lookup keys, priced free plans, per-seat individuals", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  const [free, pro, team] = doc.plans.items;
  free.prices = { monthly: { amount: 100, lookupKey: "ct_pro_monthly" } };
  pro.perSeat = true;
  team.prices.yearly.lookupKey = "ct_pro_yearly";
  const dir = await mkdtemp(path.join(tmpdir(), "site-"));
  const file = path.join(dir, "site.yaml");
  await writeFile(file, YAML.stringify(doc));
  const findings = [];
  await checkSite(file, { domainsWithLabs: domains, repoRoot }, findings);
  const messages = findings.map((f) => f.message);
  // The schema already rejects prices on a free plan (if/then), so the run stops there.
  assert.ok(messages.some((m) => /schema/.test(m)), messages.join("\n"));
  delete free.prices;
  await writeFile(file, YAML.stringify(doc));
  findings.length = 0;
  await checkSite(file, { domainsWithLabs: domains, repoRoot }, findings);
  const again = findings.map((f) => f.message);
  assert.ok(again.some((m) => m.includes("lookup key 'ct_pro_yearly' is also used by pro/yearly")), again.join("\n"));
  assert.ok(again.some((m) => m.includes("per-seat pricing is for organisation plans")), again.join("\n"));
});

test("schema errors, unknown routes, missing screenshots and a weak notice are reported", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  doc.footer.columns[0].links.push({ label: "Nowhere", to: "/nowhere" });
  doc.showcase = [{ title: "x", body: "y", figure: { image: "/site/does-not-exist.png", alt: "x" } }];
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
  assert.ok(messages.some((m) => m.includes("'/nowhere' is not a website route")));
  assert.ok(messages.some((m) => m.includes("not affiliated")));
  assert.ok(messages.some((m) => m.includes("highlighted domain 'linux'")));
});
