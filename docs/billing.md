# Billing (Stripe, test mode)

Plans are data (`content/site.yaml` `plans`, see `docs/website.md`); Stripe handles money;
the gateway keeps the mapping from a Stripe customer and subscription to an organisation
(and, for individual plans, a person), meters lab compute and enforces who may start what.
**This version runs Stripe in test mode only and the whole feature sits behind a flag that is
off by default.** Every amount in `site.yaml` is a placeholder.

## The model

1. **Pay for compute.** Every lab session started through the gateway is metered from start
   to stop (wall-clock minutes, rounded up, at least `compute.minimumMinutes`). The lab's
   *compute tier* comes from its topology: `pod` (container nodes and virtual clusters),
   `vm` (exactly one VM) or `heavy` (two or more VMs, a kubeadm cluster or a netdev
   topology). Billed units = minutes x the tier's `unitsPerMinute`; money = units x
   `compute.unitPrice`. At the end of the session its units are reported to a Stripe
   **Billing Meter** as one meter event, and a **metered Price** on a separate *compute
   subscription* turns them into an invoice line, monthly in arrears. Compute is billed on top
   of any plan.
2. **Plans unlock premium labs.** Each plan has a `level` (Free 0, Pro 1, Premium 2, Team 2).
   `plans.premium` rules say which plan a lab needs; a lab matching no rule is *standard*.
3. **Free accounts get the trial.** Without a payment method or a plan, a person may start
   only the `plans.free.trialLabs`, uncharged, up to `maxSessions` sessions or `maxMinutes`
   minutes (lifetime, per person and organisation). Everything else needs a payment method
   on file (Checkout in setup mode) or a subscription.
4. **Organisation seats.** An admin buys N seats (the subscription quantity) and assigns or
   unassigns members on `/admin/billing`. Only seated members get the organisation plan's
   level, and their compute is billed to the organisation. Changing the seat count updates
   the quantity with proration (`proration_behavior=create_prorations`).
5. **Failed payments.** A failed invoice, or a `past_due`/`unpaid` subscription, starts a
   grace period (`dunning.graceDays`): a banner and the portal link show, labs still start.
   After it, new *paid* lab starts are refused; running sessions are never stopped and the
   free trial stays available. A paid invoice (or the subscription back to `active`) restores
   access. Both transitions mail the person, or the organisation's admins (Mailpit in dev).
6. **Spend caps.** A monthly compute spend cap per account and per organisation (defaults in
   `plans.limits`, each account or org admin may change theirs). With `hardStop` new paid
   labs are refused at the cap; without it the page only warns (at 80% and at the cap).

### Why premium is a site.yaml rule list, not a lab-schema field

The lab schema (`packages/lab-schema`) is content: deployment-neutral, shared and licensed
with the packs. Which labs are premium is a commercial decision of one deployment, changes
with pricing, and covers hundreds of labs. Rules over existing lab facts (`labs` ids,
`domains`, `difficulties`, `computeTiers`, `tags`) gate whole groups without touching a lab
file, and `CT_SITE_CONFIG` can swap them per deployment. A single lab is listed by id.

### Enforcement order (`BillingService.assertLabStart`)

| Check | Refusal (`402`, `code: payment_required`, `details: BillingBlockDetails`) |
|---|---|
| Premium: the lab's required plan level vs the person's (own plan, or the org's when seated) | `plan_required`, `action: upgrade`, `requiredPlan` |
| Trial lab with allowance left | allowed, uncharged (`trial`) |
| Trial used up and no payment method | `trial_exhausted`, `action: add_payment_method` |
| No payment method (and no plan) for the payer | `payment_method_required`, `action: add_payment_method` |
| Payer past the dunning grace period | `payment_overdue`, `action: portal` |
| Payer at the spend cap with `hardStop` | `spend_cap_reached`, `action: raise_cap` |

When the organisation pays and the caller cannot manage billing, `action` is
`contact_admin`. `details.href` names the page that fixes it. The catalog
(`GET /api/catalog`) and the lab page (`GET /api/labs/:id`) carry the same decision per lab
as `access` (`computeTier`, `pricePerHour`, `requiredPlan`, `trial`, `free`, `locked`), so the
UI shows locked labs and the reason before anyone clicks.

What is metered: lab sessions started through `POST /api/labs/:id/sessions`. Exam simulations
and CTF event sessions start through their own services and are not metered or gated yet
(an open decision).

## Switches

| Variable | Default | |
|---|---|---|
| `CT_BILLING_ENABLED` | off | `1` turns billing on. Off: the billing pages show the default plan, checkout and portal answer 409, the webhook route is not registered |
| `STRIPE_MODE` | `test` | Only `test` is accepted; anything else refuses to start |
| `STRIPE_SECRET_KEY` | | A test-mode secret key (`sk_test_...`). A live key (`sk_live_`, `rk_live_`) refuses to start, on or off. Load it from the environment only (for example `set -a; . ~/.config/cloudtrain/stripe-test.env; set +a`); never commit it, print it or put it in CI, docs, screenshots or on a shared machine. The gateway logs it masked (`sk_test_…XXXX`) |
| `STRIPE_WEBHOOK_SECRET` | | The endpoint secret (`whsec_...`) from `stripe listen` or the dashboard; required when billing is on |
| `CT_BILLING_ENFORCE` | on with billing | `1`/`0`. Unset, it follows `CT_BILLING_ENABLED` (so dev with billing on enforces); `0` meters and shows everything but never refuses a start. Without billing nothing is enforced |
| `CT_BILLING_SWEEP_MS` | `60000` | How often usage of sessions that ended outside the gateway (expiry, admin) is closed and the meter outbox is flushed; `0` turns the worker off |
| `flags.checkoutEnabled` (site.yaml) | `false` | Self-service payments. Off: the pricing page's paid calls to action lead to contact and `POST .../checkout` and `.../payment-method` answer 409, while summaries and the portal keep working. With enforcement on and checkout off, people can only run the trial |

### Configuration (`content/site.yaml` `plans`)

| Key | Placeholder value | |
|---|---|---|
| `items[].level` | free 0, pro 1, premium 2, team 2 | Premium level a plan grants |
| `items[].prices` | Pro 9/90, Premium 19/190, Team 15/150 per seat (EUR per month/year) | `stripe:sync` creates the Prices |
| `items[team].minSeats` | 3 | Seat count bounds for checkout and changes |
| `free.trialLabs` | `[shell-first-steps-timetable]` | A 10-minute single-container Linux lab, status verified |
| `free.maxSessions` / `free.maxMinutes` | 3 / 60 | Trial caps per person |
| `compute.unitPrice` | `'0.5'` (half a cent per unit) | Decimal minor units (Stripe `unit_amount_decimal`) |
| `compute.tiers.{pod,vm,heavy}.unitsPerMinute` | 1 / 4 / 10 | EUR 0.30 / 1.20 / 3.00 per hour |
| `compute.minimumMinutes` | 1 | Billed minimum per session |
| `compute.lookupKey` / `compute.meterEventName` | `ct_compute_unit` / `ct_compute_units` | The metered Price and the Meter |
| `limits.user` / `limits.org` | 50.00 hard stop / 500.00 warn only | Default monthly compute caps (minor units; 0 = none) |
| `dunning.graceDays` | 7 | Grace after a failed payment |
| `premium` | Pro: `difficulties: [hard]`; Premium: `difficulties: [hard]` + `computeTiers: [heavy]` | Rules; the highest matching plan wins |

The plan id `compute` is reserved (the Compute product). A rule naming an unknown plan, or an
unknown trial lab, is logged at startup and covered by `test/billing-compute.test.ts`.

## What the gateway does

| Endpoint | Permission | |
|---|---|---|
| `GET /api/billing/me` | `progress.read.self` | `BillingSummary` for the signed-in person: plan and entitlements (default free plan without a subscription), subscription, whether the portal is available, the individual plans |
| `POST /api/billing/me/checkout` | `progress.read.self` | `CheckoutRequest` `{ planId, interval }` → `201 { url, sessionId }`: a Stripe Checkout Session in subscription mode for the plan's price (found by lookup key), with the org and user in `metadata` and `subscription_data.metadata`; the browser is sent to `url`. Audit `billing.checkout` |
| `POST /api/billing/me/portal` | `progress.read.self` | `{ url }` of a Customer Portal session; 409 before the first checkout. Audit `billing.portal` |
| `POST /api/billing/me/payment-method` | `progress.read.self` | `201 { url, sessionId }`: a Checkout Session in **setup** mode (`currency` from the site) that saves a card for pay-as-you-go compute; no charge now. Audit `billing.payment_method` |
| `PUT /api/billing/me/limits` | `progress.read.self` | `BillingLimitRequest` `{ monthlyCap, hardStop }` (minor units, 0 = no cap). Audit `billing.limit` |
| `GET /api/billing/org`, `POST /api/billing/org/checkout` (`{ planId, interval, seats }`), `POST /api/billing/org/payment-method`, `POST /api/billing/org/portal`, `PUT /api/billing/org/limits` | `billing.manage` | The same for the organisation and its per-seat plans |
| `GET /api/billing/org/seats`, `PUT /api/billing/org/seats` (`{ seats }`), `POST /api/billing/org/seats/assign` (`{ userId }`), `DELETE /api/billing/org/seats/:userId` | `billing.manage` | Seats bought, who holds them, the active members without one. The count change updates the Stripe subscription item quantity with proration (409 below the assigned count); assignment refuses past the purchased count (409). Audit `billing.seats`, `billing.seat_assign`, `billing.seat_unassign` |
| `GET /api/billing/org/events` | `billing.manage` | The organisation's webhook deliveries (type, status, summary) |
| `POST /api/billing/webhook` | public (Stripe signs it) | Verifies `Stripe-Signature` (HMAC-SHA256 over the raw body, 5 minute tolerance), refuses live-mode events, records the event once by Stripe event id (a replay answers `duplicate`), applies it, audits `billing.webhook` and `billing.subscription` for the org |

`BillingSummary` (both scopes) now also carries: `enforced`, `paymentMethod`, `level`,
`payer` (who pays this person's compute) and `seat`, the compute `rates` (per tier, per hour),
`usage` this calendar month (UTC: minutes, units, estimate to date, running sessions, by tier,
by member for the org, the latest 50 sessions with their meter report state), `limit` (cap,
hard stop, spent, `warn`, `reached`), `dunning` (`ok`/`grace`/`blocked`, since, grace end),
`trial` (user scope) and `seats` (org scope). The estimate is ours; Stripe's invoice is
authoritative. A session counts in the month it ends (that is the meter event's timestamp).

Handled events:

| Event | Effect |
|---|---|
| `checkout.session.completed`, mode `subscription` | fetches the subscription and records it; the subscription's payment method becomes the customer default; opens the compute subscription |
| `checkout.session.completed`, mode `setup` | fetches the SetupIntent, makes its payment method the customer default, marks the payment method on file, opens the compute subscription |
| `customer.subscription.created/updated/deleted` (plan) | latest state, seats, period end, cancellation; entitlements follow the plan while `trialing`, `active` or `past_due`, else the free plan; dunning recomputed; an active plan without a compute subscription gets one |
| `customer.subscription.*` (compute: `metadata.ct_kind=compute` or the metered lookup key) | recorded as `kind = compute`, never as a plan |
| `invoice.payment_failed` | starts the grace period (once), mails |
| `invoice.paid` | ends it (if no subscription is still `past_due`/`unpaid`), mails |
| `customer.updated` | payment method on file follows `invoice_settings.default_payment_method` |

Everything else is recorded as `ignored`. Mails go out after the transaction commits; a mail
failure is logged and never undoes billing state.

`billing.manage` is held by `org_admin` (every non-platform permission). Code:
`services/gateway/src/billing/` (`stripe.ts` REST client and signatures, `compute.ts` tiers,
rates and premium rules, `service.ts`, `routes.ts`, `sync.ts`), migrations
`services/gateway/src/db/migrations/0007_billing.ts` and `0009_billing_compute.ts`.

## Data

Migration `0007_billing`, row-level security on `org_id` like every tenant table (the
webhook runs in the platform context before the org is known, then stamps the row):

| Table | Holds |
|---|---|
| `billing_customers` | one Stripe customer id per (org, user-or-org) |
| `billing_subscriptions` | the latest state of each Stripe subscription: plan, lookup key, interval, seats, status, period end, cancellation |
| `billing_entitlements` | the effective plan and its entitlements per (org, user-or-org), with its source (`subscription`, `default`, `manual`) |
| `billing_events` | every webhook delivery by Stripe event id: type, outcome, a summary of ids and amounts; append-only for the app role apart from the outcome |

Migration `0009_billing_compute` (same tenancy):

| Table | Holds |
|---|---|
| `billing_usage` | one row per metered session (`session_name` unique): learner, lab, compute tier, the rate and unit price at start, payer (`payer_key`: a user id, or `''` for the organisation), trial, billable, start, end, billed minutes and units |
| `billing_meter_outbox` | one meter event per billable usage row: identifier `ctu_<usage id>`, event name, Stripe customer, value, timestamp, status (`pending`, `sent`, `failed`), attempts, next attempt, last error |
| `billing_seats` | members holding a seat of the organisation plan |
| `billing_limits` | a custom monthly cap and hard stop per (org, user-or-org) |
| `billing_customers` + | `has_payment_method`, `invoice_failed_at`, `delinquent_since`, `compute_subscription_id` |
| `billing_subscriptions` + | `kind` (`plan` or `compute`) |

### Metering and the outbox

The usage row is written right after the session is created (`POST /api/labs/:id/sessions`)
with the payer decided by the gate. Ending it (`DELETE /api/sessions/:id`, or the sweep
for sessions that expired or were deleted elsewhere) computes the billed minutes and units
and, **in the same transaction**, inserts the meter event into the outbox. The outbox worker
(right after the end, and every `CT_BILLING_SWEEP_MS`) leases due rows
(`FOR UPDATE SKIP LOCKED`), sends `POST /v1/billing/meter_events` with
`identifier = ctu_<usage id>` and an idempotency key, and marks them `sent`. Stripe refuses a
second event with the same identifier ("An event already exists with identifier ...",
verified against the sandbox), which the worker treats as sent, so a crash between Stripe's
answer and our commit never bills twice. Failures back off exponentially (1, 2, 4 ... minutes,
at most 6 hours); a 4xx other than 401/403/409/429, or 12 attempts, marks the row `failed`
(dead letter): it shows as `failed` in the usage list. Requeue after fixing the cause with
`UPDATE billing_meter_outbox SET status = 'pending', next_attempt_at = now() WHERE status = 'failed'`
(Stripe accepts meter events up to 35 days old).

Card data never reaches the platform: the only payment identifiers stored are Stripe
object ids (`cus_`, `sub_`, `evt_`, `cs_`). `audit_log` gets a row for every checkout, portal
visit, subscription change and webhook.

## Entitlements

`PlanEntitlements`: lab hours per month, concurrent labs, environment tiers, exam
simulations per month, CTF events. Shown on `/account/billing` (everyone) and
`/admin/billing` (org admins, with seats and the event history). They are still recorded
and displayed only; what is enforced is the model above (premium level, trial, payment
method, dunning, spend cap).

## Products and prices

`pnpm --filter @cloudtrain/gateway stripe:sync [--dry-run] [--site content/site.yaml]`
creates or updates one Product per paid plan (found by `metadata.ct_plan_id`) and one
Price per interval (found by lookup key), plus the Billing Meter (by event name: sum of
`payload.value` per `payload.stripe_customer_id`), a Compute Product and the metered monthly
Price on that meter (`unit_amount_decimal`), idempotently. A changed amount creates a new
Price that takes over the lookup key and archives the old one, so existing subscriptions
keep their price. Needs `STRIPE_SECRET_KEY` (test) in the environment; the key is never
printed. Run it against the test account whenever `plans` change.

## Local test flow

1. `task dev:deps` (Postgres; migrations 0007 and 0009 apply), then export the test key and
   `CT_BILLING_ENABLED=1` (enforcement follows) and start the gateway. Set
   `flags.checkoutEnabled: true` in a local copy of `content/site.yaml`
   (`CT_SITE_CONFIG=...`) to open checkout and payment-method setup.
2. Webhooks on a laptop: `stripe listen --forward-to localhost:8787/api/billing/webhook`
   prints the `whsec_...` to put in `STRIPE_WEBHOOK_SECRET` (the CLI is a user-local binary,
   e.g. `~/.local/bin/stripe`). Without the CLI, the test suite's `signWebhook()`
   (`services/gateway/src/billing/stripe.ts`) signs a hand-made event; Stripe's test clocks
   and fixtures (`stripe fixtures`) drive renewals and failed payments.
3. `pnpm --filter @cloudtrain/gateway stripe:sync` (plans, the meter, the metered price).
4. As a fresh learner: the catalog shows the trial lab as free and every other lab locked;
   the trial lab starts, the fourth trial session is refused.
5. `/account/billing` → *Add a payment method* → Checkout in setup mode with
   `4242 4242 4242 4242`. The webhook saves the card and opens the compute subscription;
   standard labs unlock. Start and end a lab: the usage table shows it `sent`, and the
   meter's event summaries in the dashboard (Billing → Meters) show the units after a few
   minutes; the customer's upcoming invoice has the compute line.
6. Subscribe to Pro: hard labs unlock (multi-VM hard labs need Premium).
7. Failed payment: in the dashboard, attach `4000 0000 0000 0341` (attaches, then declines)
   as the default and advance a test clock past the renewal, or replay an
   `invoice.payment_failed` with `stripe trigger invoice.payment_failed`. The banner shows
   the grace period and Mailpit (`http://localhost:8025`) has the mail; with
   `dunning.graceDays: 0` new paid labs are refused at once. Paying the invoice restores.
8. As an org admin, `/admin/billing`: buy Team seats, assign members (they now run labs on
   the organisation's bill at the Premium level), change the seat count (Stripe prorates),
   set the org spend cap.

A scripted version of steps 4 to 8 against the sandbox (no browser: a SetupIntent confirmed
with `pm_card_visa` stands in for Checkout, events are signed locally) was run for this
version: setup session, saved default payment method, compute subscription, a 13-unit meter
event, the duplicate-identifier refusal, a 3 to 5 seat change with its prorated invoice
preview.

CI never calls Stripe: `services/gateway/test/billing.test.ts` and
`test/billing-compute.test.ts` run against a throwaway Postgres with an in-memory fake of
the Stripe endpoints the service uses (`test/fake-stripe.ts`: customers, prices, Checkout in
both modes, subscriptions with quantity updates, setup intents, meters and meter events with
injectable failures, invoice builders) and a controllable clock; `test/stripe.test.ts` covers
signatures, form encoding and the configuration guard rails. Mock mode (`apps/web`) has its own billing handlers.

## Go-live checklist

Not done in this version; all of it is required before `STRIPE_MODE=live` exists:

- Rotate the test key that was shared in chat; create restricted keys per environment;
  store them in the deployment's secret store only, never in files on shared machines.
- Decide the plan shapes (individual, organisation per seat, free trial) and final prices:
  plan fees, `compute.unitPrice`, the tier rates, trial caps, default spend caps, grace
  period and the premium rules; drop `plans.placeholder`, `placeholderPrices` and
  `compute.placeholder`; re-run `stripe:sync` against the live account once live mode is
  implemented (it creates the live meter and metered price too).
- Decide whether exam simulations and CTF event sessions are metered and gated (today only
  `POST /api/labs/:id/sessions` is).
- Monitor `billing_meter_outbox` (`status = 'failed'`, old `pending` rows) and the meter's
  error reports (`v1.billing.meter.error_report_triggered`); Stripe accepts meter events at
  most 35 days old.
- Decide how a running session that spans a month end is billed (today: in the month it
  ends) and whether long sessions report interim usage.
- Stripe Tax (automatic tax on Checkout Sessions, `automatic_tax[enabled]`), tax ids on
  customers, VAT handling for EU B2B (reverse charge) and the `taxNote`.
- Terms of service and privacy notice reviewed by counsel (`legal.terms`, `legal.privacy`
  lose `placeholder: true`); consent at checkout (`consent_collection`).
- Licensing implications of charging: Terraform under BUSL, the Cisco evaluation licence,
  trademarks in alignment badges.
- Webhook endpoint registered in the live dashboard with its own secret; retries and
  dead-letter monitoring on `billing_events.status = 'failed'`.
- Review the remaining entitlements (lab hours, concurrent labs, exam simulations, CTF
  events) that are still display-only.
- Dunning in the live account: Smart Retries and the customer emails in Billing settings
  (ours complement them), the subscription status after all retries fail (`unpaid` vs
  `canceled`).
- Customer portal configuration (allowed plan switches, cancellation reasons), invoice
  branding, receipts.
- Live-mode guard rails: `STRIPE_MODE=live` must require `NODE_ENV=production`, a live key,
  a live webhook secret and `flags.checkoutEnabled`; refuse test keys in live mode.
