import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { award, BrokenAnswerError, computedExpected, matchAnswer, parseNumber, type MatchRules } from '../src/answers/match.js';
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
