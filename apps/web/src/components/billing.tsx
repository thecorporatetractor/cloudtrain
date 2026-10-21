import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, CreditCard, Gauge, Lock, Sparkles } from 'lucide-react';
import { useBilling } from '@/api/billing';
import type { BillingBlockDetails, BillingBlockReason, LabAccess, LabSummary } from '@/api/types';
import { Badge } from '@/components/ui';
import { BLOCK_TITLE, COMPUTE_TIER_LABEL, accessChip, blockAction, formatMinor } from '@/lib/billing';
import { formatDate, relativeTime } from '@/lib/utils';

/*
 * Billing pieces outside the billing pages: why a lab cannot start (and the one
 * action that fixes it), the catalog chip for early-access, trial and locked labs,
 * and the app-wide payment banner while a payment is overdue.
 */

const ICON: Record<BillingBlockReason, typeof Lock> = {
  plan_required: Sparkles,
  trial_exhausted: CreditCard,
  payment_method_required: CreditCard,
  payment_overdue: AlertTriangle,
  spend_cap_reached: Gauge,
};

/** A refused lab start (402 payment_required) or a locked lab: title, the gateway's message, the fix. */
export function BillingBlocked({ block, compact, title }: { block: Pick<BillingBlockDetails, 'reason' | 'action' | 'href' | 'requiredPlan'> & { message: string }; compact?: boolean; title?: string }) {
  const Icon = ICON[block.reason];
  const to = block.href === '/admin/billing' ? '/admin/billing' : '/account/billing';
  return (
    <div className={compact ? 'billing-block billing-block-compact' : 'billing-block'} role={compact ? 'note' : 'alert'}>
      <span className="billing-block-icon" aria-hidden>
        <Icon size={compact ? 15 : 20} />
      </span>
      <div className="stack grow" style={{ gap: 4, minWidth: 0 }}>
        <strong className={compact ? 'small' : undefined}>{title ?? (block.reason === 'plan_required' && block.requiredPlan ? `Early access: ${block.requiredPlan.name} or higher` : BLOCK_TITLE[block.reason])}</strong>
        <span className="small muted">{block.message}</span>
      </div>
      <Link to={to} search={block.action === 'upgrade' && block.requiredPlan ? { plan: block.requiredPlan.id } : {}} className={compact ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-md'}>
        {blockAction(block)} <ArrowRight size={13} aria-hidden />
      </Link>
    </div>
  );
}

/** The catalog chip for a lab: early access (its plan), the free trial, or locked. */
export function LabAccessChip({ access }: { access?: LabAccess }) {
  const chip = accessChip(access);
  if (!chip) return null;
  return (
    <Badge tone={chip.tone} title={chip.title} className="lab-access-chip">
      {access?.locked ? <Lock size={10} aria-hidden /> : chip.tone === 'accent' || chip.tone === 'outline' ? <Sparkles size={10} aria-hidden /> : null} {chip.label}
    </Badge>
  );
}

/** "Pod · €0.30/h" for the lab page. */
export function ComputeRate({ access, currency }: { access: LabAccess; currency: string }) {
  return (
    <span className="xs subtle tnum" title="Compute is billed per started minute of a lab session">
      {COMPUTE_TIER_LABEL[access.computeTier]} · {access.free ? 'free' : `${formatMinor(access.pricePerHour, currency)} per hour`}
    </span>
  );
}

/** App-wide banner while the payer's payment is overdue (grace period or blocked). */
export function BillingBanner() {
  const q = useBilling('user');
  const b = q.data;
  if (!b?.enabled || b.dunning.state === 'ok') return null;
  const org = b.payer === 'org';
  const blocked = b.dunning.state === 'blocked';
  return (
    <div className={blocked ? 'billing-banner billing-banner-err' : 'billing-banner'} role="status">
      <AlertTriangle size={14} aria-hidden />
      <span className="grow small">
        {org ? "Your organisation's last payment failed." : 'Your last payment failed.'}{' '}
        {blocked
          ? 'New paid labs cannot be started until it is settled; running labs are not affected.'
          : `Labs keep working until ${b.dunning.graceEndsAt ? `${formatDate(b.dunning.graceEndsAt)} (${relativeTime(b.dunning.graceEndsAt)})` : 'the grace period ends'}.`}
      </span>
      {org ? (
        <span className="xs subtle">Ask an organisation admin.</span>
      ) : (
        <Link to="/account/billing" className="btn btn-secondary btn-sm">
          Update payment details
        </Link>
      )}
    </div>
  );
}

/** Above the catalog list: what keeps labs locked and the one step that unlocks them (upgrade prompt). */
export function CatalogBillingPrompt({ labs }: { labs: LabSummary[] }) {
  const locked = labs.filter((l) => l.access?.locked);
  if (locked.length === 0) return null;
  const needsCard = locked.filter((l) => l.access!.locked!.action === 'add_payment_method').length;
  const early = locked.filter((l) => l.access!.locked!.reason === 'plan_required');
  const trial = labs.find((l) => l.access?.trial && l.access.free);
  const first = (needsCard ? locked.find((l) => l.access!.locked!.action === 'add_payment_method') : early[0] ?? locked[0])!;
  const plan = early.map((l) => l.access!.requiredPlan!).sort((a, b) => a.level - b.level)[0];
  const message = needsCard
    ? `${trial ? `"${trial.title}" is free to try. ` : ''}Add a payment method to unlock ${needsCard} more lab${needsCard === 1 ? '' : 's'}: you pay only for the compute each session uses.`
    : early.length
      ? `${early.length} early-access lab${early.length === 1 ? ' is' : 's are'} included from ${plan ? plan.name : 'a paid plan'}: new content before it goes public. Compute is billed on top of any plan.`
      : first.access!.locked!.message;
  return (
    <div style={{ marginBottom: 16 }}>
      <BillingBlocked compact title={needsCard ? 'Unlock the catalog' : early.length ? 'Early access' : undefined} block={{ reason: first.access!.locked!.reason, action: first.access!.locked!.action, href: first.access!.locked!.href, message, ...(plan && !needsCard ? { requiredPlan: plan } : {}) }} />
    </div>
  );
}
