import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingEventRow, BillingLimit, BillingLimitRequest, BillingScope, BillingSeats, BillingSummary, CheckoutRequest, CheckoutResponse, PortalResponse } from './types';
import { del, post, put, request } from './client';

/*
 * Billing API (packages/api-types/billing.d.ts): the signed-in person's plan
 * (`/api/billing/me`) and the organisation's (`/api/billing/org`, billing.manage).
 * Checkout (plans, or setup mode for a payment method) and the customer portal
 * answer with a Stripe URL the browser is sent to. Limits and seats change in place.
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

/** Checkout in setup mode: saves a card for pay-as-you-go compute. */
export function usePaymentMethod(scope: BillingScope) {
  return useMutation({ mutationFn: () => post<CheckoutResponse>(`${base(scope)}/payment-method`) });
}

export function useSetLimit(scope: BillingScope) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: BillingLimitRequest) => put<BillingLimit>(`${base(scope)}/limits`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['billing'] }) });
}

/** Seats (org): the count (prorated in Stripe) and who holds them. Each answers the new `BillingSeats`. */
export function useSeatActions() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['billing'] });
  return {
    count: useMutation({ mutationFn: (seats: number) => put<BillingSeats>('/api/billing/org/seats', { seats }), onSuccess: done }),
    assign: useMutation({ mutationFn: (userId: string) => post<BillingSeats>('/api/billing/org/seats/assign', { userId }), onSuccess: done }),
    unassign: useMutation({ mutationFn: (userId: string) => del<BillingSeats>(`/api/billing/org/seats/${encodeURIComponent(userId)}`), onSuccess: done }),
  };
}
