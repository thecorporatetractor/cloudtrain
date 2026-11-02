import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrivacyNoticeBody } from './PrivacyNotice';

describe('first-sign-in notice', () => {
  it('tells an org-managed learner who manages them, what is processed, and where to go', () => {
    const h = renderToStaticMarkup(<PrivacyNoticeBody brand="CloudTrain" legalName="CloudTrain Ltd" orgName="Quillmoor" />);
    expect(h).toContain('Quillmoor');
    expect(h).toContain('You may not have signed up yourself');
    expect(h).toContain('CloudTrain Ltd');
    expect(h).toContain('can see your progress');
    expect(h).toContain('An instructor can watch it read-only');
    expect(h).toContain('IP address');
    expect(h).toContain('/legal/privacy');
    expect(h).toContain('/account/privacy');
    expect(h).not.toMatch(/consent|agree/i);
  });

  it('does not invent an organisation for someone without one', () => {
    const h = renderToStaticMarkup(<PrivacyNoticeBody brand="CloudTrain" />);
    expect(h).toContain('CloudTrain processes your data');
    expect(h).not.toContain('managers');
  });
});
