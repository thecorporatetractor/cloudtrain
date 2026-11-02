// The public /learn pages of the static website (build-site.mjs): a labs index, a hub per domain, a
// page per learning path, per exam simulation and per published lab, from content/curriculum.yaml and
// the already public /data documents. Pure, so scripts/learn-pages.test.mjs can check it.
//
// A published lab has status `verified` and is not `type: exam`: exam tasks are the pools the
// simulations draw from, and a task statement that has been crawled cannot be taken back. They get no
// page, no link and no count here, and site-check.mjs fails the build if one appears.
//
// What may reach a page is decided here, field by field, and nothing else does: a lab's title,
// description (oneLine), domain, difficulty, duration and skill names, a path's title, audience, level
// and modules, an exam's title, format, duration, task count, pass mark and objective names. Lab
// specs (solutions, checks, hints, mutations, misconceptions) are not even an input. Exam alignment,
// frameworks and disclaimers are left out because they name certification marks.

import { breadcrumbLd, learningResourceLd } from './site-seo.mjs';

/** A lab whose title, description and skill names together have fewer words than this is noindex and out of the sitemap. */
export const THIN_WORDS = 30;
/** A path with fewer published labs than this is noindex: too little to be a useful result. */
export const THIN_PATH_LABS = 3;

const TITLE_MAX = 60;
const TITLE_MIN = 50;
const DESC_MAX = 155;
const DESC_MIN = 140;

const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}.'/-]*/gu) ?? []).length;
const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const DIFF_ORDER = { easy: 0, medium: 1, hard: 2 };

/** The labs of the exam pools, which never reach a page (any status). */
export const examTasks = (curriculum) => curriculum.labs.filter((l) => l.type === 'exam');

/**
 * What the coming-soon page counts (data/catalog-summary.json): labs that passed verification, from the
 * curriculum, overall and per domain. The catalog also lists labs that are only built.
 */
export function catalogSummary(catalog, curriculum) {
  const listed = new Set(catalog.labs.map((l) => l.id));
  const verified = curriculum.labs.filter((l) => l.status === 'verified' && listed.has(l.id));
  const perDomain = (id) => verified.filter((l) => l.domain === id).length;
  return {
    domains: catalog.domains.map((d) => ({ ...d, labCount: perDomain(d.id) })),
    counts: { labs: verified.length, paths: catalog.paths.length, exams: catalog.exams.length },
  };
}

/** What people search for per domain, in a page title or description. */
const LAB_NOUN = { kubernetes: 'Kubernetes lab', linux: 'Linux lab', containers: 'container lab', iac: 'Terraform lab', automation: 'Ansible lab', networking: 'networking lab' };

/**
 * The first candidate of the right length, else the longest that fits. A name that is too long on its
 * own stays whole (a results page shortens it anyway, and a cut one could collide with another).
 */
export function fitTitle(candidates) {
  const fitting = candidates.filter((c) => c.length <= TITLE_MAX);
  return fitting.find((c) => c.length >= TITLE_MIN) ?? [...fitting].sort((a, b) => b.length - a.length)[0] ?? [...candidates].sort((a, b) => a.length - b.length)[0];
}

/** `text` with the first tail that lands it in range, or cut at a word when it is too long already. */
export function fitDescription(text, tails = []) {
  const base = text.replace(/\s+/g, ' ').trim();
  if (base.length > DESC_MAX) return `${base.slice(0, DESC_MAX - 1).replace(/\s+\S*$/, '').replace(/[\s:,;]+$/, '')}…`;
  if (base.length >= DESC_MIN) return base;
  const fits = tails.map((t) => `${base} ${t}`).filter((c) => c.length <= DESC_MAX);
  return fits.find((c) => c.length >= DESC_MIN) ?? fits.sort((a, b) => b.length - a.length)[0] ?? base;
}

const PATH_PREFIX = '/learn';
export const labUrl = (id) => `${PATH_PREFIX}/labs/${id}`;
export const domainUrl = (id) => `${PATH_PREFIX}/${id}`;
export const pathUrl = (id) => `${PATH_PREFIX}/paths/${id}`;
export const examUrl = (id) => `${PATH_PREFIX}/exams/${id}`;
const LABS = { label: 'Labs', to: `${PATH_PREFIX}/labs` };
const PATHS = { label: 'Learning paths', to: `${PATH_PREFIX}/paths` };
const EXAMS = { label: 'Exam simulations', to: `${PATH_PREFIX}/exams` };

const hours = (min) => (min < 60 ? `${min} minutes` : `about ${Math.round(min / 6) / 10} hours`);

const labLink = (l) => ({ id: l.id, title: l.title, to: labUrl(l.id), difficulty: l.difficulty, minutes: l.minutes });
const byLevel = (a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] || a.title.localeCompare(b.title);

/** Up to six labs: most skills in common, then the same competency, in the same domain; thin labs last. */
function relatedLabs(lab, all) {
  const skills = new Set(lab.skillIds);
  const comps = new Set(lab.skillIds.map((s) => s.split('.').slice(0, 2).join('.')));
  return all
    .filter((o) => o.id !== lab.id && o.domain === lab.domain)
    .map((o) => ({
      o,
      score: o.skillIds.filter((s) => skills.has(s)).length * 10 + o.skillIds.filter((s) => comps.has(s.split('.').slice(0, 2).join('.'))).length,
    }))
    .sort((a, b) => Number(a.o.thin) - Number(b.o.thin) || b.score - a.score || a.o.title.localeCompare(b.o.title))
    .slice(0, 6)
    .map(({ o }) => labLink(o));
}

/**
 * @param curriculum  parsed content/curriculum.yaml
 * @param catalog     /data/catalog.json
 * @param exams       Map of exam id to /data/exams/<id>.json
 * @param seo         content/site.yaml `seo` (`pages`, `domains`)
 * @param siteUrl     the site's origin, for absolute URLs in structured data
 */
export function buildLearn({ curriculum, catalog, exams, seo, siteUrl = '' }) {
  const pages = [];
  const catalogLabs = new Map(catalog.labs.map((l) => [l.id, l]));
  const skillName = (id) => catalog.skillNames[id];
  const brand = 'CloudTrain';
  const report = { thinLabs: [], excludedLabs: { proposed: 0, built: 0, other: 0, examTasks: 0 }, skippedPaths: [], thinPaths: [], skippedDomains: [], noindexExams: [], labsWithoutPath: 0 };

  const add = (path, kind, head, doc, extra) => {
    pages.push({ path, kind, ...head, sources: extra.sources, jsonLd: extra.jsonLd(head), doc: { kind, path, head, ...doc } });
  };
  const crumbsLd = (crumbs) => breadcrumbLd(siteUrl, [{ label: 'Home', to: '/' }, ...crumbs]);

  /* ---------------------------------------------------------------- labs */
  const labs = [];
  for (const l of curriculum.labs) {
    if (l.status !== 'verified') {
      report.excludedLabs[l.status in report.excludedLabs ? l.status : 'other'] += 1;
      continue;
    }
    if (l.type === 'exam') {
      report.excludedLabs.examTasks += 1;
      continue;
    }
    // Nothing goes public that the public catalog does not already list.
    const pub = catalogLabs.get(l.id);
    if (!pub) continue;
    const skills = pub.skillIds.map(skillName).filter(Boolean);
    const thin = words(l.title) + words(l.oneLine) + skills.reduce((n, s) => n + words(s), 0) < THIN_WORDS;
    labs.push({ id: l.id, title: l.title, summary: l.oneLine, domain: l.domain, difficulty: l.difficulty, minutes: l.minutes, skills, skillIds: pub.skillIds, thin });
  }
  const labById = new Map(labs.map((l) => [l.id, l]));

  /* ------------------------------------------------------- paths of a lab */
  const paths = [];
  const pathsOfLab = new Map();
  for (const p of curriculum.paths) {
    if (p.status === 'proposed') {
      report.skippedPaths.push(p.id);
      continue;
    }
    const modules = p.modules
      .map((m) => ({ id: m.id, title: m.title, labs: m.labs.map((id) => labById.get(id)).filter(Boolean) }))
      .filter((m) => m.labs.length > 0);
    const count = new Set(modules.flatMap((m) => m.labs.map((l) => l.id))).size;
    if (count === 0) {
      report.skippedPaths.push(p.id);
      continue;
    }
    const minutes = [...new Map(modules.flatMap((m) => m.labs).map((l) => [l.id, l.minutes])).values()].reduce((a, b) => a + b, 0);
    const path = { id: p.id, title: p.title, domain: p.domain, audience: p.audience, level: p.level, prerequisites: p.prerequisites ?? [], modules, count, minutes, thin: count < THIN_PATH_LABS };
    paths.push(path);
    for (const m of modules) {
      for (const l of m.labs) {
        const seen = pathsOfLab.get(l.id) ?? [];
        if (!seen.some((s) => s.id === p.id)) seen.push({ id: p.id, title: p.title, module: m.title, to: pathUrl(p.id) });
        pathsOfLab.set(l.id, seen);
      }
    }
  }
  const pathById = new Map(paths.map((p) => [p.id, p]));
  const pathLink = (p) => ({ id: p.id, title: p.title, to: pathUrl(p.id), labs: p.count, level: p.level, time: hours(p.minutes) });

  /* --------------------------------------------------------------- domains */
  const hubDomains = [];
  for (const d of curriculum.domains) {
    const domainLabs = labs.filter((l) => l.domain === d.id);
    const cfg = seo?.domains?.[d.id];
    if (domainLabs.length === 0 || !cfg) {
      report.skippedDomains.push(d.id);
      continue;
    }
    hubDomains.push({ id: d.id, name: cfg.name, h1: cfg.h1, lead: cfg.lead, title: cfg.title, description: cfg.description, competencies: d.competencies ?? [], labs: domainLabs });
  }
  const domainById = new Map(hubDomains.map((d) => [d.id, d]));
  const domainLink = (id) => {
    const d = domainById.get(id);
    return d ? { id, name: d.name, to: domainUrl(id) } : undefined;
  };

  const examList = [...exams.values()];

  /* ------------------------------------------------------------ lab pages */
  for (const l of labs) {
    const noun = LAB_NOUN[l.domain] ?? 'hands-on lab';
    const parents = pathsOfLab.get(l.id) ?? [];
    if (parents.length === 0) report.labsWithoutPath += 1;
    if (l.thin) report.thinLabs.push(l.id);
    const dom = domainById.get(l.domain);
    const crumbs = [LABS, { label: dom?.name ?? label(l.domain), to: domainUrl(l.domain) }, { label: l.title }];
    const head = {
      title: fitTitle([`${l.title}: hands-on ${noun} | ${brand}`, `${l.title}: ${noun} | ${brand}`, `${l.title} | ${noun}`, `${l.title} | ${brand}`, l.title]),
      description: fitDescription(l.summary, [`A ${l.difficulty}, ${l.minutes}-minute hands-on ${noun}, graded on the end state. Join the waitlist.`, `A ${l.difficulty}, ${l.minutes}-minute hands-on ${noun}. Join the waitlist.`, `${label(l.difficulty)}, ${l.minutes} minutes. Join the waitlist.`, 'Join the waitlist.']),
      noindex: l.thin,
    };
    add(
      labUrl(l.id),
      'lab',
      head,
      {
        crumbs,
        title: l.title,
        lead: l.summary,
        lab: { difficulty: l.difficulty, minutes: l.minutes, domain: domainLink(l.domain), skills: l.skills, paths: parents.slice(0, 3), related: relatedLabs(l, labs) },
      },
      {
        sources: [`content/packs/${l.domain}/labs/${l.id}`],
        jsonLd: () => [
          learningResourceLd(siteUrl, { path: labUrl(l.id), name: l.title, description: l.summary, type: 'Hands-on lab', level: label(l.difficulty), minutes: l.minutes, teaches: l.skills, partOf: parents[0] && { name: parents[0].title, to: parents[0].to } }),
          crumbsLd(crumbs),
        ],
      },
    );
  }

  /* ----------------------------------------------------------- path pages */
  const levelText = (lv) => (lv ? `${label(lv)} level` : undefined);
  for (const p of paths) {
    if (p.thin) report.thinPaths.push(p.id);
    const crumbs = [LABS, PATHS, { label: p.title }];
    const domainName = domainById.get(p.domain)?.name ?? label(p.domain);
    const lead = p.audience ? `For ${p.audience.charAt(0).toLowerCase()}${p.audience.slice(1)}.` : `A learning path of ${p.count} hands-on labs.`;
    const head = {
      title: fitTitle([`${p.title}: learning path | ${brand}`, `${p.title}: hands-on learning path | ${brand}`, `${p.title} | ${brand}`, p.title]),
      description: fitDescription(`${p.title}: an ordered path of ${p.count} hands-on labs in ${p.modules.length} ${p.modules.length === 1 ? 'module' : 'modules'}.`, [`${lead} Join the waitlist.`, 'Graded on the end state of real systems, not on the commands you type. Join the waitlist.', 'Graded on the end state. Join the waitlist.', 'Join the waitlist.']),
      noindex: p.thin,
    };
    add(
      pathUrl(p.id),
      'path',
      head,
      {
        crumbs,
        title: p.title,
        lead,
        learningPath: {
          level: levelText(p.level),
          labs: p.count,
          time: hours(p.minutes),
          domain: domainLink(p.domain),
          prerequisites: p.prerequisites.map((id) => pathById.get(id)).filter(Boolean).map(pathLink),
          modules: p.modules.map((m) => ({ id: m.id, title: m.title, labs: m.labs.map(labLink) })),
          related: paths.filter((o) => o.id !== p.id && o.domain === p.domain).slice(0, 4).map(pathLink),
          exams: examList.filter((e) => e.domain === p.domain).slice(0, 3).map((e) => ({ id: e.id, title: e.title, to: examUrl(e.id) })),
        },
      },
      {
        sources: ['content/curriculum.yaml'],
        jsonLd: (h) => [learningResourceLd(siteUrl, { path: pathUrl(p.id), name: p.title, description: h.description, type: 'Learning path', level: p.level ? label(p.level) : undefined, minutes: p.minutes, about: domainName, audience: p.audience }), crumbsLd(crumbs)],
      },
    );
  }

  /* ----------------------------------------------------------- exam pages */
  for (const e of examList) {
    const open = e.availability === 'available';
    if (!open) report.noindexExams.push(e.id);
    const crumbs = [LABS, EXAMS, { label: e.title }];
    const facts = `${e.taskCount} tasks in ${e.durationMinutes} minutes`;
    const lead = `A timed practical simulation: ${facts}, graded on the end state of the systems you leave behind and reported per objective against a pass mark of ${e.passMark}%.`;
    const head = {
      title: fitTitle([`${e.title} | ${brand}`, e.title]),
      description: fitDescription(`${e.title}: ${facts}, graded per objective against a ${e.passMark}% pass mark.`, ['Timed, on real systems, with fresh tasks on every attempt. Join the waitlist.', 'Timed, on real systems. Join the waitlist.', 'Join the waitlist.']),
      noindex: !open,
    };
    add(
      examUrl(e.id),
      'exam',
      head,
      {
        crumbs,
        title: e.title,
        lead,
        exam: {
          open,
          tasks: e.taskCount,
          minutes: e.durationMinutes,
          passMark: e.passMark,
          domain: domainLink(e.domain),
          objectives: e.objectives.map((o) => ({ name: o.name, weight: o.weight })),
          rules: [
            'One timer for the whole simulation',
            ...(e.rules.anyOrder ? ['Do the tasks in any order'] : []),
            ...(e.rules.flagForReview ? ['Flag tasks to come back to'] : []),
            'No hints and no validation during the simulation',
            ...(e.rules.rebootBeforeGrade ? ['The machines reboot before grading, so only what persists scores'] : []),
            ...(e.retakePolicy?.freshDraw ? ['A retake draws different tasks with new parameters'] : []),
          ],
          docsAllowed: e.rules.docsAllowed,
          paths: paths.filter((p) => p.domain === e.domain).slice(0, 4).map(pathLink),
        },
      },
      {
        sources: ['content/curriculum.yaml'],
        jsonLd: (h) => [learningResourceLd(siteUrl, { path: examUrl(e.id), name: e.title, description: h.description, type: 'Practice exam', minutes: e.durationMinutes, teaches: e.objectives.map((o) => o.name) }), crumbsLd(crumbs)],
      },
    );
  }

  /* ---------------------------------------------------------- domain hubs */
  for (const d of hubDomains) {
    const crumbs = [LABS, { label: d.name }];
    const compTitle = (id) => d.competencies.find((c) => id === c.id || id.startsWith(`${c.id}.`));
    const groups = new Map(d.competencies.map((c) => [c.id, { id: c.id, title: c.title, labs: [] }]));
    const more = { id: 'more', title: 'More labs', labs: [] };
    for (const l of d.labs) {
      const c = l.skillIds.map(compTitle).find(Boolean);
      (c ? groups.get(c.id) : more).labs.push(l);
    }
    const lists = [...groups.values(), more].filter((g) => g.labs.length > 0).map((g) => ({ id: g.id, title: g.title, labs: [...g.labs].sort(byLevel).map(labLink) }));
    const head = { title: d.title, description: d.description, noindex: false };
    add(
      domainUrl(d.id),
      'domain',
      head,
      {
        crumbs,
        title: d.h1,
        lead: d.lead,
        domain: {
          labCount: d.labs.length,
          groups: lists,
          paths: paths.filter((p) => p.domain === d.id).map(pathLink),
          exams: examList.filter((e) => e.domain === d.id).map((e) => ({ id: e.id, title: e.title, to: examUrl(e.id), tasks: e.taskCount, minutes: e.durationMinutes })),
        },
      },
      { sources: ['content/curriculum.yaml'], jsonLd: () => [crumbsLd(crumbs)] },
    );
  }

  /* --------------------------------------------------------- the three indexes */
  const pageSeo = (path) => seo.pages[path];
  const domainCards = hubDomains.map((d) => ({ id: d.id, name: d.name, to: domainUrl(d.id), lead: d.lead, labs: d.labs.length, paths: paths.filter((p) => p.domain === d.id).length }));
  {
    const crumbs = [{ label: 'Labs' }];
    const cfg = pageSeo('/learn/labs');
    add(
      LABS.to,
      'labs-index',
      { title: cfg.title, description: cfg.description, noindex: false },
      { crumbs, title: cfg.h1, lead: cfg.lead, labsIndex: { domains: domainCards, paths: paths.filter((p) => !p.thin).slice(0, 8).map(pathLink), pathCount: paths.length, examCount: examList.length } },
      { sources: ['content/curriculum.yaml'], jsonLd: () => [crumbsLd(crumbs)] },
    );
  }
  {
    const crumbs = [LABS, { label: 'Learning paths' }];
    const cfg = pageSeo('/learn/paths');
    add(
      PATHS.to,
      'paths-index',
      { title: cfg.title, description: cfg.description, noindex: false },
      { crumbs, title: cfg.h1, lead: cfg.lead, pathsIndex: { domains: hubDomains.map((d) => ({ id: d.id, name: d.name, to: domainUrl(d.id), paths: paths.filter((p) => p.domain === d.id).map(pathLink) })).filter((d) => d.paths.length > 0) } },
      { sources: ['content/curriculum.yaml'], jsonLd: () => [crumbsLd(crumbs)] },
    );
  }
  {
    const crumbs = [LABS, { label: 'Exam simulations' }];
    const cfg = pageSeo('/learn/exams');
    add(
      EXAMS.to,
      'exams-index',
      { title: cfg.title, description: cfg.description, noindex: false },
      { crumbs, title: cfg.h1, lead: cfg.lead, examsIndex: { exams: examList.map((e) => ({ id: e.id, title: e.title, to: examUrl(e.id), tasks: e.taskCount, minutes: e.durationMinutes, passMark: e.passMark, domain: domainLink(e.domain) })) } },
      { sources: ['content/curriculum.yaml'], jsonLd: () => [crumbsLd(crumbs)] },
    );
  }

  report.counts = { labs: labs.length, paths: paths.length, exams: examList.length, domains: hubDomains.length };
  return { pages, report };
}

/** The file of a page's document under the site root (`/learn/labs/x` to `data/learn/labs/x.json`). */
export const learnDocFile = (path) => `data${path}.json`;
