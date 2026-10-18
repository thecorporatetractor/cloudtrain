import { Link } from '@tanstack/react-router';
import { ArrowRight, Clock, Mail, Phone, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSite } from '@/api/public';
import type { SiteConfig, SiteLegalDocument } from '@/api/types';
import { Badge, Card, PageSkeleton } from '@/components/ui';
import { Cta } from './Landing';
import { linkKey, Paragraphs, SiteAnchor, useDocumentTitle } from '@/site/util';

/*
 * The small public pages: pricing (plans arrive with the next schema version),
 * about, FAQ, contact, terms and privacy. All copy is configuration
 * (content/site.yaml); the pages only lay it out.
 */

function SitePage({ title, eyebrow, lead, children, narrow }: { title: string; eyebrow?: string; lead?: ReactNode; children: ReactNode; narrow?: boolean }) {
  const site = useSite();
  useDocumentTitle(title);
  if (site.isPending) {
    return (
      <div className="site-container site-page">
        <PageSkeleton />
      </div>
    );
  }
  return (
    <div className={narrow ? 'site-container site-page site-page-narrow' : 'site-container site-page'}>
      <header className="site-page-head site-page-head-stack">
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="site-h1">{title}</h1>
        {lead && <p className="muted site-lead-sm">{lead}</p>}
      </header>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ pricing */

export function Pricing() {
  const site = useSite().data;
  const p = site?.pricing;
  return (
    <SitePage title={p?.headline ?? 'Pricing'} eyebrow="Pricing" lead={p?.intro}>
      {site && !site.flags.showPricing && (
        <Card className="site-pricing-soon">
          <div className="stack" style={{ gap: 8 }}>
            <Badge tone="warn">Not published yet</Badge>
            <h2>Plans are being finalised</h2>
            <p className="muted small" style={{ maxWidth: 520 }}>
              Individual and organisation plans with lab hours, concurrent labs, environment tiers, exam simulations and events will be listed here. Until then, talk to us about a pilot.
            </p>
          </div>
          {p?.contactCta && <Cta cta={p.contactCta} size="md" />}
        </Card>
      )}
      {site?.legal.alignmentNotice && (
        <p className="site-notice xs subtle" style={{ marginTop: 28 }}>
          <ShieldCheck size={12} aria-hidden /> {site.legal.alignmentNotice}
        </p>
      )}
    </SitePage>
  );
}

/* -------------------------------------------------------------------- about */

export function About() {
  const site = useSite().data;
  const a = site?.about;
  return (
    <SitePage title={a?.title ?? 'About'} eyebrow="About" narrow>
      <div className="split split-7-5">
        <div className="site-prose">{a && <Paragraphs text={a.paragraphs} />}</div>
        {a?.facts && a.facts.length > 0 && (
          <Card>
            <dl className="site-facts">
              {a.facts.map((f) => (
                <div key={f.label} className="site-fact">
                  <dt className="xs subtle">{f.label}</dt>
                  <dd className="small">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 32, flexWrap: 'wrap' }}>
        <Link to="/catalog" search={{}} className="btn btn-primary btn-md">
          Browse the catalog <ArrowRight size={13} aria-hidden />
        </Link>
        <Link to="/contact" className="btn btn-secondary btn-md">
          Contact
        </Link>
      </div>
    </SitePage>
  );
}

/* ---------------------------------------------------------------------- faq */

export function Faq() {
  const site = useSite().data;
  const groups = new Map<string, SiteConfig['faq']>();
  for (const f of site?.faq ?? []) {
    const g = f.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  return (
    <SitePage title="Frequently asked questions" eyebrow="FAQ" narrow lead="Short answers about labs, simulations, organisations and content.">
      <div className="stack" style={{ gap: 28 }}>
        {[...groups.entries()].map(([group, items]) => (
          <section key={group || 'general'} aria-labelledby={group ? `faq-${slug(group)}` : undefined}>
            {group && (
              <h2 id={`faq-${slug(group)}`} className="site-h3" style={{ marginBottom: 10 }}>
                {group}
              </h2>
            )}
            <div className="site-faq">
              {items.map((f) => (
                <details key={f.q} className="site-faq-item">
                  <summary>{f.q}</summary>
                  <p className="small muted">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 32 }}>
        Something else?{' '}
        <Link to="/contact" className="link-quiet">
          Ask us
        </Link>
        .
      </p>
    </SitePage>
  );
}

/* ------------------------------------------------------------------ contact */

export function Contact() {
  const site = useSite().data;
  const c = site?.contact;
  return (
    <SitePage title={c?.title ?? 'Contact'} eyebrow="Contact" lead={c?.intro} narrow>
      <div className="split split-5-7">
        <Card className="stack" style={{ gap: 14 }}>
          {c?.email && (
            <a href={`mailto:${c.email}`} className="site-contact-row">
              <Mail size={15} aria-hidden />
              <span className="stack" style={{ gap: 1 }}>
                <span className="xs subtle">General</span>
                <span className="small">{c.email}</span>
              </span>
            </a>
          )}
          {c?.salesEmail && (
            <a href={`mailto:${c.salesEmail}`} className="site-contact-row">
              <Mail size={15} aria-hidden />
              <span className="stack" style={{ gap: 1 }}>
                <span className="xs subtle">Sales and pilots</span>
                <span className="small">{c.salesEmail}</span>
              </span>
            </a>
          )}
          {c?.phone && (
            <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="site-contact-row">
              <Phone size={15} aria-hidden />
              <span className="small">{c.phone}</span>
            </a>
          )}
          {c?.hours && (
            <span className="site-contact-row">
              <Clock size={15} aria-hidden />
              <span className="small muted">{c.hours}</span>
            </span>
          )}
          {c?.address && c.address.length > 0 && (
            <address className="small muted" style={{ fontStyle: 'normal', paddingLeft: 27 }}>
              {c.address.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </address>
          )}
        </Card>
        <div className="stack" style={{ gap: 12 }}>
          {c?.links && c.links.length > 0 && (
            <Card>
              <h3>Elsewhere</h3>
              <ul className="site-list small" style={{ marginTop: 8 }}>
                {c.links.map((l) => (
                  <li key={linkKey(l)}>
                    <SiteAnchor to={l.to} external={l.external} className="link-quiet">
                      {l.label} <ArrowRight size={11} aria-hidden />
                    </SiteAnchor>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h3>Already a customer?</h3>
            <p className="small muted" style={{ marginTop: 6 }}>
              Your organisation's administrator manages people, teams and access. Sign in and ask through the help menu.
            </p>
            <Link to="/sign-in" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }}>
              Sign in
            </Link>
          </Card>
        </div>
      </div>
    </SitePage>
  );
}

/* -------------------------------------------------------------------- legal */

function LegalPage({ doc }: { doc: SiteLegalDocument | undefined }) {
  return (
    <SitePage title={doc?.title ?? 'Legal'} eyebrow="Legal" narrow lead={doc ? `Last updated ${doc.updated}` : undefined}>
      {doc?.placeholder && (
        <p className="site-callout small" role="note">
          <Badge tone="warn">Placeholder</Badge> This document is a draft that has not passed legal review. It will be replaced before paid plans open.
        </p>
      )}
      <div className="site-prose">
        {doc?.sections.map((s) => (
          <section key={s.title} aria-labelledby={`legal-${slug(s.title)}`}>
            <h2 id={`legal-${slug(s.title)}`} className="site-h3">
              {s.title}
            </h2>
            <Paragraphs text={s.paragraphs} />
          </section>
        ))}
      </div>
    </SitePage>
  );
}

export function Terms() {
  return <LegalPage doc={useSite().data?.legal.terms} />;
}

export function Privacy() {
  return <LegalPage doc={useSite().data?.legal.privacy} />;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
