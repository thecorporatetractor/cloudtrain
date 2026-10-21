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
  assert.equal(r.plans, 4);
});

test("compute cross-checks: premium rules name plans, trial labs exist, the metered key and plan id are free", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  doc.plans.premium.push({ plan: "platinum", difficulties: ["hard"] });
  doc.plans.compute.lookupKey = "ct_pro_monthly";
  doc.plans.free.trialLabs = ["no-such-lab"];
  const dir = await mkdtemp(path.join(tmpdir(), "site-"));
  const file = path.join(dir, "site.yaml");
  await writeFile(file, YAML.stringify(doc));
  const findings = [];
  await checkSite(file, { domainsWithLabs: domains, repoRoot, labIds: new Set(["shell-first-steps-timetable"]) }, findings);
  const messages = findings.filter((f) => f.level === "error").map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("unknown plan 'platinum'")), messages.join("\n"));
  assert.ok(messages.some((m) => m.includes("lookup key 'ct_pro_monthly' is also used by pro/monthly")), messages.join("\n"));
  assert.ok(messages.some((m) => m.includes("trial lab 'no-such-lab'")), messages.join("\n"));
});

test("plan cross-checks: duplicate lookup keys, priced free plans, per-seat individuals", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  const [free, pro, , team] = doc.plans.items;
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

test("an enabled waitlist needs a privacy notice that describes it, and required fields stay enabled", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  assert.ok(doc.waitlist.enabled);
  doc.legal.privacy.sections = doc.legal.privacy.sections.filter((s) => !/waitlist/i.test(s.title));
  doc.waitlist.fields.interest = { required: true, enabled: false };
  const dir = await mkdtemp(path.join(tmpdir(), "site-"));
  const file = path.join(dir, "site.yaml");
  await writeFile(file, YAML.stringify(doc));
  const findings = [];
  await checkSite(file, { domainsWithLabs: domains, repoRoot }, findings);
  const messages = findings.filter((f) => f.level === "error").map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("does not describe it")), messages.join("\n"));
  assert.ok(messages.some((m) => m.includes("a required field cannot be disabled")), messages.join("\n"));
  // Turning the waitlist off lifts the privacy requirement.
  doc.waitlist = { enabled: false };
  await writeFile(file, YAML.stringify(doc));
  findings.length = 0;
  await checkSite(file, { domainsWithLabs: domains, repoRoot }, findings);
  assert.deepEqual(findings.filter((f) => f.level === "error"), []);
});

test("launch and social proof: FAQ groups must exist, placeholder quotes cannot be published as real", async () => {
  const doc = YAML.parse(await (await import("node:fs/promises")).readFile(siteFile, "utf8"));
  assert.equal(doc.launch.mode, "coming-soon");
  doc.launch.faqGroups = ["Labs", "Nonexistent"];
  doc.socialProof.placeholder = false;
  doc.waitlist.enabled = false;
  const dir = await mkdtemp(path.join(tmpdir(), "site-"));
  const file = path.join(dir, "site.yaml");
  await writeFile(file, YAML.stringify(doc));
  const findings = [];
  await checkSite(file, { domainsWithLabs: domains, repoRoot }, findings);
  const errors = findings.filter((f) => f.level === "error").map((f) => f.message);
  const warnings = findings.filter((f) => f.level !== "error").map((f) => f.message);
  assert.ok(errors.some((m) => m.includes("no FAQ entry has group 'Nonexistent'")), errors.join("\n"));
  assert.ok(errors.some((m) => m.includes("placeholder quotes are published as real")), errors.join("\n"));
  assert.ok(warnings.some((m) => m.includes("coming soon without the waitlist")), warnings.join("\n"));
});
