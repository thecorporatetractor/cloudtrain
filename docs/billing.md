# Billing (Stripe, test mode)

Plans are data (`content/site.yaml` `plans`, see `docs/website.md`); Stripe handles money;
the gateway keeps the mapping from a Stripe customer and subscription to an organisation
(and, for individual plans, a person) plus the entitlements that follow. **This version runs
Stripe in test mode only and the whole feature sits behind a flag that is off by default.**
Entitlements are recorded and displayed, never enforced yet.

## Switches

| Variable | Default | |
|---|---|---|
| `CT_BILLING_ENABLED` | off | `1` turns billing on. Off: the billing pages show the default plan, checkout and portal answer 409, the webhook route is not registered |
| `STRIPE_MODE` | `test` | Only `test` is accepted; anything else refuses to start |
| `STRIPE_SECRET_KEY` | | A test-mode secret key (`sk_test_...`). A live key (`sk_live_`, `rk_live_`) refuses to start, on or off. Load it from the environment only (for example `set -a; . ~/.config/cloudtrain/stripe-test.env; set +a`); never commit it, print it or put it in CI, docs, screenshots or on a shared machine. The gateway logs it masked (`sk_test_…XXXX`) |
| `STRIPE_WEBHOOK_SECRET` | | The endpoint secret (`whsec_...`) from `stripe listen` or the dashboard; required when billing is on |
| `flags.checkoutEnabled` (site.yaml) | `false` | Self-service checkout. Off: the pricing page's paid calls to action lead to contact and `POST .../checkout` answers 409, while summaries and the portal keep working |

## What the gateway does

| Endpoint | Permission | |
|---|---|---|
| `GET /api/billing/me` | `progress.read.self` | `BillingSummary` for the signed-in person: plan and entitlements (default free plan without a subscription), subscription, whether the portal is available, the individual plans |
| `POST /api/billing/me/checkout` | `progress.read.self` | `CheckoutRequest` `{ planId, interval }` → `201 { url, sessionId }`: a Stripe Checkout Session in subscription mode for the plan's price (found by lookup key), with the org and user in `metadata` and `subscription_data.metadata`; the browser is sent to `url`. Audit `billing.checkout` |
| `POST /api/billing/me/portal` | `progress.read.self` | `{ url }` of a Customer Portal session; 409 before the first checkout. Audit `billing.portal` |
| `GET /api/billing/org`, `POST /api/billing/org/checkout` (`{ planId, interval, seats }`), `POST /api/billing/org/portal` | `billing.manage` | The same for the organisation and its per-seat plans |
| `GET /api/billing/org/events` | `billing.manage` | The organisation's webhook deliveries (type, status, summary) |
| `POST /api/billing/webhook` | public (Stripe signs it) | Verifies `Stripe-Signature` (HMAC-SHA256 over the raw body, 5 minute tolerance), refuses live-mode events, records the event once by Stripe event id (a replay answers `duplicate`), applies it, audits `billing.webhook` and `billing.subscription` for the org |

Handled events: `checkout.session.completed` (fetches the subscription and records it),
`customer.subscription.created|updated|deleted` (latest state, seats, period end,
cancellation; entitlements follow the plan while the status is `trialing`, `active` or
`past_due`, and fall back to the free plan otherwise), `invoice.paid` and
`invoice.payment_failed` (recorded). Everything else is recorded as `ignored`.

`billing.manage` is held by `org_admin` (every non-platform permission). Code:
`services/gateway/src/billing/` (`stripe.ts` REST client and signatures, `service.ts`,
`routes.ts`, `sync.ts`), migration `services/gateway/src/db/migrations/0007_billing.ts`.

## Data

Migration `0007_billing`, row-level security on `org_id` like every tenant table (the
webhook runs in the platform context before the org is known, then stamps the row):

| Table | Holds |
|---|---|
| `billing_customers` | one Stripe customer id per (org, user-or-org) |
| `billing_subscriptions` | the latest state of each Stripe subscription: plan, lookup key, interval, seats, status, period end, cancellation |
| `billing_entitlements` | the effective plan and its entitlements per (org, user-or-org), with its source (`subscription`, `default`, `manual`) |
| `billing_events` | every webhook delivery by Stripe event id: type, outcome, a summary of ids and amounts; append-only for the app role apart from the outcome |

Card data never reaches the platform: the only payment identifiers stored are Stripe
object ids (`cus_`, `sub_`, `evt_`, `cs_`). `audit_log` gets a row for every checkout, portal
visit, subscription change and webhook.

## Entitlements

`PlanEntitlements`: lab hours per month, concurrent labs, environment tiers, exam
simulations per month, CTF events. Shown on `/account/billing` (everyone) and
`/admin/billing` (org admins, with seats and the event history). Enforcement is a
TODO: `BillingService.assertLabStart` is called before a lab session starts and never
refuses (`services/gateway/src/billing/service.ts`, `TODO(billing-enforcement)`).

## Products and prices

`pnpm --filter @cloudtrain/gateway stripe:sync [--dry-run] [--site content/site.yaml]`
creates or updates one Product per paid plan (found by `metadata.ct_plan_id`) and one
Price per interval (found by lookup key), idempotently. A changed amount creates a new
Price that takes over the lookup key and archives the old one, so existing subscriptions
keep their price. Needs `STRIPE_SECRET_KEY` (test) in the environment; the key is never
printed. Run it against the test account whenever `plans` change.

## Local test flow

1. `task dev:deps` (Postgres; migration 0007 applies), then export the test key and
   `CT_BILLING_ENABLED=1` and start the gateway. Set `flags.checkoutEnabled: true` in a
   local copy of `content/site.yaml` (`CT_SITE_CONFIG=...`) to open checkout.
2. Webhooks on a laptop: `stripe listen --forward-to localhost:8787/api/billing/webhook`
   prints the `whsec_...` to put in `STRIPE_WEBHOOK_SECRET`. Without the CLI, the test
   suite's `signWebhook()` (`services/gateway/src/billing/stripe.ts`) signs a hand-made
   event; Stripe's test clocks and fixtures (`stripe fixtures`) drive renewals.
3. `pnpm --filter @cloudtrain/gateway stripe:sync`, then on `/account/billing` subscribe
   to Pro with a test card (`4242 4242 4242 4242`, any future date). The webhook lands,
   the plan flips to Pro, the portal link appears.
4. Cancel in the portal: `customer.subscription.updated` (cancel at period end) then
   `deleted` fall the entitlements back to the free plan.

CI never calls Stripe: `services/gateway/test/billing.test.ts` runs against a throwaway
Postgres with an in-memory fake of the Stripe endpoints the service uses
(`FakeStripe`), `test/stripe.test.ts` covers signatures, form encoding and the
configuration guard rails. Mock mode (`apps/web`) has its own billing handlers.

## Go-live checklist

Not done in this version; all of it is required before `STRIPE_MODE=live` exists:

- Rotate the test key that was shared in chat; create restricted keys per environment;
  store them in the deployment's secret store only, never in files on shared machines.
- Decide the plan shapes (individual, organisation per seat, free tier) and final prices;
  drop `plans.placeholder` and `placeholderPrices`; re-run `stripe:sync` against the live
  account once live mode is implemented.
- Stripe Tax (automatic tax on Checkout Sessions, `automatic_tax[enabled]`), tax ids on
  customers, VAT handling for EU B2B (reverse charge) and the `taxNote`.
- Terms of service and privacy notice reviewed by counsel (`legal.terms`, `legal.privacy`
  lose `placeholder: true`); consent at checkout (`consent_collection`).
- Licensing implications of charging: Terraform under BUSL, the Cisco evaluation licence,
  trademarks in alignment badges.
- Webhook endpoint registered in the live dashboard with its own secret; retries and
  dead-letter monitoring on `billing_events.status = 'failed'`.
- Enforcement of entitlements (`assertLabStart`), usage metering of lab hours, seat
  assignment for organisation plans, dunning for `past_due`.
- Customer portal configuration (allowed plan switches, cancellation reasons), invoice
  branding, receipts.
- Live-mode guard rails: `STRIPE_MODE=live` must require `NODE_ENV=production`, a live key,
  a live webhook secret and `flags.checkoutEnabled`; refuse test keys in live mode.
