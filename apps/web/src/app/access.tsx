import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMe } from '@/api/client';
import type { Me, Permission } from '@/api/types';
import { EmptyState, PageSkeleton } from '@/components/ui';

/**
 * Screens that are not for everyone. The UI only hides; the gateway enforces.
 * Access is decided from the principal's permission list (`/api/me`), never from
 * role names: `any` lists the permissions of which one is enough, and `when`
 * narrows further on scope (a manager with no team has nothing to look at).
 */
export interface RouteAccess {
  any: Permission[];
  when?: (me: Me) => boolean;
  /** Shown on the 403 page. */
  label: string;
}

export const ROUTE_ACCESS: Record<string, RouteAccess> = {
  '/assignments': { any: ['progress.read.self'], label: 'My assignments' },
  '/history': { any: ['progress.read.self'], label: 'History' },
  '/exams': { any: ['lab.run'], label: 'Exams' },
  '/team': { any: ['progress.read.team'], when: (me) => me.managedTeams.length > 0, label: 'Team dashboard' },
  '/cohorts': { any: ['cohort.manage'], label: 'Cohorts' },
  '/studio': { any: ['studio.author'], label: 'Scenario Studio' },
  '/admin': { any: ['user.manage', 'team.manage', 'sso.manage', 'content.visibility', 'quota.manage', 'audit.read', 'settings.manage'], label: 'Administration' },
  '/admin/users': { any: ['user.manage'], label: 'Users' },
  '/admin/teams': { any: ['team.manage'], label: 'Teams' },
  '/admin/sso': { any: ['sso.manage'], label: 'Single sign-on' },
  '/admin/content': { any: ['content.visibility'], label: 'Content' },
  '/admin/sessions': { any: ['session.control'], label: 'Live sessions' },
  '/admin/usage': { any: ['quota.manage'], label: 'Usage & quotas' },
  '/admin/audit': { any: ['audit.read'], label: 'Audit log' },
  '/admin/settings': { any: ['settings.manage'], label: 'Settings' },
  '/platform': { any: ['org.manage', 'capacity.read'], label: 'Platform' },
  '/platform/capacity': { any: ['capacity.read'], label: 'Capacity' },
};

export const can = (me: Me | undefined, perm: Permission): boolean => !!me?.permissions.includes(perm);

/** The most specific access rule whose prefix covers the path. */
function ruleFor(path: string): RouteAccess | undefined {
  const match = Object.keys(ROUTE_ACCESS)
    .filter((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_ACCESS[match] : undefined;
}

export function canAccess(me: Me | undefined, path: string): boolean {
  const rule = ruleFor(path);
  if (!rule) return true;
  if (!me) return false;
  return rule.any.some((p) => me.permissions.includes(p)) && (rule.when ? rule.when(me) : true);
}

/** Renders children only when the principal may see the screen; otherwise the 403 state in place of it. */
export function RequireAccess({ path, children }: { path: string; children: ReactNode }) {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (!canAccess(me.data, path)) return <Forbidden path={path} />;
  return <>{children}</>;
}

export function Forbidden({ path, permission }: { path?: string; permission?: string }) {
  const rule = path ? ruleFor(path) : undefined;
  const needs = permission ?? rule?.any.join(' or ');
  return (
    <div className="page page-narrow">
      <EmptyState
        icon={<Lock size={20} />}
        title={rule ? `${rule.label} is not available to you` : 'You do not have access to this page'}
        description={needs ? `It needs the ${needs} permission in this organisation. Ask your organisation admin if you think you should have it.` : 'Ask your organisation admin if you think you should have it.'}
        action={
          <Link to="/" className="btn btn-secondary btn-md">
            Back to home
          </Link>
        }
      />
    </div>
  );
}
