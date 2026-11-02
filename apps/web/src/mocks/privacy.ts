import { delay, http, HttpResponse } from 'msw';
import type { AccountPrivacySummary, LedgerView } from '@/api/types';
import { personById } from './fixtures/platform';
import { currentSession } from './platformHandlers';

/*
 * Mock of the signed-in privacy routes (services/gateway/src/gdpr). The org admin persona is
 * blocked as the sole administrator; everyone else may delete. The waitlist entry can be withdrawn once.
 */

const RETAINED = [
  { category: 'invoices', explanation: 'Invoices stay with our payment provider Stripe for as long as tax and accounting law requires. They hold the billing name and address on the invoice.' },
  { category: 'usage', explanation: 'Usage behind issued invoices stays without your name or any link to you.' },
  { category: 'audit', explanation: "Your organisation's security log keeps what happened, with your name, email address and IP address removed." },
  { category: 'backups', explanation: 'Database backups expire within 14 days. If one is ever restored, your erasure is applied again.' },
];

let waitlisted = true;
let restrictedAt: string | null = null;

const summary = (): AccountPrivacySummary => {
  const s = currentSession();
  const person = s ? personById.get(s.userId) : undefined;
  return {
    email: person?.email ?? 'lena.varga@quillmoor.example',
    name: person?.name ?? 'Lena Varga',
    recentSignIn: true,
    restrictedAt,
    rectification: s?.userId === 'u-priya' ? { managedBy: 'identity_account', url: 'https://id.example/realms/cloudtrain/account/' } : { managedBy: 'organisation', organisation: 'Quillmoor Logistics' },
    contact: 'gdpr@cloudtrain.app',
    closureDays: 90,
    waitlistEntry: waitlisted,
    blockers: s?.userId === 'u-priya' ? [{ code: 'sole_org_admin', message: 'You are the only administrator of Quillmoor Logistics. Make another member an administrator first, or ask us to close the organisation.', orgs: ['Quillmoor Logistics'] }] : [],
    retained: RETAINED,
  };
};

const ledger: LedgerView = {
  chain: { ok: true, count: 2, headSeq: 2, headHash: '6f1c0a3f6e0d4c7ba2f4b1a9e7d3c2181d5e9f0a7b6c4d3e2f1a0b9c8d7e6f5a', problems: 0 },
  requests: [
    { requestId: 'r2', seq: 2, type: 'erasure', scope: 'account', actor: 'self', requestedAt: '2026-10-28T09:12:00Z', completedAt: '2026-10-28T09:12:04Z', outcomes: [{ system: 'postgres.users', action: 'deleted', rows: 1 }, { system: 'keycloak', action: 'deleted', rows: 1 }, { system: 'postgres.lab_attempts', action: 'deleted', rows: 14 }, { system: 'postgres.audit_log', action: 'anonymised', rows: 31 }] },
    { requestId: 'r1', seq: 1, type: 'withdrawal', scope: 'waitlist', actor: 'self', requestedAt: '2026-10-21T16:40:00Z', completedAt: '2026-10-21T16:44:10Z', outcomes: [{ system: 'waitlist', action: 'deleted', rows: 1 }] },
  ],
};

export const privacyHandlers = [
  http.get('/api/me/privacy', async () => {
    await delay(120);
    return HttpResponse.json(summary());
  }),
  http.post('/api/me/privacy/export', async () => {
    await delay(300);
    return HttpResponse.json({ exportedAt: new Date().toISOString(), profile: { email: summary().email }, sections: {} });
  }),
  http.post('/api/me/privacy/withdraw', async () => {
    await delay(220);
    const removed = waitlisted ? 1 : 0;
    waitlisted = false;
    return HttpResponse.json({ status: 'completed', removed });
  }),
  http.post('/api/me/privacy/delete', async ({ request }) => {
    await delay(400);
    const b = (await request.json().catch(() => null)) as { confirmEmail?: string } | null;
    if (b?.confirmEmail?.trim().toLowerCase() !== summary().email.toLowerCase()) return HttpResponse.json({ error: 'Type your email address to confirm', code: 'invalid' }, { status: 422 });
    return HttpResponse.json({ status: 'completed', requestId: 'r3', retained: RETAINED });
  }),
  http.post('/api/me/privacy/notice', async () => {
    await delay(120);
    try {
      localStorage.removeItem('ct.mock.notice');
    } catch {
      /* no storage */
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.put('/api/me/privacy/restriction', async () => {
    await delay(200);
    restrictedAt = new Date().toISOString();
    return HttpResponse.json({ restrictedAt, endedLabs: 0 });
  }),
  http.delete('/api/me/privacy/restriction', async () => {
    await delay(200);
    restrictedAt = null;
    return HttpResponse.json({ restrictedAt: null, endedLabs: 0 });
  }),
  http.post('/api/me/privacy/objection', async () => {
    await delay(300);
    return HttpResponse.json({ status: 'raised', requestId: 'r4', contact: 'gdpr@cloudtrain.app' }, { status: 202 });
  }),
  http.post('/api/me/privacy/close', async () => {
    await delay(300);
    return HttpResponse.json({ status: 'closed', deleteAfter: new Date(Date.now() + 90 * 86_400_000).toISOString() });
  }),
  http.post('/api/platform/privacy/erase', async () => {
    await delay(300);
    return HttpResponse.json({ status: 'completed', requestId: 'r5', retained: RETAINED });
  }),
  http.post('/api/platform/privacy/reopen', async () => {
    await delay(200);
    return HttpResponse.json({ status: 'reopened' });
  }),
  http.get('/api/platform/privacy/requests', async () => {
    await delay(120);
    return HttpResponse.json(ledger);
  }),
];
