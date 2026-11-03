import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { award, BrokenAnswerError, computedExpected, matchAnswer, parseNumber, answerPatternProblem, type MatchRules } from '../src/answers/match.js';
import { repo } from './fakes.js';

interface Vector {
  name: string;
  answer: MatchRules;
  expected: string[];
  submitted: string;
  accepted: boolean;
  error?: boolean;
}

const doc = JSON.parse(readFileSync(path.join(repo, 'packages/lab-schema/testdata/answer-matchers.json'), 'utf8')) as { vectors: Vector[] };

describe('answer matcher (shared vectors with the Go matcher)', () => {
  it('has the vectors', () => expect(doc.vectors.length).toBeGreaterThan(20));
  for (const v of doc.vectors) {
    it(v.name, () => {
      if (v.error) {
        expect(() => matchAnswer(v.answer, v.expected, v.submitted)).toThrow(BrokenAnswerError);
        return;
      }
      expect(matchAnswer(v.answer, v.expected, v.submitted)).toBe(v.accepted);
    });
  }
});

describe('answer helpers', () => {
  it('splits computed any-of output into lines', () => {
    expect(computedExpected('any-of', 'a\r\n\n  \nb')).toEqual(['a', 'b']);
    expect(computedExpected('exact', 'a\nb')).toEqual(['a\nb']);
  });
  it('awards points minus penalties and hints, never below 0', () => {
    expect(award(100, 10, 2, 25)).toBe(55);
    expect(award(100, 30, 4, 0)).toBe(0);
  });
  it('parses plain decimals only', () => {
    expect(parseNumber(' 7 ')).toBe(7);
    expect(parseNumber('1e400')).toBeUndefined();
    expect(parseNumber('0x10')).toBeUndefined();
  });
});

// Patterns are built at runtime (join): as literals, static analysis would itself report them as ReDoS patterns.
const j = (...parts: string[]) => parts.join('');

describe('answer patterns run in linear time (no backtracking engine)', () => {
  it('accepts the shapes labs use', () => {
    for (const p of ['^PS?$', '(labelled|relabel-scheduled)', '(allow-[a-z]+ ){2}allow-[a-z]+', '3\\.3(\\.[0-9]+)?', '[1-9][0-9]*', '(~> *3\\.3(\\.[0-9]+)?|>= *3\\.3\\.[0-9]+)', '[(+*]+', 'a{2,5}b+', '(?:ab)+', '\\(x+\\)+', '(?<v>v[0-9]+)', 'x{,2}', '[a-]', '\\bword\\b']) {
      expect(answerPatternProblem(p), p).toBeNull();
    }
  });

  it('refuses what is not in the subset Go RE2 and JavaScript share', () => {
    expect(answerPatternProblem(j('(a)', '\\1'))).toMatch(/backreference/);
    expect(answerPatternProblem('foo(?=bar)')).toMatch(/lookaround/);
    expect(answerPatternProblem('(?<!x)y')).toMatch(/lookaround/);
    expect(answerPatternProblem('(?i)abc')).toMatch(/inline flags/);
    expect(answerPatternProblem('[[:alpha:]]')).toMatch(/POSIX/);
    expect(answerPatternProblem('[]a]')).toMatch(/start with \]/);
    expect(answerPatternProblem('a++')).toMatch(/nested repetition/);
    expect(answerPatternProblem('\\q')).toMatch(/unsupported escape/);
    expect(answerPatternProblem('a{1001}')).toMatch(/repeat count/);
    expect(answerPatternProblem('((a{1,100}){1,100})')).toMatch(/too large/);
    expect(answerPatternProblem('(unclosed')).not.toBeNull();
    // Go RE2 has no \\u (labctl verify would refuse what the gateway loads); \\x{...} is Go-only.
    expect(answerPatternProblem('\\u0041')).toMatch(/not RE2/);
    expect(answerPatternProblem('[\\u0041-\\u005a]')).toMatch(/not RE2/);
    expect(answerPatternProblem('\\x{41}')).toMatch(/2 hex digits/);
    expect(answerPatternProblem('\\x41')).toBeNull();
    // What JavaScript's parser refuses, the engine refuses on its own (no RegExp is built to check).
    for (const p of ['a{2,1}', '[z-a]', '(', ')', '*a', 'a|*', '[a', '\\']) expect(answerPatternProblem(p), p).not.toBeNull();
  });

  it('matches the patterns that hang a backtracking engine, quickly (review cases)', () => {
    const cases: [string, string, boolean][] = [
      [j('(a|a)', '{1,60}'), 'a'.repeat(25) + 'b', false],
      [j('(a+)', '{1,40}'), 'a'.repeat(25) + 'b', false],
      [j('\\s*', '\\s*', '\\s*', '\\s*', '\\s*', 'x'), ' '.repeat(150), false],
      [j('(?:a|a)?'.repeat(20)) + 'a'.repeat(20), 'a'.repeat(21), true],
      [j('(a+', ')+b'), 'a'.repeat(512), false],
      [j('(.*a)', '{20}'), 'a'.repeat(511) + 'b', false],
      [j('([a-z]+', '\\.?)*$'), 'a'.repeat(511) + '!', false],
    ];
    for (const [p, s, want] of cases) {
      const t0 = Date.now();
      expect(matchAnswer({ match: 'regex', whitespace: 'none' }, [p], s), p).toBe(want);
      expect(Date.now() - t0, p).toBeLessThan(500);
    }
  });

  it('compiles nested empty repeats at once (they add no states, so the state cap never fired)', () => {
    const cases: [string, string, boolean][] = [
      ['((((?:){1000}){1000}){1000})', '', true],
      ['(((((?:){1000}){1000}){1000}){1000}){1000}', 'x', false],
      ['((((){1000}){1000}){1000}){1000}', '', true],
      ['((((a{0}){1000}){1000}){1000}){1000}b', 'b', true],
      ['(((((?:)*){1000}){1000}){1000})', '', true],
      ['x(?:(?:){1000}){1000}y', 'xy', true],
      ['(?:(?:a{0}){0,1000}){1000}', 'a', false],
    ];
    for (const [p, s, want] of cases) {
      const t0 = Date.now();
      expect(answerPatternProblem(p), p).toBeNull();
      expect(matchAnswer({ match: 'regex', whitespace: 'none' }, [p], s), p).toBe(want);
      expect(Date.now() - t0, p).toBeLessThan(200);
    }
    // Nesting that does push states is still capped.
    expect(answerPatternProblem('(((a?){1000}){1000}){1000}')).toMatch(/too large/);
    expect(answerPatternProblem('((((?:)|a){1000}){1000}){1000}')).toMatch(/too large/);
  });

  it('agrees with JavaScript RegExp on safe patterns (differential)', () => {
    const patterns = ['[a-z]+-[0-9]{2}', 'cat|dog', '(ab|a)(bc|c)?', 'a{2,3}b?', 'x(y|z)*w', '[^0-9 ]+', '\\d+\\.\\d*', '\\w+@\\w+\\.com', '(?:a|b)+c{0,2}', 'v?1\\.2[0-9]', '\\bfoo\\b.*', '[A-F]{2}', '^ab$', 'a\\-b', '[\\]x]', '[.]+', '\\x41\\x42', '', 'a|'];
    const inputs = ['', 'a', 'ab', 'abc', 'abbc', 'web-01', 'Web-01', 'cat', 'dog', 'hotdog', 'aab', 'aaab', 'xw', 'xyzyw', 'abc ', '12.', '12.5', 'me@x.com', 'ababcc', 'v1.25', '1.29', 'foo bar', 'foobar', 'AF', 'af', 'a-b', ']', 'x', '..', 'AB', 'ab'];
    for (const p of patterns) {
      for (const cs of [true, false]) {
        const re = new RegExp(`^(?:${p})$`, cs ? '' : 'i');
        for (const s of inputs) {
          const got = cs ? s : s.toLowerCase();
          expect(matchAnswer({ match: 'regex', whitespace: 'none', caseSensitive: cs }, [p], got), `${p} ${cs} ${JSON.stringify(got)}`).toBe(re.test(got));
        }
      }
    }
  });

  it('accepts every regex answer pattern in content/', async () => {
    const { loadContent } = await import('../src/content/load.js');
    const c = await loadContent(path.join(repo, 'content'));
    expect(c.issues.filter((i) => /answer pattern/.test(i.message))).toEqual([]);
  });
});
