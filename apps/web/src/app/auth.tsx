import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { ApiError, UNAUTHENTICATED_EVENT, useMe } from '@/api/client';
import { PageSkeleton } from '@/components/ui';

/** Routes that render without a session (and without the shell chrome). */
export const PUBLIC_PATHS = ['/sign-in'];
export const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Sends signed-out visitors to the sign-in page, remembering where they were.
 * A 401 from any request while signed in means the session expired: same
 * redirect, with `reason=expired` so the page can say so.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useRouterState({ select: (s) => s.location });
  const wasSignedIn = useRef(false);
  const publicPage = isPublicPath(location.pathname);

  useEffect(() => {
    if (me.isSuccess) wasSignedIn.current = true;
  }, [me.isSuccess]);

  useEffect(() => {
    const onExpired = () => {
      if (isPublicPath(window.location.pathname)) return;
      const returnTo = window.location.pathname + window.location.search;
      // Drop everything cached under the old session, including the principal, so the
      // sign-in page does not bounce back on stale data.
      qc.clear();
      void navigate({ to: '/sign-in', search: { returnTo, reason: wasSignedIn.current ? 'expired' : undefined }, replace: true });
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onExpired);
  }, [navigate, qc]);

  if (publicPage) return <>{children}</>;
  if (me.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    // The event listener above already navigated; render nothing while the route changes.
    return null;
  }
  return <>{children}</>;
}
