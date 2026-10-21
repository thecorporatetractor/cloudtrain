import { ArrowRight, Check, Minus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { ComputeTierId, SiteConfig, SitePlan, SitePricingModel } from '@/api/types';
import { formatAmount, perMonth, priceFor } from '@/lib/plans';
import { COMPUTE_TIERS, DEFAULT_TIER_LABEL, earlyAccessFor, planFeatures, formatMinutes, formatMoney, rateLabels, readCompute, readFreeTrial, sessionCost, type ComputeModel, type ComputeRate } from '@/lib/pricingModel';
import { cn } from '@/lib/utils';
import { FeatureIcon, SiteAnchor } from './util';

/*
 * "How pricing works": the pay-for-compute model explained for visitors, on the
 * pricing page, the coming-soon page and (as a teaser) the landing page. The
 * words come from content/site.yaml `pricing.model`; every amount from
 * `plans` (compute rates, plan prices), read defensively (src/lib/pricingModel.ts).
 * While billing has no rates configured the page says "to be announced" instead
 * of inventing a figure, and placeholder amounts are labelled as such.
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
    <ol className="pm-steps">
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
    <ul className={cn('pm-paths', paths.length === 2 && 'pm-paths-2')} aria-label="Ways to run CloudTrain">
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
          {p.price && <p className="pm-path-price">{p.price}</p>}
          {p.id === 'hosted' && from && compute && (
            <p className="pm-path-rate">
              from <span className="tnum">{rateLabels(from, compute.currency).hour}</span> an hour {compute.placeholder && <PlaceholderTag />}
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
    <ul className="pm-tiers" aria-label="Compute tiers">
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
            {t.body && <p>{t.body}</p>}
            <div className="pm-tier-rate">
              {labels ? (
                <>
                  <span className="pm-tier-amount tnum">{labels.hour}</span>
                  <span className="pm-tier-per">
                    an hour, billed per minute ({labels.minute}/min)
                    {compute?.placeholder && (
                      <>
                        {' '}
                        · <PlaceholderTag />
                      </>
                    )}
                  </span>
                </>
              ) : (
                <span className="pm-tier-per">{model?.pendingNote ?? PENDING}</span>
              )}
            </div>
            <div className="pm-tier-bar" aria-hidden>
              <span style={{ width: `${Math.max(12, Math.round(share * 100))}%` }} />
            </div>
            {t.examples && t.examples.length > 0 && (
              <ul className="pm-tier-examples" aria-label={`${t.name}, for example`}>
                {t.examples.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------- estimator */

export function Estimator({ site }: { site: SiteConfig }) {
  const { compute, model } = usePricing(site);
  const est = model?.estimator;
  const uid = useId();
  const tiers = compute?.rates ?? [];
  const [tier, setTier] = useState<ComputeTierId>(est?.defaultTier && tiers.some((t) => t.id === est.defaultTier) ? est.defaultTier : (tiers[1]?.id ?? tiers[0]?.id ?? 'vm'));
  const [minutes, setMinutes] = useState(est?.defaultMinutes ?? 45);
  const [sessions, setSessions] = useState(est?.defaultSessions ?? 12);
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
  return (
    <div className="pm-estimator">
      <div className="pm-estimator-controls">
        <h3 id={`${uid}-t`}>{est?.title ?? 'Estimate your month'}</h3>
        <fieldset className="pm-field">
          <legend>Lab type</legend>
          <div className="pm-radios">
            {tiers.map((t) => (
              <label key={t.id} className={cn('pm-radio', t.id === tier && 'is-on')}>
                <input type="radio" name={`${uid}-tier`} value={t.id} checked={t.id === tier} onChange={() => setTier(t.id)} />
                {names[t.id] ?? t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="pm-field">
          <label htmlFor={`${uid}-min`}>
            Minutes per session <output className="tnum">{formatMinutes(minutes)}</output>
          </label>
          <input id={`${uid}-min`} type="range" min={5} max={240} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
        <div className="pm-field">
          <label htmlFor={`${uid}-ses`}>
            Sessions per month <output className="tnum">{sessions}</output>
          </label>
          <input id={`${uid}-ses`} type="range" min={1} max={40} step={1} value={sessions} onChange={(e) => setSessions(Number(e.target.value))} />
        </div>
      </div>
      <div className="pm-estimator-result" aria-live="polite">
        <div className="pm-estimator-figure">
          <span className="pm-estimator-label">About</span>
          <span className="pm-estimator-amount tnum">{formatMoney(month, compute.currency)}</span>
          <span className="pm-estimator-label">of compute a month</span>
        </div>
        <dl className="pm-estimator-lines">
          <div>
            <dt>One session</dt>
            <dd className="tnum">{formatMoney(one, compute.currency)}</dd>
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
        <p className="pm-estimator-note">
          {compute.placeholder && (
            <>
              <PlaceholderTag>Placeholder rates</PlaceholderTag>{' '}
            </>
          )}
          {est?.note ?? 'Billed per started minute while a lab runs. A subscription, if you have one, is billed separately.'}
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- worked examples */

export function WorkedExamples({ site }: { site: SiteConfig }) {
  const { compute, model } = usePricing(site);
  const examples = model?.examples ?? [];
  if (examples.length === 0) return null;
  const names = Object.fromEntries(tierRows(compute, model).map((r) => [r.id, r.name]));
  return (
    <ul className="pm-examples" aria-label="Worked examples">
      {examples.map((e) => {
        const rate = compute?.rates.find((r) => r.id === e.tier);
        const sessions = e.sessions ?? 1;
        const cost = rate && compute ? sessionCost(rate, e.minutes, compute, sessions) : undefined;
        return (
          <li key={e.title} className="pm-example">
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
                  <span className="tnum">{formatMoney(cost, compute.currency)}</span>
                  <span className="pm-example-per">{sessions > 1 ? 'a month' : 'for the session'}</span>
                </>
              ) : (
                <span className="pm-example-per">{PENDING}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
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

/**
 * Plans side by side, on the axes of the model: what the subscription costs, how
 * compute is paid, which labs it opens and who it is for. Rows a configuration
 * cannot answer are left out.
 */
export function PlanComparison({ site }: { site: SiteConfig }) {
  const { compute, trial } = usePricing(site);
  const plans = site.plans;
  if (!plans || plans.items.length === 0) return null;
  const placeholder = !!(plans.placeholder || plans.items.some((p) => p.placeholderPrices));
  type Cell = { yes: boolean; text: string; sub?: string; tag?: boolean };
  const early = earlyAccessFor(plans);
  const rows: { label: string; cell: (p: SitePlan) => Cell }[] = [
    {
      label: 'Subscription',
      cell: (p) => {
        const pr = planPrice(p, plans.currency);
        return { yes: true, text: pr.text, ...(pr.sub ? { sub: pr.sub } : {}), tag: !!(p.prices && (p.placeholderPrices || plans.placeholder)) };
      },
    },
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
    {
      label: 'Public labs',
      cell: (p) => (p.kind === 'free' ? { yes: true, text: 'Every public lab', sub: 'the trial lab free, the rest per minute' } : { yes: true, text: 'Every public lab', sub: 'never locked behind a tier' }),
    },
    ...(early ? [{ label: 'Early-access labs', cell: (p: SitePlan): Cell => (early(p) ? { yes: true, text: 'Included' } : { yes: false, text: 'Not included' }) }] : []),
    {
      label: 'Exam simulations',
      cell: (p) => {
        const n = p.entitlements?.examSimulationsPerMonth;
        if (n === undefined)
          return {
            yes: p.kind !== 'free',
            text: p.kind === 'free' ? 'Not included' : 'Included',
          };
        return n === 0
          ? { yes: false, text: 'Not included' }
          : {
              yes: true,
              text: n === 'unlimited' ? 'Unlimited' : `${n} a month`,
            };
      },
    },
    {
      label: 'Seats',
      cell: (p) =>
        p.kind === 'organisation'
          ? {
              yes: true,
              text: 'Bought per seat',
              sub: `admins assign them${p.minSeats ? `, from ${p.minSeats}` : ''}`,
            }
          : { yes: true, text: 'One person' },
    },
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
  return (
    <div className="pm-compare-wrap">
      <table className="pm-compare">
        <caption className="sr-only">Plans compared</caption>
        <thead>
          <tr>
            <td />
            {plans.items.map((p) => (
              <th key={p.id} scope="col" className={cn(p.highlight && 'is-highlight')}>
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {plans.items.map((p) => {
                const c = r.cell(p);
                return (
                  <td key={p.id} className={cn(!c.yes && 'is-no', p.highlight && 'is-highlight')}>
                    <span className="pm-cell">
                      {c.yes ? <Check size={14} aria-hidden className="pm-yes" /> : <Minus size={14} aria-hidden />}
                      <span>
                        {c.text}
                        {c.tag && (
                          <>
                            {' '}
                            <PlaceholderTag />
                          </>
                        )}
                        {c.sub && <span className="pm-cell-sub">{c.sub}</span>}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {placeholder && (
        <p className="pm-compare-note">
          <PlaceholderTag>Pricing to be announced</PlaceholderTag> {site.pricing?.placeholderNote ?? 'Amounts are placeholders, not offers.'} {plans.taxNote}
        </p>
      )}
    </div>
  );
}
