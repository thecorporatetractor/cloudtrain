import { describe, expect, it } from 'vitest';
import { buildLearn, catalogSummary, examTasks, fitDescription, fitTitle, THIN_WORDS } from './learn-pages.mjs';

const long = 'Bring the depot worker back into service after the kubelet stopped, restart the agent and leave every workload scheduled where it was before the outage happened.';
const curriculum = {
  domains: [
    { id: 'kubernetes', title: 'Kubernetes', summary: 'S', competencies: [{ id: 'k8s.cli', title: 'kubectl' }, { id: 'k8s.ops', title: 'Operations' }] },
    { id: 'secops', title: 'Security operations', summary: 'S', competencies: [] },
  ],
  labs: [
    { id: 'alpha', domain: 'kubernetes', title: 'Scale one Deployment among several', oneLine: long, difficulty: 'easy', minutes: 5, status: 'verified', frameworks: ['cka:workloads'], notes: 'INTERNAL NOTE' },
    { id: 'beta', domain: 'kubernetes', title: 'Fix the node', oneLine: long, difficulty: 'hard', minutes: 15, status: 'verified' },
    { id: 'thin', domain: 'kubernetes', title: 'Fix it', oneLine: 'Fix the given unit.', difficulty: 'easy', minutes: 5, status: 'verified' },
    { id: 'draft', domain: 'kubernetes', title: 'Proposed lab', oneLine: long, difficulty: 'easy', minutes: 5, status: 'proposed' },
    { id: 'built', domain: 'kubernetes', title: 'Built lab', oneLine: long, difficulty: 'easy', minutes: 5, status: 'built' },
    { id: 'soc', domain: 'secops', title: 'Query', oneLine: long, difficulty: 'easy', minutes: 5, status: 'proposed' },
    { id: 'xka-pool-task', type: 'exam', domain: 'kubernetes', title: 'A pool task', oneLine: 'The statement of a task in the exam pool that must stay private to the simulation.', difficulty: 'easy', minutes: 5, status: 'verified' },
    { id: 'unlisted', domain: 'kubernetes', title: 'Not in the catalog', oneLine: long, difficulty: 'easy', minutes: 5, status: 'verified' },
  ],
  paths: [
    { id: 'p1', domain: 'kubernetes', title: 'Kubernetes foundations', audience: 'Engineers new to Kubernetes', level: 'beginner', prerequisites: [], frameworks: ['cka'], disclaimer: 'CKA is a trademark.', modules: [{ id: 'm1', title: 'First', labs: ['alpha', 'beta', 'thin', 'draft', 'built', 'xka-pool-task'] }, { id: 'm2', title: 'Empty', labs: ['draft'] }] },
    { id: 'p2', domain: 'kubernetes', title: 'Short path', level: 'beginner', prerequisites: ['p1'], modules: [{ id: 'm3', title: 'One', labs: ['alpha'] }] },
    { id: 'p3', domain: 'kubernetes', title: 'No published labs', modules: [{ id: 'm4', title: 'None', labs: ['draft'] }] },
    { id: 'p4', domain: 'secops', title: 'Proposed path', status: 'proposed', modules: [{ id: 'm5', title: 'None', labs: ['soc'] }] },
  ],
};
const skillIds = ['k8s.cli.contexts', 'k8s.ops.drain'];
const catalog = {
  labs: [{ id: 'alpha', skillIds, frameworks: ['cka:workloads'] }, { id: 'beta', skillIds }, { id: 'thin', skillIds: ['k8s.cli.contexts'] }, { id: 'draft', skillIds }, { id: 'built', skillIds }, { id: 'xka-pool-task', skillIds }],
  skillNames: { 'k8s.cli.contexts': 'Inspect and switch contexts', 'k8s.ops.drain': 'Cordon and drain nodes for maintenance' },
};
const exam = {
  id: 'sim-a',
  title: 'Kubernetes administrator practical exam simulation',
  domain: 'kubernetes',
  alignsTo: ['cka'],
  disclaimer: 'CKA is a trademark of its owner.',
  passMarkNote: 'The real exam publishes a pass mark.',
  durationMinutes: 120,
  passMark: 66,
  taskCount: 17,
  availability: 'available',
  rules: { anyOrder: true, flagForReview: true, rebootBeforeGrade: false, notes: 'INTERNAL RULE NOTE', docsAllowed: 'man pages' },
  retakePolicy: { freshDraw: true, notes: 'INTERNAL RETAKE NOTE' },
  objectives: [{ id: 'cka:storage', name: 'Storage', weight: 100, tasks: 2, poolSize: 4 }],
  reportIncludes: [],
};
const soon = { ...exam, id: 'sim-b', title: 'Analyst simulation', domain: 'secops', availability: 'coming-soon', description: 'The real exam is multiple choice.' };
const cfg = { title: 'T', description: 'D', h1: 'H', lead: 'L' };
const seo = {
  pages: { '/learn/labs': { ...cfg, title: 'Labs index' }, '/learn/paths': { ...cfg, title: 'Paths index' }, '/learn/exams': { ...cfg, title: 'Exams index' } },
  domains: { kubernetes: { name: 'Kubernetes', title: 'Kubernetes hub', description: 'D', h1: 'Kubernetes labs', lead: 'L' } },
};
const build = () => buildLearn({ curriculum, catalog, exams: new Map([[exam.id, exam], [soon.id, soon]]), seo, siteUrl: 'https://site.example' });
const page = (b, path) => b.pages.find((p) => p.path === path);

describe('the /learn pages', () => {
  it('publishes verified labs in the public catalog only', () => {
    const b = build();
    const labs = b.pages.filter((p) => p.kind === 'lab').map((p) => p.path);
    expect(labs).toEqual(['/learn/labs/alpha', '/learn/labs/beta', '/learn/labs/thin']);
    expect(b.report.excludedLabs).toEqual({ proposed: 2, built: 1, other: 0, examTasks: 1 });
    const docs = JSON.stringify(b.pages.map((p) => p.doc));
    expect(docs).not.toContain('draft');
    expect(docs).not.toContain('Proposed lab');
    expect(docs).not.toContain('Built lab');
  });

  it('publishes nothing of an exam task: no page, link, count or statement', () => {
    const b = build();
    const all = JSON.stringify(b.pages);
    expect(all).not.toContain('xka-pool-task');
    expect(all).not.toContain('A pool task');
    expect(all).not.toContain('statement of a task');
    expect(page(b, '/learn/kubernetes').doc.domain.labCount).toBe(3);
    expect(page(b, '/learn/labs').doc.labsIndex.domains[0].labs).toBe(3);
    expect(page(b, '/learn/paths/p1').doc.learningPath.labs).toBe(3);
    expect(examTasks(curriculum).map((l) => l.id)).toEqual(['xka-pool-task']);
  });

  it('counts for the home page are the verified labs, exam tasks included, from the curriculum', () => {
    const cat = { ...catalog, domains: [{ id: 'kubernetes', name: 'Kubernetes', labCount: 99, pathCount: 2, examCount: 1 }], paths: [{}], exams: [{}, {}] };
    expect(catalogSummary(cat, curriculum)).toEqual({ domains: [{ id: 'kubernetes', name: 'Kubernetes', labCount: 4, pathCount: 2, examCount: 1 }], counts: { labs: 4, paths: 1, exams: 2 } });
  });

  it('carries no framework, alignment, disclaimer or internal note on any page', () => {
    const all = JSON.stringify(build().pages);
    for (const leak of ['cka', 'CKA', 'INTERNAL', 'trademark', 'passMarkNote', 'real exam', 'frameworks', 'alignsTo', 'poolSize']) expect(all, leak).not.toContain(leak);
  });

  it('sets a thin lab or path to noindex and reports it', () => {
    const b = build();
    expect(page(b, '/learn/labs/thin').noindex).toBe(true);
    expect(page(b, '/learn/labs/alpha').noindex).toBe(false);
    expect(b.report.thinLabs).toEqual(['thin']);
    expect(page(b, '/learn/paths/p2').noindex).toBe(true);
    expect(page(b, '/learn/paths/p1').noindex).toBe(false);
    expect(THIN_WORDS).toBeGreaterThan(0);
  });

  it('drops paths and domains without a published lab, and modules without one', () => {
    const b = build();
    expect(b.report.skippedPaths).toEqual(['p3', 'p4']);
    expect(page(b, '/learn/paths/p3')).toBeUndefined();
    expect(page(b, '/learn/secops')).toBeUndefined();
    expect(b.report.skippedDomains).toEqual(['secops']);
    expect(page(b, '/learn/paths/p1').doc.learningPath.modules.map((m) => m.id)).toEqual(['m1']);
    expect(page(b, '/learn/paths/p1').doc.learningPath.modules[0].labs.map((l) => l.id)).toEqual(['alpha', 'beta', 'thin']);
  });

  it('links both ways: lab to path and domain, path and domain to lab, related labs', () => {
    const b = build();
    const lab = page(b, '/learn/labs/alpha').doc.lab;
    expect(lab.paths.map((p) => p.to)).toEqual(['/learn/paths/p1', '/learn/paths/p2']);
    expect(lab.domain.to).toBe('/learn/kubernetes');
    expect(lab.related[0].id).toBe('beta');
    expect(lab.related.at(-1).id).toBe('thin');
    const hub = page(b, '/learn/kubernetes').doc.domain;
    expect(hub.groups.flatMap((g) => g.labs.map((l) => l.to))).toContain('/learn/labs/alpha');
    expect(hub.paths.map((p) => p.to)).toEqual(['/learn/paths/p1', '/learn/paths/p2']);
    expect(hub.exams.map((e) => e.to)).toEqual(['/learn/exams/sim-a']);
  });

  it('counts a path\'s time from its published labs, and does not use an exam\'s description', () => {
    const b = build();
    expect(page(b, '/learn/paths/p1').doc.learningPath.time).toBe('25 minutes');
    expect(JSON.stringify(page(b, '/learn/exams/sim-b'))).not.toContain('real exam');
    expect(page(b, '/learn/exams/sim-b').noindex).toBe(true);
    expect(page(b, '/learn/exams/sim-a').noindex).toBe(false);
  });

  it('writes valid structured data with no invented fact', () => {
    const b = build();
    const [resource, crumbs] = page(b, '/learn/labs/alpha').jsonLd;
    expect(resource['@type']).toBe('LearningResource');
    expect(resource.url).toBe('https://site.example/learn/labs/alpha');
    expect(resource.timeRequired).toBe('PT5M');
    expect(resource.isPartOf.url).toBe('https://site.example/learn/paths/p1');
    expect(crumbs.itemListElement.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(crumbs.itemListElement.at(-1).item).toBeUndefined();
    const all = JSON.stringify(b.pages.map((p) => p.jsonLd));
    for (const invented of ['aggregateRating', 'review', 'offers', 'price', 'datePublished']) expect(all).not.toContain(invented);
  });

  it('gives every page a unique title, and a description near the target', () => {
    const b = build();
    const titles = b.pages.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(page(b, '/learn/labs/alpha').title).toBe('Scale one Deployment among several | Kubernetes lab');
    expect(page(b, '/learn/labs/alpha').description.length).toBeLessThanOrEqual(155);
  });
});

describe('fitting titles and descriptions', () => {
  it('takes the first title of the right length', () => {
    expect(fitTitle(['x'.repeat(70), 'y'.repeat(55), 'z'.repeat(52)])).toBe('y'.repeat(55));
    expect(fitTitle(['x'.repeat(70), 'y'.repeat(30), 'z'.repeat(40)])).toBe('z'.repeat(40));
    expect(fitTitle(['x'.repeat(70), 'y'.repeat(65)])).toBe('y'.repeat(65));
  });

  it('adds the tail that lands a description in range, and cuts a long one at a word', () => {
    const short = 'a'.repeat(100);
    expect(fitDescription(short, ['b'.repeat(200), 'c'.repeat(45)])).toBe(`${short} ${'c'.repeat(45)}`);
    const cut = fitDescription(`${'word '.repeat(50)}end`);
    expect(cut.length).toBeLessThanOrEqual(155);
    expect(cut.endsWith('word…')).toBe(true);
    expect(fitDescription('e'.repeat(150))).toBe('e'.repeat(150));
  });
});
