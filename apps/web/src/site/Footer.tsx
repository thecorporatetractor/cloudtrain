import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Mail, Moon, ShieldCheck, Sun, Sunset } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEFAULT_BRAND, useSite } from '@/api/public';
import type { SiteConfig } from '@/api/types';
import { BrandLockup, BrandMark, BrandName, useBrandName } from '@/components/brand';
import { THEMES, useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { isComingSoon } from './launch';
import { linkKey, SiteAnchor } from './util';

/*
 * The footer of the public website, shared by the live chrome (SiteLayout) and
 * the coming-soon chrome: the brand lockup with its tagline, the link columns
 * from content/site.yaml `footer.columns` (Product, Company, Resources, Legal)
 * with the contact address under Company, the alignment notice, the copyright
 * line with the licence note, and the theme switch. In coming-soon mode the
 * links into the platform are dropped and /pricing and /faq become links to the
 * sections of the one page.
 */

export const themeIcon: Record<Theme, ReactNode> = { dark: <Moon size={15} />, light: <Sun size={15} />, cream: <Sunset size={15} /> };

/** The brand in the header and footer: the approved lockup, or a deployment's own logo and name (content/site.yaml `brand`). */
export function SiteBrand({ height = 22 }: { height?: number }) {
  const site = useSite().data;
  const brand = useBrandName();
  if (site?.brand.logo || brand !== DEFAULT_BRAND) {
    return (
      <>
        <BrandMark size={height + 4} />
        <BrandName height={Math.round(height * 0.6)} />
      </>
    );
  }
  return <BrandLockup height={height} title={brand} />;
}

type FooterLink = SiteConfig['footer']['columns'][number]['links'][number];

/** The link as this website shows it, or undefined when the page behind it is not on this website. */
function retarget(l: FooterLink, site: SiteConfig, soon: boolean): FooterLink | undefined {
  if (!l.to.startsWith('/')) return l;
  const route = l.to.split(/[?#]/)[0] ?? '';
  if (soon) {
    if (route === '/pricing') return site.pricing?.model ? { ...l, to: '/#pricing' } : undefined;
    if (route === '/faq') return { ...l, to: '/#faq' };
    if (route === '/' || route.startsWith('/legal')) return l;
    return undefined;
  }
  if (route === '/pricing' && !site.flags.showPricing) return undefined;
  if (route.startsWith('/catalog') && !site.flags.showCatalog) return undefined;
  return l;
}

export function SiteFooter() {
  const site = useSite().data;
  const brand = useBrandName();
  const { theme, setTheme } = useTheme();
  const year = new Date().getFullYear();
  if (!site) return null;
  const soon = isComingSoon(site);
  const email = site.contact.email;
  const columns = site.footer.columns.map((c) => ({ title: c.title, links: c.links.map((l) => retarget(l, site, soon)).filter((l): l is FooterLink => !!l) })).filter((c) => c.links.length > 0);
  const companyAt = columns.findIndex((c) => /company/i.test(c.title));
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer-grid" data-reveal="children">
          <div className="site-footer-brand">
            <Link to="/" className="site-brand" aria-label={`${brand} home`}>
              <SiteBrand height={24} />
            </Link>
            <p className="site-footer-tagline">{site.brand.tagline}</p>
            {email && companyAt < 0 && (
              <a href={`mailto:${email}`} className="site-footer-link">
                <Mail size={13} aria-hidden /> {email}
              </a>
            )}
          </div>
          {columns.map((c, i) => (
            <nav key={c.title} className="site-footer-col" aria-label={c.title}>
              <h3>{c.title}</h3>
              <ul>
                {c.links.map((l) => (
                  <li key={linkKey(l)}>
                    <SiteAnchor to={l.to} external={l.external} className="site-footer-link">
                      {l.label}
                      {!l.to.startsWith('/') && <ArrowUpRight size={13} aria-hidden />}
                    </SiteAnchor>
                  </li>
                ))}
                {email && i === companyAt && (
                  <li>
                    <a href={`mailto:${email}`} className="site-footer-link">
                      <Mail size={13} aria-hidden /> {email}
                    </a>
                  </li>
                )}
              </ul>
            </nav>
          ))}
        </div>
        {site.legal.alignmentNotice && (
          <p className="site-notice">
            <ShieldCheck size={14} aria-hidden /> <span>{site.legal.alignmentNotice}</span>
          </p>
        )}
        <div className="site-footer-bottom">
          <div className="site-footer-bottom-copy">
            <span>
              © {year} {site.brand.legalName ?? brand}
            </span>
            {site.footer.note && <span className="site-footer-note">{site.footer.note}</span>}
          </div>
          <div className="site-theme-chips" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={cn('chip', theme === t.id && 'is-on')} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                {themeIcon[t.id]} {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
