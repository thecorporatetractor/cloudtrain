import { delay, http, HttpResponse } from 'msw';
import { publicCatalog, publicExamDetail, publicPathDetail, site } from './fixtures/site';

/** Mock of `/api/public/*` (services/gateway src/routes/public.ts): no session needed. */
export const publicHandlers = [
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
