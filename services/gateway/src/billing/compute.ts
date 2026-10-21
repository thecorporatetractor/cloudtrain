import type { ComputeTier, SiteCompute, SitePlan, SitePremiumRule, SiteConfig, SiteSpendLimit } from '@cloudtrain/api-types';
import type { ContentLab } from '../content/load.js';

/*
 * The pricing model as data (content/site.yaml `plans`): compute tiers and
 * rates, premium-lab rules and plan levels, the free trial, default spend caps
 * and the dunning grace period. Pure functions; the service does the I/O.
 *
 * Compute tier from the lab's topology, the environment it really runs on:
 *   pod   only container nodes and virtual clusters (vcluster)
 *   vm    exactly one VM node
 *   heavy two or more VMs, a kubeadm cluster or a netdev topology
 */

type Topology = ContentLab['lab']['spec']['topology'];

export function computeTierOf(topology: Topology): ComputeTier {
  let vms = 0;
  for (const n of topology.nodes) {
    if (n.driver === 'netdev') return 'heavy';
    if (n.driver === 'k8s-cluster' && n.cluster?.mode === 'kubeadm') return 'heavy';
    if (n.driver === 'vm') vms++;
  }
  return vms >= 2 ? 'heavy' : vms === 1 ? 'vm' : 'pod';
}

/** Fallback rates when the site configures no `compute` (billing still meters). */
export const DEFAULT_COMPUTE: SiteCompute = {
  unitPrice: '0',
  lookupKey: 'ct_compute_unit',
  meterEventName: 'ct_compute_units',
  minimumMinutes: 1,
  placeholder: true,
  tiers: { pod: { label: 'Pod', unitsPerMinute: 1 }, vm: { label: 'VM', unitsPerMinute: 4 }, heavy: { label: 'Heavy', unitsPerMinute: 10 } },
};

export const DEFAULT_GRACE_DAYS = 7;
export const DEFAULT_TRIAL = { maxSessions: 3, maxMinutes: 60 } as const;

export interface LabFacts {
  id: string;
  domain: string;
  difficulty: string;
  tags?: string[];
  tier: ComputeTier;
}

export class PricingModel {
  readonly compute: SiteCompute;
  readonly unitPrice: number;

  constructor(private readonly site: SiteConfig) {
    this.compute = site.plans?.compute ?? DEFAULT_COMPUTE;
    this.unitPrice = Number(this.compute.unitPrice);
  }

  get plans(): SitePlan[] {
    return this.site.plans?.items ?? [];
  }

  get currency(): string {
    return this.site.plans?.currency ?? 'EUR';
  }

  /** Free 0, paid plans 1 unless configured. */
  level(plan: SitePlan | undefined): number {
    if (!plan) return 0;
    return plan.level ?? (plan.kind === 'free' ? 0 : 1);
  }

  unitsPerMinute(tier: ComputeTier): number {
    return this.compute.tiers[tier]?.unitsPerMinute ?? 0;
  }

  /** Minor units per hour on a tier. */
  pricePerHour(tier: ComputeTier): number {
    return round2(this.unitsPerMinute(tier) * 60 * this.unitPrice);
  }

  /** Billed minutes for a wall-clock duration: rounded up, at least `minimumMinutes` (0 ms stays 0 only when the minimum is 0). */
  billedMinutes(ms: number): number {
    const min = this.compute.minimumMinutes ?? 1;
    return Math.max(min, Math.ceil(Math.max(0, ms) / 60_000));
  }

  /** Minor units (estimate) for `units` at `unitPrice` (the price recorded when the session started). */
  amount(units: number, unitPrice = this.unitPrice): number {
    return round2(units * unitPrice);
  }

  /** The plan a premium lab needs (the highest level among matching rules), or undefined for a standard lab. */
  requiredPlan(lab: LabFacts): SitePlan | undefined {
    let best: SitePlan | undefined;
    for (const rule of this.site.plans?.premium ?? []) {
      if (!ruleMatches(rule, lab)) continue;
      const plan = this.plans.find((p) => p.id === rule.plan);
      if (plan && (!best || this.level(plan) > this.level(best))) best = plan;
    }
    return best;
  }

  get trial(): { labs: string[]; maxSessions: number; maxMinutes: number } {
    const f = this.site.plans?.free;
    return { labs: f?.trialLabs ?? [], maxSessions: f?.maxSessions ?? DEFAULT_TRIAL.maxSessions, maxMinutes: f?.maxMinutes ?? DEFAULT_TRIAL.maxMinutes };
  }

  isTrialLab(labId: string): boolean {
    return this.trial.labs.includes(labId);
  }

  defaultLimit(scope: 'user' | 'org'): Required<SiteSpendLimit> {
    const l = this.site.plans?.limits?.[scope];
    return { monthlyCap: l?.monthlyCap ?? 0, hardStop: l?.hardStop ?? false };
  }

  get graceDays(): number {
    return this.site.plans?.dunning?.graceDays ?? DEFAULT_GRACE_DAYS;
  }

  /** Configuration problems worth a startup warning (unknown plan ids in rules, unknown trial labs). */
  issues(labIds: ReadonlySet<string>): string[] {
    const out: string[] = [];
    for (const r of this.site.plans?.premium ?? []) if (!this.plans.some((p) => p.id === r.plan)) out.push(`plans.premium: unknown plan ${r.plan}`);
    for (const id of this.trial.labs) if (!labIds.has(id)) out.push(`plans.free.trialLabs: unknown lab ${id}`);
    return out;
  }
}

function ruleMatches(rule: SitePremiumRule, lab: LabFacts): boolean {
  if (rule.labs?.includes(lab.id)) return true;
  const selectors = [rule.domains, rule.difficulties, rule.computeTiers, rule.tags].filter((s) => s && s.length);
  if (selectors.length === 0) return false;
  if (rule.domains?.length && !rule.domains.includes(lab.domain)) return false;
  if (rule.difficulties?.length && !(rule.difficulties as string[]).includes(lab.difficulty)) return false;
  if (rule.computeTiers?.length && !rule.computeTiers.includes(lab.tier)) return false;
  if (rule.tags?.length && !rule.tags.some((t) => lab.tags?.includes(t))) return false;
  return true;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** First instant of the UTC calendar month of `at`, and of the next one. */
export function monthOf(at: Date): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)), end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)) };
}
