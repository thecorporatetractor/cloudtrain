// Generates src/types.generated.ts from schema/lab.schema.json.
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
