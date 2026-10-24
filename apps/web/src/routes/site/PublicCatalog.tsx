import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Clock, GraduationCap, Lock, Route, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useMe } from '@/api/client';
import { publicQueries, usePublicCatalog, useSite } from '@/api/public';
import type { Difficulty, Domain, PublicExam, PublicLab, PublicPath } from '@/api/types';
import { DifficultyBadge, DomainIcon, domainLabel } from '@/components/domain';
import { alignLabel, Disclaimer, ExamDomainIcon, examDomainLabel } from '@/components/exams/ui';
import { Badge, Card, EmptyState, ErrorState, PageSkeleton, Segmented } from '@/components/ui';
import { catalogRoute } from '@/router';
import { cn, formatMinutes, titleCase } from '@/lib/utils';
import { SignInLink, useDocumentTitle } from '@/site/util';

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const DURATIONS = [20, 30, 45];

/**
 * The public, read-only catalog (`/catalog` for visitors): paths, courses, labs and
 * exam simulations from content/, with the same search params as the signed-in
 * catalog so links keep working after sign-in. "Start lab" leads to sign-in and
 * back to that lab.
 */
export function PublicCatalog() {
  const search = catalogRoute.useSearch();
  const navigate = useNavigate({ from: catalogRoute.fullPath });
  const site = useSite();
  const catalog = usePublicCatalog();
  useDocumentTitle('Catalog');
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => clean({ ...prev, ...patch }), replace: true });

  const data = catalog.data;
  const q = search.q?.toLowerCase().trim();
  const activePath = search.path ? data?.paths.find((p) => p.id === search.path) : undefined;
  const domain = activePath?.domain ?? search.domain;
  // A selected path lists its labs in order: membership comes from the path detail.
  const pathDetail = useQuery({ ...publicQueries.path(search.path ?? ''), enabled: !!activePath });
  const pathLabIds = pathDetail.data?.labs.map((l) => l.id);

  const labs = useMemo(() => {
    if (!data) return [];
    const inPath = pathLabIds ? new Set(pathLabIds) : undefined;
    const ordered = inPath ? (pathLabIds ?? []).map((id) => data.labs.find((l) => l.id === id)).filter((l): l is PublicLab => !!l) : data.labs;
    return ordered.filter((l) => {
      if (activePath) {
        if (!inPath) return false;
      } else if (domain && l.domain !== domain) return false;
      if (search.difficulty && l.difficulty !== search.difficulty) return false;
      if (search.maxMinutes && l.estimatedMinutes > search.maxMinutes) return false;
      if (q && !`${l.title} ${l.tags?.join(' ') ?? ''} ${l.skillIds.map((s) => data.skillNames[s] ?? s).join(' ')} ${l.frameworks?.join(' ') ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, activePath, domain, search.difficulty, search.maxMinutes, q, pathDetail.data]);

  if (site.data && site.data.flags.showCatalog === false) {
    return (
      <div className="site-container site-section">
        <EmptyState icon={<Lock size={20} />} title="The catalog is not public on this site" description="Sign in to browse the labs your organisation has enabled." action={<SignInLink returnTo="/catalog" className="btn btn-primary btn-md">Sign in</SignInLink>} />
      </div>
    );
  }
  if (catalog.isPending) {
    return (
      <div className="site-container site-section">
        <PageSkeleton />
      </div>
    );
  }
  if (catalog.isError || !data) {
    return (
      <div className="site-container site-section">
        <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
      </div>
    );
  }

  const paths = data.paths.filter((p) => p.kind === 'path' && (!domain || p.domain === domain));
  const courses = data.paths.filter((p) => p.kind === 'course' && (!domain || p.domain === domain));
  const exams = data.exams.filter((e) => !domain || e.domain === domain);
  const hasFilters = !!(q || search.difficulty || search.maxMinutes);
  const showOverview = !activePath && !hasFilters;

  return (
    <div className="site-container site-page">
      <header className="site-page-head">
        <div>
          <div className="page-eyebrow">Catalog</div>
          <h1 className="site-h1">{domain ? domainLabel[domain] : 'Everything you can practise'}</h1>
          <p className="muted">
            {data.labs.length} labs, {data.paths.filter((p) => p.kind === 'path').length} paths and {data.exams.length} exam simulations across {data.domains.filter((d) => d.labCount > 0).length} domains. Read-only here; sign in to start a lab.
          </p>
        </div>
        <Segmented<Domain | 'all'>
          label="Domain"
          value={domain ?? 'all'}
          onChange={(v) => set({ domain: v === 'all' ? undefined : v, path: undefined })}
          options={[{ value: 'all', label: 'All' }, ...data.domains.filter((d) => d.labCount > 0).map((d) => ({ value: d.id, label: (<span className="row" style={{ gap: 6 }}><DomainIcon domain={d.id} size={13} />{d.name}</span>) }))]}
        />
      </header>

      {showOverview && !domain && (
        <section className="site-domain-grid" aria-label="Domains" style={{ marginBottom: 36 }}>
          {data.domains
            .filter((d) => d.labCount > 0)
            .map((d) => (
              <button key={d.id} type="button" className="card card-interactive domain-card" onClick={() => set({ domain: d.id })}>
                <span className="domain-card-icon">
                  <DomainIcon domain={d.id} size={18} />
                </span>
                <span className="stack" style={{ gap: 3 }}>
                  <span className="row-between">
                    <h3>{d.name}</h3>
                    <ArrowRight size={14} className="subtle" aria-hidden />
                  </span>
                  <span className="small muted">{d.tagline}</span>
                  <span className="xs subtle" style={{ marginTop: 6 }}>
                    {d.labCount} labs · {d.pathCount} {d.pathCount === 1 ? 'path' : 'paths'}
                    {d.examCount ? ` · ${d.examCount} exam ${d.examCount === 1 ? 'simulation' : 'simulations'}` : ''}
                  </span>
                </span>
              </button>
            ))}
        </section>
      )}

      {showOverview && paths.length > 0 && (
        <section className="page-section" aria-labelledby="paths" style={{ marginTop: 0 }}>
          <div className="section-header">
            <div>
              <h2 id="paths">Paths</h2>
              <p className="muted small">Ordered sequences from first contact to exam readiness, some aligned to public exam blueprints.</p>
            </div>
          </div>
          <div className="site-path-grid">
            {paths.map((p) => (
              <PathCard key={p.id} path={p} frameworkName={data.frameworks.find((f) => f.id === p.framework)?.name} />
            ))}
          </div>
        </section>
      )}

      {showOverview && courses.length > 0 && (
        <section className="page-section" aria-labelledby="courses">
          <div className="section-header">
            <div>
              <h2 id="courses">Courses</h2>
              <p className="muted small">Short, focused groups of labs on one topic.</p>
            </div>
          </div>
          <Card className="card-flush">
            <ul className="lab-list">
              {courses.map((c) => (
                <li key={c.id}>
                  <Link to="/catalog/paths/$pathId" params={{ pathId: c.id }} className="lab-row">
                    <span className="lab-row-icon">
                      <Route size={15} aria-hidden />
                    </span>
                    <span className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                      <span className="lab-row-title truncate">{c.title}</span>
                      <span className="row xs subtle lab-row-meta" style={{ gap: 10 }}>
                        <span className="row" style={{ gap: 5 }}>
                          <DomainIcon domain={c.domain} size={11} /> {domainLabel[c.domain]}
                        </span>
                        <span>
                          {c.labCount} labs · {formatMinutes(c.estimatedMinutes)}
                        </span>
                      </span>
                    </span>
                    <ArrowRight size={14} className="subtle" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {showOverview && exams.length > 0 && (
        <section className="page-section" aria-labelledby="exams">
          <div className="section-header">
            <div>
              <h2 id="exams">Exam simulations</h2>
              <p className="muted small">Timed practical simulations graded against a pass mark. Objectives aligned to public blueprints; no affiliation, no certification conferred.</p>
            </div>
          </div>
          <div className="site-exam-grid">
            {exams.map((e) => (
              <ExamCard key={e.id} exam={e} />
            ))}
          </div>
        </section>
      )}

      <section className="page-section" aria-labelledby="labs">
        <div className="section-header" style={{ alignItems: 'center' }}>
          <div className="row" style={{ gap: 10 }}>
            <h2 id="labs">{activePath ? activePath.title : 'Labs'}</h2>
            <span className="subtle small tnum">{labs.length}</span>
            {activePath && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ path: undefined })}>
                <X size={12} aria-hidden /> Clear path
              </button>
            )}
          </div>
          <div className="row filters" style={{ gap: 8 }}>
            <label className="search-field">
              <Search size={13} aria-hidden />
              <input className="search-input" placeholder="Search title, tag, skill…" value={search.q ?? ''} onChange={(e) => set({ q: e.target.value || undefined })} aria-label="Search labs" />
            </label>
            <div className="chip-group" role="group" aria-label="Difficulty">
              {DIFFS.map((d) => (
                <button key={d} type="button" className={cn('chip', search.difficulty === d && 'is-on')} aria-pressed={search.difficulty === d} onClick={() => set({ difficulty: search.difficulty === d ? undefined : d })}>
                  {titleCase(d)}
                </button>
              ))}
            </div>
            <div className="chip-group" role="group" aria-label="Maximum duration">
              {DURATIONS.map((m) => (
                <button key={m} type="button" className={cn('chip', search.maxMinutes === m && 'is-on')} aria-pressed={search.maxMinutes === m} onClick={() => set({ maxMinutes: search.maxMinutes === m ? undefined : m })}>
                  <Clock size={11} aria-hidden /> ≤ {m}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {activePath && (
          <Card className="path-banner">
            <div className="stack grow" style={{ gap: 4 }}>
              <p className="small muted">{activePath.description}</p>
              <div className="row xs subtle" style={{ gap: 12 }}>
                <span>{activePath.labCount} labs</span>
                <span>{formatMinutes(activePath.estimatedMinutes)}</span>
                <Link to="/catalog/paths/$pathId" params={{ pathId: activePath.id }} className="link-quiet">
                  Path details <ArrowRight size={11} aria-hidden />
                </Link>
              </div>
            </div>
          </Card>
        )}

        {labs.length === 0 ? (
          <EmptyState title="No labs match these filters" description="Try widening the duration or clearing the difficulty filter." action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ q: undefined, difficulty: undefined, maxMinutes: undefined })}>Clear filters</button>} />
        ) : (
          <Card className="card-flush">
            <ul className="lab-list">
              {labs.map((l) => (
                <li key={l.id}>
                  <PublicLabRow lab={l} skillNames={data.skillNames} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="xs subtle" style={{ marginTop: 16 }}>
          Lab titles name tasks, never exams or vendors. Framework badges show alignment to public blueprints only.
        </p>
      </section>

      {domain && (
        <p className="small subtle" style={{ marginTop: 24 }}>
          Looking for something else?{' '}
          <Link to="/catalog" search={{}} className="link-quiet">
            Browse all domains
          </Link>
        </p>
      )}
    </div>
  );
}

export function PathCard({ path, frameworkName }: { path: PublicPath; frameworkName?: string }) {
  return (
    <Link to="/catalog/paths/$pathId" params={{ pathId: path.id }} className="card card-interactive path-card">
      <div className="row-between">
        <span className="row xs subtle" style={{ gap: 6 }}>
          <DomainIcon domain={path.domain} size={12} aria-hidden /> {domainLabel[path.domain]}
        </span>
        {path.framework && (
          <Badge tone="outline" title="Objectives aligned to this exam; no affiliation">
            {frameworkName ?? alignLabel(path.framework)}-aligned
          </Badge>
        )}
      </div>
      <h3 style={{ marginTop: 10 }}>{path.title}</h3>
      <p className="small muted" style={{ marginTop: 4, flex: 1 }}>
        {path.description}
      </p>
      <div className="row-between xs subtle" style={{ marginTop: 14 }}>
        <span>
          {path.labCount} labs · {formatMinutes(path.estimatedMinutes)}
        </span>
        <span className="row" style={{ gap: 4 }}>
          Details <ArrowRight size={11} aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export function ExamCard({ exam }: { exam: PublicExam }) {
  const soon = exam.availability !== 'available';
  return (
    <Card className={cn('exam-card', soon && 'exam-card-soon')}>
      <div className="row xs subtle" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 5 }}>
          <ExamDomainIcon domain={exam.domain} size={12} /> {examDomainLabel[exam.domain]}
        </span>
        {exam.alignsTo.map((a) => (
          <Badge key={a} tone="outline" title="Objectives aligned to this exam; no affiliation">
            {alignLabel(a)}-aligned
          </Badge>
        ))}
        {soon && <Badge>Coming soon</Badge>}
      </div>
      <Link to="/catalog/exams/$examId" params={{ examId: exam.id }} className="exam-card-title link-quiet">
        {exam.title}
      </Link>
      <div className="exam-facts">
        <div className="exam-fact">
          <span className="exam-fact-label">Duration</span>
          <span className="exam-fact-value tnum">{formatMinutes(exam.durationMinutes)}</span>
        </div>
        <div className="exam-fact">
          <span className="exam-fact-label">Tasks</span>
          <span className="exam-fact-value tnum">{exam.taskCount}</span>
        </div>
        <div className="exam-fact">
          <span className="exam-fact-label">Pass mark</span>
          <span className="exam-fact-value tnum">{exam.passMark}%</span>
        </div>
      </div>
      <Disclaimer text={exam.disclaimer} />
      <div className="exam-card-foot">
        <span className="xs subtle row" style={{ gap: 5 }}>
          <GraduationCap size={12} aria-hidden /> {exam.format === 'practical' ? 'Practical' : 'Practical simulation'}
        </span>
        <Link to="/catalog/exams/$examId" params={{ examId: exam.id }} className="btn btn-secondary btn-sm">
          Details <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

/** A lab in the public catalog: no completion, and "Start lab" goes through sign-in. */
export function PublicLabRow({ lab, skillNames }: { lab: PublicLab; skillNames: Record<string, string> }) {
  const shown = lab.skillIds.slice(0, 3);
  return (
    <div className="lab-row lab-row-static">
      <span className="lab-row-icon">
        <DomainIcon domain={lab.domain} size={15} />
      </span>
      <span className="stack grow" style={{ gap: 3, minWidth: 0 }}>
        <span className="lab-row-title truncate">{lab.title}</span>
        <span className="row xs subtle lab-row-meta" style={{ gap: 10 }}>
          <DifficultyBadge difficulty={lab.difficulty} />
          {lab.questionCount ? (
            <Badge tone="accent" title={`Investigation challenge: ${lab.questionCount} questions with points`}>
              CTF · {lab.questionCount} questions
            </Badge>
          ) : null}
          <span className="row" style={{ gap: 4, whiteSpace: 'nowrap' }}>
            <Clock size={11} aria-hidden /> {formatMinutes(lab.estimatedMinutes)}
          </span>
          <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {shown.map((id) => (
              <span key={id} className="skill-tag skill-tag-xs" title={id}>
                {skillNames[id] ?? id.split('.').pop()}
              </span>
            ))}
            {lab.skillIds.length > shown.length && <span className="skill-tag subtle">+{lab.skillIds.length - shown.length}</span>}
          </span>
        </span>
      </span>
      <StartLab labId={lab.id} />
    </div>
  );
}

/** Visitors: sign in and come back to the lab. Signed in: straight to it. */
export function StartLab({ labId, size = 'sm' }: { labId: string; size?: 'sm' | 'md' }) {
  const me = useMe();
  if (me.isSuccess) {
    return (
      <Link to="/labs/$labId" params={{ labId }} className={`btn btn-secondary btn-${size}`}>
        Start lab <ArrowRight size={12} aria-hidden />
      </Link>
    );
  }
  return (
    <SignInLink returnTo={`/labs/${labId}`} className={`btn btn-secondary btn-${size}`} title="Sign in to start this lab">
      <Lock size={11} aria-hidden /> Start lab
    </SignInLink>
  );
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}
