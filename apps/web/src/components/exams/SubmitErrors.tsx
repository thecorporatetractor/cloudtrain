import { AlertTriangle, Send } from 'lucide-react';
import { Button } from '@/components/ui';

/** The manual submit failed: the dialog stays open, says why, and its button retries. */
export function SubmitFailed({ error }: { error: unknown }) {
  return (
    <p className="small row text-err" role="alert" style={{ gap: 6, alignItems: 'flex-start' }}>
      <AlertTriangle size={13} style={{ flex: 'none', marginTop: 2 }} />
      <span>
        Your exam was not submitted{error instanceof Error ? `: ${error.message}` : ''}. Your work is still there and the timer keeps running. Try again.
      </span>
    </p>
  );
}

/** Time is up but the automatic submit failed. The environment is still graded at the deadline; the retry records the submission. */
export function AutoSubmitFailed({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="stack" style={{ gap: 8 }} role="alert">
      <p className="small">
        <strong>The automatic submit did not go through</strong>
        {error instanceof Error ? ` (${error.message})` : ''}. The environment still closes and is graded at the deadline; submit again to make sure your attempt is recorded.
      </p>
      <div>
        <Button variant="primary" size="sm" icon={<Send size={13} />} loading={retrying} onClick={onRetry}>
          Submit again
        </Button>
      </div>
    </div>
  );
}
