import { queryOptions, useQuery } from '@tanstack/react-query';
import type { PublicCatalog, PublicExamDetail, PublicPathDetail, SiteConfig } from './types';
import { ApiError, request } from './client';
import { STATIC_SITE, staticDataUrl } from '@/lib/siteMode';

/*
 * The public website API (packages/api-types/public.d.ts): the site configuration
 * and the read-only catalog. No session is needed, the gateway serves it from
 * content/ with a public Cache-Control, so these queries stay fresh for long.
 */

const enc = encodeURIComponent;

/** The public documents: the gateway's `/api/public/*`, or the exported `/data/*.json` files in the static website build. */
const get = <T>(api: string, file: string): Promise<T> =>
  STATIC_SITE
    ? fetch(staticDataUrl(file)).then((r) => {
        if (!r.ok) throw new ApiError(r.status, r.status === 404 ? 'Not found' : 'Request failed', r.status === 404 ? 'not_found' : undefined);
        return r.json() as Promise<T>;
      })
    : request<T>(api);
const HOUR = 3_600_000;

export const publicQueries = {
  site: () => queryOptions({ queryKey: ['public', 'site'], queryFn: () => get<SiteConfig>('/api/public/site', 'site.json'), staleTime: HOUR, gcTime: 2 * HOUR }),
  catalog: () => queryOptions({ queryKey: ['public', 'catalog'], queryFn: () => get<PublicCatalog>('/api/public/catalog', 'catalog.json'), staleTime: 10 * 60_000 }),
  path: (id: string) => queryOptions({ queryKey: ['public', 'path', id], queryFn: () => get<PublicPathDetail>(`/api/public/paths/${enc(id)}`, `paths/${enc(id)}.json`), staleTime: 10 * 60_000 }),
  exam: (id: string) => queryOptions({ queryKey: ['public', 'exam', id], queryFn: () => get<PublicExamDetail>(`/api/public/exams/${enc(id)}`, `exams/${enc(id)}.json`), staleTime: 10 * 60_000 }),
};

export const useSite = () => useQuery(publicQueries.site());
export const usePublicCatalog = (enabled = true) => useQuery({ ...publicQueries.catalog(), enabled });
export const usePublicPath = (id: string) => useQuery(publicQueries.path(id));
export const usePublicExam = (id: string) => useQuery(publicQueries.exam(id));

/** The brand name for titles and the header before the configuration has loaded. */
export const DEFAULT_BRAND = 'CloudTrain';

/** An internal path (`/pricing`) as opposed to a URL (`https://`, `mailto:`). */
export const isInternalHref = (to: string): boolean => to.startsWith('/') && !to.startsWith('//');
