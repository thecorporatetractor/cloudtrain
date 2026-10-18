/**
 * Billing API (`/api/billing/*`, docs/billing.md): the current plan and
 * entitlements of the signed-in user or their organisation, Stripe Checkout
 * and Customer Portal links, and the webhook. Stripe runs in TEST MODE ONLY in
 * this version and the whole feature sits behind CT_BILLING_ENABLED (default
 * off): without it the endpoints still answer with the default plan so the app
 * can show entitlements, and checkout/portal return 409.
 *
 * Entitlements are recorded and displayed, never enforced yet.
 */

import type { PlanEntitlements, PlanInterval, SitePlan } from './public.js';

/** `user`: an individual plan for the signed-in person; `org`: the organisation's plan (billing.manage). */
export type BillingScope = 'user' | 'org';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';

export interface BillingSubscription {
  id: string;
  planId: string;
  interval: PlanInterval;
  /** Seats bought (1 for individual plans). */
  seats: number;
  status: SubscriptionStatus;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
}

export interface BillingPlanState {
  planId: string;
  planName: string;
  kind: SitePlan['kind'];
  entitlements: PlanEntitlements;
  /** `default`: no subscription (the free plan, or the first plan when there is none); `subscription`: from Stripe; `manual`: set by the platform. */
  source: 'default' | 'subscription' | 'manual';
  since?: string;
}

/** `GET /api/billing/me` and `GET /api/billing/org`. */
export interface BillingSummary {
  /** Billing integration on (CT_BILLING_ENABLED); off = plans are informational only. */
  enabled: boolean;
  /** Always `test` in this version when enabled. */
  mode: 'test' | 'off';
  scope: BillingScope;
  /** Absent when the site configures no plans. */
  plan?: BillingPlanState;
  subscription?: BillingSubscription;
  /** A Stripe customer exists: the portal link is available. */
  portalAvailable: boolean;
  /** Plans this scope may buy (individual plans for `user`, organisation plans for `org`). */
  plans: SitePlan[];
  currency: string;
  /** Prices are placeholders (site configuration). */
  placeholder: boolean;
  /** Billing is on but self-service checkout is off (flags.checkoutEnabled). */
  checkoutEnabled: boolean;
}

export interface CheckoutRequest {
  planId: string;
  interval: PlanInterval;
  /** Per-seat plans; ignored otherwise. */
  seats?: number;
}

/** 201: redirect the browser to `url` (Stripe Checkout, test mode). */
export interface CheckoutResponse {
  url: string;
  sessionId: string;
}

export interface PortalResponse {
  url: string;
}

/** `GET /api/billing/org/events` (billing.manage): the organisation's webhook history. */
export interface BillingEventRow {
  id: string;
  type: string;
  receivedAt: string;
  processedAt?: string;
  status: 'received' | 'processed' | 'ignored' | 'failed';
  summary: Record<string, unknown>;
}
