import { Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, Check, Cpu, CreditCard, ExternalLink, FlaskConical, Gauge, Gift, Info, Minus, Receipt, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBilling, useBillingEvents, useCheckout, usePaymentMethod, usePortal, useRefreshBilling, useSeatActions, useSetLimit } from '@/api/billing';
import { useSite } from '@/api/public';
import type { BillingScope, BillingSummary, PlanInterval, SitePlan } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Badge, Button, Card, ErrorState, Field, Input, Meter, PageSkeleton, Segmented, Stat } from '@/components/ui';
import { COMPUTE_TIER_LABEL, formatMinor } from '@/lib/billing';
import { ENTITLEMENT_ROWS, formatAmount, perMonth, priceFor, yearlySaving } from '@/lib/plans';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import { accountBillingRoute, adminBillingRoute, type BillingSearch } from '@/router';

/*
 * Billing pages (docs/billing.md). `/account/billing`: the signed-in person's
 * plan, payment method, compute used this month and its estimated cost, the
 * spend cap, the free trial and the individual plans. `/admin/billing` (org
 * admins): the organisation's plan, seats and who holds them, the org's
 * compute by member, its cap and the Stripe events. Checkout (plans, or setup
 * mode for a card) and the portal hand the browser to Stripe (test mode).
 */

export function AccountBilling() {
  const search = accountBillingRoute.useSearch();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Account</div>
          <h1>Plan and billing</h1>
          <p className="muted">Your plan, your payment method and the compute your labs use. Organisation plans and seats are managed by your administrator.</p>
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
    if (!search.checkout && !search.setup) return;
    if (search.checkout) toast(search.checkout === 'success' ? { title: 'Checkout complete', description: 'Your plan updates as soon as Stripe confirms the subscription.', tone: 'ok' } : { title: 'Checkout cancelled', tone: 'neutral' });
    if (search.setup) toast(search.setup === 'success' ? { title: 'Payment method saved', description: 'Labs unlock as soon as Stripe confirms it. You pay only for the compute you use.', tone: 'ok' } : { title: 'No payment method added', tone: 'neutral' });
    refresh();
    const t = window.setTimeout(refresh, 4000);
    void navigate({ to: scope === 'org' ? '/admin/billing' : '/account/billing', search: {}, replace: true });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.checkout, search.setup]);

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
      {b.dunning.state !== 'ok' && <DunningCallout b={b} scope={scope} />}
      <div className="split split-7-5" style={{ alignItems: 'start' }}>
        <CurrentPlan b={b} scope={scope} />
        <SubscriptionCard b={b} scope={scope} />
      </div>

      <div className="split split-7-5" style={{ alignItems: 'start' }}>
        <ComputeCard b={b} scope={scope} />
        <div className="stack" style={{ gap: 20 }}>
          {scope === 'user' && b.trial && b.trial.labs.length > 0 && <TrialCard b={b} />}
          {scope === 'org' && b.seats && <SeatsCard b={b} />}
          {b.compute && <RatesCard b={b} />}
        </div>
      </div>

      <UsageTable b={b} scope={scope} />

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
      <PremiumLevel b={b} scope={scope} />
      <p className="xs subtle row" style={{ gap: 6 }}>
        <Info size={11} aria-hidden /> {b.enforced ? 'Lab starts are checked against the premium level, the free trial, the payment method and the spend cap. The numbers above are shown, not enforced.' : 'Billing checks are off on this deployment: nothing is refused.'}
      </p>
    </Card>
  );
}

function PremiumLevel({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const site = useSite();
  const unlocked = (site.data?.plans?.items ?? []).filter((p) => p.kind === 'individual' && (p.level ?? 1) > 0 && (p.level ?? 1) <= b.level).map((p) => p.name);
  return (
    <div className="billing-level small row" style={{ gap: 8 }}>
      <Badge tone={b.level > 0 ? 'accent' : 'outline'}>Premium labs</Badge>
      <span className="muted">{unlocked.length ? `${unlocked.join(' and ')} labs included` : 'Standard labs only'}</span>
      {scope === 'user' && b.seat && <span className="xs subtle">· through your organisation's {b.seat.planName} seat</span>}
    </div>
  );
}

function DunningCallout({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const portal = usePortal(scope);
  const { toast } = useShell();
  const blocked = b.dunning.state === 'blocked';
  const viaOrg = scope === 'user' && b.payer === 'org';
  return (
    <div className={cn('billing-block', blocked && 'billing-block-err')} role="alert">
      <span className="billing-block-icon" aria-hidden>
        <AlertTriangle size={20} />
      </span>
      <div className="stack grow" style={{ gap: 4 }}>
        <strong>{viaOrg ? "Your organisation's last payment failed" : 'Your last payment failed'}</strong>
        <span className="small muted">
          {blocked
            ? `The ${b.dunning.graceDays}-day grace period has ended: new paid labs cannot be started until the payment goes through. Running labs are not affected.`
            : `Labs keep working until ${b.dunning.graceEndsAt ? formatDate(b.dunning.graceEndsAt) : 'the grace period ends'}. Update the payment method to avoid an interruption.`}
        </span>
      </div>
      {viaOrg ? (
        <span className="xs subtle">Ask an organisation admin.</span>
      ) : (
        b.portalAvailable && (
          <Button
            variant="primary"
            icon={<ExternalLink size={13} />}
            loading={portal.isPending}
            onClick={() => portal.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast({ title: 'Could not open the billing portal', description: e.message, tone: 'err' }) })}
          >
            Update payment details
          </Button>
        )
      )}
    </div>
  );
}

function ComputeCard({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const u = b.usage;
  const l = b.limit;
  const setLimit = useSetLimit(scope);
  const { toast } = useShell();
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(l.monthlyCap / 100));
  const [hardStop, setHardStop] = useState(l.hardStop);
  const viaOrg = scope === 'user' && b.payer === 'org';
  const save = () => {
    const minor = Math.round(Number(cap) * 100);
    if (!Number.isFinite(minor) || minor < 0) return toast({ title: 'Enter an amount of 0 or more', tone: 'warn' });
    setLimit.mutate({ monthlyCap: minor, hardStop }, { onSuccess: () => (setEditing(false), toast({ title: 'Spend cap saved', tone: 'ok' })), onError: (e) => toast({ title: 'Could not save the cap', description: e.message, tone: 'err' }) });
  };
  return (
    <Card className="stack" style={{ gap: 14 }} aria-labelledby="compute-head">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="xs subtle">
            Compute this month · {formatDate(u.periodStart)} to {formatDate(new Date(Date.parse(u.periodEnd) - 1).toISOString())}
          </span>
          <h2 id="compute-head" className="row" style={{ gap: 8 }}>
            <Cpu size={15} aria-hidden /> <span className="tnum">{formatMinor(u.estimate, b.currency)}</span>
            <span className="xs subtle" style={{ fontWeight: 400 }}>
              estimated to date
            </span>
          </h2>
        </div>
        {b.compute?.placeholder && <Badge tone="warn">Placeholder rates</Badge>}
      </div>
      {viaOrg && <p className="small muted">Your labs run on your organisation's {b.seat?.planName ?? ''} seat: their compute is billed to the organisation. The total above is what you pay yourself.</p>}
      <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
        <Stat label="Minutes" value={u.minutes} />
        <Stat label="Compute units" value={u.units} />
        <Stat label="Running now" value={u.running} />
      </div>
      {u.byTier.length > 0 && (
        <ul className="billing-tiers small" aria-label="By compute tier">
          {u.byTier.map((t) => (
            <li key={t.tier}>
              <span className="grow">{COMPUTE_TIER_LABEL[t.tier]}</span>
              <span className="tnum muted">{t.minutes} min</span>
              <span className="tnum">{formatMinor(t.amount, b.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {!viaOrg && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-between small">
            <span className="row" style={{ gap: 6 }}>
              <Gauge size={13} aria-hidden /> Monthly spend cap
            </span>
            <span className="tnum">
              {l.monthlyCap > 0 ? `${formatMinor(l.spent, b.currency)} of ${formatAmount(l.monthlyCap, b.currency)}` : 'No cap'}
              {l.monthlyCap > 0 && <span className="xs subtle"> · {l.hardStop ? 'hard stop' : 'warning only'}</span>}
            </span>
          </div>
          {l.monthlyCap > 0 && <Meter value={Math.min(1, l.spent / l.monthlyCap)} tone={l.reached ? 'err' : l.warn ? 'warn' : 'accent'} label="Spend against the cap" thin />}
          {l.reached && <p className="xs text-warn">{l.hardStop ? 'Cap reached: new paid labs are refused until next month or a higher cap. Running labs continue.' : 'Cap reached (warning only): labs still start.'}</p>}
          {editing ? (
            <div className="row billing-cap-form" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={`Cap per month (${b.currency})`} hint="0 means no cap">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" value={cap} onChange={(e) => setCap(e.target.value)} style={{ maxWidth: 140 }} />}
              </Field>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={hardStop} onChange={(e) => setHardStop(e.target.checked)} /> Stop new paid labs at the cap
              </label>
              <Button size="sm" loading={setLimit.isPending} onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => (setCap(String(l.monthlyCap / 100)), setHardStop(l.hardStop), setEditing(true))} style={{ alignSelf: 'flex-start' }}>
              Change the cap
            </Button>
          )}
        </div>
      )}
      <p className="xs subtle">An estimate from metered lab minutes; Stripe's invoice is authoritative. A session counts in the month it ends.</p>
    </Card>
  );
}

function TrialCard({ b }: { b: BillingSummary }) {
  const t = b.trial!;
  const lab = t.labs[0]!;
  return (
    <Card className="stack" style={{ gap: 10 }}>
      <h2 className="row" style={{ gap: 8 }}>
        <Gift size={15} aria-hidden /> Free trial
      </h2>
      <p className="small muted">
        {t.labs.length === 1 ? 'One guided lab is' : `${t.labs.length} labs are`} free of charge, no card needed: up to {t.maxSessions} sessions or {t.maxMinutes} minutes.
      </p>
      <div className="row" style={{ gap: 20 }}>
        <Stat label="Sessions" value={`${t.usedSessions} / ${t.maxSessions}`} />
        <Stat label="Minutes" value={`${t.usedMinutes} / ${t.maxMinutes}`} />
      </div>
      {t.exhausted ? (
        <p className="small text-warn">{b.paymentMethod ? 'The trial is used up; the trial lab is now billed like any other.' : 'The trial is used up. Add a payment method to keep going.'}</p>
      ) : (
        <Link to="/labs/$labId" params={{ labId: lab.id }} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
          Open {lab.title} <ArrowRight size={13} aria-hidden />
        </Link>
      )}
    </Card>
  );
}

function RatesCard({ b }: { b: BillingSummary }) {
  const c = b.compute!;
  return (
    <Card className="stack" style={{ gap: 10 }}>
      <h2 className="row" style={{ gap: 8 }}>
        <Cpu size={15} aria-hidden /> Compute rates
      </h2>
      <ul className="billing-tiers small" aria-label="Compute rates per tier">
        {c.tiers.map((t) => (
          <li key={t.tier}>
            <span className="grow">{t.label}</span>
            <span className="tnum muted">{t.unitsPerMinute} unit{t.unitsPerMinute === 1 ? '' : 's'}/min</span>
            <span className="tnum">{formatMinor(t.pricePerHour, b.currency)}/h</span>
          </li>
        ))}
      </ul>
      <p className="xs subtle">Billed per started minute{c.minimumMinutes > 1 ? `, at least ${c.minimumMinutes} minutes a session` : ''}, on top of any plan.</p>
    </Card>
  );
}

function SeatsCard({ b }: { b: BillingSummary }) {
  const seats = b.seats!;
  const actions = useSeatActions();
  const { toast } = useShell();
  const [count, setCount] = useState(String(Math.max(seats.purchased, seats.minSeats)));
  const [pick, setPick] = useState('');
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, tone: 'err' });
  const free = seats.purchased - seats.assigned.length;
  return (
    <Card className="stack" style={{ gap: 12 }} aria-labelledby="seats-head">
      <div className="row-between">
        <h2 id="seats-head" className="row" style={{ gap: 8 }}>
          <Users size={15} aria-hidden /> Seats
        </h2>
        <span className="small tnum">
          {seats.assigned.length} of {seats.purchased} assigned
        </span>
      </div>
      <p className="xs subtle">Seated members get the organisation plan's premium labs, and their compute is billed to the organisation.</p>
      {seats.purchased === 0 ? (
        <p className="small muted">No seats yet: subscribe to an organisation plan below.</p>
      ) : (
        <>
          <ul className="billing-seats small" aria-label="Seat holders">
            {seats.assigned.map((m) => (
              <li key={m.userId}>
                <span className="grow truncate">
                  {m.name} <span className="xs subtle">{m.email}</span>
                </span>
                <Button size="sm" variant="ghost" icon={<UserMinus size={13} />} loading={actions.unassign.isPending && actions.unassign.variables === m.userId} onClick={() => actions.unassign.mutate(m.userId, { onError: fail('Could not unassign the seat') })}>
                  Unassign
                </Button>
              </li>
            ))}
          </ul>
          {seats.unassigned.length > 0 && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select className="input" aria-label="Member to seat" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 260 }} disabled={free <= 0}>
                <option value="">{free > 0 ? `Assign a seat (${free} free)…` : 'All seats are assigned'}</option>
                {seats.unassigned.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Button size="sm" icon={<UserPlus size={13} />} disabled={!pick || free <= 0} loading={actions.assign.isPending} onClick={() => actions.assign.mutate(pick, { onSuccess: () => setPick(''), onError: fail('Could not assign the seat') })}>
                Assign
              </Button>
            </div>
          )}
          {seats.canChange && (
            <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Seats on the subscription" hint={`${seats.maxSeats >= 100000 ? `${seats.minSeats} or more` : `${seats.minSeats} to ${seats.maxSeats}`}; Stripe prorates the change`}>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={seats.minSeats} max={seats.maxSeats} value={count} onChange={(e) => setCount(e.target.value)} style={{ maxWidth: 110 }} />}
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={Number(count) === seats.purchased}
                loading={actions.count.isPending}
                onClick={() => actions.count.mutate(Number(count), { onSuccess: (r) => toast({ title: `Seats changed to ${r.purchased}`, description: 'Stripe prorates the difference on the next invoice.', tone: 'ok' }), onError: fail('Could not change the seats') })}
              >
                Change seats
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function UsageTable({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const u = b.usage;
  return (
    <section aria-labelledby="usage-head">
      <div className="section-header">
        <div>
          <h2 id="usage-head">{scope === 'org' ? 'Compute by session' : 'Your lab sessions'}</h2>
          <p className="muted small">This month's metered sessions, newest first, and whether each was reported to Stripe.</p>
        </div>
      </div>
      {scope === 'org' && u.byMember && u.byMember.length > 0 && (
        <Card className="card-flush" style={{ marginBottom: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th className="num">Minutes</th>
                <th className="num">Units</th>
                <th className="num">Estimate</th>
              </tr>
            </thead>
            <tbody>
              {u.byMember.map((m) => (
                <tr key={m.userId}>
                  <td>{m.name}</td>
                  <td className="num tnum">{m.minutes}</td>
                  <td className="num tnum">{m.units}</td>
                  <td className="num tnum">{formatMinor(m.amount, b.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card className="card-flush">
        {u.sessions.length === 0 ? (
          <p className="small muted" style={{ padding: 16 }}>
            No lab sessions this month.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Lab</th>
                  {scope === 'org' && <th>Member</th>}
                  <th>Tier</th>
                  <th>Started</th>
                  <th className="num">Minutes</th>
                  <th className="num">Cost</th>
                  <th>Billing</th>
                </tr>
              </thead>
              <tbody>
                {u.sessions.map((r) => (
                  <tr key={r.id}>
                    <td className="truncate" style={{ maxWidth: 280 }}>
                      <Link to="/labs/$labId" params={{ labId: r.labId }} className="link-quiet">
                        {r.labTitle}
                      </Link>
                    </td>
                    {scope === 'org' && <td className="small">{r.userName ?? r.userId}</td>}
                    <td className="small">{COMPUTE_TIER_LABEL[r.tier]}</td>
                    <td className="small tnum">{relativeTime(r.startedAt)}</td>
                    <td className="num tnum">{r.minutes}</td>
                    <td className="num tnum">{r.trial ? 'free' : formatMinor(r.amount, b.currency)}</td>
                    <td>
                      <ReportBadge r={r} viaOrg={scope === 'user' && r.payer === 'org'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

function ReportBadge({ r, viaOrg }: { r: BillingSummary['usage']['sessions'][number]; viaOrg: boolean }) {
  if (r.trial) return <Badge tone="ok">Free trial</Badge>;
  if (r.report === 'running') return <Badge tone="accent">Running</Badge>;
  if (viaOrg) return <Badge tone="outline">Organisation</Badge>;
  if (r.report === 'sent') return <Badge tone="ok">Reported</Badge>;
  if (r.report === 'pending') return <Badge tone="neutral">Queued</Badge>;
  if (r.report === 'failed') return <Badge tone="err">Report failed</Badge>;
  return <Badge tone="outline">Not billed</Badge>;
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
        <Receipt size={15} aria-hidden /> Payment and subscription
      </h2>
      <PaymentMethodRow b={b} scope={scope} />
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
        <p className="small muted">{b.enabled ? 'No plan subscription: compute only, billed per minute.' : 'Billing is off on this deployment.'}</p>
      )}
      {b.portalAvailable && (
        <Button variant="secondary" size="sm" icon={<ExternalLink size={13} />} loading={portal.isPending} onClick={open}>
          Manage billing in Stripe
        </Button>
      )}
      <p className="xs subtle">Invoices (plans and compute), payment methods and cancellation live in Stripe's customer portal. Card details never reach this platform.</p>
    </Card>
  );
}

function PaymentMethodRow({ b, scope }: { b: BillingSummary; scope: BillingScope }) {
  const add = usePaymentMethod(scope);
  const { toast } = useShell();
  if (!b.enabled) return null;
  if (b.paymentMethod)
    return (
      <p className="small row" style={{ gap: 6 }}>
        <CreditCard size={13} className="text-ok" aria-hidden /> Payment method on file
      </p>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small muted">{scope === 'org' ? 'No payment method yet: add one, or subscribe to a plan, to run labs on the organisation.' : 'No payment method yet. The free trial needs none; any other lab is billed per compute minute.'}</p>
      {b.checkoutEnabled && (
        <Button
          variant="primary"
          size="sm"
          icon={<CreditCard size={13} />}
          loading={add.isPending}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => add.mutate(undefined, { onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast({ title: 'Could not open Stripe', description: e.message, tone: 'err' }) })}
        >
          Add a payment method
        </Button>
      )}
    </div>
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
