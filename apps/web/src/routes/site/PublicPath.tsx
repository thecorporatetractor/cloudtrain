import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, Clock, Layers } from 'lucide-react';
import { usePublicCatalog, usePublicPath } from '@/api/public';
import { DomainIcon, domainLabel } from '@/components/domain';
import { alignLabel, Disclaimer } from '@/components/exams/ui';
import { Badge, Card, ErrorState, PageSkeleton } from '@/components/ui';
import { publicPathRoute } from '@/router';
import { formatMinutes } from '@/lib/utils';
import { useDocumentTitle } from '@/site/util';
import { PathCard, PublicLabRow, StartLab } from './PublicCatalog';

/** A learning path or course, read-only: sections, labs, alignment and related paths. */
export function PublicPath() {
  const { pathId } = publicPathRoute.useParams();
  const path = usePublicPath(pathId);
  const catalog = usePublicCatalog();
  useDocumentTitle(path.data?.title);
  if (path.isPending) {
    return (
      <div className="site-container site-page">
        <PageSkeleton />
      </div>
    );
  }
  if (path.isError || !path.data) {
    return (
      <div className="site-container site-page">
        <ErrorState title="This path does not exist" error={path.error} />
        <Link to="/catalog" search={{}} className="btn btn-secondary btn-md" style={{ marginTop: 16 }}>
          <ChevronLeft size={14} aria-hidden /> Back to the catalog
        </Link>
      </div>
    );
  }
  const p = path.data;
  const skillNames = catalog.data?.skillNames ?? {};
  const frameworkName = p.framework ? catalog.data?.frameworks.find((f) => f.id === p.framework)?.name : undefined;
  const first = p.labs[0];
  return (
    <div className="site-container site-page">
      <nav className="site-crumbs xs subtle" aria-label="Breadcrumb">
        <Link to="/catalog" search={{}} className="link-quiet">
          Catalog
        </Link>
        <span aria-hidden>/</span>
        <Link to="/catalog" search={{ domain: p.domain }} className="link-quiet">
          {domainLabel[p.domain]}
        </Link>
        <span aria-hidden>/</span>
        <span>{p.kind === 'course' ? 'Course' : 'Path'}</span>
      </nav>
      <header className="site-page-head">
        <div className="stack" style={{ gap: 8 }}>
          <div className="row xs subtle" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 5 }}>
              <DomainIcon domain={p.domain} size={12} aria-hidden /> {domainLabel[p.domain]}
            </span>
            <Badge tone="outline">{p.kind === 'course' ? 'Course' : 'Path'}</Badge>
            {p.framework && (
              <Badge tone="outline" title="Objectives aligned to this exam; no affiliation">
                {frameworkName ?? alignLabel(p.framework)}-aligned
              </Badge>
            )}
          </div>
          <h1 className="site-h1">{p.title}</h1>
          <p className="muted" style={{ maxWidth: 720 }}>
            {p.description}
          </p>
          <div className="row small muted" style={{ gap: 16, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 5 }}>
              <Layers size={13} aria-hidden /> {p.labCount} labs
              {p.sections.length > 1 ? ` in ${p.sections.length} sections` : ''}
            </span>
            <span className="row" style={{ gap: 5 }}>
              <Clock size={13} aria-hidden /> about {formatMinutes(p.estimatedMinutes)}
            </span>
          </div>
          {p.disclaimer && <Disclaimer text={p.disclaimer} />}
        </div>
        {first && (
          <div className="site-page-head-action">
            <StartLab labId={first.id} size="md" />
            <span className="xs subtle">Starts with "{first.title}"</span>
          </div>
        )}
      </header>

      {p.sections.map((s, i) => (
        <section key={s.id} className="page-section" aria-labelledby={`section-${s.id}`} style={i === 0 ? { marginTop: 0 } : undefined}>
          <div className="section-header">
            <div>
              <h2 id={`section-${s.id}`}>
                {p.sections.length > 1 && <span className="subtle tnum" style={{ marginRight: 8 }}>{String(i + 1).padStart(2, '0')}</span>}
                {s.title}
              </h2>
              {s.description && <p className="muted small">{s.description}</p>}
            </div>
            <span className="xs subtle tnum">{s.labIds.length} labs</span>
          </div>
          <Card className="card-flush">
            <ul className="lab-list">
              {s.labIds.map((id) => p.labs.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l).map((l) => (
                <li key={l.id}>
                  <PublicLabRow lab={l} skillNames={skillNames} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}

      {p.related.length > 0 && (
        <section className="page-section" aria-labelledby="related">
          <div className="section-header">
            <h2 id="related">More in {domainLabel[p.domain]}</h2>
            <Link to="/catalog" search={{ domain: p.domain }} className="link-quiet small">
              All {domainLabel[p.domain]} <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          <div className="site-path-grid">
            {p.related.slice(0, 3).map((r) => (
              <PathCard key={r.id} path={r} frameworkName={r.framework ? catalog.data?.frameworks.find((f) => f.id === r.framework)?.name : undefined} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
