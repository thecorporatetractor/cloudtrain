import type { Framework, FrameworkDomain, SkillState } from '@/api/types';

/**
 * Framework readiness, shared by Home, Skills and the mock fixtures so every
 * screen shows the same number for the same learner.
 *
 * readiness = Σ domain.weight × mean μ of the domain's skills.
 */
export interface DomainReadiness {
  domainId: string;
  name: string;
  weight: number;
  /** Mean μ over the domain's skills (0 when none have a state). */
  mean: number;
  states: SkillState[];
}

export interface FrameworkReadiness {
  readiness: number;
  perDomain: DomainReadiness[];
  practised: number;
  total: number;
  maxSigma?: SkillState;
}

export function domainReadiness(domain: FrameworkDomain, stateOf: ReadonlyMap<string, SkillState>): DomainReadiness {
  const states = domain.skillIds.map((id) => stateOf.get(id)).filter((x): x is SkillState => !!x);
  const mean = states.length ? states.reduce((a, s) => a + s.mu, 0) / states.length : 0;
  return { domainId: domain.id, name: domain.name, weight: domain.weight, mean, states };
}

export function frameworkReadiness(framework: Framework, states: Iterable<SkillState> | ReadonlyMap<string, SkillState>): FrameworkReadiness {
  const stateOf: ReadonlyMap<string, SkillState> = states instanceof Map ? states : new Map(Array.from(states as Iterable<SkillState>, (s) => [s.skillId, s]));
  let readiness = 0;
  let practised = 0;
  let total = 0;
  let maxSigma: SkillState | undefined;
  const perDomain = framework.domains.map((d) => {
    const r = domainReadiness(d, stateOf);
    readiness += r.mean * d.weight;
    total += r.states.length;
    practised += r.states.filter((s) => s.evidence > 0).length;
    for (const s of r.states) if (!maxSigma || s.sigma > maxSigma.sigma) maxSigma = s;
    return r;
  });
  return { readiness, perDomain, practised, total, maxSigma };
}

/** Human label for a framework domain id such as "cks:cluster-setup" → "CKS · Cluster setup". */
export function frameworkDomainLabel(id: string, frameworks: Framework[] | undefined): string {
  const [fw, dom] = id.split(':');
  const framework = frameworks?.find((f) => f.id === fw);
  const domain = framework?.domains.find((d) => d.id === id);
  if (framework && domain) return `${framework.name} · ${domain.name}`;
  if (framework) return framework.name;
  return (fw ?? id).toUpperCase() + (dom ? ` · ${dom.replace(/-/g, ' ')}` : '');
}

/**
 * Integer percentages that sum to exactly 100 (largest-remainder rounding).
 * `weights` are any non-negative numbers; an all-zero input yields all zeros.
 */
export function percentages(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * 100);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}
