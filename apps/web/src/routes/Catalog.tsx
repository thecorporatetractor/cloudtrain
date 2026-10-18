import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Clock, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo } from 'react';
import { useCatalog, useSkills } from '@/api/client';
import type { Difficulty, Domain } from '@/api/types';
import { Bar } from '@/components/charts';
import { DomainIcon, LabRow, domainLabel } from '@/components/domain';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, Segmented } from '@/components/ui';
import { catalogRoute } from '@/router';
import { cn, formatMinutes, titleCase } from '@/lib/utils';

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const DURATIONS = [20, 30, 45];

export function Catalog() {
  const search = catalogRoute.useSearch();
  const navigate = useNavigate({ from: catalogRoute.fullPath });
  const catalog = useCatalog();
  // Framework short names for path badges ("RHCSA", not the id "rhcsa-aligned").
  const frameworks = useSkills().data?.frameworks;

  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => clean({ ...prev, ...patch }), replace: true });

  const filtered = useMemo(() => {
    if (!catalog.data) return [];
    const q = search.q?.toLowerCase().trim();
    const path = search.path ? catalog.data.paths.find((p) => p.id === search.path) : undefined;
    return catalog.data.labs.filter((l) => {
      // A selected path supersedes the domain filter: paths may cross domains on purpose.
      if (path) {
        if (!path.labIds.includes(l.id)) return false;
      } else if (search.domain && l.domain !== search.domain) return false;
      if (search.difficulty && l.difficulty !== search.difficulty) return false;
      if (search.maxMinutes && l.estimatedMinutes > search.maxMinutes) return false;
      if (q && !`${l.title} ${l.tags?.join(' ')} ${l.skillIds.join(' ')} ${l.frameworks?.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [catalog.data, search]);

  if (catalog.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (catalog.isError) {
    return (
      <div className="page">
        <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
      </div>
    );
  }

  const { domains, paths } = catalog.data;
  const activePath = search.path ? paths.find((p) => p.id === search.path) : undefined;
  const visiblePaths = paths.filter((p) => !search.domain || p.domain === search.domain);
  const hasFilters = !!(search.q || search.difficulty || search.maxMinutes || search.path);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Catalog</div>
          <h1>{search.domain ? domainLabel[search.domain] : 'All domains'}</h1>
          <p className="muted">
            {catalog.data.labs.length} labs across {paths.length} paths. Every lab runs on a real, isolated topology.
          </p>
        </div>
        <Segmented<Domain | 'all'>
          label="Domain"
          value={search.domain ?? 'all'}
          onChange={(v) => set({ domain: v === 'all' ? undefined : v, path: undefined })}
          options={[
            { value: 'all', label: 'All' },
            ...domains.map((d) => ({ value: d.id, label: (<span className="row" style={{ gap: 6 }}><DomainIcon domain={d.id} size={13} />{d.name}</span>) })),
          ]}
        />
      </header>

      {!search.domain && !hasFilters && (
        <section className="grid-3" aria-label="Domains" style={{ marginBottom: 36 }}>
          {domains.map((d) => (
            <button key={d.id} className="card card-interactive domain-card" onClick={() => set({ domain: d.id })}>
              <span className="domain-card-icon">
                <DomainIcon domain={d.id} size={18} />
              </span>
              <span className="stack" style={{ gap: 3 }}>
                <span className="row-between">
                  <h3>{d.name}</h3>
                  <ArrowRight size={14} className="subtle" />
                </span>
                <span className="small muted">{d.tagline}</span>
                <span className="xs subtle" style={{ marginTop: 6 }}>
                  {d.labCount} labs · {d.pathCount} {d.pathCount === 1 ? 'path' : 'paths'}
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      {visiblePaths.length > 0 && !activePath && (
        <section className="page-section" aria-labelledby="paths" style={{ marginTop: 0 }}>
          <div className="section-header">
            <div>
              <h2 id="paths">Paths</h2>
              <p className="muted small">Ordered sequences aligned to a certification blueprint.</p>
            </div>
          </div>
          <div className={cn(visiblePaths.length >= 3 ? 'grid-3' : 'grid-2')}>
            {visiblePaths.map((p) => (
              <button key={p.id} className="card card-interactive path-card" onClick={() => set({ path: p.id, domain: p.domain })}>
                <div className="row-between">
                  <span className="row xs subtle" style={{ gap: 6 }}>
                    <DomainIcon domain={p.domain} size={12} /> {domainLabel[p.domain]}
                  </span>
                  {p.framework && <Badge tone="outline">{frameworks?.find((f) => f.id === p.framework)?.name ?? p.framework.toUpperCase()}</Badge>}
                </div>
                <h3 style={{ marginTop: 10 }}>{p.title}</h3>
                <p className="small muted" style={{ marginTop: 4, flex: 1 }}>
                  {p.description}
                </p>
                <div className="stack" style={{ gap: 6, marginTop: 14 }}>
                  <div className="row-between xs subtle">
                    <span>
                      {p.labIds.length} labs · {formatMinutes(p.estimatedMinutes)}
                    </span>
                    <span className="tnum">{progressLabel(p.progress)}</span>
                  </div>
                  <Bar value={p.progress} thin tone={p.progress === 1 ? 'ok' : p.progress === 0 ? 'neutral' : 'accent'} />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="page-section" aria-labelledby="labs">
        <div className="section-header" style={{ alignItems: 'center' }}>
          <div className="row" style={{ gap: 10 }}>
            <h2 id="labs">{activePath ? activePath.title : 'Labs'}</h2>
            <span className="subtle small tnum">{filtered.length}</span>
            {activePath && (
              <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => set({ path: undefined })}>
                Clear path
              </Button>
            )}
          </div>
          <div className="row filters" style={{ gap: 8 }}>
            <label className="search-field">
              <Search size={13} aria-hidden />
              <input className="search-input" placeholder="Search title, tag, skill…" value={search.q ?? ''} onChange={(e) => set({ q: e.target.value || undefined })} aria-label="Search labs" />
            </label>
            <span className="vdivider" style={{ height: 18 }} />
            <SlidersHorizontal size={13} className="subtle" aria-hidden />
            <div className="chip-group" role="group" aria-label="Difficulty">
              {DIFFS.map((d) => (
                <button key={d} className={cn('chip', search.difficulty === d && 'is-on')} aria-pressed={search.difficulty === d} onClick={() => set({ difficulty: search.difficulty === d ? undefined : d })}>
                  {titleCase(d)}
                </button>
              ))}
            </div>
            <div className="chip-group" role="group" aria-label="Maximum duration">
              {DURATIONS.map((m) => (
                <button key={m} className={cn('chip', search.maxMinutes === m && 'is-on')} aria-pressed={search.maxMinutes === m} onClick={() => set({ maxMinutes: search.maxMinutes === m ? undefined : m })}>
                  <Clock size={11} /> ≤ {m}m
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
                <span>{activePath.labIds.length} labs</span>
                <span>{formatMinutes(activePath.estimatedMinutes)}</span>
                <span>{progressLabel(activePath.progress, true)}</span>
              </div>
            </div>
            <div className="path-banner-bar">
              <Bar value={activePath.progress} tone={activePath.progress === 0 ? 'neutral' : 'accent'} />
            </div>
          </Card>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            title="No labs match these filters"
            description="Try widening the duration or clearing the difficulty filter."
            action={
              <Button variant="secondary" size="sm" onClick={() => set({ q: undefined, difficulty: undefined, maxMinutes: undefined })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <Card className="card-flush">
            <ul className="lab-list">
              {(activePath ? activePath.labIds.map((id) => filtered.find((l) => l.id === id)).filter((x): x is NonNullable<typeof x> => !!x) : filtered).map((l) => (
                <li key={l.id}>
                  <LabRow lab={l} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {search.domain && (
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

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/** A path nobody has started is "not started", not "0%". */
function progressLabel(progress: number, long = false): string {
  if (progress <= 0) return 'not started';
  if (progress >= 1) return 'done';
  return `${Math.round(progress * 100)}%${long ? ' complete' : ''}`;
}
