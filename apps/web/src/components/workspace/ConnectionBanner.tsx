import { RotateCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * A background refresh failed but the screen still has what it last loaded: keep it (a lab or an
 * exam must not unmount during a deploy or a cold start) and say that updates are not arriving.
 * The query keeps polling on its own; Retry asks now.
 */
export function ConnectionBanner({ what, error, retrying, onRetry }: { what: string; error: unknown; retrying: boolean; onRetry: () => void }) {
  const reason = error instanceof Error ? error.message : undefined;
  return (
    <div className="ws-notice ws-notice-conn" role="alert">
      <span className="row small" style={{ gap: 8, minWidth: 0 }}>
        <WifiOff size={13} aria-hidden />
        <strong>Lost contact with {what}</strong>
        <span className="muted truncate">· your work is safe; the screen may be out of date until it reconnects{reason ? ` (${reason})` : ''}</span>
      </span>
      <Button variant="ghost" size="sm" icon={<RotateCw size={12} />} loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
