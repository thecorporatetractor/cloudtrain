import { Outlet, useRouterState } from '@tanstack/react-router';
import { useMe } from '@/api/client';
import { RequireAccess, canAccess } from '@/app/access';
import { Badge, TabNav } from '@/components/ui';

const TABS: { to: string; label: string; exact?: boolean }[] = [
  { to: '/admin', label: 'Overview', exact: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/teams', label: 'Teams' },
  { to: '/admin/sso', label: 'Single sign-on' },
  { to: '/admin/content', label: 'Content' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/usage', label: 'Usage & quotas' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/billing', label: 'Plan & billing' },
];

export function AdminLayout() {
  return (
    <RequireAccess path="/admin">
      <Layout />
    </RequireAccess>
  );
}

function Layout() {
  const me = useMe().data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = TABS.filter((t) => canAccess(me, t.to));
  const orgName = me?.activeOrg?.name ?? me?.org ?? '';
  return (
    <div className="page page-wide area">
      <header className="area-header">
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="row" style={{ gap: 10 }}>
            {orgName}
            {me?.supportAccess && <Badge tone="warn">support access · until {new Date(me.supportAccess.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Badge>}
          </h1>
        </div>
        <TabNav label="Administration" current={pathname} items={tabs.map((t) => ({ to: t.to as '/admin', label: t.label, exact: t.exact, search: t.to === '/admin' ? undefined : {} }))} />
      </header>
      <Outlet />
    </div>
  );
}
