/**
 * Answer matching: a TypeScript port of the orchestrator's Go matcher
 * (services/lab-orchestrator/internal/answer). Both run the shared vectors in
 * packages/lab-schema/testdata/answer-matchers.json, so `labctl verify`
 * proves exactly what learners are graded with.
 */

import { LinearRegex, RegexSyntaxError } from './linear-regex.js';

export type AnswerMatch = 'exact' | 'number' | 'regex' | 'any-of';
export type AnswerWhitespace = 'trim' | 'collapse' | 'remove' | 'none';

export interface MatchRules {
  match: AnswerMatch;
  caseSensitive?: boolean;
  whitespace?: AnswerWhitespace;
  tolerance?: number;
}

/** Longest accepted answer (characters; the Go side counts bytes of the same ASCII-mostly input). */
export const MAX_ANSWER_LENGTH = 512;

/** The whitespace set both implementations share: ASCII whitespace and the no-break space. */
const WS = '[ \\t\\n\\v\\f\\r\\u00a0]';
const LEADING = new RegExp(`^${WS}+`);
const TRAILING = new RegExp(`${WS}+$`);
const RUNS = new RegExp(`${WS}+`, 'g');

const trim = (s: string) => s.replace(LEADING, '').replace(TRAILING, '');

export function normalize(s: string, whitespace: AnswerWhitespace = 'collapse', caseSensitive = false): string {
  switch (whitespace) {
    case 'none':
      break;
    case 'trim':
      s = trim(s);
      break;
    case 'remove':
      s = s.replace(RUNS, '');
      break;
    default:
      s = trim(s).replace(RUNS, ' ');
  }
  return caseSensitive ? s : s.toLowerCase();
}

const NUMBER = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/;

/** A plain decimal number, or undefined (no hex, infinities, NaN or separators). */
export function parseNumber(s: string): number | undefined {
  const t = trim(s);
  if (!NUMBER.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export class BrokenAnswerError extends Error {}

const compiled = new Map<string, LinearRegex>();
const MAX_CACHED = 512;

/**
 * Compiles an answer pattern for the linear-time engine (see linear-regex.ts):
 * JavaScript's backtracking RegExp never runs it, so no pattern, however
 * written, templated or computed, can stall the gateway. Throws
 * RegexSyntaxError for a pattern outside the subset Go RE2 and JavaScript
 * share.
 */
export function compileAnswerPattern(pattern: string, caseSensitive: boolean): LinearRegex {
  const key = `${caseSensitive ? 's' : 'i'}:${pattern}`;
  let re = compiled.get(key);
  if (re) return re;
  // The engine's parser accepts only the subset Go RE2 and JavaScript share (no JavaScript RegExp
  // is built from the pattern, not even to check its syntax).
  re = new LinearRegex(pattern, { caseInsensitive: !caseSensitive });
  if (compiled.size >= MAX_CACHED) compiled.delete(compiled.keys().next().value!);
  compiled.set(key, re);
  return re;
}

/** Why `pattern` cannot be an answer pattern, or null. */
export function answerPatternProblem(pattern: string): string | null {
  try {
    compileAnswerPattern(pattern, true);
    return null;
  } catch (e) {
    if (e instanceof RegexSyntaxError) return e.message;
    throw e;
  }
}

/**
 * Whether `submitted` matches one of `expected`. Throws BrokenAnswerError when
 * the lab itself is broken (an expected number that does not parse, an
 * invalid pattern), which must never count as a wrong answer.
 */
export function matchAnswer(rules: MatchRules, expected: string[], submitted: string): boolean {
  if (!expected.length) throw new BrokenAnswerError('no expected value');
  const ws = rules.whitespace ?? 'collapse';
  const cs = rules.caseSensitive ?? false;
  const got = normalize(submitted, ws, cs);
  switch (rules.match) {
    case 'exact':
    case 'any-of':
      return expected.some((e) => normalize(e, ws, cs) === got);
    case 'number': {
      const want = parseNumber(expected[0]!);
      if (want === undefined) throw new BrokenAnswerError(`expected value is not a number`);
      const have = parseNumber(submitted);
      if (have === undefined) return false;
      const tol = rules.tolerance ?? 0;
      return Math.abs(have - want) <= tol + 1e-9 * Math.max(1, Math.abs(want));
    }
    case 'regex': {
      let re: LinearRegex;
      try {
        re = compileAnswerPattern(expected[0]!, cs);
      } catch (e) {
        if (e instanceof RegexSyntaxError) throw new BrokenAnswerError(`invalid regex: ${e.message}`);
        throw e;
      }
      return re.test(got);
    }
    default:
      throw new BrokenAnswerError(`unknown match ${String(rules.match)}`);
  }
}

/** Accepted values of a computed answer: the output as is, or each non-empty line for any-of. */
export function computedExpected(match: AnswerMatch, computed: string): string[] {
  if (match !== 'any-of') return [computed];
  return computed
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => trim(l) !== '');
}

/** Points a solved question earns: points minus penalties and hint costs, never below 0. */
export function award(points: number, penalty: number, wrong: number, hintCost: number): number {
  return Math.max(0, points - penalty * wrong - hintCost);
}
