import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PublicCatalog, PublicDomain, PublicExam, PublicExamDetail, PublicLab, PublicPath, PublicPathDetail, SiteConfig } from '@cloudtrain/api-types';
import type { Content } from '../content/load.js';
import { examDomain, examRules, objectives, retakePolicy, type ExamCatalog } from '../exams/catalog.js';
import { HttpError, notFound } from '../errors.js';

/*
 * The public, read-only API behind the website (`/api/public/*`): the site
 * configuration and the catalog as content/ describes it. Nothing here reads
 * the database or a principal, so no org or learner data can leak: no
 * completion, progress, visibility, pins, attempts or retake state, and no exam
 * pool task ids. Payloads are computed once (content is read at startup),
 * served with an ETag and a public Cache-Control, and rate-limited per client
 * address.
 */

export interface PublicDeps {
  content: Content;
  site: SiteConfig;
  exams?: ExamCatalog;
  /** Requests per minute per client address over all public routes (default 120). */
  ratePerMinute?: number;
  /** `max-age` of the public responses in seconds (default 300). */
  maxAgeSeconds?: number;
  now?: () => number;
}

/* --------------------------------------------------------------- shapes */

export function publicLabs(content: Content): PublicLab[] {
  return content.summaries
    .filter((l) => !(l.tags ?? []).includes('exam-fixture'))
    .map((l) => ({
      id: l.id,
      title: l.title,
      domain: l.domain,
      difficulty: l.difficulty,
      estimatedMinutes: l.estimatedMinutes,
      ...(l.frameworks?.length ? { frameworks: l.frameworks } : {}),
      ...(l.tags?.length ? { tags: l.tags } : {}),
      skillIds: l.skillIds,
      ...(l.pathId ? { pathId: l.pathId } : {}),
      ...(l.questionCount ? { questionCount: l.questionCount } : {}),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function publicPaths(content: Content): PublicPath[] {
  const courseIds = new Set(content.packs.flatMap((p) => p.courses.map((c) => c.id)));
  const disclaimerOf = (fw: string | undefined) => (fw ? content.frameworks.find((f) => f.id === fw)?.disclaimer : undefined);
  return content.paths
    .filter((p) => p.labIds.length > 0)
    .map((p) => ({
      id: p.id,
      kind: courseIds.has(p.id) ? ('course' as const) : ('path' as const),
      title: p.title,
      domain: p.domain,
      description: p.description,
      ...(p.framework ? { framework: p.framework } : {}),
      labCount: p.labIds.length,
      estimatedMinutes: p.estimatedMinutes,
      ...(disclaimerOf(p.framework) ? { disclaimer: disclaimerOf(p.framework) } : {}),
    }));
}

export function publicExam(cat: ExamCatalog, id: string): PublicExam | undefined {
  const ex = cat.exams.get(id);
  if (!ex) return undefined;
  const def = ex.def;
  return {
    id: def.id,
    title: def.title,
    domain: examDomain(def),
    alignsTo: def.alignsTo,
    disclaimer: def.disclaimer,
    format: def.format,
    durationMinutes: def.durationMinutes,
    passMark: def.passMark,
    ...(def.passMarkNote ? { passMarkNote: def.passMarkNote } : {}),
    taskCount: def.taskCount,
    environment: def.environment,
    availability: ex.availability,
    ...(ex.availabilityNote ? { availabilityNote: ex.availabilityNote } : {}),
    rules: examRules(def),
    retakePolicy: retakePolicy(def),
  };
}

export function publicExamDetail(cat: ExamCatalog, id: string): PublicExamDetail | undefined {
  const ex = cat.exams.get(id);
  const summary = publicExam(cat, id);
  if (!ex || !summary) return undefined;
  return {
    ...summary,
    ...(ex.def.description ? { description: ex.def.description } : {}),
    ...(ex.def.simulationNote ? { simulationNote: ex.def.simulationNote } : {}),
    objectives: objectives(cat, ex),
    reportIncludes: ex.def.scoreReport.includes ?? [],
  };
}

export function publicCatalog(content: Content, exams?: ExamCatalog): PublicCatalog {
  const labs = publicLabs(content);
  const paths = publicPaths(content);
  const examList = exams
    ? [...exams.exams.keys()]
        .map((id) => publicExam(exams, id)!)
        .sort((a, b) => (a.availability === b.availability ? a.title.localeCompare(b.title) : a.availability === 'available' ? -1 : 1))
    : [];
  const domains: PublicDomain[] = content.domains.map((d) => ({
    id: d.id,
    name: d.name,
    tagline: d.tagline,
    labCount: labs.filter((l) => l.domain === d.id).length,
    pathCount: paths.filter((p) => p.domain === d.id).length,
    examCount: examList.filter((e) => e.domain === d.id).length,
  }));
  const frameworks = content.frameworks.map((f) => ({
    id: f.id,
    name: f.name,
    fullName: f.fullName,
    vendor: f.vendor,
    ...(f.domain ? { domain: f.domain } : {}),
    group: f.group,
    coverage: f.coverage,
    ...(f.disclaimer ? { disclaimer: f.disclaimer } : {}),
  }));
  const used = new Set(labs.flatMap((l) => l.skillIds));
  const skillNames = Object.fromEntries(content.skills.filter((s) => used.has(s.id)).map((s) => [s.id, s.name]));
  return { domains, paths, labs, exams: examList, frameworks, skillNames };
}

export function publicPathDetail(content: Content, id: string): PublicPathDetail | undefined {
  const all = publicPaths(content);
  const path = all.find((p) => p.id === id);
  const source = content.paths.find((p) => p.id === id);
  if (!path || !source) return undefined;
  const labs = publicLabs(content);
  const byId = new Map(labs.map((l) => [l.id, l]));
  const pack = content.packs.find((p) => p.paths.some((pp) => pp.id === id) || p.courses.some((c) => c.id === id));
  const packPath = pack?.paths.find((pp) => pp.id === id);
  const sections = packPath
    ? packPath.courseIds
        .map((cid) => pack!.courses.find((c) => c.id === cid))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, title: c.title, ...(c.description ? { description: c.description } : {}), labIds: c.labIds.filter((l) => byId.has(l)) }))
        .filter((s) => s.labIds.length > 0)
    : [{ id: path.id, title: path.title, labIds: source.labIds.filter((l) => byId.has(l)) }];
  return {
    ...path,
    sections,
    labs: source.labIds.map((l) => byId.get(l)).filter((l): l is PublicLab => !!l),
    related: all.filter((p) => p.id !== id && p.domain === path.domain).slice(0, 6),
  };
}

/* ------------------------------------------------------------ rate limit */

/** Fixed window (one minute by default) per client address, in memory (one gateway process). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs: number = 60_000,
  ) {}

  /** Seconds until the key's window resets (at least 1). */
  resetIn(key: string): number {
    const h = this.hits.get(key);
    return h ? Math.max(1, Math.ceil((h.resetAt - this.now()) / 1000)) : Math.ceil(this.windowMs / 1000);
  }

  /** Counts one request; returns the remaining budget and when the window resets, or `null` when over the limit. */
  take(key: string): { remaining: number; resetAt: number } | null {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      h = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, h);
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    }
    h.count += 1;
    if (h.count > this.perMinute) return null;
    return { remaining: this.perMinute - h.count, resetAt: h.resetAt };
  }
}

/* ----------------------------------------------------------------- routes */

interface Cached {
  body: string;
  etag: string;
}

function cache(value: unknown): Cached {
  const body = JSON.stringify(value);
  return { body, etag: `W/"${createHash('sha1').update(body).digest('hex').slice(0, 27)}"` };
}

export function registerPublicRoutes(app: FastifyInstance, deps: PublicDeps): void {
  const pub = { config: { public: true } };
  const limiter = new RateLimiter(Math.max(1, deps.ratePerMinute ?? 120), deps.now);
  const maxAge = deps.maxAgeSeconds ?? 300;
  const cacheControl = `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`;

  // Computed once: content and the site configuration are read at startup.
  const site = cache(deps.site);
  const catalog = cache(publicCatalog(deps.content, deps.exams));
  const paths = new Map<string, Cached>();
  const exams = new Map<string, Cached>();

  const send = (req: FastifyRequest, reply: FastifyReply, c: Cached) => {
    const quota = limiter.take(req.ip);
    if (!quota) {
      throw new HttpError(429, 'Too many requests', { code: 'rate_limited', details: { retryAfterSeconds: 60 } });
    }
    reply.header('x-ratelimit-limit', String(Math.max(1, deps.ratePerMinute ?? 120)));
    reply.header('x-ratelimit-remaining', String(quota.remaining));
    reply.header('cache-control', cacheControl);
    reply.header('vary', 'accept-encoding');
    reply.header('etag', c.etag);
    if (req.headers['if-none-match']?.split(',').some((t) => t.trim() === c.etag)) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(c.body);
  };

  app.get('/api/public/site', pub, async (req, reply) => send(req, reply, site));
  app.get('/api/public/catalog', pub, async (req, reply) => send(req, reply, catalog));
  app.get<{ Params: { id: string } }>('/api/public/paths/:id', pub, async (req, reply) => {
    let c = paths.get(req.params.id);
    if (!c) {
      const detail = publicPathDetail(deps.content, req.params.id);
      if (!detail) {
        limiter.take(req.ip);
        throw notFound('Path');
      }
      c = cache(detail);
      paths.set(req.params.id, c);
    }
    return send(req, reply, c);
  });
  app.get<{ Params: { id: string } }>('/api/public/exams/:id', pub, async (req, reply) => {
    let c = exams.get(req.params.id);
    if (!c) {
      const detail = deps.exams ? publicExamDetail(deps.exams, req.params.id) : undefined;
      if (!detail) {
        limiter.take(req.ip);
        throw notFound('Exam');
      }
      c = cache(detail);
      exams.set(req.params.id, c);
    }
    return send(req, reply, c);
  });
}
