/*
 * Static website mode (`pnpm --filter web build:site`, docs/deploy-website.md).
 *
 * The public marketing site can be built as plain static files for any static
 * host. In that build the site configuration and the catalog are not fetched
 * from the gateway but read from JSON files exported next to the bundle
 * (`/data/*.json`, from the same content/ the gateway serves), nobody is signed
 * in, and the only call to the API is the waitlist form, which posts to the API
 * origin set in runtime-config.js (`apiBase`). The rest of the app (labs, exams,
 * admin) is not part of this bundle; `/sign-in` and every app path hand over to the
 * app origin (`appUrl` in runtime-config.js, else VITE_APP_URL; src/lib/surface.ts)
 * when the platform has its own address, and `/sign-in` explains itself otherwise.
 */
export const STATIC_SITE = import.meta.env.VITE_SITE_MODE === 'static';

/** Where a static-site JSON document lives (`data/site.json`), relative to the site root. */
export const staticDataUrl = (file: string): string => `/data/${file}`;
