import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LicenseStatus } from './types';
import { del, put, request } from './client';

/*
 * Self-hosted license (`/api/platform/license`, platform admins): the status, installing
 * an uploaded license key, removing it (docs/licensing-keys.md). Changing it changes
 * what every org may use, so `/api/me` (entitlements) is refetched too.
 */

export const licenseQueries = {
  status: () => queryOptions({ queryKey: ['platform', 'license'], queryFn: () => request<LicenseStatus>('/api/platform/license') }),
};

export const useLicense = () => useQuery(licenseQueries.status());

export function useLicenseActions() {
  const qc = useQueryClient();
  const done = (s: LicenseStatus) => {
    qc.setQueryData(licenseQueries.status().queryKey, s);
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  return {
    install: useMutation({ mutationFn: (license: string) => put<LicenseStatus>('/api/platform/license', { license }), onSuccess: done }),
    remove: useMutation({ mutationFn: () => del<LicenseStatus>('/api/platform/license'), onSuccess: done }),
  };
}
