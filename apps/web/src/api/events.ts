import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCtfEventRequest, CtfEventDetail, CtfEventReport, CtfEventSummary, CtfScoreboard, JoinCtfEventRequest, LabSession, UpdateCtfEventRequest } from './types';
import { del, patch, post, put, request } from './client';

export const eventQueries = {
  list: () => queryOptions({ queryKey: ['events'], queryFn: () => request<CtfEventSummary[]>('/api/events') }),
  detail: (id: string) =>
    queryOptions({
      queryKey: ['events', id],
      queryFn: () => request<CtfEventDetail>(`/api/events/${id}`),
      // Teams fill up and the event starts: refresh while it is not over.
      refetchInterval: (q) => (q.state.data && q.state.data.status !== 'ended' ? 15_000 : false),
    }),
  scoreboard: (id: string) =>
    queryOptions({
      queryKey: ['events', id, 'scoreboard'],
      queryFn: () => request<CtfScoreboard>(`/api/events/${id}/scoreboard`),
      refetchInterval: (q) => (q.state.data?.status === 'running' ? 10_000 : false),
    }),
  report: (id: string) =>
    queryOptions({
      queryKey: ['events', id, 'report'],
      queryFn: () => request<CtfEventReport>(`/api/events/${id}/report`),
      refetchInterval: (q) => (q.state.data?.scoreboard.status === 'running' ? 10_000 : false),
    }),
};

export const useEvents = () => useQuery(eventQueries.list());
export const useEvent = (id: string) => useQuery(eventQueries.detail(id));
export const useScoreboard = (id: string) => useQuery(eventQueries.scoreboard(id));
export const useEventReport = (id: string) => useQuery(eventQueries.report(id));

function useEventMutation<V>(fn: (v: V) => Promise<CtfEventDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (e) => {
      qc.setQueryData(['events', e.id], e);
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export const useCreateEvent = () => useEventMutation((body: CreateCtfEventRequest) => post<CtfEventDetail>('/api/events', body));
export const useUpdateEvent = (id: string) => useEventMutation((body: UpdateCtfEventRequest) => patch<CtfEventDetail>(`/api/events/${id}`, body));
export const useJoinEvent = (id: string) => useEventMutation((body: JoinCtfEventRequest) => post<CtfEventDetail>(`/api/events/${id}/join`, body));
export const useLeaveEvent = (id: string) => useEventMutation(() => post<CtfEventDetail>(`/api/events/${id}/leave`));
export const useCreateTeam = (id: string) => useEventMutation((name: string) => post<CtfEventDetail>(`/api/events/${id}/teams`, { name }));
export const useSetTeamMembers = (id: string) => useEventMutation(({ teamId, userIds }: { teamId: string; userIds: string[] }) => put<CtfEventDetail>(`/api/events/${id}/teams/${teamId}/members`, { userIds }));

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/api/events/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['events'] }) });
}

export function useStartEventLab(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labId: string) => post<LabSession>(`/api/events/${eventId}/labs/${labId}/sessions`),
    onSuccess: (s) => {
      qc.setQueryData(['session', s.id], s);
      void qc.invalidateQueries({ queryKey: ['events', eventId] });
    },
  });
}
