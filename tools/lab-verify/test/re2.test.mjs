import { test } from "node:test";
import assert from "node:assert/strict";
import { re2Problems } from "../src/verify.mjs";

test("flags regex features RE2 lacks", () => {
  for (const re of ["^(\\d+)=\\1 3/3$", "(?<n>a)\\k<n>", "^a(?=b)", "^a(?!b)", "(?<=a)b", "(?<!a)b", "(?>ab)", "a++", "a{2}+"]) {
    assert.ok(re2Problems(re).length > 0, re);
  }
});

test("accepts RE2-compatible regexes", () => {
  for (const re of ["^1\\.35\\.2-\\S+ ?$", "^TCP/(web|80)$", '^\\["ReadOnlyMany"\\]$', "^(web\\ncache|cache\\nweb)\\n?$", "a+?", "(?:x)", "(?<name>x)", "(?i)abc", "\\(?=\\)"]) {
    assert.deepEqual(re2Problems(re), [], re);
  }
});
