import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { useShell } from './shell-context';
import { ApiError, UNAUTHENTICATED_EVENT, useMe } from '@/api/client';
import { PageSkeleton } from '@/components/ui';
import { AccountUnavailable, accountLoadFailed } from './access';
import { HYBRID_PATHS, isHybridRoute, isSiteOnlyPath, ON_APP, PUBLIC_PATHS, SITE_PATHS } from '@/lib/surface';

export { HYBRID_PATHS, PUBLIC_PATHS, SITE_PATHS };

export const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
/**
 * The public website: rendered in the site layout (header, footer) with or without a
 * session. Signed-in visitors see "Go to dashboard" instead of "Sign in".
 */
export const isSitePath = isSiteOnlyPath;
/**
 * `/` and `/catalog`: the website for visitors and the app for signed-in users, on one
 * combined origin. On the app origin of a split deployment they are plain app pages
 * that need a session (src/lib/surface.ts).
 */
export const isHybridPath = (pathname: string) => !ON_APP && isHybridRoute(pathname);
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
  const { toast } = useShell();
  const hybridAccountFailed = isHybridPath(location.pathname) && accountLoadFailed(me);

  // A hybrid page falls back to its visitor variant when /api/me fails (cold gateway, network):
  // a signed-in user must be told, with a retry, instead of silently seeing the public page.
  // Once per failure (errorUpdatedAt), not on every render or navigation.
  useEffect(() => {
    if (!hybridAccountFailed) return;
    toast({ title: 'Could not load your account', description: 'You are seeing the public page. If you are signed in, try again in a moment.', tone: 'err', action: { label: 'Try again', onClick: () => void me.refetch() } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridAccountFailed, me.errorUpdatedAt]);

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
  if (waitForMe(openPage, me)) {
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
  // App pages need the principal (navigation, permissions, the CSRF token): no empty shell.
  if (!openPage && accountLoadFailed(me)) return <AccountUnavailable error={me.error} onRetry={() => void me.refetch()} />;
  return <>{children}</>;
}

/**
 * Whether to hold the page behind a skeleton while `/api/me` loads. App pages wait for the
 * principal (it retries for about half a minute on a cold gateway). Hybrid pages ('/', the
 * catalog) wait only for the first answer: once an attempt failed they render their visitor
 * variant at once, and switch to the signed-in one if a retry then succeeds.
 */
export const waitForMe = (openPage: boolean, me: { isPending: boolean; failureCount: number }) => me.isPending && !(openPage && me.failureCount > 0);

/** True once `/api/me` answered with a principal (not while loading). */
export function useSignedIn(): boolean {
  return useMe().isSuccess;
}
