/**
 * Query hooks for the platform API (docs/api/platform.md): auth, assignments,
 * attempts, manager, instructor, admin and platform endpoints. Shapes come from
 * packages/api-types/platform.d.ts.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddCohortMembersRequest,
  AddDomainRequest,
  AddTeamMemberRequest,
  AdminOverview,
  Assignment,
  AssignmentDetail,
  Attempt,
  AttemptDetail,
  AuditEvent,
  AuditQuery,
  AuthDiscovery,
  Capacity,
  Cohort,
  CohortBoard,
  ContentVisibility,
  CreateAssignmentRequest,
  CreateAssignmentResponse,
  CreateCohortRequest,
  CreatePlatformOrgRequest,
  CreateSsoConnectionRequest,
  CreateTeamRequest,
  Domain,
  ExtendSessionRequest,
  Invitation,
  InviteUserRequest,
  InviteUserResponse,
  LiveSession,
  LogoutResponse,
  Me,
  MemberDetail,
  MyAssignment,
  OrgDomain,
  OrgSettingsResponse,
  OrgUser,
  Page,
  PlatformOrg,
  Quotas,
  SessionControlResponse,
  SsoConnection,
  SsoOverview,
  SsoTestResult,
  Team,
  TeamDashboard,
  TeamDetail,
  UpdateContentVisibilityRequest,
  UpdateOrgSettingsRequest,
  UpdatePlatformOrgRequest,
  UpdateSsoConnectionRequest,
  UpdateTeamRequest,
  UpdateUserRequest,
  UpdateUserResponse,
  Usage,
  UserQuery,
  VerifyDomainResponse,
} from './types';
import { del, patch, post, put, request } from './client';

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

/** Global content pack as the platform admin sees it (mock shape until the gateway serves `/platform/content`). */
export interface PlatformPack {
  id: string;
  title: string;
  domain: Domain;
  version: string;
  labs: number;
  orgsEnabled: number;
  global: boolean;
  updatedAt: string;
}

export const platformQueries = {
  discover: (email: string) => queryOptions({ queryKey: ['auth', 'discover', email], queryFn: () => request<AuthDiscovery>(`/api/auth/discover${qs({ email })}`), enabled: !!email, staleTime: 60_000, retry: false }),
  myAssignments: () => queryOptions({ queryKey: ['assignments', 'mine'], queryFn: () => request<MyAssignment[]>('/api/assignments/mine') }),
  myAttempts: (q: { lab?: string; outcome?: string; cursor?: string; limit?: number } = {}) => queryOptions({ queryKey: ['attempts', 'mine', q], queryFn: () => request<Page<Attempt>>(`/api/attempts/mine${qs(q)}`) }),
  attempt: (id: string | undefined) => queryOptions({ queryKey: ['attempts', id], queryFn: () => request<AttemptDetail>(`/api/attempts/${id}`), enabled: !!id }),
  teams: () => queryOptions({ queryKey: ['teams'], queryFn: () => request<Team[]>('/api/teams'), staleTime: 60_000 }),
  teamDashboard: (id: string | undefined) => queryOptions({ queryKey: ['teams', id, 'dashboard'], queryFn: () => request<TeamDashboard>(`/api/teams/${id}/dashboard`), enabled: !!id }),
  member: (teamId: string, userId: string) => queryOptions({ queryKey: ['teams', teamId, 'members', userId], queryFn: () => request<MemberDetail>(`/api/teams/${teamId}/members/${userId}`) }),
  assignments: (q: { team?: string; user?: string; cohort?: string; state?: string; cursor?: string; limit?: number } = {}) => queryOptions({ queryKey: ['assignments', q], queryFn: () => request<Page<Assignment>>(`/api/assignments${qs(q)}`) }),
  assignment: (id: string | undefined) => queryOptions({ queryKey: ['assignments', 'detail', id], queryFn: () => request<AssignmentDetail>(`/api/assignments/${id}`), enabled: !!id }),
  cohorts: () => queryOptions({ queryKey: ['cohorts'], queryFn: () => request<Cohort[]>('/api/cohorts') }),
  cohort: (id: string) => queryOptions({ queryKey: ['cohorts', id], queryFn: () => request<Cohort>(`/api/cohorts/${id}`) }),
  cohortBoard: (id: string, live = true) => queryOptions({ queryKey: ['cohorts', id, 'board'], queryFn: () => request<CohortBoard>(`/api/cohorts/${id}/board`), refetchInterval: live ? 5000 : false }),
  adminOverview: () => queryOptions({ queryKey: ['admin', 'overview'], queryFn: () => request<AdminOverview>('/api/admin/overview') }),
  adminUsers: (q: UserQuery) => queryOptions({ queryKey: ['admin', 'users', q], queryFn: () => request<Page<OrgUser>>(`/api/admin/users${qs(q as Record<string, string | number | undefined>)}`), placeholderData: (prev) => prev }),
  adminUser: (id: string | undefined) => queryOptions({ queryKey: ['admin', 'users', 'one', id], queryFn: () => request<OrgUser>(`/api/admin/users/${id}`), enabled: !!id }),
  invitations: () => queryOptions({ queryKey: ['admin', 'invitations'], queryFn: () => request<Invitation[]>('/api/admin/invitations') }),
  adminTeams: () => queryOptions({ queryKey: ['admin', 'teams'], queryFn: () => request<Team[]>('/api/admin/teams') }),
  adminTeam: (id: string | undefined) => queryOptions({ queryKey: ['admin', 'teams', id], queryFn: () => request<TeamDetail>(`/api/admin/teams/${id}`), enabled: !!id }),
  sso: () => queryOptions({ queryKey: ['admin', 'sso'], queryFn: () => request<SsoOverview>('/api/admin/sso') }),
  content: () => queryOptions({ queryKey: ['admin', 'content'], queryFn: () => request<ContentVisibility>('/api/admin/content') }),
  liveSessions: () => queryOptions({ queryKey: ['admin', 'sessions'], queryFn: () => request<LiveSession[]>('/api/admin/sessions'), refetchInterval: 8000 }),
  usage: (range: { from?: string; to?: string } = {}) => queryOptions({ queryKey: ['admin', 'usage', range], queryFn: () => request<Usage>(`/api/admin/usage${qs(range)}`) }),
  quotas: () => queryOptions({ queryKey: ['admin', 'quotas'], queryFn: () => request<Quotas>('/api/admin/quotas') }),
  audit: (q: AuditQuery) => queryOptions({ queryKey: ['admin', 'audit', q], queryFn: () => request<Page<AuditEvent>>(`/api/admin/audit${qs(q as Record<string, string | number | undefined>)}`), placeholderData: (prev) => prev }),
  settings: () => queryOptions({ queryKey: ['admin', 'settings'], queryFn: () => request<OrgSettingsResponse>('/api/admin/settings') }),
  platformOrgs: () => queryOptions({ queryKey: ['platform', 'orgs'], queryFn: () => request<PlatformOrg[]>('/api/platform/orgs') }),
  capacity: () => queryOptions({ queryKey: ['platform', 'capacity'], queryFn: () => request<Capacity>('/api/platform/capacity'), refetchInterval: 15_000 }),
  platformContent: () => queryOptions({ queryKey: ['platform', 'content'], queryFn: () => request<PlatformPack[]>('/api/platform/content') }),
};

const q = platformQueries;

export const useDiscover = (email: string) => useQuery(q.discover(email));
export const useMyAssignments = () => useQuery(q.myAssignments());
export const useMyAttempts = (filters?: Parameters<typeof q.myAttempts>[0]) => useQuery(q.myAttempts(filters));
export const useAttempt = (id: string | undefined) => useQuery(q.attempt(id));
export const useTeams = () => useQuery(q.teams());
export const useTeamDashboard = (id: string | undefined) => useQuery(q.teamDashboard(id));
export const useMember = (teamId: string, userId: string) => useQuery(q.member(teamId, userId));
export const useAssignments = (filters?: Parameters<typeof q.assignments>[0]) => useQuery(q.assignments(filters));
export const useAssignment = (id: string | undefined) => useQuery(q.assignment(id));
export const useCohorts = () => useQuery(q.cohorts());
export const useCohort = (id: string) => useQuery(q.cohort(id));
export const useCohortBoard = (id: string, live = true) => useQuery(q.cohortBoard(id, live));
export const useAdminOverview = () => useQuery(q.adminOverview());
export const useAdminUsers = (filters: UserQuery) => useQuery(q.adminUsers(filters));
export const useAdminUser = (id: string | undefined) => useQuery(q.adminUser(id));
export const useInvitations = () => useQuery(q.invitations());
export const useAdminTeams = () => useQuery(q.adminTeams());
export const useAdminTeam = (id: string | undefined) => useQuery(q.adminTeam(id));
export const useSso = () => useQuery(q.sso());
export const useContentVisibility = () => useQuery(q.content());
export const useLiveSessions = () => useQuery(q.liveSessions());
export const useUsage = (range?: { from?: string; to?: string }) => useQuery(q.usage(range));
export const useQuotas = () => useQuery(q.quotas());
export const useAudit = (filters: AuditQuery) => useQuery(q.audit(filters));
export const useOrgSettings = () => useQuery(q.settings());
export const usePlatformOrgs = () => useQuery(q.platformOrgs());
export const useCapacity = () => useQuery(q.capacity());
export const usePlatformContent = () => useQuery(q.platformContent());

/* ------------------------------------------------------------------ */
/* Mutations                                                            */
/* ------------------------------------------------------------------ */

export function useSwitchOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => post<Me>('/api/me/org', { orgId }),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(['me'], me);
    },
  });
}

export function useLogout() {
  return useMutation({ mutationFn: () => post<LogoutResponse>('/api/auth/logout') });
}

/** Mock mode only: completes the sign-in the real gateway would do through Keycloak. */
export function useMockLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password?: string }) => post<Me>('/api/auth/mock-login', body),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(['me'], me);
    },
  });
}

export function useSetPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (persona: string) => post<Me>('/api/dev/persona', { persona }),
    onSuccess: () => qc.clear(),
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAssignmentRequest) => post<CreateAssignmentResponse>('/api/assignments', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      void qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useDeleteAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/api/assignments/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      void qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useCreateCohort() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateCohortRequest) => post<Cohort>('/api/cohorts', body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['cohorts'] }) });
}

export function useAddCohortMembers(cohortId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: AddCohortMembersRequest) => post<Cohort>(`/api/cohorts/${cohortId}/members`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['cohorts'] }) });
}

export function useBroadcast(cohortId: string) {
  return useMutation({ mutationFn: (body: { message: string; kind?: 'info' | 'hint' }) => post<void>(`/api/cohorts/${cohortId}/broadcast`, body) });
}

export function useSessionControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, action, minutes }: { sessionId: string; action: 'extend' | 'reset' | 'terminate'; minutes?: number }) => post<SessionControlResponse>(`/api/sessions/${sessionId}/${action}`, action === 'extend' ? ({ minutes: minutes ?? 30 } satisfies ExtendSessionRequest) : undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohorts'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'sessions'] });
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteUserRequest) => post<InviteUserResponse>('/api/admin/users', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'invitations'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateUserRequest & { id: string }) => patch<UpdateUserResponse>(`/api/admin/users/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'sessions'] });
    },
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/api/admin/invitations/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'invitations'] }) });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateTeamRequest) => post<Team>('/api/admin/teams', body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'teams'] }) });
}
export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: UpdateTeamRequest & { id: string }) => patch<Team>(`/api/admin/teams/${id}`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'teams'] }) });
}
export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/api/admin/teams/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'teams'] }) });
}
export function useAddTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: AddTeamMemberRequest) => post<TeamDetail>(`/api/admin/teams/${teamId}/members`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'teams'] }) });
}
export function useRemoveTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userId: string) => del(`/api/admin/teams/${teamId}/members/${userId}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'teams'] }) });
}

export function useCreateSso() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateSsoConnectionRequest) => post<SsoConnection>('/api/admin/sso', body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}
export function useUpdateSso() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: UpdateSsoConnectionRequest & { id: string }) => patch<SsoConnection>(`/api/admin/sso/${id}`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}
export function useDeleteSso() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/api/admin/sso/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}
export function useTestSso() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => post<SsoTestResult>(`/api/admin/sso/${id}/test`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}
export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: AddDomainRequest) => post<OrgDomain>('/api/admin/sso/domains', body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}
export function useVerifyDomain() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (domain: string) => post<VerifyDomainResponse>(`/api/admin/sso/domains/${encodeURIComponent(domain)}/verify`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}
export function useRemoveDomain() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (domain: string) => del(`/api/admin/sso/domains/${encodeURIComponent(domain)}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'sso'] }) });
}

export function useUpdateContent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: UpdateContentVisibilityRequest) => put<ContentVisibility>('/api/admin/content', body), onSuccess: (data) => qc.setQueryData(['admin', 'content'], data) });
}

export function useUpdateQuotas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Quotas>) => put<Quotas>('/api/admin/quotas', body),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'quotas'], data);
      void qc.invalidateQueries({ queryKey: ['admin', 'usage'] });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOrgSettingsRequest) => patch<OrgSettingsResponse>('/api/admin/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useCreatePlatformOrg() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreatePlatformOrgRequest) => post<PlatformOrg>('/api/platform/orgs', body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'orgs'] }) });
}
export function useUpdatePlatformOrg() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: UpdatePlatformOrgRequest & { id: string }) => patch<PlatformOrg>(`/api/platform/orgs/${id}`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'orgs'] }) });
}
export function usePlatformOrgAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'reactivate' }) => post<PlatformOrg>(`/api/platform/orgs/${id}/${action}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'orgs'] }) });
}

/** Mock-only registration of an observer (the real gateway learns it from the WebSocket `?observe=1`). */
export function useObserveRegistration() {
  return {
    start: (sessionId: string) => post<void>(`/api/sessions/${sessionId}/observe`).catch(() => undefined),
    stop: (sessionId: string) => del(`/api/sessions/${sessionId}/observe`).catch(() => undefined),
  };
}

/** Download a CSV endpoint through the session cookie (an `<a download>` would skip the CSRF-free GET just fine, but we want errors surfaced). */
export async function downloadCsv(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message || 'Export failed');
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
