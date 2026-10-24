import { ArrowRight } from 'lucide-react';
import { usePublicCatalog, useSite } from '@/api/public';
import type { PublicCatalog, SiteConfig } from '@/api/types';
import { PageSkeleton } from '@/components/ui';
import { CsLink as Section } from './ComingSoonChrome';
import { DomainMarquee } from './Flourish';
import { HeroStory } from './LabStory';
import { ComputeTiers, Estimator, PlanComparison, PricingPaths, PricingSteps, WorkedExamples } from './PricingModel';
import { FeatureIcon, useDocumentTitle } from './util';
import { WaitlistSection } from './Waitlist';

/*
 * The coming-soon website (content/site.yaml `launch.mode: coming-soon`, see
 * src/site/launch.ts): one standalone page with what the platform is, how
 * pricing works, the early-access waitlist and the questions, in its own chrome
 * (brand, section links, theme, "Join the waitlist"). Nothing on it leads into
 * the platform: no sign-in, no checkout, no catalog. The legal pages keep their
 * own routes inside the same chrome.
 */

export function ComingSoon() {
  const site = useSite();
  const catalog = usePublicCatalog(site.data?.flags.showCatalog !== false);
  useDocumentTitle(site.data?.launch?.status ? undefined : 'Coming soon');
  if (site.isPending) {
    return (
      <div className="site-container site-section site-pending">
        <PageSkeleton />
      </div>
    );
  }
  if (!site.data) {
    return (
      <div className="site-container site-section">
        <p className="muted">The website configuration could not be loaded.</p>
      </div>
    );
  }
  const s = site.data;
  return (
    <>
      <Hero site={s} />
      {s.flags.showCatalog !== false && <DomainMarquee site={s} cat={catalog.data} label="Domains at launch" />}
      <What site={s} cat={catalog.data} />
      <PricingExplained site={s} />
      <WaitlistSection site={s} />
      <Questions site={s} />
    </>
  );
}

function Hero({ site }: { site: SiteConfig }) {
  const l = site.launch;
  return (
    <HeroStory site={site} className="cs-hero">
      {l?.status && (
        <p className="cs-status">
          <span className="cs-status-dot" aria-hidden /> {l.status}
        </p>
      )}
      <h1 id="hero-title" className="site-h1 site-display">
        {l?.title ?? site.hero.title}
      </h1>
      <p className="site-lead">{l?.subtitle ?? site.hero.subtitle}</p>
      <div className="site-hero-actions">
        {site.waitlist?.enabled && (
          <Section id="waitlist" className="btn btn-primary btn-xl">
            {l?.ctaLabel ?? 'Join the waitlist'} <ArrowRight size={16} aria-hidden />
          </Section>
        )}
        {site.pricing?.model && (
          <Section id="pricing" className="btn btn-secondary btn-xl">
            How pricing works
          </Section>
        )}
      </div>
    </HeroStory>
  );
}

function What({ site, cat }: { site: SiteConfig; cat: PublicCatalog | undefined }) {
  const points = site.launch?.points ?? [];
  const figures: [number, string][] = cat
    ? (
        [
          [cat.labs.length, 'hands-on labs'],
          [cat.paths.length, 'paths and courses'],
          [cat.exams.length, 'exam simulations'],
          [cat.domains.filter((d) => d.labCount > 0).length, 'domains'],
        ] as [number, string][]
      ).filter(([n]) => n > 0)
    : [];
  if (points.length === 0 && figures.length === 0) return null;
  return (
    <section className="site-section" id="what" aria-labelledby="what-title">
      <div className="site-container">
        <div className="site-section-head">
          <div className="site-section-head-copy" data-reveal="children">
            <p className="site-eyebrow">{site.launch?.eyebrow ?? 'What it is'}</p>
            <h2 id="what-title" className="site-h2">
              {site.brand.tagline}
            </h2>
            <p className="site-section-lead">{site.hero.subtitle}</p>
          </div>
        </div>
        {figures.length > 0 && (
          <dl className="site-stats" aria-label="Ready at launch" data-reveal="children">
            {figures.map(([n, label]) => (
              <div key={label} className="site-stat">
                <dt>{label}</dt>
                <dd className="tnum" data-count>
                  {n.toLocaleString('en')}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {points.length > 0 && (
          <ul className="cs-points" data-reveal="children">
            {points.map((p) => (
              <li key={p.title} className="cs-point">
                {p.icon && (
                  <span className="site-icon-tile" aria-hidden>
                    <FeatureIcon icon={p.icon} size={18} />
                  </span>
                )}
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function PricingExplained({ site, id = 'pricing', headingLevel = 2 }: { site: SiteConfig; id?: string; headingLevel?: 1 | 2 }) {
  const m = site.pricing?.model;
  if (!m) return null;
  const H = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className="site-section site-section-alt pm" id={id} aria-labelledby={`${id}-title`}>
      <div className="site-container">
        <div className="site-section-head pm-head">
          <div className="site-section-head-copy" data-reveal="children">
            <p className="site-eyebrow">{m.eyebrow ?? 'Pricing'}</p>
            <H id={`${id}-title`} className={headingLevel === 1 ? 'site-h1 site-display' : 'site-h2'}>
              {m.title}
            </H>
            {m.intro && <p className="site-section-lead">{m.intro}</p>}
          </div>
        </div>
        <PricingPaths site={site} />
        {m.paths && m.paths.length > 0 && <h3 className="pm-subhead">The hosted service, step by step</h3>}
        <PricingSteps model={m} />
        <h3 className="pm-subhead">Compute, by the minute</h3>
        <ComputeTiers site={site} />
        <div className="pm-split">
          <Estimator site={site} />
          <div className="pm-split-examples">
            <h3 className="pm-subhead pm-subhead-tight">Worked examples</h3>
            <WorkedExamples site={site} />
          </div>
        </div>
        {site.plans && site.plans.items.length > 0 && (
          <>
            <h3 className="pm-subhead">Hosted plans compared</h3>
            <PlanComparison site={site} />
          </>
        )}
      </div>
    </section>
  );
}

function Questions({ site }: { site: SiteConfig }) {
  const groups = site.launch?.faqGroups;
  const pricingGroup = site.pricing?.faqGroup;
  const items = groups?.length ? site.faq.filter((f) => f.group && groups.includes(f.group)) : site.faq.filter((f) => f.featured || (pricingGroup && f.group === pricingGroup));
  if (items.length === 0) return null;
  return (
    <section className="site-section" id="faq" aria-labelledby="faq-title">
      <div className="site-container cs-faq">
        <div className="site-section-head-copy" data-reveal="children">
          <p className="site-eyebrow">Questions</p>
          <h2 id="faq-title" className="site-h2">
            Straight answers
          </h2>
          {site.contact.email && (
            <p className="site-section-lead">
              Something else? Write to <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>.
            </p>
          )}
        </div>
        <div className="site-faq" data-reveal="children">
          {items.map((f) => (
            <details key={f.q} className="site-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
