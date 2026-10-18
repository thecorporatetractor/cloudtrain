import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DomainInfo,
  ErrorCode,
  Framework,
  HomeData,
  Lab,
  LabSession,
  LabSummary,
  Me,
  Path,
  Permission,
  CtfTotals,
  QuestionsView,
  SubmitAnswerResponse,
  Skill,
  SkillState,
  StudioDraft,
  ValidateResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ErrorCode,
    /** On 403: the permission the request needed. */
    public permission?: Permission,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Fired on any 401 so the shell can send the user to sign in (with returnTo). */
export const UNAUTHENTICATED_EVENT = 'ct:unauthenticated';

/** CSRF token from the last `/api/me`; sent on every state-changing request. */
let csrfToken: string | undefined;
export const setCsrfToken = (t: string | undefined) => (csrfToken = t);

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const mutating = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(mutating && csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let message = res.statusText || 'Request failed';
    let code: ErrorCode | undefined;
    let permission: Permission | undefined;
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: ErrorCode; permission?: Permission; details?: Record<string, unknown> };
      if (body.error) message = body.error;
      code = body.code;
      permission = body.permission;
      details = body.details;
    } catch {
      /* ignore */
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT, { detail: { url } }));
    throw new ApiError(res.status, message, code, permission, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const post = <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(url: string, body: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T>(url: string, body: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T = void>(url: string) => request<T>(url, { method: 'DELETE' });

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
  /** Personal CTF points (best attempt per CTF lab); absent before the first CTF answer. */
  ctf?: CtfTotals;
}

export const queries = {
  me: () =>
    queryOptions({
      queryKey: ['me'],
      queryFn: async () => {
        const me = await request<Me>('/api/me');
        setCsrfToken(me.csrfToken);
        return me;
      },
      staleTime: 5 * 60_000,
      retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && count < 1,
    }),
  home: () => queryOptions({ queryKey: ['home'], queryFn: () => request<HomeData>('/api/home') }),
  catalog: () => queryOptions({ queryKey: ['catalog'], queryFn: () => request<CatalogData>('/api/catalog'), staleTime: 60_000 }),
  lab: (id: string) => queryOptions({ queryKey: ['lab', id], queryFn: () => request<Lab>(`/api/labs/${id}`), staleTime: 60_000 }),
  session: (id: string | undefined) =>
    queryOptions({
      queryKey: ['session', id],
      queryFn: () => request<LabSession>(`/api/sessions/${id}`),
      enabled: !!id,
      refetchInterval: (q) => {
        const s = q.state.data;
        if (!s || s.phase === 'failed' || s.phase === 'expired' || s.status === 'expired' || s.status === 'failed') return false;
        if (s.phase === 'pending' || s.phase === 'provisioning') return 1500;
        if (s.nodes.some((n) => n.status === 'provisioning')) return 1000;
        // A slow poll while running picks up instructor notices (observing, hints) and extensions.
        return 5000;
      },
    }),
  questions: (sessionId: string | undefined, enabled = true) =>
    queryOptions({
      queryKey: ['questions', sessionId],
      queryFn: () => request<QuestionsView>(`/api/sessions/${sessionId}/questions`),
      enabled: !!sessionId && enabled,
      // In a team event teammates solve questions too: poll for their progress.
      refetchInterval: (q) => (q.state.data?.event?.teamId ? 10_000 : false),
    }),
  skills: (member?: string) =>
    queryOptions({
      queryKey: member ? ['skills', member] : ['skills'],
      queryFn: () => request<SkillsData>(member ? `/api/skills?member=${encodeURIComponent(member)}` : '/api/skills'),
      staleTime: 60_000,
    }),
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
export const useQuestions = (sessionId: string | undefined, enabled = true) => useQuery(queries.questions(sessionId, enabled));

export function useSubmitAnswer(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ checkId, answer }: { checkId: string; answer: string }) => post<SubmitAnswerResponse>(`/api/sessions/${sessionId}/questions/${encodeURIComponent(checkId)}/answer`, { answer }),
    onSuccess: (r) => qc.setQueryData(['questions', sessionId], r.view),
  });
}

export function useRevealQuestionHint(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ checkId, index }: { checkId: string; index: number }) => post<QuestionsView>(`/api/sessions/${sessionId}/questions/${encodeURIComponent(checkId)}/hints/${index}`),
    onSuccess: (v) => qc.setQueryData(['questions', sessionId], v),
  });
}
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

export function useEndSession(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Through request() so the CSRF header is sent; 404 means it is already gone.
      try {
        await del(`/api/sessions/${sessionId}`);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
    },
    onSuccess: () => qc.removeQueries({ queryKey: ['session', sessionId] }),
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
