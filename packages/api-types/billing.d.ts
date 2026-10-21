/**
 * Billing API (`/api/billing/*`, docs/billing.md): the current plan and
 * entitlements of the signed-in user or their organisation, Stripe Checkout
 * and Customer Portal links, and the webhook. Stripe runs in TEST MODE ONLY in
 * this version and the whole feature sits behind CT_BILLING_ENABLED (default
 * off): without it the endpoints still answer with the default plan so the app
 * can show entitlements, and checkout/portal return 409.
 *
 * Pricing model: learners pay for the compute their lab sessions use (metered
 * per session, reported to a Stripe Billing Meter); plans unlock premium features
 * (docs/licensing-keys.md) and early-access labs;
 * a free account gets the trial lab only. Lab starts are enforced when
 * CT_BILLING_ENFORCE is on (default: on with billing).
 */

import type { ComputeTier, PlanEntitlements, PlanInterval, SitePlan } from './public.js';

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
  /** Lab starts are checked (CT_BILLING_ENFORCE). */
  enforced: boolean;
  /** A payment method is on file for this scope (setup checkout or a subscription). */
  paymentMethod: boolean;
  /** Effective plan level for early-access labs (plan level, or the organisation's for a seated member). */
  level: number;
  /** User scope: who pays this person's compute; `org` for a seated member. */
  payer: BillingScope;
  /** User scope: the organisation seat this person holds. */
  seat?: { planId: string; planName: string; level: number };
  /** Compute rates (placeholders while `compute.placeholder`). */
  compute?: BillingComputeRates;
  /** Compute used this calendar month (UTC) and its estimated cost. */
  usage: BillingUsage;
  limit: BillingLimit;
  /** The payer's payment state (the organisation's for a seated member). */
  dunning: BillingDunning;
  /** User scope: the free trial and what is left of it. */
  trial?: BillingTrial;
  /** Org scope: seats bought and who holds them. */
  seats?: BillingSeats;
}

export interface BillingComputeRates {
  /** Minor units per compute unit (decimal). */
  unitPrice: number;
  placeholder: boolean;
  minimumMinutes: number;
  tiers: { tier: ComputeTier; label: string; unitsPerMinute: number; /** Minor units per hour. */ pricePerHour: number }[];
}

export type UsageReportState = 'running' | 'unbilled' | 'pending' | 'sent' | 'failed';

export interface BillingUsageRow {
  id: string;
  sessionName: string;
  labId: string;
  labTitle: string;
  userId: string;
  userName?: string;
  tier: ComputeTier;
  startedAt: string;
  endedAt?: string;
  minutes: number;
  units: number;
  /** Minor units (estimate; Stripe's invoice is authoritative). */
  amount: number;
  payer: BillingScope;
  trial: boolean;
  /** Where its meter event stands: running (not ended), unbilled (trial or no account), pending/sent/failed (outbox). */
  report: UsageReportState;
}

export interface BillingUsage {
  periodStart: string;
  periodEnd: string;
  minutes: number;
  units: number;
  /** Estimated compute cost to date, minor units. */
  estimate: number;
  running: number;
  byTier: { tier: ComputeTier; minutes: number; units: number; amount: number }[];
  /** Org scope: per member. */
  byMember?: { userId: string; name: string; minutes: number; units: number; amount: number }[];
  /** Latest sessions (at most 50). */
  sessions: BillingUsageRow[];
}

export interface BillingLimit {
  /** Minor units per month; 0 = no cap. */
  monthlyCap: number;
  hardStop: boolean;
  source: 'default' | 'custom';
  /** Compute estimate this month (same as usage.estimate). */
  spent: number;
  /** At or over the cap. */
  reached: boolean;
  /** At or over 80% of the cap. */
  warn: boolean;
}

export interface BillingDunning {
  /** ok; grace: a payment failed, labs still start until graceEndsAt; blocked: new paid labs are refused. */
  state: 'ok' | 'grace' | 'blocked';
  since?: string;
  graceEndsAt?: string;
  graceDays: number;
}

export interface BillingTrial {
  labs: { id: string; title: string }[];
  maxSessions: number;
  maxMinutes: number;
  usedSessions: number;
  usedMinutes: number;
  exhausted: boolean;
}

export interface BillingSeatRow {
  userId: string;
  name: string;
  email: string;
  assignedAt: string;
}

export interface BillingSeats {
  /** Seats on the organisation subscription (0 without one). */
  purchased: number;
  assigned: BillingSeatRow[];
  /** Active members without a seat. */
  unassigned: { userId: string; name: string; email: string }[];
  /** A subscription exists whose quantity can change. */
  canChange: boolean;
  minSeats: number;
  maxSeats: number;
}

/** `PUT /api/billing/{me,org}/limits`. */
export interface BillingLimitRequest {
  /** Minor units; 0 = no cap. */
  monthlyCap: number;
  hardStop: boolean;
}

/** `PUT /api/billing/org/seats`: the new quantity (prorated). */
export interface SeatCountRequest {
  seats: number;
}

/** `POST /api/billing/org/seats/assign`. */
export interface SeatAssignRequest {
  userId: string;
}

export type BillingBlockReason = 'plan_required' | 'trial_exhausted' | 'payment_method_required' | 'payment_overdue' | 'spend_cap_reached';

/** `details` of a 402 `payment_required` on a lab start. */
export interface BillingBlockDetails {
  reason: BillingBlockReason;
  /** What fixes it. `contact_admin`: the organisation's account blocks and the caller cannot manage it. */
  action: 'upgrade' | 'add_payment_method' | 'portal' | 'raise_cap' | 'contact_admin';
  /** The page where it is fixed (/account/billing or /admin/billing). */
  href: string;
  /** Whose account blocks. */
  scope: BillingScope;
  requiredPlan?: { id: string; name: string; level: number };
  currency?: string;
  cap?: number;
  spent?: number;
  graceEndedAt?: string;
}

/** Billing view of one lab for the signed-in person. */
export interface LabAccess {
  computeTier: ComputeTier;
  unitsPerMinute: number;
  /** Minor units per hour of compute (placeholder rates). */
  pricePerHour: number;
  /** The plan that unlocks this early-access lab (hosted edition). */
  requiredPlan?: { id: string; name: string; level: number };
  /** Early access: content not yet public, unlocked by `requiredPlan` or higher. */
  earlyAccess?: boolean;
  /** A free-trial lab. */
  trial?: boolean;
  /** Not billed when started now (trial allowance left, or billing off). */
  free?: boolean;
  /** Present when enforcement would refuse a start now. */
  locked?: { reason: BillingBlockReason; message: string; action: BillingBlockDetails['action']; href: string };
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
