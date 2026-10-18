import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { BrandMark, BrandName } from '@/components/brand';
import { EmptyState } from '@/components/ui';

export function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="page-brand">
        <BrandMark size={30} />
        <BrandName height={15} />
      </div>
      <EmptyState
        icon={<Compass size={20} />}
        title="This page does not exist"
        description="The link may be out of date, or the lab was unpublished."
        action={
          <Link to="/" className="btn btn-secondary btn-md">
            Back to home
          </Link>
        }
      />
    </div>
  );
}
