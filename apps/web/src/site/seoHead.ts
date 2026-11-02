import { STATIC_SITE } from '@/lib/siteMode';

/*
 * The head of a page after an in-app navigation on the static website. A page's first load already has
 * the head it needs in its HTML (build-site.mjs, scripts/site-seo.mjs), so that one is left untouched:
 * what a crawler renders is what the file says. Moving to another page rewrites the same tags and drops
 * the structured data, which described the page the visitor has left.
 */
export interface PageHead {
  title: string;
  description: string;
  noindex?: boolean;
}

let loaded: string | null = typeof window === 'undefined' ? null : window.location.pathname;

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

export function applyPageHead(pathname: string, head: PageHead | undefined) {
  if (!STATIC_SITE) return;
  if (pathname === loaded) return;
  loaded = null;
  if (!head) return;
  const url = `${window.location.origin}${pathname}`;
  document.title = head.title;
  setMeta('name', 'description', head.description);
  setMeta('property', 'og:title', head.title);
  setMeta('property', 'og:description', head.description);
  setMeta('property', 'og:url', url);
  setMeta('name', 'twitter:title', head.title);
  setMeta('name', 'twitter:description', head.description);
  document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', url);
  const robots = document.head.querySelector('meta[name="robots"]');
  if (head.noindex && !robots) setMeta('name', 'robots', 'noindex');
  if (!head.noindex) robots?.remove();
  for (const block of document.head.querySelectorAll('script[type="application/ld+json"]')) block.remove();
}
