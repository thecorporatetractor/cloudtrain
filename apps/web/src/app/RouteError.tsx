import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { BrandMark, BrandName } from '@/components/brand';
import { Button, EmptyState } from '@/components/ui';

/** Rendered by the router when a route component or loader throws. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="page page-narrow">
      <div className="page-brand">
        <BrandMark size={30} />
        <BrandName height={15} />
      </div>
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="Something went wrong"
        description={message || 'The page could not be shown.'}
        action={
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <Button type="button" variant="secondary" onClick={reset}>
              Try again
            </Button>
            <Link to="/" className="btn btn-ghost btn-md">
              Back to home
            </Link>
          </div>
        }
      />
    </div>
  );
}
