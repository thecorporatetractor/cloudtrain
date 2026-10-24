import { Link, useRouterState } from '@tanstack/react-router';
import { AlertTriangle, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMe } from '@/api/client';
import type { Feature } from '@/api/types';
import { hasFeature, unlockHint } from '@/lib/entitlements';

/**
 * App-wide banner for admins while the self-hosted license needs attention:
 * expiring within 30 days, in its grace period, expired, invalid, or over its seats.
 * The gateway only sends `entitlements.license` to platform and org admins.
 */
export function LicenseBanner() {
  const me = useMe().data;
  const onLicensePage = useRouterState({ select: (s) => s.location.pathname.startsWith('/platform/license') });
  const n = me?.entitlements?.license;
  if (!n || onLicensePage) return null;
  const bad = n.state === 'expired' || n.state === 'invalid';
  return (
    <div className={bad ? 'billing-banner billing-banner-err' : 'billing-banner'} role="status">
      <AlertTriangle size={14} aria-hidden />
      <span className="grow small">{n.message}</span>
      {me?.platformAdmin ? (
        <Link to="/platform/license" className="btn btn-secondary btn-sm">
          Manage the license
        </Link>
      ) : (
        <span className="xs subtle">Ask your platform administrator.</span>
      )}
    </div>
  );
}

/** A locked premium feature in place of (or above) the UI it gates: what it is and who can unlock it. */
export function FeatureLock({ feature, children, compact }: { feature: Feature; children?: ReactNode; compact?: boolean }) {
  const me = useMe().data;
  if (hasFeature(me, feature)) return null;
  const hint = unlockHint(me, feature);
  return (
    <div className={compact ? 'feature-lock feature-lock-compact' : 'feature-lock'} role="note">
      <Lock size={14} aria-hidden className="subtle" />
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="small">{hint.text}</span>
        {children ? <span className="xs subtle">{children}</span> : null}
      </div>
      {hint.to ? (
        <Link to={hint.to} className="btn btn-secondary btn-sm">
          {hint.cta}
        </Link>
      ) : null}
    </div>
  );
}
