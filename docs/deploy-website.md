# Deploying the public website

How to host CloudTrain's public marketing site (landing page, catalog, about, FAQ,
contact, legal pages and the early-access waitlist) separately from the platform, or
with it.

**Status: undecided.** Which host serves the site and under which domain is the
owner's decision, and it is still pending. Nothing in this repository creates an
account, buys or points a domain, or turns on a hosting service (GitHub Pages is not
enabled). This page describes what is ready, so the decision can be made and carried
out in an afternoon.

## What is ready

`pnpm --filter web build:site` produces the whole site as static files in
`apps/web/dist-site/`:

```sh
pnpm install --frozen-lockfile --filter web...
pnpm --filter web build:site -- --api-base https://api.cloudtrain.example
```

| Option (or env) | Meaning |
|---|---|
| `--out <dir>` | Output directory (default `dist-site`, relative to where you run it) |
| `--api-base <origin>` (`CT_API_BASE`) | The gateway the waitlist form posts to, e.g. `https://api.cloudtrain.example`. Empty: the site's own origin, for a host that proxies `/api` to the gateway |
| `--app-url <origin>` (`CT_APP_URL`) | Where the platform lives. Set: "Sign in" and `/sign-in` hand over to `<origin>/sign-in`. Empty: no sign-in button, and `/sign-in` explains that the platform is not open to the public |
| `--pricing` | Keep the pricing page. Off by default: its plan buttons lead into the platform, which a static host does not have |

What the build does:

1. Exports the public data from `content/` with the gateway's own code
   (`pnpm --filter @cloudtrain/gateway site:export`): `data/site.json`, `data/catalog.json`,
   `data/paths/<id>.json` and `data/exams/<id>.json`, byte for byte what `/api/public/*`
   serves. No database, cluster or secret is involved. `CT_SITE_CONFIG` and
   `CT_CONTENT_DIR` work as for the gateway, so a deployment's own `site.yaml` can be built
   in.
2. Runs `vite build` in static website mode (`VITE_SITE_MODE=static`, real API mode so no
   mock service worker). In this mode the site reads the JSON above instead of the API,
   nobody is signed in, and the only API call is `POST /api/public/waitlist`.
3. Adds `runtime-config.js` (the API origin; edit it on the host to repoint the form
   without a rebuild) and the host files: `404.html` (the app, for GitHub Pages),
   `_redirects` and `_headers` (Cloudflare Pages, Netlify), `staticwebapp.config.json`
   (Azure Static Web Apps), `.nojekyll` and `robots.txt`. The CSP allows scripts from the
   site only and `connect-src` to the API origin only.

Preview it locally with `pnpm --filter web exec vite preview --outDir dist-site`.
Content changes (copy, screenshots, catalog) need a rebuild: the data is a snapshot.

The bundle uses root-relative URLs, so it must be served from the root of a host name
(`https://www.example.com/`), not from a sub-path such as `https://org.github.io/repo/`.

## The waitlist backend

The form needs a running gateway with Postgres behind it (migration `0008_waitlist`),
reachable at the `--api-base` origin. A static host cannot store anything, and no
third-party form service is used. On the gateway:

- list the site's origin in `CT_CORS_ORIGINS` (e.g. `https://www.cloudtrain.example`), so the
  browser's preflight and POST are allowed; the endpoint itself needs no cookie and no CSRF
  token. Skip this when the host proxies `/api` to the gateway on the same origin;
- `CT_WAITLIST_RATE_PER_HOUR` (default 10 per client address) and `CT_TRUST_PROXY` (so the
  address is the visitor's, not the proxy's) apply;
- a platform admin exports the list with `GET /api/platform/waitlist.csv`.

If you host the site without any gateway, set `waitlist.enabled: false` in the site
configuration before building: the section disappears and nothing posts to a missing API.

## Options

| | GitHub Pages | Cloudflare Pages | Azure Static Web Apps | The platform itself |
|---|---|---|---|---|
| What serves the site | GitHub's static hosting | Cloudflare's edge | Azure's static hosting | The `web` image (nginx) from the Helm chart, behind the same Ingress as the gateway |
| Account needed | The GitHub org, which exists | A Cloudflare account | An Azure subscription | None beyond the cluster |
| Custom domain and TLS | Yes (a `CNAME` file or the repository setting), automatic certificate | Yes, automatic certificate | Yes, automatic certificate | Ingress host and cert-manager, as for the platform |
| Response headers (CSP) | Not configurable: no `_headers`, the CSP in the bundle's files is not applied | `_headers` is applied | `staticwebapp.config.json` is applied | nginx config, already in the image |
| Unknown paths | `404.html` is served with a 404 status (works, but crawlers see 404s) | `_redirects` rewrites with 200 | `navigationFallback` rewrites with 200 | `try_files` fallback, 200 |
| Waitlist API | Cross-origin to the gateway (CORS) | Cross-origin (CORS) | Cross-origin (CORS) | Same origin, no CORS |
| Cost | Free for public repositories | Free tier | Free tier | The cluster you already run |
| Fit | Quickest to try, weakest headers | Good default for a marketing site | Fits if the rest is on Azure | No second host to run, but the marketing site goes down with the platform |

### GitHub Pages

Serve `apps/web/dist-site/` from the root of a Pages site on a custom domain. The usual
route is a workflow that builds with `--api-base` and uploads the directory with the Pages
actions; enabling Pages in the repository settings is the step this repository does not
take. Limits: root URLs only (a custom domain solves this), no custom headers, and the
single-page fallback answers unknown paths with status 404.

### Cloudflare Pages

Either direct upload of `dist-site/` (`wrangler pages deploy`), or a Git-connected project
with the build command `pnpm install --frozen-lockfile && pnpm --filter web build:site` (set
`CT_API_BASE` and optionally `CT_APP_URL` as build variables) and the output directory
`apps/web/dist-site`. `_headers` and `_redirects` are picked up as they are.

### Azure Static Web Apps

Deploy `apps/web/dist-site/` as a prebuilt app (`skip_app_build: true`,
`app_location: apps/web/dist-site`) from a workflow, or by the Static Web Apps CLI.
`staticwebapp.config.json` carries the fallback, the CSP and the asset caching.

### The platform itself

No static bundle is needed: the `web` image already serves these pages, and the landing
page and the waitlist work from the same origin as the gateway. The cost is that the
marketing site and the platform share one deployment, one release cadence and one
failure domain. This is the default today, and the right choice until the owner picks a
separate host.

## Decisions for the owner

1. The host: one of the three above, or keep the site on the platform.
2. The domain, and who controls its DNS. Not bought, not configured.
3. The API origin for the waitlist (a gateway host name reachable from the public
   internet) and whether `CT_CORS_ORIGINS` may include the site's origin.
4. Whether "Sign in" on the marketing site leads to the platform (`--app-url`) or the
   platform stays closed for now.
5. Whether the pricing page is shown (`--pricing`); its prices are placeholders.

Once these are answered, the remaining work is a workflow file for the chosen host and
the DNS records.
