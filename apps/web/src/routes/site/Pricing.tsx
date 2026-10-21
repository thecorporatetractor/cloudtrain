import { Link } from '@tanstack/react-router';
import { ArrowRight, Check, Cpu, Gift, LayoutDashboard, LogIn, Minus, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/api/client';
import { useSite } from '@/api/public';
import type { PlanInterval, SiteConfig, SitePlan } from '@/api/types';
import { Badge, Card, PageSkeleton, Segmented } from '@/components/ui';
import { formatMinor, siteComputeRates } from '@/lib/billing';
import { ENTITLEMENT_ROWS, entitlementSummary, formatAmount, perMonth, priceFor, yearlySaving } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { SiteAnchor, useDocumentTitle } from '@/site/util';
import { Cta } from './Landing';

/**
 * Pricing: the configured plans (free, individual monthly/yearly, organisation
 * per seat) as cards with an interval switch, the pay-for-compute rates and the
 * free trial, a comparison of entitlements and premium labs, the placeholder
 * note while prices are not final, the plan FAQ and the alignment notice. Calls
 * to action lead to sign-in, checkout (when enabled) or contact.
 */
export function Pricing() {
  const site = useSite();
  const [interval, setInterval] = useState<PlanInterval>('monthly');
  useDocumentTitle('Pricing');
  if (site.isPending) {
    return (
      <div className="site-container site-page">
        <PageSkeleton />
      </div>
    );
  }
  const s = site.data;
  const p = s?.pricing;
  const plans = s?.plans;
  const anyYearly = plans?.items.some((pl) => pl.prices?.yearly) ?? false;
  const placeholder = !!(plans?.placeholder || plans?.items.some((pl) => pl.placeholderPrices));
  const faq = p?.faqGroup ? (s?.faq ?? []).filter((f) => f.group === p.faqGroup) : [];

  return (
    <div className="site-container site-page">
      <header className="site-page-head site-page-head-stack" style={{ alignItems: 'center', textAlign: 'center', margin: '0 auto 28px' }}>
        <div className="page-eyebrow">Pricing</div>
        <h1 className="site-h1">{p?.headline ?? 'Plans'}</h1>
        {p?.intro && <p className="muted site-lead-sm">{p.intro}</p>}
        {anyYearly && (
          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <Segmented<PlanInterval> label="Billing interval" value={interval} onChange={setInterval} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
            {interval === 'yearly' && savingBadge(plans)}
          </div>
        )}
      </header>

      {s && !s.flags.showPricing && (
        <Card className="site-pricing-soon" style={{ marginBottom: 28 }}>
          <div className="stack" style={{ gap: 8 }}>
            <Badge tone="warn">Not published yet</Badge>
            <h2>Plans are being finalised</h2>
            <p className="muted small" style={{ maxWidth: 520 }}>
              The plans below are a preview. Talk to us about a pilot.
            </p>
          </div>
          {p?.contactCta && <Cta cta={p.contactCta} size="md" />}
        </Card>
      )}

      {plans && plans.items.length > 0 ? (
        <>
          {placeholder && p?.placeholderNote && (
            <p className="site-callout small" role="note" style={{ justifyContent: 'center' }}>
              <Badge tone="warn">Placeholder prices</Badge> {p.placeholderNote}
            </p>
          )}
          <div className={cn('site-plans', plans.items.length === 2 && 'site-plans-2', plans.items.length >= 4 && 'site-plans-4')}>
            {plans.items.map((pl) => (
              <PlanCard key={pl.id} plan={pl} currency={plans.currency} interval={interval} site={s!} />
            ))}
          </div>
          <p className="xs subtle" style={{ textAlign: 'center', marginTop: 14 }}>
            {[plans.taxNote, plans.billingNote].filter(Boolean).join(' ')}
            {anyYearly && interval === 'yearly' ? ' Yearly prices are shown per month and billed once a year.' : ''}
          </p>

          <ComputeSection site={s!} />

          <section className="page-section" aria-labelledby="compare">
            <div className="section-header">
              <div>
                <h2 id="compare">Compare plans</h2>
                <p className="muted small">Premium labs, lab hours, concurrent labs, environment tiers, exam simulations and events per plan. Compute is billed on top of every plan.</p>
              </div>
            </div>
            <Card className="card-flush site-compare-wrap">
              <table className="table site-compare">
                <thead>
                  <tr>
                    <th scope="col">Entitlement</th>
                    {plans.items.map((pl) => (
                      <th key={pl.id} scope="col">
                        {pl.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(plans.premium?.length ?? 0) > 0 && (
                    <tr>
                      <th scope="row">Premium labs</th>
                      {plans.items.map((pl) => (
                        <td key={pl.id} className={cn(premiumUnlocked(plans, pl).length === 0 && 'subtle')}>
                          <span className="row" style={{ gap: 6 }}>
                            {premiumUnlocked(plans, pl).length ? <Check size={13} className="text-ok" aria-hidden /> : <Minus size={13} aria-hidden />}
                            {premiumUnlocked(plans, pl).length ? premiumUnlocked(plans, pl).join(' and ') : pl.kind === 'free' && plans.free?.trialLabs.length ? 'Trial lab only, free' : 'Standard labs'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  )}
                  {ENTITLEMENT_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      {plans.items.map((pl) => (
                        <td key={pl.id} className={cn(!row.has(pl.entitlements) && 'subtle')}>
                          <span className="row" style={{ gap: 6 }}>
                            {row.has(pl.entitlements) ? <Check size={13} className="text-ok" aria-hidden /> : <Minus size={13} aria-hidden />}
                            {row.value(pl.entitlements)}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Who it is for</th>
                    {plans.items.map((pl) => (
                      <td key={pl.id}>{pl.kind === 'organisation' ? `Organisations${pl.perSeat ? ', per seat' : ''}${pl.minSeats ? ` (from ${pl.minSeats})` : ''}` : pl.kind === 'individual' ? 'One person' : 'Anyone'}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </Card>
          </section>
        </>
      ) : (
        <Card className="site-pricing-soon">
          <div className="stack" style={{ gap: 8 }}>
            <h2>No plans configured</h2>
            <p className="muted small">Add `plans` to the site configuration, or talk to us.</p>
          </div>
          {p?.contactCta && <Cta cta={p.contactCta} size="md" />}
        </Card>
      )}

      {faq.length > 0 && (
        <section className="page-section site-page-narrow" aria-labelledby="plan-faq" style={{ marginLeft: 'auto', marginRight: 'auto' }}>
          <div className="section-header">
            <h2 id="plan-faq">Questions about plans</h2>
            <Link to="/faq" className="link-quiet small">
              All questions <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          <div className="site-faq">
            {faq.map((f) => (
              <details key={f.q} className="site-faq-item">
                <summary>{f.q}</summary>
                <p className="small muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {s?.legal.alignmentNotice && (
        <p className="site-notice xs subtle" style={{ marginTop: 32 }}>
          <ShieldCheck size={12} aria-hidden /> {s.legal.alignmentNotice}
        </p>
      )}
    </div>
  );
}

function savingBadge(plans: SiteConfig['plans']) {
  const best = Math.max(0, ...(plans?.items.map((pl) => yearlySaving(pl) ?? 0) ?? []));
  return best > 0 ? <Badge tone="ok">Save up to {best}%</Badge> : null;
}

export function PlanPrice({ plan, currency, interval }: { plan: SitePlan; currency: string; interval: PlanInterval }) {
  if (plan.kind === 'free' || !plan.prices) {
    return (
      <div className="site-plan-price">
        <span className="site-plan-amount">Free</span>
      </div>
    );
  }
  const price = priceFor(plan, interval);
  if (!price) return null;
  const shown = perMonth(price.amount, price.interval);
  return (
    <div className="site-plan-price">
      <span className="site-plan-amount tnum">{formatAmount(shown, currency)}</span>
      <span className="site-plan-per xs subtle">
        {plan.perSeat ? 'per seat ' : ''}per month{price.interval === 'yearly' ? ', billed yearly' : ''}
        {plan.perSeat && plan.minSeats ? ` · from ${plan.minSeats} seats` : ''}
      </span>
    </div>
  );
}

function PlanCard({ plan, currency, interval, site }: { plan: SitePlan; currency: string; interval: PlanInterval; site: SiteConfig }) {
  return (
    <Card className={cn('site-plan', plan.highlight && 'site-plan-highlight')} aria-label={`${plan.name} plan`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="site-plan-name">{plan.name}</h2>
          <span className="xs subtle row" style={{ gap: 5 }}>
            {plan.kind === 'organisation' ? <Users size={11} aria-hidden /> : null}
            {plan.kind === 'organisation' ? 'Organisation' : plan.kind === 'individual' ? 'Individual' : 'Free'}
          </span>
        </div>
        {plan.badge && <Badge tone={plan.highlight ? 'accent' : 'warn'}>{plan.badge}</Badge>}
      </div>
      <PlanPrice plan={plan} currency={currency} interval={interval} />
      <p className="small muted">{plan.description}</p>
      <PlanCta plan={plan} interval={interval} site={site} />
      <ul className="site-plan-list">
        {entitlementSummary(plan.entitlements).map((line) => (
          <li key={line}>
            <Check size={13} aria-hidden /> {line}
          </li>
        ))}
      </ul>
      {plan.includes.length > 0 && (
        <ul className="site-plan-list site-plan-list-muted">
          {plan.includes.map((line) => (
            <li key={line}>
              <Check size={13} aria-hidden /> {line}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A plan's call to action for the current visitor. */
export function PlanCta({ plan, interval, site, size = 'md' }: { plan: SitePlan; interval: PlanInterval; site: SiteConfig; size?: 'md' | 'lg' }) {
  const me = useMe();
  const cls = cn('btn', plan.highlight ? 'btn-primary' : 'btn-secondary', `btn-${size}`, 'site-plan-cta');
  const action = plan.cta.action === 'checkout' && !site.flags.checkoutEnabled ? 'contact' : plan.cta.action;
  if (action === 'checkout') {
    const target = plan.kind === 'organisation' ? `/admin/billing?plan=${plan.id}&interval=${interval}` : `/account/billing?plan=${plan.id}&interval=${interval}`;
    if (me.isSuccess) {
      return (
        <SiteAnchor to={target} className={cls}>
          {plan.cta.label} <ArrowRight size={13} aria-hidden />
        </SiteAnchor>
      );
    }
    return (
      <Link to="/sign-in" search={{ returnTo: target }} className={cls}>
        <LogIn size={13} aria-hidden /> {plan.cta.label}
      </Link>
    );
  }
  if (action === 'signin') {
    if (me.isSuccess) {
      return (
        <Link to="/" className={cls}>
          <LayoutDashboard size={13} aria-hidden /> Go to dashboard
        </Link>
      );
    }
    return (
      <Link to="/sign-in" className={cls}>
        <LogIn size={13} aria-hidden /> {plan.cta.label}
      </Link>
    );
  }
  return (
    <SiteAnchor to={plan.cta.to ?? site.pricing?.contactCta?.to ?? '/contact'} className={cls}>
      {plan.cta.action === 'checkout' ? (site.pricing?.contactCta?.label ?? 'Talk to us') : plan.cta.label} <ArrowRight size={13} aria-hidden />
    </SiteAnchor>
  );
}

/** Names of the premium tiers a plan unlocks (rule plans whose level is at most this plan's). */
function premiumUnlocked(plans: NonNullable<SiteConfig['plans']>, plan: SitePlan): string[] {
  const level = plan.level ?? (plan.kind === 'free' ? 0 : 1);
  const names = new Set<string>();
  for (const rule of plans.premium ?? []) {
    const rp = plans.items.find((p) => p.id === rule.plan);
    const rl = rp ? (rp.level ?? (rp.kind === 'free' ? 0 : 1)) : Infinity;
    if (rp && rl <= level) names.add(`${rp.name} labs`);
  }
  return [...names];
}

/** Pay for compute: the rate per environment tier and the free trial. */
function ComputeSection({ site }: { site: SiteConfig }) {
  const plans = site.plans!;
  const rates = siteComputeRates(site);
  if (rates.length === 0) return null;
  const trial = plans.free;
  const EXAMPLE: Record<string, string> = { pod: 'Shell, files, Git, scripting, Kubernetes API work', vm: 'systemd, storage, SELinux, boot and recovery', heavy: 'kubeadm clusters, multi-node estates, network topologies' };
  return (
    <section className="page-section" aria-labelledby="compute">
      <div className="section-header">
        <div>
          <h2 id="compute" className="row" style={{ gap: 8 }}>
            <Cpu size={18} aria-hidden /> Pay for the compute you use
          </h2>
          <p className="muted small">Every lab session is metered from start to stop, per started minute, and billed monthly on top of any plan. A monthly spend cap stops new paid labs when you reach it; a running lab is never cut off.</p>
        </div>
        {plans.compute?.placeholder && <Badge tone="warn">Placeholder rates</Badge>}
      </div>
      <div className="split split-8-4" style={{ alignItems: 'start' }}>
        <Card className="card-flush site-compare-wrap">
          <table className="table site-compare">
            <thead>
              <tr>
                <th scope="col">Environment</th>
                <th scope="col">Typical labs</th>
                <th scope="col">Per hour</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.tier}>
                  <th scope="row">{r.label}</th>
                  <td className="small muted">{EXAMPLE[r.tier]}</td>
                  <td className="tnum">{formatMinor(r.pricePerHour, plans.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {trial && trial.trialLabs.length > 0 && (
          <Card className="stack" style={{ gap: 8 }}>
            <h3 className="row" style={{ gap: 8 }}>
              <Gift size={15} aria-hidden /> Try it free
            </h3>
            <p className="small muted">
              A free account runs {trial.trialLabs.length === 1 ? 'one guided lab' : `${trial.trialLabs.length} guided labs`} at no charge, no card needed (up to {trial.maxSessions ?? 3} sessions or {trial.maxMinutes ?? 60} minutes). Add a payment method to run any standard lab.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
