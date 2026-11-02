import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountPrivacySummary } from '@/api/types';
import { ClosedNotice, DeletedNotice, LedgerTable, PrivacySection, type PrivacySectionProps } from './AccountPrivacy';

const noop = () => undefined;
const summary: AccountPrivacySummary = { email: 'lena@quillmoor.example', name: 'Lena', recentSignIn: true, restrictedAt: null, rectification: { managedBy: 'identity_account', url: 'https://id.example/account/' }, contact: 'gdpr@example.org', closureDays: 90, waitlistEntry: false, blockers: [], retained: [{ category: 'invoices', explanation: 'Invoices stay with our payment provider Stripe for as long as tax and accounting law requires.' }] };
const buttons = (h: string) => h.split('<button').slice(1).map((b) => b.split('</button>')[0]!);
const view = (p: Partial<PrivacySectionProps> = {}) => renderToStaticMarkup(<PrivacySection summary={summary} confirmEmail="" onRestrict={noop} onObject={noop} onClose={noop} onConfirmEmail={noop} onDownload={noop} onWithdraw={noop} onDelete={noop} {...p} />);

describe('privacy section', () => {
  it('explains what stays before anything is pressed', () => {
    const h = view();
    expect(h).toContain('Download my data');
    expect(h).toContain('What stays, and why');
    expect(h).toContain('tax and accounting law');
    expect(h).toContain('cannot be undone');
  });

  it('keeps the delete button off until the address is typed', () => {
    const btn = (h: string) => buttons(h).find((b) => b.includes('Delete my account'))!;
    expect(btn(view())).toContain('disabled');
    expect(btn(view({ confirmEmail: 'Lena@quillmoor.example ' }))).not.toContain('disabled');
    expect(btn(view({ confirmEmail: 'other@quillmoor.example' }))).toContain('disabled');
  });

  it('a blocked person gets the reason and no button', () => {
    const h = view({ summary: { ...summary, blockers: [{ code: 'sole_org_admin', message: 'You are the only administrator of Quillmoor. Make another member an administrator first.', orgs: ['Quillmoor'] }] } });
    expect(h).toContain('only administrator of Quillmoor');
    expect(h).toContain('role="alert"');
    expect(buttons(h).some((b) => b.includes('Delete my account'))).toBe(false);
  });

  it('offers withdrawal only when something rests on consent', () => {
    const withdraw = (h: string) => buttons(h).some((b) => b.includes('Withdraw consent'));
    expect(withdraw(view())).toBe(false);
    expect(withdraw(view({ summary: { ...summary, waitlistEntry: true } }))).toBe(true);
  });

  it('offers closure with the same confirmation, and says what it means', () => {
    const btn = (h: string) => buttons(h).find((b) => b.includes('Close my account'))!;
    expect(btn(view())).toContain('disabled');
    expect(btn(view({ confirmEmail: summary.email }))).not.toContain('disabled');
    expect(view()).toContain('after 90 days');
    expect(renderToStaticMarkup(<ClosedNotice result={{ status: 'closed', deleteAfter: '2027-02-01T00:00:00Z' }} />)).toContain('on or after');
  });

  it('pending does not say deleted', () => {
    const pending = renderToStaticMarkup(<DeletedNotice result={{ status: 'pending', requestId: 'r', retained: [] }} />);
    expect(pending).toContain('in progress');
    expect(pending).not.toContain('has been deleted');
    expect(renderToStaticMarkup(<DeletedNotice result={{ status: 'completed', requestId: 'r', retained: [] }} />)).toContain('has been deleted');
  });

  it('asks for a new sign-in before a download or deletion, without offering either button', () => {
    const h = view({ summary: { ...summary, recentSignIn: false } });
    expect(buttons(h).some((b) => b.includes('Download my data') || b.includes('Delete my account'))).toBe(false);
    expect(h).toContain('Sign in again');
    expect(h).toContain('reauth=1');
  });

  it('says where to correct details, by who manages them', () => {
    const local = view();
    expect(local).toContain('Open my sign-in account');
    expect(local).toContain('https://id.example/account/');
    const managed = view({ summary: { ...summary, rectification: { managedBy: 'organisation', organisation: 'Quillmoor' } } });
    expect(managed).toContain('Quillmoor&#x27;s identity provider');
    expect(managed).not.toContain('Open my sign-in account');
  });

  it('shows the restriction and how to lift it', () => {
    expect(buttons(view()).some((b) => b.includes('Restrict processing'))).toBe(true);
    const on = view({ summary: { ...summary, restrictedAt: '2026-11-01T00:00:00Z' } });
    expect(on).toContain('Restricted');
    expect(buttons(on).some((b) => b.includes('Lift the restriction'))).toBe(true);
  });

  it('an objection is confirmed as received, not as granted', () => {
    expect(view()).toContain('Send my objection');
    const sent = view({ objected: { requestId: 'r', contact: 'gdpr@example.org' } });
    expect(sent).toContain('We received your objection');
    expect(sent).toContain('Nothing changes until then');
  });

  it('the ledger table shows the chain and no identifiers', () => {
    const h = renderToStaticMarkup(<LedgerTable view={{ chain: { ok: false, count: 1, headSeq: 1, headHash: 'abc', problems: 2 }, requests: [{ requestId: 'r', seq: 1, type: 'erasure', scope: 'waitlist', actor: 'self', requestedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:00Z', outcomes: [{ system: 'waitlist', action: 'deleted', rows: 1 }] }] }} />);
    expect(h).toContain('2 problem(s)');
    expect(h).toContain('waitlist: deleted 1');
  });
});
