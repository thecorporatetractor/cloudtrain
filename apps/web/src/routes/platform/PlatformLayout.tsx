import { Outlet, useRouterState } from '@tanstack/react-router';
import { useMe } from '@/api/client';
import { RequireAccess, canAccess } from '@/app/access';
import { Badge, TabNav } from '@/components/ui';

const TABS: { to: string; label: string; exact?: boolean }[] = [
  { to: '/platform', label: 'Organisations', exact: true },
  { to: '/platform/capacity', label: 'Capacity' },
  { to: '/platform/content', label: 'Global content' },
];

export function PlatformLayout() {
  return (
    <RequireAccess path="/platform">
      <Layout />
    </RequireAccess>
  );
}

function Layout() {
  const me = useMe().data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="page page-wide area">
      <header className="area-header">
        <div>
          <div className="page-eyebrow">Platform</div>
          <h1 className="row" style={{ gap: 10 }}>
            CloudTrain operations <Badge tone="accent">platform scope</Badge>
          </h1>
        </div>
        <TabNav label="Platform" current={pathname} items={TABS.filter((t) => canAccess(me, t.to)).map((t) => ({ to: t.to as '/platform', label: t.label, exact: t.exact, search: t.to === '/platform' ? {} : undefined }))} />
      </header>
      <Outlet />
    </div>
  );
}
