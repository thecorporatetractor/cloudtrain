// Generates src/types.generated.ts from schema/lab.schema.json and
// src/curriculum.generated.ts from schema/curriculum.schema.json.
// Run after every schema change; the output is committed so consumers need no codegen step.
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const here = new URL("..", import.meta.url);
const schema = JSON.parse(await readFile(new URL("schema/lab.schema.json", here), "utf8"));

// Name the root type `Lab` (the schema title is human-facing).
const ts = await compile({ ...schema, title: "Lab" }, "Lab", {
  bannerComment:
    "/* eslint-disable */\n/**\n * GENERATED from schema/lab.schema.json by scripts/gen-types.mjs. Do not edit by hand.\n */",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: false },
});
await writeFile(new URL("src/types.generated.ts", here), ts);
console.log("wrote src/types.generated.ts");

const curriculum = JSON.parse(await readFile(new URL("schema/curriculum.schema.json", here), "utf8"));
const cts = await compile({ ...curriculum, title: "Curriculum" }, "Curriculum", {
  bannerComment:
    "/* eslint-disable */\n/**\n * GENERATED from schema/curriculum.schema.json by scripts/gen-types.mjs. Do not edit by hand.\n */",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: false },
});
await writeFile(new URL("src/curriculum.generated.ts", here), cts);
console.log("wrote src/curriculum.generated.ts");

const site = JSON.parse(await readFile(new URL("schema/site.schema.json", here), "utf8"));
const sts = await compile({ ...site, title: "Site" }, "Site", {
  bannerComment:
    "/* eslint-disable */\n/**\n * GENERATED from schema/site.schema.json by scripts/gen-types.mjs. Do not edit by hand.\n */",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: false },
});
await writeFile(new URL("src/site.generated.ts", here), sts);
console.log("wrote src/site.generated.ts");
