import { describe, expect, it } from 'vitest';
import type { SitePlans } from '@/api/types';
import { billedMinutes, earlyAccessFor, planFeatures, formatMinutes, formatMoney, rateLabels, readCompute, readFreeTrial, sessionCost } from './pricingModel';

const base = {
  currency: 'EUR',
  items: [
    {
      id: 'free',
      name: 'Free',
      kind: 'free',
      description: 'x',
      includes: [],
      cta: { label: 'Go', action: 'signin' },
    },
  ],
} as unknown as SitePlans;
const withCompute = (compute: unknown, extra: object = {}) => ({ ...base, ...extra, compute }) as unknown as SitePlans;

describe('readCompute', () => {
  it('is undefined while billing has not configured compute', () => {
    expect(readCompute(undefined)).toBeUndefined();
    expect(readCompute(base)).toBeUndefined();
    expect(readCompute(withCompute({ unitPrice: '0.5' }))).toBeUndefined();
    expect(readCompute(withCompute({ tiers: { pod: { label: 'Pod' } } }))).toBeUndefined();
  });

  it('multiplies the unit price by the units per minute of each tier', () => {
    const m = readCompute(
      withCompute({
        unitPrice: '0.5',
        minimumMinutes: 5,
        placeholder: true,
        tiers: {
          pod: { label: 'Pod', unitsPerMinute: 1 },
          vm: { label: 'VM', unitsPerMinute: 3 },
          heavy: { label: 'Multi-VM', unitsPerMinute: 8 },
        },
      }),
    );
    expect(m).toEqual({
      currency: 'EUR',
      minimumMinutes: 5,
      placeholder: true,
      rates: [
        { id: 'pod', label: 'Pod', perMinute: 0.5 },
        { id: 'vm', label: 'VM', perMinute: 1.5 },
        { id: 'heavy', label: 'Multi-VM', perMinute: 4 },
      ],
    });
  });

  it('accepts direct per-minute or per-hour rates and skips unusable tiers', () => {
    const m = readCompute(
      withCompute(
        {
          tiers: {
            pod: { perHour: 60 },
            vm: { perMinute: 2 },
            heavy: { unitsPerMinute: 'lots' },
          },
        },
        { placeholder: true },
      ),
    );
    expect(m?.rates).toEqual([
      { id: 'pod', label: 'Pod labs', perMinute: 1 },
      { id: 'vm', label: 'VM labs', perMinute: 2 },
    ]);
    expect(m?.placeholder).toBe(true);
    expect(m?.minimumMinutes).toBe(1);
  });
});

describe('readFreeTrial', () => {
  it('counts the trial labs and keeps the caps', () => {
    expect(readFreeTrial(base)).toBeUndefined();
    expect(
      readFreeTrial({
        ...base,
        free: { trialLabs: ['a'], maxSessions: 3, maxMinutes: 60 },
      } as unknown as SitePlans),
    ).toEqual({ labs: 1, maxSessions: 3, maxMinutes: 60 });
  });
});

describe('costs', () => {
  const rate = { id: 'vm' as const, label: 'VM', perMinute: 1.5 };
  it('rounds minutes up and applies the minimum', () => {
    expect(billedMinutes(0.2)).toBe(1);
    expect(billedMinutes(10.1)).toBe(11);
    expect(billedMinutes(2, 5)).toBe(5);
  });
  it('prices sessions in whole minor units', () => {
    expect(sessionCost(rate, 45, { minimumMinutes: 1 })).toBe(68); // 67.5 -> 68
    expect(sessionCost(rate, 45, { minimumMinutes: 1 }, 10)).toBe(675);
  });
  it('formats money, rates and durations', () => {
    expect(formatMoney(675, 'EUR')).toBe('€6.75');
    expect(formatMoney(900, 'EUR')).toBe('€9');
    expect(rateLabels(rate, 'EUR')).toEqual({
      hour: '€0.90',
      minute: '€0.015',
    });
    expect(rateLabels({ id: 'heavy', label: 'H', perMinute: 5 }, 'EUR').hour).toBe('€3.00');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });
});

describe('early access and features', () => {
  const items = [
    { id: 'free', kind: 'free' },
    { id: 'pro', kind: 'individual', level: 1 },
    { id: 'premium', kind: 'individual', level: 2 },
  ];
  it('is undefined without earlyAccess rules, otherwise opens from the lowest rule plan up', () => {
    expect(earlyAccessFor({ currency: 'EUR', items } as unknown as SitePlans)).toBeUndefined();
    const f = earlyAccessFor({ currency: 'EUR', items, earlyAccess: [{ plan: 'premium' }, { plan: 'nope' }] } as unknown as SitePlans)!;
    expect(items.map(f)).toEqual([false, false, true]);
  });
  it('reads feature ids or objects and names the known ones', () => {
    expect(planFeatures({})).toBeUndefined();
    expect(planFeatures({ features: ['scim', { id: 'x', label: 'Custom thing' }, 3] })).toEqual(['SCIM provisioning', 'Custom thing']);
  });
});
