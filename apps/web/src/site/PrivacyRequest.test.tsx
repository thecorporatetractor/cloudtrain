import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyPrivacyForm } from '@/lib/privacyRequest';
import { PrivacyConfirmView, PrivacyRequestView } from './PrivacyRequest';

const noop = () => undefined;
const form = (over = {}) => renderToStaticMarkup(<PrivacyRequestView values={emptyPrivacyForm} errors={{}} phase="idle" onChange={noop} onSubmit={noop} {...over} />);

describe('privacy request form', () => {
  it('offers the three requests, the address and a hidden honeypot', () => {
    const h = form();
    expect(h).toContain('Erase my waitlist entry');
    expect(h).toContain('Withdraw my consent');
    expect(h).toContain('Get a copy of my data');
    expect(h).toContain('name="email"');
    expect(h).toMatch(/aria-hidden="true"[^]*name="website"/);
    expect(h).toContain('Email me a confirmation link');
  });

  it('shows field errors next to their field', () => {
    const h = form({ errors: { email: 'Enter your email address' } });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('Enter your email address');
  });

  it('the accepted state says nothing about whether the address is known', () => {
    const h = form({ phase: 'accepted', acceptedMessage: 'If this address can receive email, a link is on its way.' });
    expect(h).toContain('Check your email');
    expect(h).toContain('If this address can receive email');
    expect(h).not.toContain('<form');
  });
});

describe('confirming', () => {
  it('asks for a press: opening the link does nothing by itself', () => {
    const onConfirm = vi.fn();
    const h = renderToStaticMarkup(<PrivacyConfirmView phase="ready" onConfirm={onConfirm} />);
    expect(h).toContain('Confirm my request');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a pending result does not claim the data is gone', () => {
    const h = renderToStaticMarkup(<PrivacyConfirmView phase="done" result={{ status: 'pending', type: 'erasure' }} onConfirm={noop} />);
    expect(h).toContain('still being processed');
    expect(h).not.toMatch(/\berased\b/i);
  });

  it('shows a copy of the data, with a download', () => {
    const h = renderToStaticMarkup(<PrivacyConfirmView phase="done" result={{ status: 'completed', type: 'export', removed: 0, data: { waitlist: [{ email: 'a@b.io', organisation: 'Org', role: null, interest: null, consentAt: '2026-01-01', createdAt: '2026-01-01' }] } }} onConfirm={noop} onDownload={noop} />);
    expect(h).toContain('a@b.io');
    expect(h).toContain('Download as JSON');
  });

  it('a dead link leads to a new request, not a retry', () => {
    const h = renderToStaticMarkup(<PrivacyConfirmView phase="error" error="This link is invalid" canRetry={false} onConfirm={noop} />);
    expect(h).toContain('Send a new request');
    expect(h).not.toContain('Confirm my request');
  });
});
