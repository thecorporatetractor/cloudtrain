import { afterEach, describe, expect, it } from 'vitest';
import { clockOffset, dueWarning, EXPIRY_WARNINGS, labDeadline, resetSessionClocks, sessionClock, warningText, warningTitle } from './labClock';

describe('lab deadline', () => {
  it("prefers the gateway's expiresAt, which moves with extensions", () => {
    expect(labDeadline({ startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60, expiresAt: '2026-11-04T11:30:00Z' })).toBe(Date.parse('2026-11-04T11:30:00Z'));
  });

  it('falls back to start plus the limit', () => {
    expect(labDeadline({ startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60 })).toBe(Date.parse('2026-11-04T11:00:00Z'));
    expect(labDeadline({ startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60, expiresAt: 'garbage' })).toBe(Date.parse('2026-11-04T11:00:00Z'));
  });
});

describe('expiry warnings', () => {
  /** Runs a countdown second by second and collects the warnings given, like the Timer does. */
  const run = (from: number, to: number) => {
    const given = new Set<number>();
    const out: string[] = [];
    for (let r = from; r >= to; r--) {
      const due = dueWarning(r, given);
      if (due === undefined) continue;
      for (const t of EXPIRY_WARNINGS) if (t >= due) given.add(t);
      out.push(warningTitle(r, due));
    }
    return out;
  };

  it('warns at 10 and at 2 minutes left, once each', () => {
    expect(run(30 * 60, 1)).toEqual(['10 minutes left', '2 minutes left']);
  });

  it('opening a lab late warns with the time actually left, never a larger threshold', () => {
    expect(run(5 * 60, 1)).toEqual(['Less than 5 minutes left', '2 minutes left']);
    expect(run(4 * 60 + 30, 1)).toEqual(['Less than 5 minutes left', '2 minutes left']);
    expect(run(90, 1)).toEqual(['Less than 2 minutes left']);
    expect(run(40, 1)).toEqual(['Less than 1 minute left']);
  });

  it('says nothing once the time is up', () => {
    expect(dueWarning(0, new Set())).toBeUndefined();
    expect(dueWarning(-5, new Set())).toBeUndefined();
  });

  it('names the minutes left at the threshold, allowing for a late tick', () => {
    expect(warningText(600, 600)).toMatch(/^10 minutes left in this lab/);
    expect(warningText(597, 600)).toMatch(/^10 minutes left/);
    expect(warningText(120, 120)).toMatch(/^2 minutes left/);
    expect(warningText(300, 600)).toMatch(/^Less than 5 minutes left in this lab/);
  });
});

describe('per-session clock', () => {
  afterEach(() => resetSessionClocks());

  it('keeps the last gateway offset when a response has no serverTime', () => {
    expect(clockOffset('a', '2026-11-04T10:00:00Z', Date.parse('2026-11-04T10:25:00Z'))).toBe(-25 * 60_000);
    expect(clockOffset('a', undefined, Date.parse('2026-11-04T10:26:00Z'))).toBe(-25 * 60_000);
    // A new serverTime replaces it; other sessions are separate; with none ever seen, the browser clock.
    expect(clockOffset('a', '2026-11-04T10:30:00Z', Date.parse('2026-11-04T10:30:00Z'))).toBe(0);
    expect(clockOffset('b', undefined)).toBe(0);
    expect(clockOffset(undefined, undefined)).toBe(0);
  });

  it('remembers the warnings given across remounts', () => {
    sessionClock('a').given.add(600);
    expect(dueWarning(590, sessionClock('a').given)).toBeUndefined();
    expect(dueWarning(590, sessionClock('b').given)).toBe(600);
  });
});
