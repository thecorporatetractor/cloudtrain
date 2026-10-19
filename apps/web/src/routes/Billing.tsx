import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, CreditCard, ExternalLink, FlaskConical, Info, Minus, Receipt, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBilling, useBillingEvents, useCheckout, usePortal, useRefreshBilling } from '@/api/billing';
import { useSite } from '@/api/public';
import type { BillingScope, BillingSummary, PlanInterval, SitePlan } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Badge, Button, Card, ErrorState, Field, Input, PageSkeleton, Segmented, Stat } from '@/components/ui';
import { ENTITLEMENT_ROWS, formatAmount, perMonth, priceFor, yearlySaving } from '@/lib/plans';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import { accountBillingRoute, adminBillingRoute, type BillingSearch } from '@/router';

/*
 * Billing pages. `/account/billing`: the signed-in person's plan, entitlements,
 * subscription and the individual plans they can buy. `/admin/billing` (org
 * admins): the organisation's plan with seats. Entitlements are shown, not
 * enforced yet. Checkout and the portal hand the browser to Stripe (test mode).
 */

export function AccountBilling() {
  const search = accountBillingRoute.useSearch();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Account</div>
          <h1>Plan and billing</h1>
          <p className="muted">Your plan, what it allows, and your subscription. Organisation plans are managed by your administrator.</p>
        </div>
      </header>
      <BillingScreen scope="user" search={search} />
    </div>
  );
}

export function AdminBilling() {
  const search = adminBillingRoute.useSearch();
  return (
    <RequireAccess path="/admin/billing">
      <BillingScreen scope="org" search={search} />
    </RequireAccess>
  );
}

function BillingScreen({ scope, search }: { scope: BillingScope; search: BillingSearch }) {
  const q = useBilling(scope);
  const site = useSite();
  const { toast } = useShell();
  const navigate = useNavigate();
  const refresh = useRefreshBilling();
  const [interval, setInterval] = useState<PlanInterval>(search.interval ?? 'monthly');

  // Back from Stripe: say so once, refresh (the webhook may land a moment later), and clean the URL.
  useEffect(() => {
    if (!search.checkout) return;
    toast(search.checkout === 'success' ? { title: 'Checkout complete', description: 'Your plan updates as soon as Stripe confirms the subscription.', tone: 'ok' } : { title: 'Checkout cancelled', tone: 'neutral' });
    refresh();
    const t = window.setTimeout(refresh, 4000);
    void navigate({ to: scope === 'org' ? '/admin/billing' : '/account/billing', search: {}, replace: true });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.checkout]);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const anyYearly = b.plans.some((p) => p.prices?.yearly);

  return (
    <div className="stack" style={{ gap: 20 }}>
      {b.enabled ? (
        <p className="billing-note xs subtle row" style={{ gap: 6 }}>
          <FlaskConical size={12} aria-hidden /> Stripe test mode: no real charges. Use Stripe's test cards at checkout.
        </p>
      ) : (
        <p className="billing-note xs subtle row" style={{ gap: 6 }}>
          <Info size={12} aria-hidden /> Billing is not enabled on this deployment; plans are informational.
        </p>
      )}
      <div className="split split-7-5" style={{ alignItems: 'start' }}>
        <CurrentPlan b={b} scope={scope} />
        <SubscriptionCard b={b} scope={scope} />
      </div>

      {b.plans.length > 0 && (
        <section aria-labelledby="plans">
          <div className="section-header" style={{ alignItems: 'center' }}>
            <div>
              <h2 id="plans">{scope === 'org' ? 'Organisation plans' : 'Plans for you'}</h2>
              <p className="muted small">{b.placeholder ? site.data?.pricing?.placeholderNote ?? 'Prices are placeholders.' : 'Change plans any time; the portal handles upgrades, downgrades and cancellation.'}</p>
            </div>
            {anyYearly && <Segmented<PlanInterval> label="Billing interval" value={interval} onChange={setInterval} size="sm" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />}
          </div>
          <div className={cn('billing-plans', b.plans.length === 1 && 'billing-plans-1')}>
            {b.plans.map((p) => (
              <PlanOffer key={p.id} plan={p} b={b} scope={scope} interval={interval} preselected={search.plan === p.id} />
            ))}
          </div>
        </section>
      )}

      {scope === 'org' && <OrgEvents enabled={b.enabled} />}

      {site.data?.legal.alignmentNotice && (
        <p className="xs subtle row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <ShieldCheck size={12} aria-hidden style={{ marginTop: 2 }} /> {site.data.legal.alignmentNotice}
        </p>
      )}
    </div>
  );
}

function CurrentPlan({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const plan = b.plan;
  return (
    <Card className="stack" style={{ gap: 14 }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="xs subtle">{scope === 'org' ? "Your organisation's plan" : 'Your plan'}</span>
          <h2 className="row" style={{ gap: 8 }}>
            {plan?.planName ?? 'No plan'}
            {plan && <Badge tone={plan.source === 'subscription' ? 'ok' : 'outline'}>{plan.source === 'subscription' ? 'Subscribed' : plan.source === 'manual' ? 'Set by the platform' : 'Default'}</Badge>}
          </h2>
          {plan?.since && <span className="xs subtle">since {formatDate(plan.since)}</span>}
        </div>
        {plan?.kind === 'organisation' && <Users size={16} className="subtle" aria-hidden />}
      </div>
      {plan ? (
        <ul className="billing-entitlements" aria-label="Entitlements">
          {ENTITLEMENT_ROWS.map((row) => (
            <li key={row.key} className={cn(!row.has(plan.entitlements) && 'subtle')}>
              {row.has(plan.entitlements) ? <Check size={13} className="text-ok" aria-hidden /> : <Minus size={13} aria-hidden />}
              <span className="grow">{row.label}</span>
              <span className="tnum">{row.value(plan.entitlements)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">This site configures no plans.</p>
      )}
      <p className="xs subtle row" style={{ gap: 6 }}>
        <Info size={11} aria-hidden /> Entitlements are recorded and shown; limits are not enforced yet.
      </p>
    </Card>
  );
}

function SubscriptionCard({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const portal = usePortal(scope);
  const { toast } = useShell();
  const s = b.subscription;
  const open = () =>
    portal.mutate(undefined, {
      onSuccess: (r) => window.location.assign(r.url),
      onError: (e) => toast({ title: 'Could not open the billing portal', description: e.message, tone: 'err' }),
    });
  return (
    <Card className="stack" style={{ gap: 12 }}>
      <h2 className="row" style={{ gap: 8 }}>
        <Receipt size={15} aria-hidden /> Subscription
      </h2>
      {s ? (
        <>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <Stat label="Status" value={<Badge tone={s.status === 'active' || s.status === 'trialing' ? 'ok' : s.status === 'past_due' ? 'warn' : 'neutral'}>{s.status.replace('_', ' ')}</Badge>} />
            <Stat label="Interval" value={s.interval} />
            {s.seats > 1 && <Stat label="Seats" value={s.seats} />}
            {s.currentPeriodEnd && <Stat label={s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} value={formatDate(s.currentPeriodEnd)} hint={relativeTime(s.currentPeriodEnd)} />}
          </div>
          {s.cancelAtPeriodEnd && <p className="small text-warn">Cancellation scheduled: the plan stays until the end of the period.</p>}
        </>
      ) : (
        <p className="small muted">{b.enabled ? 'No subscription yet.' : 'Billing is off on this deployment.'}</p>
      )}
      {b.portalAvailable && (
        <Button variant="secondary" size="sm" icon={<ExternalLink size={13} />} loading={portal.isPending} onClick={open}>
          Manage billing in Stripe
        </Button>
      )}
      <p className="xs subtle">Invoices, payment methods and cancellation live in Stripe's customer portal. Card details never reach this platform.</p>
    </Card>
  );
}

function PlanOffer({ plan, b, scope, interval, preselected }: { plan: SitePlan; b: BillingSummary; scope: BillingScope; interval: PlanInterval; preselected: boolean }) {
  const checkout = useCheckout(scope);
  const { toast } = useShell();
  const [seats, setSeats] = useState(plan.minSeats ?? 5);
  const price = priceFor(plan, interval);
  const current = b.plan?.planId === plan.id && b.plan.source === 'subscription';
  const saving = yearlySaving(plan);
  const start = () =>
    checkout.mutate(
      { planId: plan.id, interval: price?.interval ?? interval, ...(plan.perSeat ? { seats } : {}) },
      { onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast({ title: 'Could not start checkout', description: e.message, tone: 'err' }) },
    );
  const total = price ? (plan.perSeat ? price.amount * seats : price.amount) : 0;
  return (
    <Card className={cn('billing-plan stack', (plan.highlight || preselected) && 'billing-plan-highlight')} style={{ gap: 12 }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <h3>{plan.name}</h3>
          <span className="xs subtle">{plan.description}</span>
        </div>
        {current ? <Badge tone="ok">Current</Badge> : plan.badge ? <Badge tone="warn">{plan.badge}</Badge> : null}
      </div>
      {price && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="billing-amount tnum">{formatAmount(perMonth(price.amount, price.interval), b.currency)}</span>
          <span className="xs subtle">
            {plan.perSeat ? 'per seat ' : ''}per month{price.interval === 'yearly' ? ', billed yearly' : ''}
            {price.interval === 'yearly' && saving ? ` · save ${saving}%` : ''}
          </span>
        </div>
      )}
      {plan.perSeat && (
        <Field label="Seats" hint={`${plan.minSeats ?? 1}${plan.maxSeats ? ` to ${plan.maxSeats}` : ' or more'}`}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={plan.minSeats ?? 1} max={plan.maxSeats} value={seats} onChange={(e) => setSeats(Math.max(plan.minSeats ?? 1, Number(e.target.value) || 0))} style={{ maxWidth: 120 }} />}
        </Field>
      )}
      {plan.perSeat && price && (
        <span className="small muted tnum">
          {formatAmount(total, b.currency)} per {price.interval === 'yearly' ? 'year' : 'month'} for {seats} seats
        </span>
      )}
      <ul className="billing-includes small muted">
        {plan.includes.slice(0, 4).map((line) => (
          <li key={line}>
            <Check size={12} aria-hidden /> {line}
          </li>
        ))}
      </ul>
      {b.enabled && b.checkoutEnabled ? (
        <Button variant={plan.highlight || preselected ? 'primary' : 'secondary'} icon={<CreditCard size={13} />} loading={checkout.isPending} disabled={current || !price} onClick={start}>
          {current ? 'Current plan' : `Subscribe to ${plan.name}`}
        </Button>
      ) : (
        <Link to="/contact" className="btn btn-secondary btn-md">
          Talk to us <ArrowRight size={13} aria-hidden />
        </Link>
      )}
    </Card>
  );
}

function OrgEvents({ enabled }: { enabled: boolean }) {
  const events = useBillingEvents(enabled);
  if (!enabled || events.isPending) return null;
  return (
    <section aria-labelledby="billing-events">
      <div className="section-header">
        <div>
          <h2 id="billing-events">Billing events</h2>
          <p className="muted small">Webhook deliveries from Stripe for this organisation, newest first. Every delivery is also in the audit log.</p>
        </div>
      </div>
      <Card className="card-flush">
        {events.isError ? (
          <ErrorState error={events.error} />
        ) : events.data && events.data.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Received</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td className="mono small">{e.type}</td>
                  <td>
                    <Badge tone={e.status === 'processed' ? 'ok' : e.status === 'failed' ? 'err' : 'neutral'}>{e.status}</Badge>
                  </td>
                  <td className="small tnum">{relativeTime(e.receivedAt)}</td>
                  <td className="xs subtle mono truncate" style={{ maxWidth: 360 }}>
                    {Object.entries(e.summary)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small muted" style={{ padding: 16 }}>
            No events yet.
          </p>
        )}
      </Card>
    </section>
  );
}
