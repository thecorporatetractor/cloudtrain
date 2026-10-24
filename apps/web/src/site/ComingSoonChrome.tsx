import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useSite } from '@/api/public';
import { BrandLockup, useBrandName } from '@/components/brand';
import { SiteFooter } from './Footer';

/*
 * Chrome of the coming-soon website (src/site/launch.ts): brand, links to the
 * sections of the page, the theme menu and "Join the waitlist" in the header;
 * the shared footer (Footer.tsx) without the links into the platform. The page
 * itself (ComingSoon.tsx) is loaded lazily, this stays small.
 */

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
      <SiteFooter />
    </div>
  );
}
