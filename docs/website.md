# Public website

The public website is part of the same React app as the platform (`apps/web`) and is
served by the same gateway. Visitors browse without signing in; the header offers
"Sign in" (back to the page afterwards) and, once signed in, "Go to dashboard". It
shares the design system and the three themes (dark, light, cream), and every word
on it comes from one configuration file.

## Routes

| Route | Page | Signed in |
|---|---|---|
| `/` | Landing page: hero with a real product preview and the live catalog figures, the six domains with counts, how a lab works (`#how-it-works`), the three differentiators and the secondary capabilities, the product showcase, who the platform is for (`#teams`), featured questions, closing call to action | The learner's Home |
| `/catalog` (+ `?domain=`, `?q=`, `?difficulty=`, `?maxMinutes=`, `?path=`) | Public read-only catalog: domains, paths, courses, labs and exam simulations from `content/` | The full catalog (same search params, so links keep working) |
| `/catalog/paths/:id` | A path or course: sections, labs, alignment disclaimer, related paths | Same page, site layout, "Start lab" goes straight to the lab |
| `/catalog/exams/:id` | An exam simulation: format, rules, objectives and weights, report contents, retake policy. Never the pool task ids | Same page, "Open in the app" |
| `/pricing` | Pricing: the configured plans as cards with a monthly/yearly switch, an entitlement comparison, the placeholder note, the plan FAQ group and the alignment notice | Same; plan calls to action go to the billing pages |
| `/about`, `/faq`, `/contact` | Configured copy | Same |
| `/legal/terms`, `/legal/privacy` | Legal placeholders, marked as such until reviewed. The privacy notice describes the waitlist processing | Same |
| `/sign-in` | Identity-first sign-in (unchanged) | Redirects to `returnTo` |

"Start lab" in the public catalog links to `/sign-in?returnTo=/labs/<id>`; after the
OIDC round trip the gateway sends the browser back to that lab.

Implementation: `apps/web/src/site/` (layout, theme hook, helpers), `apps/web/src/routes/site/`
(pages), `apps/web/src/app/auth.tsx` (`SITE_PATHS`, `HYBRID_PATHS`: `/` and `/catalog` render
the website for visitors and the app for signed-in users), `apps/web/src/styles/site.css`.

## Gateway endpoints

All public (no session), served from `content/` and the site configuration only, never
from the database. Nothing org- or user-specific can leak: no completion, progress,
visibility, pins, attempts, retake state or exam pool ids.

| Endpoint | Returns |
|---|---|
| `GET /api/public/site` | `SiteConfig` (the validated configuration file) |
| `GET /api/public/catalog` | `PublicCatalog`: domains with counts, paths and courses, labs, exam simulations, frameworks, skill names |
| `GET /api/public/paths/:id` | `PublicPathDetail`: sections (courses of a pack path), labs in order, related paths |
| `GET /api/public/exams/:id` | `PublicExamDetail`: objectives with weights and pool sizes, rules, report contents |
| `POST /api/public/waitlist` | Early-access signup (see "Early-access waitlist"); the one public route that writes |

Responses carry `ETag` (304 on `If-None-Match`) and `Cache-Control: public, max-age=300,
stale-while-revalidate=600`, and are rate-limited per client address (`CT_PUBLIC_RATE_PER_MINUTE`,
default 120 per minute; 429 with `Retry-After` beyond). Types: `packages/api-types/public.d.ts`.
Code: `services/gateway/src/routes/public.ts`, tests `services/gateway/test/public.test.ts`.

In mock mode (`pnpm --filter web dev`) MSW serves the same endpoints from the real
`content/site.yaml` (bundled as text) and the mock lab world (`apps/web/src/mocks/public.ts`).

## Configuration file

Default: `content/site.yaml`. Schema: `packages/lab-schema/schema/site.schema.json`
(`cloudtrain.dev/v1 Site`, draft 2020-12), generated type `Site` in `@cloudtrain/lab-schema`,
API type `SiteConfig` in `@cloudtrain/api-types`.

A deployment replaces the file without a code change: mount its own (for example from a
ConfigMap) and point the gateway at it with `CT_SITE_CONFIG=/etc/cloudtrain/site.yaml`.
The gateway validates the file at startup and refuses to start when it is invalid, listing
the schema issues. Logos, favicons and screenshots are URLs or absolute paths served by the
web app (`apps/web/public/`); the default screenshots in `apps/web/public/site/` are real
mock-mode captures (dark and light, WebP) that `apps/web/scripts/site-shots.mjs` refreshes.

### Reference

| Key | Required | Meaning |
|---|---|---|
| `apiVersion`, `kind` | yes | `cloudtrain.dev/v1`, `Site` |
| `brand.name` | yes | Product name in the header, titles, footer and the app's navigation |
| `brand.legalName` | | Copyright line; defaults to `brand.name` |
| `brand.tagline` | yes | Footer, sign-in page, closing call to action |
| `brand.logo`, `brand.logoDark` | | Logo image URL/path (replaces the built-in mark); the dark variant defaults to `logo` |
| `brand.favicon` | | Favicon URL/path (replaces the built-in one at runtime) |
| `hero.eyebrow`, `hero.title`, `hero.subtitle` | title, subtitle | Landing page hero |
| `hero.primaryCta`, `hero.secondaryCta` | | `{ label, to }`; `to: /sign-in` becomes "Go to dashboard" for signed-in visitors |
| `hero.note` | | Small print under the buttons |
| `hero.preview` | | `{ image, imageLight?, alt, width?, height? }`: the product screenshot beside the headline (`imageLight` serves the light and cream themes; the size reserves the space) |
| `hero.proof` | | Up to 4 short attributes shown after the live figures (labs, domains, exam simulations from the catalog API) |
| `highlightDomains` | yes | 1 to 6 domain ids shown on the landing page, in order (`kubernetes`, `linux`, `containers`, `iac`, `automation`, `networking`) |
| `features[]` | yes | Secondary capabilities `{ icon, title, body }`, listed after the differentiators; icons: `server`, `shield`, `graduation`, `flag`, `users`, `network`, `boxes`, `terminal`, `timer`, `check`, `sparkles`, `chart`, `lock`, `cloud`, `route`, `eye`, `user`, `building`, `target`, `layers` |
| `howItWorks[]` | yes | 2 to 6 numbered steps `{ title, body, icon? }` |
| `differentiators[]` | | 2 to 4 blocks `{ icon?, title, body, figure? }`; `figure` is a screenshot like `hero.preview` |
| `showcase[]` | | 1 to 6 product views `{ title, body, why?, figure }` |
| `audiences[]` | | 1 to 4 pathways `{ icon?, title, body, points?[], cta }` |
| `faq[]` | yes | `{ q, a, group?, featured? }`; grouped under `group` headings in order of first appearance; the first six `featured` questions also appear on the landing page |
| `about.title`, `about.paragraphs[]`, `about.facts[]` | title, paragraphs | About page; facts are `{ label, value }` pairs in a side card |
| `contact.*` | `email` | `title`, `intro`, `email`, `salesEmail`, `phone`, `address[]`, `hours`, `links[]` |
| `footer.columns[]` | yes | `{ title, links: [{ label, to, external? }] }`; links to pages a flag turned off are hidden |
| `footer.note` | | Text under the columns (licence notice) |
| `legal.alignmentNotice` | yes | Shown in the footer and on pricing; must say the platform is not affiliated with the certifying bodies (lab-verify checks) |
| `legal.terms`, `legal.privacy` | yes | `{ title, updated, placeholder, sections: [{ title, paragraphs[] }] }`; `placeholder: true` shows a draft banner |
| `theme.default` | | Theme for first-time visitors (`dark`, `light`, `cream`); a stored choice wins |
| `theme.tokens.{all,dark,light,cream}` | | CSS custom property overrides, e.g. `{ --accent: "#6d8bd9" }` (tokens in `apps/web/src/styles/tokens.css`) |
| `flags.showPricing` | yes | Pricing page and navigation link |
| `flags.showCatalog` | yes | Public catalog (off: visitors are asked to sign in) |
| `flags.signupEnabled` | yes | Self-service sign-up (off: calls to action lead to sign-in or contact) |
| `flags.showContactForm` | | Contact form (needs a backend; off shows the details only) |
| `flags.checkoutEnabled` | | Self-service checkout for paid plans (needs the gateway's billing integration); off turns `checkout` calls to action into contact |
| `pricing.headline`, `pricing.intro`, `pricing.placeholderNote`, `pricing.contactCta`, `pricing.faqGroup` | | Pricing page copy; `placeholderNote` is shown while any price is a placeholder; `faqGroup` names the FAQ group listed under the plans |
| `plans` | | See below |
| `closing.title`, `closing.body`, `closing.primaryCta`, `closing.secondaryCta` | | The closing call to action on the landing page; the buttons default to the hero's |
| `waitlist.enabled` | when `waitlist` is present | Shows the waitlist section on the landing page (`#waitlist`) and lets the gateway accept submissions; off removes both |
| `waitlist.eyebrow`, `title`, `body`, `note`, `submitLabel`, `emailLabel` | | Section copy and button/field labels (defaults in `apps/web/src/site/Waitlist.tsx`) |
| `waitlist.consentLabel`, `privacyLinkLabel` | | Consent checkbox: the text before the link, and the link text; the link always opens `/legal/privacy` in a new tab |
| `waitlist.successTitle`, `successBody`, `duplicateTitle`, `duplicateBody`, `errorMessage` | | The two outcome states and the failure message |
| `waitlist.fields.{organisation,role,interest}` | | `{ enabled?, required?, label? }` each (default: shown, optional). `role.options[]` turns the role into a select whose choices the gateway enforces; `organisation.placeholder`, `role.placeholder`; `interest.enterpriseLabel`, `interest.individualLabel` (the stored values are always `enterprise` and `individual`) |

### Plans

Plans are data: the pricing page, the billing pages and the Stripe sync read them from
here. Three shapes are supported, and the default file ships one of each with
placeholder prices: `free`, `pro` (individual, monthly or yearly) and `team`
(organisation, per seat).

| Key | Required | Meaning |
|---|---|---|
| `plans.currency` | yes | ISO 4217 code; every `amount` is in its minor unit (cents) |
| `plans.placeholder` | | Every price is a placeholder, not an offer (the page shows `pricing.placeholderNote`) |
| `plans.taxNote`, `plans.billingNote` | | Small print under the cards |
| `plans.items[].id`, `name`, `kind`, `description` | yes | `kind`: `free` (no price), `individual` (one person), `organisation` (per seat) |
| `plans.items[].badge`, `highlight` | | Card label; at most one highlighted plan |
| `plans.items[].prices.monthly`, `.yearly` | paid plans | `{ amount, lookupKey }`; the lookup key names the Stripe Price (`stripe:sync` creates or updates it) and must be unique |
| `plans.items[].perSeat`, `minSeats`, `maxSeats` | | Organisation plans: price per seat and the allowed seat range |
| `plans.items[].placeholderPrices` | | This plan's prices are placeholders |
| `plans.items[].entitlements` | yes | `labHoursPerMonth` (integer or `unlimited`), `concurrentLabs`, `envTiers` (subset of `A B C K V N`), `examSimulationsPerMonth` (integer or `unlimited`), `ctfEvents` (boolean). Recorded and shown; not enforced yet |
| `plans.items[].includes[]` | yes | Marketing bullets |
| `plans.items[].cta` | yes | `{ label, action, to? }`; `signin` (sign in, or "Go to dashboard"), `checkout` (subscribe; contact while `flags.checkoutEnabled` is off), `contact` (`to`, default `/contact`) |

`lab-verify` checks unique plan ids and lookup keys, that free plans have no price and paid
plans have one, that per-seat pricing stays on organisation plans, and that placeholder
prices come with `pricing.placeholderNote`.

Internal links (`to` starting with `/`) must be website routes; `lab-verify --strict`
(`tools/lab-verify/src/site.mjs`) checks that, the highlighted domains, every screenshot
(`hero.preview`, `differentiators[].figure`, `showcase[].figure`) and the alignment notice,
and fails CI otherwise. Validate locally with
`node tools/lab-verify/bin/lab-verify.mjs --strict`.

## Early-access waitlist

A section on the landing page (between "who it is for" and the questions, anchored `#waitlist`,
linked from the footer) with a short form: email, optional organisation, role and interest
(`enterprise` or `individual`), and a consent checkbox that links to the privacy notice. The
privacy text is `legal.privacy` in `content/site.yaml`, which carries a waitlist section;
`lab-verify` fails when the waitlist is on and the notice does not mention it. Copy, the optional
fields, their labels and the role choices are all `waitlist.*` in the same file; `enabled: false`
removes the section and the gateway answers 404.

The form posts JSON to `POST /api/public/waitlist` (on `apiBase` of `runtime-config.js`, so a
separately hosted site can point at the gateway), without cookies. The page shows field errors
next to their controls (focus moves to the first), a status message for success and one for an
address that is already on the list, a failure message, and a rate-limit message.

| Concern | How |
|---|---|
| Validation | `services/gateway/src/waitlist/validate.ts`, driven by the `waitlist` configuration (hand written like the rest of the gateway; no schema library). Email format and length, optional fields trimmed and length-limited, role must be one of `role.options` when set, `interest` is `enterprise` or `individual`, `consent` must be `true`. Body limit 8 KiB. 422 `invalid` with `details.fields` |
| Spam | Per client address (`CT_TRUST_PROXY` decides what that is): `CT_WAITLIST_RATE_PER_HOUR` (default 10) in memory, every attempt counts, 429 with `Retry-After`. A hidden `website` field (honeypot): when filled the answer looks like a success and nothing is stored. No CAPTCHA and no third-party service |
| Storage | Table `waitlist_entries` (migration `0008_waitlist`): email as typed, optional organisation, role and interest, `consent_at`, `created_at`. Unique on `lower(email)`; a second submission, in any case, answers `duplicate` and changes nothing. The client address is not stored. Row-level security: the app role may INSERT anywhere, read and delete only in the platform context |
| Admin | `GET /api/platform/waitlist` (JSON) and `GET /api/platform/waitlist.csv` for platform admins (`org.manage`). Nothing is emailed; exporting the list is the only way it leaves the database |

Tests: `services/gateway/test/waitlist.test.ts` (validation, duplicates, honeypot, rate limit,
admin access, CSV, static export), `waitlist-pg.test.ts` (unique index, RLS, export through real
principals), `apps/web/src/lib/waitlist.test.ts` and `apps/web/src/site/Waitlist.test.tsx` (field
rules, the request, the rendered markup for each state).

## Static deployment

The public site can be built as plain static files (`pnpm --filter web build:site`) and hosted
anywhere, with only the waitlist form calling the gateway. See [deploy-website.md](deploy-website.md).

## Content rules

Framework names (CKA, RHCSA, CCNA, ...) appear only as "X-aligned" badges and in the
disclaimers that `content/` already carries for paths and exams; titles never name an exam,
exam code or certifying body (`tools/lab-verify/src/curriculum.mjs`, `TITLE_DENY`). The
footer repeats `legal.alignmentNotice` on every page.

## Screenshots

`apps/web/scripts/platform-shots.mjs` captures `landing` (+ `-phone`, `-tablet`, light and
cream), `site-menu-phone`, `catalog-public` (+ `-domain`, `-phone`, light and cream),
`catalog-path-public`, `catalog-exam-public`, `pricing` (+ `-yearly`, `-phone`, light and
cream), `waitlist` (+ `-filled`, `-errors`, `-success`, `-duplicate`, `-phone`, light and cream),
`about`, `faq`, `contact`, `legal-terms`, `legal-privacy` and `site-signed-in`; `readme-shots.mjs`
adds `docs/images/landing.png`, `catalog-public.png`, `catalog-path-public.png` and
`pricing.png`. `apps/web/scripts/site-shots.mjs` captures the screenshots the website itself
shows (`apps/web/public/site/*.webp`: the workspace after a validation run, the topology and
checks crops, skills, an exam report and the team dashboard, each in dark and light) and
prints their sizes for `width`/`height`.
