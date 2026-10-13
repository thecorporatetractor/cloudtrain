import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DomainInfo,
  Framework,
  HomeData,
  Lab,
  LabSession,
  LabSummary,
  Learner,
  Path,
  Skill,
  SkillState,
  StudioDraft,
  TeamData,
  ValidateResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, ...init });
  if (!res.ok) {
    let message = res.statusText || 'Request failed';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const post = <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export interface CatalogData {
  domains: DomainInfo[];
  paths: Path[];
  labs: LabSummary[];
}

export interface SkillsData {
  skills: Skill[];
  states: SkillState[];
  frameworks: Framework[];
  /** Present when the states belong to another team member (manager view). */
  member?: { id: string; name: string; title: string };
}

export const queries = {
  me: () => queryOptions({ queryKey: ['me'], queryFn: () => request<Learner>('/api/me'), staleTime: 5 * 60_000 }),
  home: () => queryOptions({ queryKey: ['home'], queryFn: () => request<HomeData>('/api/home') }),
  catalog: () => queryOptions({ queryKey: ['catalog'], queryFn: () => request<CatalogData>('/api/catalog'), staleTime: 60_000 }),
  lab: (id: string) => queryOptions({ queryKey: ['lab', id], queryFn: () => request<Lab>(`/api/labs/${id}`), staleTime: 60_000 }),
  session: (id: string | undefined) =>
    queryOptions({
      queryKey: ['session', id],
      queryFn: () => request<LabSession>(`/api/sessions/${id}`),
      enabled: !!id,
      refetchInterval: (q) => (q.state.data?.nodes.some((n) => n.status === 'provisioning') ? 1000 : false),
    }),
  skills: (member?: string) =>
    queryOptions({
      queryKey: member ? ['skills', member] : ['skills'],
      queryFn: () => request<SkillsData>(member ? `/api/skills?member=${encodeURIComponent(member)}` : '/api/skills'),
      staleTime: 60_000,
    }),
  team: () => queryOptions({ queryKey: ['team'], queryFn: () => request<TeamData>('/api/team') }),
  drafts: () =>
    queryOptions({
      queryKey: ['studio', 'drafts'],
      queryFn: () => request<StudioDraft[]>('/api/studio/drafts'),
      refetchInterval: (q) => (q.state.data?.some((d) => d.stage === 'verify') ? 1500 : false),
    }),
  draft: (id: string) =>
    queryOptions({
      queryKey: ['studio', 'draft', id],
      queryFn: () => request<StudioDraft>(`/api/studio/drafts/${id}`),
      refetchInterval: (q) => (q.state.data?.stage === 'verify' ? 1200 : false),
    }),
};

export const useMe = () => useQuery(queries.me());
export const useHome = () => useQuery(queries.home());
export const useCatalog = () => useQuery(queries.catalog());
export const useLab = (id: string) => useQuery(queries.lab(id));
export const useSession = (id: string | undefined) => useQuery(queries.session(id));
export const useSkills = (member?: string) => useQuery(queries.skills(member));
export const useTeam = () => useQuery(queries.team());
export const useDrafts = () => useQuery(queries.drafts());
export const useDraft = (id: string) => useQuery(queries.draft(id));

export function useStartSession(labId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<LabSession>(`/api/labs/${labId}/sessions`),
    onSuccess: (s) => qc.setQueryData(['session', s.id], s),
  });
}

export function useValidate(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<ValidateResponse>(`/api/sessions/${sessionId}/validate`),
    onSuccess: (r) => qc.setQueryData(['session', r.session.id], r.session),
  });
}

export function useRevealHint(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (index: number) => post<LabSession>(`/api/sessions/${sessionId}/hints/${index}`),
    onSuccess: (s) => qc.setQueryData(['session', s.id], s),
  });
}

export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prompt: string) => post<StudioDraft>('/api/studio/drafts', { prompt }),
    onSuccess: (d) => {
      qc.setQueryData(['studio', 'draft', d.id], d);
      void qc.invalidateQueries({ queryKey: ['studio', 'drafts'] });
    },
  });
}

export function useDraftAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'verify' | 'publish') => post<StudioDraft>(`/api/studio/drafts/${id}/${action}`),
    onSuccess: (d) => {
      qc.setQueryData(['studio', 'draft', d.id], d);
      void qc.invalidateQueries({ queryKey: ['studio', 'drafts'] });
    },
  });
}
