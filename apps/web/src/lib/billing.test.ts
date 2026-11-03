import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import raw from '../../../../content/site.yaml?raw';
import { ApiError } from '@/api/client';
import type { SiteConfig } from '@/api/types';
import { BLOCK_TITLE, accessChip, billingBlockOf, blockAction, formatMinor, siteComputeRates } from './billing';

const site = parse(raw) as SiteConfig;

describe('billing helpers', () => {
  it('reads a 402 payment_required refusal and ignores other errors', () => {
    const e = new ApiError(402, 'Add a payment method to start this lab.', 'payment_required', undefined, { reason: 'payment_method_required', action: 'add_payment_method', href: '/account/billing', scope: 'user' });
    expect(billingBlockOf(e)).toMatchObject({ reason: 'payment_method_required', message: 'Add a payment method to start this lab.' });
    expect(billingBlockOf(new ApiError(429, 'slow down', 'quota_exceeded'))).toBeUndefined();
    expect(billingBlockOf(new Error('x'))).toBeUndefined();
    expect(blockAction({ action: 'upgrade', requiredPlan: { id: 'pro', name: 'Pro', level: 1 } })).toBe('Upgrade to Pro');
  });

  it('reads the plan-limit refusals (concurrent labs, lab hours, exam simulations)', () => {
    const e = new ApiError(402, 'You already have 2 labs running, and the Pro plan allows 2 at a time.', 'payment_required', undefined, { reason: 'concurrent_limit', action: 'end_session', href: '/account/billing', scope: 'user', limit: 2, used: 2 });
    expect(billingBlockOf(e)).toMatchObject({ reason: 'concurrent_limit', action: 'end_session', limit: 2, used: 2, message: expect.stringMatching(/2 labs running/) });
    expect(blockAction({ action: 'end_session' })).toBe('See your running labs');
    expect(BLOCK_TITLE.exam_limit_reached).toMatch(/Exam simulations/);
    expect(BLOCK_TITLE.lab_hours_exhausted).toMatch(/Lab hours/);
  });

  it('derives the compute rates per hour from site.yaml', () => {
    expect(siteComputeRates(site).map((r) => [r.tier, r.pricePerHour])).toEqual([
      ['pod', 20],
      ['vm', 50],
      ['heavy', 150],
    ]);
    expect(formatMinor(20, 'EUR', 'en')).toBe('€0.20');
  });

  it('labels catalog rows: premium, free trial, locked, nothing for standard', () => {
    const base = { computeTier: 'pod' as const, unitsPerMinute: 1, pricePerHour: 30 };
    expect(accessChip({ ...base, requiredPlan: { id: 'pro', name: 'Pro', level: 1 }, locked: { reason: 'plan_required', message: 'm', action: 'upgrade', href: '/account/billing' } })?.label).toBe('Pro');
    expect(accessChip({ ...base, trial: true, free: true })?.label).toBe('Free trial');
    expect(accessChip({ ...base, locked: { reason: 'payment_method_required', message: 'm', action: 'add_payment_method', href: '/account/billing' } })?.label).toBe('Locked');
    expect(accessChip(base)).toBeUndefined();
  });
});
