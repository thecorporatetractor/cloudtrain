import { ArrowRight, Check, Minus } from 'lucide-react';
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ComputeTierId, SiteConfig, SitePlan, SitePricingModel } from '@/api/types';
import { formatAmount, perMonth, priceFor } from '@/lib/plans';
import { bestPack, COMPUTE_TIERS, DEFAULT_TIER_LABEL, earlyAccessFor, planFeatures, formatMinutes, formatMoney, rateLabels, readCompute, readFreeTrial, readPacks, sessionCost, withPack, type ComputeModel, type ComputeRate } from '@/lib/pricingModel';
import { isComingSoon } from './launch';
import { cn } from '@/lib/utils';
import { FeatureIcon, SiteAnchor } from './util';

/*
 * "How pricing works": the pay-for-compute model explained for visitors, on the
 * pricing page, the coming-soon page and (as a teaser) the landing page. The
 * words come from content/site.yaml `pricing.model`; every amount from
 * `plans` (compute rates, plan prices), read defensively (src/lib/pricingModel.ts).
 * While billing has no rates configured the page says "to be announced" instead
 * of inventing a figure; `plans.taxNote` is the one line of small print next to
 * the amounts (currency, VAT, that launch prices may change).
 */

const PENDING = 'Rates to be announced';

/** Relative weight of each tier, for the ladder when there are no rates yet. */
const WEIGHT: Record<ComputeTierId, number> = { pod: 1, vm: 2, heavy: 3 };

export function usePricing(site: SiteConfig) {
  return useMemo(() => {
    const compute = readCompute(site.plans);
    return {
      compute,
      trial: readFreeTrial(site.plans),
      packs: readPacks(site.plans),
      model: site.pricing?.model,
    };
  }, [site]);
}

/** A placeholder marker: amounts on the public pages are not offers until plans are final. */
export function PlaceholderTag({ children = 'Placeholder' }: { children?: string }) {
  return <span className="ct-tag ct-tag-warn">{children}</span>;
}

/* --------------------------------------------------------------- steps */

export function PricingSteps({ model }: { model: SitePricingModel }) {
  return (
    <ol className="pm-steps" data-reveal="children">
      {model.steps.map((s, i) => (
        <li key={s.title} className="pm-step">
          <span className="pm-step-n tnum" aria-hidden>
            {String(i + 1).padStart(2, '0')}
          </span>
          {s.icon && (
            <span className="pm-step-icon" aria-hidden>
              <FeatureIcon icon={s.icon} size={18} />
            </span>
          )}
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------------------------------------- paths */

/**
 * The ways to run CloudTrain side by side (pricing.model.paths): self-host free, the hosted
 * service paid per minute of compute, enterprise features by subscription or license key.
 * The `hosted` path shows the compute rates from plans.
 */
export function PricingPaths({ site }: { site: SiteConfig }) {
  const { compute, model } = usePricing(site);
  const paths = model?.paths ?? [];
  if (paths.length === 0) return null;
  const from = compute?.rates[0];
  return (
    <ul className={cn('pm-paths', paths.length === 2 && 'pm-paths-2')} aria-label="Ways to run CloudTrain" data-reveal="children">
      {paths.map((p) => (
        <li key={p.id} className={cn('pm-path', `pm-path-${p.id}`)}>
          <div className="pm-path-head">
            {p.icon && (
              <span className="pm-step-icon" aria-hidden>
                <FeatureIcon icon={p.icon} size={18} />
              </span>
            )}
            {p.eyebrow && <span className="pm-path-eyebrow">{p.eyebrow}</span>}
          </div>
          <h3>{p.title}</h3>
          {(p.price || (p.id === 'hosted' && from && compute)) && (
            <p className="pm-path-figure">
              {p.price && <span className="pm-path-price">{p.price}</span>}
              {p.id === 'hosted' && from && compute && (
                <span className="pm-path-rate">
                  from <span className="tnum">{rateLabels(from, compute.currency).hour}</span> an hour
                </span>
              )}
            </p>
          )}
          <p className="pm-path-body">{p.body}</p>
          {p.points && p.points.length > 0 && (
            <ul className="pm-path-points">
              {p.points.map((pt) => (
                <li key={pt}>
                  <Check size={14} aria-hidden className="pm-yes" /> {pt}
                </li>
              ))}
            </ul>
          )}
          {p.cta && (
            <SiteAnchor to={p.cta.to} className="btn btn-secondary btn-md pm-path-cta">
              {p.cta.label} <ArrowRight size={14} aria-hidden />
            </SiteAnchor>
          )}
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------- tiers */

function tierRows(
  compute: ComputeModel | undefined,
  model: SitePricingModel | undefined,
): {
  id: ComputeTierId;
  name: string;
  body?: string;
  examples?: string[];
  rate?: ComputeRate;
}[] {
  return COMPUTE_TIERS.map((id) => {
    const copy = model?.tiers?.[id];
    const rate = compute?.rates.find((r) => r.id === id);
    return {
      id,
      name: copy?.name ?? rate?.label ?? DEFAULT_TIER_LABEL[id],
      body: copy?.body,
      examples: copy?.examples,
      rate,
    };
  }).filter((t) => t.rate || t.body);
}

export function ComputeTiers({ site }: { site: SiteConfig }) {
  const { compute, model } = usePricing(site);
  const rows = tierRows(compute, model);
  const max = Math.max(...rows.map((r) => r.rate?.perMinute ?? 0), 0);
  return (
    <ul className="pm-tiers" aria-label="Compute tiers" data-reveal="children">
      {rows.map((t) => {
        const share = t.rate && max > 0 ? t.rate.perMinute / max : WEIGHT[t.id] / 3;
        const labels = t.rate && compute ? rateLabels(t.rate, compute.currency) : undefined;
        return (
          <li key={t.id} className={cn('pm-tier', `pm-tier-${t.id}`)} aria-labelledby={`pm-tier-${t.id}`}>
            <div className="pm-tier-head">
              <h3 id={`pm-tier-${t.id}`}>{t.name}</h3>
              <span className="pm-tier-glyph" aria-hidden>
                {Array.from({ length: 3 }, (_, i) => (
                  <i key={i} className={i < WEIGHT[t.id] ? 'is-on' : undefined} />
                ))}
              </span>
            </div>
            <div className="pm-tier-rate">
              {labels ? (
                <>
                  <span className="pm-tier-amount tnum">
                    {labels.hour}
                    <span className="pm-tier-unit">/h</span>
                  </span>
                  <span className="pm-tier-per tnum">{labels.minute}/min, billed per minute</span>
                </>
              ) : (
                <span className="pm-tier-per">{model?.pendingNote ?? PENDING}</span>
              )}
            </div>
            <div className="pm-tier-bar" aria-hidden>
              <span style={{ width: `${Math.max(12, Math.round(share * 100))}%` }} />
            </div>
            {t.body && <p>{t.body}</p>}
            {t.examples && t.examples.length > 0 && (
              <p className="pm-tier-examples" aria-label={`${t.name}, for example: ${t.examples.join(', ')}`}>
                <FitLabels items={t.examples} className="pm-tier-examples-in" />
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Labels on one line: as many whole ones as fit, then "+N" for the rest. Measured from a hidden
 * probe of every label (so the measure never depends on what is shown) whenever the width changes.
 */
function FitLabels({ items, className }: { items: string[]; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(items.length);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const probe = el.querySelector<HTMLElement>('.pm-fit-probe');
      const more = el.querySelector<HTMLElement>('.pm-fit-more-probe');
      if (!probe || !more) return;
      const width = el.clientWidth;
      const spans = Array.from(probe.children) as HTMLElement[];
      let n = 0;
      for (let i = 0; i < spans.length; i++) {
        const right = spans[i]!.offsetLeft + spans[i]!.offsetWidth;
        const room = i === spans.length - 1 ? width : width - more.offsetWidth - 6;
        if (right <= room) n = i + 1;
        else break;
      }
      setFit((cur) => (cur === n ? cur : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [items]);
  const shown = items.slice(0, fit);
  const rest = items.length - shown.length;
  return (
    <span ref={ref} className={cn('pm-fit', className)}>
      <span className="pm-fit-probe" aria-hidden>
        {items.map((e, i) => (
          <span key={e}>
            {i > 0 && <i>·</i>}
            {e}
          </span>
        ))}
      </span>
      <span className="pm-fit-more-probe" aria-hidden>
        +{items.length}
      </span>
      {shown.map((e, i) => (
        <span key={e}>
          {i > 0 && <i aria-hidden>·</i>}
          {e}
        </span>
      ))}
      {rest > 0 && <span className="pm-fit-more tnum">+{rest}</span>}
    </span>
  );
}

/* --------------------------------------------------------------- packs */

/** The prepaid compute packs (`plans.compute.packs`): a strip under the tiers, "prepay and save". */
export function ComputePacks({ site }: { site: SiteConfig }) {
  const { compute, packs } = usePricing(site);
  if (!compute || !packs) return null;
  const c = compute.currency;
  const note = `${packs.note ?? `Credit valid ${packs.validMonths} months, spent at the tier rates, on every paid plan.`}${packs.proposal ? ' Proposed amounts.' : ''}`;
  return (
    <section className="pm-packs" aria-labelledby="pm-packs-title" data-reveal>
      <div className="pm-packs-copy">
        <h3 id="pm-packs-title">{packs.maxBonus > 0 ? `Prepay and save up to ${packs.maxBonus}%` : 'Prepay for compute'}</h3>
        <p title={note}>{note}</p>
      </div>
      <ul className="pm-packs-list" aria-label="Packs">
        {packs.items.map((pk) => (
          <li key={pk.price} className={cn('pm-pack', pk.bonusPercent === packs.maxBonus && packs.maxBonus > 0 && 'is-best')}>
            <span className="pm-pack-price tnum">{formatMoney(pk.price, c)}</span>
            {pk.bonusPercent > 0 ? (
              <>
                <span className="pm-pack-arrow" aria-hidden>
                  →
                </span>
                <span className="pm-pack-credit tnum">{formatMoney(pk.credit, c)}</span>
                <span className="pm-pack-bonus tnum">+{pk.bonusPercent}%</span>
              </>
            ) : (
              <span className="pm-pack-credit pm-pack-credit-flat">at cost</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------- estimator */

/** What the estimator estimates: the lab's tier, the minutes of a session and the sessions in a month. */
export interface EstimateInput {
  tier: ComputeTierId;
  minutes: number;
  sessions: number;
}

/** The estimator's starting point, from the configuration (`pricing.model.estimator`) and the rates there are. */
export function defaultEstimate(site: SiteConfig): EstimateInput {
  const { compute, model } = pricingData(site);
  const est = model?.estimator;
  const tiers = compute?.rates ?? [];
  return {
    tier: est?.defaultTier && tiers.some((t) => t.id === est.defaultTier) ? est.defaultTier : (tiers[1]?.id ?? tiers[0]?.id ?? 'vm'),
    minutes: est?.defaultMinutes ?? 45,
    sessions: est?.defaultSessions ?? 12,
  };
}
function pricingData(site: SiteConfig) {
  return { compute: readCompute(site.plans), model: site.pricing?.model };
}

/** A slider with its filled track (site.css .pm-range; the motion engine moves the fill with its sweep). */
function Range({ id, min, max, step, value, onChange }: { id: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return <input id={id} className="pm-range" type="range" min={min} max={max} step={step} value={value} data-count-range style={{ '--pct': `${((value - min) / (max - min)) * 100}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />;
}

/**
 * The estimator. On its own it keeps its state; given `value` and `onChange` it is driven from
 * outside (ComputeSplit, where the worked examples set it).
 */
export function Estimator({ site, value, onChange }: { site: SiteConfig; value?: EstimateInput; onChange?: (v: EstimateInput) => void }) {
  const { compute, model, packs } = usePricing(site);
  const est = model?.estimator;
  const uid = useId();
  const tiers = compute?.rates ?? [];
  const [own, setOwn] = useState<EstimateInput>(() => defaultEstimate(site));
  const { tier, minutes, sessions } = value ?? own;
  const set = (patch: Partial<EstimateInput>) => (onChange ?? setOwn)({ tier, minutes, sessions, ...patch });
  const rate = tiers.find((t) => t.id === tier);
  const names = Object.fromEntries(tierRows(compute, model).map((r) => [r.id, r.name]));

  if (!compute || !rate) {
    return (
      <div className="pm-estimator pm-estimator-pending">
        <h3>{est?.title ?? 'Estimate your month'}</h3>
        <p className="pm-formula" aria-label="Your monthly bill is the minutes your labs run, times the rate of their tier, plus a subscription if you choose one.">
          <span className="pm-term">
            <strong>Minutes</strong> your labs run
          </span>
          <span className="pm-op" aria-hidden>
            ×
          </span>
          <span className="pm-term">
            <strong>Rate</strong> of the lab&apos;s tier
          </span>
          <span className="pm-op" aria-hidden>
            +
          </span>
          <span className="pm-term pm-term-optional">
            <strong>Subscription</strong> if you want premium
          </span>
        </p>
        <p>{model?.pendingNote ?? PENDING}. The estimator opens here as soon as the per-minute rates are published.</p>
      </div>
    );
  }
  const one = sessionCost(rate, minutes, compute);
  const month = sessionCost(rate, minutes, compute, sessions);
  const pack = bestPack(packs, month);
  const note = `${est?.note ?? 'Billed per started minute while a lab runs. A subscription, if you have one, is billed separately.'}${site.plans?.taxNote ? ` ${site.plans.taxNote}` : ''}`;
  return (
    <div className="pm-estimator">
      <div className="pm-estimator-controls">
        <div className="pm-estimator-top">
          <h3 id={`${uid}-t`}>{est?.title ?? 'Estimate your month'}</h3>
          <fieldset className="pm-field pm-field-tier">
            <legend className="sr-only">Lab type</legend>
            <div className="pm-radios">
              {tiers.map((t) => (
                <label key={t.id} className={cn('pm-radio', t.id === tier && 'is-on')}>
                  <input type="radio" name={`${uid}-tier`} value={t.id} checked={t.id === tier} onChange={() => set({ tier: t.id })} />
                  {names[t.id] ?? t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="pm-estimator-sliders">
          <div className="pm-field">
            <label htmlFor={`${uid}-min`}>
              Minutes per session <output className="tnum">{formatMinutes(minutes)}</output>
            </label>
            <Range id={`${uid}-min`} min={5} max={240} step={5} value={minutes} onChange={(v) => set({ minutes: v })} />
          </div>
          <div className="pm-field">
            <label htmlFor={`${uid}-ses`}>
              Sessions per month <output className="tnum">{sessions}</output>
            </label>
            <Range id={`${uid}-ses`} min={1} max={40} step={1} value={sessions} onChange={(v) => set({ sessions: v })} />
          </div>
        </div>
      </div>
      <div className="pm-estimator-result" aria-live="polite">
        <div className="pm-estimator-figure">
          <span className="pm-estimator-label">About</span>
          <span className="pm-estimator-amount tnum" data-count>
            {formatMoney(month, compute.currency)}
          </span>
          <span className="pm-estimator-label">of compute a month</span>
        </div>
        <dl className="pm-estimator-lines">
          <div>
            <dt>One session</dt>
            <dd className="tnum" data-count>
              {formatMoney(one, compute.currency)}
            </dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd className="tnum">{rateLabels(rate, compute.currency).hour} an hour</dd>
          </div>
          <div>
            <dt>Time in labs</dt>
            <dd className="tnum">{formatMinutes(minutes * sessions)}</dd>
          </div>
        </dl>
        {pack && (
          <p className="pm-estimator-pack">
            <span>
              or about <b className="tnum">{formatMoney(withPack(month, pack), compute.currency)}</b> a month from the {formatMoney(pack.price, compute.currency)} pack
            </span>
            <span className="pm-estimator-pack-bonus tnum">+{pack.bonusPercent}% credit</span>
          </p>
        )}
        {/* one line; the whole note is in the title */}
        <p className="pm-estimator-note" title={note}>
          {note}
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- worked examples */

/**
 * The worked examples (`pricing.model.examples`): each a card with its tier (and where the tier
 * sits on the ladder of rates), its minutes and sessions and what that costs. With `onPick` a
 * card is a button that puts the example into the estimator; `picked` marks the one it shows.
 */
export function WorkedExamples({ site, onPick, picked }: { site: SiteConfig; onPick?: (v: EstimateInput) => void; picked?: EstimateInput }) {
  const { compute, model } = usePricing(site);
  const examples = model?.examples ?? [];
  if (examples.length === 0) return null;
  const names = Object.fromEntries(tierRows(compute, model).map((r) => [r.id, r.name]));
  const max = Math.max(...(compute?.rates.map((r) => r.perMinute) ?? []), 0);
  return (
    <ul className="pm-examples" aria-label="Worked examples" data-reveal="children">
      {examples.map((e) => {
        const rate = compute?.rates.find((r) => r.id === e.tier);
        const sessions = e.sessions ?? 1;
        const cost = rate && compute ? sessionCost(rate, e.minutes, compute, sessions) : undefined;
        const share = rate && max > 0 ? rate.perMinute / max : WEIGHT[e.tier] / 3;
        const input: EstimateInput = { tier: e.tier, minutes: e.minutes, sessions };
        const isOn = !!picked && picked.tier === e.tier && picked.minutes === e.minutes && picked.sessions === sessions;
        const body = (
          <>
            <div className="pm-example-meta">
              <span className={cn('pm-chip', `pm-chip-${e.tier}`)}>{names[e.tier] ?? DEFAULT_TIER_LABEL[e.tier]}</span>
              <span className="tnum">
                {formatMinutes(e.minutes)}
                {sessions > 1 ? ` × ${sessions}` : ''}
              </span>
            </div>
            <h3>{e.title}</h3>
            {e.body && <p>{e.body}</p>}
            <div className="pm-example-cost">
              {cost !== undefined && compute ? (
                <>
                  <span className="pm-example-amount tnum" data-count>
                    {formatMoney(cost, compute.currency)}
                  </span>
                  <span className="pm-example-per">{sessions > 1 ? 'a month' : 'for the session'}</span>
                  {rate && <span className="pm-example-rate tnum">{rateLabels(rate, compute.currency).hour}/h</span>}
                </>
              ) : (
                <span className="pm-example-per">{PENDING}</span>
              )}
            </div>
            {/* where the tier sits among the rates: the same ladder as the tiers above */}
            <span className={cn('pm-example-bar', `pm-example-bar-${e.tier}`)} aria-hidden>
              <i style={{ width: `${Math.max(14, Math.round(share * 100))}%` }} />
            </span>
          </>
        );
        return (
          <li key={e.title} className={cn('pm-example', onPick && 'pm-example-pick', isOn && 'is-on')}>
            {onPick ? (
              <button type="button" className="pm-example-btn" aria-pressed={isOn} onClick={() => onPick(input)}>
                {body}
                <span className="pm-example-hint">{isOn ? 'In the estimator' : 'Try in the estimator'}</span>
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The estimator beside the worked examples, which set it: one state for both. */
export function ComputeSplit({ site }: { site: SiteConfig }) {
  const [value, setValue] = useState<EstimateInput>(() => defaultEstimate(site));
  return (
    <div className="pm-split">
      <Estimator site={site} value={value} onChange={setValue} />
      <div className="pm-split-examples">
        <h3 className="pm-split-title">Worked examples</h3>
        <WorkedExamples site={site} onPick={setValue} picked={value} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------ tier comparison */

const planPrice = (pl: SitePlan, currency: string): { text: string; sub?: string } => {
  if (pl.kind === 'free' || !pl.prices) return { text: 'Free' };
  const p = priceFor(pl, 'monthly');
  if (!p) return { text: '—' };
  return {
    text: formatAmount(perMonth(p.amount, p.interval), currency),
    sub: `${pl.perSeat ? 'per seat ' : ''}a month${p.interval === 'yearly' ? ', billed yearly' : ''}`,
  };
};

/** The first line of a plan's `includes` that matches, e.g. its support level. */
const includesLine = (plan: SitePlan, re: RegExp): string | undefined => plan.includes.find((l) => re.test(l));

/**
 * Plans side by side, on the axes of the model: what the subscription costs (in the
 * head, with who the plan is for and its call to action), how compute is paid, the
 * prepaid packs, which labs and how many at once it opens, the exam simulations, the
 * spend cap, seats, single sign-on, support. Rows a configuration cannot answer are left
 * out. On a phone the same plans are cards, one under the other.
 */
export function PlanComparison({ site }: { site: SiteConfig }) {
  const { compute, trial, packs } = usePricing(site);
  const plans = site.plans;
  if (!plans || plans.items.length === 0) return null;
  type Cell = { yes: boolean; text: string; sub?: string };
  const early = earlyAccessFor(plans);
  const soon = isComingSoon(site);
  const c = plans.currency;
  const contact = site.pricing?.contactCta ?? { label: 'Talk to us', to: '/contact' };
  const ctaFor = (p: SitePlan) => (p.kind === 'organisation' || p.cta.action === 'contact' ? contact : soon ? { label: 'Join the waitlist', to: '#waitlist' } : { label: p.cta.label, to: '/sign-in' });
  const cap = (p: SitePlan) => (p.kind === 'organisation' ? plans.limits?.org : plans.limits?.user);
  const rows: { label: string; cell: (p: SitePlan) => Cell }[] = [
    {
      label: 'Compute',
      cell: (p) =>
        p.kind === 'free'
          ? {
              yes: true,
              text: trial?.labs ? `${trial.labs === 1 ? 'One trial lab' : `${trial.labs} trial labs`}, free` : 'A trial lab, free',
              ...(trial?.maxMinutes ? { sub: `up to ${formatMinutes(trial.maxMinutes)}` } : {}),
            }
          : {
              yes: true,
              text: 'Pay per minute',
              sub: compute ? 'at the tier rates above' : 'rates to be announced',
            },
    },
    ...(packs
      ? [{ label: 'Prepaid packs', cell: (p: SitePlan): Cell => (p.kind === 'free' ? { yes: false, text: 'Pay as you go' } : { yes: true, text: packs.maxBonus > 0 ? `Up to ${packs.maxBonus}% bonus credit` : 'Available', sub: `credit valid ${packs.validMonths} months` }) }]
      : []),
    {
      label: 'Public labs',
      cell: (p) => (p.kind === 'free' ? { yes: true, text: 'Every public lab', sub: 'the trial lab free, then per minute' } : { yes: true, text: 'Every public lab', sub: 'never locked behind a tier' }),
    },
    ...(early ? [{ label: 'Early-access labs', cell: (p: SitePlan): Cell => (early(p) ? { yes: true, text: 'Included' } : { yes: false, text: 'Not included' }) }] : []),
    {
      label: 'Exam simulations',
      cell: (p) => {
        const n = p.entitlements?.examSimulationsPerMonth;
        if (n === undefined) return { yes: p.kind !== 'free', text: p.kind === 'free' ? 'Not included' : 'Included' };
        return n === 0 ? { yes: false, text: 'Not included' } : { yes: true, text: n === 'unlimited' ? 'Unlimited' : `${n} a month` };
      },
    },
    ...(plans.items.some((p) => p.entitlements?.concurrentLabs)
      ? [{ label: 'Labs at once', cell: (p: SitePlan): Cell => ({ yes: true, text: p.entitlements?.concurrentLabs ? `${p.entitlements.concurrentLabs} at a time` : 'One at a time' }) }]
      : []),
    ...(plans.limits
      ? [{ label: 'Spend cap', cell: (p: SitePlan): Cell => (cap(p)?.monthlyCap ? { yes: true, text: `${formatMoney(cap(p)!.monthlyCap, c)} a month`, sub: 'the default, yours to change' } : { yes: true, text: 'None by default', sub: 'set one any time' }) }]
      : []),
    {
      label: 'Seats',
      cell: (p) => (p.kind === 'organisation' ? { yes: true, text: p.minSeats ? `From ${p.minSeats} seats` : 'Per seat', sub: 'admins assign them' } : { yes: true, text: 'One person' }),
    },
    ...(plans.items.some((p) => includesLine(p, /single sign-on|\bsso\b/i))
      ? [{ label: 'Single sign-on', cell: (p: SitePlan): Cell => (includesLine(p, /single sign-on|\bsso\b/i) ? { yes: true, text: 'With your identity provider' } : { yes: false, text: 'Not included' }) }]
      : []),
    ...(plans.items.some((p) => includesLine(p, /support/i)) ? [{ label: 'Support', cell: (p: SitePlan): Cell => ({ yes: true, text: includesLine(p, /support/i) ?? 'Community support' }) }] : []),
    ...(plans.items.some((p) => planFeatures(p)?.length)
      ? [
          {
            label: 'Enterprise features',
            cell: (p: SitePlan): Cell => {
              const f = planFeatures(p) ?? [];
              return f.length ? { yes: true, text: f.slice(0, 3).join(', '), ...(f.length > 3 ? { sub: `and ${f.length - 3} more` } : {}) } : { yes: false, text: 'Not included' };
            },
          },
        ]
      : []),
  ];
  const head = (p: SitePlan) => {
    const pr = planPrice(p, c);
    const cta = ctaFor(p);
    return (
      <div className="pm-plan-head">
        <span className="pm-plan-name">
          {p.name}
          {p.highlight && <span className="pm-plan-tag">Recommended</span>}
        </span>
        <span className="pm-plan-price">
          <b className="tnum">{pr.text}</b>
          <span>{pr.sub ?? (p.kind === 'free' ? 'no card needed' : '')}</span>
        </span>
        {p.audience && <span className="pm-plan-audience">{p.audience}</span>}
        <SiteAnchor to={cta.to} className={cn('btn btn-md pm-plan-cta', p.highlight ? 'btn-primary' : 'btn-secondary')}>
          {cta.label} <ArrowRight size={13} aria-hidden />
        </SiteAnchor>
      </div>
    );
  };
  const mark = (yes: boolean) => (
    <span className={cn('pm-mark', yes ? 'is-yes' : 'is-no')} aria-hidden>
      {yes ? <Check size={12} /> : <Minus size={12} />}
    </span>
  );
  return (
    <>
      <div className="pm-compare-wrap">
        <table className="pm-compare">
          <caption className="sr-only">Plans compared</caption>
          <thead>
            <tr>
              <td />
              {plans.items.map((p) => (
                <th key={p.id} scope="col" className={cn('pm-plan-col', p.highlight && 'is-highlight')}>
                  {head(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {plans.items.map((p) => {
                  const cell = r.cell(p);
                  return (
                    <td key={p.id} className={cn(!cell.yes && 'is-no', p.highlight && 'is-highlight')}>
                      <span className="pm-cell">
                        {mark(cell.yes)}
                        <span>
                          {cell.text}
                          {cell.sub && <span className="pm-cell-sub">{cell.sub}</span>}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {plans.taxNote && <p className="pm-compare-note">{plans.taxNote}</p>}
      </div>
      {/* Phones: the plans as cards, one under the other (site.css shows one or the other). */}
      <ul className="pm-compare-cards" aria-label="Plans compared">
        {plans.items.map((p) => (
          <li key={p.id} className={cn('pm-compare-card', p.highlight && 'is-highlight')}>
            {head(p)}
            <dl>
              {rows.map((r) => {
                const cell = r.cell(p);
                return (
                  <div key={r.label} className={cn(!cell.yes && 'is-no')}>
                    <dt>{r.label}</dt>
                    <dd>
                      {mark(cell.yes)}
                      <span>
                        {cell.text}
                        {cell.sub && <span className="pm-cell-sub">{cell.sub}</span>}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
        {plans.taxNote && <li className="pm-compare-note">{plans.taxNote}</li>}
      </ul>
    </>
  );
}
