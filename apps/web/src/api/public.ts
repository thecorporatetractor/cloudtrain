import { queryOptions, useQuery } from '@tanstack/react-query';
import type { PublicCatalog, PublicExamDetail, PublicPathDetail, SiteConfig } from './types';
import { request } from './client';

/*
 * The public website API (packages/api-types/public.d.ts): the site configuration
 * and the read-only catalog. No session is needed, the gateway serves it from
 * content/ with a public Cache-Control, so these queries stay fresh for long.
 */

const enc = encodeURIComponent;
const HOUR = 3_600_000;

export const publicQueries = {
  site: () => queryOptions({ queryKey: ['public', 'site'], queryFn: () => request<SiteConfig>('/api/public/site'), staleTime: HOUR, gcTime: 2 * HOUR }),
  catalog: () => queryOptions({ queryKey: ['public', 'catalog'], queryFn: () => request<PublicCatalog>('/api/public/catalog'), staleTime: 10 * 60_000 }),
  path: (id: string) => queryOptions({ queryKey: ['public', 'path', id], queryFn: () => request<PublicPathDetail>(`/api/public/paths/${enc(id)}`), staleTime: 10 * 60_000 }),
  exam: (id: string) => queryOptions({ queryKey: ['public', 'exam', id], queryFn: () => request<PublicExamDetail>(`/api/public/exams/${enc(id)}`), staleTime: 10 * 60_000 }),
};

export const useSite = () => useQuery(publicQueries.site());
export const usePublicCatalog = (enabled = true) => useQuery({ ...publicQueries.catalog(), enabled });
export const usePublicPath = (id: string) => useQuery(publicQueries.path(id));
export const usePublicExam = (id: string) => useQuery(publicQueries.exam(id));

/** The brand name for titles and the header before the configuration has loaded. */
export const DEFAULT_BRAND = 'CloudTrain';

/** An internal path (`/pricing`) as opposed to a URL (`https://`, `mailto:`). */
export const isInternalHref = (to: string): boolean => to.startsWith('/') && !to.startsWith('//');
