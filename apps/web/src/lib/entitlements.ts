import type { Feature, Me } from '@/api/types';

/*
 * Premium features in the UI (docs/licensing-keys.md). The gateway decides and
 * enforces (402 `feature_required`); the UI only locks and explains. A gateway
 * that predates entitlements sends none: everything stays unlocked.
 */

export const FEATURE_NAMES: Record<Feature, string> = {
  sso: 'Single sign-on',
  scim: 'SCIM provisioning',
  audit_export: 'Audit log export',
  advanced_analytics: 'Advanced analytics',
  exam_certificates: 'Exam certificates',
  custom_branding: 'Custom branding',
  multi_org: 'Multiple organisations',
};

export function hasFeature(me: Me | undefined, f: Feature): boolean {
  if (!me?.entitlements) return true;
  return me.entitlements.features.includes(f);
}

/** Where to unlock `f` and what to say, for the person looking. */
export function unlockHint(me: Me | undefined, f: Feature): { text: string; to?: string; cta?: string } {
  const e = me?.entitlements;
  const name = FEATURE_NAMES[f];
  if (!e) return { text: `${name} is not available.` };
  if (e.edition === 'hosted') {
    const plans = e.upgrade?.[f] ?? [];
    const which = plans.length ? ` It is included in ${plans.map((p) => p.name).join(', ')}.` : '';
    const admin = me.permissions.includes('billing.manage');
    return admin ? { text: `${name} is not part of your organisation's plan.${which}`, to: '/admin/billing', cta: 'See plans' } : { text: `${name} is not part of your organisation's plan.${which} Ask an organisation admin.` };
  }
  const expired = e.license?.state === 'expired' || e.license?.state === 'not_yet_valid';
  const text = expired ? `${name} needs a current CloudTrain license; the installed one has expired.` : `${name} is a premium feature of self-hosted CloudTrain: it needs a license key.`;
  return me.platformAdmin ? { text, to: '/platform/license', cta: expired ? 'Renew the license' : 'Install a license' } : { text: `${text} Ask your platform administrator.` };
}
