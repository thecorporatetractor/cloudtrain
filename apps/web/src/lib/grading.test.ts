import { describe, expect, it } from 'vitest';
import { timedOutRunFinished } from './grading';

const s = (validations: number, phase: 'ready' | 'grading', status: 'pending' | 'pass' | 'fail') => ({ validations, phase, results: [{ checkId: 'a', status, skills: [] }] }) as never;

describe('timedOutRunFinished', () => {
  it('waits while the run is grading or results are pending', () => {
    expect(timedOutRunFinished(s(1, 'grading', 'pending'), s(1, 'grading', 'pending'))).toBe(false);
    expect(timedOutRunFinished(s(0, 'ready', 'pending'), s(0, 'ready', 'pending'))).toBe(false);
  });
  it('finishes when the run that was running answers', () => {
    expect(timedOutRunFinished(s(1, 'grading', 'pending'), s(1, 'ready', 'pass'))).toBe(true);
  });
  it('does not take the previous run (shown when Validate gave up) for the new one', () => {
    expect(timedOutRunFinished(s(1, 'ready', 'fail'), s(1, 'ready', 'fail'))).toBe(false);
    expect(timedOutRunFinished(s(1, 'ready', 'fail'), s(2, 'ready', 'pass'))).toBe(true);
  });
});
