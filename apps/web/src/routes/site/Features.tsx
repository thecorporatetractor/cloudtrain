import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSite } from '@/api/public';
import type { SiteFeatureItem } from '@/api/types';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { FeatureShot, Lightbox, featureGroups, featureId, type LightboxEntry } from '@/site/Features';
import { useDocumentTitle } from '@/site/util';

/**
 * The features page (`/features`): every feature of the product with a heading, a
 * short description, which plans include it, and its screens, in the configured
 * groups (content/site.yaml `featurePage`). The screens follow the visitor's theme
 * and open enlarged in a lightbox (src/site/Features.tsx). The page scrolls freely,
 * like the legal texts (`data-no-stops`, src/site/motion/stops.ts), and keeps its own
 * page in coming-soon mode (src/site/launch.ts).
 */
export function Features() {
  const site = useSite();
  useDocumentTitle('Features');
  const [open, setOpen] = useState<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  if (site.isPending) {
    return (
      <div className="site-container site-page">
        <PageSkeleton />
      </div>
    );
  }
  const page = site.data?.featurePage;
  if (!page) {
    return (
      <div className="site-container site-page site-page-narrow" data-no-stops>
        <header className="site-page-head site-page-head-stack">
          <div className="page-eyebrow">Features</div>
          <h1 className="site-h1">Features</h1>
          <p className="muted site-lead-sm">This website has no features page configured.</p>
        </header>
      </div>
    );
  }
  const groups = featureGroups(page);
  // Every screen of the page in reading order, so the lightbox steps through all of them.
  const entries: LightboxEntry[] = [];
  const at = new Map<SiteFeatureItem, number>();
  for (const g of groups) {
    for (const it of g.items) {
      at.set(it, entries.length);
      for (const figure of it.figures) entries.push({ figure, title: it.title });
    }
  }
  return (
    <div className="site-container site-page site-features" data-no-stops>
      <header className="site-page-head site-page-head-stack site-features-head" data-reveal="children">
        <div className="page-eyebrow">{page.eyebrow ?? 'Features'}</div>
        <h1 className="site-h1">{page.title}</h1>
        {page.intro && <p className="muted site-lead-sm">{page.intro}</p>}
      </header>
      {groups.map((g) => (
        <section key={g.id} id={g.id} className="site-feature-group" aria-labelledby={`features-${g.id}`}>
          <div className="site-feature-group-head" data-reveal="children">
            <h2 id={`features-${g.id}`} className="site-h2">
              {g.title}
            </h2>
            {g.lead && <p className="site-section-lead">{g.lead}</p>}
          </div>
          <ol className="site-feature-list">
            {g.items.map((it, i) => {
              const first = at.get(it)!;
              return (
                <li key={it.title} id={featureId(it)} className={cn('site-feature', i % 2 === 1 && 'is-flipped')} data-reveal>
                  <div className="site-feature-copy">
                    <h3>{it.title}</h3>
                    <p>{it.body}</p>
                    {it.access && <p className="site-feature-access">{it.access}</p>}
                  </div>
                  <div className={cn('site-feature-shots', it.figures.length > 1 && 'is-many')}>
                    {it.figures.map((figure, j) => (
                      <button
                        key={figure.image}
                        ref={(el) => {
                          thumbs.current[first + j] = el;
                        }}
                        type="button"
                        className="site-feature-thumb"
                        onClick={() => setOpen(first + j)}
                        aria-label={`Enlarge: ${figure.alt}`}
                      >
                        {/* The first screen is in the first viewport: it must not wait for lazy loading. */}
                        <FeatureShot figure={figure} sizes="(max-width: 1023px) 100vw, 740px" priority={first + j === 0} />
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p className="site-feature-foot">
        {site.data?.waitlist?.enabled && (
          <Link to="/" hash="waitlist" className="link-quiet">
            Join the waitlist <ArrowRight size={12} aria-hidden />
          </Link>
        )}
      </p>
      <Lightbox entries={entries} index={open} onChange={setOpen} returnTo={(i) => thumbs.current[i] ?? null} />
    </div>
  );
}
