import { delay, http, HttpResponse } from 'msw';
import { publicCatalog, publicExamDetail, publicPathDetail, site } from './fixtures/site';

/** Mock of `/api/public/*` (services/gateway src/routes/public.ts): no session needed. */
/** Addresses that joined in this mock session (lowercased), so a second submission shows the duplicate state. */
const waitlist = new Set<string>(['already@example.com']);

export const publicHandlers = [
  http.post('/api/public/waitlist', async ({ request }) => {
    await delay(220);
    const b = (await request.json().catch(() => null)) as { email?: unknown; consent?: unknown; website?: unknown } | null;
    const email = typeof b?.email === 'string' ? b.email.trim() : '';
    const fields: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.email = 'Enter a valid email address';
    if (b?.consent !== true) fields.consent = 'Please agree to the privacy notice to join the waitlist';
    if (Object.keys(fields).length) return HttpResponse.json({ error: 'Check the highlighted fields', code: 'invalid', details: { fields } }, { status: 422 });
    if (b?.website) return HttpResponse.json({ status: 'created' }, { status: 201 });
    if (waitlist.has(email.toLowerCase())) return HttpResponse.json({ status: 'duplicate' });
    waitlist.add(email.toLowerCase());
    return HttpResponse.json({ status: 'created' }, { status: 201 });
  }),
  http.post('/api/public/privacy/requests', async ({ request }) => {
    await delay(220);
    const b = (await request.json().catch(() => null)) as { email?: unknown; type?: unknown } | null;
    const email = typeof b?.email === 'string' ? b.email.trim() : '';
    const fields: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.email = 'Enter a valid email address';
    if (!['erasure', 'withdrawal', 'export'].includes(String(b?.type))) fields.type = 'Choose what you would like us to do';
    if (Object.keys(fields).length) return HttpResponse.json({ error: 'Check the highlighted fields', code: 'invalid', details: { fields } }, { status: 422 });
    return HttpResponse.json({ status: 'accepted', message: 'If this address can receive email, a confirmation link is on its way. It works once and expires after a day.' }, { status: 202 });
  }),
  http.post('/api/public/privacy/confirm', async ({ request }) => {
    await delay(220);
    const b = (await request.json().catch(() => null)) as { token?: unknown } | null;
    if (b?.token === 'expired') return HttpResponse.json({ error: 'This link is invalid, has expired or was already used. You can send a new request.', code: 'invalid' }, { status: 410 });
    return HttpResponse.json({ status: 'completed', type: 'erasure', removed: 1 });
  }),
  http.get('/api/public/site', async () => {
    await delay(80);
    return HttpResponse.json(site, { headers: { 'cache-control': 'public, max-age=300' } });
  }),
  http.get('/api/public/catalog', async () => {
    await delay(160);
    return HttpResponse.json(publicCatalog, { headers: { 'cache-control': 'public, max-age=300' } });
  }),
  http.get('/api/public/paths/:id', async ({ params }) => {
    await delay(120);
    const d = publicPathDetail(String(params.id));
    return d ? HttpResponse.json(d) : HttpResponse.json({ error: 'Path not found', code: 'not_found' }, { status: 404 });
  }),
  http.get('/api/public/exams/:id', async ({ params }) => {
    await delay(120);
    const d = publicExamDetail(String(params.id));
    return d ? HttpResponse.json(d) : HttpResponse.json({ error: 'Exam not found', code: 'not_found' }, { status: 404 });
  }),
];
