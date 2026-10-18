import type { EnvTier, PlanEntitlements, PlanInterval, SitePlan } from '@/api/types';

/*
 * Plan helpers shared by the pricing page and the billing pages: price
 * formatting, interval maths and human-readable entitlements. Plans are data
 * (content/site.yaml `plans`), never code.
 */

export const TIER_LABEL: Record<EnvTier, string> = {
  A: 'Pod',
  B: 'Kata pod',
  C: 'Virtual machine',
  K: 'kubeadm cluster',
  V: 'Virtual cluster',
  N: 'Network devices',
};

/** Minor units -> localised currency string, without decimals when whole. */
export function formatAmount(amount: number, currency: string, locale?: string): string {
  const major = amount / 100;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${major.toFixed(whole ? 0 : 2)} ${currency}`;
  }
}

/** The price to show for an interval; falls back to the other interval when a plan has only one. */
export function priceFor(plan: SitePlan, interval: PlanInterval): { amount: number; interval: PlanInterval; lookupKey: string } | undefined {
  const p = plan.prices?.[interval] ?? plan.prices?.[interval === 'monthly' ? 'yearly' : 'monthly'];
  if (!p) return undefined;
  return { amount: p.amount, interval: plan.prices?.[interval] ? interval : interval === 'monthly' ? 'yearly' : 'monthly', lookupKey: p.lookupKey };
}

/** Percent saved by paying yearly, when both prices exist and yearly is cheaper. */
export function yearlySaving(plan: SitePlan): number | undefined {
  const m = plan.prices?.monthly?.amount;
  const y = plan.prices?.yearly?.amount;
  if (!m || !y || y >= m * 12) return undefined;
  return Math.round((1 - y / (m * 12)) * 100);
}

/** Yearly price shown per month ("€24 / month, billed yearly"). */
export const perMonth = (amount: number, interval: PlanInterval) => (interval === 'yearly' ? Math.round(amount / 12) : amount);

export const countLabel = (v: number | 'unlimited', unit: string) => (v === 'unlimited' ? `Unlimited ${unit}` : v === 0 ? `No ${unit}` : `${v} ${unit}`);

export interface EntitlementRow {
  key: keyof PlanEntitlements;
  label: string;
  value: (e: PlanEntitlements) => string;
  /** True when the plan has the thing at all (for check marks). */
  has: (e: PlanEntitlements) => boolean;
}

export const ENTITLEMENT_ROWS: EntitlementRow[] = [
  { key: 'labHoursPerMonth', label: 'Lab hours per month', value: (e) => (e.labHoursPerMonth === 'unlimited' ? 'Unlimited' : `${e.labHoursPerMonth} h`), has: (e) => e.labHoursPerMonth === 'unlimited' || e.labHoursPerMonth > 0 },
  { key: 'concurrentLabs', label: 'Concurrent labs', value: (e) => String(e.concurrentLabs), has: (e) => e.concurrentLabs > 0 },
  { key: 'envTiers', label: 'Environment tiers', value: (e) => (e.envTiers.length === 6 ? 'All tiers' : e.envTiers.map((t) => TIER_LABEL[t]).join(', ')), has: (e) => e.envTiers.length > 0 },
  { key: 'examSimulationsPerMonth', label: 'Exam simulations per month', value: (e) => (e.examSimulationsPerMonth === 'unlimited' ? 'Unlimited' : e.examSimulationsPerMonth === 0 ? 'None' : String(e.examSimulationsPerMonth)), has: (e) => e.examSimulationsPerMonth === 'unlimited' || e.examSimulationsPerMonth > 0 },
  { key: 'ctfEvents', label: 'CTF events', value: (e) => (e.ctfEvents ? 'Included' : 'Not included'), has: (e) => e.ctfEvents },
];

/** Short entitlement bullets for a plan card. */
export function entitlementSummary(e: PlanEntitlements): string[] {
  return [
    e.labHoursPerMonth === 'unlimited' ? 'Unlimited lab hours' : `${e.labHoursPerMonth} lab hours a month`,
    `${e.concurrentLabs} ${e.concurrentLabs === 1 ? 'lab' : 'labs'} at a time`,
    e.envTiers.length === 6 ? 'Every environment tier' : `${e.envTiers.map((t) => TIER_LABEL[t].toLowerCase()).join(' and ')} tiers`,
    e.examSimulationsPerMonth === 'unlimited' ? 'Unlimited exam simulations' : e.examSimulationsPerMonth === 0 ? 'No exam simulations' : `${e.examSimulationsPerMonth} exam ${e.examSimulationsPerMonth === 1 ? 'simulation' : 'simulations'} a month`,
    e.ctfEvents ? 'CTF events' : 'No CTF events',
  ];
}
