import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingEventRow, BillingScope, BillingSummary, CheckoutRequest, CheckoutResponse, PortalResponse } from './types';
import { post, request } from './client';

/*
 * Billing API (packages/api-types/billing.d.ts): the signed-in person's plan
 * (`/api/billing/me`) and the organisation's (`/api/billing/org`, billing.manage).
 * Checkout and the customer portal answer with a Stripe URL the browser is sent to.
 */

const base = (scope: BillingScope) => (scope === 'org' ? '/api/billing/org' : '/api/billing/me');

export const billingQueries = {
  summary: (scope: BillingScope) => queryOptions({ queryKey: ['billing', scope], queryFn: () => request<BillingSummary>(base(scope)), staleTime: 30_000 }),
  events: () => queryOptions({ queryKey: ['billing', 'org', 'events'], queryFn: async () => (await request<{ events: BillingEventRow[] }>('/api/billing/org/events')).events, staleTime: 30_000 }),
};

export const useBilling = (scope: BillingScope) => useQuery(billingQueries.summary(scope));
export const useBillingEvents = (enabled = true) => useQuery({ ...billingQueries.events(), enabled });

export function useCheckout(scope: BillingScope) {
  return useMutation({ mutationFn: (body: CheckoutRequest) => post<CheckoutResponse>(`${base(scope)}/checkout`, body) });
}

export function usePortal(scope: BillingScope) {
  return useMutation({ mutationFn: () => post<PortalResponse>(`${base(scope)}/portal`) });
}

export function useRefreshBilling() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['billing'] });
}
