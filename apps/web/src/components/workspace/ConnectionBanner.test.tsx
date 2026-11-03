import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';

describe('connection banner', () => {
  it('is an alert that names the service and the reason, with a Retry', () => {
    const h = renderToStaticMarkup(<ConnectionBanner what="the exam service" error={new Error('Failed to fetch')} retrying={false} onRetry={() => undefined} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain('Lost contact with the exam service');
    expect(h).toContain('Failed to fetch');
    expect(h).toContain('Retry');
  });
});
