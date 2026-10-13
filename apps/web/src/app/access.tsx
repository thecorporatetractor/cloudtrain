import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMe } from '@/api/client';
import type { Learner } from '@/api/types';
import { EmptyState, PageSkeleton } from '@/components/ui';

export type Role = Learner['role'];

/** Screens that are not for every role. Nav, palette, hotkeys and the routes themselves all use this one map. */
export const ROUTE_ROLES: Record<string, Role[]> = {
  '/team': ['manager', 'admin'],
  '/studio': ['admin'],
};

export function canAccess(role: Role | undefined, path: string): boolean {
  const entry = Object.entries(ROUTE_ROLES).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (!entry) return true;
  return !!role && entry[1].includes(role);
}

/** Renders children only for the allowed roles; otherwise a "no access" state in place of the screen. */
export function RequireRole({ path, children }: { path: string; children: ReactNode }) {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (!canAccess(me.data?.role, path)) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Lock size={20} />}
          title="You do not have access to this screen"
          description={`It is available to ${(ROUTE_ROLES[path] ?? []).join(' and ')} roles. Ask your team manager if you think you should see it.`}
          action={
            <Link to="/" className="btn btn-secondary btn-md">
              Back to home
            </Link>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}
