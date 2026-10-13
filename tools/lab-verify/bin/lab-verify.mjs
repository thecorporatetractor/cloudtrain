#!/usr/bin/env node
// lab-verify: validates CloudTrain content.
//   lab-verify [contentDir] [--json] [--strict] [--verbose]
// Exit code 1 on any error or denylist hit (and on warnings with --strict).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyContent } from "../src/verify.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");
const verbose = args.includes("--verbose");
const positional = args.filter((a) => !a.startsWith("--"));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contentDir = path.resolve(positional[0] ?? path.join(repoRoot, "content"));

const r = await verifyContent(contentDir);
const rel = (f) => path.relative(process.cwd(), f) || ".";
const errors = r.findings.filter((f) => f.level === "error");
const warns = r.findings.filter((f) => f.level === "warn");
const infos = r.findings.filter((f) => f.level === "info");

if (json) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log(`content: ${rel(contentDir)}`);
  console.log(`skills: ${r.skills}  framework objectives: ${r.frameworks}  labs: ${r.labs.length}\n`);
  for (const l of r.labs) console.log(`  ${l.ok ? "PASS" : "FAIL"}  ${l.id}  (${l.checks} checks)`);
  const shown = r.findings.filter((f) => verbose || f.level !== "info");
  if (shown.length) console.log("");
  for (const f of shown) console.log(`${f.level.toUpperCase().padEnd(5)} ${rel(f.file)}${f.path ? ` ${f.path}` : ""}: ${f.message}`);
  console.log(`\ndenylist scan: ${r.denylistHits.length} hit(s)`);
  for (const h of r.denylistHits) console.log(`  HIT  ${rel(h.file)}:${h.line} [${h.id}] ${h.text}`);
  if (infos.length && !verbose) console.log(`\ninfo: ${infos.length} skill(s) not exercised by any lab (--verbose lists them)`);
  console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
}
const failed = errors.length > 0 || r.denylistHits.length > 0 || (strict && warns.length > 0);
process.exit(failed ? 1 : 0);
