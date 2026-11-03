import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutoSubmitFailed, SubmitFailed } from './SubmitErrors';

describe('exam submit errors', () => {
  it('a failed manual submit is announced with the reason', () => {
    const h = renderToStaticMarkup(<SubmitFailed error={new Error('Service unavailable')} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain('Your exam was not submitted: Service unavailable');
  });

  it('a failed automatic submit offers to submit again', () => {
    const h = renderToStaticMarkup(<AutoSubmitFailed error={new Error('timeout')} retrying={false} onRetry={() => undefined} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain('automatic submit did not go through');
    expect(h).toContain('Submit again');
  });
});
