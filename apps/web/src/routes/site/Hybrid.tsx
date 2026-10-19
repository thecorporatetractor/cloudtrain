import { lazy, Suspense } from 'react';
import { useMe } from '@/api/client';
import { PageSkeleton } from '@/components/ui';
import { Catalog } from '@/routes/Catalog';
import { Home } from '@/routes/Home';

/*
 * `/` and `/catalog` are two pages in one: the website for visitors, the app for
 * signed-in users. The AuthGate has already resolved `/api/me` when these render
 * (a skeleton meanwhile), so the choice is immediate and never flips.
 */

const Landing = lazy(() => import('./Landing').then((m) => ({ default: m.Landing })));
const PublicCatalog = lazy(() => import('./PublicCatalog').then((m) => ({ default: m.PublicCatalog })));

/** Viewport-tall, so the footer stays below the fold and nothing shifts when the page arrives. */
function fallback() {
  return (
    <div className="site-container site-page site-pending">
      <PageSkeleton />
    </div>
  );
}

export function RootIndex() {
  const me = useMe();
  if (me.isSuccess) return <Home />;
  return (
    <Suspense fallback={fallback()}>
      <Landing />
    </Suspense>
  );
}

export function CatalogIndex() {
  const me = useMe();
  if (me.isSuccess) return <Catalog />;
  return (
    <Suspense fallback={fallback()}>
      <PublicCatalog />
    </Suspense>
  );
}
