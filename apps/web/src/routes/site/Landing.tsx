import { Link } from '@tanstack/react-router';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMe } from '@/api/client';
import { isInternalHref, usePublicCatalog, useSite } from '@/api/public';
import type { PublicCatalog, SiteConfig, SiteCta } from '@/api/types';
import { DomainIcon } from '@/components/domain';
import { PageSkeleton } from '@/components/ui';
import { MockSignIn } from '@/site/MockSignIn';
import { FeatureIcon, SiteAnchor, SiteShot, useDocumentTitle } from '@/site/util';

/**
 * The landing page for visitors (`/` while signed out). Sections, in order: the
 * hero with a real product preview, the six domains with live counts from the
 * public catalog, how a lab works, the three differentiators (plus the secondary
 * capabilities), the product showcase, who the platform is for, the featured
 * questions and the closing call to action. Every word comes from the site
 * configuration (content/site.yaml); every figure from the catalog API.
 */
export function Landing() {
  const site = useSite();
  const catalog = usePublicCatalog(site.data?.flags.showCatalog !== false);
  useDocumentTitle();
  if (site.isPending) {
    // Tall enough to keep the footer below the fold, so the page does not shift when the content arrives.
    return (
      <div className="site-container site-section site-pending">
        <PageSkeleton />
      </div>
    );
  }
  if (site.isError || !site.data) {
    return (
      <div className="site-container site-section">
        <p className="muted">The website configuration could not be loaded.</p>
      </div>
    );
  }
  const s = site.data;
  const cat = catalog.data;
  const featured = s.faq.filter((f) => f.featured).slice(0, 6);
  return (
    <>
      <Hero site={s} cat={cat} />
      {s.flags.showCatalog && cat && <Domains site={s} cat={cat} />}
      <HowItWorks site={s} />
      {(s.differentiators?.length || s.features.length) > 0 && <Differentiators site={s} />}
      {s.showcase && s.showcase.length > 0 && <Showcase site={s} />}
      {s.audiences && s.audiences.length > 0 && <Audiences site={s} />}
      {featured.length > 0 && <Trust items={featured} />}
      <ClosingCta site={s} />
    </>
  );
}

/** A configured call to action; `/sign-in` turns into "Go to dashboard" for signed-in visitors. */
export function Cta({ cta, variant = 'primary', size = 'lg' }: { cta: SiteCta; variant?: 'primary' | 'secondary'; size?: 'md' | 'lg' | 'xl' }) {
  const me = useMe();
  const cls = `btn btn-${variant} btn-${size}`;
  const arrow = size === 'xl' ? 16 : 14;
  if (cta.to === '/sign-in' && me.isSuccess) {
    return (
      <Link to="/" className={cls}>
        <LayoutDashboard size={arrow} aria-hidden /> Go to dashboard
      </Link>
    );
  }
  if (isInternalHref(cta.to)) {
    return (
      <SiteAnchor to={cta.to} className={cls}>
        {cta.label} <ArrowRight size={arrow} aria-hidden />
      </SiteAnchor>
    );
  }
  return (
    <SiteAnchor to={cta.to} className={cls}>
      {cta.label}
    </SiteAnchor>
  );
}

function SectionHead({ id, eyebrow, title, lead, action }: { id: string; eyebrow?: string; title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="site-section-head">
      <div className="site-section-head-copy">
        {eyebrow && <p className="site-eyebrow">{eyebrow}</p>}
        <h2 id={id} className="site-h2">
          {title}
        </h2>
        {lead && <p className="site-section-lead">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- hero */

function Hero({ site, cat }: { site: SiteConfig; cat: PublicCatalog | undefined }) {
  const h = site.hero;
  const all: [number, string][] = cat
    ? [
        [cat.labs.length, 'labs'],
        [cat.domains.filter((d) => d.labCount > 0).length, 'domains'],
        [cat.exams.length, 'exam simulations'],
      ]
    : [];
  const figures = all.filter(([n]) => n > 0);
  const proof = h.proof ?? [];
  return (
    <section className="site-hero" aria-labelledby="hero-title">
      <div className="site-container site-hero-inner">
        <div className="site-hero-copy">
          {h.eyebrow && <p className="site-eyebrow">{h.eyebrow}</p>}
          <h1 id="hero-title" className="site-h1">
            {h.title}
          </h1>
          <p className="site-lead">{h.subtitle}</p>
          <div className="site-hero-actions">
            {h.primaryCta && <Cta cta={h.primaryCta} size="xl" />}
            {h.secondaryCta && <Cta cta={h.secondaryCta} variant="secondary" size="xl" />}
          </div>
          {h.note && <p className="site-note">{h.note}</p>}
          {(figures.length > 0 || proof.length > 0) && (
            <ul className="site-proof" aria-label="At a glance">
              {proof.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {/* The live figures arrive after the configuration; appended, so the items before them never move. */}
              {figures.map(([n, label]) => (
                <li key={label}>
                  <span className="site-proof-n tnum">{n.toLocaleString('en')}</span> {label}
                </li>
              ))}
            </ul>
          )}
          <MockSignIn />
        </div>
        {h.preview && (
          <div className="site-hero-preview">
            <SiteShot figure={h.preview} priority sizes="(max-width: 1023px) 100vw, 640px" />
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- domains */

function Domains({ site, cat }: { site: SiteConfig; cat: PublicCatalog }) {
  const domains = site.highlightDomains.map((id) => cat.domains.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d && d.labCount > 0);
  if (domains.length === 0) return null;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <section className="site-section" id="domains" aria-labelledby="domains-title">
      <div className="site-container">
        <SectionHead
          id="domains-title"
          eyebrow="Catalog"
          title={`Explore the ${domains.length === 6 ? 'six ' : ''}domains`}
          lead="Every domain runs on the substrate it needs: pods, virtual machines, kubeadm or virtual clusters, or network devices on real wires."
          action={
            <Link to="/catalog" search={{}} className="btn btn-secondary btn-lg site-section-action">
              Browse the catalog <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        <ul className="site-domain-grid" aria-label="Domains">
          {domains.map((d) => (
            <li key={d.id}>
              <Link to="/catalog" search={{ domain: d.id }} className="site-domain-card">
                <span className="site-icon-tile" aria-hidden>
                  <DomainIcon domain={d.id} size={20} />
                </span>
                <span className="site-domain-card-body">
                  <span className="site-domain-card-title">
                    <h3>{d.name}</h3>
                    <ArrowRight size={16} className="site-domain-card-arrow" aria-hidden />
                  </span>
                  <span className="site-domain-card-text">{d.tagline}</span>
                  <span className="site-meta">
                    {plural(d.labCount, 'lab', 'labs')}
                    {d.pathCount > 0 && ` · ${plural(d.pathCount, 'path', 'paths')}`}
                    {d.examCount > 0 && ` · ${plural(d.examCount, 'exam simulation', 'exam simulations')}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- how it works */

function HowItWorks({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section site-section-alt" id="how-it-works" aria-labelledby="how-title">
      <div className="site-container">
        <SectionHead id="how-title" eyebrow="The loop" title="How a lab works" lead="Choose a problem, operate a real system, prove the outcome. Provisioning, access and reset depend on the lab type; the grading never does." />
        <ol className="site-steps">
          {site.howItWorks.map((step, i) => (
            <li key={step.title} className="site-step">
              <div className="site-step-head">
                <span className="site-step-n tnum">{String(i + 1).padStart(2, '0')}</span>
                {step.icon && (
                  <span className="site-step-icon" aria-hidden>
                    <FeatureIcon icon={step.icon} size={18} />
                  </span>
                )}
              </div>
              <h3>{step.title}</h3>
              <p className="site-step-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------ differentiators */

function Differentiators({ site }: { site: SiteConfig }) {
  const diffs = site.differentiators ?? [];
  return (
    <section className="site-section" id="why" aria-labelledby="why-title">
      <div className="site-container">
        <SectionHead id="why-title" eyebrow="Why it works" title="What makes CloudTrain different" />
        {diffs.length > 0 && (
          <div className="site-diff-grid">
            {diffs.map((d) => (
              <article key={d.title} className="site-diff">
                {d.figure && <SiteShot figure={d.figure} className="site-diff-figure" sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 380px" />}
                <div className="site-diff-body">
                  {d.icon && (
                    <span className="site-icon-tile site-icon-tile-sm" aria-hidden>
                      <FeatureIcon icon={d.icon} size={16} />
                    </span>
                  )}
                  <h3>{d.title}</h3>
                  <p>{d.body}</p>
                </div>
              </article>
            ))}
          </div>
        )}
        {site.features.length > 0 && (
          <div className="site-also">
            <h3 className="site-also-title">Also on the platform</h3>
            <ul className="site-feature-list">
              {site.features.map((f) => (
                <li key={f.title} className="site-feature">
                  <span className="site-feature-icon" aria-hidden>
                    <FeatureIcon icon={f.icon} size={16} />
                  </span>
                  <span className="site-feature-text">
                    <strong>{f.title}</strong>
                    <span>{f.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- showcase */

function Showcase({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section site-section-alt" id="showcase" aria-labelledby="showcase-title">
      <div className="site-container">
        <SectionHead id="showcase-title" eyebrow="A look inside" title="The platform as learners and managers see it" lead="Real screens from the product, in the theme you are reading this in." />
        <div className="site-showcase">
          {site.showcase!.map((item, i) => (
            <article key={item.title} className="site-showcase-item" aria-labelledby={`showcase-${i}`}>
              <div className="site-showcase-copy">
                <h3 id={`showcase-${i}`}>{item.title}</h3>
                <p>{item.body}</p>
                {item.why && <p className="site-showcase-why">{item.why}</p>}
              </div>
              <SiteShot figure={item.figure} className="site-showcase-figure" sizes="(max-width: 1023px) 100vw, 760px" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ audiences */

function Audiences({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section" id="who" aria-labelledby="who-title">
      <div className="site-container">
        <SectionHead id="who-title" eyebrow="Who it is for" title="One platform, three ways in" />
        <div className="site-audience-grid">
          {site.audiences!.map((a, i) => (
            <article key={a.title} className="site-audience" id={i === site.audiences!.length - 1 ? 'teams' : undefined}>
              {a.icon && (
                <span className="site-icon-tile" aria-hidden>
                  <FeatureIcon icon={a.icon} size={20} />
                </span>
              )}
              <h3>{a.title}</h3>
              <p>{a.body}</p>
              {a.points && a.points.length > 0 && (
                <ul className="site-points">
                  {a.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="site-audience-cta">
                <Cta cta={a.cta} variant="secondary" size="lg" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- trust */

function Trust({ items }: { items: SiteConfig['faq'] }) {
  return (
    <section className="site-section site-section-alt" id="questions" aria-labelledby="trust-title">
      <div className="site-container">
        <SectionHead
          id="trust-title"
          eyebrow="Straight answers"
          title="Before you start"
          action={
            <Link to="/faq" className="btn btn-secondary btn-lg site-section-action">
              All questions <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        <dl className="site-qa">
          {items.map((f) => (
            <div key={f.q} className="site-qa-item">
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- closing */

function ClosingCta({ site }: { site: SiteConfig }) {
  const c = site.closing;
  const primary = c?.primaryCta ?? site.hero.primaryCta;
  const secondary = c?.secondaryCta ?? site.hero.secondaryCta;
  return (
    <section className="site-section" aria-labelledby="cta-title">
      <div className="site-container">
        <div className="site-closing">
          <div className="site-closing-copy">
            <h2 id="cta-title" className="site-h2">
              {c?.title ?? site.brand.tagline}
            </h2>
            {c?.body && <p className="site-section-lead">{c.body}</p>}
          </div>
          <div className="site-hero-actions">
            {primary && <Cta cta={primary} size="xl" />}
            {secondary && <Cta cta={secondary} variant="secondary" size="xl" />}
          </div>
        </div>
      </div>
    </section>
  );
}
