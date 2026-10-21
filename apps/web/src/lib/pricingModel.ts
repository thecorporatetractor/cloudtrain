import type { ComputeTierId, SitePlans } from '@/api/types';

/*
 * The pay-for-compute pricing model, read from the site configuration for the
 * public pages (pricing, coming-soon, landing). The rates live in
 * content/site.yaml `plans.compute` (owned by billing, docs/billing.md): a price
 * per compute unit and, per tier, the units a session uses per wall-clock
 * minute. Everything here reads that shape defensively, because the website
 * must render (with "rates to be announced") whether or not billing has
 * configured it yet, and never invents an amount.
 */

export const COMPUTE_TIERS: ComputeTierId[] = ['pod', 'vm', 'heavy'];

export const DEFAULT_TIER_LABEL: Record<ComputeTierId, string> = {
  pod: 'Pod labs',
  vm: 'VM labs',
  heavy: 'Multi-VM labs',
};

export interface ComputeRate {
  id: ComputeTierId;
  label: string;
  /** Price of one minute on this tier, in minor units of the currency (may be fractional). */
  perMinute: number;
}

export interface ComputeModel {
  currency: string;
  rates: ComputeRate[];
  /** A session is billed at least this many minutes (rounded up per minute). */
  minimumMinutes: number;
  /** The rates are placeholders, not offers. */
  placeholder: boolean;
}

export interface FreeTrial {
  /** Labs a free account may try. */
  labs: number;
  maxSessions?: number;
  maxMinutes?: number;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * The compute rates, or undefined while `plans.compute` is absent or incomplete.
 * Accepts the billing shape (`unitPrice` x `tiers.<id>.unitsPerMinute`) and, for a
 * hand-written configuration, a direct `perMinute` or `perHour` per tier (minor units).
 */
export function readCompute(plans: SitePlans | undefined): ComputeModel | undefined {
  const p = rec(plans);
  const c = rec(p?.compute);
  const tiers = rec(c?.tiers);
  if (!p || !c || !tiers) return undefined;
  const unit = num(c.unitPrice);
  const rates: ComputeRate[] = [];
  for (const id of COMPUTE_TIERS) {
    const t = rec(tiers[id]);
    if (!t) continue;
    const units = num(t.unitsPerMinute);
    const perMinute = units !== undefined && unit !== undefined ? units * unit : (num(t.perMinute) ?? (num(t.perHour) !== undefined ? num(t.perHour)! / 60 : undefined));
    if (perMinute === undefined) continue;
    rates.push({
      id,
      label: typeof t.label === 'string' && t.label ? t.label : DEFAULT_TIER_LABEL[id],
      perMinute,
    });
  }
  if (rates.length === 0) return undefined;
  const currency = typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) ? p.currency : 'EUR';
  return {
    currency,
    rates,
    minimumMinutes: Math.max(1, Math.floor(num(c.minimumMinutes) ?? 1)),
    placeholder: c.placeholder === true || p.placeholder === true,
  };
}

/** The free trial (`plans.free`), or undefined when none is configured. */
export function readFreeTrial(plans: SitePlans | undefined): FreeTrial | undefined {
  const f = rec(rec(plans)?.free);
  if (!f) return undefined;
  const labs = Array.isArray(f.trialLabs) ? f.trialLabs.length : 0;
  const maxSessions = num(f.maxSessions);
  const maxMinutes = num(f.maxMinutes);
  return {
    labs,
    ...(maxSessions !== undefined ? { maxSessions } : {}),
    ...(maxMinutes !== undefined ? { maxMinutes } : {}),
  };
}

/** Billed minutes for a session: whole minutes, rounded up, at least the minimum. */
export const billedMinutes = (minutes: number, minimum = 1) => Math.max(minimum, Math.ceil(Math.max(0, minutes)));

/** Cost of `sessions` sessions of `minutes` each on a tier, in minor units (rounded to a whole minor unit). */
export function sessionCost(rate: ComputeRate, minutes: number, model: Pick<ComputeModel, 'minimumMinutes'>, sessions = 1): number {
  return Math.round(billedMinutes(minutes, model.minimumMinutes) * rate.perMinute * Math.max(0, sessions));
}

/** Minor units -> currency, with up to `digits` fraction digits (rates need more than prices). */
export function formatMoney(minor: number, currency: string, digits = 2, locale?: string, keepCents = false): string {
  const major = minor / 100;
  const whole = Number.isInteger(major) && !keepCents;
  try {
    return new Intl.NumberFormat(locale ?? 'en', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : Math.max(2, digits) }).format(major);
  } catch {
    return `${major.toFixed(whole ? 0 : 2)} ${currency}`;
  }
}

/** "€0.90 an hour" for a tier, with the per-minute figure for the small print. */
export function rateLabels(rate: ComputeRate, currency: string): { hour: string; minute: string } {
  return {
    hour: formatMoney(rate.perMinute * 60, currency, 2, undefined, true),
    minute: formatMoney(rate.perMinute, currency, 4),
  };
}

/** Human duration: "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** A plan's tier level (billing: free 0, paid 1 unless set). */
export const planLevel = (plan: { kind: string; level?: number }): number => (typeof plan.level === 'number' ? plan.level : plan.kind === 'free' ? 0 : 1);

/**
 * Whether a plan opens early-access labs: `plans.earlyAccess[]` rules name the plan whose
 * level unlocks the labs they match (public labs are never locked). Undefined when no rule
 * is configured, so the row can be left out.
 */
export function earlyAccessFor(plans: SitePlans | undefined): ((plan: { id: string; kind: string; level?: number }) => boolean) | undefined {
  const p = rec(plans);
  const rules = Array.isArray(p?.earlyAccess) ? (p!.earlyAccess as unknown[]) : [];
  const items = (plans?.items ?? []) as { id: string; kind: string; level?: number }[];
  const levels = rules
    .map((r) => rec(r)?.plan)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is { id: string; kind: string; level?: number } => !!i)
    .map(planLevel);
  if (levels.length === 0) return undefined;
  const min = Math.min(...levels);
  return (plan) => planLevel(plan) >= min;
}

/** The enterprise features a plan includes (`plans.items[].features`: ids, or `{ id, label|name }`), as labels. */
export function planFeatures(plan: unknown): string[] | undefined {
  const f = rec(plan)?.features;
  if (!Array.isArray(f)) return undefined;
  return f
    .map((x) => (typeof x === 'string' ? x : (rec(x)?.label ?? rec(x)?.name ?? rec(x)?.id)))
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((x) => FEATURE_LABEL[x] ?? x);
}

/** Display names for the feature ids of docs/licensing.md (provisional ids; unknown ids show as given). */
const FEATURE_LABEL: Record<string, string> = {
  sso: 'SSO with your IdP',
  'sso-external': 'SSO with your IdP',
  scim: 'SCIM provisioning',
  'audit-export': 'Audit log export',
  'advanced-analytics': 'Advanced analytics',
  'exam-certificates': 'Exam certificates',
  'custom-branding': 'Custom branding',
  'multi-org': 'Multiple organisations',
};
