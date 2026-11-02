// The build's check of the finished static site (build-site.mjs runs it; `node scripts/site-check.mjs
// <dir> --site-url <origin>` runs it alone). Fails on what search engines punish and on what must
// never be published: duplicate titles or canonicals, a canonical that is not the page's own, a
// missing h1, a sitemap URL outside the route manifest, invalid structured data, private lab text on a
// page, certification marks, third-party requests. Reads files only; scripts/site-check.test.mjs
// proves each rule fails.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Certification marks that must not appear on a page of the coming-soon site (and never on /learn). */
export const CERT_MARKS = /\b(CKA|CKAD|CKS|KCNA|KCSA|LFCS|LFCE|LPIC-?\d?|RHCSA|RHCE|CCNA|CCNP|Linux\+|Network\+|Security\+|Terraform Associate|Docker Certified|DCA|JNCIA|EX\d{3}|SC-200)(?![\w-])/;
const FORBIDDEN = [
  [/SOC 2 compliant/i, 'says "SOC 2 compliant"'],
  [/googletagmanager|google-analytics|gtag\(|google-site-verification/i, 'carries a Google tag'],
];

const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", apos: "'", nbsp: ' ' })[e]);
const text = (html) => decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html, attr, key) => {
  for (const m of html.matchAll(/<meta\s+(name|property)="([^"]+)"\s+content="([^"]*)"/g)) if (m[1] === attr && m[2] === key) return decode(m[3]);
  return undefined;
};
export const headOf = (html) => html.slice(0, html.indexOf('</head>') + 7);
export const mainOf = (html) => {
  const m = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/);
  return m ? m[1] : '';
};
/** The text of markup as its separate runs, so a run of words never spans two elements. */
const runs = (html) => decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '\n').replace(/<[^>]+>/g, '\n')).split('\n').map((r) => r.replace(/\s+/g, ' ').trim()).filter(Boolean);
const tokens = (s) => s.toLowerCase().match(/[a-z0-9][a-z0-9./_-]*/g) ?? [];
const SHINGLE = 6;
/**
 * How much of an exam task's statement has to match: a cut description still does, while two labs that
 * merely open alike do not ("Write a Bake file whose default group builds the ..." is eight words of two labs).
 */
const TASK_PREFIX = 12;
const taskIds = (s) => s.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
function* shingles(s) {
  const t = tokens(s);
  for (let i = 0; i + SHINGLE <= t.length; i += 1) yield t.slice(i, i + SHINGLE).join(' ');
}

function allStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) allStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) allStrings(x, out);
  return out;
}

/** The private text of a lab: nothing here may reach a page. */
export function privateText(spec) {
  return allStrings([spec?.solution, spec?.checks, spec?.hints, spec?.misconceptions, spec?.setup, spec?.teardown, spec?.exam]);
}

/** Structured data problems of one block (an empty list when it is valid), for the types the site uses. */
export function jsonLdProblems(d, { siteUrl, routes }) {
  const bad = [];
  if (d['@context'] !== 'https://schema.org') bad.push('@context is not https://schema.org');
  const absOwn = (u) => typeof u === 'string' && u.startsWith(`${siteUrl}/`);
  const known = (u) => absOwn(u) && (routes.has(u.slice(siteUrl.length)) || u === `${siteUrl}/`);
  for (const invented of ['aggregateRating', 'review', 'offers', 'address', 'legalName']) if (invented in d) bad.push(`has ${invented}`);
  switch (d['@type']) {
    case 'Organization':
      if (!d.name || !absOwn(d.url) || !absOwn(d.logo)) bad.push('Organization needs name, url and logo');
      break;
    case 'WebSite':
      if (!d.name || !absOwn(d.url)) bad.push('WebSite needs name and url');
      break;
    case 'FAQPage':
      if (!Array.isArray(d.mainEntity) || d.mainEntity.length === 0) bad.push('FAQPage without questions');
      else for (const q of d.mainEntity) if (q['@type'] !== 'Question' || !q.name || q.acceptedAnswer?.['@type'] !== 'Answer' || !q.acceptedAnswer.text) bad.push('FAQPage entry is not a Question with an Answer');
      break;
    case 'BreadcrumbList': {
      const items = d.itemListElement;
      if (!Array.isArray(items) || items.length < 2) bad.push('BreadcrumbList needs two items or more');
      else
        items.forEach((it, i) => {
          if (it['@type'] !== 'ListItem' || it.position !== i + 1 || !it.name) bad.push(`breadcrumb ${i + 1} is malformed`);
          if (i < items.length - 1 && !known(it.item)) bad.push(`breadcrumb ${i + 1} points at ${it.item}`);
        });
      break;
    }
    case 'LearningResource':
      if (!d.name || !d.description || !known(d.url) || !d.learningResourceType || !d.provider?.name) bad.push('LearningResource needs name, description, its own url, type and provider');
      if (d.timeRequired && !/^PT\d+M$/.test(d.timeRequired)) bad.push(`timeRequired ${d.timeRequired} is not ISO 8601`);
      if (d.isPartOf && !known(d.isPartOf.url)) bad.push(`isPartOf points at ${d.isPartOf.url}`);
      break;
    default:
      bad.push(`unknown @type ${d['@type']}`);
  }
  return bad;
}

const listFiles = (dir, base = dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
};

/**
 * @param dir       the built site
 * @param siteUrl   its origin
 * @param secrets   private strings per lab id ({ id: string[] }), or undefined to skip the leak check
 * @param allowed   public text that may overlap with them (curriculum titles and descriptions, skill names)
 * @param redirects paths the host redirects, which pages may link to
 * @param examTasks labs of the exam pools ({ id, oneLine }): neither may be on a page, in a page's document or in the sitemap
 * @param verifiedLabs the number of verified labs, which data/catalog-summary.json must state
 * @param strictMarks  fail on certification marks on every page, not only under /learn
 */
export function checkSite({ dir, siteUrl, secrets, allowed = [], redirects = [], strictMarks = true, limits = {}, examTasks = [], verifiedLabs }) {
  const errors = [];
  const fail = (where, what) => errors.push(`${where}: ${what}`);
  const { titleMax = 75, titleMin = 20, descMax = 170, descMin = 90 } = limits;
  const stats = { titleLengths: [], descLengths: [], pages: 0, noindex: 0, words: 0 };

  const manifest = JSON.parse(readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  const routes = new Map(manifest.map((r) => [r.path, r]));
  const titles = new Map();
  const canonicals = new Map();
  const files = new Set(listFiles(dir).map((f) => `/${f}`));
  const linkable = (href) => {
    const p = href.split(/[?#]/)[0];
    return p === '' || routes.has(p) || redirects.includes(p) || files.has(p) || p === '/';
  };

  const pageTexts = new Map();
  const taskIdSet = new Set(examTasks.map((t) => t.id));
  const taskHeads = new Map();
  for (const t of examTasks) {
    const head = tokens(t.oneLine ?? '').slice(0, TASK_PREFIX).join(' ');
    if (head) taskHeads.set(head, t.id);
  }
  const taskLengths = [...new Set([...taskHeads.keys()].map((h) => h.split(' ').length))];
  const findTasks = (where, content, strings) => {
    for (const id of taskIds(content)) if (taskIdSet.has(id)) fail(where, `names the exam task ${id}`);
    for (const str of strings) {
      const t = tokens(str);
      for (const n of taskLengths) {
        for (let i = 0; i + n <= t.length; i += 1) {
          const id = taskHeads.get(t.slice(i, i + n).join(' '));
          if (id) fail(where, `has the statement of the exam task ${id}`);
        }
      }
    }
  };
  for (const r of manifest) {
    const where = r.path;
    const file = path.join(dir, r.file);
    if (!existsSync(file)) {
      fail(where, `no file ${r.file}`);
      continue;
    }
    const html = readFileSync(file, 'utf8');
    const head = headOf(html);
    const main = mainOf(html);
    stats.pages += 1;

    const title = head.match(/<title>([^<]*)<\/title>/)?.[1];
    const description = meta(head, 'name', 'description');
    const canonical = head.match(/<link rel="canonical" href="([^"]*)"/g) ?? [];
    const noindex = /<meta name="robots" content="noindex"/.test(head);
    const want = `${siteUrl}${r.path}`;

    if (!title) fail(where, 'no title');
    else {
      if (titles.has(title)) fail(where, `same title as ${titles.get(title)}: "${title}"`);
      titles.set(title, where);
      if (!r.noindex && (decode(title).length > titleMax || decode(title).length < titleMin)) fail(where, `title of ${decode(title).length} characters: "${title}"`);
      stats.titleLengths.push(decode(title).length);
    }
    if (!description) fail(where, 'no description');
    else {
      if (!r.noindex && (description.length > descMax || description.length < descMin)) fail(where, `description of ${description.length} characters: "${description}"`);
      stats.descLengths.push(description.length);
    }
    if (canonical.length !== 1) fail(where, `${canonical.length} canonical links`);
    else {
      const href = canonical[0].match(/href="([^"]*)"/)[1];
      if (href !== want) fail(where, `canonical is ${href}, not itself`);
      if (canonicals.has(href)) fail(where, `same canonical as ${canonicals.get(href)}`);
      canonicals.set(href, where);
    }
    for (const [attr, key] of [['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['name', 'twitter:title'], ['name', 'twitter:description']]) {
      if (!meta(head, attr, key)) fail(where, `no ${key}`);
    }
    if (meta(head, 'property', 'og:url') !== want) fail(where, `og:url is ${meta(head, 'property', 'og:url')}`);
    if (noindex !== !!r.noindex) fail(where, `robots noindex is ${noindex}, the manifest says ${!!r.noindex}`);
    if (noindex) stats.noindex += 1;

    const h1s = main.match(/<h1\b/g)?.length ?? 0;
    if (h1s !== 1 || (html.match(/<h1\b/g)?.length ?? 0) !== 1) fail(where, `${html.match(/<h1\b/g)?.length ?? 0} h1 elements`);
    // Heading levels never skip one going down, over the page and its footer.
    let last = 0;
    for (const m of html.slice(html.indexOf('<body')).matchAll(/<h([1-6])\b/g)) {
      const n = Number(m[1]);
      if (last && n > last + 1) fail(where, `heading h${last} is followed by h${n}`);
      last = n;
    }

    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      if (!/\balt="/.test(tag)) fail(where, `image without alt: ${tag.slice(0, 80)}`);
      if (!/\bwidth="/.test(tag) || !/\bheight="/.test(tag)) fail(where, `image without width and height: ${tag.slice(0, 80)}`);
    }

    // No request may leave the site. Links to other sites are fine, they are not requests.
    for (const m of html.matchAll(/<(script|img|iframe|source|video|audio)\b[^>]*\b(?:src|srcset)="(https?:)?\/\/[^"]*"/g)) fail(where, `third-party request: ${m[0].slice(0, 100)}`);
    for (const m of html.matchAll(/<link\b[^>]*\bhref="(https?:)?\/\/[^"]*"[^>]*>/g)) {
      if (!/rel="canonical"/.test(m[0]) && !m[0].includes(siteUrl)) fail(where, `third-party request: ${m[0].slice(0, 100)}`);
    }
    for (const [re, why] of FORBIDDEN) if (re.test(html)) fail(where, why);
    if (strictMarks || r.path.startsWith('/learn')) {
      const seen = text(html).match(CERT_MARKS);
      if (seen) fail(where, `names the certification mark ${seen[0]}`);
    }

    for (const m of main.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/g)) {
      if (!linkable(m[1])) fail(where, `link to ${m[1]}, which is not a page`);
    }

    const blocks = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((b) => b[1]);
    const ldText = [];
    for (const b of blocks) {
      let d;
      try {
        d = JSON.parse(b);
      } catch (e) {
        fail(where, `invalid JSON-LD: ${e.message}`);
        continue;
      }
      ldText.push(...allStrings(d));
      for (const p of jsonLdProblems(d, { siteUrl, routes })) fail(where, `JSON-LD: ${p}`);
      if (d['@type'] === 'FAQPage') {
        const visible = text(main);
        for (const q of d.mainEntity ?? []) {
          if (!visible.includes(q.name.replace(/\s+/g, ' ').trim())) fail(where, `FAQ question is not on the page: "${q.name}"`);
          if (!visible.includes((q.acceptedAnswer?.text ?? '').replace(/\s+/g, ' ').trim())) fail(where, `FAQ answer is not on the page: "${q.name}"`);
        }
      }
      if (d['@type'] === 'BreadcrumbList' && r.path.startsWith('/learn')) {
        const crumbs = main.match(/<nav\b[^>]*aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
        for (const it of d.itemListElement ?? []) if (!text(crumbs).includes(it.name) && it.name !== 'Home') fail(where, `breadcrumb "${it.name}" is not on the page`);
      }
    }
    stats.words += tokens(text(main)).length;
    pageTexts.set(r.path, [...runs(main), ...ldText]);
    if (examTasks.length) findTasks(where, html, [...runs(html), ...ldText, title ?? '', description ?? '']);
  }

  /* -------------------------------------------------------------- sitemap */
  const sitemapDir = dir;
  if (existsSync(path.join(sitemapDir, 'sitemap.xml'))) {
    const xml = readFileSync(path.join(sitemapDir, 'sitemap.xml'), 'utf8');
    const parts = [...xml.matchAll(/<sitemap><loc>([^<]*)<\/loc>/g)].map((m) => m[1].slice(siteUrl.length + 1));
    const urls = [];
    for (const f of parts.length ? parts : ['sitemap.xml']) {
      if (!existsSync(path.join(sitemapDir, f))) {
        fail('sitemap', `${f} is missing`);
        continue;
      }
      for (const m of readFileSync(path.join(sitemapDir, f), 'utf8').matchAll(/<url><loc>([^<]*)<\/loc>/g)) {
        urls.push(m[1]);
        if (examTasks.length) findTasks('sitemap', m[1], []);
      }
    }
    const inMap = new Set();
    for (const u of urls) {
      const p = u.startsWith(siteUrl) ? u.slice(siteUrl.length) : u;
      const r = routes.get(p);
      if (!r) fail('sitemap', `${u} is not in the route manifest`);
      else if (r.noindex) fail('sitemap', `${u} is noindex`);
      if (inMap.has(p)) fail('sitemap', `${u} is listed twice`);
      inMap.add(p);
    }
    for (const r of manifest) if (!r.noindex && !inMap.has(r.path)) fail('sitemap', `${r.path} is missing`);
  } else if (siteUrl) fail('sitemap', 'no sitemap.xml');

  /* --------------------------------------------- public documents */
  const learnDir = path.join(dir, 'data', 'learn');
  if (examTasks.length && existsSync(learnDir)) {
    for (const f of listFiles(learnDir)) {
      const raw = readFileSync(path.join(learnDir, f), 'utf8');
      findTasks(`data/learn/${f}`, raw, allStrings(JSON.parse(raw)));
    }
  }
  // Author notes on exams (content/curriculum.yaml exams[].rules.notes, exams[].description) are for the
  // people who build them: services/gateway/src/routes/public.ts leaves them out of what is public.
  const examDocs = [];
  if (existsSync(path.join(dir, 'data', 'catalog.json'))) examDocs.push(...(JSON.parse(readFileSync(path.join(dir, 'data', 'catalog.json'), 'utf8')).exams ?? []).map((e) => ['data/catalog.json', e]));
  if (existsSync(path.join(dir, 'data', 'exams'))) for (const f of listFiles(path.join(dir, 'data', 'exams'))) examDocs.push([`data/exams/${f}`, JSON.parse(readFileSync(path.join(dir, 'data', 'exams', f), 'utf8'))]);
  for (const [where, e] of examDocs) {
    if (e.rules?.notes !== undefined) fail(where, `exam ${e.id} carries rules.notes`);
    if (e.description !== undefined) fail(where, `exam ${e.id} carries a description`);
  }
  if (verifiedLabs !== undefined) {
    const summary = JSON.parse(readFileSync(path.join(dir, 'data', 'catalog-summary.json'), 'utf8'));
    if (summary.counts?.labs !== verifiedLabs) fail('data/catalog-summary.json', `counts ${summary.counts?.labs} labs, the curriculum has ${verifiedLabs} verified`);
  }

  /* ---------------------------------------------------- nothing private leaks */
  if (secrets) {
    // Every run of six words on a page or in a page's document, except those the public text has anyway.
    const seen = new Map();
    const docText = new Map();
    if (existsSync(path.join(dir, 'data', 'learn'))) {
      for (const f of listFiles(path.join(dir, 'data', 'learn'))) {
        docText.set(`data/learn/${f}`, allStrings(JSON.parse(readFileSync(path.join(dir, 'data', 'learn', f), 'utf8'))));
      }
    }
    for (const [where, list] of [...pageTexts, ...docText]) for (const t of list) for (const s of shingles(t)) if (!seen.has(s)) seen.set(s, where);
    for (const a of allowed) for (const s of shingles(a)) seen.delete(s);
    const hit = new Set();
    for (const [lab, strings] of Object.entries(secrets)) {
      for (const str of strings) {
        for (const s of shingles(str)) {
          const where = seen.get(s);
          if (where && !hit.has(s)) {
            hit.add(s);
            fail(where, `private text of lab ${lab}: "${s}"`);
          }
        }
        // Short commands are too short for the runs above: a whole line of a lab's own text on its own page.
        const own = pageTexts.get(`/learn/labs/${lab}`)?.join('\n');
        if (own) {
          for (const line of str.split('\n')) {
            const l = line.trim();
            if (l.length >= 16 && /\s/.test(l) && own.includes(l) && !allowed.some((a) => a.includes(l))) fail(`/learn/labs/${lab}`, `private text: "${l}"`);
          }
        }
      }
    }
  }
  return { errors, stats };
}

export const range = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? `${s[0]} to ${s.at(-1)}, median ${s[Math.floor(s.length / 2)]}` : 'none';
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = path.resolve(process.argv[2] ?? 'dist-site');
  const i = process.argv.indexOf('--site-url');
  const { errors, stats } = checkSite({ dir, siteUrl: i > 0 ? process.argv[i + 1] : 'https://cloudtrain.app' });
  for (const e of errors.slice(0, 200)) console.error(e);
  console.log(`${stats.pages} pages, ${stats.noindex} noindex, ${errors.length} problems`);
  process.exit(errors.length ? 1 : 0);
}
