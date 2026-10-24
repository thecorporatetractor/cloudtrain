import { Link } from '@tanstack/react-router';
import { ArrowRight, Clock, LayoutDashboard } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMe } from '@/api/client';
import { isInternalHref, usePublicCatalog, useSite } from '@/api/public';
import type { PublicCatalog, SiteConfig, SiteCta, SiteFeatureBlock, SiteFeatureIcon } from '@/api/types';
import { DomainIcon } from '@/components/domain';
import { PageSkeleton } from '@/components/ui';
import { formatMinutes } from '@/lib/pricingModel';
import { cn } from '@/lib/utils';
import { DomainMarquee } from '@/site/Flourish';
import { HeroStory } from '@/site/LabStory';
import { ComputeTiers, PricingPaths, PricingSteps } from '@/site/PricingModel';
import { SocialProof } from '@/site/SocialProof';
import { FeatureIcon, SiteAnchor, SiteShot, useDocumentTitle } from '@/site/util';
import { WaitlistSection } from '@/site/Waitlist';

/**
 * The landing page for visitors (`/` while signed out, launch mode `live`).
 * Sections, in order: the hero and the story of a lab (the lab window stays in
 * view while the four stages of a lab scroll past it, src/site/LabStory.tsx), a
 * band of the domains, what makes the platform different (a bento of the
 * differentiators and capabilities), catalog highlights with live figures, a
 * product tour of real screens, how pricing works, who it is for, social proof,
 * the waitlist, the featured questions and the closing call to action. Every
 * word comes from the site configuration (content/site.yaml); every figure from
 * the catalog API and the plans.
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
      {s.flags.showCatalog && <DomainMarquee site={s} cat={cat} />}
      {(s.differentiators?.length || s.features.length) > 0 && <Bento site={s} />}
      {s.flags.showCatalog && cat && <CatalogHighlights site={s} cat={cat} />}
      {s.showcase && s.showcase.length > 0 && <Tour site={s} />}
      {s.pricing?.model && <PricingTeaser site={s} />}
      {s.audiences && s.audiences.length > 0 && <Audiences site={s} />}
      <SocialProof site={s} />
      <WaitlistSection site={s} />
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

function SectionHead({ id, eyebrow, title, lead, action, n }: { id: string; eyebrow?: string; title: string; lead?: ReactNode; action?: ReactNode; n?: number }) {
  return (
    <div className="site-section-head">
      <div className="site-section-head-copy" data-reveal="children">
        {eyebrow && (
          <p className="site-eyebrow">
            {n !== undefined && <span className="site-eyebrow-n tnum">{String(n).padStart(2, '0')}</span>}
            {eyebrow}
          </p>
        )}
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
    <HeroStory site={site}>
      {h.eyebrow && <p className="site-eyebrow site-eyebrow-chip">{h.eyebrow}</p>}
      <h1 id="hero-title" className="site-h1 site-display">
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
    </HeroStory>
  );
}

/* ---------------------------------------------------------------- bento */

/** A small drawing for a capability, picked by its icon; decorative. */
function Vignette({ icon }: { icon: SiteFeatureIcon }) {
  if (icon === 'graduation' || icon === 'timer')
    return (
      <div className="vg vg-exam" aria-hidden>
        <svg viewBox="0 0 44 44" className="vg-ring">
          <circle cx="22" cy="22" r="18" />
          <circle cx="22" cy="22" r="18" className="vg-ring-on" pathLength="100" strokeDasharray="68 100" />
        </svg>
        <div className="vg-bars">
          {[82, 64, 91, 47].map((w, i) => (
            <span key={i}>
              <i style={{ width: `${w}%` }} />
            </span>
          ))}
        </div>
        <span className="vg-time tnum">1:47:12</span>
      </div>
    );
  if (icon === 'flag')
    return (
      <ol className="vg vg-board" aria-hidden>
        {[
          ['blue-team', 1450],
          ['night-shift', 1210],
          ['you', 980],
        ].map(([n, p], i) => (
          <li key={n} className={i === 2 ? 'is-you' : undefined}>
            <span className="tnum">{i + 1}</span>
            {n}
            <span className="tnum">{p}</span>
          </li>
        ))}
      </ol>
    );
  if (icon === 'sparkles' || icon === 'chart')
    return (
      <div className="vg vg-heat" aria-hidden>
        {[3, 4, 2, 1, 4, 3, 2, 4, 1, 3, 4, 2, 2, 3, 4, 1, 3, 2, 4, 3, 1, 2, 3, 4].map((v, i) => (
          <i key={i} style={{ opacity: 0.15 + v * 0.2 }} />
        ))}
      </div>
    );
  if (icon === 'users' || icon === 'building' || icon === 'lock')
    return (
      <div className="vg vg-sso" aria-hidden>
        <span className="vg-chip">Entra ID</span>
        <span className="vg-chip">Okta</span>
        <span className="vg-chip">Keycloak</span>
        <span className="vg-arrow">OIDC →</span>
        <span className="vg-chip vg-chip-on">learner</span>
        <span className="vg-chip vg-chip-on">manager</span>
        <span className="vg-chip vg-chip-on">admin</span>
      </div>
    );
  return null;
}

function Bento({ site }: { site: SiteConfig }) {
  const diffs = site.differentiators ?? [];
  const feats: SiteFeatureBlock[] = site.features;
  // Six columns: the first differentiator spans four, every other card two. The last row is
  // filled by widening its cards (two of two become two of three, one becomes the whole row).
  const units = (diffs.length > 0 ? 4 + (diffs.length - 1) * 2 : 0) + feats.length * 2;
  const rest = units % 6;
  const widen = (i: number) => (rest === 4 && i >= feats.length - 2 ? 'bento-span-3' : rest === 2 && i === feats.length - 1 ? 'bento-span-6' : undefined);
  return (
    <section className="site-section" id="why" aria-labelledby="why-title">
      <div className="site-container">
        <SectionHead
          id="why-title"
          n={1}
          eyebrow="Why it works"
          title="Real systems. Real grading. Real progress."
          lead="No simulated shells and no multiple choice: every lab is a live environment, every grade is read from the system you leave behind."
        />
        <div className="bento" data-reveal="children">
          {diffs.map((d, i) => (
            <article key={d.title} className={cn('bento-card bento-diff', i === 0 && 'bento-wide')}>
              <div className="bento-copy">
                {d.icon && (
                  <span className="site-icon-tile site-icon-tile-sm" aria-hidden>
                    <FeatureIcon icon={d.icon} size={16} />
                  </span>
                )}
                <h3>{d.title}</h3>
                <p>{d.body}</p>
              </div>
              {d.figure && <SiteShot figure={d.figure} className="bento-shot" sizes={i === 0 ? '(max-width: 1023px) 100vw, 760px' : '(max-width: 1023px) 100vw, 380px'} />}
            </article>
          ))}
          {feats.map((f, i) => (
            <article key={f.title} className={cn('bento-card bento-feat', widen(i))}>
              <Vignette icon={f.icon} />
              <div className="bento-copy">
                <span className="site-icon-tile site-icon-tile-sm" aria-hidden>
                  <FeatureIcon icon={f.icon} size={16} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- catalog highlights */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

function CatalogHighlights({ site, cat }: { site: SiteConfig; cat: PublicCatalog }) {
  const domains = site.highlightDomains.map((id) => cat.domains.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d && d.labCount > 0);
  if (domains.length === 0) return null;
  const maxLabs = Math.max(...domains.map((d) => d.labCount));
  const paths = cat.paths.filter((p) => p.kind === 'path').slice(0, 4);
  const stats: [number, string][] = (
    [
      [cat.labs.length, 'hands-on labs'],
      [cat.paths.length, 'paths and courses'],
      [cat.exams.length, 'exam simulations'],
      [domains.length, 'domains'],
    ] as [number, string][]
  ).filter(([n]) => n > 0);
  return (
    <section className="site-section" id="domains" aria-labelledby="domains-title">
      <div className="site-container">
        <SectionHead
          id="domains-title"
          n={2}
          eyebrow="Catalog"
          title="Everything you can practise"
          lead="Every domain runs on the substrate it needs: pods, virtual machines, kubeadm or virtual clusters, or network devices on real wires."
          action={
            <Link to="/catalog" search={{}} className="btn btn-secondary btn-lg site-section-action">
              Browse the catalog <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        <dl className="site-stats" aria-label="The catalog in numbers" data-reveal="children">
          {stats.map(([n, label]) => (
            <div key={label} className="site-stat">
              <dt>{label}</dt>
              <dd className="tnum" data-count>
                {n.toLocaleString('en')}
              </dd>
            </div>
          ))}
        </dl>
        <ul className="site-domain-grid" aria-label="Domains" data-reveal="children">
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
                  <span className="site-domain-bar" aria-hidden>
                    <i
                      data-grow
                      style={{
                        width: `${Math.max(8, Math.round((d.labCount / maxLabs) * 100))}%`,
                      }}
                    />
                  </span>
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
        {paths.length > 0 && (
          <div className="site-paths-strip" data-reveal>
            <h3 className="site-paths-title">Learning paths</h3>
            <ul>
              {paths.map((p) => (
                <li key={p.id}>
                  <Link to="/catalog/paths/$pathId" params={{ pathId: p.id }} className="site-path-pill">
                    <DomainIcon domain={p.domain} size={14} aria-hidden />
                    <span className="site-path-pill-title">{p.title}</span>
                    <span className="site-meta">
                      {plural(p.labCount, 'lab', 'labs')} · <Clock size={11} aria-hidden /> {formatMinutes(p.estimatedMinutes)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the tour */

function Tour({ site }: { site: SiteConfig }) {
  const items = site.showcase!;
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (active + d + items.length) % items.length;
    setActive(next);
    tabs.current[next]?.focus();
  };
  const item = items[active]!;
  return (
    <section className="site-section site-section-alt" id="showcase" aria-labelledby="showcase-title">
      <div className="site-container">
        <SectionHead id="showcase-title" n={3} eyebrow="A look inside" title="The platform as learners and managers see it" lead="Real screens from the product, in the theme you are reading this in." />
        <div className="tour" data-reveal="children">
          <div className="tour-tabs" role="tablist" aria-label="Product tour" onKeyDown={onKey}>
            {items.map((it, i) => (
              <button
                key={it.title}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`tour-tab-${i}`}
                aria-selected={i === active}
                aria-controls="tour-panel"
                tabIndex={i === active ? 0 : -1}
                className={cn('tour-tab', i === active && 'is-active')}
                onClick={() => setActive(i)}
              >
                <span className="tour-tab-n tnum">{String(i + 1).padStart(2, '0')}</span>
                <span className="tour-tab-copy">
                  <strong>{it.title}</strong>
                  <span>{it.body}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="tour-panel" role="tabpanel" id="tour-panel" aria-labelledby={`tour-tab-${active}`}>
            <SiteShot key={item.figure.image} figure={item.figure} className="tour-shot" sizes="(max-width: 1023px) 100vw, 760px" />
            {item.why && <p className="tour-why">{item.why}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- pricing teaser */

function PricingTeaser({ site }: { site: SiteConfig }) {
  const m = site.pricing!.model!;
  return (
    <section className="site-section pm" id="pricing" aria-labelledby="pricing-title">
      <div className="site-container">
        <SectionHead
          id="pricing-title"
          n={4}
          eyebrow={m.eyebrow ?? 'Pricing'}
          title={m.title}
          lead={m.intro}
          action={
            site.flags.showPricing ? (
              <Link to="/pricing" className="btn btn-secondary btn-lg site-section-action">
                Plans and estimator <ArrowRight size={14} aria-hidden />
              </Link>
            ) : undefined
          }
        />
        {m.paths && m.paths.length > 0 ? <PricingPaths site={site} /> : <PricingSteps model={m} />}
        <ComputeTiers site={site} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ audiences */

function Audiences({ site }: { site: SiteConfig }) {
  return (
    <section className="site-section site-section-alt" id="who" aria-labelledby="who-title">
      <div className="site-container">
        <SectionHead id="who-title" n={5} eyebrow="Who it is for" title="One platform, three ways in" />
        <div className="site-audience-grid" data-reveal="children">
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
    <section className="site-section" id="questions" aria-labelledby="trust-title">
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
        <dl className="site-qa" data-reveal="children">
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
        <div className="site-closing" data-reveal>
          <div className="site-closing-glow" aria-hidden />
          <div className="site-closing-copy">
            <h2 id="cta-title" className="site-h2">
              {c?.title ?? site.brand.tagline}
            </h2>
            {c?.body && <p className="site-section-lead">{c.body}</p>}
          </div>
          <div className="site-hero-actions" data-reveal="children">
            {primary && <Cta cta={primary} size="xl" />}
            {secondary && <Cta cta={secondary} variant="secondary" size="xl" />}
          </div>
        </div>
      </div>
    </section>
  );
}
