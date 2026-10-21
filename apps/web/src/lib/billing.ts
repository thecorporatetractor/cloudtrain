import type { BillingBlockDetails, BillingBlockReason, ComputeTier, LabAccess, SiteConfig } from '@/api/types';
import { ApiError } from '@/api/client';

/*
 * Pay-for-compute helpers shared by the billing pages, the catalog, the
 * workspace and the pricing page (docs/billing.md). The gateway decides
 * (`LabAccess`, `BillingBlockDetails`); this file only words and formats it.
 */

export const COMPUTE_TIER_LABEL: Record<ComputeTier, string> = { pod: 'Pod', vm: 'VM', heavy: 'Multi-VM' };

/** Minor units, possibly fractional (compute estimates), as money: always two decimals below 100 units. */
export function formatMinor(amount: number, currency: string, locale?: string): string {
  const major = amount / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

/** Compute rates from the site configuration (the pricing page; the app gets them from the summary). */
export function siteComputeRates(site: SiteConfig | undefined): { tier: ComputeTier; label: string; unitsPerMinute: number; pricePerHour: number }[] {
  const c = site?.plans?.compute;
  if (!c) return [];
  const unit = Number(c.unitPrice);
  return (['pod', 'vm', 'heavy'] as const).map((tier) => ({ tier, label: c.tiers[tier].label, unitsPerMinute: c.tiers[tier].unitsPerMinute, pricePerHour: Math.round(c.tiers[tier].unitsPerMinute * 60 * unit * 100) / 100 }));
}

export const BLOCK_TITLE: Record<BillingBlockReason, string> = {
  plan_required: 'A premium lab',
  trial_exhausted: 'Your free trial is used up',
  payment_method_required: 'Add a payment method to start this lab',
  payment_overdue: 'A payment is overdue',
  spend_cap_reached: 'Monthly spend cap reached',
};

export function blockAction(d: Pick<BillingBlockDetails, 'action' | 'requiredPlan'>): string {
  switch (d.action) {
    case 'upgrade':
      return d.requiredPlan ? `Upgrade to ${d.requiredPlan.name}` : 'See plans';
    case 'add_payment_method':
      return 'Add a payment method';
    case 'portal':
      return 'Update payment details';
    case 'raise_cap':
      return 'Change the spend cap';
    case 'contact_admin':
      return 'See billing';
  }
}

/** The billing refusal inside an API error (402 payment_required), if any. */
export function billingBlockOf(e: unknown): (BillingBlockDetails & { message: string }) | undefined {
  if (!(e instanceof ApiError) || e.code !== 'payment_required' || !e.details) return undefined;
  const d = e.details as unknown as BillingBlockDetails;
  return d.reason ? { ...d, message: e.message } : undefined;
}

/** Short label for a catalog row. */
export function accessChip(a: LabAccess | undefined): { label: string; tone: 'ok' | 'warn' | 'accent' | 'outline'; title: string } | undefined {
  if (!a) return undefined;
  if (a.locked?.reason === 'plan_required' && a.requiredPlan) return { label: a.requiredPlan.name, tone: 'accent', title: a.locked.message };
  if (a.trial && a.free) return { label: 'Free trial', tone: 'ok', title: 'Included in the free trial: no charge' };
  if (a.locked) return { label: 'Locked', tone: 'warn', title: a.locked.message };
  if (a.requiredPlan) return { label: a.requiredPlan.name, tone: 'outline', title: `Premium lab, included in your ${a.requiredPlan.name} plan or higher` };
  return undefined;
}
