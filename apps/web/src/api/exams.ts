import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamAttemptState, ExamAttemptSummary, ExamDetail, ExamReport, ExamSummary, StartExamResponse, TeamExamReadiness } from './types';
import { ApiError } from './client';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
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

const enc = encodeURIComponent;

/** Attempts in these phases change on their own; poll them. */
const LIVE = new Set<ExamAttemptState['phase']>(['preparing', 'in-progress', 'grading']);

export const examQueries = {
  list: () => queryOptions({ queryKey: ['exams'], queryFn: async () => (await call<{ exams: ExamSummary[] }>('/api/exams')).exams }),
  detail: (id: string) => queryOptions({ queryKey: ['exams', id], queryFn: () => call<ExamDetail>(`/api/exams/${enc(id)}`) }),
  mine: () => queryOptions({ queryKey: ['exams', 'attempts', 'mine'], queryFn: () => call<ExamAttemptSummary[]>('/api/exams/attempts/mine') }),
  attempt: (id: string) =>
    queryOptions({
      queryKey: ['exam-attempt', id],
      queryFn: () => call<ExamAttemptState>(`/api/exams/attempts/${enc(id)}`),
      // Preparing and grading move server-side; in progress refreshes the clock offset and the deadline.
      refetchInterval: (q) => {
        const p = q.state.data?.phase;
        if (!p || !LIVE.has(p)) return false;
        return p === 'in-progress' ? 15_000 : 2_000;
      },
    }),
  report: (id: string) => queryOptions({ queryKey: ['exam-report', id], queryFn: () => call<ExamReport>(`/api/exams/attempts/${enc(id)}/report`), staleTime: Infinity }),
  team: (team?: string) =>
    queryOptions({
      queryKey: ['exams', 'team', team ?? ''],
      queryFn: () => call<TeamExamReadiness>(`/api/exams/team-readiness${team ? `?team=${enc(team)}` : ''}`),
    }),
};

export const useExams = () => useQuery(examQueries.list());
export const useExam = (id: string) => useQuery(examQueries.detail(id));
export const useMyAttempts = () => useQuery(examQueries.mine());
export const useAttempt = (id: string) => useQuery(examQueries.attempt(id));
export const useExamReport = (id: string, enabled = true) => useQuery({ ...examQueries.report(id), enabled });
export const useTeamExamReadiness = (team?: string) => useQuery(examQueries.team(team));

export function useStartExam(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await call<StartExamResponse>(`/api/exams/${enc(examId)}/attempts`, { method: 'POST' })).attempt,
    onSuccess: (a) => {
      qc.setQueryData(['exam-attempt', a.id], a);
      void qc.invalidateQueries({ queryKey: ['exams'] });
    },
  });
}

export function useFlagTask(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ index, flagged }: { index: number; flagged: boolean }) =>
      call<ExamAttemptState>(`/api/exams/attempts/${enc(attemptId)}/tasks/${index}/flag`, { method: 'PUT', body: JSON.stringify({ flagged }) }),
    onMutate: ({ index, flagged }) => {
      qc.setQueryData<ExamAttemptState>(['exam-attempt', attemptId], (a) => (a ? { ...a, tasks: a.tasks.map((t) => (t.index === index ? { ...t, flagged } : t)) } : a));
    },
    onSuccess: (a) => qc.setQueryData(['exam-attempt', a.id], a),
  });
}

export function useSubmitExam(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<ExamAttemptState>(`/api/exams/attempts/${enc(attemptId)}/submit`, { method: 'POST' }),
    onSuccess: (a) => {
      qc.setQueryData(['exam-attempt', a.id], a);
      void qc.invalidateQueries({ queryKey: ['exams'] });
    },
  });
}
