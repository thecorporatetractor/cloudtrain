# Public website

The public website is part of the same React app as the platform (`apps/web`) and is
served by the same gateway. Visitors browse without signing in; the header offers
"Sign in" (back to the page afterwards) and, once signed in, "Go to dashboard". It
shares the design system and the three themes (dark, light, cream), and every word
on it comes from one configuration file.

## Routes

| Route | Page | Signed in |
|---|---|---|
| `/` | Landing page: hero, highlighted domains with live counts, how a lab works, feature blocks, screenshots, closing call to action | The learner's Home |
| `/catalog` (+ `?domain=`, `?q=`, `?difficulty=`, `?maxMinutes=`, `?path=`) | Public read-only catalog: domains, paths, courses, labs and exam simulations from `content/` | The full catalog (same search params, so links keep working) |
| `/catalog/paths/:id` | A path or course: sections, labs, alignment disclaimer, related paths | Same page, site layout, "Start lab" goes straight to the lab |
| `/catalog/exams/:id` | An exam simulation: format, rules, objectives and weights, report contents, retake policy. Never the pool task ids | Same page, "Open in the app" |
| `/pricing` | Pricing (plans arrive with the next schema version; until then the configured note and contact call to action) | Same |
| `/about`, `/faq`, `/contact` | Configured copy | Same |
| `/legal/terms`, `/legal/privacy` | Legal placeholders, marked as such until reviewed | Same |
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
web app (`apps/web/public/`); the four default screenshots in `apps/web/public/site/` are
copies that `apps/web/scripts/readme-shots.mjs` refreshes.

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
| `highlightDomains` | yes | 1 to 6 domain ids shown on the landing page, in order (`kubernetes`, `linux`, `containers`, `iac`, `automation`, `networking`) |
| `features[]` | yes | `{ icon, title, body }`; icons: `server`, `shield`, `graduation`, `flag`, `users`, `network`, `boxes`, `terminal`, `timer`, `check`, `sparkles`, `chart`, `lock`, `cloud`, `route`, `eye` |
| `howItWorks[]` | yes | 2 to 6 numbered steps `{ title, body }` |
| `screenshots[]` | | `{ image, alt, caption? }`; `image` is an absolute path under `apps/web/public` or a URL |
| `faq[]` | yes | `{ q, a, group? }`; grouped under `group` headings in order of first appearance |
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
| `pricing.headline`, `pricing.intro`, `pricing.placeholderNote`, `pricing.contactCta` | | Pricing page copy while plans are placeholders |

Internal links (`to` starting with `/`) must be website routes; `lab-verify --strict`
(`tools/lab-verify/src/site.mjs`) checks that, the highlighted domains, the images and the
alignment notice, and fails CI otherwise. Validate locally with
`node tools/lab-verify/bin/lab-verify.mjs --strict`.

## Content rules

Framework names (CKA, RHCSA, CCNA, ...) appear only as "X-aligned" badges and in the
disclaimers that `content/` already carries for paths and exams; titles never name an exam,
exam code or certifying body (`tools/lab-verify/src/curriculum.mjs`, `TITLE_DENY`). The
footer repeats `legal.alignmentNotice` on every page.

## Screenshots

`apps/web/scripts/platform-shots.mjs` captures `landing` (+ `-phone`, `-tablet`, light and
cream), `site-menu-phone`, `catalog-public` (+ `-domain`, `-phone`, light and cream),
`catalog-path-public`, `catalog-exam-public`, `pricing`, `about`, `faq`, `contact`,
`legal-terms` and `site-signed-in`; `readme-shots.mjs` adds `docs/images/landing.png`,
`catalog-public.png` and `catalog-path-public.png` and refreshes `apps/web/public/site/`.
