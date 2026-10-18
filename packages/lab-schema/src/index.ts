import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { Lab } from "./types.generated.js";
import type { Curriculum } from "./curriculum.generated.js";
import type { Site } from "./site.generated.js";

export type * from "./types.generated.js";
export type { Curriculum } from "./curriculum.generated.js";
export type { Site } from "./site.generated.js";

const require = createRequire(import.meta.url);

/** The raw JSON Schema (draft 2020-12) for `cloudtrain.dev/v3` labs. */
export const labSchema: Record<string, unknown> = require("../schema/lab.schema.json");

/** The raw JSON Schema (draft 2020-12) for the `cloudtrain.dev/v1` Curriculum document. */
export const curriculumSchema: Record<string, unknown> = require("../schema/curriculum.schema.json");

/** The raw JSON Schema (draft 2020-12) for the `cloudtrain.dev/v1` Site document (public website configuration). */
export const siteSchema: Record<string, unknown> = require("../schema/site.schema.json");

export const LAB_API_VERSION = "cloudtrain.dev/v3" as const;

export interface ValidationIssue {
  /** JSON pointer into the lab document, e.g. `/spec/checks/2/skills`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false });
const compiled = ajv.compile<Lab>(labSchema);
const compiledCurriculum = ajv.compile<Curriculum>(curriculumSchema);
const compiledSite = ajv.compile<Site>(siteSchema);

function unique(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function toIssue(e: ErrorObject): ValidationIssue {
  let message = e.message ?? "invalid";
  if (e.keyword === "additionalProperties") {
    message = `unknown property '${(e.params as { additionalProperty: string }).additionalProperty}'`;
  } else if (e.keyword === "enum") {
    message = `${message}: ${JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues)}`;
  }
  return { path: e.instancePath || "/", message };
}

/** Validates a parsed lab document against the v3 schema. */
export function validateLab(doc: unknown): ValidationResult {
  const valid = compiled(doc) as boolean;
  const issues = valid ? [] : (compiled.errors ?? []).map(toIssue);
  // oneOf failures repeat every branch's error; keep the list readable.
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const k = `${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { valid, issues: unique };
}

/**
 * Validates a parsed content/curriculum.yaml against the curriculum schema (shape only;
 * cross-references such as lab ids, skills and framework refs are checked by tools/lab-verify).
 */
export function validateCurriculum(doc: unknown): ValidationResult {
  const valid = compiledCurriculum(doc) as boolean;
  const issues = valid ? [] : (compiledCurriculum.errors ?? []).map(toIssue);
  const seen = new Set<string>();
  return {
    valid,
    issues: issues.filter((i) => {
      const k = `${i.path}|${i.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}

/**
 * Validates a parsed site configuration (content/site.yaml or a deployment's CT_SITE_CONFIG)
 * against the Site schema. Shape only; tools/lab-verify cross-checks the highlighted domains.
 */
export function validateSite(doc: unknown): ValidationResult {
  const valid = compiledSite(doc) as boolean;
  return { valid, issues: valid ? [] : unique((compiledSite.errors ?? []).map(toIssue)) };
}

/** Type guard form of {@link validateLab}. */
export function isLab(doc: unknown): doc is Lab {
  return validateLab(doc).valid;
}

const PARAM_REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * True when a `{{ name }}` match is literal text, not a param reference: written with
 * inner whitespace (the Jinja/Ansible style) and not naming a declared param. `{{name}}`
 * without whitespace always references a param. Mirrors the compiler (literalPlaceholder).
 */
export function isLiteralPlaceholder(match: string, name: string, declared: (name: string) => boolean): boolean {
  return match !== `{{${name}}}` && !declared(name);
}

/** Returns every `{{param}}` name referenced anywhere in the lab's spec (literal Jinja excluded). */
export function referencedParams(lab: Lab): Set<string> {
  const names = new Set<string>();
  const params = (lab.spec as { params?: Record<string, unknown> }).params ?? {};
  const declared = (n: string) => Object.prototype.hasOwnProperty.call(params, n);
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const m of v.matchAll(PARAM_REF)) { if (!isLiteralPlaceholder(m[0], m[1]!, declared)) names.add(m[1]!); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(lab.spec);
  return names;
}

/** Names of the params declared `secret: true` (answer checks reference them; never sent to learners). */
export function secretParams(lab: Lab): Set<string> {
  const params = (lab.spec.params ?? {}) as Record<string, { secret?: boolean }>;
  return new Set(Object.entries(params).filter(([, p]) => p?.secret === true).map(([n]) => n));
}

/** True for answer checks (CTF questions graded on the submitted answer, not on end state). */
export function isAnswerCheck(check: { type: string }): boolean {
  return check.type === "answer";
}
