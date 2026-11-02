import * as Popover from '@radix-ui/react-popover';
import { ArrowRight, Check, Info, Minus } from 'lucide-react';
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { ComputeTierId, SiteConfig, SitePlan, SitePricingModel } from '@/api/types';
import { formatAmount, perMonth, priceFor } from '@/lib/plans';
import { COMPUTE_TIERS, type ComputeModel, type ComputeRate, DEFAULT_TIER_LABEL, earlyAccessFor, formatMinutes, formatMoney, hardLabsFor, includedCompute, labTypesFor, levelForType, planFeatures, planForLevel, planLevel, rateLabels, readCompute, readFreeTrial, readPacks, sessionCost } from '@/lib/pricingModel';
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
    <ul className="pm-tiers" aria-label="Lab types and their compute rates" data-reveal="children">
      {rows.map((t) => {
        const share = t.rate && max > 0 ? t.rate.perMinute / max : WEIGHT[t.id] / 3;
        const labels = t.rate && compute ? rateLabels(t.rate, compute.currency) : undefined;
        return (
          <li key={t.id} className={cn('pm-tier', `pm-tier-${t.id}`)} aria-labelledby={`pm-tier-${t.id}`}>
            <div className="pm-tier-head">
              <h3 id={`pm-tier-${t.id}`}>{t.name}</h3>
              {labels ? (
                <span className="pm-tier-amount tnum">
                  {labels.hour}
                  <span className="pm-tier-unit">/h</span>
                </span>
              ) : (
                <span className="pm-tier-per">{model?.pendingNote ?? PENDING}</span>
              )}
            </div>
            <div className="pm-tier-bar" aria-hidden>
              <span style={{ width: `${Math.max(12, Math.round(share * 100))}%` }} />
            </div>
            {(t.body || labels || t.examples?.length) && (
              <p className="pm-tier-body">
                {t.body}
                {(labels || t.examples?.length) && (
                  <Hint label={`More about ${t.name}`}>
                    {labels && `${labels.minute} a minute, billed per started minute. `}
                    {t.examples && t.examples.length > 0 && `For example: ${t.examples.join(', ')}.`}
                  </Hint>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- packs */

/** The prepaid compute packs (`plans.compute.packs`): one line under the rate cards. */
export function ComputePacks({ site }: { site: SiteConfig }) {
  const { compute, packs } = usePricing(site);
  if (!compute || !packs) return null;
  const c = compute.currency;
  const bonus = packs.items.filter((pk) => pk.bonusPercent > 0);
  return (
    <p className="pm-packs" data-reveal>
      <b>{packs.maxBonus > 0 ? `Prepay: up to ${packs.maxBonus}% bonus credit` : 'Prepay for compute'}</b>
      <span className="pm-packs-list" aria-label="Packs">
        {(bonus.length ? bonus : packs.items).map((pk, i) => (
          <span key={pk.price} className="tnum">
            {i > 0 && <i aria-hidden>·</i>}
            {formatMoney(pk.price, c)} → {formatMoney(pk.credit, c)}
          </span>
        ))}
      </span>
      <Hint label="About prepaid packs">
        {packs.note ?? `Compute credit bought up front, valid ${packs.validMonths} months and spent at the compute rates, on every paid plan; the larger packs add bonus credit.`}
        {packs.proposal ? ' The amounts are proposed; they may change before paid plans open.' : ''}
      </Hint>
    </p>
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

/**
 * The pack to buy for a monthly spend: the largest one with a bonus whose credit the spend
 * uses up within the validity, and how many months it covers (never more than the validity).
 * None when no bonus pack would be used up in time.
 */
function packFor(packs: ReturnType<typeof readPacks>, monthlyCost: number): { pack: NonNullable<ReturnType<typeof readPacks>>['items'][number]; months: number } | undefined {
  if (!packs || !(monthlyCost > 0)) return undefined;
  const fits = packs.items.filter((p) => p.bonusPercent > 0 && p.credit <= monthlyCost * packs.validMonths);
  const pack = fits[fits.length - 1];
  return pack ? { pack, months: Math.min(packs.validMonths, Math.max(1, Math.round(pack.credit / monthlyCost))) } : undefined;
}

/**
 * A slider with its filled track (site.css .pm-range; the motion engine moves the fill with its
 * sweep) and a number field for typing a value in.
 */
function Range({ id, min, max, step, value, unit, onChange }: { id: string; min: number; max: number; step: number; value: number; unit: string; onChange: (v: number) => void }) {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : value);
  return (
    <div className="pm-range-row">
      <input id={id} className="pm-range" type="range" min={min} max={max} step={step} value={value} data-count-range style={{ '--pct': `${((value - min) / (max - min)) * 100}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="pm-range-num tnum" type="number" min={min} max={max} step={step} value={value} aria-label={`${unit}, as a number`} onChange={(e) => onChange(clamp(Number(e.target.value)))} />
    </div>
  );
}

/**
 * The estimator: the lab type, two inputs, one result, and one all-in line with the plan. The
 * secondary figures (a session, the rate, the time in labs, the pack that pays off) are in a
 * "Details" disclosure. On its own it keeps its state; given `value` and `onChange` it is driven
 * from outside (ComputeSplit, where the worked examples set it).
 */
export function Estimator({ site, value, onChange }: { site: SiteConfig; value?: EstimateInput; onChange?: (v: EstimateInput) => void }) {
  const { compute, model, packs } = usePricing(site);
  const est = model?.estimator;
  const uid = useId();
  const [plan, setPlan] = useState<string | undefined>(undefined);
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
        <p className="pm-formula" aria-label="Your monthly bill is the minutes your labs run, times the rate of their lab type, plus a subscription if you choose one.">
          <span className="pm-term">
            <strong>Minutes</strong> your labs run
          </span>
          <span className="pm-op" aria-hidden>
            ×
          </span>
          <span className="pm-term">
            <strong>Rate</strong> of the lab type
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
  const c = compute.currency;
  const one = sessionCost(rate, minutes, compute);
  const month = sessionCost(rate, minutes, compute, sessions);
  const pack = packFor(packs, month);
  const paid = (site.plans?.items ?? []).filter((p) => p.kind !== 'free' && priceFor(p, 'monthly'));
  const planCost = (p: SitePlan) => perMonth(priceFor(p, 'monthly')!.amount, priceFor(p, 'monthly')!.interval);
  const picked = paid.find((p) => p.id === plan) ?? paid[0];
  // The lab type may need a higher plan (plans.premium rules by lab type): the figure uses the lowest plan that runs it.
  const needLevel = levelForType(site.plans)(tier);
  const needs = picked && planLevel(picked) < needLevel ? (planForLevel(paid.filter((p) => p.kind === picked.kind), needLevel) ?? planForLevel(paid, needLevel)) : undefined;
  const chosen = needs ?? picked;
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
            <Range id={`${uid}-min`} min={5} max={240} step={5} value={minutes} unit="Minutes per session" onChange={(v) => set({ minutes: v })} />
          </div>
          <div className="pm-field">
            <label htmlFor={`${uid}-ses`}>
              Sessions per month <output className="tnum">{sessions}</output>
            </label>
            <Range id={`${uid}-ses`} min={1} max={40} step={1} value={sessions} unit="Sessions per month" onChange={(v) => set({ sessions: v })} />
          </div>
        </div>
      </div>
      <div className="pm-estimator-result" aria-live="polite">
        <div className="pm-estimator-figure">
          <span className="pm-estimator-label">About</span>
          <span className="pm-estimator-amount tnum" data-count>
            {formatMoney(month, c)}
          </span>
          <span className="pm-estimator-label">of compute a month</span>
        </div>
        {paid.length > 0 && chosen && (
          // all in: the plan's fee and the compute, per person; an organisation plan per seat
          <div className="pm-estimator-allin">
            <span className="pm-estimator-allin-pick" role="group" aria-label="With a plan">
              {paid.map((p) => (
                <button key={p.id} type="button" className={cn('pm-radio', p.id === chosen.id && 'is-on')} aria-pressed={p.id === chosen.id} onClick={() => setPlan(p.id)}>
                  {p.name}
                </button>
              ))}
            </span>
            <span className="pm-estimator-allin-sum">
              <b className="tnum">{formatMoney(planCost(chosen) + month, c)}</b>
              {chosen.kind === 'organisation' ? ' per seat a month, all in' : ' a month, all in'}
              {needs && picked && <span className="pm-estimator-needs"> ({names[tier] ?? DEFAULT_TIER_LABEL[tier]} need {needs.name})</span>}
            </span>
          </div>
        )}
        <details className="pm-estimator-details">
          <summary>Details</summary>
          <p className="pm-estimator-lines">
            <span>
              <b className="tnum">{formatMoney(one, c)}</b> a session
            </span>
            <span>
              <b className="tnum">{rateLabels(rate, c).hour}</b> an hour
            </span>
            <span>
              <b className="tnum">{formatMinutes(minutes * sessions)}</b> in labs
            </span>
            {chosen && (
              <span>
                <b className="tnum">{formatMoney(planCost(chosen), c)}</b> {chosen.name}{chosen.kind === 'organisation' ? ' per seat' : ''} + <b className="tnum">{formatMoney(month, c)}</b> compute
              </span>
            )}
            {pack && (
              <span>
                a <b className="tnum">{formatMoney(pack.pack.price, c)}</b> pack (+{pack.pack.bonusPercent}% credit) covers {pack.months === 1 ? 'a month' : `${pack.months} months`} at this pace
              </span>
            )}
          </p>
        </details>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- worked examples */

/**
 * The worked examples (`pricing.model.examples`), compact rows: the title, the lab type (and the
 * plan it needs, when one does), the duration, the price. With `onPick` a row is a button that
 * puts the example into the estimator; `picked` marks the one it shows.
 */
export function WorkedExamples({ site, onPick, picked }: { site: SiteConfig; onPick?: (v: EstimateInput) => void; picked?: EstimateInput }) {
  const { compute, model } = usePricing(site);
  const examples = model?.examples ?? [];
  if (examples.length === 0) return null;
  const names = Object.fromEntries(tierRows(compute, model).map((r) => [r.id, r.name]));
  const need = levelForType(site.plans);
  const planFor = (t: ComputeTierId) => (need(t) > 0 ? planForLevel((site.plans?.items ?? []).filter((p) => p.kind === 'individual'), need(t)) : undefined);
  return (
    <ul className="pm-examples" aria-label="Worked examples" data-reveal="children">
      {examples.map((e) => {
        const rate = compute?.rates.find((r) => r.id === e.tier);
        const sessions = e.sessions ?? 1;
        const cost = rate && compute ? sessionCost(rate, e.minutes, compute, sessions) : undefined;
        const input: EstimateInput = { tier: e.tier, minutes: e.minutes, sessions };
        const isOn = !!picked && picked.tier === e.tier && picked.minutes === e.minutes && picked.sessions === sessions;
        const plan = planFor(e.tier);
        // Left: the title, then the chips (lab type, the plan it needs, "in the estimator" when picked).
        // Right: the cost large with its period beside it, the time it stands for under it ("8 × 1 h").
        const body = (
          <>
            <span className="pm-example-main">
              <span className="pm-example-title">{e.title}</span>
              <span className="pm-example-meta">
                <span className={cn('pm-chip', `pm-chip-${e.tier}`)}>{(names[e.tier] ?? DEFAULT_TIER_LABEL[e.tier]).replace(/ labs$/, '')}</span>
                {plan && <span className="pm-chip pm-chip-plan">{plan.name}</span>}
                {isOn && <span className="pm-chip pm-chip-on">In the estimator</span>}
              </span>
            </span>
            <span className="pm-example-cost">
              {cost !== undefined && compute ? (
                <>
                  <span className="pm-example-figure">
                    <b className="pm-example-amount tnum" data-count>
                      {formatMoney(cost, compute.currency)}
                    </b>
                    <span className="pm-example-per">{sessions > 1 ? 'a month' : 'a session'}</span>
                  </span>
                  <span className="pm-example-time">{sessions > 1 ? `${sessions} × ${formatMinutes(e.minutes)}` : formatMinutes(e.minutes)}</span>
                </>
              ) : (
                <span className="pm-example-per">{PENDING}</span>
              )}
            </span>
          </>
        );
        return (
          <li key={e.title} className={cn('pm-example', onPick && 'pm-example-pick', isOn && 'is-on')}>
            {onPick ? (
              <button type="button" className="pm-example-btn" aria-pressed={isOn} title={e.body} onClick={() => onPick(input)}>
                {body}
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
        <WorkedExamples site={site} onPick={setValue} picked={value} />
      </div>
    </div>
  );
}

/**
 * The billing terms under the compute block, two short lines in full view: what ends a
 * forgotten lab (first, the sentence people need), then how the minutes are billed and the
 * launch-price note (`pricing.model.sessionNote` and `estimator.note`, each one line of copy).
 */
export function ComputeTerms({ site }: { site: SiteConfig }) {
  const { compute, model } = usePricing(site);
  if (!compute) return null;
  return (
    <div className="pm-terms">
      {model?.sessionNote && <p className="pm-terms-lead">{model.sessionNote}</p>}
      <p>{model?.estimator?.note ?? 'Billed per started minute while a lab runs; a finished lab costs nothing.'}</p>
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
 * A short explanation behind a small "i": a popover, so it opens on a tap, a click or the
 * keyboard (Enter, Space; Escape closes) as well as on hover, and reads well on a phone.
 */
function Hint({ children, label = 'More about this' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="pm-hint" aria-label={label} onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)} onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}>
          <Info size={12} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={6} collisionPadding={12} className="pm-hint-pop" onOpenAutoFocus={(e) => e.preventDefault()}>
          {children}
          <Popover.Arrow className="pm-hint-arrow" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const listTypes = (types: ComputeTierId[], names: Record<string, string>): string => {
  const n = types.map((t) => (names[t] ?? DEFAULT_TIER_LABEL[t]).replace(/ labs$/, ''));
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

/**
 * Plans side by side, on what sets them apart. A line above the table says what every plan has
 * (every public lab, pay-per-minute compute, the packs, a spend cap), the head of each column its
 * price and what compute adds to it (a worked example from the rates: the estimator's defaults),
 * and the rows are the differences, the deciding ones first: the lab types the `plans.premium`
 * rules open, exam simulations, labs at once, early access, included
 * compute credit (when a plan has `computeCredit`), seats, the default spend cap (per person or, for an organisation
 * plan, for the organisation, as billing applies it), single sign-on, support, enterprise
 * features. Check and dash marks only on yes/no rows. Rows the data cannot answer are left out,
 * and a plan is a row of `plans.items`, so adding or dropping one is a configuration change.
 * On a phone one plan shows at a time, chosen with a switcher.
 */
export function PlanComparison({ site, title }: { site: SiteConfig; title?: string }) {
  const { compute, trial, packs, model } = usePricing(site);
  const plans = site.plans;
  const uid = useId();
  const [shown, setShown] = useState(() => Math.max(0, plans?.items.findIndex((p) => p.highlight) ?? 0));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!plans || plans.items.length === 0) return null;
  type Cell = { kind: 'yes' | 'no' | 'text'; text: string; sub?: string };
  const yes = (text: string, sub?: string): Cell => ({ kind: 'yes', text, ...(sub ? { sub } : {}) });
  const no = (text: string, sub?: string): Cell => ({ kind: 'no', text, ...(sub ? { sub } : {}) });
  const txt = (text: string, sub?: string): Cell => ({ kind: 'text', text, ...(sub ? { sub } : {}) });
  const early = earlyAccessFor(plans);
  const types = labTypesFor(plans);
  const hard = hardLabsFor(plans);
  const soon = isComingSoon(site);
  const c = plans.currency;
  const names = Object.fromEntries(tierRows(compute, model).map((r) => [r.id, r.name]));
  const contact = site.pricing?.contactCta ?? { label: 'Talk to us', to: '/contact' };
  const ctaFor = (p: SitePlan) => (p.kind === 'organisation' || p.cta.action === 'contact' ? contact : { label: p.cta.label, to: '/sign-in' });
  const cap = (p: SitePlan) => (p.kind === 'organisation' ? plans.limits?.org : plans.limits?.user);
  const rates = Object.fromEntries((compute?.rates ?? []).map((r) => [r.id, r]));

  // What compute adds, from the rates: a two-hour lab, and a month of the estimator's defaults.
  const est = model?.estimator;
  const exTier = (est?.defaultTier && rates[est.defaultTier] ? est.defaultTier : (compute?.rates[1]?.id ?? compute?.rates[0]?.id)) as ComputeTierId | undefined;
  const exRate = exTier ? rates[exTier] : undefined;
  const exName = exTier ? (names[exTier] ?? DEFAULT_TIER_LABEL[exTier]).replace(/ labs$/, '') : '';
  const twoHours = exRate && compute ? sessionCost(exRate, 120, compute) : undefined;
  const monthSessions = est?.defaultSessions ?? 12;
  const monthMinutes = est?.defaultMinutes ?? 45;
  const month = exRate && compute ? sessionCost(exRate, monthMinutes, compute, monthSessions) : undefined;
  const computeLine = (p: SitePlan): string => {
    if (p.kind === 'free') return trial?.labs ? `${trial.labs === 1 ? 'one trial lab' : `${trial.labs} trial labs`} free${trial.maxMinutes ? ` (${formatMinutes(trial.maxMinutes)})` : ''}, then compute per minute` : 'then compute per minute';
    return month !== undefined && compute ? `+ about ${formatMoney(month, c)} of compute${p.kind === 'organisation' ? ' per person' : ''} for ${monthSessions} ${exName} labs` : '+ compute per minute';
  };

  const rows: { label: string; hint?: ReactNode; cell: (p: SitePlan) => Cell }[] = [
    // The labs a plan opens: every standard lab runs on every plan (the summary line says so); the
    // hard ones need a plan, by lab type, as the `plans.premium` rules say and the gateway applies them.
    ...(hard
      ? [
          {
            label: 'Hard labs',
            hint: 'Labs marked hard. On the hosted service they need a plan, by lab type: Pod (containers), VM (one machine) or Multi-VM (clusters and topologies). Every standard lab runs on every plan; self-hosted, every lab is yours.',
            cell: (p: SitePlan): Cell => {
              const t = hard(p);
              if (t.length === 0) return no('Not included', p.kind === 'free' ? (trial?.labs ? 'standard labs: the trial lab free, then per minute' : 'standard labs per minute') : undefined);
              return txt(t.length === COMPUTE_TIERS.length ? `Every type, Multi-VM included` : listTypes(t, names));
            },
          },
        ]
      : [
          {
            label: 'Labs',
            hint: 'Which lab types the plan runs on the hosted service: Pod (containers), VM (one machine) or Multi-VM (clusters and topologies). Self-hosted, every lab is yours.',
            cell: (p: SitePlan): Cell => {
              const t = types(p);
              const all = t.length === COMPUTE_TIERS.length;
              return txt(all ? 'Every lab' : t.length === 0 ? 'None' : `${listTypes(t, names)} labs`, p.kind === 'free' ? (trial?.labs ? 'the trial lab free, then per minute' : 'per minute') : undefined);
            },
          },
        ]),
    {
      label: 'Exam simulations',
      hint: 'A timed simulation with tasks drawn from a public exam blueprint, graded per objective against a pass mark. The number is what the plan includes each month.',
      cell: (p) => {
        const n = p.entitlements?.examSimulationsPerMonth;
        if (n === undefined) return p.kind === 'free' ? no('Not included') : yes('Included');
        return n === 0 ? no('Not included') : yes(n === 'unlimited' ? 'Unlimited' : `${n} a month, unused ones roll over`);
      },
    },
    ...(plans.items.some((p) => p.entitlements?.concurrentLabs) ? [{ label: 'Labs at once', hint: 'How many lab environments the plan is meant for at the same time.', cell: (p: SitePlan): Cell => txt(String(p.entitlements?.concurrentLabs ?? 1)) }] : []),
    ...(early ? [{ label: 'Early-access labs', cell: (p: SitePlan): Cell => (early(p) ? yes('Included') : no('Not included')) }] : []),
    ...(plans.items.some((p) => includedCompute(p) > 0)
      ? [{ label: 'Included compute', hint: 'Compute credit the plan includes every month, spent at the compute rates before anything is billed.', cell: (p: SitePlan): Cell => (includedCompute(p) > 0 ? yes(`${formatMoney(includedCompute(p), c)} a month`) : no('None')) }]
      : []),
    {
      label: 'Seats',
      cell: (p) => (p.kind === 'organisation' ? txt(p.minSeats ? `Per seat, from ${p.minSeats}` : 'Per seat', 'admins assign them') : txt('One person')),
    },
    ...(plans.limits
      ? [
          {
            label: 'Default spend cap',
            hint: 'A monthly limit on compute spend, set on the billing page and changed any time: at the cap, new labs wait until it is raised; running labs continue.',
            cell: (p: SitePlan): Cell => (cap(p)?.monthlyCap ? txt(`${formatMoney(cap(p)!.monthlyCap, c)} a month`, p.kind === 'organisation' ? 'for the organisation' : 'per person') : txt('None by default')),
          },
        ]
      : []),
    ...(plans.items.some((p) => includesLine(p, /single sign-on|\bsso\b/i)) ? [{ label: 'Single sign-on', cell: (p: SitePlan): Cell => (includesLine(p, /single sign-on|\bsso\b/i) ? yes('With your identity provider') : no('Not included')) }] : []),
    ...(plans.items.some((p) => includesLine(p, /support/i)) ? [{ label: 'Support', cell: (p: SitePlan): Cell => txt(includesLine(p, /support/i) ?? 'Community support') }] : []),
    ...(plans.items.some((p) => planFeatures(p)?.length)
      ? [
          {
            label: 'Enterprise features',
            cell: (p: SitePlan): Cell => {
              const f = planFeatures(p) ?? [];
              return f.length ? yes(f.slice(0, 3).join(', '), f.length > 3 ? `and ${f.length - 3} more` : undefined) : no('Not included');
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
        <span className="pm-plan-name">{p.name}</span>
        <span className="pm-plan-price">
          <b className="tnum">{pr.text}</b>
          <span>{pr.sub ?? (p.kind === 'free' ? 'no card needed' : '')}</span>
        </span>
        <span className="pm-plan-compute">{computeLine(p)}</span>
        {p.audience && <span className="pm-plan-audience">{p.audience}</span>}
        {!soon && (
          <SiteAnchor to={cta.to} className={cn('btn btn-md pm-plan-cta', p.highlight ? 'btn-primary' : 'btn-secondary')}>
            {cta.label} <ArrowRight size={13} aria-hidden />
          </SiteAnchor>
        )}
      </div>
    );
  };
  const cell = (r: (typeof rows)[number], p: SitePlan) => {
    const v = r.cell(p);
    return (
      <span className={cn('pm-cell', v.kind === 'no' && 'is-no')}>
        {v.kind !== 'text' && (
          <span className={cn('pm-mark', v.kind === 'yes' ? 'is-yes' : 'is-no')} aria-hidden>
            {v.kind === 'yes' ? <Check size={12} /> : <Minus size={12} />}
          </span>
        )}
        <span>
          {v.text}
          {v.sub && <span className="pm-cell-sub">{v.sub}</span>}
        </span>
      </span>
    );
  };
  const label = (r: (typeof rows)[number]) => (
    <>
      {r.label}
      {r.hint && <Hint label={`About ${r.label.toLowerCase()}`}>{r.hint}</Hint>}
    </>
  );
  const onTabKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (shown + d + plans.items.length) % plans.items.length;
    setShown(next);
    tabs.current[next]?.focus();
  };
  const highlight = (p: SitePlan) => !soon && p.highlight;
  const active = plans.items[Math.min(shown, plans.items.length - 1)]!;
  const rateList = compute ? compute.rates.map((r) => `${(names[r.id] ?? DEFAULT_TIER_LABEL[r.id]).replace(/ labs$/, '')} ${rateLabels(r, c).hour}/h`).join(' · ') : undefined;
  const cta = soon ? (
    <SiteAnchor to="#waitlist" className="btn btn-primary btn-md pm-compare-cta">
      Join the waitlist <ArrowRight size={14} aria-hidden />
    </SiteAnchor>
  ) : null;
  return (
    <>
      {(title || cta) && (
        // The heading and, before launch, the one call to action for every plan, on one row.
        <div className="pm-compare-head">
          {title && <h3 className="pm-subhead">{title}</h3>}
          {cta}
        </div>
      )}
      <p className="pm-compare-every">
        <b>Every plan:</b> every standard lab, pay-per-minute compute
        {rateList && <Hint label="The compute rates">{rateList}, billed per started minute while a lab runs.</Hint>}
        {packs && (
          <>
            , prepaid packs{packs.maxBonus > 0 ? ` with up to ${packs.maxBonus}% bonus credit` : ''}
            <Hint label="About prepaid packs">
              Compute credit bought up front, valid {packs.validMonths} months and spent at the compute rates; the larger packs add bonus credit.{packs.proposal ? ' Proposed amounts.' : ''}
            </Hint>
          </>
        )}
        {plans.limits && ', a spend cap you set'}.{twoHours !== undefined && ` A 2-hour ${exName} lab adds about ${formatMoney(twoHours, c)} to any plan.`}
      </p>
      <div className="pm-compare-wrap">
        <table className="pm-compare">
          <caption className="sr-only">Plans compared</caption>
          <thead>
            <tr>
              <th scope="col" className="pm-compare-corner">
                <span className="sr-only">Feature</span>
              </th>
              {plans.items.map((p) => (
                <th key={p.id} scope="col" className={cn('pm-plan-col', highlight(p) && 'is-highlight')}>
                  {head(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{label(r)}</th>
                {plans.items.map((p) => (
                  <td key={p.id} className={cn(highlight(p) && 'is-highlight')}>
                    {cell(r, p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {plans.taxNote && <p className="pm-compare-note">{plans.taxNote}</p>}
      </div>
      {/* Phones: one plan at a time, chosen with the switcher (site.css shows this or the table). */}
      <div className="pm-compare-cards">
        <div className="pm-plan-switch" role="tablist" aria-label="Plan" onKeyDown={onTabKey}>
          {plans.items.map((p, i) => (
            <button
              key={p.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${p.id}`}
              aria-selected={i === shown}
              aria-controls={`${uid}-panel`}
              tabIndex={i === shown ? 0 : -1}
              className={cn('pm-plan-tab', i === shown && 'is-on')}
              onClick={() => setShown(i)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="pm-compare-card" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${active.id}`}>
          {head(active)}
          <dl>
            {rows.map((r) => (
              <div key={r.label}>
                <dt>{label(r)}</dt>
                <dd>{cell(r, active)}</dd>
              </div>
            ))}
          </dl>
        </div>
        {plans.taxNote && <p className="pm-compare-note">{plans.taxNote}</p>}
      </div>
      {soon && (
        <p className="pm-compare-one">One waitlist for every plan; no card needed.</p>
      )}
    </>
  );
}
