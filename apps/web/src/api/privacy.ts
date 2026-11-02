import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountCloseResponse, AccountDeleteResponse, AccountPrivacySummary, AccountRestrictionResponse, LedgerView, ObjectionRequest, ObjectionResponse, WithdrawResponse } from './types';
import { del, post, put, request } from './client';
import { apiUrl } from '@/lib/runtimeConfig';

/*
 * Data-subject rights of the signed-in person (services/gateway/src/gdpr, docs/gdpr.md):
 * what can be done now, the download, withdrawal and account deletion; for platform
 * admins the completed requests from the evidence ledger.
 */

export const useAccountPrivacy = () => useQuery({ queryKey: ['privacy', 'me'], queryFn: () => request<AccountPrivacySummary>('/api/me/privacy'), staleTime: 15_000 });

export const useLedgerView = () => useQuery({ queryKey: ['privacy', 'ledger'], queryFn: () => request<LedgerView>('/api/platform/privacy/requests'), staleTime: 15_000 });

export function useDownloadMyData() {
  return useMutation({
    mutationFn: async () => {
      const data = await post<unknown>('/api/me/privacy/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cloudtrain-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

export function useWithdrawConsent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post<WithdrawResponse>('/api/me/privacy/withdraw'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['privacy', 'me'] }) });
}

export function useRestriction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (on: boolean) => (on ? put<AccountRestrictionResponse>('/api/me/privacy/restriction', {}) : del<AccountRestrictionResponse>('/api/me/privacy/restriction')), onSuccess: () => void qc.invalidateQueries({ queryKey: ['privacy', 'me'] }) });
}

export const useObjection = () => useMutation({ mutationFn: (body: ObjectionRequest) => post<ObjectionResponse>('/api/me/privacy/objection', body) });

export const useCloseAccount = () => useMutation({ mutationFn: (confirmEmail: string) => post<AccountCloseResponse>('/api/me/privacy/close', { confirmEmail }) });

export function useAdminPrivacy() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['privacy', 'ledger'] });
  return {
    erase: useMutation({ mutationFn: (b: { email: string; confirmEmail: string }) => post<AccountDeleteResponse>('/api/platform/privacy/erase', b), onSuccess: done }),
    reopen: useMutation({ mutationFn: (email: string) => post<{ status: 'reopened' }>('/api/platform/privacy/reopen', { email }) }),
  };
}

/** Sign in again and come back: the prompt is forced, so an identity-provider session is not enough. */
export const reauthUrl = (email: string, returnTo = '/account/privacy') => apiUrl(`/api/auth/login?reauth=1&email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`);

/** No cache invalidation: on success the session is gone, and asking `/api/me` now would only bounce to sign-in. */
export const useDeleteAccount = () => useMutation({ mutationFn: (confirmEmail: string) => post<AccountDeleteResponse>('/api/me/privacy/delete', { confirmEmail }) });
