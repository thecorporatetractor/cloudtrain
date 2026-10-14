import { describe, expect, it } from 'vitest';
import { decayedSigma, evidenceWeight, expectedSuccess, MU0, prior, SIGMA0, SIGMA_MAX, SIGMA_MIN, trendOf, update } from '../src/learner/model.js';

const t0 = new Date('2026-10-01T00:00:00Z');
const days = (n: number) => new Date(t0.getTime() + n * 86_400_000);
const ev = (passed: boolean, over: Partial<{ weight: number; difficulty: number; hintsUsed: number; at: Date }> = {}) => ({ passed, weight: 1, difficulty: 0.5, hintsUsed: 0, at: t0, ...over });

describe('learner model', () => {
  it('starts from the prior and moves toward the evidence', () => {
    const p = prior(t0);
    expect(p).toMatchObject({ mu: MU0, sigma: SIGMA0, evidence: 0 });
    const up = update(p, ev(true));
    const down = update(p, ev(false));
    expect(up.mu).toBeGreaterThan(MU0);
    expect(down.mu).toBeLessThan(MU0);
    expect(up.evidence).toBe(1);
    expect(up.lastDelta).toBeCloseTo(up.mu - MU0);
  });

  it('shrinks sigma with evidence, never below the floor', () => {
    let b = prior(t0);
    for (let i = 0; i < 40; i++) b = update(b, ev(true, { at: t0 }));
    expect(b.sigma).toBeGreaterThanOrEqual(SIGMA_MIN - 1e-9);
    expect(b.sigma).toBeLessThan(0.1);
    expect(b.mu).toBeGreaterThan(0.8);
    expect(b.mu).toBeLessThanOrEqual(1);
  });

  it('grows sigma back with time (decay), capped', () => {
    const b = update(prior(t0), ev(true));
    expect(decayedSigma(b, days(60))).toBeGreaterThan(b.sigma);
    expect(decayedSigma(b, days(100_000))).toBeCloseTo(SIGMA_MAX);
  });

  it('rewards a hard pass more than an easy one and penalises an easy fail more than a hard one', () => {
    const p = prior(t0);
    expect(update(p, ev(true, { difficulty: 0.7 })).mu).toBeGreaterThan(update(p, ev(true, { difficulty: 0.3 })).mu);
    expect(update(p, ev(false, { difficulty: 0.3 })).mu).toBeLessThan(update(p, ev(false, { difficulty: 0.7 })).mu);
  });

  it('weights heavier checks more and discounts hinted passes', () => {
    const p = prior(t0);
    expect(update(p, ev(true, { weight: 3 })).mu).toBeGreaterThan(update(p, ev(true, { weight: 0.5 })).mu);
    expect(update(p, ev(true, { hintsUsed: 2 })).mu).toBeLessThan(update(p, ev(true)).mu);
    expect(evidenceWeight({ passed: false, weight: 1, hintsUsed: 3 })).toBe(1);
    expect(evidenceWeight({ passed: true, weight: 99, hintsUsed: 0 })).toBe(3);
  });

  it('moves less when certain', () => {
    let sure = prior(t0);
    for (let i = 0; i < 10; i++) sure = update(sure, ev(true));
    const unsure = { ...sure, sigma: SIGMA0 };
    expect(Math.abs(update(sure, ev(false)).mu - sure.mu)).toBeLessThan(Math.abs(update(unsure, ev(false)).mu - unsure.mu));
  });

  it('expected success is 0.5 at mu = difficulty and monotonic', () => {
    expect(expectedSuccess(0.5, 0.5)).toBeCloseTo(0.5);
    expect(expectedSuccess(0.8, 0.5)).toBeGreaterThan(expectedSuccess(0.6, 0.5));
  });

  it('reports trends and forgets them after a month', () => {
    const b = update(prior(t0), ev(true));
    expect(trendOf(b, t0)).toBe('up');
    expect(trendOf(update(prior(t0), ev(false)), t0)).toBe('down');
    expect(trendOf(b, days(45))).toBe('flat');
  });
});
