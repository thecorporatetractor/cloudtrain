import { Link } from '@tanstack/react-router';
import { Mail, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSite } from '@/api/public';
import { BrandLockup, useBrandName } from '@/components/brand';

/*
 * Chrome of the coming-soon website (src/site/launch.ts): brand, links to the
 * sections of the page, the theme menu and "Join the waitlist" in the header;
 * pricing, questions, legal pages, the contact address and the source in the
 * footer. Nothing leads into the platform. The page itself (ComingSoon.tsx) is
 * loaded lazily, this stays small.
 */

const hostOf = (href: string): string => {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
};

/** A link to a section of the coming-soon page, from any path. */
export function CsLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <Link to="/" hash={id} className={className}>
      {children}
    </Link>
  );
}

export function ComingSoonChrome({ children, themeMenu }: { children: ReactNode; themeMenu: ReactNode }) {
  const site = useSite().data;
  const brand = useBrandName();
  const cta = site?.launch?.ctaLabel ?? 'Join the waitlist';
  const year = new Date().getFullYear();
  const links = site?.footer.columns.flatMap((c) => c.links) ?? [];
  const licensing = links.find((l) => /licens/i.test(l.label));
  const repo = links.find((l) => hostOf(l.to) === 'github.com' && l !== licensing);
  return (
    <div className="site cs">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-container site-header-inner">
          <Link to="/" className="site-brand" aria-label={`${brand} home`}>
            <BrandLockup height={22} title={brand} />
          </Link>
          <nav className="site-nav cs-nav" aria-label="Sections">
            <CsLink id="what" className="site-nav-link">
              What it is
            </CsLink>
            <CsLink id="pricing" className="site-nav-link">
              Pricing
            </CsLink>
            <CsLink id="faq" className="site-nav-link">
              FAQ
            </CsLink>
          </nav>
          <div className="site-header-actions">
            {themeMenu}
            {site?.waitlist?.enabled && (
              <CsLink id="waitlist" className="btn btn-primary btn-md cs-header-cta">
                {cta}
              </CsLink>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="site-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer cs-footer">
        <div className="site-container">
          <div className="cs-footer-top">
            <div className="site-footer-brand">
              <Link to="/" className="site-brand" aria-label={`${brand} home`}>
                <BrandLockup height={24} title={brand} />
              </Link>
              <p className="site-footer-tagline">{site?.brand.tagline}</p>
            </div>
            <nav className="cs-footer-links" aria-label="Footer">
              <CsLink id="pricing" className="site-footer-link">
                Pricing
              </CsLink>
              <CsLink id="faq" className="site-footer-link">
                FAQ
              </CsLink>
              <Link to="/legal/terms" className="site-footer-link">
                Terms
              </Link>
              <Link to="/legal/privacy" className="site-footer-link">
                Privacy
              </Link>
              {site?.contact.email && (
                <a href={`mailto:${site.contact.email}`} className="site-footer-link">
                  <Mail size={13} aria-hidden /> {site.contact.email}
                </a>
              )}
              {licensing && (
                <a href={licensing.to} className="site-footer-link" target="_blank" rel="noopener noreferrer">
                  {licensing.label}
                </a>
              )}
              {repo && (
                <a href={repo.to} className="site-footer-link" target="_blank" rel="noopener noreferrer">
                  Source code
                </a>
              )}
            </nav>
          </div>
          {site?.footer.note && <p className="site-footer-note">{site.footer.note}</p>}
          {site?.legal.alignmentNotice && (
            <p className="site-notice">
              <ShieldCheck size={14} aria-hidden /> <span>{site.legal.alignmentNotice}</span>
            </p>
          )}
          <div className="site-footer-bottom">
            <span>
              © {year} {site?.brand.legalName ?? brand}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
