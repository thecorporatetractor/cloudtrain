import { describe, expect, it } from 'vitest';
import { breadcrumbLd, faqPageLd, jsonLdTag, newestDate, organizationLd, pageHead, parseGitDates, sitemapFiles, withoutApp } from './site-seo.mjs';

const shell = `<!doctype html><html><head>
<title>Old</title>
<meta name="description" content="old" />
<meta property="og:title" content="old" />
<meta property="og:description" content="old" />
<meta property="og:url" content="https://site.example/" />
<meta name="twitter:title" content="old" />
<link rel="canonical" href="https://site.example/" />
<script defer src="/runtime-config.js"></script>
<script defer src="/site-boot.js?v=index-A"></script>
<link rel="preload" href="/data/site.json" as="fetch" crossorigin />
</head><body></body></html>`;

describe('the head of a page', () => {
  it('is the page\'s own, and only one of each', () => {
    const out = pageHead(shell, { path: '/features', title: 'A & "B"', description: 'Desc', siteUrl: 'https://site.example' });
    expect(out).toContain('<title>A &amp; &quot;B&quot;</title>');
    expect(out).toContain('<meta name="description" content="Desc" />');
    expect(out).toContain('<meta property="og:url" content="https://site.example/features" />');
    expect(out).toContain('<meta name="twitter:description" content="Desc" />');
    expect(out.match(/rel="canonical"/g)).toHaveLength(1);
    expect(out).toContain('<link rel="canonical" href="https://site.example/features" />');
    expect(out).not.toContain('robots');
  });

  it('says noindex when asked, and carries preloads and data blocks', () => {
    const out = pageHead(shell, { path: '/x', title: 'T', description: 'D', noindex: true, siteUrl: 'https://site.example', jsonLd: [{ '@type': 'Thing', name: '</script><script>alert(1)</script>' }], preload: ['/data/x.json'] });
    expect(out).toContain('<meta name="robots" content="noindex" />');
    expect(out).toContain('<link rel="preload" href="/data/x.json" as="fetch" crossorigin />');
    expect(out).not.toContain('</script><script>alert');
    const tag = jsonLdTag({ a: '</script>' });
    expect(JSON.parse(tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('<')))).toEqual({ a: '</script>' });
  });

  it('names no URL when the origin is not known', () => {
    const out = pageHead(shell.replace(/\s*<link rel="canonical"[^>]*>/, '').replace(/\s*<meta property="og:url"[^>]*>/, ''), { path: '/x', title: 'T', description: 'D', siteUrl: '', jsonLd: [{ a: 1 }] });
    expect(out).not.toMatch(/canonical|og:url|ld\+json/);
    expect(out).toContain('<title>T</title>');
  });

  it('the 404 page runs no app and claims no URL', () => {
    const out = withoutApp(`${pageHead(shell, { path: '/404', title: 'T', description: 'D', noindex: true, siteUrl: 'https://site.example' })}<button class="site-icon-btn">x</button><a href="/">Home</a>`);
    expect(out).not.toMatch(/site-boot|runtime-config|data\/site\.json|canonical|og:url|site-icon-btn/);
    expect(out).toContain('<a href="/">Home</a>');
  });
});

describe('structured data', () => {
  it('the Organization has the name, URL, logo and email, and no postal or legal detail', () => {
    const d = organizationLd('https://site.example', { name: 'CloudTrain', email: 'hello@site.example' });
    expect(Object.keys(d).sort()).toEqual(['@context', '@type', 'email', 'logo', 'name', 'url']);
  });
  it('FAQPage and BreadcrumbList are well formed', () => {
    expect(faqPageLd([{ q: 'Q', a: 'A' }]).mainEntity[0]).toEqual({ '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } });
    expect(breadcrumbLd('https://site.example', [{ label: 'Home', to: '/' }, { label: 'Here' }]).itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://site.example/' },
      { '@type': 'ListItem', position: 2, name: 'Here' },
    ]);
  });
});

describe('the sitemap', () => {
  const routes = [
    { path: '/', kind: 'site', lastmod: '2026-10-01' },
    { path: '/learn/labs/a', kind: 'lab', lastmod: '2026-09-01' },
    { path: '/learn/labs/b&c', kind: 'lab', lastmod: '2026-10-05' },
    { path: '/learn/labs/thin', kind: 'lab', noindex: true, lastmod: '2026-10-09' },
    { path: '/legal/privacy-request', kind: 'site', noindex: true },
    { path: '/undated', kind: 'site' },
  ];
  it('is an index over pages and labs, without noindex routes', () => {
    const files = Object.fromEntries(sitemapFiles('https://site.example', routes));
    expect(Object.keys(files)).toEqual(['sitemap.xml', 'sitemap-pages.xml', 'sitemap-labs.xml']);
    expect(files['sitemap.xml']).toContain('<sitemap><loc>https://site.example/sitemap-labs.xml</loc><lastmod>2026-10-05</lastmod></sitemap>');
    expect(files['sitemap-labs.xml']).toContain('<url><loc>https://site.example/learn/labs/a</loc><lastmod>2026-09-01</lastmod></url>');
    expect(files['sitemap-labs.xml']).toContain('b&amp;c');
    expect(files['sitemap-labs.xml']).not.toContain('thin');
    expect(files['sitemap-pages.xml']).not.toContain('privacy-request');
    expect(files['sitemap-pages.xml']).toContain('<url><loc>https://site.example/undated</loc></url>');
  });
  it('dates come from the newest commit of a route\'s source, a file or a directory', () => {
    const dates = parseGitDates('\x002026-10-05\n\ncontent/site.yaml\ncontent/packs/k/labs/a/lab.yaml\n\x002026-09-01\n\ncontent/site.yaml\ncontent/packs/k/labs/a/assets/x\ncontent/packs/k/labs/ab/lab.yaml\n');
    expect(dates.get('content/site.yaml')).toBe('2026-10-05');
    expect(newestDate(dates, ['content/packs/k/labs/a'])).toBe('2026-10-05');
    expect(newestDate(dates, ['content/packs/k/labs/ab'])).toBe('2026-09-01');
    expect(newestDate(dates, ['content/nope'])).toBeUndefined();
  });
});
