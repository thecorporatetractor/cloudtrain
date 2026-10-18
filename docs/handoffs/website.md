# Handoff: public website and paid path (branch `feat/site-*`)

The public website lives in the same React app as the platform (`apps/web`), is served by
the same gateway and is configured from `content/site.yaml`. It is the first step toward paid
plans: plans and pricing come next, then Stripe in test mode behind a flag.

## Status (2026-10-18)

- **PR 1, website (merged):** routes `/` (landing for visitors, Home when signed in),
  `/catalog` (public read-only catalog or the full one), `/catalog/paths/:id`,
  `/catalog/exams/:id`, `/pricing` (placeholder until PR 2), `/about`, `/faq`, `/contact`,
  `/legal/terms`, `/legal/privacy`. Shared header with theme switcher and "Sign in" /
  "Go to dashboard"; "Start lab" in the public catalog goes through sign-in with `returnTo`.
  Gateway `GET /api/public/{site,catalog,paths/:id,exams/:id}`: content only, `ETag`,
  `Cache-Control: public`, per-address rate limit (`CT_PUBLIC_RATE_PER_MINUTE`).
  `content/site.yaml` validated against `packages/lab-schema/schema/site.schema.json`
  (gateway refuses to start on an invalid file; `lab-verify --strict` checks it in CI).
  Deployments mount their own file: `CT_SITE_CONFIG`. Reference: `docs/website.md`.
- **PR 2, plans and pricing:** `plans` in the Site schema (free, individual monthly/yearly,
  organisation per seat; entitlements: lab hours per month, concurrent labs, environment
  tiers, exam simulations, CTF events), the pricing page, `flags.showPricing: true`.
- **PR 3, Stripe test mode:** `CT_BILLING_ENABLED` (default off), Checkout Sessions,
  Customer Portal, webhook with signature verification and idempotent handling, Postgres
  tables with RLS for customers, subscriptions, entitlements and billing events, account
  and org billing pages, `stripe:sync` for Products and Prices by lookup key.

## How to resume

- Worktree `.worktrees/site-web` (branch `feat/site-web`); later PRs on `feat/site-plans`,
  `feat/site-billing`.
- Mock mode shows the website at `pnpm --filter web dev` with the persona switched off
  (`localStorage ct.mock.session = 'none'`, or the sign-out item); real mode needs the
  gateway, which now loads `content/site.yaml` at startup.
- Screenshots: `apps/web/scripts/platform-shots.mjs` (website views listed in
  `apps/web/docs/screenshots/README.md`) and `readme-shots.mjs` (`docs/images/landing.png`,
  `catalog-public.png`, `catalog-path-public.png`; refreshes `apps/web/public/site/`).

## Open questions (user)

- Individual vs organisation per-seat plans, and whether there is a free tier (PR 2 ships
  all three shapes with placeholder prices).
- Licensing implications of charging: Terraform BUSL, the Cisco evaluation licence,
  trademarks in alignment badges.
- Contact details in `content/site.yaml` are `*.example` placeholders.
- Terms and privacy are placeholders pending legal review.
