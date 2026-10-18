import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { ApiError, UNAUTHENTICATED_EVENT, useMe } from '@/api/client';
import { PageSkeleton } from '@/components/ui';

/** Routes that render without a session and without any chrome (the sign-in card). */
export const PUBLIC_PATHS = ['/sign-in'];
/**
 * The public website: rendered in the site layout (header, footer) with or without a
 * session. Signed-in visitors see "Go to dashboard" instead of "Sign in".
 */
export const SITE_PATHS = ['/catalog/paths', '/catalog/exams', '/pricing', '/about', '/faq', '/contact', '/legal'];
/**
 * Routes that are the website for visitors and the app for signed-in users: `/` is
 * the landing page or the learner's Home, `/catalog` the public or the full catalog.
 */
export const HYBRID_PATHS = ['/', '/catalog'];

const under = (pathname: string, prefixes: string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
export const isPublicPath = (pathname: string) => under(pathname, PUBLIC_PATHS);
export const isSitePath = (pathname: string) => under(pathname, SITE_PATHS);
export const isHybridPath = (pathname: string) => HYBRID_PATHS.includes(pathname);
/** No session needed to render this path (sign-in, website and hybrid pages). */
export const isOpenPath = (pathname: string) => isPublicPath(pathname) || isSitePath(pathname) || isHybridPath(pathname);

/**
 * Sends signed-out visitors of app pages to the sign-in page, remembering where
 * they were. A 401 from any request while signed in means the session expired:
 * same redirect, with `reason=expired` so the page can say so. Website and
 * hybrid pages render for visitors; only an expired session leaves them.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useRouterState({ select: (s) => s.location });
  const wasSignedIn = useRef(false);
  const openPage = isOpenPath(location.pathname);

  useEffect(() => {
    if (me.isSuccess) wasSignedIn.current = true;
  }, [me.isSuccess]);

  useEffect(() => {
    const onExpired = () => {
      const here = window.location.pathname;
      if (isPublicPath(here) || isSitePath(here)) return;
      // A visitor on the landing page or the public catalog simply stays there.
      if (isHybridPath(here) && !wasSignedIn.current) return;
      const returnTo = here + window.location.search;
      // Drop everything cached under the old session, including the principal, so the
      // sign-in page does not bounce back on stale data.
      qc.clear();
      void navigate({ to: '/sign-in', search: { returnTo, reason: wasSignedIn.current ? 'expired' : undefined }, replace: true });
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onExpired);
  }, [navigate, qc]);

  if (isPublicPath(location.pathname) || isSitePath(location.pathname)) return <>{children}</>;
  if (me.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    // Hybrid pages render their public variant; elsewhere the listener above already navigated.
    return openPage ? <>{children}</> : null;
  }
  return <>{children}</>;
}

/** True once `/api/me` answered with a principal (not while loading). */
export function useSignedIn(): boolean {
  return useMe().isSuccess;
}
