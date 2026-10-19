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
