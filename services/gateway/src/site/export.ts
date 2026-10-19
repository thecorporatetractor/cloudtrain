import type { SiteConfig } from '@cloudtrain/api-types';
import type { Content } from '../content/load.js';
import type { ExamCatalog } from '../exams/catalog.js';
import { publicCatalog, publicExamDetail, publicPathDetail, publicPaths } from '../routes/public.js';

/*
 * The public website as static files, for hosting it without the gateway
 * (docs/deploy-website.md). These are exactly the documents `/api/public/*`
 * serves, written as JSON under `data/`:
 *
 *   data/site.json              GET /api/public/site
 *   data/catalog.json           GET /api/public/catalog
 *   data/paths/<id>.json        GET /api/public/paths/:id
 *   data/exams/<id>.json        GET /api/public/exams/:id
 *
 * The static build of apps/web (VITE_SITE_MODE=static) reads them from there. The
 * pricing page is switched off in the exported configuration: its plan buttons
 * lead into the platform (sign-in, checkout), which a static host does not have.
 * Links to /sign-in point at the platform's address when one is given and are
 * dropped otherwise, so the static site has no dead ends.
 */

export interface StaticFile {
  /** Path below the site root, e.g. `data/site.json`. */
  path: string;
  body: string;
}

export interface ExportOptions {
  /** Keep the pricing page and navigation link (default false). */
  pricing?: boolean;
  /**
   * Origin of the platform. Links to `/sign-in` become absolute links into it; without it
   * the static site has nowhere to sign in, so those links and buttons are dropped.
   */
  appUrl?: string;
}

const SIGN_IN = /^\/sign-in(?:[/?#]|$)/;

/** Rewrites or drops the links that lead into the platform (sign-in); everything else is kept. */
export function adaptSignInLinks(site: SiteConfig, appUrl?: string): SiteConfig {
  const fix = <T extends { to: string }>(l: T | undefined): T | undefined => (l && SIGN_IN.test(l.to) ? (appUrl ? { ...l, to: `${appUrl.replace(/\/+$/, '')}${l.to}` } : undefined) : l);
  const copy: SiteConfig = structuredClone(site);
  const drop = (o: object | undefined, k: string) => {
    const rec = o as Record<string, { to: string } | undefined> | undefined;
    if (!rec) return;
    const v = fix(rec[k]);
    if (v) rec[k] = v;
    else delete rec[k];
  };
  drop(copy.hero, 'primaryCta');
  drop(copy.hero, 'secondaryCta');
  drop(copy.closing, 'primaryCta');
  drop(copy.closing, 'secondaryCta');
  drop(copy.pricing, 'contactCta');
  // An audience pathway always has a call to action: one that led into the platform falls back to the contact page.
  if (copy.audiences) copy.audiences = copy.audiences.map((a) => ({ ...a, cta: fix(a.cta) ?? { label: 'Talk to us', to: '/contact' } }));
  for (const c of copy.footer.columns) c.links = c.links.map(fix).filter((l): l is NonNullable<typeof l> => !!l);
  copy.footer.columns = copy.footer.columns.filter((c) => c.links.length > 0);
  if (copy.contact.links) copy.contact.links = copy.contact.links.map(fix).filter((l): l is NonNullable<typeof l> => !!l);
  return copy;
}

export function staticSiteFiles(content: Content, site: SiteConfig, exams?: ExamCatalog, opts: ExportOptions = {}): StaticFile[] {
  const adapted = adaptSignInLinks(site, opts.appUrl);
  const config: SiteConfig = opts.pricing ? adapted : { ...adapted, flags: { ...adapted.flags, showPricing: false } };
  const json = (v: unknown) => `${JSON.stringify(v)}\n`;
  const files: StaticFile[] = [
    { path: 'data/site.json', body: json(config) },
    { path: 'data/catalog.json', body: json(publicCatalog(content, exams)) },
  ];
  for (const p of publicPaths(content)) {
    const detail = publicPathDetail(content, p.id);
    if (detail) files.push({ path: `data/paths/${p.id}.json`, body: json(detail) });
  }
  if (exams) {
    for (const id of exams.exams.keys()) {
      const detail = publicExamDetail(exams, id);
      if (detail) files.push({ path: `data/exams/${id}.json`, body: json(detail) });
    }
  }
  return files;
}
