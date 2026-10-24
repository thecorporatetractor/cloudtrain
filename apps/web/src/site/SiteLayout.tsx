import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowUpRight, LayoutDashboard, LogIn, Menu, Moon, ShieldCheck, Sun, Sunset, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/api/client';
import { DEFAULT_BRAND, useSite } from '@/api/public';
import type { SiteConfig } from '@/api/types';
import { BrandLockup, BrandMark, BrandName, useBrandName } from '@/components/brand';
import { Dropdown, Tooltip } from '@/components/ui';
import { THEMES, useTheme, type Theme } from '@/lib/theme';
import { ON_SITE, surfaceConfig } from '@/lib/surface';
import { cn } from '@/lib/utils';
import { ComingSoon } from './ComingSoon';
import { ComingSoonChrome } from './ComingSoonChrome';
import { isComingSoon, keepsOwnPage, launchKnown } from './launch';
import { linkKey, SignInLink, SiteAnchor } from './util';



/*
 * Chrome of the public website: a sticky header with the primary navigation,
 * the theme switcher and "Sign in" / "Go to dashboard", the page, and a footer
 * built from the site configuration. Every public route renders inside it; the
 * signed-in app keeps its sidebar shell (app/Shell.tsx).
 */

interface NavEntry {
  /** Website route, optionally with a section hash (`/#how-it-works`). */
  to: string;
  label: string;
}

/** The header navigation: the catalog and its paths, the two landing sections, pricing when enabled. */
export function siteNav(site: SiteConfig | undefined): NavEntry[] {
  const flags = site?.flags;
  return [
    ...(flags?.showCatalog !== false ? [{ to: '/catalog', label: 'Catalog' }, { to: '/catalog#paths', label: 'Learning paths' }] : []),
    { to: '/#how-it-works', label: 'How it works' },
    { to: '/#teams', label: 'For teams' },
    ...(flags?.showPricing ? [{ to: '/pricing', label: 'Pricing' }] : []),
  ];
}

/** The pages that live in the drawer and the footer rather than the header. */
const SECONDARY_NAV: NavEntry[] = [
  { to: '/about', label: 'About' },
  { to: '/faq', label: 'FAQ' },
  { to: '/contact', label: 'Contact' },
];

const split = (to: string): [string, string] => {
  const [path, hash] = to.split('#');
  return [path || '/', hash ?? ''];
};

/** Active when the pathname matches and, for section links, the hash does too (a plain `/catalog` is not active on `/catalog#paths`). */
function isActive(entry: NavEntry, pathname: string, hash: string): boolean {
  const [path, h] = split(entry.to);
  const onPath = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
  if (!onPath) return false;
  return h ? hash === h : !hash || path !== '/';
}

function NavLink({ entry, className, current }: { entry: NavEntry; className: string; current: boolean }) {
  const [path, hash] = split(entry.to);
  const aria = current ? ('page' as const) : undefined;
  // `/catalog` validates its search params, so it gets an explicit empty search.
  if (path === '/catalog') {
    return (
      <Link to="/catalog" search={{}} hash={hash || undefined} className={className} aria-current={aria}>
        {entry.label}
      </Link>
    );
  }
  return (
    <Link to={path as '/'} hash={hash || undefined} className={className} aria-current={aria}>
      {entry.label}
    </Link>
  );
}

const themeIcon: Record<Theme, ReactNode> = { dark: <Moon size={15} />, light: <Sun size={15} />, cream: <Sunset size={15} /> };

/**
 * The website scrolls inside `.shell-site`, not the window, so the router's
 * scroll restoration does not reach it: a new page starts at the top and a
 * section link scrolls to its target (the header is sticky; sections carry a
 * scroll margin).
 */
function useSiteScroll() {
  const location = useRouterState({ select: (s) => s.location });
  const { pathname, hash } = location;
  useEffect(() => {
    // After the frame in which the drawer closes and returns focus, so the scroll is not cancelled.
    const id = window.setTimeout(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (hash) {
        const el = document.getElementById(hash);
        if (el) {
          el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
          return;
        }
      }
      document.querySelector('.shell-site')?.scrollTo({ top: 0 });
    }, 60);
    return () => window.clearTimeout(id);
  }, [pathname, hash]);
}

export function SiteLayout({ children }: { children: ReactNode }) {
  useSiteScroll();
  const site = useSite().data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Until the configuration says which website this is, neither chrome is drawn (no flash of the other one).
  if (!launchKnown(site)) {
    return (
      <div className="site">
        <main id="main" className="site-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    );
  }
  // Pre-launch (src/site/launch.ts): one standalone page in its own chrome; only the legal pages keep theirs.
  if (isComingSoon(site)) {
    return <ComingSoonChrome themeMenu={<ThemeMenu />}>{keepsOwnPage(pathname) ? children : <ComingSoon />}</ComingSoonChrome>;
  }
  return (
    <div className="site">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="site-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** "Sign in" for visitors (back to this page afterwards), "Go to dashboard" once signed in. */
export function SessionButton({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const me = useMe();
  const location = useRouterState({ select: (s) => s.location });
  // The website origin has no platform behind it unless the app's origin is configured.
  if (ON_SITE && !surfaceConfig.appUrl) return null;
  if (me.isSuccess) {
    return (
      <Link to="/" className={cn('btn btn-primary', `btn-${size}`, className)}>
        <LayoutDashboard size={14} aria-hidden /> Go to dashboard
      </Link>
    );
  }
  const here = location.pathname + location.searchStr;
  return (
    <SignInLink returnTo={here !== '/' ? here : undefined} className={cn('btn btn-primary', `btn-${size}`, className)}>
      <LogIn size={14} aria-hidden /> Sign in
    </SignInLink>
  );
}

/** The brand in the header and footer: the approved lockup, or a deployment's own logo and name (content/site.yaml `brand`). */
function SiteBrand({ height = 22 }: { height?: number }) {
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

/** The theme switcher of the website header. */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <Dropdown.Root>
      <Tooltip content="Theme">
        <Dropdown.Trigger asChild>
          <button type="button" className="site-icon-btn" aria-label={`Theme: ${theme}`}>
            {themeIcon[theme]}
          </button>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content align="end" sideOffset={8}>
        <Dropdown.Label>Appearance</Dropdown.Label>
        <Dropdown.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map((t) => (
            <Dropdown.RadioItem key={t.id} value={t.id}>
              {themeIcon[t.id]}
              <span className="grow">{t.label}</span>
              <span className="subtle xs">{t.hint}</span>
            </Dropdown.RadioItem>
          ))}
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}

function SiteHeader() {
  const site = useSite().data;
  const brand = useBrandName();
  const location = useRouterState({ select: (s) => s.location });
  const { pathname, hash } = location;
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname, hash]);
  const nav = siteNav(site);

  return (
    <header className="site-header">
      <div className="site-container site-header-inner">
        <Link to="/" className="site-brand" aria-label={`${brand} home`}>
          <SiteBrand />
        </Link>
        <nav className="site-nav" aria-label="Website">
          {nav.map((n) => {
            const current = isActive(n, pathname, hash);
            return <NavLink key={n.to} entry={n} className={cn('site-nav-link', current && 'is-active')} current={current} />;
          })}
        </nav>
        <div className="site-header-actions">
          <ThemeMenu />
          <SessionButton className="site-session-btn" />
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger asChild>
              <button ref={menuButton} type="button" className="site-icon-btn site-menu-btn" aria-label="Open menu" aria-expanded={open} aria-controls="site-drawer" aria-haspopup="dialog">
                <Menu size={20} />
              </button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="dialog-overlay" />
              <DialogPrimitive.Content id="site-drawer" className="site-drawer" aria-describedby={undefined} onCloseAutoFocus={(e) => (e.preventDefault(), menuButton.current?.focus({ preventScroll: true }))}>
                <div className="site-drawer-head">
                  <DialogPrimitive.Title className="site-drawer-title">
                    <BrandLockup height={20} title={`${brand} menu`} />
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <button type="button" className="site-icon-btn" aria-label="Close menu">
                      <X size={18} />
                    </button>
                  </DialogPrimitive.Close>
                </div>
                <nav className="site-drawer-nav" aria-label="Website">
                  <Link to="/" className={cn('site-drawer-link', pathname === '/' && !hash && 'is-active')} aria-current={pathname === '/' && !hash ? 'page' : undefined}>
                    Home
                  </Link>
                  {nav.map((n) => {
                    const current = isActive(n, pathname, hash);
                    return <NavLink key={n.to} entry={n} className={cn('site-drawer-link', current && 'is-active')} current={current} />;
                  })}
                  <span className="site-drawer-sep" aria-hidden />
                  {SECONDARY_NAV.map((n) => {
                    const current = isActive(n, pathname, hash);
                    return <NavLink key={n.to} entry={n} className={cn('site-drawer-link site-drawer-link-secondary', current && 'is-active')} current={current} />;
                  })}
                </nav>
                <div className="site-drawer-foot">
                  <SessionButton size="lg" />
                  <div className="site-theme-chips" role="group" aria-label="Theme">
                    {THEMES.map((t) => (
                      <button key={t.id} type="button" className={cn('chip', theme === t.id && 'is-on')} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                        {themeIcon[t.id]} {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </div>
    </header>
  );
}

/** Links to pages a flag has turned off are dropped rather than leading to an empty page. */
function visibleLink(to: string, site: SiteConfig): boolean {
  const route = to.split(/[?#]/)[0] ?? '';
  if (route === '/pricing') return site.flags.showPricing;
  if (route.startsWith('/catalog')) return site.flags.showCatalog;
  return true;
}

function SiteFooter() {
  const site = useSite().data;
  const brand = useBrandName();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <Link to="/" className="site-brand" aria-label={`${brand} home`}>
              <SiteBrand height={24} />
            </Link>
            <p className="site-footer-tagline">{site?.brand.tagline}</p>
            {site?.footer.note && <p className="site-footer-note">{site.footer.note}</p>}
          </div>
          {site?.footer.columns.map((c) => (
            <nav key={c.title} className="site-footer-col" aria-label={c.title}>
              <h3>{c.title}</h3>
              <ul>
                {c.links.filter((l) => visibleLink(l.to, site)).map((l) => (
                  <li key={linkKey(l)}>
                    <SiteAnchor to={l.to} external={l.external} className="site-footer-link">
                      {l.label}
                      {!l.to.startsWith('/') && <ArrowUpRight size={13} aria-hidden />}
                    </SiteAnchor>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        {site?.legal.alignmentNotice && (
          <p className="site-notice">
            <ShieldCheck size={14} aria-hidden /> <span>{site.legal.alignmentNotice}</span>
          </p>
        )}
        <div className="site-footer-bottom">
          <span>
            © {year} {site?.brand.legalName ?? brand}
          </span>
          <span className="site-footer-legal">
            <SiteAnchor to="/legal/terms" className="site-footer-link">
              Terms
            </SiteAnchor>
            <SiteAnchor to="/legal/privacy" className="site-footer-link">
              Privacy
            </SiteAnchor>
          </span>
        </div>
      </div>
    </footer>
  );
}
