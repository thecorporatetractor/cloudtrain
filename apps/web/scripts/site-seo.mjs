// Pure helpers of build-site.mjs for search engines: structured data, the head of one page, the route
// manifest's sitemap files and lastmod dates from git. Checked by scripts/site-seo.test.mjs.
import { execFileSync } from 'node:child_process';

const SCHEMA = 'https://schema.org';

export function organizationLd(siteUrl, { name, email }) {
  return { '@context': SCHEMA, '@type': 'Organization', name, url: `${siteUrl}/`, logo: `${siteUrl}/brand/icon-512.png`, ...(email ? { email } : {}) };
}

export function websiteLd(siteUrl, { name, description }) {
  return { '@context': SCHEMA, '@type': 'WebSite', name, url: `${siteUrl}/`, ...(description ? { description } : {}), publisher: { '@type': 'Organization', name, url: `${siteUrl}/` } };
}

/** FAQPage from the questions the page itself shows, read from its rendered markup. */
export function faqPageLd(items) {
  return { '@context': SCHEMA, '@type': 'FAQPage', mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
}

/** A crumb without `to` is the page itself: the last entry, named but without an item URL (as Google allows). */
export function breadcrumbLd(siteUrl, crumbs) {
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.to ? { item: `${siteUrl}${c.to}` } : {}) })),
  };
}

/**
 * A lab, a learning path or an exam simulation. LearningResource rather than Course: Google's Course
 * rich results require offers and a course instance, which would mean inventing a price and dates.
 */
export function learningResourceLd(siteUrl, { path, name, description, type, level, minutes, teaches, partOf, about, audience }) {
  return {
    '@context': SCHEMA,
    '@type': 'LearningResource',
    name,
    description,
    url: `${siteUrl}${path}`,
    inLanguage: 'en',
    learningResourceType: type,
    ...(level ? { educationalLevel: level } : {}),
    ...(minutes ? { timeRequired: `PT${minutes}M` } : {}),
    ...(teaches?.length ? { teaches } : {}),
    ...(about ? { about } : {}),
    ...(audience ? { audience: { '@type': 'Audience', audienceType: audience } } : {}),
    ...(partOf ? { isPartOf: { '@type': 'LearningResource', name: partOf.name, url: `${siteUrl}${partOf.to}` } } : {}),
    provider: { '@type': 'Organization', name: 'CloudTrain', url: `${siteUrl}/` },
  };
}

const attrEsc = (s) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
/** Serialised for a script data block: `<` is escaped so no value can close the element. */
export const jsonLdTag = (value) => `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;

/**
 * The head of one route, from the rewritten head of the shell: title, description, canonical, Open
 * Graph and Twitter URLs and text, robots, structured data and preloads. Only values differ between
 * two pages, so the tags are found by name and replaced; a tag that is missing is added.
 */
export function pageHead(html, { path, title, description, noindex, siteUrl, jsonLd = [], preload = [] }) {
  let out = html;
  const META = /<meta\s+(name|property)="([^"]+)"\s+content="[^"]*"\s*\/?>/g;
  const setMeta = (attr, key, value) => {
    const tag = `<meta ${attr}="${key}" content="${attrEsc(value)}" />`;
    let found = false;
    out = out.replace(META, (whole, a, k) => (a === attr && k === key ? ((found = true), tag) : whole));
    if (!found) out = out.replace('</head>', () => `  ${tag}\n  </head>`);
  };
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${attrEsc(title)}</title>`);
  setMeta('name', 'description', description);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  // Without the site's origin there is no absolute URL to name: no canonical, og:url or structured data.
  if (siteUrl) setMeta('property', 'og:url', `${siteUrl}${path}`);
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  out = out.replace(/\s*<link rel="canonical"[^>]*>/, '');
  const add = siteUrl ? [`<link rel="canonical" href="${attrEsc(`${siteUrl}${path}`)}" />`] : [];
  if (noindex) add.push('<meta name="robots" content="noindex" />');
  for (const p of preload) add.push(`<link rel="preload" href="${attrEsc(p)}" as="fetch" crossorigin />`);
  if (siteUrl) for (const d of jsonLd) add.push(jsonLdTag(d));
  return out.replace('</head>', () => `${add.map((a) => `  ${a}\n`).join('')}  </head>`);
}

/** What stays of a page without its app: the 404 page runs no script but the theme's, so it works whatever the path. */
export function withoutApp(html) {
  const end = html.indexOf('</head>');
  // Each of these sits on a line of its own in the head (rewriteHead, pageHead, deferEntry).
  const head = html
    .slice(0, end)
    .split('\n')
    .filter((line) => !/site-boot\.js|runtime-config\.js|as="fetch"|as="font"|rel="canonical"|property="og:url"/.test(line))
    .join('\n');
  return head + html.slice(end).replace(/<button[^>]*site-icon-btn[\s\S]*?<\/button>/g, '');
}

const xmlEsc = (s) => s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[c]);
const urlset = (siteUrl, routes) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((r) => `  <url><loc>${xmlEsc(siteUrl + r.path)}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;

/** The sitemap files of a manifest: an index, the labs apart from the rest (so a search console reports on them apart). noindex routes are left out. */
export function sitemapFiles(siteUrl, routes) {
  const indexed = routes.filter((r) => !r.noindex);
  const parts = [
    ['sitemap-pages.xml', indexed.filter((r) => r.kind !== 'lab')],
    ['sitemap-labs.xml', indexed.filter((r) => r.kind === 'lab')],
  ].filter(([, list]) => list.length > 0);
  const newest = (list) => list.map((r) => r.lastmod).filter(Boolean).sort().at(-1);
  const index = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts.map(([f, list]) => `  <sitemap><loc>${xmlEsc(`${siteUrl}/${f}`)}</loc>${newest(list) ? `<lastmod>${newest(list)}</lastmod>` : ''}</sitemap>`).join('\n')}\n</sitemapindex>\n`;
  return [['sitemap.xml', index], ...parts.map(([f, list]) => [f, urlset(siteUrl, list)])];
}

/** Parses `git log --format=%x00%cs --name-only`: the newest date of each file (the log runs newest first). */
export function parseGitDates(log) {
  const dates = new Map();
  let date = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('\0')) date = line.slice(1).trim();
    else if (line && date && !dates.has(line)) dates.set(line, date);
  }
  return dates;
}

/** The newest commit date under `sources` (files or directories), or undefined. */
export function newestDate(dates, sources) {
  let best;
  for (const s of sources) {
    const exact = dates.get(s);
    if (exact && (!best || exact > best)) best = exact;
    if (exact) continue;
    const prefix = s.endsWith('/') ? s : `${s}/`;
    for (const [file, date] of dates) if (file.startsWith(prefix) && (!best || date > best)) best = date;
  }
  return best;
}

/** Newest commit date per file under content/. Empty without git or in a shallow clone, where the dates would be wrong: no lastmod then. */
export function gitDates(repo) {
  try {
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (git('rev-parse', '--is-shallow-repository').trim() === 'true') return new Map();
    return parseGitDates(git('log', '--format=%x00%cs', '--name-only', '--', 'content/'));
  } catch {
    return new Map();
  }
}
