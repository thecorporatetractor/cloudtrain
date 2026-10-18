import { Link } from '@tanstack/react-router';
import { ArrowRight, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { useMe } from '@/api/client';
import { isInternalHref, usePublicCatalog, useSite } from '@/api/public';
import type { PublicCatalog, SiteConfig, SiteCta } from '@/api/types';
import { DomainIcon } from '@/components/domain';
import { Card, PageSkeleton } from '@/components/ui';
import { FeatureIcon, SiteAnchor, useDocumentTitle } from '@/site/util';

/**
 * The landing page for visitors (`/` while signed out): value proposition, the
 * highlighted domains with live counts from the public catalog, how a lab works,
 * feature blocks, screenshots and a closing call to action. Everything but the
 * counts comes from the site configuration (content/site.yaml).
 */
export function Landing() {
  const site = useSite();
  const catalog = usePublicCatalog(site.data?.flags.showCatalog !== false);
  useDocumentTitle();
  if (site.isPending) {
    return (
      <div className="site-container site-section">
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
  return (
    <>
      <Hero site={s} cat={cat} />
      {s.flags.showCatalog && <Domains site={s} cat={cat} />}
      <HowItWorks site={s} />
      <Features site={s} />
      {s.screenshots && s.screenshots.length > 0 && <Screenshots site={s} />}
      <ClosingCta site={s} />
    </>
  );
}

/** A configured call to action; `/sign-in` turns into "Go to dashboard" for signed-in visitors. */
export function Cta({ cta, variant = 'primary', size = 'lg' }: { cta: SiteCta; variant?: 'primary' | 'secondary'; size?: 'md' | 'lg' }) {
  const me = useMe();
  const cls = `btn btn-${variant} btn-${size}`;
  if (cta.to === '/sign-in' && me.isSuccess) {
    return (
      <Link to="/" className={cls}>
        <LayoutDashboard size={15} aria-hidden /> Go to dashboard
      </Link>
    );
  }
  if (isInternalHref(cta.to)) {
    return (
      <SiteAnchor to={cta.to} className={cls}>
        {cta.label} <ArrowRight size={14} aria-hidden />
      </SiteAnchor>
    );
  }
  return (
    <SiteAnchor to={cta.to} className={cls}>
      {cta.label}
    </SiteAnchor>
  );
}

function Hero({ site, cat }: { site: SiteConfig; cat: PublicCatalog | undefined }) {
  const h = site.hero;
  const stats = cat
    ? [
        [cat.labs.length, 'labs'],
        [cat.paths.filter((p) => p.kind === 'path').length, 'paths'],
        [cat.exams.length, 'exam simulations'],
        [cat.domains.filter((d) => d.labCount > 0).length, 'domains'],
      ]
    : [];
  return (
    <section className="site-hero" aria-labelledby="hero-title">
      <div className="site-container site-hero-inner">
        <div className="site-hero-copy">
          {h.eyebrow && <div className="page-eyebrow">{h.eyebrow}</div>}
          <h1 id="hero-title" className="site-h1">
            {h.title}
          </h1>
          <p className="site-lead">{h.subtitle}</p>
          <div className="site-hero-actions">
            {h.primaryCta && <Cta cta={h.primaryCta} />}
            {h.secondaryCta && <Cta cta={h.secondaryCta} variant="secondary" />}
          </div>
          {h.note && <p className="xs subtle">{h.note}</p>}
        </div>
        {stats.length > 0 && (
          <dl className="site-stats" aria-label="Catalog size">
            {stats.map(([n, label]) => (
              <div key={String(label)} className="site-stat">
                <dt className="site-stat-label">{label}</dt>
                <dd className="site-stat-value tnum">{n}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

function Domains({ site, cat }: { site: SiteConfig; cat: PublicCatalog | undefined }) {
  const domains = site.highlightDomains.map((id) => cat?.domains.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
  if (!cat) return null;
  return (
    <section className="site-section" id="domains" aria-labelledby="domains-title">
      <div className="site-container">
        <div className="site-section-head">
          <h2 id="domains-title" className="site-h2">
            Six domains, one way of learning
          </h2>
          <p className="muted">Every domain runs on the substrate it needs: pods, VMs, kubeadm or virtual clusters, network devices on real wires.</p>
        </div>
        <div className="site-domain-grid">
          {domains.map((d) => (
            <Link key={d.id} to="/catalog" search={{ domain: d.id }} className="card card-interactive domain-card site-domain-card">
              <span className="domain-card-icon">
                <DomainIcon domain={d.id} size={18} />
              </span>
              <span className="stack" style={{ gap: 3, minWidth: 0 }}>
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
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section site-section-alt" id="how-it-works" aria-labelledby="how-title">
      <div className="site-container">
        <div className="site-section-head">
          <h2 id="how-title" className="site-h2">
            How a lab works
          </h2>
        </div>
        <ol className="site-steps">
          {site.howItWorks.map((step, i) => (
            <li key={step.title} className="site-step">
              <span className="site-step-n tnum" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{step.title}</h3>
              <p className="small muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section" id="features" aria-labelledby="features-title">
      <div className="site-container">
        <div className="site-section-head">
          <h2 id="features-title" className="site-h2">
            What makes it different
          </h2>
        </div>
        <div className="site-feature-grid">
          {site.features.map((f) => (
            <Card key={f.title} className="site-feature">
              <span className="site-feature-icon">
                <FeatureIcon icon={f.icon} />
              </span>
              <h3>{f.title}</h3>
              <p className="small muted">{f.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Screenshots({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section site-section-alt" id="screenshots" aria-labelledby="shots-title">
      <div className="site-container">
        <div className="site-section-head">
          <h2 id="shots-title" className="site-h2">
            A look inside
          </h2>
          <p className="muted">The platform as learners, managers and instructors see it. Three themes: dark, light and cream.</p>
        </div>
        <div className="site-shots">
          {site.screenshots!.map((shot) => (
            <figure key={shot.image} className="site-shot">
              <img src={shot.image} alt={shot.alt} loading="lazy" />
              {shot.caption && <figcaption className="xs subtle">{shot.caption}</figcaption>}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCta({ site }: { site: SiteConfig }) {
  const h = site.hero;
  return (
    <section className="site-section" aria-labelledby="cta-title">
      <div className="site-container">
        <Card className="site-cta">
          <div className="stack" style={{ gap: 6 }}>
            <h2 id="cta-title" className="site-h2">
              Ready when you are
            </h2>
            <p className="muted">{site.brand.tagline}. Browse the catalog, or sign in with your organisation's identity provider.</p>
            <p className="xs subtle row" style={{ gap: 6 }}>
              <ShieldCheck size={12} aria-hidden /> Sessions are isolated per learner and destroyed afterwards.
            </p>
          </div>
          <div className="site-hero-actions">
            {h.primaryCta && <Cta cta={h.primaryCta} />}
            {h.secondaryCta && <Cta cta={h.secondaryCta} variant="secondary" />}
          </div>
        </Card>
      </div>
    </section>
  );
}
