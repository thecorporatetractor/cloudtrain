import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkSite, jsonLdProblems, privateText } from './site-check.mjs';

const ORIGIN = 'https://site.example';
const LD = (d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`;
const PLACEHOLDER_DESC = 'A page description that is long enough to count as a real description for a search result, with some words.';

function page({ route, title, description = `${PLACEHOLDER_DESC} ${route}`, canonical = `${ORIGIN}${route}`, body = '<h1>Heading</h1>', noindex = false, ld = '' }) {
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}" /><meta property="og:title" content="${title}" /><meta property="og:description" content="${description}" /><meta property="og:url" content="${canonical}" /><meta name="twitter:title" content="${title}" /><meta name="twitter:description" content="${description}" /><link rel="canonical" href="${canonical}" />${noindex ? '<meta name="robots" content="noindex" />' : ''}${ld}</head><body><div id="root"><main id="main">${body}</main></div></body></html>`;
}

let dir;
function site(pages, sitemap) {
  const routes = pages.map((p) => ({ path: p.route, file: p.route === '/' ? 'index.html' : `${p.route.slice(1)}/index.html`, kind: 'site', noindex: !!p.noindex }));
  routes.forEach((r, i) => {
    const f = path.join(dir, r.file);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, page(pages[i]));
  });
  writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(routes));
  const urls = sitemap ?? routes.filter((r) => !r.noindex).map((r) => `${ORIGIN}${r.path}`);
  writeFileSync(path.join(dir, 'sitemap.xml'), `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`);
}
const good = () => [
  { route: '/', title: 'A title for the home page of the site' },
  { route: '/features', title: 'A title for the features page of the site' },
];
const errors = (opts = {}) => checkSite({ dir, siteUrl: ORIGIN, ...opts }).errors;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'site-check-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('site-check', () => {
  it('passes a clean site', () => {
    site(good());
    expect(errors()).toEqual([]);
  });

  it('fails on a duplicate title', () => {
    site([{ route: '/', title: 'The very same title on both pages' }, { route: '/features', title: 'The very same title on both pages' }]);
    expect(errors().join()).toContain('same title as /');
  });

  it('fails on a canonical that is not the page itself, and on a duplicate canonical', () => {
    site([good()[0], { ...good()[1], canonical: `${ORIGIN}/` }]);
    const e = errors().join('\n');
    expect(e).toContain('canonical is https://site.example/, not itself');
    expect(e).toContain('same canonical as /');
  });

  it('fails on a missing h1, and on two', () => {
    site([good()[0], { ...good()[1], body: '<p>Nothing</p>' }]);
    expect(errors().join()).toContain('0 h1 elements');
    site([good()[0], { ...good()[1], body: '<h1>A</h1><h1>B</h1>' }]);
    expect(errors().join()).toContain('2 h1 elements');
  });

  it('fails on a heading that skips a level', () => {
    site([good()[0], { ...good()[1], body: '<h1>A</h1><h3>B</h3>' }]);
    expect(errors().join()).toContain('h1 is followed by h3');
  });

  it('fails on a sitemap URL outside the manifest, a noindex URL in it, and a page missing from it', () => {
    site(good(), [`${ORIGIN}/`, `${ORIGIN}/ghost`]);
    const e = errors().join('\n');
    expect(e).toContain('https://site.example/ghost is not in the route manifest');
    expect(e).toContain('/features is missing');
    site([good()[0], { ...good()[1], noindex: true }], [`${ORIGIN}/`, `${ORIGIN}/features`]);
    expect(errors().join()).toContain('https://site.example/features is noindex');
  });

  it('fails when robots and the manifest disagree', () => {
    site(good());
    const f = path.join(dir, 'features/index.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('</head>', '<meta name="robots" content="noindex" /></head>'));
    expect(errors().join()).toContain('robots noindex is true, the manifest says false');
  });

  it('fails on JSON-LD that does not parse, and on invented or malformed data', () => {
    site([good()[0], { ...good()[1], ld: '<script type="application/ld+json">{not json</script>' }]);
    expect(errors().join()).toContain('invalid JSON-LD');
    site([good()[0], { ...good()[1], ld: LD({ '@context': 'https://schema.org', '@type': 'Organization', name: 'X', url: `${ORIGIN}/`, logo: `${ORIGIN}/l.png`, aggregateRating: { ratingValue: 5 } }) }]);
    expect(errors().join()).toContain('has aggregateRating');
    expect(jsonLdProblems({ '@context': 'http://schema.org', '@type': 'Mystery' }, { siteUrl: ORIGIN, routes: new Map() })).toHaveLength(2);
    expect(jsonLdProblems({ '@context': 'https://schema.org', '@type': 'LearningResource', name: 'N', description: 'D', url: `${ORIGIN}/gone`, learningResourceType: 'x', provider: { name: 'P' } }, { siteUrl: ORIGIN, routes: new Map() })[0]).toContain('needs name');
  });

  it('fails when an FAQPage says what the page does not', () => {
    const faq = (a) => LD({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Is it real?', acceptedAnswer: { '@type': 'Answer', text: a } }] });
    site([{ ...good()[0], body: '<h1>H</h1><details class="site-faq-item"><summary>Is it real?</summary><p>Yes.</p></details>', ld: faq('Yes.') }, good()[1]]);
    expect(errors()).toEqual([]);
    site([{ ...good()[0], body: '<h1>H</h1><details class="site-faq-item"><summary>Is it real?</summary><p>Yes.</p></details>', ld: faq('Definitely, it is.') }, good()[1]]);
    expect(errors().join()).toContain('FAQ answer is not on the page');
  });

  it('fails when a solution, a hint, a check command or misconception feedback reaches a page', () => {
    const spec = {
      solution: { explanation: 'Drain the worker with ignore daemonsets and then cordon', steps: [{ run: 'kubectl drain yard-wk-1' }] },
      hints: [{ body: 'The setup module gathers facts so the output stays short' }],
      checks: [{ command: 'kubectl get node yard-wk-1 -o jsonpath' }],
      misconceptions: [{ feedback: 'Your report has a header line that the import treats as a host', mutation: { run: 'sed -i 1d report.txt' } }],
    };
    const leak = (text, route = '/learn/labs/x') => {
      site([good()[0], { route, title: 'A title for the lab page of the site', body: `<h1>H</h1><p>${text}</p>` }]);
      return errors({ secrets: { x: privateText(spec) } }).join('\n');
    };
    expect(leak('The lab is about nodes')).toBe('');
    expect(leak('Drain the worker with ignore daemonsets and then cordon it')).toContain('private text of lab x');
    expect(leak('hint: the setup module gathers facts so the output')).toContain('private text of lab x');
    expect(leak('your report has a header line that the import')).toContain('private text of lab x');
    expect(leak('kubectl drain yard-wk-1')).toContain('private text: "kubectl drain yard-wk-1"');
  });

  it('allows what the curriculum publishes anyway', () => {
    const spec = { hints: [{ body: 'cordon and drain it so every Pod runs healthy elsewhere' }] };
    site([good()[0], { route: '/learn/labs/x', title: 'A title for the lab page of the site', body: '<h1>H</h1><p>cordon and drain it so every Pod runs healthy elsewhere</p>' }]);
    expect(errors({ secrets: { x: privateText(spec) }, allowed: ['cordon and drain it so every Pod runs healthy elsewhere'] })).toEqual([]);
  });

  it('fails on certification marks, a SOC 2 claim, Google tags and third-party requests', () => {
    const bad = (body) => {
      site([good()[0], { ...good()[1], body: `<h1>H</h1>${body}` }]);
      return errors().join('\n');
    };
    for (const mark of ['CKA', 'CKAD', 'LFCS', 'CCNA', 'RHCSA', 'Terraform Associate']) expect(bad(`<p>Prepare for ${mark} today</p>`), mark).toContain(`certification mark ${mark}`);
    expect(bad('<p>We are SOC 2 compliant.</p>')).toContain('SOC 2 compliant');
    expect(bad('<script src="https://www.googletagmanager.com/gtag/js"></script>')).toContain('Google tag');
    expect(bad('<img src="https://cdn.example/x.png" alt="x" width="1" height="1" />')).toContain('third-party request');
    expect(bad('<a href="https://github.com/x">Source</a>')).toBe('');
  });

  it('fails on an image without alt or size, and on a link to no page', () => {
    site([good()[0], { ...good()[1], body: '<h1>H</h1><img src="/a.png" /><a href="/nowhere">x</a>' }]);
    const e = errors().join('\n');
    expect(e).toContain('image without alt');
    expect(e).toContain('image without width and height');
    expect(e).toContain('link to /nowhere');
  });

  describe('exam tasks', () => {
    const task = { id: 'xka-pool-task', oneLine: 'Save a verified snapshot of the stacked etcd to the backup path on the first control plane node' };
    const check = (body, sitemap) => {
      site([good()[0], { ...good()[1], body: `<h1>H</h1>${body}` }], sitemap);
      return errors({ examTasks: [task] }).join('\n');
    };
    it('passes a site without them', () => {
      expect(check('<p>A snapshot of etcd is a good idea, and a backup too.</p>')).toBe('');
    });
    it('fails on a task id in a link or anywhere in the markup', () => {
      expect(check('<a href="/features">x</a><span data-x="xka-pool-task"></span>')).toContain('names the exam task xka-pool-task');
    });
    it('fails on a task statement, whole or cut short', () => {
      expect(check(`<p>${task.oneLine}</p>`)).toContain('statement of the exam task xka-pool-task');
      expect(check('<p>Save a verified snapshot of the stacked etcd to the backup path…</p>')).toContain('statement of the exam task xka-pool-task');
    });
    it('does not take a lab that merely opens the same way for the task', () => {
      expect(check('<p>Save a verified snapshot of the stacked etcd on the jump host, then restore it.</p>')).toBe('');
    });
    it('fails on a task in the sitemap', () => {
      expect(check('<p>ok</p>', [`${ORIGIN}/`, `${ORIGIN}/features`, `${ORIGIN}/learn/labs/xka-pool-task`])).toContain('sitemap: names the exam task xka-pool-task');
    });
    it('fails on a task in a page\'s document', () => {
      site(good());
      mkdirSync(path.join(dir, 'data/learn/labs'), { recursive: true });
      writeFileSync(path.join(dir, 'data/learn/labs/a.json'), JSON.stringify({ related: [{ id: 'xka-pool-task' }] }));
      expect(errors({ examTasks: [task] }).join()).toContain('data/learn/labs/a.json: names the exam task xka-pool-task');
    });
  });

  it('fails on author notes in the public exam documents', () => {
    site(good());
    mkdirSync(path.join(dir, 'data/exams'), { recursive: true });
    writeFileSync(path.join(dir, 'data/exams/a.json'), JSON.stringify({ id: 'a', rules: { notes: 'Before any live run, exclude these' } }));
    writeFileSync(path.join(dir, 'data/catalog.json'), JSON.stringify({ exams: [{ id: 'b', description: 'since revision 2' }] }));
    const e = errors().join('\n');
    expect(e).toContain('data/exams/a.json: exam a carries rules.notes');
    expect(e).toContain('data/catalog.json: exam b carries a description');
  });

  it('fails when the public lab count is not the verified count', () => {
    site(good());
    mkdirSync(path.join(dir, 'data'), { recursive: true });
    writeFileSync(path.join(dir, 'data/catalog-summary.json'), JSON.stringify({ counts: { labs: 865 } }));
    expect(errors({ verifiedLabs: 850 }).join()).toContain('counts 865 labs, the curriculum has 850 verified');
    expect(errors({ verifiedLabs: 865 })).toEqual([]);
  });

  it('accepts a link to a page, a redirect or a section of a page', () => {
    site([good()[0], { ...good()[1], body: '<h1>H</h1><a href="/#waitlist">a</a><a href="/features">b</a><a href="/pricing">c</a>' }]);
    expect(errors({ redirects: ['/pricing'] })).toEqual([]);
  });
});
