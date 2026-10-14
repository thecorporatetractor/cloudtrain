import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamAttemptState, ExamAttemptSummary, ExamDetail, ExamReport, ExamRetakeGrant, ExamSummary, GrantExamRetakeRequest, StartExamResponse, TeamExamReadiness } from './types';
import { post, put, request } from './client';

/*
 * Exam API (packages/api-types/exam.d.ts). Reads and writes go through the
 * shared client (request/post/put), so writes carry the session's CSRF token
 * in real mode and errors keep their code, permission and details.
 */

const enc = encodeURIComponent;

/** Attempts in these phases change on their own; poll them. */
const LIVE = new Set<ExamAttemptState['phase']>(['preparing', 'in-progress', 'grading']);

export const examQueries = {
  list: () => queryOptions({ queryKey: ['exams'], queryFn: async () => (await request<{ exams: ExamSummary[] }>('/api/exams')).exams }),
  detail: (id: string) => queryOptions({ queryKey: ['exams', id], queryFn: () => request<ExamDetail>(`/api/exams/${enc(id)}`) }),
  mine: () => queryOptions({ queryKey: ['exams', 'attempts', 'mine'], queryFn: () => request<ExamAttemptSummary[]>('/api/exams/attempts/mine') }),
  attempt: (id: string) =>
    queryOptions({
      queryKey: ['exam-attempt', id],
      queryFn: () => request<ExamAttemptState>(`/api/exams/attempts/${enc(id)}`),
      // Preparing and grading move server-side; in progress refreshes the clock offset and the deadline.
      refetchInterval: (q) => {
        const p = q.state.data?.phase;
        if (!p || !LIVE.has(p)) return false;
        return p === 'in-progress' ? 15_000 : 2_000;
      },
    }),
  report: (id: string) => queryOptions({ queryKey: ['exam-report', id], queryFn: () => request<ExamReport>(`/api/exams/attempts/${enc(id)}/report`), staleTime: Infinity }),
  team: (team?: string) =>
    queryOptions({
      queryKey: ['exams', 'team', team ?? ''],
      queryFn: () => request<TeamExamReadiness>(`/api/exams/team-readiness${team ? `?team=${enc(team)}` : ''}`),
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
    mutationFn: async () => (await post<StartExamResponse>(`/api/exams/${enc(examId)}/attempts`)).attempt,
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
      put<ExamAttemptState>(`/api/exams/attempts/${enc(attemptId)}/tasks/${index}/flag`, { flagged }),
    onMutate: ({ index, flagged }) => {
      qc.setQueryData<ExamAttemptState>(['exam-attempt', attemptId], (a) => (a ? { ...a, tasks: a.tasks.map((t) => (t.index === index ? { ...t, flagged } : t)) } : a));
    },
    onSuccess: (a) => qc.setQueryData(['exam-attempt', a.id], a),
  });
}

export function useSubmitExam(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<ExamAttemptState>(`/api/exams/attempts/${enc(attemptId)}/submit`),
    onSuccess: (a) => {
      qc.setQueryData(['exam-attempt', a.id], a);
      void qc.invalidateQueries({ queryKey: ['exams'] });
    },
  });
}

/* ------------------------------------------------- interventions (manager/admin) */

/** Ends a person's running attempt: not scored, not counted (session.control on that person). */
export function useVoidExamAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, reason }: { attemptId: string; reason?: string }) => post<ExamAttemptSummary>(`/api/exams/attempts/${enc(attemptId)}/void`, reason ? { reason } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['exams'] }),
  });
}

/** One more attempt past the cooldown / 30-day cap (assignment.manage on that person). */
export function useGrantExamRetake(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GrantExamRetakeRequest) => post<ExamRetakeGrant>(`/api/exams/${enc(examId)}/retake-grants`, req),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['exams'] }),
  });
}
